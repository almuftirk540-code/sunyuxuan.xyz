import { evaluateFeatureTerms } from '../../vendor/metrics-core.mjs';
import { esc, table, panel, trend, groupedBars, highlight, platformName } from '../charts.mjs';

const polarities = { affirmative: '肯定归属', negative: '否定排除', uncertain: '待核' };
let lastQuery,
  cache = new Map();
function termId() {
  const h = Array.from(crypto.getRandomValues(new Uint8Array(10)), (v) => v.toString(16).padStart(2, '0')).join('');
  const time = Date.now().toString(16).padStart(12, '0');
  return (
    time.slice(0, 8) +
    '-' +
    time.slice(8) +
    '-7' +
    h.slice(0, 3) +
    '-' +
    (8 + (parseInt(h[3], 16) % 4)).toString(16) +
    h.slice(4, 7) +
    '-' +
    h.slice(7, 19)
  );
}
export function features(c) {
  const { state, project, button, register } = c,
    target = project.targetBrand.canonical,
    rival = c.topRival(c.m, true)?.name ?? c.topRival(c.m)?.name;
  const query = JSON.stringify([c.snapshot.snapshotId, state.granularity, state.currentPeriod, state.platforms, state.dataOriginFilter]);
  if (query !== lastQuery) {
    lastQuery = query;
    cache.clear();
  }
  // Unchanged terms have identical results. Scan all periods only for terms that changed.
  const rows = state.terms.map((term) => {
    if (!cache.has(term)) cache.set(term, evaluateFeatureTerms(c.snapshot, { ...state, featureTerms: [term] })[0]);
    return cache.get(term);
  });
  const active = rows.find((r) => r.id === state.activeTerm) ?? rows[0];
  function focusTerm(id) {
    state.activeTerm = id;
    c.render();
  }
  function featurePoint(row, key, period = state.currentPeriod) {
    const r = row.periodTrend.find((p) => p.periodId === period) ?? row;
    const stat = key === 'rival' ? r.competitorAffirmative[rival] : r[key];
    return {
      ...stat,
      action: register(() => {
        const term = state.terms.find((t) => t.id === row.id);
        const evidence =
          period === state.currentPeriod
            ? row
            : evaluateFeatureTerms(c.snapshot, { ...state, currentPeriod: period, featureTerms: [term] })[0];
        const ids = new Set(
          evidence.matchedClauses
            .filter(
              (cl) =>
                key === 'anyMention' ||
                (cl.polarity === 'affirmative' && cl.subjects.includes(key === 'rival' ? rival : target)),
            )
            .map((cl) => cl.responseId),
        );
        c.list(
          row.label,
          c.selectedSlots(period).filter((s) => ids.has(s.responseId)),
        );
      }),
    };
  }
  const editing = state.terms.find((t) => t.id === state.editTerm);
  const chips = state.terms
    .map(
      (t) =>
        '<span class="term">' +
        '<button class="term-edit" data-action="' +
        c.register(() => {
          state.editTerm = t.id;
          focusTerm(t.id);
          document.querySelector('#term-input').focus();
        }) +
        '">' +
        esc(t.label) +
        '<small class="pat"> [' +
        esc(t.patterns.join('|')) +
        ']</small></button>' +
        button(
          '×',
          () => {
            cache.delete(t);
            state.terms = state.terms.filter((v) => v !== t);
            state.featureSelected.delete(t.id);
            c.persistTerms();
            c.render();
          },
          'remove',
        ) +
        '</span>',
    )
    .join('');
  function save() {
    const input = document.querySelector('#term-input'),
      value = input.value.trim(),
      match = /^([^:：]+?)\s*[:：]\s*(.*)$/u.exec(value);
    const label = (match?.[1] ?? value).trim(),
      patterns = (match?.[2] ?? value)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    if (!label || !patterns.length) {
      input.setCustomValidity('请填写名称和至少一个检测词');
      input.reportValidity();
      return;
    }
    const id = editing?.id ?? termId(),
      term = { id, label, patterns: [...new Set(patterns)] };
    if (editing) {
      cache.delete(editing);
      state.terms = state.terms.map((t) => (t === editing ? term : t));
    } else state.terms.push(term);
    state.editTerm = null;
    state.activeTerm = id;
    state.featureSelected.add(id);
    c.persistTerms();
    c.render();
  }
  const form =
    '<form class="toolbar" data-submit="' +
    register(save) +
    '"><label>检测词<input id="term-input" required placeholder="名称: 词1|词2，或直接输入冷链" value="' +
    esc(editing ? editing.label + ': ' + editing.patterns.join('|') : '') +
    '"></label><button class="primary" type="submit">' +
    (editing ? '保存修改' : '新增检测词') +
    '</button></form>';
  const tableRows = rows.map((r) => [
    button(r.label, () => focusTerm(r.id)),
    ...['anyMention', 'targetAffirmative', 'givenTargetMentioned', ...(rival ? ['rival'] : [])].map((k) =>
      c.rate(featurePoint(r, k), true),
    ),
    r.uncertainCount,
  ]);
  const periods = c.m.periodSeries.map((p) => p.periodId);
  const selected = rows.filter((r) => state.featureSelected.has(r.id));
  const choices = rows
    .map(
      (r) =>
        '<label class="check"><input type="checkbox" ' +
        (state.featureSelected.has(r.id) ? 'checked' : '') +
        ' data-action="' +
        register(() => {
          if (state.featureSelected.has(r.id)) state.featureSelected.delete(r.id);
          else state.featureSelected.add(r.id);
          c.render();
        }) +
        '">' +
        esc(r.label) +
        '</label>',
    )
    .join('');
  const selectedSlots = new Map(c.selectedSlots(state.currentPeriod).map((s) => [s.responseId, s]));
  const words = [
    target,
    ...project.competitors.map((b) => b.canonical),
    ...(state.terms.find((t) => t.id === active?.id)?.patterns ?? []),
  ];
  const allClauses = active?.matchedClauses ?? [],
    limit = state.allClauses ? allClauses.length : 12;
  const clauses = allClauses.slice(0, limit).map((cl) => [
    esc(c.periodLabel(cl.periodId)),
    esc(platformName(cl.platform)),
    button('Q' + cl.questionSeq, () => c.list('分句原文', [selectedSlots.get(cl.responseId)])),
    highlight(cl.clauseText, words),
    esc(cl.subjects.join('、') || '主语未明'),
    polarities[cl.polarity === 'affirmative' && !cl.subjects.length ? 'uncertain' : cl.polarity],
  ]);
  return (
    '<p class="notice">以下比例统计模型回答正文中的表述出现与主语归属情况，不代表临床疗效或医药广告断言</p>' +
    panel(
      '检测词编辑',
      '<div class="pills">' + chips + '</div>' + form,
      button(
        '恢复默认词条',
        () => {
          cache.clear();
          state.terms = structuredClone(project.defaultFeatureTerms);
          state.featureSelected = new Set(state.terms.slice(0, 2).map((t) => t.id));
          c.persistTerms(true);
          state.activeTerm = null;
          state.editTerm = null;
          c.render();
        },
        'outline',
      ),
    ) +
    panel(
      '分句归属对比',
      table(
        [
          '特点词',
          '词面出现 n/V',
          esc(target) + '归属 n/V',
          '本品提及中 n/H',
          ...(rival ? [esc(rival) + '归属 n/V'] : []),
          '待核回答',
        ],
        tableRows,
        'num-table',
      ) +
        groupedBars(
          rows.map((r) => r.label),
          [
            { name: target, points: rows.map((r) => featurePoint(r, 'targetAffirmative')) },
            ...(rival ? [{ name: rival, points: rows.map((r) => featurePoint(r, 'rival')) }] : []),
          ],
          true,
        ),
    ) +
    panel(
      '特点词本品归属率趋势',
      '<div class="pills">' +
        choices +
        '</div>' +
        trend(
          periods.map((id) => c.periodLabel(id)),
          selected.map((r) => ({
            name: r.label,
            points: periods.map((id) => featurePoint(r, 'targetAffirmative', id)),
          })),
        ),
    ) +
    panel(
      '命中分句' + (active ? ' · ' + active.label : ''),
      table(['周期', '平台', '题号', '原始分句', '主语', '判定'], clauses) +
        (allClauses.length > 12
          ? '<div class="more">' +
            button(state.allClauses ? '收起，只看前 12 条' : '显示全部 ' + allClauses.length + ' 条命中分句', () => {
              state.allClauses = !state.allClauses;
              c.render();
            }, 'outline') +
            '</div>'
          : ''),
      '<small>' + allClauses.length + ' 条</small>',
    )
  );
}
