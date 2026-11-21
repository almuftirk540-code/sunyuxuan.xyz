// This module runs unchanged in the browser and in Node. A slot always belongs
// to its capture week, even when several weeks are viewed as one month.
function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

const rate = (hits, denominator) => ({ hits, denominator, rate: denominator ? hits / denominator : null });
const unique = values => [...new Set(values)];
const unitKey = s => s.questionSeq + '/' + s.platform;
const count = (rows, predicate) => rows.reduce((n, row) => n + Number(Boolean(predicate(row))), 0);
const valid = s => Boolean(s.responseId);
const named = (s, name) => s.brands.some(b => b.canonical === name);

function selection(snapshot, state) {
  const byWeek = new Map(snapshot.periods.map(p => [p.periodId, state.granularity === 'month' ? p.monthKey : p.periodId]));
  const periods = unique(byWeek.values()).sort();
  const selected = state.platforms && new Set(state.platforms);
  const groups = new Map(periods.map(id => [id, []]));
  for (const s of snapshot.slots) {
    if (!selected || selected.has(s.platform)) groups.get(byWeek.get(s.periodId)).push(s);
  }
  const current = state.currentPeriod ?? periods.at(-1);
  const compare = state.comparePeriod ?? periods[periods.indexOf(current) - 1];
  // Real-only changes the observable numerator and sample, never the plan.
  const observed = s => valid(s) && (state.dataOriginFilter !== 'real' || !s.isSynthetic);
  return { periods, groups, current, compare, observed };
}

function entityRule(names, generic) {
  return {
    hit: s => (generic && s.otherGenerics.includes(generic)) || names.some(name => named(s, name)),
    prompted: q => names.some(name => q.promptBrands.includes(name)),
    role: (s, role) => s.brands.some(b => names.includes(b.canonical) && b.role === role)
  };
}

function summarize(plan, observed, questions, rule) {
  const rows = plan.filter(observed);
  const unprompted = rows.filter(s => !rule.prompted(questions.get(s.questionSeq)));
  const rec = rows.filter(s => questions.get(s.questionSeq).hasRecommendationIntent);
  const soleFirst = rate(count(rec, s => rule.role(s, 'sole_first')), rec.length);
  const coFirst = rate(count(rec, s => rule.role(s, 'co_first')), rec.length);
  const combinedFirst = rate(count(rec, s => rule.role(s, 'sole_first') || rule.role(s, 'co_first')), rec.length);
  return {
    plannedSlots: plan.length, validResponses: rows.length, missingSlots: plan.length - rows.length,
    completionRate: rows.length ? rows.length / plan.length : null,
    brandMention: rate(count(rows, rule.hit), rows.length),
    unpromptedBrandMention: rate(count(unprompted, rule.hit), unprompted.length),
    firstRecommendation: { ...combinedFirst, soleFirst, coFirst, combinedFirst,
      uncertainCount: count(rec, s => rule.role(s, 'uncertain_first')) }
  };
}

function comparable(current, baseline, observed, hit) {
  function collect(plan) {
    const units = new Map();
    for (const s of plan) {
      const key = unitKey(s);
      if (!units.has(key)) units.set(key, { v: 0, h: 0 });
      const u = units.get(key);
      if (observed(s)) { u.v++; if (hit(s)) u.h++; }
    }
    return units;
  }
  const a = collect(baseline), b = collect(current);
  const keys = unique([...a.keys(), ...b.keys()]);
  let commonUnits = 0, sumA = 0, sumB = 0;
  const exclusionReasons = { noBaselineObservation: 0, noCurrentObservation: 0, noObservationEither: 0 };
  for (const key of keys) {
    const prev = a.get(key), now = b.get(key);
    if (prev?.v && now?.v) {
      commonUnits++;
      sumA += prev.h / prev.v;
      sumB += now.h / now.v;
    } else if (!prev?.v && !now?.v) exclusionReasons.noObservationEither++;
    else if (!prev?.v) exclusionReasons.noBaselineObservation++;
    else exclusionReasons.noCurrentObservation++;
  }
  const meanA = commonUnits ? sumA / commonUnits : null;
  const meanB = commonUnits ? sumB / commonUnits : null;
  return { meanA, meanB, deltaPp: commonUnits ? (meanB - meanA) * 100 : null,
    commonUnits, totalPlannedUnits: keys.length, excludedUnits: keys.length - commonUnits, exclusionReasons };
}

