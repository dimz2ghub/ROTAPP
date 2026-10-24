import { readRotaPdf, MONTHS } from './reader.js';
import { readRotaXlsx } from './xlsx.js';

const VERSION = '0.4 prototype';
const KEY = 'rotapp.v1';

const T = {
  M: { n: 'M shift', sm: 'M', bg: '#00B050', fg: '#000' },
  L: { n: 'L shift', sm: 'L', bg: '#4472C4', fg: '#fff' },
  O: { n: 'Off', sm: 'Off', bg: 'var(--off)', fg: 'var(--offt)' },
  H: { n: 'Holiday', sm: 'H', bg: '#FFE24D', fg: '#000' },
  C: { n: 'C', sm: 'C', bg: '#F3DDB0', fg: '#000' },
  S: { n: 'Sick', sm: 'Sick', bg: '#F4A6C0', fg: '#000' },
  X: { n: 'Other', sm: 'Oth', bg: '#8B5E3C', fg: '#fff' },
  MA: { n: 'MA', sm: 'MA', bg: '#ED7D31', fg: '#000' },
  LA: { n: 'LA', sm: 'LA', bg: '#5B9BD5', fg: '#000' },
  E: { n: 'E', sm: 'E', bg: '#E03131', fg: '#fff' },
  P: { n: 'PH', sm: 'PH', bg: '#7030A0', fg: '#fff' },
};
const COMMON = ['M', 'L', 'O', 'H', 'C', 'S'];
const MORE = ['X', 'MA', 'LA', 'E', 'P'];
const LEAVE = { H: 1, C: 1, S: 1, X: 1 };
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- data ----------
let D = {};
let SET = { name: 'Dimitri Jovanovic', allow: null, carry: 0, style: 'A', theme: 'auto', wmode: 'cal' };
let canSave = true;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d.days === 'object') D = d.days;
    if (d && d.set) SET = { ...SET, ...d.set };
  } catch (e) { canSave = false; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, days: D, set: SET })); canSave = true; }
  catch (e) { canSave = false; }
}

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
const leaveYear = () => today().getFullYear();
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
  const s = weekStart(off), tk = ymd(today());
  let h = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i), k = ymd(d), c = D[k], tod = k === tk ? ' tod' : '';
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
  let h = '<div class="frame"><div class="g">';
  for (let i = 0; i < off; i++) h += '<div></div>';
  for (let n = 1; n <= dim; n++) { const k = y + '-' + p2(m + 1) + '-' + p2(n); h += cell(n, k, D[k]); }
  return h + '</div></div>';
}
function monthSummary(mo) {
  const f = monthFirst(mo), y = f.getFullYear(), m = f.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  let nm = 0, nl = 0;
  for (let n = 1; n <= dim; n++) { const c = D[y + '-' + p2(m + 1) + '-' + p2(n)]; if (c === 'M' || c === 'MA') nm++; if (c === 'L' || c === 'LA') nl++; }
  return (nm + nl) ? (nm + nl) + ' shifts · ' + nm + ' M · ' + nl + ' L' : 'No shifts yet';
}
function leaveHtml() {
  const y = leaveYear(), c = countYear(y);
  let h = '<div class="hd"><b>Leave</b><span class="k">' + y + '</span></div>';
  if (SET.allow == null) {
    h += '<div class="k">Holiday used</div><div class="big">' + c.H + ' <span class="k">days</span></div>';
    h += '<button class="lnk" data-a="gosettings" style="text-align:left;padding-left:0">Set your yearly allowance in Settings</button>';
  } else {
    const tot = SET.allow + SET.carry, rem = tot - c.H;
    h += '<div class="k">Holiday remaining</div><div class="big">' + rem + ' <span class="k">of ' + tot + ' days</span></div>';
    h += '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, Math.round(c.H / (tot || 1) * 100))) + '%"></i></div>';
    h += '<div class="k" style="margin-bottom:8px">' + SET.allow + ' allowance + ' + SET.carry + ' carried over · ' + c.H + ' used</div>';
  }
  h += '<div class="rw"><span><i class="sw" style="background:' + T.C.bg + '"></i>C</span><b>' + c.C + '</b></div>';
  h += '<div class="rw"><span><i class="sw" style="background:' + T.S.bg + '"></i>Sick</span><b>' + c.S + '</b></div>';
  h += '<div class="rw"><span><i class="sw" style="background:' + T.X.bg + '"></i>Other</span><b>' + c.X + '</b></div>';
  h += '<div class="sec">Booked leave</div>';
  const t0 = today(), runs = leaveRuns(y);
  let shown = 0;
  runs.forEach((r, i) => {
    const past = r.e < t0;
    if (past && !S.showPast) return;
    shown++;
    h += '<button class="rw" data-a="run" data-v="' + i + '"><span>' + lab(r.s, r.e) + ' · ' + T[r.t].n + (past ? ' <span class="k">(past)</span>' : '') + '</span><b>' + r.n + (r.n === 1 ? ' day' : ' days') + '</b></button>';
  });
  if (!shown) h += '<div class="k" style="padding:8px 0">No upcoming leave</div>';
  h += '<button class="lnk" data-a="past">' + (S.showPast ? 'Hide past leave' : 'Show past leave') + '</button>';
  h += '<button class="btn" data-a="add">Add leave</button>';
  return h;
}
function addDefaults() { const t = today(); return { type: 'H', start: ymd(t), end: ymd(t), edit: null }; }
function addHtml() {
  const A = S.add, y = leaveYear(), c = countYear(y);
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
      if (SET.allow == null) h += 'Holiday used ' + usedH + ' → ' + (usedH + n) + '<br><span class="k">Set your allowance in Settings to see what is left.</span>';
      else {
        const rem = SET.allow + SET.carry - usedH;
        h += rem + ' remaining → ' + (rem - n);
        if (rem - n < 0) h += '<br><span class="warn">Over your allowance by ' + (n - rem) + (n - rem === 1 ? ' day' : ' days') + '. You can still save.</span>';
      }
    } else h += 'Sick days used ' + (c.S) + ' → ' + (c.S + n);
    h += '<br>Replaces ' + repl + ' existing ' + (repl === 1 ? 'day' : 'days') + '</div>';
  }
  h += '<div class="acts"><button data-a="acancel">Cancel</button><button class="p" data-a="asave">Save leave</button></div>';
  return h;
}
function settingsHtml() {
  const seg = (a, v, t, on) => '<button data-a="' + a + '" data-v="' + v + '" class="' + (on ? 'on' : '') + '">' + t + '</button>';
  let h = '<div class="hd"><b>Settings</b></div>';
  h += '<div class="sec" style="margin-top:4px">Import</div>';
  h += '<button class="btn" data-a="impstart" style="margin-top:6px">Import rota file</button>';
  h += '<div class="k" style="margin-top:6px">Choose the rota as a PDF or an xlsx spreadsheet. You check it before anything is saved.</div>';
  h += '<div class="strow"><label for="setName">Your name on the rota</label><input class="fld wide" id="setName" type="text" value="' + esc(SET.name) + '" autocomplete="off" autocapitalize="words"></div>';
  h += '<div class="sec">Backup</div><div class="acts" style="margin-top:6px"><button data-a="export">Export backup</button><button data-a="bkimport">Import backup</button></div>';
  if (!canSave) h += '<div class="wbar">This browser is not letting Rotapp save. Export a backup now and then to be safe.</div>';
  h += '<div class="sec">Holiday</div>';
  h += '<div class="strow"><label for="setAllow">Yearly allowance (days)</label><input class="fld" id="setAllow" type="number" inputmode="numeric" min="0" max="99" value="' + (SET.allow == null ? '' : SET.allow) + '" placeholder="Not set"></div>';
  h += '<div class="strow"><label for="setCarry">Carried over <span class="k">(max 2)</span></label><input class="fld" id="setCarry" type="number" inputmode="numeric" min="0" max="2" value="' + SET.carry + '"></div>';
  h += '<div class="sec">Appearance</div>';
  h += '<div class="strow"><span>Day style</span><span class="seg">' + seg('style', 'A', 'Filled', SET.style === 'A') + seg('style', 'B', 'Badge', SET.style === 'B') + seg('style', 'C', 'Dot', SET.style === 'C') + '</span></div>';
  h += '<div class="strow"><span>Theme</span><span class="seg">' + seg('themeset', 'auto', 'Auto', SET.theme === 'auto') + seg('themeset', 'light', 'Light', SET.theme === 'light') + seg('themeset', 'dark', 'Dark', SET.theme === 'dark') + '</span></div>';
  h += '<div class="sec">Week</div>';
  h += '<div class="strow"><span>Week view</span><span class="seg">' + seg('wmode', 'cal', 'Mon – Sun', SET.wmode === 'cal') + seg('wmode', 'roll', 'Next 7 days', SET.wmode === 'roll') + '</span></div>';
  h += '<div class="foot">Rotapp ' + VERSION + '</div>';
  return h;
}

