'use strict';
/* =====================================================================
   ezzo-offline.js - Ezzo while he is asleep.

   Until a Gemini key is added, Ezzo still answers: a large set of
   questions about the person's own budget (worked out live from their
   planner) and about how the planner works. There is no free typing to
   send. As they type, the two questions closest to what they mean appear
   as full-width pills, and tapping one asks it.

   Online Ezzo (penny.js) is not touched. This only takes over the Ezzo
   button while Ezzo is not active, and steps aside the moment he is.
   ===================================================================== */

// ── The sleeping face ────────────────────────────────────────────────────
// The same badge and face, eyes closed, with z's drifting up from his head.
const EZ_SLEEP_SVG = `<svg class="ez-face ez-face--asleep" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M9.3 14.9c1.3 1.2 3.3 1.2 4.6 0" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><path d="M18.1 14.9c1.3 1.2 3.3 1.2 4.6 0" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><circle cx="8.4" cy="19.2" r="1.8" fill="#fff" opacity=".24"/><circle cx="23.6" cy="19.2" r="1.8" fill="#fff" opacity=".24"/><ellipse cx="16" cy="21.4" rx="1.7" ry="1.3" fill="#fff" opacity=".9"/></svg>`;
const EZ_ZZZ = '<span class="ez-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>';
const ezSleepAvatar = cls => `<span class="ez-avatar ez-avatar--asleep${cls ? ' ' + cls : ''}" aria-hidden="true">${EZ_SLEEP_SVG}${EZ_ZZZ}</span>`;

// ── Words ─────────────────────────────────────────────────────────────────
const EZ_STOP = new Set(('a an the i im me my mine we our you your it its is are was were be been am do does did doing to of in on at for from by with and or but so if then than ' +
  'this that these those there here what whats which who whom whose how when where why can could would should will shall may might must ' +
  'please tell show give let get got any some just about into up out over again also very really too much many ever still now ' +
  'want wanna need like know see find use using have has had having make makes made app planner ezzo ezo hey hi hello thanks thank ok okay').split(' '));
