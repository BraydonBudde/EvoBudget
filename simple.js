'use strict';
/* =====================================================================
   simple.js - a planner that starts small and grows with you.

   Three things live here:
   - Tools. Home, Budget, Transactions and Bills are always there. Goals,
     Debt Payoff, Calendar, Challenges, Can I afford it?, the Need/Want/Save
     split and the full dashboard are tools: off until someone asks for
     them in setup, in Settings, or from a suggestion that comes once.
   - The calm dashboard's own pieces: the first-week checklist, the one
     suggestion at a time, the urgent-only alert and "How is this worked
     out?". The calm view itself is drawn in renderDashboardLayout1.
   - Setup. One question per screen: pay, money in the account now, bills,
     everyday spending, what to help with. It ends on the person's own
     Free to spend number.

   Nothing here does any arithmetic of its own: every figure shown is the
   one the dashboard already works out, so the two can never disagree.
   ===================================================================== */

// ── Tools ────────────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'goals', tab: 'goals', ico: 'sinking' },
  { id: 'debt', tab: 'debt', ico: 'debt' },
  { id: 'calendar', tab: 'calendar', ico: 'calendar' },
  { id: 'challenges', tab: 'challenges', ico: 'challenges' },
  { id: 'afford', ico: 'afford' },
  { id: 'alloc', ico: 'tag' },
  { id: 'insights', ico: 'dashboard' }
];
const TOOL_IDS = TOOLS.map(x => x.id);

// The split keeps its own switch, so there is one truth for it.
function toolOn(id) {
  if (typeof state === 'undefined' || !state) return false;
  if (id === 'alloc') return !!(state.allocation && state.allocation.enabled);
  return !!(state.settings && state.settings.tools && state.settings.tools[id]);
}
function toolSet(id, on) {
  if (id === 'alloc') { if (state.allocation) state.allocation.enabled = !!on; return; }
  state.settings.tools = { ...(state.settings.tools || {}), [id]: !!on };
  // The full dashboard opens on its overview; switched off, home is calm.
  if (id === 'insights') state.settings.dashView = on ? 'overview' : 'calm';
}
function toolName(id) { return t('tool_' + id); }

if (typeof APP_ICONS !== 'undefined') {
  APP_ICONS.tools = '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><path d="M17 13.8v6.4"/><path d="M13.8 17h6.4"/>';
}

// Sections a tool owns are hidden while it is off, and every navigation
// (top tabs, sidebar, phone menu, swipe) is drawn from the tab bar, so
// hiding the tab hides it everywhere at once.
function applyTools() {
  const tabs = document.getElementById('ubpTabs');
  if (tabs) {
    TOOLS.forEach(x => {
      if (!x.tab) return;
      const b = tabs.querySelector(`.btab[data-btab="${x.tab}"]`);
      if (b) b.hidden = !toolOn(x.id);
    });
    let more = tabs.querySelector('.btab--tools');
    if (!more) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'btab btab--tools';
      more.innerHTML = `<i class="btab-ico" aria-hidden="true" data-ico="tools"></i><span class="btab-txt"></span>`;
      more.addEventListener('click', openToolsSheet);
      tabs.appendChild(more);
    }
    more.querySelector('.btab-txt').textContent = t('tools_more');
    more.title = t('tools_more');
    more.hidden = TOOLS.every(x => toolOn(x.id));
    try { paintTabIcons(); } catch (e) {}
  }
  if (!document.getElementById('toolsNavBtn')) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'toolsNavBtn'; b.hidden = true;
    b.addEventListener('click', openToolsSheet);
    document.body.appendChild(b);
  }
  try { applyNavPosition(); } catch (e) {}
}
function toolsChanged() {
  saveState();
  applyTools();
  const owner = TOOLS.find(x => x.tab === currentTab);
  if (owner && !toolOn(owner.id)) switchTab('dashboard');
  else dispatchRender(currentTab);
}

function toolRowHtml(x) {
  const on = toolOn(x.id);
  return `<label class="tool-row${on ? ' is-on' : ''}">
    <span class="tool-ico" aria-hidden="true">${appIconSvg(x.ico)}</span>
    <span class="tool-txt"><b>${esc(toolName(x.id))}</b><em>${esc(t('tool_' + x.id + '_d'))}</em></span>
    <span class="recurring-toggle"><input type="checkbox" data-tool="${x.id}" ${on ? 'checked' : ''}><span class="rec-toggle-track"></span></span>
  </label>`;
}
function wireToolRows(scope, after) {
  scope.querySelectorAll('input[data-tool]').forEach(inp => inp.addEventListener('change', () => {
    const id = inp.dataset.tool;
    toolSet(id, inp.checked);
    inp.closest('.tool-row')?.classList.toggle('is-on', inp.checked);
    toolsChanged();
    showToast(tf(inp.checked ? 'tools_toast_on' : 'tools_toast_off', toolName(id)));
    if (after) after();
  }));
}
// The card in Settings and the sheet from the navigation are one list.
function toolsCardHtml() {
  return `<div class="panel"><div class="panel-inner">
    <div class="settings-card-title">🧰 ${t('tools_title')}</div>
    <p class="settings-desc">${t('tools_desc')}</p>
    <div class="tool-list">${TOOLS.map(toolRowHtml).join('')}</div>
  </div></div>`;
}
function openToolsSheet() {
  document.getElementById('modalTitle').textContent = t('tools_title');
  document.getElementById('modalBody').innerHTML = `<div class="tools-sheet">
    <p class="settings-desc">${t('tools_desc')}</p>
    <div class="tool-list">${TOOLS.map(toolRowHtml).join('')}</div>
    <div class="edit-tx-actions"><button class="btn btn-primary" type="button" id="toolsDone">${t('tools_done')}</button></div>
  </div>`;
  const body = document.getElementById('modalBody');
  wireToolRows(body);
  body.querySelector('#toolsDone').addEventListener('click', closeModal);
  document.getElementById('tutorialOverlay').hidden = false;
}

// Quick add offers a goal or a debt payment only where there is one to
// pay into, or the tool for it is on.
function qaTypeShown(ty, current) {
  if (ty === current) return true;
  if (ty === 'sinking_fund') return toolOn('goals') || (state.sinkingFunds || []).length > 0;
  if (ty === 'debt') return toolOn('debt') || (state.debts || []).length > 0;
  return true;
}