function repeats(plan, observed, hit) {
  const units = new Map();
  for (const s of plan) {
    const key = s.periodId + '/' + unitKey(s);
    if (!units.has(key)) units.set(key, { indices: new Set(), hits: 0 });
    const unit = units.get(key);
    if (observed(s)) { unit.indices.add(s.repeatIndex); if (hit(s)) unit.hits++; }
  }
  const bins = [0, 0, 0, 0];
  let completeUnits = 0;
  for (const { indices, hits } of units.values()) {
    if (indices.size === 3 && [1, 2, 3].every(i => indices.has(i))) { bins[hits]++; completeUnits++; }
  }
  return { completeUnits, incompleteUnits: units.size - completeUnits, bins: bins.map(n => rate(n, completeUnits)) };
}

export function computeMetrics(snapshot, queryState = {}) {
  const { periods, groups, current, compare, observed } = selection(snapshot, queryState);
  const plan = groups.get(current) ?? [], baseline = groups.get(compare) ?? [];
  const p = snapshot.project;
  const questions = new Map(p.questions.map(q => [q.seq, q]));
  const target = entityRule([p.targetBrand.canonical]);
  function overview(rows, previous) {
    return { ...summarize(rows, observed, questions, target),
      genericMention: p.hasGenericName ? rate(count(rows, s => observed(s) && s.genericMentioned), count(rows, observed)) : null,
      comparableDelta: comparable(rows, previous, observed, target.hit) };
  }
  const sceneMatrix = ['symptom', 'category_form', 'brand_compare', 'safety_combo'].map(scene => {
    const inScene = s => questions.get(s.questionSeq).scene === scene;
    return { scene, ...overview(plan.filter(inScene), baseline.filter(inScene)),
      questions: p.questions.filter(q => q.scene === scene).map(q => ({ questionSeq: q.seq, text: q.text,
        ...overview(plan.filter(s => s.questionSeq === q.seq), baseline.filter(s => s.questionSeq === q.seq)) })) };
  });
  const platforms = unique(snapshot.periods.flatMap(period => period.platforms));
  function entity(name, rule) {
    const stats = summarize(plan, observed, questions, rule);
    return { name, ...stats, isZero: stats.brandMention.rate === 0,
      comparableDelta: comparable(plan, baseline, observed, rule.hit),
      platforms: platforms.map(platform => {
        const sample = plan.filter(s => s.platform === platform && observed(s));
        return { platform, ...rate(count(sample, rule.hit), sample.length) };
      }) };
  }
  const competitors = { target: [entity(p.targetBrand.canonical, target)], same_generic: [], other_generic: [], no_generic: [] };
  const families = new Map();
  for (const c of p.competitors) {
    const row = entity(c.canonical, entityRule([c.canonical]));
    if (c.tier !== 'other_generic') competitors[c.tier].push(row);
    else {
      if (!families.has(c.generic)) families.set(c.generic, []);
      families.get(c.generic).push(row);
    }
  }
  for (const [generic, brands] of families) {
    competitors.other_generic.push({ ...entity(generic, entityRule(brands.map(b => b.name), generic)), brands });
  }
  const selected = periods.filter(id => !queryState.selectedPeriods || queryState.selectedPeriods.includes(id));
  return immutable({ currentPeriod: current, comparePeriod: compare ?? null, ...overview(plan, baseline),
    repeatDistribution: repeats(plan, observed, target.hit), sceneMatrix, competitors,
    periodSeries: selected.map((periodId, index) => ({ periodId,
      ...overview(groups.get(periodId), groups.get(selected[index - 1]) ?? []) })) });
}

