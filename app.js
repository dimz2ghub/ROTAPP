import { readRotaPdf, MONTHS } from './reader.js';
import { readRotaXlsx } from './xlsx.js';

const VERSION = '0.6 prototype';
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
const MORE = ['X', 'MA', 'LA', 'E', 'P'];
const LEAVE = { H: 1, C: 1, S: 1, X: 1 };
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- data ----------
let D = {};
let SET = { name: 'Dimitri Jovanovic', allow: null, carry: 0, style: 'A', theme: 'auto', wmode: 'cal', showing: null, swapGroups: ['London', 'Dubai'], lastImport: null, lastBackup: null, years: {}, showC: true, showSick: true };
// Everyone else from the rota: people[name] = { g: office, d: { 'YYYY-MM-DD': code } }; groups = office order from the most recent import.
let TEAM = { people: {}, groups: [] };
let canSave = true;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d.days === 'object') D = d.days;
    if (d && d.set) SET = { ...SET, ...d.set };
    if (d && d.team && d.team.people) TEAM = { people: d.team.people, groups: d.team.groups || [] };
    // 0.5 kept one allowance; from 0.6 each year has its own.
    if (!SET.years || typeof SET.years !== 'object') SET.years = {};
    if (SET.allow != null && !SET.years[curYear()]) SET.years[curYear()] = { allow: SET.allow, carry: SET.carry || 0 };
    tidyShowing();
  } catch (e) { canSave = false; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 2, days: D, set: SET, team: TEAM })); canSave = true; }
  catch (e) { canSave = false; }
}

// ---------- team ----------
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
  add: null, imp: null, toast: '', runSheet: null, panelOpen: true,
};
let toastTimer = null;
function toast(msg) {
  S.toast = msg; render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ''; render(); }, 2800);
}

