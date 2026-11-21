import { esc, pp, option, table, panel, scenes, platformName, sourceLink, highlight } from '../charts.mjs';

const mode = (value) => (value === 1 ? '开启' : value === 0 ? '关闭' : '未披露');
export function evidence(c, slot) {
  if (!slot) return;
  const { state, project } = c;
  // A historical chart can open a week outside the current period.
  const pool = c.snapshot.slots.filter(
    (s) =>
      s.questionSeq === slot.questionSeq &&
      state.platforms.includes(s.platform) &&
      (state.granularity === 'month'
        ? c.byWeek.get(s.periodId).monthKey === c.byWeek.get(slot.periodId).monthKey
        : s.periodId === slot.periodId),
  );
  function switcher(values, key, label, format) {
    return (
      '<label>' +
      label +
      '<select aria-label="' +
      esc(label) +
      '" data-select-action="' +
      c.register((e) => {
        const val = e.target.value,
          choices = pool.filter((s) => String(s[key]) === val);
        const next =
          choices.find(
            (s) =>
              (key === 'platform' || s.platform === slot.platform) &&
              (key === 'periodId' || s.periodId === slot.periodId) &&
              (key === 'repeatIndex' || s.repeatIndex === slot.repeatIndex),
          ) ??
          choices.find((s) => s.platform === slot.platform) ??
          choices[0];
        evidence(c, next);
      }) +
      '">' +
      values.map((v) => option(v, format(v), v === slot[key])).join('') +
      '</select></label>'
    );
  }
  const local = pool.filter((s) => s.periodId === slot.periodId && s.platform === slot.platform);
  const controls =
    '<div class="toolbar">' +
    switcher([...new Set(pool.map((s) => s.periodId))], 'periodId', '采集周', c.periodLabel) +
    switcher(
      [...new Set(pool.filter((s) => s.periodId === slot.periodId).map((s) => s.platform))],
      'platform',
      '平台',
      platformName,
    ) +
    switcher(
      local.map((s) => s.repeatIndex).sort((a, b) => a - b),
      'repeatIndex',
      '问询',
      (i) => '第 ' + i + ' 次问询',
    ) +
    '</div>';
  let body = '<h3>' + esc(c.questionsBySeq.get(slot.questionSeq).text) + '</h3>' + controls;
  if (!slot.responseId || (state.dataOriginFilter === 'real' && slot.isSynthetic)) {
    body +=
      '<p class="notice">' + (slot.responseId ? '当前仅查看真实采集，该槽位为模拟样本' : '该计划槽位缺采') + '</p>';
  } else {
    const words = [project.targetBrand, ...project.competitors].flatMap((b) => [
      b.canonical,
      ...b.aliases,
      ...(b.genericAliases || []),
    ]);
    words.push(...(project.genericEntity?.aliases || []), ...state.terms.flatMap((t) => t.patterns));
    body +=
      '<div class="metadata"><span>' +
      (slot.isSynthetic ? '模拟演示' : '真实采集') +
      '</span><span>采集 ' +
      esc(slot.answeredAt) +
      '</span><span>模型 ' +
      esc(slot.modelLabel || '未披露') +
      '</span><span>联网 ' +
      mode(slot.searchOn) +
      '</span><span>深度思考 ' +
      mode(slot.deepThinkOn) +
      '</span></div>' +
      '<h3>原始回答全文</h3><div class="answer">' +
      highlight(slot.answerText, words) +
      '</div><h3>本次去重引用 · ' +
      slot.citations.length +
      '</h3>' +
      (slot.citations
        .map(
          (r) =>
            '<div class="source">' +
            esc([...new Set(r.markers.map((m) => '[' + m.idx + ']'))].join(' ')) +
            ' ' +
            sourceLink(r.urlCanonical, r.title || r.domain) +
            '<small>' +
            esc(r.siteName || r.domain) +
            ' · ' +
            (r.inlineVerified ? '实引' : '候选 / 链接') +
            '</small></div>',
        )
        .join('') || '<p>未记录引用</p>') +
      '<details><summary>平台公开展示的推理文本 (reasoning_text)</summary><div class="answer">' +
      esc(slot.reasoningText || '未披露') +
      '</div></details>' +
      '<h3>原页面长截图</h3>' +
      (slot.isSynthetic
        ? '<p class="muted">模拟演示样本·无真机截图</p>'
        : /^screenshots\/[a-zA-Z0-9_-]+\.(?:png|webp)$/.test(slot.screenshot)
          ? '<a href="./data/' +
            esc(slot.screenshot) +
            '" target="_blank" rel="noopener"><img class="capture" alt="原页面长截图 answer.png" src="./data/' +
            esc(slot.screenshot) +
            '"></a>'
          : '<p class="muted">该真实记录未附截图</p>');
  }
  c.dialogBody('Q' + slot.questionSeq + ' · 回答存证', body);
}
export function questions(c) {
  const { state, m, project, button } = c;
  const plans = c.selectedSlots(state.currentPeriod, false),
    valid = new Set(c.selectedSlots(state.currentPeriod).map((s) => s.responseId));
  const matches = c.entityRule(project.targetBrand.canonical),
    stats = new Map(m.sceneMatrix.flatMap((s) => s.questions).map((q) => [q.questionSeq, q]));
  const rows = project.questions
    .filter((q) => {
      const hit = stats.get(q.seq).brandMention;
      return (
        (!state.questionScene || q.scene === state.questionScene) &&
        ('Q' + q.seq + ' ' + q.text).toLowerCase().includes(state.questionSearch.toLowerCase().trim()) &&
        (!state.questionHit || (state.questionHit === 'yes' ? hit.hits > 0 : hit.hits === 0 && hit.denominator > 0))
      );
    })
    .map((q) => {
      const slots = plans.filter((s) => s.questionSeq === q.seq),
        info = stats.get(q.seq);
      function open(s) {
        if (s) evidence(c, s);
        else c.list('该题无计划槽位', []);
      }
      const cells = state.platforms.map((p) => {
        const local = slots.filter((s) => s.platform === p);
        return (
          [...new Set(local.map((s) => s.periodId))]
            .map((week) => {
              const repeats = local.filter((s) => s.periodId === week).sort((a, b) => a.repeatIndex - b.repeatIndex);
              const seen = repeats.filter((s) => valid.has(s.responseId)),
                hits = seen.filter(matches).length;
              return (
                '<button class="repeat-cell" data-action="' +
                c.register(() => open(seen[0] || repeats[0])) +
                '">' +
                (state.granularity === 'month' ? '<small>' + esc(c.periodLabel(week)) + '</small>' : '') +
                repeats
                  .map(
                    (s) =>
                      '<i class="' +
                      (!valid.has(s.responseId) ? 'missing' : matches(s) ? 'hit' : 'miss') +
                      '" title="第 ' +
                      s.repeatIndex +
                      ' 问 · ' +
                      (!valid.has(s.responseId) ? '缺采或来源已过滤' : matches(s) ? '命中' : '未命中') +
                      '"></i>',
                  )
                  .join('') +
                ' ' +
                hits +
                '/' +
                seen.length +
                '</button>'
              );
            })
            .join('') || '—'
        );
      });
      return [
        button('Q' + q.seq, () => open(slots.find((s) => valid.has(s.responseId)) || slots[0])),
        esc(scenes[q.scene]),
        button(q.text, () => open(slots.find((s) => valid.has(s.responseId)) || slots[0]), 'answer-link'),
        info.brandMention.hits +
          '/' +
          info.validResponses +
          '<small>采集 ' +
          info.validResponses +
          '/' +
          info.plannedSlots +
          '</small>',
        pp(info.comparableDelta.deltaPp),
        ...cells,
      ];
    });
  const filters =
    '<div class="toolbar"><label>场景<select data-key="questionScene">' +
    option('', '全部场景', !state.questionScene) +
    Object.entries(scenes)
      .map(([k, v]) => option(k, v, state.questionScene === k))
      .join('') +
    '</select></label>' +
    '<label>关键词<input id="question-search" data-search="questionSearch" placeholder="题号或问题原文" value="' +
    esc(state.questionSearch) +
    '"></label>' +
    '<label>品牌提及<select data-key="questionHit">' +
    [
      ['', '全部回答'],
      ['yes', '有提及'],
      ['no', '有效回答均未提及'],
    ]
      .map(([k, v]) => option(k, v, state.questionHit === k))
      .join('') +
    '</select></label></div>';
  return panel(
    '逐题三问矩阵',
    filters +
      '<p class="dots-key"><i class="hit"></i> 命中　<i class="miss"></i> 未命中　<i class="missing"></i> 缺采或来源已过滤</p>' +
      table(
        ['题号', '场景', '问题原文', '命中 / 有效', '可比环比', ...state.platforms.map((p) => esc(platformName(p)))],
        rows,
        'question-table',
      ),
    '<small>' + rows.length + ' 题</small>',
  );
}
