import { buildCitationIntelligence } from '../../vendor/metrics-core.mjs';
import { table, panel, esc, sourceLink, platformName } from '../charts.mjs';

const categories = {
  medical_media: '医疗健康垂类',
  social_video: '社媒与短视频',
  wiki_ranking: '商业榜单与百科',
  guideline: '临床指南共识',
  gov_portal: '政务药监',
  drug_label: '药品说明书',
  other: '其他',
};
export function citations(c) {
  const { state, button } = c,
    keys = Object.keys(categories);
  state.categories ??= [...keys];
  const samples = c.selectedSlots(state.currentPeriod),
    search = state.citationSearch.trim().toLowerCase();
  const all = samples.flatMap((s) => s.citations.map((ref) => ({ s, ref })));
  const slots = samples.map((s) => ({
    ...s,
    citations: s.citations.filter((r) => state.categories.includes(r.docCategory)),
  }));
  const ledger = buildCitationIntelligence({ ...c.snapshot, slots }, state);
  const filtered = slots.flatMap((s) => s.citations.map((ref) => ({ s, ref })));
  function toggle(key) {
    const active = state.categories.includes(key);
    state.categories = active ? state.categories.filter((k) => k !== key) : [...state.categories, key];
    state.citationPage = 0;
    c.render();
  }
  const choices = keys
    .map(
      (k) =>
        '<label class="check"><input type="checkbox" ' +
        (state.categories.includes(k) ? 'checked' : '') +
        ' data-action="' +
        c.register(() => toggle(k)) +
        '">' +
        categories[k] +
        '</label>',
    )
    .join('');
  const range =
    '<div class="toolbar">' +
    button('全部文类', () => {
      state.categories = [...keys];
      state.citationPage = 0;
      c.render();
    }) +
    choices +
    '<i class="divider" aria-hidden="true"></i>' +
    '<label class="check exclude"><input id="exclude-label" type="checkbox" ' +
    (!state.categories.includes('drug_label') ? 'checked' : '') +
    ' data-action="' +
    c.register(() => toggle('drug_label')) +
    '">排除药品说明书</label>' +
    '</div>';
  const countNote =
    '<strong id="citation-count">筛选后 ' +
    filtered.length +
    ' 条 / 全量 ' +
    all.length +
    ' 条</strong>';
  // single compact filter bar
  function records(title, test) {
    return button(title, () =>
      c.list(
        title,
        slots.filter((s) => s.citations.some((ref) => test(ref, s))),
      ),
    );
  }
  function domainOf(ref) {
    const host = ref.domain.toLowerCase().replace(/^www\.|\.$/g, '');
    return ['39.net', 'miaoshou.com', 'douyin.com'].find((d) => host === d || host.endsWith('.' + d)) ?? host;
  }
  const sites = ledger.sites.map((site) => [
    esc(site.siteName || '未披露') + '<small>' + esc(site.domain) + '</small>',
    records(
      site.coverage.hits + '/' + site.coverage.denominator,
      (r) => r.inlineVerified && domainOf(r) === site.domain,
    ),
    site.inlineArticleCount,
    site.candidateCount,
    site.docCategories.map((k) => esc(categories[k])).join('、'),
  ]);
  const articles = ledger.articles.map((a) => {
    const clause = a.boundClauses[0],
      n = a.observableResponseCount;
    const refs = slots.filter((s) => s.citations.some((r) => r.urlCanonical === a.urlCanonical && r.inlineVerified));
    const bindings = Map.groupBy(a.boundClauses, (cl) => cl.responseId);
    const full =
      '<details><summary>展开 ' +
      refs.length +
      ' 条回答</summary>' +
      refs
        .map(
          (s) =>
            '<div class="binding">' +
            button(
              c.periodLabel(s.periodId) +
                ' · ' +
                platformName(s.platform) +
                ' Q' +
                s.questionSeq +
                ' #' +
                s.repeatIndex,
              () => c.list('引用原文', [s]),
              'ref-row',
            ) +
            (bindings.get(s.responseId) ?? [])
              .map(
                (cl) =>
                  '<blockquote>' +
                  esc(cl.clauseText) +
                  '<small>' +
                  esc(cl.brandsInClause.join('、') || '句中未点名') +
                  '</small></blockquote>',
              )
              .join('') +
            '</div>',
        )
        .join('') +
      '</details>';
    return [
      sourceLink(a.urlCanonical, a.title || '标题未披露') +
        '<small>' +
        esc(a.siteName || a.domain) +
        ' · ' +
        esc(a.publishedAt || '未披露') +
        '</small>',
      records(a.inlineResponseCount + '/' + n, (r) => r.urlCanonical === a.urlCanonical && r.inlineVerified),
      esc(a.platforms.map(platformName).join('、')) + '<small>' + a.periods.length + ' 周</small>',
      (clause
        ? '<span class="quote">' +
          esc(clause.clauseText) +
          '</span><small>' +
          esc(clause.brandsInClause.join('、') || '句中未点名') +
          '</small>'
        : '角标未绑定原句') + full,
      esc(a.contentBrands.join('、') || '未命中'),
      records(
        a.targetSameScopeCount + '/' + n,
        (r) =>
          r.urlCanonical === a.urlCanonical &&
          r.inlineVerified &&
          [
            ...r.contentBrands,
            ...r.markers.filter((m) => m.clauseIdx != null).flatMap((m) => m.brandsInClause),
          ].includes(c.project.targetBrand.canonical),
      ),
    ];
  });
  const blank = ledger.blankSites.map((b) => [
    esc(b.siteName || b.domain) +
      '<small>' +
      esc(b.domain) +
      ' · ' +
      esc(
        (ledger.sites.find((s) => s.domain === b.domain)?.docCategories ?? []).map((k) => categories[k]).join('、'),
      ) +
      '</small>',
    'Q' + b.questionSeq + ' · ' + esc(platformName(b.platform)),
    records(
      b.competitorCoverage.hits + '/' + b.competitorCoverage.denominator,
      (r, s) =>
        s.questionSeq === b.questionSeq &&
        s.platform === b.platform &&
        r.inlineVerified &&
        domainOf(r) === b.domain &&
        [...r.contentBrands, ...r.markers.filter((m) => m.clauseIdx != null).flatMap((m) => m.brandsInClause)].some(
          (n) => c.project.competitors.some((e) => e.canonical === n),
        ),
    ),
    '0/' + b.targetCoverage.denominator,
    b.coveredWeeks,
  ]);
  const matches = filtered.filter(({ s, ref }) =>
    [
      ref.title,
      ref.siteName,
      ref.urlCanonical,
      ref.domain,
      ref.contentBrands.join(' '),
      categories[ref.docCategory],
      platformName(s.platform),
      'Q' + s.questionSeq,
    ]
      .join(' ')
      .toLowerCase()
      .includes(search),
  );
  const last = Math.max(0, Math.ceil(matches.length / 40) - 1),
    page = Math.min(state.citationPage ?? 0, last);
  const pageBtn = (label, n) =>
    button(label, () => {
      state.citationPage = Math.min(last, Math.max(0, n));
      c.render();
    });
  const download = () =>
    c.download('引用-' + state.currentPeriod + '.csv', [
      ['回答 ID', '周期', '平台', '题号', '站点', '标题', '原链接', '发布日期', '文类', '实引', '来源类型'],
      ...matches.map(({ s, ref: r }) => [
        s.responseId,
        s.periodId,
        s.platform,
        s.questionSeq,
        r.siteName,
        r.title,
        r.urlCanonical,
        r.publishedAt,
        categories[r.docCategory],
        r.inlineVerified,
        r.kinds.join('|'),
      ]),
    ]);
  state.citeOpen ??= new Set();
  function capped(key, rows, n) {
    const open = state.citeOpen.has(key);
    return {
      rows: open ? rows : rows.slice(0, n),
      more:
        rows.length > n
          ? '<div class="more">' +
            button(open ? '收起' : '展开全部 ' + rows.length + ' 条', () => {
              if (open) state.citeOpen.delete(key);
              else state.citeOpen.add(key);
              c.render();
            }, 'outline') +
            '</div>'
          : '',
      note: '<small>' + rows.length + ' 条</small>',
    };
  }
  const siteView = capped('sites', sites, 12),
    blankView = capped('blank', blank, 12);
  return (
    panel('引用文类与范围', range, countNote) +
    '<div class="row-half">' +
    panel(
      '实引站点排行',
      table(['站点 / 域名', '覆盖回答', '实引', '候选', '文类'], siteView.rows, 'site-table') + siteView.more,
      siteView.note,
    ) +
    panel(
      '同题同平台的实引空白站点',
      table(['站点', '题号与平台', '竞品实引', '本品', '周数'], blankView.rows, 'blank-table') + blankView.more,
      blankView.note,
    ) +
    '</div>' +
    panel(
      '高被引文章与角标原句',
      '<div class="scroll-tall">' +
        table(
          [
            '文章 / 站点 / 发布日期',
            '实引 n/N',
            '平台 / 周数',
            '角标原句 / 引用回答',
            '来源标题或摘要命中',
            '本品同口径 m/N',
          ],
          articles,
        ) +
        '</div>',
      '<small>' + articles.length + ' 篇</small>',
    ) +
    panel(
      '全量引用检索',
      '<div class="toolbar"><label>搜索引用<input id="citation-search" data-search="citationSearch" placeholder="文章、域名、站点或题号" value="' +
        esc(state.citationSearch) +
        '"></label>' +
        button('下载当前引用 CSV', download, 'outline') +
        '</div>' +
        table(
          ['题号 / 平台', '站点与文章', '文类', '记录类型'],
          matches
            .slice(page * 40, page * 40 + 40)
            .map(({ s, ref: r }) => [
              button('Q' + s.questionSeq + ' · ' + platformName(s.platform), () => c.list('引用原文', [s])),
              sourceLink(r.urlCanonical, r.title || r.domain),
              categories[r.docCategory],
              r.inlineVerified ? '角标实引' : r.kinds.includes('search_result') ? '搜索候选' : '链接',
            ]),
        ) +
        '<div class="pager">' +
        pageBtn('上一页', page - 1) +
        '<span>' +
        (page + 1) +
        ' / ' +
        (last + 1) +
        ' 页 · ' +
        matches.length +
        ' 条</span>' +
        pageBtn('下一页', page + 1) +
        '</div>',
    )
  );
}
