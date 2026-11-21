import { esc, pct, pp, trend, table, panel, platformName, groupedBars, frequency } from '../charts.mjs';

export function platforms(c) {
  const { state, project, metrics, entityPoint, rate } = c;
  const ids = state.platforms,
    samples = c.selectedSlots(state.currentPeriod);
  const summaries = ids.map((platform) => metrics({ platform }));
  const point = (i, key) => entityPoint(summaries[i], key, { where: (s) => s.platform === ids[i] });
  const series = ['brandMention', 'firstRecommendation'].map((key, k) => ({
    name: ['品牌提及率', '品牌首推率'][k],
    points: ids.map((_, i) => point(i, key)),
  }));
  const rows = ids.map((platform, i) => {
    const m = summaries[i],
      rival = c.topRival(m),
      where = (s) => s.platform === platform;
    const visible = samples.filter((s) => where(s) && s.inlineObservable);
    const n = visible.reduce((a, s) => a + s.citations.filter((r) => r.inlineVerified).length, 0);
    return [
      esc(platformName(platform)),
      m.validResponses + '/' + m.plannedSlots,
      ...(project.hasGenericName ? [rate(point(i, 'genericMention'))] : []),
      rate(point(i, 'brandMention')) + '<small>' + pp(m.comparableDelta.deltaPp) + '</small>',
      rate(point(i, 'firstRecommendation')) +
        '<small>' +
        pp(metrics({ platform, projection: 'firstRecommendation' }).comparableDelta.deltaPp) +
        '</small>',
      rival ? esc(rival.name) + ' ' + rate(entityPoint(rival, 'brandMention', { where })) : '—',
      frequency(m.repeatDistribution),
      visible.length ? (n / visible.length).toFixed(2) : '—',
    ];
  });
  const periods = c.m.periodSeries.map((p) => p.periodId);
  const lines = ids.map((platform, i) => ({
    name: platformName(platform),
    points: summaries[i].periodSeries.map((row) =>
      entityPoint(row, 'brandMention', { period: row.periodId, where: (s) => s.platform === platform }),
    ),
  }));
  const modes = ids.map((platform, i) => {
    const sample = samples.filter((s) => s.platform === platform),
      counts = new Map();
    for (const s of sample) counts.set(s.modelLabel || '未披露', (counts.get(s.modelLabel || '未披露') || 0) + 1);
    function mode(key) {
      const known = sample.filter((s) => s[key] != null),
        hits = known.filter((s) => s[key] === 1).length;
      return (
        rate(
          c.point(
            { hits, denominator: known.length, rate: known.length ? hits / known.length : null },
            '模式开启记录',
            (s) => s.platform === platform && s[key] === 1,
          ),
          true,
        ) +
        '<small>未知 ' +
        (sample.length - known.length) +
        '</small>'
      );
    }
    const m = summaries[i];
    return [
      esc(platformName(platform)),
      mode('searchOn'),
      mode('deepThinkOn'),
      [...counts].map(([k, n]) => esc(k) + ' × ' + n).join('、') || '—',
      '缺采 ' + m.missingSlots + ' 槽 · 跨期排除 ' + m.comparableDelta.excludedUnits + ' 单元',
    ];
  });
  return (
    panel(
      '平台同题集横向对比',
      table(
        [
          '平台',
          '有效 / 计划',
          ...(project.hasGenericName ? ['通用名提及率'] : []),
          '品牌提及率 / 环比',
          '首推率 / 环比',
          '首位竞品',
          '三问命中分布',
          '平均实引篇数',
        ],
        rows,
        'platform-table',
      ),
    ) +
    '<div class="chart-pair">' +
    panel('本期平台表现', groupedBars(ids.map(platformName), series, false, { span: 'half' })) +
    panel(
      '各平台提及率走势',
      trend(
        periods.map((id) => c.periodLabel(id)),
        lines,
        { span: 'half', height: 290 },
      ),
    ) +
    '</div>' +
    panel(
      '运行状态与模式核查',
      table(['平台', '联网开启 / 已知', '深度思考 / 已知', '模型版本分布', '采集与可比范围'], modes),
    )
  );
}