// ── Dates ────────────────────────────────────────────────────────────────
const smToday = () => toLocalISO(new Date());
function smDaysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// ── How is this worked out? ──────────────────────────────────────────────
// The same sum the headline uses, laid out line by line.
function openFreeExplain() {
  const sum = computeSummary(computeActuals());
  const c = nlCommitted();
  const free = sum.leftover - c.total;
  const p = nlDaysInPeriod();
  const end = state.settings.periodEnd ? formatDateDisplay(state.settings.periodEnd) : '';
  const roll = state.rollover || 0;
  const row = (op, label, v, note) => `<div class="fx-row"><span class="fx-op">${op}</span><span class="fx-l">${esc(label)}${note ? `<em>${esc(note)}</em>` : ''}</span><b>${fmt(Math.abs(v))}</b></div>`;
  document.getElementById('modalTitle').textContent = t('fx_title');
  document.getElementById('modalBody').innerHTML = `<div class="fx">
    <p class="settings-desc">${t('fx_intro')}</p>
    <div class="fx-rows">
      ${row('', t('fx_in'), sum.totalIncome)}
      ${roll ? row(roll > 0 ? '+' : '−', t(roll > 0 ? 'fx_roll' : 'fx_roll_neg'), roll, t(roll > 0 ? 'fx_roll_note' : 'fx_roll_neg_note')) : ''}
      ${row('−', t('fx_out'), sum.totalOut)}
      ${sum.totalSavings ? row('−', t('fx_saved'), sum.totalSavings) : ''}
      ${row('−', tf('fx_due', end), c.total, c.items.length ? tf('fx_due_note', c.items.length) : t('nl_nothing_due'))}
      <div class="fx-row fx-total"><span class="fx-op">=</span><span class="fx-l">${t('nl_free_to_spend')}</span><b>${free < 0 ? '−' : ''}${fmt(Math.abs(free))}</b></div>
    </div>
    ${free > 0 && p.left > 0 ? `<p class="fx-foot">${tf('fx_per_day', fmt(free / p.left), p.left)}</p>` : ''}
    <div class="edit-tx-actions"><button class="btn btn-primary" type="button" id="fxClose">${t('rfh_close')}</button></div>
  </div>`;
  document.getElementById('fxClose').addEventListener('click', closeModal);
  document.getElementById('tutorialOverlay').hidden = false;
}

// ── Your first week ──────────────────────────────────────────────────────
// A short list that ticks itself off from what has actually happened, so
// there is nothing to remember to mark.
function fwItems() {
  const tx = state.transactions || [];
  const items = [
    { id: 'setup', done: state.settings.setupDone === true, btn: 'fw_setup_btn' },
    { id: 'spend', done: tx.some(x => x.type === 'expense' && !x.setup), btn: 'fw_spend_btn' }
  ];
  if ((state.bills || []).length) items.push({ id: 'bill', done: tx.some(x => (x.type === 'bill' || x.type === 'debt') && !x.setup), btn: 'fw_bill_btn' });
  let synced = false;
  try { synced = syncGetMode('ubp') === 'google'; } catch (e) {}
  items.push({ id: 'safe', done: synced || !!state.settings.exportedOn, btn: 'fw_safe_btn' });
  items.push({ id: 'back', done: !!state.settings.firstSeen && smToday() > state.settings.firstSeen });
  return items;
}
function fwVisible() {
  if (state.settings.fwHidden) return false;
  const first = state.settings.firstSeen;
  if (first && smDaysBetween(first, smToday()) > 21) return false;
  return fwItems().some(i => !i.done);
}
function fwHtml() {
  if (!fwVisible()) return '';
  const items = fwItems(), done = items.filter(i => i.done).length;
  const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  return `<section class="panel fw"><div class="panel-inner-sm">
    <div class="fw-head"><h3 class="ov-title">${t('fw_title')}</h3><span class="fw-count">${tf('fw_count', done, items.length)}</span>
      <button class="link-btn fw-hide" type="button" data-fw-hide>${t('fw_hide')}</button></div>
    <div class="fw-bar" aria-hidden="true"><i style="width:${Math.round(done / items.length * 100)}%"></i></div>
    <ul class="fw-list">${items.map(i => `<li class="fw-item${i.done ? ' is-done' : ''}">
      <span class="fw-check">${i.done ? tick : ''}</span>
      <span class="fw-txt"><b>${t('fw_' + i.id)}</b><em>${t('fw_' + i.id + '_d')}</em></span>
      ${!i.done && i.btn ? `<button class="btn btn-secondary btn-sm fw-go" type="button" data-fw="${i.id}">${t(i.btn)}</button>` : ''}
    </li>`).join('')}</ul>
  </div></section>`;
}
function fwGo(id) {
  if (id === 'setup') setupOpen();
  else if (id === 'spend') openQuickAddTx();
  else if (id === 'bill') switchTab('bills');
  else if (id === 'safe') {
    switchTab('settings');
    requestAnimationFrame(() => document.querySelector('#bview-settings [data-sync-mode]')?.closest('.stg-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
}

// ── One suggestion at a time ─────────────────────────────────────────────
// A tool is offered when something someone has done shows it would help,
// never on the day they set up, and never again once they say no.
const NUDGES = [
  { tool: 'debt', when: () => (state.debts || []).length > 0 || (state.bills || []).some(b => /loan|card|credit|mortgage|finance|klarna|afterpay|overdraft/i.test(b.name || '')) },
  { tool: 'calendar', when: () => (state.bills || []).filter(b => b.active !== false).length >= 5 },
  { tool: 'afford', when: () => (state.transactions || []).filter(x => x.type === 'expense' && !x.setup).length >= 12 },
  { tool: 'goals', when: () => { const s = computeSummary(computeActuals()); return s.totalIncome > 0 && s.totalIncome - s.totalOut > s.totalIncome * 0.15 && nlDaysInPeriod().dayOf >= 7; } }
];
function nudgeNow() {
  const first = state.settings.firstSeen;
  if (!state.settings.setupDone || !first || first >= smToday()) return null;
  const no = state.settings.toolNudgeNo || {};
  for (const n of NUDGES) {
    if (toolOn(n.tool) || no[n.tool]) continue;
    try { if (n.when()) return n; } catch (e) {}
  }
  return null;
}
function nudgeHtml() {
  const n = nudgeNow();
  if (!n) return '';
  const x = TOOLS.find(y => y.id === n.tool);
  return `<section class="panel nudge"><div class="panel-inner-sm">
    <span class="tool-ico" aria-hidden="true">${appIconSvg(x.ico)}</span>
    <span class="nudge-txt"><b>${esc(toolName(n.tool))}</b><em>${t('nudge_' + n.tool)}</em></span>
    <span class="nudge-acts"><button class="btn btn-primary btn-sm" type="button" data-nudge-on="${n.tool}">${t('nudge_on')}</button>
      <button class="link-btn" type="button" data-nudge-no="${n.tool}">${t('nudge_no')}</button></span>
  </div></section>`;
}

// ── The calm dashboard ───────────────────────────────────────────────────
// Free to spend and what is due next, then only what needs doing: the
// first-week list or one suggestion, and anything urgent that Coming up
// does not already show.
function calmAlertHtml(rf) {
  const high = (rf || []).filter(x => huBucket(x) === 'high' && !/^(bill|debt)_/.test(x.kind || ''));
  if (!high.length) return '';
  return `<button class="panel calm-alert" type="button" data-calm-alert>
    <span class="calm-alert-ico" aria-hidden="true">!</span>
    <span class="calm-alert-txt"><b>${high.length === 1 ? t('calm_alert_one') : tf('calm_alert_n', high.length)}</b><em>${esc(high[0].title)}</em></span>
    <span class="calm-alert-go" aria-hidden="true">→</span>
  </button>`;
}
function calmDashHtml(sum, subMo, rf) {
  const fw = fwHtml();
  return `${nlHeroHtml(sum.leftover, { income: sum.totalIncome, subsMonthly: subMo, cuLimit: 3 })}
    ${calmAlertHtml(rf)}
    ${fw || nudgeHtml()}
    <div class="calm-foot"><button class="calm-more" type="button" data-calm-more>${t('calm_more')}</button></div>`;
}
function wireCalmDash(el) {
  el.querySelectorAll('[data-fw]').forEach(b => b.addEventListener('click', () => fwGo(b.dataset.fw)));
  el.querySelector('[data-fw-hide]')?.addEventListener('click', () => { state.settings.fwHidden = true; saveState(); dashQuietNext(); renderDashboard(); });
  el.querySelectorAll('[data-nudge-on]').forEach(b => b.addEventListener('click', () => {
    toolSet(b.dataset.nudgeOn, true); toolsChanged();
    showToast(tf('tools_toast_on', toolName(b.dataset.nudgeOn)));
  }));
  el.querySelectorAll('[data-nudge-no]').forEach(b => b.addEventListener('click', () => {
    state.settings.toolNudgeNo = { ...(state.settings.toolNudgeNo || {}), [b.dataset.nudgeNo]: true };
    saveState(); dashQuietNext(); renderDashboard();
  }));
  el.querySelector('[data-calm-alert]')?.addEventListener('click', () => switchTab('notifications'));
  el.querySelector('[data-calm-more]')?.addEventListener('click', () => {
    toolSet('insights', true); saveState(); applyTools(); _dashEntering = true; renderDashboard();
    showToast(tf('tools_toast_on', toolName('insights')));
  });
}
// Saving a copy counts as keeping the budget safe.
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#exportCsvBtn') && typeof state !== 'undefined' && state) {
    state.settings.exportedOn = smToday(); saveState();
  }
}, true);

