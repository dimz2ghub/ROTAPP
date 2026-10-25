// Rotapp PDF reader.
// extractPages() turns a PDF into positioned text items (needs PDF.js).
// parseRota() is pure: it finds the day headings, your row and each cell's date by position.

export const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export const WD = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
export const CODE = { M: 'M', L: 'L', OFF: 'O', H: 'H', C: 'C', S: 'S', MA: 'MA', LA: 'LA', E: 'E', PH: 'P' };
export const HEADER_RE = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(\d{1,2})$/i;

export async function extractPages(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const s = (it.str || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const tr = pdfjs.Util.transform(vp.transform, it.transform);
      items.push({ s, x: tr[4], top: tr[5], w: Math.abs(it.width) });
    }
    pages.push({ n: p, items });
  }
  return pages;
}

export async function readRotaPdf(pdfjs, data, opts) {
  let pages;
  try {
    pages = await extractPages(pdfjs, data);
  } catch (err) {
    return { status: 'fail', message: "Rotapp couldn't open that file. Check it is a PDF.", months: [] };
  }
  return parseRota(pages, opts);
}

// Sorting the name column into office headings, people and rows to ignore.
const KNOWN_GROUPS = ['account managers'];
export function classifyLabel(label) {
  const t = label.replace(/\s+/g, ' ').trim(), low = t.toLowerCase();
  if (!t) return 'skip';
  if (/^(shifts|key|legend)$/i.test(t)) return 'stop';
  if (/^(total\b|name$)/i.test(t) || /speakers/i.test(t)) return 'skip';
  if (t.length <= 3 && CODE[t.toUpperCase()]) return 'stop';
  if (KNOWN_GROUPS.includes(low)) return 'group';
  if (/[A-Z]{2}/.test(t) && t === t.toUpperCase()) return 'group';
  return 'person';
}
export const groupName = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUs\b/, 'US').replace(/\bPd\b/, 'PD');
export const codeOf = (v) => (v == null || String(v).trim() === '' ? 'O' : (CODE[String(v).toUpperCase().replace(/[^A-Z]/g, '')] || 'O'));
// Collects every person row under its office heading. Returns { groups: [[group, [names]]], people: { name: { g, d: { day: code }, me } } }.
export function collectTeam(rowsInOrder, isMe) {
  const groups = [], people = {};
  let cur = null;
  for (const row of rowsInOrder) {
    const name = row.label.replace(/\s+/g, ' ').trim();
    const kind = classifyLabel(name);
    if (kind === 'stop') break;
    if (kind === 'skip') continue;
    if (kind === 'group') { cur = groupName(name); if (!groups.find((g) => g[0] === cur)) groups.push([cur, []]); continue; }
    if (!cur) { cur = 'Other'; if (!groups.find((g) => g[0] === cur)) groups.push([cur, []]); }
    const g = groups.find((x) => x[0] === cur);
    if (people[name]) continue;
    g[1].push(name);
    people[name] = { g: cur, d: row.days(), me: isMe(row) };
  }
  return { groups: groups.filter((g) => g[1].length), people };
}

export const norm = (s) => s.toLowerCase().replace(/[^a-z0-9À-ɏ ]/g, ' ').replace(/\s+/g, ' ').trim();
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

function findHeaders(items) {
  const heads = [];
  for (const it of items) {
    const m = it.s.match(HEADER_RE);
    if (m) heads.push({ wd: WD[m[1].toLowerCase().slice(0, 3)], n: +m[2], cx: it.x + it.w / 2, top: it.top });
  }
  // Fallback: weekday and day number as separate items.
  const wds = items.filter((i) => /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/i.test(i.s));
  const nums = items.filter((i) => /^\d{1,2}$/.test(i.s));
  for (const w of wds) {
    const wcx = w.x + w.w / 2;
    const n = nums.find((q) => Math.abs(q.top - w.top) < 14 && Math.abs(q.x + q.w / 2 - wcx) < 8);
    if (n) heads.push({ wd: WD[w.s.toLowerCase().slice(0, 3)], n: +n.s, cx: wcx, top: Math.min(w.top, n.top) });
  }
  return heads;
}

