import { esc, pp, table, panel, scenes, platformName, groupedBars } from '../charts.mjs';

export function competitors(c) {
  const { m, state, project, button, entityPoint, rate } = c,
    generic = project.hasGenericName;
  const goScene = (scene) => {
    state.questionScene = scene;
    state.questionSearch = '';
    state.questionHit = '';
    c.go('questions');
  };
  const matrix = m.sceneMatrix.map((s) => {
    const where = (slot) => c.questionsBySeq.get(slot.questionSeq).scene === s.scene;
    const rival = c.topRival(c.metrics({ scene: s.scene }));
    return [
      button(scenes[s.scene], () => goScene(s.scene)),
      s.questions.length,
      s.validResponses,
      rate(entityPoint(s, 'brandMention', { where }), true),
      rival ? esc(rival.name) + ' ' + rate(entityPoint(rival, 'brandMention', { where })) : '—',
      pp(s.comparableDelta.deltaPp),
    ];
  });
  const groups = m.competitors,
    entities = c.entityRows(m);
  const titles = ['实体', '正文提及 H/V', '未点名提及率', '唯一首推率', '并列首推率', '可比环比', '分平台命中'];
  const parts = [];
  function section(label, rows) {
    parts.push('<h3 class="group-name">' + esc(label) + '</h3>');
    const output = [];
    for (const { row, family, child } of rows) {
      if (!state.allEntities && row.brandMention.hits === 0) continue;
      const opts = { family };
      const micro = row.platforms
        .filter((p) => state.platforms.includes(p.platform))
        .map((p) => {
          const item = c.point(
            p,
            row.name + ' · ' + platformName(p.platform),
            (s) => s.platform === p.platform && c.entityRule(row.name, 'brandMention', family)(s),
          );
          return (
            '<button class="micro" data-tip="' +
            esc(platformName(p.platform) + ' ' + p.hits + '/' + p.denominator) +
            '" aria-label="' +
            esc(platformName(p.platform) + ' ' + p.hits + '/' + p.denominator) +
            '" data-action="' +
            item.action +
            '" style="--level:' +
            Math.round(100 * (p.rate || 0)) +
            '%"></button>'
          );
        })
        .join('');
      output.push([
        (child ? '↳ ' : '') + esc(row.name),
        ...['brandMention', 'unpromptedBrandMention', 'soleFirst', 'coFirst'].map((key) =>
          rate(entityPoint(row, key, opts), key === 'brandMention'),
        ),
        pp(row.comparableDelta.deltaPp),
        '<div class="micro-set">' + micro + '</div>',
      ]);
    }
    parts.push(output.length ? table(titles, output, 'entity-table') : '<p class="muted">当前筛选下无可展示实体</p>');
  }
  section(
    '本品牌',
    groups.target.map((row) => ({ row })),
  );
  if (generic)
    section(
      '同通用名竞品（' + (project.genericEntity?.canonical ?? '') + '）',
      groups.same_generic.map((row) => ({ row })),
    );
  else if (groups.same_generic.length)
    section(
      '竞品',
      groups.same_generic.map((row) => ({ row })),
    );
  section(
    generic ? '其他通用名及下属品牌' : '其他竞品',
    groups.other_generic.flatMap((f) => [
      ...(generic ? [{ row: f, family: f.brands.map((b) => b.name) }] : []),
      ...f.brands.map((row) => ({ row, child: generic })),
    ]),
  );
  section(
    generic ? '无通用名品牌' : '独立品牌',
    groups.no_generic.map((row) => ({ row })),
  );
  state.overlap ??= entities.slice(0, 2).map((e) => e.name);
  const selected = entities.filter((e) => state.overlap.includes(e.name));
  const toggles = entities
    .map(
      (e) =>
        '<label class="check"><input type="checkbox" ' +
        (state.overlap.includes(e.name) ? 'checked' : '') +
        ' data-action="' +
        c.register(() => {
          state.overlap = state.overlap.includes(e.name)
            ? state.overlap.filter((n) => n !== e.name)
            : [...state.overlap, e.name];
          c.render();
        }) +
        '">' +
        esc(e.name) +
        '</label>',
    )
    .join('');
  const overlap = selected.length
    ? c.selectedSlots(state.currentPeriod).filter((s) => selected.every((e) => c.entityRule(e.name)(s)))
    : [];
  const chart = groupedBars(
    selected.map((e) => e.name),
    [{ name: '正文提及率', points: selected.map((e) => entityPoint(e)) }],
    false,
    { span: 'minor' },
  );
  return (
    '<div class="row-split">' +
    panel(
      '提问场景矩阵',
      table(['场景', '题目数', '有效回答', '本品牌提及率', '首位竞品', '可比环比'], matrix, 'scene-table'),
    ) +
    panel(
      '竞品提及重叠对比',
      '<div class="pills">' +
        toggles +
        '</div>' +
        chart +
        '<div class="panel-foot">' +
        button('同时提及所选实体 · ' + overlap.length + ' 条回答', () => c.list('实体交集', overlap), 'outline') +
        '</div>',
    ) +
    '</div>' +
    panel(
      '监测实体分层',
      parts.join(''),
      button(
        state.allEntities ? '折叠零命中实体' : '展开全部 ' + entities.length + ' 个监测实体（含 0 命中）',
        () => {
          state.allEntities = !state.allEntities;
          c.render();
        },
        'outline',
      ),
    )
  );
}