// ══ Setup ═══════════════════════════════════════════════════════════════
// One question per screen. Nothing is written until the last question is
// answered, so leaving halfway leaves the planner as it was and setup simply
// offers itself again next time.
const SETUP_STEPS = ['welcome', 'pay', 'amount', 'now', 'bills', 'plan', 'help', 'done'];
const SETUP_FREQS = ['month', 'w2', 'w1', 'w4', 'varies'];
const SETUP_BILLS = ['Rent', 'Mortgage', 'Electricity', 'Water', 'Phone', 'Internet', 'Insurance', 'Car payment', 'Streaming', 'Gym'];
const SETUP_PLAN = ['Groceries', 'Eating out', 'Transport', 'Shopping', 'Entertainment'];
// A starting point for anyone who would rather edit than invent: shares of
// what is left after bills, leaving some of it unplanned on purpose.
const SETUP_SPLIT = { 'Groceries': .3, 'Eating out': .1, 'Transport': .15, 'Shopping': .1, 'Entertainment': .08 };
const SETUP_HELP = [
  { id: 'goals', tools: ['goals'], ico: 'sinking' },
  { id: 'debt', tools: ['debt'], ico: 'debt' },
  { id: 'calendar', tools: ['calendar'], ico: 'calendar' },
  { id: 'impulse', tools: ['challenges', 'afford'], ico: 'challenges' },
  { id: 'alloc', tools: ['alloc'], ico: 'tag' },
  { id: 'insights', tools: ['insights'], ico: 'dashboard' }
];
let _setup = null;

