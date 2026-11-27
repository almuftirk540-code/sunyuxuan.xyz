import { computeMetrics, evaluateFeatureTerms, buildCitationIntelligence } from './metrics-core.mjs';

const distinct = (values) => [...new Set(values)];
const table = (title, columns, rows) => ({ title, columns, rows });
const platformNames = {
  doubao: '豆包',
  deepseek: 'DeepSeek',
  tongyi: '通义千问',
  yuanbao: '腾讯元宝',
  kimi: 'Kimi',
  ernie: '文心一言',
  chatglm: '智谱清言',
};
const platformName = (id) => platformNames[id] ?? id;
const sceneNames = {
  symptom: '泛症状选药',
  category_form: '品类与剂型对比',
  brand_compare: '品牌推荐与横评',
  safety_combo: '安全与联用',
};
const pct = (n) => (n == null ? '—' : (n * 100).toFixed(1) + '%');
export function formatCell(value) {
  if (value == null) return '—';
  if (typeof value !== 'object') return String(value);
  if ('deltaPp' in value) {
    const raw = value.deltaPp;
    if (raw == null) return '不可比';
    const n = Math.abs(raw) < 0.05 ? 0 : raw;
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  return pct(value.rate) + ' (' + value.hits + '/' + value.denominator + ')';
}

// Express each eligible sample and binary outcome through the core's common-unit calculation.
export function metricProjection(snapshot, metric, scene) {
  if (!metric && !scene) return snapshot;
  const questions = new Map(snapshot.project.questions.map((q) => [q.seq, q]));
  const name = snapshot.project.targetBrand.canonical;
  const slots = snapshot.slots.filter((s) => {
    const q = questions.get(s.questionSeq);
    return (
      (!scene || scene === q.scene) &&
      (metric !== 'unpromptedBrandMention' || !q.promptBrands.includes(name)) &&
      (!['firstRecommendation', 'soleFirst', 'coFirst'].includes(metric) || q.hasRecommendationIntent)
    );
  });
  const roles = { firstRecommendation: ['sole_first', 'co_first'], soleFirst: ['sole_first'], coFirst: ['co_first'] };
  return {
    ...snapshot,
    slots: !metric
      ? slots
      : slots.map((s) => {
          if (!s.responseId) return s;
          const hit =
            metric === 'genericMention'
              ? s.genericMentioned
              : s.brands.some((b) => b.canonical === name && (!roles[metric] || roles[metric].includes(b.role)));
          return { ...s, brands: hit ? [{ canonical: name, role: 'mentioned_not_first' }] : [] };
        }),
  };
}

// A content fingerprint for stable edition identifiers, not a signature.
function fingerprint(value) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}
function editionId(snapshot, query, narrative) {
  const time = Date.parse(snapshot.generatedAt).toString(16).padStart(12, '0');
  const hash = fingerprint([snapshot.snapshotId, query, narrative]);
  return (
    time.slice(0, 8) +
    '-' +
    time.slice(8) +
    '-7' +
    hash.slice(0, 3) +
    '-8' +
    hash.slice(3, 6) +
    '-' +
    hash.slice(6) +
    snapshot.snapshotId.slice(-2)
  );
}

export function normalizeReportQuery(snapshot, state = {}) {
  const granularity = state.granularity ?? 'week';
  if (!['week', 'month'].includes(granularity)) throw Error('周期粒度必须为 week 或 month');
  const ids = distinct(snapshot.periods.map((p) => (granularity === 'month' ? p.monthKey : p.periodId))).sort();
  const platforms = distinct(snapshot.periods.flatMap((p) => p.platforms));
  const currentPeriod = state.currentPeriod ?? ids.at(-1) ?? '';
  const comparePeriod =
    state.comparePeriod === undefined ? (ids[ids.indexOf(currentPeriod) - 1] ?? '') : state.comparePeriod || '';
  const selectedPeriods = state.selectedPeriods ?? ids;
  if ([currentPeriod, comparePeriod, ...selectedPeriods].some((id) => id && !ids.includes(id)))
    throw Error('快照中没有所选周期');
  if (state.platforms?.some((p) => !platforms.includes(p))) throw Error('快照中没有所选平台');
  if (state.dataOriginFilter && !['all', 'real'].includes(state.dataOriginFilter)) throw Error('无效的数据来源筛选');
  return {
    granularity,
    currentPeriod,
    comparePeriod,
    selectedPeriods: ids.filter((id) => selectedPeriods.includes(id)),
    platforms: platforms.filter((p) => !state.platforms || state.platforms.includes(p)),
    dataOriginFilter: state.dataOriginFilter ?? 'all',
    featureTerms: structuredClone(state.featureTerms ?? state.terms ?? snapshot.project.defaultFeatureTerms),
  };
}