// Words that mean the same thing for these questions, folded to one.
const EZ_SYN = {
  spend: 'spend spending spent spends expense expenses expenditure buy buying bought purchase purchases purchased shopping outgoing outgoings cost costs',
  money: 'money cash funds fund dollars bucks balance account bank',
  income: 'income pay paid paycheck paycheque payday salary wage wages earn earning earnings earned salary payslip',
  bill: 'bill bills rent utility utilities invoice invoices recurring scheduled',
  sub: 'subscription subscriptions subs sub netflix spotify streaming membership memberships',
  save: 'save saving savings saved goal goals pot pots sinking emergency nest',
  debt: 'debt debts loan loans owe owing owed credit card cards mortgage borrow borrowed apr interest',
  left: 'left remaining remain rest available free safe spare leftover',
  today: 'today daily day tonight',
  week: 'week weekly weeks fortnight fortnightly',
  month: 'month monthly months',
  year: 'year yearly annual annually years',
  add: 'add log record enter new create insert put',
  edit: 'edit change update modify fix correct adjust rename alter',
  delete: 'delete remove erase clear cancel bin trash',
  import: 'import upload statement statements csv pdf file files',
  theme: 'theme themes appearance look colour color colours colors dark light mode style skin',
  sync: 'sync syncing drive google devices device laptop cloud',
  category: 'category categories cat cats envelope envelopes',
  budget: 'budget budgets budgeting plan planned planning allowance limit limits',
  period: 'period periods cycle cycles payday paydays range dates',
  over: 'over overspent overspend overspending exceeded exceed above blown',
  overdue: 'overdue late missed missing past',
  due: 'due upcoming coming next soon',
  most: 'most biggest largest highest top max',
  least: 'least smallest lowest min',
  total: 'total sum overall altogether',
  afford: 'afford affordable worth',
  impulse: 'impulse impulsive tempted temptation urge',
  key: 'key api gemini token',
  sleep: 'sleep sleeping asleep offline wake awake',
  persona: 'persona personas voice tone personality',
  tag: 'tag tags tagged tagging allocation allocate split need needs want wants',
  rollover: 'rollover carry carried carryover',
  chart: 'chart charts graph graphs stats statistics',
  delete_all: 'reset wipe',
  help: 'help guide tutorial explain'
};
const EZ_SYN_MAP = (() => { const m = new Map(); Object.entries(EZ_SYN).forEach(([k, v]) => v.split(' ').forEach(w => m.set(w, k))); return m; })();
const EZ_CONTRACT = [[/\bcan't\b|\bcant\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/n't\b/g, ' not'], [/'s\b/g, ''], [/'re\b/g, ' are'], [/'ll\b/g, ' will'], [/'ve\b/g, ' have'], [/'m\b/g, ' am'], [/&/g, ' and ']];
function ezStem(w) {
  if (w.length <= 3) return w;
  if (EZ_SYN_MAP.has(w)) return EZ_SYN_MAP.get(w);
  let s = w;
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('es') && s.length > 4 && /[sxz]es$|[cs]hes$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) s = s.slice(0, -1);
  return EZ_SYN_MAP.get(s) || s;
}
function ezWords(text) {
  let s = String(text || '').toLowerCase().replace(/[‘’]/g, "'");
  EZ_CONTRACT.forEach(([re, to]) => { s = s.replace(re, to); });
  return s.replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter(Boolean);
}
// Each word as the concept it stands for. Stop words drop out, except when
// they are all there is, so "how do I" still finds something.
function ezTokens(text, keepPartial) {
  const ws = ezWords(text);
  const toks = ws.filter(w => !EZ_STOP.has(w)).map(w => ({ raw: w, t: ezStem(w) }));
  if (keepPartial && toks.length && !/\s$/.test(text)) toks[toks.length - 1].partial = true;
  return toks;
}
function ezLev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ── The index ─────────────────────────────────────────────────────────────
// Questions are worded as the person would ask them; the keywords carry the
// other ways of asking. Both count, the question's own words a little more.
function ezEntryTokens(e) {
  const m = new Map();
  ezTokens(e.q).forEach(x => m.set(x.t, Math.max(m.get(x.t) || 0, 1)));
  ezTokens(e.k || '').forEach(x => m.set(x.t, Math.max(m.get(x.t) || 0, .8)));
  ezWords(e.q).forEach(w => { if (!m.has(w) && !EZ_STOP.has(w)) m.set(w, .9); });
  return m;
}
let _ezStatic = null;
function ezAllEntries() {
  // The questions asked most get a small head start in a close race.
  const pri = { free_today: 90, free_period: 90, bills_next: 60, over_any: 50, spent_period: 40, how_add_expense: 40, budget_left: 30, on_track: 30 };
  if (!_ezStatic) _ezStatic = EZ_KB.map(e => ({ ...e, pri: pri[e.id] || 0, toks: ezEntryTokens(e) }));
  const dyn = (typeof ezDynamicEntries === 'function' ? ezDynamicEntries() : []).map(e => ({ ...e, toks: ezEntryTokens(e), dyn: true }));
  return _ezStatic.concat(dyn);
}
function ezIdf(entries) {
  const df = new Map();
  entries.forEach(e => e.toks.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const n = entries.length;
  return t => Math.log(1 + n / ((df.get(t) || 0) + 1));
}
// "how do I / how to / where / can I" leans to how-to answers; "how much,
// how many, when, what is my" leans to the person's own numbers.
function ezIntent(q) {
  const s = q.toLowerCase();
  if (/\b(how (do|can|to|would|should)|where|can i|is there a way|steps?)\b/.test(s)) return 'how';
  if (/\b(how much|how many|how long|when|what is my|whats my|what's my|am i|do i have|have i|did i|my )\b/.test(s)) return 'data';
  return '';
}

function ezScore(e, qt, idf, intent, qNorm) {
  if (!qt.length) return 0;
  let score = 0, hit = 0;
  qt.forEach(x => {
    let best = 0;
    const exact = e.toks.get(x.t);
    if (exact) best = exact * idf(x.t);
    else {
      for (const [t, w] of e.toks) {
        let v = 0;
        if (x.partial && x.raw.length >= 2 && (t.startsWith(x.raw) || t.startsWith(x.t))) v = .8;
        else if (x.t.length >= 4 && t.length >= 4) { const d = ezLev(x.t, t); if (d <= (x.t.length >= 7 ? 2 : 1)) v = .6; }
        if (v) best = Math.max(best, v * w * idf(t));
      }
    }
    if (best) hit++;
    score += best;
  });
  if (!score) return 0;
  score *= .5 + .5 * (hit / qt.length);
  score /= 1 + .025 * e.toks.size;
  // The whole phrase found in the question counts only when the phrase
  // carries meaning of its own, not just "how much is".
  if (qt.length >= 2 && qNorm.length > 6 && e.q.toLowerCase().includes(qNorm)) score += 3;
  if (intent && e.type === intent) score *= 1.15;
  // A question about one of their own things wins when it is named, and
  // otherwise gives way to the general answer.
  if (e.dyn && e.name) score *= qNorm.includes(e.name.toLowerCase()) ? 1.6 : .75;
  return score + (e.pri || 0) * .01;
}
const EZ_START = ['free_today', 'bills_next', 'over_any', 'how_add_expense'];
function ezSuggest(query, asked) {
  const entries = ezAllEntries().filter(e => !e.when || e.when());
  const qt = ezTokens(query, true);
  const qNorm = ezWords(query).join(' ');
  const done = asked || new Set();
  if (!qt.length) {
    const last = _ez.lastId && entries.find(e => e.id === _ez.lastId);
    const pool = last ? entries.filter(e => e.topic === last.topic && e.id !== last.id && !done.has(e.id)) : [];
    const picks = pool.length >= 2 ? pool : entries.filter(e => EZ_START.includes(e.id) && !done.has(e.id)).concat(entries.filter(e => EZ_START.includes(e.id)));
    return [...new Map(picks.map(e => [e.id, e])).values()].slice(0, 2);
  }
  const idf = ezIdf(entries), intent = ezIntent(query);
  const ranked = entries.map(e => ({ e, s: ezScore(e, qt, idf, intent, qNorm) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const out = [];
  if (ranked.length) {
    out.push(ranked[0].e);
    // The second pick leans to the first one's topic, so the two read as a
    // pair: "spent on groceries" and "left in groceries", not a stray match.
    const top = ranked[0].e, rest = ranked.slice(1).filter(x => x.e.q !== top.q)
      .map(x => ({ e: x.e, s: x.s * (x.e.topic === top.topic ? 1.3 : 1) })).sort((a, b) => b.s - a.s);
    if (rest.length && rest[0].s >= ranked[0].s * .35) out.push(rest[0].e);
    else { const same = entries.find(e => e.topic === top.topic && e.id !== top.id && !done.has(e.id)) || entries.find(e => e.topic === top.topic && e.id !== top.id); if (same) out.push(same); }
  }
  // Nothing matched: the closest by spelling, then the most asked.
  if (out.length < 2) {
    const tri = s => { const g = new Set(); const p = '  ' + s.toLowerCase() + ' '; for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3)); return g; };
    const qg = tri(query);
    entries.map(e => { const g = tri(e.q); let n = 0; qg.forEach(x => { if (g.has(x)) n++; }); return { e, s: n / (qg.size + g.size - n) }; })
      .sort((a, b) => b.s - a.s).forEach(x => { if (out.length < 2 && !out.includes(x.e)) out.push(x.e); });
  }
  return out.slice(0, 2);
}

// ── The chat ──────────────────────────────────────────────────────────────
const _ez = { built: false, lastId: null, asked: new Set() };
function ezOfflineActive() { return typeof pennyIsActive === 'function' ? !pennyIsActive() : true; }
function ezBuild() {
  const wrap = document.createElement('div');
  wrap.id = 'ezOffDrawer';
  wrap.className = 'penny-drawer ez-off';
  wrap.innerHTML = `
    <div class="penny-drawer-scrim" data-ez-close></div>
    <div class="penny-drawer-panel" role="dialog" aria-modal="true" aria-label="${esc(t('ezo_title'))}">
      <div class="penny-drawer-header">
        ${ezSleepAvatar()}
        <span class="penny-head-txt"><span class="penny-drawer-title">Ezzo</span><span class="penny-drawer-sub">${t('ezo_sub')}</span></span>
        <span class="penny-drawer-header-actions">
          <button class="penny-icon-btn" type="button" data-ez-close aria-label="${esc(t('penny_close'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </span>
      </div>
      <div class="penny-body">
        <div class="penny-welcome ez-off-welcome">
          ${ezSleepAvatar('ez-avatar--xl')}
          <h3 class="penny-welcome-title">${t('ezo_hello')}</h3>
          <p class="penny-welcome-sub">${t('ezo_hello_sub')}</p>
          <button class="link-btn ez-wake" type="button" data-ez-wake>${t('ezo_wake')}</button>
        </div>
        <div class="penny-messages" id="ezOffMessages"></div>
      </div>
      <div class="ez-pills" id="ezOffPills" role="group" aria-label="${esc(t('ezo_pills'))}"></div>
      <div class="penny-input-row ez-off-input">
        <div class="penny-input-wrap">
          <input class="input penny-input" id="ezOffInput" type="text" placeholder="${esc(t('ezo_placeholder'))}" autocomplete="off" aria-describedby="ezOffPills">
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  _ez.built = true;
  wrap.querySelectorAll('[data-ez-close]').forEach(b => b.addEventListener('click', ezClose));
  wrap.querySelector('[data-ez-wake]').addEventListener('click', ezWake);
  const inp = wrap.querySelector('#ezOffInput');
  inp.addEventListener('input', () => ezPaintPills());
  // Return asks the top suggestion; nothing typed is ever sent as it is.
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); wrap.querySelector('.ez-pill')?.click(); }
    if (e.key === 'Escape') ezClose();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('is-open')) ezClose(); });
}
function ezPaintPills() {
  const box = document.getElementById('ezOffPills');
  const inp = document.getElementById('ezOffInput');
  if (!box || !inp) return;
  const list = ezSuggest(inp.value, _ez.asked);
  box.innerHTML = list.map(e => `<button class="ez-pill" type="button" data-ez-ask="${esc(e.id)}"><span>${esc(e.q)}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg></button>`).join('');
  box.querySelectorAll('[data-ez-ask]').forEach(b => b.addEventListener('click', () => ezAsk(b.dataset.ezAsk)));
}
function ezAnswerText(e) {
  try { return typeof e.a === 'function' ? e.a() : e.a; }
  catch (err) { console.error('[ezzo offline]', e.id, err); return t('ezo_err'); }
}
function ezAsk(id) {
  const e = ezAllEntries().find(x => x.id === id);
  if (!e) return;
  const list = document.getElementById('ezOffMessages');
  document.querySelector('#ezOffDrawer .ez-off-welcome')?.classList.add('is-gone');
  const user = document.createElement('div');
  user.className = 'penny-msg penny-msg--user';
  user.innerHTML = `<div class="penny-msg-bubble"><div class="penny-msg-text"></div></div>`;
  user.querySelector('.penny-msg-text').textContent = e.q;
  list.appendChild(user);
  const inp = document.getElementById('ezOffInput');
  inp.value = '';
  _ez.lastId = e.id; _ez.asked.add(e.id);
  const row = document.createElement('div');
  row.className = 'penny-msg penny-msg--penny';
  row.innerHTML = `<span class="penny-msg-avatar">${EZ_SLEEP_SVG}</span><div class="penny-msg-bubble penny-typing"><span></span><span></span><span></span></div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  document.getElementById('ezOffPills').innerHTML = '';
  setTimeout(() => {
    const bubble = row.querySelector('.penny-msg-bubble');
    bubble.className = 'penny-msg-bubble';
    const fmtText = typeof pennyFormatMarkdown === 'function' ? pennyFormatMarkdown(ezAnswerText(e)) : esc(ezAnswerText(e));
    bubble.innerHTML = `<div class="penny-msg-text">${fmtText}</div>${e.go ? `<button class="btn btn-secondary btn-sm ez-go" type="button">${esc(e.go[0])}</button>` : ''}`;
    bubble.querySelector('.ez-go')?.addEventListener('click', () => { ezClose(); setTimeout(() => ezGo(e.go[1]), 120); });
    list.scrollTop = list.scrollHeight;
    ezPaintPills();
    if (window.matchMedia('(pointer: fine)').matches) inp.focus();
  }, 450);
}
// Where an answer's button takes you.
function ezGo(to) {
  if (typeof to === 'function') { to(); return; }
  if (to === 'quickadd') { openQuickAddTx(); return; }
  if (to === 'tools') { openToolsSheet(); return; }
  if (to === 'afford') { if (typeof openAffordCheck === 'function') openAffordCheck(); return; }
  if (to === 'period') { switchTab('dashboard'); setTimeout(() => document.getElementById('periodBtn')?.click(), 150); return; }
  if (to === 'explain') { switchTab('dashboard'); openFreeExplain(); return; }
  if (to === 'settings:penny') { ezWake(); return; }
  if (String(to).startsWith('settings')) { if (typeof _stgAll !== 'undefined' && to !== 'settings') _stgAll = true; switchTab('settings'); const sel = { 'settings:sync': '[data-sync-mode]', 'settings:theme': '.theme-opt', 'settings:persona': '.persona-grid', 'settings:tools': '[data-tool]', 'settings:export': '#exportCsvBtn', 'settings:currency': '#settCurrency', 'settings:rollover': '#settRollover' }[to];
    if (sel) setTimeout(() => document.querySelector('#bview-settings ' + sel)?.closest('.stg-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80); return; }
  const owner = typeof TOOLS !== 'undefined' && TOOLS.find(x => x.tab === to);
  if (owner && !toolOn(owner.id)) { toolSet(owner.id, true); toolsChanged(); showToast(tf('tools_toast_on', toolName(owner.id))); }
  switchTab(to);
}
function ezOpen() {
  if (!_ez.built) ezBuild();
  const d = document.getElementById('ezOffDrawer');
  d.classList.add('is-open');
  document.body.classList.add('penny-drawer-open');
  ezPaintPills();
  if (window.matchMedia('(pointer: fine)').matches) setTimeout(() => document.getElementById('ezOffInput')?.focus(), 200);
}
function ezClose() {
  document.getElementById('ezOffDrawer')?.classList.remove('is-open');
  if (!document.getElementById('pennyDrawer')?.classList.contains('is-open')) document.body.classList.remove('penny-drawer-open');
}
// Waking him means adding a key: the Ezzo card in Settings.
function ezWake() {
  ezClose();
  if (typeof _stgAll !== 'undefined') _stgAll = true;
  switchTab('settings');
  setTimeout(() => document.querySelector('.penny-settings-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
}
// The Ezzo button opens this while Ezzo is asleep, and online Ezzo once he
// is awake; online Ezzo's own handler is left to run then, untouched.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#pennyNavBtn');
  if (!b || !ezOfflineActive()) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  ezOpen();
}, true);

const EZO_WORDS = {
  ezo_title: 'Ezzo, asleep', ezo_sub: 'Asleep: answering from your planner',
  ezo_hello: 'Ezzo is having a nap',
  ezo_hello_sub: 'He can still answer hundreds of questions about your money and the planner. Start typing, then tap the question you mean.',
  ezo_wake: 'Wake Ezzo up for any question',
  ezo_placeholder: 'Type your question, then pick one below',
  ezo_pills: 'Questions Ezzo can answer',
  ezo_err: 'Ezzo mumbled something in his sleep. Try asking that another way.',
  ezo_open: 'Open'
};
(function ezoAddWords() { try { Object.assign(TRANSLATIONS.en, EZO_WORDS); } catch (e) {} })();