function setupCurrencyGuess() {
  try {
    const region = (new Intl.Locale(navigator.language)).maximize().region;
    return ({ US: 'USD', GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR',
      PL: 'PLN', JP: 'JPY', CA: 'CAD', AU: 'AUD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', IN: 'INR', BR: 'BRL', MX: 'MXN', ZA: 'ZAR' })[region] || null;
  } catch (e) { return null; }
}
const SETUP_CURRENCIES = [['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['PLN', 'zł'], ['JPY', '¥'], ['CAD', '$'], ['AUD', '$'], ['CHF', 'CHF'],
  ['SEK', 'kr'], ['NOK', 'kr'], ['DKK', 'kr'], ['INR', '₹'], ['BRL', 'R$'], ['MXN', '$'], ['ZAR', 'R']];

function setupHasData() {
  if ((state.transactions || []).length || (state.debts || []).length || (state.sinkingFunds || []).length || (state.bills || []).length) return true;
  return Object.values(state.budgets || {}).some(arr => (arr || []).some(r => (r.expected || 0) > 0));
}
// Called once the dashboard is up. A brand-new planner opens setup; anyone
// who skipped it finds it again on the first-week list.
function maybeStartOnboarding() {
  if (_setup || state.settings.onboardingDone || setupHasData()) return;
  setupOpen();
}
function setupOpen() {
  const cur = setupCurrencyGuess();
  const pick = SETUP_CURRENCIES.find(c => c[0] === (state.settings.onboardingDone ? state.settings.currency : (cur || state.settings.currency))) || SETUP_CURRENCIES[0];
  _setup = { step: 0, freq: 'month', last: smToday(), pay: '', bal: '', cur: pick[0] + '|' + pick[1],
    bills: [], plan: SETUP_PLAN.map(n => ({ name: n, amount: '' })), help: new Set() };
  const ov = document.createElement('div');
  ov.className = 'onb-overlay setup-ov';
  ov.id = 'onbOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = '<div class="onb-card setup-card" role="document"></div>';
  document.body.appendChild(ov);
  setupPaint();
  requestAnimationFrame(() => ov.classList.add('is-in'));
}
function setupClose(then) {
  const ov = document.getElementById('onbOverlay');
  _setup = null;
  if (!ov) { if (then) then(); return; }
  ov.classList.add('is-leaving');
  setTimeout(() => { ov.remove(); if (then) then(); }, 220);
}
function setupSkip() {
  state.settings.onboardingDone = true;
  if (!state.settings.firstSeen) state.settings.firstSeen = smToday();
  saveState();
  setupClose(() => { if (currentTab === 'dashboard') renderDashboard(); });
}

const setupSym = () => (_setup.cur.split('|')[1] || '$');
const setupNum = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return n > 0 ? Math.round(n * 100) / 100 : 0; };
const setupMoney = n => { const s = setupSym(); return s.length > 1 && /^[A-Za-z]/.test(s) ? `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${s}` : `${s}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
function setupPeriodWord() { return t('setup_per_' + (_setup.freq === 'varies' ? 'month' : _setup.freq)); }
// Bills are monthly here, so a shorter pay cycle carries its share of them.
function setupBillsPerPeriod() {
  const monthly = _setup.bills.reduce((s, b) => s + setupNum(b.amount), 0);
  const days = { w1: 7, w2: 14, w4: 28 }[_setup.freq];
  return days ? Math.round(monthly * days / 30.4375 * 100) / 100 : monthly;
}
function setupBillRoom() {
  if (!isTrial()) return Infinity;
  return Math.max(0, TRIAL_LIMITS.subscriptions - trialCount('subscriptions', (state.bills || []).length));
}

function setupAmountField(id, value, label) {
  return `<label class="setup-money"><span class="setup-money-sym">${esc(setupSym())}</span>
    <input class="input setup-money-in" id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(value)}" aria-label="${esc(label)}"></label>`;
}
function setupDots() {
  const n = SETUP_STEPS.length - 2, at = _setup.step;
  if (at === 0 || at > n) return '';
  return `<div class="onb-progress">${Array.from({ length: n }, (_, i) => `<span class="onb-progress-dot${i + 1 === at ? ' is-active' : i + 1 < at ? ' is-done' : ''}"></span>`).join('')}</div>`;
}
function setupNav(nextLabel, opts) {
  const o = opts || {};
  return `<div class="setup-nav">
    ${_setup.step > 1 && _setup.step < SETUP_STEPS.length - 1 ? `<button class="btn btn-ghost setup-back" type="button" data-setup-back>${t('setup_back')}</button>` : '<span></span>'}
    <div class="setup-nav-r">
      ${o.skip ? `<button class="link-btn setup-skip-step" type="button" data-setup-skipstep>${t(o.skip)}</button>` : ''}
      <button class="btn btn-primary setup-next" type="button" data-setup-next>${t(nextLabel || 'setup_next')}</button>
    </div>
  </div>
  <p class="setup-err" id="setupErr" hidden></p>`;
}

