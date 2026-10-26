import { readRotaPdf, MONTHS } from './reader.js';
import { readRotaXlsx } from './xlsx.js';

const VERSION = '0.8.1 prototype';
const KEY = 'rotapp.v1';

// UI v2.0 (Dark-first) shift colours
const T = {
  M: { n: 'M shift', sm: 'M', bg: '#2FB866', fg: '#06150B' },
  L: { n: 'L shift', sm: 'L', bg: '#4C7DFF', fg: '#fff' },
  O: { n: 'Off', sm: 'Off', bg: 'var(--off)', fg: 'var(--offt)' },
  H: { n: 'Holiday', sm: 'H', bg: '#FFD43B', fg: '#1a1400' },
  C: { n: 'C', sm: 'C', bg: '#D9BC8C', fg: '#1a1208' },
  S: { n: 'Sick', sm: 'Sick', bg: '#FF7AA8', fg: '#1a0710' },
  X: { n: 'Other', sm: 'Oth', bg: '#A8724A', fg: '#fff' },
  MA: { n: 'MA', sm: 'MA', bg: '#FF8A3D', fg: '#1a0b00' },
  LA: { n: 'LA', sm: 'LA', bg: '#6FB3FF', fg: '#06121f' },
  E: { n: 'E', sm: 'E', bg: '#FF5A5A', fg: '#fff' },
  P: { n: 'PH', sm: 'PH', bg: '#9B5CFF', fg: '#fff' },
};
const COMMON = ['M', 'L', 'O', 'H', 'C', 'S'];
const TIMES = { M: '08:00–16:30', L: '15:00–23:30', E: '23:00–07:30' };
const WORKED = { M: 1, L: 1, MA: 1, LA: 1, E: 1 };
const MORE = ['X', 'MA', 'LA', 'E', 'P'];
const LEAVE = { H: 1, C: 1, S: 1, X: 1 };
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- data ----------
let D = {};
let SET = { name: 'Dimitri Jovanovic', allow: null, carry: 0, style: 'A', theme: 'auto', wmode: 'cal', showing: null, swapGroups: ['London', 'Dubai'], lastImport: null, lastBackup: null, years: {}, showC: true, showSick: true, cAdj: {}, removed: [], skipped: [], whoOff: [], whoHide: [] };
// Everyone else from the rota: people[name] = { g: office, d: { 'YYYY-MM-DD': code } }; groups = office order from the most recent import.
let TEAM = { people: {}, groups: [], latest: [], seen: {} };
let canSave = true;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d.days === 'object') D = d.days;
    if (d && d.set) SET = { ...SET, ...d.set };
    NOTES = cleanNotes(d && d.notes);
    if (d && d.team && d.team.people) TEAM = { people: d.team.people, groups: d.team.groups || [], latest: d.team.latest || latestFromGroups(d.team.groups || []), seen: d.team.seen || {} };
    // 0.5 kept one allowance; from 0.6 each year has its own.
    if (!SET.years || typeof SET.years !== 'object') SET.years = {};
    if (SET.allow != null && !SET.years[curYear()]) SET.years[curYear()] = { allow: SET.allow, carry: SET.carry || 0 };
    if (!Array.isArray(SET.whoOff)) SET.whoOff = [];
    if (!Array.isArray(SET.whoHide)) SET.whoHide = [];
    tidyShowing();
  } catch (e) { canSave = false; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 2, days: D, set: SET, team: TEAM, notes: NOTES })); canSave = true; }
  catch (e) { canSave = false; }
}

// Notes on changed days: NOTES[who][ymd] = { was, kind: 'swap' | 'edit', with }. Your own days use the key '@me'.
let NOTES = {};
const ME_KEY = '@me';
// Keep the original "was"; a day back on its "was" shift loses its note.
function markChange(key, k, oldC, newC, kind, withN, id) {
  const m = NOTES[key] || (NOTES[key] = {}), n = m[k], was = n ? n.was : (oldC || 'O');
  if ((newC || 'O') === was) delete m[k];
  else m[k] = kind === 'swap' ? { was, kind: 'swap', with: withN || '', id: id || '' } : { was, kind: 'edit' };
  if (!Object.keys(m).length) delete NOTES[key];
}
function clearNote(key, k) { const m = NOTES[key]; if (!m) return; delete m[k]; if (!Object.keys(m).length) delete NOTES[key]; }
function clearMonthNotes(key, pre) { const m = NOTES[key]; if (!m) return; Object.keys(m).forEach((k) => { if (k.startsWith(pre)) delete m[k]; }); if (!Object.keys(m).length) delete NOTES[key]; }
function cleanNotes(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [who, m] of Object.entries(src)) {
    if (!m || typeof m !== 'object') continue;
    const o = {};
    for (const [k, v] of Object.entries(m)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && T[v.was] && (v.kind === 'swap' || v.kind === 'edit')) o[k] = v.kind === 'swap' ? { was: v.was, kind: 'swap', with: String(v.with || ''), id: String(v.id || '') } : { was: v.was, kind: 'edit' };
    if (Object.keys(o).length) out[who] = o;
  }
  return out;
}
// Swapped days get a corner triangle in the colour of the shift they replaced (Off: solid black in dark mode, white in light).
function swapPaint(k) {
  const key = viewingOther() ? SET.showing : ME_KEY, n = NOTES[key] && NOTES[key][k];
  if (!n || n.kind !== 'swap') return null;
  return n.was === 'O' ? 'var(--offmark)' : T[n.was].bg;
}

// ---------- team ----------
const latestFromGroups = (groups) => groups.flatMap((g) => g[1]);
const latestNames = () => TEAM.groups.flatMap((g) => g[1]);
const viewingOther = () => !!(SET.showing && SET.showing !== SET.name && TEAM.people[SET.showing]);
const shown = () => (viewingOther() ? TEAM.people[SET.showing].d : D);
// Only people in the most recent import appear in the list; if the one being viewed drops off, go back to you.
function tidyShowing() { if (SET.showing && (SET.showing === SET.name || !latestNames().includes(SET.showing))) SET.showing = null; }
const othersIn = (groups) => groups.map(([g, ns]) => [g, ns.filter((n) => n !== SET.name)]).filter((x) => x[1].length);

// ---------- dates ----------
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const pk = (s) => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const today = () => midnight(new Date());
const monthKey = (y, m) => y + '-' + p2(m + 1) + '-';
const hasMonth = (y, m) => { const pre = monthKey(y, m); return Object.keys(D).some((k) => k.startsWith(pre)); };
function lab(a, b) {
  if (ymd(a) === ymd(b)) return a.getDate() + ' ' + MN[a.getMonth()];
  if (a.getMonth() === b.getMonth()) return a.getDate() + ' – ' + b.getDate() + ' ' + MN[b.getMonth()];
  return a.getDate() + ' ' + MN[a.getMonth()] + ' – ' + b.getDate() + ' ' + MN[b.getMonth()];
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isWide = () => window.matchMedia('(min-width: 900px)').matches;

// ---------- state ----------
const S = {
  tab: 'month', woff: 0, moff: 0, sheet: null, pick: null, more: false, showPast: false,
  add: null, imp: null, card: null, nest: { ppl: false, swap: false, who: false }, wOff: new Set(),
};

// ---------- leave maths ----------
const curYear = () => today().getFullYear();
const leaveYear = () => S.lyear || curYear();
const allowFor = (y) => (SET.years && SET.years[y]) || null;
// A new year starts with last year's allowance copied in (carry-over is typed in by hand).
function ensureYear() {
  const y = curYear();
  if (SET.years[y]) return;
  const prev = Object.keys(SET.years).map(Number).filter((x) => x < y).sort((a, b) => b - a)[0];
  if (prev != null && SET.years[prev].allow != null) {
    const P = SET.years[prev], unused = P.allow + (P.carry || 0) - countYear(prev).H;
    SET.years[y] = { allow: P.allow, carry: Math.max(0, Math.min(2, unused)) }; save();
  }
}
// English bank holidays (England and Wales), worked out for any year. One-off extra days are not included.
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da);
}
function bankHolidays(y) {
  const out = [], add = (d, n) => out.push({ k: ymd(d), n });
  const firstMon = (m) => { const d = new Date(y, m, 1); return addDays(d, (8 - d.getDay()) % 7); };
  const lastMon = (m) => { const d = new Date(y, m + 1, 0); return addDays(d, -((d.getDay() + 6) % 7)); };
  const nyd = new Date(y, 0, 1); add(nyd.getDay() === 6 ? addDays(nyd, 2) : nyd.getDay() === 0 ? addDays(nyd, 1) : nyd, 'New Year’s Day');
  const es = easterSunday(y); add(addDays(es, -2), 'Good Friday'); add(addDays(es, 1), 'Easter Monday');
  add(firstMon(4), 'Early May bank holiday'); add(lastMon(4), 'Spring bank holiday'); add(lastMon(7), 'Summer bank holiday');
  const xm = new Date(y, 11, 25), w = xm.getDay();
  if (w === 5) { add(xm, 'Christmas Day'); add(new Date(y, 11, 28), 'Boxing Day (substitute)'); }
  else if (w === 6) { add(new Date(y, 11, 27), 'Christmas Day (substitute)'); add(new Date(y, 11, 28), 'Boxing Day (substitute)'); }
  else if (w === 0) { add(new Date(y, 11, 26), 'Boxing Day'); add(new Date(y, 11, 27), 'Christmas Day (substitute)'); }
  else { add(xm, 'Christmas Day'); add(new Date(y, 11, 26), 'Boxing Day'); }
  return out.sort((a, b) => (a.k < b.k ? -1 : 1));
}
// 1 C day for each bank holiday worked on M, L, MA, LA or E; unused C days reset each January.
const bhWorked = (y) => bankHolidays(y).filter((b) => WORKED[D[b.k]]).map((b) => ({ ...b, s: D[b.k] }));
const cAdjFor = (y) => (SET.cAdj && SET.cAdj[y]) || 0;
const cEarned = (y) => bhWorked(y).length + cAdjFor(y);
const cLeft = (y) => cEarned(y) - countYear(y).C;
// The first month of the year that has any of your days, if it isn't January.
function countingFrom(y) {
  const ms = Object.keys(D).filter((k) => k.startsWith(y + '-')).map((k) => +k.slice(5, 7) - 1);
  if (!ms.length) return null;
  const first = Math.min(...ms);
  return first > 0 ? first : null;
}
function countYear(y) {
  const c = { H: 0, C: 0, S: 0, X: 0 };
  for (const [k, v] of Object.entries(D)) if (k.startsWith(y + '-') && c[v] !== undefined) c[v]++;
  return c;
}
function leaveRuns(y) {
  const keys = Object.keys(D).filter((k) => k.startsWith(y + '-') && LEAVE[D[k]]).sort();
  const runs = [];
  let cur = null;
  for (const k of keys) {
    const d = pk(k), t = D[k];
    if (cur && cur.t === t) {
      let ok = true;
      for (let x = addDays(cur.e, 1); x < d; x = addDays(x, 1)) { const w = x.getDay(); if (w !== 0 && w !== 6) ok = false; }
      if (ok) { cur.e = d; cur.n++; continue; }
    }
    cur = { t, s: d, e: d, n: 1 };
    runs.push(cur);
  }
  return runs;
}
const weekdaysIn = (a, b) => { const r = []; for (let d = a; d <= b; d = addDays(d, 1)) { const w = d.getDay(); if (w >= 1 && w <= 5) r.push(d); } return r; };