// ---------- leave maths ----------
const curYear = () => today().getFullYear();
const leaveYear = () => S.lyear || curYear();
const allowFor = (y) => (SET.years && SET.years[y]) || null;
// A new year starts with last year's allowance copied in (carry-over is typed in by hand).
function ensureYear() {
  const y = curYear();
  if (SET.years[y]) return;
  const prev = Object.keys(SET.years).map(Number).filter((x) => x < y).sort((a, b) => b - a)[0];
  if (prev != null && SET.years[prev].allow != null) { SET.years[y] = { allow: SET.years[prev].allow, carry: 0 }; save(); }
}
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
    else { const t = T[c]; h += '<button class="card' + tod + '" data-a="day" data-k="' + k + '" style="background:' + t.bg + ';color:' + t.fg + '">' + nm + '<div class="l">' + (c === 'M' || c === 'L' ? c : t.n) + '</div></button>'; }
  }
  return h;
}
function cell(n, k, c) {
  const tod = k === ymd(today()) ? ' tod' : '', t = c ? T[c] : null;
  const a = ' data-a="day" data-k="' + k + '" aria-label="' + n + (t ? ', ' + t.n : '') + '"';
  if (!t) return '<button class="c' + tod + '"' + a + ' style="background:var(--surface2)"><span class="dn">' + n + '</span></button>';
  if (SET.style === 'A') return '<button class="c' + tod + '"' + a + ' style="background:' + t.bg + ';color:' + t.fg + '"><span>' + n + '</span><b>' + t.sm + '</b></button>';
  if (SET.style === 'B') return '<button class="c' + tod + '"' + a + ' style="background:var(--surface2)"><span class="dn">' + n + '</span><b class="bd" style="background:' + t.bg + ';color:' + t.fg + '">' + t.sm + '</b></button>';
  return '<button class="c' + tod + '"' + a + ' style="background:var(--surface2)"><span class="dn">' + n + '</span><span class="dot" style="background:' + t.bg + '"></span></button>';
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
  if (SET.showC) h += '<div class="rw"><span><i class="sw" style="background:' + T.C.bg + '"></i>C</span><b>' + c.C + '</b></div>';
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
  let h = '<div class="hd"><b>' + (A.edit ? 'Change leave' : 'Add leave') + '</b></div><div class="k">Type</div><div class="chips">';
  ['H', 'S'].forEach((x) => { h += '<button class="chp' + (A.type === x ? ' on' : '') + '" data-a="atype" data-v="' + x + '" style="background:' + T[x].bg + ';color:' + T[x].fg + '">' + T[x].n + '</button>'; });
  h += '</div><label class="k" for="aStart">Start date</label><input class="fld" id="aStart" type="date" value="' + A.start + '"><label class="k" for="aEnd">End date</label><input class="fld" id="aEnd" type="date" value="' + A.end + '">';
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
  leave: ['#E8A317', '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'],
};
const shortDate = (k) => { const d = pk(k); return d.getDate() + ' ' + MN[d.getMonth()]; };
function personOptions(selected, withMe) {
  let h = '';
  if (withMe) h += '<option value="">Me (' + esc(SET.name) + ')</option>';
  const groups = withMe ? othersIn(TEAM.groups) : TEAM.groups;
  groups.forEach(([g, ns]) => { h += '<optgroup label="' + esc(g) + '">' + ns.map((n) => '<option' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</optgroup>'; });
  return h;
}
function settingsHtml() {
  const seg = (a, v, t, on) => '<button data-a="' + a + '" data-v="' + v + '" class="' + (on ? 'on' : '') + '">' + t + '</button>';
  const hasTeam = TEAM.groups.length > 0, open = (id) => (S.card === id ? ' open' : '');
  const showingName = viewingOther() ? SET.showing : 'me';
  let h = '<div class="stitle">Settings</div>';
  // Import, with backup tucked behind the arrow
  h += '<div class="herocard' + open('backup') + '" data-card="backup"><div class="herorow">';
  h += '<button class="hmain" data-a="impstart"><span class="hic"><svg viewBox="0 0 24 24">' + SICON.imp + '</svg></span><span><b>Import rota file</b><small>' + (SET.lastImport ? 'Last: ' + esc(SET.lastImport.file) + ' · ' + shortDate(SET.lastImport.at) : 'PDF or xlsx. You check it before anything is saved.') + '</small></span></button>';
  h += '<button class="hchev" data-a="card" data-v="backup" aria-expanded="' + (S.card === 'backup') + '" aria-label="Backup options"><span class="chev">▾</span></button></div>';
  h += '<div class="cb"><div><div class="hinner"><div class="hk">Backup · ' + (SET.lastBackup ? 'last saved ' + shortDate(SET.lastBackup) : 'not saved yet') + '</div><div class="hbtns"><button data-a="export">Export backup</button><button data-a="bkimport">Import backup</button></div><div class="hk" style="margin-top:6px">Saves everything to a file you can keep in Files or iCloud.</div></div></div></div></div>';
  if (!canSave) h += '<div class="wbar">This browser is not letting Rotapp save. Export a backup now and then to be safe.</div>';
  const card = (id, title, sum, body) => '<div class="scard' + open(id) + '" data-card="' + id + '"><button class="ch" data-a="card" data-v="' + id + '" aria-expanded="' + (S.card === id) + '"><span class="sic" style="background:' + SICON[id][0] + '"><svg viewBox="0 0 24 24">' + SICON[id][1] + '</svg></span><span class="t"><b>' + title + '</b><small>' + sum + '</small></span><span class="chev">▾</span></button><div class="cb"><div><div class="inner">' + body + '</div></div></div></div>';
  // Rota
  let rb = '';
  if (hasTeam) {
    rb += '<div class="it"><label for="setShow">Showing</label><select class="sel" id="setShow">' + personOptions(viewingOther() ? SET.showing : '', true) + '</select></div>';
    rb += '<div class="it col"><span>Groups in the swap list</span><div class="ticks">' + TEAM.groups.map(([g]) => '<label><input type="checkbox" data-g="' + esc(g) + '"' + (SET.swapGroups.includes(g) ? ' checked' : '') + '> ' + esc(g) + '</label>').join('') + '</div></div>';
  } else rb += '<div class="it col"><span class="k">Import a rota to see your team here.</span></div>';
  rb += '<div class="it"><span>Week view</span><span class="seg">' + seg('wmode', 'cal', 'Mon – Sun', SET.wmode === 'cal') + seg('wmode', 'roll', 'Next 7 days', SET.wmode === 'roll') + '</span></div>';
  if (hasTeam && latestNames().includes(SET.name)) rb += '<div class="it"><label for="setMe">This is me</label><select class="sel" id="setMe">' + personOptions(SET.name, false) + '</select></div>';
  else rb += '<div class="it"><label for="setName">This is me</label><input class="fld wide" id="setName" type="text" value="' + esc(SET.name) + '" autocomplete="off" autocapitalize="words"></div>';
  rb += '<div class="it col"><span class="k">"This is me" is your row on the rota. Only change it if your name is written differently.</span></div>';
  h += card('rota', 'Rota', 'Showing ' + esc(showingName) + ' · ' + (SET.wmode === 'cal' ? 'Mon – Sun' : 'Next 7 days'), rb);
  // Appearance
  const sty = { A: 'Filled', B: 'Badge', C: 'Dot' }, th = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  let ab = '<div class="it"><span>Day style</span><span class="seg">' + seg('style', 'A', 'Filled', SET.style === 'A') + seg('style', 'B', 'Badge', SET.style === 'B') + seg('style', 'C', 'Dot', SET.style === 'C') + '</span></div>';
  ab += '<div class="it"><span>Theme</span><span class="seg">' + seg('themeset', 'auto', 'Auto', SET.theme === 'auto') + seg('themeset', 'light', 'Light', SET.theme === 'light') + seg('themeset', 'dark', 'Dark', SET.theme === 'dark') + '</span></div>';
  h += card('look', 'Appearance', sty[SET.style] + ' · ' + th[SET.theme], ab);
  // Leave: this year's allowance, and which counts show on the Leave tab
  const y = curYear(), A = allowFor(y);
  let lb = '<div class="it"><label for="setAllow">Holiday allowance (' + y + ')</label><input class="fld num" id="setAllow" type="number" inputmode="numeric" min="0" max="99" value="' + (A && A.allow != null ? A.allow : '') + '" placeholder="–"></div>';
  lb += '<div class="it"><label for="setCarry">Carried over <span class="k">(max 2)</span></label><input class="fld num" id="setCarry" type="number" inputmode="numeric" min="0" max="2" value="' + (A ? A.carry : 0) + '"></div>';
  lb += '<div class="it col"><span>Show on the Leave tab</span><div class="lticks"><label><input type="checkbox" data-lt="showC"' + (SET.showC ? ' checked' : '') + '> C</label><label><input type="checkbox" data-lt="showSick"' + (SET.showSick ? ' checked' : '') + '> Sick</label></div></div>';
  lb += '<div class="it col"><span class="k">A new year starts with last year\'s allowance copied in. You can change it here.</span></div>';
  h += card('leave', 'Leave', (A && A.allow != null ? A.allow + ' + ' + A.carry + ' days · ' + y : 'Allowance not set'), lb);
  h += '<div class="foot">Rotapp ' + VERSION + '</div>';
  return h;
}
// Open or close a Settings card in place, so the slide plays; only one is open at a time.
function toggleCard(id) {
  S.card = S.card === id ? null : id;
  document.querySelectorAll('[data-card]').forEach((c) => {
    const on = c.dataset.card === S.card;
    c.classList.toggle('open', on);
    const b = c.querySelector('[data-a="card"]'); if (b) b.setAttribute('aria-expanded', String(on));
  });
}

// ---------- day editor (bottom sheet on phones, side panel on wide screens) ----------
function dayEditorInner() {
  const d = pk(S.sheet), cur = D[S.sheet], pick = S.pick || cur;
  let h = '<b>' + DN[d.getDay()] + ' ' + d.getDate() + ' ' + MN[d.getMonth()] + '</b> <span class="k">· ' + (cur ? T[cur].n : 'No shift') + '</span><div class="tiles">';
  const tile = (x) => '<button class="tile' + (pick === x ? ' on' : '') + '" data-a="pick" data-v="' + x + '" style="background:' + T[x].bg + ';color:' + T[x].fg + '">' + T[x].n + '</button>';
  COMMON.forEach((x) => { h += tile(x); });
  if (S.more) MORE.forEach((x) => { h += tile(x); });
  h += '</div><button class="mrow" data-a="more">' + (S.more ? 'Fewer types ▴' : 'More types ▾') + '</button>';
  const why = swapBlocked(S.sheet);
  h += why ? '<button class="swapbtn" disabled>⇄ Swap with someone</button><div class="k" style="text-align:center;margin-top:4px">' + why + '</div>' : '<button class="swapbtn" data-a="swap">⇄ Swap with someone</button>';
  h += '<div class="acts"><button data-a="cancel">Cancel</button><button class="p" data-a="done">Done</button></div>';
  return h;
}

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
function swapMonth(name, y, m) {
  const W = S.swap, pd = TEAM.people[name].d, f = new Date(y, m, 1), off = (f.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
  let h = '<div class="mh">' + MF[m] + '</div><div class="g">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => '<div class="w">' + x + '</div>').join('');
  for (let i = 0; i < off; i++) h += '<div></div>';
  for (let n = 1; n <= dim; n++) {
    const k = y + '-' + p2(m + 1) + '-' + p2(n), c = pd[k], t = c ? T[c] : null;
    const cls = (W.their === k ? ' sel' : '') + (W.day === k ? ' mine' : '');
    h += t ? '<button class="c sm' + cls + '" data-a="sday" data-k="' + k + '" style="background:' + t.bg + ';color:' + t.fg + '"><span>' + n + '</span><b>' + t.sm + '</b></button>'
      : '<button class="c sm' + cls + '" disabled style="background:var(--surface2);color:var(--muted)"><span>' + n + '</span></button>';
  }
  return h + '</div>';
}
function swapInner() {
  const W = S.swap, k = W.day, mine = D[k];
  let h = '';
  if (W.step === 'who') {
    h += '<div class="stp">Step 1 of 3</div><h3 class="sh">Swap ' + longDate(k) + '</h3><div class="k">You: ' + T[mine].n + '. Pick who you are swapping with. Their shift on ' + shortDate(k) + ' is shown.</div>';
    const groups = othersIn(TEAM.groups).filter(([g]) => SET.swapGroups.includes(g));
    if (!groups.length) h += '<div class="k" style="padding:12px 0">No groups are ticked for swaps. Choose them in Settings → Rota.</div>';
    groups.forEach(([g, ns]) => {
      h += '<div class="grp">' + esc(g) + '</div>';
      ns.forEach((n) => { const c = TEAM.people[n] && TEAM.people[n].d[k]; h += '<button class="prow' + (c === mine ? ' same' : '') + '" data-a="swho" data-v="' + esc(n) + '"><span>' + esc(n) + '</span>' + chip(c) + '</button>'; });
    });
    h += '<div class="acts"><button data-a="sback" data-v="edit">Back</button></div>';
  } else if (W.step === 'their') {
    const t = today(), nx = new Date(t.getFullYear(), t.getMonth() + 1, 1);
    h += '<div class="stp">Step 2 of 3</div><h3 class="sh">Which of ' + esc(firstName(W.who)) + '\'s days?</h3><div class="k">It starts on the same day. Tap a different day to swap across days. Your day has a dashed outline.</div>';
    h += swapMonth(W.who, t.getFullYear(), t.getMonth());
    if (W.more) h += swapMonth(W.who, nx.getFullYear(), nx.getMonth());
    h += '<button class="mrow" data-a="smore">' + (W.more ? 'Hide ' + MF[nx.getMonth()] + ' ▴' : 'Show ' + MF[nx.getMonth()] + ' ▾') + '</button>';
    const tc = TEAM.people[W.who].d[W.their];
    h += '<div class="k" style="margin-top:8px">Selected: <b>' + longDate(W.their) + '</b> · ' + esc(firstName(W.who)) + ' on ' + (tc ? T[tc].n : 'no shift') + '</div>';
    h += '<div class="acts"><button data-a="sback" data-v="who">Back</button><button class="p" data-a="snext"' + (tc ? '' : ' disabled') + '>Next</button></div>';
  } else {
    const days = W.their === k ? [k] : [k, W.their].sort();
    h += '<div class="stp">Step 3 of 3</div><h3 class="sh">Check the swap</h3><div class="k">You and ' + esc(firstName(W.who)) + ' exchange shifts on ' + (days.length === 1 ? 'this day' : 'both days') + '.</div>';
    days.forEach((x) => {
      const a = D[x], b = TEAM.people[W.who].d[x];
      h += '<div class="cmp"><div class="d">' + longDate(x) + '</div><div class="r"><span>You</span><span>' + chip(a) + ' → ' + chip(b) + '</span></div><div class="r"><span>' + esc(W.who) + '</span><span>' + chip(b) + ' → ' + chip(a) + '</span></div></div>';
    });
    if (days.every((x) => D[x] === TEAM.people[W.who].d[x])) h += '<div class="k" style="margin-top:8px">Nothing would change: you are on the same shift.</div>';
    h += '<div class="acts"><button data-a="sback" data-v="their">Back</button><button class="p" data-a="sconfirm">Confirm swap</button></div>';
  }
  return h;
}
function applySwap() {
  const W = S.swap, other = TEAM.people[W.who].d;
  const days = W.their === W.day ? [W.day] : [W.day, W.their];
  days.forEach((x) => {
    const a = D[x], b = other[x];
    if (b) D[x] = b; else delete D[x];
    if (a) other[x] = a; else delete other[x];
  });
  save();
  const who = W.who;
  S.swap = null; S.sheet = null;
  toast('Swapped with ' + who);
}
function runSheetInner() {
  const r = S.runSheet;
  return '<b>' + lab(r.s, r.e) + '</b> <span class="k">· ' + T[r.t].n + ', ' + r.n + (r.n === 1 ? ' day' : ' days') + '</span>' +
    '<div class="acts"><button data-a="runedit">Change dates</button><button data-a="rundel" style="color:var(--danger)">Delete</button></div>' +
    '<div class="acts" style="margin-top:8px"><button data-a="runclose">Close</button></div>';
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
function impHtml() {
  const I = S.imp;
  if (!I) return '';
  const dim = '<div class="dim" data-a="impcancel"></div>';
  if (I.step === 'confirm') {
    return dim + '<div class="modal" role="dialog" aria-label="Use this file?"><h3>Use this file?</h3><p class="k" style="word-break:break-all;margin:0">' + esc(I.name) + '</p><div class="acts"><button data-a="impcancel">Cancel</button><button class="p" data-a="impread">Confirm</button></div></div>';
  }
  if (I.step === 'reading') return dim + '<div class="modal"><div class="spin">Reading ' + esc(I.name) + '…</div></div>';
  if (I.step === 'fail') {
    let h = dim + '<div class="modal" role="dialog"><h3>Couldn\'t read that file</h3><div class="wbar">' + esc(I.message) + '</div>';
    if (I.candidates && I.candidates.length) {
      h += '<p class="k" style="margin:8px 0 0">Is one of these you?</p>';
      I.candidates.forEach((c, i) => { h += '<button class="cand" data-a="impcand" data-v="' + i + '">' + esc(c) + '</button>'; });
    }
    h += '<div class="acts"><button data-a="impcancel">Cancel</button><button class="p" data-a="impmanual">Enter it by hand</button></div></div>';
    return h;
  }
  let h = dim + '<div class="modal" role="dialog" aria-label="Check the import"><h3>Check the import</h3>';
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
  const anyExists = I.months.some((M) => M.on && M.exists);
  h += '<div class="acts"><button data-a="impcancel">Cancel</button><button class="p" data-a="impdone">' + (anyExists ? 'Add and replace' : 'Add to Rotapp') + '</button></div></div>';
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
  S.imp = { step: 'preview', name: I.name, bytes: I.bytes, matched: res.months[0].matched, warnings: res.warnings || [], months, groups, count, showing: '' };
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
    M.days.forEach((d) => { D[pre + p2(d.n)] = d.code === '?' ? 'O' : d.code; });
    if (M.exists) replaced++; else added++;
    // Everyone else: replace their month too.
    for (const [name, p] of Object.entries(M.team.people)) {
      if (p.me) continue;
      const tp = TEAM.people[name] || (TEAM.people[name] = { g: p.g, d: {} });
      tp.g = p.g;
      Object.keys(tp.d).forEach((k) => { if (k.startsWith(pre)) delete tp.d[k]; });
      for (const [n, c] of Object.entries(p.d)) tp.d[pre + p2(+n)] = c;
    }
  });
  // The people list follows the most recent import.
  const meGroup = on.map((M) => Object.values(M.team.people).find((p) => p.me)).find(Boolean);
  const groups = mergeGroups(on);
  if (meGroup) { let g = groups.find((x) => x[0] === meGroup.g); if (!g) { g = [meGroup.g, []]; groups.unshift(g); } }
  // Keep your own name in the list so "This is me" can show it.
  if (meGroup) { const g = groups.find((x) => x[0] === meGroup.g); const idx = on[on.length - 1].team.groups.find((x) => x[0] === meGroup.g); const order = idx ? idx[1] : []; if (!g[1].includes(SET.name)) { g[1].push(SET.name); g[1].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)); } }
  TEAM.groups = groups;
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
    const blob = new Blob([JSON.stringify({ app: 'Rotapp', version: 2, days: D, set: SET, team: TEAM })], { type: 'application/json' });
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
      if (['A', 'B', 'C'].includes(s.style)) SET.style = s.style;
      if (['auto', 'light', 'dark'].includes(s.theme)) SET.theme = s.theme;
      if (['cal', 'roll'].includes(s.wmode)) SET.wmode = s.wmode;
      if (Array.isArray(s.swapGroups)) SET.swapGroups = s.swapGroups.filter((g) => typeof g === 'string');
      SET.showing = typeof s.showing === 'string' ? s.showing : null;
      if (s.lastImport && typeof s.lastImport.file === 'string') SET.lastImport = s.lastImport;
      if (typeof s.lastBackup === 'string') SET.lastBackup = s.lastBackup;
    }
    TEAM = { people: {}, groups: [] };
    if (d.team && typeof d.team.people === 'object' && d.team.people) {
      for (const [n, p] of Object.entries(d.team.people)) {
        if (!p || typeof p.d !== 'object') continue;
        const dd = {}; for (const [k, v] of Object.entries(p.d)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && T[v]) dd[k] = v;
        TEAM.people[n] = { g: String(p.g || 'Other'), d: dd };
      }
      if (Array.isArray(d.team.groups)) TEAM.groups = d.team.groups.filter((g) => Array.isArray(g) && Array.isArray(g[1])).map((g) => [String(g[0]), g[1].map(String)]);
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
  if (viewingOther()) h += '<div class="vpill"><span>' + esc(SET.showing) + ' · view only</span></div>';
  if (kind === 'week') h += '<div class="mid"><span class="seg"><button data-a="wmode" data-v="cal" class="' + (SET.wmode === 'cal' ? 'on' : '') + '">Mon – Sun</button><button data-a="wmode" data-v="roll" class="' + (SET.wmode === 'roll' ? 'on' : '') + '">Next 7 days</button></span></div>';
  else h += '<div class="g wd">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => '<div class="w">' + x + '</div>').join('') + '</div>';
  h += '<div class="swv"><div class="trk">' + [o - 1, o, o + 1].map((x) => '<div class="pg"' + (x === o ? '' : ' aria-hidden="true" inert') + '>' + P.body(x) + '</div>').join('') + '</div></div>';
  if (kind === 'month') {
    if (SET.style === 'C') { h += '<div class="lgd">'; COMMON.forEach((x) => { h += '<span><i style="background:' + T[x].bg + '"></i>' + T[x].n + '</span>'; }); h += '</div>'; }
    h += '<div class="sum">' + monthSummary(o) + '</div>';
  }
  return h;
}

// ---------- render ----------
function render() {
  const t = S.tab, scr = document.getElementById('scr'), main = document.getElementById('main'), top = main.scrollTop;
  document.documentElement.setAttribute('data-theme', SET.theme);
  const mt = document.querySelector('meta[name=theme-color]'); if (mt) mt.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#131416';
  scr.innerHTML = t === 'week' || t === 'month' ? pagedHtml(t) : t === 'leave' ? leaveHtml() : t === 'add' ? addHtml() : settingsHtml();
  bindTrack();
  main.classList.toggle('grouped', t === 'settings');
  main.scrollTop = top;
  const wide = isWide(), panel = document.getElementById('panel');
  let ov = '', pnl = '';
  const editing = S.sheet != null, runOpen = S.runSheet != null;
  if (wide) {
    if (editing) pnl = '<button class="lnk" data-a="cancel" style="text-align:right;margin:0 0 8px">Close ✕</button>' + (S.swap ? swapInner() : dayEditorInner());
    else if (runOpen) pnl = '<button class="lnk" data-a="runclose" style="text-align:right;margin:0 0 8px">Close ✕</button>' + runSheetInner();
  } else {
    if (editing) ov += '<div class="dim" data-a="cancel"></div><div class="sheet"><div class="grab"></div>' + (S.swap ? swapInner() : dayEditorInner()) + '</div>';
    else if (runOpen) ov += '<div class="dim" data-a="runclose"></div><div class="sheet"><div class="grab"></div>' + runSheetInner() + '</div>';
  }
  panel.innerHTML = pnl;
  panel.classList.toggle('open', wide && (editing || runOpen));
  ov += impHtml();
  if (S.toast) ov += '<div class="toast" role="status">' + esc(S.toast) + '</div>';
  document.getElementById('ov').innerHTML = ov;
  let tb = wide ? '<div class="brand">Rotapp</div>' : '';
  [['week', 'Week'], ['month', 'Month'], ['leave', 'Leave'], ['settings', 'Settings']].forEach((x) => {
    const on = t === x[0] || (t === 'add' && x[0] === 'leave');
    tb += '<button class="tab' + (on ? ' on' : '') + '" data-a="tab" data-v="' + x[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + icon(x[0]) + x[1] + '</button>';
  });
  document.getElementById('nav').innerHTML = tb;
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  if (swallowClick) return;
  const el = e.target.closest('[data-a]');
  if (S.ymenu && (!el || (el.dataset.a !== 'yr' && el.dataset.a !== 'pickyear'))) { S.ymenu = false; render(); if (!el) return; }
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v, k = el.dataset.k;
  if (a === 'tab') { S.tab = v; S.sheet = null; S.swap = null; S.runSheet = null; S.imp = null; S.add = null; S.lyear = null; S.ymenu = false; S.showPast = false; }
  else if (a === 'yr') S.ymenu = !S.ymenu;
  else if (a === 'pickyear') { S.lyear = +v === curYear() ? null : +v; S.ymenu = false; S.showPast = false; S.runSheet = null; }
  else if (a === 'card') { toggleCard(v); return; }
  else if (a === 'gosettings') S.tab = 'settings';
  else if (a === 'wmode') { SET.wmode = v; S.woff = 0; save(); }
  else if (a === 'prev') { interrupt(); animateTo(-1); return; }
  else if (a === 'next') { interrupt(); animateTo(1); return; }
  else if (a === 'today') { interrupt(); const o = PAGED[S.tab].off(); if (o) animateTo(o > 0 ? -1 : 1, 0); return; }
  else if (a === 'style') { SET.style = v; save(); }
  else if (a === 'themeset') { SET.theme = v; save(); }
  else if (a === 'day') { if (viewingOther()) return; S.sheet = k; S.pick = null; S.more = false; S.runSheet = null; S.swap = null; }
  else if (a === 'swap') { if (swapBlocked(S.sheet)) return; S.swap = { step: 'who', day: S.sheet }; }
  else if (a === 'swho') { if (!TEAM.people[v]) return; S.swap.who = v; S.swap.their = S.swap.day; S.swap.more = monthIndex(S.swap.day) === 1; S.swap.step = 'their'; }
  else if (a === 'sday') S.swap.their = k;
  else if (a === 'smore') S.swap.more = !S.swap.more;
  else if (a === 'snext') S.swap.step = 'confirm';
  else if (a === 'sback') { if (v === 'edit') S.swap = null; else S.swap.step = v; }
  else if (a === 'sconfirm') { applySwap(); return; }
  else if (a === 'pick') S.pick = v;
  else if (a === 'more') S.more = !S.more;
  else if (a === 'done') { if (S.pick) { D[S.sheet] = S.pick; save(); } S.sheet = null; }
  else if (a === 'cancel') { S.sheet = null; S.swap = null; }
  else if (a === 'past') S.showPast = !S.showPast;
  else if (a === 'add') { S.add = addDefaults(); S.tab = 'add'; }
  else if (a === 'atype') S.add.type = v;
  else if (a === 'acancel') { S.add = null; S.tab = 'leave'; }
  else if (a === 'asave') {
    const A = S.add, s = pk(A.start), en = pk(A.end);
    if (en < s) { render(); return; }
    if (A.edit) for (let d = A.edit.s; d <= A.edit.e; d = addDays(d, 1)) if (D[ymd(d)] === A.edit.t) D[ymd(d)] = 'O';
    weekdaysIn(s, en).forEach((d) => { D[ymd(d)] = A.type; });
    save(); S.add = null; S.tab = 'leave';
  }
  else if (a === 'run') { S.runSheet = leaveRuns(leaveYear())[+v]; S.sheet = null; }
  else if (a === 'runclose') S.runSheet = null;
  else if (a === 'rundel') {
    const r = S.runSheet;
    for (let d = r.s; d <= r.e; d = addDays(d, 1)) if (D[ymd(d)] === r.t) D[ymd(d)] = 'O';
    save(); S.runSheet = null; toast('Leave deleted'); return;
  }
  else if (a === 'runedit') {
    const r = S.runSheet;
    S.add = { type: r.t === 'S' ? 'S' : 'H', start: ymd(r.s), end: ymd(r.e), edit: r };
    S.runSheet = null; S.tab = 'add';
  }
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
  if (t.id === 'setShow') { SET.showing = t.value || null; tidyShowing(); save(); render(); return; }
  if (t.id === 'setMe') { SET.name = t.value; tidyShowing(); save(); render(); return; }
  if (t.dataset && t.dataset.g != null) { const g = t.dataset.g; SET.swapGroups = t.checked ? [...new Set([...SET.swapGroups, g])] : SET.swapGroups.filter((x) => x !== g); save(); render(); return; }
  if (t.id === 'aStart' && S.add) { S.add.start = t.value || S.add.start; if (pk(S.add.end) < pk(S.add.start)) S.add.end = S.add.start; render(); }
  else if (t.id === 'aEnd' && S.add) { S.add.end = t.value || S.add.end; render(); }
  else if (t.id === 'setName') { SET.name = t.value.trim() || SET.name; save(); render(); }
  else if (t.id === 'setAllow') { const y = curYear(), n = parseInt(t.value, 10), cur = allowFor(y) || { allow: null, carry: 0 }; SET.years[y] = { allow: Number.isFinite(n) && n >= 0 ? Math.min(99, n) : null, carry: cur.carry }; save(); render(); }
  else if (t.id === 'setCarry') { const y = curYear(), n = parseInt(t.value, 10), cur = allowFor(y) || { allow: null, carry: 0 }; SET.years[y] = { allow: cur.allow, carry: Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0 }; save(); render(); }
  else if (t.dataset && t.dataset.lt) { SET[t.dataset.lt] = t.checked; save(); render(); }
});
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
const canSwipe = () => TR && (S.tab === 'week' || S.tab === 'month') && S.sheet == null && S.runSheet == null && !S.imp;
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