// ---------- day editor (bottom sheet on phones, side panel on wide screens) ----------
function dayEditorInner() {
  const d = pk(S.sheet), cur = D[S.sheet], pick = S.pick || cur;
  let h = '<b>' + DN[d.getDay()] + ' ' + d.getDate() + ' ' + MN[d.getMonth()] + '</b> <span class="k">· ' + (cur ? T[cur].n : 'No shift') + '</span><div class="tiles">';
  const tile = (x) => '<button class="tile' + (pick === x ? ' on' : '') + '" data-a="pick" data-v="' + x + '" style="background:' + T[x].bg + ';color:' + T[x].fg + '">' + T[x].n + '</button>';
  COMMON.forEach((x) => { h += tile(x); });
  if (S.more) MORE.forEach((x) => { h += tile(x); });
  h += '</div><button class="mrow" data-a="more">' + (S.more ? 'Fewer types ▴' : 'More types ▾') + '</button>';
  h += '<div class="acts"><button data-a="cancel">Cancel</button><button class="p" data-a="done">Done</button></div>';
  return h;
}
function runSheetInner() {
  const r = S.runSheet;
  return '<b>' + lab(r.s, r.e) + '</b> <span class="k">· ' + T[r.t].n + ', ' + r.n + (r.n === 1 ? ' day' : ' days') + '</span>' +
    '<div class="acts"><button data-a="runedit">Change dates</button><button data-a="rundel" style="color:var(--danger)">Delete</button></div>' +
    '<div class="acts" style="margin-top:8px"><button data-a="runclose">Close</button></div>';
}