function setupStepHtml() {
  const S = _setup, step = SETUP_STEPS[S.step];
  if (step === 'welcome') return `
    <div class="setup-hero-ico" aria-hidden="true">${appIconSvg('dashboard')}</div>
    <h2 class="onb-title">${t('setup_w_title')}</h2>
    <p class="onb-sub">${t('setup_w_sub')}</p>
    <ul class="setup-w-list">
      <li>${t('setup_w_1')}</li><li>${t('setup_w_2')}</li><li>${t('setup_w_3')}</li>
    </ul>
    <div class="onb-actions">
      <button class="btn btn-primary" type="button" data-setup-next>${t('setup_w_go')}</button>
      <button class="onb-skip-link" type="button" data-setup-skip>${t('setup_w_skip')}</button>
    </div>`;
  if (step === 'pay') return `${setupDots()}
    <h2 class="onb-title">${t('setup_pay_title')}</h2>
    <p class="onb-sub">${t('setup_pay_sub')}</p>
    <div class="setup-chips setup-chips--2" role="radiogroup">${SETUP_FREQS.map(f => `<button class="setup-chip${S.freq === f ? ' is-on' : ''}${f === 'varies' ? ' setup-chip--wide' : ''}" type="button" role="radio" aria-checked="${S.freq === f}" data-freq="${f}">${t('setup_freq_' + f)}</button>`).join('')}</div>
    ${S.freq === 'varies' ? `<p class="setup-note">${t('setup_varies_note')}</p>` : `
    <div class="setup-q">${t('setup_last_q')}</div>
    <div class="setup-last">
      <button class="setup-chip${S.last === smToday() ? ' is-on' : ''}" type="button" data-last="0">${t('cu_today_cap')}</button>
      <button class="setup-chip${S.last === toLocalISO(new Date(Date.now() - 86400000)) ? ' is-on' : ''}" type="button" data-last="1">${t('cu_yesterday_cap')}</button>
      ${styledDateField('setupLast', 'setupLastWrap', S.last)}
    </div>`}
    <label class="setup-cur"><span>${t('currency')}</span><select class="select" id="setupCur">${SETUP_CURRENCIES.map(([c, s]) => `<option value="${c}|${s}"${S.cur === c + '|' + s ? ' selected' : ''}>${c} (${s})</option>`).join('')}</select></label>
    ${setupNav()}`;
  if (step === 'amount') return `${setupDots()}
    <h2 class="onb-title">${t(S.freq === 'varies' ? 'setup_amt_title_v' : 'setup_amt_title')}</h2>
    <p class="onb-sub">${t('setup_amt_sub')}</p>
    ${setupAmountField('setupPay', S.pay, t('setup_amt_title'))}
    ${setupNav()}`;
  if (step === 'now') return `${setupDots()}
    <h2 class="onb-title">${t('setup_now_title')}</h2>
    <p class="onb-sub">${t(S.freq === 'varies' ? 'setup_now_sub_v' : 'setup_now_sub')}</p>
    ${setupAmountField('setupBal', S.bal, t('setup_now_title'))}
    <p class="setup-note">${t('setup_now_note')}</p>
    ${setupNav('setup_next', { skip: 'setup_skip_q' })}`;
  if (step === 'bills') {
    const room = setupBillRoom(), full = S.bills.length >= room;
    const used = new Set(S.bills.map(b => b.name));
    return `${setupDots()}
    <h2 class="onb-title">${t('setup_bills_title')}</h2>
    <p class="onb-sub">${t('setup_bills_sub')}</p>
    <div class="setup-pills">${SETUP_BILLS.filter(n => !used.has(n)).map(n => `<button class="setup-pill" type="button" data-addbill="${esc(n)}"${full ? ' disabled' : ''}>+ ${esc(n)}</button>`).join('')}
      <button class="setup-pill setup-pill--other" type="button" data-addbill=""${full ? ' disabled' : ''}>+ ${t('setup_other')}</button></div>
    ${room !== Infinity ? `<p class="setup-note">${room > 0 ? tf('setup_bills_trial', room) : t('setup_bills_trial_none')}</p>` : ''}
    ${S.bills.length ? `<div class="setup-rows">
      <div class="setup-row setup-row--head"><span>${t('setup_col_name')}</span><span>${t('setup_col_amount')}</span><span>${t('setup_col_day')}</span><span></span></div>
      ${S.bills.map((b, i) => `<div class="setup-row" data-bill="${i}">
        <input class="input" type="text" data-bf="name" value="${esc(b.name)}" placeholder="${esc(t('setup_bill_ph'))}" aria-label="${esc(t('setup_col_name'))}" maxlength="40">
        ${setupAmountField('setupBillAmt' + i, b.amount, t('setup_col_amount'))}
        <select class="select" data-bf="day" aria-label="${esc(t('setup_col_day'))}"><option value="">${t('setup_day_unsure')}</option>${Array.from({ length: 31 }, (_, d) => `<option value="${d + 1}"${String(b.day) === String(d + 1) ? ' selected' : ''}>${d + 1}</option>`).join('')}</select>
        <button class="btn-icon setup-x" type="button" data-rmbill="${i}" aria-label="${esc(t('nw_remove'))}">×</button>
      </div>`).join('')}
    </div>
    <p class="setup-total">${tf('setup_bills_total', setupMoney(S.bills.reduce((s, b) => s + setupNum(b.amount), 0)))}</p>`
      : `<p class="setup-empty">${t('setup_bills_empty')}</p>`}
    ${setupNav(S.bills.length ? 'setup_next' : 'setup_no_bills')}`;
  }
  if (step === 'plan') {
    const pay = setupNum(S.pay), bills = setupBillsPerPeriod();
    const planned = S.plan.reduce((s, r) => s + setupNum(r.amount), 0);
    const left = Math.round((pay - bills - planned) * 100) / 100;
    return `${setupDots()}
    <h2 class="onb-title">${t('setup_plan_title')}</h2>
    <p class="onb-sub">${tf('setup_plan_sub', setupPeriodWord())}</p>
    <div class="setup-sum">
      <span><em>${t(S.freq === 'varies' ? 'setup_sum_in_v' : 'setup_sum_pay')}</em><b>${setupMoney(pay)}</b></span>
      <span><em>${t('setup_sum_bills')}</em><b>− ${setupMoney(bills)}</b></span>
      <span><em>${t('setup_sum_planned')}</em><b id="setupPlanned">− ${setupMoney(planned)}</b></span>
      <span class="setup-sum-left${left < 0 ? ' is-neg' : ''}"><em>${t(left < 0 ? 'setup_sum_over' : 'setup_sum_left')}</em><b id="setupLeft">${setupMoney(Math.abs(left))}</b></span>
    </div>
    <div class="setup-rows setup-rows--plan">${S.plan.map((r, i) => `<div class="setup-row setup-row--plan" data-plan="${i}">
      <input class="input" type="text" data-pf="name" value="${esc(r.name)}" maxlength="40" aria-label="${esc(t('setup_col_name'))}" placeholder="${esc(t('setup_cat_ph'))}">
      ${setupAmountField('setupPlanAmt' + i, r.amount, t('setup_col_amount'))}
      <button class="btn-icon setup-x" type="button" data-rmplan="${i}" aria-label="${esc(t('nw_remove'))}">×</button>
    </div>`).join('')}</div>
    <div class="setup-plan-acts">
      <button class="link-btn" type="button" data-addplan>+ ${t('setup_add_cat')}</button>
      ${pay > bills ? `<button class="link-btn" type="button" data-suggest>${t('setup_suggest')}</button>` : ''}
    </div>
    <p class="setup-note">${t('setup_plan_note')}</p>
    ${setupNav('setup_next', { skip: 'setup_plan_later' })}`;
  }
  if (step === 'help') return `${setupDots()}
    <h2 class="onb-title">${t('setup_help_title')}</h2>
    <p class="onb-sub">${t('setup_help_sub')}</p>
    <div class="setup-help">${SETUP_HELP.map(h => `<button class="setup-help-card${S.help.has(h.id) ? ' is-on' : ''}" type="button" aria-pressed="${S.help.has(h.id)}" data-help-pick="${h.id}">
      <span class="tool-ico" aria-hidden="true">${appIconSvg(h.ico)}</span>
      <span class="setup-help-txt"><b>${t('setup_help_' + h.id)}</b><em>${esc(tf('setup_adds', h.tools.map(toolName).join(t('setup_and'))))}</em></span>
      <span class="setup-help-tick" aria-hidden="true"></span>
    </button>`).join('')}</div>
    <p class="setup-note">${t('setup_help_note')}</p>
    ${setupNav('setup_finish')}`;
  // done
  const sum = computeSummary(computeActuals()), c = nlCommitted(), p = nlDaysInPeriod();
  const free = sum.leftover - c.total;
  const end = state.settings.periodEnd ? formatDateDisplay(state.settings.periodEnd) : '';
  return `<div class="setup-hero-ico setup-hero-ico--done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
    <h2 class="onb-title">${t('setup_done_title')}</h2>
    <div class="setup-free">
      <span>${t('nl_free_to_spend')}</span>
      <strong${free < 0 ? ' class="is-neg"' : ''}>${free < 0 ? '−' : ''}${fmt(Math.abs(free))}</strong>
      <em>${free > 0 && p.left > 0 ? tf('setup_done_rate', end, fmt(free / p.left)) : sum.totalIncome || state.rollover ? tf('setup_done_until', end) : t('setup_done_none')}</em>
    </div>
    <p class="onb-sub">${t(c.total > 0 ? 'setup_done_bills' : 'setup_done_sub')}</p>
    ${(() => { const n = (state.bills || []).filter(b => b.active !== false && !b.nextBillingDate).length;
      return n ? `<p class="setup-note setup-note--warn">${n === 1 ? t('setup_done_nodate_1') : tf('setup_done_nodate', n)}</p>` : ''; })()}
    <div class="onb-actions"><button class="btn btn-primary" type="button" data-setup-go>${t('setup_done_go')}</button></div>`;
}

