import { computeMetrics } from '../vendor/metrics-core.mjs';

import { buildReportViewModel, metricProjection, reportScope } from '../vendor/report-model.mjs';
import { installReportExport } from './report-export.mjs';
import { esc, pct, fraction, option, platformName, table, setLayout } from './charts.mjs';
import { overview } from './views/overview.mjs';
import { platforms } from './views/platforms.mjs';
import { competitors } from './views/competitors.mjs';
import { features } from './views/features.mjs';
import { citations } from './views/citations.mjs';
import { questions, evidence } from './views/questions.mjs';
import { methodology } from './views/methodology.mjs';

const views = {
  overview: ['分析总览', overview],
  platforms: ['平台分析', platforms],
  competitors: ['场景与竞品', competitors],
  features: ['特点词检测', features],
  citations: ['引用与竞品内容', citations],
  questions: ['逐题三问存证', questions],
  methodology: ['指标与口径', methodology],
};
const icons = [
  'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  'M3 20h18 M5 16v-5 M12 16V4 M19 16V8',
  'M3 8h6l3 4 3-7h6 M3 17h6l3-4 3 4h6',
  'M4 5h16 M9 3v4 M4 12h16 M15 10v4 M4 19h16 M8 17v4',
  'M9 15l6-6 M8 11l-3 3a3.5 3.5 0 005 5l3-3 M11 8l3-3a3.5 3.5 0 015 5l-3 3',
  'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h4',
  'M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 0-4-2-9 0z M12 6v13',
];
const $ = (s) => document.querySelector(s);
const dialog = $('#drawer');
const aliases = { analysis: 'overview', responses: 'questions' };
const state = {
  granularity: 'week',
  dataOriginFilter: 'all',
  trendMetric: 'brandMention',
  questionSearch: '',
  questionScene: '',
  questionHit: '',
  citationSearch: '',
  categories: null,
  allEntities: false,
  featureSelected: new Set(),
  overlap: null,
};
let liveApi, realCount, savedTerms, saveRevision = 0, saves = Promise.resolve();
let snapshot,
  project,
  weeks,
  months,
  allPlatforms,
  questionsBySeq,
  byWeek,
  actions = [],
  pageActionCount = 0,
  cache = new Map(),
  context;