// ---------- import ----------
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
  h += '<div class="obar">Read ' + esc(I.matched) + '\'s row from ' + esc(I.name) + '.</div>';
  (I.warnings || []).forEach((w) => { h += '<div class="wbar">' + esc(w) + '</div>'; });
  const multi = I.months.length > 1;
  I.months.forEach((M, mi) => {
    h += '<div class="pm">';
    h += multi ? '<label><input type="checkbox" data-a="imptick" data-v="' + mi + '"' + (M.on ? ' checked' : '') + '> ' + MF[M.m] + ' ' + M.y + '</label>' : '<b>' + MF[M.m] + ' ' + M.y + '</b>';
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
    return { y: m.year, m: m.month, days: m.days, blanks: m.blanks, doubt: m.unknown.length, warnings: m.warnings || [], exists, list, chg, open: false, on: true };
  });
  S.imp = { step: 'preview', name: I.name, bytes: I.bytes, matched: res.months[0].matched, warnings: res.warnings || [], months };
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
  });
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
    const blob = new Blob([JSON.stringify({ app: 'Rotapp', version: 1, days: D, set: SET })], { type: 'application/json' });
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
      if (['A', 'B', 'C'].includes(s.style)) SET.style = s.style;
      if (['auto', 'light', 'dark'].includes(s.theme)) SET.theme = s.theme;
      if (['cal', 'roll'].includes(s.wmode)) SET.wmode = s.wmode;
    }
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
  scr.innerHTML = t === 'week' || t === 'month' ? pagedHtml(t) : t === 'leave' ? leaveHtml() : t === 'add' ? addHtml() : settingsHtml();
  bindTrack();
  main.scrollTop = top;
  const wide = isWide(), panel = document.getElementById('panel');
  let ov = '', pnl = '';
  const editing = S.sheet != null, runOpen = S.runSheet != null;
  if (wide) {
    if (editing) pnl = '<button class="lnk" data-a="cancel" style="text-align:right;margin:0 0 8px">Close ✕</button>' + dayEditorInner();
    else if (runOpen) pnl = '<button class="lnk" data-a="runclose" style="text-align:right;margin:0 0 8px">Close ✕</button>' + runSheetInner();
  } else {
    if (editing) ov += '<div class="dim" data-a="cancel"></div><div class="sheet"><div class="grab"></div>' + dayEditorInner() + '</div>';
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
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v, k = el.dataset.k;
  if (a === 'tab') { S.tab = v; S.sheet = null; S.runSheet = null; S.imp = null; S.add = null; }
  else if (a === 'gosettings') S.tab = 'settings';
  else if (a === 'wmode') { SET.wmode = v; S.woff = 0; save(); }
  else if (a === 'prev') { interrupt(); animateTo(-1); return; }
  else if (a === 'next') { interrupt(); animateTo(1); return; }
  else if (a === 'today') { interrupt(); const o = PAGED[S.tab].off(); if (o) animateTo(o > 0 ? -1 : 1, 0); return; }
  else if (a === 'style') { SET.style = v; save(); }
  else if (a === 'themeset') { SET.theme = v; save(); }
  else if (a === 'day') { S.sheet = k; S.pick = null; S.more = false; S.runSheet = null; }
  else if (a === 'pick') S.pick = v;
  else if (a === 'more') S.more = !S.more;
  else if (a === 'done') { if (S.pick) { D[S.sheet] = S.pick; save(); } S.sheet = null; }
  else if (a === 'cancel') S.sheet = null;
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
  if (t.id === 'aStart' && S.add) { S.add.start = t.value || S.add.start; if (pk(S.add.end) < pk(S.add.start)) S.add.end = S.add.start; render(); }
  else if (t.id === 'aEnd' && S.add) { S.add.end = t.value || S.add.end; render(); }
  else if (t.id === 'setName') { SET.name = t.value.trim() || SET.name; save(); render(); }
  else if (t.id === 'setAllow') { const n = parseInt(t.value, 10); SET.allow = Number.isFinite(n) && n >= 0 ? Math.min(99, n) : null; save(); render(); }
  else if (t.id === 'setCarry') { const n = parseInt(t.value, 10); SET.carry = Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0; save(); render(); }
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
render();
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* best effort */ }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__rotapp = { get data() { return D; }, get settings() { return SET; } };