const negativePrefix = /(?:不(?!良反应)(?:能|宜|可|具有|具备|属于|代表|意味|等于|一定|是|够|算|建议|推荐)?|并非|并无|没有|缺乏|尚无|未(?:能|见|必|经)?|无证据)[^，,。；;！？!?]{0,15}$/u;

export function evaluateFeatureTerms(snapshot, queryState = {}) {
  const { periods, groups, current, observed } = selection(snapshot, queryState);
  const p = snapshot.project, target = p.targetBrand.canonical;
  const terms = queryState.featureTerms ?? p.defaultFeatureTerms;
  const samples = periods.map(periodId => {
    const rows = groups.get(periodId).filter(observed);
    return { periodId, rows, targetCount: count(rows, s => named(s, target)) };
  });
  return immutable(terms.map(term => {
    const patterns = unique(term.patterns.flatMap(word => word.split('|')).map(word => word.trim()).filter(Boolean));
    const matchedClauses = [];
    function tally({ periodId, rows, targetCount }) {
      let any = 0, affirmative = 0, uncertain = 0;
      const byBrand = new Map();
      for (const s of rows) {
        let matched = false, pending = false;
        const subjects = new Set();
        for (const clause of s.clauses) {
          for (const pattern of patterns) {
            let index = clause.text.indexOf(pattern);
            if (index < 0) continue;
            matched = true;
            let positive = false;
            while (index >= 0) {
              if (!negativePrefix.test(clause.text.slice(0, index))) { positive = true; break; }
              index = clause.text.indexOf(pattern, index + pattern.length);
            }
            const polarity = positive ? clause.polarity : 'negative';
            if (clause.polarity === 'uncertain' || (!clause.subjects.length && named(s, target))) pending = true;
            if (polarity === 'affirmative') for (const name of clause.subjects) subjects.add(name);
            if (periodId === current) matchedClauses.push({ responseId: s.responseId, periodId: s.periodId,
              platform: s.platform, questionSeq: s.questionSeq, clauseText: clause.text, matchedPattern: pattern,
              subjects: [...clause.subjects], polarity });
          }
        }
        if (matched) any++;
        if (pending) uncertain++;
        if (subjects.has(target)) affirmative++;
        for (const name of subjects) byBrand.set(name, (byBrand.get(name) ?? 0) + 1);
      }
      return { periodId, anyMention: rate(any, rows.length), targetAffirmative: rate(affirmative, rows.length),
        givenTargetMentioned: rate(affirmative, targetCount), uncertainCount: uncertain,
        competitorAffirmative: Object.fromEntries(p.competitors.map(c => [c.canonical, rate(byBrand.get(c.canonical) ?? 0, rows.length)])) };
    }
    const periodTrend = samples.map(tally);
    const active = periodTrend.find(x => x.periodId === current) ?? tally({ periodId: current ?? null, rows: [], targetCount: 0 });
    return { id: term.id, label: term.label, ...active, periodTrend, matchedClauses };
  }));
}

function siteDomain(value) {
  const host = value.toLowerCase().replace(/^www\.|\.$/g, '');
  for (const domain of ['39.net', 'miaoshou.com', 'douyin.com']) {
    if (host === domain || host.endsWith('.' + domain)) return domain;
  }
  return host;
}