function setupPaint() {
  const card = document.querySelector('#onbOverlay .setup-card');
  if (!card || !_setup) return;
  card.innerHTML = setupStepHtml();
  card.scrollTop = 0;
  document.getElementById('onbOverlay').setAttribute('aria-label', card.querySelector('.onb-title')?.textContent || '');
  setupWire(card);
  const first = card.querySelector('.setup-money-in, input[data-bf="name"]');
  if (first && !('ontouchstart' in window)) first.focus({ preventScroll: true });
}
function setupErr(card, key) {
  const e = card.querySelector('#setupErr');
  if (e) { e.textContent = t(key); e.hidden = false; }
}
// Field values are read into the draft before any redraw, so nothing typed
// is ever lost by adding a row or going back.
function setupRead(card) {
  const S = _setup;
  card.querySelectorAll('[data-bill]').forEach(row => {
    const b = S.bills[+row.dataset.bill]; if (!b) return;
    b.name = row.querySelector('[data-bf="name"]').value;
    b.amount = row.querySelector('.setup-money-in').value;
    b.day = row.querySelector('[data-bf="day"]').value;
  });
  card.querySelectorAll('[data-plan]').forEach(row => {
    const r = S.plan[+row.dataset.plan]; if (!r) return;
    r.name = row.querySelector('[data-pf="name"]').value;
    r.amount = row.querySelector('.setup-money-in').value;
  });
  const pay = card.querySelector('#setupPay'); if (pay) S.pay = pay.value;
  const bal = card.querySelector('#setupBal'); if (bal) S.bal = bal.value;
  const cur = card.querySelector('#setupCur'); if (cur) S.cur = cur.value;
  const last = card.querySelector('#setupLast'); if (last && last.value) S.last = last.value;
}
function setupWire(card) {
  const S = _setup;
  const go = d => { setupRead(card); S.step = Math.max(0, Math.min(SETUP_STEPS.length - 1, S.step + d)); setupPaint(); };
  const repaint = () => { setupRead(card); setupPaint(); };
  card.querySelector('[data-setup-skip]')?.addEventListener('click', setupSkip);
  card.querySelector('[data-setup-back]')?.addEventListener('click', () => go(-1));
  card.querySelector('[data-setup-go]')?.addEventListener('click', () => setupClose(() => { switchTab('dashboard'); }));
  card.querySelectorAll('[data-freq]').forEach(b => b.addEventListener('click', () => { setupRead(card); S.freq = b.dataset.freq; setupPaint(); }));
  card.querySelectorAll('[data-last]').forEach(b => b.addEventListener('click', () => {
    setupRead(card); S.last = toLocalISO(new Date(Date.now() - (+b.dataset.last) * 86400000)); setupPaint();
  }));
  if (card.querySelector('#setupLast')) bindDateField('setupLast', 'setupLastWrap', () => { setupRead(card); setupPaint(); });
  card.querySelector('#setupCur')?.addEventListener('change', repaint);
  card.querySelectorAll('[data-addbill]').forEach(b => b.addEventListener('click', () => {
    setupRead(card);
    if (S.bills.length >= setupBillRoom()) return;
    S.bills.push({ name: b.dataset.addbill, amount: '', day: '' });
    setupPaint();
    const rows = document.querySelectorAll('#onbOverlay [data-bill]');
    const last = rows[rows.length - 1];
    (b.dataset.addbill ? last?.querySelector('.setup-money-in') : last?.querySelector('[data-bf="name"]'))?.focus();
  }));
  card.querySelectorAll('[data-rmbill]').forEach(b => b.addEventListener('click', () => { setupRead(card); S.bills.splice(+b.dataset.rmbill, 1); setupPaint(); }));
  card.querySelectorAll('[data-rmplan]').forEach(b => b.addEventListener('click', () => { setupRead(card); S.plan.splice(+b.dataset.rmplan, 1); setupPaint(); }));
  card.querySelector('[data-addplan]')?.addEventListener('click', () => {
    setupRead(card); S.plan.push({ name: '', amount: '' }); setupPaint();
    const rows = document.querySelectorAll('#onbOverlay [data-plan]');
    rows[rows.length - 1]?.querySelector('[data-pf="name"]').focus();
  });
  card.querySelector('[data-suggest]')?.addEventListener('click', () => {
    setupRead(card);
    const room = setupNum(S.pay) - setupBillsPerPeriod();
    S.plan.forEach(r => {
      const share = SETUP_SPLIT[r.name.trim()];
      if (share && !setupNum(r.amount)) r.amount = String(Math.max(5, Math.round(room * share / 5) * 5));
    });
    setupPaint();
  });
  // The running totals follow every keystroke without a redraw.
  card.querySelectorAll('[data-plan] .setup-money-in').forEach(inp => inp.addEventListener('input', () => {
    setupRead(card);
    const planned = S.plan.reduce((s, r) => s + setupNum(r.amount), 0);
    const left = Math.round((setupNum(S.pay) - setupBillsPerPeriod() - planned) * 100) / 100;
    card.querySelector('#setupPlanned').textContent = '− ' + setupMoney(planned);
    const box = card.querySelector('.setup-sum-left');
    box.classList.toggle('is-neg', left < 0);
    box.querySelector('em').textContent = t(left < 0 ? 'setup_sum_over' : 'setup_sum_left');
    box.querySelector('b').textContent = setupMoney(Math.abs(left));
  }));
  card.querySelectorAll('[data-bill] .setup-money-in').forEach(inp => inp.addEventListener('input', () => {
    setupRead(card);
    const tot = card.querySelector('.setup-total');
    if (tot) tot.textContent = tf('setup_bills_total', setupMoney(S.bills.reduce((s, b) => s + setupNum(b.amount), 0)));
  }));
  card.querySelectorAll('[data-help-pick]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.helpPick;
    S.help.has(id) ? S.help.delete(id) : S.help.add(id);
    b.classList.toggle('is-on', S.help.has(id)); b.setAttribute('aria-pressed', S.help.has(id));
  }));
  card.querySelector('[data-setup-skipstep]')?.addEventListener('click', () => {
    setupRead(card);
    if (SETUP_STEPS[S.step] === 'now') S.bal = '';
    if (SETUP_STEPS[S.step] === 'plan') S.plan.forEach(r => { r.amount = ''; });
    S.step++; setupPaint();
  });
  card.querySelector('[data-setup-next]')?.addEventListener('click', () => {
    setupRead(card);
    const step = SETUP_STEPS[S.step];
    if (step === 'pay' && S.freq !== 'varies' && (!S.last || S.last > smToday())) { setupErr(card, 'setup_err_last'); return; }
    if (step === 'amount' && !setupNum(S.pay)) { setupErr(card, 'setup_err_pay'); card.querySelector('#setupPay')?.focus(); return; }
    if (step === 'bills') {
      S.bills = S.bills.filter(b => b.name.trim() || setupNum(b.amount));
      if (S.bills.some(b => !b.name.trim() || !setupNum(b.amount))) { setupErr(card, 'setup_err_bill'); return; }
    }
    if (step === 'help') { setupCommit(); }
    go(1);
  });
  card.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && inp.classList.contains('setup-money-in') && (card.querySelector('#setupPay') === inp || card.querySelector('#setupBal') === inp)) {
      e.preventDefault(); card.querySelector('[data-setup-next]')?.click();
    }
  }));
}

