import { esc, pct, pp, fraction } from './charts.mjs';

function display(value) {
  if (value == null) return '—';
  if (typeof value !== 'object') return String(value);
  return 'deltaPp' in value ? pp(value.deltaPp) : pct(value.rate) + ' (' + fraction(value) + ')';
}

function figure({ kind, title, values, labels }) {
  const left = 56,
    right = 660,
    top = 16,
    bottom = 145;
  const step = (right - left) / Math.max(1, labels.length);
  const x = (i) => left + step * (i + 0.5);
  const y = (rate) => bottom - (bottom - top) * rate;
  let marks = '',
    line = '',
    move = true;
  for (const rate of [0, 0.5, 1]) {
    marks +=
      '<path class="grid" d="M' +
      left +
      ' ' +
      y(rate) +
      'H' +
      right +
      '"/><text x="2" y="' +
      (y(rate) + 4) +
      '">' +
      rate * 100 +
      '%</text>';
  }
  for (const [i, point] of values.entries()) {
    marks += '<text text-anchor="middle" x="' + x(i) + '" y="166">' + esc(labels[i]) + '</text>';
    if (point.rate == null) {
      move = true;
      continue;
    }
    if (kind === 'bars') {
      marks +=
        '<rect x="' +
        (x(i) - step * 0.26) +
        '" y="' +
        y(point.rate) +
        '" width="' +
        step * 0.52 +
        '" height="' +
        (bottom - y(point.rate)) +
        '"><title>' +
        esc(display(point)) +
        '</title></rect>';
    } else {
      line += (move ? 'M' : 'L') + x(i) + ' ' + y(point.rate) + ' ';
      marks +=
        '<circle cx="' +
        x(i) +
        '" cy="' +
        y(point.rate) +
        '" r="3.5"><title>' +
        esc(display(point)) +
        '</title></circle>';
      move = false;
    }
  }
  return (
    '<figure><figcaption>' +
    esc(title) +
    '</figcaption><svg role="img" aria-label="' +
    esc(title) +
    '" viewBox="0 0 680 180">' +
    marks +
    '<path class="series" d="' +
    line +
    '"/></svg></figure>'
  );
}
function reportTable({ title, columns, rows }) {
  const body = rows
    .map((row) => '<tr>' + row.map((c) => '<td>' + esc(display(c)) + '</td>').join('') + '</tr>')
    .join('');
  return (
    '<table' +
    (rows.length > 12 ? ' class="long-table"' : '') +
    '><caption>' +
    esc(title) +
    '</caption><thead><tr>' +
    columns.map((c) => '<th scope="col">' + esc(c) + '</th>').join('') +
    '</tr></thead><tbody>' +
    (body || '<tr><td colspan="' + columns.length + '">当前筛选下暂无记录</td></tr>') +
    '</tbody></table>'
  );
}