export function reportScope(snapshot, query) {
  const selected = new Set([...query.selectedPeriods, query.currentPeriod, query.comparePeriod]);
  const periods = snapshot.periods.filter((p) => selected.has(query.granularity === 'month' ? p.monthKey : p.periodId));
  const ids = new Set(periods.map((p) => p.periodId));
  const slots = snapshot.slots
    .filter((s) => ids.has(s.periodId) && query.platforms.includes(s.platform))
    .map((s) => {
      if (query.dataOriginFilter !== 'real' || !s.isSynthetic) return s;
      const { periodId, questionSeq, platform, repeatIndex } = s;
      return { periodId, questionSeq, platform, repeatIndex };
    });
  return { ...snapshot, periods, slots };
}

function mode(samples, key) {
  const known = samples.filter((s) => s[key] != null);
  const hits = known.filter((s) => s[key] === 1).length;
  return { hits, denominator: known.length, rate: known.length ? hits / known.length : null };
}
function strongest(rows) {
  return rows
    .filter((r) => r.delta.deltaPp != null)
    .sort((a, b) => Math.abs(b.delta.deltaPp) - Math.abs(a.delta.deltaPp))[0];
}
function concentration(label, row) {
  return row
    ? label + '中提及率变动幅度最大的是' + row.name + '（' + formatCell(row.delta) + '）。'
    : label + '无共同可比单元。';
}
function prepareOverview(snapshot, query, m, platformRows) {
  const labels = {
    brandMention: '品牌提及率',
    unpromptedBrandMention: '未点名提及率',
    firstRecommendation: '品牌首推率',
    soleFirst: '唯一首推率',
    coFirst: '并列首推率',
    genericMention: '通用名提及率',
  };
  const rows = [],
    trends = [],
    series = m.periodSeries;
  const base = computeMetrics(snapshot, { ...query, currentPeriod: query.comparePeriod, selectedPeriods: [] });
  for (const [key, label] of Object.entries(labels)) {
    if (key === 'genericMention' && !snapshot.project.hasGenericName) continue;
    const projected = key === 'brandMention' ? m : computeMetrics(metricProjection(snapshot, key), query);
    const stat = (row) => row[key] ?? row.firstRecommendation[key];
    rows.push([label, stat(m), stat(base), projected.comparableDelta, projected.comparableDelta.commonUnits]);
    series.forEach((p, i) => {
      const d = projected.periodSeries[i].comparableDelta;
      trends.push([p.periodId, label, stat(p), i ? d : null, d.commonUnits]);
    });
  }
  const completion = (r) => ({ hits: r.validResponses, denominator: r.plannedSlots, rate: r.completionRate });
  rows.push(['采集完成度', completion(m), completion(base), null, null]);
  series.forEach((p) => trends.push([p.periodId, '采集完成度', completion(p), null, null]));
  const platform = strongest(
    platformRows.map(({ id, stats }) => ({ name: platformName(id), delta: stats.comparableDelta })),
  );
  const scene = strongest(m.sceneMatrix.map((s) => ({ name: sceneNames[s.scene], delta: s.comparableDelta })));
  return [
    {
      title: '一、核心结论与跨期表现总览',
      findings: [
        '本期品牌提及率为 ' + formatCell(m.brandMention) + '，共同单元环比为 ' + formatCell(m.comparableDelta) + '。',
        concentration('平台', platform),
        concentration('场景', scene),
      ],
      tables: [table('当前期与基准期', ['指标', '当前期', '基准期', '可比环比', '|C|'], rows)],
    },
    {
      title: '二、连续多周 / 跨月趋势分析',
      findings: [
        series.length
          ? '趋势覆盖 ' + series[0].periodId + ' 至 ' + series.at(-1).periodId + '，共 ' + series.length + ' 期。'
          : '所选范围暂无周期。',
      ],
      chart: {
        kind: 'trend',
        title: '品牌提及率走势',
        labels: series.map((p) => p.periodId),
        values: series.map((p) => p.brandMention),
      },
      tables: [table('逐期表现与前一选定期环比', ['周期', '指标', '有效样本命中率', '可比环比', '|C|'], trends)],
    },
  ];
}