// ---------- icons ----------
function icon(n) {
  const p = {
    week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 15h10"/>',
    month: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    leave: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p[n] + '</svg>';
}

// ---------- screens ----------
function weekStart(off) {
  const b = addDays(today(), off * 7);
  return SET.wmode === 'cal' ? addDays(b, -((b.getDay() + 6) % 7)) : b;
}
// Plain refresh symbol (anticlockwise) between the left chevron and the title; shows from two steps away.
const refreshBtn = (off) => (Math.abs(off) > 1 ? '<button class="refresh" data-a="today" aria-label="Jump to today">↺</button>' : '');
function weekTitle(off) { const s = weekStart(off); return lab(s, addDays(s, 6)); }
function weekBody(off) {
  const s = weekStart(off), tk = ymd(today()), DD = shown();
  let h = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i), k = ymd(d), c = DD[k], tod = k === tk ? ' tod' : '';
    const nm = '<div class="n"><b>' + DN[d.getDay()] + '</b>' + d.getDate() + ' ' + MN[d.getMonth()] + '</div>';
    if (!c) h += '<button class="card empty' + tod + '" data-a="day" data-k="' + k + '">' + nm + '<div class="l">–</div></button>';
    else { const t = T[c], sp = swapPaint(k); h += '<button class="card' + tod + (sp ? ' swp' : '') + '" data-a="day" data-k="' + k + '" style="background-color:' + t.bg + ';color:' + t.fg + (sp ? ';--prev:' + sp : '') + '">' + nm + '<div class="r"><div class="l">' + (c === 'M' || c === 'L' ? c : t.n) + '</div>' + (TIMES[c] ? '<div class="tm">' + TIMES[c] + '</div>' : '') + '</div></button>'; }
  }
  return h;
}
function cell(n, k, c) {
  const tod = k === ymd(today()) ? ' tod' : '', t = c ? T[c] : null, sp = t ? swapPaint(k) : null;
  const a = ' data-a="day" data-k="' + k + '" aria-label="' + n + (t ? ', ' + t.n : '') + (sp ? ', swapped' : '') + '"';
  const cls = 'c' + tod + (sp ? ' swp' : ''), pv = sp ? ';--prev:' + sp : '';
  if (!t) return '<button class="' + cls + '"' + a + ' style="background-color:var(--surface2)"><span class="dn">' + n + '</span></button>';
  if (SET.style === 'A') return '<button class="' + cls + '"' + a + ' style="background-color:' + t.bg + ';color:' + t.fg + pv + '"><span>' + n + '</span><b>' + t.sm + '</b></button>';
  if (SET.style === 'B') return '<button class="' + cls + '"' + a + ' style="background-color:var(--surface2)' + pv + '"><span class="dn">' + n + '</span><b class="bd" style="background:' + t.bg + ';color:' + t.fg + '">' + t.sm + '</b></button>';
  return '<button class="' + cls + '"' + a + ' style="background-color:var(--surface2)' + pv + '"><span class="dn">' + n + '</span><span class="dot" style="background:' + t.bg + '"></span></button>';
}
const monthFirst = (mo) => new Date(today().getFullYear(), today().getMonth() + mo, 1);
function monthTitle(mo) { const f = monthFirst(mo); return MF[f.getMonth()] + ' ' + f.getFullYear(); }
// Days only. The frame is always six rows tall; shorter months sit in the middle of it.
function monthBody(mo) {
  const f = monthFirst(mo), y = f.getFullYear(), m = f.getMonth(), dim = new Date(y, m + 1, 0).getDate(), off = (f.getDay() + 6) % 7;
  const DD = shown();
  let h = '<div class="frame"><div class="g">';
  for (let i = 0; i < off; i++) h += '<div></div>';
  for (let n = 1; n <= dim; n++) { const k = y + '-' + p2(m + 1) + '-' + p2(n); h += cell(n, k, DD[k]); }
  return h + '</div></div>';
}
function monthSummary(mo) {
  const f = monthFirst(mo), y = f.getFullYear(), m = f.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  let nm = 0, nl = 0;
  const DD = shown();
  for (let n = 1; n <= dim; n++) { const c = DD[y + '-' + p2(m + 1) + '-' + p2(n)]; if (c === 'M' || c === 'MA') nm++; if (c === 'L' || c === 'LA') nl++; }
  return (nm + nl) ? (nm + nl) + ' shifts · ' + nm + ' M · ' + nl + ' L' : 'No shifts yet';
}
function leaveHtml() {
  const y = leaveYear(), cy = curYear(), isCur = y === cy, c = countYear(y), A = allowFor(y);
  let h = '<div class="hd lhd"><b>Leave</b><button class="yr" data-a="yr" aria-haspopup="true" aria-expanded="' + !!S.ymenu + '">' + y + '</button>';
  if (S.ymenu) { const other = isCur ? cy - 1 : cy; h += '<div class="ymenu"><button data-a="pickyear" data-v="' + other + '">' + other + '</button></div>'; }
  h += '</div>';
  const from = countingFrom(y);
  if (!A || A.allow == null) {
    if (isCur) {
      h += '<div class="kr"><span class="k">Holiday used</span>' + (from != null ? '<span class="note">Counting from ' + MF[from] + '</span>' : '') + '</div><div class="big">' + c.H + ' <span class="k">days</span></div>';
      h += '<div class="note" style="padding:4px 0 8px">Set your allowance in Settings → Leave.</div>';
    } else {
      h += '<div class="k">Holiday</div><div class="big">' + (c.H ? c.H + ' <span class="k">days used</span>' : 'No data') + '</div>';
      if (!c.H) h += '<div class="note" style="margin-top:4px">Rotapp has no leave recorded for ' + y + '.</div>';
    }
  } else {
    const tot = A.allow + A.carry, rem = tot - c.H;
    h += '<div class="kr"><span class="k">Holiday remaining</span>' + (from != null ? '<span class="note">Counting from ' + MF[from] + '</span>' : '') + '</div>';
    h += '<div class="big">' + rem + ' <span class="k">of ' + tot + ' days</span></div>';
    h += '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, Math.round(c.H / (tot || 1) * 100))) + '%"></i></div>';
    h += '<div class="k" style="margin-bottom:8px">' + A.allow + ' + ' + A.carry + ' carried over · ' + c.H + ' used</div>';
  }
  if (SET.showC) {
    const e = cEarned(y), l = e - c.C;
    h += '<div class="cblock"><div class="k">C days left</div><div class="big">' + l + ' <span class="k">of ' + e + ' earned</span></div>';
    h += '<div class="bar"><i style="width:' + (e ? Math.max(0, Math.min(100, Math.round(c.C / e * 100))) : 0) + '%;background:' + T.C.bg + '"></i></div>';
    h += '<div class="k">' + e + ' earned from bank holidays worked · ' + c.C + ' used</div>';
    h += '<button class="rw" data-a="bhsheet" style="margin-top:8px"><span>Bank holidays worked</span><span class="k">' + bhWorked(y).length + ' ›</span></button></div>';
  }
  if (SET.showSick) h += '<div class="rw"><span><i class="sw" style="background:' + T.S.bg + '"></i>Sick</span><b>' + c.S + '</b></div>';
  if (c.X) h += '<div class="rw"><span><i class="sw" style="background:' + T.X.bg + '"></i>Other</span><b>' + c.X + '</b></div>';
  h += '<div class="sec">Booked leave</div>';
  const t0 = today(), runs = leaveRuns(y);
  const isPast = (r) => !isCur || r.e < t0;
  let up = 0, past = 0;
  runs.forEach((r, i) => {
    const p = isPast(r);
    if (p) past++; else up++;
    if (p && !S.showPast) return;
    const label = '<span>' + lab(r.s, r.e) + ' · ' + T[r.t].n + (p ? ' <span class="k">(past)</span>' : '') + '</span><b>' + r.n + (r.n === 1 ? ' day' : ' days') + '</b>';
    h += isCur ? '<button class="rw" data-a="run" data-v="' + i + '">' + label + '</button>' : '<div class="rw ro">' + label + '</div>';
  });
  if (!up) h += '<div class="k" style="padding:8px 0">No upcoming leave</div>';
  if (past) h += '<button class="lnk" data-a="past">' + (S.showPast ? 'Hide past leave' : 'Show past leave') + '</button>';
  if (isCur) h += '<button class="btn" data-a="add">Add leave</button>';
  return h;
}
function addDefaults() { const t = today(); return { type: 'H', start: ymd(t), end: ymd(t), edit: null }; }
function addHtml() {
  const A = S.add, y = curYear(), c = countYear(y), AY = allowFor(y);
  const a = pk(A.start), b = pk(A.end), bad = b < a;
  const days = bad ? [] : weekdaysIn(a, b), n = days.length;
  let repl = 0;
  days.forEach((d) => { if (D[ymd(d)]) repl++; });
  // when editing, the old range is released first, so it does not count as used
  let usedH = c.H;
  if (A.edit && A.edit.t === 'H') usedH -= A.edit.n;
  let h = '<div class="hd"><b>' + (A.edit ? 'Change leave' : 'Add leave') + '</b></div><div class="k">Type</div><div class="atype">' + segHtml('atype', [['H', 'Holiday'], ['S', 'Sick'], ['C', 'C']], A.type) + '</div>';
  h += '<label class="k" for="aStart">Start date</label><input class="fld" id="aStart" type="date" value="' + A.start + '"><label class="k" for="aEnd">End date</label><input class="fld" id="aEnd" type="date" value="' + A.end + '">';
  const f = new Date(a.getFullYear(), a.getMonth(), 1), dim = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate(), off = (f.getDay() + 6) % 7;
  h += '<div class="k" style="margin-top:6px;text-align:center"><b>' + MF[f.getMonth()] + ' ' + f.getFullYear() + '</b></div><div class="g" style="margin-top:4px">';
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((x) => { h += '<div class="w">' + x + '</div>'; });
  for (let i = 0; i < off; i++) h += '<div></div>';
  for (let i = 1; i <= dim; i++) {
    const d = new Date(f.getFullYear(), f.getMonth(), i), w = d.getDay(), inr = !bad && d >= a && d <= b, wk = w === 0 || w === 6;
    let s = '';
    if (inr && !wk) s = 'background:' + T[A.type].bg + ';color:' + T[A.type].fg + ';font-weight:600';
    else if (inr) s = 'border:1px dashed var(--muted)';
    h += '<div class="mc" style="' + s + '">' + i + '</div>';
  }
  h += '</div>';
  if (bad) h += '<div class="smry warn">The end date is before the start date.</div>';
  else {
    h += '<div class="smry"><b>' + n + (n === 1 ? ' day' : ' days') + ' counted</b> (weekends not counted)<br>';
    if (A.type === 'H') {
      if (!AY || AY.allow == null) h += 'Holiday used ' + usedH + ' → ' + (usedH + n) + '<br><span class="k">Set your allowance in Settings → Leave to see what is left.</span>';
      else {
        const rem = AY.allow + AY.carry - usedH;
        h += rem + ' remaining → ' + (rem - n);
        if (rem - n < 0) h += '<br><span class="warn">Over your allowance by ' + (n - rem) + (n - rem === 1 ? ' day' : ' days') + '. You can still save.</span>';
      }
    } else if (A.type === 'C') {
      let l = cLeft(y);
      if (A.edit && A.edit.t === 'C') l += A.edit.n;
      h += 'C left ' + l + ' → ' + (l - n);
      if (l - n < 0) h += '<br><span class="warn">Below zero by ' + (n - l) + (n - l === 1 ? ' day' : ' days') + '. You can still save.</span>';
    } else h += 'Sick days used ' + (c.S) + ' → ' + (c.S + n);
    h += '<br>Replaces ' + repl + ' existing ' + (repl === 1 ? 'day' : 'days') + '</div>';
  }
  h += '<div class="acts"><button data-a="acancel">Cancel</button><button class="p" data-a="asave">Save leave</button></div>';
  return h;
}
const SICON = {
  imp: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  rota: ['#00A36C', '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>'],
  look: ['#8E5CC9', '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>'],
  people: ['#5C6B80', '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'],
  leave: ['#E8A317', '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'],
};
// Person picker sheet: Back to me, then everyone grouped by office, filtered by the search box.
// Person picker: Back to me, then everyone grouped by office, filtered by the search box.
function pickerPage() {
  const pg = makePage({ top: '<div class="pph2"><b>Show rota for</b><button data-a="close">Done</button></div><label class="srch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="ppq" type="search" placeholder="Search names" autocomplete="off" autocorrect="off" spellcheck="false"></label>', scroll: ppListHtml(''), label: 'Show rota for' });
  pg.on = { close: closeSheet, pppick: (el) => { SET.showing = el.dataset.v || null; tidyShowing(); save(); render(); closeSheet(); } };
  const inp = pg.top.querySelector('input');
  inp.addEventListener('input', () => { pg.inner.innerHTML = ppListHtml(inp.value); });
  inp.addEventListener('focus', () => { if (SH.state === 'normal') shExpand(); });   // tapping the search box expands it to tall
  return pg;
}
function ppListHtml(qq) {
  const q = qq.trim().toLowerCase(), cur = viewingOther() ? SET.showing : null;
  let h = '';
  if (!q) h += '<button class="ppme" data-a="pppick" data-v="">Back to me<small>' + (cur ? esc(SET.name) : 'showing now') + '</small></button>';
  let any = false;
  othersIn(TEAM.groups).forEach(([g, ns]) => {
    const f = ns.filter((n) => !q || n.toLowerCase().includes(q)); if (!f.length) return; any = true;
    h += '<div class="ppg">' + esc(g) + '</div>' + f.map((n) => '<button class="ppr' + (n === cur ? ' cur' : '') + '" data-a="pppick" data-v="' + esc(n) + '">' + esc(n) + (n === cur ? '<span class="tk">✓</span>' : '') + '</button>').join('');
  });
  if (!any) h += '<div class="k" style="padding:16px 2px">No one matches "' + esc(qq) + '".</div>';
  return h + '<div style="height:16px"></div>';
}
const shortDate = (k) => { const d = pk(k); return d.getDate() + ' ' + MN[d.getMonth()]; };
function personOptions(selected, withMe) {
  let h = '';
  if (withMe) h += '<option value="">Me (' + esc(SET.name) + ')</option>';
  const groups = withMe ? othersIn(TEAM.groups) : TEAM.groups;
  groups.forEach(([g, ns]) => { h += '<optgroup label="' + esc(g) + '">' + ns.map((n) => '<option' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</optgroup>'; });
  return h;
}
function settingsHtml() {
  const hasTeam = TEAM.groups.length > 0;
  const showingName = viewingOther() ? SET.showing : 'me';
  let h = '<div class="stitle">Settings</div>';
  // Import, with backup tucked behind the arrow
  h += '<div class="xw hero' + xopen(S.card === 'backup') + '"><div class="xi"><div class="herorow">';
  h += '<button class="hmain" data-a="impstart"><span class="hic"><svg viewBox="0 0 24 24">' + SICON.imp + '</svg></span><span><b>Import rota file</b><small>' + (SET.lastImport ? 'Last: ' + esc(SET.lastImport.file) + ' · ' + shortDate(SET.lastImport.at) : 'PDF or xlsx. You check it before anything is saved.') + '</small></span></button>';
  h += '<button class="hchev" data-a="xtog" data-v="backup" aria-expanded="' + (S.card === 'backup') + '" aria-label="Backup options"><span class="chev">▾</span></button></div>';
  h += '<div class="xb"><div class="hinner"><div class="hk">Backup · ' + (SET.lastBackup ? 'last saved ' + shortDate(SET.lastBackup) : 'not saved yet') + '</div><div class="hbtns"><button data-a="export">Export backup</button><button data-a="bkimport">Import backup</button></div><div class="hk" style="margin-top:6px">Saves everything to a file you can keep in Files or iCloud.</div></div></div></div></div>';
  if (!canSave) h += '<div class="wbar">This browser is not letting Rotapp save. Export a backup now and then to be safe.</div>';
  const card = (id, title, sum, body) => '<div class="xw xcard' + xopen(S.card === id) + '"><div class="xi"><button class="ch" data-a="xtog" data-v="' + id + '" aria-expanded="' + (S.card === id) + '"><span class="sic" style="background:' + SICON[id][0] + '"><svg viewBox="0 0 24 24">' + SICON[id][1] + '</svg></span><span class="t"><b>' + title + '</b><small>' + sum + '</small></span><span class="chev">▾</span></button><div class="xb"><div class="inner">' + body + '</div></div></div></div>';
  // Rota
  let rb = '';
  if (hasTeam) {
    rb += '<div class="it"><label for="setShow">Showing</label><span class="ctl"><button class="mebtn" data-a="showme"' + (viewingOther() ? '' : ' disabled') + '>Me</button><select class="sel" id="setShow">' + personOptions(viewingOther() ? SET.showing : '', true) + '</select></span></div>';
    const sw = TEAM.groups.map(([g]) => g).filter((g) => SET.swapGroups.includes(g));
    rb += nestRow('swap', 'Groups in the swap list', sw.length ? esc(sw.join(', ')) : 'No groups', '<div class="k">Groups you can swap with.</div><div class="ticks" style="padding-bottom:10px">' + TEAM.groups.map(([g]) => '<label><input type="checkbox" data-g="' + esc(g) + '"' + (SET.swapGroups.includes(g) ? ' checked' : '') + '> ' + esc(g) + '</label>').join('') + '</div>');
    rb += nestRow('who', "Who's on", whoSummary(), whoSettingsHtml());
  } else rb += '<div class="it col"><span class="k">Import a rota to see your team here.</span></div>';
  rb += '<div class="it"><span>Week view</span>' + segHtml('wmode', [['cal', 'Mon – Sun'], ['roll', 'Next 7 days']], SET.wmode) + '</div>';
  if (hasTeam && latestNames().includes(SET.name)) rb += '<div class="it"><label for="setMe">This is me</label><select class="sel" id="setMe">' + personOptions(SET.name, false) + '</select></div>';
  else rb += '<div class="it"><label for="setName">This is me</label><input class="fld wide" id="setName" type="text" value="' + esc(SET.name) + '" autocomplete="off" autocapitalize="words"></div>';
  rb += '<div class="it col"><span class="k">"This is me" is your row on the rota. Only change it if your name is written differently.</span></div>';
  // People: a summary row at the bottom of the Rota card that opens the list inside the card.
  const pb = peopleHtml();
  if (pb) rb += nestRow('ppl', 'People', pb.sum, pb.body);
  h += card('rota', 'Rota', 'Showing ' + esc(showingName) + ' · ' + (SET.wmode === 'cal' ? 'Mon – Sun' : 'Next 7 days'), rb);

  // Appearance
  const sty = { A: 'Filled', B: 'Badge', C: 'Dot' }, th = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  let ab = '<div class="it"><span>Day style</span>' + segHtml('style', [['A', 'Filled'], ['B', 'Badge'], ['C', 'Dot']], SET.style) + '</div>';
  ab += '<div class="it"><span>Theme</span>' + segHtml('themeset', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], SET.theme) + '</div>';
  h += card('look', 'Appearance', sty[SET.style] + ' · ' + th[SET.theme], ab);
  // Leave: this year's allowance, and which counts show on the Leave tab
  const y = curYear(), A = allowFor(y);
  let lb = '<div class="it"><label for="setAllow">Holiday allowance (' + y + ')</label><input class="fld num" id="setAllow" type="number" inputmode="numeric" min="0" max="99" value="' + (A && A.allow != null ? A.allow : '') + '" placeholder="–"></div>';
  lb += '<div class="it"><label for="setCarry">Carried over <span class="k">(max 2)</span></label><input class="fld num" id="setCarry" type="number" inputmode="numeric" min="0" max="2" value="' + (A ? A.carry : 0) + '"></div>';
  lb += '<div class="it col"><span>Show on the Leave tab</span><div class="lticks"><label><input type="checkbox" data-lt="showC"' + (SET.showC ? ' checked' : '') + '> C</label><label><input type="checkbox" data-lt="showSick"' + (SET.showSick ? ' checked' : '') + '> Sick</label></div></div>';
  lb += '<div class="it col"><span class="k">A new year starts with last year\'s allowance copied in. You can change it here.</span></div>';
  h += card('leave', 'Leave', (A && A.allow != null ? A.allow + ' + ' + A.carry + ' days · ' + y : 'Allowance not set'), lb);
  h += '<div class="foot">Rotapp ' + VERSION + '</div>';
  return '<div class="setwrap">' + h + '</div>';
}
// Everyone you have imported, with Remove. Names not in your latest import show when they were last seen.
function peopleHtml() {
  const groups = othersIn(TEAM.groups);
  if (!groups.length) return '';
  const latest = new Set(TEAM.latest || []);
  let total = 0, old = 0;
  let h = '<div class="k" style="margin-top:6px">Everyone you have imported. Remove anyone you no longer need.</div><div class="plist">';
  groups.forEach(([g, ns]) => {
    h += '<div class="grp">' + esc(g) + '</div>';
    ns.forEach((n) => {
      const seen = TEAM.seen && TEAM.seen[n], isOld = !latest.has(n) && seen;
      total++; if (isOld) old++;
      h += '<div class="prw"><span>' + esc(n) + (isOld ? '<span class="old">last seen ' + MN[+seen.slice(5, 7) - 1] + '</span>' : '') + '</span><button class="rmb" data-a="rmask" data-v="' + esc(n) + '">Remove</button></div>';
    });
  });
  return { sum: total + ' people' + (old ? ' · ' + old + ' not in latest import' : ''), body: h + '</div>' };
}
function removePerson(n) {
  delete TEAM.people[n]; delete NOTES[n];
  TEAM.groups = TEAM.groups.map(([g, ns]) => [g, ns.filter((x) => x !== n)]).filter((g) => g[1].length);
  TEAM.latest = (TEAM.latest || []).filter((x) => x !== n);
  if (!SET.removed.includes(n)) SET.removed.push(n);
  if (SET.showing === n) SET.showing = null;
  save();
}
// A summary row inside the Rota card that opens in place (swap list, Who's on, People).
const xopen = (on) => (on ? ' open' : '');
// A summary row inside the Rota card that opens in place (swap list, Who's on, People).
function nestRow(key, title, sum, body) {
  const o = !!S.nest[key];
  return '<div class="xw row' + xopen(o) + '"><div class="xi"><button class="rh" data-a="xtog" data-v="' + key + '" aria-expanded="' + o + '"><span><span>' + title + '</span><small>' + sum + '</small></span><span class="chev">▾</span></button><div class="xb">' + body + '</div></div></div>';
}
// Who's on settings: offices ticked, with people inside each office that can be unticked. New people show if their office is ticked.
const whoShows = (n, g) => !SET.whoOff.includes(g) && !SET.whoHide.includes(n);
function whoSummary() {
  const gs = othersIn(TEAM.groups); let tot = 0, on = 0;
  gs.forEach(([g, ns]) => ns.forEach((n) => { tot++; if (whoShows(n, g)) on++; }));
  return on === tot ? 'Everyone · ' + tot + ' people' : on + ' of ' + tot + ' people';
}
function whoSettingsHtml() {
  let h = '<div class="k" style="margin:0 0 4px">Who appears in the Who\'s on list in the day editor.</div>';
  othersIn(TEAM.groups).forEach(([g, ns]) => {
    const n = ns.filter((x) => whoShows(x, g)).length, offOn = !SET.whoOff.includes(g), mixed = offOn && n < ns.length, open = S.wOff.has(g);
    h += '<div class="xw orow' + xopen(open) + '"><div class="xi"><div class="wog"><label><input type="checkbox" data-wo="' + esc(g) + '"' + (offOn ? ' checked' : '') + (mixed ? ' data-mixed="1"' : '') + '> ' + esc(g) + '</label><span class="cnt">' + n + ' of ' + ns.length + '</span><button class="woc" data-a="xtog" data-v="wo:' + esc(g) + '" aria-label="People in ' + esc(g) + '" aria-expanded="' + open + '"><span class="chev">▾</span></button></div>';
    h += '<div class="xb"><div class="wpl">' + ns.map((p) => { const on = whoShows(p, g); return '<label class="' + (on ? '' : 'off') + '"><input type="checkbox" data-wp="' + esc(p) + '" data-wg="' + esc(g) + '"' + (on ? ' checked' : '') + '><span>' + esc(p) + '</span></label>'; }).join('') + '</div></div></div></div>';
  });
  return h + '<div style="height:8px"></div>';
}
function whoTickOffice(g, on) {
  const ns = (othersIn(TEAM.groups).find((x) => x[0] === g) || [g, []])[1];
  if (on) { SET.whoOff = SET.whoOff.filter((x) => x !== g); SET.whoHide = SET.whoHide.filter((x) => !ns.includes(x)); }
  else if (!SET.whoOff.includes(g)) SET.whoOff.push(g);
}
function whoTickPerson(p, g, on) {
  const ns = (othersIn(TEAM.groups).find((x) => x[0] === g) || [g, []])[1];
  if (on) {
    if (SET.whoOff.includes(g)) { SET.whoOff = SET.whoOff.filter((x) => x !== g); ns.forEach((n) => { if (n !== p && !SET.whoHide.includes(n)) SET.whoHide.push(n); }); }
    SET.whoHide = SET.whoHide.filter((x) => x !== p);
  } else {
    if (!SET.whoHide.includes(p)) SET.whoHide.push(p);
    if (ns.every((n) => SET.whoHide.includes(n))) { SET.whoHide = SET.whoHide.filter((x) => !ns.includes(x)); whoTickOffice(g, false); }
  }
}
// ---------- Settings cards and rows that open in place: transform and opacity only ----------
// Each section is .xw (clipping window) > .xi (the look) > .xb (the body). The page is laid out once with every
// changing section open; each window then slides to reveal or hide its body and everything below slides with it.
const CARD_MS = 320, CARD_EASE = 'cubic-bezier(.2,.8,.2,1)';
let xjob = null;
function xToggle(btn) {
  if (xjob) xjob.commit();                                 // a tap mid-animation finishes the last one first
  const w = btn.closest('.xw'), id = btn.dataset.v, on = !w.classList.contains('open');
  const changes = [{ w, on }];
  if (w.classList.contains('hero') || w.classList.contains('xcard')) {
    S.card = on ? id : null;                               // one top-level card open at a time
    if (on) document.querySelectorAll('.setwrap>.xw.open').forEach((o) => { if (o !== w) changes.push({ w: o, on: false }); });
  } else if (id.startsWith('wo:')) { if (on) S.wOff.add(id.slice(3)); else S.wOff.delete(id.slice(3)); }
  else S.nest[id] = on;
  changes.forEach((c) => { const b = c.w.querySelector(':scope>.xi [data-a="xtog"]'); if (b) b.setAttribute('aria-expanded', String(c.on)); }); // chevrons turn straight away
  if (reduceMotion()) { changes.forEach((c) => c.w.classList.toggle('open', c.on)); return; }
  slideSections(changes, document.querySelector('.setwrap'), CARD_MS, CARD_EASE, (j) => { xjob = j; }, () => xjob);
}
function slideSections(changes, root, ms, ease, setJob, getJob) {
  changes.forEach((c) => c.w.classList.add('open'));
  const info = changes.map((c) => {
    const full = c.w.getBoundingClientRect().height;
    c.w.classList.remove('open');
    const shut = c.w.getBoundingClientRect().height;
    c.w.classList.add('open');
    const d = full - shut;
    return { w: c.w, on: c.on, a: c.on ? d : 0, b: c.on ? 0 : d };   // hidden amount at the start and the end
  });
  const M = new Map();
  const add = (el, a, b) => { const v = M.get(el) || [0, 0]; v[0] += a; v[1] += b; M.set(el, v); };
  info.forEach((i) => {
    for (let n = i.w; n && n !== root; n = n.parentElement) {
      if (n.classList.contains('xw')) { add(n, -i.a, -i.b); add(n.firstElementChild, i.a, i.b); }   // move the window's bottom edge
      for (let s = n.nextElementSibling; s; s = s.nextElementSibling) if (!s.classList.contains('foot')) add(s, -i.a, -i.b); // slide what's below
    }
  });
  const o = { duration: ms, easing: ease, fill: 'forwards' }, anims = [];
  M.forEach((v, el) => {
    if (Math.abs(v[0]) < 0.5 && Math.abs(v[1]) < 0.5) return;
    anims.push(el.animate([{ transform: tr(v[0]) }, { transform: tr(v[1]) }], o));
  });
  info.forEach((i) => { const b = i.w.querySelector(':scope>.xi>.xb'); if (b) anims.push(b.animate(i.on ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { ...o, duration: i.on ? ms : ms * 0.6 })); });
  const j = { commit() { if (getJob() !== j) return; setJob(null); anims.forEach((a) => a.cancel()); info.forEach((i) => i.w.classList.toggle('open', i.on)); } };
  setJob(j);
  Promise.all(anims.map((a) => a.finished)).then(() => j.commit(), () => {});
}

// ---------- bottom sheets: one motion for every sheet (transform and opacity only) ----------
// pos is how far the sheet is pushed down: 0 = tall (3/4 of the screen), Tc = normal, H = closed.
const SHEET_MS = 450, EASE_SHEET = 'cubic-bezier(.32,.72,0,1)';
const tr = (y) => 'translate3d(0,' + y + 'px,0)', tx = (x) => 'translate3d(' + x + ',0,0)';
const SH = { host: null, H: 0, Tc: 0, pos: 0, state: 'closed', anims: [], after: null, stack: [], expandable: true, peek: 0 };
const shWrap = document.getElementById('sh'), shDim = document.getElementById('shdim'), shSheet = document.getElementById('sheet'), shPages = document.getElementById('pages'), shBar = document.getElementById('shbar');
const curPage = () => SH.stack[SH.stack.length - 1];
const barAt = (t) => Math.max(0, t - SH.Tc);                       // the button bar moves with the sheet only below normal
const dimAt = (t) => Math.max(0, Math.min(1, 1 - (t - SH.Tc) / Math.max(1, SH.H - SH.Tc)));
function shApply(t) { SH.pos = t; shSheet.style.transform = tr(t); shBar.style.transform = tr(barAt(t)); shDim.style.opacity = dimAt(t); }
function makePage({ top = '', scroll = '', bar = [], label = '' }) {
  const el = document.createElement('div');
  el.className = 'spg';
  el.innerHTML = '<div class="stop"><div class="grab"></div>' + top + '</div><div class="sscroll"><div class="sinner">' + scroll + '</div><div class="spad"></div></div>';
  const pg = { el, top: el.querySelector('.stop'), scroll: el.querySelector('.sscroll'), inner: el.querySelector('.sinner'), bar, label, on: {} };
  pg.setTop = (html) => { pg.top.innerHTML = '<div class="grab"></div>' + html; };
  pg.scroll.addEventListener('scroll', () => el.classList.toggle('scrolled', pg.scroll.scrollTop > 2), { passive: true });
  return pg;
}
const barEl = () => (SH.host === 'panel' ? document.getElementById('pbar') : shBar);
function setBar(pg, fade) {
  const b = barEl(); if (!b) return;
  b.innerHTML = pg.bar.map((x) => '<button data-a="' + x[1] + '"' + (x[2] ? ' class="p"' : '') + (x[3] ? ' disabled' : '') + '>' + x[0] + '</button>').join('');
  if (SH.host === 'panel') b.hidden = !pg.bar.length; else b.style.visibility = pg.bar.length ? '' : 'hidden';
  if (fade && !reduceMotion()) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
}
function shMeasure() {
  if (SH.host !== 'sheet' || !curPage()) return;
  const hd = SH.toTitle && document.querySelector('#scr .hd');
  SH.H = hd ? Math.round(window.innerHeight - hd.getBoundingClientRect().bottom - 8) : Math.round(window.innerHeight * 3 / 4);
  shSheet.style.height = SH.H + 'px';
  const pg = curPage(), barH = pg.bar.length ? shBar.offsetHeight : 0;
  SH.stack.forEach((p) => { p.el.querySelector('.spad').style.height = barH + 'px'; });
  SH.Tc = Math.max(0, SH.H - Math.min(SH.H, pg.top.offsetHeight + SH.peek + barH));
}
// Where the sheet is right now, read from the running animation if one is mid-way.
function shStop() {
  if (!SH.anims.length) return;
  const m = new DOMMatrixReadOnly(getComputedStyle(shSheet).transform).m42;
  SH.anims.forEach((a) => a.cancel()); SH.anims = []; SH.after = null;
  shApply(m);
}
// Keyframes for something that bends at Tc (the bar and the dim), so it tracks the sheet exactly.
function bent(from, to, f, prop) {
  const k = [{ offset: 0, [prop]: f(from) }];
  if ((from - SH.Tc) * (to - SH.Tc) < 0) k.push({ offset: (SH.Tc - from) / (to - from), [prop]: f(SH.Tc) });
  k.push({ offset: 1, [prop]: f(to) });
  return k;
}
function shSnap(to, done) {
  shStop();
  const from = SH.pos;
  if (reduceMotion() || Math.abs(from - to) < 0.5) { shApply(to); if (done) done(); return; }
  const o = { duration: SHEET_MS, easing: EASE_SHEET, fill: 'forwards' };
  const list = [shSheet.animate([{ transform: tr(from) }, { transform: tr(to) }], o), shBar.animate(bent(from, to, (t) => tr(barAt(t)), 'transform'), o), shDim.animate(bent(from, to, dimAt, 'opacity'), o)];
  SH.anims = list; SH.after = done;
  Promise.all(list.map((a) => a.finished)).then(() => {
    if (SH.anims !== list) return;
    const cb = SH.after; SH.anims = []; SH.after = null;
    shApply(to); list.forEach((a) => a.cancel());              // land: set the end values and drop the animations together
    if (cb) cb();
  }, () => {});
}
function shSetState(s) {
  SH.state = s; shSheet.classList.toggle('tall', s === 'tall');
  if (s !== 'tall' && curPage()) { curPage().scroll.scrollTop = 0; curPage().el.classList.remove('scrolled'); }
}
// Phones: a bottom sheet. Wide screens: pages marked panel go in the side panel instead.
function openSheet(pg, opts = {}) {
  closeNow();
  SH.expandable = opts.expandable !== false; SH.peek = opts.peek || 0; SH.stack = [pg]; SH.toTitle = !!opts.toTitle;
  if (opts.panel && isWide()) {
    SH.host = 'panel'; SH.state = 'panel';
    const panel = document.getElementById('panel');
    panel.innerHTML = '<button class="lnk pclose" data-a="shclose">Close ✕</button><div id="ppages"></div><div id="pbar" class="pbar"></div>';
    panel.querySelector('#ppages').appendChild(pg.el); panel.classList.add('open');
    setBar(pg);
    return;
  }
  SH.host = 'sheet';
  shPages.innerHTML = ''; shPages.appendChild(pg.el); setBar(pg);
  shSheet.setAttribute('aria-label', pg.label || 'Sheet');
  shWrap.hidden = false; shSetState('normal');
  shMeasure(); shApply(SH.H); shSnap(SH.Tc);
}
function closeNow() {
  if (SH.state === 'closed') return;
  shStop();
  if (SH.host === 'panel') { const p = document.getElementById('panel'); p.classList.remove('open'); p.innerHTML = ''; }
  else { shWrap.hidden = true; shPages.innerHTML = ''; }
  SH.stack = []; SH.state = 'closed'; SH.host = null;
}
function closeSheet() {
  if (SH.state === 'closed' || SH.state === 'closing') return;
  if (SH.host === 'panel') { closeNow(); return; }
  shSetState('closing');
  shSnap(SH.H, () => { shWrap.hidden = true; shPages.innerHTML = ''; SH.stack = []; SH.state = 'closed'; SH.host = null; });
}
const shExpand = () => (SH.expandable ? shSnap(0, () => shSetState('tall')) : shSnap(SH.Tc));
const shShrink = () => { shSetState('normal'); shSnap(SH.Tc); };
const shRefit = () => { shMeasure(); if (SH.state === 'normal') shSnap(SH.Tc); };
// Pages inside a sheet (the swap steps) slide in from the right like iOS navigation; Back slides them out.
function pushPage(pg, opts = {}) {
  const old = curPage(); SH.stack.push(pg);
  (SH.host === 'panel' ? document.getElementById('ppages') : shPages).appendChild(pg.el); setBar(pg, true);
  if (SH.host === 'panel') { old.el.hidden = true; return; }
  shMeasure();
  if (opts.tall && SH.state !== 'tall') shExpand(); else if (SH.state === 'normal') shSnap(SH.Tc);
  if (reduceMotion()) { old.el.hidden = true; return; }
  const o = { duration: SHEET_MS, easing: EASE_SHEET, fill: 'forwards' };
  const a = [pg.el.animate([{ transform: tx('100%') }, { transform: tx('0') }], o), old.el.animate([{ transform: tx('0'), opacity: 1 }, { transform: tx('-30%'), opacity: 0 }], o)];
  Promise.all(a.map((x) => x.finished)).then(() => { old.el.hidden = true; a.forEach((x) => x.cancel()); }, () => {});
}
function popPage() {
  if (SH.stack.length < 2) return;
  const pg = SH.stack.pop(), prev = curPage(); prev.el.hidden = false; setBar(prev, true);
  if (SH.host === 'panel') { pg.el.remove(); return; }
  shMeasure(); if (SH.state === 'normal') shSnap(SH.Tc);
  if (reduceMotion()) { pg.el.remove(); return; }
  const o = { duration: SHEET_MS, easing: EASE_SHEET, fill: 'forwards' };
  const a = [pg.el.animate([{ transform: tx('0') }, { transform: tx('100%') }], o), prev.el.animate([{ transform: tx('-30%'), opacity: 0 }, { transform: tx('0'), opacity: 1 }], o)];
  Promise.all(a.map((x) => x.finished)).then(() => { pg.el.remove(); a.forEach((x) => x.cancel()); }, () => {});
}
// Touch events (not pointer events), so the code can choose between moving the sheet and scrolling the list.
let gs = null;
shSheet.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1 || SH.state === 'closing' || !curPage()) { gs = null; return; }
  const was = SH.anims.length; shStop();                    // touching mid-animation catches the sheet where it is
  const y = e.touches[0].clientY;
  gs = { y0: y, p0: SH.pos, mode: was ? 'drag' : null, s: [{ y, t: e.timeStamp }], handle: y < curPage().scroll.getBoundingClientRect().top };
}, { passive: true });
shSheet.addEventListener('touchmove', (e) => {
  if (!gs) return;
  const y = e.touches[0].clientY, dy = y - gs.y0;
  if (!gs.mode) {
    if (Math.abs(dy) < 4) return;
    // Normal height: any drag moves the sheet. Tall: the fixed top moves it; the list scrolls, except a pull down from its top.
    gs.mode = SH.state !== 'tall' || gs.handle || (curPage().scroll.scrollTop <= 0 && dy > 0) ? 'drag' : 'scroll';
    if (gs.mode === 'drag') { gs.y0 = y; gs.p0 = SH.pos; }
  }
  if (gs.mode !== 'drag') return;
  e.preventDefault();
  let t = gs.p0 + (y - gs.y0);
  const lo = SH.expandable ? 0 : SH.Tc;
  if (t < lo) t = lo + (t - lo) / 4;                         // a little give past fully open
  shApply(Math.min(t, SH.H));
  gs.s.push({ y, t: e.timeStamp }); if (gs.s.length > 8) gs.s.shift();
}, { passive: false });
function shEnd() {
  if (!gs || gs.mode !== 'drag') { gs = null; return; }
  const s = gs.s, last = s[s.length - 1]; let f = s[0];
  for (const q of s) if (last.t - q.t <= 100) { f = q; break; }
  const v = (last.y - f.y) / Math.max(1, last.t - f.t), proj = SH.pos + v * 220;   // where it's heading, from position plus speed
  const targets = (SH.expandable ? [[0, 'tall']] : []).concat([[SH.Tc, 'normal'], [SH.H, 'closed']]);
  const near = targets.sort((a, b) => Math.abs(a[0] - proj) - Math.abs(b[0] - proj))[0][1];
  gs = null;
  if (near === 'closed') closeSheet(); else if (near === 'tall') shExpand(); else shShrink();
}
shSheet.addEventListener('touchend', shEnd);
shSheet.addEventListener('touchcancel', shEnd);
shDim.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
shDim.addEventListener('click', () => closeSheet());
// Mouse and trackpad: scrolling down on the sheet expands it.
shSheet.addEventListener('wheel', (e) => { if (SH.state === 'normal' && SH.expandable && e.deltaY > 0) { e.preventDefault(); shExpand(); } }, { passive: false });