export function renderReportHtml(model, css) {
  const { query, dataOrigin } = model;
  const origin = esc(dataOrigin.label) + ' · 真实 ' + dataOrigin.real + ' / 模拟 ' + dataOrigin.synthetic;
  const title = esc(model.projectName) + ' · GEO 分析报告';
  const chapters = model.chapters
    .map(
      (c, i) =>
        '<section><h2>' +
        esc(c.title) +
        '</h2>' +
        (i === 0 ? '<h3>执行摘要</h3><p class="finding">' + esc(model.narrative) + '</p>' : '') +
        (i || model.narrativeSource === 'ai'
          ? '<ul>' + c.findings.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>'
          : '') +
        (c.chart ? figure(c.chart) : '') +
        c.tables.map(reportTable).join('') +
        '</section>',
    )
    .join('');
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;">' +
    '<title>' +
    title +
    '</title><style>' +
    css +
    '\n@page { @top-right { content: "' +
    dataOrigin.label +
    '"; font: 8pt sans-serif; color: #774310 } @bottom-left { content: "' +
    dataOrigin.label +
    '"; font: 8pt sans-serif } @bottom-right { content: counter(page) " / " counter(pages); font: 8pt sans-serif } }</style></head><body class="report-paper"><article><header><p class="origin">' +
    origin +
    '</p><h1>' +
    title +
    '</h1><p>' +
    esc(query.currentPeriod || '无当前期') +
    ' 对比 ' +
    esc(query.comparePeriod || '无基准期') +
    ' · 共同可比单元 |C| = ' +
    model.commonUnits +
    '</p><dl>' +
    [
      ['趋势范围', query.selectedPeriods.join('、')],
      ['平台', query.platforms.join('、')],
      ['报告 ID', model.reportId],
      ['快照 ID', model.snapshotId],
      ['快照生成时间（UTC）', model.generatedAt],
    ]
      .map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>')
      .join('') +
    '</dl></header>' +
    chapters +
    '<aside><h2>附录 · 统计口径</h2><ul>' +
    model.appendix.map((p) => '<li>' + esc(p) + '</li>').join('') +
    '</ul></aside><footer>' +
    origin +
    ' · ' +
    esc(model.reportId) +
    '</footer></article></body></html>'
  );
}