// Everything answered is written at once.
function setupCommit() {
  const S = _setup, today = smToday();
  const [currency, symbol] = S.cur.split('|');
  state.settings.currency = currency; state.settings.symbol = symbol;
  try { syncSymbol(); } catch (e) {}

  // The period follows the pay: it starts on the last payday and ends the
  // day before the next. Pay that varies gets the calendar month.
  let r;
  if (S.freq === 'varies') r = { kind: 'month' };
  else if (S.freq === 'month') r = { kind: 'payday', day: new Date(S.last + 'T00:00:00').getDate() };
  else r = { kind: S.freq, anchor: S.last };
  const [ps, pe] = bpPeriodFor(r, today);
  state.settings.periodRhythm = { kind: r.kind, day: r.day || null, anchor: r.anchor || null, auto: true, since: today };
  state.settings.periodStart = ps; state.settings.periodEnd = pe;
  bpMarkChosen();

  // Pay: the plan for every period, and this period's pay as it landed.
  const pay = setupNum(S.pay), bal = S.bal === '' ? null : Math.max(0, parseFloat(String(S.bal).replace(/[^0-9.]/g, '')) || 0);
  const income = state.budgets.income = state.budgets.income || [];
  let row = income.find(x => x.category === 'Salary');
  if (!row) { row = { id: uid(), category: 'Salary', expected: 0 }; income.unshift(row); }
  row.expected = pay;
  const hasIncome = (state.transactions || []).some(x => x.type === 'income' && x.date >= ps && x.date <= pe);
  rolloverMaps();
  if (S.freq !== 'varies') {
    if (!hasIncome) state.transactions.push({ id: uid(), date: ps, type: 'income', category: 'Salary', amount: pay, description: t('setup_tx_pay'), allocation: null, setup: true });
    // What is in the account now makes the number right from today. The
    // difference from the pay is carried into this period: more than the pay
    // was already there, or less because some of it went before tracking
    // began. It belongs to this period only; the next one carries over what
    // is really left, as it always does.
    if (bal != null && !hasIncome) {
      const diff = Math.round((bal - pay) * 100) / 100;
      if (diff) { state.rollover = diff; state.rolloverHistory[ps] = diff; state.rolloverManual[ps] = true; }
    }
  } else if (bal != null) {
    state.rollover = bal; state.rolloverHistory[ps] = bal; state.rolloverManual[ps] = true;
  }

  // Bills, each falling due on its own day of the month.
  const have = new Set((state.bills || []).map(b => (b.name || '').toLowerCase()));
  const subs = /stream|netflix|spotify|disney|hulu|prime|youtube|gym|apple|music|icloud|xbox|playstation/i;
  S.bills.slice(0, setupBillRoom()).forEach(b => {
    const name = b.name.trim(), amount = setupNum(b.amount);
    if (!name || !amount || have.has(name.toLowerCase())) return;
    const isSub = subs.test(name);
    state.bills.push({ id: uid(), name, amount, frequency: 'monthly',
      category: /gym/i.test(name) ? 'Health & Fitness' : isSub ? 'Entertainment' : /insurance|loan|card|mortgage|car payment/i.test(name) ? 'Finance' : 'Other',
      nextBillingDate: b.day ? nextDueFromDay(b.day) : '', active: true, allocation: null, kind: isSub ? 'subscription' : 'bill', payTxIds: [] });
    trialUse('subscriptions');
  });

  // Everyday spending: the planned amount for each category named.
  const exp = state.budgets.expenses = state.budgets.expenses || [];
  S.plan.forEach(p => {
    const name = p.name.trim(), amount = setupNum(p.amount);
    if (!name || !amount) return;
    const hit = exp.find(x => (x.category || '').toLowerCase() === name.toLowerCase());
    if (hit) hit.expected = amount; else exp.push({ id: uid(), category: name, expected: amount });
  });

  SETUP_HELP.forEach(h => h.tools.forEach(id => toolSet(id, S.help.has(h.id))));
  state.settings.setupDone = true;
  state.settings.onboardingDone = true;
  if (!state.settings.firstSeen) state.settings.firstSeen = today;
  saveState();
  applyTools();
  try { trackEvent('feature_used', { feature: 'setup_done', freq: S.freq, bills: S.bills.length, tools: [...S.help].join(',') }); } catch (e) {}
  dispatchRender(currentTab);
}

