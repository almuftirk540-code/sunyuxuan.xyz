import { esc, panel, table } from '../charts.mjs';

export function methodology(c) {
  const { snapshot, state } = c;
  const rules = [
    [
      '计划槽位与完成度',
      '每个采集周 × 题号 × 平台 × 问询次序对应一个槽位 E。有回答标识的槽位计为 V。仅真实采集筛选保留原计划分母。',
    ],
    ['品牌与通用名提及率', 'H/V 按回答去重计数，同一篇反复提及计一次。通用名按项目词典独立统计。分母为零时显示「—」。'],
    ['未点名问题提及率', '先排除题干点名相应品牌的问题，再以剩余有效回答作分母。不同实体的未点名分母可能不同。'],
    ['品牌首推率', '仅使用有推荐意图的问题。唯一首推、并列首推分别计数，合并指标按回答取并集。待核单列，不计入首推。'],
    [
      '跨期可比单元 |C|',
      '单元为同一题号 × 同一平台。两期均有有效观察才纳入。先在单元内计算命中率，再对共同单元等权平均，两期均值之差以百分点（pp）表示。',
    ],
    ['单题三问分布', '每周同一题、同一平台的第 1、2、3 问全部有效才进入 0～3 次命中分箱。按月查看时保留每周三问边界。'],
    [
      '分句肯定归属',
      '按回答正文分句匹配词面，结合分句主语、肯定或否定状态归属品牌。词面出现、肯定归属和待核分开统计，回答内去重。',
    ],
    [
      '引用去重与实引',
      '同一回答中相同规范 URL 合并为一篇。站点覆盖按回答去重，候选搜索与角标实引分别统计。N 为角标可观测回答数。',
    ],
    [
      '本品牌同口径与空白站点',
      '来源标题或摘要、已绑定角标的原句出现品牌，才计入该品牌关联。空白站点在同题同平台核对竞品实引与本品零实引。',
    ],
    ['模式与平均实引', '联网及深度思考开启率的分母为状态已知的回答。平均实引篇数采用可观测回答作为分母。'],
  ];
  const periods = state.granularity === 'month' ? c.months : c.weeks.map((w) => w.periodId);
  const rows = periods
    .filter((p) => state.selectedPeriods.includes(p))
    .map((id) => {
      const slots = c.selectedSlots(id, false),
        observed = c.selectedSlots(id);
      const real = slots.filter((s) => s.responseId && !s.isSynthetic).length,
        demo = slots.filter((s) => s.responseId && s.isSynthetic).length;
      return [esc(c.periodLabel(id, true)), slots.length, real, demo, slots.length - real - demo, observed.length];
    });
  return (
    panel(
      '快照信息',
      '<dl class="snapshot-info">' +
        ['snapshotId', 'generatedAt', 'sourceSha256', 'schemaVersion']
          .map(
            (k) =>
              '<div><dt>' + k + '</dt><dd title="' + esc(snapshot[k]) + '">' + esc(snapshot[k]) + '</dd></div>',
          )
          .join('') +
        '</dl>',
    ) +
    panel(
      '批次真实与模拟构成',
      table(['批次', '计划槽位', '原始真实', '原始模拟', '原始缺采', '筛选后有效'], rows, 'num-table'),
    ) +
    panel(
      '指标计算口径',
      '<dl class="rules">' +
        rules.map(([name, desc]) => '<div><dt>' + name + '</dt><dd>' + desc + '</dd></div>').join('') +
        '</dl>',
    )
  );
}