// Sections that open in place inside a sheet (Who's on): the Settings card method, on the sheet's curve.
let sjob = null;
function toggleSection(btn, root) {
  if (sjob) sjob.commit();
  const w = btn.closest('.xw'), on = !w.classList.contains('open');
  btn.setAttribute('aria-expanded', String(on));
  if (reduceMotion()) { w.classList.toggle('open', on); return; }
  slideSections([{ w, on }], root, SHEET_MS, EASE_SHEET, (j) => { sjob = j; }, () => sjob);
}

// ---------- undo a swap or a hand edit ----------
// A swap is undone on every day it touched, for both people; days whose note has gone are left alone.
function undoChange(k) {
  const n = NOTES[ME_KEY] && NOTES[ME_KEY][k];
  if (!n) return;
  if (n.kind === 'swap') {
    const mine = NOTES[ME_KEY], days = Object.keys(mine).filter((x) => mine[x].kind === 'swap' && (x === k || (n.id && mine[x].id === n.id)));
    const p = TEAM.people[n.with], theirs = NOTES[n.with] || {};
    days.forEach((x) => {
      const w = mine[x].was; if (w === 'O' && !D[x]) delete D[x]; else D[x] = w;
      clearNote(ME_KEY, x);
      const t = theirs[x];
      if (p && t && t.kind === 'swap' && (!n.id || t.id === n.id)) { p.d[x] = t.was; clearNote(n.with, x); }
    });
    toast('Swap with ' + firstName(n.with) + ' undone');
  } else { D[k] = n.was; clearNote(ME_KEY, k); toast('Change undone'); }
  save(); render();
}
function askUndo(k) {
  const n = NOTES[ME_KEY] && NOTES[ME_KEY][k]; if (!n) return;
  S.cf = n.kind === 'swap'
    ? { title: 'Undo swap with ' + firstName(n.with) + '?', text: 'You both go back to your original shifts on every day in this swap.', yes: 'Undo swap', k }
    : { title: 'Undo change to ' + longDate(k) + '?', text: 'The day goes back to ' + T[n.was].n + '.', yes: 'Undo', k };
  render();
}