const register = (fn) => (actions.push(fn), actions.length - 1);
const periodIds = () => (state.granularity === 'week' ? weeks.map((w) => w.periodId) : months);
const monthName = (m) => Number(m.slice(5)) + '月';
function periodLabel(id, long = false) {
  if (!id) return '无对比期';
  const week = byWeek.get(id);
  if (!week)
    return long
      ? id.slice(0, 4) + '年' + monthName(id) + ' (' + weeks.filter((w) => w.monthKey === id).length + '周)'
      : monthName(id);
  if (liveApi) return long ? week.label : week.label.split(' (')[0];
  const number = weeks.filter((w) => w.monthKey === week.monthKey).indexOf(week) + 1;
  return (
    monthName(week.monthKey) +
    (long
      ? '第' +
        number +
        '周 (' +
        week.startDate.slice(5).replace('-', '.') +
        '–' +
        week.endDate.slice(5).replace('-', '.') +
        ')'
      : 'W' + number)
  );
}
function range(granularity, periods) {
  Object.assign(state, {
    granularity,
    selectedPeriods: periods,
    currentPeriod: periods.at(-1),
    comparePeriod: periods.at(-2) ?? null,
  });
}
function selectedSlots(period, observed = true) {
  return snapshot.slots.filter(
    (s) =>
      (state.granularity === 'month' ? byWeek.get(s.periodId).monthKey : s.periodId) === period &&
      state.platforms.includes(s.platform) &&
      (!observed || (s.responseId && (state.dataOriginFilter !== 'real' || !s.isSynthetic))),
  );
}
function dialogBody(title, body) {
  $('#drawer-title').textContent = title;
  const template = document.createElement('template');
  template.innerHTML = body;
  if (liveApi) {
    for (const img of template.content.querySelectorAll('img.capture')) {
      const id = /^\.\/data\/screenshots\/([\w-]+)\.png$/.exec(img.getAttribute('src'))?.[1];
      if (id) img.src = img.parentElement.href = '/api/screenshots/' + id;
    }
  }
  $('#drawer-body').replaceChildren(template.content);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function list(title, rows) {
  dialogBody(
    title,
    '<p class="count">' +
      rows.length +
      ' 条命中回答</p>' +
      table(
        ['周期 / 平台', '题号 · 问询', '回答原文'],
        rows.map((s) => [
          esc(periodLabel(s.periodId)) + '<small>' + esc(platformName(s.platform)) + '</small>',
          'Q' + s.questionSeq + ' · ' + s.repeatIndex,
          button(s.answerText, () => evidence(context, s), 'answer-link'),
        ]),
      ),
  );
}
function button(label, fn, cls = '') {
  return '<button class="' + cls + '" data-action="' + register(fn) + '">' + esc(label) + '</button>';
}
function point(r, title, predicate, period = state.currentPeriod) {
  return { ...r, action: register(() => list(title, selectedSlots(period).filter(predicate))) };
}
function rate(p, withFraction = false) {
  return (
    '<button class="rate" data-action="' +
    p.action +
    '">' +
    pct(p.rate) +
    (withFraction ? '<small>' + fraction(p) + '</small>' : '') +
    '</button>'
  );
}
function entityRule(name, metric = 'brandMention', family = null) {
  const names = family || [name];
  return (s) => {
    const q = questionsBySeq.get(s.questionSeq),
      brands = s.brands.filter((b) => names.includes(b.canonical));
    if (metric === 'genericMention') return s.genericMentioned;
    if (metric === 'unpromptedBrandMention')
      return (
        (brands.length > 0 && !names.some((n) => q.promptBrands.includes(n))) ||
        Boolean(family && s.otherGenerics.includes(name) && !names.some((n) => q.promptBrands.includes(n)))
      );
    if (metric === 'brandMention') return brands.length > 0 || Boolean(family && s.otherGenerics.includes(name));
    const roles = { firstRecommendation: ['sole_first', 'co_first'], soleFirst: ['sole_first'], coFirst: ['co_first'] };
    return q.hasRecommendationIntent && brands.some((b) => roles[metric].includes(b.role));
  };
}
function entityPoint(row, metric = 'brandMention', opts = {}) {
  const { period, where = () => true, family } = opts;
  const predicate = entityRule(row.name ?? project.targetBrand.canonical, metric, family);
  const r = row[metric] ?? row.firstRecommendation[metric];
  return point(r, row.name ?? project.targetBrand.canonical, (s) => where(s) && predicate(s), period);
}
function metrics({ period = state.currentPeriod, compare = state.comparePeriod, platform, scene, projection } = {}) {
  const key = JSON.stringify([period, compare, platform, scene, projection]);
  if (!cache.has(key)) {
    const input = metricProjection(snapshot, projection, scene);
    cache.set(
      key,
      computeMetrics(input, {
        ...state,
        currentPeriod: period,
        comparePeriod: compare ?? '',
        platforms: platform ? [platform] : state.platforms,
      }),
    );
  }
  return cache.get(key);
}
function entityRows(m) {
  const g = m.competitors;
  return [...g.target, ...g.same_generic, ...g.other_generic.flatMap((f) => f.brands), ...g.no_generic];
}
function topRival(m, same = false) {
  const rows = same ? m.competitors.same_generic : entityRows(m).slice(1);
  return [...rows].sort((a, b) => b.brandMention.hits - a.brandMention.hits)[0];
}
function download(name, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((v) => {
          let text = String(v ?? '');
          if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function go(view, push = true) {
  const url = new URL(location.href);
  const mapped = aliases[view] ?? view;
  state.view = Object.hasOwn(views, mapped) ? mapped : 'overview';
  url.searchParams.set('view', state.view);
  if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](null, '', url);
  render();
}
function renderControls(m) {
  const select = (label, key, values) =>
    '<label>' +
    label +
    '<select data-key="' +
    key +
    '">' +
    values.map((id) => option(id, periodLabel(id, true), state[key] === id)).join('') +
    '</select></label>';
  const pill = (label, active, fn) =>
    '<button aria-pressed="' + active + '" data-action="' + register(fn) + '">' + esc(label) + '</button>';
  function shortcut(g, ids) {
    range(g, ids);
    reset();
  }
  const weekIds = weeks.map((w) => w.periodId);
  const shortcuts = [
    ['全部' + weeks.length + '周', 'week', weekIds],
    ...months.map((month) => {
      const ids = weeks.filter((w) => w.monthKey === month).map((w) => w.periodId);
      return [monthName(month) + 'W1–W' + ids.length, 'week', ids];
    }),
    [months.map(monthName).join(' vs '), 'month', months],
  ];
  const completion = point(
    { hits: m.validResponses, denominator: m.plannedSlots, rate: m.completionRate },
    '采集完成',
    () => true,
  );
  $('#controls').innerHTML =
    '<div class="filter-row"><div class="seg">' +
    ['week', 'month']
      .map((g, i) =>
        pill(['按周查看', '按月查看'][i], state.granularity === g, () => shortcut(g, g === 'week' ? weekIds : months)),
      )
      .join('') +
    '</div>' +
    select('当前期', 'currentPeriod', periodIds()) +
    select('对比期', 'comparePeriod', state.comparePeriod ? periodIds() : [null, ...periodIds()]) +
    (liveApi && realCount !== null
      ? '<span class="live-badge">100% 真实已采数据 (' + realCount + ' 条)</span>'
      : '<label class="origin">数据来源<select data-key="dataOriginFilter">' +
    option('all', '全部样本 (真实+模拟演示)', state.dataOriginFilter === 'all') +
    option('real', '仅真实采集记录', state.dataOriginFilter === 'real') +
    '</select></label>') +
    '<button class="completion" data-action="' +
    completion.action +
    '">采集完成 ' +
    fraction(completion) +
    ' (' +
    pct(completion.rate) +
    ')</button></div>' +
    '<div class="filter-row slim"><span class="filter-label">趋势范围</span><div class="pills">' +
    shortcuts
      .map(([l, g, ids]) =>
        pill(l, g === state.granularity && ids.join() === state.selectedPeriods.join(), () => shortcut(g, ids)),
      )
      .join('') +
    '</div><i class="divider" aria-hidden="true"></i>' +
    '<span class="filter-label">平台范围</span><div class="pills">' +
    pill('全部' + allPlatforms.length + '平台', state.platforms.length === allPlatforms.length, () => {
      state.platforms = [...allPlatforms];
      reset();
    }) +
    allPlatforms
      .map((p) =>
        pill(platformName(p), state.platforms.length !== allPlatforms.length && state.platforms.includes(p), () => {
          const all = state.platforms.length === allPlatforms.length;
          const next = all
            ? [p]
            : state.platforms.includes(p)
              ? state.platforms.filter((id) => id !== p)
              : [...state.platforms, p];
          state.platforms = next.length ? next : [...allPlatforms];
          reset();
        }),
      )
      .join('') +
    '</div></div>';
}
function reset() {
  cache.clear();
  render();
}
let closeExport, lastWidth = 0, resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = $('#content')?.clientWidth;
    if (snapshot && w && Math.abs(w - lastWidth) > 24 && !dialog.open) render();
  }, 180);
});
function render() {
  closeExport?.();
  actions = [];
  $('#tooltip').hidden = true;
  const m = metrics();
  context = {
    snapshot,
    project,
    state,
    weeks,
    months,
    allPlatforms,
    byWeek,
    questionsBySeq,
    selectedSlots,
    metrics,
    m,
    entityRule,
    entityPoint,
    entityRows,
    topRival,
    button,
    point,
    rate,
    register,
    list,
    dialogBody,
    persistTerms,
    download,
    go,
    render,
    periodLabel,
  };
  $('nav').innerHTML = Object.entries(views)
    .map(
      ([id, [label]], i) =>
        '<a href="?view=' +
        id +
        '" data-view="' +
        id +
        '" ' +
        (id === state.view ? 'aria-current="page"' : '') +
        '><svg aria-hidden="true" viewBox="0 0 24 24"><path d="' +
        icons[i] +
        '"/></svg>' +
        label +
        '</a>',
    )
    .join('');
  $('h1').textContent = views[state.view][0];
  document.title = views[state.view][0] + ' · ' + project.projectName;
  renderControls(m);
  setLayout($('#content').clientWidth);
  lastWidth = $('#content').clientWidth;
  $('#content').innerHTML = views[state.view][1](context);
  decorate();
  pageActionCount = actions.length;
}
// Visual-only pass: colours signed pp deltas and feeds KPI gauges. Never alters text.
function decorate() {
  const delta = /^([+-])(\d+(?:\.\d+)?) pp$/;
  for (const el of document.querySelectorAll('#content [data-delta], #content .ranking b, #content td, #content td small')) {
    if (el.children.length) continue;
    const m = delta.exec(el.textContent.trim());
    if (m) el.dataset.tone = Number(m[2]) === 0 ? 'flat' : m[1] === '+' ? 'up' : 'down';
  }
  for (const kpi of document.querySelectorAll('#content .kpi')) {
    const v = parseFloat(kpi.querySelector('[data-value]')?.textContent);
    kpi.style.setProperty('--rate', Number.isFinite(v) ? Math.min(1, v / 100) : 0);
  }
}
document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-view]');
  if (nav && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    go(nav.dataset.view);
    window.scrollTo(0, 0);
    return;
  }
  const el = event.target.closest('[data-action]');
  if (el) actions[Number(el.dataset.action)]?.(event);
});
document.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-submit]')) return;
  event.preventDefault();
  actions[Number(event.target.dataset.submit)](event);
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'term-input') event.target.setCustomValidity('');
  const key = event.target.dataset.search;
  if (!key || event.isComposing) return;
  const { id, value, selectionStart } = event.target;
  state[key] = value;
  state.citationPage = 0;
  render();
  const input = document.getElementById(id);
  input.focus();
  input.setSelectionRange(selectionStart, selectionStart);
});
document.addEventListener('change', (event) => {
  if (event.target.hasAttribute('data-select-action')) actions[Number(event.target.dataset.selectAction)](event);
  const key = event.target.dataset.key;
  if (key) {
    state[key] = event.target.value;
    reset();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.target.closest('svg [data-action]') && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    actions[Number(event.target.closest('[data-action]').dataset.action)]();
  }
});
function tooltip(event) {
  const el = event.target.closest('[data-tip]'),
    tip = $('#tooltip');
  tip.hidden = !el;
  if (!el) return;
  tip.textContent = el.dataset.tip;
  const rect = el.getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(innerWidth - tip.offsetWidth - 8, (event.clientX || rect.x) + 10)) + 'px';
  tip.style.top = Math.max(4, Math.min(innerHeight - tip.offsetHeight - 8, (event.clientY || rect.y) - 40)) + 'px';
}
document.addEventListener('pointerover', tooltip);
document.addEventListener('focusin', tooltip);
document.addEventListener('pointerout', () => {
  $('#tooltip').hidden = true;
});
document.addEventListener('focusout', () => {
  $('#tooltip').hidden = true;
});
dialog.addEventListener('close', () => {
  actions.length = pageActionCount;
  $('#drawer-body').replaceChildren();
});
$('#close').onclick = () => dialog.close();
dialog.onclick = (e) => {
  if (e.target === dialog && e.clientX < dialog.getBoundingClientRect().left) dialog.close();
};
window.addEventListener('popstate', () => go(new URL(location.href).searchParams.get('view'), false));
$('#export').onclick = () => {
  const event = new CustomEvent('geo:export-report', {
    cancelable: true,
    detail: { snapshotId: snapshot.snapshotId, query: { ...state } },
  });
  if (!window.dispatchEvent(event)) return;
  download('GEO-' + state.currentPeriod + '.csv', [
    ['周期', '题号', '平台', '问询', '来源', '回答 ID', '回答原文'],
    ...selectedSlots(state.currentPeriod).map((s) => [
      s.periodId,
      s.questionSeq,
      platformName(s.platform),
      s.repeatIndex,
      s.isSynthetic ? '模拟' : '真实',
      s.responseId,
      s.answerText,
    ]),
  ]);
};
async function request(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw Error('HTTP ' + res.status);
  return res.json();
}
function notify(message) { $('#live-note').textContent = message; }
function persistTerms(restore = false) {
  if (!liveApi) return;
  const revision = ++saveRevision;
  const changed = structuredClone(state.terms);
  saves = saves.then(async () => {
    try {
      savedTerms = await request(liveApi + '/feature-terms', restore ? { method: 'DELETE' } : {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changed),
      });
      if (revision === saveRevision) notify('特点词已保存');
    } catch (err) {
      if (revision === saveRevision) {
        state.terms = structuredClone(savedTerms);
        reset();
        notify('特点词保存失败 · ' + err.message);
      }
    }
  });
}
function updateSnapshot(data, first) {
  if (data.schemaVersion !== '1.0.0') throw Error('不支持的快照版本');
  const previousIds = first ? [] : periodIds();
  const allSelected = first || previousIds.every(id => state.selectedPeriods.includes(id));
  const following = first || state.currentPeriod === previousIds.at(-1);
  const allPlatformsSelected = first || state.platforms.length === allPlatforms.length;
  snapshot = data;
  project = snapshot.project;
  weeks = [...snapshot.periods].sort((a, b) => a.periodId.localeCompare(b.periodId));
  byWeek = new Map(weeks.map((w) => [w.periodId, w]));
  months = [...new Set(weeks.map((w) => w.monthKey))];
  allPlatforms = [...new Set(weeks.flatMap((w) => w.platforms))];
  questionsBySeq = new Map(project.questions.map((q) => [q.seq, q]));
  if (liveApi) {
    const valid = snapshot.slots.filter(s => s.responseId);
    realCount = valid.some(s => s.isSynthetic) ? null : valid.length;
    // The existing evidence drawer uses the static path as its image marker.
    // dialogBody resolves that marker before inserting the fragment into the page.
    for (const slot of valid) {
      if (slot.screenshot === '/api/screenshots/' + slot.responseId)
        slot.screenshot = 'screenshots/' + slot.responseId + '.png';
    }
  }
  state.platforms = allPlatformsSelected ? [...allPlatforms] : state.platforms.filter(p => allPlatforms.includes(p));
  if (first) {
    state.terms = structuredClone(snapshot.featureTerms ?? project.defaultFeatureTerms);
    savedTerms = structuredClone(state.terms);
    state.featureSelected = new Set(state.terms.slice(0, 2).map((t) => t.id));
    const monthly = liveApi && months.length && weeks.every(w => w.dataOrigin === 'real');
    range(monthly ? 'month' : 'week', monthly ? months : weeks.map(w => w.periodId));
  } else {
    const ids = periodIds();
    state.selectedPeriods = allSelected ? ids : state.selectedPeriods.filter(id => ids.includes(id));
    if (following || !ids.includes(state.currentPeriod)) {
      const next = ids.at(-1);
      if (state.currentPeriod !== next) state.comparePeriod = ids.at(-2) ?? null;
      state.currentPeriod = next;
    }
    if (!ids.includes(state.comparePeriod)) state.comparePeriod = null;
  }
  cache.clear();
  $('#project').textContent = project.projectName;
  $('#snapshot-date').innerHTML =
    '<small>快照生成时间 · UTC</small>' + esc(snapshot.generatedAt.replace('T', ' ').slice(0, 16));
}
function pollerBadge(status) {
  const runs = status.activeRuns;
  $('#poller-status').textContent = runs.length
    ? (status.daemonDetected ? '采集中' : '有未结束批次') + ' · 已完成 ' +
      runs.reduce((n, r) => n + r.succeeded, 0) + '/' + runs.reduce((n, r) => n + r.planned, 0)
    : (status.daemonDetected ? '采集服务空闲' : '采集服务离线');
}
function installLive() {
  $('#export').insertAdjacentHTML('beforebegin', '<div class="live-tools"><span id="poller-status" class="live-badge"></span>' +
    '<button id="live-sync" class="outline">↻ 同步最新采集</button><small id="live-note" role="status"></small></div>');
  const status = () => request('/api/poller/status').then(pollerBadge, () => {
    $('#poller-status').textContent = '轮询状态暂不可用';
  });
  status();
  setInterval(() => { if (!document.hidden) status(); }, 15000);
  $('#live-sync').onclick = async ({ currentTarget: button }) => {
    button.disabled = true;
    notify('正在同步…');
    try {
      await saves;
      const result = await request(liveApi + '/sync', { method: 'POST' });
      updateSnapshot(await request(liveApi + '/snapshot'), false);
      pollerBadge(result.pollerStatus);
      if (dialog.open) dialog.close();
      render();
      notify('已同步，当前共 ' + result.totalValidResponses + ' 条真实有效回答');
    } catch (err) { notify('同步失败 · ' + err.message); }
    finally { button.disabled = false; }
  };
}
try {
  const health = await request('/api/health', { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (health?.ok && health.mode === 'live-backend') liveApi = '/api/projects/' + encodeURIComponent(health.projectId);
  updateSnapshot(await request(liveApi ? liveApi + '/snapshot' : './data/snapshot.json'), true);
  if (liveApi) installLive();
  closeExport = installReportExport(() => snapshot, { buildReportViewModel, reportScope, liveApi });
  go(new URL(location.href).searchParams.get('view'), false);
} catch (error) {
  $('#content').textContent = '无法载入分析工作台 · ' + error.message;
}