function platformSection(rows, m) {
  const names = rows.map((r) => platformName(r.id));
  const distribution = m.repeatDistribution;
  return {
    title: '三、七大 AI 平台表现与单题三问一致性拆解',
    findings: [
      '所选平台有 ' +
        distribution.completeUnits +
        ' 个完整三问单元，另有 ' +
        distribution.incompleteUnits +
        ' 个不完整单元。',
    ],
    chart: { kind: 'bars', title: '各平台品牌提及率', labels: names, values: rows.map((r) => r.stats.brandMention) },
    tables: [
      table(
        '平台表现',
        ['平台', '有效 / 计划', '品牌提及率', '可比环比', '首推率', ...(m.genericMention ? ['通用名提及率'] : [])],
        rows.map(({ stats: s }, i) => [
          names[i],
          { hits: s.validResponses, denominator: s.plannedSlots, rate: s.completionRate },
          s.brandMention,
          s.comparableDelta,
          s.firstRecommendation,
          ...(s.genericMention ? [s.genericMention] : []),
        ]),
      ),
      table(
        '每周同题三问命中分布',
        ['平台', '0/3', '1/3', '2/3', '3/3', '不完整单元'],
        [
          ...rows.map((r, i) => [
            names[i],
            ...r.stats.repeatDistribution.bins,
            r.stats.repeatDistribution.incompleteUnits,
          ]),
          ['合计', ...distribution.bins, distribution.incompleteUnits],
        ],
      ),
      table(
        '联网与模型状态',
        ['平台', '联网开启 / 已知', '未知', '深度思考开启 / 已知', '未知', '模型记录'],
        rows.map(({ samples }, i) => {
          const models = new Map();
          for (const s of samples)
            models.set(s.modelLabel || '未披露', (models.get(s.modelLabel || '未披露') ?? 0) + 1);
          const search = mode(samples, 'searchOn'),
            deep = mode(samples, 'deepThinkOn');
          return [
            names[i],
            search,
            samples.length - search.denominator,
            deep,
            samples.length - deep.denominator,
            Array.from(models, ([name, n]) => name + ' × ' + n).join('、') || '—',
          ];
        }),
      ),
    ],
  };
}
function competitorSection(m) {
  const g = m.competitors;
  const entities = [
    ...g.target.map((e) => ['本品', e]),
    ...g.same_generic.map((e) => ['同通用名', e]),
    ...g.other_generic.flatMap((f) => [['异通用名', f], ...f.brands.map((e) => [f.name, e])]),
    ...g.no_generic.map((e) => ['无通用名', e]),
  ];
  return {
    title: '四、四大提问场景与通用名-竞品分层格局',
    findings: m.sceneMatrix.map((s) => sceneNames[s.scene] + '的品牌提及率为 ' + formatCell(s.brandMention) + '。'),
    tables: [
      table(
        '四场景表现矩阵',
        ['场景', '提及率', '未点名提及率', '首推率', '提及率环比'],
        m.sceneMatrix.map((s) => [
          sceneNames[s.scene],
          s.brandMention,
          s.unpromptedBrandMention,
          s.firstRecommendation,
          s.comparableDelta,
        ]),
      ),
      table(
        '同通用名与异通用名竞品',
        ['分层', '实体', '提及率', '未点名提及率', '唯一首推', '并列首推', '提及率环比'],
        entities.map(([tier, e]) => [
          tier,
          e.name,
          e.brandMention,
          e.unpromptedBrandMention,
          e.firstRecommendation.soleFirst,
          e.firstRecommendation.coFirst,
          e.comparableDelta,
        ]),
      ),
    ],
  };
}
function featureSection(snapshot, query, m) {
  const terms = evaluateFeatureTerms(snapshot, query);
  const g = m.competitors;
  const rivals = g.same_generic.length
    ? g.same_generic
    : [...g.other_generic.flatMap((f) => f.brands), ...g.no_generic];
  const rival = [...rivals].sort((a, b) => b.brandMention.hits - a.brandMention.hits)[0]?.name;
  const target = snapshot.project.targetBrand.canonical;
  const excerpts = [];
  for (const t of terms) {
    for (const [label, match] of [
      ['肯定归属', (c) => c.polarity === 'affirmative' && c.subjects.length],
      ['待核', (c) => c.polarity === 'uncertain' || (!c.subjects.length && c.polarity === 'affirmative')],
    ]) {
      const c = t.matchedClauses.find(match);
      if (c)
        excerpts.push([
          t.label,
          label,
          c.clauseText,
          c.subjects.join('、') || '主语未明',
          c.periodId,
          platformName(c.platform) + ' Q' + c.questionSeq,
          c.responseId,
        ]);
    }
  }
  return {
    title: '五、产品特点词表述归属分析',
    findings: [
      '生效词典 ' +
        fingerprint(query.featureTerms) +
        '，共 ' +
        terms.length +
        ' 个词条。' +
        (rival ? '对照品牌为' + rival + '。' : ''),
      ...terms.slice(0, 1).map((t) => t.label + '的词面出现率为 ' + formatCell(t.anyMention) + '。'),
    ],
    tables: [
      table(
        '当前词典与逐回答归属',
        [
          '特点词',
          '检测词面',
          '词面出现率',
          target + '肯定归属率',
          '提及本品中归属率',
          ...(rival ? [rival + '肯定归属率'] : []),
          '待核回答',
        ],
        terms.map((t, i) => [
          t.label,
          query.featureTerms[i].patterns.join(' | '),
          t.anyMention,
          t.targetAffirmative,
          t.givenTargetMentioned,
          ...(rival ? [t.competitorAffirmative[rival]] : []),
          t.uncertainCount,
        ]),
      ),
      table('典型正向与待核原句', ['词条', '判定', '原句', '句中主体', '周期', '问询', '回答 ID'], excerpts),
    ],
  };
}
function citationSection(snapshot, query, samples) {
  const ledger = buildCitationIntelligence(snapshot, query);
  const filtered = buildCitationIntelligence(
    {
      ...snapshot,
      slots: samples.map((s) => ({ ...s, citations: s.citations.filter((c) => c.docCategory !== 'drug_label') })),
    },
    query,
  );
  const competitors = new Set(snapshot.project.competitors.map((c) => c.canonical));
  const articles = ledger.articles
    .filter(
      (a) =>
        a.contentBrands.some((n) => competitors.has(n)) ||
        a.boundClauses.some((c) => c.brandsInClause.some((n) => competitors.has(n))),
    )
    .slice(0, 10);
  function ranking(title, sites) {
    return table(
      title,
      ['排名', '站点', '域名', '覆盖回答', '实引篇次', '搜索候选次数'],
      sites
        .filter((s) => s.inlineArticleCount)
        .map((s, i) => [i + 1, s.siteName, s.domain, s.coverage, s.inlineArticleCount, s.candidateCount]),
    );
  }
  return {
    title: '六、底层引用信源结构与竞品高被引内容证据',
    findings: [
      '当前期有 ' +
        ledger.observableResponseCount +
        ' 条角标可观测回答。按同题同平台核对，共有 ' +
        ledger.blankSites.length +
        ' 条竞品有实引、本品零实引的站点记录。',
    ],
    tables: [
      ranking('全部文类实引站点排行', ledger.sites),
      ranking('排除药品说明书后的实引排行', filtered.sites),
      table(
        '高被引竞品关联文章与角标原句',
        ['文章与规范链接', '来源命中品牌', '实引回答 / 可观测', '角标原句', '句中品牌', '回答 ID'],
        articles.map((a) => {
          const c = a.boundClauses.find((c) => c.brandsInClause.some((n) => competitors.has(n))) ?? a.boundClauses[0];
          return [
            (a.title || '标题未披露') + '\n' + a.urlCanonical,
            a.contentBrands.join('、') || '—',
            a.inlineResponseCount + '/' + a.observableResponseCount,
            c?.clauseText || '角标未绑定原句',
            c?.brandsInClause.join('、'),
            c?.responseId,
          ];
        }),
      ),
      table(
        '本品实引为零的待覆盖站点',
        ['站点', '题号', '平台', '竞品实引', '本品实引', '覆盖周数'],
        ledger.blankSites.map((b) => [
          b.domain,
          b.questionSeq,
          platformName(b.platform),
          b.competitorCoverage,
          b.targetCoverage,
          b.coveredWeeks,
        ]),
      ),
    ],
  };
}