function bestBand(heads) {
  const bands = [];
  for (const h of [...heads].sort((a, b) => a.top - b.top)) {
    const b = bands.find((x) => Math.abs(x.top - h.top) <= 3);
    if (b) b.items.push(h); else bands.push({ top: h.top, items: [h] });
  }
  const good = bands.filter((b) => b.items.length >= 20);
  return good.length ? good[0] : null;
}

export function pickMonthYear(monthHint, cols, today) {
  const ty = today.getFullYear(), tm = today.getMonth();
  const dist = (y, m) => Math.abs((y * 12 + m) - (ty * 12 + tm));
  const fits = (y, m) => cols.every((c) => {
    const d = new Date(y, m, c.n);
    return d.getMonth() === m && d.getDay() === c.wd;
  });
  const months = monthHint == null ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [monthHint];
  const cand = [];
  for (const y of [ty - 1, ty, ty + 1]) for (const m of months) if (fits(y, m)) cand.push({ y, m });
  cand.sort((a, b) => dist(a.y, a.m) - dist(b.y, b.m));
  return cand.length ? cand[0] : null;
}

function parsePage(page, opts) {
  const warnings = [];
  const heads = findHeaders(page.items);
  const band = bestBand(heads);
  if (!band) return { page: page.n, skipped: true };

  const cols = band.items.sort((a, b) => a.cx - b.cx);
  const consecutive = cols.every((c, i) => c.n === cols[0].n + i);
  if (!consecutive) warnings.push("The day headings aren't in a simple 1, 2, 3 order, so some days may be misplaced.");
  const pitch = median(cols.slice(1).map((c, i) => c.cx - cols[i].cx));

  // Month name above the headings.
  let monthHint = null;
  const names = page.items
    .filter((i) => MONTHS.includes(i.s.toLowerCase()) && i.top <= band.top + 2)
    .sort((a, b) => b.top - a.top);
  if (names.length) monthHint = MONTHS.indexOf(names[0].s.toLowerCase());
  let my = pickMonthYear(monthHint, cols, opts.today);
  let month, year;
  if (my) {
    month = my.m; year = my.y;
    if (monthHint == null) warnings.push("The month name wasn't found, so Rotapp worked it out from the weekdays.");
  } else {
    month = monthHint != null ? monthHint : cols.length ? opts.today.getMonth() : 0;
    year = opts.today.getFullYear();
    warnings.push("The weekdays in the headings don't match the calendar for " + MONTHS[month] + ". The year may be wrong.");
  }
  const dim = new Date(year, month + 1, 0).getDate();
  if (cols.length < dim) warnings.push('Only ' + cols.length + ' of ' + dim + ' days were found in the headings.');
  if (cols.length > dim) warnings.push('Found ' + cols.length + ' day headings for a month with ' + dim + ' days.');

  // Find the row.
  const labelEdge = cols[0].cx - pitch * 0.6;
  const labelItems = page.items.filter((i) => i.x + i.w / 2 < labelEdge && i.top > band.top + 4);
  const target = norm(opts.name || '');
  let rowTop = null, matched = null, matches = [];
  const exact = labelItems.filter((i) => norm(i.s) === target);
  if (exact.length) {
    matches = exact;
  } else {
    const toks = target.split(' ').filter(Boolean);
    matches = labelItems.filter((i) => toks.length && toks.every((t) => norm(i.s).split(' ').includes(t)));
    if (matches.length) warnings.push('The name matched loosely: "' + matches[0].s + '".');
  }
  if (!matches.length) {
    const toks = target.split(' ').filter(Boolean);
    const cands = [...new Set(labelItems.filter((i) => toks.some((t) => norm(i.s).split(' ').includes(t))).map((i) => i.s))].slice(0, 5);
    return { page: page.n, problem: 'name', month, year, cands, warnings };
  }
  if (matches.length > 1) warnings.push('"' + matches[0].s + '" appears ' + matches.length + ' times. Rotapp used the first one.');
  matched = matches[0].s;
  rowTop = matches[0].top;

  // Cells in that row.
  const raw = page.items.filter((i) => Math.abs(i.top - rowTop) <= 2.5 && i.x + i.w / 2 >= labelEdge);
  const cells = [];
  for (const it of raw) {
    const toks = it.s.split(' ');
    if (toks.length === 1) { cells.push({ s: it.s, cx: it.x + it.w / 2 }); continue; }
    const len = it.s.length;
    let off = 0;
    for (const t of toks) {
      cells.push({ s: t, cx: it.x + it.w * ((off + t.length / 2) / len) });
      off += t.length + 1;
    }
  }
  const byCol = new Map();
  const unplaced = [];
  for (const c of cells) {
    let best = 0, bd = Infinity;
    cols.forEach((col, i) => { const d = Math.abs(col.cx - c.cx); if (d < bd) { bd = d; best = i; } });
    if (bd > pitch * 0.45) { unplaced.push(c.s); continue; }
    if (byCol.has(best)) { warnings.push('Two entries landed on ' + cols[best].n + ' ' + MONTHS[month] + '. Rotapp used the first.'); continue; }
    byCol.set(best, c.s);
  }
  if (unplaced.length) warnings.push(unplaced.length + ' entries in your row sat between days and were ignored: ' + unplaced.join(', ') + '.');

  const days = cols.map((col, i) => {
    const rawText = byCol.get(i) || null;
    if (rawText == null) return { n: col.n, wd: col.wd, raw: null, code: 'O', blank: true };
    const up = rawText.toUpperCase().replace(/[^A-Z]/g, '');
    const code = CODE[up];
    return code ? { n: col.n, wd: col.wd, raw: rawText, code } : { n: col.n, wd: col.wd, raw: rawText, code: '?', unknown: true };
  });
  // Everyone else on the page, for the team view.
  const placeRow = (top) => {
    const out = {};
    for (const it of page.items) {
      if (Math.abs(it.top - top) > 2.5 || it.x + it.w / 2 < labelEdge) continue;
      const toks = it.s.split(' '), len = it.s.length;
      let off = 0;
      for (const t of toks) {
        const cx = toks.length === 1 ? it.x + it.w / 2 : it.x + it.w * ((off + t.length / 2) / len);
        off += t.length + 1;
        let best = 0, bd = Infinity;
        cols.forEach((col, i) => { const d = Math.abs(col.cx - cx); if (d < bd) { bd = d; best = i; } });
        if (bd <= pitch * 0.45 && out[cols[best].n] == null) out[cols[best].n] = codeOf(t);
      }
    }
    cols.forEach((c) => { if (out[c.n] == null) out[c.n] = 'O'; });
    return out;
  };
  const labelRows = [...labelItems].sort((a, b) => a.top - b.top).map((it) => ({ label: it.s, top: it.top, days: () => placeRow(it.top) }));
  const team = collectTeam(labelRows, (r) => Math.abs(r.top - rowTop) <= 1);

  return {
    page: page.n, month, year, daysInMonth: dim, days, matched, warnings, team,
    blanks: days.filter((d) => d.blank).map((d) => d.n),
    unknown: days.filter((d) => d.unknown).map((d) => ({ n: d.n, raw: d.raw })),
  };
}

export function parseRota(pages, opts) {
  const o = { name: '', today: new Date(), ...opts };
  const results = pages.map((p) => parsePage(p, o));
  const read = results.filter((r) => r.days);
  if (read.length) {
    const warnings = [];
    if (read.length > 1) warnings.push('This PDF has ' + read.length + ' months. Rotapp is showing the first one.');
    return { status: 'ok', months: read, warnings };
  }
  const prob = results.find((r) => r.problem === 'name');
  if (prob) {
    return {
      status: 'fail', reason: 'name',
      message: "Rotapp couldn't find \"" + o.name + '" in that PDF.',
      candidates: prob.cands, months: [],
    };
  }
  return { status: 'fail', reason: 'layout', message: "Rotapp couldn't find the day headings, so this doesn't look like a rota it knows how to read.", months: [] };
}
