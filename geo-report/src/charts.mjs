export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const pct = (value) => (value == null ? '—' : (value * 100).toFixed(1) + '%');
export const fraction = (r) => r.hits + '/' + r.denominator;
export const pp = (value) => {
  if (value == null) return '不可比';
  const n = Math.abs(value) < 0.05 ? 0 : value;
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
};
export const platformNames = {
  doubao: '豆包',
  deepseek: 'DeepSeek',
  tongyi: '通义千问',
  yuanbao: '腾讯元宝',
  kimi: 'Kimi',
  ernie: '文心一言',
  chatglm: '智谱清言',
};
export const platformName = (id) => platformNames[id] ?? id;
export const scenes = {
  symptom: '泛症状选药',
  category_form: '品类与剂型对比',
  brand_compare: '品牌推荐与横评',
  safety_combo: '安全与联用',
};
// Signal lime = 本品 / primary series; orange = 头号竞品; then neutral + cool tones.
export const colors = ['#d4ff3a', '#ff6a3d', '#e6e6e8', '#5d8bff', '#8a8a90', '#ffb23d', '#36d6b5'];
let chartSeq = 0;
export function table(headers, rows, cls = '') {
  return (
    '<div class="table-scroll"><table' +
    (cls ? ' class="' + cls + '"' : '') +
    '><thead><tr>' +
    headers.map((h) => '<th scope="col">' + h + '</th>').join('') +
    '</tr></thead><tbody>' +
    (rows.length
      ? rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('')
      : '<tr><td class="empty" colspan="' + headers.length + '">当前筛选下暂无记录</td></tr>') +
    '</tbody></table></div>'
  );
}
export function panel(title, body, aside = '') {
  return (
    '<section class="panel"><header class="panel-head"><h2>' +
    esc(title) +
    '</h2>' +
    aside +
    '</header>' +
    body +
    '</section>'
  );
}
export function option(value, label, selected) {
  return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
}
export function highlight(value, words) {
  const list = [...new Set(words.filter(Boolean))].sort((a, b) => b.length - a.length);
  const patterns = list.map((w) => w.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'));
  const re = new RegExp('(' + [...patterns, '\\[\\d+\\]'].join('|') + ')', 'gu');
  return String(value ?? '')
    .split(re)
    .map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part)))
    .join('');
}
export function sourceLink(url, title) {
  return /^https?:\/\//i.test(url)
    ? '<a rel="noopener noreferrer" target="_blank" href="' + esc(url) + '">' + esc(title || url) + ' ↗</a>'
    : esc(title || url);
}
function legend(series) {
  return (
    '<div class="legend">' +
    series
      .map((s, i) => '<span><i style="background:' + colors[i % colors.length] + '"></i>' + esc(s.name) + '</span>')
      .join('') +
    '</div>'
  );
}
function pointAttrs(name, label, point) {
  const tip = name + ' · ' + label + ' · ' + fraction(point) + ' (' + pct(point.rate) + ')';
  return (
    ' tabindex="0" role="button" aria-label="' +
    esc(tip) +
    '" data-tip="' +
    esc(tip) +
    '" data-action="' +
    point.action +
    '"'
  );
}
// Charts render at the measured panel width so text and markers keep a constant
// on-screen size. app.mjs refreshes these widths before every render.
export const layout = { full: 1000, half: 480, major: 640, minor: 420 };
export function setLayout(contentWidth) {
  const pad = 42,
    gap = 16,
    w = Math.max(430, Math.floor(contentWidth));
  layout.full = Math.max(430, w - pad);
  layout.half = Math.max(400, Math.floor((w - gap) / 2) - pad);
  layout.major = Math.max(430, Math.floor(((w - gap) * 2) / 3) - pad);
  layout.minor = Math.max(360, Math.floor((w - gap) * 0.42) - pad);
}
const widthOf = (span) => layout[span] ?? layout.full;
// Null observations break the line. A measured zero remains on the baseline.
export function trend(labels, series, { span = 'full', height = 230 } = {}) {
  const width = Math.max(widthOf(span), labels.length * 64),
    left = 44,
    right = width - 20,
    top = 14,
    bottom = height - 34;
  const ceiling = Math.max(
    0.1,
    Math.ceil(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.rate || 0))) * 10) / 10,
  );
  const x = (i) => (labels.length < 2 ? (left + right) / 2 : left + (i * (right - left)) / (labels.length - 1));
  const y = (rate) => bottom - (rate / ceiling) * (bottom - top);
  const gid = 'g' + ++chartSeq;
  let svg =
    '<defs><linearGradient id="' +
    gid +
    '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' +
    colors[0] +
    '" stop-opacity=".2"/><stop offset="1" stop-color="' +
    colors[0] +
    '" stop-opacity="0"/></linearGradient></defs>';
  for (let i = 0; i <= 4; i++) {
    const v = (ceiling * i) / 4;
    svg +=
      '<path class="' +
      (i ? 'grid' : 'axis') +
      '" d="M' +
      left +
      ' ' +
      y(v) +
      'H' +
      right +
      '"/><text x="0" y="' +
      (y(v) + 4) +
      '">' +
      Math.round(v * 100) +
      '%</text>';
  }
  labels.forEach((label, i) => {
    svg +=
      '<path class="grid" d="M' +
      x(i) +
      ' ' +
      bottom +
      'v5"/><text class="x-label" text-anchor="middle" x="' +
      x(i) +
      '" y="' +
      (bottom + 22) +
      '">' +
      esc(label) +
      '</text>';
  });
  series.forEach((s, k) => {
    const color = colors[k % colors.length];
    let d = '',
      points = '',
      start = true,
      area = '',
      segStart = null,
      lastX = null;
    s.points.forEach((p, i) => {
      if (p.rate == null) {
        start = true;
        return;
      }
      if (k === 0) {
        if (start) {
          if (segStart != null && lastX !== segStart)
            area += 'L' + lastX + ' ' + bottom + ' L' + segStart + ' ' + bottom + ' Z ';
          segStart = x(i);
          area += 'M' + x(i) + ' ' + y(p.rate) + ' ';
        } else area += 'L' + x(i) + ' ' + y(p.rate) + ' ';
        lastX = x(i);
      }
      d += (start ? 'M' : 'L') + x(i) + ' ' + y(p.rate) + ' ';
      start = false;
      points +=
        '<g' +
        pointAttrs(s.name, labels[i], p) +
        '><circle cx="' +
        x(i) +
        '" cy="' +
        y(p.rate) +
        '" r="10" fill="transparent"/><circle cx="' +
        x(i) +
        '" cy="' +
        y(p.rate) +
        '" r="' +
        (k ? 2.5 : 3.5) +
        '" fill="' +
        (k ? color : '#0a0a0b') +
        '" stroke="' +
        color +
        '" stroke-width="' +
        (k ? 0 : 1.8) +
        '"/></g>';
    });
    if (k === 0 && segStart != null && lastX !== segStart)
      area += 'L' + lastX + ' ' + bottom + ' L' + segStart + ' ' + bottom + ' Z';
    svg +=
      '<g data-series="' +
      esc(s.name) +
      '">' +
      (k === 0 && area ? '<path d="' + area + '" fill="url(#' + gid + ')" stroke="none"/>' : '') +
      '<path d="' +
      d +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="' +
      (k ? 1.4 : 2.2) +
      '" stroke-linejoin="round"' +
      (k ? ' stroke-opacity=".85"' : '') +
      '/>' +
      points +
      '</g>';
  });
  return (
    legend(series) +
    '<div class="chart-scroll"><svg class="chart" role="group" aria-label="多期趋势折线图" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '">' +
    svg +
    '</svg></div>'
  );
}
// Bars are scaled to the largest value on screen and always carry a value label,
// so small rates stay legible without implying a different denominator.
export function groupedBars(labels, series, diverging = false, { span = 'full' } = {}) {
  const width = widthOf(span),
    labelCol = Math.min(diverging ? 156 : 124, Math.round(width * 0.24)),
    valueCol = 50,
    barH = 8,
    rowGap = diverging ? 34 : 18 + series.length * (barH + 5),
    max = Math.max(0.05, ...series.flatMap((s) => s.points.map((p) => p.rate || 0))) * 1.08;
  const plotLeft = labelCol + (diverging ? valueCol : 0),
    plotRight = width - valueCol,
    center = plotLeft + (plotRight - plotLeft) / 2,
    half = (plotRight - plotLeft) / 2,
    span1 = width - labelCol - valueCol;
  let svg = '';
  labels.forEach((label, i) => {
    const y = i * rowGap + 8;
    svg +=
      '<text class="x-label" x="0" y="' +
      (y + (diverging ? 11 : 4 + (series.length * (barH + 5)) / 2)) +
      '">' +
      esc(label) +
      '</text>';
    if (i) svg += '<path class="grid" d="M0 ' + (y - 9) + 'H' + width + '"/>';
    series.forEach((s, k) => {
      const p = s.points[i];
      if (p.rate == null) return;
      if (diverging) {
        const w = (p.rate / max) * half,
          bx = k === 0 ? center - w : center,
          by = y + 3;
        svg +=
          '<rect x="' +
          (k === 0 ? center - half : center) +
          '" y="' +
          by +
          '" width="' +
          half +
          '" height="' +
          barH +
          '" rx="2" fill="#16161a"/>';
        svg +=
          '<g' +
          pointAttrs(s.name, label, p) +
          '><rect x="' +
          bx +
          '" y="' +
          by +
          '" width="' +
          Math.max(2, w) +
          '" height="' +
          barH +
          '" rx="2" fill="' +
          colors[k % colors.length] +
          '"/></g>';
        svg +=
          '<text class="value" text-anchor="' +
          (k === 0 ? 'end' : 'start') +
          '" x="' +
          (k === 0 ? plotLeft - 8 : plotRight + 8) +
          '" y="' +
          (by + barH - 0.5) +
          '">' +
          pct(p.rate) +
          '</text>';
      } else {
        const w = (p.rate / max) * span1,
          by = y + k * (barH + 5);
        svg +=
          '<rect x="' +
          labelCol +
          '" y="' +
          by +
          '" width="' +
          span1 +
          '" height="' +
          barH +
          '" rx="2" fill="#16161a"/>';
        svg +=
          '<g' +
          pointAttrs(s.name, label, p) +
          '><rect x="' +
          labelCol +
          '" y="' +
          by +
          '" width="' +
          Math.max(2, w) +
          '" height="' +
          barH +
          '" rx="2" fill="' +
          colors[k % colors.length] +
          '"/></g>';
        svg +=
          '<text class="value" text-anchor="end" x="' +
          width +
          '" y="' +
          (by + barH - 0.5) +
          '">' +
          pct(p.rate) +
          '</text>';
      }
    });
  });
  const height = Math.max(36, labels.length * rowGap + 2);
  return (
    legend(series) +
    '<div class="chart-scroll"><svg class="chart bars" aria-label="分组条形对比图" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '">' +
    (diverging ? '<path class="axis" d="M' + center + ' 0v' + height + '"/>' : '') +
    svg +
    '</svg></div>'
  );
}
export function frequency(distribution) {
  let x = 0;
  const segments = distribution.bins.map((b, i) => {
    const w = (b.rate ?? 0) * 160,
      start = x;
    x += w;
    return (
      '<rect x="' +
      start +
      '" width="' +
      w +
      '" height="7" fill="' +
      ['#26262b', '#4a4a52', '#8fae2a', '#d4ff3a'][i] +
      '"><title>' +
      i +
      '/3 · ' +
      fraction(b) +
      ' 个单元</title></rect>'
    );
  });
  return (
    '<svg class="frequency" viewBox="0 0 160 7">' +
    segments.join('') +
    '</svg><small>' +
    distribution.bins.map((b, i) => i + '/3·' + b.hits).join('　') +
    '</small>'
  );
}
