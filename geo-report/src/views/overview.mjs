import { esc, pct, pp, fraction, trend, table, panel, scenes, platformName } from '../charts.mjs';

export function overview(c) {
  const { m, state, project, metrics, entityPoint, rate, periodLabel } = c;
  const same = c.topRival(m, true),
    rival = same ?? c.topRival(m);
  const first = m.firstRecommendation;
  function card(title, key, delta, detail = '', row = m) {
    const p = entityPoint(row, key);
    return (
      '<article class="kpi"><button class="card-hit" aria-label="' +
      esc(title) +
      ' 下钻" data-action="' +
      p.action +
      '"><span>' +
      esc(title) +
      '</span><strong data-value>' +
      pct(p.rate) +
      '</strong>' +
      '<span data-fraction>' +
      fraction(p) +
      '</span> 条有效回答<small><b data-delta>' +
      pp(delta.deltaPp) +
      '</b> · 共同单元 ' +
      delta.commonUnits +
      '</small></button>' +
      detail +
      '</article>'
    );
  }
  const cards = [
    card('品牌提及率', 'brandMention', m.comparableDelta),
    card(
      '未点名问题品牌提及率',
      'unpromptedBrandMention',
      metrics({ projection: 'unpromptedBrandMention' }).comparableDelta,
    ),
    card(
      '品牌首推率',
      'firstRecommendation',
      metrics({ projection: 'firstRecommendation' }).comparableDelta,
      '<div class="card-note">唯一 ' +
        c.button(fraction(first.soleFirst), () =>
          c.list(
            '唯一首推',
            c.selectedSlots(state.currentPeriod).filter(c.entityRule(project.targetBrand.canonical, 'soleFirst')),
          ),
        ) +
        ' · 并列 ' +
        c.button(fraction(first.coFirst), () =>
          c.list(
            '并列首推',
            c.selectedSlots(state.currentPeriod).filter(c.entityRule(project.targetBrand.canonical, 'coFirst')),
          ),
        ) +
        ' · 待核 ' +
        first.uncertainCount +
        '</div>',
    ),
  ];
  if (project.hasGenericName)
    cards.push(
      card(
        '通用名提及率',
        'genericMention',
        metrics({ projection: 'genericMention' }).comparableDelta,
        same ? '<div class="card-note">' + esc(same.name) + ' ' + rate(entityPoint(same)) + '</div>' : '',
      ),
    );
  else if (rival) cards.push(card(rival.name + '提及率', 'brandMention', rival.comparableDelta, '', rival));
  const periods = m.periodSeries.map((p) => p.periodId),
    labels = periods.map((id) => periodLabel(id));
  const other = m.competitors.other_generic.flatMap((f) => f.brands);
  const preferred = other.filter((row) => ['泛福舒', '日达仙'].includes(row.name));
  const representatives = preferred.length ? preferred : other.slice(0, 2);
  const names = [project.targetBrand.canonical, rival?.name, ...representatives.map((row) => row.name)].filter(Boolean);
  const series = [...new Set(names)].map((name) => ({
    name,
    points: periods.map((period) => {
      const row = c.entityRows(metrics({ period })).find((e) => e.name === name);
      return entityPoint(row, state.trendMetric, { period });
    }),
  }));
  const toggles =
    '<div class="seg">' +
    ['brandMention', 'firstRecommendation']
      .map(
        (key, i) =>
          '<button aria-pressed="' +
          (key === state.trendMetric) +
          '" data-action="' +
          c.register(() => {
            state.trendMetric = key;
            c.render();
          }) +
          '">' +
          ['提及率', '首推率'][i] +
          '</button>',
      )
      .join('') +
    '</div>';
  const detail = [['有效 / 计划', ...m.periodSeries.map((p) => p.validResponses + ' / ' + p.plannedSlots)]];
  for (const [label, key] of [
    ['通用名提及率', 'genericMention'],
    ['品牌提及率', 'brandMention'],
    ['品牌首推率', 'firstRecommendation'],
  ]) {
    if (key === 'genericMention' && !project.hasGenericName) continue;
    detail.push([label, ...m.periodSeries.map((p) => rate(entityPoint(p, key, { period: p.periodId }), true))]);
    detail.push([
      label + '环比',
      ...m.periodSeries.map((p, i) =>
        i
          ? pp(
              (key === 'brandMention' ? p : metrics({ period: p.periodId, compare: periods[i - 1], projection: key }))
                .comparableDelta.deltaPp,
            )
          : '—',
      ),
    ]);
  }
  function ranking(title, rows) {
    const valid = rows
      .filter((r) => r.delta.deltaPp != null)
      .sort((a, b) => Math.abs(b.delta.deltaPp) - Math.abs(a.delta.deltaPp))
      .slice(0, 3);
    return (
      '<div><h3>' +
      title +
      '</h3>' +
      (valid.length
        ? valid
            .map(
              (r) =>
                '<div class="ranking"><span>' +
                esc(r.name) +
                '</span><small>' +
                r.delta.commonUnits +
                ' 个共同单元</small><b>' +
                pp(r.delta.deltaPp) +
                '</b></div>',
            )
            .join('')
        : '<p class="empty">无共同可比单元</p>') +
      '</div>'
    );
  }
  return (
    '<div class="kpis">' +
    cards.join('') +
    '</div>' +
    '<div class="row-major">' +
    panel('品牌多期趋势', trend(labels, series, { span: 'major', height: 300 }), toggles) +
    panel(
      '本期提及率变化集中度',
      '<div class="split stack">' +
        ranking(
          '平台 · 前三',
          state.platforms.map((platform) => ({
            name: platformName(platform),
            delta: metrics({ platform }).comparableDelta,
          })),
        ) +
        ranking(
          '提问场景 · 前三',
          m.sceneMatrix.map((s) => ({ name: scenes[s.scene], delta: s.comparableDelta })),
        ) +
        '</div>',
    ) +
    '</div>' +
    panel('多期指标明细', table(['指标', ...labels.map(esc)], detail, 'num-table'))
  );
}