// ---------- day editor ----------
const echip = (c, was) => '<span class="echip' + (was ? ' was' : '') + '" style="background:' + (c === 'O' ? 'var(--offsolid)' : T[c].bg) + ';color:' + (c === 'O' ? 'var(--text2)' : T[c].fg) + '">' + T[c].sm + '</span>';
// Edit line under the date: the old shift crossed out, the new one, and who changed it.
function editLine(k, cur) {
  const n = NOTES[ME_KEY] && NOTES[ME_KEY][k];
  if (!n) return '';
  return '<div class="edl">' + echip(n.was, true) + '<span class="ar">→</span>' + echip(cur || 'O') + '<span>(' + (n.kind === 'swap' ? 'swapped with ' + esc(firstName(n.with || '')) : 'edited by you') + ')</span><button class="undo" data-a="undo">' + (n.kind === 'swap' ? 'Undo swap' : 'Undo') + '</button></div>';
}
function editorPage(k) {
  let pick = null, more = false, warn = '';
  const cur = D[k], d = pk(k), weekend = d.getDay() === 0 || d.getDay() === 6;
  // Same warnings as Add leave when a single day takes Holiday over, or C below zero (you can still save).
  const warnHtml = () => {
    if (!pick || pick === cur || (pick !== 'H' && pick !== 'C')) return '';
    const y = d.getFullYear();
    if (pick === 'H') {
      const A = allowFor(y);
      if (A && A.allow != null) { const rem = A.allow + A.carry - countYear(y).H - 1; if (rem < 0) return '<div class="warn" style="font-size:13px;margin-top:8px">Over your Holiday allowance by ' + (-rem) + (rem === -1 ? ' day' : ' days') + '. You can still save.</div>'; }
      return '';
    }
    const l = cLeft(y) - 1;
    return l < 0 ? '<div class="warn" style="font-size:13px;margin-top:8px">C days below zero by ' + (-l) + (l === -1 ? ' day' : ' days') + '. You can still save.</div>' : '';
  };
  const tile = (x) => (x === 'H' && weekend)
    ? '<button class="tile" data-v="H" disabled style="background:' + T[x].bg + ';color:' + T[x].fg + '">' + T[x].n + '</button>'
    : '<button class="tile' + ((pick || cur) === x ? ' on' : '') + '" data-a="pick" data-v="' + x + '" style="background:' + T[x].bg + ';color:' + T[x].fg + '">' + T[x].n + '</button>';
  const topHtml = () => {
    warn = warnHtml();
    let h = '<div class="eh">' + longDate(k) + ' <small>· ' + (cur ? T[cur].n : 'No shift') + (cur && TIMES[cur] ? ' · ' + TIMES[cur] : '') + '</small></div>' + editLine(k, cur);
    h += '<div class="tiles">' + (more ? COMMON.concat(MORE) : COMMON).map(tile).join('') + '</div>';
    h += '<button class="mrow" data-a="more">' + (more ? 'Fewer types ▴' : 'More types ▾') + '</button><div class="dwarn">' + warn + '</div>';
    const why = swapBlocked(k);
    h += why ? '<button class="swapbtn" disabled>⇄ Swap with someone</button><div class="k" style="text-align:center;margin-top:4px">' + why + '</div>' : '<button class="swapbtn" data-a="swap">⇄ Swap with someone</button>';
    return h;
  };
  const pg = makePage({ top: topHtml(), scroll: whoOnHtml(k), bar: [['Cancel', 'cancel'], ['Done', 'done', 1]], label: 'Day editor' });
  pg.on = {
    cancel: closeSheet,
    done: () => { if (pick && pick !== cur) { markChange(ME_KEY, k, cur, pick, 'edit'); D[k] = pick; save(); render(); } closeSheet(); },
    // The selection outline moves instantly between tiles.
    pick: (el) => {
      pick = el.dataset.v;
      pg.top.querySelectorAll('.tile').forEach((b) => b.classList.toggle('on', b.dataset.v === pick));
      const w = warnHtml(); if (w !== warn) { warn = w; pg.top.querySelector('.dwarn').innerHTML = w; shRefit(); }
    },
    more: () => { more = !more; pg.setTop(topHtml()); shRefit(); },
    swap: () => pushPage(swapWhoPage(k), { tall: true }),
    undo: () => askUndo(k),
    wtog: (el) => toggleSection(el, pg.inner),
  };
  return pg;
}
// Everyone working that day, grouped by shift (yours first and open) then by office.
const WHO_ORDER = ['M', 'MA', 'L', 'LA', 'E'];
function whoOnHtml(k) {
  if (!TEAM.groups.length) return '';
  const mine = D[k], offices = TEAM.groups.map((g) => g[0]), by = {};
  for (const [n, p] of Object.entries(TEAM.people)) {
    const c = p.d[k];
    if (n === SET.name || !WORKED[c] || !whoShows(n, p.g)) continue;
    (by[c] = by[c] || []).push([n, p.g]);
  }
  const order = WORKED[mine] ? [mine, ...WHO_ORDER.filter((x) => x !== mine)] : WHO_ORDER;
  let h = '<div class="woh">Who\'s on · ' + longDate(k) + '</div>', any = false;
  const rank = (n, g) => { const gi = offices.indexOf(g), grp = TEAM.groups[gi]; return [gi < 0 ? 99 : gi, grp ? grp[1].indexOf(n) : 0]; };
  order.forEach((c) => {
    const ps = by[c]; if (!ps) return; any = true;
    ps.sort((a, b) => { const x = rank(a[0], a[1]), y = rank(b[0], b[1]); return x[0] - y[0] || x[1] - y[1]; });
    const open = c === mine;
    h += '<div class="xw wsec' + xopen(open) + '"><div class="xi"><button class="wsh" data-a="wtog" aria-expanded="' + open + '">' + stag(c) + (TIMES[c] ? '<span class="tm">' + TIMES[c] + '</span>' : '') + (c === mine ? '<span class="you">with you</span>' : '') + '<span class="cnt">' + ps.length + (ps.length === 1 ? ' person' : ' people') + '</span><span class="chev">▾</span></button><div class="xb"><div class="wsgb">';
    let last = null;
    ps.forEach(([n, g]) => { if (g !== last) { h += '<div class="wog2">' + esc(g) + '</div>'; last = g; } h += '<div class="wpr">' + esc(n) + stag(c) + '</div>'; });
    h += '</div></div></div></div>';
  });
  if (!any) h += '<div class="k" style="padding:6px 0">No one else is working.</div>';
  return h + '<div style="height:12px"></div>';
}
const stag = (c) => '<span class="stag" style="background:' + T[c].bg + ';color:' + T[c].fg + '">' + T[c].sm + '</span>';
// ---------- swap shifts: one day each side, both people exchange shifts on each day involved ----------
const monthIndex = (k) => { const d = pk(k), t = today(); return (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth(); };
function swapBlocked(k) {
  if (!TEAM.groups.length) return 'Import a rota to swap with someone.';
  const mi = monthIndex(k);
  if (mi !== 0 && mi !== 1) { const t = today(); return 'Swaps are only for ' + MF[t.getMonth()] + ' and ' + MF[(t.getMonth() + 1) % 12] + '.'; }
  if (!D[k]) return 'This day has no shift to swap.';
  return '';
}
const chip = (c) => (c ? '<span class="chip" style="background:' + T[c].bg + ';color:' + T[c].fg + '">' + T[c].sm + '</span>' : '<span class="chip" style="background:var(--surface2);color:var(--muted)">–</span>');
const longDate = (k) => { const d = pk(k); return DN[d.getDay()] + ' ' + d.getDate() + ' ' + MN[d.getMonth()]; };
const firstName = (n) => n.split(' ')[0];
function swapMonth(name, y, m, day, their) {
  const pd = TEAM.people[name].d, f = new Date(y, m, 1), off = (f.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
  let h = '<div class="mh">' + MF[m] + '</div><div class="g">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => '<div class="w">' + x + '</div>').join('');
  for (let i = 0; i < off; i++) h += '<div></div>';
  for (let n = 1; n <= dim; n++) {
    const k = y + '-' + p2(m + 1) + '-' + p2(n), c = pd[k], t = c ? T[c] : null;
    const cls = (their === k ? ' sel' : '') + (day === k ? ' mine' : '');
    h += t ? '<button class="c sm' + cls + '" data-a="sday" data-k="' + k + '" style="background:' + t.bg + ';color:' + t.fg + '"><span>' + n + '</span><b>' + t.sm + '</b></button>'
      : '<button class="c sm' + cls + '" disabled style="background:var(--surface2);color:var(--muted)"><span>' + n + '</span></button>';
  }
  return h + '</div>';
}
function swapWhoPage(k) {
  const mine = D[k], groups = othersIn(TEAM.groups).filter(([g]) => SET.swapGroups.includes(g));
  let s = groups.length ? '' : '<div class="k" style="padding:12px 0">No groups are ticked for swaps. Choose them in Settings → Rota.</div>';
  groups.forEach(([g, ns]) => {
    s += '<div class="grp">' + esc(g) + '</div>';
    ns.forEach((n) => { const c = TEAM.people[n] && TEAM.people[n].d[k]; s += '<button class="prow' + (c === mine ? ' same' : '') + '" data-a="swho" data-v="' + esc(n) + '"><span>' + esc(n) + '</span>' + chip(c) + '</button>'; });
  });
  const pg = makePage({ top: '<div class="stp">Step 1 of 3</div><div class="eh">Swap ' + longDate(k) + '</div><div class="k">You: ' + T[mine].n + '. Pick who you are swapping with. Their shift on ' + shortDate(k) + ' is shown.</div>', scroll: s + '<div style="height:12px"></div>', bar: [['Back', 'back']], label: 'Swap, step 1 of 3' });
  pg.on = { back: popPage, swho: (el) => { if (TEAM.people[el.dataset.v]) pushPage(swapDayPage(k, el.dataset.v)); } };
  return pg;
}
function swapDayPage(k, who) {
  let their = k, more = monthIndex(k) === 1;
  const t = today(), nx = new Date(t.getFullYear(), t.getMonth() + 1, 1), pd = TEAM.people[who].d;
  const selLine = () => 'Selected: <b>' + longDate(their) + '</b> · ' + esc(firstName(who)) + ' on ' + (pd[their] ? T[pd[their]].n : 'no shift');
  const body = () => swapMonth(who, t.getFullYear(), t.getMonth(), k, their) + (more ? swapMonth(who, nx.getFullYear(), nx.getMonth(), k, their) : '') +
    '<button class="mrow" data-a="smore">' + (more ? 'Hide ' + MF[nx.getMonth()] + ' ▴' : 'Show ' + MF[nx.getMonth()] + ' ▾') + '</button><div class="k ssel" style="margin:8px 0 12px">' + selLine() + '</div>';
  const pg = makePage({ top: '<div class="stp">Step 2 of 3</div><div class="eh">Which of ' + esc(firstName(who)) + '\'s days?</div><div class="k">It starts on the same day. Tap a different day to swap across days. Your day has a dashed outline.</div>', scroll: body(), bar: [['Back', 'back'], ['Next', 'next', 1, !pd[their]]], label: 'Swap, step 2 of 3' });
  pg.on = {
    back: popPage,
    // The outline moves instantly to the chosen day.
    sday: (el) => {
      their = el.dataset.k;
      pg.inner.querySelectorAll('.c.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel');
      pg.inner.querySelector('.ssel').innerHTML = selLine();
      pg.bar[1][3] = !pd[their]; const nb = barEl().querySelector('[data-a="next"]'); if (nb) nb.disabled = !pd[their];
    },
    smore: () => { more = !more; pg.inner.innerHTML = body(); },
    next: () => { if (pd[their]) pushPage(swapCheckPage(k, who, their)); },
  };
  return pg;
}
function swapCheckPage(k, who, their) {
  const days = their === k ? [k] : [k, their].sort(), od = TEAM.people[who].d;
  let s = days.map((x) => '<div class="cmp"><div class="d">' + longDate(x) + '</div><div class="r"><span>You</span><span>' + chip(D[x]) + ' → ' + chip(od[x]) + '</span></div><div class="r"><span>' + esc(who) + '</span><span>' + chip(od[x]) + ' → ' + chip(D[x]) + '</span></div></div>').join('');
  if (days.every((x) => D[x] === od[x])) s += '<div class="k" style="margin-top:8px">Nothing would change: you are on the same shift.</div>';
  const pg = makePage({ top: '<div class="stp">Step 3 of 3</div><div class="eh">Check the swap</div><div class="k">You and ' + esc(firstName(who)) + ' exchange shifts on ' + (days.length === 1 ? 'this day' : 'both days') + '.</div>', scroll: s + '<div style="height:12px"></div>', bar: [['Back', 'back'], ['Confirm swap', 'confirm', 1]], label: 'Swap, step 3 of 3' });
  pg.on = { back: popPage, confirm: () => applySwap(k, who, their) };
  return pg;
}
function applySwap(k, who, their) {
  const other = TEAM.people[who].d, days = their === k ? [k] : [k, their], id = Date.now().toString(36);
  days.forEach((x) => {
    const a = D[x], b = other[x];
    markChange(ME_KEY, x, a, b, 'swap', who, id); markChange(who, x, b, a, 'swap', SET.name, id);
    if (b) D[x] = b; else delete D[x];
    if (a) other[x] = a; else delete other[x];
  });
  save(); render(); closeSheet();
  toast('Swapped with ' + who);
}
function bhPage() {
  const y = leaveYear(), ro = y !== curYear();
  const topH = () => { const e = cEarned(y), used = countYear(y).C; return '<div class="eh">C days · ' + y + '</div><div class="k">1 C day for each English bank holiday you work.</div><div class="k" style="margin-top:4px">' + e + ' earned · ' + used + ' used · <b>' + (e - used) + ' left</b></div>'; };
  const body = () => {
    const list = bhWorked(y), adj = cAdjFor(y);
    let h = list.length ? '' : '<div class="k" style="padding:10px 0">No bank holidays worked yet this year.</div>';
    list.forEach((b) => { const d = pk(b.k); h += '<div class="rw"><span>' + d.getDate() + ' ' + MN[d.getMonth()] + ' · ' + b.n + '</span><span>' + chip(b.s) + ' <b>+1</b></span></div>'; });
    return h + '<div class="adj"><span>Adjust total<br><span class="k">If the count is ever wrong</span></span><span class="stepper"><button data-a="cadj" data-v="-1" aria-label="Minus one"' + (ro ? ' disabled' : '') + '>−</button><b>' + (adj > 0 ? '+' : '') + adj + '</b><button data-a="cadj" data-v="1" aria-label="Plus one"' + (ro ? ' disabled' : '') + '>+</button></span></div><div style="height:12px"></div>';
  };
  const pg = makePage({ top: topH(), scroll: body(), bar: [['Close', 'close']], label: 'C days' });
  pg.on = {
    close: closeSheet,
    cadj: (el) => { if (ro) return; SET.cAdj[y] = Math.max(-9, Math.min(9, cAdjFor(y) + +el.dataset.v)); save(); pg.setTop(topH()); pg.inner.innerHTML = body(); render(); },
  };
  return pg;
}
function runPage(r) {
  const pg = makePage({ top: '<div class="eh">' + lab(r.s, r.e) + ' <small>· ' + T[r.t].n + ', ' + r.n + (r.n === 1 ? ' day' : ' days') + '</small></div><div class="acts"><button data-a="runedit">Change dates</button><button data-a="rundel" style="color:var(--danger)">Delete</button></div>', bar: [['Close', 'close']], label: 'Booked leave' });
  pg.on = {
    close: closeSheet,
    // Change dates closes this sheet and pushes Change leave at the same time.
    runedit: () => { closeSheet(); S.add = { type: r.t === 'S' || r.t === 'C' ? r.t : 'H', start: ymd(r.s), end: ymd(r.e), edit: r }; pushScreen(); },
    rundel: () => {
      for (let d = r.s; d <= r.e; d = addDays(d, 1)) { const k = ymd(d); if (D[k] === r.t) { D[k] = 'O'; clearNote(ME_KEY, k); } }
      save(); closeSheet(); toast('Leave deleted');
    },
  };
  return pg;
}

// ---------- import ----------
function miniGridFor(M, name) {
  const f = new Date(M.y, M.m, 1), off = (f.getDay() + 6) % 7, p = M.team.people[name], dim = new Date(M.y, M.m + 1, 0).getDate();
  let h = '<div class="g" style="margin-top:8px">';
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((x) => { h += '<div class="w">' + x + '</div>'; });
  for (let i = 0; i < off; i++) h += '<div></div>';
  for (let n = 1; n <= dim; n++) {
    const c = p && p.d[n], t = c ? T[c] : null;
    h += t ? '<div class="c" style="height:38px;background:' + t.bg + ';color:' + t.fg + '"><span>' + n + '</span><b>' + t.sm + '</b></div>' : '<div class="c" style="height:38px;background:var(--surface2);color:var(--muted)"><span>' + n + '</span></div>';
  }
  return h + '</div>';
}
function miniGrid(M) {
  const f = new Date(M.y, M.m, 1), off = (f.getDay() + 6) % 7;
  let h = '<div class="g" style="margin-top:8px">';
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((x) => { h += '<div class="w">' + x + '</div>'; });
  for (let i = 0; i < off; i++) h += '<div></div>';
  M.days.forEach((d) => {
    const unk = d.code === '?', c = unk ? 'O' : d.code, t = T[c] || T.O;
    const cls = unk ? ' dbt' : (M.chg[d.n] ? ' chg' : '');
    h += '<div class="c' + cls + '" style="height:38px;background:' + t.bg + ';color:' + t.fg + '"><span>' + d.n + '</span><b>' + (unk ? '?' : t.sm) + '</b></div>';
  });
  return h + '</div>';
}
function impInner() {
  const I = S.imp;
  if (!I) return '';
  if (I.step === 'confirm') {
    return '<h3>Use this file?</h3><p class="k" style="word-break:break-all;margin:0">' + esc(I.name) + '</p><div class="acts"><button data-a="impcancel">Cancel</button><button class="p" data-a="impread">Confirm</button></div>';
  }
  if (I.step === 'reading') return '<div class="spin">Reading ' + esc(I.name) + '…</div>';
  if (I.step === 'fail') {
    let h = '<h3>Couldn\'t read that file</h3><div class="wbar">' + esc(I.message) + '</div>';
    if (I.candidates && I.candidates.length) {
      h += '<p class="k" style="margin:8px 0 0">Is one of these you?</p>';
      I.candidates.forEach((c, i) => { h += '<button class="cand" data-a="impcand" data-v="' + i + '">' + esc(c) + '</button>'; });
    }
    h += '<div class="acts"><button data-a="impcancel">Cancel</button><button class="p" data-a="impmanual">Enter it by hand</button></div>';
    return h;
  }
  let h = '<h3>Check the import</h3>';
  h += '<div class="obar">Read ' + esc(I.matched) + '\'s row' + (I.count ? ' and ' + I.count + ' other ' + (I.count === 1 ? 'person' : 'people') : '') + ' from ' + esc(I.name) + '.</div>';
  if (I.groups.length) {
    let o = '<option value="">' + esc(I.matched) + ' (me)</option>';
    I.groups.forEach(([g, ns]) => { o += '<optgroup label="' + esc(g) + '">' + ns.map((n) => '<option' + (n === I.showing ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</optgroup>'; });
    h += '<div class="vrow"><label class="k" for="impShow">Showing</label><select class="sel" id="impShow">' + o + '</select></div>';
  }
  const other = I.showing;
  (I.warnings || []).forEach((w) => { h += '<div class="wbar">' + esc(w) + '</div>'; });
  const multi = I.months.length > 1;
  I.months.forEach((M, mi) => {
    h += '<div class="pm">';
    h += multi ? '<label><input type="checkbox" data-a="imptick" data-v="' + mi + '"' + (M.on ? ' checked' : '') + '> ' + MF[M.m] + ' ' + M.y + '</label>' : '<b>' + MF[M.m] + ' ' + M.y + '</b>';
    if (other) { h += (M.team.people[other] ? miniGridFor(M, other) : '<div class="k" style="margin-top:6px">' + esc(other) + ' isn\'t on this month\'s rota.</div>') + '</div>'; return; }
    h += '<div class="k" style="margin-top:4px">Read ' + M.days.length + ' days' + (M.blanks.length ? ' · ' + M.blanks.length + ' blank ' + (M.blanks.length === 1 ? 'day' : 'days') + ' treated as Off' : '') + '</div>';
    if (M.doubt) h += '<div class="wbar">' + M.doubt + (M.doubt === 1 ? ' day needs' : ' days need') + ' a look: code not recognised, shown as Off with a dashed outline.</div>';
    M.warnings.forEach((w) => { h += '<div class="wbar">' + esc(w) + '</div>'; });
    if (M.exists) {
      const nl = M.list.filter((x) => LEAVE[x.o]).length;
      h += '<div class="wbar"><b>' + MF[M.m] + ' already has data. Replace it?</b><br>' + (M.list.length ? M.list.length + (M.list.length === 1 ? ' day' : ' days') + ' will change' + (nl ? ', including ' + nl + ' leave ' + (nl === 1 ? 'day' : 'days') : '') : 'No days will change') + '.</div>';
    }
    h += miniGrid(M);
    if (M.exists && M.list.length) {
      h += '<button class="lnk" data-a="implist" data-v="' + mi + '">' + (M.open ? 'Hide all changes' : 'See all changes') + '</button>';
      if (M.open) M.list.forEach((x) => {
        const dd = new Date(M.y, M.m, x.n);
        h += '<div class="cl' + (LEAVE[x.o] ? ' ls' : '') + '"><span>' + DN[dd.getDay()] + ' ' + dd.getDate() + ' ' + MN[M.m] + '</span><span>' + T[x.o].n + ' → ' + T[x.nw].n + '</span></div>';
      });
    }
    h += '</div>';
  });
  if (I.groups.length) {
    const total = I.groups.reduce((a, g) => a + g[1].length, 0), skipped = I.groups.reduce((a, g) => a + g[1].filter((n) => I.skip.has(n)).length, 0);
    h += '<div class="pm' + (I.pOpen ? ' open' : '') + '"><button class="ph" data-a="imppeople"><span><b>People</b><br><span class="k">Importing ' + (total - skipped) + ' of ' + total + (skipped ? ' · ' + skipped + ' skipped' : '') + '</span></span><span class="chev">▾</span></button>';
    if (I.pOpen) {
      I.groups.forEach(([g, ns], gi) => {
        const cnt = ns.filter((n) => !I.skip.has(n)).length;
        h += '<label class="igrp"><input type="checkbox" data-ig="' + gi + '"' + (cnt === ns.length ? ' checked' : '') + (cnt && cnt < ns.length ? ' data-mixed="1"' : '') + '> ' + esc(g) + '<span class="cnt">' + cnt + ' of ' + ns.length + '</span></label>';
        if (gi === 0 && I.meGroup === g) h += '<div class="ipr me"><span class="lock">🔒</span><span>' + esc(I.matched) + ' <span class="k">(me)</span></span><span class="tag">always imported</span></div>';
        ns.forEach((n) => {
          const tag = SET.removed.includes(n) ? '<span class="tag">removed earlier</span>' : !TEAM.people[n] ? '<span class="tag new">new</span>' : '';
          h += '<label class="ipr' + (I.skip.has(n) ? ' off' : '') + '"><input type="checkbox" data-ip="' + esc(n) + '"' + (I.skip.has(n) ? '' : ' checked') + '><span class="nm">' + esc(n) + '</span>' + tag + '</label>';
        });
      });
    }
    h += '</div>';
  }
  const anyExists = I.months.some((M) => M.on && M.exists);
  h += '<div class="acts"><button data-a="impcancel">Cancel</button><button class="p" data-a="impdone">' + (anyExists ? 'Add and replace' : 'Add to Rotapp') + '</button></div>';
  return h;
}
// Office groups across the months of one import, latest month's order first; you are left out.
function mergeGroups(months) {
  const out = [];
  [...months].reverse().forEach((M) => M.team.groups.forEach(([g, ns]) => {
    let row = out.find((x) => x[0] === g); if (!row) { row = [g, []]; out.push(row); }
    ns.forEach((n) => { if (!M.team.people[n].me && !row[1].includes(n)) row[1].push(n); });
  }));
  return out.filter((g) => g[1].length);
}
function buildPreview(res, I) {
  const months = res.months.map((m) => {
    const exists = hasMonth(m.year, m.month), list = [], chg = {};
    m.days.forEach((d) => {
      const nw = d.code === '?' ? 'O' : d.code;
      if (exists) {
        const old = D[monthKey(m.year, m.month) + p2(d.n)];
        if (old !== nw) { list.push({ n: d.n, o: old || 'O', nw }); chg[d.n] = true; }
      }
    });
    return { y: m.year, m: m.month, days: m.days, blanks: m.blanks, doubt: m.unknown.length, warnings: m.warnings || [], exists, list, chg, open: false, on: true, team: m.team || { groups: [], people: {} } };
  });
  const groups = mergeGroups(months), count = groups.reduce((a, g) => a + g[1].length, 0);
  // Skipped and removed people start unticked; new people start ticked.
  const skip = new Set(groups.flatMap((g) => g[1]).filter((n) => SET.skipped.includes(n) || SET.removed.includes(n)));
  const meP = months.map((M) => Object.values(M.team.people).find((p) => p.me)).find(Boolean);
  if (meP) { const gi = groups.findIndex((g) => g[0] === meP.g); if (gi > 0) groups.unshift(groups.splice(gi, 1)[0]); }
  S.imp = { step: 'preview', name: I.name, bytes: I.bytes, matched: res.months[0].matched, warnings: res.warnings || [], months, groups, count, showing: '', skip, pOpen: false, meGroup: meP ? meP.g : null };
}
async function ensureJSZip() {
  if (window.JSZip) return;
  await new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = './vendor/jszip.min.js';
    s.onload = ok; s.onerror = () => no(new Error('jszip'));
    document.head.appendChild(s);
  });
}
async function readFile() {
  const I = S.imp;
  I.step = 'reading'; render();
  const head = new Uint8Array(I.bytes.slice(0, 4));
  let res;
  try {
    const opts = { name: SET.name, today: new Date() };
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
      const pdfjs = await import('./vendor/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
      res = await readRotaPdf(pdfjs, I.bytes.slice(0), opts);
    } else if (head[0] === 0x50 && head[1] === 0x4b) {
      await ensureJSZip();
      res = await readRotaXlsx(window.JSZip, I.bytes.slice(0), opts);
    } else {
      res = { status: 'fail', message: 'Rotapp reads PDF and xlsx files. That looks like something else.', months: [] };
    }
  } catch (err) {
    res = { status: 'fail', message: "Something went wrong while reading that file. Try again, or enter the month by hand.", months: [] };
  }
  if (!S.imp || S.imp !== I) return;
  if (res.status === 'ok' && res.months.length) buildPreview(res, I);
  else S.imp = { step: 'fail', name: I.name, bytes: I.bytes, message: res.message || "Rotapp couldn't read that file.", candidates: res.candidates || [] };
  render();
}
function applyImport() {
  const I = S.imp, on = I.months.filter((M) => M.on);
  if (!on.length) { toast('Tick at least one month'); return; }
  let replaced = 0, added = 0;
  on.forEach((M) => {
    const pre = monthKey(M.y, M.m);
    Object.keys(D).forEach((k) => { if (k.startsWith(pre)) delete D[k]; });
    clearMonthNotes(ME_KEY, pre);
    M.days.forEach((d) => { D[pre + p2(d.n)] = d.code === '?' ? 'O' : d.code; });
    if (M.exists) replaced++; else added++;
    // Everyone else: replace their month too.
    for (const [name, p] of Object.entries(M.team.people)) {
      if (p.me || I.skip.has(name)) continue;
      const seen = M.y + '-' + p2(M.m + 1);
      if (!TEAM.seen[name] || TEAM.seen[name] < seen) TEAM.seen[name] = seen;
      const tp = TEAM.people[name] || (TEAM.people[name] = { g: p.g, d: {} });
      tp.g = p.g;
      Object.keys(tp.d).forEach((k) => { if (k.startsWith(pre)) delete tp.d[k]; });
      clearMonthNotes(name, pre);
      for (const [n, c] of Object.entries(p.d)) tp.d[pre + p2(+n)] = c;
    }
  });
  // The people list keeps everyone ever imported (until removed); this import's order comes first.
  const meGroup = on.map((M) => Object.values(M.team.people).find((p) => p.me)).find(Boolean);
  const fresh = mergeGroups(on).map(([g, ns]) => [g, ns.filter((n) => !I.skip.has(n))]);
  if (meGroup) {
    let g = fresh.find((x) => x[0] === meGroup.g); if (!g) { g = [meGroup.g, []]; fresh.unshift(g); }
    const ref = on[on.length - 1].team.groups.find((x) => x[0] === meGroup.g), order = ref ? ref[1] : [];
    if (!g[1].includes(SET.name)) { g[1].push(SET.name); g[1].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)); }
  }
  TEAM.latest = fresh.flatMap((g) => g[1]);
  for (const [g, ns] of TEAM.groups) {
    let row = fresh.find((x) => x[0] === g); if (!row) { row = [g, []]; fresh.push(row); }
    ns.forEach((n) => { if (TEAM.people[n] && !fresh.some((x) => x[1].includes(n))) row[1].push(n); });
  }
  TEAM.groups = fresh.filter((g) => g[1].length);
  // Remember who was skipped; anyone imported again is no longer "removed".
  const inFile = new Set(I.groups.flatMap((g) => g[1]));
  SET.skipped = [...SET.skipped.filter((n) => !inFile.has(n)), ...I.skip];
  SET.removed = SET.removed.filter((n) => !(inFile.has(n) && !I.skip.has(n)));
  SET.lastImport = { file: I.name, at: ymd(today()) };
  tidyShowing();
  save();
  const first = on[0];
  S.imp = null;
  S.tab = 'month';
  const t = today();
  S.moff = (first.y - t.getFullYear()) * 12 + (first.m - t.getMonth());
  toast(on.length === 1 ? MF[first.m] + (first.exists ? ' replaced' : ' added') : on.length + ' months imported');
}

// ---------- backup ----------
function exportBackup() {
  try {
    SET.lastBackup = ymd(today()); save();
    const blob = new Blob([JSON.stringify({ app: 'Rotapp', version: 2, days: D, set: SET, team: TEAM, notes: NOTES })], { type: 'application/json' });
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = 'rotapp-backup-' + ymd(today()) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Backup exported');
  } catch (err) { toast("Couldn't export the backup"); }
}
function restoreBackup(text) {
  try {
    const d = JSON.parse(text);
    if (!d || d.app !== 'Rotapp' || typeof d.days !== 'object' || d.days === null) throw new Error('bad');
    const days = {};
    for (const [k, v] of Object.entries(d.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && T[v]) days[k] = v;
    D = days;
    if (d.set && typeof d.set === 'object') {
      const s = d.set;
      if (typeof s.name === 'string') SET.name = s.name;
      SET.allow = typeof s.allow === 'number' ? s.allow : null;
      SET.carry = typeof s.carry === 'number' ? Math.min(2, Math.max(0, s.carry)) : 0;
      SET.years = {};
      if (s.years && typeof s.years === 'object') for (const [yy, v] of Object.entries(s.years)) if (/^\d{4}$/.test(yy) && v && typeof v === 'object') SET.years[yy] = { allow: typeof v.allow === 'number' ? v.allow : null, carry: typeof v.carry === 'number' ? Math.min(2, Math.max(0, v.carry)) : 0 };
      if (SET.allow != null && !SET.years[curYear()]) SET.years[curYear()] = { allow: SET.allow, carry: SET.carry };
      SET.showC = s.showC !== false; SET.showSick = s.showSick !== false;
      SET.cAdj = {}; if (s.cAdj && typeof s.cAdj === 'object') for (const [yy, v] of Object.entries(s.cAdj)) if (/^\d{4}$/.test(yy) && typeof v === 'number') SET.cAdj[yy] = Math.max(-9, Math.min(9, v));
      SET.removed = Array.isArray(s.removed) ? s.removed.map(String) : [];
      SET.skipped = Array.isArray(s.skipped) ? s.skipped.map(String) : [];
      SET.whoOff = Array.isArray(s.whoOff) ? s.whoOff.map(String) : [];
      SET.whoHide = Array.isArray(s.whoHide) ? s.whoHide.map(String) : [];
      if (['A', 'B', 'C'].includes(s.style)) SET.style = s.style;
      if (['auto', 'light', 'dark'].includes(s.theme)) SET.theme = s.theme;
      if (['cal', 'roll'].includes(s.wmode)) SET.wmode = s.wmode;
      if (Array.isArray(s.swapGroups)) SET.swapGroups = s.swapGroups.filter((g) => typeof g === 'string');
      SET.showing = typeof s.showing === 'string' ? s.showing : null;
      if (s.lastImport && typeof s.lastImport.file === 'string') SET.lastImport = s.lastImport;
      if (typeof s.lastBackup === 'string') SET.lastBackup = s.lastBackup;
    }
    NOTES = cleanNotes(d.notes);
    TEAM = { people: {}, groups: [], latest: [], seen: {} };
    if (d.team && typeof d.team.people === 'object' && d.team.people) {
      for (const [n, p] of Object.entries(d.team.people)) {
        if (!p || typeof p.d !== 'object') continue;
        const dd = {}; for (const [k, v] of Object.entries(p.d)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && T[v]) dd[k] = v;
        TEAM.people[n] = { g: String(p.g || 'Other'), d: dd };
      }
      if (Array.isArray(d.team.groups)) TEAM.groups = d.team.groups.filter((g) => Array.isArray(g) && Array.isArray(g[1])).map((g) => [String(g[0]), g[1].map(String)]);
      TEAM.latest = Array.isArray(d.team.latest) ? d.team.latest.map(String) : latestFromGroups(TEAM.groups);
      if (d.team.seen && typeof d.team.seen === 'object') for (const [n, v] of Object.entries(d.team.seen)) if (/^\d{4}-\d{2}$/.test(v)) TEAM.seen[n] = v;
    }
    tidyShowing();
    save();
    toast('Backup restored');
  } catch (err) { toast("That isn't a Rotapp backup"); }
}

// ---------- Week and Month: fixed header, only the days slide ----------
const PAGED = {
  week: { title: weekTitle, body: weekBody, off: () => S.woff, set: (v) => { S.woff = v; } },
  month: { title: monthTitle, body: monthBody, off: () => S.moff, set: (v) => { S.moff = v; } },
};
function pagedHtml(kind) {
  const P = PAGED[kind], o = P.off();
  let h = '<div class="hd"><span class="side"><button class="arr" data-a="prev" aria-label="Previous ' + kind + '">‹</button>' + refreshBtn(o) + '</span>';
  h += '<div class="reel" aria-live="polite">' + [-1, 0, 1].map((s) => '<span class="rt"' + (s ? ' aria-hidden="true"' : '') + ' data-s="' + s + '">' + P.title(o + s) + '</span>').join('') + '</div>';
  h += '<span class="side r"><button class="arr" data-a="next" aria-label="Next ' + kind + '">›</button></span></div>';
  if (TEAM.groups.length) {
    const o = viewingOther();
    h += '<div class="pchip"><span class="pc' + (o ? '' : ' me') + '"><button class="nm" data-a="ppopen" aria-label="Choose whose rota to show">' + (o ? '<span class="who1">' + esc(SET.showing) + '</span><small>· view only</small>' : 'Me') + '<span class="cv">▾</span></button>' + (o ? '<button class="x" data-a="showme" aria-label="Back to me">✕</button>' : '') + '</span></div>';
  }
  if (kind === 'week') h += '<div class="mid">' + segHtml('wmode', [['cal', 'Mon – Sun'], ['roll', 'Next 7 days']], SET.wmode) + '</div>';
  else h += '<div class="g wd">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => '<div class="w">' + x + '</div>').join('') + '</div>';
  h += '<div class="swv"><div class="trk">' + [o - 1, o, o + 1].map((x) => '<div class="pg"' + (x === o ? '' : ' aria-hidden="true" inert') + '>' + P.body(x) + '</div>').join('') + '</div></div>';
  if (kind === 'month') {
    if (SET.style === 'C') { h += '<div class="lgd">'; COMMON.forEach((x) => { h += '<span><i style="background:' + T[x].bg + '"></i>' + T[x].n + '</span>'; }); h += '</div>'; }
    h += '<div class="sum">' + monthSummary(o) + '</div>';
  }
  return h;
}

// ---------- render ----------
// Re-entrant calls (a focused field losing focus mid-render fires "change") are run straight after instead.
let rendering = false;
function render() {
  if (rendering) { queueMicrotask(render); return; }
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
}
function renderNow() {
  const t = S.tab, scr = document.getElementById('scr'), main = document.getElementById('main'), top = main.scrollTop;
  document.documentElement.setAttribute('data-theme', SET.theme);
  const mt = document.querySelector('meta[name=theme-color]'); if (mt) mt.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#131416';
  scr.innerHTML = t === 'week' || t === 'month' ? pagedHtml(t) : t === 'leave' ? leaveHtml() : settingsHtml();
  bindTrack();
  main.classList.toggle('grouped', t === 'settings');
  main.scrollTop = top;
  if (PUSH.on && S.add) { const push = document.getElementById('push'), st = push.scrollTop; push.querySelector('.pscr').innerHTML = addHtml(); push.scrollTop = st; }
  modalSync();
  markMixed(document);
  let tb = isWide() ? '<div class="brand">Rotapp</div>' : '';
  [['week', 'Week'], ['month', 'Month'], ['leave', 'Leave'], ['settings', 'Settings']].forEach((x) => {
    const on = t === x[0];
    tb += '<button class="tab' + (on ? ' on' : '') + '" data-a="tab" data-v="' + x[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + icon(x[0]) + x[1] + '</button>';
  });
  document.getElementById('nav').innerHTML = tb;
}
// ---------- toasts: drop in from the top, then fade away ----------
let toastT = 0, toastA = null;
function toast(msg) {
  render();
  const t = document.getElementById('toast');
  t.textContent = msg;
  if (toastA) toastA.cancel();
  clearTimeout(toastT);
  if (reduceMotion()) { t.style.opacity = 1; t.style.transform = 'translate3d(-50%,0,0)'; toastT = setTimeout(() => { t.style.opacity = 0; }, 1800); return; }
  t.style.opacity = ''; t.style.transform = '';
  toastA = t.animate([{ opacity: 0, transform: 'translate3d(-50%,-24px,0)' }, { opacity: 1, transform: 'translate3d(-50%,0,0)' }], { duration: 320, easing: EASE_SHEET, fill: 'forwards' });
  toastT = setTimeout(() => { toastA = t.animate([{ opacity: 1, transform: 'translate3d(-50%,0,0)' }, { opacity: 0, transform: 'translate3d(-50%,-12px,0)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }); }, 1800);
}
// ---------- segmented controls: the highlight slides; labels switch at once ----------
function segHtml(act, opts, val) {
  const i = Math.max(0, opts.findIndex((o) => o[0] === val));
  return '<span class="seg2"><span class="thumb" style="width:calc((100% - 4px) / ' + opts.length + ');transform:translate3d(' + i * 100 + '%,0,0)"></span>' +
    opts.map((o) => '<button data-a="seg" data-act="' + act + '" data-v="' + o[0] + '" class="' + (o[0] === val ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</span>';
}
const SEGACT = {
  wmode: (v) => { SET.wmode = v; S.woff = 0; save(); },
  style: (v) => { SET.style = v; save(); },
  themeset: (v) => { SET.theme = v; save(); },
  atype: (v) => { if (S.add) S.add.type = v; },
};
let segTimer = 0;
function segTap(btn) {
  if (btn.classList.contains('on')) return;
  const seg = btn.closest('.seg2'), btns = [...seg.querySelectorAll('button')], i = btns.indexOf(btn), th = seg.querySelector('.thumb');
  const from = new DOMMatrixReadOnly(getComputedStyle(th).transform).m41, to = i * th.offsetWidth;
  th.getAnimations().forEach((a) => a.cancel());
  th.style.transform = 'translate3d(' + to + 'px,0,0)';
  btns.forEach((b) => b.classList.toggle('on', b === btn));
  const apply = () => { SEGACT[btn.dataset.act](btn.dataset.v); render(); };   // the screen updates once the highlight lands
  clearTimeout(segTimer);
  if (reduceMotion()) { apply(); return; }
  th.animate([{ transform: 'translate3d(' + from + 'px,0,0)' }, { transform: 'translate3d(' + to + 'px,0,0)' }], { duration: 300, easing: EASE_SHEET });
  segTimer = setTimeout(apply, 300);
}
// ---------- Add leave and Change leave slide in over the Leave tab ----------
const PUSH = { on: false, anims: [] };
const pushEls = () => [document.getElementById('push'), document.getElementById('main'), document.getElementById('pshade')];
function pushCancel() { pushEls().forEach((el) => el.getAnimations().forEach((a) => a.cancel())); PUSH.anims = []; }
function pushScreen() {
  const [push, main, shade] = pushEls();
  pushCancel();
  push.innerHTML = '<div class="pscr">' + addHtml() + '</div>'; push.scrollTop = 0;
  push.hidden = false; shade.hidden = false; PUSH.on = true;
  if (reduceMotion()) { shade.style.opacity = 0; return; }
  shade.style.opacity = '';
  const o = { duration: SHEET_MS, easing: EASE_SHEET };
  PUSH.anims = [push.animate([{ transform: tx('100%') }, { transform: tx('0') }], o), main.animate([{ transform: tx('0') }, { transform: tx('-30%') }], { ...o, fill: 'forwards' }), shade.animate([{ opacity: 0 }, { opacity: 0.25 }], { ...o, fill: 'forwards' })];
}
function pushEnd() { const [push, , shade] = pushEls(); pushCancel(); push.hidden = true; shade.hidden = true; push.innerHTML = ''; }
function popScreen() {
  if (!PUSH.on) return;
  PUSH.on = false;
  const [push, main, shade] = pushEls();
  pushCancel();
  if (reduceMotion()) { pushEnd(); return; }
  const o = { duration: SHEET_MS, easing: EASE_SHEET, fill: 'forwards' };
  const a = [push.animate([{ transform: tx('0') }, { transform: tx('100%') }], o), main.animate([{ transform: tx('-30%') }, { transform: tx('0') }], o), shade.animate([{ opacity: 0.25 }, { opacity: 0 }], o)];
  PUSH.anims = a;
  Promise.all(a.map((x) => x.finished)).then(() => { if (PUSH.anims === a && !PUSH.on) pushEnd(); }, () => {});
}
function pushInstant() { PUSH.on = false; pushEnd(); }
// ---------- pop-ups (import, remove someone): fade in with a slight scale-up ----------
const MO = { key: null, closing: false, dipping: false, pending: null };
const moWrap = document.getElementById('mo'), moDim = document.getElementById('modim'), moBox = document.getElementById('modal');
const moCancel = () => { moBox.getAnimations().forEach((a) => a.cancel()); moDim.getAnimations().forEach((a) => a.cancel()); };
function rmInner() { return '<h3>Remove ' + esc(S.rm) + '?</h3><div class="k">They disappear from Showing and the swap list, and their saved shifts are deleted. If they appear in a future import, they come back.</div><div class="acts"><button data-a="rmno">Cancel</button><button class="d" data-a="rmyes">Remove</button></div>'; }
function modalSync() {
  const key = S.imp ? 'imp:' + S.imp.step : S.rm ? 'rm' : S.cf ? 'cf' : null;
  if (!key) { if (MO.key) modalClose(); MO.key = null; return; }
  const html = S.imp ? impInner() : S.rm ? rmInner() : '<h3>' + esc(S.cf.title) + '</h3><div class="k">' + esc(S.cf.text) + '</div><div class="acts"><button data-a="cfno">Cancel</button><button class="p" data-a="cfyes">' + esc(S.cf.yes) + '</button></div>';
  moDim.dataset.a = S.imp ? 'impcancel' : S.rm ? 'rmno' : 'cfno';
  if (!MO.key || MO.closing) {
    moCancel(); MO.closing = false; MO.dipping = false;
    moBox.className = S.imp ? '' : 'conf'; moBox.innerHTML = html; moWrap.hidden = false; moBox.scrollTop = 0;
    if (!reduceMotion()) {
      moDim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
      moBox.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, easing: EASE_SHEET });
    }
  } else if (MO.key !== key) {
    // Next step: the whole box dips out and back in, so its size change is never seen.
    MO.pending = html;
    if (reduceMotion()) { moBox.innerHTML = html; moBox.scrollTop = 0; }
    else if (!MO.dipping) {
      MO.dipping = true; moCancel();
      const out = moBox.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 120, easing: 'ease-in', fill: 'forwards' });
      out.finished.then(() => {
        if (!MO.dipping) return;
        MO.dipping = false; moBox.innerHTML = MO.pending; moBox.scrollTop = 0; markMixed(moBox);
        moBox.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 220, easing: EASE_SHEET });
        out.cancel();
      }, () => {});
    }
  } else if (MO.dipping) MO.pending = html;
  else { const st = moBox.scrollTop; moBox.innerHTML = html; moBox.scrollTop = st; }
  MO.key = key;
}
function modalClose() {
  MO.dipping = false; MO.closing = true; moCancel();
  const end = () => { if (!MO.closing) return; MO.closing = false; moWrap.hidden = true; moBox.innerHTML = ''; moCancel(); };
  if (reduceMotion()) { end(); return; }
  const a = [moBox.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }), moDim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' })];
  Promise.all(a.map((x) => x.finished)).then(end, () => {});
}
const markMixed = (root) => root.querySelectorAll('[data-mixed]').forEach((x) => { x.indeterminate = true; });

// ---------- events ----------
document.addEventListener('click', (e) => {
  if (swallowClick) return;
  const el = e.target.closest('[data-a]');
  if (S.ymenu && (!el || (el.dataset.a !== 'yr' && el.dataset.a !== 'pickyear'))) { S.ymenu = false; render(); if (!el) return; }
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v, k = el.dataset.k;
  // Buttons in a sheet (or the side panel) belong to the page that is showing.
  if (el.closest('#sh, #panel')) { if (a === 'shclose') closeSheet(); else { const f = curPage() && curPage().on[a]; if (f) f(el); } return; }
  if (a === 'seg') { segTap(el); return; }
  if (a === 'xtog') { xToggle(el); return; }
  if (a === 'tab') { closeNow(); pushInstant(); S.rm = null; S.cf = null; S.tab = v; S.imp = null; S.add = null; S.lyear = null; S.ymenu = false; S.showPast = false; }
  else if (a === 'yr') S.ymenu = !S.ymenu;
  else if (a === 'pickyear') { S.lyear = +v === curYear() ? null : +v; S.ymenu = false; S.showPast = false; }
  else if (a === 'showme') { SET.showing = null; save(); }
  else if (a === 'ppopen') { openSheet(pickerPage(), { peek: 260 }); return; }
  else if (a === 'bhsheet') { openSheet(bhPage(), { peek: 220 }); return; }
  else if (a === 'rmask') S.rm = v;
  else if (a === 'rmno') S.rm = null;
  else if (a === 'cfno') S.cf = null;
  else if (a === 'cfyes') { const k2 = S.cf.k; S.cf = null; closeSheet(); undoChange(k2); return; }
  else if (a === 'rmyes') { const n = S.rm; S.rm = null; removePerson(n); toast(n + ' removed'); return; }
  else if (a === 'imppeople') S.imp.pOpen = !S.imp.pOpen;
  else if (a === 'gosettings') S.tab = 'settings';
  else if (a === 'prev') { interrupt(); animateTo(-1); return; }
  else if (a === 'next') { interrupt(); animateTo(1); return; }
  else if (a === 'today') { interrupt(); const o = PAGED[S.tab].off(); if (o) animateTo(o > 0 ? -1 : 1, 0); return; }
  else if (a === 'day') { if (viewingOther()) return; openSheet(editorPage(k), { panel: true, expandable: TEAM.groups.length > 0, toTitle: true }); return; }
  else if (a === 'past') S.showPast = !S.showPast;
  else if (a === 'add') { S.add = addDefaults(); pushScreen(); return; }
  else if (a === 'acancel') { popScreen(); S.add = null; }
  else if (a === 'asave') {
    const A = S.add, s = pk(A.start), en = pk(A.end);
    if (en < s) { render(); return; }
    // Leave gets no note, and clears any note on the days it writes.
    if (A.edit) for (let d = A.edit.s; d <= A.edit.e; d = addDays(d, 1)) if (D[ymd(d)] === A.edit.t) { D[ymd(d)] = 'O'; clearNote(ME_KEY, ymd(d)); }
    weekdaysIn(s, en).forEach((d) => { D[ymd(d)] = A.type; clearNote(ME_KEY, ymd(d)); });
    save(); S.add = null; render(); popScreen(); return;
  }
  else if (a === 'run') { openSheet(runPage(leaveRuns(leaveYear())[+v]), { panel: true, expandable: false }); return; }
  else if (a === 'impstart') { document.getElementById('rotaFile').click(); return; }
  else if (a === 'bkimport') { document.getElementById('backupFile').click(); return; }
  else if (a === 'export') { exportBackup(); return; }
  else if (a === 'impcancel') S.imp = null;
  else if (a === 'impread') { readFile(); return; }
  else if (a === 'impcand') { SET.name = S.imp.candidates[+v]; save(); readFile(); return; }
  else if (a === 'impmanual') { S.imp = null; S.tab = 'month'; S.moff = 1; }
  else if (a === 'implist') S.imp.months[+v].open = !S.imp.months[+v].open;
  else if (a === 'impdone') { applyImport(); return; }
  else if (a === 'imptick') return;
  render();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.a === 'imptick') { S.imp.months[+t.dataset.v].on = t.checked; render(); return; }
  if (t.id === 'impShow' && S.imp) { S.imp.showing = t.value; render(); return; }
  if (t.dataset && t.dataset.ip != null && S.imp) { const n = t.dataset.ip; if (t.checked) S.imp.skip.delete(n); else S.imp.skip.add(n); render(); return; }
  if (t.dataset && t.dataset.ig != null && S.imp) { const ns = S.imp.groups[+t.dataset.ig][1]; ns.forEach((n) => { if (t.checked) S.imp.skip.delete(n); else S.imp.skip.add(n); }); render(); return; }
  if (t.id === 'setShow') { SET.showing = t.value || null; tidyShowing(); save(); render(); return; }
  if (t.id === 'setMe') { SET.name = t.value; tidyShowing(); save(); render(); return; }
  if (t.dataset && t.dataset.wo != null) { whoTickOffice(t.dataset.wo, t.checked); save(); render(); return; }
  if (t.dataset && t.dataset.wp != null) { whoTickPerson(t.dataset.wp, t.dataset.wg, t.checked); save(); render(); return; }
  if (t.dataset && t.dataset.g != null) { const g = t.dataset.g; SET.swapGroups = t.checked ? [...new Set([...SET.swapGroups, g])] : SET.swapGroups.filter((x) => x !== g); save(); render(); return; }
  if (t.id === 'aStart' && S.add) { S.add.start = t.value || S.add.start; if (pk(S.add.end) < pk(S.add.start)) S.add.end = S.add.start; render(); }
  else if (t.id === 'aEnd' && S.add) { S.add.end = t.value || S.add.end; render(); }
  else if (t.id === 'setName') { SET.name = t.value.trim() || SET.name; save(); render(); }
  else if (t.id === 'setAllow') { const y = curYear(), n = parseInt(t.value, 10), cur = allowFor(y) || { allow: null, carry: 0 }; SET.years[y] = { allow: Number.isFinite(n) && n >= 0 ? Math.min(99, n) : null, carry: cur.carry }; save(); render(); }
  else if (t.id === 'setCarry') { const y = curYear(), n = parseInt(t.value, 10), cur = allowFor(y) || { allow: null, carry: 0 }; SET.years[y] = { allow: cur.allow, carry: Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0 }; save(); render(); }
  else if (t.dataset && t.dataset.lt) { SET[t.dataset.lt] = t.checked; save(); render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (S.imp) { S.imp = null; render(); } else if (S.rm) { S.rm = null; render(); } else if (S.cf) { S.cf = null; render(); } else closeSheet(); } });
window.addEventListener('resize', () => { if (SH.host !== 'sheet' || SH.state === 'closed' || SH.state === 'closing') return; shStop(); shMeasure(); shApply(SH.state === 'tall' ? 0 : SH.Tc); });
document.getElementById('rotaFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { S.imp = { step: 'confirm', name: f.name, bytes: await f.arrayBuffer() }; }
  catch (err) { toast("Couldn't open that file"); return; }
  render();
});
document.getElementById('backupFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { restoreBackup(await f.text()); } catch (err) { toast("Couldn't read that file"); }
});
window.matchMedia('(min-width: 900px)').addEventListener('change', render);


// ---------- swiping between weeks and months ----------
// Only transforms are animated, so it runs on the graphics chip and costs almost nothing.
const SNAP_MS = 900, SNAP_EASE = 'cubic-bezier(.16,1,.3,1)', GAP = 16, REEL_H = 26;
let TR = null, job = null, drag = null, swallowClick = false;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function bindTrack() {
  job = null;
  const scr = document.getElementById('scr'), swv = scr.querySelector('.swv');
  TR = swv ? { swv, trk: swv.querySelector('.trk'), pgs: [...swv.querySelectorAll('.pg')], rts: [...scr.querySelectorAll('.rt')] } : null;
  if (TR) { transitions(false); layout(0); }
}
// p: -1 = fully on the previous page, 0 = current, 1 = fully on the next page
function layout(p) {
  const W = TR.swv.clientWidth + GAP;
  TR.trk.style.transform = 'translate3d(' + (-W - p * W) + 'px,0,0)';
  TR.rts.forEach((r) => { const d = +r.dataset.s - p; r.style.transform = 'translate3d(0,' + (d * REEL_H) + 'px,0)'; r.style.opacity = Math.max(0, 1 - Math.abs(d) * 0.85); });
}
function transitions(on) {
  const t = SNAP_MS + 'ms ' + SNAP_EASE;
  TR.trk.style.transition = on ? 'transform ' + t : 'none';
  TR.rts.forEach((r) => { r.style.transition = on ? 'transform ' + t + ', opacity ' + t : 'none'; });
}
function run(p, dir, done) {
  if (reduceMotion()) { layout(p); if (done) done(); return; }
  void TR.trk.offsetWidth; // apply the start position before animating
  transitions(true); layout(p);
  const j = { dir, done, fin: false, timer: 0 };
  j.end = (e) => {
    if (j.fin || (e && (e.target !== TR.trk || e.propertyName !== 'transform'))) return;
    j.fin = true; clearTimeout(j.timer); TR.trk.removeEventListener('transitionend', j.end); job = null;
    if (done) done(); else transitions(false);
  };
  TR.trk.addEventListener('transitionend', j.end);
  j.timer = setTimeout(() => j.end(), SNAP_MS + 120);
  job = j;
}
// dir: 1 = next, -1 = previous, 0 = spring back. target lets ↺ land on today in one slide.
function animateTo(dir, target) {
  if (!TR) return;
  if (dir === 0) { run(0, 0, null); return; }
  const tab = S.tab, P = PAGED[tab], o = P.off();
  if (target == null) target = o + dir;
  if (target !== o + dir) {
    const i = dir > 0 ? 2 : 0;
    TR.pgs[i].innerHTML = P.body(target);
    TR.rts[i].textContent = P.title(target);
  }
  run(dir, dir, () => { if (S.tab === tab) { P.set(target); render(); } });
}
// A new swipe during a slide catches the page where it is, rather than being ignored.
function interrupt() {
  if (!job || !TR) return 0;
  const j = job; job = null; j.fin = true; clearTimeout(j.timer); TR.trk.removeEventListener('transitionend', j.end);
  const W = TR.swv.clientWidth + GAP;
  const tx = new DOMMatrixReadOnly(getComputedStyle(TR.trk).transform).m41;
  let p = (-W - tx) / W;
  if (j.dir) { j.done(); p -= j.dir; }
  transitions(false); layout(p);
  return p;
}
const canSwipe = () => TR && (S.tab === 'week' || S.tab === 'month') && SH.state === 'closed' && !S.imp;
const scrEl = document.getElementById('scr');
scrEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !e.isPrimary || !canSwipe()) return;
  if (e.target.closest('.hd button, .mid button')) return; // header buttons handle their own taps
  const p0 = interrupt();
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lock: null, dx: 0, p0, p: p0, W: TR.swv.clientWidth + GAP, s: [{ x: e.clientX, t: e.timeStamp }] };
});
scrEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (drag.lock === null) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dx) > Math.abs(dy) * 1.2) { drag.lock = 'x'; transitions(false); try { scrEl.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } }
    else { const d = drag; drag = null; if (d.p0) animateTo(0); return; }
  }
  drag.dx = dx; drag.s.push({ x: e.clientX, t: e.timeStamp }); if (drag.s.length > 8) drag.s.shift();
  drag.p = Math.max(-1, Math.min(1, drag.p0 - dx / drag.W)); layout(drag.p);
});
function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.lock !== 'x') { if (d.p0) animateTo(0); return; }
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 300);
  // speed over the last ~100 ms, so a quick flick counts even after a slow start
  const last = d.s[d.s.length - 1]; let first = d.s[0];
  for (const q of d.s) { if (last.t - q.t <= 100) { first = q; break; } }
  const v = (last.x - first.x) / Math.max(1, last.t - first.t);
  let dir = 0;
  if (!cancelled) {
    if (Math.abs(v) > 0.3 && Math.abs(d.dx) > 16) dir = v < 0 ? 1 : -1;
    else if (Math.abs(d.p) > 1 / 3) dir = d.p > 0 ? 1 : -1;
  }
  animateTo(dir);
}
scrEl.addEventListener('pointerup', (e) => endDrag(e, false));
scrEl.addEventListener('pointercancel', (e) => endDrag(e, true));
window.addEventListener('resize', () => { if (TR && !job && !drag) layout(0); });

// ---------- start ----------
load();
ensureYear();
render();
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* best effort */ }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__rotapp = { get data() { return D; }, get settings() { return SET; }, get team() { return TEAM; } };
