// Rotapp xlsx reader. Needs JSZip (passed in) and the browser's DOMParser.
// Finds the row of dates, then your row, on every sheet that looks like a rota month.

import { CODE, MONTHS, HEADER_RE, WD, norm, pickMonthYear } from './reader.js';

const colNum = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const refParts = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return m ? { c: colNum(m[1]), r: +m[2] } : null; };
const serialToDate = (s) => { const d = new Date(Math.round((s - 25569) * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const dateToSerial = (y, m, d) => Math.round(Date.UTC(y, m, d) / 86400000) + 25569;
const isSerial = (v) => typeof v === 'number' && v >= 36526 && v <= 73050 && Math.floor(v) === v;
const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const attr = (el, name) => el.getAttribute(name);

async function loadWorkbook(JSZip, data) {
  const zip = await JSZip.loadAsync(data);
  const text = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
  const wbXml = await text('xl/workbook.xml');
  if (!wbXml) throw new Error('not a workbook');
  const wb = parseXml(wbXml);
  const relXml = await text('xl/_rels/workbook.xml.rels');
  const rels = {};
  if (relXml) for (const r of parseXml(relXml).getElementsByTagName('Relationship')) rels[attr(r, 'Id')] = attr(r, 'Target');
  const sstXml = await text('xl/sharedStrings.xml');
  const sst = [];
  if (sstXml) for (const si of parseXml(sstXml).getElementsByTagName('si')) {
    sst.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join(''));
  }
  const sheets = [];
  for (const sh of wb.getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid];
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    sheets.push({ name: attr(sh, 'name'), hidden: attr(sh, 'state') === 'hidden' || attr(sh, 'state') === 'veryHidden', path: target });
  }
  return { text, sst, sheets };
}

function parseSheet(xml, sst) {
  const doc = parseXml(xml);
  const hiddenCols = new Set();
  for (const c of doc.getElementsByTagName('col')) {
    if (attr(c, 'hidden') === '1' || attr(c, 'hidden') === 'true') {
      for (let i = +attr(c, 'min'); i <= Math.min(+attr(c, 'max'), +attr(c, 'min') + 200); i++) hiddenCols.add(i);
    }
  }
  const rows = new Map();
  const hiddenRows = new Set();
  let autoRow = 0;
  for (const row of doc.getElementsByTagName('row')) {
    const rn = attr(row, 'r') ? +attr(row, 'r') : ++autoRow;
    autoRow = rn;
    if (attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true') hiddenRows.add(rn);
    const cells = new Map();
    let autoCol = 0;
    for (const c of row.getElementsByTagName('c')) {
      const p = attr(c, 'r') ? refParts(attr(c, 'r')) : null;
      const cn = p ? p.c : ++autoCol;
      autoCol = cn;
      const t = attr(c, 't');
      const vEl = c.getElementsByTagName('v')[0];
      const fEl = c.getElementsByTagName('f')[0];
      const raw = vEl ? vEl.textContent : null;
      let v = null;
      if (t === 's') v = raw != null ? (sst[+raw] ?? null) : null;
      else if (t === 'inlineStr') v = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
      else if (t === 'str') v = raw;
      else if (t === 'b') v = raw === '1';
      else if (t === 'e') v = null;
      else if (raw != null && raw !== '') v = Number(raw);
      cells.set(cn, { v, f: fEl ? (fEl.textContent || '').trim() : null });
    }
    rows.set(rn, cells);
  }
  return { rows, hiddenRows, hiddenCols };
}

// Fill in header dates when the file has formulas but no saved results.
function repairHeaderRow(cells) {
  const cols = [...cells.keys()].sort((a, b) => a - b);
  let prev = null, prevCol = null;
  for (const c of cols) {
    const cell = cells.get(c);
    if (cell.v == null && cell.f != null) {
      const m = /^DATE\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)$/i.exec(cell.f);
      if (m) cell.v = dateToSerial(+m[1], +m[2] - 1, +m[3]);
      else if (prev != null && prevCol === c - 1) cell.v = prev + 1;
    }
    if (isSerial(cell.v)) { prev = cell.v; prevCol = c; } else { prev = null; prevCol = null; }
  }
}

function findDateRun(rows) {
  let best = null;
  const rowNums = [...rows.keys()].sort((a, b) => a - b).filter((r) => r <= 20);
  for (const r of rowNums) {
    const cells = rows.get(r);
    repairHeaderRow(cells);
    const cols = [...cells.keys()].sort((a, b) => a - b);
    let run = [];
    const flush = () => { if (run.length >= 20 && (!best || run.length > best.cols.length)) best = { row: r, cols: run, kind: 'date' }; run = []; };
    for (const c of cols) {
      const v = cells.get(c).v;
      if (isSerial(v) && (!run.length || (c === run[run.length - 1].c + 1 && v === run[run.length - 1].v + 1))) run.push({ c, v });
      else { flush(); if (isSerial(v)) run = [{ c, v }]; }
    }
    flush();
    if (best) return best;
  }
  // Text headings such as "Thu 01".
  for (const r of rowNums) {
    const cells = rows.get(r);
    const cols = [...cells.keys()].sort((a, b) => a - b);
    let run = [];
    let found = null;
    const flush = () => { if (run.length >= 20 && !found) found = { row: r, cols: run, kind: 'text' }; run = []; };
    for (const c of cols) {
      const v = cells.get(c).v;
      const m = typeof v === 'string' ? HEADER_RE.exec(v.trim()) : null;
      if (m && (!run.length || (c === run[run.length - 1].c + 1 && +m[2] === run[run.length - 1].n + 1))) run.push({ c, wd: WD[m[1].toLowerCase().slice(0, 3)], n: +m[2] });
      else { flush(); if (m) run = [{ c, wd: WD[m[1].toLowerCase().slice(0, 3)], n: +m[2] }]; }
    }
    flush();
    if (found) return found;
  }
  return null;
}

function readSheet(sheet, parsed, opts) {
  const { rows, hiddenRows } = parsed;
  const run = findDateRun(rows);
  if (!run) return { sheet: sheet.name, skipped: true };
  const warnings = [];
  const cols = run.cols;
  let month, year, dayCols;
  if (run.kind === 'date') {
    const dates = cols.map((x) => serialToDate(x.v));
    month = dates[0].getMonth(); year = dates[0].getFullYear();
    dayCols = cols.map((x, i) => ({ c: x.c, n: dates[i].getDate(), wd: dates[i].getDay() }));
    if (dates.some((d) => d.getMonth() !== month)) warnings.push('The dates on sheet ' + sheet.name + ' run into the next month. Only the first month is used.');
    dayCols = dayCols.filter((x, i) => dates[i].getMonth() === month);
  } else {
    const lo = cols[0].c, hi = cols[cols.length - 1].c;
    let hint = null;
    for (let r = 1; r < run.row && hint == null; r++) {
      for (const [cn, cell] of (rows.get(r) || new Map())) {
        if (cn >= lo && cn <= hi && typeof cell.v === 'string' && MONTHS.includes(cell.v.trim().toLowerCase())) { hint = MONTHS.indexOf(cell.v.trim().toLowerCase()); break; }
      }
    }
    const my = pickMonthYear(hint, cols, opts.today);
    if (my) { month = my.m; year = my.y; } else { month = hint != null ? hint : opts.today.getMonth(); year = opts.today.getFullYear(); warnings.push("The weekdays in the headings don't match the calendar for " + MONTHS[month] + '. The year may be wrong.'); }
    dayCols = cols.map((x) => ({ c: x.c, n: x.n, wd: x.wd }));
  }
  const dim = new Date(year, month + 1, 0).getDate();
  if (dayCols.length < dim) warnings.push('Only ' + dayCols.length + ' of ' + dim + ' days were found on sheet ' + sheet.name + '.');

  // A title above the dates should agree with the dates.
  if (run.kind === 'date') {
    for (let r = 1; r < run.row; r++) {
      let hit = null;
      for (const [cn, cell] of (rows.get(r) || new Map())) {
        if (cn >= cols[0].c && cn <= cols[cols.length - 1].c && typeof cell.v === 'string' && MONTHS.includes(cell.v.trim().toLowerCase())) { hit = MONTHS.indexOf(cell.v.trim().toLowerCase()); break; }
      }
      if (hit != null && hit !== month) warnings.push('Sheet ' + sheet.name + ' is titled ' + MONTHS[hit].toUpperCase() + ' but its dates are in ' + MONTHS[month] + '.');
      if (hit != null) break;
    }
  }

  // Find the row.
  const firstCol = dayCols[0].c;
  const target = norm(opts.name || '');
  const toks = target.split(' ').filter(Boolean);
  const labelOf = (cells) => {
    for (let c = 1; c < firstCol; c++) { const cell = cells.get(c); if (cell && typeof cell.v === 'string' && cell.v.trim()) return cell.v; }
    return null;
  };
  const found = [];
  for (const [r, cells] of rows) {
    if (r <= run.row) continue;
    const label = labelOf(cells);
    if (!label) continue;
    const nl = norm(label);
    if (nl === target) found.push({ r, label, exact: true, hidden: hiddenRows.has(r) });
    else if (toks.length && toks.every((t) => nl.split(' ').includes(t))) found.push({ r, label, exact: false, hidden: hiddenRows.has(r) });
  }
  if (!found.length) {
    const cands = [];
    for (const [r, cells] of rows) {
      if (r <= run.row) continue;
      const label = labelOf(cells);
      if (label && toks.some((t) => norm(label).split(' ').includes(t))) cands.push(label.trim());
    }
    return { sheet: sheet.name, problem: 'name', month, year, cands: [...new Set(cands)].slice(0, 5), warnings };
  }
  found.sort((a, b) => (b.exact - a.exact) || (a.hidden - b.hidden) || (a.r - b.r));
  const pick = found[0];
  if (!pick.exact) warnings.push('The name matched loosely: "' + pick.label.trim() + '".');
  const same = found.filter((f) => f.exact === pick.exact && f.hidden === pick.hidden);
  if (same.length > 1) warnings.push('"' + pick.label.trim() + '" appears ' + same.length + ' times on sheet ' + sheet.name + '. Rotapp used the first.');
  if (pick.hidden) warnings.push('That row is hidden in the spreadsheet.');

  const cells = rows.get(pick.r);
  const days = dayCols.map((d) => {
    const cell = cells.get(d.c);
    let v = cell ? cell.v : null;
    if (typeof v === 'string') v = v.trim();
    if (v === null || v === '' || v === undefined) return { n: d.n, wd: d.wd, raw: null, code: 'O', blank: true };
    const rawText = String(v);
    const code = CODE[rawText.toUpperCase().replace(/[^A-Z]/g, '')];
    return code ? { n: d.n, wd: d.wd, raw: rawText, code } : { n: d.n, wd: d.wd, raw: rawText, code: '?', unknown: true };
  });
  return {
    sheet: sheet.name, month, year, daysInMonth: dim, days, matched: pick.label.trim(), warnings,
    blanks: days.filter((d) => d.blank).map((d) => d.n),
    unknown: days.filter((d) => d.unknown).map((d) => ({ n: d.n, raw: d.raw })),
    allBlank: days.every((d) => d.blank),
  };
}

export async function readRotaXlsx(JSZip, data, opts) {
  const o = { name: '', today: new Date(), ...opts };
  let wb;
  try { wb = await loadWorkbook(JSZip, data); }
  catch (err) { return { status: 'fail', reason: 'open', message: "Rotapp couldn't open that file. Check it is an .xlsx spreadsheet.", months: [] }; }

  const results = [];
  for (const sh of wb.sheets) {
    if (sh.hidden) continue;
    const xml = await wb.text(sh.path);
    if (!xml) continue;
    try { results.push(readSheet(sh, parseSheet(xml, wb.sst), o)); }
    catch (err) { results.push({ sheet: sh.name, skipped: true }); }
  }
  const warnings = [];
  const read = results.filter((r) => r.days && !r.allBlank);
  for (const r of results) if (r.days && r.allBlank) warnings.push('Sheet ' + r.sheet + ' has no shifts in your row, so it was skipped.');
  for (const r of results) if (r.problem === 'name' && read.length) warnings.push('Sheet ' + r.sheet + " doesn't contain \"" + o.name + '".');
  if (read.length) {
    read.sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
    return { status: 'ok', months: read, warnings };
  }
  const prob = results.find((r) => r.problem === 'name');
  if (prob) return { status: 'fail', reason: 'name', message: "Rotapp couldn't find \"" + o.name + '" in that spreadsheet.', candidates: prob.cands, months: [] };
  return { status: 'fail', reason: 'layout', message: "Rotapp couldn't find a row of dates, so this doesn't look like a rota it knows how to read.", months: [] };
}