function download(name, data, type) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([data], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows) {
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((cell) => {
            let text = cell == null ? '' : display(cell);
            if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}

// ZIP stored entries (UTF-8 names, no compression). One download works offline
// without browser permission for multiple automatic files.
function csvArchive(files) {
  const encode = (s) => new TextEncoder().encode(s);
  const local = [],
    central = [];
  let offset = 0,
    directorySize = 0;
  for (const [filename, content] of files) {
    const name = encode(filename),
      bytes = encode(content);
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = new Uint8Array(30 + name.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, ~crc, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length),
      e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    entry.set(header.subarray(4, 28), 6);
    e.setUint32(42, offset, true);
    entry.set(name, 46);
    local.push(header, bytes);
    central.push(entry);
    offset += header.length + bytes.length;
    directorySize += entry.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end]);
}
function summaryCsv(model) {
  const rows = [
    ['报告 ID', '当前期', '基准期', '章节', '表名', '行', '字段', '值', '分子', '分母', '原始比例', '可比百分点'],
  ];
  for (const chapter of model.chapters)
    for (const t of chapter.tables)
      for (const [i, row] of t.rows.entries()) {
        row.forEach((v, j) =>
          rows.push([
            model.reportId,
            model.query.currentPeriod,
            model.query.comparePeriod,
            chapter.title,
            t.title,
            i + 1,
            t.columns[j],
            v,
            v?.hits,
            v?.denominator,
            v?.rate,
            v?.deltaPp,
          ]),
        );
      }
  return csv(rows);
}
function evidenceCsv(model, scoped) {
  const { query } = model;
  const weeks = new Set(
    scoped.periods
      .filter((p) => (query.granularity === 'month' ? p.monthKey : p.periodId) === query.currentPeriod)
      .map((p) => p.periodId),
  );
  const rows = [
    [
      '报告 ID',
      '回答 ID',
      '采集周',
      '平台',
      '题号',
      '问询',
      '来源',
      '站点',
      '文章',
      '规范链接',
      '来源品牌',
      '文类',
      '来源类型',
      '实引',
      '角标',
      '角标原句',
      '句中品牌',
    ],
  ];
  for (const s of scoped.slots.filter((s) => weeks.has(s.periodId) && s.responseId)) {
    for (const r of s.citations) {
      for (const mark of r.markers.length ? r.markers : [null]) {
        rows.push([
          model.reportId,
          s.responseId,
          s.periodId,
          s.platform,
          s.questionSeq,
          s.repeatIndex,
          s.isSynthetic ? '模拟' : '真实',
          r.domain,
          r.title,
          r.urlCanonical,
          r.contentBrands.join('、'),
          r.docCategory,
          r.kinds.join('|'),
          String(r.inlineVerified),
          mark?.idx,
          s.clauses[mark?.clauseIdx]?.text,
          mark?.brandsInClause.join('、'),
        ]);
      }
    }
  }
  return csv(rows);
}

export function installReportExport(snapshotSource, { buildReportViewModel, reportScope, liveApi }) {
  const panel = document.querySelector('#report-export');
  const frame = panel.querySelector('iframe'),
    status = panel.querySelector('[role=status]');
  if (liveApi) panel.querySelector('.report-tools').insertAdjacentHTML('afterbegin',
    '<button data-export="pdf">下载正式 A4 PDF 报告</button>');
  let active,
    sheet,
    revision = 0;
  function close() {
    revision++;
    active = null;
    if (panel.open) panel.close();
    frame.removeAttribute('srcdoc');
  }
  function dismiss() {
    close();
    document.querySelector('#export').focus();
  }
  function escape(event) {
    if (event.key === 'Escape') dismiss();
  }
  panel.querySelector('[data-export=close]').onclick = dismiss;
  panel.addEventListener('keydown', escape);
  window.addEventListener('geo:export-report', async (event) => {
    // Respect consumers of the existing cancelable export event.
    await Promise.resolve();
    if (event.defaultPrevented) return;
    const request = ++revision;
    active = null;
    const buttons = panel.querySelectorAll('button:not([data-export=close])');
    for (const button of buttons) button.disabled = true;
    if (!panel.open) panel.show();
    status.textContent = '正在生成报告…';
    frame.removeAttribute('srcdoc');
    try {
      const snapshot = typeof snapshotSource === 'function' ? snapshotSource() : snapshotSource;
      const model = buildReportViewModel(snapshot, event.detail.query);
      if (!sheet) {
        const res = await fetch('./styles/print-report.css');
        if (!res.ok) throw Error('无法读取打印样式');
        sheet = await res.text();
      }
      if (request !== revision) return;
      const html = renderReportHtml(model, sheet);
      frame.onload = () => {
        if (request === revision && frame.contentDocument?.querySelector('.report-paper')) {
          frame.contentDocument.addEventListener('keydown', escape);
          active = { model, html, snapshot };
          for (const button of buttons) button.disabled = false;
          status.textContent = '回答明细 CSV 已触发下载。';
        }
      };
      frame.srcdoc = html;
    } catch (err) {
      if (request === revision) status.textContent = '报告生成失败 · ' + err.message;
    }
  });
  panel.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-export]')?.dataset.export;
    if (!active || !action || action === 'close') return;
    const { model, html, snapshot } = active;
    const name = 'GEO-' + model.query.currentPeriod;
    if (action === 'pdf' && liveApi) {
      const button = event.target.closest('button');
      const request = revision;
      button.disabled = true;
      status.textContent = '正在排版 A4 PDF…';
      try {
        const res = await fetch(liveApi + '/export-report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...model.query, format: 'pdf' }) });
        if (!res.ok) throw Error('HTTP ' + res.status);
        download(name + '.pdf', await res.blob(), 'application/pdf');
        if (request === revision) status.textContent = 'PDF 已下载';
      } catch (err) { if (request === revision) status.textContent = 'PDF 导出失败 · ' + err.message; }
      finally { if (request === revision) button.disabled = false; }
    }
    if (action === 'print') {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }
    if (action === 'html') download(name + '.html', html, 'text/html;charset=utf-8');
    if (action === 'csv' || action === 'json') {
      const scoped = reportScope(snapshot, model.query);
      if (action === 'json')
        download(
          name + '.json',
          JSON.stringify({ snapshot: scoped, queryState: model.query, reportId: model.reportId }),
          'application/json',
        );
      else
        download(
          name + '.zip',
          csvArchive([
            ['summary.csv', summaryCsv(model)],
            ['citation-evidence.csv', evidenceCsv(model, scoped)],
          ]),
          'application/zip',
        );
    }
  });
  return close;
}