// ── Words ────────────────────────────────────────────────────────────────
const SIMPLE_WORDS = {
  tools_title: 'Tools', tools_more: 'Add tools',
  tools_desc: 'Switch on what helps you, and leave the rest out of the way. Everything you have entered stays, whatever is switched off.',
  tools_done: 'Done', tools_toast_on: '{0} switched on', tools_toast_off: '{0} switched off',
  tool_goals: 'Savings Goals', tool_goals_d: 'Save towards things, and keep an emergency pot.',
  tool_debt: 'Debt Payoff', tool_debt_d: 'A plan to clear what you owe, and the date you will be free of it.',
  tool_calendar: 'Calendar', tool_calendar_d: 'Your month at a glance, with every due date marked.',
  tool_challenges: 'Challenges', tool_challenges_d: 'Small games for the moment you are about to spend.',
  tool_afford: 'Can I afford it?', tool_afford_d: 'See what a purchase would do to your money before you buy it.',
  tool_alloc: 'Need, Want and Save', tool_alloc_d: 'Tag each spend so you can see how your money splits.',
  tool_insights: 'Full dashboard', tool_insights_d: 'Charts, trends, statistics and every detail on your dashboard.',
  stg_show_all: 'Show all settings ({0} more)', stg_show_less: 'Show fewer settings',
  dv_calm: 'Calm view', calm_more: 'See the full picture',
  calm_alert_one: '1 thing needs a look', calm_alert_n: '{0} things need a look',
  nl_explain: 'How is this worked out?',
  fx_title: 'How Free to spend is worked out',
  fx_intro: 'Everything that came in this period, less everything that went out, less what is still due before the period ends.',
  fx_in: 'Came in this period', fx_roll: 'Carried over', fx_roll_note: 'Money you had before this period started',
  fx_roll_neg: 'Spent before you started tracking', fx_roll_neg_note: 'The difference between your pay and your balance at setup',
  fx_out: 'Spent and paid', fx_saved: 'Put into savings', fx_due: 'Still due before {0}', fx_due_note: '{0} payments, all set aside',
  fx_per_day: 'That is about {0} a day for the {1} days left.',
  fw_title: 'Your first week', fw_count: '{0} of {1}', fw_hide: 'Hide',
  fw_setup: 'Set up your pay and bills', fw_setup_d: 'Two minutes, and your number is right.', fw_setup_btn: 'Start',
  fw_spend: 'Log something you spend', fw_spend_d: 'Coffee counts. The + button is always there.', fw_spend_btn: 'Log it',
  fw_bill: 'Pay a bill when it goes out', fw_bill_d: 'Tap Pay in Coming up once it has left your account.', fw_bill_btn: 'See bills',
  fw_safe: 'Keep your budget safe', fw_safe_d: 'Turn on sync, or save a copy, so it is never lost.', fw_safe_btn: 'Set it up',
  fw_back: 'Check in again tomorrow', fw_back_d: 'A quick look at your number each day is the whole habit.',
  nudge_on: 'Turn it on', nudge_no: 'Not now',
  nudge_debt: 'Paying something off? See the order to clear it in, and the date you will be free.',
  nudge_calendar: 'You have quite a few bills now. See every due date on one calendar.',
  nudge_afford: 'Thinking about a purchase? Check what it does to your money first.',
  nudge_goals: 'You are keeping money back this period. Give it something to grow towards.',
  setup_next: 'Continue', setup_back: 'Back', setup_finish: 'Finish', setup_skip_q: 'Skip this',
  setup_w_title: "Let's find your number",
  setup_w_sub: 'A few quick questions, about two minutes, and you will see exactly how much you can spend, with your bills already set aside.',
  setup_w_1: 'When you get paid, and how much', setup_w_2: 'The bills that come out regularly', setup_w_3: 'A rough plan for everyday spending',
  setup_w_go: "Let's go", setup_w_skip: "Skip, I'll set it up myself",
  setup_pay_title: 'How often do you get paid?', setup_pay_sub: 'Your budget runs from one payday to the next, so it always matches your money.',
  setup_freq_month: 'Every month', setup_freq_w2: 'Every 2 weeks', setup_freq_w1: 'Every week', setup_freq_w4: 'Every 4 weeks', setup_freq_varies: 'It changes, or I am self-employed',
  setup_varies_note: 'No problem. Your budget will run by calendar month.',
  setup_last_q: 'When did you last get paid?',
  setup_amt_title: 'How much is one pay?', setup_amt_title_v: 'Roughly how much comes in each month?',
  setup_amt_sub: 'After tax: the amount that actually lands in your account. A rough number is fine.',
  setup_now_title: 'How much is in your account right now?',
  setup_now_sub: 'The account your pay goes into. Check your banking app.',
  setup_now_sub_v: 'The account you spend from. Check your banking app.',
  setup_now_note: 'This makes your number right from today, even if you have spent some of your pay already.',
  setup_bills_title: 'What comes out regularly?',
  setup_bills_sub: 'Rent, phone, insurance, subscriptions: anything that leaves on a schedule. Add the main ones now; the rest can wait.',
  setup_other: 'Something else', setup_col_name: 'Bill', setup_col_amount: 'Amount', setup_col_day: 'Due day',
  setup_bill_ph: 'Name', setup_day_unsure: 'Not sure',
  setup_bills_total: 'Bills: {0} a month', setup_bills_empty: 'Tap a bill above to add it.', setup_no_bills: 'I have no bills',
  setup_bills_trial: 'Your free trial includes {0} bill. Unlock the full planner to add the rest.',
  setup_bills_trial_none: 'Your free trial has room for no more bills. Unlock the full planner to add them.',
  setup_plan_title: 'Plan your everyday spending',
  setup_plan_sub: 'How much do you want to allow {0} for the things you buy day to day? Rough numbers are fine, and you can change them any time on the Budget page.',
  setup_sum_pay: 'Your pay', setup_sum_in_v: 'Comes in', setup_sum_bills: 'Bills', setup_sum_planned: 'Planned',
  setup_sum_left: 'Not planned yet', setup_sum_over: 'Planned over by',
  setup_cat_ph: 'Category', setup_add_cat: 'Add a category', setup_suggest: 'Suggest a starting point',
  setup_plan_note: 'Anything you leave unplanned is still yours to spend. It shows up in Free to spend.',
  setup_plan_later: 'Plan this later',
  setup_per_month: 'every month', setup_per_w1: 'every week', setup_per_w2: 'every two weeks', setup_per_w4: 'every four weeks',
  setup_help_title: 'What would you like help with?',
  setup_help_sub: 'Pick any, or none. The planner stays simple and only adds what you choose.',
  setup_help_goals: 'Saving for something', setup_help_debt: 'Paying off debt', setup_help_calendar: 'Seeing my month ahead',
  setup_help_impulse: 'Stopping impulse buys', setup_help_alloc: 'Splitting needs, wants and savings', setup_help_insights: 'Charts and the full picture',
  setup_adds: 'Adds {0}', setup_and: ' and ',
  setup_help_note: 'You can add or remove any of these later from Add tools.',
  setup_done_title: "You're all set",
  setup_done_rate: 'until {0}, about {1} a day',
  setup_done_until: 'until {0}',
  setup_done_none: 'Log your pay when it lands to see it grow.',
  setup_done_bills: 'Your bills are already set aside, so this is yours to spend.',
  setup_done_sub: 'Log what you spend as you go, and this number keeps itself right.',
  setup_done_go: 'Go to my dashboard',
  setup_done_nodate_1: '1 bill has no due day yet, so it is not set aside. Add its day on the Bills page and your number will allow for it.',
  setup_done_nodate: '{0} bills have no due day yet, so they are not set aside. Add their days on the Bills page and your number will allow for them.',
  setup_err_last: 'Pick the day you were last paid.', setup_err_pay: 'Enter roughly how much you get paid.',
  setup_err_bill: 'Give each bill a name and an amount, or remove it.',
  setup_tx_pay: 'Pay'
};
(function simpleAddWords() {
  try { Object.assign(TRANSLATIONS.en, SIMPLE_WORDS); } catch (e) {}
})();