export function buildCitationIntelligence(snapshot, queryState = {}) {
  const { groups, current, observed } = selection(snapshot, queryState);
  const rows = (groups.get(current) ?? []).filter(observed);
  const target = snapshot.project.targetBrand.canonical;
  const competitors = new Set(snapshot.project.competitors.map(c => c.canonical));
  const observableResponseCount = count(rows, s => s.inlineObservable);
  const sites = new Map(), articles = new Map(), scopes = new Map();
  const denominators = new Map();
  for (const s of rows) {
    const unit = unitKey(s);
    if (s.inlineObservable) denominators.set(unit, (denominators.get(unit) ?? 0) + 1);
    // WP-12 emits exactly one citation per response and canonical URL.
    for (const c of s.citations) {
      const domain = siteDomain(c.domain);
      if (!sites.has(domain)) sites.set(domain, { domain, siteName: null, categories: new Set(),
        answers: new Set(), inlineArticleCount: 0, candidateCount: 0 });
      const site = sites.get(domain);
      site.siteName ??= c.siteName;
      site.categories.add(c.docCategory);
      if (c.kinds.includes('search_result')) site.candidateCount++;
      if (!c.inlineVerified) continue;
      site.inlineArticleCount++;
      site.answers.add(s.responseId);
      if (!articles.has(c.urlCanonical)) articles.set(c.urlCanonical, {
        urlCanonical: c.urlCanonical, domain, siteName: null, title: null, publishedAt: null, docCategory: c.docCategory,
        inlineResponseCount: 0, observableResponseCount, platforms: new Set(), periods: new Set(),
        boundClauses: [], contentBrands: new Set(), targetSameScopeCount: 0 });
      const article = articles.get(c.urlCanonical);
      article.siteName ??= c.siteName;
      article.title ??= c.title;
      article.publishedAt ??= c.publishedAt;
      article.inlineResponseCount++;
      article.platforms.add(s.platform);
      article.periods.add(s.periodId);
      const associated = new Set(c.contentBrands);
      for (const brand of c.contentBrands) article.contentBrands.add(brand);
      const seenClauses = new Set();
      for (const marker of c.markers) {
        if (marker.clauseIdx === null || seenClauses.has(marker.clauseIdx)) continue;
        seenClauses.add(marker.clauseIdx);
        const clause = s.clauses[marker.clauseIdx];
        for (const name of marker.brandsInClause) associated.add(name);
        article.boundClauses.push({ responseId: s.responseId, periodId: s.periodId, platform: s.platform,
          questionSeq: s.questionSeq, clauseText: clause.text, brandsInClause: [...marker.brandsInClause], polarity: clause.polarity });
      }
      if (associated.has(target)) article.targetSameScopeCount++;
      const key = domain + '/' + unit;
      if (!scopes.has(key)) scopes.set(key, { domain, unit, questionSeq: s.questionSeq, platform: s.platform,
        competitors: new Set(), target: new Set(), weeks: new Set() });
      const scope = scopes.get(key);
      if (associated.has(target)) scope.target.add(s.responseId);
      if ([...associated].some(name => competitors.has(name))) {
        scope.competitors.add(s.responseId);
        scope.weeks.add(s.periodId);
      }
    }
  }
  return immutable({ observableResponseCount,
    sites: [...sites.values()].map(({ answers, categories, ...site }) => ({ ...site,
      docCategories: [...categories].sort(), coverage: rate(answers.size, observableResponseCount) }))
      .sort((a,b) => b.coverage.hits - a.coverage.hits || b.inlineArticleCount - a.inlineArticleCount || a.domain.localeCompare(b.domain)),
    articles: [...articles.values()].map(a => ({ ...a, platforms: [...a.platforms].sort(), periods: [...a.periods].sort(),
      contentBrands: [...a.contentBrands].sort() })).sort((a,b) => b.inlineResponseCount - a.inlineResponseCount || a.urlCanonical.localeCompare(b.urlCanonical)),
    blankSites: [...scopes.values()].filter(s => s.competitors.size && !s.target.size).map(s => ({
      domain: s.domain, siteName: sites.get(s.domain).siteName, questionSeq: s.questionSeq, platform: s.platform,
      competitorCoverage: rate(s.competitors.size, denominators.get(s.unit)), targetCoverage: rate(0, denominators.get(s.unit)),
      coveredWeeks: s.weeks.size })).sort((a,b) => b.competitorCoverage.hits - a.competitorCoverage.hits) });
}