function numberLists(sections, extraCounts) {
  const rates = new Set(),
    points = new Set(),
    integers = new Set(extraCounts);
  for (const chapter of sections)
    for (const t of chapter.tables)
      for (const row of t.rows)
        for (const v of row) {
          if (Number.isSafeInteger(v)) integers.add(v);
          if (v && typeof v === 'object') {
            if ('hits' in v) {
              integers.add(v.hits);
              integers.add(v.denominator);
              if (v.rate != null) rates.add(Number((v.rate * 100).toFixed(1)));
            }
            if (v.deltaPp != null) points.add(Number(v.deltaPp.toFixed(1)));
          }
        }
  return { rates: [...rates], points: [...points], integers: [...integers] };
}

export function validateNarrativeNumbers(text, allowedNumbers) {
  const flat = Array.isArray(allowedNumbers) || allowedNumbers instanceof Set;
  const sets = {};
  for (const key of ['rates', 'points', 'integers']) {
    const numbers = flat ? allowedNumbers : allowedNumbers[key];
    sets[key] = new Set(Array.from(numbers, (n) => Number(Number(n).toFixed(1))));
  }
  const unexpected = new Set();
  const normalized = String(text)
    .normalize('NFKC')
    .replaceAll('−', '-')
    .replace(/百分之\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/gu, '$1%');
  // The prompt requests Arabic numerals. Fail closed for alternative percentage
  // notation that cannot be compared directly at the report's display precision.
  for (const match of normalized.matchAll(
    /百分之[零〇一二两三四五六七八九十百千万亿点负正]+|[零〇一二两三四五六七八九十百千万亿点负正]+\s*(?:个百分点|百分点|%)|\d+(?:\.\d+)?\s*[万亿千百]\s*(?:个百分点|百分点|%)/gu,
  )) {
    unexpected.add(match[0]);
  }
  for (const match of normalized.matchAll(
    /([+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*(个百分点|百分点|pp\b|%)?/gi,
  )) {
    const n = Number(match[1].replaceAll(',', ''));
    const rounded = Number(n.toFixed(1));
    const key = match[2] === '%' ? 'rates' : match[2] ? 'points' : 'integers';
    const valid =
      Number.isFinite(n) &&
      (key === 'rates'
        ? sets.rates.has(rounded) || sets.points.has(rounded)
        : key === 'integers'
          ? Number.isSafeInteger(n) && sets.integers.has(rounded)
          : sets.points.has(rounded));
    if (!valid) unexpected.add(match[0].trim());
  }
  return { ok: !unexpected.size, unexpectedNumbers: [...unexpected] };
}

export function buildReportViewModel(snapshot, queryState = {}, { customNarrative } = {}) {
  const query = normalizeReportQuery(snapshot, queryState);
  const scoped = reportScope(snapshot, query);
  const all = scoped.slots.filter((s) => s.responseId);
  const synthetic = all.filter((s) => s.isSynthetic).length;
  const weeks = new Set(
    scoped.periods
      .filter((p) => (query.granularity === 'month' ? p.monthKey : p.periodId) === query.currentPeriod)
      .map((p) => p.periodId),
  );
  const samples = all.filter((s) => weeks.has(s.periodId));
  const m = computeMetrics(scoped, query);
  const platforms = query.platforms.map((id) => ({
    id,
    stats: computeMetrics(scoped, { ...query, platforms: [id], selectedPeriods: [] }),
    samples: samples.filter((s) => s.platform === id),
  }));
  const chapters = [
    ...prepareOverview(scoped, query, m, platforms),
    platformSection(platforms, m),
    competitorSection(m),
    featureSection(scoped, query, m),
    citationSection(scoped, query, samples),
  ];
  const allowedNumbers = numberLists(chapters, [
    all.length - synthetic,
    synthetic,
    query.selectedPeriods.length,
    query.featureTerms.length,
    chapters[5].tables.at(-1).rows.length,
    samples.filter((s) => s.inlineObservable).length,
    m.comparableDelta.commonUnits,
    m.repeatDistribution.completeUnits,
  ]);
  const validation = validateNarrativeNumbers(customNarrative ?? '', allowedNumbers);
  const accepted = Boolean(customNarrative?.trim()) && validation.ok;
  const narrative = accepted ? customNarrative.trim() : chapters[0].findings.join(' ');
  return {
    reportId: editionId(snapshot, query, narrative),
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    projectName: snapshot.project.projectName,
    target: snapshot.project.targetBrand.canonical,
    dataOrigin: {
      real: all.length - synthetic,
      synthetic,
      label: synthetic
        ? all.length === synthetic
          ? '全部为模拟补齐样本'
          : '含模拟补齐样本'
        : all.length
          ? '仅真实采集样本'
          : '无有效样本',
    },
    commonUnits: m.comparableDelta.commonUnits,
    query,
    chapters,
    allowedNumbers,
    narrative,
    narrativeSource: accepted ? 'ai' : 'deterministic',
    validation,
    appendix: [
      '提及率按有效回答去重。未点名指标排除题干点名的回答。首推限有推荐意图的问题，唯一与并列按回答取并集。',
      '采集完成度采用原计划槽位作分母。无有效观察显示「—」。共同可比单元为两期均有观察的同题同平台，先求单元内命中率再等权计算百分比变化。',
      '三问分布仅计入每周三次均有效的单元。特点词按回答去重，表述归属仅描述回答正文。',
      '站点覆盖按回答去重，分母为可观察角标的回答数。文章按实引回答数排序，展示前十篇竞品关联文章，每篇摘录一条已绑定原句（如有）。竞品关联来自来源标题、摘要或已绑定原句。',
    ],
  };
}
