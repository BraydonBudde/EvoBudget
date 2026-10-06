/* Ezzo Budget - v2.7 "Onboarding & Upgrade"  (2026-07-01)
   Change set vs v1.0 "Baseline":
   - All native browser confirm()/alert() popups replaced with in-app
     glass dialogs (confirmDialog / alertDialog) - mobile-friendly.
   - UBP: duplicated init()/applyLayout() collapsed into one; recurring
     engine restored and init now runs exactly once. */
'use strict';
/* =====================================================================
   Ezzo Budget - Ultimate Budget Planner  (ultimate-budget.js)
   ===================================================================== */

// ── Utilities ─────────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2, 11);
const esc   = s  => { const d = document.createElement('div'); d.appendChild(document.createTextNode(String(s ?? ''))); return d.innerHTML; };
// The user's date, not UTC. toISOString() reports the UTC day, so east of
// UTC late in the evening it dated things yesterday, and west of UTC it
// dated them tomorrow. Everything else here compares against the local
// day via toLocalISO, so this has to agree with it.
const today = () => toLocalISO(new Date());

function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function getMonthBounds() {
  const n = new Date();
  return { start: toLocalISO(new Date(n.getFullYear(), n.getMonth(), 1)),
           end:   toLocalISO(new Date(n.getFullYear(), n.getMonth()+1, 0)) };
}
function formatDateDisplay(s) {
  if (!s) return '';
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString(calLocale(), { day:'numeric', month:'short', year:'numeric' });
}

// Day and month only. Everything in the hero's list falls inside the
// current period, so the year carries no information.
function formatDateShort(s) {
  if (!s) return '';
  const [y,m,d] = s.split('-').map(Number);
  const out = new Date(y, m-1, d).toLocaleDateString(calLocale(), { day:'numeric', month:'short' });
  return calLocale().startsWith('en') ? out.replace(/\bSept\b/, 'Sep') : out;
}

const POST_SYM = new Set(['PLN','SEK','NOK','DKK','HUF','CZK','RON','HRK']);
let SYM = '$';
const fmt = v => {
  const n = Math.abs(Number(v||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return POST_SYM.has(state?.settings?.currency) ? `${n}\u00a0${SYM}` : `${SYM}${n}`;
};
const pct = (a,e) => (!e||e===0) ? 0 : Math.min(999, Math.round((a/e)*100));

const calIcon = () => `<svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const helpBtn = k => `<button class="help-icon-btn" data-help="${k}" type="button" aria-label="${t('help_aria')}">?</button>`;

function styledDateField(inputId, wrapId, value) {
  return `<div class="date-field-styled" id="${wrapId}">${calIcon()}<span class="date-field-val" id="${inputId}Disp">${value ? formatDateDisplay(value) : '<span class="no-date">Set date</span>'}</span><input type="date" id="${inputId}" value="${value||''}"></div>`;
}
function bindDateField(inputId, wrapId, onChange) {
  document.getElementById(wrapId)?.addEventListener('click', () => { openDatePicker(document.getElementById(inputId), document.getElementById(wrapId)); });
  // Keyboard users tab to the real (visually-hidden) <input type="date"> - let
  // Enter/Space/Down open the same styled picker a mouse click would.
  document.getElementById(inputId)?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openDatePicker(document.getElementById(inputId), document.getElementById(wrapId));
    }
  });
  document.getElementById(inputId)?.addEventListener('change', e => {
    const disp = document.getElementById(inputId+'Disp');
    if (disp) disp.innerHTML = e.target.value ? formatDateDisplay(e.target.value) : '<span class="no-date">Set date</span>';
    if (onChange) onChange(e.target.value);
  });
}

// ── State ─────────────────────────────────────────────────────────────
const UBP_KEY = 'evobudget_ubp_v1';
const SBP_KEY = 'evobudget_v1';

// The budget a new planner starts with: the income and spending most
// households have, each list ending in Other, so anything that fits
// nowhere else (Ezzo's unsure guesses included) still has a home. All at
// zero until the person plans them.
const DEFAULT_BUDGET = {
  en: { income: ['Salary', 'Side income', 'Bonus', 'Benefits', 'Investments', 'Rental income', 'Gifts', 'Refunds', 'Other'],
        expenses: ['Groceries', 'Eating out', 'Transport', 'Shopping', 'Clothing', 'Health', 'Personal care', 'Home', 'Utilities', 'Subscriptions', 'Entertainment', 'Travel', 'Kids', 'Pets', 'Education', 'Gifts & donations', 'Fees & charges', 'Cash', 'Other'] },
};
function defaultState() {
  const {start,end} = getMonthBounds();
  return {
    settings: { currency:'USD', symbol:'$', periodStart:start, periodEnd:end, language:'en', pennyEnabled:false, upcomingDays:30, dashboardLayout:SLEEK_LAYOUT, dashboardAnimations:true, onboardingDone:false, tools:{} },
    rollover: 0,
    budgets: {
      income:   DEFAULT_BUDGET.en.income.map(category => ({ id: uid(), category, expected: 0 })),
      expenses: DEFAULT_BUDGET.en.expenses.map(category => ({ id: uid(), category, expected: 0 }))
    },
    transactions: [],
    debts: [],
    debtSettings: { method:'avalanche', extraPayment:0 },
    sinkingFunds: [],
    bills: [],
    allocation: {
      enabled: false,
      buckets: [
        {id:'need', name:'Need', pct:50, color:'#6366f1'},
        {id:'want', name:'Want', pct:30, color:'#ec4899'},
        {id:'save', name:'Save', pct:20, color:'#10b981'},
      ]
    }
  };
}

let state;
// Subscriptions and the Budget tab's Bills section were two models for one
// thing: money that goes out on a schedule. They are one list now, told
// apart by a label rather than by which screen they live on. Both old
// shapes are folded in once, on load, so nothing has to be re-entered.
function migrateToBills(s) {
  if (!Array.isArray(s.bills)) s.bills = [];
  let moved = false;
  // Every subscription is a bill that happens to be a subscription.
  (s.subscriptions || []).forEach(x => {
    s.bills.push({ ...x, kind: 'subscription', payTxIds: x.payTxIds || [] });
    moved = true;
  });
  delete s.subscriptions;
  // A budgeted bill row becomes a monthly bill falling due on its own day.
  ((s.budgets && s.budgets.bills) || []).forEach(r => {
    const day = r.dueDay || (r.dueDate ? parseInt(String(r.dueDate).split('-')[2], 10) : 0);
    s.bills.push({
      id: r.id || uid(), name: r.category, category: r.category,
      amount: r.expected || 0, frequency: 'monthly',
      nextBillingDate: day ? nextDueFromDay(day) : '',
      active: true, kind: 'bill',
      payTxIds: Array.isArray(r.payTxIds) ? r.payTxIds : (r.paidTxId ? [r.paidTxId] : [])
    });
    moved = true;
  });
  if (s.budgets) delete s.budgets.bills;
  // A budgeted savings row is a goal with no target: money put aside every
  // period with nothing in particular to reach. calcFund copes with that
  // now, so it keeps its contribution and simply has no bar to fill.
  if (!Array.isArray(s.sinkingFunds)) s.sinkingFunds = [];
  ((s.budgets && s.budgets.savings) || []).forEach(r => {
    s.sinkingFunds.push({
      id: r.id || uid(), name: r.category, icon: '🏦',
      targetAmount: 0, currentSaved: 0, targetDate: '',
      monthlyContribution: r.expected || 0
    });
  });
  if (s.budgets) delete s.budgets.savings;
  (s.transactions || []).forEach(tx => { if (tx.type === 'savings') tx.type = 'sinking_fund'; });
  // Anything already in the list predates the label.
  s.bills.forEach(b => {
    if (!b.kind) b.kind = 'bill';
    if (!Array.isArray(b.payTxIds)) b.payTxIds = [];
  });
  // A transaction filed against a subscription is filed against a bill.
  (s.transactions || []).forEach(tx => { if (tx.type === 'subscription') tx.type = 'bill'; });
  return moved;
}

function loadState() {
  try {
    const r = localStorage.getItem(UBP_KEY);
    const s = r ? JSON.parse(r) : null;
    if (!s || !s.settings || !s.budgets) return null;
    // Migration: add allocation if missing (existing users)
    if (!s.allocation) s.allocation = defaultState().allocation;
    // Nothing logs a payment by itself any more: only the person can say a
    // payment happened. A schedule left in an older save is dropped.
    delete s.recurringTemplates; delete s.settings.automationEnabled;
    if (s.settings.pennyEnabled === undefined) s.settings.pennyEnabled = false;
    migrateToBills(s);
    return s;
  } catch { return null; }
}
// A full localStorage used to throw straight through the caller, losing
// the write with no message and often leaving the render half-done.
let _saveWarned = false;
function saveState() {
  try {
    localStorage.setItem(UBP_KEY, JSON.stringify(state));
    _saveWarned = false;
  } catch (e) {
    if (!_saveWarned) {
      _saveWarned = true;
      try { showToast(t('save_failed')); } catch (e2) {}
      try { trackEvent('save_failed', { name: e && e.name }); } catch (e2) {}
    }
    return false;
  }
  SYM=state.settings.symbol;
  syncPushDebounced('ubp');
  // The rail's widgets read the same state, so they are redrawn with it.
  try { navWidgetsQueueRefresh(); } catch (e) {}
  return true;
}
function syncSymbol() { SYM=state.settings.symbol; }

// ══════════════════════════════════════════════════════════════════════
//  FREE TRIAL GATING (UBP)
//  Entering via "TRY FOR FREE" caps usage; entering via "Open" is full.
// ══════════════════════════════════════════════════════════════════════
const UBP_MODE_KEY = 'evobudget_ubp_mode';                 // 'trial' | 'full'
const TRIAL_LIMITS = { transactions:3, income:3, expenses:3, bills:3, savings:3, subscriptions:1, sinkingFunds:1, debts:1 };

// ▼▼ EDIT THESE: drop in your real checkout links + prices ▼▼
// TEST MODE links (ezzohub.lemonsqueezy.com store is not yet activated) -
// swap these for the live-mode checkout links once the store is approved
// and the products are copied over via Lemon Squeezy's "Copy to Live Mode".
// ⚠ TEMPORARY: both buttons go to the Etsy listing while Lemon Squeezy
// reviews the account. Put these two back when that review is done:
//   sbp: 'https://ezzohub.lemonsqueezy.com/checkout/buy/06896e34-a3a0-485d-a470-891e1bd45b6d'
//   ubp: 'https://ezzohub.lemonsqueezy.com/checkout/buy/82d76580-b132-4c74-8d1c-2a383087510c'
// Nothing else needs changing: the tracking and the funnel do not care
// where the link points.
const PURCHASE_URLS = {
  sbp: 'https://www.etsy.com/listing/4579311708/adhd-budget-planner-app-paycheck-budget',
  ubp: 'https://www.etsy.com/listing/4579311708/adhd-budget-planner-app-paycheck-budget',
};
const PRICES        = { sbp:'$19.99', ubp:'$49.99' };
// ▲▲ ─────────────────────────────────────────────────────── ▲▲

// Entitlement decides this, not the mode flag. The two used to be able to
// disagree: setting the mode to "full" lifted every cap without ever
// claiming to have paid. Anything not demonstrably unlocked is a trial.
// A full unlock is only ever recorded together with the key that earned it
// (script.js stores both on redeeming a key). A flag with no key behind it
// was never redeemed here, so it counts for nothing.
function isUnlockedUbp(){ return localStorage.getItem('evobudget_ubp_unlocked') === '1' && !!localStorage.getItem('evobudget_ubp_key'); }
function isTrial(){ return !isUnlockedUbp(); }

// Reaching this page with full access requires an active trial or a
// redeemed launch code (evobudget_ubp_unlocked, set only by a validated
// code in script.js). Both are set by budgetplanner.html's launcher before
// it navigates here - a direct visit (bookmark, shared link, typed URL)
// with neither set must not fall through to unrestricted full access.
// A stale flag with no key is cleared first, so the tools page asks for the
// key instead of sending the visitor straight back here.
if (localStorage.getItem('evobudget_ubp_unlocked') === '1' && !localStorage.getItem('evobudget_ubp_key')) {
  try { localStorage.removeItem('evobudget_ubp_unlocked'); } catch (e) {}
}
if (localStorage.getItem(UBP_MODE_KEY) !== 'trial' && !isUnlockedUbp()) {
  window.location.replace('budgetplanner');
}

// Returns true when the action is blocked (caller should stop and show the upgrade prompt).

// ── Trial usage, counted over the life of the trial ───────────────────
// Kept out of `state` deliberately: wiping the planner's data must not
// also wipe the record of what the free tier has already been spent on.
const TRIAL_USED_KEY = 'evobudget_trial_used';
function trialUsed() {
  try { return JSON.parse(localStorage.getItem(TRIAL_USED_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function trialUse(kind, n) {
  if (!isTrial()) return;
  try {
    const u = trialUsed();
    u[kind] = (Number(u[kind]) || 0) + (n || 1);
    localStorage.setItem(TRIAL_USED_KEY, JSON.stringify(u));
  } catch (e) {}
}
// The larger of "what exists now" and "what has been created" decides, so
// an existing trial is never suddenly cut off by this arriving, and a fresh
// one cannot be topped back up by deleting rows.
function trialCount(kind, live) {
  return Math.max(Number(live) || 0, Number(trialUsed()[kind]) || 0);
}

function trialBlocks(kind){
  if(!isTrial()) return false;
  switch(kind){
    case 'transaction':   return trialCount(kind, state.transactions.filter(x => !x.setup).length) >= TRIAL_LIMITS.transactions;
    case 'debts':         return trialCount(kind, (state.debts||[]).length) >= TRIAL_LIMITS.debts;
    case 'subscriptions': return trialCount(kind, (state.bills||[]).length) >= TRIAL_LIMITS.subscriptions;
    case 'sinkingFunds':  return trialCount(kind, (state.sinkingFunds||[]).length) >= TRIAL_LIMITS.sinkingFunds;
    default:              return trialCount(kind, state.budgets[kind]?.length||0) >= (TRIAL_LIMITS[kind]||Infinity);
  }
}

function goToPurchase(product){
  const url = PURCHASE_URLS[product];
  // Middle step of the dashboard's conversion funnel - see the matching
  // comment in script.js.
  trackEvent('purchase_initiated', { tool: product });
  if(url){ window.open(url,'_blank','noopener'); }
  else { showToast('Add your checkout link in PURCHASE_URLS.'+product); }
}

function upgradeChip(ctx){
  const L = {
    transaction:  tf('upg_chip_tx', TRIAL_LIMITS.transactions),
    subscriptions:tf('upg_chip_subs', TRIAL_LIMITS.subscriptions),
    sinkingFunds: tf('upg_chip_sinking', TRIAL_LIMITS.sinkingFunds),
    debts:        tf('upg_chip_debts', TRIAL_LIMITS.debts),
  };
  if(L[ctx.reason]) return L[ctx.reason];
  const names = { income:'tab_income', expenses:'tab_expenses', bills:'tab_bills', savings:'tab_savings' };
  if(ctx.reason==='category' && names[ctx.type]) return tf('upg_chip_cat', TRIAL_LIMITS[ctx.type], t(names[ctx.type]));
  return t('upg_chip_limit');
}

// ── Upgrade prompt (UBP primary, SBP secondary) ────────────────────────
function showUpgradeModal(ctx = {}){
  document.getElementById('fkUpgradeOverlay')?.remove();
  const check = `<svg class="fk-up-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

  const ov = document.createElement('div');
  ov.className = 'fk-up-overlay';
  ov.id = 'fkUpgradeOverlay';
  ov.setAttribute('role','dialog');
  ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label',t('upg_aria_label'));
  ov.innerHTML = `
    <div class="fk-up-card" role="document">
      <button class="fk-up-x" id="fkUpClose" type="button" aria-label="${t('close_aria')}">&times;</button>
      <div class="fk-up-hero">
        <div class="fk-up-glow" aria-hidden="true"></div>
        <div class="fk-up-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${esc(upgradeChip(ctx))}
        </div>
        <h2 class="fk-up-title">${t('upg_title_html')}</h2>
        <p class="fk-up-sub">${t('upg_sub')}</p>
      </div>
      <div class="fk-up-body">
        <ul class="fk-up-list">
          <li>${check}<span>${t('upg_feat_unlimited_tx_html')}</span></li>
          <li>${check}<span>${t('upg_feat_unlimited_cat_html')}</span></li>
          <li>${check}<span>${t('upg_feat_unlimited_other_html')}</span></li>
          <li>${check}<span>${t('upg_feat_onetime')}</span></li>
        </ul>
        <div class="fk-up-price-row">
          <div class="fk-up-price"><span class="fk-up-price-num">${esc(PRICES.ubp)}</span><span class="fk-up-price-tag">${t('upg_price_tag')}</span></div>
          <span class="fk-up-price-note">${t('upg_price_note')}</span>
        </div>
        <button class="fk-up-cta" id="fkUpBuyUbp" type="button">${tf('upg_cta_ubp',esc(PRICES.ubp))}</button>
        <button class="fk-up-upsell" id="fkUpBuySbp" type="button">
          <span class="fk-up-upsell-lead">${t('upg_upsell_lead')}</span>
          <span class="fk-up-upsell-cta">${tf('upg_upsell_cta',esc(PRICES.sbp))}</span>
        </button>
        <div class="fk-up-foot">
          <button class="fk-up-later" id="fkUpLater" type="button">${t('upg_later')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => { ov.classList.add('is-leaving'); document.removeEventListener('keydown', onKey); setTimeout(() => ov.remove(), 180); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#fkUpClose')?.addEventListener('click', close);
  ov.querySelector('#fkUpLater')?.addEventListener('click', close);
  ov.querySelector('#fkUpBuyUbp')?.addEventListener('click', () => goToPurchase('ubp'));
  ov.querySelector('#fkUpBuySbp')?.addEventListener('click', () => goToPurchase('sbp'));
  requestAnimationFrame(() => ov.classList.add('is-in'));
}
// Next occurrence (>= today) of a given day-of-month
// A budget row's due day, 1 to 31, or 0 for none. Saves written before
// this was a day held a whole date and only its day was ever read, so that
// is read through here rather than rewritten on load: nothing has to run at
// load time and an older copy of the app still reads the same row.
function rowDueDay(row){
  if(row.dueDay!==undefined&&row.dueDay!==null&&row.dueDay!==''){
    const d=parseInt(row.dueDay,10)||0;
    return d>=1&&d<=31?d:0;
  }
  if(row.dueDate){ const d=parseInt(String(row.dueDate).split('-')[2],10)||0; return d>=1&&d<=31?d:0; }
  return 0;
}
// Writing it leaves any old dueDate alone: rowDueDay prefers dueDay, so the
// stale field is never read again, and a rollback still finds its own data.
function setRowDueDay(row,val){
  const d=parseInt(val,10)||0;
  if(d>=1&&d<=31) row.dueDay=d; else delete row.dueDay;
}
// The day of the month a bill next falls on. Bills carry a whole date now,
// because a quarterly or annual one cannot be said as a day alone.
function billDueDay(b){
  if(!b||!b.nextBillingDate) return 0;
  const d=parseInt(String(b.nextBillingDate).split('-')[2],10)||0;
  return d>=1&&d<=31?d:0;
}
function nextDueFromDay(day){
  day=Math.min(31,Math.max(1,parseInt(day)||1));
  const now=new Date(); now.setHours(0,0,0,0);
  let y=now.getFullYear(), m=now.getMonth();
  const mk=(yy,mm)=>{const last=new Date(yy,mm+1,0).getDate();return new Date(yy,mm,Math.min(day,last));};
  let d=mk(y,m);
  if(d<now){ m++; if(m>11){m=0;y++;} d=mk(y,m); }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// ── Aggregation ───────────────────────────────────────────────────────
// Type label/color for the Daily Spend hover tooltip's per-transaction
// breakdown - the SAME colors as the Cash Flow rows/rings elsewhere on
// this dashboard, so a category reads as the same category everywhere.
// Savings goals share Savings' color/computeActuals section - they're a
// form of savings, not a separate concept.
function spendTypeLabel(type) {
  return { expense: t('bud_section_expenses'), bill: t('bud_section_bills'), debt: t('dash_debt_payments'), savings: t('bud_section_savings'), subscription: t('dash_subscriptions'), sinking_fund: t('tab_sinking') }[type] || type;
}
function spendTypeColor(type) {
  return { expense: '#ec4899', bill: '#fb923c', debt: '#a855f7', savings: '#3b82f6', subscription: '#10b981', sinking_fund: '#3b82f6' }[type] || '#6366f1';
}

function computeActuals() {
  const a={income:{},expenses:{},bills:{},savings:{},debt:{}};
  const MAP={income:'income',expense:'expenses',bill:'bills',debt:'debt',sinking_fund:'savings'};
  const {periodStart,periodEnd}=state.settings;
  for (const tx of state.transactions) {
    if (tx.date<periodStart||tx.date>periodEnd) continue;
    const sec=MAP[tx.type]; if (sec) a[sec][tx.category]=(a[sec][tx.category]||0)+tx.amount;
  }
  return a;
}
function computeSummary(act) {
  const sum=o=>Object.values(o||{}).reduce((s,v)=>s+v,0);
  const totalIncome=sum(act.income), totalExpenses=sum(act.expenses),
        totalSavings=sum(act.savings), totalDebt=sum(act.debt);
  const subNames=new Set((state.bills||[]).filter(b=>b.kind==='subscription').map(b=>b.name));
  let totalSubscriptions=0, totalBills=0;
  Object.entries(act.bills||{}).forEach(([name,v])=>{
    if(subNames.has(name)) totalSubscriptions+=v; else totalBills+=v;
  });
  const totalOut=totalExpenses+totalBills+totalDebt+totalSubscriptions;
  const savingsRate=totalIncome>0?Math.round((totalSavings/totalIncome)*100):0;
  const leftover=(state.rollover||0)+totalIncome-totalOut-totalSavings;
  return {totalIncome,totalExpenses,totalBills,totalSavings,totalDebt,totalSubscriptions,totalOut,savingsRate,leftover};
}
function computePrevSummary() {
  const {periodStart,periodEnd}=state.settings;
  const s=new Date(periodStart+'T00:00:00'),e=new Date(periodEnd+'T00:00:00');
  const durMs=e.getTime()-s.getTime();
  const prevEnd=new Date(s.getTime()-86400000);
  const prevStart=new Date(prevEnd.getTime()-durMs);
  const ps=toLocalISO(prevStart),pe=toLocalISO(prevEnd);
  const a={income:{},expenses:{},bills:{},savings:{},debt:{}};
  const MAP={income:'income',expense:'expenses',bill:'bills',debt:'debt',sinking_fund:'savings'};
  for(const tx of state.transactions){
    if(tx.date<ps||tx.date>pe)continue;
    const sec=MAP[tx.type];if(sec)a[sec][tx.category]=(a[sec][tx.category]||0)+tx.amount;
  }
  const hasTx=Object.values(a).some(o=>Object.keys(o).length>0);
  return hasTx?computeSummary(a):null;
}
// ── Rollover ─────────────────────────────────────────────────────────
// What a period carries in is what the period before it left over, on top
// of what that one carried in itself. Each period's figure is remembered by
// its start date, so applying a period twice, going back to an earlier one
// or nudging its dates never adds the same money a second time. An amount
// typed in by hand is kept exactly as typed.
// The period before this one, as the budget's own rhythm would have had it:
// the calendar month before a calendar month, the payday before a payday,
// the fortnight before a fortnight. A month-long period whose end was
// nudged still looks back a whole month. Anything else looks back the
// same number of days.
function rolloverPrevWindow(start, end) {
  const pe = bpAdd(start, -1);
  const r = bpRhythm();
  if (r && r.kind !== 'custom') {
    const w = bpPeriodFor(r, start);
    if (w && w[0] === start) { const q = bpPeriodFor(r, pe); if (q) return q; }
  }
  const span = bpSpan(start, end);
  if (span >= 25 && span <= 34) {
    const d = bpDate(start).getDate();
    return d === 1 ? bpPeriodFor({ kind: 'month' }, pe) : bpPeriodFor({ kind: 'payday', day: d }, pe);
  }
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
  const prevEnd = new Date(s.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (e.getTime() - s.getTime()));
  return [toLocalISO(prevStart), toLocalISO(prevEnd)];
}
// What came in less what went out in a window, nothing carried. null when
// nothing at all was logged in it.
function rolloverRaw(ps, pe) {
  let n = 0, v = 0;
  for (const tx of state.transactions || []) {
    if (tx.date < ps || tx.date > pe) continue;
    const a = Number(tx.amount) || 0;
    if (tx.type === 'income') { v += a; n++; }
    else if (tx.type === 'expense' || tx.type === 'bill' || tx.type === 'debt' || tx.type === 'sinking_fund') { v -= a; n++; }
  }
  return n ? v : null;
}
function rolloverInto(start, end, depth) {
  const H = state.rolloverHistory || {}, M = state.rolloverManual || {};
  if (M[start] && H[start] != null) return H[start];
  const [ps, pe] = rolloverPrevWindow(start, end);
  const raw = rolloverRaw(ps, pe);
  if (raw === null) return H[start] != null ? H[start] : (H[ps] != null ? H[ps] : 0);
  const base = depth > 0 ? rolloverInto(ps, pe, depth - 1) : (H[ps] || 0);
  return Math.max(0, Math.round(((base || 0) + raw) * 100) / 100);
}
function rolloverMaps() {
  if (!state.rolloverHistory) state.rolloverHistory = {};
  if (!state.rolloverManual) state.rolloverManual = {};
}
function maybeAutoCarryRollover() {
  if (state.settings.rolloverAutoCarry===false) return;
  const { periodStart: start, periodEnd: end } = state.settings;
  if (!start || !end) return;
  rolloverMaps();
  const was = state.rollover || 0;
  const r = rolloverInto(start, end, 12);
  state.rollover = r;
  state.rolloverHistory[start] = r;
  saveState();
  const input=document.getElementById('settRollover');
  if (input) input.value=state.rollover||'';
  if (Math.abs(was - r) > 0.004) showToast(tf('toast_rollover_autoset',fmt(state.rollover)));
}
// Saved before any of this existed: the rollover on file belongs to the
// period on file. The upcoming window moves from the old 7-day default to 30.
function settingsCatchUp() {
  if (!state || !state.settings) return;
  if (!state.rolloverHistory) {
    rolloverMaps();
    const st = state.settings.periodStart;
    if (st && (state.rollover || 0) > 0) { state.rolloverHistory[st] = state.rollover; state.rolloverManual[st] = true; }
  }
  if (!state.settings.upcoming30) {
    if (!state.settings.upcomingDays || state.settings.upcomingDays === 7) state.settings.upcomingDays = 30;
    state.settings.upcoming30 = true;
  }
}
function monthlySubAmt(s) {
  switch(s.frequency){case'annual':return s.amount/12;case'weekly':return s.amount*52/12;case'quarterly':return s.amount/3;default:return s.amount;}
}
function annualSubAmt(s) {
  switch(s.frequency){case'annual':return s.amount;case'weekly':return s.amount*52;case'quarterly':return s.amount*4;default:return s.amount*12;}
}
function totalSubMonthly() { return state.bills.filter(s=>s.active!==false&&s.kind==='subscription').reduce((t,s)=>t+monthlySubAmt(s),0); }

// ── Debt Payoff Algorithm ─────────────────────────────────────────────
function calcAmortizationPayment(principal,aprPercent,termMonths) {
  if (!(termMonths>0)) return 0;
  const r=(aprPercent/100)/12;
  if (r===0) return principal/termMonths;
  return principal*r*Math.pow(1+r,termMonths)/(Math.pow(1+r,termMonths)-1);
}
function calcDecliningFirstPayment(principal,aprPercent,termMonths) {
  if (!(termMonths>0)) return 0;
  return (principal/termMonths)+principal*((aprPercent/100)/12);
}
function recomputePercentMinPayment(d) {
  return Math.max(d.minPayFloor||0,(d.balance||0)*(d.minPayPercent||0)/100);
}
function totalMonthlyDebtCost(d) {
  return (d.minimumPayment||0)+(d.targetedExtra||0)+(d.type==='mortgage'?(d.escrowMonthly||0):0);
}
function currentRateForMonth(d,month) {
  if (d.rateType==='arm'&&d.armFixedMonths>0&&month>d.armFixedMonths) return d.armAdjustedRate;
  return d.interestRate;
}
function runDebtPayoff() {
  const {method,extraPayment}=state.debtSettings;
  state.debts.forEach(d=>{ if(d.minPayMode==='percent') d.minimumPayment=recomputePercentMinPayment(d); });
  const active=state.debts.filter(d=>d.balance>0);
  if (!active.length) return null;
  let working=active.map(d=>({...d,remaining:d.balance,paidOffMonth:null}));
  const priority=[...working].sort((a,b)=>method==='snowball'?a.balance-b.balance:b.interestRate-a.interestRate);
  // Whatever was going into a debt each month keeps being paid once that
  // debt is gone, and goes to whichever debt the chosen method puts next.
  // That rollover is the entire difference between the two methods, so
  // without it the order was decorative and both gave the same answer.
  let month=0,totalInterest=0,rolled=0;
  const now=new Date();
  while (working.some(d=>d.remaining>0.01)&&month<600) {
    month++;
    // Spare money this month: the unspent tail of a payment that cleared
    // its debt early. Separate from rolled, which is what earlier months
    // have already handed over for good.
    let freed=0, clearing=0;
    for (const d of working) {
      if (d.remaining<=0) continue;
      if (d.rateType==='arm'&&d.amortType!=='equal_principal'&&d.armFixedMonths>0&&month===d.armFixedMonths+1) {
        d._currentFixedPayment=calcAmortizationPayment(d.remaining,d.armAdjustedRate,Math.max(1,(d.termMonths||0)-d.armFixedMonths));
      }
      const rate=currentRateForMonth(d,month);
      const interest=d.remaining*(rate/100/12);
      totalInterest+=interest; d.remaining+=interest;
      const targeted=d.targetedExtra||0;
      const minPay=d.minPayMode==='percent'?Math.max(d.minPayFloor||0,d.remaining*(d.minPayPercent||0)/100)
        :(d.amortType==='equal_principal'&&d.termMonths>0)?(d.balance/d.termMonths)+interest
        :(d._currentFixedPayment||d.minimumPayment);
      const due=minPay+targeted;
      d._due=due;
      const pay=Math.min(d.remaining,due);
      d.remaining-=pay;
      d._monthPayment=pay; d._monthInterest=interest; d._monthPrincipal=pay-interest;
      if (d.remaining<0.01){
        // Only the part of this payment the debt did not need is spare now.
        // The old line resolved to the whole payment, which handed money
        // already spent on this debt to the others as well.
        freed+=due-pay;
        clearing+=due;
        d.remaining=0;
        if(!d.paidOffMonth)d.paidOffMonth=month;
      }
    }
    let avail=extraPayment+freed+rolled;
    for (const p of priority) {
      const a=working.find(w=>w.id===p.id); if(!a||a.remaining<=0) continue;
      const pay=Math.min(a.remaining,avail); a.remaining-=pay; avail-=pay;
      a._monthPayment=(a._monthPayment||0)+pay; a._monthPrincipal=(a._monthPrincipal||0)+pay;
      if(a.remaining<0.01){
        if(!a.paidOffMonth)a.paidOffMonth=month;
        a.remaining=0;
        clearing+=a._due||0;   // its own payment rolls on from next month too
      }
      if(avail<=0) break;
    }
    // Added after the round, not during it: a debt cleared this month has
    // already had this month's payment counted once, as freed.
    rolled+=clearing;
    const dateStr=toLocalISO(new Date(now.getFullYear(),now.getMonth()+month,1));
    for (const d of working) {
      if (d._monthPayment===undefined) continue;
      const escrow=d.type==='mortgage'?(d.escrowMode==='declining'?(d.escrowMonthly||0)*(d.remaining/d.balance):(d.escrowMonthly||0)):undefined;
      (d.schedule=d.schedule||[]).push({month,date:dateStr,payment:d._monthPayment,principal:d._monthPrincipal,interest:d._monthInterest,escrow,balance:d.remaining});
      d._monthPayment=d._monthPrincipal=d._monthInterest=undefined;
    }
  }
  const debtFreeDate=toLocalISO(new Date(now.getFullYear(),now.getMonth()+month,1));
  return {
    months:month, totalInterest:Math.round(totalInterest*100)/100, debtFreeDate,
    // The order money is aimed in, which is what the method chooses. Kept
    // separate because it is not the order debts finish in: under avalanche
    // the first debt attacked is often the largest and the last cleared.
    attackOrder:priority.map(p=>p.id),
    payoffOrder:priority.map(p=>{
      const w=working.find(x=>x.id===p.id),mo=w.paidOffMonth;
      const dt=mo?toLocalISO(new Date(now.getFullYear(),now.getMonth()+mo,1)):null;
      return {...p,paidOffMonth:mo,paidOffDate:dt?formatDateDisplay(dt):'-'};
    // Numbered 1, 2, 3 against a date each, so it has to read down the page
    // in the order they are actually cleared.
    }).sort((a,b)=>(a.paidOffMonth||9e9)-(b.paidOffMonth||9e9))
  };
}

// ── Savings Goal Calculations ─────────────────────────────────────────
// A goal may have no target: an emergency fund is money put aside with
// nothing in particular to reach. Everything that divides by a target has
// to hold its nerve when there isn't one, rather than show a 0% bar and a
// required monthly of nothing.
function fundHasTarget(f){ return (Number(f&&f.targetAmount)||0) > 0; }
function calcFund(f) {
  const now=new Date();
  const td=f.targetDate?new Date(f.targetDate+'T00:00:00'):null;
  const monthsLeft=td?Math.max(1,(td.getFullYear()-now.getFullYear())*12+(td.getMonth()-now.getMonth())):12;
  if(!fundHasTarget(f)){
    // Open ended: what it takes each month is whatever was set aside for it.
    return {monthsLeft,remaining:0,requiredMonthly:Number(f.monthlyContribution)||0,
            pctComplete:0,openEnded:true};
  }
  const remaining=Math.max(0,(f.targetAmount||0)-(f.currentSaved||0));
  return {monthsLeft,remaining,requiredMonthly:remaining/monthsLeft,
          pctComplete:Math.min(100,((f.currentSaved||0)/f.targetAmount)*100),openEnded:false};
}

// ── Upcoming Events ───────────────────────────────────────────────────
// A debt's monthly due dates up to yesterday that fall in this period, each
// with what it still owes. The period's payments settle the earliest dates
// first, so a minimum missed last month is still owed after the month turns,
// and whatever is left over is what counts towards the next date.
function debtOverdueDates(d, debtAct) {
  const day = parseInt(d.dueDay, 10), min = Number(d.minimumPayment) || 0;
  let left = subOrDebtPaid(debtAct || {}, d.name);
  if (!(day >= 1) || !(min > 0)) return { dates: [], left };
  const now = new Date();
  const yday = toLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const pStart = state.settings.periodStart || toLocalISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const pEnd = state.settings.periodEnd || '';
  const to = pEnd && pEnd < yday ? pEnd : yday;
  const dates = [];
  const from = new Date(pStart + 'T00:00:00');
  for (let k = 0; k < 400; k++) {
    const y = from.getFullYear(), m = from.getMonth() + k;
    const due = toLocalISO(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())));
    if (due > to) break;
    if (due < pStart) continue;
    const cover = Math.min(min, left); left = payRound2(left - cover);
    if (min - cover > 0.005) dates.push({ date: due, owe: payRound2(min - cover), paid: cover, min });
  }
  return { dates, left };
}

function getUpcomingEvents(days, act) {
  const events=[], now=new Date();
  const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+days);
  const debtAct=act?.debt||{}, subAct=act?.subscription||{};
  // srcId is what a Pay button needs to reopen the right thing. Scheduled
  const now0=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const pEnd=state.settings?.periodEnd||'';
  const push=(day,label,type,amount,color,paid,srcId,paidSoFar,expected)=>{
    for(let mo=0;mo<=2;mo++){
      const last=new Date(now.getFullYear(),now.getMonth()+mo+1,0).getDate();
      const d=new Date(now.getFullYear(),now.getMonth()+mo,Math.min(day,last));
      if(d<now0||d>end) continue;
      const iso=toLocalISO(d), inPeriod=!pEnd||iso<=pEnd;
      // What was paid this period settles this period's date, not next month's.
      events.push(inPeriod
        ? {date:iso,label,type,amount,color,paid:!!paid,srcId,paidSoFar:paidSoFar||0,expected:expected||0}
        : {date:iso,label,type,amount:expected||amount,color,paid:false,srcId,paidSoFar:0,expected:expected||0});
    }
  };

  // Debts and subscriptions store no payment links, so what has gone in is
  // whatever the period's transactions say. Both owe the remainder, not the
  // full amount, exactly as a part-paid bill does.
  for(const d of state.debts)
    if(d.dueDay){
      const exp=d.minimumPayment||0, done=subOrDebtPaid(debtAct,d.name);
      push(d.dueDay,d.name,'debt',Math.max(0,payRound2(exp-done)),'#a855f7',exp>0&&done>=exp,d.id,done,exp);
    }
  // A bill falls due on its own date and then once per cycle after it, so
  // an annual bill is due once a year rather than on the same day every
  // month. Its first date carries what has been paid towards it and owes
  // the rest; later dates are owed in full. A date already gone is overdue
  // rather than upcoming, and nlCommitted adds those on purpose.
  const billToday=toLocalISO(now), billEnd=toLocalISO(end);
  for(const b of (state.bills||[]).filter(x=>x.active!==false)){
    if(!b.nextBillingDate) continue;
    const exp=rowExpected(b), done=rowPaidAmount(b);
    let iso=b.nextBillingDate;
    for(let i=0;i<60&&iso<=billEnd;i++){
      const paidSoFar=i===0?done:0;
      if(iso>=billToday) events.push({date:iso,label:b.name,type:'bill',
        amount:Math.max(0,payRound2(exp-paidSoFar))||exp,color:'#fb923c',
        paid:exp>0&&paidSoFar>=exp,srcId:b.id,paidSoFar,expected:exp});
      iso=stepBillDate(iso,b.frequency);
    }
  }
  events.sort((a,b)=>a.date.localeCompare(b.date));
  return events;
}

// ── SVG Donut ─────────────────────────────────────────────────────────
const COLORS=['#06b6d4','#ec4899','#fb923c','#8b5cf6','#10b981','#eab308','#3b82f6','#f43f5e','#14b8a6','#a855f7','#f97316','#6366f1'];
// ── Internationalisation ─────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    lang_name:'English',
    // Tabs
    tab_dashboard:'Dashboard', tab_budget:'Budget', tab_transactions:'Transactions',
    tab_income:'Income', tab_expenses:'Expenses', tab_bills:'Bills',
    tab_debt:'Debt', tab_savings:'Savings', tab_settings:'Settings',own_title:'Twoje imię i nazwisko',own_desc:'Tak, jak drukuje je twój bank. Pieniądze, które przelewasz sobie na inne konto lub które przychodzą od ciebie, są wtedy pomijane przy imporcie jako przelew między twoimi kontami, a nie wydatek. Dodaj też osoby, których konta są twoje, np. partnera na koncie wspólnym.',own_ph:'Imię i nazwisko',own_add:'Dodaj',own_remove:'Usuń: {0}',own_one_word:'Podaj imię i nazwisko, żeby nie pomylić z kimś innym.',own_dupe:'To imię i nazwisko już jest.',own_title:'Il tuo nome',own_desc:'Come lo stampa la tua banca. I soldi che mandi a te stesso su un altro conto, o che arrivano da te, vengono esclusi all’importazione come giroconto tra i tuoi conti, non come spesa. Aggiungi anche chi condivide i tuoi conti, come il partner su un conto cointestato.',own_ph:'Nome e cognome',own_add:'Aggiungi',own_remove:'Rimuovi {0}',own_one_word:'Aggiungi nome e cognome, così non si confonde con qualcun altro.',own_dupe:'Questo nome c’è già.',own_title:'Tu nombre',own_desc:'Tal como lo imprime tu banco. El dinero que te envías a otra cuenta, o que llega de ti, se deja fuera al importar como un traspaso entre tus propias cuentas, no como gasto. Añade también a quien comparta tus cuentas, como tu pareja en una cuenta conjunta.',own_ph:'Nombre y apellido',own_add:'Añadir',own_remove:'Quitar a {0}',own_one_word:'Añade nombre y apellido, para no confundirlo con otra persona.',own_dupe:'Ese nombre ya está.',own_title:'Votre nom',own_desc:'Tel que votre banque l’imprime. L’argent que vous vous envoyez sur un autre compte, ou qui vient de vous, est alors laissé de côté à l’import comme un virement entre vos propres comptes, pas une dépense. Ajoutez aussi les personnes dont les comptes sont les vôtres, comme un conjoint sur un compte joint.',own_ph:'Prénom et nom',own_add:'Ajouter',own_remove:'Retirer {0}',own_one_word:'Ajoutez un prénom et un nom, pour ne pas confondre avec quelqu’un d’autre.',own_dupe:'Ce nom y est déjà.',own_title:'Dein Name',own_desc:'So, wie deine Bank ihn druckt. Geld, das du dir selbst auf ein anderes Konto schickst oder das von dir kommt, wird beim Import dann als Umbuchung zwischen deinen eigenen Konten weggelassen, nicht als Ausgabe. Füge auch andere hinzu, deren Konten deine sind, etwa Partner auf einem Gemeinschaftskonto.',own_ph:'Vor- und Nachname',own_add:'Hinzufügen',own_remove:'{0} entfernen',own_one_word:'Gib Vor- und Nachnamen ein, damit er nicht mit jemand anderem verwechselt wird.',own_dupe:'Dieser Name ist schon da.',own_title:'Your name',own_desc:'As your bank prints it. Money you send to yourself at another bank, or that arrives from you, is then left out of an import as a move between your own accounts, not spending. Add anyone else whose accounts are yours too, like a partner on a joint account.',own_ph:'First and last name',own_add:'Add',own_remove:'Remove {0}',own_one_word:'Add a first and last name, so it is not mistaken for someone else.',own_dupe:'That name is already there.',penny_hello:'Hi, I\'m Ezzo',penny_hello_sub:'Ask me anything about your budget, or send me a bank statement and I will sort it for you to check.',hu_see_all:'See all {0} in Notifications',set_name_title:'Planner name',set_name_desc:'Shown at the top of the sidebar.',set_name_label:'Name',lic_title:'License key',lic_desc:'The key that unlocked Ultimate Budget on this device. Support may ask for it.',lic_show:'Show',lic_hide:'Hide',lic_copy:'Copy',lic_copied:'License key copied',lic_none:'No license key is stored on this device. If you need help, contact support with the email you bought with.',af_title:'Can I afford it?',af_eyebrow:'Before you buy',af_how_much:'How much is it?',af_empty:'Tap in an amount and you will see straight away what it does to your money.',af_yes:'Yes, go for it',af_yes_line:'It fits inside today\'s {0}, so nothing else moves.',af_days:'Yes, but it costs your days',af_tight:'You can, but it gets tight',af_days_line:'Your daily amount drops from {0} to {1} until {2}.',af_wait:'Wait for your next period',af_wait_line:'You would be {0} short. Your next period starts {1}.',af_free_after:'Free to spend after',af_day_after:'A day, until {0}',af_now:'now {0}',af_left_today:'{0} still free today after this',af_covered:'Still covered: {0}',af_less_day:'{0} less to spend each day until {1}',af_tight_note:'That leaves little room for surprises',af_dip:'Buying now would dip into money set aside for bills',af_save_toward:'Or save towards it: {0} a week gets you there in a month',af_not_now:'Not now',af_log:'Log it',af_log_anyway:'Log it anyway',af_foot:'Bills already due are set aside first.',tx_way_afford_sub:'See what a purchase would do before you buy it',tx_way_afford_btn:'Check',nl_bills_today:'+ {0} in bills',pay_settled:'{0} {1} paid · already set aside ✓',pay_settled_part:'{0} {1} of {2} paid · already set aside ✓',pay_settled_over:'{0} paid · {1} more than planned',toast_undo_btn:'Undo',toast_undone:'Undone',nth_what:'What this means',nth_fix:'How to fix it',nth_aria:'What is this and how do I fix it?',nth_close:'Got it',nth_bill_late_w:'This bill\'s due date has passed and it has not been paid yet.',nth_bill_late_f:'If you have paid it, tap Pay and log it with the date it went out | If not, pay it as soon as you can to avoid late fees | If the amount or date has changed, update the bill so future reminders are right',nth_bill_soon_w:'This bill is due within the next week.',nth_bill_soon_f:'Make sure the money is there before the due date | Tap Pay once it has left your account | If you pay it another way, still log it here so your figures stay right',nth_debt_late_w:'This debt\'s minimum payment date has passed and the full minimum has not been logged.',nth_debt_late_f:'If you paid it, tap Pay and log it with the date it left your account | If not, pay at least the minimum straight away: a missed minimum can bring fees and hurt your credit | Check the debt\'s due day is right',nth_debt_soon_w:'This debt\'s minimum payment is due within the next week.',nth_debt_soon_f:'Make sure the minimum is covered before the due date | Tap Pay once it has gone out | Paying more than the minimum clears the debt sooner',nth_over_w:'You have spent more in this category than you planned for this period.',nth_over_f:'Tap Review to see the category | Hold back on it until the period ends | If the amount was unrealistic, raise it and lower another so your plan still adds up',nth_uncat_w:'These expenses were logged to sort later and have no category, so your budget cannot count them properly.',nth_uncat_f:'Tap Sort them to see them | Give each one a category | Your budget updates straight away',nth_goal_late_w:'This goal\'s date has passed and it has not reached its target.',nth_goal_late_f:'Tap Review to find the goal | Set a new date, or lower the target to what you have saved | If you no longer need it, delete the goal',nav_menu:'Menu',
    tab_debt_payoff:'Debt Payoff', tab_sinking:'Savings Goals',
    tab_calendar:'Calendar', tab_subscriptions:'Bills',
    // Dashboard stats
    total_income:'Total Income', expenses_bills:'Expenses & Bills',
    debt_payments:'Debt Payments', total_savings:'Total Savings',
    total_outgoing:'Total Outgoing', savings_rate:'Savings Rate',
    net_leftover:'Net Leftover', cash_flow:'Cash Flow',
    income_sources:'Income Sources', spending_breakdown:'Spending Breakdown',
    expected:'Expected', actual:'Actual',
    of:'of', budgeted:'budgeted', saved:'saved',
    // Settings
    budget_period:'Budget Period', start_date:'Start date', end_date:'End date',
    this_month:'This Month', this_week:'This Week', last_week:'Last Week', last_month:'Last Month', last_30_days:'Last 30 Days', this_quarter:'This Quarter', this_year:'This Year',
    currency:'Currency', rollover:'Rollover', appearance:'Appearance',
    language:'Language', reset_data:'Reset All Data',
    light:'Light',theme_jolly:'Jolly',theme_peachy:'Peachy',theme_frosty:'Frosty', dark:'Dark', theme_synthwave:'Synthwave', theme_vintage_ledger:'Vintage', theme_terminal:'Terminal',
    auto_badge:'Auto', auto_badge_title:'Added automatically on this date. Pay it now to settle it early or by hand.',
    nw_calendar:'Calendar', nw_calendar_desc:'This month at a glance, with today and every due date marked.',
    nw_cal_due:'Due', nw_cal_spent:'Spent',
    nw_today:'Today', nw_today_desc:"Today's share of what is free, and what is left of it.", nw_today_sub:'spent {0} of {1} today',
    nw_forecast:'Forecast', nw_forecast_desc:'Where this period lands if the rest of it looks like the start.', nw_forecast_sub:'at {0}/day, day {1} of {2}',
    nw_vs_last:'Vs Last Period', nw_vs_last_desc:'Spending at this same point last period, up or down.', nw_vs_last_sub:'{0} vs {1} by day {2}', nw_vs_last_none:'Nothing to compare with yet.',
    nw_notes:'Notes', nw_notes_desc:'Somewhere to put a thought. It never touches your numbers.', nw_notes_ph:'Cancel the gym, check the water bill\u2026', nw_notes_saved:'Saved',
    nw_head:'Widgets', nw_title:'Sidebar widgets', nw_edit:'Edit', nw_add_btn:'Add widget', nw_add:'Add', nw_done:'Done',
    nw_available:'Available', nw_none_yet:'No widgets yet.', nw_all_added:'Every widget is already in your sidebar.',
    nw_full:'Remove one to add another. {0} is the maximum.', nw_pick_desc:'Pick up to {0}. They appear in the order below.',
    nw_move_up:'Move up', nw_move_down:'Move down', nw_remove:'Remove', nw_log:'Log', nw_no_cats:'Add a category first',
    nw_days_left:'days left of {0}', nw_no_spend:'Nothing spent yet this period.',
    nw_quick_spend:'Quick Spend', nw_quick_spend_desc:'Log an expense without leaving the page.',
    nw_free_to_spend:'Free to Spend', nw_free_to_spend_desc:'What is left once everything still due is set aside.',
    nw_next_due:'Next Due', nw_next_due_desc:'The soonest payment you still owe, with a Pay button.',
    nw_period:'Period', nw_period_desc:'How much of your budget period is left.',
    nw_top_spend:'Top Spending', nw_top_spend_desc:'Your three biggest expense categories this period.',
    nav_position:'Navigation', nav_position_desc:'Choose where the section menu sits. On a phone it always runs across the top.', nav_pos_top:'Top', nav_pos_left:'Left', nav_pos_right:'Right',
    dashboard_layout:'Dashboard Layout', dashboard_layout_desc:'Choose how your Dashboard is designed and visualised.',
    dash_spend_btn:'+ Spend',
    layout_3:'Sleek', greet_morning:'Good morning', greet_afternoon:'Good afternoon', greet_evening:'Good evening',
    layout_1:'Classic', layout_2:'Radial Pulse', layout_coming_soon:'More Coming Soon!',
    changes_autosaved:'✅ Changes are saved automatically.',
    rollover_desc:'Carry unspent money from your previous period into this one.',rollover_autocarry_label:'Auto-carry from previous period',rollover_autocarry_hint:'When you change the budget period, this amount is recalculated automatically from what was actually left over last time. Uncheck to set it manually instead.',toast_rollover_autoset:'Rollover auto-set to {0} from last period',
    rollover_amount:'Rollover amount',
    reset_desc:'Permanently deletes all your data. This cannot be undone.',
    reset_btn:'Reset everything',
    // Common
    add:'Add', save_failed:'Could not save: this browser is out of storage space.',cancel:'Cancel',rename_title_prompt:'Rename your budget planner', save:'Save', delete:'Delete',dp_today:'Today',dp_clear:'Clear', edit:'Edit',field_info_aria:'About {0}',
    paid:'Paid', due_date:'Due Date', category:'Category', amount:'Amount',
    description:'Description', date:'Date', type:'Type',
    add_category:'+ Add category', no_transactions:'No transactions yet.',
    // Upgrade
    upgrade_title:'Ready for the pro experience?',
    upgrade_desc:'Unlock Debt Payoff Calculator, Savings Goals, Smart Calendar & Subscription Tracker.',
    upgrade_now:'Upgrade Now →',
    // Calendar days
    mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun',
    quick_presets:'Quick presets:',select_currency:'Select your currency',select_language:'Select language',
    appearance_desc:'Choose a colour theme.',
    dash_anim_title:'Dashboard Animations',dash_anim_desc:'Play a subtle entrance animation when the dashboard loads.',dash_anim_label:'Enable animations',
    help_sett_intro:'All your preferences for the Ultimate Budget Planner. Changes are saved automatically as you make them.',
    help_sett_currency_p:'Changes the currency symbol everywhere in the app immediately on selection.',
    help_sett_appearance_p:'Choose from six colour themes: Light, Peachy, Dark, Vintage, Jolly or Frosty. Your preference is remembered across sessions.',
    help_sett_layout_p:'Choose from two Dashboard designs - Classic or Radial Pulse. Each shows the same underlying data with its own charts and arrangement, with more designs coming soon.',
    help_sett_nav_h:'Navigation',
    help_sett_nav_top:'Top - the classic tab bar across the top of the page.',
    help_sett_nav_side:'Left (default) or Right - the sections become a vertical bar beside your content. A tablet shows icons only; a phone always falls back to the top bar.',
    help_sett_period_p:'The date range that defines “this budget”. Only transactions within this range count toward actuals. Use the 7 presets (This Month, Last Month, This Week, Last Week, Last 30 Days, This Quarter, This Year) for quick setup.',
    help_sett_rollover_p:"Any unspent money you want to carry forward from your previous period. It's added to your Net Leftover on the dashboard. With Auto-carry enabled, this updates automatically to match what was actually left over whenever you change the budget period - uncheck it to set the amount yourself.",
    // Calendar
    cal_title:'Smart Calendar',
    cal_desc:'All your bills, debt payments, subscriptions, and transactions in one live calendar. Click any day to see its events.',
    cal_prev:'\u2190 Prev',cal_next:'Next \u2192',
    cal_all_events:'All events - ',
    cal_no_events_day:'No events on this day.',
    cal_no_events_month:'No events this month.',
    cal_no_events_sub:'Add bills, debts, or subscriptions to see them here.',
    cal_event_one:'event',cal_event_many:'events',cal_clear:'Clear \u00d7',
    cal_leg_bill:'Bill',cal_leg_debt:'Debt',cal_leg_sub:'Subscription',cal_leg_tx:'Transaction',cal_leg_sinking:'Savings goal',cal_leg_goal:'Goal date',cal_leg_auto:'Automatic',
    cal_paid:'\u2713 Paid',cal_unpaid:'Unpaid',cal_mark_paid:'Mark paid',
    help_cal_intro:'The Smart Calendar pulls together all your financial commitments in one monthly view - updated automatically as you add data.',
    help_cal_ev_types_h:'Event types',
    help_cal_bill_li:'Bills - from your Bills budget section (recurring monthly on the due day you set)',
    help_cal_debt_li:'Debt payments - from your Debt Payoff section (recurring on the due day)',
    help_cal_sub_li:'Subscriptions - from your Subscriptions tracker (on the next billing date day)',
    help_cal_tx_li:'Transactions - dates you logged income or spending',
    help_cal_nav_h:'Navigating',
    help_cal_nav_p:'Use \u2190 Prev and Next \u2192 to move between months. Click any day to see its events highlighted in a panel below the calendar. Click the same day again or \u201cClear \u00d7\u201d to deselect.',
    help_cal_paid_h:'Marking bills paid',help_cal_paid_p:'Click a day to expand its events. Any unpaid bill shows a "Mark paid" checkbox right there - check it to log the actual amount you paid as a transaction, no need to switch to the Budget tab.',help_cal_tip:'\uD83D\uDCA1 Set due dates on bills and debts to get the most out of the calendar.',
    sf_add_btn:'+ Add goal',
    sf_desc:'A savings goal lets you save gradually for something bigger, so there are no nasty surprises. Set an amount and a date, and we\'ll work out exactly how much to save each month.',
    sf_empty_title:'No savings goals yet.',
    sf_empty_sub:'Great for: holidays, car repairs, weddings, new tech, annual bills.',
    sf_pct_complete:'complete',
    sf_save_prefix:'Save',sf_per_month:'/month',
    sf_mo_left_tpl:'{0} months left',
    sf_total_contrib:'Total monthly contributions needed:',
    sf_modal_new:'🏺 New Savings Goal',sf_modal_edit:'✏️ Edit Savings Goal',
    sf_fund_name_label:'Goal name',sf_fund_name_ph:'e.g. Summer holiday',
    sf_icon_label:'Icon',sf_target_amount_label:'Target amount',sf_monthly_label:'Monthly contribution',sf_monthly_hint:'What goes in each month. Leave the target blank for an open ended goal.',
    sf_currently_saved_label:'Currently saved',sf_target_date_label:'Target date',
    sf_fund_name_hint:'A short name for what you\'re saving toward, like "Summer Holiday" or "New Laptop".',
    sf_icon_hint:'Pick an icon to help this goal stand out at a glance.',
    sf_target_amount_hint:'The total amount you need to reach this goal.',
    sf_currently_saved_hint:"How much you've already put aside for this goal, if anything.",
    sf_target_date_hint:'When you want to reach your goal by - used to work out how much to save each month.',
    sf_create_btn:'Create goal',
    help_sf_intro:'A savings goal is money you set aside ahead of time for something planned, so there are no nasty surprises when the bill arrives.',
    help_sf_how_to_h:'How to use it',
    help_sf_step1:'Click + Add goal',
    help_sf_step2:'Name your goal (e.g. "Summer Holiday"), pick an icon',
    help_sf_step3:'Set a target amount (how much you need total)',
    help_sf_step4:'Set a target date (when you need the money)',
    help_sf_step5:"Enter how much you've already saved toward it",
    help_sf_reading_h:'Reading the card',
    help_sf_reading_p:'Each card shows your saved vs target, a progress bar, and exactly how much to save per month to hit your goal on time. Once you reach 100%, a "Goal reached" badge appears on the card.',
    help_sf_contrib_h:'Adding contributions',
    help_sf_contrib_p:"Click the + icon on a card to log a contribution - enter the amount you're adding this month.",
    help_sf_tip:'\uD83D\uDCA1 Great for: holidays, car repairs, annual insurance, weddings, electronics, home improvements.',
    dpc_title:'Debt Payoff',dpc_add_btn:'+ Add debt',
    dpc_desc:"Enter every debt, pick a payoff strategy, and see exactly when you'll be debt-free and how much interest you'll pay in total.",
    dpc_method_label:'Payoff method',
    dpc_avalanche:'Avalanche',dpc_snowball:'Snowball',dpc_saves_interest:'Saves {0} in interest against {1}',dpc_same_either_way:'Same result either way with your current debts',dpc_same_order:'Both methods reach your debts in the same order here, so the plan and the figures are identical. Your smallest balance is also your highest rate.',dpc_same_no_extra:'With nothing extra to put in, there is no spare money to aim, so both methods follow the same path. Add an amount above and they separate.',dpc_method_hint:'Which debt your spare money goes to first',dpc_months_sooner:'{0} months sooner',dpc_costs_interest:'Costs {0} more in interest than {1}',dpc_months_longer:'{0} months longer',
    dpc_snowball_desc:'Lowest balance first - quick wins keep you motivated',
    dpc_avalanche_desc:'Highest rate first - saves the most money overall',
    dpc_extra_label:'Extra monthly payment',
    dpc_extra_hint:'Amount above your minimum payments to throw at debt each month.',
    dpc_empty_title:'No debts added yet.',
    dpc_empty_sub:'Click \u201c+ Add debt\u201d to build your payoff plan.',
    dpc_th_name:'Debt',dpc_th_type:'Type',dpc_th_balance:'Balance',
    dpc_th_apr:'APR %',dpc_th_min:'Min. payment',dpc_th_due:'Due day',
    dpc_totals:'Totals',dpc_name_ph:'e.g. Visa Card',
    dpc_name_hint:'The label you’ll see for this debt everywhere in the app.',dpc_type_hint:'Used to apply the right rules for this kind of loan (e.g. mortgages support escrow and ARM rates).',
    dpc_balance_hint:'The amount you currently owe on this debt.',dpc_apr_hint:'The annual interest rate charged on the remaining balance.',
    dpc_min_hint:'The smallest payment required each month, before any extra you add.',
    dpc_term_label:'Loan term (years)',dpc_term_hint:'Sets how long this loan runs, so Auto-calculate can work out an accurate minimum payment.',
    dpc_autocalc_btn:'Auto-calculate',dpc_autocalc_done:'Calculated: {0}/mo',
    dpc_min_mode_label:'Minimum payment type',dpc_min_mode_fixed:'Fixed amount',dpc_min_mode_percent:'% of balance',
    dpc_min_percent_label:'Percent of balance (%)',dpc_min_floor_label:'Minimum floor amount',
    dpc_min_mode_hint:'Fixed keeps the same minimum every month. Percent of balance recalculates it as the balance shrinks - common for credit cards.',
    dpc_min_percent_hint:'The percentage of the remaining balance used to calculate the minimum payment.',dpc_min_floor_hint:'The minimum payment never drops below this amount, even if the percentage works out lower.',
    dpc_min_calculated_hint:'Calculated automatically - whichever is higher of the percentage or the floor amount.',
    dpc_escrow_label:'Escrow (taxes & insurance)',
    dpc_escrow_hint:"Adds to your real monthly cost, but is excluded from the payoff simulation since it doesn't reduce your balance.",
    dpc_min_pct_caption:'{0}% of balance',dpc_escrow_note:'{0} escrow',
    dpc_term_note_faster:'{0} months faster than your {1}-yr term',dpc_term_note_slower:'{0} months slower than your {1}-yr term',
    dpc_term_note_onschedule:'right on schedule for your {0}-yr term',
    dpc_escrow_mode_label:'Escrow type',dpc_escrow_mode_fixed:'Fixed amount',dpc_escrow_mode_declining:'Declining with balance',
    dpc_escrow_mode_hint:"This only affects the payment schedule below. Today's monthly payment and dashboard total always use the current flat escrow amount.",
    dpc_rate_type_label:'Rate type',dpc_rate_type_fixed:'Fixed for the whole term',dpc_rate_type_arm:'Adjusts after a fixed period (ARM)',
    dpc_rate_type_hint:'A simplified model: one rate for the fixed period, then a single new rate for the rest of the loan - not a full index/cap simulation.',
    dpc_arm_fixed_years_label:'Fixed-rate period (years)',dpc_arm_rate_label:'Rate after adjustment',
    dpc_arm_fixed_years_hint:'How many years the initial rate lasts before switching to the adjusted rate.',dpc_arm_rate_hint:'The interest rate that applies for the rest of the loan once the fixed period ends.',
    dpc_arm_caption:'adjusts after {0}-yr fixed period',
    dpc_recalc_link:'↺ Recalculate',
    dpc_th_extra:'Extra/mo',dpc_mo_suffix:'/mo',
    dpc_extra_col_hint:"Paid on top of this debt's minimum every month, before the shared Extra Monthly Payment above is distributed. Stops once this debt is paid off - it isn't redirected elsewhere.",
    dpc_targeted_extra_note:'{0} targeted extra',
    dpc_schedule_btn_title:'View payment schedule',
    dpc_amort_type_label:'Repayment style',dpc_amort_equal_payment:'Equal payments',dpc_amort_equal_principal:'Declining payments (equal principal)',
    dpc_amort_type_hint:'Equal payments stay the same every month. Declining payments keep the amount going to principal fixed, so the total payment shrinks over time as interest reduces - common for some mortgages.',
    dpc_autocalc_done_declining:'First payment: {0}/mo (decreases monthly)',dpc_declining_caption:'declining payment',
    dtype_credit_card:'Credit Card',dtype_student_loan:'Student Loan',
    dtype_mortgage:'Mortgage',dtype_car_loan:'Car Loan',
    dtype_personal_loan:'Personal Loan',dtype_other:'Other',
    dpc_debt_free_label:'\uD83C\uDFAF Debt-free date',dpc_months_from_now:'{0} months from now',
    dpc_interest_label:'\uD83D\uDCB8 Total interest',dpc_on_top:'on top of',dpc_principal:'principal',
    dpc_monthly_label:'\uD83D\uDCC5 Monthly total',dpc_min_abbr:'min',dpc_extra_abbr:'extra',
    dpc_payoff_order_sf:'Payoff order - \u26c4 Snowball (lowest balance first)',
    dpc_focus_word:'Focus',
    dpc_focus_seq:'Extra money goes here first: {0}',
    dpc_focus_none:'Set an extra monthly payment above and this order decides which debt it clears first.',
    dpc_focus_hint:'Where your extra money is aimed, in order',
    dpc_payoff_order_av:'Payoff order - \uD83C\uDF0A Avalanche (highest rate first)',
    dpc_paid_off:'Paid off:',dpc_balance_word:'balance',dpc_apr_word:'APR',
    help_dpc_intro:'This calculator builds a personalised debt payoff plan based on your debts and chosen strategy.',
    help_dpc_entries_h:'Your debt entries',
    help_dpc_balance_li:'Balance - How much you currently owe on that debt.',
    help_dpc_apr_li:'APR % - The annual interest rate (find it on your statement). E.g. 18.9 means 18.9%.',
    help_dpc_min_li:'Min. payment - The minimum monthly payment required by the lender.',
    help_dpc_due_li:'Due day - The day of the month the payment is due (shows on the Smart Calendar).',
    help_dpc_strategies_h:'Payoff strategies',
    help_dpc_snowball_li:'\u26c4 Snowball - Pay debts in order of smallest balance first. Once cleared, roll that payment into the next. Best for motivation.',
    help_dpc_avalanche_li:'\uD83C\uDF0A Avalanche - Pay debts in order of highest interest rate first. Saves the most money overall.',
    help_dpc_extra_h:'Extra monthly payment',
    help_dpc_extra_p:'Any surplus above your minimums you can throw at debt. Even a small extra payment can save hundreds in interest and cut months off your timeline. Results update as you type.',
    help_dpc_tip:'\uD83D\uDCA1 Toggle between methods to see how much interest you\u2019d save with each approach.',
    help_dpc_term_li:'Loan term - For mortgages, student loans, car loans and personal loans, set the term in years and click Auto-calculate to work out an accurate minimum payment.',
    help_dpc_percent_li:'Percentage-based minimum - For credit cards, switch to "% of balance" to match how your statement\u2019s minimum payment actually works (e.g. 2% of balance or $25, whichever is higher).',
    help_dpc_escrow_li:'Escrow - For mortgages, add your monthly taxes & insurance so your real monthly cost is accurate everywhere; it\u2019s excluded from the payoff projection since it doesn\u2019t reduce your balance.',
    help_dpc_amort_li:'Repayment style - Equal payments keep your payment the same every month. Declining payments (equal principal) keep the amount going to principal fixed, so your total payment shrinks over time; check your loan documents to see which one you have.',
    help_dpc_escrow_mode_li:'Escrow type - choose "Declining with balance" if your escrow shrinks along with your loan balance, like some declining insurance premiums; you can see it decline in the payment schedule.',
    help_dpc_rate_type_li:'Rate type - choose "Adjusts after a fixed period" for ARMs, then set how many years the rate is fixed and what it changes to afterward.',
    help_dpc_extra_targeted_li:'Extra/mo (per debt) - an optional amount paid only toward that one debt every month, on top of its minimum, regardless of your snowball/avalanche order.',
    dsched_col_date:'Date',dsched_col_payment:'Payment',dsched_col_principal:'Principal',dsched_col_interest:'Interest',dsched_col_escrow:'Escrow',dsched_col_balance:'Balance',
    dsched_never_payoff_warning:"At this pace, this debt won't be fully paid off within 50 years - the payment barely outpaces interest. Consider a higher minimum, a higher percentage floor, or an extra payment.",
    tx_import_csv:'\uD83D\uDCE5 Import CSV or PDF',
    tx_page_desc:'Log every dollar that moves - each entry updates your budget categories, dashboard, and allocation automatically.',
    tx_add_title:'Add a transaction',
    tx_date:'Date',tx_type:'Type',tx_category:'Category',tx_amount:'Amount',
    tx_desc_label:'Description',tx_desc_ph:'e.g. Grocery run\u2026',
    tx_date_hint:'The date this transaction happened.',
    tx_type_hint:'What kind of transaction this is - which part of your budget it counts against.',
    tx_category_hint:'Which category within that type this belongs to.',
    tx_amount_hint:'How much this transaction was for.',
    tx_desc_hint:'An optional note to help you remember what this was, like "Grocery run".',
    tx_add_btn:'Add',tx_error_required:'Please fill all required fields.',tx_error_no_cats:'No categories exist for this type yet. Add one in your budget first.',
    tx_transaction_one:'transaction',tx_transaction_many:'transactions',
    tx_clear_all:'Clear all',tx_empty:'No transactions yet.',tx_select_all_page:'Select all on this page',tx_n_selected:'{0} selected',tx_delete_selected:'Delete selected',tx_clear_selection:'Clear selection',tx_select_all_matching:'Select all {0} matching',tx_tag_as:'Tag as:',tx_tagged_toast:'{0} transactions tagged',confirm_delete_selected_tx:'Delete {0} selected transactions? This cannot be undone.',
    tx_way_manual_sub:'One off, on any date you choose',
    tx_way_auto_none:'Nothing repeating yet',
    tx_way_auto_one:'1 rule running',
    tx_way_auto_many:'{0} rules running',
    tx_way_view:'View all',
    tx_way_close:'Close',
    tx_type_income:'Income',tx_type_expense:'Expense',tx_type_bill:'Bill',tx_type_savings:'Savings',
    tx_th_amount:'Amount',tx_th_desc:'Description',
    tx_edit_title:'\u270F\uFE0F Edit Transaction',tx_save_changes:'Save changes',
    help_tx_intro:'Every money movement goes here. Your Budget actuals and Dashboard update automatically each time you add one.',
    help_tx_adding_h:'Adding a transaction',
    help_tx_step1:'Pick a Date - click the date field to open the calendar picker',
    help_tx_step2:'Choose a Type: Income, Expense, Bill, Savings, Debt, Subscription, or Savings Goal',
    help_tx_step3:'Select the matching Category (set up in the Budget tab)',
    help_tx_step4:'Enter the Amount and an optional description',
    help_tx_step5:'Hit Add',
    help_tx_edit_h:'Editing & deleting',
    help_tx_edit_p:'Click \u270F\uFE0F on any transaction to edit it, or \u00d7 to delete it. To wipe everything, use \u201cClear all\u201d.',help_tx_bulk_h:'Selecting multiple transactions',help_tx_bulk_p:'Check the box next to any transaction to select it, or use the checkbox in the header to select the whole page. If your search or filter matches more than one page, a "Select all matching" link lets you grab every result at once, then delete them together.',help_tx_auto_h:'Automatic transactions',help_tx_auto_p:'Create a rule for anything that repeats (like rent or salary) and pick how often. The app adds it to your list automatically on each due date. Use the toggle to pause a rule, or the pencil to edit it.',
    help_tx_csv_h:'CSV import',
    help_tx_csv_p1:'Import a spreadsheet export using the format: Date,Type,Category,Amount,Description (header row required).',
    help_tx_csv_p2:'Dates should be in YYYY-MM-DD format. Type must be one of: income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_desc:'Set an expected amount for every income and expense category, then track what actually comes in and goes out. Bills and savings goals have tabs of their own.',
    bud_section_income:'Income',bud_section_expenses:'Expenses',
    bud_section_bills:'Bills',bud_section_savings:'Savings',
    bud_th_category:'Category',bud_th_expected:'Expected',
    bud_th_actual:'Actual',bud_th_progress:'Progress',
    bud_th_due_date:'Due date',bud_th_paid:'Paid',
    bud_th_expected_hint:'The amount you plan to budget for this category each month.',
    bud_th_actual_hint:'Calculated automatically from your logged transactions in this category.',
    bud_th_progress_hint:'How much of your expected amount has been used so far, as a percentage.',
    bud_total:'Total',bud_set_date:'Set date',
    bud_add_btn:'+ Add',bud_add_any:'+ Add budget',env_sum_left:'Left',env_sum_spent:'Spent',env_sum_target:'Targets',env_sum_note:'{0}% of what you planned has gone out',bud_section_label:'Section',env_left:'left to spend',env_over:'over budget',env_in:'received',env_saved:'saved',env_meta_out:'{0} spent · {1} budgeted',env_meta_in:'{0} of {1}',env_log:'Log',bud_add_cat_title:'Add new category',
    bud_quick_add:'Quick add',
    bud_sugg_income:'Salary|Freelance|Bonus|Interest|Side hustle|Benefits|Rental income|Gifts',
    bud_sugg_expenses:'Groceries|Fuel|Transport|Dining out|Coffee|Clothing|Household|Health|Pets|Entertainment|Childcare|Hobbies',
    bud_sugg_bills:'Rent|Mortgage|Electricity|Gas|Water|Internet|Phone|Insurance|Car payment|Childcare',
    bud_sugg_savings:'Emergency fund|Holiday|Pension|Investments|House deposit|Car fund|Christmas|Wedding',
    bud_cat_name_label:'Category name',bud_cat_name_ph:'e.g. Freelance',
    bud_add_cat_btn:'Add',bud_due_date_label:'Due date',
    bud_cat_name_hint:'A short name for this category, like "Rent" or "Groceries".',
    bud_due_date_hint:'When this is due each period. Shows on the Smart Calendar.',
    help_bud_intro:"The Budget tab is where you plan what comes in and what you spend. Set expected amounts for each category and the actuals fill in from your Transactions. Bills and savings goals are planned on their own tabs.",
    help_bud_how_h:'How it works',
    help_bud_step1:'Click an Expected field and type your budget amount',
    help_bud_step2:'Log transactions in the Transactions tab',
    help_bud_step3:'The Actual column and progress bars update automatically',
    help_bud_colours_h:'Progress bar colours',
    help_bud_col_green:'Green - income at or above target',
    help_bud_col_indigo:'Indigo - expense within budget',
    help_bud_col_red:'Red - expense over budget',
    help_bud_bills_h:'Bills section',
    help_bud_bills_p:"Bills have a Due Date (click to open the date picker), and those dates show on the Smart Calendar. Mark a bill paid from the Calendar or the dashboard, where you are asked for the amount you actually paid and it is logged as a transaction, since bills like utilities rarely match your budgeted amount exactly.",
    help_bud_tip:'\uD83D\uDCA1 Use "+ Add category" to create custom categories for any section.',
    dash_total_income:'Total Income',dash_of:'of',dash_expected_sfx:'expected',
    dash_total_outgoing:'Total Outgoing',dash_budgeted_sfx:'budgeted',
    dash_savings_rate:'Savings Rate',dash_saved_sfx:'saved',
    dash_subscriptions:'Subscriptions',dash_per_year:'/year',
    dash_net_leftover:'Net Leftover this period',nl_breakdown:'Breakdown',nl_spent_today:'Spent today',nl_upcoming_title:'Upcoming payments',nl_show:'Show',nl_hide:'Hide',nl_partial_of:'{0} of {1} paid',mod_mark_paid:'Mark as paid',pay_btn:'Pay',paid_partial:'Partial',pay_partial_hint:'{0} will still be outstanding. {1} stays open.',pay_already_hint:'{0} already paid of {1} budgeted.',pay_save_partial:'Log part payment',pay_logged_title:'Payments logged',pay_remove_aria:'Remove this payment',toast_payment_removed:'Payment removed',nl_still_to_pay:'Still to pay',nl_free_to_spend:'Free to spend',nl_due_before:'before {0}',nl_nothing_due:'Nothing else due this period',nl_free_rate:'{0} a day for {1} days',nl_income_kept:'Income kept',nl_day_of:'Day {0} of {1} in this period',nl_per_day:'That is {0} a day for the {1} days left in this period.',nl_over_by:'You are {0} over for this period, with {1} days still to go.',nl_empty:'Add your income and expected amounts to see what is left.',nl_total:'Net leftover',
    dash_in_sfx:'in',dash_out_sfx:'out',
    dash_includes:'Includes',dash_rollover_sfx:'rollover',
    dash_cash_flow:'Cash Flow',
    dash_income_kept:'of income kept',
    dash_daily_spend:'Daily Spend',dash_daily_spend_caption:'total spend this period',spend_tip_more:'+{0} more',dash_other_category:'Other',
    dash_expected_legend:'Expected',dash_actual_legend:'Actual',
    dash_income_sources:'Income Sources',dash_no_income:'No income logged yet.',
    dash_spending_breakdown:'Spending Breakdown',dash_no_spending:'No spending logged yet.',
    dash_no_debts:'No debts added.',dash_set_up:'Set up \u2192',
    dash_debt_free_label:'Debt-free',dash_interest_label:'Interest',
    dash_months_label:'Months',dash_method_label:'Method',
    dash_set_balances:'Set balances to see results.',
    dash_upcoming_tpl:'\uD83D\uDCC5 Upcoming ({0} days)',dash_nothing_scheduled:'Nothing scheduled.',view_as_list:'Show as a list',view_as_cards:'Show as cards',sf_saved_so_far:'saved so far',sf_open_ended:'no target',qa_title_expense:'Add expense',qa_title_bill:'Pay a bill',qa_title_sinking_fund:'Add to a goal',qa_title_debt:'Pay a debt',qa_title_income:'Add income',qa_go_expense:'Add expense',qa_go_bill:'Pay bill',qa_go_sinking_fund:'Add to goal',qa_go_debt:'Pay debt',qa_go_income:'Add income',qa_type_expense:'Expense',qa_type_bill:'Bill',qa_type_sinking_fund:'Goal',qa_type_debt:'Debt',qa_type_income:'Income',qa_type_it:'type it instead',qa_clear:'Clear',qa_backspace:'Delete last digit',qa_tap_cat:'Tap a category to add it',qa_no_cats_expense:'No expense categories yet, but you can sort this one later.',qa_no_cats_bill:'Add a bill on the Bills tab first.',qa_no_cats_sinking_fund:'Add a savings goal first.',qa_no_cats_debt:'Add a debt first.',qa_no_cats_income:'Add an income category on the Budget tab first.',qa_uncat:'Uncategorized',qa_uncat_chip:'Uncategorized · sort later',qa_add_note:'Add note',qa_again:'Save and add another',qa_after:'After this: {0} until {1}, about {2} a day.',cu_today_cap:'Today',cu_yesterday_cap:'Yesterday',cu_title:'Coming up',cu_all:'All bills',cu_paid:'Paid',cu_today:'today',cu_tomorrow:'tomorrow',cu_yesterday:'yesterday',cu_in_days:'in {0} days',cu_days_ago:'{0} days ago',cu_empty:'Nothing due in the next {0} days.',cu_next_period:'Next period',stg_general:'General',stg_budget:'Budget and periods',stg_look:'Look and feel',stg_assist:'Assistant',stg_data:'Your data',stg_more:'More',set_width_title:'Layout width',set_width_desc:'Use the whole width of the window, or keep the app in a fixed column in the middle.',set_width_full:'Use the full width of the window',rail_assistant:'Budget Assistant',rail_guide:'Guide',rail_home:'Home',nl_free_today:'Free to spend today',rf_runout:'You could run short before the period ends',rf_runout_d:'At your usual {0} a day you would need {1}, with {2} free.',rf_noplan:'{0} has spending but nothing planned',rf_noplan_d:'{0} spent with no amount set.',rf_act_edit:'Fix it',rf_unplanned:'Spending outside your budget ({0})',rf_unplanned_d:'{0} in categories with no budget line: {1}.',rf_act_tx:'Show them',rf_unlinked_bill:'Bill payments that match no bill ({0})',rf_unlinked_bill_d:'Logged under {0}, which is not one of your bills.',rf_unlinked_debt:'Debt payments that match no debt ({0})',rf_unlinked_debt_d:'Logged under {0}, which is not one of your debts.',rf_unlinked_goal:'Goal contributions that match no goal ({0})',rf_unlinked_goal_d:'Logged under {0}, which is not one of your goals.',rf_unlinked_inc:'Income outside your budget ({0})',rf_unlinked_inc_d:'Logged under {0}, which has no income line.',rf_untagged:'Transactions with no Need, Want or Save tag ({0})',rf_untagged_d:'{0} this period is left out of your split.',rf_alloc_save:'Saving is behind its share',rf_alloc_d:'{0}% of income against a {1}% target.',rf_alloc_over:'{0} is over its share',rf_plan:'Your plan spends more than you expect to earn',rf_plan_d:'Planned outgoings of {0} against {1} of expected income.',rf_noincome:'No income logged yet this period',rf_noincome_d:'You expect {0}. Log it when it lands.',rf_goal_track:'{0} needs more each month',rf_goal_track_d:'{0} a month to reach it by {1}, and {2} is planned.',rf_goal_late:'{0} passed its date short of the target',rf_goal_late_d:'{0} still to save.',rf_interest:'{0}: the minimum does not cover the interest',rf_interest_d:'Interest is about {0} a month against a {1} minimum.',rf_missed:'{0}: minimum payment not made yet',rf_missed_d:'Due on day {0}, {1} of {2} paid so far.',rf_billjump:'{0} cost more than usual',rf_billjump_d:'Paid {0} against the usual {1}.',rf_nodate:'{0} has no due date',rf_nodate_d:'Without one it cannot be tracked or show up as due.',rf_act_setdate:'Set a date',rf_spike:'Spending is running above last period',rf_spike_d:'On pace for {0} against {1} last period.',rf_trend:'{0} is up on your usual',rf_trend_d:'{0} this period against about {1} a month.',rf_dupe:'Possible duplicate: {0}',rf_dupe_d:'{0} logged twice on {1}.',rf_future:'Transactions dated in the future ({0})',rf_future_d:'Check the dates. The first is {0}.',rf_ended:'Your budget period has ended',rf_ended_d:'It ended on {0}. Start the next one so your figures stay current.',rf_act_period:'Choose period',rf_one_open:'flag to look at',rf_many_open:'flags to look at',rf_urgent:'Urgent',rf_worth:'Worth a look',nt_ignore:'Ignore',nt_ignored_show:'Show {0} ignored',nt_ignored_toast:'Ignored. It no longer counts toward your badges.',close:'Close',dv_label:'Dashboard view',dv_overview:'Overview',dv_stats:'Statistics',dash_line_style:'Line style',dash_line_line:'Straight lines',dash_line_curve:'Curved lines',dash_other:'Other',psf_title:'This period so far',psf_in:'In',psf_out:'Out',psf_kept:'Kept',psf_still:'{0} still expected',psf_all_in:'All expected income is in',psf_bills_part:'{0} of it bills',psf_kept_pct:'{0}% of what came in',psf_where:'Where the money went',gp_title:'Goal progress',gp_all:'All goals',gp_done:'Done',gp_late:'Past date',gp_by:'by {0}',gp_of:'{0} of {1}',gp_saved:'{0} saved',gp_sum_of:'of {0} across your goals ({1}%)',ra_title:'Recent activity',ra_all:'All activity',ra_deleted:'Deleted {0} ({1})',ra_undo:'Undo',ra_more:'More',ra_empty:'Nothing logged yet.',ra_restored:'Put back',ra_amount:'Amount',ra_note:'Note',ra_again:'Log again',rf_pace:'Spending faster than planned',rf_pace_d:'On pace for {0} of everyday spending, {1} over plan.',rf_act_budget:'Review budget',rf_short:'Payments due are more than what is left',rf_short_d:'{0} still to pay with {1} left this period.',rf_act_coming:'See what is due',rf_overdue:'{0} bills are overdue',rf_overdue_one:'1 bill is overdue',rf_act_pay:'Pay now',rf_over:'{0} categories are over budget',rf_over_one:'1 category is over budget',rf_income:'Less income than expected',rf_income_d:'Only {0} of the {1} you expect has come in.',rf_act_log:'Log income',rf_nosave:'Nothing put toward your goals yet',rf_nosave_d:'Your goals need about {0} a month.',rf_act_goals:'Open goals',rf_apr:'{0} charges {1}% and gets only its minimum',rf_apr_d:'Anything extra on it saves the most interest.',rf_act_debt:'Open debt',rf_rise:'{0} went up by {1}',rf_rise_d:'It was {0} and is now {1}.',rf_act_bills:'Open bills',rf_subs:'Subscriptions weigh heavy',rf_subs_d:'{0} a month is {1}% of your expected income.',rf_big:'A large one-off expense: {0}',rf_big_d:'{0} on {1}.',rf_act_view:'View it',rf_loose:'Unsorted spending is piling up',rf_loose_d:'{0} this period has no category yet.',rf_thin:'Keeping very little of what came in',rf_thin_d:'Only {0}% of this period’s income is left after spending.',rf_one:'Heads-up',rf_many:'Heads-ups',rf_filter_label:'Show',rf_filtered:'{0} more hidden by your filters.',rfh_what:'What this means',rfh_fix:'How to fix it',rfh_aria:'What is this and how do I fix it?',rfh_close:'Got it',rfh_pace_w:'Your everyday spending this period is heading past what you planned. At this rate you will overspend before the period ends.',rfh_pace_f:'Open Budget and see which categories are running hot | Ease off those for the rest of the period | If the plan was too low, raise those amounts and lower others so it still adds up',rfh_runout_w:'At the rate you usually spend each day, the money free to spend will not last until the period ends.',rfh_runout_f:'Look at what you spend on a typical day and pick one or two things to cut | Use Free to spend today as your daily limit | If more income is coming, log it when it lands',rfh_short_w:'Bills and payments still due this period add up to more than you have left.',rfh_short_f:'Open Coming up to see what is due and when | Pay the essentials first: housing, utilities, debt minimums | Move money from flexible spending, or ask a company to move a due date',rfh_overdue_w:'A bill\'s due date has passed and no payment has been logged for it.',rfh_overdue_f:'If you have paid it, tap Pay and log the payment with the date it went out | If not, pay it as soon as you can to avoid late fees | If the bill changed or ended, edit or pause it on the Bills page',rfh_over_w:'You have spent more in a category than you planned for it this period.',rfh_over_f:'Open Budget to see which categories are over | Hold back on them until the period ends | If the amount was unrealistic, raise it and lower another so the plan still adds up',rfh_missed_w:'A debt\'s minimum payment date has passed and the full minimum has not been logged.',rfh_missed_f:'If you paid it, tap Pay and log it with the date it left your account | If not, pay at least the minimum straight away: a missed minimum can bring fees and hurt your credit | Check the debt\'s due day is right',rfh_interest_w:'This debt\'s minimum payment is no bigger than the interest it adds each month, so the balance will barely go down, or will grow.',rfh_interest_f:'Pay more than the minimum on this debt, even a little | Add an extra monthly payment in Debt Payoff | Ask the lender for a lower rate, or move the balance to a cheaper loan or card',rfh_plan_w:'The amounts you plan to spend, pay and save add up to more than the income you expect.',rfh_plan_f:'Open Budget and compare planned income with planned outgoings | Trim flexible categories until the plan fits | Check every income source is listed, including irregular ones',rfh_noincome_w:'You expect income this period but none has been logged yet, so you may be spending money that has not arrived.',rfh_noincome_f:'When your pay lands, log it with + Spend and choose Income | If it is late, hold off on spending that can wait until it arrives',rfh_income_w:'Less income has come in than you planned for this period.',rfh_income_f:'Log any income that has arrived but is not recorded yet | If some will not come, lower the planned amount on Budget so your figures stay honest | Cut back where you can to cover the gap',rfh_thin_w:'After spending, very little of this period\'s income is left, so there is not much room for surprises.',rfh_thin_f:'Look for one or two regular costs you can reduce | Set even a small amount aside each payday | Check your bills and subscriptions for anything you no longer use',rfh_ended_w:'Your budget period has finished, so your figures are still counting the old dates.',rfh_ended_f:'Tap Choose period and pick the new dates | Turn on Move on to the next period by itself so it happens for you next time',rfh_nosave_w:'Your goals need money each month, but nothing has been put towards them this period.',rfh_nosave_f:'When you move money into savings, add it as a contribution in Savings Goals | Even a small amount keeps a goal moving | If a date is no longer realistic, move it later',rfh_goal_track_w:'To reach this goal by its date you need to save more each month than you currently plan to.',rfh_goal_track_f:'Add a little more to it each month | Move the target date later | Or lower the target amount',rfh_goal_late_w:'This goal\'s date has passed and it has not reached its target.',rfh_goal_late_f:'Open Savings Goals and set a new date | Or lower the target to what you have saved | If you no longer need it, delete the goal',rfh_apr_w:'This is your most expensive debt and it only gets its minimum. Extra money on it saves the most interest.',rfh_apr_f:'Open Debt Payoff and add an extra monthly payment | Choose Avalanche so the extra goes to the highest rate first',rfh_rise_w:'A bill or subscription\'s price has gone up.',rfh_rise_f:'Check the new price is right | Decide whether it is still worth it | Look for a cheaper plan, or cancel and pause the bill',rfh_jump_w:'The last payment for this bill was noticeably higher than usual.',rfh_jump_f:'Check the payment for a mistake or a one-off charge | If it is right, update the bill\'s amount so your plan matches | If it was unexpected, contact the provider',rfh_subs_w:'Your subscriptions take up a large share of your expected income.',rfh_subs_f:'Open Bills and go through each subscription | Cancel or pause the ones you rarely use | Look for cheaper or shared plans',rfh_nodate_w:'This bill has no due date, so it cannot show as due, overdue or in Coming up.',rfh_nodate_f:'Tap Set a date and enter when it is next due | Pick how often it repeats so the app can follow it',rfh_big_w:'A single expense this period is much larger than your usual spending.',rfh_big_f:'Check it is correct and in the right category | If it was planned, there is nothing to do | If it was a surprise, consider a savings goal for costs like it next time',rfh_loose_w:'Some spending this period has no category yet, so your budget cannot count it properly.',rfh_loose_f:'Open Transactions and filter for Uncategorized | Give each one a category | Your budget and heads-ups update straight away',rfh_spike_w:'You are on pace to spend noticeably more than last period.',rfh_spike_f:'Open Statistics on the dashboard to see where it is going | Look for one-off costs or categories that grew | Rein in flexible spending for the rest of the period',rfh_trend_w:'This category is running well above your usual monthly amount.',rfh_trend_f:'Look at its recent transactions | Decide whether it is a one-off or the new normal | If it is the new normal, update its planned amount',rfh_dupe_w:'Two transactions with the same amount, category and date were logged. One may be a mistake.',rfh_dupe_f:'Open Transactions and compare the two | If one is a duplicate, delete it | If both are real, set this heads-up aside',rfh_future_w:'Some transactions are dated in the future, so they count before the money has moved.',rfh_future_f:'Open Transactions and check the dates | Change any wrong date to the day the money actually moved',rfh_noplan_w:'You spent in a category that has no planned amount, so it is not part of your plan.',rfh_noplan_f:'Tap Fix it and set a realistic amount | Or move the spending into a category that has one',rfh_unplanned_w:'Some spending is in categories with no line in your budget, so the plan does not cover it.',rfh_unplanned_f:'Add those categories to Budget with a planned amount | Or edit the transactions to use an existing category',rfh_unbill_w:'Some bill payments are logged under names that match none of your bills, so no bill shows them as paid.',rfh_unbill_f:'Edit the payments and pick the right bill | Or add the bill on the Bills page with the same name',rfh_undebt_w:'Some debt payments are logged under names that match no debt, so no debt counts them.',rfh_undebt_f:'Edit the payments and pick the right debt | Or add the debt in Debt Payoff with the same name',rfh_ungoal_w:'Some goal contributions are logged under names that match no goal, so no goal has grown from them.',rfh_ungoal_f:'Edit the contributions and pick the right goal | Or create the goal in Savings Goals with the same name',rfh_uninc_w:'Some income is logged under sources that have no income line in your budget.',rfh_uninc_f:'Add the source to Budget with its expected amount | Or edit the income to use an existing source',rfh_untagged_w:'Some transactions have no Need, Want or Save tag, so they are missing from your allocation split.',rfh_untagged_f:'Open Transactions and filter for Untagged | Give each one a tag',rfh_alloc_save_w:'You are putting a smaller share of income into savings than your allocation target.',rfh_alloc_save_f:'Add a contribution to a savings goal | Tag money you move to savings as Save | Trim a Want category to free up money',rfh_alloc_w:'This allocation bucket is taking more of your income than its target share.',rfh_alloc_f:'Look at the transactions tagged to it | Cut back on the biggest ones | If the split no longer fits your life, adjust it in Settings',rf_clear:'All clear',rf_checked:'{0} checks run on this period',rf_restore:'Show {0} set aside',rf_dismiss:'Set aside for this period',rf_none:'Nothing looks wrong this period. Nice work.',st_pace:'Spending against plan',st_spent:'Spent',st_plan:'Plan',st_proj:'At this pace',st_months:'Last six months',st_week:'By day of the week',st_cats:'Categories against budget',st_rate:'Kept of income',st_rate_d:'{0} kept this period',st_avg:'Average a day',st_avg_d:'over {0} days so far',st_projected:'By the end of the period',st_projected_d:'against {0} planned',st_top:'Largest share',st_top_d:'{0}, {1}% of spending',nt_title:'Notifications',nt_desc:'Everything that wants a look, from bills due to things worth knowing, and what to do about each.',nt_group_late:'Needs attention now',nt_group_soon:'Due this week',nt_group_todo:'To tidy up',nt_empty_title:"You're all caught up",nt_empty_sub:'Nothing is overdue, due this week, worth a look or waiting to be sorted.',nt_bill_late:'{0} was due {1}',nt_bill_soon:'{0} due {1}',nt_debt_soon:'{0} minimum payment due {1}',nt_over:'{0} over its {1} budget',nt_uncat_title:'{0} expenses to sort',nt_uncat_one:'1 expense to sort',nt_uncat_detail:'Logged to sort later. Give each one a category so your budget adds up.',nt_goal_late:'Its date has passed with {0} still to save',nt_act_review:'Review',nt_act_sort:'Sort them',nt_act_edit_goal:'Edit goal',nt_open:'Open {0}',nt_tag_overdue:'Overdue',nt_tag_soon:'Due soon',nt_tag_over:'Over budget',nt_tag_pastdate:'Past date',nt_tag_todo:'To do',tab_notifications:'Notifications',bp_title:'Budget period',bp_how:'Quick pick',bp_r_month:'Calendar month',bp_r_payday:'Monthly',bp_r_w2:'Every 2 weeks',bp_r_w4:'Every 4 weeks',bp_r_w1:'Every week',bp_r_custom:'Custom',bp_payday:'Starts on',bp_day_n:'day {0}',bp_starts:'Starts {0}',bp_tap_custom:'Tap the first day of the period.',bp_tap_last:'Now tap the last day.',bp_tap_rhythm:'Tap a day to start the period there.',bp_auto:'Move on to the next period by itself',bp_days:'{0} days',bp_day_of:'today is day {0} of {1}',bp_starts_in:'starts in {0} days',bp_over:'already over',bp_left:'{0} days left',bp_daily:'Your planned income of {0} comes to about {1} a day.',bp_now:'Back to today',bp_use:'Use {0}',bp_prev:'Previous period',bp_next:'Next period',bp_moved:'A new budget period has started: {0}',rail_nav:'Navigation',rail_account:'Account',rail_guest:'Your budget',rail_local:'Saved on this device',rail_account_open:'Open settings',badge_bills:'{0} bills overdue or due this week',badge_debt:'{0} debt payments due this week',badge_budget:'{0} categories over budget',badge_transactions:'{0} expenses to sort into a category',badge_goals:'{0} goals past their date',
    dash_no_sinking:'No savings goals yet.',dash_create_one:'Create one \u2192',
    help_dash_intro:'The Dashboard gives you a real-time financial overview. All numbers update automatically as you log transactions.',
    help_dash_hero_h:'Free to spend and Coming up',
    help_dash_hero_p:'The big figure is what you can still spend this period: what has come in, less what has gone out, less everything still owed before the period ends. Beside it, Coming up lists the next five payments still owed this period, overdue bills first. Press Pay on any of them to log it.',
    help_dash_leftover_h:'Colours',
    help_dash_leftover_p:'White means you are on track. Red means what you still owe is more than you have left.',
    help_dash_cashflow_h:'Cash Flow chart',
    help_dash_cashflow_p:'Each row shows Expected (grey bar) vs Actual (coloured bar) for Income, Expenses, Bills and Savings. A red Expenses bar means you went over budget.',
    help_dash_donut_h:'Donut charts',
    help_dash_donut_p:'Hover or tap a segment to see the label and percentage. These show where your money comes from and where it goes.',
    help_dash_bottom_h:'Bottom panels',
    help_dash_bottom_p:'Quick snapshots of your Debt Payoff progress and your Savings Goals.',
    help_dash_tip:'\uD83D\uDCA1 Click the date badge at the top to change your budget period.',
    tx_type_debt:'Debt',
    dash_debt_payments:'Debt',
    dash_debts_paid:'debt paid this period',dash_debts_paid_many:'debts paid this period',
    tx_type_subscription:'Subscription',
    alloc_title:'Budget Allocation',
    alloc_desc:'Tag spending as Need, Want or Save to see how your money aligns with your target split.',
    alloc_label:'Allocation',alloc_optional:'Tag spending',
    alloc_target:'Target',alloc_on_track:'On Track',alloc_over:'Over',alloc_under:'Under',
    alloc_enabled_label:'Enable budget allocation',
    alloc_name_ph:'Bucket name',alloc_pct_label:'% of income',
    alloc_sum_ok:'\u2713 100%',alloc_sum_bad:'\u26a0 Must total 100%',
    alloc_based_on:'Based on',alloc_income_period:'income this period',
    alloc_untagged:'Untagged',alloc_untagged_desc:'of spending not yet tagged',
    alloc_def_need:'Need',alloc_def_want:'Want',alloc_def_save:'Save',
    alloc_sett_title:'\uD83C\uDFAF Budget Allocation',
    alloc_nearing:'Nearing',
    alloc_behind:'Behind',
    alloc_required:'Allocation is required for spending transactions.',
    toast_tx_added:'Transaction added \u2713',toast_tx_updated:'Updated \u2713',toast_tx_deleted:'Deleted',
    toast_period_updated:'Period updated \u2713',toast_period_error:'End date must be after start date',
    toast_currency_updated:'Currency updated \u2713',toast_imported:'Imported {0} \u2713',
    toast_fund_created:'Goal created ✓',toast_fund_updated:'Goal updated ✓',
    toast_fund_contrib:'Added {0} to {1} \u2713',
    toast_sub_added:'Subscription added \u2713',toast_sub_updated:'Subscription updated \u2713',
    toast_alloc_enabled:'Allocation enabled \u2713',toast_alloc_disabled:'Allocation disabled',
    toast_lang_updated:'Language updated \u2713',toast_export:'Exported \u2713',
    toast_saved:'Saved \u2713',toast_reset:'All data cleared',toast_alloc_bucket_added:'Bucket added \u2713',
    confirm_remove_cat:'Remove this category?',bud_edit_title:'\u270f\ufe0f Edit Category',bud_name_required:'Give the category a name.',bud_name_taken:'Another category in this section already uses that name.',bud_expected_invalid:'Enter an expected amount of 0 or more.',bud_due_day_invalid:'Enter a due day between 1 and 31, or leave it blank.',confirm_delete_all_tx:'Delete ALL transactions? This cannot be undone.',
    confirm_remove_cat_with_tx:'{0} existing transaction(s) use this category. They will keep it as a label, but it will no longer be tracked in your budget. Delete anyway?',
    confirm_delete_tx:'Delete this transaction?',confirm_remove_debt:'Remove this debt?',
    confirm_delete_fund:'Delete this goal?',confirm_remove_sub:'Remove this subscription?',
    confirm_reset_1:'Are you sure? All data will be permanently deleted.',
    confirm_reset_2:'Last chance - this cannot be undone. Continue?',
    sett_upcoming_title:'📅 Upcoming Window',sett_upcoming_desc:"Choose how many days ahead the Dashboard's Upcoming list looks.",sett_upcoming_label:'Days ahead',
    export_csv_btn:'\uD83D\uDCE5 Export CSV',sett_export_title:'\uD83D\uDCE4 Export Data',
    sett_export_desc:'Download all transactions as a CSV file for backup or use in another app.',
    sf_add_contribution:'Add Contribution',sf_contribution_label:'Amount to add',sf_currently_saved:'Currently saved',
    tx_search_ph:'Search by description or category\u2026',tx_filter_all_types:'All types',tx_filter_all_alloc:'All allocations',
    tx_sort_date_new:'Newest first',tx_sort_date_old:'Oldest first',tx_sort_amt_high:'Highest amount',tx_sort_amt_low:'Lowest amount',
    tx_showing:'Showing {n} of {total}',tx_no_results:'No transactions match your filter.',
    alloc_add_bucket:'+ Add bucket',alloc_remove_btn:'Remove',alloc_total_label:'Total',alloc_new_bucket:'New bucket',alloc_color_title:'Pick a color',alloc_custom_color:'Custom',alloc_min_buckets:'Minimum 2 buckets required',
    alloc_auto_tag:'Auto-tagged \u2192 {1}',
    tx_prev:'\u2190 Prev',tx_next:'Next \u2192',tx_page_of:'Page {n} of {total}',
    debt_due_day_note:'Days 29-31 won\u2019t show in shorter months',
    sub_advanced:'Billing date advanced to {date}',
    sf_days_left:'{n} days left',sf_days_overdue:'{n} days overdue',
    sf_due_today:'Due today!',sf_target_complete:'Target reached! \u2713',sf_goal_reached:'Goal reached',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs Previous Period',dash_compare_no_data:'No previous period data',
    recurring_title:'Automatic Transactions',recurring_desc:"Set up transactions that repeat on a schedule (example: rent, salary or subscriptions). They're added to your list automatically on each due date.",recurring_add_rule:'+ Add Automatic Transaction',
    recurring_empty:'No automatic transactions added yet.',recurring_label_ph:'Transaction name (e.g. Netflix)',
    recurring_freq:'Frequency',freq_daily:'Daily',freq_weekly:'Weekly',
    freq_monthly:'Monthly',freq_quarterly:'Quarterly',freq_annual:'Annual',
    recurring_next_due:'Next Due',recurring_generated:'Automated {0} new transactions',
    recurring_remove:'Remove rule',recurring_paused:'Paused',recurring_active:'Active',recurring_saved:'Automatic transaction saved ✓',dpc_add_debt_title:'Add debt',dpc_edit_debt_title:'Edit debt',debt_due_day_modal_hint:'The day of the month this payment is due',toast_debt_added:'Debt added',toast_debt_updated:'Debt updated',sf_billing_day_label:'Due day',sf_billing_day_hint:'The day each month the contribution is logged automatically',sf_error_required:'Please fill in all required fields',bill_paid_modal_title:'Mark bill paid',bill_paid_amount_label:'Amount paid',bill_paid_amount_hint:"How much you actually paid - this gets logged as a transaction so your spending history stays accurate, even if it's different from your budgeted amount.",bill_paid_save_btn:'Log payment',bill_paid_budgeted_hint:'Budgeted: {0}',toast_bill_marked_paid:'Payment logged',sub_active:'Active',sub_paused:'Paused',sub_desc:"Track every recurring payment and understand your true annual cost. Pause subscriptions you're not using to keep costs in check.",sub_add_btn:'+ Add bill',sub_add_title:'Add bill',sub_edit_title:'Edit bill',sub_empty_title:'No bills yet.',sub_empty_sub:'Add your recurring payments - Netflix, Spotify, gym memberships, etc.',sub_sum_monthly:'Monthly total',sub_sum_annual:'Annual total',sub_by_category:'By category',sub_per_month:'/month',sub_next_label:'Next',sub_name_label:'Name',bill_kind_label:'Type',bill_kind_bill:'Bill',bill_kind_sub:'Subscription',sub_name_ph:'e.g. Netflix',sub_amount_label:'Amount',sub_freq_label:'Billing frequency',sub_freq_monthly:'Monthly',sub_freq_annual:'Annual',sub_freq_quarterly:'Quarterly',sub_freq_weekly:'Weekly',sub_unit_month:'month',sub_unit_year:'year',sub_unit_quarter:'quarter',sub_cat_label:'Category',sub_date_label:'Due date',sub_name_hint:'The service or provider this payment is for, like "Netflix" or "Gym Membership".',sub_amount_hint:"How much you're charged each billing cycle.",sub_freq_hint:'How often this subscription bills you.',sub_cat_hint:'Groups this subscription for the category breakdown chart.',sub_date_hint:'The next date this subscription will charge you. Shows on the Smart Calendar.',alloc_label_hint:'Tag this as a Need, Want, or Save so it counts toward your allocation buckets.',sub_cat_entertainment:'Entertainment',sub_cat_productivity:'Productivity',sub_cat_health:'Health & Fitness',sub_cat_food:'Food & Drink',sub_cat_cloud:'Cloud Storage',sub_cat_finance:'Finance',sub_cat_education:'Education',sub_cat_gaming:'Gaming',sub_cat_news:'News & Media',sub_cat_other:'Other',help_sub_intro:"Track every recurring payment and understand your true monthly and annual cost. Subscriptions that quietly drain your account are easy to miss - this keeps them visible.",help_sub_how_h:'Adding a subscription',help_sub_step1:'Click + Add subscription',help_sub_step2:'Enter the name, amount, and billing frequency (monthly, annual, quarterly, weekly)',help_sub_step3:'Pick a category to group similar subscriptions',help_sub_step4:'Set the next billing date - it will appear on the Smart Calendar',help_sub_monthly_h:'Monthly equivalent',help_sub_monthly_p:'Annual and quarterly subscriptions are converted to a monthly cost so you can see your true monthly spend at a glance.',help_sub_pause_h:'Pausing subscriptions',help_sub_pause_p:"Switch the Active toggle off on any subscription you're not currently using. It won't count toward your totals until you switch it back on.",help_sub_price_h:'Price history',help_sub_price_p:"When you change a subscription's price, it's logged automatically. A small ↑ or ↓ next to the amount shows the most recent change - hover it to see the full history.",help_sub_chart_h:'Category chart',help_sub_chart_p:'The donut chart shows how your subscription spending breaks down by category - hover a segment to see the details.',help_sub_tip:'💡 Tap Pay when a bill actually leaves your account. If an automatic payment from your bank fails, the bill stays owed here, so nothing slips by.',automate_auto_pay:'Auto-pay',sf_auto_contribute:'Auto-contribute',sf_auto_need_amount:'Add a target amount and date first',sf_auto_set:'Monthly contribution set to {0}',automate_label:'Automate',automate_hint:'Adds it to your transactions automatically on schedule',automate_hint_off:'Turn on Automation in Settings to use this',automate_th:'Autopay',automate_need_amount:'Set a minimum payment first',automate_payment_word:'payment',automate_linked:'Linked automatic transaction',sf_contribution_label:'Monthly contribution',sf_contribution_hint:'Logged automatically each month to grow this goal',sett_automation_h:'Automation',sett_automation_desc:'Master switch for automatic transactions. When off, no scheduled transactions are generated and the Automate options are disabled.',sett_automation_toggle:'Automatic transactions',sett_automation_hint:'Applies to the Transactions tab, subscriptions, savings goals and debts',
    tx_type_sinking_fund:'Savings goal',
    help_dash_alloc_h:'Budget Allocation panel',
    help_dash_alloc_what_h:'What it is',
    help_dash_alloc_what_p:'Tracks your spending against customisable target percentages of your income. The classic 50/30/20 rule splits income into Needs (essentials: rent, food, utilities), Wants (lifestyle: dining, streaming, hobbies) and Savings (wealth-building and debt payoff). You can set any split you like - the percentages just need to total 100%.',
    help_dash_alloc_tag_h:'Tagging transactions',
    help_dash_alloc_tag_p:'When logging a transaction, choose an allocation (Need / Want / Save) from the dropdown. Income and savings contributions are excluded from tagging. A ? badge on a row means that spending is not yet tagged.',
    help_dash_alloc_read_h:'Reading the cards',
    help_dash_alloc_read_p:'Each card shows the bucket name, your target %, and your actual % of income for the period. The thin bar fills proportionally - when it is full, you have hit your limit.',
    help_dash_alloc_col_h:'Colour coding',
    help_dash_alloc_col_over:'Red - you have exceeded the target. The percentage and bar both turn red.',
    help_dash_alloc_col_near:'Orange - within 5 percentage points of the target. A heads-up that you are close.',
    help_dash_alloc_col_norm:'Bucket colour - comfortably within your target for this period.',
    help_dash_alloc_setup_h:'Customising',
    help_dash_alloc_setup_p:'Open Settings \u2192 Budget Allocation. Edit the bucket names, adjust the percentages, and toggle the panel on or off. Percentages must total 100% before changes take effect.',
    // Ezzo (AI assistant)
    sett_penny_h:'Ezzo (AI Budget Assistant)',
    sett_penny_desc:'Ask Ezzo questions about your budget & spending habits',
    sett_penny_toggle:'Enable Ezzo',
    sett_penny_hint:'Turns on the Ezzo assistant and its icon in the navigation bar.',
    sett_penny_key_label:'Gemini API Key',
    sett_penny_key_placeholder:'Paste your Gemini API key',
    sett_penny_howto:'How to create my key',
    sett_penny_save_btn:'Save key',
    sett_penny_key_saved:'Gemini API key saved and encrypted',
    sett_penny_remove:'Remove key',
    sett_penny_available:'Ezzo is now available in the navigation menu.',
    sett_penny_usage_count:'Ezzo has answered {0} questions this month',
    sett_penny_key_error_short:"That doesn't look like a valid key. Please check and try again.",
    confirm_penny_remove_key:'Remove your saved Gemini API key? Ezzo will be turned off until you add a new one.',
    toast_penny_key_saved:'Gemini key saved securely.',
    penny_nav_pill_off:'Enable Ezzo',
    penny_nav_pill_on:'Ask Ezzo',
    penny_nav_aria_off:'Enable Ezzo',
    penny_nav_aria_on:'Ask Ezzo',
    penny_chat_title:'Ask Ezzo',
    penny_input_placeholder:'Ask about your budget\u2026',
    penny_send:'Ask',
    penny_thinking:'Ezzo is thinking\u2026',
    penny_voice_on:'Voice replies on',
    penny_voice_off:'Voice replies off',
    penny_disclaimer:'Your very own AI Budget Assistant',
    penny_no_key_notice:'Add your Gemini API key in Settings to start chatting with Ezzo.',
    penny_open_settings:'Open Settings',
    penny_close:'Close Ezzo',
    penny_qp_leftover:'How much do I have left this period?',
    penny_qp_top_category:"What's my biggest spending category?",
    penny_qp_on_track:'Am I on track with my budget?',
    penny_qp_subscriptions:'What am I paying in subscriptions?',
    penny_qp_debt:"How's my debt payoff going?",
    penny_qp_chart:'Show me a chart of my spending',
    penny_err_invalid_key:'Your Gemini API key looks invalid or has been revoked. Update it in Settings.',
    penny_err_rate_limited:"You've hit Gemini's rate limit for now. This is a limit from Google on your key, not the counter above. Wait a bit and try again.",
    penny_err_overloaded:"Google's Gemini service is temporarily overloaded with requests right now. Please try again in a moment.",
    penny_err_network:"Ezzo couldn't reach Google's servers. Check your connection and try again.",
    penny_err_blocked:"Ezzo couldn't come up with a safe answer to that. Try rephrasing your question about your budget.",
    penny_err_unknown:"Something went wrong on Ezzo's end. Please try again in a moment.",
    penny_err_key_unreadable:"Your saved key couldn't be read. Please re-enter it in Settings.",
    penny_err_retry:'Retry',
    help_sett_penny_p:'Turn on Ezzo below to ask questions about your budget in plain English. Tap "How to create my key" for setup steps.',
    help_penny_title:'Setting up Ezzo',
    help_penny_intro:"Ezzo is Ezzo Budget's AI assistant. Since this app has no server of its own, Ezzo talks directly from your browser to Google using your own free Gemini API key. Nothing ever passes through an Ezzo Budget server, because there isn't one.",
    help_penny_steps_h:'How to create your key',
    help_penny_step1:'Go to Google AI Studio (aistudio.google.com/apikey) and sign in with a Google account.',
    help_penny_step2:'Click "Create API key" (choose "Create key in new project" if you don\u2019t have one yet).',
    help_penny_step3:'Copy the generated key.',
    help_penny_step4:'Paste it into the "Gemini API Key" field in Ezzo Budget\u2019s Settings and click "Save key".',
    help_penny_cost_h:'Is this free?',
    help_penny_cost_p:'Gemini\u2019s API has a free tier with limits set by Google, which can change. Check your current limits any time at aistudio.google.com. The "questions asked" counter you see in Settings is a personal counter kept on your own device for your own awareness. It isn\u2019t a live reading of your Google quota.',
    help_penny_safety_h:'Is my key safe?',
    help_penny_safety_p:"Your key is encrypted before it's saved in your browser's own storage, and it's only ever sent directly to Google's API when you ask Ezzo a question. It never goes to any Ezzo Budget server.",
    help_penny_cta:'Open Google AI Studio \u2192',
    // Guide
    guide_group_start:'Getting Started', guide_group_track:'Tracking Your Money', guide_group_plan:'Planning Ahead',
    guide_group_smart:'Working Smarter', guide_group_settings:'Making It Yours',
    guide_section_big:'The Big Picture', guide_section_how:'How to Use It', guide_section_connects:'How It Connects', guide_back:'Back to topics',
    guide_welcome_title:'Welcome to Ultimate Budget Planner',
    guide_welcome_big:"Ultimate Budget Planner takes the simple idea of tracking income and spending and gives it superpowers - a real debt payoff plan, savings goals with progress bars, a bird's-eye calendar, subscription tracking, and Ezzo, an AI assistant who already knows your numbers. Start with the Dashboard, and explore the rest whenever you're ready.",
    guide_dashboard_title:'Dashboard',
    guide_dashboard_big:"The Dashboard is your command center - everything important about your money lives on this one screen, from your bottom line to what's coming up this week.",
    guide_dashboard_step1:'Check the summary cards at the top for your <strong>Total Income</strong>, <strong>Total Outgoing</strong>, <strong>Savings Rate</strong>, and <strong>Net Leftover</strong>.',
    guide_dashboard_step2:'Scroll to the <strong>Upcoming</strong> list to see everything due in the next 7 days - bills, debt payments, and subscriptions all in one place.',
    guide_dashboard_step3:'Check your <strong>Debt Payoff</strong> and <strong>Savings Goals</strong> snapshots to see progress toward your bigger goals at a glance.',
    guide_dashboard_connect1:"Every number here is pulled live from Transactions, Budget, Debt Payoff, Savings Goals, and Subscriptions - there's nothing to calculate by hand.",
    guide_dashboard_connect2:'The Net Leftover figure includes your <strong>Rollover</strong> setting, so unspent money from last period can carry forward automatically.',
    guide_dashboard_connect3:"If something looks off, it's almost always worth checking the page it came from - the Dashboard is a mirror, not a source.",
    guide_dashboard_tip:"Set aside 30 seconds each morning to scan the Dashboard - it's the fastest way to catch a bill or debt payment before it's overdue.",guide_dashboard_usecase_h:'See it in action',guide_dashboard_usecase_p:"<p><strong>Maria</strong> opens Ezzo Budget on payday. She glances at the Dashboard and sees her Net Leftover this period is $420 - enough to add a bit extra to her emergency fund.</p><p>The Cash Flow panel shows she's already over budget on Dining, so she skips ordering takeout that night instead of finding out at the end of the month.</p>",
    guide_transactions_title:'Transactions',
    guide_transactions_big:'Transactions are the foundation of everything in this app - every dollar you log here powers your Dashboard, your budget, and every chart you see. Nothing is added for you: every entry is one you say happened, so the figures always match real life.',
    guide_transactions_step1:'Tap <strong>Add Transaction</strong>, pick a type and category, and fill in the amount.',
    guide_transactions_step2:'Pay bills and debt minimums with <strong>Pay</strong> from Coming up on the dashboard: the amount and the bill are filled in for you, so it takes one tap.',
    guide_transactions_step3:'Use <strong>Import CSV</strong> to bring in existing spending data all at once instead of entering it by hand.',
    guide_transactions_step4:'Tap any transaction to edit it, or use the filters above the list to find one quickly.',
    guide_transactions_connect1:'A bill or debt payment logged here marks it paid, and deleting the payment makes it owed again, so Free to spend always matches what has really left your account.',
    guide_transactions_connect2:'Every transaction counts toward its matching category in Budget, Debt Payoff, or Subscriptions automatically.',
    guide_transactions_connect3:"Your Dashboard totals and charts are built entirely from what's logged here.",
    guide_transactions_tip:'Log a payment when it actually leaves your account, not when it is due. If an automatic payment from your bank fails, the app will still show it as owed.',guide_transactions_usecase_h:'See it in action',guide_transactions_usecase_p:"<p><strong>Jack</strong> gets his Netflix renewal charged to his card. He opens Transactions, taps <strong>+ Add Transaction</strong>, picks Expense → Entertainment, types the amount, and it's logged in seconds.</p><p>Later, doing a spring clean, he notices a batch of duplicate test entries from when he was trying out the app. He selects them with the checkboxes and taps <strong>Delete Selected</strong>, clearing them all in one go instead of deleting them one by one.</p>",
    guide_budget_title:'Budget',
    guide_budget_big:'Budget is where you set your targets - how much you expect to earn and spend across Income, Expenses, Bills, and Savings - all from one screen instead of jumping between separate tabs.',
    guide_budget_step1:'Add a category under <strong>Income</strong>, <strong>Expenses</strong>, <strong>Bills</strong>, or <strong>Savings</strong> and set its <strong>Expected</strong> amount.',
    guide_budget_step2:'As you log transactions, watch the <strong>Actual</strong> column fill in automatically for each category.',
    guide_budget_step3:'Compare Expected to Actual to see which categories are on track and which need attention.',
    guide_budget_step4:"Adjust any Expected amount as your life changes - your budget should flex with you, not the other way around.",
    guide_budget_connect1:'Every transaction you log in Transactions flows straight into the matching category here.',
    guide_budget_connect2:'Your Spending Breakdown chart and Net Leftover on the Dashboard are both built from these categories.',
    guide_budget_connect3:"If you've turned on <strong>Allocation Buckets</strong> in Settings, this page is also where you'll see how your spending lines up against those percentage targets.",
    guide_budget_tip:"Review your Expected amounts once a month - budgets that never change stop reflecting reality pretty quickly.",guide_budget_usecase_h:'See it in action',guide_budget_usecase_p:"<p>At the start of the month, <strong>Priya</strong> sets her expected amount for Groceries to $500 in the Budget tab. As she logs transactions through the month, the Actual column fills in automatically.</p><p>The progress bar turns from green to orange as she gets close to her limit - telling her to ease off before she goes over, instead of finding out after the fact.</p>",
    guide_debt_title:'Debt Payoff',
    guide_debt_big:"This is more than a place to log what you owe - it builds you an actual plan to become debt-free, showing you exactly which debt to focus on first and how much interest you'll save doing it.",
    guide_debt_step1:'Add each debt with its <strong>Balance</strong>, <strong>APR</strong> (interest rate), and <strong>Minimum Payment</strong>.',
    guide_debt_step2:'Choose a strategy: <strong>Snowball</strong> (pay off the smallest balance first for quick wins) or <strong>Avalanche</strong> (pay off the highest interest rate first to save the most money).',
    guide_debt_step3:'Add any extra amount you can put toward debt each period - the calculator applies it to whichever debt your strategy targets first.',
    guide_debt_step4:'Check your projected <strong>debt-free date</strong> and total interest to see how extra payments change the picture.',
    guide_debt_step5:'For mortgages and loans, set a <strong>Loan term</strong> and click <strong>Auto-calculate</strong> for an accurate minimum payment. For credit cards, switch to <strong>% of balance</strong> to match your real statement minimum.',
    guide_debt_step6:'Some loans use <strong>declining payments</strong> instead of equal payments - the amount going to principal stays fixed and the total payment shrinks over time. Check <strong>Repayment style</strong> to match your loan.',
    guide_debt_step7:'For an ARM, switch <strong>Rate type</strong> to "Adjusts after a fixed period" and set when it changes. For a mortgage escrow that shrinks over time, switch <strong>Escrow type</strong> to "Declining with balance".',
    guide_debt_step8:'Click the <strong>ℹ️ info icon</strong> on any debt to see its full month-by-month payment schedule. Use the <strong>Extra/mo</strong> column to aim extra payments at one specific debt, regardless of your snowball/avalanche order.',
    guide_debt_connect1:"Debt payments you log in Transactions count toward each debt's balance here.",
    guide_debt_connect2:'Your Dashboard shows a snapshot of this payoff plan so you always know where you stand without opening this page.',
    guide_debt_connect3:'Paying more than the minimum here - even a little - is usually the single biggest lever you have to shorten your payoff timeline.',
    guide_debt_tip:'Try switching between Snowball and Avalanche to compare - Snowball feels more motivating early on, but Avalanche usually saves more money overall.',guide_debt_usecase_h:'See it in action',guide_debt_usecase_p:'<p><strong>Sam</strong> has three debts: a credit card, a car loan, and a small personal loan. He enters all three, picks Avalanche so the highest-interest card gets paid off first, and sees his real payoff date and total interest right away.</p><p>When he gets a work bonus, he types it into that one card\'s <strong>Extra/mo</strong> field instead of the shared extra-payment pool, so the bonus goes exactly where he wants it - then opens the ℹ️ schedule to see month-by-month exactly how much faster he\'ll be debt-free.</p>',
    guide_sinking_title:'Savings Goals',
    guide_sinking_big:"A savings goal is money set aside for something. Give it a target and a date and it works out what you need to put in each month. Leave the target blank and it is simply a pot you add to, which is what an emergency fund really is.",
    guide_sinking_step1:'Create a goal and give it a <strong>Target Amount</strong> and, if you like, a target date.',
    guide_sinking_step2:'Add contributions whenever you set money aside for it, and watch the <strong>progress bar</strong> fill in.',
    guide_sinking_step3:"Once a goal reaches its target, you're ready for that expense without touching your regular budget.",
    guide_sinking_connect1:'Savings goals are kept apart from your everyday budget categories - they\'re for specific, planned things rather than general spending.',
    guide_sinking_connect2:"Your Dashboard shows a snapshot of all your goals' progress in one place.",
    guide_sinking_connect3:'Contributing to a goal regularly, even a small amount, is what turns a big expense into something that never derails your budget.',
    guide_sinking_tip:"Break big goals into round monthly numbers - it's much easier to commit to $50 a month than to 'save up for a vacation eventually.'",guide_sinking_usecase_h:'See it in action',guide_sinking_usecase_p:'<p><strong>Elena</strong> is planning a $1,200 vacation for next July. She creates a Savings Goal with that target amount and date, and Ezzo Budget tells her she needs to save $150/month to get there.</p><p>Each payday she moves the money and taps <strong>Add contribution</strong>, so the goal only grows when the money has really been set aside.</p>',
    guide_subscriptions_title:'Bills',
    guide_subscriptions_big:"Every payment that comes round on a schedule lives here: rent, utilities, insurance and the subscriptions that quietly pile up. Mark one as a subscription and it is still a bill, just labelled so you can see what those add up to on their own.",
    guide_subscriptions_step1:'Add each subscription along with its cost and how often it bills (monthly, yearly, etc.).',
    guide_subscriptions_step2:'Check the <strong>Monthly Cost</strong> total to see what all your subscriptions add up to.',
    guide_subscriptions_step3:"Pause or cancel anything you're not using, right from this page.",
    guide_subscriptions_connect1:'Your total subscription cost feeds directly into your Dashboard summary and your Total Outgoing.',
    guide_subscriptions_connect2:'Subscription due dates also show up on your Calendar, so you can see them alongside bills and debt payments.',
    guide_subscriptions_connect3:"Reviewing this list every few months is one of the easiest ways to find money you didn't know you were losing.",
    guide_subscriptions_tip:"Do a subscription review right after your bank statement comes in each month - it's the easiest time to spot something you forgot you were paying for.",guide_subscriptions_usecase_h:'See it in action',guide_subscriptions_usecase_p:"<p><strong>Jack</strong> adds Netflix as a subscription - $15.49, Monthly - and each month taps <strong>Pay</strong> in Coming up once the charge shows on his card, so a failed or cancelled payment never slips by unnoticed.</p><p>Six months later, Netflix raises its price to $17.99. The next time Jack edits the subscription to update it, Ezzo Budget quietly notes the price increase and shows a small ↑ next to the amount, so he can see at a glance which subscriptions have crept up in price.</p>",
    guide_calendar_title:'Calendar',
    guide_calendar_big:'The Calendar pulls every bill, debt payment, subscription charge, and transaction into one month view, so you can see everything happening with your money at a glance instead of checking five different pages.',
    guide_calendar_step1:'Browse to any month to see color-coded dots marking bills, debt payments, and subscriptions due that day.',
    guide_calendar_step2:'Tap a day to see the full list of everything happening on it.',
    guide_calendar_step3:'Use this view before you make a big purchase to see what else is due around the same time.',
    guide_calendar_connect1:"Everything shown here comes from Bills, Debt Payoff, Subscriptions, and Transactions - the Calendar doesn't hold any of its own data.",
    guide_calendar_connect2:"It's the fastest way to spot a week where several due dates land close together, before it catches you off guard.",
    guide_calendar_connect3:"Nothing you do on the Calendar changes your budget - it's purely a view, so it's completely safe to browse.",
    guide_calendar_tip:'Check the Calendar at the start of each week - it takes seconds and means due dates are never a surprise.',guide_calendar_usecase_h:'See it in action',guide_calendar_usecase_p:"<p>Before heading out for the weekend, <strong>Amir</strong> checks the Calendar to see what's due this week. He spots his electric bill is due Monday and still unpaid.</p><p>He pays it online, then checks the box right there on the calendar and types in the $87.40 he actually paid - logged without him needing to switch tabs.</p>",
    guide_rollover_title:'Rollover',
    guide_rollover_big:"Rollover means unspent money from last period doesn't just disappear - it automatically carries forward and adds to what you have available this period.",
    guide_rollover_step1:'Open <strong>Settings</strong> and find the <strong>Rollover</strong> card.',
    guide_rollover_step2:'Turn it on so any leftover amount from the previous period carries into the new one automatically.',
    guide_rollover_step3:"Check your Dashboard's Net Leftover - it will now include that carried-forward amount.",
    guide_rollover_connect1:"Rollover works directly off your Net Leftover from the previous period - the better you stick to your budget, the more it has to carry forward.",
    guide_rollover_connect2:'This is different from Savings Goals, which are for planned future spending - Rollover is just about not losing track of money you already have.',
    guide_rollover_connect3:"A string of good months compounds nicely here, since each period's leftover adds to the next.",
    guide_rollover_tip:"If a big rollover amount is burning a hole in your pocket, consider moving some of it into a Savings Goal so it's earmarked for something specific.",guide_rollover_usecase_h:'See it in action',guide_rollover_usecase_p:"<p>At the end of June, <strong>Noor</strong> has $180 left over after covering everything. Because <strong>Auto-carry</strong> is turned on, the moment she moves her budget period into July, that $180 automatically shows up as her rollover amount - added straight to her Net Leftover, instead of her having to calculate and re-type it herself.</p>",
    guide_automation_title:'Automation',
    guide_automation_big:'Automation takes the recurring rules you set up in Transactions and posts them for you automatically, so your regular bills, paychecks, and subscriptions show up right on schedule without you lifting a finger.',
    guide_automation_step1:'Open <strong>Settings</strong> and find the <strong>Automation</strong> card.',
    guide_automation_step2:"Turn it on so recurring transaction rules post automatically when they're due.",
    guide_automation_step3:'Check Transactions afterward to confirm everything posted the way you expected.',
    guide_automation_connect1:"This feature only works with recurring rules you've already created in Transactions - set those up first.",
    guide_automation_connect2:'Every transaction it posts flows into Budget, Debt Payoff, and Subscriptions exactly like one you entered by hand.',
    guide_automation_connect3:"It's the difference between a budgeting app you have to remember to update, and one that keeps itself current.",
    guide_automation_tip:'Turn on Automation once your recurring rules feel accurate - it is most useful once you trust the numbers it will post.',guide_automation_usecase_h:'See it in action',guide_automation_usecase_p:"<p><strong>Tom</strong> has three things that repeat every month: rent, his car loan payment, and a Netflix subscription. Instead of typing all three in by hand each period, he turns on <strong>Automate</strong> for each one.</p><p>Every time he opens the app in a new period, Ezzo Budget has already logged them as transactions on schedule, and Tom only needs to review what's new instead of re-entering what's routine.</p>",
    guide_penny_title:'Ezzo',
    guide_penny_big:'Ezzo is your own AI budget assistant, built right into the app - ask her a question about your money in plain English, and she reads your real budget data to give you a real answer, complete with charts when it helps.',
    guide_penny_step1:"Open <strong>Settings</strong>, turn on Ezzo, and paste in your own Gemini API key (there's a link right there showing exactly how to get one for free).",
    guide_penny_step2:'Tap the sparkle icon in the top navigation to open the chat.',
    guide_penny_step3:"Ask a question in your own words, like 'what's my biggest spending category this month?', or tap one of the quick-question buttons to get started.",
    guide_penny_step4:"Toggle her voice reply on or off with the speaker icon if you'd rather listen than read.",
    guide_penny_connect1:'Ezzo can only see your budget data to answer questions - she can never add, edit, or delete anything for you.',
    guide_penny_connect2:"She pulls straight from Dashboard, Transactions, Debt Payoff, Subscriptions, and Savings Goals, so her answers always match what you'd see on those pages yourself.",
    guide_penny_connect3:"Your API key is encrypted and stored only on your own device - it's never sent anywhere except directly to Google when you ask Ezzo a question.",
    guide_penny_tip:"Start with one of the quick-question buttons the first time - it's the fastest way to see what she can do before asking your own questions.",guide_penny_usecase_h:'See it in action',guide_penny_usecase_p:'<p>Whenever <strong>Diane</strong> isn\'t sure where her money went this month, she opens Ezzo and asks "why is my spending higher than usual this month?"</p><p>Ezzo looks at her actual transactions and gives her a plain-language answer - pointing out, say, that Dining spending doubled - instead of her having to dig through the Transactions list herself.</p>',
    guide_settings_title:'Settings',
    guide_settings_big:'Settings is where the app adapts to you - currency, budgeting period, rollover, appearance, persona, and how your data is stored and backed up.',
    guide_settings_step1:'Pick your <strong>Currency</strong> and <strong>Budget Period</strong> so the app matches how you actually get paid and spend.',
    guide_settings_step2:'Turn on <strong>Rollover</strong> if you want unspent money to carry into the next period.',
    guide_settings_step3:'Pick an <strong>Appearance</strong> theme (Light, Peachy, Dark, Vintage, Jolly or Frosty), and a <strong>Persona</strong> for how the app talks to you.',
    guide_settings_step4:'Set up <strong>Allocation Buckets</strong> if you want to budget by percentage (like 50% needs, 30% wants, 20% savings) instead of fixed category amounts.',
    guide_settings_step5:'Choose how your data is stored under <strong>Data & Sync</strong> - locally on this device, or synced with Google Drive so it follows you across devices.',
    guide_settings_step6:'Use <strong>Export Data</strong> to back up everything, or <strong>Reset Data</strong> if you ever want to start completely fresh.',
    guide_settings_connect1:'Your Currency, Budget Period, and Rollover choices here shape how every other page in the app calculates and displays numbers.',
    guide_settings_connect2:'Turning on Google sync here is what lets your data follow you if you open the app on a different device.',
    guide_settings_connect3:"Exporting your data here is the safest habit to build before making any big change you're not sure about.",
    guide_settings_tip:'Set up Currency, Budget Period, and Data & Sync first, before anything else - they are the foundation everything else in the app is built on.',guide_settings_usecase_h:'See it in action',guide_settings_usecase_p:'<p>When <strong>Ben</strong> switches to freelance work, his income no longer lines up with the calendar month. He opens Settings and changes his Budget Period to a custom date range that matches his actual pay cycle.</p><p>He picks USD as his currency, and turns off the Automation master switch temporarily while he re-plans his budget from scratch.</p>',
    upg_chip_tx:'{0} / {0} free transactions used',
    upg_chip_recurring:'{0} / {0} free automatic transactions used',
    upg_chip_subs:'{0} / {0} free subscription used',
    upg_chip_sinking:'{0} / {0} free savings goal used',
    upg_chip_debts:'{0} / {0} free debt used',
    upg_chip_cat:'{0} / {0} free {1} categories used',
    upg_chip_limit:'Free trial limit reached',
    upg_aria_label:'Upgrade to unlock the full planner',
    close_aria:'Close',help_aria:'Help',ok:'OK',
    upg_title_html:'Unlock the full<br>Ultimate Budget Planner',
    upg_sub:"You're at the free trial limit. Upgrade once to remove every cap. No subscription, ever.",
    upg_feat_unlimited_tx_html:'<strong>Unlimited</strong> transactions',
    upg_feat_unlimited_cat_html:'<strong>Unlimited</strong> budget categories in every section',
    upg_feat_unlimited_other_html:'<strong>Unlimited</strong> debts, subscriptions &amp; savings goals',
    upg_feat_onetime:'One-time payment · free updates for life',
    upg_price_tag:'one-time',upg_price_note:'No subscription',
    upg_cta_ubp:'Unlock Ultimate for {0}',
    upg_upsell_lead:'💰 Just need the basics?',upg_upsell_cta:'Get Simple for {0} →',
    upg_later:'Maybe later',
    sample_loaded_toast:'Sample data loaded',
    onb_step_x_of_y:'Step {0} of {1}',
    onb_setup_title:"Let's get you set up",
    onb_setup_sub:"Set your currency and budget period - you can always change these later in Settings.",
    onb_continue_btn:'Continue',
    onb_skip_link:"Skip, I'll explore on my own",
    onb_spot_budget_title:'Set an expected amount',
    onb_spot_budget_body:"This is where you plan ahead. Type how much you expect to earn from your first income source below.",
    onb_spot_tx_title:'Log your first transaction',
    onb_spot_tx_body:"Transactions are what actually happened. Press Add transaction, fill in the date, category and amount, and your first one is logged.",
    onb_next_btn:'Next',
    onb_nice_toast:'Nice! Moving on...',
    onb_tips_title:"You're all set!",
    onb_tips_sub:'A few more things worth knowing:',
    onb_tip1_h:'Guide button',onb_tip1_b:'Tap the ? icon on any tab for detailed help on that section.',
    onb_tip2_h:'Fill in the rest',onb_tip2_b:"Don't forget Expenses, Bills & Savings - the same way you just did Income.",
    onb_tip3_h:'Pro tools',onb_tip3_b:'Explore the Debt Payoff calculator, Savings Goals, Subscriptions and the Smart Calendar.',
    onb_tip4_h:'Sync across devices',nav_dock_aria:'Quick actions',onb_tip4_b:'Turn on Google Sync in Settings to access your budget from any device.',
    onb_finish_btn:'Start budgeting →',
    sync_card_title:'☁️ Data &amp; Sync',sync_card_desc:'Choose how your data is stored and kept up to date across devices.',
    sync_mode_local_title:'This device only',sync_mode_local_desc:'Data is saved on this device only',
    sync_recommended:'Recommended',
    sync_mode_google_title:'Sync with Google',sync_mode_google_desc:'Data is synced across multiple devices',
    sync_signed_in_as:'Signed in as {0}',sync_error_generic:"Sign-in didn't go through. Please try again.",
    toast_synced_google:'Synced with Google Drive ✓',toast_synced_local:'Switched to local storage ✓',
    sync_err_popup_blocked:'Your browser blocked the Google sign-in window. Please allow pop-ups for this site (check your address bar for a blocked pop-up icon) and try again.',
    sync_err_cancelled:'Sign-in was cancelled. Please try again.',
  },

};

function t(key) {
  // The chosen persona speaks first; whatever it has no version of reads as Stiff.
  const persona = state?.settings?.persona;
  if (persona && persona !== 'stiff' && typeof PERSONA_WORDS !== 'undefined') {
    const pv = PERSONA_WORDS[persona]?.[key];
    if (pv != null) return pv;
  }
  const lang = 'en';
  const v = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key];
  if (v != null) return v;
  // Last-resort safeguard: never render a raw key identifier in the UI
  return String(key).replace(/^(tx|sf|dpc|cal|sett|alloc|bud|dtype|help|toast|freq|dash|sub|rec|dp|sett)_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
function tf(key, ...args) { let s=t(key); args.forEach((v,i)=>s=s.replaceAll(`{${i}}`,v)); return s; }

// Home leads to the dashboard rather than back out to the tools page, so
// it says so, in whatever language is set. Called at startup and again
// whenever the language changes.
function syncHomeLabel() {
  const b = document.getElementById('backToHub');
  if (!b) return;
  const label = t('tab_dashboard');
  b.title = label;
  b.setAttribute('aria-label', label);
}
function applyLanguage() {
  const lang = 'en';
  document.documentElement.lang = lang;
  // Update tab labels live
  document.querySelectorAll('.btab[data-btab]').forEach(btn => {
    const key = 'tab_' + btn.dataset.btab;
    const tx = TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key];
    if (tx) {
      btn.title = tx;
      // The icon and the label are separate elements so a narrow screen can
      // set the label aside and run on the icon alone. Only the label is
      // rewritten; writing over the button would flatten both back into one
      // text node and the split would be lost on the first language change.
      const txt = btn.querySelector('.btab-txt');
      if (txt) { txt.textContent = tx; return; }
      // Markup that predates the split: rebuild it, keeping the emoji.
      const current = btn.textContent.trim();
      const emoji = current.match(/^(\p{Emoji}[\uFE0F\u20E3]?\s*)/u)?.[0] || '';
      btn.innerHTML = '<i class="btab-ico" aria-hidden="true">' + esc(emoji.trim()) +
        '</i><span class="btab-txt">' + esc(tx) + '</span>';
    }
  });
  paintTabIcons();
  syncHomeLabel();
  // The rail's labels are copies of the tab bar's, so they follow it here.
  if (document.querySelector('.nav-rail')) buildNavRail();
}

let _did=0;
function svgDonut(segs,size=130,sw=17) {
  const r=size/2-sw/2,c=2*Math.PI*r,cx=size/2,cy=size/2;
  const gid='d'+(++_did);
  // Radial gradient for visual depth
  const defs=`<defs><radialGradient id="rg${gid}" cx="38%" cy="32%" r="68%"><stop offset="0%" stop-color="white" stop-opacity="0.18"/><stop offset="100%" stop-color="black" stop-opacity="0.06"/></radialGradient></defs>`;
  const bg=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(30,27,46,.08)" stroke-width="${sw}"/>`;
  if(!segs||!segs.length) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">${defs}${bg}</svg>`;
  let arcs='',cum=0;
  segs.forEach((s,idx)=>{
    const p=s.pct||0;if(p<=0){cum+=p;return;}
    const dash=(p/100)*c,gap=c-dash,rot=-90+(cum/100)*360;
    arcs+=`<circle class="dseg" data-idx="${idx}" data-label="${esc(s.label||'')}" data-pct="${p.toFixed(1)}" data-val="${s.value||0}"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"
      tabindex="0" role="button" aria-label="${esc(s.label||'')}: ${p.toFixed(0)}%, ${esc(fmt(s.value||0))}"
      style="cursor:pointer;transition:stroke-width .18s,opacity .18s"/>`;
    cum+=p;
  });
  // Gradient overlay for depth effect
  const overlay=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#rg${gid})" stroke-width="${sw+6}" pointer-events="none"/>`;
  // Center hover label
  const fs1=(size*.14).toFixed(0),fs2=(size*.085).toFixed(0);
  const center=`<g class="donut-center" pointer-events="none">
    <text class="donut-hover-pct" x="${cx}" y="${cy+2}" text-anchor="middle" dominant-baseline="middle"
      style="font-family:var(--font-display);font-weight:800;font-size:${fs1}px;fill:var(--text-primary);opacity:0;transition:opacity .15s"></text>
    <text class="donut-hover-lbl" x="${cx}" y="${cy+parseInt(fs1)+4}" text-anchor="middle"
      style="font-size:${fs2}px;fill:var(--text-secondary);opacity:0;transition:opacity .15s"></text>
  </g>`;
  return `<svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0;overflow:visible">${defs}${bg}${arcs}${overlay}${center}</svg>`;
}

function initDonuts(container) {
  (container||document).querySelectorAll('.donut-svg').forEach(svg => {
    const segs=svg.querySelectorAll('.dseg');
    if(!segs.length) return;
    const baseSW=parseFloat(segs[0].getAttribute('stroke-width')||17);
    const pctEl=svg.querySelector('.donut-hover-pct');
    const lblEl=svg.querySelector('.donut-hover-lbl');
    const legend=svg.closest('.donut-block')?.querySelector('.donut-legend');
    const legRows=legend?Array.from(legend.querySelectorAll('.dleg-row')):[];
    const show=seg=>{
      segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='0.45';});
      seg.setAttribute('stroke-width',baseSW+5);seg.style.opacity='1';
      if(pctEl){pctEl.textContent=seg.dataset.pct+'%';pctEl.style.opacity='1';}
      if(lblEl){lblEl.textContent=seg.dataset.label;lblEl.style.opacity='1';}
      const row=legRows.find(r=>r.dataset.idx===seg.dataset.idx);
      if(row){
        row.classList.add('is-active');
        const amtEl=row.querySelector('.dleg-pct');
        if(amtEl){if(amtEl.dataset.pctText===undefined)amtEl.dataset.pctText=amtEl.textContent;amtEl.textContent=fmt(parseFloat(seg.dataset.val)||0);}
      }
    };
    const hide=()=>{
      segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='1';});
      if(pctEl)pctEl.style.opacity='0';
      if(lblEl)lblEl.style.opacity='0';
      legRows.forEach(row=>{
        row.classList.remove('is-active');
        const amtEl=row.querySelector('.dleg-pct');
        if(amtEl&&amtEl.dataset.pctText!==undefined)amtEl.textContent=amtEl.dataset.pctText;
      });
    };
    segs.forEach(seg=>{
      seg.addEventListener('mouseenter',()=>show(seg));
      seg.addEventListener('mouseleave',hide);
      seg.addEventListener('touchstart',e=>{e.preventDefault();show(seg);},{passive:false});
      seg.addEventListener('touchend',()=>setTimeout(hide,1600));
      seg.addEventListener('focus',()=>show(seg));
      seg.addEventListener('blur',hide);
    });
    legRows.forEach(row=>{
      const seg=Array.from(segs).find(s=>s.dataset.idx===row.dataset.idx);
      if(!seg) return;
      row.setAttribute('tabindex','0');
      row.setAttribute('role','button');
      row.setAttribute('aria-label',seg.getAttribute('aria-label')||'');
      row.addEventListener('mouseenter',()=>show(seg));
      row.addEventListener('mouseleave',hide);
      row.addEventListener('focus',()=>show(seg));
      row.addEventListener('blur',hide);
    });
  });
}

// ── Drag scroll, Theme, Nav ────────────────────────────────────────────
function enableDragScroll(el) {
  if(!el) return; let pos=null,dragged=false;
  el.addEventListener('mousedown',e=>{pos={left:el.scrollLeft,x:e.clientX};dragged=false;});
  el.addEventListener('mousemove',e=>{if(!pos||!(e.buttons&1)){pos=null;return;}const dx=e.clientX-pos.x;if(Math.abs(dx)>4){dragged=true;el.classList.add('is-dragging');}el.scrollLeft=pos.left-dx;});
  const stop=()=>{pos=null;el.classList.remove('is-dragging');};
  el.addEventListener('mouseup',stop);el.addEventListener('mouseleave',stop);
  el.addEventListener('click',e=>{if(dragged){e.stopPropagation();dragged=false;}},true);
}
function applyTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem('evobudget_theme',t);document.querySelectorAll('.theme-opt').forEach(b=>b.classList.toggle('is-active',b.dataset.themeVal===t));}
function initTheme(){let th=localStorage.getItem('evobudget_theme')||'dark';if(th==='terminal')th='jolly';if(th==='minimal')th='peachy';if(th==='synthwave')th='dark';applyTheme(th);}

// ── Dashboard Layout picker (Settings) ─────────────────────────────────
const DASHBOARD_LAYOUT_ICONS = {
  1: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  2: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10.5"/>',
  // A wide header band over a row of cards: the shape Sleek makes.
  3: '<rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="13" width="8" height="7" rx="1.6"/><rect x="14" y="13" width="7" height="7" rx="1.6"/>'
};
// ── Navigation position: top (default) / left / right ─────────────────
// Docked left or right, the rail is the whole chrome: the app title, the
// sections, the widgets, and the tool buttons. The topbar has nothing left
// to show, so it is hidden and the rail becomes the only navigation.
//
// The section buttons are generated from the tab bar rather than being a
// second hand-maintained list, so what sections exist - and what they are
// called in each of the six languages - can only come from one place. The
// tab bar stays in the DOM while hidden, which is what keeps
// applyLanguage's existing pass over .btab the source for both.
const NAV_POSITIONS = ['top', 'left', 'right'];
const NAV_POS_ICONS = {
  top:   '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  left:  '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  right: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'
};

function getNavPosition() {
  const v = state?.settings?.navPosition;
  // The sidebar is the default: the app sits in one frame with the
  // sections down its left edge. A phone still gets the top bar and dock.
  return NAV_POSITIONS.includes(v) ? v : 'left';
}

// A phone has no room for a rail, so below this width the tab bar comes
// back and the topbar takes its controls again. The setting is untouched:
// widen the window and the rail returns.
const NAV_RAIL_MQ = window.matchMedia('(max-width: 760px)');
function navRailDocks() { return getNavPosition() !== 'top' && !NAV_RAIL_MQ.matches; }

// ── Borrowing the topbar's controls ──────────────────────────────────
// They are MOVED, not copied, so there is never a second #settingsNavBtn
// and nothing needs rewiring - every button keeps the listener it was
// given at startup. railRelease puts each one back where it began.
const RAIL_ADOPT = ['backToHub', 'guideNavBtn', 'pennyNavBtn', 'settingsNavBtn'];
let _railHome = null;

function railRemember() {
  if (_railHome) return;
  _railHome = {};
  const note = el => { if (el && el.id) _railHome[el.id] = { parent: el.parentNode, next: el.nextSibling }; };
  const mark = document.querySelector('.tool-shell .wordmark');
  if (mark && !mark.id) mark.id = 'railBrand';
  note(mark);
  RAIL_ADOPT.forEach(id => note(document.getElementById(id)));
}

function railAdopt(rail) {
  railRemember();
  const brand = rail.querySelector('.nav-rail-brand');
  const tools = rail.querySelector('.nav-rail-tools');
  const mark = document.getElementById('railBrand');
  if (mark && brand && mark.parentNode !== brand) brand.appendChild(mark);
  // Appended in RAIL_ADOPT order, which is the order they read in the rail.
  RAIL_ADOPT.forEach(id => {
    const el = document.getElementById(id);
    if (el && tools && el.parentNode !== tools) tools.appendChild(el);
  });
}

function railRelease() {
  if (!_railHome) return;
  Object.keys(_railHome).forEach(id => {
    const el = document.getElementById(id), home = _railHome[id];
    if (!el || !home || !home.parent || el.parentNode === home.parent) return;
    // Only aim for the original sibling if it is still where it was.
    const before = (home.next && home.next.parentNode === home.parent) ? home.next : null;
    home.parent.insertBefore(el, before);
  });
}

// ── The rail itself ──────────────────────────────────────────────────
function navRailEl() {
  const tabs = document.getElementById('ubpTabs');
  const shell = tabs && tabs.closest('.tool-shell');
  if (!shell) return null;
  let rail = shell.querySelector('.nav-rail');
  if (!rail) {
    rail = document.createElement('nav');
    rail.className = 'nav-rail';
    rail.setAttribute('aria-label', tabs.getAttribute('aria-label') || '');
    rail.innerHTML = '<div class="nav-rail-box">' +
      '<div class="nav-rail-brand"></div>' +
      '<p class="nav-rail-heading" data-i18n-rail="rail_nav"></p>' +
      '<div class="nav-rail-sections" id="navRailSections"></div>' +
      '<div class="nav-rail-sections nav-rail-extra" id="navRailExtra"></div>' +
      '<div class="nav-rail-widgets" id="navWidgets"></div>' +
      '<div class="nav-rail-tools"></div>' +
      '<div class="nav-rail-sections nav-rail-foot" id="navRailFoot"></div>' +
      '<p class="nav-rail-heading" data-i18n-rail="rail_account"></p>' +
      '<button class="nav-rail-account" id="navRailAccount" type="button"></button>' +
      '</div>';
    rail.querySelector('#navRailAccount').addEventListener('click', () =>
      document.getElementById('settingsNavBtn')?.click());
    // Delegated, so redrawing the sections never re-attaches listeners.
    rail.addEventListener('click', e => {
      const b = e.target.closest('.nav-rail-item');
      if (b && b.dataset.railAct) { document.getElementById(b.dataset.railAct)?.click(); return; }
      if (b) switchTab(b.dataset.btab);
    });
    shell.insertBefore(rail, shell.firstChild);
  }
  return rail;
}

// ── Section badges ───────────────────────────────────────────────────────
// A number beside a section says how many things there want a look: bills
// overdue or due within a week, debt payments due within a week, budget
// categories already over, expenses still waiting for a category, and
// goals whose date has passed short of the target. Red when any of them
// is already late. Counted from the same helpers the sections use, so a
// badge can never point at something the section itself does not show.
const BADGE_SOON_DAYS = 7;
function collectNotifications() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const today = toLocalISO(now);
  const soon = toLocalISO(new Date(now.getTime() + BADGE_SOON_DAYS * 86400000));
  const out = [];
  // Bills overdue, and bills due within the week.
  (state.bills || []).filter(b => b.active !== false && b.nextBillingDate && b.nextBillingDate <= soon && rowPayState(b) !== 'paid')
    .forEach(b => {
      const late = b.nextBillingDate < today, owe = rowRemaining(b) || rowExpected(b);
      out.push({ id: 'bill:' + b.id, kind: late ? 'bill_late' : 'bill_soon', flash: ['bills', rfIds('data-bill-row', [b.id])], section: 'bills', level: late ? 'late' : 'soon', tag: late ? 'overdue' : 'soon', date: b.nextBillingDate,
        title: b.name, detail: tf(late ? 'nt_bill_late' : 'nt_bill_soon', fmt(owe), cuRelative(b.nextBillingDate)),
        act: { label: t('pay_btn'), run: done => promptPay('bill', b.id, done) } });
    });
  // Debt minimums due within the week.
  let ev = [];
  try { ev = getUpcomingEvents(BADGE_SOON_DAYS, computeActuals()) || []; } catch (e) { ev = []; }
  const seen = new Set();
  // A minimum whose date has passed unpaid this period, as a late bill is.
  let dAct = {};
  try { dAct = computeActuals().debt || {}; } catch (e) { dAct = {}; }
  (state.debts || []).forEach(d => {
    const miss = debtOverdueDates(d, dAct).dates[0];
    if (!miss) return;
    seen.add(d.id);
    out.push({ id: 'debt:' + d.id, kind: 'debt_late', flash: ['debt', rfIds('data-debt-row', [d.id])], section: 'debt', level: 'late', tag: 'overdue', date: miss.date,
      title: d.name, detail: tf('nt_bill_late', fmt(miss.owe), cuRelative(miss.date)),
      act: { label: t('pay_btn'), run: done => promptPay('debt', d.id, done, miss.date) } });
  });
  ev.filter(e => e.type === 'debt' && !e.paid && (Number(e.amount) || 0) > 0).forEach(e => {
    if (seen.has(e.srcId)) return; seen.add(e.srcId);
    out.push({ id: 'debt:' + e.srcId, kind: 'debt_soon', flash: ['debt', rfIds('data-debt-row', [e.srcId])], section: 'debt', level: 'soon', tag: 'soon', date: e.date,
      title: e.label, detail: tf('nt_debt_soon', fmt(e.amount), cuRelative(e.date)),
      act: { label: t('pay_btn'), run: done => promptPay('debt', e.srcId, done, e.date) } });
  });
  // Categories already over.
  let exp = {};
  try { exp = computeActuals().expenses || {}; } catch (e) { exp = {}; }
  (state.budgets?.expenses || []).forEach(r => {
    const a = exp[r.category] || 0;
    if ((r.expected || 0) > 0 && a > r.expected) out.push({ id: 'over:' + r.id, kind: 'over', flash: ['budget', rfIds('data-env-id', [r.id])], section: 'budget', level: 'late', tag: 'over',
      title: r.category, detail: tf('nt_over', fmt(a - r.expected), fmt(r.expected)),
      act: { label: t('nt_act_review'), run: () => goAndFlash('budget', rfIds('data-env-id', [r.id])) } });
  });
  // Expenses logged to sort later.
  const uncat = new Set(Object.values(TRANSLATIONS).map(x => x && x.qa_uncat).filter(Boolean));
  const loose = (state.transactions || []).filter(tx => tx.type === 'expense' && (!tx.category || uncat.has(tx.category)));
  const looseSel = rfIds('data-tx-row', loose.map(x => x.id));
  if (loose.length) out.push({ id: 'uncat', kind: 'uncat', flash: ['transactions', looseSel], section: 'transactions', level: 'todo', tag: 'todo', count: loose.length,
    title: loose.length === 1 ? t('nt_uncat_one') : tf('nt_uncat_title', loose.length), detail: t('nt_uncat_detail'),
    act: { label: t('nt_act_sort'), run: () => goAndFlash('transactions', looseSel) } });
  // Goals whose date passed short of the target.
  (state.sinkingFunds || []).forEach(f => {
    if ((f.targetAmount || 0) > 0 && f.targetDate && f.targetDate < today && (f.currentSaved || 0) < f.targetAmount)
      out.push({ id: 'goal:' + f.id, kind: 'goal_late', flash: ['goals', rfIds('data-fund-card', [f.id])], section: 'goals', level: 'late', tag: 'pastdate', date: f.targetDate,
        title: f.name, detail: tf('nt_goal_late', fmt(f.targetAmount - (f.currentSaved || 0))),
        act: { label: t('nt_act_review'), run: () => goAndFlash('goals', rfIds('data-fund-card', [f.id])) } });
  });
  return out;
}
// ── Heads-ups join the same list ──
// The checks on the dashboard become items like any other. Five of them
// said what a notification already says (an overdue bill, a missed debt
// payment, a category over, a goal past its date, spending to sort), so
// those are left to the notification, which can act on the one row.
const HU_DUP = new Set(['overdue', 'over', 'goal_late', 'missed', 'loose']);
const HU_TIDY = new Set(['unplanned', 'unbill', 'undebt', 'ungoal', 'uninc', 'untagged', 'dupe', 'future', 'nodate', 'noplan']);
const HU_SECTION = { pace: 'budget', runout: 'budget', short: 'dashboard', noplan: 'budget', unplanned: 'transactions', unbill: 'transactions',
  undebt: 'transactions', ungoal: 'transactions', uninc: 'transactions', untagged: 'transactions', alloc_save: 'goals', alloc: 'transactions',
  plan: 'budget', income: 'transactions', noincome: 'transactions', nosave: 'goals', goal_track: 'goals', apr: 'debt', interest: 'debt',
  rise: 'bills', jump: 'bills', nodate: 'bills', subs: 'bills', big: 'transactions', spike: 'budget', trend: 'transactions',
  dupe: 'transactions', future: 'transactions', thin: 'budget', ended: 'dashboard' };
function headsUpItems() {
  let rf;
  try { const act = computeActuals(); rf = computeRedFlags({ act, sum: computeSummary(act) }); } catch (e) { return []; }
  return (rf.all || []).filter(x => !HU_DUP.has(x.kind)).map(x => {
    const tidy = HU_TIDY.has(x.kind), high = x.sev === 'high';
    return { id: 'hu:' + x.id, kind: x.kind, src: 'hu', flag: x, section: HU_SECTION[x.kind] || 'dashboard',
      level: high ? 'late' : tidy ? 'todo' : 'worth', tag: high ? 'urgent' : tidy ? 'todo' : 'worth',
      title: x.title, detail: x.detail, flash: (x.act && x.act.run && x.act.run.go) || null,
      act: x.act ? { label: x.act.label, run: () => x.act.run() } : null };
  });
}
// Everything that wants a look, in the order it is worth reading.
const NT_LEVEL_ORDER = { late: 0, soon: 1, worth: 2, todo: 3 };
function collectInbox() {
  return collectNotifications().concat(headsUpItems());
}
function ntSorted(items) {
  return items.slice().sort((a, b) => (NT_LEVEL_ORDER[a.level] - NT_LEVEL_ORDER[b.level]) || String(a.date || '9').localeCompare(String(b.date || '9')));
}
function ntTagLabel(tag) { return tag === 'urgent' ? t('rf_urgent') : tag === 'worth' ? t('rf_worth') : t('nt_tag_' + tag); }
// The ? beside any item: a heads-up explains itself the way it always has,
// a notification the way it always has.
function ntOpenHelp(it, after) {
  if (it.src === 'hu') openRfHelp(it.flag);
  else openNtHelp(it, () => it.act.run(after));
}
// The arrow goes to the very thing, lit up.
function ntGo(it) { if (it.flash) goAndFlash(it.flash[0], it.flash[1]); else switchTab(it.section); }

// The badges count what needs doing now or this week. Things worth a look
// and things to tidy wait on the Notifications page without raising the
// number, so the number keeps meaning something.
// Ignoring is per item and per due date, so next month's bill still shows.
function ntKey(i) { return `${i.id}|${i.date || state.settings.periodStart || ''}`; }
function ntIgnored(i) { return !!(state.settings.ntIgnore || {})[ntKey(i)]; }
function navBadgeCounts() {
  const out = {}, total = { n: 0, late: false };
  collectInbox().filter(i => !ntIgnored(i) && (i.level === 'late' || i.level === 'soon')).forEach(i => {
    const c = out[i.section] || (out[i.section] = { n: 0, late: false });
    const k = i.count || 1;
    c.n += k; total.n += k;
    if (i.level === 'late') { c.late = true; total.late = true; }
  });
  out.__total = total;
  return out;
}
const NT_GROUPS = [['late', 'nt_group_late'], ['soon', 'nt_group_soon'], ['worth', 'rf_worth'], ['todo', 'nt_group_todo']];
const NT_ICON = { bills: 'bills', debt: 'debt', budget: 'budget', expenses: 'expenses', transactions: 'transactions', goals: 'sinking', dashboard: 'dashboard' };
// The paid row takes a tick, slides off and folds shut, so the rows under
// it close the gap; the same motion Coming up uses on the dashboard.
function ntSnapshot(scope) {
  const rows = [...scope.querySelectorAll('[data-nt-key]:not(.cu-leave)')];
  return { keys: rows.map(r => r.dataset.ntKey), html: new Map(rows.map(r => [r.dataset.ntKey, r.outerHTML])),
           after: new Map(rows.map(r => [r.dataset.ntKey, r.nextElementSibling?.dataset.ntKey || null])),
           group: new Map(rows.map(r => [r.dataset.ntKey, r.parentElement?.dataset.ntGroup || ''])),
           lists: new Map([...scope.querySelectorAll('.nt-list[data-nt-group]')].map(l => [l.dataset.ntGroup, { cls: l.className, title: l.closest('.nt-group')?.querySelector('.nt-group-title')?.textContent || '' }])) };
}
function ntAnimateAfterPay(scope, prev, opts) {
  const tick = !(opts && opts.tick === false);
  if (!prev) return;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
  const now = new Set([...scope.querySelectorAll('[data-nt-key]:not(.cu-leave)')].map(r => r.dataset.ntKey));
  prev.keys.forEach(k => {
    if (now.has(k)) return;
    const lvl = prev.group.get(k);
    let list = scope.querySelector(`.nt-list[data-nt-group="${lvl}"]`);
    // Its group emptied with it: the group comes back just long enough for
    // the row to take its tick and fold away.
    if (!list) {
      const was = prev.lists && prev.lists.get(lvl);
      if (!was) return;
      const sec = document.createElement('section');
      sec.className = 'nt-group nt-group--leaving';
      sec.innerHTML = `<h3 class="nt-group-title">${esc(was.title)}</h3><div class="${esc(was.cls)}" data-nt-group="${esc(lvl)}"></div>`;
      const order = NT_GROUPS.map(g => g[0]), after = order.slice(order.indexOf(lvl) + 1);
      const next = after.map(g => scope.querySelector(`.nt-list[data-nt-group="${g}"]`)?.closest('.nt-group')).find(Boolean)
        || scope.querySelector('.nt-empty');
      if (next) next.parentNode.insertBefore(sec, next); else scope.appendChild(sec);
      setTimeout(() => sec.remove(), 950);
      list = sec.querySelector('.nt-list');
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = prev.html.get(k);
    const ghost = tmp.firstElementChild;
    ghost.classList.add('cu-leave'); ghost.setAttribute('aria-hidden', 'true');
    const act = ghost.querySelector('.nt-act');
    if (act && !tick) { act.disabled = true; act.removeAttribute('data-nt-act'); }
    else if (act) { act.disabled = true; act.removeAttribute('data-nt-act'); act.classList.add('cu-pay'); act.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'; }
    const nextKey = prev.after.get(k);
    const before = nextKey ? list.querySelector(`[data-nt-key="${nextKey}"]`) : null;
    list.insertBefore(ghost, before);
    ghost.style.height = ghost.offsetHeight + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('is-going')));
    setTimeout(() => ghost.remove(), 900);
  });
}
const NT_GO_SVG = '<svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
// The same four controls wherever an item is shown: its action, Ignore,
// what it means, and the way to it.
function ntActsHtml(i, kind) {
  const p = kind || 'nt';
  return `${i.act ? `<button class="btn btn-primary btn-sm nt-act" type="button" data-${p}-act="${esc(i.id)}">${esc(i.act.label)}</button>` : ''}
    <button class="btn btn-ghost btn-sm nt-ignore" type="button" data-${p}-ignore="${esc(i.id)}">${t('nt_ignore')}</button>
    <span class="nt-icons"><button class="lv-act nt-help" type="button" data-${p}-help="${esc(i.id)}" title="${esc(t('nth_aria'))}" aria-label="${esc(t('nth_aria'))}">?</button><button class="lv-act nt-go" type="button" data-${p}-go="${esc(i.id)}" title="${esc(tf('nt_open', t('tab_' + i.section) || i.section))}" aria-label="${esc(tf('nt_open', t('tab_' + i.section) || i.section))}">${NT_GO_SVG}</button></span>`;
}
function renderNotifications() {
  queueNavBadges();
  const el = document.getElementById('bview-notifications');
  if (!el) return;
  const every = collectInbox();
  const ignored = every.filter(ntIgnored).length;
  const items = ntSorted(every.filter(i => !ntIgnored(i)));
  const count = lvl => items.filter(i => i.level === lvl).reduce((s, i) => s + (i.count || 1), 0);
  const cards = viewMode('notifications') === 'cards';
  const rowHtml = i => `
        <div class="nt-row nt-row--${i.level}" data-nt-key="${esc(i.id)}">
          <span class="nt-ico" aria-hidden="true">${appIconSvg(NT_ICON[i.section] || 'bell')}</span>
          <span class="nt-main"><span class="nt-title">${esc(i.title)}<i class="nt-tag nt-tag--${i.tag}">${esc(ntTagLabel(i.tag))}</i></span>${i.detail ? `<span class="nt-detail">${esc(i.detail)}</span>` : ''}</span>
          <span class="nt-acts">${ntActsHtml(i)}</span>
        </div>`;
  const cardHtml = i => `
        <div class="nt-card nt-row--${i.level}" data-nt-key="${esc(i.id)}">
          <div class="nt-card-top"><span class="nt-ico" aria-hidden="true">${appIconSvg(NT_ICON[i.section] || 'bell')}</span><i class="nt-tag nt-tag--${i.tag}">${esc(ntTagLabel(i.tag))}</i></div>
          <span class="nt-main"><span class="nt-title">${esc(i.title)}</span>${i.detail ? `<span class="nt-detail">${esc(i.detail)}</span>` : ''}</span>
          <span class="nt-acts">${ntActsHtml(i)}</span>
        </div>`;
  el.innerHTML = `<div class="section-header"><h2 class="section-title">${appIconSvg('bell')} ${t('nt_title')}</h2><div class="section-header-actions">${viewToggleBtn('notifications')}</div></div>
    <p class="section-desc">${t('nt_desc')}${ignored ? ` <button class="link-btn nt-unignore" type="button" data-nt-unignore>${tf('nt_ignored_show', ignored)}</button>` : ''}</p>
    ${items.length ? `<div class="nt-summary">${NT_GROUPS.map(([lvl, key]) =>
      `<div class="nt-sum nt-sum--${lvl}"><strong>${count(lvl)}</strong><span>${t(key)}</span></div>`).join('')}</div>
    ${NT_GROUPS.map(([lvl, key]) => {
      const rows = items.filter(i => i.level === lvl);
      if (!rows.length) return '';
      return `<section class="nt-group"><h3 class="nt-group-title">${t(key)}</h3>${cards
        ? `<div class="nt-cards nt-list" data-nt-group="${lvl}">${rows.map(cardHtml).join('')}</div>`
        : `<div class="lv nt-list" data-nt-group="${lvl}">${rows.map(rowHtml).join('')}</div>`}</section>`;
    }).join('')}`
    : `<div class="nt-empty"><span class="nt-empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
      <p class="nt-empty-title">${t('nt_empty_title')}</p><p class="nt-empty-sub">${t('nt_empty_sub')}</p></div>`}`;
  wireViewToggle(el, 'notifications', renderNotifications);
  const find = id => items.find(i => i.id === id);
  const after = () => { const prev = ntSnapshot(el); renderNotifications(); ntAnimateAfterPay(el, prev); };
  el.querySelectorAll('[data-nt-act]').forEach(btn => btn.addEventListener('click', () => {
    const it = find(btn.dataset.ntAct);
    // Paid from here, the row leaves the way a paid row leaves Coming up.
    if (it && it.act) it.act.run(after);
  }));
  el.querySelectorAll('[data-nt-help]').forEach(btn => btn.addEventListener('click', () => {
    const it = find(btn.dataset.ntHelp);
    if (it) ntOpenHelp(it, after);
  }));
  el.querySelectorAll('[data-nt-ignore]').forEach(btn => btn.addEventListener('click', () => {
    const it = find(btn.dataset.ntIgnore);
    if (!it) return;
    const prev = ntSnapshot(el);
    state.settings.ntIgnore = { ...(state.settings.ntIgnore || {}), [ntKey(it)]: true };
    saveState(); renderNotifications(); ntAnimateAfterPay(el, prev, { tick: false });
    showToast(t('nt_ignored_toast'));
  }));
  el.querySelector('[data-nt-unignore]')?.addEventListener('click', () => {
    state.settings.ntIgnore = {}; saveState(); renderNotifications();
  });
  el.querySelectorAll('[data-nt-go]').forEach(btn => btn.addEventListener('click', () => {
    const it = find(btn.dataset.ntGo);
    if (it) ntGo(it);
  }));
}
// What a notification means and how to deal with it, in a pop-up of its
// own; its action sits at the foot and does exactly what the row's does.
function openNtHelp(it, onAct) {
  const steps = String(t('nth_' + it.kind + '_f')).split(' | ').filter(Boolean);
  document.getElementById('modalTitle').textContent = it.title;
  document.getElementById('modalBody').innerHTML = `<div class="rfh rfh--${it.level === 'late' ? 'high' : 'med'}">
    ${it.detail ? `<p class="rfh-detail">${esc(it.detail)}</p>` : ''}
    <h4 class="rfh-h">${t('nth_what')}</h4>
    <p class="rfh-p">${esc(t('nth_' + it.kind + '_w'))}</p>
    <h4 class="rfh-h">${t('nth_fix')}</h4>
    <ol class="rfh-steps">${steps.map(st => `<li>${esc(st)}</li>`).join('')}</ol>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" type="button" id="nthAct">${esc(it.act.label)}</button>
      <button class="btn btn-ghost btn-sm" type="button" id="nthClose">${t('nth_close')}</button>
    </div></div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  document.getElementById('nthClose')?.addEventListener('click', closeModal);
  document.getElementById('nthAct')?.addEventListener('click', () => { closeModal(); onAct(); });
}


// ── Motion that answers an action ────────────────────────────────────────
// Re-adding a class restarts its animation even if it just ran.
function ddPulse(node, cls, ms) {
  if (!node) return;
  node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), ms || 1500);
}
function ddReduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
// Dashboard motion is always on; only a reduced-motion preference stops it.
function ddDashOff() { return ddReduced(); }
// A figure counts from where it was to where it is now.
function ddCount(node, from, to, render, ms) {
  if (!node) return;
  const t0 = performance.now(), dur = ms || 850, ease = x => 1 - Math.pow(1 - x, 3);
  const step = now => { const k = Math.min(1, (now - t0) / dur); node.innerHTML = render(from + (to - from) * ease(k)); if (typeof fitIfFigure === 'function') fitIfFigure(node); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const DD_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function paintNavBadges() {
  let counts = {};
  try { counts = navBadgeCounts(); } catch (e) { return; }
  document.querySelectorAll('.btab[data-btab]').forEach(btn => {
    if (!btn.querySelector('.nav-badge')) {
      const b = document.createElement('b');
      b.className = 'nav-badge'; b.dataset.badgeFor = btn.dataset.btab; b.hidden = true;
      btn.appendChild(b);
    }
  });
  document.querySelectorAll('.nav-badge[data-badge-for]').forEach(el => {
    const c = counts[el.dataset.badgeFor];
    const k = c && c.n > 0 ? c.n : 0;
    el.hidden = !k;
    const was = el.textContent;
    el.textContent = k > 99 ? '99+' : String(k || '');
    if (k && was && was !== el.textContent && !ddReduced()) ddPulse(el, 'dd-badge', 700);
    el.classList.toggle('is-wide', k > 9);
    el.classList.toggle('is-late', !!(c && c.late && k));
    const label = k ? tf('badge_' + el.dataset.badgeFor, k) : '';
    if (label) { el.title = label; el.setAttribute('aria-label', label); }
  });
}
let _navBadgeQ = 0;
function queueNavBadges() {
  if (_navBadgeQ) return;
  _navBadgeQ = requestAnimationFrame(() => { _navBadgeQ = 0; paintNavBadges(); });
}
// Who this is, read from what sign-in already stored. Nothing here signs
// anyone in or out; the card opens Settings, where that lives.
function paintRailAccount(rail) {
  const box = rail && rail.querySelector('#navRailAccount');
  if (!box) return;
  let email = '', mode = '';
  try { email = typeof syncGetEmail === 'function' ? syncGetEmail('ubp') : ''; } catch (e) {}
  try { mode = typeof syncGetMode === 'function' ? syncGetMode('ubp') : ''; } catch (e) {}
  const google = mode === 'google' && !!email;
  const own = (state?.settings?.ownNames || [])[0];
  const name = google ? (own || email.split('@')[0]) : (own || t('rail_guest'));
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  box.innerHTML = `<span class="nra-avatar" aria-hidden="true">${esc(initial)}</span>
    <span class="nra-text"><span class="nra-name">${esc(name)}</span><span class="nra-sub">${esc(google ? email : t('rail_local'))}</span></span>
    <span class="nra-go" aria-hidden="true">${appIconSvg('settings') || ''}</span>`;
  box.title = t('rail_account_open');
}

function buildNavRail() {
  const rail = navRailEl();
  const tabs = document.getElementById('ubpTabs');
  if (!rail || !tabs) return;
  rail.querySelector('#navRailSections').innerHTML =
    [...tabs.querySelectorAll('.btab[data-btab]:not([hidden])')].map(b => {
      // The tab carries its icon and its label as separate elements, so the
      // rail can take each of them rather than guessing where one ends. The
      // emoji-prefix split stays as the fallback for anything without them.
      // The icon is drawn from the shared set by the tab's own name rather
      // than copied out of the tab, which held text when it was an emoji and
      // holds markup now.
      const txt = b.querySelector('.btab-txt');
      const full = b.textContent.trim();
      const icon = appIconSvg(b.querySelector('.btab-ico')?.dataset.ico || b.dataset.btab);
      const label = txt ? txt.textContent.trim() : full;
      const on = b.classList.contains('is-active');
      return `<button class="nav-rail-item${on ? ' is-active' : ''}"${on ? ' aria-current="true"' : ''} data-btab="${esc(b.dataset.btab)}" type="button" title="${esc(label)}">
      <span class="nav-rail-icon" aria-hidden="true">${icon}</span><span class="nav-rail-label">${esc(label)}</span><b class="nav-badge" data-badge-for="${esc(b.dataset.btab)}" hidden></b>
    </button>`;
    }).join('');
  if (typeof TOOLS !== 'undefined' && TOOLS.some(x => !toolOn(x.id))) rail.querySelector('#navRailSections').insertAdjacentHTML('beforeend',
    `<button class="nav-rail-item nav-rail-item--tools" data-rail-act="toolsNavBtn" type="button" title="${esc(t('tools_more'))}"><span class="nav-rail-icon" aria-hidden="true">${appIconSvg('tools')}</span><span class="nav-rail-label">${esc(t('tools_more'))}</span></button>`);
  // Notifications carries the total; Settings sits under it. Both are
  // items like the sections, so the same click and the same highlight.
  const cur = typeof currentTab !== 'undefined' ? currentTab : '';
  // Notifications, the budget assistant where this planner has one, then
  // Settings; Guide and Home at the foot. The tool buttons they stand for
  // stay where they were, hidden, and these press them.
  const item = ([tab, ico, label, badge, act]) => `<button class="nav-rail-item${!act && cur === tab ? ' is-active' : ''}"${!act && cur === tab ? ' aria-current="true"' : ''} ${act ? `data-rail-act="${act}"` : `data-btab="${tab}"`} type="button" title="${esc(label)}">
      <span class="nav-rail-icon" aria-hidden="true">${appIconSvg(ico)}</span><span class="nav-rail-label">${esc(label)}</span>${badge ? `<b class="nav-badge" data-badge-for="${badge}" hidden></b>` : ''}
    </button>`;
  rail.querySelector('#navRailExtra').innerHTML = [['notifications', 'bell', t('nt_title'), '__total'],
    document.getElementById('pennyNavBtn') ? ['assistant', 'assistant', t('rail_assistant'), '', 'pennyNavBtn'] : null,
    (typeof toolOn !== 'function' || toolOn('afford')) ? ['afford', 'afford', t('af_title'), '', 'affordNavBtn'] : null,
    ['guide', 'guide', t('rail_guide'), '', 'guideNavBtn'],
    ['settings', 'settings', t('tab_settings'), '']].filter(Boolean).map(item).join('');
  // Guide sits with the tools now and Home is not in the sidebar, so the
  // foot is left empty: it still holds the account card at the bottom.
  const foot = rail.querySelector('#navRailFoot');
  foot.innerHTML = ''; foot.classList.add('is-empty');
  rail.querySelectorAll('[data-i18n-rail]').forEach(h => { h.textContent = t(h.dataset.i18nRail); });
  paintRailAccount(rail);
  railAdopt(rail);
  queueNavBadges();
  renderNavWidgets();
}

// Called on load, on a change of setting, and when the window crosses the
// phone breakpoint. Everything about the top layout is left alone.
// ── Swipe between sections ────────────────────────────────────────────
// Phones and tablets only: a horizontal drag across the content moves to
// the next or previous section, in the order the tab bar shows them. It is
// the tab bar that is read and switchTab that runs, so a swipe lands
// exactly where tapping the tab would, and the rail stays in step because
// that function already keeps both navigations together.
//
// Only the sections are in the cycle. The tools (home, guidebook, Ezzo,
// settings) are not places in the same sense, so they are never swiped to.
const SWIPE_MAX_W = 1024;   // above this there is a pointer and the tabs are easy to hit
const SWIPE_MIN_X = 60;     // far enough to mean it
const SWIPE_MAX_T = 700;    // and quick enough to be a swipe rather than a slow drag
const SWIPE_RATIO = 1.5;    // clearly sideways, so a scroll that drifts is not taken as one

// A pane that can scroll sideways owns the gesture, but only while it still
// has somewhere to go in the direction being swiped: a table already hard
// against its right edge has nothing left to give, so a further swipe left
// belongs to the section behind it. Checked at the end of the gesture, which
// is the first moment the direction is known.
function swipeOwnsGesture(el, dir) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      const room = dir > 0
        ? n.scrollLeft < n.scrollWidth - n.clientWidth - 2   // more to reveal on the right
        : n.scrollLeft > 2;                                  // more to reveal on the left
      if (room) return true;
    }
  }
  return false;
}

// Only what genuinely owns a sideways drag is kept back: a slider, the tab
// strip, a widget being reordered, anything on top in a dialog. Buttons and
// plain fields are deliberately not on this list. These screens are mostly
// form, and excluding them left the gesture working only in the gaps, which
// is the same as it not working. A drag of this length never becomes a tap,
// so nothing is triggered on the way past.
const SWIPE_KEEP = 'input[type="range"], [contenteditable], .budget-tabs, .nav-rail, .nw-mg-row, .nw-note, [draggable="true"], dialog, .modal-card, .onb-card, .tutorial-card';

// A field being typed in keeps its drag, so moving the caret still works.
function swipeInLiveField(el) {
  const a = document.activeElement;
  if (!a || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) return false;
  return a === el || a.contains(el);
}

let _swX = 0, _swY = 0, _swT = 0, _swLive = false, _swTarget = null;

function swipeSections() {
  return [...document.querySelectorAll('#ubpTabs .btab[data-btab]:not([hidden])')];
}

function swipeStep(dir) {
  const tabs = swipeSections();
  if (tabs.length < 2) return;
  const at = tabs.findIndex(b => b.classList.contains('is-active'));
  if (at < 0) return;
  const to = at + dir;
  // The ends are the ends: wrapping from the last section back to the first
  // would make a swipe jump the whole width of the bar.
  if (to < 0 || to >= tabs.length) return;
  switchTab(tabs[to].dataset.btab);
}

function initSwipeNav() {
  const scope = document.querySelector('.tool-shell') || document.body;
  if (!scope || scope.dataset.swipeWired) return;
  scope.dataset.swipeWired = '1';

  // Both listeners are passive: the gesture is only ever read, never taken
  // off the browser, so vertical scrolling stays exactly as smooth as it was.
  scope.addEventListener('touchstart', e => {
    _swLive = false;
    if (e.touches.length !== 1) return;              // a pinch is not a swipe
    if (window.innerWidth > SWIPE_MAX_W) return;
    if (e.target.closest(SWIPE_KEEP)) return;
    if (swipeInLiveField(e.target)) return;
    _swTarget = e.target;
    _swX = e.touches[0].clientX;
    _swY = e.touches[0].clientY;
    _swT = Date.now();
    _swLive = true;
  }, { passive: true });

  scope.addEventListener('touchend', e => {
    if (!_swLive) return;
    _swLive = false;
    if (e.changedTouches.length !== 1) return;
    if (Date.now() - _swT > SWIPE_MAX_T) return;
    const dx = e.changedTouches[0].clientX - _swX;
    const dy = e.changedTouches[0].clientY - _swY;
    if (Math.abs(dx) < SWIPE_MIN_X) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
    // Dragging the content left brings the next section in from the right,
    // the way a page of anything else moves under a finger.
    const dir = dx < 0 ? 1 : -1;
    if (swipeOwnsGesture(_swTarget, dir)) return;
    swipeStep(dir);
  }, { passive: true });

  scope.addEventListener('touchcancel', () => { _swLive = false; }, { passive: true });
}

const SHELL_SEL = '.app.tool-shell';

// ── The phone dock ───────────────────────────────────────────────────
// On a phone the tools leave the top bar and gather in a bar along the
// bottom, where a thumb reaches them, with quick-add raised in the middle.
// The sections keep the top to themselves and run the full width.
//
// The four buttons are the same nodes the rail borrows, moved rather than
// copied, so every listener they were given at startup still applies and
// railRelease still knows where each one came from.
function navDockActive() { return NAV_RAIL_MQ.matches; }

function buildNavDock() {
  const shell = document.querySelector(SHELL_SEL);
  if (!shell) return;
  railRemember();
  let dock = document.getElementById('navDock');
  if (!dock) {
    dock = document.createElement('nav');
    dock.className = 'nav-dock';
    dock.id = 'navDock';
    dock.setAttribute('aria-label', t('nav_dock_aria'));
    dock.innerHTML = `<div class="nav-dock-bar">
      <div class="nav-dock-side" id="navDockLeft"></div>
      <div class="nav-dock-gap" aria-hidden="true"></div>
      <div class="nav-dock-side" id="navDockRight"></div>
    </div>
    <button class="nav-dock-add" id="navDockAdd" type="button"
      title="${esc(t('tx_add_title'))}" aria-label="${esc(t('tx_add_title'))}"><svg class="nav-dock-plus" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg></button>`;
    shell.appendChild(dock);
    dock.querySelector('#navDockAdd').addEventListener('click', openQuickAddTx);
  }
  const left = dock.querySelector('#navDockLeft');
  const right = dock.querySelector('#navDockRight');
  // Home and the guide to the left of quick-add, Ezzo and settings to its
  // right. Anything an app does not have is simply absent.
  const place = (ids, into) => ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentNode !== into) into.appendChild(el);
  });
  place(['backToHub', 'guideNavBtn'], left);
  place(['settingsNavBtn'], right);
  // The menu holds everything else, in the sidebar's order. The assistant
  // and notification buttons wait out of sight in the dock so that their
  // own listeners still run when the menu presses them, and notifications
  // is remembered too so it goes home when the dock is taken away.
  if (_railHome && !_railHome.notifNavBtn) {
    const n = document.getElementById('notifNavBtn');
    if (n) _railHome.notifNavBtn = { parent: n.parentNode, next: n.nextSibling };
  }
  let stash = dock.querySelector('#navDockStash');
  if (!stash) { stash = document.createElement('div'); stash.id = 'navDockStash'; stash.hidden = true; dock.appendChild(stash); }
  place(['pennyNavBtn', 'notifNavBtn'], stash);
  let menuBtn = dock.querySelector('#navDockMenu');
  if (!menuBtn) {
    menuBtn = document.createElement('button');
    menuBtn.type = 'button'; menuBtn.id = 'navDockMenu'; menuBtn.className = 'btn-icon nav-dock-menu';
    menuBtn.setAttribute('aria-haspopup', 'menu'); menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><b class="nav-badge" data-badge-for="__total" hidden></b>`;
    menuBtn.addEventListener('click', () => navMenuOpen() ? navMenuClose() : navMenuShow());
  }
  menuBtn.title = t('nav_menu'); menuBtn.setAttribute('aria-label', t('nav_menu'));
  right.appendChild(menuBtn);
  queueNavBadges();
}

// ── The phone menu ───────────────────────────────────────────────────
// Every place the sidebar offers, in the sidebar's order: the sections as
// the tab bar lists them, then notifications, the assistant and settings,
// then the guide and home. A sheet above the dock; picking anything, a tap
// outside it or Escape puts it away.
function navMenuOpen() { return !!document.getElementById('navMenu'); }
function navMenuGroups() {
  const tabs = document.getElementById('ubpTabs');
  const sections = tabs ? [...tabs.querySelectorAll('.btab[data-btab]:not([hidden])')].map(b => ({
    tab: b.dataset.btab, ico: b.querySelector('.btab-ico')?.dataset.ico || b.dataset.btab,
    label: (b.querySelector('.btab-txt') || b).textContent.trim(), badge: b.dataset.btab })) : [];
  if (typeof TOOLS !== 'undefined' && TOOLS.some(x => !toolOn(x.id))) sections.push({ act: 'toolsNavBtn', ico: 'tools', label: t('tools_more') });
  const extra = [{ tab: 'notifications', ico: 'bell', label: t('nt_title'), badge: '__total' },
    document.getElementById('pennyNavBtn') ? { act: 'pennyNavBtn', ico: 'assistant', label: t('rail_assistant') } : null,
    (typeof toolOn !== 'function' || toolOn('afford')) ? { act: 'affordNavBtn', ico: 'afford', label: t('af_title') } : null,
    { act: 'guideNavBtn', ico: 'guide', label: t('rail_guide') },
    { tab: 'settings', ico: 'settings', label: t('tab_settings') }].filter(Boolean);
  const foot = [{ act: 'backToHub', ico: 'home', label: t('rail_home') }];
  return [sections, extra, foot];
}
function navMenuShow() {
  navMenuClose();
  const shell = document.querySelector(SHELL_SEL);
  if (!shell) return;
  const cur = typeof currentTab !== 'undefined' ? currentTab : '';
  const item = x => `<button class="nav-menu-item${x.tab && x.tab === cur ? ' is-active' : ''}" type="button" role="menuitem" ${x.act ? `data-menu-act="${x.act}"` : `data-btab="${esc(x.tab)}"`}${x.tab && x.tab === cur ? ' aria-current="true"' : ''}>
      <span class="nav-menu-ico" aria-hidden="true">${appIconSvg(x.ico)}</span><span class="nav-menu-label">${esc(x.label)}</span>${x.badge ? `<b class="nav-badge" data-badge-for="${x.badge}" hidden></b>` : ''}
    </button>`;
  const scrim = document.createElement('div');
  scrim.className = 'nav-menu-scrim'; scrim.id = 'navMenuScrim';
  const menu = document.createElement('div');
  menu.className = 'nav-menu'; menu.id = 'navMenu';
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('nav_menu'));
  menu.innerHTML = navMenuGroups().filter(g => g.length).map(g => `<div class="nav-menu-group">${g.map(item).join('')}</div>`).join('');
  shell.appendChild(scrim); shell.appendChild(menu);
  scrim.addEventListener('click', navMenuClose);
  menu.addEventListener('click', e => {
    const b = e.target.closest('.nav-menu-item');
    if (!b) return;
    navMenuClose();
    if (b.dataset.menuAct) document.getElementById(b.dataset.menuAct)?.click();
    else if (b.dataset.btab) switchTab(b.dataset.btab);
  });
  document.addEventListener('keydown', navMenuKey);
  document.getElementById('navDockMenu')?.setAttribute('aria-expanded', 'true');
  document.getElementById('navDockMenu')?.classList.add('is-on');
  queueNavBadges();
  requestAnimationFrame(() => { menu.classList.add('is-in'); scrim.classList.add('is-in'); menu.querySelector('.nav-menu-item')?.focus({ preventScroll: true }); });
}
function navMenuKey(e) { if (e.key === 'Escape') { navMenuClose(); document.getElementById('navDockMenu')?.focus(); } }
function navMenuClose() {
  document.getElementById('navMenu')?.remove();
  document.getElementById('navMenuScrim')?.remove();
  document.removeEventListener('keydown', navMenuKey);
  const b = document.getElementById('navDockMenu');
  if (b) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-on'); }
}

// Hands the buttons back before the dock is taken away, or they would go
// with it.
function navDockRemove() {
  const dock = document.getElementById('navDock');
  if (!dock) return;
  navMenuClose();
  railRelease();
  dock.remove();
}

function applyNavPosition() {
  applyWidthPref();
  // A phone always runs on the top bar and the dock, whatever is chosen, so
  // it takes the top bar's styling too rather than a sidebar's fallback.
  document.documentElement.dataset.nav = NAV_RAIL_MQ.matches ? 'top' : getNavPosition();
  // Three possible homes for the tools, and exactly one of them owns the
  // buttons at a time: the side rail on a wide screen, the bottom dock on
  // a phone, the top bar otherwise.
  if (navRailDocks()) { navDockRemove(); buildNavRail(); }
  else if (navDockActive()) buildNavDock();
  else { navDockRemove(); railRelease(); }
  // Whether the tab bar can share the topbar's line depends on where the
  // nav sits, so the two are decided together and in this order.
  try { applyDashChrome(); } catch (e) {}
}
if (NAV_RAIL_MQ.addEventListener) NAV_RAIL_MQ.addEventListener('change', applyNavPosition);
else if (NAV_RAIL_MQ.addListener) NAV_RAIL_MQ.addListener(applyNavPosition);

function navPositionCardHtml() {
  const cur = getNavPosition();
  const opts = NAV_POSITIONS.map(p => `
    <button class="layout-opt${cur === p ? ' is-active' : ''}" data-nav-val="${p}" type="button" title="${t('nav_pos_' + p)}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${NAV_POS_ICONS[p]}</svg>
      ${t('nav_pos_' + p)}
    </button>`).join('');
  return `<div class="panel"><div class="panel-inner">
    <div class="settings-card-title">🧭 ${t('nav_position')}</div>
    <p class="settings-desc">${t('nav_position_desc')}</p>
    <div class="layout-setting-row">
      <div class="layout-pill theme-pill" role="group" aria-label="${t('nav_position')}">${opts}</div>
    </div>
  </div></div>`;
}

function wireNavPositionPicker(el) {
  el.querySelectorAll('[data-nav-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = NAV_POSITIONS.includes(btn.dataset.navVal) ? btn.dataset.navVal : 'top';
      state.settings.navPosition = p;
      saveState();
      trackEvent('nav_position_changed', { position: p });
      el.querySelectorAll('[data-nav-val]').forEach(b => b.classList.toggle('is-active', b === btn));
      applyNavPosition();
    });
  });
}

// ══ Sidebar widgets ═══════════════════════════════════════════════════
// Up to three, chosen and ordered by the user. Each one reads the same
// helpers the dashboard reads, so a widget can never disagree with the
// panel it is sitting next to.
const NAV_WIDGET_MAX = 5;
// Ordered as they read in the picker: the two you act on, then the ones
// that tell you something, then the one that just holds a thought.
const NAV_WIDGETS = ['quick_spend', 'today', 'next_due', 'calendar', 'free_to_spend',
                     'forecast', 'vs_last', 'top_spend', 'period', 'notes'];
const NAV_WIDGET_ICON = {
  quick_spend: '⚡', today: '☀️', next_due: '📌',
  calendar: '📅', free_to_spend: '💸', forecast: '🔮',
  vs_last: '⚖️', top_spend: '📊', period: '📆',
  notes: '🗒️'
};
// Each app names these differently: UBP's due items are bill/debt/
// subscription, SBP's are the module keys bills/debt. The pay function
// each one hands this to expects its own spelling.
const NAV_WIDGET_PAYABLE = new Set(['bill', 'debt']);

function navWidgetList() {
  const v = state?.settings?.navWidgets;
  if (!Array.isArray(v)) return [];
  // Unknown ids (an older build, a hand-edited file) are dropped rather
  // than rendered as a blank card.
  return v.filter((id, i) => NAV_WIDGETS.indexOf(id) !== -1 && v.indexOf(id) === i)
          .slice(0, NAV_WIDGET_MAX);
}

function navWidgetSave(list) {
  state.settings.navWidgets = list.slice(0, NAV_WIDGET_MAX);
  saveState();
  renderNavWidgets();
}

// ── Shared date and spend helpers for the widgets ────────────────────
// Deliberately local rather than leaning on each app's own period maths,
// because only one of the two has computePrevSummary - and a widget that
// quietly means something different in Simple than in Ultimate is worse
// than no widget. NL_SPEND_TYPES is each app's own definition of "spending",
// so the totals here always agree with the hero's.
function navIso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}
function navToday() { return navIso(new Date()); }

function navDateAdd(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  d.setDate(d.getDate() + days);
  return navIso(d);
}

// The current budget period, or the one of equal length directly before it.
function navPeriodBounds(previous) {
  const ps = state?.settings?.periodStart, pe = state?.settings?.periodEnd;
  if (!ps || !pe) return null;
  const s = new Date(ps + 'T00:00:00'), e = new Date(pe + 'T00:00:00');
  if (isNaN(s) || isNaN(e) || e < s) return null;
  if (!previous) return { start: ps, end: pe };
  const span = Math.round((e - s) / 86400000);
  const end = navDateAdd(ps, -1);
  return { start: navDateAdd(end, -span), end: end };
}

function navSpendBetween(start, end) {
  if (!start || !end) return 0;
  return (state.transactions || []).reduce((sum, tx) =>
    (tx.date >= start && tx.date <= end && NL_SPEND_TYPES.indexOf(tx.type) !== -1)
      ? sum + (Number(tx.amount) || 0) : sum, 0);
}

function navLang() { return 'en'; }

// Monday-first initials, taken from the browser rather than from twenty more
// translation keys that would then have to be kept in step.
function navWeekdayInitials() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i));   // 1 Jan 2024 was a Monday
    let s = '';
    try { s = d.toLocaleDateString(navLang(), { weekday: 'narrow', timeZone: 'UTC' }); }
    catch (e) { s = 'MTWTFSS'[i]; }
    out.push(s);
  }
  return out;
}

function navWidgetBody(id) {
  switch (id) {
    // A glanceable month: today ringed, a warm dot on a day something is
    // still owed, a faint one on a day money actually moved.
    case 'calendar': {
      const now = new Date(), y = now.getFullYear(), m = now.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      const lead = (new Date(y, m, 1).getDay() + 6) % 7;      // Monday first
      const cell = d => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const due = new Set(nlCommitted().items.map(i => i.date));
      const moved = new Set((state.transactions || [])
        .filter(tx => NL_SPEND_TYPES.indexOf(tx.type) !== -1).map(tx => tx.date));
      const todayKey = navToday();
      let title = '';
      try { title = now.toLocaleDateString(navLang(), { month: 'long', year: 'numeric' }); }
      catch (e) { title = String(y); }

      let grid = '';
      for (let i = 0; i < lead; i++) grid += '<span class="nw-cal-pad"></span>';
      for (let d = 1; d <= days; d++) {
        const k = cell(d), cls = ['nw-cal-day'];
        if (k === todayKey) cls.push('is-today');
        if (due.has(k)) cls.push('has-due');
        else if (moved.has(k)) cls.push('has-spend');
        grid += `<span class="${cls.join(' ')}">${d}</span>`;
      }
      return `<div class="nw-cal-month">${esc(title)}</div>
        <div class="nw-cal-dow">${navWeekdayInitials().map(w => `<span>${esc(w)}</span>`).join('')}</div>
        <div class="nw-cal-grid">${grid}</div>
        <div class="nw-cal-key"><i class="k-due"></i>${t('nw_cal_due')}<i class="k-spend"></i>${t('nw_cal_spent')}</div>`;
    }

    // The period figure divided by the days left is a rate; this is the one
    // that answers "can I buy this now". Today's spending is already inside
    // the leftover, so the allowance is what remains of today's share.
    case 'today': {
      const free = computeSummary(computeActuals()).leftover - nlCommitted().total;
      const p = nlDaysInPeriod();
      const allow = p.left > 0 ? free / p.left : free;
      const spent = nlSpentToday();
      const left = allow - spent;
      const pct = allow > 0 ? Math.min(100, Math.round(spent / allow * 100)) : (spent > 0 ? 100 : 0);
      return `<div class="nw-big" style="color:${left < 0 ? 'var(--expense)' : 'var(--income)'}">${left < 0 ? '−' : ''}${fmt(Math.abs(left))}</div>
        <div class="nw-sub">${tf('nw_today_sub', fmt(spent), fmt(Math.max(0, allow)))}</div>
        <div class="nw-bar${left < 0 ? ' is-over' : ''}"><span style="width:${pct}%"></span></div>`;
    }

    // Where this period ends up if the rest of it looks like the part
    // already spent. The number nobody else puts in front of you until the
    // month is over and it is too late to act on it.
    case 'forecast': {
      const p = nlDaysInPeriod();
      const cur = navPeriodBounds(false);
      if (!cur) return `<div class="nw-empty">${t('nw_no_spend')}</div>`;
      const today = navToday();
      const spent = navSpendBetween(cur.start, today < cur.end ? today : cur.end);
      if (spent <= 0) return `<div class="nw-empty">${t('nw_no_spend')}</div>`;
      const perDay = spent / Math.max(1, p.dayOf);
      const projected = perDay * p.total;
      const pct = projected > 0 ? Math.min(100, Math.round(spent / projected * 100)) : 0;
      return `<div class="nw-big">${fmt(projected)}</div>
        <div class="nw-sub">${tf('nw_forecast_sub', fmt(perDay), p.dayOf, p.total)}</div>
        <div class="nw-bar"><span style="width:${pct}%"></span></div>`;
    }

    // Compared at the same distance into each period, so a period that is
    // only half over is never measured against a whole one.
    case 'vs_last': {
      const p = nlDaysInPeriod();
      const cur = navPeriodBounds(false), prev = navPeriodBounds(true);
      if (!cur || !prev) return `<div class="nw-empty">${t('nw_vs_last_none')}</div>`;
      const now = navSpendBetween(cur.start, navDateAdd(cur.start, p.dayOf - 1));
      const then = navSpendBetween(prev.start, navDateAdd(prev.start, p.dayOf - 1));
      if (then <= 0) return `<div class="nw-empty">${t('nw_vs_last_none')}</div>`;
      const diff = now - then;
      const pct = Math.round(diff / then * 100);
      const worse = diff > 0;
      return `<div class="nw-big" style="color:${worse ? 'var(--expense)' : 'var(--income)'}">${worse ? '+' : '−'}${Math.abs(pct)}%</div>
        <div class="nw-sub">${tf('nw_vs_last_sub', fmt(now), fmt(then), p.dayOf)}</div>`;
    }

    // The one box in the planner with no amount, no category and no date.
    // It never touches a figure; it is just somewhere to put the thing you
    // would otherwise forget before you get to the Transactions tab.
    case 'notes': {
      const v = typeof state?.settings?.navNote === 'string' ? state.settings.navNote : '';
      return `<textarea class="input nw-note" id="wnNote" rows="4" maxlength="600"
          placeholder="${t('nw_notes_ph')}" aria-label="${t('nw_notes')}">${esc(v)}</textarea>
        <div class="nw-sub nw-note-saved" id="wnNoteSaved" hidden>${t('nw_notes_saved')}</div>`;
    }

    case 'free_to_spend': {
      const free = computeSummary(computeActuals()).leftover - nlCommitted().total;
      const p = nlDaysInPeriod();
      const rate = (p.left > 0 && free > 0) ? tf('nl_free_rate', fmt(free / p.left), p.left) : '';
      return `<div class="nw-big" style="color:${free < 0 ? 'var(--expense)' : 'var(--income)'}">${free < 0 ? '−' : ''}${fmt(Math.abs(free))}</div>
        ${rate ? `<div class="nw-sub">${rate}</div>` : ''}`;
    }
    case 'next_due': {
      const next = nlCommitted().items
        .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
      if (!next) return `<div class="nw-empty">${t('nl_nothing_due')}</div>`;
      const payable = next.id && NAV_WIDGET_PAYABLE.has(next.type);
      return `<div class="nw-row"><span class="nw-name">${esc(next.label)}</span>
          <strong class="nw-amt">${fmt(next.amount)}</strong></div>
        <div class="nw-sub">${esc(formatDateShort(next.date))}</div>
        ${payable ? `<button class="nw-act" type="button" data-nw-pay="${esc(next.id)}"
          data-nw-paytype="${esc(next.type)}" data-nw-paydate="${esc(next.occDate || next.date)}">${t('pay_btn')}</button>` : ''}`;
    }
    case 'period': {
      const p = nlDaysInPeriod();
      return `<div class="nw-big">${p.left}</div>
        <div class="nw-sub">${tf('nw_days_left', p.total)}</div>
        <div class="nw-bar"><span style="width:${p.pct}%"></span></div>`;
    }
    case 'top_spend': {
      const rows = Object.entries(computeActuals().expenses || {})
        .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (!rows.length) return `<div class="nw-empty">${t('nw_no_spend')}</div>`;
      const max = rows[0][1];
      return rows.map(([cat, v]) => `<div class="nw-line">
          <div class="nw-row"><span class="nw-name">${esc(cat)}</span>
            <strong class="nw-amt">${fmt(v)}</strong></div>
          <div class="nw-bar"><span style="width:${Math.round(v / max * 100)}%"></span></div>
        </div>`).join('');
    }
    case 'quick_spend': {
      const cats = getCats('expense');
      // Hidden fields rather than a date picker and a type menu: this
      // widget is deliberately "an expense, today", and addTransaction
      // reads both by id, so all of its validation and trial gating apply
      // exactly as they do in the full Add Transaction modal.
      return `<input type="hidden" id="wqsDate" value="${today()}">
        <input type="hidden" id="wqsType" value="expense">
        <select class="select nw-input" id="wqsCategory" aria-label="${t('tx_category')}">${
          cats.length ? cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
                      : `<option value="">${t('nw_no_cats')}</option>`}</select>
        ${state.allocation?.enabled ? `<select class="select nw-input" id="wqsAlloc" aria-label="${t('alloc_label')}"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets || []).map(b => `<option value="${b.id}">${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select>` : ''}
        <input class="input nw-input" type="number" id="wqsAmount" min="0" step="0.01"
               placeholder="${esc(SYM)}0.00" aria-label="${t('tx_amount')}">
        <div class="nw-err" id="wqsError" hidden></div>
        <button class="nw-act nw-act--go" type="button" id="wqsLog">${t('nw_log')}</button>`;
    }
  }
  return '';
}

// Sidebar widgets are switched off for now. Turning this back on brings
// them straight back: the list each person chose is still saved.
const NAV_WIDGETS_ON = false;
function renderNavWidgets() {
  const host = document.getElementById('navWidgets');
  if (!host) return;
  if (!NAV_WIDGETS_ON) { host.innerHTML = ''; host.setAttribute('aria-hidden', 'true'); return; }
  host.removeAttribute('aria-hidden');
  document.querySelectorAll('.cc-tip-pop').forEach(el => el.remove());
  const list = navWidgetList();
  host.innerHTML = `
    <div class="nw-head">
      <span>${t('nw_head')}</span>
      ${list.length ? `<button class="nw-manage-btn" id="navWidgetManage" type="button"
        title="${t('nw_title')}" aria-label="${t('nw_title')}">${t('nw_edit')}</button>` : ''}
    </div>
    ${list.map(id => `<section class="nw-card" data-nw="${id}">
      <h4 class="nw-card-title">
        <span aria-hidden="true">${NAV_WIDGET_ICON[id]}</span>
        <span class="cc-label-text">${t('nw_' + id)}</span>
        <button class="cc-info" type="button" data-tip="${esc(t('nw_' + id + '_desc'))}"
                aria-label="${esc(tf('field_info_aria', t('nw_' + id)))}">i</button>
      </h4>
      ${navWidgetBody(id)}
    </section>`).join('')}
    ${list.length < NAV_WIDGET_MAX
      ? `<button class="nw-add" id="navWidgetAdd" type="button">+ ${t('nw_add_btn')}</button>`
      : ''}`;
  wireNavWidgets(host);
}

function wireNavWidgets(host) {
  initFieldTips(host);
  host.querySelector('#wqsLog')?.addEventListener('click', () => {
    addTransaction({ prefix: 'wqs', after: () => {
      showUndoToast(t('toast_tx_added'));
      if (currentTab === 'dashboard') renderDashboard();
      renderNavWidgets();
    } });
  });
  host.querySelectorAll('[data-nw-pay]').forEach(b => b.addEventListener('click', () =>
    promptPay(b.dataset.nwPaytype, b.dataset.nwPay, () => {
      if (currentTab === 'dashboard') renderDashboard();
      renderNavWidgets();
    }, b.dataset.nwPaydate)));
  const note = host.querySelector('#wnNote');
  if (note) {
    // Saved as you type, but not on every keystroke. The queued redraw
    // skips a widget that has focus, so the box is never pulled out from
    // under the cursor mid-sentence.
    let noteTimer = null;
    note.addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        state.settings.navNote = note.value;
        saveState();
        const flag = document.getElementById('wnNoteSaved');
        if (flag) {
          flag.hidden = false;
          setTimeout(() => { if (flag) flag.hidden = true; }, 1400);
        }
      }, 500);
    });
    note.addEventListener('blur', () => {
      clearTimeout(noteTimer);
      if (state.settings.navNote !== note.value) { state.settings.navNote = note.value; saveState(); }
    });
  }
  host.querySelector('#navWidgetAdd')?.addEventListener('click', openNavWidgetPicker);
  host.querySelector('#navWidgetManage')?.addEventListener('click', openNavWidgetPicker);
}

// Redrawn after any save, so a figure in the rail can never be staler than
// the page beside it. Skipped while a widget has focus, or typing an amount
// would wipe the field out from under the user.
let _navWidgetQueued = false;
function navWidgetsQueueRefresh() {
  const host = document.getElementById('navWidgets');
  if (!host || _navWidgetQueued) return;
  _navWidgetQueued = true;
  requestAnimationFrame(() => {
    _navWidgetQueued = false;
    const h = document.getElementById('navWidgets');
    if (h && !h.contains(document.activeElement)) renderNavWidgets();
  });
}

// One place to add, remove and reorder. Every change applies to the rail
// behind the modal straight away, so the effect is visible while choosing
// rather than only after closing.
function openNavWidgetPicker() {
  const body = () => document.getElementById('modalBody');
  // Dragging is the quick way; the arrows are the one that works on a
  // touch screen and with a keyboard, so both stay.
  let dragFrom = null;

  const draw = () => {
    const cur = navWidgetList();
    const spare = NAV_WIDGETS.filter(id => cur.indexOf(id) === -1);
    body().innerHTML = `
      <p class="settings-desc">${tf('nw_pick_desc', NAV_WIDGET_MAX)}</p>
      <div class="nw-mg">
        ${cur.length ? cur.map((id, i) => `
          <div class="nw-mg-row" draggable="true" data-nw-idx="${i}">
            <span class="nw-mg-grip" aria-hidden="true">&#8942;&#8942;</span>
            <span class="nw-mg-icon" aria-hidden="true">${NAV_WIDGET_ICON[id]}</span>
            <span class="nw-mg-name">${t('nw_' + id)}</span>
            <button class="nw-mini" type="button" data-nw-move="${i}" data-nw-to="${i - 1}"
              ${i === 0 ? 'disabled' : ''} aria-label="${t('nw_move_up')}" title="${t('nw_move_up')}">&#8593;</button>
            <button class="nw-mini" type="button" data-nw-move="${i}" data-nw-to="${i + 1}"
              ${i === cur.length - 1 ? 'disabled' : ''} aria-label="${t('nw_move_down')}" title="${t('nw_move_down')}">&#8595;</button>
            <button class="nw-mini nw-mini--del" type="button" data-nw-remove="${i}"
              aria-label="${t('nw_remove')}" title="${t('nw_remove')}">&#215;</button>
          </div>`).join('') : `<p class="nw-mg-empty">${t('nw_none_yet')}</p>`}
      </div>
      ${spare.length ? `<h4 class="nw-mg-h">${t('nw_available')}</h4>
      <div class="nw-mg">
        ${spare.map(id => `
          <div class="nw-mg-row nw-mg-row--add">
            <span class="nw-mg-icon" aria-hidden="true">${NAV_WIDGET_ICON[id]}</span>
            <span class="nw-mg-text"><strong>${t('nw_' + id)}</strong><em>${t('nw_' + id + '_desc')}</em></span>
            <button class="btn btn-secondary btn-sm" type="button" data-nw-add="${id}"
              ${cur.length >= NAV_WIDGET_MAX ? 'disabled' : ''}>${t('nw_add')}</button>
          </div>`).join('')}
      </div>
      ${cur.length >= NAV_WIDGET_MAX ? `<p class="nw-mg-note">${tf('nw_full', NAV_WIDGET_MAX)}</p>` : ''}`
      : `<p class="nw-mg-note">${t('nw_all_added')}</p>`}
      <div class="edit-tx-actions">
        <button class="btn btn-primary" id="nwDone" type="button">${t('nw_done')}</button>
      </div>`;

    const rows = () => [...body().querySelectorAll('.nw-mg-row[data-nw-idx]')];
    const clearMarks = () => rows().forEach(r => r.classList.remove('is-dragging', 'is-over'));
    rows().forEach(row => {
      row.addEventListener('dragstart', e => {
        dragFrom = Number(row.dataset.nwIdx);
        row.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          // Firefox starts no drag at all without some payload set.
          try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) {}
        }
      });
      row.addEventListener('dragend', () => { dragFrom = null; clearMarks(); });
      row.addEventListener('dragover', e => {
        if (dragFrom === null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        rows().forEach(r => r.classList.toggle('is-over',
          r === row && Number(r.dataset.nwIdx) !== dragFrom));
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-over'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        const to = Number(row.dataset.nwIdx), from = dragFrom;
        dragFrom = null; clearMarks();
        if (from === null || Number.isNaN(to) || to === from) return;
        const l = navWidgetList();
        if (from < 0 || from >= l.length) return;
        l.splice(to, 0, l.splice(from, 1)[0]);
        navWidgetSave(l); draw();
      });
    });

    body().querySelectorAll('[data-nw-move]').forEach(b => b.addEventListener('click', () => {
      const l = navWidgetList(), from = +b.dataset.nwMove, to = +b.dataset.nwTo;
      if (to < 0 || to >= l.length) return;
      l.splice(to, 0, l.splice(from, 1)[0]);
      navWidgetSave(l); draw();
    }));
    body().querySelectorAll('[data-nw-remove]').forEach(b => b.addEventListener('click', () => {
      const l = navWidgetList();
      l.splice(+b.dataset.nwRemove, 1);
      navWidgetSave(l); draw();
    }));
    body().querySelectorAll('[data-nw-add]').forEach(b => b.addEventListener('click', () => {
      const l = navWidgetList();
      if (l.length >= NAV_WIDGET_MAX) return;
      l.push(b.dataset.nwAdd);
      navWidgetSave(l); draw();
    }));
    body().querySelector('#nwDone')?.addEventListener('click', closeModal);
  };

  document.getElementById('modalTitle').textContent = t('nw_title');
  draw();
  document.getElementById('tutorialOverlay').hidden = false;
}

function dashboardLayoutCardHtml() {
  const cur = getDashLayout();
  const opts = DASH_LAYOUTS.map(n => `
    <button class="layout-opt${cur === n ? ' is-active' : ''}" data-layout-val="${n}" type="button" title="${t('layout_' + n)}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${DASHBOARD_LAYOUT_ICONS[n]}</svg>
      ${t('layout_' + n)}
    </button>`).join('');
  return `<div class="panel"><div class="panel-inner">
    <div class="settings-card-title">📊 ${t('dashboard_layout')}</div>
    <p class="settings-desc">${t('dashboard_layout_desc')}</p>
    <div class="layout-setting-row">
      <div class="layout-pill theme-pill" role="group" aria-label="${t('dashboard_layout')}">${opts}</div>
    </div>
  </div></div>`;
}
function wireDashboardLayoutPicker(el) {
  el.querySelectorAll('.layout-opt[data-layout-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.layoutVal, 10) || 1;
      state.settings.dashboardLayout = n;
      saveState();
      trackEvent('dashboard_layout_changed', { layout: n });
      applyDashChrome();
      el.querySelectorAll('.layout-opt[data-layout-val]').forEach(b => b.classList.toggle('is-active', b === btn));
      renderDashboard();
    });
  });
}

let currentTab='dashboard', calYear, calMonth, calSelectedDay=null;
let txFilter={search:'',type:'',alloc:'',sort:'date_desc'};
let txPage=0;
let txSelected=new Set();
const TX_PAGE_SIZE=25;

function dispatchRender(tab) {
  maybeAdvancePeriod();
  rollBills();
  queueNavBadges();
  ({dashboard:renderDashboard,budget:renderBudget,transactions:renderTransactions,debt:renderDebt,goals:renderSinking,calendar:renderCalendar,bills:renderSubscriptions,settings:renderSettings,notifications:renderNotifications,challenges:typeof renderChallenges==='function'?renderChallenges:renderDashboard}[tab]||renderDashboard)();
}
function switchTab(tab) {
  if (tab === 'dashboard') _dashEntering = true;
  currentTab=tab;
  trackEvent('tab_viewed', { tab });
  // Both navigations are kept in step. Only one is ever on screen, but the
  // hidden one is what the other gets rebuilt from.
  ['.btab','.nav-rail-item'].forEach(sel =>
    document.querySelectorAll(sel).forEach(b=>b.classList.toggle('is-active',b.dataset.btab===tab))
  );
  document.querySelectorAll('.btab[role="tab"]').forEach(b=>b.setAttribute('aria-selected',b.dataset.btab===tab?'true':'false'));
  document.querySelectorAll('.nav-rail-item').forEach(b => b.dataset.btab === tab
    ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current'));
  document.querySelectorAll('.bview').forEach(v=>v.classList.remove('is-active'));
  document.getElementById(`bview-${tab}`)?.classList.add('is-active');
  dispatchRender(tab);
  document.querySelector('.app-scroll')?.scrollTo({top:0});   // new tab starts at the top of the content region
}

// ── SAMPLE DATA ───────────────────────────────────────────────────────
// One-click demo dataset for the empty-state welcome banner, so a new (or
// trial) user sees the dashboards working before entering anything real.
// Only reachable from the welcome banner, which itself only renders while
// the planner is empty - so this never clobbers real data.
function loadSampleData(){
  const ps=state.settings.periodStart, pe=state.settings.periodEnd;
  const day=n=>{const d=new Date(ps+'T00:00:00');d.setDate(d.getDate()+n);const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return iso>pe?pe:iso;};
  state.budgets={
    income:[{id:uid(),category:'Paycheck',expected:4200},{id:uid(),category:'Freelance',expected:800}],
    expenses:[{id:uid(),category:'Food',expected:600},{id:uid(),category:'Gas',expected:200},{id:uid(),category:'Entertainment',expected:150},{id:uid(),category:'Shopping',expected:250}],
    bills:[{id:uid(),category:'Rent',expected:1400,dueDay:1,paid:false},{id:uid(),category:'Electric',expected:120,dueDay:21,paid:false},{id:uid(),category:'Internet',expected:70,dueDay:24,paid:false},{id:uid(),category:'Phone',expected:65,dueDay:19,paid:false}],
    savings:[{id:uid(),category:'Emergency Fund',expected:400},{id:uid(),category:'Retirement',expected:250}]
  };
  state.transactions=[
    {id:uid(),date:day(0),type:'income',category:'Paycheck',amount:2100,description:'Payday',allocation:null},
    {id:uid(),date:day(14),type:'income',category:'Paycheck',amount:2100,description:'Payday',allocation:null},
    {id:uid(),date:day(9),type:'income',category:'Freelance',amount:450,description:'Side project',allocation:null},
    {id:uid(),date:day(2),type:'expense',category:'Food',amount:112.45,description:'Groceries',allocation:'need'},
    {id:uid(),date:day(5),type:'expense',category:'Food',amount:64.20,description:'Groceries',allocation:'need'},
    {id:uid(),date:day(7),type:'expense',category:'Gas',amount:48,description:'',allocation:'need'},
    {id:uid(),date:day(8),type:'expense',category:'Entertainment',amount:32.50,description:'Movies',allocation:'want'},
    {id:uid(),date:day(10),type:'expense',category:'Shopping',amount:89.99,description:'Shoes',allocation:'want'},
    {id:uid(),date:day(11),type:'expense',category:'Food',amount:73.10,description:'Groceries',allocation:'need'},
    {id:uid(),date:day(13),type:'expense',category:'Entertainment',amount:55,description:'Concert',allocation:'want'},
    {id:uid(),date:day(15),type:'expense',category:'Gas',amount:51.25,description:'',allocation:'need'},
    {id:uid(),date:day(16),type:'expense',category:'Food',amount:96.80,description:'Groceries + takeout',allocation:'need'},
    {id:uid(),date:day(4),type:'sinking_fund',category:'Emergency Fund',amount:200,description:'',allocation:'save'},
    {id:uid(),date:day(14),type:'sinking_fund',category:'Retirement',amount:250,description:'',allocation:'save'},
    {id:uid(),date:day(6),type:'bill',category:'Streaming',amount:15.99,description:'Netflix',allocation:'want'},
    {id:uid(),date:day(15),type:'debt',category:'Credit Card',amount:150,description:'Card payment',allocation:'need'},
    {id:uid(),date:day(0),type:'bill',category:'Rent',amount:1400,description:'',allocation:'need'}
  ];
  // Link the rent payment to its bill row so it shows as paid, not duplicated
  const rentRow=(state.bills||[]).find(b=>b.name==='Rent');
  const rentTx=state.transactions.find(tx=>tx.type==='bill'&&tx.category==='Rent');
  if(rentRow&&rentTx){rentRow.paid=true;rentRow.paidTxId=rentTx.id;}
  state.debts=[
    {id:uid(),name:'Credit Card',type:'credit_card',balance:3200,interestRate:24.99,minimumPayment:96,dueDay:16,minPayMode:'fixed'},
    {id:uid(),name:'Car Loan',type:'car_loan',balance:11800,interestRate:6.4,minimumPayment:315,dueDay:5,termMonths:48,amortType:'equal_payment'}
  ];
  state.debtSettings={method:'avalanche',extraPayment:100};
  const yr=new Date(ps+'T00:00:00').getFullYear();
  state.sinkingFunds=[
    {id:uid(),name:'Holidays',icon:'🎄',targetAmount:900,currentSaved:340,targetDate:(yr+'-12-15')},
    {id:uid(),name:'Car Repairs',icon:'🔧',targetAmount:600,currentSaved:180,targetDate:day(27)}
  ];
  state.bills=[
    {id:uid(),name:'Netflix',amount:15.99,frequency:'monthly',category:'Streaming',nextBillingDate:day(28),active:true,allocation:'want'},
    {id:uid(),name:'Spotify',amount:10.99,frequency:'monthly',category:'Music',nextBillingDate:day(25),active:true,allocation:'want'},
    {id:uid(),name:'Cloud Storage',amount:2.99,frequency:'monthly',category:'Storage',nextBillingDate:day(23),active:true,allocation:'need'}
  ];
  saveState();
  trackEvent('feature_used', { feature: 'sample_data_loaded' });
  renderDashboard();
  showToast(t('sample_loaded_toast'));
}
// ── PRO DASHBOARD ─────────────────────────────────────────────────────
function renderDashboard() {
  queueNavBadges();
  const dashEl = document.getElementById('bview-dashboard');
  const afterAction = !_dashEntering && currentTab === 'dashboard' && !!dashEl && dashEl.childElementCount > 0;
  _dashEntering = false;
  const prevSnap = afterAction ? dashSnapshot(dashEl) : null;
  if (afterAction) dashQuietNext();
  requestAnimationFrame(() => { if (prevSnap) animateDashDiff(dashEl, prevSnap); else animateStatsIn(dashEl); dashPaySettle(dashEl, prevSnap); });
  rollBills();
  // renderDashboardLayout1 is still reachable, but only through Sleek,
  // which calls it and then swaps its heading.
  ({
    2: renderDashboardLayout2,
    3: renderDashboardLayout3
  }[getDashLayout()] || renderDashboardLayout3)();
}

// ══ Layout 3: "Sleek" ═════════════════════════════════════════════════
// Not a third copy of the dashboard. Sleek renders Classic and then
// replaces its heading with a greeting and a strip of figures, so the cards
// below can never drift out of step with the layout they were written for.
// It also changes the chrome: with the sections along the top, brand, nav
// and tools share one line and the shell is wider, which is where the
// reference layout gets its composure.
const SLEEK_LAYOUT = 3;
// Sleek first, and Classic no longer among them. Classic is not deleted:
// Sleek renders it and then replaces its heading, so it is still the thing
// doing the work - it just stopped being a choice of its own.
// Radial Pulse was a placeholder and is gone, so this is the one layout and
// Settings no longer offers a choice. A saved Radial Pulse moves across.
const DASH_LAYOUTS = [SLEEK_LAYOUT];

function getDashLayout() {
  const v = state?.settings?.dashboardLayout;
  return DASH_LAYOUTS.indexOf(v) !== -1 ? v : SLEEK_LAYOUT;
}
// Moves anyone still on Classic across, once, so the stored value stops
// naming a layout that can no longer be picked. Nothing of theirs is lost:
// Sleek is the same dashboard with a different header.
function migrateDashLayout() {
  const st = state && state.settings;
  if (!st || DASH_LAYOUTS.indexOf(st.dashboardLayout) !== -1) return;
  st.dashboardLayout = SLEEK_LAYOUT;
  try { saveState(); } catch (e) {}
}
function dashIsSleek() { return getDashLayout() === SLEEK_LAYOUT; }

// Where the tab bar sits when it is not borrowed by the topbar.
let _sleekTabsHome = null;

function applyDashChrome() {
  migrateDashLayout();
  document.documentElement.dataset.dash = dashIsSleek() ? 'sleek' : 'classic';
  const tabs = document.getElementById('ubpTabs');
  const bar = document.querySelector('.tool-shell .tool-topbar');
  const tools = bar && bar.querySelector('.tool-topbar-right');
  if (!tabs || !bar || !tools) return;

  // Docked to a side, the rail owns all of this and the topbar is hidden;
  // railRelease has already put the tab bar back where it started. A phone
  // never docks, so it gets the top bar's arrangement whatever is chosen.
  if (navRailDocks()) {
    if (_sleekTabsHome && tabs.parentNode !== _sleekTabsHome.parent) {
      const before = (_sleekTabsHome.next && _sleekTabsHome.next.parentNode === _sleekTabsHome.parent)
        ? _sleekTabsHome.next : null;
      _sleekTabsHome.parent.insertBefore(tabs, before);
    }
    return;
  }

  // Two pills on one line: the sections on the left, the tools on the right.
  if (!_sleekTabsHome) _sleekTabsHome = { parent: tabs.parentNode, next: tabs.nextSibling };
  if (tabs.parentNode !== bar) bar.insertBefore(tabs, tools);

  // Gathered into the one group, in a fixed order, from wherever the markup
  // or the rail last left them. appendChild moves a node it already owns,
  // so re-running this settles the order rather than appending duplicates.
  // On a phone the dock holds them instead, and pulling them back up here
  // would empty it on every render.
  // The bell sits just before Settings.
  if (!navDockActive()) RAIL_ADOPT.flatMap(id => id === 'settingsNavBtn' ? ['notifNavBtn', id] : [id]).forEach(id => {
    const el = document.getElementById(id);
    if (el) tools.appendChild(el);
  });

  // Whatever group they came from is now empty, and an empty flex child
  // still takes the row's gap - which pushed the sections pill off the
  // left edge. CSS :empty cannot see this: the element still holds the
  // whitespace between the tags it used to wrap.
  const left = bar.querySelector('.tool-topbar-left');
  if (left) left.style.display = left.querySelector('*') ? '' : 'none';
  // Same for the tools group once the dock has taken its buttons: an empty
  // flex child still claims the row gap, and the sections pill is supposed
  // to have the whole line to itself now.
  tools.style.display = tools.querySelector('*') ? '' : 'none';
}

function sleekGreeting() {
  const h = new Date().getHours();
  return t(h < 12 ? 'greet_morning' : h < 18 ? 'greet_afternoon' : 'greet_evening');
}

function sleekDateLine() {
  try {
    return new Date().toLocaleDateString('en',
      { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) { return ''; }
}

// What is still owed this period, soonest first, with anything overdue at
// the top. It reads the same list Free to spend subtracts, so the figure
// and the rows beside it can never disagree. Five rows at most, and bills
// take the places first: an unpaid bill is the thing this list is for, so
// a run of smaller scheduled items cannot push one out of view. Every Pay
// opens the same sheet as everywhere else, so each payment is a real
// transaction linked to what it paid.
const CU_LIMIT = 5;
function cuRelative(iso) {
  const a = new Date(iso + 'T00:00:00'), now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = Math.round((a - now) / 86400000);
  if (d === 0) return t('cu_today');
  if (d === 1) return t('cu_tomorrow');
  if (d === -1) return t('cu_yesterday');
  return d > 0 ? tf('cu_in_days', d) : tf('cu_days_ago', -d);
}
// Past the end of the period there is still something coming. When the
// period has fewer than five things left in it, the list carries on into
// the next one so it is never half empty two days before payday. Those
// rows sit under a small divider, because they are not part of what Free
// to spend has taken off.
const CU_LOOKAHEAD_DAYS = 62;
const cuKeyOf = i => `${i.type}:${i.id}:${i.occDate || i.date}`;
// What is overdue, always, and then what falls due within the "days ahead"
// window set in Settings, five rows at most. Rows past the end of the
// period sit under a divider, since Free to spend does not count them. A
// bill already paid this period is not brought back as next month's row
// the moment it is paid: that read as the payment not having worked.
function cuWindowDays() { const d = parseInt(state.settings?.upcomingDays, 10); return d >= 1 && d <= 90 ? d : 30; }
function comingUpItems(committed, limit) {
  const today = toLocalISO(new Date());
  const pEnd = state.settings.periodEnd || '';
  const start = state.settings.periodStart || '';
  const overdue = (committed || nlCommitted()).items.filter(i => i.date < today);
  const seen = new Set(overdue.map(cuKeyOf));
  let upcoming = [];
  try {
    upcoming = (getUpcomingEvents(cuWindowDays(), computeActuals()) || [])
      .filter(ev => !ev.paid && (Number(ev.amount) || 0) > 0)
      .map(ev => ({ label: ev.label, date: ev.date, amount: Number(ev.amount) || 0,
                    type: ev.type, id: ev.srcId, occDate: ev.occDate || ev.date,
                    paidSoFar: ev.paidSoFar || 0, expected: ev.expected || 0, later: !!pEnd && ev.date > pEnd }))
      .filter(i => !seen.has(cuKeyOf(i)));
  } catch (e) { upcoming = []; }
  const paidThisPeriod = id => { const b = (state.bills || []).find(x => x.id === id);
    return !!b && (rowPayState(b) === 'paid' || (b.lastPaidOn && b.lastPaidOn >= start)); };
  const all = overdue.concat(upcoming)
    .filter(i => i.id && PAYABLE_KINDS.has(i.type))
    .filter(i => !(i.later && i.type === 'bill' && paidThisPeriod(i.id)))
    .map(i => ({ ...i, overdue: i.date < today }));
  const rank = i => i.overdue ? 0 : i.type === 'bill' ? 1 : 2;
  const picked = [], shown = new Set();
  all.slice().sort((a, b) => rank(a) - rank(b) || String(a.date).localeCompare(String(b.date)))
    .forEach(i => {
      const src = `${i.type}:${i.id}`;
      // Each bill, debt or automation once, at its earliest date: a weekly
      // bill would otherwise fill the list on its own.
      if (picked.length >= (limit || CU_LIMIT) || shown.has(src)) return;
      picked.push(i); shown.add(src);
    });
  return picked
    .sort((a, b) => (a.later ? 1 : 0) - (b.later ? 1 : 0) || String(a.date).localeCompare(String(b.date)));
}
function comingUpHtml(committed, limit) {
  const items = comingUpItems(committed, limit);
  const lang = 'en';
  const mon = iso => new Date(iso + 'T00:00:00').toLocaleString(lang, { month: 'short' }).replace('.', '').toUpperCase();
  const firstLater = items.findIndex(i => i.later);
  const row = (i, k) => `${k === firstLater && k > 0 ? `<li class="cu-sep" aria-hidden="true"><span>${t('cu_next_period')}</span></li>` : ''}
      <li class="cu-row${i.overdue ? ' is-overdue' : ''}${i.later ? ' is-later' : ''}" data-cu-key="${esc(cuKeyOf(i))}">
        <span class="cu-date"><b>${parseInt(i.date.slice(8, 10), 10)}</b><small>${esc(mon(i.date))}</small></span>
        <span class="cu-info">
          <span class="cu-name"><span class="cu-name-txt">${esc(i.label)}</span></span>
          <span class="cu-sub"><span class="cu-amt">${fmt(i.amount)}</span><span class="cu-when">${esc(cuRelative(i.date))}${i.paidSoFar > 0 ? ` \u00b7 ${esc(tf('nl_partial_of', fmt(i.paidSoFar), fmt(i.expected)))}` : ''}</span></span>
        </span>
        <button class="cu-pay" type="button" data-cu-type="${esc(i.type)}" data-cu-pay="${esc(i.id)}" data-cu-date="${esc(i.occDate || i.date)}">${t('pay_btn')}</button>
      </li>`;
  return `<section class="coming-up">
    <div class="cu-head">
      <h3 class="cu-title">${t('cu_title')}</h3>
      <button class="link-btn cu-all" type="button" data-btab="bills">${t('cu_all')}</button>
    </div>
    ${items.length ? `<ul class="cu-list">${items.map(row).join('')}</ul>`
      : `<p class="cu-empty">${tf('cu_empty', cuWindowDays())}</p>`}
  </section>`;
}

// ── After a payment ──────────────────────────────────────────────────────
// The dashboard is redrawn without its entrance animation, and the list
// shows what changed instead: the paid row takes a tick, slides away and
// folds shut so the rows under it close the gap, a part-paid row pulses its
// new amount, and whatever moves up into view fades in last.
function cuSnapshot(scope) {
  const rows = [...scope.querySelectorAll('.nl-hero .cu-row')];
  return rows.length ? {
    keys: rows.map(r => r.dataset.cuKey),
    html: new Map(rows.map(r => [r.dataset.cuKey, r.outerHTML])),
    amts: new Map(rows.map(r => [r.dataset.cuKey, r.querySelector('.cu-amt').textContent]))
  } : null;
}
const CU_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
function cuAnimateAfterPay(scope, prev) {
  if (!prev || !scope) return;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
  let list = scope.querySelector('.nl-hero .cu-list');
  const rows = list ? [...list.querySelectorAll('.cu-row')] : [];
  const now = new Set(rows.map(r => r.dataset.cuKey));
  rows.forEach(r => {
    const k = r.dataset.cuKey;
    if (!prev.keys.includes(k)) r.classList.add('cu-enter');
    else if (prev.amts.get(k) !== r.querySelector('.cu-amt').textContent) r.classList.add('cu-updated');
  });
  // The last one paid leaves an empty list, and the tick still needs
  // somewhere to play: a list just for it, gone once it has folded away.
  if (!list) {
    const empty = scope.querySelector('.nl-hero .cu-empty');
    if (!empty || !prev.keys.length) return;
    list = document.createElement('ul');
    list.className = 'cu-list cu-list--leaving';
    empty.parentNode.insertBefore(list, empty);
    setTimeout(() => list.remove(), 950);
  }
  prev.keys.forEach((k, i) => {
    if (now.has(k)) return;
    const tmp = document.createElement('ul');
    tmp.innerHTML = prev.html.get(k);
    const ghost = tmp.firstElementChild;
    ghost.classList.add('cu-leave');
    ghost.setAttribute('aria-hidden', 'true');
    const pay = ghost.querySelector('.cu-pay');
    if (pay) { pay.disabled = true; pay.removeAttribute('data-cu-pay'); pay.innerHTML = CU_TICK; }
    const at = [...list.querySelectorAll('.cu-row:not(.cu-leave)')][i] || null;
    list.insertBefore(ghost, at && at.previousElementSibling?.classList.contains('cu-sep') ? at.previousElementSibling : at);
    ghost.style.height = ghost.offsetHeight + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('is-going')));
    setTimeout(() => ghost.remove(), 900);
  });
}
function wireComingUp(scope) {
  scope.querySelectorAll('[data-cu-pay]').forEach(btn => btn.addEventListener('click', () =>
    promptPay(btn.dataset.cuType || 'bill', btn.dataset.cuPay, () => {
      const prev = cuSnapshot(scope);
      dashQuietNext();
      renderDashboard();
      cuAnimateAfterPay(document.getElementById('bview-dashboard'), prev);
    }, btn.dataset.cuDate)));
  scope.querySelectorAll('.cu-all[data-btab]').forEach(btn => btn.addEventListener('click', () =>
    switchTab(btn.dataset.btab)));
}
// One quiet redraw: the next dashboard render skips its entrance animation.
let _dashQuiet = false;
function dashQuietNext() { _dashQuiet = true; }
function takeDashQuiet() { const q = _dashQuiet; _dashQuiet = false; return q; }

// ══ Dashboard: Overview and Statistics ═══════════════════════════════════
// Two views of the same period, switched from the header. Overview is the
// day to day: what is free, what is due, how the spending runs, what came
// in and went out, where the goals stand, the latest activity, and anything
// that looks wrong. Statistics is the long look: pace, trends and shares.
function dashView() {
  if (typeof toolOn === 'function' && !toolOn('insights')) return 'calm';
  const v = state.settings.dashView;
  return v === 'stats' || v === 'calm' ? v : 'overview';
}
const DV_ICONS = {
  calm: '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 13.6c1.9 1.7 4.9 1.7 6.8 0"/><path d="M9 9.8h.01"/><path d="M15 9.8h.01"/>',
  overview: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.8"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.8"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.8"/>',
  stats: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'
};
function dashViewToggleHtml() {
  if (typeof toolOn === 'function' && !toolOn('insights')) return '';
  const v = dashView();
  return `<div class="dv-toggle" role="radiogroup" aria-label="${esc(t('dv_label'))}">${['calm', 'overview', 'stats'].map(k =>
    `<button class="dv-opt${v === k ? ' is-on' : ''}" type="button" role="radio" aria-checked="${v === k}" data-dash-view="${k}" title="${esc(t('dv_' + k))}" aria-label="${esc(t('dv_' + k))}"><svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DV_ICONS[k]}</svg></button>`).join('')}</div>`;
}

// ── Daily spend, straight or curved ──────────────────────────────────────
function spendPanelHtml(points) {
  const total = points.reduce((s, p) => s + p.value, 0);
  const curve = state.settings.spendCurve === true;
  const ico = { line: '<path d="M3 17 9 9l5 5 7-9"/>', curve: '<path d="M3 17c3-7 5-8 7-6s3 5 5 4 4-6 6-9"/>' };
  return `<div class="panel spend-line-panel"><div class="panel-inner-sm">
    <div class="panel-titlebar"><span class="panel-title-sm">${t('dash_daily_spend')}</span>
      <div class="dv-toggle dv-toggle--sm" role="radiogroup" aria-label="${esc(t('dash_line_style'))}">${[['line', false], ['curve', true]].map(([k, on]) =>
        `<button class="dv-opt${curve === on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${curve === on}" data-spend-curve="${on ? 1 : 0}" title="${esc(t('dash_line_' + k))}" aria-label="${esc(t('dash_line_' + k))}"><svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ico[k]}</svg></button>`).join('')}</div>
    </div>
    ${total > 0 ? svgSpendLine(points, { w: 900, h: 150, curve }) + `<div class="spend-line-caption"><span class="spend-line-num">${fmt(total)}</span><span class="spend-line-label">${t('dash_daily_spend_caption')}</span></div>`
      : `<div class="chart-empty">${t('dash_no_spending')}</div>`}
  </div></div>`;
}

// ── This period so far ───────────────────────────────────────────────────
// In, out and kept, then where the out went as one bar. Savings moved to a
// goal is kept money, so it is not counted as out.
function periodSoFarHtml(sum, spendSegs) {
  const inn = sum.totalIncome, out = sum.totalOut, kept = inn - out;
  const planned = (state.budgets.income || []).reduce((t, r) => t + (r.expected || 0), 0);
  const still = Math.max(0, planned - inn);
  const billsPart = sum.totalBills + sum.totalSubscriptions;
  const keptPct = inn > 0 ? Math.round(kept / inn * 100) : 0;
  const tot = spendSegs.reduce((s, x) => s + x.value, 0);
  const top = spendSegs.slice(0, 6);
  const rest = spendSegs.slice(6).reduce((s, x) => s + x.value, 0);
  const segs = rest > 0 ? top.concat([{ label: t('dash_other'), value: rest, color: '#94a3b8' }]) : top;
  return `<div class="panel psf"><div class="panel-inner-sm">
    <div class="psf-head"><h3 class="ov-title">${t('psf_title')}</h3><span class="psf-range">${esc(formatDateShort(state.settings.periodStart))} – ${esc(formatDateShort(state.settings.periodEnd))}</span></div>
    <div class="psf-tiles">
      <div class="psf-tile psf-tile--in"><span class="psf-k">${t('psf_in')}</span><strong data-v="${inn}">${fmt(inn)}</strong><em>${still > 0 ? tf('psf_still', fmt(still)) : planned > 0 ? t('psf_all_in') : '&nbsp;'}</em></div>
      <div class="psf-tile psf-tile--out"><span class="psf-k">${t('psf_out')}</span><strong data-v="${out}">${fmt(out)}</strong><em>${billsPart > 0 ? tf('psf_bills_part', fmt(billsPart)) : '&nbsp;'}</em></div>
      <div class="psf-tile psf-tile--kept${kept < 0 ? ' is-neg' : ''}"><span class="psf-k">${t('psf_kept')}</span><strong data-v="${kept}">${kept < 0 ? '−' : ''}${fmt(Math.abs(kept))}</strong><em>${inn > 0 ? tf('psf_kept_pct', keptPct) : '&nbsp;'}</em></div>
    </div>
    ${tot > 0 ? `<div class="psf-bar" role="img" aria-label="${esc(t('psf_where'))}">${segs.map(x =>
      `<span style="flex:${x.value};background:${x.color}" title="${esc(x.label)} ${esc(fmt(x.value))}"></span>`).join('')}</div>
    <div class="psf-legend">${segs.map(x => `<span><i style="background:${x.color}"></i>${esc(x.label)} <b>${fmt(x.value)}</b></span>`).join('')}</div>`
      : `<p class="ov-empty">${t('dash_no_spending')}</p>`}
  </div></div>`;
}

// ── Goal progress ────────────────────────────────────────────────────────
function goalRingSvg(p, color) {
  const r = 19, c = 2 * Math.PI * r, d = Math.max(0, Math.min(100, p)) / 100 * c;
  return `<svg class="gp-ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="5"/>
    <circle cx="24" cy="24" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${d.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 24 24)"/></svg>`;
}
function goalProgressHtml() {
  const goals = (state.sinkingFunds || []).slice();
  const targeted = goals.filter(fundHasTarget);
  const saved = targeted.reduce((s, f) => s + (f.currentSaved || 0), 0);
  const target = targeted.reduce((s, f) => s + (f.targetAmount || 0), 0);
  const allPct = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
  const today = toLocalISO(new Date());
  // Nearest date first; open-ended goals after the ones with a date.
  goals.sort((a, b) => String(a.targetDate || '9').localeCompare(String(b.targetDate || '9')));
  const row = f => {
    const has = fundHasTarget(f), c = calcFund(f), p = Math.round(c.pctComplete || 0);
    const done = has && (f.currentSaved || 0) >= f.targetAmount;
    const late = has && !done && f.targetDate && f.targetDate < today;
    const color = done ? '#10b981' : late ? '#f43f5e' : 'var(--grad-indigo)';
    const status = done ? `<i class="gp-chip gp-chip--done">${t('gp_done')}</i>`
      : late ? `<i class="gp-chip gp-chip--late">${t('gp_late')}</i>`
      : has && f.targetDate ? `<i class="gp-chip">${tf('gp_by', formatDateShort(f.targetDate))}</i>` : `<i class="gp-chip gp-chip--open">${t('sf_open_ended')}</i>`;
    return `<button class="gp-row" type="button" data-btab="goals" data-gp-id="${esc(f.id)}" data-pct="${has ? p : 100}">
      <span class="gp-ringwrap" style="color:${color}">${goalRingSvg(has ? p : 100, has ? color : 'var(--grad-purple)')}<b>${has ? p + '%' : ''}</b></span>
      <span class="gp-main"><span class="gp-name">${esc(f.icon && f.icon.length <= 4 ? f.icon + ' ' : '')}${esc(f.name)}${status}</span>
        <span class="gp-sub">${has ? tf('gp_of', fmt(f.currentSaved || 0), fmt(f.targetAmount)) : tf('gp_saved', fmt(f.currentSaved || 0))}${!done && c.requiredMonthly > 0 ? ` · ${fmt(c.requiredMonthly)}${t('sf_per_month')}` : ''}</span></span>
    </button>`;
  };
  return `<div class="panel gp"><div class="panel-inner-sm">
    <div class="psf-head"><h3 class="ov-title">${t('gp_title')}</h3><button class="link-btn cu-all" type="button" data-btab="goals">${t('gp_all')}</button></div>
    ${goals.length ? `${target > 0 ? `<div class="gp-sum"><div class="gp-sum-top"><strong>${fmt(saved)}</strong><span>${tf('gp_sum_of', fmt(target), allPct)}</span></div>
      <div class="gp-sum-bar"><i style="width:${allPct}%"></i></div></div>` : ''}
      <div class="gp-list">${goals.slice(0, 4).map(row).join('')}</div>`
      : `<div class="ov-emptybox"><p class="ov-empty">${t('dash_no_sinking')}</p><button class="btn btn-primary btn-sm" type="button" data-btab="goals">${t('dash_create_one')}</button></div>`}
  </div></div>`;
}

// ── Recent activity ──────────────────────────────────────────────────────
const RA_ICON = { expense: 'expenses', bill: 'bills', income: 'income', sinking_fund: 'sinking', savings: 'savings', debt: 'debt', subscription: 'bills' };
const RA_TINT = { expense: '#ec4899', bill: '#fb923c', income: '#10b981', sinking_fund: '#06b6d4', savings: '#3b82f6', debt: '#a855f7', subscription: '#fb923c' };
let _raUndo = null;
function recentTxs(n) {
  return (state.transactions || []).map((tx, i) => ({ tx, i }))
    .sort((a, b) => String(b.tx.date).localeCompare(String(a.tx.date)) || b.i - a.i)
    .slice(0, n).map(x => x.tx);
}
function recentActivityHtml() {
  const rows = recentTxs(5);
  const undo = _raUndo && _raUndo.until > Date.now() ? _raUndo : null;
  const PEN = '<svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
  const DOTS = '<svg class="app-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>';
  return `<div class="panel ra"><div class="panel-inner-sm">
    <div class="psf-head"><h3 class="ov-title">${t('ra_title')}</h3><button class="link-btn cu-all" type="button" data-btab="transactions">${t('ra_all')}</button></div>
    ${undo ? `<div class="ra-undo" role="status"><span>${esc(tf('ra_deleted', undo.tx.description || undo.tx.category, fmt(undo.tx.amount)))}</span><button class="btn btn-ghost btn-sm" type="button" id="raUndoBtn">${t('ra_undo')}</button></div>` : ''}
    ${rows.length ? `<div class="ra-list">${rows.map(tx => {
      const inc = tx.type === 'income';
      const tint = RA_TINT[tx.type] || 'var(--grad-indigo)';
      return `<div class="ra-row" data-ra-id="${esc(tx.id)}" style="--tint:${tint}">
        <span class="ra-ico" style="color:${tint};background:color-mix(in srgb, ${tint} 14%, transparent)" aria-hidden="true">${appIconSvg(RA_ICON[tx.type] || 'transactions')}</span>
        <span class="ra-main"><span class="ra-name">${esc(tx.description || tx.category)}</span>
          <span class="ra-meta">${esc(formatDateShort(tx.date))} · ${esc(tx.category)} · ${esc(txTypeLabel(tx.type))}</span></span>
        <span class="ra-amt${inc ? ' is-in' : ''}">${inc ? '+' : ''}${fmt(tx.amount)}</span>
        <span class="ra-acts">
          <button class="lv-act ra-edit" type="button" data-ra-edit="${esc(tx.id)}" title="${esc(t('edit'))}" aria-label="${esc(t('edit'))}">${PEN}</button>
          <button class="lv-act" type="button" data-ra-menu="${esc(tx.id)}" title="${esc(t('ra_more'))}" aria-label="${esc(t('ra_more'))}">${DOTS}</button>
        </span>
      </div>`; }).join('')}</div>`
      : `<div class="ov-emptybox"><p class="ov-empty">${t('ra_empty')}</p><button class="btn btn-primary btn-sm" type="button" data-ra-add>${t('tx_add_btn')}</button></div>`}
  </div></div>`;
}
// Editing from the dashboard: the editor is the transaction list's own, and
// once it closes the dashboard is drawn again with whatever changed.
function raEdit(id) {
  openEditTx(id);
  const ov = document.getElementById('tutorialOverlay');
  const mo = new MutationObserver(() => {
    if (!ov.hidden) return;
    mo.disconnect();
    if (currentTab === 'dashboard') { dashQuietNext(); renderDashboard(); }
  });
  mo.observe(ov, { attributes: true, attributeFilter: ['hidden'] });
}
// Deleting keeps the transaction for a few seconds so it can be put back
// exactly as it was, bill link and goal balance included.
function raDelete(id) {
  const i = state.transactions.findIndex(x => x.id === id);
  if (i < 0) return;
  const tx = state.transactions[i];
  // The bill it paid, whether it paid the current cycle or one already rolled on.
  const bill = (state.bills || []).find(b => rowPayTxIds(b).includes(tx.id) || (b.paidCycles || []).some(c => c.ids.includes(tx.id)));
  applySinkingFundDelta(tx, -1);
  state.transactions.splice(i, 1);
  syncBillPaidLinks();
  saveState();
  _raUndo = { tx, i, billId: bill ? bill.id : null, until: Date.now() + 6000 };
  dashQuietNext(); renderDashboard();
  setTimeout(() => { if (_raUndo && _raUndo.until <= Date.now()) { _raUndo = null; document.querySelector('#bview-dashboard .ra-undo')?.remove(); } }, 6100);
}
function raUndo() {
  const u = _raUndo;
  if (!u) return;
  _raUndo = null;
  state.transactions.splice(Math.min(u.i, state.transactions.length), 0, u.tx);
  applySinkingFundDelta(u.tx, +1);
  const bill = u.billId && (state.bills || []).find(b => b.id === u.billId);
  if (bill) setRowPayments(bill, [...rowPayTxIds(bill), u.tx.id]);
  saveState();
  dashQuietNext(); renderDashboard();
  showToast(t('ra_restored'));
}
function openTxSheet(id) {
  const tx = state.transactions.find(x => x.id === id);
  if (!tx) return;
  const kv = [[t('ra_amount'), `${tx.type === 'income' ? '+' : ''}${fmt(tx.amount)}`], [t('tx_date'), formatDateDisplay(tx.date)],
    [t('tx_category'), tx.category], [t('tx_type'), txTypeLabel(tx.type)]];
  if (tx.description) kv.push([t('ra_note'), tx.description]);
  const I = p => `<svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  document.getElementById('modalTitle').textContent = tx.description || tx.category;
  document.getElementById('modalBody').innerHTML = `<div class="txs">
    <dl class="txs-kv">${kv.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="txs-acts">
      <button class="txs-btn" type="button" data-txs="edit">${I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>')}${t('edit')}</button>
      <button class="txs-btn" type="button" data-txs="again">${I('<path d="M12 5v14"/><path d="M5 12h14"/>')}${t('ra_again')}</button>
      <button class="txs-btn txs-btn--del" type="button" data-txs="del">${I('<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>')}${t('delete')}</button>
    </div>
    <div class="txs-foot"><button class="btn btn-ghost" type="button" data-txs="close">${t('close')}</button></div>
  </div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  document.querySelectorAll('#modalBody [data-txs]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.txs;
    if (a === 'close') return closeModal();
    if (a === 'edit') { closeModal(); return raEdit(id); }
    if (a === 'again') { closeModal(); return openQuickAddTx({ type: tx.type, category: tx.category, amount: tx.amount, description: tx.description }); }
    if (a === 'del') { closeModal(); return raDelete(id); }
  }));
}

// ── Taking the user to the thing ─────────────────────────────────────────
// A flag's action opens the section and points at what it is about: the
// page scrolls to it and it pulses a few times, so there is no hunting.
function goAndFlash(tab, sel) {
  switchTab(tab);
  setTimeout(() => {
    const root = document.getElementById('bview-' + tab);
    if (!root) return;
    let els = sel ? [...root.querySelectorAll(sel)] : [];
    if (sel && !els.length && tab === 'transactions') els = flashFindTx(root, sel);
    if (!els.length) els = [root.querySelector('.section-header')].filter(Boolean);
    if (!els.length) return;
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.forEach(el => {
      el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 3400);
    });
  }, 160);
}
// A transaction the highlight is after may sit behind a search or on a later
// page of the list. Clear the filters and turn the pages until it shows.
function flashFindTx(root, sel) {
  txFilter.search = ''; txFilter.type = ''; if ('alloc' in txFilter) txFilter.alloc = '';
  txPage = 0; renderTransactions();
  const pages = Math.max(1, Math.ceil((state.transactions || []).length / TX_PAGE_SIZE));
  for (let pg = 0; pg < pages; pg++) {
    if (pg) { txPage = pg; renderTxList(); }
    const found = [...root.querySelectorAll(sel)];
    if (found.length) return found;
  }
  txPage = 0; renderTxList();
  return [];
}
const rfIds = (attr, ids) => ids.map(id => `[${attr}="${String(id).replace(/"/g, '')}"]`).join(', ');

// ── Heads-ups (formerly red flags) ────────────────────────────────────────────────────────────
// Every check runs on the period, and each one says what looks wrong and
// what to do about it. A flag can be set aside for the rest of the period.
function computeRedFlags(ctx) {
  const { act, sum } = ctx;
  const S = state.settings, start = S.periodStart, end = S.periodEnd;
  const p = nlDaysInPeriod(), f = p.total > 0 ? p.dayOf / p.total : 0;
  const today = toLocalISO(new Date());
  const inP = x => x.date >= start && x.date <= end;
  const txs = (state.transactions || []);
  const pTx = txs.filter(inP);
  const planInc = (state.budgets.income || []).reduce((t, r) => t + (r.expected || 0), 0);
  const planExp = (state.budgets.expenses || []).reduce((t, r) => t + (r.expected || 0), 0);
  const uncat = new Set(Object.values(TRANSLATIONS).map(x => x && x.qa_uncat).filter(Boolean));
  const expNames = new Set((state.budgets.expenses || []).map(r => r.category));
  const incNames = new Set((state.budgets.income || []).map(r => r.category));
  const billNames = new Set((state.bills || []).map(b => b.name));
  const debtNames = new Set((state.debts || []).map(d => d.name));
  const goalNames = new Set((state.sinkingFunds || []).map(g => g.name));
  const flags = [];
  // The kind names the help behind its ? button; ids that carry a row id
  // after the kind are trimmed back to it.
  const kindOf = id => ['alloc_save', 'goal_track', 'goal_late', 'interest', 'missed', 'jump', 'alloc'].find(k => id === k || id.startsWith(k + '_')) || id;
  // A go-and-flash that also says where it goes, for the arrow beside it.
  const gf = (tab, sel) => Object.assign(() => goAndFlash(tab, sel), { go: [tab, sel] });
  const add = (id, sev, title, detail, label, run) => flags.push({ id, kind: kindOf(id), sev, title, detail, act: label ? { label, run } : null });
  const list = (arr, n) => arr.slice(0, n || 3).join(', ') + (arr.length > (n || 3) ? '…' : '');
  const toTx = ids => gf('transactions', rfIds('data-tx-row', ids));
  const checks = [
    // Spending pace against the everyday budget.
    () => {
      if (planExp > 0 && f > 0.15 && sum.totalExpenses > 0) {
        const projected = sum.totalExpenses / f;
        if (projected > planExp * 1.1) add('pace', projected > planExp * 1.3 ? 'high' : 'med', t('rf_pace'),
          tf('rf_pace_d', fmt(projected), fmt(projected - planExp)), t('rf_act_budget'), gf('budget', '[data-mod-type="expenses"]'));
      }
    },
    // At the usual daily pace, will the money run out before the end?
    () => {
      const free = sum.leftover - nlCommitted().total;
      const perDay = p.dayOf > 0 ? sum.totalExpenses / p.dayOf : 0;
      if (p.left > 2 && free > 0 && perDay > 0 && perDay * p.left > free * 1.05)
        add('runout', 'high', t('rf_runout'), tf('rf_runout_d', fmt(perDay), fmt(perDay * p.left), fmt(free)), t('rf_act_budget'), gf('budget', '[data-mod-type="expenses"]'));
    },
    // More still owed than is left.
    () => {
      const c = nlCommitted();
      if (sum.leftover - c.total < 0) add('short', 'high', t('rf_short'), tf('rf_short_d', fmt(c.total), fmt(Math.max(0, sum.leftover))), t('rf_act_coming'), gf('dashboard', '.nl-right'));
    },
    // Bills overdue.
    () => {
      const o = (state.bills || []).filter(b => b.active !== false && b.nextBillingDate && b.nextBillingDate < today && rowPayState(b) !== 'paid');
      if (o.length) add('overdue', 'high', tf(o.length === 1 ? 'rf_overdue_one' : 'rf_overdue', o.length), list(o.map(b => b.name)), t('rf_act_pay'),
        gf('bills', rfIds('data-bill-row', o.map(b => b.id))));
    },
    // Categories over budget.
    () => {
      const o = (state.budgets.expenses || []).filter(r => (r.expected || 0) > 0 && (act.expenses[r.category] || 0) > r.expected);
      if (o.length) add('over', 'med', tf(o.length === 1 ? 'rf_over_one' : 'rf_over', o.length), list(o.map(r => r.category)), t('rf_act_budget'),
        gf('budget', rfIds('data-env-id', o.map(r => r.id))));
    },
    // Categories with spending but no amount planned.
    () => {
      const o = (state.budgets.expenses || []).filter(r => !(r.expected > 0) && (act.expenses[r.category] || 0) > 0);
      if (o.length) add('noplan', 'med', tf('rf_noplan', list(o.map(r => r.category))), tf('rf_noplan_d', fmt(o.reduce((s, r) => s + act.expenses[r.category], 0))), t('rf_act_edit'),
        gf('budget', rfIds('data-env-id', o.map(r => r.id))));
    },
    // Spending logged under a category the budget does not have.
    () => {
      const o = pTx.filter(x => x.type === 'expense' && x.category && !uncat.has(x.category) && !expNames.has(x.category));
      if (o.length) { const cats = [...new Set(o.map(x => x.category))];
        add('unplanned', 'med', tf('rf_unplanned', o.length), tf('rf_unplanned_d', fmt(o.reduce((s, x) => s + x.amount, 0)), list(cats)), t('rf_act_tx'), toTx(o.map(x => x.id))); }
    },
    // Bill payments that match no bill.
    () => {
      const o = pTx.filter(x => x.type === 'bill' && !billNames.has(x.category));
      if (o.length) add('unbill', 'med', tf('rf_unlinked_bill', o.length), tf('rf_unlinked_bill_d', list([...new Set(o.map(x => x.category))])), t('rf_act_tx'), toTx(o.map(x => x.id)));
    },
    // Debt payments that match no debt.
    () => {
      const o = pTx.filter(x => x.type === 'debt' && !debtNames.has(x.category));
      if (o.length) add('undebt', 'med', tf('rf_unlinked_debt', o.length), tf('rf_unlinked_debt_d', list([...new Set(o.map(x => x.category))])), t('rf_act_tx'), toTx(o.map(x => x.id)));
    },
    // Goal contributions that match no goal.
    () => {
      const o = pTx.filter(x => x.type === 'sinking_fund' && !goalNames.has(x.category));
      if (o.length) add('ungoal', 'med', tf('rf_unlinked_goal', o.length), tf('rf_unlinked_goal_d', list([...new Set(o.map(x => x.category))])), t('rf_act_tx'), toTx(o.map(x => x.id)));
    },
    // Income that has no income line.
    () => {
      const o = pTx.filter(x => x.type === 'income' && !incNames.has(x.category));
      if (o.length) add('uninc', 'med', tf('rf_unlinked_inc', o.length), tf('rf_unlinked_inc_d', list([...new Set(o.map(x => x.category))])), t('rf_act_tx'), toTx(o.map(x => x.id)));
    },
    // Unsorted spending piling up.
    () => {
      const o = pTx.filter(x => x.type === 'expense' && uncat.has(x.category));
      const amt = o.reduce((s, x) => s + x.amount, 0);
      if (o.length && sum.totalExpenses > 0 && amt > sum.totalExpenses * 0.1) add('loose', 'med', t('rf_loose'), tf('rf_loose_d', fmt(amt)), t('nt_act_sort'), toTx(o.map(x => x.id)));
    },
    // Needs, wants and saving: untagged spending, and a bucket over its share.
    () => {
      if (!state.allocation?.enabled) return;
      const o = pTx.filter(x => (x.type === 'expense' || x.type === 'bill' || x.type === 'debt') && !x.allocation);
      if (o.length) add('untagged', 'med', tf('rf_untagged', o.length), tf('rf_untagged_d', fmt(o.reduce((s, x) => s + x.amount, 0))), t('rf_act_tx'), toTx(o.map(x => x.id)));
    },
    () => {
      if (!state.allocation?.enabled || !(sum.totalIncome > 0)) return;
      const { totals } = computeAllocation();
      (state.allocation.buckets || []).forEach(bk => {
        const ap = (totals[bk.id] || 0) / sum.totalIncome * 100;
        if (bk.id === 'save') { if (f > 0.6 && bk.pct > 0 && ap < bk.pct * 0.7) add('alloc_save', 'med', t('rf_alloc_save'), tf('rf_alloc_d', Math.round(ap), bk.pct), t('rf_act_goals'), () => switchTab('goals')); }
        else if (bk.pct > 0 && ap > bk.pct) add('alloc_' + bk.id, 'med', tf('rf_alloc_over', getAllocBucketDisplayName(bk)), tf('rf_alloc_d', Math.round(ap), bk.pct), t('rf_act_tx'), () => switchTab('transactions'));
      });
    },
    // The plan itself spends more than the plan earns.
    () => {
      const bills = (state.bills || []).filter(b => b.active !== false).reduce((s, b) => s + monthlySubAmt(b), 0);
      const debts = (state.debts || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
      const goals = (state.sinkingFunds || []).reduce((s, g) => s + (calcFund(g).requiredMonthly || 0), 0);
      // Bills, minimums and goals are monthly; the plan is per period. A
      // period that is not a month (paid weekly or fortnightly) takes its
      // share of them, or every short period would read as overspent.
      const k = p.total >= 28 && p.total <= 31 ? 1 : p.total / 30.4375;
      const out = planExp + (bills + debts + goals) * k;
      if (planInc > 0 && out > planInc * 1.02) add('plan', 'high', t('rf_plan'), tf('rf_plan_d', fmt(out), fmt(planInc)), t('rf_act_budget'), gf('budget', '.budget-summary, .section-header'));
    },
    // Income running short late in the period, or none at all.
    () => { if (planInc > 0 && f > 0.6 && sum.totalIncome > 0 && sum.totalIncome < planInc * 0.8) add('income', 'med', t('rf_income'), tf('rf_income_d', fmt(sum.totalIncome), fmt(planInc)), t('rf_act_log'), () => openQuickAddTx({ type: 'income' })); },
    () => { if (planInc > 0 && p.dayOf > 7 && sum.totalIncome === 0) add('noincome', 'high', t('rf_noincome'), tf('rf_noincome_d', fmt(planInc)), t('rf_act_log'), () => openQuickAddTx({ type: 'income' })); },
    // Goals: nothing put by, one falling behind, one past its date.
    () => {
      const need = (state.sinkingFunds || []).reduce((s, g) => s + (calcFund(g).requiredMonthly || 0), 0);
      if (need > 0 && f > 0.5 && sum.totalSavings === 0) add('nosave', 'med', t('rf_nosave'), tf('rf_nosave_d', fmt(need)), t('rf_act_goals'), gf('goals', '.sf-card, .lv-row'));
    },
    () => (state.sinkingFunds || []).forEach(g => {
      const c = calcFund(g);
      if (fundHasTarget(g) && g.targetDate && g.targetDate >= today && (g.monthlyContribution || 0) > 0 && c.requiredMonthly > g.monthlyContribution * 1.1)
        add('goal_track_' + g.id, 'med', tf('rf_goal_track', g.name), tf('rf_goal_track_d', fmt(c.requiredMonthly), formatDateShort(g.targetDate), fmt(g.monthlyContribution)), t('rf_act_edit'), gf('goals', rfIds('data-fund-card', [g.id])));
      if (fundHasTarget(g) && g.targetDate && g.targetDate < today && (g.currentSaved || 0) < g.targetAmount)
        add('goal_late_' + g.id, 'med', tf('rf_goal_late', g.name), tf('rf_goal_late_d', fmt(g.targetAmount - (g.currentSaved || 0))), t('rf_act_edit'), gf('goals', rfIds('data-fund-card', [g.id])));
    }),
    // Debt: expensive balances on minimums, minimums below the interest, and
    // minimums not yet paid past their day.
    () => {
      const hot = (state.debts || []).filter(d => (d.balance || 0) > 0 && (d.interestRate || 0) >= 20 && !(d.targetedExtra > 0));
      if (hot.length && !((state.debtSettings || {}).extraPayment > 0)) add('apr', 'med', tf('rf_apr', hot[0].name, hot[0].interestRate), t('rf_apr_d'), t('rf_act_debt'), gf('debt', rfIds('data-debt-row', [hot[0].id])));
    },
    () => (state.debts || []).forEach(d => {
      const interest = (d.balance || 0) * (d.interestRate || 0) / 1200;
      if (interest > 0 && (d.minimumPayment || 0) <= interest) add('interest_' + d.id, 'high', tf('rf_interest', d.name), tf('rf_interest_d', fmt(interest), fmt(d.minimumPayment || 0)), t('rf_act_debt'), gf('debt', rfIds('data-debt-row', [d.id])));
      const day = parseInt(d.dueDay, 10);
      const miss = debtOverdueDates(d, act.debt).dates[0];
      if (miss) add('missed_' + d.id, 'high', tf('rf_missed', d.name), tf('rf_missed_d', day, fmt(miss.paid), fmt(miss.min)), t('rf_act_pay'), () => promptPay('debt', d.id, () => renderDashboard(), miss.date));
    }),
    // Bills: a price rise, one that came in higher than usual, one with no date,
    // and subscriptions heavy against income.
    () => {
      const cutoff = toLocalISO(new Date(Date.now() - 90 * 86400000));
      const r = (state.bills || []).filter(b => { const h = b.priceHistory || []; const l = h[h.length - 1]; return l && l.to > l.from && (l.date || '') >= cutoff; });
      if (r.length) { const b = r[0], l = b.priceHistory[b.priceHistory.length - 1];
        add('rise', 'med', tf('rf_rise', b.name, fmt(l.to - l.from)), tf('rf_rise_d', fmt(l.from), fmt(l.to)), t('rf_act_bills'), gf('bills', rfIds('data-bill-row', [b.id]))); }
    },
    () => (state.bills || []).forEach(b => {
      const paid = pTx.filter(x => x.type === 'bill' && x.category === b.name).reduce((s, x) => s + x.amount, 0);
      if (b.frequency === 'monthly' && (b.amount || 0) > 0 && paid > b.amount * 1.25) add('jump_' + b.id, 'med', tf('rf_billjump', b.name), tf('rf_billjump_d', fmt(paid), fmt(b.amount)), t('rf_act_bills'), gf('bills', rfIds('data-bill-row', [b.id])));
    }),
    () => {
      const o = (state.bills || []).filter(b => b.active !== false && !b.nextBillingDate);
      if (o.length) add('nodate', 'med', tf('rf_nodate', list(o.map(b => b.name))), t('rf_nodate_d'), t('rf_act_setdate'), gf('bills', rfIds('data-bill-row', o.map(b => b.id))));
    },
    () => { const subMo = totalSubMonthly(); if (planInc > 0 && subMo > planInc * 0.1) add('subs', 'med', t('rf_subs'), tf('rf_subs_d', fmt(subMo), Math.round(subMo / planInc * 100)), t('rf_act_bills'), gf('bills', '.lv-tag, .sub-row')); },
    // One large expense, spending above last period, a category above its usual.
    () => {
      const big = pTx.filter(x => x.type === 'expense' && planInc > 0 && x.amount > planInc * 0.2).sort((a, b) => b.amount - a.amount)[0];
      if (big) add('big', 'med', tf('rf_big', fmt(big.amount)), tf('rf_big_d', big.description || big.category, formatDateShort(big.date)), t('rf_act_view'), () => openTxSheet(big.id));
    },
    () => {
      let prev = null; try { prev = computePrevSummary(); } catch (e) { prev = null; }
      if (prev && prev.totalExpenses > 0 && f > 0.3) { const pace = sum.totalExpenses / f;
        if (pace > prev.totalExpenses * 1.25) add('spike', 'med', t('rf_spike'), tf('rf_spike_d', fmt(pace), fmt(prev.totalExpenses)), t('rf_act_budget'), gf('budget', '[data-mod-type="expenses"]')); }
    },
    () => {
      const from = toLocalISO(new Date(new Date(start + 'T00:00:00').getTime() - 91 * 86400000));
      const hist = {};
      txs.forEach(x => { if (x.type === 'expense' && x.date >= from && x.date < start) hist[x.category] = (hist[x.category] || 0) + x.amount; });
      const ups = Object.entries(act.expenses).filter(([c, v]) => !uncat.has(c) && hist[c] > 0 && v > 50 && v > (hist[c] / 3) * 1.5).sort((a, b) => b[1] - a[1]);
      if (ups.length) { const [c, v] = ups[0];
        add('trend', 'med', tf('rf_trend', c), tf('rf_trend_d', fmt(v), fmt(hist[c] / 3)), t('rf_act_tx'), toTx(pTx.filter(x => x.type === 'expense' && x.category === c).map(x => x.id))); }
    },
    // Data that looks wrong: duplicates, and entries dated in the future.
    () => {
      const seen = new Map(), dup = [];
      pTx.forEach(x => { const k = [x.date, x.type, x.category, x.amount].join('|'); if (seen.has(k)) dup.push([seen.get(k), x]); else seen.set(k, x); });
      if (dup.length) { const [a, b] = dup[0];
        add('dupe', 'med', tf('rf_dupe', b.description || b.category), tf('rf_dupe_d', fmt(b.amount), formatDateShort(b.date)), t('rf_act_tx'), toTx([a.id, b.id])); }
    },
    () => {
      const o = txs.filter(x => x.date > today).sort((a, b) => a.date.localeCompare(b.date));
      if (o.length) add('future', 'med', tf('rf_future', o.length), tf('rf_future_d', formatDateDisplay(o[0].date)), t('rf_act_tx'), toTx(o.map(x => x.id)));
    },
    // Keeping very little, and a period that has run out.
    () => { if (sum.totalIncome > 0 && f > 0.5 && (sum.totalIncome - sum.totalOut) < sum.totalIncome * 0.1) add('thin', 'high', t('rf_thin'), tf('rf_thin_d', Math.max(0, Math.round((sum.totalIncome - sum.totalOut) / sum.totalIncome * 100))), t('rf_act_budget'), gf('budget', '[data-mod-type="expenses"]')); },
    () => { if (end && today > end) add('ended', 'high', t('rf_ended'), tf('rf_ended_d', formatDateDisplay(end)), t('rf_act_period'), () => openPeriodPicker()); },
  ];
  checks.forEach(c => { try { c(); } catch (e) {} });
  const dis = S.flagDismiss || {};
  const live = flags.filter(x => dis[x.id] !== start);
  return { all: flags, live, dismissed: flags.length - live.length, checks: checks.length };
}
// What a heads-up means and how to put it right, in a pop-up of its own.
// The flag's own action sits at the foot, so reading leads straight to doing.
function openRfHelp(x) {
  const k = x.kind || x.id;
  const steps = String(t('rfh_' + k + '_f')).split(' | ').filter(Boolean);
  document.getElementById('modalTitle').textContent = x.title;
  document.getElementById('modalBody').innerHTML = `<div class="rfh rfh--${x.sev}">
    ${x.detail ? `<p class="rfh-detail">${esc(x.detail)}</p>` : ''}
    <h4 class="rfh-h">${t('rfh_what')}</h4>
    <p class="rfh-p">${esc(t('rfh_' + k + '_w'))}</p>
    <h4 class="rfh-h">${t('rfh_fix')}</h4>
    <ol class="rfh-steps">${steps.map(st => `<li>${esc(st)}</li>`).join('')}</ol>
    <div class="edit-tx-actions">
      ${x.act ? `<button class="btn btn-primary" type="button" id="rfhAct">${esc(x.act.label)}</button>` : ''}
      <button class="btn btn-ghost${x.act ? ' btn-sm' : ''}" type="button" id="rfhClose">${t('rfh_close')}</button>
    </div></div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  document.getElementById('rfhClose')?.addEventListener('click', closeModal);
  document.getElementById('rfhAct')?.addEventListener('click', () => { closeModal(); x.act.run(); });
}
// Which kinds are on show. Urgent is on and Worth a look off until the
// person says otherwise.
function rfShow() { const v = state.settings.rfShow || {}; return { high: v.high !== false, med: v.med === true }; }
// The top three from the Notifications list, with the same controls. The
// switches choose between what is urgent (needs attention now or due this
// week) and what is worth a look (worth knowing, or to tidy).
const HU_SHOW_MAX = 3;
const huBucket = i => (i.level === 'late' || i.level === 'soon') ? 'high' : 'med';
function headsUpCardItems() { return ntSorted(collectInbox().filter(i => !ntIgnored(i))); }
function redFlagsHtml(all) {
  all = all || [];
  const show = rfShow();
  const high = all.filter(x => huBucket(x) === 'high').length, med = all.length - high;
  const shown = all.filter(x => show[huBucket(x)]);
  const listed = shown.slice(0, HU_SHOW_MAX);
  const hidden = all.length - shown.length;
  const ico = all.length
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const tog = (k, label, count) => `<button class="hu-tog hu-tog--${k}${show[k] ? ' is-on' : ''}" type="button" role="switch" aria-checked="${show[k]}" data-rf-tog="${k}">
      <span class="hu-tog-track" aria-hidden="true"><i></i></span><span class="hu-tog-label">${esc(label)}</span><b>${count}</b></button>`;
  return `<section class="panel hu${all.length ? '' : ' is-clear'}"><div class="hu-inner">
    <header class="hu-head">
      <div class="hu-title"><span class="hu-ico" aria-hidden="true">${ico}</span><h3 class="ov-title">${t('rf_many')}</h3></div>
      <div class="hu-toggles" role="group" aria-label="${esc(t('rf_filter_label'))}">${tog('high', t('rf_urgent'), high)}${tog('med', t('rf_worth'), med)}</div>
    </header>
    <ol class="rf-list">${listed.map((x, i) => `<li class="rf-item rf-item--${huBucket(x)}" data-rf-id="${esc(x.id)}">
        <span class="rf-num">${i + 1}</span>
        <span class="rf-main"><span class="rf-t">${esc(x.title)}</span>${x.detail ? `<span class="rf-d">${esc(x.detail)}</span>` : ''}</span>
        <span class="rf-acts nt-acts">${ntActsHtml(x, 'rf')}</span>
      </li>`).join('')}${all.length ? '' : `<li class="rf-none"><span class="rf-none-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>${t('rf_none')}</li>`}</ol>
    ${hidden || all.length > listed.length ? `<div class="hu-foot">${hidden ? `<span>${tf('rf_filtered', hidden)}</span>` : '<span></span>'}${all.length > listed.length ? `<button class="link-btn hu-all" type="button" data-rf-all>${tf('hu_see_all', all.length)}</button>` : ''}</div>` : ''}
  </div></section>`;
}

// ── Statistics ───────────────────────────────────────────────────────────
function stKpi(label, value, sub, tone) {
  return `<div class="st-kpi${tone ? ' st-kpi--' + tone : ''}"><span class="st-k">${label}</span><strong>${value}</strong><em>${sub || '&nbsp;'}</em></div>`;
}
// Spend added up day by day, against a steady line to the plan and a dashed
// run on from today at the pace so far.
function stPaceChart(points, plan) {
  const w = 900, h = 190, pad = 14;
  const n = points.length;
  if (!n) return `<div class="chart-empty">${t('dash_no_spending')}</div>`;
  const p = nlDaysInPeriod();
  // Money moved to a goal is kept, not spent, as everywhere else here.
  const spent = x => (x.items || []).filter(i => i.type !== 'sinking_fund' && i.type !== 'savings').reduce((t, i) => t + i.amount, 0);
  let run = 0;
  const cum = points.map(x => (run += spent(x)));
  const upto = Math.min(n, p.dayOf);
  const avg = upto > 0 ? cum[upto - 1] / upto : 0;
  const proj = avg * n;
  const top = Math.max(plan, proj, cum[n - 1], 1) * 1.08;
  const X = i => pad + (n > 1 ? i / (n - 1) : 0) * (w - pad * 2);
  const Y = v => h - pad - v / top * (h - pad * 2);
  const actual = cum.slice(0, upto).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' L');
  const area = upto ? `M${X(0).toFixed(1)},${Y(0).toFixed(1)} L${actual} L${X(upto - 1).toFixed(1)},${Y(0).toFixed(1)} Z` : '';
  return `<div class="st-chart-wrap"><svg class="st-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(t('st_pace'))}">
    <defs><linearGradient id="stPaceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--grad-indigo);stop-opacity:.32"/><stop offset="100%" style="stop-color:var(--grad-indigo);stop-opacity:0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map(g => `<line x1="${pad}" x2="${w - pad}" y1="${(pad + g * (h - pad * 2)).toFixed(1)}" y2="${(pad + g * (h - pad * 2)).toFixed(1)}" class="st-grid"/>`).join('')}
    ${plan > 0 ? `<path d="M${X(0)},${Y(0)} L${X(n - 1)},${Y(plan)}" class="st-plan" vector-effect="non-scaling-stroke"/>` : ''}
    ${area ? `<path d="${area}" fill="url(#stPaceFill)"/><path d="M${actual}" class="st-actual" vector-effect="non-scaling-stroke"/>` : ''}
    ${upto && upto < n ? `<path d="M${X(upto - 1)},${Y(cum[upto - 1])} L${X(n - 1)},${Y(proj)}" class="st-proj" vector-effect="non-scaling-stroke"/>` : ''}
  </svg></div>
  <div class="st-legend"><span><i class="st-sw st-sw--actual"></i>${t('st_spent')} ${fmt(upto ? cum[upto - 1] : 0)}</span>${plan > 0 ? `<span><i class="st-sw st-sw--plan"></i>${t('st_plan')} ${fmt(plan)}</span>` : ''}<span><i class="st-sw st-sw--proj"></i>${t('st_proj')} ${fmt(proj)}</span></div>`;
}
// Six calendar months of what came in against what went out.
function stMonthsChart() {
  const now = new Date(), lang = 'en';
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({ key: toLocalISO(d).slice(0, 7), label: d.toLocaleString(lang, { month: 'short' }).replace('.', ''), inn: 0, out: 0 });
  }
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  (state.transactions || []).forEach(x => {
    const i = idx[String(x.date).slice(0, 7)];
    if (i === undefined) return;
    if (x.type === 'income') months[i].inn += x.amount;
    else if (x.type !== 'sinking_fund' && x.type !== 'savings') months[i].out += x.amount;
  });
  const top = Math.max(1, ...months.map(m => Math.max(m.inn, m.out)));
  return `<div class="st-bars">${months.map(m => `<div class="st-bar-col" title="${esc(m.label)}: ${esc(t('psf_in'))} ${esc(fmt(m.inn))}, ${esc(t('psf_out'))} ${esc(fmt(m.out))}">
      <div class="st-bar-pair"><span class="st-bar st-bar--in" style="height:${(m.inn / top * 100).toFixed(1)}%"></span><span class="st-bar st-bar--out" style="height:${(m.out / top * 100).toFixed(1)}%"></span></div>
      <span class="st-bar-lbl">${esc(m.label)}</span></div>`).join('')}</div>
    <div class="st-legend"><span><i class="st-sw st-sw--in"></i>${t('psf_in')}</span><span><i class="st-sw st-sw--out"></i>${t('psf_out')}</span></div>`;
}
// Which days of the week the money goes, over the last 90 days.
function stWeekdayChart() {
  const from = toLocalISO(new Date(Date.now() - 90 * 86400000));
  const tot = [0, 0, 0, 0, 0, 0, 0];
  (state.transactions || []).forEach(x => {
    if (x.type === 'income' || x.type === 'sinking_fund' || x.type === 'savings' || x.date < from) return;
    tot[(new Date(x.date + 'T00:00:00').getDay() + 6) % 7] += x.amount;
  });
  const top = Math.max(1, ...tot), max = tot.indexOf(Math.max(...tot));
  const lang = 'en';
  let f; try { f = new Intl.DateTimeFormat(lang, { weekday: 'short' }); } catch (e) { f = new Intl.DateTimeFormat('en', { weekday: 'short' }); }
  return `<div class="st-bars st-bars--week">${tot.map((v, i) => `<div class="st-bar-col" title="${esc(f.format(new Date(2024, 0, 1 + i)))}: ${esc(fmt(v))}">
    <div class="st-bar-pair"><span class="st-bar st-bar--wk${i === max && v > 0 ? ' is-max' : ''}" style="height:${(v / top * 100).toFixed(1)}%"></span></div>
    <span class="st-bar-lbl">${esc(f.format(new Date(2024, 0, 1 + i)))}</span></div>`).join('')}</div>`;
}
// Each everyday category against its budget, the budget as a tick.
function stCategoryChart(act) {
  const rows = (state.budgets.expenses || []).map(r => ({ name: r.category, plan: r.expected || 0, spent: act.expenses[r.category] || 0 }))
    .filter(r => r.plan > 0 || r.spent > 0).sort((a, b) => Math.max(b.plan, b.spent) - Math.max(a.plan, a.spent)).slice(0, 8);
  if (!rows.length) return `<div class="chart-empty">${t('dash_no_spending')}</div>`;
  const top = Math.max(1, ...rows.map(r => Math.max(r.plan, r.spent)));
  return `<div class="st-cats">${rows.map(r => {
    const over = r.plan > 0 && r.spent > r.plan;
    return `<div class="st-cat"><div class="st-cat-top"><span>${esc(r.name)}</span><b class="${over ? 'is-over' : ''}">${fmt(r.spent)}<small> / ${fmt(r.plan)}</small></b></div>
      <div class="st-cat-track"><i class="${over ? 'is-over' : ''}" style="width:${(r.spent / top * 100).toFixed(1)}%"></i>${r.plan > 0 ? `<em style="left:${(r.plan / top * 100).toFixed(1)}%"></em>` : ''}</div></div>`;
  }).join('')}</div>`;
}
function dashStatsHtml(o) {
  const { act, sum, spendPoints, expOut, spendSegs, cashGridHtml, bottomRowHtml, allocHtml } = o;
  const p = nlDaysInPeriod();
  const elapsed = Math.max(1, Math.min(p.total, p.dayOf));
  const avg = sum.totalOut / elapsed;
  const proj = avg * p.total;
  const kept = sum.totalIncome - sum.totalOut;
  const rate = sum.totalIncome > 0 ? Math.round(kept / sum.totalIncome * 100) : 0;
  const topCat = spendSegs[0];
  return `<div class="st-kpis">
      ${stKpi(t('st_rate'), `${rate}%`, tf('st_rate_d', fmt(Math.max(0, kept))), rate >= 20 ? 'good' : rate < 0 ? 'bad' : '')}
      ${stKpi(t('st_avg'), fmt(avg), tf('st_avg_d', elapsed))}
      ${stKpi(t('st_projected'), fmt(proj), expOut > 0 ? tf('st_projected_d', fmt(expOut)) : '', expOut > 0 && proj > expOut ? 'bad' : 'good')}
      ${stKpi(t('st_top'), topCat ? esc(topCat.label) : '–', topCat ? tf('st_top_d', fmt(topCat.value), sum.totalOut > 0 ? Math.round(topCat.value / sum.totalOut * 100) : 0) : '')}
    </div>
    <div class="panel st-panel"><div class="panel-inner-sm"><div class="panel-titlebar"><span class="panel-title-sm">${t('st_pace')}</span></div>${stPaceChart(spendPoints, expOut)}</div></div>
    <div class="st-row">
      <div class="panel st-panel"><div class="panel-inner-sm"><div class="panel-titlebar"><span class="panel-title-sm">${t('st_months')}</span></div>${stMonthsChart()}</div></div>
      <div class="panel st-panel"><div class="panel-inner-sm"><div class="panel-titlebar"><span class="panel-title-sm">${t('st_week')}</span></div>${stWeekdayChart()}</div></div>
    </div>
    <div class="panel st-panel"><div class="panel-inner-sm"><div class="panel-titlebar"><span class="panel-title-sm">${t('st_cats')}</span></div>${stCategoryChart(act)}</div></div>
    ${cashGridHtml}
    ${allocHtml}
    ${bottomRowHtml}`;
}

// ── Wiring for both views ────────────────────────────────────────────────
function wireDashViews(el, rf) {
  el.querySelectorAll('[data-dash-view]').forEach(b => b.addEventListener('click', () => {
    if (dashView() === b.dataset.dashView) return;
    state.settings.dashView = b.dataset.dashView; saveState(); _dashEntering = true; renderDashboard();
  }));
  el.querySelectorAll('[data-spend-curve]').forEach(b => b.addEventListener('click', () => {
    state.settings.spendCurve = b.dataset.spendCurve === '1'; saveState(); dashQuietNext(); renderDashboard();
    if (!ddDashOff()) spendRise(document.querySelector('#bview-dashboard .spend-line-wrap'));
  }));
  el.querySelectorAll('[data-ra-menu]').forEach(b => b.addEventListener('click', () => openTxSheet(b.dataset.raMenu)));
  el.querySelectorAll('[data-ra-edit]').forEach(b => b.addEventListener('click', () => raEdit(b.dataset.raEdit)));
  el.querySelector('[data-ra-add]')?.addEventListener('click', () => openQuickAddTx());
  el.querySelector('#raUndoBtn')?.addEventListener('click', raUndo);
  const huFind = id => (rf || []).find(f => f.id === id);
  const huAfter = () => { if (currentTab === 'dashboard') renderDashboard(); };
  el.querySelectorAll('[data-rf-act]').forEach(b => b.addEventListener('click', () => {
    const x = huFind(b.dataset.rfAct);
    if (x && x.act) x.act.run(huAfter);
  }));
  el.querySelectorAll('[data-rf-help]').forEach(b => b.addEventListener('click', () => {
    const x = huFind(b.dataset.rfHelp);
    if (x) ntOpenHelp(x, huAfter);
  }));
  el.querySelectorAll('[data-rf-ignore]').forEach(b => b.addEventListener('click', () => {
    const x = huFind(b.dataset.rfIgnore);
    if (!x) return;
    state.settings.ntIgnore = { ...(state.settings.ntIgnore || {}), [ntKey(x)]: true };
    saveState(); dashQuietNext(); renderDashboard(); queueNavBadges();
    showToast(t('nt_ignored_toast'));
  }));
  el.querySelectorAll('[data-rf-go]').forEach(b => b.addEventListener('click', () => {
    const x = huFind(b.dataset.rfGo);
    if (x) ntGo(x);
  }));
  el.querySelectorAll('[data-rf-tog]').forEach(b => b.addEventListener('click', () => {
    const v = rfShow(); v[b.dataset.rfTog] = !v[b.dataset.rfTog];
    state.settings.rfShow = v; saveState(); dashQuietNext(); renderDashboard();
  }));
  el.querySelector('[data-rf-all]')?.addEventListener('click', () => switchTab('notifications'));
}


// ── The dashboard after an action ────────────────────────────────────────
// Switching to the dashboard plays its entrance. Any redraw while it is
// already on screen is the result of something just done, so it redraws
// quietly and animates only what that changed.
let _dashEntering = true;
function dashSnapshot(el) {
  if (!el || !el.childElementCount) return null;
  const today = toLocalISO(new Date());
  const v = el.querySelector('.leftover-value');
  const dot = el.querySelector(`.spend-line-dot[data-label="${today}"]`);
  return {
    free: v ? parseFloat(v.dataset.nlValue) : null,
    nums: [...el.querySelectorAll('.psf-tile strong[data-v], .nl-pill strong[data-v]')].map(x => parseFloat(x.dataset.v)),
    ra: [...el.querySelectorAll('.ra-row[data-ra-id]')].map(x => x.dataset.raId),
    gp: Object.fromEntries([...el.querySelectorAll('.gp-row[data-gp-id]')].map(x => [x.dataset.gpId, parseFloat(x.dataset.pct)])),
    rf: [...el.querySelectorAll('.rf-item[data-rf-id]')].map(x => x.dataset.rfId),
    rfc: [...el.querySelectorAll('.hu-tog b')].map(x => x.textContent),
    today: dot ? parseFloat(dot.dataset.val) : null
  };
}
function animateDashDiff(el, prev) {
  if (!prev || !el || ddDashOff()) return;
  const moved = (a, b) => a != null && b != null && Math.abs(a - b) > 0.004;
  // Free to spend counts to its new value and glows the way it went.
  const v = el.querySelector('.leftover-value');
  const free = v ? parseFloat(v.dataset.nlValue) : null;
  if (moved(prev.free, free) && !payPending()) {
    ddCount(v, prev.free, free, x => (x < 0 ? '\u2212' : '') + nlAmountHtml(Math.abs(x)), 950);
    ddPulse(v, free > prev.free ? 'dd-up' : 'dd-down', 1400);
  }
  // In, out, kept and today's figures.
  [...el.querySelectorAll('.psf-tile strong[data-v], .nl-pill strong[data-v]')].forEach((node, i) => {
    const a = prev.nums[i], b = parseFloat(node.dataset.v);
    if (!moved(a, b)) return;
    ddCount(node, a, b, x => (x < 0 ? '\u2212' : '') + fmt(Math.abs(x)), 800);
    ddPulse(node.closest('.psf-tile, .nl-pill'), 'dd-tile', 1200);
  });
  // A new transaction slides into Recent activity.
  el.querySelectorAll('.ra-row[data-ra-id]').forEach(r => { if (!prev.ra.includes(r.dataset.raId)) ddPulse(r, 'dd-new', 1400); });
  // A goal's ring sweeps from where it was to where it is.
  el.querySelectorAll('.gp-row[data-gp-id]').forEach(r => {
    const a = prev.gp[r.dataset.gpId], b = parseFloat(r.dataset.pct);
    if (a == null || Math.abs(a - b) < 0.05) return;
    const arc = r.querySelectorAll('.gp-ring circle')[1];
    if (arc) {
      const c = 2 * Math.PI * 19, to = arc.getAttribute('stroke-dasharray');
      arc.style.transition = 'none'; arc.style.strokeDasharray = `${(Math.max(0, Math.min(100, a)) / 100 * c).toFixed(1)} ${c.toFixed(1)}`;
      void arc.getBoundingClientRect();
      requestAnimationFrame(() => { arc.style.transition = 'stroke-dasharray .95s cubic-bezier(.2,.8,.2,1)'; arc.style.strokeDasharray = to; });
    }
    const label = r.querySelector('.gp-ringwrap b');
    if (label && label.textContent) ddCount(label, a, b, x => Math.round(x) + '%', 950);
    ddPulse(r, 'dd-tile', 1200);
  });
  // Red flags: the count pops when it changes, a new flag slides in.
  const cur = [...el.querySelectorAll('.rf-item[data-rf-id]')].map(x => x.dataset.rfId);
  el.querySelectorAll('.hu-tog b').forEach((b, i) => { if (prev.rfc && prev.rfc[i] !== undefined && prev.rfc[i] !== b.textContent) ddPulse(b, 'dd-pop', 700); });
  el.querySelectorAll('.rf-item[data-rf-id]').forEach(r => { if (!prev.rf.includes(r.dataset.rfId)) ddPulse(r, 'dd-new', 1400); });
  // Today's point on the chart pings when today's spending moved.
  const today = toLocalISO(new Date());
  const dot = el.querySelector(`.spend-line-dot[data-label="${today}"]`);
  if (dot && moved(prev.today, parseFloat(dot.dataset.val))) ddPulse(dot, 'dd-ping', 2400);
}
// ── A bill or debt paid from the dashboard ──────────────────────────────
// It moves the way spending does: the figure counts down by what was paid
// under the same red glow, then counts back to where it was, because that
// money had already been set aside. Paying more than was owed comes back
// only as far as the new figure. The line underneath says which it was.
// With motion off only the line is shown.
let _lastPay = null;
function payPending() { return !!_lastPay && Date.now() - _lastPay.at < 4000; }
function dashPaySettle(el, prev) {
  const lp = _lastPay;
  if (!lp || !el) return;
  const v = el.querySelector('.nl-hero .leftover-value');
  if (!v) return;
  _lastPay = null;
  // Paid elsewhere a while ago: just the line, the next time the dashboard shows.
  if (Date.now() - lp.at > 5 * 60 * 1000) return;
  const extra = payRound2(lp.amt - lp.owe);
  const over = extra > 0.005, part = lp.amt < lp.owe - 0.005;
  settleCaption(el, over ? tf('pay_settled_over', lp.label, fmt(extra))
    : part ? tf('pay_settled_part', lp.label, fmt(lp.amt), fmt(lp.expected || lp.owe))
    : tf('pay_settled', lp.label, fmt(lp.amt)));
  if (!prev || prev.free == null || ddDashOff() || Date.now() - lp.at > 4000) return;
  const before = prev.free, after = parseFloat(v.dataset.nlValue), low = before - lp.amt;
  if (isNaN(after)) return;
  const render = x => (x < 0 ? '\u2212' : '') + nlAmountHtml(Math.abs(x));
  ddPulse(v, 'dd-down', 1400);
  ddCount(v, before, low, render, 550);
  setTimeout(() => { if (v.isConnected) ddCount(v, low, after, render, 700); }, 680);
}
// The line under the figure says what happened for a few seconds, then the
// usual rate comes back.
function settleCaption(el, text) {
  const left = el.querySelector('.nl-hero .nl-left');
  if (!left) return;
  let sub = left.querySelector('.nl-sub');
  const had = !!sub, before = sub ? sub.innerHTML : '';
  if (!sub) { sub = document.createElement('div'); sub.className = 'nl-sub'; left.querySelector('.leftover-value')?.after(sub); }
  sub.textContent = text;
  sub.classList.remove('is-settle-out'); sub.classList.add('is-settle-cap');
  clearTimeout(sub._settle);
  sub._settle = setTimeout(() => {
    sub.classList.add('is-settle-out');
    setTimeout(() => {
      if (!sub.isConnected) return;
      sub.classList.remove('is-settle-cap', 'is-settle-out');
      if (had) sub.innerHTML = before; else sub.remove();
    }, 300);
  }, 3200);
}
// The statistics view draws itself in: bars grow, the pace line draws.
function animateStatsIn(el) {
  if (ddDashOff() || !el.querySelector('.st-kpis')) return;
  const grow = [...el.querySelectorAll('.st-bar')], widen = [...el.querySelectorAll('.st-cat-track i')];
  const hs = grow.map(b => b.style.height), ws = widen.map(b => b.style.width);
  grow.forEach(b => { b.style.transition = 'none'; b.style.height = '0%'; });
  widen.forEach(b => { b.style.transition = 'none'; b.style.width = '0%'; });
  void el.offsetWidth;
  requestAnimationFrame(() => {
    grow.forEach((b, i) => { b.style.transition = `height .7s cubic-bezier(.2,.8,.2,1) ${Math.min(i * 30, 360)}ms`; b.style.height = hs[i]; });
    widen.forEach((b, i) => { b.style.transition = `width .8s cubic-bezier(.2,.8,.2,1) ${Math.min(i * 50, 400)}ms`; b.style.width = ws[i]; });
  });
  el.querySelectorAll('.st-actual, .st-proj, .st-plan').forEach(pth => ddPulse(pth, 'dd-draw', 1400));
}

function renderDashboardLayout3() {
  // Classic first: every card, already wired, with its own listeners intact.
  renderDashboardLayout1();

  const el = document.getElementById('bview-dashboard');
  const head = el?.querySelector('.section-header');
  if (!head) return;

  const wrap = document.createElement('header');
  wrap.className = 'sleek-head';
  wrap.innerHTML = `
    <div class="sleek-head-top">
      <div class="sleek-hello">
        <p class="sleek-eyebrow">${esc(sleekDateLine())}</p>
        <h2 class="sleek-greeting section-title">${appIconSvg('dashboard')} ${esc(sleekGreeting())}</h2>
      </div>
      <div class="sleek-actions"></div>
    </div>`;

  // The controls are MOVED out of the old heading, not rebuilt, so the
  // period bar, the Add button and the help icon keep the listeners
  // renderDashboardLayout1 just gave them.
  const actions = wrap.querySelector('.sleek-actions');
  head.querySelectorAll(':scope > *').forEach(node => {
    if (node.classList.contains('section-title')) return;   // the greeting replaces it
    actions.appendChild(node);
  });
  head.replaceWith(wrap);

  // The dashboard already answers all of this below, in the Cash Flow panel
  // and the hero: a band repeating it just made the screen busier.
  // "+ Add" is the generic word the heading row uses; here the button has
  // room to say what it actually logs.
  const logBtn = el.querySelector('#dashLogBtn');
  if (logBtn) logBtn.textContent = t('dash_spend_btn');
}

function renderDashboardLayout1() {
  const quiet=takeDashQuiet();
  const act=computeActuals(),sum=computeSummary(act),result=runDebtPayoff(),subMo=totalSubMonthly();
  const expInc=state.budgets.income.reduce((t,r)=>t+(r.expected||0),0);
  const expExp=state.budgets.expenses.reduce((t,r)=>t+(r.expected||0),0);
  const expBil=(state.bills||[]).filter(r=>r.active!==false&&r.kind!=='subscription').reduce((t,r)=>t+monthlySubAmt(r),0);
  const expSav=(state.sinkingFunds||[]).reduce((t,f)=>t+(calcFund(f).requiredMonthly||0),0);
  const expDebt=state.debts.reduce((s,d)=>s+totalMonthlyDebtCost(d),0);
  const expOut=expExp+expBil+expDebt+subMo,leftColor=sum.leftover>=0?'#10b981':'#f43f5e';
  const upcomingDays=state.settings?.upcomingDays||30;
  const upcoming=getUpcomingEvents(upcomingDays,act);
  const incSegs=assignSegColors(state.budgets.income.map((r,i)=>({label:r.category,value:act.income[r.category]||0,color:COLORS[i%COLORS.length]})).filter(s=>s.value>0).sort((a,b)=>b.value-a.value), COLORS);
  const incTot=incSegs.reduce((t,s)=>t+s.value,0);
  const spendSegs=assignSegColors([
    ...state.budgets.expenses.map(r=>({label:r.category,value:act.expenses[r.category]||0})),
    ...(state.bills||[]).map(r=>({label:r.name,value:act.bills[r.name]||0})),
    ...Object.entries(act.debt||{}).map(([name,val])=>({label:name,value:val})),
  ].filter(s=>s.value>0).sort((a,b)=>b.value-a.value), COLORS);
  const spTot=spendSegs.reduce((t,s)=>t+s.value,0);
  const flowRows=[
    {label:t('bud_section_income'),  exp:expInc, act:sum.totalIncome,          color:'#10b981',isInc:true},
    {label:t('bud_section_expenses'),exp:expExp, act:sum.totalExpenses,        color:'#ec4899',isInc:false},
    {label:t('bud_section_bills'),   exp:expBil, act:sum.totalBills,           color:'#fb923c',isInc:false},
    {label:t('bud_section_savings'), exp:expSav, act:sum.totalSavings,         color:'#3b82f6',isInc:false},
    {label:t('dash_debt_payments'),  exp:expDebt,act:sum.totalDebt||0,         color:'#a855f7',isInc:false},
    {label:t('dash_subscriptions'),  exp:subMo,  act:sum.totalSubscriptions||0,color:'#10b981',isInc:false},
  ];
  const spendPoints=computeDailySpendPoints();
  const spendLineTotal=spendPoints.reduce((s,p)=>s+p.value,0);

  const el=document.getElementById('bview-dashboard');
  const isCurrentRender=markRenderGen(el);
  const cashGridHtml=`    <div class="dashboard-grid" style="margin-bottom:16px">
      <div class="panel cash-flow-panel"><div class="panel-inner-sm">
        <div class="panel-titlebar"><span class="panel-title-sm">${t('dash_cash_flow')}</span><div class="flow-legend"><span class="legend-item"><span class="legend-dot" style="background:rgba(30,27,46,.22)"></span>${t('dash_expected_legend')}</span><span class="legend-item"><span class="legend-dot" style="background:#6366f1"></span>${t('dash_actual_legend')}</span></div></div>
        <div class="flow-table">${flowRows.map(row=>{const pct=row.exp>0?(row.act/row.exp*100):(row.act>0?100:0),aw=Math.min(100,pct).toFixed(1),over=!row.isInc&&row.act>row.exp&&row.exp>0;return`<div class="flow-row"><div class="flow-row-top"><span class="flow-label">${esc(row.label)}</span><span class="flow-amounts"><span style="color:${over?'#f43f5e':row.color}">${fmt(row.act)}</span><span class="flow-amt--exp"> / ${fmt(row.exp)}</span></span></div><div class="flow-bars"><div class="flow-bar-wrap"><div class="flow-bar" style="width:${aw}%;background:${over?'#f43f5e':row.color}"></div></div></div></div>`;}).join('')}</div>
      </div></div>
      <div class="charts-col">
        <div class="panel chart-panel"><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('dash_income_sources')}</div>${incSegs.length===0?`<div class="chart-empty">${t('dash_no_income')}</div>`:`<div class="donut-block">${svgDonut(incSegs.map(s=>({...s,pct:incTot>0?s.value/incTot*100:0})),110,16)}<div class="donut-legend">${incSegs.slice(0,5).map((s,idx)=>`<div class="dleg-row" data-idx="${idx}"><span class="dleg-swatch" style="background:${s.color}"></span><span class="dleg-label">${esc(s.label)}</span><span class="dleg-pct">${(incTot>0?s.value/incTot*100:0).toFixed(0)}%</span></div>`).join('')}</div></div>`}</div></div>
        <div class="panel chart-panel"><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('dash_spending_breakdown')}</div>${spendSegs.length===0?`<div class="chart-empty">${t('dash_no_spending')}</div>`:`<div class="donut-block">${svgDonut(spendSegs.map(s=>({...s,pct:spTot>0?s.value/spTot*100:0})).slice(0,50),110,16)}<div class="donut-legend">${spendSegs.slice(0,5).map((s,idx)=>`<div class="dleg-row" data-idx="${idx}"><span class="dleg-swatch" style="background:${s.color}"></span><span class="dleg-label">${esc(s.label)}</span><span class="dleg-pct">${(spTot>0?s.value/spTot*100:0).toFixed(0)}%</span></div>`).join('')}</div></div>`}</div></div>
      </div>
    </div>`;
  const allocHtml=(()=>{
      if (!state.allocation?.enabled) return '';
      const {totals, untagged} = computeAllocation();
      const income = sum.totalIncome > 0 ? sum.totalIncome : expInc;
      const buckets = state.allocation.buckets || [];
      if (income <= 0 && Object.values(totals).every(v=>v===0)) return '';
      const pctOf = v => income > 0 ? (v / income * 100) : 0;
      const cards = buckets.map((b, bi) => {
        const actual = totals[b.id] || 0;
        const ap = pctOf(actual);
        const tp = b.pct;
        const fill = tp > 0 ? Math.min(ap / tp * 100, 100) : 0;
        const {accentColor, statusColor, statusKey, statusIcon} = allocBucketStatus(b, ap, tp);
        const displayName = getAllocBucketDisplayName(b);
        return `<div class="alloc-card" style="--bc:${b.color || ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4'][bi % 5]}"><div class="alloc-card-header"><span class="alloc-card-name">${esc(displayName)}</span><span class="alloc-target-badge">${t('alloc_target')} ${tp}%</span></div><div class="alloc-pct-big" style="color:${accentColor}">${ap.toFixed(1)}%</div><div class="alloc-amount">${fmt(actual)}</div><div class="alloc-bar-row"><div class="alloc-strip-wrap"><div class="alloc-strip" style="width:${fill}%;background:${accentColor}"></div></div><span class="alloc-fill-pct" style="color:${accentColor}">${Math.round(fill)}%</span></div><div class="alloc-status" style="color:${statusColor}"><span class="alloc-status-icon">${statusIcon}</span> ${t(statusKey)}</div></div>`;
      }).join('');
      const untaggedLine = untagged > 0 ? `<div class="alloc-untagged">⚠ ${fmt(untagged)} ${t('alloc_untagged_desc')}</div>` : '';
      return `<div class="panel alloc-panel"><div class="panel-inner-sm"><div class="alloc-header"><span class="panel-title-sm">${t('alloc_title')}</span><span class="alloc-income-base">${t('alloc_based_on')} ${fmt(income)} ${t('alloc_income_period')}</span></div><div class="alloc-grid">${cards}</div>${untaggedLine}</div></div>`;
    })();
  const bottomRowHtml=`    <div class="pro-bottom-row">
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">${appIconSvg('debt')} ${t('tab_debt')}</div>
        ${state.debts.length===0?`<div class="chart-empty">${t('dash_no_debts')}<br><button class="link-btn" data-btab="debt">${t('dash_set_up')}</button></div>`:result?`<div class="debt-teaser"><div class="dt-item"><span class="dt-label">${t('dash_debt_free_label')}</span><span class="dt-value">${formatDateDisplay(result.debtFreeDate)}</span></div><div class="dt-item"><span class="dt-label">${t('dash_interest_label')}</span><span class="dt-value" style="color:#f43f5e">${fmt(result.totalInterest)}</span></div><div class="dt-item"><span class="dt-label">${t('dash_months_label')}</span><span class="dt-value">${result.months}</span></div><div class="dt-item"><span class="dt-label">${t('dash_method_label')}</span><span class="dt-value">${state.debtSettings.method==='snowball'?'⛄ Snowball':'🌊 Avalanche'}</span></div></div>${(()=>{const dp=act.debt||{},paid=state.debts.filter(d=>(dp[d.name]||0)>=(d.minimumPayment||0)&&d.minimumPayment>0).length,total=state.debts.filter(d=>d.minimumPayment>0).length;return total>0?`<div style="margin-top:7px;font-size:11px;color:${paid===total?'#10b981':'#fb923c'};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${paid} ${t('dash_of')} ${total} ${total===1?t('dash_debts_paid'):t('dash_debts_paid_many')}</div>`:'';})()}`:`<div class="chart-empty">${t('dash_set_balances')}</div>`}
      </div></div>
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">${appIconSvg('sinking')} ${t('tab_sinking')}</div>
        ${state.sinkingFunds.length===0?`<div class="chart-empty">${t('dash_no_sinking')}<br><button class="link-btn" data-btab="goals">${t('dash_create_one')}</button></div>`:`<div class="sf-snap">${state.sinkingFunds.slice(0,4).map(f=>{const p=f.targetAmount>0?Math.min(100,Math.round((f.currentSaved||0)/f.targetAmount*100)):0;return`<div class="sf-snap-item"><div class="sf-snap-header"><span>${esc(f.icon||'🏺')} ${esc(f.name)}</span><span class="sf-snap-pct">${p}%</span></div><div class="prog-bar-wrap"><div class="prog-bar prog-bar--income" style="width:${p}%"></div></div><div style="font-size:11px;color:var(--text-faint);margin-top:2px;display:flex;justify-content:space-between">${fmt(f.currentSaved||0)} / ${fmt(f.targetAmount||0)}</div></div>`;}).join('')}</div>`}
      </div></div>
    </div>`;
  const view=dashView();
  const rf=view!=='stats'?headsUpCardItems():null;
  el.innerHTML=`
    <div class="section-header section-header--period">
      <h2 class="section-title">${appIconSvg('dashboard')} ${t('tab_dashboard')}</h2>
      ${periodBarHtml()}
      ${dashLogControlsHtml()}
      ${dashViewToggleHtml()}
      ${helpBtn('dashboard')}
    </div>
    ${dashFabHtml()}
    ${view==='stats'
      ? dashStatsHtml({act,sum,spendPoints,expOut,spendSegs,cashGridHtml,bottomRowHtml,allocHtml})
      : view==='calm' && typeof calmDashHtml==='function' ? calmDashHtml(sum, subMo, rf)
      : `${nlHeroHtml(sum.leftover, { income: sum.totalIncome, subsMonthly: subMo })}
    ${spendPanelHtml(spendPoints)}
    <div class="ov-grid"><div class="ov-col">${periodSoFarHtml(sum, spendSegs)}${typeof toolOn!=='function'||toolOn('goals')||(state.sinkingFunds||[]).length?goalProgressHtml():''}${typeof chDashHtml === 'function' && (typeof toolOn!=='function'||toolOn('challenges')) ? chDashHtml() : ''}</div>${recentActivityHtml()}</div>
    ${allocHtml}
    ${redFlagsHtml(rf)}`}`;
  wireDashViews(el, rf);
  wirePeriodBar(el);
  wireNlHero(el);
  wireDashLog(el);
  wireComingUp(el);
  if (typeof wireCalmDash === 'function') wireCalmDash(el);
  requestAnimationFrame(()=>{
    if (!isCurrentRender()) return;
    initDonuts(el);
    wireChartHover(el, '.spend-line-dot', { format: d =>
      formatSpendTooltipHtml(spendPoints[parseInt(d.idx, 10)] || { label: d.label, value: parseFloat(d.val) || 0, items: [] },
        { typeLabel: spendTypeLabel, typeColor: spendTypeColor, moreText: n => tf('spend_tip_more', n) }) });
    const nlFree = nlHeroTarget(el);
    if (!quiet) animateDashboardEntrance(el, [
      { el: el.querySelector('.leftover-value'), target: Math.abs(nlFree), html: true,
        render: v => (nlFree < 0 ? '\u2212' : '') + nlAmountHtml(v) }
    ]);
  });
  el.querySelectorAll('[data-btab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

// ── Layout 2: "Radial Pulse" - KPI-cockpit feel ─────────────────────────
function renderDashboardLayout2() {
  const quiet=takeDashQuiet();
  const act=computeActuals(),sum=computeSummary(act),result=runDebtPayoff(),subMo=totalSubMonthly();
  const expInc=state.budgets.income.reduce((t,r)=>t+(r.expected||0),0);
  const expExp=state.budgets.expenses.reduce((t,r)=>t+(r.expected||0),0);
  const expBil=(state.bills||[]).filter(r=>r.active!==false&&r.kind!=='subscription').reduce((t,r)=>t+monthlySubAmt(r),0);
  const expSav=(state.sinkingFunds||[]).reduce((t,f)=>t+(calcFund(f).requiredMonthly||0),0);
  const expDebt=state.debts.reduce((s,d)=>s+totalMonthlyDebtCost(d),0);
  const expOut=expExp+expBil+expDebt+subMo,leftColor=sum.leftover>=0?'#10b981':'#f43f5e';
  const upcomingDays=state.settings?.upcomingDays||30;
  const upcoming=getUpcomingEvents(upcomingDays,act);
  const incSegs=assignSegColors(state.budgets.income.map((r,i)=>({label:r.category,value:act.income[r.category]||0,color:COLORS[i%COLORS.length]})).filter(s=>s.value>0).sort((a,b)=>b.value-a.value), COLORS);
  const incTot=incSegs.reduce((t,s)=>t+s.value,0);
  const spendSegs=assignSegColors([
    ...state.budgets.expenses.map(r=>({label:r.category,value:act.expenses[r.category]||0})),
    ...(state.bills||[]).map(r=>({label:r.name,value:act.bills[r.name]||0})),
    ...Object.entries(act.debt||{}).map(([name,val])=>({label:name,value:val})),
  ].filter(s=>s.value>0).sort((a,b)=>b.value-a.value), COLORS);
  const spTot=spendSegs.reduce((t,s)=>t+s.value,0);

  const gaugePct = sum.totalIncome>0 ? Math.max(0,Math.min(100, sum.leftover/sum.totalIncome*100)) : 0;
  const rings=[
    {label:t('bud_section_expenses'),value:sum.totalExpenses,expected:expExp,color:'#ec4899'},
    {label:t('bud_section_bills'),   value:sum.totalBills,   expected:expBil,color:'#fb923c'},
    {label:t('dash_debt_payments'),  value:sum.totalDebt||0, expected:expDebt,color:'#a855f7'},
    {label:t('bud_section_savings'), value:sum.totalSavings, expected:expSav,color:'#3b82f6'},
    {label:t('dash_subscriptions'),  value:sum.totalSubscriptions||0, expected:subMo,color:'#10b981'}
  ];
  const spendPoints=computeDailySpendPoints();
  const spendLineTotal=spendPoints.reduce((s,p)=>s+p.value,0);

  const allocHtml = (() => {
    if (!state.allocation?.enabled) return '';
    const {totals} = computeAllocation();
    const income = sum.totalIncome > 0 ? sum.totalIncome : expInc;
    const buckets = state.allocation.buckets || [];
    if (income <= 0 && Object.values(totals).every(v=>v===0)) return '';
    // Same over/nearing/under classification as the Classic layout's
    // allocation cards (computeAllocation-derived), so both layouts agree
    // on what counts as "over budget" for a bucket.
    const pctOf = v => income > 0 ? (v / income * 100) : 0;
    const tiles = buckets.map(b => {
      const actual = totals[b.id] || 0;
      const ap = pctOf(actual);
      const tp = b.pct;
      // Fill = progress toward the target (100% = "at target"), capped so
      // the ring itself never needs to exceed a full sweep - going over is
      // instead conveyed by colour + the status line below, not by an
      // ever-growing arc.
      const fill = tp > 0 ? Math.min(ap / tp * 100, 100) : (ap > 0 ? 100 : 0);
      const {accentColor, statusKey, statusIcon} = allocBucketStatus(b, ap, tp);
      const displayName = getAllocBucketDisplayName(b);
      return `<div class="chart-hero-panel" style="padding:12px 8px">
        ${svgSemiGauge(fill, 110, accentColor, ap.toFixed(0) + '%')}
        <div class="chart-hero-label" style="margin-top:-4px">${esc(displayName)}</div>
        <div class="chart-hero-sub" style="font-weight:700;color:var(--text-secondary)">${fmt(actual)}</div>
        <div class="chart-hero-sub">${t('alloc_target')} ${tp}%</div>
        <div class="chart-hero-status" style="color:${accentColor}">${statusIcon} ${esc(t(statusKey))}</div>
      </div>`;
    }).join('');
    return `<div class="panel alloc-panel" data-chart-scope><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:10px">${t('alloc_title')}</div>
      <div class="ist-row" style="grid-template-columns:repeat(${buckets.length},1fr)">${tiles}</div>
    </div></div>`;
  })();

  const el=document.getElementById('bview-dashboard');
  const isCurrentRender=markRenderGen(el);
  el.innerHTML=`
    <div class="section-header section-header--period">
      <h2 class="section-title">${appIconSvg('dashboard')} ${t('tab_dashboard')}</h2>
      ${periodBarHtml()}
      ${dashLogControlsHtml()}
      ${helpBtn('dashboard')}
    </div>
    ${dashFabHtml()}

    ${nlHeroHtml(sum.leftover, { income: sum.totalIncome, subsMonthly: subMo })}

    <div class="dashboard-grid" style="margin-bottom:14px">
      <div class="panel cash-flow-hero-panel" data-chart-scope>
        <div class="panel-inner-sm">
          <div class="panel-title-sm" style="margin-bottom:10px">${t('dash_cash_flow')}</div>
          <div class="radial-bars-block">
            ${svgRadialBars(rings, 250)}
            <div class="donut-legend">${rings.map((r,idx) => {
              const over = r.expected>0 && r.value>r.expected;
              return `
              <div class="dleg-row dleg-row--stacked" data-idx="${idx}">
                <span class="dleg-swatch" style="background:${over?'#f43f5e':r.color}"></span>
                <div class="dleg-stack">
                  <span class="dleg-label">${esc(r.label)}</span>
                  <span class="dleg-pct">
                    <span style="color:${over?'#f43f5e':r.color}">${fmt(r.value)}</span>
                    <span class="flow-amt--exp"> / ${fmt(r.expected)}</span>
                  </span>
                </div>
              </div>`;}).join('')}</div>
          </div>
        </div>
      </div>
      <div class="charts-col pulse-charts-col">
        <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('dash_income_sources')}</div>${incSegs.length===0?`<div class="chart-empty">${t('dash_no_income')}</div>`:pieChartHtml(incSegs.map(s=>({...s,pct:incTot>0?s.value/incTot*100:0})), {limit:5,otherLabel:t('dash_other_category')})}</div></div>
        <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('dash_spending_breakdown')}</div>${spendSegs.length===0?`<div class="chart-empty">${t('dash_no_spending')}</div>`:pieChartHtml(spendSegs.map(s=>({...s,pct:spTot>0?s.value/spTot*100:0})), {limit:5,otherLabel:t('dash_other_category')})}</div></div>
      </div>
    </div>

    <div class="panel spend-line-panel" data-chart-scope><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:10px">${t('dash_daily_spend')}</div>${spendLineTotal>0?svgSpendLine(spendPoints,{w:900,h:140})+`<div class="spend-line-caption"><span class="spend-line-num">${fmt(spendLineTotal)}</span><span class="spend-line-label">${t('dash_daily_spend_caption')}</span></div>`:`<div class="chart-empty">${t('dash_no_spending')}</div>`}</div></div>
    ${allocHtml}

    <div class="pro-bottom-row" style="margin-top:14px">
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">${appIconSvg('debt')} ${t('tab_debt')}</div>
        ${state.debts.length===0?`<div class="chart-empty">${t('dash_no_debts')}<br><button class="link-btn" data-btab="debt">${t('dash_set_up')}</button></div>`:result?`<div class="debt-teaser"><div class="dt-item"><span class="dt-label">${t('dash_debt_free_label')}</span><span class="dt-value">${formatDateDisplay(result.debtFreeDate)}</span></div><div class="dt-item"><span class="dt-label">${t('dash_interest_label')}</span><span class="dt-value" style="color:#f43f5e">${fmt(result.totalInterest)}</span></div><div class="dt-item"><span class="dt-label">${t('dash_months_label')}</span><span class="dt-value">${result.months}</span></div><div class="dt-item"><span class="dt-label">${t('dash_method_label')}</span><span class="dt-value">${state.debtSettings.method==='snowball'?'⛄ Snowball':'🌊 Avalanche'}</span></div></div>`:`<div class="chart-empty">${t('dash_set_balances')}</div>`}
      </div></div>
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">${appIconSvg('sinking')} ${t('tab_sinking')}</div>
        ${state.sinkingFunds.length===0?`<div class="chart-empty">${t('dash_no_sinking')}<br><button class="link-btn" data-btab="goals">${t('dash_create_one')}</button></div>`:`<div class="sf-snap">${state.sinkingFunds.slice(0,4).map(f=>{const p=f.targetAmount>0?Math.min(100,Math.round((f.currentSaved||0)/f.targetAmount*100)):0;return`<div class="sf-snap-item"><div class="sf-snap-header"><span>${esc(f.icon||'🏺')} ${esc(f.name)}</span><span class="sf-snap-pct">${p}%</span></div><div class="prog-bar-wrap"><div class="prog-bar prog-bar--income" style="width:${p}%"></div></div><div style="font-size:11px;color:var(--text-faint);margin-top:2px;display:flex;justify-content:space-between">${fmt(f.currentSaved||0)} / ${fmt(f.targetAmount||0)}</div></div>`;}).join('')}</div>`}
      </div></div>
    </div>`;
  wirePeriodBar(el);
  wireNlHero(el);
  wireDashLog(el);
  wireComingUp(el);
  requestAnimationFrame(()=>{
    if (!isCurrentRender()) return;
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.rbar-seg', { legendScope: scope, swapText: true, swapFormat: d => `${d.pct}%`, format: d =>
        `<strong>${esc(d.label)}</strong><br>` +
        `<span style="color:var(--text-faint)">${esc(t('dash_expected_legend'))}: ${esc(fmt(parseFloat(d.expected) || 0))}</span><br>` +
        `<span style="color:${d.color || 'var(--text-primary)'};font-weight:800">${esc(t('dash_actual_legend'))}: ${esc(fmt(parseFloat(d.val) || 0))}</span>` });
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d =>
        `<strong>${esc(d.label)}</strong><br>${esc(fmt(parseFloat(d.val) || 0))} · ${parseFloat(d.pct || 0).toFixed(0)}%` });
      wireChartHover(scope, '.spend-line-dot', { format: d =>
        formatSpendTooltipHtml(spendPoints[parseInt(d.idx, 10)] || { label: d.label, value: parseFloat(d.val) || 0, items: [] },
          { typeLabel: spendTypeLabel, typeColor: spendTypeColor, moreText: n => tf('spend_tip_more', n) }) });
    });
    const nlFree = nlHeroTarget(el);
    if (!quiet) animateDashboardEntrance(el, [
      { el: el.querySelector('.leftover-value'), target: Math.abs(nlFree), html: true,
        render: v => (nlFree < 0 ? '\u2212' : '') + nlAmountHtml(v) }
    ]);
  });
  el.querySelectorAll('[data-btab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

// ── Budget Allocation ─────────────────────────────────────────────────
function computeAllocation() {
  const {periodStart, periodEnd} = state.settings;
  const buckets = state.allocation?.buckets || [];
  const saveId = buckets.find(b => b.id === 'save')?.id || 'save';
  const totals = {};
  buckets.forEach(b => totals[b.id] = 0);
  let untagged = 0;
  for (const tx of state.transactions) {
    if (tx.date < periodStart || tx.date > periodEnd) continue;
    if (tx.type === 'income') continue;
    const alloc = (tx.type==='savings'||tx.type==='sinking_fund') ? saveId : (tx.allocation || null);
    if (alloc && totals[alloc] !== undefined) totals[alloc] += tx.amount;
    else untagged += tx.amount;
  }
  return { totals, untagged };
}
// ── Allocation display helpers ────────────────────────────────────────
const ALLOC_DEFAULTS = {
  need: new Set(['Need','Bedarf','Besoin','Necesidad','Bisogno','Potrzeba']),
  want: new Set(['Want','Wunsch','Envie','Deseo','Desiderio','Chęć']),
  save: new Set(['Save','Sparen','Épargne','Ahorro','Risparmio','Oszczędność']),
};
const BUCKET_COLORS=['#6366f1','#ec4899','#10b981','#fb923c','#a855f7','#3b82f6','#eab308','#f43f5e','#06b6d4','#84cc16'];
// Shared over/nearing/under classification for allocation buckets.
// For spending buckets (Need/Want) being under target is good; for the Save
// bucket the meaning flips - under target means you're behind on savings.
function allocBucketStatus(b, ap, tp) {
  if (b.id === 'save') {
    const met = tp > 0 ? ap >= tp : ap > 0;
    const nearing = !met && tp > 0 && (tp - ap) <= 5 && ap > 0;
    const behind = !met && !nearing;
    return {
      accentColor: behind ? '#f43f5e' : nearing ? '#fb923c' : b.color,
      statusColor: behind ? '#f43f5e' : nearing ? '#fb923c' : '#10b981',
      statusKey:   behind ? 'alloc_behind' : nearing ? 'alloc_nearing' : 'alloc_on_track',
      statusIcon:  behind ? '▼' : nearing ? t('alloc_icon_near') : t('alloc_icon_ok')
    };
  }
  const over = ap > tp && tp > 0;
  const nearing = !over && tp > 0 && (tp - ap) <= 5 && ap > 0;
  return {
    accentColor: over ? '#f43f5e' : nearing ? '#fb923c' : b.color,
    statusColor: over ? '#f43f5e' : nearing ? '#fb923c' : '#10b981',
    statusKey:   over ? 'alloc_over' : nearing ? 'alloc_nearing' : 'alloc_under',
    statusIcon:  over ? t('alloc_icon_over') : nearing ? t('alloc_icon_near') : t('alloc_icon_ok')
  };
}
function getAllocBucketDisplayName(b) {
  const keyMap = {need:'alloc_def_need', want:'alloc_def_want', save:'alloc_def_save'};
  if (keyMap[b.id] && ALLOC_DEFAULTS[b.id]?.has(b.name)) return t(keyMap[b.id]);
  return b.name;
}
function getModMeta(){return{
  income: {icon:'💰',title:t('bud_section_income'),isInc:true, hasDates:false},
  expenses:{icon:'🛒',title:t('bud_section_expenses'),isInc:false,hasDates:false},
};}

// What the whole budget adds up to, across everything money goes out of.
// Income is left out: nothing is "left to spend" of money coming in.
function budgetSummaryHtml(act) {
  const OUT = ['expenses'];
  let target = 0, spent = 0;
  OUT.forEach(type => {
    const rows = state.budgets[type] || [], a = act[type] || {};
    rows.forEach(r => { target += r.expected || 0; spent += a[r.category] || 0; });
  });
  const left = target - spent;
  const p = pct(spent, target);
  const over = target > 0 && spent > target;
  return `<div class="panel bud-summary"><div class="bud-summary-inner">
    <div class="bud-sum-figures">
      <div class="bud-sum-fig${over ? ' is-over' : ''}">
        <span class="bud-sum-label">${t('env_sum_left')}</span>
        <strong class="bud-sum-value">${left < 0 ? '\u2212' : ''}${fmt(Math.abs(left))}</strong>
      </div>
      <div class="bud-sum-fig">
        <span class="bud-sum-label">${t('env_sum_spent')}</span>
        <strong class="bud-sum-value">${fmt(spent)}</strong>
      </div>
      <div class="bud-sum-fig">
        <span class="bud-sum-label">${t('env_sum_target')}</span>
        <strong class="bud-sum-value">${fmt(target)}</strong>
      </div>
    </div>
    <div class="bud-sum-track"><div class="bud-sum-fill${over ? ' is-over' : ''}" style="width:${Math.min(p, 100)}%"></div></div>
    <p class="bud-sum-note">${tf('env_sum_note', p)}</p>
  </div></div>`;
}

function renderBudget() {
  queueNavBadges();
  const act=computeActuals(), MOD_META=getModMeta();
  const el=document.getElementById('bview-budget');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">${appIconSvg('budget')} ${t('tab_budget')}</h2>
      <div class="section-header-actions">${viewToggleBtn('budget')}${helpBtn('budget')}<button class="btn btn-primary btn-sm" id="budAddAny" type="button">${t('bud_add_any')}</button></div>
    </div>
    <p class="section-desc">${t('bud_desc')}</p>
    ${budgetSummaryHtml(act)}`+
    Object.entries(MOD_META).map(([type,meta])=>buildModuleHTML(type,meta,act)).join('');
  Object.entries(MOD_META).forEach(([type,meta])=>bindModuleEvents(type,meta,el,act));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
  // Opened without a section, so the form asks which one it belongs to.
  document.getElementById('budAddAny')?.addEventListener('click',()=>openAddBudgetRow(null));
  wireViewToggle(el,'budget',renderBudget);
  initFieldTips(el);
}

// ── Edit a budget category ─────────────────────────────────────────────
// The row exposed the expected amount and due date as inline inputs, but
// the category name had no editor at all: renaming meant deleting the row
// and rebuilding it, which detached every transaction filed under it. Same
// modal shape as the transaction editor.
const BUD_TX_TYPE = { income: 'income', expenses: 'expense' };

function openEditBudgetRow(type, id) {
  const meta = getModMeta()[type];
  const rows = state.budgets[type] || [];
  const row = rows.find(r => r.id === id);
  if (!row || !meta) return;
  const oldName = row.category;

  document.getElementById('modalTitle').textContent = t('bud_edit_title');
  document.getElementById('modalBody').innerHTML = `
    <div class="field"><label class="field-label">${t('bud_th_category')}</label>
      <input class="input" type="text" id="ebCat" maxlength="60" value="${esc(row.category)}"></div>
    <div class="field"><label class="field-label">${t('bud_th_expected')} (${SYM})</label>
      <input class="input" type="number" id="ebExp" min="0" step="0.01" value="${row.expected || ''}" placeholder="0.00"></div>
    ${meta.hasDates ? `<div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_th_due'),'debt_due_day_modal_hint',false)}</label>
      <input class="input" type="number" id="ebDueDay" min="1" max="31" step="1" inputmode="numeric" placeholder="1-31" value="${rowDueDay(row) || ''}"></div>
    <div class="field-hint">${t('debt_due_day_note')}</div>` : ''}
    <div class="tx-error" id="ebError" hidden></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="ebSave" type="button">${t('tx_save_changes')}</button>
      <button class="btn btn-ghost btn-sm" id="ebCancel" type="button">${t('cancel')}</button>
      <button class="btn btn-danger btn-sm" id="ebDelete" type="button">${t('delete')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden = false;

  const showErr = msg => { const e = document.getElementById('ebError'); if (e) { e.textContent = msg; e.hidden = false; } };
  document.getElementById('modalBody').addEventListener('input', () => {
    const e = document.getElementById('ebError'); if (e) e.hidden = true;
  });

  document.getElementById('ebSave')?.addEventListener('click', () => {
    const name = document.getElementById('ebCat').value.trim();
    const expRaw = document.getElementById('ebExp').value;
    const exp = expRaw === '' ? 0 : parseFloat(expRaw);
    if (!name) return showErr(t('bud_name_required'));
    // Two rows sharing a name in one section would pool their actuals,
    // since a transaction is matched to a row by name.
    if (rows.some(r => r.id !== id && r.category.toLowerCase() === name.toLowerCase())) return showErr(t('bud_name_taken'));
    if (isNaN(exp) || exp < 0) return showErr(t('bud_expected_invalid'));

    // Transactions store the category as a name rather than an id, so a
    // rename has to carry them with it. Without this the row's actual drops
    // to zero and the spending is stranded under a category that no longer
    // exists anywhere.
    if (name !== oldName) {
      const txType = BUD_TX_TYPE[type];
      state.transactions.forEach(tx => { if (tx.type === txType && tx.category === oldName) tx.category = name; });
      // Recurring templates file by category name too, so they would start
      // generating transactions under the old name.
    }
    row.category = name;
    row.expected = exp;
    if (meta.hasDates) {
      const raw = document.getElementById('ebDueDay')?.value ?? '';
      if (raw !== '' && !(Number(raw) >= 1 && Number(raw) <= 31)) return showErr(t('bud_due_day_invalid'));
      setRowDueDay(row, raw);
    }
    saveState(); closeModal(); renderBudget();
    showToast(t('toast_saved'));
  });

  document.getElementById('ebCancel')?.addEventListener('click', closeModal);

  // Same warning the row's own delete button gives, so deleting from here
  // cannot quietly do more than deleting from there.
  document.getElementById('ebDelete')?.addEventListener('click', async () => {
    const txCount = state.transactions.filter(tx => tx.type === BUD_TX_TYPE[type] && tx.category === oldName).length;
    const message = txCount > 0 ? tf('confirm_remove_cat_with_tx', txCount) : t('confirm_remove_cat');
    if (!await confirmDialog({ message, confirmText: t('delete') })) return;
    state.budgets[type] = rows.filter(r => r.id !== id);
    saveState(); closeModal(); renderBudget();
  });
}

// Adding a row used to reveal a card wedged under the table, which meant
// scrolling to find it and again to get back. It is the same job as editing
// a row, so it is the same modal, with suggestions on top.
function openAddBudgetRow(type, forcePicker) {
  const META = getModMeta();
  // Opened from the section's own button the section is known; opened from
  // the one button above them all it is asked for, and everything below
  // follows whatever is picked.
  const pickSection = !type || forcePicker;
  if (!type) type = 'expenses';
  const meta = META[type];
  if (!meta) return;
  const rows = state.budgets[type] || [];
  // Nothing already in this section, since a second row under one name
  // would pool its actuals with the first.
  const taken = new Set(rows.map(r => (r.category || '').toLowerCase()));
  const suggestions = (t('bud_sugg_' + type) || '').split('|')
    .map(x => x.trim()).filter(x => x && !taken.has(x.toLowerCase()));

  document.getElementById('modalTitle').textContent = `${t('bud_add_cat_title')} \u00b7 ${meta.title}`;
  document.getElementById('modalBody').innerHTML = `
    ${pickSection ? `<div class="field"><label class="field-label">${t('bud_section_label')}</label>
      <select class="select" id="abSection">${Object.entries(META).map(([k, m]) =>
        `<option value="${k}"${k === type ? ' selected' : ''}>${m.icon} ${esc(m.title)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('bud_cat_name_label'),'bud_cat_name_hint',false)}</label>
      <input class="input" type="text" id="abCat" maxlength="60"${suggestions.length?'':` placeholder="${esc(t('bud_cat_name_ph'))}"`} autocomplete="off"></div>
    ${suggestions.length ? `<div class="quick-add">
      <span class="quick-add-label">${t('bud_quick_add')}</span>
      <div class="quick-add-chips">${suggestions.map(x =>
        `<button class="quick-chip" type="button" data-sugg="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    </div>` : ''}
    <div class="field"><label class="field-label">${t('bud_th_expected')} (${SYM})</label>
      <input class="input" type="number" id="abExp" min="0" step="0.01" placeholder="0.00" inputmode="decimal"></div>
    ${meta.hasDates ? `<div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_th_due'),'debt_due_day_modal_hint',false)}</label>
      <input class="input" type="number" id="abDueDay" min="1" max="31" step="1" inputmode="numeric" placeholder="1-31"></div>
    <div class="field-hint">${t('debt_due_day_note')}</div>` : ''}
    <div class="tx-error" id="abError" hidden></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="abSave" type="button">${t('bud_add_cat_btn')}</button>
      <button class="btn btn-ghost btn-sm" id="abCancel" type="button">${t('cancel')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  // Changing the section reopens the form on it, so its own suggestions and
  // its own due-day field come with it.
  document.getElementById('abSection')?.addEventListener('change', e => openAddBudgetRow(e.target.value, true));
  const nameEl = document.getElementById('abCat');
  // After the overlay's own focus move, which runs on a microtask and would
  // otherwise win. Only with a real pointer: on a phone the keyboard would
  // spring up and cover the suggestions, which are the reason to be here.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches)
    setTimeout(() => nameEl?.focus(), 0);

  const showErr = msg => { const e = document.getElementById('abError'); if (e) { e.textContent = msg; e.hidden = false; } };
  document.getElementById('modalBody').addEventListener('input', () => {
    const e = document.getElementById('abError'); if (e) e.hidden = true;
  });
  // A chip fills the name and hands over to the amount, rather than adding
  // the row outright: the amount is the part worth asking for.
  document.querySelectorAll('#modalBody .quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (nameEl) nameEl.value = chip.dataset.sugg;
      document.querySelectorAll('#modalBody .quick-chip').forEach(c => c.classList.toggle('is-on', c === chip));
      const e = document.getElementById('abError'); if (e) e.hidden = true;
      document.getElementById('abExp')?.focus();
    });
  });

  const save = () => {
    // Checked here as well as on the button that opened this, since the
    // limit can be reached while the modal is open.
    if (trialBlocks(type)) { closeModal(); showUpgradeModal({ reason: 'category', type }); return; }
    const name = (document.getElementById('abCat')?.value || '').trim();
    const expRaw = document.getElementById('abExp')?.value ?? '';
    const exp = expRaw === '' ? 0 : parseFloat(expRaw);
    if (!name) return showErr(t('bud_name_required'));
    if (rows.some(r => (r.category || '').toLowerCase() === name.toLowerCase())) return showErr(t('bud_name_taken'));
    if (isNaN(exp) || exp < 0) return showErr(t('bud_expected_invalid'));
    const newRow = { id: uid(), category: name, expected: exp };
    if (meta.hasDates) {
      const rawDay = document.getElementById('abDueDay')?.value ?? '';
      if (rawDay !== '' && !(Number(rawDay) >= 1 && Number(rawDay) <= 31)) return showErr(t('bud_due_day_invalid'));
      setRowDueDay(newRow, rawDay);
      newRow.paid = false;
    }
    (state.budgets[type] = state.budgets[type] || []).push(newRow);
    trialUse(type);
    saveState(); closeModal(); renderBudget();
    showToast(t('toast_saved'));
  };
  document.getElementById('abSave')?.addEventListener('click', save);
  // Enter on the name or the amount commits, which is what a two-field form
  // invites. Not on the date, where Enter belongs to the picker.
  ['abCat', 'abExp'].forEach(id => document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  }));
  document.getElementById('abCancel')?.addEventListener('click', closeModal);
}

// One icon for every section of the app, drawn the same way: a 24x24 box,
// stroked at one weight, never filled. Emoji were rendering at a different
// weight and shape on every platform, and could not take the colour of the
// thing they sat in.
const APP_ICONS = {
  envelope:      '<rect x="2.6" y="5" width="18.8" height="14" rx="2.4"/><path d="M3.2 7 12 13l8.8-6"/>',
  list:          '<path d="M8.6 6.5h12"/><path d="M8.6 12h12"/><path d="M8.6 17.5h12"/><circle cx="4.3" cy="6.5" r="1"/><circle cx="4.3" cy="12" r="1"/><circle cx="4.3" cy="17.5" r="1"/>',
  assistant:     '<path d="M10 4l1.5 4.1 4.1 1.5-4.1 1.5L10 15.2 8.5 11.1 4.4 9.6l4.1-1.5L10 4z"/><path d="M17.5 3.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/><path d="M17 13.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5z"/>',
  guide:         '<path d="M2.8 5h5.6a3 3 0 0 1 3 3v11.5a2.3 2.3 0 0 0-2.3-2.3H2.8z"/><path d="M21.2 5h-5.6a3 3 0 0 0-3 3v11.5a2.3 2.3 0 0 1 2.3-2.3h6.3z"/>',
  home:          '<path d="M3.6 10.2 12 3.6l8.4 6.6v9.1a1.1 1.1 0 0 1-1.1 1.1H4.7a1.1 1.1 0 0 1-1.1-1.1z"/><path d="M9.6 20.4v-6.6h4.8v6.6"/>',
  coins:         '<ellipse cx="9" cy="7" rx="5.6" ry="2.6"/><path d="M3.4 7v4.4c0 1.4 2.5 2.6 5.6 2.6s5.6-1.2 5.6-2.6V7"/><path d="M9.4 16.6c.9 1.2 3.2 2 5.6 2 3.1 0 5.6-1.2 5.6-2.6V11.6c0-1.4-2.5-2.6-5.6-2.6"/>',
  bolt:          '<path d="M13.2 2.8 4.8 13.6h6.4l-.8 7.6 8.4-10.8h-6.4z"/>',
  moon:          '<path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8z"/>',
  cloud:         '<path d="M7.2 18.6a4.4 4.4 0 0 1-.5-8.8 6 6 0 0 1 11.5 1.6 3.6 3.6 0 0 1-.4 7.2z"/>',
  globe:         '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2c2.4 2.4 3.6 5.4 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.4-3.6-8.8S9.6 5.6 12 3.2z"/>',
  upload:        '<path d="M12 15.6V4"/><path d="m7.6 8.4 4.4-4.4 4.4 4.4"/><path d="M4.4 15.6v3a1.4 1.4 0 0 0 1.4 1.4h12.4a1.4 1.4 0 0 0 1.4-1.4v-3"/>',
  alert:         '<path d="M10.4 4.4 2.9 17.6A1.8 1.8 0 0 0 4.5 20.3h15a1.8 1.8 0 0 0 1.6-2.7L13.6 4.4a1.8 1.8 0 0 0-3.2 0z"/><path d="M12 9.6v4.2"/><path d="M12 17h.01"/>',
  width:         '<path d="M3 12h18"/><path d="m6.6 8.4-3.6 3.6 3.6 3.6"/><path d="m17.4 8.4 3.6 3.6-3.6 3.6"/><path d="M3 4v16" opacity=".5"/><path d="M21 4v16" opacity=".5"/>',
  bell:          '<path d="M6.2 16.4v-5.1a5.8 5.8 0 0 1 11.6 0v5.1l1.6 2.1H4.6z"/><path d="M10 20.6a2.1 2.1 0 0 0 4 0"/>',
  dashboard:     '<rect x="3.2" y="3.4" width="7.6" height="7.6" rx="1.7"/><rect x="13.2" y="3.4" width="7.6" height="7.6" rx="1.7"/><rect x="3.2" y="13.4" width="7.6" height="7.2" rx="1.7"/><rect x="13.2" y="13.4" width="7.6" height="7.2" rx="1.7"/>',
  budget:        '<path d="M12 3.2v17.6"/><path d="M16.2 6.6H9.9a2.85 2.85 0 0 0 0 5.7h4.2a2.85 2.85 0 0 1 0 5.7H7.8"/>',
  transactions:  '<path d="M4 7.4h12.6"/><path d="M13.6 4.4 16.9 7.4 13.6 10.4"/><path d="M20 16.6H7.4"/><path d="M10.4 13.6 7.1 16.6 10.4 19.6"/>',
  debt:          '<rect x="2.6" y="5.2" width="18.8" height="13.6" rx="2.4"/><path d="M2.6 10h18.8"/>',
  subscriptions: '<path d="M20.4 11.2a8.4 8.4 0 0 0-14.4-5.3L3.2 8.6"/><path d="M3.6 12.8a8.4 8.4 0 0 0 14.4 5.3l2.8-2.7"/><path d="M3.2 4.6v4h4"/><path d="M20.8 19.4v-4h-4"/>',
  sinking:       '<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="4.3"/><circle cx="12" cy="12" r="0.9"/>',
  user:          '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0"/>',
  tag:           '<path d="M3.5 12.6V4.4a.9.9 0 0 1 .9-.9h8.2l7.9 7.9a1.3 1.3 0 0 1 0 1.8l-6.6 6.6a1.3 1.3 0 0 1-1.8 0z"/><circle cx="8.2" cy="8.2" r="1.4"/>',
  key:           '<circle cx="7.8" cy="15.8" r="4.2"/><path d="m10.8 12.8 8.7-8.7"/><path d="m16.6 7 2.6 2.6"/><path d="m14.4 9.2 2 2"/>',
  // A shopping bag, for Can I afford it?
  afford:        '<path d="M5.2 7.6h13.6l-1 12.2a1.4 1.4 0 0 1-1.4 1.3H7.6a1.4 1.4 0 0 1-1.4-1.3z"/><path d="M8.8 10V6.6a3.2 3.2 0 0 1 6.4 0V10"/>',
  // Two faces, one smiling and one not, for the persona setting.
  persona:       '<path d="M4 5.5c2.6-1.2 5.4-1.2 8 0v6.2c0 3.2-1.8 5.4-4 5.4s-4-2.2-4-5.4z"/><path d="M12 9.2c2.6-1.2 5.4-1.2 8 0v5.7c0 3.2-1.8 5.6-4 5.6-1.4 0-2.6-.9-3.3-2.3"/><path d="M6.4 10h.01"/><path d="M9.6 10h.01"/><path d="M6.6 13.2c.8.8 2.2.8 3 0"/><path d="M14.6 13.6h.01"/><path d="M17.6 13.6h.01"/><path d="M14.6 17.6c.8-.9 2.2-.9 3 0"/>',
  // A trophy, for Challenges.
  challenges:    '<path d="M7.4 3.8h9.2v5.4a4.6 4.6 0 0 1-9.2 0z"/><path d="M7.4 5.8H4.2v1.3a3.4 3.4 0 0 0 3.5 3.4"/><path d="M16.6 5.8h3.2v1.3a3.4 3.4 0 0 1-3.5 3.4"/><path d="M12 13.8v3.4"/><path d="M8.4 20.4h7.2"/><path d="M9.6 17.2h4.8l.6 3.2H9z"/>',
  calendar:      '<rect x="3.2" y="4.9" width="17.6" height="15.9" rx="2.4"/><path d="M16 3.2v3.5"/><path d="M8 3.2v3.5"/><path d="M3.2 10.2h17.6"/>',
  // The same gear the top bar and the phone dock draw, so Settings looks the same everywhere.
  settings:      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  income:        '<path d="M12 3.4v9.4"/><path d="M8.2 9 12 12.8 15.8 9"/><path d="M4 16.4v2.3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.3"/>',
  expenses:      '<path d="M2.8 3.2h2.2l2.4 11.1a1.7 1.7 0 0 0 1.7 1.3h8.1a1.7 1.7 0 0 0 1.7-1.3L20.6 7.1H6"/><circle cx="9.6" cy="19.6" r="1.3"/><circle cx="17.4" cy="19.6" r="1.3"/>',
  bills:         '<path d="M6 3.2h8l4 4v13.6H6z"/><path d="M14 3.2v4h4"/><path d="M9.2 12.2h5.6"/><path d="M9.2 16.2h5.6"/>',
  savings:       '<path d="M3 9.6 12 4.2l9 5.4"/><path d="M6.2 11.2v6.6"/><path d="M12 11.2v6.6"/><path d="M17.8 11.2v6.6"/><path d="M3.6 20.6h16.8"/>'
};
function appIconSvg(name){
  const d = APP_ICONS[name];
  if (!d) return '';
  return `<svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
// The budget cards ask by section name, which is the same key.
function budgetIconSvg(type){ return appIconSvg(type) || appIconSvg('expenses'); }
// The tab bar ships empty icon slots naming what belongs in them, so the set
// lives in one place rather than being pasted into two HTML files.
function paintTabIcons(){
  document.querySelectorAll('.btab-ico[data-ico]').forEach(el => {
    const svg = appIconSvg(el.dataset.ico);
    if (svg && el.innerHTML !== svg) el.innerHTML = svg;
  });
}

// Each section remembers whether it is shown as cards or as a list. The
// button shows the view it would switch to, so it reads as an offer.
const VIEW_DEFAULTS = { notifications: 'list' };
function viewMode(sec){ const v=(state.settings.viewModes||{})[sec]; return v ? (v==='list'?'list':'cards') : (VIEW_DEFAULTS[sec]||'cards'); }
function viewToggleBtn(sec){
  const toList=viewMode(sec)!=='list';
  const label=toList?t('view_as_list'):t('view_as_cards');
  return `<button class="help-icon-btn view-toggle" type="button" data-view-toggle="${sec}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${!toList}">${appIconSvg(toList?'list':'dashboard')}</button>`;
}
function wireViewToggle(scope, sec, rerender){
  scope.querySelector(`[data-view-toggle="${sec}"]`)?.addEventListener('click',()=>{
    state.settings.viewModes={...(state.settings.viewModes||{}),[sec]:viewMode(sec)==='list'?'cards':'list'};
    saveState(); rerender();
  });
}
// One row of a list view. Every section's list is built from these, so the
// columns line up the same way wherever the toggle is flipped.
function lvRow({ ico, name, sub, bar, barCls, fig, cap, acts, cls, attrs }){
  return `<div class="lv-row${cls?' '+cls:''}"${attrs?' '+attrs:''}>
    <span class="lv-ico" aria-hidden="true">${ico}</span>
    <span class="lv-main"><span class="lv-name">${name}</span>${sub?`<span class="lv-sub">${sub}</span>`:''}</span>
    <span class="lv-bar">${bar==null?'':`<span class="lv-bar-fill${barCls?' '+barCls:''}" style="width:${Math.min(100,Math.max(0,bar))}%"></span>`}</span>
    <span class="lv-fig">${fig}${cap?`<small>${cap}</small>`:''}</span>
    <span class="lv-acts">${acts||''}</span>
  </div>`;
}
const LV_SVG=p=>`<svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const LV_EDIT=LV_SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>');
const LV_DEL=LV_SVG('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>');
const LV_PLUS=LV_SVG('<path d="M12 5v14"/><path d="M5 12h14"/>');
// An icon button in a list row. cls carries whatever class the section
// already binds its handler to.
const lvBtn=(cls,attrs,label,svg)=>`<button class="lv-act${cls?' '+cls:''}" ${attrs} type="button" title="${esc(label)}" aria-label="${esc(label)}">${svg}</button>`;

function buildModuleHTML(type,meta,act) {
  const rows=state.budgets[type]||[],typeAct=act[type]||{};
  const totExp=rows.reduce((t,r)=>t+(r.expected||0),0),totAct=rows.reduce((t,r)=>t+(typeAct[r.category]||0),0);
  const totP=pct(totAct,totExp),totOvr=!meta.isInc&&totAct>totExp&&totExp>0;
  // The figure worth reading first differs by section: what is left in an
  // envelope you spend from, what has landed in one you fill.
  const card = row => {
    const a = typeAct[row.category] || 0;
    const exp = row.expected || 0;
    const p = pct(a, exp);
    const over = !meta.isInc && exp > 0 && a > exp;
    const headline = meta.isInc ? a : exp - a;
    const cap = meta.isInc
      ? (type === 'savings' ? t('env_saved') : t('env_in'))
      : (over ? t('env_over') : t('env_left'));
    const day = meta.hasDates ? rowDueDay(row) : 0;
    return `<article class="env-card${over ? ' is-over' : ''}${meta.isInc ? ' env-card--in' : ''}" data-env-id="${row.id}" data-env-type="${type}">
      <span class="env-flap" aria-hidden="true"></span>
      <span class="env-icon" aria-hidden="true">
        ${budgetIconSvg(type)}
      </span>
      <h4 class="env-name" title="${esc(row.category)}">${esc(row.category)}</h4>
      ${meta.hasDates ? `<p class="env-sub">${day ? `${t('dpc_th_due')} ${day}` : '&nbsp;'}</p>` : ''}
      <div class="env-figure">${headline < 0 ? '\u2212' : ''}${fmt(Math.abs(headline))}</div>
      <div class="env-cap">${cap}</div>
      <div class="prog-bar-wrap"><div class="prog-bar${meta.isInc ? ' prog-bar--income' : over ? ' prog-bar--over' : ' prog-bar--normal'}" id="pb-${row.id}" style="width:${Math.min(p, 100)}%"></div></div>
      <p class="env-meta" id="pl-${row.id}">${meta.isInc ? tf('env_meta_in', fmt(a), fmt(exp)) : tf('env_meta_out', fmt(a), fmt(exp))}</p>
      <div class="env-actions">
        <button class="env-btn env-btn--go" data-env-log="${row.id}" data-type="${type}" type="button">${t('env_log')}</button>
        <button class="env-btn mod-edit" data-id="${row.id}" data-type="${type}" type="button">${t('edit')}</button>
        <button class="env-btn env-btn--danger mod-del" data-id="${row.id}" data-type="${type}" type="button">${t('delete')}</button>
      </div>
    </article>`;
  };
  // The list keeps what the card leads with, the figure and its bar, and
  // folds the rest onto one line.
  const line = row => {
    const a = typeAct[row.category] || 0, exp = row.expected || 0;
    const over = !meta.isInc && exp > 0 && a > exp;
    const head = meta.isInc ? a : exp - a;
    const day = meta.hasDates ? rowDueDay(row) : 0;
    const metaTxt = meta.isInc ? tf('env_meta_in', fmt(a), fmt(exp)) : tf('env_meta_out', fmt(a), fmt(exp));
    const on = `data-id="${row.id}" data-type="${type}"`;
    return lvRow({ attrs: `data-env-id="${row.id}"`,
      cls: over ? 'is-over' : '', ico: budgetIconSvg(type), name: esc(row.category),
      sub: day ? `${t('dpc_th_due')} ${day} \u00b7 ${metaTxt}` : metaTxt,
      bar: pct(a, exp), barCls: meta.isInc ? 'is-in' : over ? 'is-over' : '',
      fig: `${head < 0 ? '\u2212' : ''}${fmt(Math.abs(head))}`,
      cap: meta.isInc ? (type === 'savings' ? t('env_saved') : t('env_in')) : (over ? t('env_over') : t('env_left')),
      acts: lvBtn('', `data-env-log="${row.id}" data-type="${type}"`, t('env_log'), LV_PLUS)
        + lvBtn('mod-edit', on, t('edit'), LV_EDIT)
        + lvBtn('lv-act--del mod-del', on, t('delete'), LV_DEL)
    });
  };
  const asList = viewMode('budget') === 'list';
  return `<div class="budget-module-section" data-mod-type="${type}"><div class="module-section-header">
      <h3 class="module-section-title">${appIconSvg(type)} ${meta.title}</h3>
      ${rows.length ? `<span class="module-section-total"><strong id="te-${type}">${fmt(totAct)}</strong> / ${fmt(totExp)}</span>` : ''}
      <button class="btn btn-ghost btn-sm mod-add-btn" data-type="${type}" type="button">${t('bud_add_btn')}</button>
    </div>
    ${asList ? (rows.length ? `<div class="lv">${rows.map(line).join('')}</div>` : '') : `<div class="env-grid">${rows.map(card).join('')}
      <button class="env-add mod-add-btn" data-type="${type}" type="button" title="${esc(t('bud_add_cat_title'))}">
        <span class="env-add-ico" aria-hidden="true">${appIconSvg('envelope')}</span>
        <span class="env-add-text">${t('bud_add_btn')}</span>
      </button>
    </div>`}
    </div>`;
}

// Marking a bill paid logs the actual amount as a real transaction rather than
// just flipping a status flag - the flag alone would leave "paid" disconnected
// from what was actually spent (bills are rarely the exact same amount twice).
function payRound2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// A bill row's payments. Historically one transaction in paidTxId; now a
// list, so a bill can be settled in instalments and each part stays its own
// transaction. Old saves are read through the same accessor, never migrated
// in place, so nothing has to run at load time.
function rowPayTxIds(row) {
  if (Array.isArray(row.payTxIds)) return row.payTxIds;
  return row.paidTxId ? [row.paidTxId] : [];
}
function rowPayments(row) {
  const ids = rowPayTxIds(row);
  if (!ids.length) return [];
  const byId = new Map(state.transactions.map(tx => [tx.id, tx]));
  return ids.map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}
function rowPaidAmount(row) {
  return payRound2(rowPayments(row).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0));
}
function rowExpected(row) {
  if (!row) return 0;
  return Number(row.expected != null ? row.expected : row.amount) || 0;
}
function rowRemaining(row) {
  return Math.max(0, payRound2(rowExpected(row) - rowPaidAmount(row)));
}
function rowPayState(row) {
  if (Array.isArray(row.payTxIds)) {
    if (row.payTxIds.length && billSettles(row, 0)) return 'paid';
    return rowPaidAmount(row) > 0 ? 'partial' : 'unpaid';
  }
  if (row.paid) return 'paid';
  return rowPaidAmount(row) > 0 ? 'partial' : 'unpaid';
}
// Half a cent of slack, so 3 payments of 33.33 against 100.00 still closes.
function billSettles(row, extra) {
  const exp = rowExpected(row);
  if (exp <= 0) return true;
  return payRound2(rowPaidAmount(row) + extra) >= exp - 0.005;
}
function stepBillDate(iso, freq) {
  const d = new Date(iso + 'T00:00:00');
  switch (freq) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'annual':    d.setFullYear(d.getFullYear() + 1); break;
    default:          d.setMonth(d.getMonth() + 1);
  }
  return toLocalISO(d);
}
function rollBills() {
  const today = toLocalISO(new Date());
  let changed = syncBillPaidLinks();
  (state.bills || []).forEach(b => {
    // Bounded, so a bill with a date years in the past cannot spin forever.
    for (let i = 0; i < 60; i++) {
      if (!b.nextBillingDate || b.nextBillingDate >= today) break;
      if (!rowPayTxIds(b).length || !billSettles(b, 0)) break;
      b.paidCycles = (b.paidCycles || []).concat([{ due: b.nextBillingDate, ids: rowPayTxIds(b).slice(), amount: rowExpected(b) }]).slice(-24);
      b.lastPaidOn = b.nextBillingDate;
      b.nextBillingDate = stepBillDate(b.nextBillingDate, b.frequency);
      b.payTxIds = []; b.paid = false;
      changed = true;
    }
  });
  if (changed) saveState();
  return changed;
}
function setRowPayments(row, ids) {
  row.payTxIds = ids;
  delete row.paidTxId;
  row.paid = ids.length > 0 && billSettles(row, 0);
}

// What the pay modal is working on. A bill row keeps its own paid state, so
// its payments are the ones it links to. Debts and subscriptions keep none -
// theirs is worked out from the transactions - so their payments are simply
// the matching transactions inside the current period.
// Debt and subscription payments are read back out of the period's
// transactions, matched on the entity's name.
function subOrDebtPaid(actuals, name) { return payRound2(Number(actuals[name]) || 0); }

function payTarget(kind, id, occDate) {
  if (kind === 'bill') {
    const row = (state.bills || []).find(b => b.id === id);
    return row && { kind, id, row, label: row.name, category: row.name,
                    txType: 'bill', expected: Number(row.amount) || 0 };
  }
  if (kind === 'debt') {
    const d = (state.debts || []).find(x => x.id === id);
    return d && { kind, id, label: d.name, category: d.name,
                  txType: 'debt', expected: Number(d.minimumPayment) || 0 };
  }

  return null;
}
function targetPayments(tg) {
  if (tg.row) return rowPayments(tg.row);
  const a = state.settings.periodStart || '', b = state.settings.periodEnd || '';
  return state.transactions
    .filter(tx => tx.type === tg.txType && tx.category === tg.category
                  && (!a || tx.date >= a) && (!b || tx.date <= b))
    .sort((x, y) => x.date.localeCompare(y.date));
}
function targetPaid(tg) {
  return payRound2(targetPayments(tg).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0));
}
function targetRemaining(tg) { return Math.max(0, payRound2(tg.expected - targetPaid(tg))); }
function targetSettles(tg, extra) {
  if (tg.expected <= 0) return true;
  return payRound2(targetPaid(tg) + extra) >= tg.expected - 0.005;
}
// Drops one payment. The transaction goes, and a bill row falls back to
// partial or unpaid on its own.
function removeTargetPayment(tg, txId, onDone) {
  const tx = state.transactions.find(t => t.id === txId);
  if (tx) applySinkingFundDelta(tx, -1);
  state.transactions = state.transactions.filter(t => t.id !== txId);
  if (tg.row) setRowPayments(tg.row, rowPayTxIds(tg.row).filter(id => id !== txId));
  syncBillPaidLinks();
  saveState();
  onDone();
  showToast(t('toast_payment_removed'));
}

// Bills, debts and subscriptions all reach this from the calendar and the
// dashboard hero. The Budget tab used to offer a tick box of its own; that
// tab plans a budget now and does not settle it.
function promptMarkBillPaid(billId, onDone) { promptPay('bill', billId, onDone); }
function promptPay(kind, id, onDone, occDate) {
  const tg = payTarget(kind, id, occDate);
  if (!tg) return;
  const paidSoFar = targetPaid(tg);
  const prefill = targetRemaining(tg) || tg.expected;
  document.getElementById('modalTitle').textContent = `${t('bill_paid_save_btn')} - ${esc(tg.label)}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('bill_paid_amount_label'), 'bill_paid_amount_hint', true)}</label>
      <input class="input" type="number" id="billPaidAmt" min="0" step="0.01" placeholder="0.00" autocomplete="off"
             value="${prefill > 0 ? prefill.toFixed(2) : ''}">
      <p class="field-hint" id="billPaidHint">${
        paidSoFar > 0 ? tf('pay_already_hint', fmt(paidSoFar), fmt(tg.expected))
        : tg.expected ? tf('bill_paid_budgeted_hint', fmt(tg.expected)) : ''}</p>
    </div>
    <div class="field"><label class="field-label">${t('date')}</label>
      <input class="input" type="date" id="billPaidDate" value="${today()}">
    </div>
    ${paidSoFar > 0 ? `<div class="pay-log">
      <div class="pay-log-title">${t('pay_logged_title')}</div>
      ${targetPayments(tg).map(tx => `<div class="pay-log-row">
        <span>${esc(formatDateDisplay(tx.date))}</span><b>${fmt(tx.amount)}</b>
        <button class="pay-log-del" type="button" data-pay-del="${tx.id}"
                title="${esc(t('pay_remove_aria'))}" aria-label="${esc(t('pay_remove_aria'))}">\u00d7</button>
      </div>`).join('')}
    </div>` : ''}
    <div class="tx-error" id="billPaidErr" hidden></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="billPaidSaveBtn">${t('mod_mark_paid')}</button>
      <button class="btn btn-ghost btn-sm" id="billPaidCancelBtn">${t('cancel')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  initFieldTips(document.getElementById('modalBody'));
  setTimeout(() => document.getElementById('billPaidAmt')?.focus(), 50);
  const amtEl = document.getElementById('billPaidAmt');
  const hintEl = document.getElementById('billPaidHint');
  const saveEl = document.getElementById('billPaidSaveBtn');
  const baseHint = hintEl ? hintEl.innerHTML : '';
  // The button has to say what it is about to do. Anything short of the
  // remainder leaves the row open, so it stops claiming to mark it paid.
  const syncPayHint = () => {
    const amt = parseFloat(amtEl?.value);
    const short = tg.expected > 0 && amt > 0 && !targetSettles(tg, amt);
    if (saveEl) saveEl.textContent = short ? t('pay_save_partial') : t('mod_mark_paid');
    if (!hintEl) return;
    hintEl.classList.toggle('field-hint--warn', short);
    hintEl.innerHTML = short
      ? tf('pay_partial_hint', fmt(payRound2(tg.expected - paidSoFar - amt)), esc(tg.label))
      : baseHint;
  };
  syncPayHint();
  amtEl?.addEventListener('input', () => {
    amtEl.classList.remove('fk-invalid');
    const e = document.getElementById('billPaidErr'); if (e) e.hidden = true;
    syncPayHint();
  });
  document.getElementById('modalBody').querySelectorAll('[data-pay-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('tutorialOverlay').hidden = true;
      removeTargetPayment(tg, btn.dataset.payDel, onDone);
    });
  });
  document.getElementById('billPaidSaveBtn')?.addEventListener('click', () => {
    // Marking a bill paid writes a transaction, so it has to respect the same
    // trial cap as every other way of adding one.
    if (trialBlocks('transaction')) {
      document.getElementById('tutorialOverlay').hidden = true;
      showUpgradeModal({ reason: 'transaction' });
      return;
    }
    const amt = parseFloat(amtEl?.value);
    if (!(amt > 0)) {
      amtEl?.classList.add('fk-invalid');
      const e = document.getElementById('billPaidErr'); if (e) { e.textContent = t('tx_error_required'); e.hidden = false; }
      return;
    }
    const date = document.getElementById('billPaidDate')?.value || today();
    // What the dashboard needs to show this payment settling: what it was,
    // how much went, and how much was still owed before it went.
    _lastPay = { at: Date.now(), key: tg.kind + ':' + tg.id, label: tg.label, amt, owe: targetRemaining(tg), expected: tg.expected };
    const tx = { id: uid(), date, type: tg.txType, category: tg.category, amount: amt, description: '' };
    state.transactions.push(tx); noteAdded(tx);
    trialUse('transaction');
    if (tg.row) setRowPayments(tg.row, rowPayTxIds(tg.row).concat(tx.id));
    saveState();
    document.getElementById('tutorialOverlay').hidden = true;
    onDone();
    showUndoToast(t('toast_bill_marked_paid'));
  });
  document.getElementById('billPaidCancelBtn')?.addEventListener('click', () => { document.getElementById('tutorialOverlay').hidden = true; });
}
// Unticking a bill undoes the whole thing: every transaction it created goes
// with it, including the parts of a payment made in instalments.
// Keeps bill "paid" status honest whenever a transaction is removed through any
// of the several delete paths (single delete, bulk delete, clear all, edit-modal
// delete) - a bill linked to a since-deleted transaction can't stay marked paid.
function syncBillPaidLinks() {
  const byId = new Map(state.transactions.map(tx => [tx.id, tx]));
  // A payment belongs to a bill while it is still a bill payment under that
  // bill's name. Deleted, retyped or moved to another name, it lets go.
  const valid = (b, id) => { const tx = byId.get(id); return !!tx && tx.type === 'bill' && tx.category === b.name; };
  let changed = false;
  (state.bills || []).forEach(b => {
    const ids = rowPayTxIds(b), live = ids.filter(id => valid(b, id));
    if (live.length !== ids.length || !Array.isArray(b.payTxIds)) { setRowPayments(b, live); changed = true; }
    else { const p = live.length > 0 && billSettles(b, 0); if (!!b.paid !== p) { b.paid = p; changed = true; } }
    // A cycle that was settled and rolled on, whose payments no longer
    // cover it, is owed again: the bill steps back to that cycle, and any
    // later payment is counted toward it first.
    const cyc = b.paidCycles || [];
    for (let i = 0; i < cyc.length; i++) {
      const c = cyc[i], cl = c.ids.filter(id => valid(b, id));
      const sum = payRound2(cl.reduce((t, id) => t + (Number(byId.get(id).amount) || 0), 0));
      if (cl.length === c.ids.length && sum >= (c.amount || 0) - 0.005) continue;
      const later = cyc.slice(i + 1).flatMap(x => x.ids).concat(rowPayTxIds(b)).filter(id => valid(b, id));
      b.nextBillingDate = c.due;
      b.lastPaidOn = i > 0 ? cyc[i - 1].due : null;
      b.paidCycles = cyc.slice(0, i);
      setRowPayments(b, cl.concat(later));
      changed = true;
      break;
    }
  });
  return changed;
}

function bindModuleEvents(type,meta,container,act) {
  const TX_TYPE_FOR_MODULE={income:'income',expenses:'expense'};
  container.querySelectorAll(`[data-env-log][data-type="${type}"]`).forEach(btn=>{
    btn.addEventListener('click',()=>{
      const row=(state.budgets[type]||[]).find(r=>r.id===btn.dataset.envLog);
      if(!row)return;
      if(trialBlocks('transaction')){ showUpgradeModal({reason:'transaction'}); return; }
      openQuickAddTx({type:BUD_TX_TYPE[type],category:row.category});
    });
  });
  container.querySelectorAll(`.mod-edit[data-type="${type}"]`).forEach(btn=>{
    btn.addEventListener('click',()=>openEditBudgetRow(type,btn.dataset.id));
  });
  container.querySelectorAll(`.mod-del[data-type="${type}"]`).forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const row=(state.budgets[type]||[]).find(r=>r.id===btn.dataset.id);
      const txCount=row?state.transactions.filter(tx=>tx.type===TX_TYPE_FOR_MODULE[type]&&tx.category===row.category).length:0;
      const message=txCount>0?tf('confirm_remove_cat_with_tx',txCount):t('confirm_remove_cat');
      if(!await confirmDialog({message,confirmText:t('delete')}))return;
      state.budgets[type]=(state.budgets[type]||[]).filter(r=>r.id!==btn.dataset.id);saveState();renderBudget();
    });
  });
  container.querySelectorAll(`.mod-add-btn[data-type="${type}"]`).forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(trialBlocks(type)){ showUpgradeModal({reason:'category',type}); return; }
      openAddBudgetRow(type);
    });
  });
}

// ── TRANSACTIONS ──────────────────────────────────────────────────────
function getCats(txType){const MAP={income:'income',expense:'expenses'};const key=MAP[txType];if(key&&state.budgets[key])return state.budgets[key].map(r=>r.category);if(txType==='debt')return state.debts.map(d=>d.name).filter(Boolean);if(txType==='bill')return state.bills.filter(s=>s.active!==false).map(s=>s.name).filter(Boolean);if(txType==='sinking_fund')return(state.sinkingFunds||[]).map(f=>f.name).filter(Boolean);return[];}
function txTypeLabel(type){return{income:t('tx_type_income'),expense:t('tx_type_expense'),bill:t('tx_type_bill'),savings:t('tx_type_savings'),debt:t('tx_type_debt'),subscription:t('tx_type_subscription'),sinking_fund:t('tx_type_sinking_fund')}[type]||type;}
function renderTxList(){
  const el=document.getElementById('txListWrap');
  if(!el)return;
  if(txSelected.size){const liveIds=new Set(state.transactions.map(tx=>tx.id));txSelected.forEach(id=>{if(!liveIds.has(id))txSelected.delete(id);});}
  let filtered=[...state.transactions];
  const txSeq=new Map(state.transactions.map((tx,i)=>[tx.id,i]));
  if(txFilter.search){const q=txFilter.search.toLowerCase();filtered=filtered.filter(tx=>(tx.category||'').toLowerCase().includes(q)||(tx.description||'').toLowerCase().includes(q));}
  if(txFilter.type)filtered=filtered.filter(tx=>tx.type===txFilter.type);
  if(state.allocation?.enabled&&txFilter.alloc){
    if(txFilter.alloc==='untagged')filtered=filtered.filter(tx=>!tx.allocation&&tx.type!=='income'&&tx.type!=='savings'&&tx.type!=='sinking_fund');
    else filtered=filtered.filter(tx=>tx.allocation===txFilter.alloc);
  }
  switch(txFilter.sort){
    case'date_asc':filtered.sort((a,b)=>a.date.localeCompare(b.date));break;
    case'amount_desc':filtered.sort((a,b)=>b.amount-a.amount);break;
    case'amount_asc':filtered.sort((a,b)=>a.amount-b.amount);break;
    // Newest first, and newest within a date too, so a transaction just
    // added sits at the top of its day rather than under the day's others.
    default:filtered.sort((a,b)=>b.date.localeCompare(a.date)||(txSeq.get(b.id)??0)-(txSeq.get(a.id)??0));
  }
  const total=state.transactions.length,count=filtered.length;
  const totalPages=Math.max(1,Math.ceil(count/TX_PAGE_SIZE));
  if(txPage>=totalPages)txPage=totalPages-1;
  const page=txPage;
  const paged=filtered.slice(page*TX_PAGE_SIZE,(page+1)*TX_PAGE_SIZE);
  const isFiltered=txFilter.search||txFilter.type||(state.allocation?.enabled&&txFilter.alloc);
  const countLabel=isFiltered?t('tx_showing').replace('{n}',count).replace('{total}',total):`${total} ${total===1?t('tx_transaction_one'):t('tx_transaction_many')}`;
  const pagination=count>TX_PAGE_SIZE?`<div class="tx-pagination"><button class="btn btn-ghost btn-sm" id="txPrevBtn" ${page===0?'disabled':''}>${t('tx_prev')}</button><span class="tx-page-label">${t('tx_page_of').replace('{n}',page+1).replace('{total}',totalPages)}</span><button class="btn btn-ghost btn-sm" id="txNextBtn" ${page>=totalPages-1?'disabled':''}>${t('tx_next')}</button></div>`:'';
  const pageIds=paged.map(tx=>tx.id);
  const allPageSelected=pageIds.length>0&&pageIds.every(id=>txSelected.has(id));
  const bulkTagBtns=state.allocation?.enabled?`<span class="tx-bulk-tag-group"><span class="tx-bulk-tag-label">${t('tx_tag_as')}</span>${(state.allocation.buckets||[]).map(b=>`<button class="tx-bulk-tag-btn" data-bucket="${b.id}" type="button" style="--bk:${b.color}">${esc(getAllocBucketDisplayName(b))}</button>`).join('')}</span>`:'';
  const bulkBar=txSelected.size>0?`<div class="tx-bulk-bar">
      <span class="tx-bulk-count">${tf('tx_n_selected',txSelected.size)}</span>
      ${count>txSelected.size?`<button class="link-btn" id="txSelectAllMatching">${tf('tx_select_all_matching',count)}</button>`:''}
      <button class="link-btn" id="txClearSelection">${t('tx_clear_selection')}</button>
      ${bulkTagBtns}
      <button class="btn btn-danger btn-sm" id="txDeleteSelected">${t('tx_delete_selected')}</button>
    </div>`:'';
  // The count and the clear-all live in the toolbar above, which is not
  // rebuilt here, so they are updated rather than reprinted.
  const countEl=document.getElementById('txCount');
  if(countEl)countEl.textContent=countLabel;
  const clearEl=document.getElementById('clearAllBtn2');
  if(clearEl)clearEl.hidden=total===0;
  el.innerHTML=`${bulkBar}
    ${count===0&&total===0
      ?`<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><p class="empty-title">${t('tx_empty')}</p><button class="btn btn-primary btn-sm empty-cta" id="txEmptyAdd" type="button">\u002B ${t('tx_add_title')}</button></div>`
      :count===0
      ?`<div class="empty-state"><div class="empty-icon">\uD83D\uDD0D</div><p>${t('tx_no_results')}</p></div>`
      :`<div class="tx-table-wrap"><table class="tx-table"><thead><tr>
          <th class="tx-sel-col"><label class="check-label"><input type="checkbox" id="txSelectPage" aria-label="${t('tx_select_all_page')}" ${allPageSelected?'checked':''}><span class="checkmark checkmark--sm"></span></label></th>
          <th>${t('tx_date')}</th><th class="col-sm-hide">${t('tx_type')}</th><th>${t('tx_category')}</th>
          <th>${t('tx_th_amount')}</th><th class="col-sm-hide">${t('tx_th_desc')}</th><th class="col-sm-hide">${state.allocation?.enabled?t('alloc_label'):''}</th><th></th>
        </tr></thead><tbody>
        ${paged.map(tx=>`<tr class="tx-row${txSelected.has(tx.id)?' is-selected':''}" data-tx-row="${tx.id}">
          <td class="tx-sel-col"><label class="check-label"><input type="checkbox" class="tx-sel-cb" data-tx="${tx.id}" ${txSelected.has(tx.id)?'checked':''}><span class="checkmark checkmark--sm"></span></label></td>
          <td class="tx-date">${formatDateDisplay(tx.date)}</td>
          <td class="col-sm-hide"><span class="tx-pill tx-pill--${tx.type}">${esc(txTypeLabel(tx.type))}</span></td>
          <td class="tx-cat">${esc(tx.category)}</td>
          <td class="tx-amt tx-amt--${tx.type}">${tx.type==='income'?'+':'\u2212'}${fmt(tx.amount)}</td>
          <td class="tx-desc col-sm-hide">${esc(tx.description||'-')}</td>
          <td class="col-sm-hide">${state.allocation?.enabled&&tx.allocation?`<span class="alloc-badge" style="background:${(state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.color||'#94a3b8'}22;color:${(state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.color||'#94a3b8'};border:1px solid ${(state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.color||'#94a3b8'}44">${esc((state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.name||tx.allocation)}</span>`:''}${tx.type!=='income'&&tx.type!=='savings'&&tx.type!=='sinking_fund'&&state.allocation?.enabled&&!tx.allocation?'<span class="alloc-badge alloc-badge--unset">?</span>':''}</td>
          <td><div class="tx-actions"><button class="edit-btn" data-tx="${tx.id}" title="Edit">\u270f\ufe0f</button><button class="del-btn" data-tx="${tx.id}" title="Delete">\xd7</button></div></td>
        </tr>`).join('')}</tbody></table></div>${pagination}`}`;
  el.querySelectorAll('.edit-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>openEditTx(b.dataset.tx)));
  el.querySelectorAll('.del-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>{const tx=state.transactions.find(t=>t.id===b.dataset.tx);applySinkingFundDelta(tx,-1);state.transactions=state.transactions.filter(t=>t.id!==b.dataset.tx);txSelected.delete(b.dataset.tx);syncBillPaidLinks();saveState();renderTxList();}));
  document.getElementById('txEmptyAdd')?.addEventListener('click',openAddTxFromList);
  document.getElementById('txPrevBtn')?.addEventListener('click',()=>{if(txPage>0){txPage--;renderTxList();}});
  document.getElementById('txNextBtn')?.addEventListener('click',()=>{if(txPage<totalPages-1){txPage++;renderTxList();}});
  document.getElementById('txSelectPage')?.addEventListener('change',e=>{pageIds.forEach(id=>{if(e.target.checked)txSelected.add(id);else txSelected.delete(id);});renderTxList();});
  el.querySelectorAll('.tx-sel-cb[data-tx]').forEach(cb=>cb.addEventListener('change',()=>{if(cb.checked)txSelected.add(cb.dataset.tx);else txSelected.delete(cb.dataset.tx);renderTxList();}));
  document.getElementById('txSelectAllMatching')?.addEventListener('click',()=>{filtered.forEach(tx=>txSelected.add(tx.id));renderTxList();});
  document.getElementById('txClearSelection')?.addEventListener('click',()=>{txSelected.clear();renderTxList();});
  el.querySelectorAll('.tx-bulk-tag-btn[data-bucket]').forEach(btn=>btn.addEventListener('click',()=>{
    const bid=btn.dataset.bucket;let n=0;
    state.transactions.forEach(tx=>{
      // income / savings / savings goal entries aren't taggable (savings map
      // to the Save bucket automatically in computeAllocation)
      if(txSelected.has(tx.id)&&tx.type!=='income'&&tx.type!=='savings'&&tx.type!=='sinking_fund'){tx.allocation=bid;n++;}
    });
    saveState();renderTxList();showToast(tf('tx_tagged_toast',n));
  }));
  document.getElementById('txDeleteSelected')?.addEventListener('click',async()=>{
    if(!await confirmDialog({message:tf('confirm_delete_selected_tx',txSelected.size),confirmText:t('delete')}))return;
    state.transactions.forEach(tx=>{if(txSelected.has(tx.id))applySinkingFundDelta(tx,-1);});
    state.transactions=state.transactions.filter(tx=>!txSelected.has(tx.id));
    txSelected.clear();syncBillPaidLinks();saveState();renderTxList();
  });
}
function renderTransactions() {
  queueNavBadges();
  const el=document.getElementById('bview-transactions');
  const allocEnabled=state.allocation?.enabled;
  // Logging one is the only way in: nothing is added by itself, so every
  // transaction here is one the person says happened.
  el.innerHTML=`<div class="section-header"><h2 class="section-title">${appIconSvg('transactions')} ${t('tab_transactions')}</h2><div class="section-header-actions">${helpBtn('transactions')}<label class="btn btn-primary btn-sm csv-label">${t('tx_import_csv')}<input type="file" id="csvInput" accept=".csv,.pdf,text/csv,application/pdf" style="display:none"></label></div></div>
    <p class="section-desc">${t('tx_page_desc')}</p>
    <div class="panel tx-ways"><div class="panel-inner-sm"><div class="tx-ways-row">
      <div class="tx-way">
        <span class="tx-way-ico" aria-hidden="true">\u270D\uFE0F</span>
        <span class="tx-way-txt"><span class="tx-way-title">${t('tx_add_title')}</span><span class="tx-way-sub">${t('tx_way_manual_sub')}</span></span>
        <span class="tx-way-btns"><button class="btn btn-primary btn-sm" id="txOpenAddBtn" type="button">${t('tx_add_btn')}</button></span>
      </div>
      ${typeof toolOn === 'function' && !toolOn('afford') ? '' : `<div class="tx-way tx-way--afford">
        <span class="tx-way-ico" aria-hidden="true">\uD83D\uDECD\uFE0F</span>
        <span class="tx-way-txt"><span class="tx-way-title">${t('af_title')}</span><span class="tx-way-sub">${t('tx_way_afford_sub')}</span></span>
        <span class="tx-way-btns"><button class="btn btn-primary btn-sm" id="txAffordBtn" type="button">${t('tx_way_afford_btn')}</button></span>
      </div>`}
    </div></div></div>
    <div class="panel tx-panel"><div class="tx-panel-inner">
      <div class="tx-toolbar">
        <span class="tx-toolbar-count" id="txCount"></span>
        <div class="tx-toolbar-fields">
          <input class="input input-sm tx-search" type="search" id="txSearch" placeholder="${esc(t('tx_search_ph'))}" value="${esc(txFilter.search)}" aria-label="${esc(t('tx_search_ph'))}">
          <select class="select select-sm" id="txTypeFilter" aria-label="${esc(t('tx_filter_all_types'))}">
            <option value="">${t('tx_filter_all_types')}</option>
            ${['income','expense','bill','sinking_fund','debt'].map(k=>
              `<option value="${k}"${txFilter.type===k?' selected':''}>${t('tx_type_'+k)}</option>`).join('')}
          </select>
          ${allocEnabled?`<select class="select select-sm" id="txAllocFilter" aria-label="${esc(t('tx_filter_all_alloc'))}">
            <option value="">${t('tx_filter_all_alloc')}</option>
            <option value="untagged"${txFilter.alloc==='untagged'?' selected':''}>${t('alloc_untagged')}</option>
            ${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}"${txFilter.alloc===b.id?' selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}
          </select>`:''}
          <select class="select select-sm" id="txSort" aria-label="${esc(t('tx_sort_date_new'))}">
            <option value="date_desc"${txFilter.sort==='date_desc'?' selected':''}>${t('tx_sort_date_new')}</option>
            <option value="date_asc"${txFilter.sort==='date_asc'?' selected':''}>${t('tx_sort_date_old')}</option>
            <option value="amount_desc"${txFilter.sort==='amount_desc'?' selected':''}>${t('tx_sort_amt_high')}</option>
            <option value="amount_asc"${txFilter.sort==='amount_asc'?' selected':''}>${t('tx_sort_amt_low')}</option>
          </select>
        </div>
        <button class="link-btn tx-clear-all" id="clearAllBtn2" type="button" hidden>${t('tx_clear_all')}</button>
      </div>
      <div id="txListWrap"></div>
    </div></div>`;
  renderTxList();
  document.getElementById('txOpenAddBtn')?.addEventListener('click',openAddTxFromList);
  document.getElementById('txAffordBtn')?.addEventListener('click',()=>openAffordCheck());
  // A bank's export or the planner's own: the importer tells them apart.
  document.getElementById('csvInput')?.addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(f)openBankImport(f,{via:'tx'});});
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
  initFieldTips(el);
  // The filters sit outside #txListWrap on purpose: the list is rebuilt on
  // every keystroke, and a search box inside it would lose focus each time.
  document.getElementById('txSearch')?.addEventListener('input',e=>{txFilter.search=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txTypeFilter')?.addEventListener('change',e=>{txFilter.type=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txAllocFilter')?.addEventListener('change',e=>{txFilter.alloc=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txSort')?.addEventListener('change',e=>{txFilter.sort=e.target.value;txPage=0;renderTxList();});
  document.getElementById('clearAllBtn2')?.addEventListener('click',async()=>{
    if(!await confirmDialog({message:t('confirm_delete_all_tx'),confirmText:t('delete')}))return;
    state.transactions.forEach(tx=>applySinkingFundDelta(tx,-1));
    state.transactions=[];txSelected.clear();syncBillPaidLinks();saveState();renderTransactions();
  });
}
// The trial gate belongs on the door: the form should not open only to refuse.
function openAddTxFromList(){
  if(trialBlocks('transaction')){ showUpgradeModal({reason:'transaction'}); return; }
  openQuickAddTx();
}
// Adjust a savings goal's currentSaved when a sinking_fund tx is added (+1) or removed (-1)
// Transactions file by name, so a rename carries them with
// it. Without this a renamed bill, goal or debt loses its history: its
// payments stop counting toward it and it reads as unpaid.
function renameTxCategory(txType, oldName, newName) {
  if (!oldName || oldName === newName) return;
  (state.transactions || []).forEach(tx => { if (tx.type === txType && tx.category === oldName) tx.category = newName; });
}
function applySinkingFundDelta(tx, sign) {
  if (tx?.type !== 'sinking_fund') return;
  const fund = (state.sinkingFunds||[]).find(f => f.name === tx.category);
  if (fund) {
    fund.currentSaved = Math.max(0, (fund.currentSaved || 0) + sign * tx.amount);
  }
}
// Reads its fields by id prefix so the Transactions form and the dashboard's
// quick-add modal can share it, allocation and sinking-fund rules included.
// Without a prefix it is the inline form, which is also how the click
// listener calls it: the event it passes has no .prefix, so it falls through.
function addTransaction(opts){
  const o=(opts&&typeof opts.prefix==='string')?opts:{};
  const p=o.prefix||'tx';
  const gid=sfx=>document.getElementById(p+sfx);
  if(trialBlocks('transaction')){ showUpgradeModal({reason:'transaction'}); return false; }
  const date=gid('Date')?.value,
        type=gid('Type')?.value,
        cat=gid('Category')?.value,
        amount=parseFloat(gid('Amount')?.value),
        desc=gid('Desc')?.value?.trim()||'',
        errEl=gid('Error');
  let alloc=gid('Alloc')?.value||'';
  if(!date||!type||!cat||isNaN(amount)||amount<=0){
    // Highlight the actual offending fields, same treatment the allocation
    // check below gives - a bare banner left users hunting for the problem.
    const amtEl=gid('Amount'),catEl=gid('Category'),dateWrap=gid('DateWrap');
    if(amtEl)amtEl.classList.toggle('fk-invalid',isNaN(amount)||amount<=0);
    if(catEl)catEl.classList.toggle('fk-invalid',!cat);
    if(dateWrap)dateWrap.classList.toggle('fk-invalid',!date);
    if(errEl){errEl.textContent=t('tx_error_required');errEl.hidden=false;}
    return false;
  }
  ['Amount','Category','DateWrap'].forEach(sfx=>gid(sfx)?.classList.remove('fk-invalid'));
  if(errEl) errEl.hidden=true;
  const allocRequired=state.allocation?.enabled&&type!=='income'&&type!=='savings'&&type!=='sinking_fund';
  if(allocRequired&&!alloc){
    const sel=gid('Alloc');
    const wrap=gid('AllocWrap');
    if(sel) sel.classList.add('select--error');
    if(wrap&&!wrap.querySelector('.field-error-msg')){
      const msg=document.createElement('span');
      msg.className='field-error-msg'; msg.textContent=t('alloc_required');
      wrap.appendChild(msg);
    }
    return false;
  }
  // sinking_fund: auto-assign to save allocation bucket (runs silently, shows in list)
  if(type==='sinking_fund'&&state.allocation?.enabled){
    const saveB=(state.allocation.buckets||[]).find(b=>b.id==='save');
    if(saveB)alloc=saveB.id;
  }
  const newTx={id:uid(),date,type,category:cat,amount,description:desc,allocation:alloc||null};
  state.transactions.push(newTx); noteAdded(newTx);
  trialUse('transaction');
  applySinkingFundDelta(newTx, +1);
  // Issue 13: auto-advance subscription billing date
  // A bill paid from the log is linked to that bill, the same as one paid
  // from its own row, so it shows as paid and moves on when its date passes.
  if(type==='bill'){
    const bill=(state.bills||[]).find(b=>b.name===cat);
    if(bill) setRowPayments(bill,[...rowPayTxIds(bill),newTx.id]);
  }
  saveState();
  if(o.after){ o.after(); return true; }
  gid('Amount').value='';
  gid('Desc').value='';
  const allocSel=gid('Alloc');
  if(allocSel){allocSel.value='';allocSel.classList.remove('select--error');}
  gid('AllocWrap')?.querySelector('.field-error-msg')?.remove();
  renderTxList();
  showUndoToast(t('toast_tx_added'));
  return true;
}

// ── Quick add, from the dashboard ──────────────────────────────────────
// Its own id prefix, because the Transactions tab's form stays in the DOM
// once that tab has been opened and would otherwise win getElementById.
// prefill lets a caller open this already pointed at one category, which is
// what an envelope's Log button does.
// Logging money, built entirely inside the app: a keypad for the amount,
// chips for the category, and the app's own calendar for the date, so it
// behaves the same on a phone as on a desktop and never hands off to the
// system keyboard or date wheel unless asked to. The hidden qa* fields are
// what addTransaction reads, so every rule it enforces (the trial cap,
// allocation, linking a bill payment, moving a goal's balance) still holds.
const QA_TYPES = ['expense', 'bill', 'sinking_fund', 'debt', 'income'];
const QA_DOTS = ['#22c55e', '#f97316', '#3b82f6', '#ec4899', '#eab308', '#8b5cf6', '#14b8a6', '#f43f5e', '#64748b'];
// ── Can I afford it? ─────────────────────────────────────────────────
// A price in, an answer out, before anything is spent. Every figure is the
// dashboard hero's own sum, so "after" here is what the hero will read once
// it is bought. Logging it goes through the keypad, so it is saved, undone
// and animated on the dashboard exactly like any other expense.
const AF_CHIPS = [100, 500, 1000];
const AF_ICONS = {
  yes:  '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cau:  '<path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
function openAffordCheck() {
  const p = nlDaysInPeriod();
  const c = nlCommitted();
  const free = computeSummary(computeActuals()).leftover - c.total;
  const spentToday = nlSpentToday();
  const freeToday = p.left >= 0 && free > 0 ? Math.max(0, (free + spentToday) / (p.left + 1) - spentToday) : 0;
  // The hero's rate: what is free spread over the days after today.
  const days = Math.max(1, p.left);
  const rateNow = Math.max(0, free) / days;
  const end = state.settings.periodEnd || '';
  const endLbl = formatDateShort(end);
  let nextLbl = '';
  if (end) { const d = new Date(end + 'T00:00:00'); d.setDate(d.getDate() + 1); nextLbl = formatDateShort(toLocalISO(d)); }
  const names = [...new Set((c.items || []).map(i => i.label).filter(Boolean))];
  const billNames = names.slice(0, 3).join(', ') + (names.length > 3 ? ', \u2026' : '');
  const money = v => (v < -0.004 ? '\u2212' : '') + fmt(v);

  document.getElementById('modalTitle').innerHTML = `<span class="af-eyebrow">${esc(t('af_eyebrow'))}</span>${esc(t('af_title'))}`;
  document.getElementById('modalBody').innerHTML = `<div class="af">
    <section class="af-ask">
      <p class="qa-label af-label">${t('af_how_much')}</p>
      <div class="qa-amount af-amount" aria-live="polite"><span class="qa-sym">${esc(SYM)}</span><span class="qa-num" id="afDisplay">0</span></div>
      <div class="qa-quick af-quick">${AF_CHIPS.map(v => `<button class="qa-chip qa-plus" type="button" data-af-plus="${v}">+${esc(SYM)}${v}</button>`).join('')}</div>
      <div class="qa-keys af-keys">${['1','2','3','4','5','6','7','8','9','.','0','back'].map(k =>
        `<button class="qa-key" type="button" data-af-key="${k}" aria-label="${k === 'back' ? esc(t('qa_backspace')) : k}">${k === 'back'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m16 9-5 5"/><path d="m11 9 5 5"/></svg>' : k}</button>`).join('')}</div>
      <button class="link-btn qa-clear af-clear" id="afClear" type="button">${t('qa_clear')}</button>
    </section>
    <section class="af-side">
      <div class="af-out" id="afOut" aria-live="polite"></div>
      <div class="af-actions">
        <button class="btn btn-ghost" id="afNotNow" type="button">${t('af_not_now')}</button>
        <button class="btn btn-primary" id="afLog" type="button" disabled>${t('af_log')}</button>
      </div>
      <p class="af-foot">${t('af_foot')}</p>
    </section>
  </div>`;
  document.getElementById('tutorialOverlay').hidden = false;

  const $ = id => document.getElementById(id);
  let buf = '';
  const amount = () => { const v = parseFloat(buf); return isNaN(v) ? 0 : Math.round(v * 100) / 100; };
  const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AF_ICONS[k]}</svg>`;

  const paint = () => {
    const a = amount();
    const [i, d] = buf.split('.');
    const whole = (parseInt(i || '0', 10) || 0).toLocaleString('en-US');
    $('afDisplay').textContent = buf.includes('.') ? `${whole}.${d || ''}` : whole;
    const log = $('afLog');
    log.disabled = !(a > 0);
    const out = $('afOut');
    if (!(a > 0)) {
      log.textContent = t('af_log');
      out.className = 'af-out is-empty';
      out.innerHTML = `<span class="af-empty-ico">${ico('wait')}</span><p class="af-empty">${t('af_empty')}</p>`;
      return;
    }
    const after = free - a, rateAfter = Math.max(0, after) / days;
    let tone, title, line;
    const facts = [];
    if (freeToday > 0 && a <= freeToday + 0.004) {
      tone = 'yes'; title = t('af_yes'); line = tf('af_yes_line', fmt(freeToday));
      facts.push(['yes', tf('af_left_today', fmt(Math.max(0, freeToday - a)))]);
      if (billNames) facts.push(['yes', tf('af_covered', esc(billNames))]);
    } else if (a <= free + 0.004) {
      // Tight once the daily amount would fall below half of what it is now.
      const tight = rateAfter < rateNow * 0.5;
      tone = 'cau'; title = t(tight ? 'af_tight' : 'af_days');
      line = tf('af_days_line', fmt(rateNow), fmt(rateAfter), endLbl);
      facts.push(['cau', tf('af_less_day', fmt(rateNow - rateAfter), endLbl)]);
      if (tight) facts.push(['cau', t('af_tight_note')]);
      if (billNames) facts.push(['yes', tf('af_covered', esc(billNames))]);
    } else {
      const short = a - Math.max(0, free);
      tone = 'wait'; title = t('af_wait'); line = tf('af_wait_line', fmt(short), nextLbl);
      if (c.total > 0) facts.push(['wait', t('af_dip')]);
      facts.push(['cau', tf('af_save_toward', fmt(Math.ceil(short / 4)))]);
    }
    log.textContent = tone === 'wait' ? t('af_log_anyway') : t('af_log');
    out.className = `af-out af-out--${tone}${after < -0.004 ? ' is-short' : ''}`;
    // Both figures share one size, set by the longer, so they read as a pair.
    const len = Math.max(money(after).length, fmt(rateAfter).length);
    out.innerHTML = `<div class="af-verdict">
        <span class="af-badge">${ico(tone)}</span>
        <span class="af-verdict-txt"><b class="af-title">${title}</b><span class="af-line">${line}</span></span>
      </div>
      <div class="af-tiles" style="--len:${len}">
        <div class="af-tile"><span class="af-tile-k">${t('af_free_after')}</span><b class="af-tile-v" data-af="free">${money(after)}</b><span class="af-tile-now">${tf('af_now', money(free))}</span></div>
        <div class="af-tile"><span class="af-tile-k">${tf('af_day_after', endLbl)}</span><b class="af-tile-v" data-af="rate">${fmt(rateAfter)}</b><span class="af-tile-now">${tf('af_now', fmt(rateNow))}</span></div>
      </div>
      <ul class="af-facts">${facts.map(([k, f]) => `<li class="af-fact af-fact--${k}">${f}</li>`).join('')}</ul>`;
  };

  // The same keypad as + spend: two places after the point, seven digits before it.
  const press = k => {
    if (k === 'back') buf = buf.slice(0, -1);
    else if (k === '.') { if (!buf.includes('.')) buf = (buf || '0') + '.'; }
    else {
      if (buf.includes('.') && buf.split('.')[1].length >= 2) return;
      if (!buf.includes('.') && buf.replace(/^0+/, '').length >= 7) return;
      buf = (buf === '0') ? k : buf + k;
    }
    paint();
  };
  document.querySelectorAll('#modalBody [data-af-key]').forEach(b => b.addEventListener('click', () => { press(b.dataset.afKey); b.blur(); }));
  document.querySelectorAll('#modalBody [data-af-plus]').forEach(b => b.addEventListener('click', () => {
    const v = Math.round((amount() + Number(b.dataset.afPlus)) * 100) / 100;
    if (v >= 1e7) return;
    buf = Number.isInteger(v) ? String(v) : v.toFixed(2);
    paint(); b.blur();
  }));
  $('afClear').addEventListener('click', () => { buf = ''; paint(); });
  // A physical keyboard drives it too, and Enter logs it. The listener lets
  // itself go once this pop-up is no longer on screen.
  const onKey = e => {
    if (!$('afDisplay') || $('tutorialOverlay').hidden) { document.removeEventListener('keydown', onKey); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === '.' || e.key === ',') { e.preventDefault(); press('.'); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
    else if (e.key === 'Enter' && amount() > 0 && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('button'))) { e.preventDefault(); $('afLog').click(); }
  };
  document.addEventListener('keydown', onKey);
  $('afNotNow').addEventListener('click', closeModal);
  $('afLog').addEventListener('click', () => {
    const a = amount();
    if (!(a > 0)) return;
    closeModal();
    openQuickAddTx({ type: 'expense', amount: a });
  });
  paint();
}

function openQuickAddTx(prefill){
  const allocEnabled = !!state.allocation?.enabled;
  let type = (prefill && QA_TYPES.includes(prefill.type)) ? prefill.type : 'expense';
  // "Log again" opens it on an earlier entry's amount and note.
  let buf = (prefill && Number(prefill.amount) > 0) ? String(Math.round(Number(prefill.amount) * 100) / 100) : '';
  let cat = (prefill && prefill.category) || '';
  let alloc = '';
  const today0 = today();

  const titleFor = ty => t('qa_title_' + ty);
  const goFor = ty => t('qa_go_' + ty);
  const amount = () => { const v = parseFloat(buf); return isNaN(v) ? 0 : v; };
  const needsAlloc = ty => allocEnabled && (ty === 'expense' || ty === 'bill' || ty === 'debt');

  document.getElementById('modalTitle').textContent = titleFor(type);
  document.getElementById('modalBody').innerHTML = `<div class="qa">
    <div class="qa-types" role="radiogroup" aria-label="${esc(t('tx_type'))}">${QA_TYPES.filter(ty => typeof qaTypeShown !== 'function' || qaTypeShown(ty, type)).map(ty =>
      `<button class="qa-type${ty === type ? ' is-on' : ''}" type="button" role="radio" aria-checked="${ty === type}" data-qa-type="${ty}">${esc(t('qa_type_' + ty))}</button>`).join('')}</div>
    <div class="qa-grid">
      <section class="qa-pad">
        <div class="qa-amount" aria-live="polite"><span class="qa-sym">${esc(SYM)}</span><span class="qa-num" id="qaDisplay">0</span></div>
        <div class="qa-quick">${[1, 5, 10, 20].map(v => `<button class="qa-chip qa-plus" type="button" data-qa-plus="${v}">+${esc(SYM)}${v}</button>`).join('')}</div>
        <div class="qa-keys">${['1','2','3','4','5','6','7','8','9','.','0','back'].map(k =>
          `<button class="qa-key" type="button" data-qa-key="${k}" aria-label="${k === 'back' ? esc(t('qa_backspace')) : k}">${k === 'back'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m16 9-5 5"/><path d="m11 9 5 5"/></svg>' : k}</button>`).join('')}</div>
        <button class="link-btn qa-clear" id="qaClear" type="button">${t('qa_clear')}</button>
      </section>
      <section class="qa-side">
        <p class="qa-label" id="qaCatLabel"></p>
        <div class="qa-cats" id="qaCats"></div>
        <div class="qa-alloc" id="qaAllocWrap" hidden><p class="qa-label">${t('alloc_label')}</p><div class="qa-cats" id="qaAllocChips"></div><input type="hidden" id="qaAlloc" value=""></div>
        <div class="qa-meta">
          <button class="qa-chip qa-meta-chip" id="qaDateWrap" type="button"><svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.2" y="4.9" width="17.6" height="15.9" rx="2.4"/><path d="M16 3.2v3.5"/><path d="M8 3.2v3.5"/><path d="M3.2 10.2h17.6"/></svg><span id="qaDateLabel"></span></button>
          <input type="date" id="qaDate" value="${today0}" class="qa-hidden-date" tabindex="-1" aria-hidden="true">
          <button class="qa-chip qa-meta-chip" id="qaNoteChip" type="button"><svg class="app-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>${t('qa_add_note')}</button>
        </div>
        <input class="input qa-note" type="text" id="qaDesc" maxlength="120" placeholder="${esc(t('tx_desc_ph'))}" hidden>
        <p class="qa-after" id="qaAfter" hidden></p>
        <div class="tx-error" id="qaError" hidden></div>
      </section>
    </div>
    <div class="qa-actions">
      <button class="btn btn-ghost" id="qaCancelBtn" type="button">${t('cancel')}</button>
      <button class="btn btn-ghost" id="qaAgainBtn" type="button">${t('qa_again')}</button>
    </div>
    <button class="btn btn-primary qa-go" id="qaSaveBtn" type="button"></button>
    <input type="hidden" id="qaType" value="${type}">
    <input type="hidden" id="qaCategory" value="">
    <input type="hidden" id="qaAmount" value="">
  </div>`;
  document.getElementById('tutorialOverlay').hidden = false;

  const $ = id => document.getElementById(id);
  const hideErr = () => { const e = $('qaError'); if (e) e.hidden = true; };

  // ── The amount ──
  const paint = () => {
    const [i, d] = buf.split('.');
    const whole = (parseInt(i || '0', 10) || 0).toLocaleString('en-US');
    $('qaDisplay').textContent = buf.includes('.') ? `${whole}.${d || ''}` : whole;
    $('qaAmount').value = buf;
    const a = amount();
    $('qaSaveBtn').textContent = a > 0 ? `${goFor(type)} ${fmt(a)}` : goFor(type);
    // What is left to spend once this is gone. Only for everyday spending:
    // a bill or a debt payment is already counted as spoken for, so paying
    // it leaves this figure where it was.
    const after = $('qaAfter');
    if (type === 'expense' && a > 0) {
      const free = computeSummary(computeActuals()).leftover - nlCommitted().total - a;
      const left = nlDaysInPeriod().left + 1;
      after.textContent = tf('qa_after', fmt(free), formatDateShort(state.settings.periodEnd), fmt(Math.max(0, free) / Math.max(1, left)));
      after.classList.toggle('is-short', free < 0);
      after.hidden = false;
    } else after.hidden = true;
  };
  const press = k => {
    hideErr();
    if (k === 'back') buf = buf.slice(0, -1);
    else if (k === '.') { if (!buf.includes('.')) buf = (buf || '0') + '.'; }
    else {
      if (buf.includes('.') && buf.split('.')[1].length >= 2) return;
      if (!buf.includes('.') && buf.replace(/^0+/, '').length >= 7) return;
      buf = (buf === '0') ? k : buf + k;
    }
    paint();
  };
  document.querySelectorAll('#modalBody [data-qa-key]').forEach(b => b.addEventListener('click', () => {
    press(b.dataset.qaKey);
    // Handed back to the page, so Enter saves rather than pressing this key
    // a second time.
    b.blur();
  }));
  document.querySelectorAll('#modalBody [data-qa-plus]').forEach(b => b.addEventListener('click', () => {
    hideErr();
    const v = Math.round((amount() + Number(b.dataset.qaPlus)) * 100) / 100;
    buf = Number.isInteger(v) ? String(v) : v.toFixed(2);
    paint(); b.blur();
  }));
  $('qaClear').addEventListener('click', () => { buf = ''; paint(); });
  // A physical keyboard drives the same keypad. The listener lets itself go
  // once this modal is no longer on screen.
  const onKey = e => {
    if (!$('qaDisplay') || $('tutorialOverlay').hidden) { document.removeEventListener('keydown', onKey); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === '.' || e.key === ',') { e.preventDefault(); press('.'); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
  };
  document.addEventListener('keydown', onKey);

  // ── The category ──
  const paintCats = () => {
    const names = getCats(type);
    $('qaCatLabel').textContent = names.length ? t('qa_tap_cat') : t('qa_no_cats_' + type);
    const chips = names.map((n, i) =>
      `<button class="qa-chip qa-cat${n === cat ? ' is-on' : ''}" type="button" data-qa-cat="${esc(n)}"><span class="qa-dot" style="background:${QA_DOTS[i % QA_DOTS.length]}"></span>${esc(n)}</button>`);
    // Spending that does not fit anywhere yet can still be logged, and
    // sorted into a category later from the transaction list.
    if (type === 'expense') chips.push(`<button class="qa-chip qa-cat qa-cat--later${cat === t('qa_uncat') ? ' is-on' : ''}" type="button" data-qa-cat="${esc(t('qa_uncat'))}">${esc(t('qa_uncat_chip'))}</button>`);
    $('qaCats').innerHTML = chips.join('');
    if (cat && !names.includes(cat) && cat !== t('qa_uncat')) cat = '';
    $('qaCategory').value = cat;
    document.querySelectorAll('#qaCats [data-qa-cat]').forEach(b => b.addEventListener('click', () => {
      cat = b.dataset.qaCat; $('qaCategory').value = cat; hideErr();
      document.querySelectorAll('#qaCats .qa-cat').forEach(x => x.classList.toggle('is-on', x === b));
    }));
    // Need or want, where the allocation split asks for it.
    const wrap = $('qaAllocWrap');
    wrap.hidden = !needsAlloc(type);
    if (!wrap.hidden) {
      $('qaAllocChips').innerHTML = (state.allocation.buckets || []).filter(b => b.id !== 'save').map(b =>
        `<button class="qa-chip qa-bucket${b.id === alloc ? ' is-on' : ''}" type="button" data-qa-alloc="${b.id}"><span class="qa-dot" style="background:${b.color}"></span>${esc(getAllocBucketDisplayName(b))}</button>`).join('');
      document.querySelectorAll('#qaAllocChips [data-qa-alloc]').forEach(b => b.addEventListener('click', () => {
        alloc = b.dataset.qaAlloc; $('qaAlloc').value = alloc; hideErr();
        wrap.querySelector('.field-error-msg')?.remove();
        document.querySelectorAll('#qaAllocChips .qa-bucket').forEach(x => x.classList.toggle('is-on', x === b));
      }));
    }
    $('qaAlloc').value = needsAlloc(type) ? alloc : '';
  };

  // ── The type ──
  document.querySelectorAll('#modalBody [data-qa-type]').forEach(b => b.addEventListener('click', () => {
    type = b.dataset.qaType; $('qaType').value = type;
    document.querySelectorAll('#modalBody .qa-type').forEach(x => {
      const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on);
    });
    document.getElementById('modalTitle').textContent = titleFor(type);
    cat = ''; hideErr(); paintCats(); paint();
  }));

  // ── The date and the note ──
  const paintDate = () => {
    const v = $('qaDate').value || today0;
    const y = toLocalISO(new Date(Date.now() - 86400000));
    $('qaDateLabel').textContent = v === today0 ? t('cu_today_cap') : v === y ? t('cu_yesterday_cap') : formatDateShort(v);
  };
  $('qaDateWrap').addEventListener('click', () => openDatePicker($('qaDate'), $('qaDateWrap')));
  $('qaDate').addEventListener('change', () => { paintDate(); $('qaDateWrap').classList.remove('fk-invalid'); });
  $('qaNoteChip').addEventListener('click', () => {
    const n = $('qaDesc'); n.hidden = false; $('qaNoteChip').hidden = true; n.focus();
  });

  // ── Saving ──
  const save = again => addTransaction({ prefix: 'qa', after: () => {
    showUndoToast(t('toast_tx_added'));
    if (!again) {
      const go = $('qaSaveBtn');
      go.disabled = true; go.classList.add('is-done'); go.innerHTML = DD_TICK;
      setTimeout(() => { closeModal(); if (currentTab !== 'settings') dispatchRender(currentTab); }, ddReduced() ? 0 : 460);
      return;
    }
    if (currentTab !== 'settings') dispatchRender(currentTab);
    // Ready for the next one: same type and day, fresh amount and category.
    buf = ''; cat = ''; $('qaDesc').value = '';
    paintCats(); paint();
  }});
  $('qaSaveBtn').addEventListener('click', () => save(false));
  $('qaAgainBtn').addEventListener('click', () => save(true));
  $('qaCancelBtn').addEventListener('click', closeModal);

  // Every chip and key lets go of focus once tapped, so Enter saves the
  // entry instead of pressing whatever was tapped last a second time.
  $('modalBody').addEventListener('click', e => {
    const hit = e.target.closest('.qa-chip, .qa-type, .qa-key');
    if (hit) hit.blur();
  });

  if (prefill && prefill.description) {
    $('qaDesc').value = prefill.description; $('qaDesc').hidden = false; $('qaNoteChip').hidden = true;
  }
  paintCats(); paintDate(); paint();
}

// The heading button on wide screens, the floating one on narrow. Both open
// the same modal; CSS decides which is visible.
function dashLogControlsHtml(){
  return `<button class="btn btn-primary btn-sm dash-log-btn" id="dashLogBtn" type="button">\u002B ${t('tx_add_btn')}</button>`;
}
function dashFabHtml(){
  return `<button class="dash-fab" id="dashFab" type="button"
    title="${esc(t('tx_add_title'))}" aria-label="${esc(t('tx_add_title'))}">\u002B</button>`;
}
function wireDashLog(scope){
  scope.querySelector('#dashLogBtn')?.addEventListener('click',openQuickAddTx);
  scope.querySelector('#dashFab')?.addEventListener('click',openQuickAddTx);
}
function openEditTx(txId){
  const tx=state.transactions.find(t=>t.id===txId);if(!tx)return;
  document.getElementById('modalTitle').textContent=t('tx_edit_title');
  document.getElementById('modalBody').innerHTML=`
    <div class="field"><label class="field-label">${t('tx_date')}</label>${styledDateField('editDate','editDateWrap',tx.date)}</div>
    <div class="field"><label class="field-label">${t('tx_type')}</label><select class="select" id="editType">
      <option value="expense" ${tx.type==='expense'?'selected':''}>${t('tx_type_expense')}</option>
      <option value="bill" ${tx.type==='bill'?'selected':''}>${t('tx_type_bill')}</option>
      <option value="savings" ${tx.type==='savings'?'selected':''}>${t('tx_type_savings')}</option>
      <option value="sinking_fund" ${tx.type==='sinking_fund'?'selected':''}>${t('tx_type_sinking_fund')}</option>
      <option value="debt" ${tx.type==='debt'?'selected':''}>${t('tx_type_debt')}</option>
      <option value="income" ${tx.type==='income'?'selected':''}>${t('tx_type_income')}</option>
    </select></div>
    <div class="field"><label class="field-label">${t('tx_category')}</label><select class="select" id="editCategory"></select></div>
    <div class="field"><label class="field-label">${t('tx_amount')} (${SYM})</label><input class="input" type="number" id="editAmount" min="0" step="0.01" value="${tx.amount}"></div>
    <div class="field"><label class="field-label">${t('tx_desc_label')}</label><input class="input" type="text" id="editDesc" value="${esc(tx.description||'')}" maxlength="120"></div>
    <div id="editAllocSlot"></div>
    <div class="tx-error" id="editError" hidden></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="saveEditBtn">${t('tx_save_changes')}</button>
      <button class="btn btn-ghost btn-sm" id="cancelEditBtn">${t('cancel')}</button>
      <button class="btn btn-danger btn-sm" id="deleteEditBtn">${t('delete')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  bindDateField('editDate','editDateWrap');
  const allocApplies=type=>state.allocation?.enabled&&type!=='income'&&type!=='savings'&&type!=='sinking_fund';
  const syncAllocField=()=>{
    const type=document.getElementById('editType')?.value;
    const slot=document.getElementById('editAllocSlot');
    if(!slot)return;
    if(!allocApplies(type)){slot.innerHTML='';return;}
    // Keep whatever the user already picked when they flip between two
    // spending types, rather than resetting the tag on every change.
    const current=document.getElementById('editAlloc')?.value ?? (tx.allocation||'');
    slot.innerHTML=`<div class="field" id="editAllocWrap"><label class="field-label">${t('alloc_label')} <span class="required-star" aria-hidden="true">*</span></label><select class="select" id="editAlloc"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}" ${current===b.id?'selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select></div>`;
  };
  const fillCats=()=>{const type=document.getElementById('editType')?.value,sel=document.getElementById('editCategory'),cats=getCats(type);if(sel)sel.innerHTML=cats.map(c=>`<option value="${esc(c)}" ${c===tx.category?'selected':''}>${esc(c)}</option>`).join('')||'<option value="">- no categories -</option>';syncAllocField();};
  fillCats();document.getElementById('editType')?.addEventListener('change',fillCats);
  document.getElementById('editAlloc')?.addEventListener('change', () => {
    document.getElementById('editAlloc')?.classList.remove('select--error');
    document.getElementById('editAllocWrap')?.querySelector('.field-error-msg')?.remove();
  });
  const showEditError=msg=>{const el=document.getElementById('editError');if(el){el.textContent=msg;el.hidden=false;}};
  // Any edit clears a stale message, so the error always describes the
  // attempt the user is looking at rather than the previous one.
  ['input','change'].forEach(ev=>document.getElementById('modalBody')?.addEventListener(ev,()=>{
    const el=document.getElementById('editError');if(el)el.hidden=true;
  }));
  document.getElementById('saveEditBtn')?.addEventListener('click',()=>{
    const date=document.getElementById('editDate')?.value,
          type=document.getElementById('editType')?.value,
          cat=document.getElementById('editCategory')?.value,
          amount=parseFloat(document.getElementById('editAmount')?.value),
          desc=document.getElementById('editDesc')?.value?.trim()||'',
          alloc=document.getElementById('editAlloc')?.value||null;
    // An empty category almost always means the type was just switched to
    // one with nothing set up yet (no debts, no funds, no subscriptions), so
    // the select had nothing to offer. This used to return silently, which
    // read as a dead Save button.
    if(!cat){showEditError(getCats(type).length?t('tx_error_required'):t('tx_error_no_cats'));return;}
    if(!date||!type||isNaN(amount)||amount<=0){showEditError(t('tx_error_required'));return;}
    const allocRequired=allocApplies(type);
    if(allocRequired&&!alloc){
      const sel=document.getElementById('editAlloc');
      const wrap=document.getElementById('editAllocWrap');
      if(sel) sel.classList.add('select--error');
      if(wrap&&!wrap.querySelector('.field-error-msg')){
        const msg=document.createElement('span');
        msg.className='field-error-msg'; msg.textContent=t('alloc_required');
        wrap.appendChild(msg);
      }
      return;
    }
    const idx=state.transactions.findIndex(t=>t.id===txId);
    if(idx!==-1){
      applySinkingFundDelta(state.transactions[idx], -1); // reverse old
      // Spread the existing record rather than rebuilding it, so anything the
      // form doesn't show survives an edit.
      const updated={...state.transactions[idx],id:txId,date,type,category:cat,amount,description:desc,allocation:allocRequired?(alloc||null):null};
      state.transactions[idx]=updated;
      applySinkingFundDelta(updated, +1); // apply new
      if(updated.type==='bill'){
        const bill=(state.bills||[]).find(b=>b.name===updated.category);
        const owned=bill&&(rowPayTxIds(bill).includes(txId)||(bill.paidCycles||[]).some(c=>c.ids.includes(txId)));
        if(bill&&!owned) setRowPayments(bill,[...rowPayTxIds(bill),txId]);
      }
      syncBillPaidLinks();
    }
    saveState(); closeModal(); renderTxList(); showToast(t('toast_tx_updated'));
  });
  document.getElementById('cancelEditBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteEditBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_delete_tx'),confirmText:t('delete')}))return;const dtx=state.transactions.find(t=>t.id===txId);applySinkingFundDelta(dtx,-1);state.transactions=state.transactions.filter(t=>t.id!==txId);syncBillPaidLinks();saveState();closeModal();renderTxList();showToast(t('toast_tx_deleted'));});
}
function handleCSV(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{const _pre=new Set(state.transactions.map(x=>x.id));const lines=ev.target.result.split('\n').filter(l=>l.trim()),TYPES=new Set(['income','expense','bill','savings','debt','subscription','sinking_fund']);let imported=0,limitHit=false;for(let i=1;i<lines.length;i++){if(trialBlocks('transaction')){limitHit=true;break;}const parts=lines[i].split(',').map(p=>p.trim().replace(/^"|"$/g,''));if(parts.length<4)continue;const[date,type,category,amtStr,desc='',alloc='']=parts,amount=parseFloat(amtStr);if(!date||!TYPES.has(type)||!category||isNaN(amount)||amount<=0)continue;const tx={id:uid(),date,type,category,amount,description:desc};if(alloc)tx.allocation=alloc;applySinkingFundDelta(tx,+1);state.transactions.push(tx);imported++;}saveState();renderTransactions();if(imported>0){_justAdded=state.transactions.filter(x=>!_pre.has(x.id)).map(x=>x.id);showUndoToast(tf('toast_imported',imported));}e.target.value='';if(limitHit)showUpgradeModal({reason:'transaction'});};reader.readAsText(file);}

// ── DEBT PAYOFF ────────────────────────────────────────────────────────
const AMORTIZING_DEBT_TYPES=['mortgage','student_loan','car_loan','personal_loan'];
function debtTypes(){return{credit_card:t('dtype_credit_card'),student_loan:t('dtype_student_loan'),mortgage:t('dtype_mortgage'),car_loan:t('dtype_car_loan'),personal_loan:t('dtype_personal_loan'),other:t('dtype_other')};}
// ── Lightweight "?" field-info tooltips (same pattern as the hub's plan comparison table) ──
// Builds the inner content of a <label class="field-label field-label--tip">: label text (truncates
// with an ellipsis instead of wrapping), an optional required-star, then the "?" tiny helper on the right.
function tipLabel(text,hintKey,required){
  return `<span class="cc-label-text">${text}</span>${required?' <span class="required-star" aria-hidden="true">*</span>':''}<button class="cc-info" type="button" data-tip="${esc(t(hintKey))}" aria-label="${tf('field_info_aria',text)}">i</button>`;
}
function initFieldTips(container){
  const scope=container||document;
  let tipBtn=null,shownViaHover=false;
  const hideAll=()=>{document.querySelectorAll('.cc-tip-pop').forEach(el=>el.remove());tipBtn=null;shownViaHover=false;};
  const show=(btn,viaHover)=>{
    hideAll();
    const name=btn.parentElement.querySelector('.cc-label-text')?.textContent||'';
    const tipEl=document.createElement('div');
    tipEl.className='cc-tip-pop';
    tipEl.innerHTML=`<div class="cc-tip-head"><span class="cc-tip-dot"></span>${esc(name)}</div><div class="cc-tip-body">${esc(btn.dataset.tip)}</div><span class="cc-tip-arrow"></span>`;
    document.body.appendChild(tipEl);
    tipBtn=btn;shownViaHover=!!viaHover;
    const r=btn.getBoundingClientRect();
    const tw=tipEl.offsetWidth,th=tipEl.offsetHeight;
    const iconCenter=r.left+r.width/2+window.scrollX;
    let left=iconCenter-tw/2;
    const minL=window.scrollX+10,maxL=window.scrollX+window.innerWidth-tw-10;
    left=Math.max(minL,Math.min(left,maxL));
    let top=r.top+window.scrollY-th-11;
    if(r.top-th-11<0){top=r.bottom+window.scrollY+11;tipEl.classList.add('cc-tip-below');}
    else{tipEl.classList.add('cc-tip-above');}
    tipEl.style.left=left+'px';tipEl.style.top=top+'px';
    const arrow=tipEl.querySelector('.cc-tip-arrow');
    let ax=iconCenter-left-6;
    ax=Math.max(14,Math.min(ax,tw-26));
    arrow.style.left=ax+'px';
    requestAnimationFrame(()=>tipEl.classList.add('is-in'));
  };
  scope.querySelectorAll('.cc-info[data-tip]').forEach(btn=>{
    btn.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show(btn,true);});
    btn.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&shownViaHover)hideAll();});
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      if(tipBtn===btn&&document.querySelector('.cc-tip-pop')){
        if(shownViaHover){shownViaHover=false;return;}
        hideAll();return;
      }
      show(btn,false);
    });
    btn.addEventListener('blur',hideAll);
  });
}
document.addEventListener('click',()=>document.querySelectorAll('.cc-tip-pop').forEach(el=>el.remove()));
window.addEventListener('scroll',()=>document.querySelectorAll('.cc-tip-pop').forEach(el=>el.remove()),true);
function openDebtModal(debtId){
  const d=debtId?state.debts.find(x=>x.id===debtId):null,isNew=!d;
  if(isNew&&trialBlocks('debts')){ showUpgradeModal({reason:'debts'}); return; }
  const DT=debtTypes();
  document.getElementById('modalTitle').textContent=isNew?'💳 '+t('dpc_add_debt_title'):'✏️ '+t('dpc_edit_debt_title');
  document.getElementById('modalBody').innerHTML=`
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_th_name'),'dpc_name_hint',true)}</label><input class="input" type="text" id="debtName" placeholder="${t('dpc_name_ph')}" value="${esc(d?.name||'')}"></div>
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_th_type'),'dpc_type_hint',false)}</label><select class="select" id="debtType">${Object.entries(DT).map(([v,l])=>`<option value="${v}" ${(d?.type||'credit_card')===v?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="field-grid">
      <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('dpc_th_balance')} (${SYM})`,'dpc_balance_hint',true)}</label><input class="input" type="number" id="debtBalance" min="0" step="0.01" placeholder="0.00" value="${d?.balance||''}"></div>
      <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('dpc_apr_word')} (%)`,'dpc_apr_hint',false)}</label><input class="input" type="number" id="debtApr" min="0" max="100" step="0.01" placeholder="0.00" value="${d?.interestRate||''}"></div>
    </div>
    <div class="field" id="debtTermRow" style="display:none">
      <label class="field-label field-label--tip">${tipLabel(t('dpc_term_label'),'dpc_term_hint',false)}</label>
      <input class="input" type="number" id="debtTermYears" min="0" step="1" placeholder="30" value="${d?.termMonths?Math.round(d.termMonths/12):''}">
    </div>
    <div class="field" id="debtAmortTypeRow" style="display:none">
      <label class="field-label field-label--tip">${tipLabel(t('dpc_amort_type_label'),'dpc_amort_type_hint',false)}</label>
      <select class="select" id="debtAmortType">
        <option value="equal_payment" ${(d?.amortType||'equal_payment')==='equal_payment'?'selected':''}>${t('dpc_amort_equal_payment')}</option>
        <option value="equal_principal" ${d?.amortType==='equal_principal'?'selected':''}>${t('dpc_amort_equal_principal')}</option>
      </select>
    </div>
    <div class="field" id="debtRateTypeRow" style="display:none">
      <label class="field-label field-label--tip">${tipLabel(t('dpc_rate_type_label'),'dpc_rate_type_hint',false)}</label>
      <select class="select" id="debtRateType">
        <option value="fixed" ${(d?.rateType||'fixed')==='fixed'?'selected':''}>${t('dpc_rate_type_fixed')}</option>
        <option value="arm" ${d?.rateType==='arm'?'selected':''}>${t('dpc_rate_type_arm')}</option>
      </select>
      <div class="field-grid" id="debtArmFieldsRow" style="display:none;margin-top:10px">
        <div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_arm_fixed_years_label'),'dpc_arm_fixed_years_hint',false)}</label><input class="input" type="number" id="debtArmFixedYears" min="0" step="1" placeholder="5" value="${d?.armFixedMonths?Math.round(d.armFixedMonths/12):''}"></div>
        <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('dpc_arm_rate_label')} (%)`,'dpc_arm_rate_hint',false)}</label><input class="input" type="number" id="debtArmRate" min="0" max="100" step="0.01" placeholder="0.00" value="${d?.armAdjustedRate??''}"></div>
      </div>
    </div>
    <div class="field" id="debtEscrowRow" style="display:none">
      <label class="field-label field-label--tip">${tipLabel(`${t('dpc_escrow_label')} (${SYM})`,'dpc_escrow_hint',false)}</label>
      <input class="input" type="number" id="debtEscrow" min="0" step="0.01" placeholder="0.00" value="${d?.escrowMonthly||''}">
      <label class="field-label field-label--tip" style="margin-top:8px">${tipLabel(t('dpc_escrow_mode_label'),'dpc_escrow_mode_hint',false)}</label>
      <select class="select" id="debtEscrowMode">
        <option value="fixed" ${(d?.escrowMode||'fixed')==='fixed'?'selected':''}>${t('dpc_escrow_mode_fixed')}</option>
        <option value="declining" ${d?.escrowMode==='declining'?'selected':''}>${t('dpc_escrow_mode_declining')}</option>
      </select>
    </div>
    <div class="field-grid">
      <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('dpc_th_min')} (${SYM})`,'dpc_min_hint',true)}</label><input class="input" type="number" id="debtMin" min="0" step="0.01" placeholder="0.00" value="${d?.minimumPayment||''}">
        <div id="debtAutoCalcRow" style="display:none;margin-top:6px"><div class="field-hint" id="debtAutoCalcResult"></div><button type="button" class="link-btn" id="debtRecalcBtn" style="display:none">${t('dpc_recalc_link')}</button></div>
      </div>
      <div class="field"><label class="field-label field-label--tip"><span class="cc-label-text">${t('dpc_th_due')}</span><button class="cc-info" type="button" data-tip="${esc(t('debt_due_day_modal_hint'))}" aria-label="${esc(tf('field_info_aria',t('dpc_th_due')))}">i</button></label><input class="input" type="number" id="debtDueDay" min="1" max="31" placeholder="1-31" value="${d?.dueDay||''}"></div>
    </div>
    <div id="debtMinModeRow" style="display:none">
      <div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_min_mode_label'),'dpc_min_mode_hint',false)}</label><select class="select" id="debtMinMode">
        <option value="fixed" ${(d?.minPayMode||'fixed')==='fixed'?'selected':''}>${t('dpc_min_mode_fixed')}</option>
        <option value="percent" ${d?.minPayMode==='percent'?'selected':''}>${t('dpc_min_mode_percent')}</option>
      </select></div>
      <div class="field-grid" id="debtPercentRow" style="display:none">
        <div class="field"><label class="field-label field-label--tip">${tipLabel(t('dpc_min_percent_label'),'dpc_min_percent_hint',false)}</label><input class="input" type="number" id="debtMinPercent" min="0" step="0.1" placeholder="2" value="${d?.minPayPercent||''}"></div>
        <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('dpc_min_floor_label')} (${SYM})`,'dpc_min_floor_hint',false)}</label><input class="input" type="number" id="debtMinFloor" min="0" step="1" placeholder="25" value="${d?.minPayFloor||''}"></div>
      </div>
      <div class="field-hint" id="debtMinCalcHint" style="display:none">${t('dpc_min_calculated_hint')}</div>
    </div>
    <div class="tx-error" id="debtError" hidden></div>
    <div class="edit-tx-actions"><button class="btn btn-primary" id="saveDebtBtn">${isNew?t('dpc_add_debt_title'):t('save')}</button><button class="btn btn-ghost btn-sm" id="cancelDebtBtn">${t('cancel')}</button>${!isNew?`<button class="btn btn-danger btn-sm" id="deleteDebtBtn">${t('delete')}</button>`:''}</div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  const clearDebtErr=()=>{const e=document.getElementById('debtError');if(e)e.hidden=true;};
  ['debtName','debtBalance','debtMin','debtDueDay','debtMinPercent','debtMinFloor'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{document.getElementById(id)?.classList.remove('fk-invalid');clearDebtErr();}));
  document.getElementById('cancelDebtBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteDebtBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_debt'),confirmText:t('delete')}))return;state.debts=state.debts.filter(x=>x.id!==debtId);saveState();closeModal();renderDebt();});
  const refreshMinPreview=()=>{
    if(document.getElementById('debtMinMode')?.value!=='percent')return;
    const bal=parseFloat(document.getElementById('debtBalance')?.value)||0;
    const pct=parseFloat(document.getElementById('debtMinPercent')?.value)||0;
    const floor=parseFloat(document.getElementById('debtMinFloor')?.value)||0;
    const minEl=document.getElementById('debtMin');
    if(minEl)minEl.value=Math.max(floor,bal*pct/100).toFixed(2);
  };
  const updateMinModeFields=()=>{
    const mode=document.getElementById('debtMinMode')?.value||'fixed';
    const percentRow=document.getElementById('debtPercentRow');if(percentRow)percentRow.style.display=mode==='percent'?'':'none';
    const calcHint=document.getElementById('debtMinCalcHint');if(calcHint)calcHint.style.display=mode==='percent'?'':'none';
    const minEl=document.getElementById('debtMin');
    if(minEl){minEl.readOnly=mode==='percent';minEl.classList.toggle('input--muted',mode==='percent');}
    refreshMinPreview();
  };
  const updateRateTypeFields=()=>{
    const rateType=document.getElementById('debtRateType')?.value||'fixed';
    const armRow=document.getElementById('debtArmFieldsRow');if(armRow)armRow.style.display=rateType==='arm'?'':'none';
  };
  const updateDebtTypeFields=()=>{
    const type=document.getElementById('debtType')?.value;
    const isAmortizing=AMORTIZING_DEBT_TYPES.includes(type);
    const termRow=document.getElementById('debtTermRow');if(termRow)termRow.style.display=isAmortizing?'':'none';
    const amortTypeRow=document.getElementById('debtAmortTypeRow');if(amortTypeRow)amortTypeRow.style.display=isAmortizing?'':'none';
    const rateTypeRow=document.getElementById('debtRateTypeRow');if(rateTypeRow)rateTypeRow.style.display=isAmortizing?'':'none';
    const autoCalcRow=document.getElementById('debtAutoCalcRow');if(autoCalcRow)autoCalcRow.style.display=isAmortizing?'':'none';
    const escrowRow=document.getElementById('debtEscrowRow');if(escrowRow)escrowRow.style.display=type==='mortgage'?'':'none';
    const minModeRow=document.getElementById('debtMinModeRow');if(minModeRow)minModeRow.style.display=type==='credit_card'?'':'none';
    updateMinModeFields();
    updateRateTypeFields();
  };
  document.getElementById('debtMinMode')?.addEventListener('change',updateMinModeFields);
  document.getElementById('debtRateType')?.addEventListener('change',updateRateTypeFields);
  ['debtBalance','debtMinPercent','debtMinFloor'].forEach(id=>document.getElementById(id)?.addEventListener('input',refreshMinPreview));
  let minManuallyEdited=!isNew;
  const updateRecalcLinkVisibility=()=>{
    const recalcBtn=document.getElementById('debtRecalcBtn');if(recalcBtn)recalcBtn.style.display=minManuallyEdited?'':'none';
  };
  const recomputeMin=()=>{
    if(minManuallyEdited)return;
    const type=document.getElementById('debtType')?.value;
    const resultEl=document.getElementById('debtAutoCalcResult');
    if(!AMORTIZING_DEBT_TYPES.includes(type)){if(resultEl)resultEl.textContent='';return;}
    const bal=parseFloat(document.getElementById('debtBalance')?.value)||0;
    const apr=parseFloat(document.getElementById('debtApr')?.value)||0;
    const years=parseFloat(document.getElementById('debtTermYears')?.value)||0;
    const amortType=document.getElementById('debtAmortType')?.value||'equal_payment';
    const minEl=document.getElementById('debtMin');
    if(!(bal>0)||!(years>0)){if(resultEl)resultEl.textContent='';return;}
    if(amortType==='equal_principal'){
      const payment=calcDecliningFirstPayment(bal,apr,years*12);
      if(minEl){minEl.value=payment.toFixed(2);minEl.classList.remove('fk-invalid');}
      if(resultEl)resultEl.textContent=tf('dpc_autocalc_done_declining',fmt(payment));
    } else {
      const payment=calcAmortizationPayment(bal,apr,years*12);
      if(minEl){minEl.value=payment.toFixed(2);minEl.classList.remove('fk-invalid');}
      if(resultEl)resultEl.textContent=tf('dpc_autocalc_done',fmt(payment));
    }
  };
  ['debtBalance','debtApr','debtTermYears'].forEach(id=>document.getElementById(id)?.addEventListener('input',recomputeMin));
  document.getElementById('debtAmortType')?.addEventListener('change',recomputeMin);
  document.getElementById('debtMin')?.addEventListener('input',()=>{minManuallyEdited=true;updateRecalcLinkVisibility();});
  document.getElementById('debtRecalcBtn')?.addEventListener('click',()=>{minManuallyEdited=false;recomputeMin();updateRecalcLinkVisibility();});
  document.getElementById('debtType')?.addEventListener('change',()=>{updateDebtTypeFields();recomputeMin();});
  updateDebtTypeFields();
  updateRecalcLinkVisibility();
  recomputeMin();
  initFieldTips(document.getElementById('modalBody'));
  document.getElementById('saveDebtBtn')?.addEventListener('click',()=>{
    const nameEl=document.getElementById('debtName'),balEl=document.getElementById('debtBalance'),minEl=document.getElementById('debtMin'),dueEl=document.getElementById('debtDueDay'),errEl=document.getElementById('debtError');
    const percentEl=document.getElementById('debtMinPercent'),floorEl=document.getElementById('debtMinFloor');
    const name=nameEl?.value.trim(),type=document.getElementById('debtType')?.value,balance=parseFloat(balEl?.value)||0,apr=parseFloat(document.getElementById('debtApr')?.value)||0,dueDay=parseInt(dueEl?.value,10);
    const isAmortizing=AMORTIZING_DEBT_TYPES.includes(type),isCreditCard=type==='credit_card';
    const termYears=parseFloat(document.getElementById('debtTermYears')?.value)||0;
    const escrow=parseFloat(document.getElementById('debtEscrow')?.value)||0;
    const escrowMode=type==='mortgage'?(document.getElementById('debtEscrowMode')?.value||'fixed'):'fixed';
    const minMode=isCreditCard?(document.getElementById('debtMinMode')?.value||'fixed'):'fixed';
    const minPercent=parseFloat(percentEl?.value)||0,minFloor=parseFloat(floorEl?.value)||0;
    const minPay=(isCreditCard&&minMode==='percent')?Math.max(minFloor,balance*minPercent/100):(parseFloat(minEl?.value)||0);
    const rateType=isAmortizing?(document.getElementById('debtRateType')?.value||'fixed'):'fixed';
    const armFixedYearsEl=document.getElementById('debtArmFixedYears');
    const armFixedYears=parseFloat(armFixedYearsEl?.value)||0;
    const armRate=parseFloat(document.getElementById('debtArmRate')?.value)||0;
    [nameEl,balEl,minEl,dueEl,percentEl,floorEl,armFixedYearsEl].forEach(x=>x&&x.classList.remove('fk-invalid'));
    let bad=false;
    if(!name){nameEl?.classList.add('fk-invalid');bad=true;}
    if(!(balance>0)){balEl?.classList.add('fk-invalid');bad=true;}
    if(isCreditCard&&minMode==='percent'){if(!(minPercent>0)&&!(minFloor>0)){percentEl?.classList.add('fk-invalid');bad=true;}}
    else if(!(minPay>0)){minEl?.classList.add('fk-invalid');bad=true;}
    if(!isNaN(dueDay)&&!(dueDay>=1&&dueDay<=31)){dueEl?.classList.add('fk-invalid');bad=true;}
    if(isAmortizing&&rateType==='arm'&&armFixedYears>0&&termYears>0&&armFixedYears>=termYears){armFixedYearsEl?.classList.add('fk-invalid');bad=true;}
    if(bad){if(errEl){errEl.textContent=t('sf_error_required');errEl.hidden=false;}return;}
    if(errEl)errEl.hidden=true;
    let did,debtObj;
    const amortType=isAmortizing?(document.getElementById('debtAmortType')?.value||'equal_payment'):undefined;
    const isArm=isAmortizing&&rateType==='arm'&&armFixedYears>0;
    const fields={name,type,balance,interestRate:apr,minimumPayment:minPay,dueDay:isNaN(dueDay)?'':dueDay,
      termMonths:isAmortizing&&termYears>0?termYears*12:undefined,
      amortType:isAmortizing&&termYears>0?amortType:undefined,
      escrowMonthly:type==='mortgage'&&escrow>0?escrow:undefined,
      escrowMode:type==='mortgage'&&escrow>0?escrowMode:undefined,
      minPayMode:isCreditCard?minMode:undefined,
      minPayPercent:isCreditCard&&minMode==='percent'?minPercent:undefined,
      minPayFloor:isCreditCard&&minMode==='percent'?minFloor:undefined,
      rateType:isArm?'arm':undefined,
      armFixedMonths:isArm?armFixedYears*12:undefined,
      armAdjustedRate:isArm?armRate:undefined};
    if(isNew){did=uid();debtObj={id:did,...fields};state.debts.push(debtObj);trialUse('debts');trackEvent('feature_used',{feature:'debt_added'});}
    else{did=debtId;debtObj=state.debts.find(x=>x.id===debtId);if(debtObj){renameTxCategory('debt',debtObj.name,fields.name);Object.assign(debtObj,fields);Object.keys(fields).forEach(k=>{if(fields[k]===undefined)delete debtObj[k];});}}
    saveState();closeModal();renderDebt();showToast(t(isNew?'toast_debt_added':'toast_debt_updated'));
  });
}
function renderDebt(){
  queueNavBadges();
  const DT=debtTypes(),result=runDebtPayoff(),{method,extraPayment}=state.debtSettings;
  // What the chosen method is worth against the other one, in the only
  // terms that matter here. Running the projection a second time is the
  // honest way to say it: the same engine, the same debts, one setting
  // changed. It also puts the difference on screen, where before the
  // choice looked inert.
  const methodNote=(()=>{
    // With one debt there is no order to choose, so there is nothing to
    // say about the choice.
    if(state.debts.length<2||!result) return '';
    const other=method==='avalanche'?'snowball':'avalanche';
    const keep=state.debtSettings.method;
    let alt=null;
    try{ state.debtSettings={...state.debtSettings,method:other}; alt=runDebtPayoff(); }
    finally{ state.debtSettings={...state.debtSettings,method:keep}; }
    if(!alt) return '';
    // When both methods aim at the debts in the same sequence there is
    // nothing for them to disagree about, and the figures match exactly.
    // That happens often and honestly: the smallest balance is usually the
    // card with the highest rate. Saying only "same result" invites the
    // reader to think the setting is broken, so it says why.
    const sameOrder=JSON.stringify(result.attackOrder)===JSON.stringify(alt.attackOrder);
    const tie=sameOrder;
    const otherName=other==='avalanche'?t('dpc_avalanche'):t('dpc_snowball');
    const mineName=method==='avalanche'?t('dpc_avalanche'):t('dpc_snowball');
    // Positive means the chosen method is ahead, negative means it is behind.
    // Both have to be said: a method that costs more should not be described
    // as making no difference.
    const saved=alt.totalInterest-result.totalInterest;
    const sooner=alt.months-result.months;
    // Under a unit either way is rounding, not a reason to pick.
    const bits=[];
    if(saved>=1){
      bits.push(tf('dpc_saves_interest',fmt(saved),otherName));
    } else if(saved<=-1){
      bits.push(tf('dpc_costs_interest',fmt(-saved),otherName));
    }
    if(sooner>=1) bits.push(tf('dpc_months_sooner',sooner));
    else if(sooner<=-1) bits.push(tf('dpc_months_longer',-sooner));
    const ahead=saved>=1||sooner>=1;
    const verdict=bits.length
      ? `<p class="dcx-verdict${ahead?' is-win':' is-cost'}">${bits.join(' · ')}</p>`
      : `<p class="dcx-verdict">${t(tie ? 'dpc_same_order'
          : (extraPayment > 0 ? 'dpc_same_either_way' : 'dpc_same_no_extra'))}</p>`;
    // Both methods shown against each other, so the difference is a figure
    // to read rather than a claim to trust. The one in force is marked.
    const cell=(name,on,res)=>`<div class="dcx-cell${on?' is-on':''}">
      <span class="dcx-name">${name}</span>
      <strong class="dcx-figure">${fmt(res.totalInterest)}</strong>
      <span class="dcx-sub">${t('dpc_interest_label')} · ${tf('dpc_months_from_now',res.months)}</span>
    </div>`;
    const mine=cell(mineName,true,result), theirs=cell(otherName,false,alt);
    const pair=method==='avalanche'?mine+theirs:theirs+mine;
    return `<div class="dc-compare"><div class="dcx-row">${pair}</div>${verdict}</div>`;
  })();
  const totDebt=state.debts.reduce((s,d)=>s+d.balance,0),totMin=state.debts.reduce((s,d)=>s+d.minimumPayment,0);
  const totEscrow=state.debts.reduce((s,d)=>s+(d.type==='mortgage'?(d.escrowMonthly||0):0),0);
  const totExtra=state.debts.reduce((s,d)=>s+(d.targetedExtra||0),0);
  const el=document.getElementById('bview-debt');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">${appIconSvg('debt')} ${t('dpc_title')}</h2><div class="section-header-actions">${viewToggleBtn('debt')}${helpBtn('debt')}<button class="btn btn-primary btn-sm" id="addDebtBtn" type="button">${t('dpc_add_btn')}</button></div></div>
    <p class="section-desc">${t('dpc_desc')}</p>
    <div class="panel debt-config"><div class="panel-inner-sm">
      <div class="debt-config-row">
        <div class="dc-col dc-col--method">
          <div class="dc-head"><span class="dc-label">${t('dpc_method_label')}</span><span class="dc-hint">${t('dpc_method_hint')}</span></div>
          <div class="method-toggle" role="radiogroup">
            ${[
              ['avalanche','🌊',t('dpc_avalanche'),t('dpc_avalanche_desc')],
              ['snowball','⛄',t('dpc_snowball'),t('dpc_snowball_desc')]
            ].map(([k,icon,name,desc])=>`
              <button class="method-btn${method===k?' is-active':''}" data-method="${k}" type="button" role="radio" aria-checked="${method===k}">
                <span class="method-btn-icon" aria-hidden="true">${icon}</span>
                <span class="method-btn-text">
                  <span class="method-btn-title">${name}</span>
                  <span class="method-btn-desc">${desc}</span>
                </span>
                <span class="method-btn-tick" aria-hidden="true"></span>
              </button>`).join('')}
          </div>
          ${methodNote}
        </div>
        <div class="dc-col dc-col--extra">
          <div class="dc-head"><span class="dc-label">${t('dpc_extra_label')}</span></div>
          <div class="dc-money">
            <span class="dc-money-sym">${SYM}</span>
            <input class="dc-money-input" type="number" id="extraPayment" min="0" step="10" value="${extraPayment||''}" placeholder="0.00" inputmode="decimal">
          </div>
          <div class="dc-hint dc-hint--block">${t('dpc_extra_hint')}</div>
        </div>
      </div>
    </div></div>
    ${state.debts.length===0
      ?`<div class="empty-state"><div class="empty-icon">💳</div><p class="empty-title">${t('dpc_empty_title')}</p><p class="empty-sub">${t('dpc_empty_sub')}</p><button class="btn btn-primary btn-sm empty-cta" id="debtEmptyAdd" type="button">${t('dpc_add_btn')}</button></div>`
      :viewMode('debt')==='list'
      ?`<div class="lv">${state.debts.map(d=>{
        const po=(result?.payoffOrder||[]).find(x=>x.id===d.id);
        return lvRow({ attrs:`data-debt-row="${d.id}"`, ico:appIconSvg('debt'), name:esc(d.name||'-'),
          sub:`${DT[d.type]||esc(d.type)} \u00b7 ${(d.interestRate||0)}% ${t('dpc_apr_word')} \u00b7 ${fmt(d.minimumPayment||0)}${t('dpc_mo_suffix')}`,
          bar:null, fig:fmt(d.balance),
          cap: po&&po.paidOffDate&&po.paidOffDate!=='-' ? `${t('dpc_paid_off')} ${po.paidOffDate}` : '',
          acts: lvBtn('',`data-debt-schedule="${d.id}"`,t('dpc_schedule_btn_title'),appIconSvg('calendar'))
            + lvBtn('',`data-debt-edit="${d.id}"`,t('edit'),LV_EDIT) + lvBtn('lv-act--del',`data-debt-id="${d.id}"`,t('delete'),LV_DEL) });
      }).join('')}
      <div class="lv-row lv-total"><span class="lv-ico"></span><span class="lv-main"><span class="lv-name">${t('dpc_totals')}</span><span class="lv-sub">${fmt(totMin)}${t('dpc_mo_suffix')}</span></span><span class="lv-bar"></span><span class="lv-fig">${fmt(totDebt)}</span><span class="lv-acts"></span></div></div>`
      :`<div class="panel" style="margin-bottom:16px"><div class="module-table-wrap"><table class="module-table debt-table"><thead><tr>
          <th>${t('dpc_th_name')}</th><th class="col-sm-hide">${t('dpc_th_type')}</th><th>${t('dpc_th_balance')}<span class="th-cur"> (${SYM})</span></th>
          <th class="col-sm-hide">${t('dpc_th_apr')}</th><th class="col-sm-hide">${t('dpc_th_min')}</th><th class="col-sm-hide" title="${t('dpc_extra_col_hint')}">${t('dpc_th_extra')}</th><th></th>
        </tr></thead><tbody>
        ${state.debts.map(d=>`<tr class="module-row" data-debt-row="${d.id}">
          <td><strong>${esc(d.name)||'<span style="color:var(--text-faint)">-</span>'}</strong></td>
          <td class="col-sm-hide">${DT[d.type]||esc(d.type)}</td>
          <td>${fmt(d.balance)}</td>
          <td class="col-sm-hide">${(d.interestRate||0)}%${d.rateType==='arm'?`<div class="field-hint" style="margin:2px 0 0">${tf('dpc_arm_caption',Math.round((d.armFixedMonths||0)/12))}</div>`:''}</td>
          <td class="col-sm-hide">${fmt(d.minimumPayment)}${d.minPayMode==='percent'?`<div class="field-hint" style="margin:2px 0 0">${tf('dpc_min_pct_caption',d.minPayPercent||0)}</div>`:d.amortType==='equal_principal'?`<div class="field-hint" style="margin:2px 0 0">${t('dpc_declining_caption')}</div>`:''}</td>
          <td class="col-sm-hide"><input class="expected-input" type="number" min="0" step="10" value="${d.targetedExtra||''}" placeholder="0.00" data-debt-extra="${d.id}"></td>
          <td><div class="tx-actions"><button class="edit-btn" data-debt-schedule="${d.id}" type="button" title="${t('dpc_schedule_btn_title')}" aria-label="${t('dpc_schedule_btn_title')}">ℹ️</button><button class="edit-btn" data-debt-edit="${d.id}" type="button" title="${t('edit')}" aria-label="${t('edit')}">✏️</button><button class="del-btn" data-debt-id="${d.id}" type="button" title="${t('delete')}" aria-label="${t('delete')}">×</button></div></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr class="total-row"><td><strong>${t('dpc_totals')}</strong></td><td class="col-sm-hide"></td><td><strong>${fmt(totDebt)}</strong></td><td class="col-sm-hide"></td><td class="col-sm-hide"><strong>${fmt(totMin)}${t('dpc_mo_suffix')}</strong></td><td class="col-sm-hide"><strong>${fmt(totExtra)}${t('dpc_mo_suffix')}</strong></td><td></td></tr></tfoot>
      </table></div></div>`}
    ${state.debts.length>0&&result?`<div class="debt-results">
      <div class="debt-results-cards">
        <div class="dr-card dr-card--green"><div class="dr-label">${t('dpc_debt_free_label')}</div><div class="dr-value">${formatDateDisplay(result.debtFreeDate)}</div><div class="dr-sub">${tf('dpc_months_from_now',result.months)}</div></div>
        <div class="dr-card dr-card--red"><div class="dr-label">${t('dpc_interest_label')}</div><div class="dr-value">${fmt(result.totalInterest)}</div><div class="dr-sub">${t('dpc_on_top')} ${fmt(totDebt)} ${t('dpc_principal')}</div></div>
        <div class="dr-card dr-card--blue"><div class="dr-label">${t('dpc_monthly_label')}</div><div class="dr-value">${fmt(totMin+(extraPayment||0)+totExtra+totEscrow)}</div><div class="dr-sub">${fmt(totMin)} ${t('dpc_min_abbr')} + ${fmt(extraPayment||0)} ${t('dpc_extra_abbr')}${totExtra>0?` + ${tf('dpc_targeted_extra_note',fmt(totExtra))}`:''}${totEscrow>0?` + ${tf('dpc_escrow_note',fmt(totEscrow))}`:''}</div></div>
      </div>
      <div class="panel" style="margin-top:16px"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:4px">${method==='snowball'?t('dpc_payoff_order_sf'):t('dpc_payoff_order_av')}</div>
        ${(()=>{
          // Order the money is aimed in, named. This is the line that moves
          // when the method changes, so it reads before the list does.
          const spare=(extraPayment||0)+totExtra;
          if(spare<=0) return `<p class="po-sub">${t('dpc_focus_none')}</p>`;
          const byId=new Map(state.debts.map(d=>[d.id,d]));
          const names=result.attackOrder.map(id=>esc(byId.get(id)?.name||'')).filter(Boolean);
          return `<p class="po-sub">${tf('dpc_focus_seq',names.join(' <span class="po-arrow">\u2192</span> '))}</p>`;
        })()}
        <div class="payoff-order-list">
        ${result.payoffOrder.map((d,i)=>{
          let termNote='';
          if(d.termMonths>0&&d.paidOffMonth){
            const years=Math.round(d.termMonths/12),diff=d.termMonths-d.paidOffMonth;
            termNote=diff>0?` • ${tf('dpc_term_note_faster',diff,years)}`:diff<0?` • ${tf('dpc_term_note_slower',-diff,years)}`:` • ${tf('dpc_term_note_onschedule',years)}`;
          }
          // Rank in the attack order, which is the method's own answer and
          // the one thing on this card that changes when it is switched.
          const rank=result.attackOrder.indexOf(d.id)+1;
          const focus=rank>0?`<span class="po-focus${rank===1?' is-first':''}" title="${esc(t('dpc_focus_hint'))}">🎯 ${t('dpc_focus_word')} ${rank}</span>`:'';
          return `<div class="payoff-order-row"><span class="po-num">${i+1}</span><div class="po-info"><div class="po-name">${esc(d.name)}${focus}</div><div class="po-detail">${DT[d.type]||d.type} • ${fmt(d.balance)} ${t('dpc_balance_word')} • ${d.interestRate}% ${t('dpc_apr_word')}${termNote}</div></div><div class="po-date">${t('dpc_paid_off')} <strong>${d.paidOffDate}</strong></div></div>`;
        }).join('')}
        </div>
      </div></div>
    </div>`:''}`;
  document.getElementById('addDebtBtn')?.addEventListener('click',()=>openDebtModal(null));
  wireViewToggle(el,'debt',renderDebt);
  document.getElementById('debtEmptyAdd')?.addEventListener('click',()=>openDebtModal(null));
  el.querySelectorAll('[data-debt-edit]').forEach(b=>b.addEventListener('click',()=>openDebtModal(b.dataset.debtEdit)));
  el.querySelectorAll('[data-method]').forEach(b=>b.addEventListener('click',()=>{state.debtSettings.method=b.dataset.method;saveState();renderDebt();}));
  document.getElementById('extraPayment')?.addEventListener('change',e=>{state.debtSettings.extraPayment=parseFloat(e.target.value)||0;saveState();renderDebt();});
  el.querySelectorAll('[data-debt-id]').forEach(b=>b.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_debt'),confirmText:t('delete')}))return;state.debts=state.debts.filter(d=>d.id!==b.dataset.debtId);saveState();renderDebt();}));
  el.querySelectorAll('[data-debt-extra]').forEach(inp=>inp.addEventListener('change',()=>{const d=state.debts.find(x=>x.id===inp.dataset.debtExtra);if(d){d.targetedExtra=Math.max(0,parseFloat(inp.value)||0);saveState();renderDebt();}}));
  el.querySelectorAll('[data-debt-schedule]').forEach(b=>b.addEventListener('click',()=>openDebtSchedule(b.dataset.debtSchedule)));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

// ── SINKING FUNDS ─────────────────────────────────────────────────────
const FUND_ICONS=['🏖️','🚗','🏠','💒','✈️','🎓','💻','🏥','🎁','🐾','🌱','⚡','🎵','🏋️','🍽️','💡','🎮','📱','🛒','🚀'];
function renderSinking(){
  queueNavBadges();
  const totMo=state.sinkingFunds.reduce((t,f)=>{const{requiredMonthly}=calcFund(f);return t+requiredMonthly;},0);
  const el=document.getElementById('bview-goals');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">${appIconSvg('sinking')} ${t('tab_sinking')}</h2><div class="section-header-actions">${viewToggleBtn('goals')}${helpBtn('sinking')}<button class="btn btn-primary btn-sm" id="addFundBtn" type="button">${t('sf_add_btn')}</button></div></div>
    <p class="section-desc">${t('sf_desc')}</p>
    ${state.sinkingFunds.length===0
      ?`<div class="empty-state"><div class="empty-icon">🏺</div><p class="empty-title">${t('sf_empty_title')}</p><p class="empty-sub">${t('sf_empty_sub')}</p><button class="btn btn-primary btn-sm empty-cta" id="fundEmptyAdd" type="button">${t('sf_add_btn')}</button></div>`
      :viewMode('goals')==='list'
      ?`<div class="lv">${state.sinkingFunds.map(f=>{
        const c=calcFund(f),has=fundHasTarget(f),p=Math.round(c.pctComplete||0),on=`data-fund="${f.id}"`;
        return lvRow({ attrs:`data-fund-card="${f.id}"`, ico:`<span class="lv-emoji">${f.icon||'\uD83C\uDFFA'}</span>`, name:esc(f.name),
          sub: has ? `${fmt(f.currentSaved||0)} / ${fmt(f.targetAmount)}${f.targetDate?` \u00b7 ${formatDateDisplay(f.targetDate)}`:''}` : `${t('sf_saved_so_far')} \u00b7 ${t('sf_open_ended')}`,
          bar: has ? p : null, barCls: p>=100?'is-in':'',
          fig: has ? `${p}%` : fmt(f.currentSaved||0),
          cap: `${fmt(c.requiredMonthly||0)}${t('sf_per_month')}`,
          acts: lvBtn('sf-add-btn',on,t('sf_add_contribution'),LV_PLUS)+lvBtn('sf-edit-btn',on,t('edit'),LV_EDIT)+lvBtn('lv-act--del sf-del-btn',on,t('delete'),LV_DEL) });
      }).join('')}</div>
      <div class="sf-total-row"><span>${t('sf_total_contrib')}</span><strong>${fmt(totMo)}${t('sf_per_month')}</strong></div>`
      :`<div class="sf-grid">${state.sinkingFunds.map(f=>{
        const{monthsLeft,requiredMonthly,pctComplete}=calcFund(f),p=Math.round(pctComplete);
        const barColor=p>=100?'#10b981':p>=60?'#6366f1':'#fb923c';
        return`<div class="sf-card panel" data-fund-card="${f.id}"><div class="sf-card-inner">
          <div class="sf-card-top"><span class="sf-icon">${f.icon||'🏺'}</span><div class="sf-card-actions">
            <button class="sf-add-btn btn-icon-tiny" data-fund="${f.id}" title="${t('sf_add_btn')}" type="button">+</button>
            <button class="sf-edit-btn btn-icon-tiny" data-fund="${f.id}" title="${t('edit')}" type="button">✏️</button>
            <button class="sf-del-btn btn-icon-tiny del-btn" data-fund="${f.id}" title="${t('delete')}" type="button">×</button>
          </div></div>
          <div class="sf-name">${esc(f.name)}${fundHasTarget(f)&&p>=100?`<span class="sf-goal-badge">🎉 ${t('sf_goal_reached')}</span>`:''}</div>
          ${fundHasTarget(f)
            ?`<div class="sf-amounts"><span class="sf-saved">${fmt(f.currentSaved||0)}</span><span class="sf-divider"> / </span><span class="sf-target">${fmt(f.targetAmount||0)}</span></div>
          <div class="prog-bar-wrap" style="margin:10px 0 5px"><div class="prog-bar" style="width:${p}%;background:${barColor}"></div></div>
          <div class="sf-pct">${p}% ${t('sf_pct_complete')}</div>`
            :`<div class="sf-amounts"><span class="sf-saved">${fmt(f.currentSaved||0)}</span></div>
          <div class="sf-pct">${t('sf_saved_so_far')} \u00b7 ${t('sf_open_ended')}</div>`}
          ${(()=>{if(!f.targetDate)return'';if(p>=100)return`<div class="sf-date sf-complete">${t('sf_target_complete')}</div>`;const td=new Date(f.targetDate+'T00:00:00'),now=new Date();now.setHours(0,0,0,0);const dl=Math.ceil((td-now)/86400000);const cls=dl<0?'sf-date sf-overdue':dl===0?'sf-date sf-today':'sf-date';return`<div class="${cls}">\uD83C\uDFAF ${formatDateDisplay(f.targetDate)}</div>`;})()} 
          <div class="sf-monthly">${t('sf_save_prefix')} ${fmt(requiredMonthly)}${t('sf_per_month')}</div>
          ${fundHasTarget(f)?`<div class="sf-months-left">${tf('sf_mo_left_tpl',monthsLeft)}</div>`:''}
        </div></div>`;
      }).join('')}</div>
      <div class="sf-total-row"><span>${t('sf_total_contrib')}</span><strong>${fmt(totMo)}${t('sf_per_month')}</strong></div>`
    }`;
  document.getElementById('addFundBtn')?.addEventListener('click',()=>openFundModal(null));
  wireViewToggle(el,'goals',renderSinking);
  document.getElementById('fundEmptyAdd')?.addEventListener('click',()=>openFundModal(null));
  el.querySelectorAll('.sf-edit-btn').forEach(b=>b.addEventListener('click',()=>openFundModal(b.dataset.fund)));
  el.querySelectorAll('.sf-del-btn').forEach(b=>b.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_delete_fund'),confirmText:t('delete')}))return;state.sinkingFunds=state.sinkingFunds.filter(f=>f.id!==b.dataset.fund);saveState();renderSinking();}));
  el.querySelectorAll('.sf-add-btn').forEach(b=>b.addEventListener('click',()=>{
    const f=state.sinkingFunds.find(f=>f.id===b.dataset.fund);if(!f)return;
    document.getElementById('modalTitle').textContent=t('sf_add_contribution')+' - '+esc(f.name);
    document.getElementById('modalBody').innerHTML=`<div class="field"><label class="field-label">${t('sf_contribution_label')} (${SYM})</label><input class="input" type="number" id="sfContribAmt" min="0.01" step="0.01" placeholder="0.00"></div><p style="font-size:12px;color:var(--text-faint);margin:4px 0 16px">${t('sf_currently_saved')}: ${fmt(f.currentSaved||0)}</p><div class="edit-tx-actions"><button class="btn btn-primary" id="sfContribSave">${t('sf_add_contribution')}</button><button class="btn btn-ghost btn-sm" id="sfContribCancel">${t('cancel')}</button></div>`;
    document.getElementById('tutorialOverlay').hidden=false;
    setTimeout(()=>document.getElementById('sfContribAmt')?.focus(),50);
    document.getElementById('sfContribSave')?.addEventListener('click',()=>{
      if(trialBlocks('transaction')){ document.getElementById('tutorialOverlay').hidden=true; showUpgradeModal({reason:'transaction'}); return; }
      const amt=parseFloat(document.getElementById('sfContribAmt')?.value);
      if(isNaN(amt)||amt<=0)return;
      const tx={id:uid(),date:today(),type:'sinking_fund',category:f.name,amount:amt,description:f.name,allocation:null};
      if(state.allocation?.enabled){const sb=(state.allocation.buckets||[]).find(b=>b.id==='save');if(sb)tx.allocation=sb.id;}
      state.transactions.push(tx); noteAdded(tx);
      trialUse('transaction');
      applySinkingFundDelta(tx,+1);
      saveState();
      document.getElementById('tutorialOverlay').hidden=true;
      renderSinking();showUndoToast(tf('toast_fund_contrib',fmt(amt),f.name));
    });
    document.getElementById('sfContribCancel')?.addEventListener('click',()=>{document.getElementById('tutorialOverlay').hidden=true;});
  }));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}
function openFundModal(fundId){
  const f=fundId?state.sinkingFunds.find(sf=>sf.id===fundId):null,isNew=!f;
  if(isNew&&trialBlocks('sinkingFunds')){ showUpgradeModal({reason:'sinkingFunds'}); return; }
  let selIcon=f?.icon||FUND_ICONS[0];
  document.getElementById('modalTitle').textContent=isNew?t('sf_modal_new'):t('sf_modal_edit');
  document.getElementById('modalBody').innerHTML=`<div class="field"><label class="field-label field-label--tip">${tipLabel(t('sf_fund_name_label'),'sf_fund_name_hint',true)}</label><input class="input" type="text" id="fundName" placeholder="${t('sf_fund_name_ph')}" value="${esc(f?.name||'')}"></div>
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('sf_icon_label'),'sf_icon_hint',false)}</label><div class="icon-picker">${FUND_ICONS.map(ic=>`<button class="icon-pick-btn${(f?.icon||FUND_ICONS[0])===ic?' is-active':''}" data-icon="${ic}" type="button">${ic}</button>`).join('')}</div></div>
    <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('sf_target_amount_label')} (${SYM})`,'sf_target_amount_hint',true)}</label><input class="input" type="number" id="fundTarget" min="0" step="10" placeholder="0.00" value="${f?.targetAmount||''}"></div>
    <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('sf_currently_saved_label')} (${SYM})`,'sf_currently_saved_hint',false)}</label><input class="input" type="number" id="fundSaved" min="0" step="10" placeholder="0.00" value="${f?.currentSaved||''}"></div>
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('sf_target_date_label'),'sf_target_date_hint',true)}</label>${styledDateField('fundDate','fundDateWrap',f?.targetDate||'')}</div>
    <div class="tx-error" id="fundError" hidden></div>
    <div class="edit-tx-actions"><button class="btn btn-primary" id="saveFundBtn">${isNew?t('sf_create_btn'):t('save')}</button><button class="btn btn-ghost btn-sm" id="cancelFundBtn">${t('cancel')}</button>${!isNew?`<button class="btn btn-danger btn-sm" id="deleteFundBtn">${t('delete')}</button>`:''}</div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  initFieldTips(document.getElementById('modalBody'));
  bindDateField('fundDate','fundDateWrap');
  document.querySelectorAll('.icon-pick-btn').forEach(b=>{b.addEventListener('click',()=>{selIcon=b.dataset.icon;document.querySelectorAll('.icon-pick-btn').forEach(x=>x.classList.toggle('is-active',x.dataset.icon===selIcon));});});
  const clearFundErr=()=>{document.getElementById('fundError')&&(document.getElementById('fundError').hidden=true);};
  ['fundName','fundTarget'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{document.getElementById(id)?.classList.remove('fk-invalid');clearFundErr();}));
  document.getElementById('fundDate')?.addEventListener('change',()=>{document.getElementById('fundDateWrap')?.classList.remove('fk-invalid');clearFundErr();});
  document.getElementById('saveFundBtn')?.addEventListener('click',()=>{
    const nameEl=document.getElementById('fundName'),targetEl=document.getElementById('fundTarget'),dateWrap=document.getElementById('fundDateWrap'),errEl=document.getElementById('fundError');
    const name=nameEl?.value.trim(),target=parseFloat(targetEl?.value)||0,saved=parseFloat(document.getElementById('fundSaved')?.value)||0,date=document.getElementById('fundDate')?.value||'';
    [nameEl,targetEl,dateWrap].forEach(x=>x&&x.classList.remove('fk-invalid'));
    let bad=false;
    if(!name){nameEl?.classList.add('fk-invalid');bad=true;}
    // A goal can be open ended: money set aside with nothing in particular
    // to reach. Only a target needs a date to aim at.
    if(target>0&&!date){dateWrap?.classList.add('fk-invalid');bad=true;}
    if(bad){if(errEl){errEl.textContent=t('sf_error_required');errEl.hidden=false;}return;}
    if(errEl)errEl.hidden=true;
    let fid,fundObj;
    if(isNew){fid=uid();fundObj={id:fid,name,icon:selIcon,targetAmount:target,currentSaved:saved,targetDate:date};state.sinkingFunds.push(fundObj);trialUse('sinkingFunds');trackEvent('feature_used',{feature:'sinking_fund_created'});}
    else{fid=fundId;fundObj=state.sinkingFunds.find(sf=>sf.id===fundId);if(fundObj){renameTxCategory('sinking_fund',fundObj.name,name);fundObj.name=name;fundObj.icon=selIcon;fundObj.targetAmount=target;fundObj.currentSaved=saved;fundObj.targetDate=date;}}
    saveState();closeModal();renderSinking();showToast(t(isNew?'toast_fund_created':'toast_fund_updated'));
  });
  document.getElementById('cancelFundBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteFundBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_delete_fund'),confirmText:t('delete')}))return;state.sinkingFunds=state.sinkingFunds.filter(sf=>sf.id!==fundId);saveState();closeModal();renderSinking();});
}

// ── SMART CALENDAR ─────────────────────────────────────────────────────
function calLocale() {
  return 'en-GB';
}

function renderCalendar(){
  queueNavBadges();
  const loc=calLocale(),now=new Date(),y=calYear,m=calMonth;
  const firstDow=(new Date(y,m,1).getDay()+6)%7,daysInMo=new Date(y,m+1,0).getDate();
  const evs={};
  const addEv=(day,ev)=>{(evs[day]=evs[day]||[]).push(ev);};
  // Bills and subscriptions are one list now, so each appears once, under its
  // own name, paid or not by the payments linked to it.
  for(const b of (state.bills||[]).filter(b=>b.active!==false)){const d=billDueDay(b);if(d&&d<=daysInMo){
    const st=rowPayState(b);
    addEv(d,{type:'bill',id:b.id,label:b.name||b.category,color:'#fb923c',paid:st==='paid',part:st==='partial'?rowPaidAmount(b):0,
             amount:st==='paid'?rowPaidAmount(b):(rowRemaining(b)||rowExpected(b))});
  }}
  // Debts and subscriptions keep no paid flag of their own, so they get a Pay
  // button rather than a tick box that could never be unticked.
  const calAct=computeActuals(), debtAct=calAct.debt||{};
  for(const d of state.debts)if(d.dueDay&&d.dueDay>=1&&d.dueDay<=daysInMo){
    const exp=d.minimumPayment||0, done=subOrDebtPaid(debtAct,d.name);
    addEv(d.dueDay,{type:'debt',id:d.id,label:d.name,color:'#a855f7',expected:exp,
      amount:Math.max(0,payRound2(exp-done))||exp,part:done>0&&done<exp?done:0,settled:exp>0&&done>=exp});
  }
  const monthStr=`${y}-${String(m+1).padStart(2,'0')}`;
  // A transaction created by ticking a bill "paid" is the same money as the
  // bill event above (which already shows the ✓ Paid state + real amount) -
  // listing both made 1 Rent look like 2 charges on the same day.
  const linkedPaidTxIds=new Set((state.bills||[]).flatMap(b=>rowPayTxIds(b)));
  for(const tx of state.transactions)if(tx.date.startsWith(monthStr)&&!linkedPaidTxIds.has(tx.id)){const d=parseInt(tx.date.split('-')[2]);addEv(d,{type:'transaction',label:tx.category,amount:tx.amount,color:'#6366f1'});}
  // Savings goal goal/target dates (milestones)
  for(const f of state.sinkingFunds||[])if(f.targetDate&&f.targetDate.startsWith(monthStr)){const d=parseInt(f.targetDate.split('-')[2]);if(d>=1&&d<=daysInMo)addEv(d,{type:'goal',label:f.name,amount:f.targetAmount||0,color:'#ec4899'});}
  // Locale-formatted month/year for header
  const monthName=new Date(y,m,1).toLocaleDateString(loc,{month:'long',year:'numeric'});
  const isNowMonth=y===now.getFullYear()&&m===now.getMonth();

  // Translated event type labels
  const typeLabel={'bill':t('cal_leg_bill'),'debt':t('cal_leg_debt'),'transaction':t('cal_leg_tx'),'goal':t('cal_leg_goal')};

  // What a calendar row offers. A bill can be ticked and unticked because it
  // stores its own state; everything else can only be paid, and is undone by
  // removing the transaction from the same modal.
  const calEvActionHtml=ev=>{
    if(ev.type==='bill'){
      if(ev.paid) return `<span class="cal-ev-status is-paid">${t('cal_paid')}</span>`;
      const part=ev.part>0?`<span class="cal-ev-status is-part">${tf('nl_partial_of',fmt(ev.part),fmt(ev.part+ev.amount))}</span>`:'';
      return part
        ? `${part}<button class="pay-btn" type="button" data-cal-pay="bill" data-cal-id="${ev.id}">${t('pay_btn')}</button>`
        : `<label class="cal-mark-paid check-label"><input type="checkbox" data-mark-paid-id="${ev.id}"><span class="checkmark checkmark--sm"></span><span>${t('cal_mark_paid')}</span></label>`;
    }
    if(ev.type==='debt'){
      const status=ev.settled?`<span class="cal-ev-status is-paid">${t('cal_paid')}</span>`
        :ev.part>0?`<span class="cal-ev-status is-part">${tf('nl_partial_of',fmt(ev.part),fmt(ev.expected))}</span>`:'';
      return `${status}<button class="pay-btn" type="button" data-cal-pay="${ev.type}" data-cal-id="${ev.id}">${t('pay_btn')}</button>`;
    }
    return '';
  };

  // Build selected day panel
  let selPanel='';
  if(calSelectedDay!==null){
    const dayEvs=evs[calSelectedDay]||[];
    const dayName=`${calSelectedDay} ${new Date(y,m,calSelectedDay).toLocaleDateString(loc,{month:'long'})}`;
    const evCount=dayEvs.length===1?`1 ${t('cal_event_one')}`:`${dayEvs.length} ${t('cal_event_many')}`;
    const evHtml=dayEvs.length===0
      ?`<div class="cal-no-events">${t('cal_no_events_day')}</div>`
      :dayEvs.map(ev=>{
        const statusHtml=calEvActionHtml(ev);
        return `<div class="cal-ev-item"><span class="cal-dot" style="background:${ev.color}"></span><span class="cal-ev-label">${esc(ev.label)}</span><span class="cal-ev-type">${esc(typeLabel[ev.type]||ev.type)}</span><span class="cal-ev-amt">${fmt(ev.amount)}</span>${statusHtml}</div>`;
      }).join('');
    selPanel=`<div class="cal-selected-events" id="calDayEvents"><div class="cal-selected-title">📌 ${esc(dayName)} - ${evCount}<button class="link-btn" id="calClearSel" style="margin-left:12px;font-size:11px">${t('cal_clear')}</button></div>${evHtml}</div>`;
  }

  // Build full month events list
  let monthList='';
  if(Object.keys(evs).length>0){
    monthList=`<div class="cal-events-list"><div class="panel-title-sm" style="margin-bottom:12px">${t('cal_all_events')}${monthName}</div>`;
    Object.entries(evs).sort(([a],[b])=>+a-+b).forEach(([day,dayEvs])=>{
      monthList+=`<div class="cal-ev-day"><div class="cal-ev-date">${day} ${new Date(y,m,+day).toLocaleDateString(loc,{month:'short'})}</div>`;
      dayEvs.forEach(ev=>{
        const statusHtml=calEvActionHtml(ev);
        monthList+=`<div class="cal-ev-item"><span class="cal-dot" style="background:${ev.color}"></span><span class="cal-ev-label">${esc(ev.label)}</span><span class="cal-ev-type">${esc(typeLabel[ev.type]||ev.type)}</span><span class="cal-ev-amt">${fmt(ev.amount)}</span>${statusHtml}</div>`;
      });
      monthList+='</div>';
    });
    monthList+='</div>';
  } else {
    monthList=`<div class="empty-state" style="padding:24px 0"><div class="empty-icon">📅</div><p class="empty-title">${t('cal_no_events_month')}</p><p class="empty-sub">${t('cal_no_events_sub')}</p><button class="btn btn-primary btn-sm empty-cta" id="calEmptyAdd" type="button">\u002B ${t('tx_add_title')}</button></div>`;
  }

  const el=document.getElementById('bview-calendar');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">${appIconSvg('calendar')} ${t('cal_title')}</h2><div class="section-header-actions">${viewToggleBtn('calendar')}${helpBtn('calendar')}</div></div>
    <p class="section-desc">${t('cal_desc')}</p>
    <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="calPrev">${t('cal_prev')}</button><h3 class="cal-month-title">${monthName}</h3><button class="btn btn-ghost btn-sm" id="calNext">${t('cal_next')}</button></div>
    <div class="panel"><div class="cal-grid-wrap"><div class="cal-grid">
      ${[t('mon'),t('tue'),t('wed'),t('thu'),t('fri'),t('sat'),t('sun')].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${Array(firstDow).fill('<div class="cal-cell cal-empty"></div>').join('')}
      ${Array.from({length:daysInMo},(_,i)=>{const day=i+1,dayEvs=evs[day]||[],isToday=isNowMonth&&day===now.getDate(),isSel=calSelectedDay===day;return`<div class="cal-cell${isToday?' cal-today':''}${isSel?' cal-selected':''}" data-day="${day}"><span class="cal-day-num">${day}</span><div class="cal-dots">${dayEvs.slice(0,3).map(e=>`<span class="cal-dot" style="background:${e.color}"></span>`).join('')}${dayEvs.length>3?`<span class="cal-dot-more">+${dayEvs.length-3}</span>`:''}</div></div>`;}).join('')}
    </div></div></div>
    <div class="cal-legend"><span class="cal-leg-item"><span class="cal-dot" style="background:#fb923c"></span>${t('cal_leg_bill')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#a855f7"></span>${t('cal_leg_debt')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#10b981"></span>${t('cal_leg_sub')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#ec4899"></span>${t('cal_leg_goal')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#6366f1"></span>${t('cal_leg_tx')}</span></div>`;

  // Inject selected-day panel and month list as DOM (not template)
  const calList=viewMode('calendar')==='list';
  el.classList.toggle('cal-as-list',calList);
  if(selPanel&&!calList) el.insertAdjacentHTML('beforeend', selPanel);
  el.insertAdjacentHTML('beforeend', monthList);
  wireViewToggle(el,'calendar',renderCalendar);

  el.querySelectorAll('.cal-cell[data-day]').forEach(cell=>{
    cell.addEventListener('click',()=>{
      const day=parseInt(cell.dataset.day);
      calSelectedDay=(calSelectedDay===day)?null:day;
      renderCalendar();
      if(calSelectedDay) requestAnimationFrame(()=>document.getElementById('calDayEvents')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    });
  });
  document.getElementById('calClearSel')?.addEventListener('click',()=>{calSelectedDay=null;renderCalendar();});
  el.querySelectorAll('[data-mark-paid-id]').forEach(cb=>cb.addEventListener('change',()=>{
    cb.checked=false;
    promptMarkBillPaid(cb.dataset.markPaidId,()=>renderCalendar());
  }));
  // Debts, subscriptions and part-paid bills: one button, same modal.
  el.querySelectorAll('[data-cal-pay]').forEach(b=>b.addEventListener('click',()=>{
    promptPay(b.dataset.calPay,b.dataset.calId,()=>renderCalendar(),b.dataset.calDate);
  }));
  document.getElementById('calPrev')?.addEventListener('click',()=>{calMonth--;if(calMonth<0){calMonth=11;calYear--;}calSelectedDay=null;renderCalendar();});
  document.getElementById('calEmptyAdd')?.addEventListener('click',()=>switchTab('transactions'));
  document.getElementById('calNext')?.addEventListener('click',()=>{calMonth++;if(calMonth>11){calMonth=0;calYear++;}renderCalendar();});
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

// ── SUBSCRIPTIONS ──────────────────────────────────────────────────────
const SUB_CATS=['Entertainment','Productivity','Health & Fitness','Food & Drink','Cloud Storage','Finance','Education','Gaming','News & Media','Other'];
const SUB_CAT_KEYS={'Entertainment':'sub_cat_entertainment','Productivity':'sub_cat_productivity','Health & Fitness':'sub_cat_health','Food & Drink':'sub_cat_food','Cloud Storage':'sub_cat_cloud','Finance':'sub_cat_finance','Education':'sub_cat_education','Gaming':'sub_cat_gaming','News & Media':'sub_cat_news','Other':'sub_cat_other'};
function subCatLabel(cat){const k=SUB_CAT_KEYS[cat||'Other'];return k?t(k):(cat||t('sub_cat_other'));}

function renderSubscriptions(){
  queueNavBadges();
  rollBills();
  const el=document.getElementById('bview-bills');
  const active=state.bills.filter(s=>s.active!==false);
  const totMo=active.reduce((t,s)=>t+monthlySubAmt(s),0);
  const totYr=active.reduce((t,s)=>t+annualSubAmt(s),0);
  const byCat={};
  for(const s of active){const c=s.category||'Other';byCat[c]=(byCat[c]||0)+monthlySubAmt(s);}
  const catEntries=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  // One colour per category, worked out once and used by both the chart
  // and the rows, so a subscription in the list carries the same colour as
  // its slice. Paused ones are not in the chart but still need a colour,
  // so they are appended after the ones that are.
  const allCats=[...new Set(state.bills.map(x=>x.category||'Other'))];
  const catOrder=catEntries.map(([c])=>c).concat(allCats.filter(c=>!byCat[c]).sort());
  const catColor={};
  catOrder.forEach((c,i)=>{catColor[c]=COLORS[i%COLORS.length];});
  const subTint=(hex,a)=>{const n=parseInt(hex.slice(1),16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;};
  const catSegs=catEntries.map(([label,value])=>({label:subCatLabel(label),value,color:catColor[label],pct:totMo>0?value/totMo*100:0}));

  // Build summary bar HTML
  // The monthly figure is the one that answers "what is this costing me",
  // so it leads and the rest support it, rather than four numbers of equal
  // weight spread across the width with nothing to look at first.
  const summaryBar = state.bills.length > 0
    ? `<div class="sub-summary">
        <div class="sub-hero">
          <span class="sub-hero-label">${t('sub_sum_monthly')}</span>
          <strong class="sub-hero-value">${fmt(totMo)}</strong>
          <span class="sub-hero-sub">${fmt(totYr)} ${t('sub_sum_annual').toLowerCase()}</span>
        </div>
        <div class="sub-stats">
          <div class="sub-stat"><strong>${active.length}</strong><em>${t('sub_active')}</em></div>
          <div class="sub-stat"><strong>${state.bills.length-active.length}</strong><em>${t('sub_paused')}</em></div>
        </div>
      </div>` : '';

  // Build list HTML
  const listHtml = state.bills.length === 0
    ? `<div class="sub-empty-centered">
        <div class="empty-icon">🔄</div>
        <p class="empty-title" style="font-size:15px;font-weight:600;color:var(--text-primary);margin:0">${t('sub_empty_title')}</p>
        <p class="empty-sub" style="margin:4px 0 0">${t('sub_empty_sub')}</p>
        <button class="btn btn-primary btn-sm empty-cta" id="subEmptyAdd" type="button">${t('sub_add_btn')}</button>
      </div>`
    : state.bills.map(sub => {
        const freqLabel = sub.frequency==='annual'?t('sub_unit_year'):sub.frequency==='quarterly'?t('sub_unit_quarter'):t('sub_unit_month');
        const nextDue = sub.nextBillingDate ? `<span class="sub-due">${t('sub_next_label')}: ${formatDateDisplay(sub.nextBillingDate)}</span>` : '';
        const hist=sub.priceHistory||[];
        let priceDelta='';
        if(hist.length){
          const latest=hist[hist.length-1],up=latest.to>latest.from;
          const tooltip=hist.map(hEntry=>`${formatDateDisplay(hEntry.date)}: ${fmt(hEntry.from)} \u2192 ${fmt(hEntry.to)}`).join(' | ');
          priceDelta=`<span class="sub-price-delta ${up?'is-up':'is-down'}" title="${tooltip}">${up?'\u2191':'\u2193'} ${fmt(Math.abs(latest.to-latest.from))}</span>`;
        }
        const payState=rowPayState(sub);
        const paidSoFar=rowPaidAmount(sub);
        const col=catColor[sub.category||'Other']||COLORS[0];
        const initial=(sub.name||'?').trim().charAt(0).toUpperCase()||'?';
        // The monthly equivalent and any price change share one line under
        // the amount, rather than stacking and making every row taller.
        const under=[sub.frequency!=='monthly'?`<span class="sub-eq">\u2248 ${fmt(monthlySubAmt(sub))}/mo</span>`:'',priceDelta].filter(Boolean).join('');
        return `<div class="sub-row panel${sub.active===false?' is-paused':''}" data-bill-row="${sub.id}" style="--sub-c:${col};--sub-bg:${subTint(col,.16)}">
            <span class="sub-avatar" aria-hidden="true">${esc(initial)}</span>
            <div class="sub-main">
              <div class="sub-name-row">
                <span class="sub-name">${esc(sub.name)}</span>
                ${sub.active===false?`<span class="sub-flag">${t('sub_paused')}</span>`:''}
                ${payState==='paid'?`<span class="sub-flag is-paid">${t('paid')}</span>`
                  :payState==='partial'?`<span class="sub-flag is-part" title="${esc(tf('nl_partial_of',fmt(paidSoFar),fmt(rowExpected(sub))))}">${t('paid_partial')}</span>`:''}
              </div>
              <div class="sub-meta"><span class="sub-cat-pill">${esc(subCatLabel(sub.category))}</span>${nextDue}</div>
            </div>
            <div class="sub-amount-block">
              <div class="sub-amount">${fmt(sub.amount)}<span class="sub-freq">/${freqLabel}</span></div>
              ${under?`<div class="sub-under">${under}</div>`:''}
            </div>
            <div class="sub-card-foot">
              <div class="sub-toggle-rows">
                <span class="mini-toggle" title="${sub.active===false?t('sub_paused'):t('sub_active')}"><span class="mini-toggle-label">${sub.active===false?t('sub_paused'):t('sub_active')}</span><label class="recurring-toggle"><input type="checkbox" class="sub-toggle-cb" data-sub-toggle="${sub.id}" ${sub.active!==false?'checked':''}><span class="rec-toggle-track"></span></label></span>
              </div>
              <div class="sub-btn-row">
                ${payState!=='paid'?`<button class="btn btn-ghost btn-sm sub-pay-btn" data-sub-pay="${sub.id}" type="button">${t('pay_btn')}</button>`:''}
                <button class="sf-edit-btn btn-icon-tiny" data-sub-edit="${sub.id}" type="button" title="${t('edit')}">✏️</button>
                <button class="del-btn" data-sub-del="${sub.id}" type="button" title="${t('delete')}">×</button>
              </div>
            </div>
        </div>`;
      }).join('');

  // Build donut chart HTML
  const chartHtml = catEntries.length > 0
    ? `<div class="panel">
        <div class="panel-inner-sm">
          <div class="panel-title-sm" style="margin-bottom:14px">${t('sub_by_category')}</div>
          <div class="donut-block">
            ${svgDonut(catSegs, 120, 16)}
            <div class="donut-legend">
              ${catSegs.map(s=>`<div class="dleg-row">
                <span class="dleg-swatch" style="background:${s.color}"></span>
                <div class="dleg-stack">
                  <span class="dleg-label">${esc(s.label)}</span>
                  <span class="dleg-sub-amt">${fmt(s.value)}${t('sub_per_month')}</span>
                </div>
              </div>`).join('')}
            </div>
          </div>
        </div>
      </div>` : '';

  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">${appIconSvg('bills')} ${t('tab_subscriptions')}</h2>
      <div class="section-header-actions">
        ${viewToggleBtn('bills')}${helpBtn('subscriptions')}
        <button class="btn btn-primary btn-sm" id="addSubBtn" type="button">${t('sub_add_btn')}</button>
      </div>
    </div>
    <p class="section-desc">${t('sub_desc')}</p>
    ${summaryBar}`;

  // Inject body using DOM to avoid template literal nesting
  if (state.bills.length === 0) {
    el.insertAdjacentHTML('beforeend', listHtml);
  } else if (viewMode('bills') === 'list') {
    // Soonest first, each with its date, what it costs and where it stands.
    const lang = 'en';
    const rows = state.bills.slice().sort((a, b) => String(a.nextBillingDate || '9').localeCompare(String(b.nextBillingDate || '9')));
    el.insertAdjacentHTML('beforeend', `<div class="lv">${rows.map(b => {
      const st = rowPayState(b), paused = b.active === false, due = b.nextBillingDate;
      const unit = b.frequency === 'annual' ? t('sub_unit_year') : b.frequency === 'quarterly' ? t('sub_unit_quarter') : t('sub_unit_month');
      const leaf = due
        ? `<span class="lv-leaf"><b>${parseInt(due.slice(8, 10), 10)}</b><small>${esc(new Date(due + 'T00:00:00').toLocaleString(lang, { month: 'short' }).replace('.', '').toUpperCase())}</small></span>`
        : appIconSvg('bills');
      const where = paused ? t('sub_paused') : st === 'paid' ? t('paid') : st === 'partial' ? t('paid_partial') : (due ? cuRelative(due) : '');
      return lvRow({ attrs: `data-bill-row="${b.id}"`, cls: paused ? 'is-paused' : st === 'paid' ? 'is-done' : '', ico: leaf,
        name: `${esc(b.name)}${b.kind === 'subscription' ? `<span class="lv-tag">${esc(t('bill_kind_sub'))}</span>` : ''}`,
        sub: [esc(subCatLabel(b.category)), esc(where)].filter(Boolean).join(' \u00b7 '), bar: null,
        fig: fmt(b.amount), cap: `/${unit}`,
        acts: `${st !== 'paid' && !paused ? `<button class="btn btn-ghost btn-sm sub-pay-btn" data-sub-pay="${b.id}" type="button">${t('pay_btn')}</button>` : ''}`
          + lvBtn('', `data-sub-edit="${b.id}"`, t('edit'), LV_EDIT) + lvBtn('lv-act--del', `data-sub-del="${b.id}"`, t('delete'), LV_DEL) });
    }).join('')}</div>`);
  } else {
    const grid = document.createElement('div');
    grid.className = 'sub-layout';
    const listCol = document.createElement('div');
    listCol.className = 'sub-list-col';
    listCol.innerHTML = listHtml;
    grid.appendChild(listCol);
    if (chartHtml) {
      const chartCol = document.createElement('div');
      chartCol.className = 'sub-chart-col';
      chartCol.innerHTML = chartHtml;
      grid.appendChild(chartCol);
    }
    el.appendChild(grid);
  }

  requestAnimationFrame(()=>initDonuts(el));
  wireViewToggle(el,'bills',renderSubscriptions);
  document.getElementById('addSubBtn')?.addEventListener('click',()=>openSubModal(null));
  document.getElementById('subEmptyAdd')?.addEventListener('click',()=>openSubModal(null));
  // Paying a bill opens the same sheet the calendar and the dashboard use,
  // so an instalment is logged as its own transaction and linked back.
  el.querySelectorAll('[data-sub-pay]').forEach(b=>b.addEventListener('click',()=>
    promptPay('bill',b.dataset.subPay,()=>renderSubscriptions())));
  el.querySelectorAll('[data-sub-edit]').forEach(b=>b.addEventListener('click',()=>openSubModal(b.dataset.subEdit)));
  el.querySelectorAll('[data-sub-del]').forEach(b=>b.addEventListener('click',async()=>{
    if(!await confirmDialog({message:t('confirm_remove_sub'),confirmText:t('delete')}))return;
    state.bills=state.bills.filter(s=>s.id!==b.dataset.subDel);
    saveState();renderSubscriptions();
  }));
  el.querySelectorAll('.sub-toggle-cb[data-sub-toggle]').forEach(cb=>cb.addEventListener('change',()=>{
    const s=state.bills.find(s=>s.id===cb.dataset.subToggle);
    if(s){s.active=cb.checked;saveState();renderSubscriptions();}
  }));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}


function openSubModal(subId){
  const sub=subId?state.bills.find(s=>s.id===subId):null,isNew=!sub;
  if(isNew&&trialBlocks('subscriptions')){ showUpgradeModal({reason:'subscriptions'}); return; }
  const allocEnabled=state.allocation?.enabled;
  document.getElementById('modalTitle').textContent=isNew?'🔄 '+t('sub_add_title'):'✏️ '+t('sub_edit_title');
  document.getElementById('modalBody').innerHTML=`<div class="field"><label class="field-label field-label--tip">${tipLabel(t('sub_name_label'),'sub_name_hint',true)}</label><input class="input" type="text" id="subName" placeholder="${t('sub_name_ph')}" value="${esc(sub?.name||'')}"></div>
    <div class="field-grid"><div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('sub_amount_label')} (${SYM})`,'sub_amount_hint',true)}</label><input class="input" type="number" id="subAmount" min="0" step="0.01" placeholder="0.00" value="${sub?.amount||''}"></div><div class="field"><label class="field-label field-label--tip">${tipLabel(t('sub_freq_label'),'sub_freq_hint',false)}</label><select class="select" id="subFreq"><option value="monthly" ${sub?.frequency==='monthly'?'selected':''}>${t('sub_freq_monthly')}</option><option value="annual" ${sub?.frequency==='annual'?'selected':''}>${t('sub_freq_annual')}</option><option value="quarterly" ${sub?.frequency==='quarterly'?'selected':''}>${t('sub_freq_quarterly')}</option><option value="weekly" ${sub?.frequency==='weekly'?'selected':''}>${t('sub_freq_weekly')}</option></select></div></div>
    <div class="field"><label class="field-label">${t('bill_kind_label')}</label><select class="select" id="subKind">
      <option value="bill"${(sub?.kind||'bill')==='bill'?' selected':''}>${t('bill_kind_bill')}</option>
      <option value="subscription"${sub?.kind==='subscription'?' selected':''}>${t('bill_kind_sub')}</option>
    </select></div>
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('sub_cat_label'),'sub_cat_hint',false)}</label><select class="select" id="subCat">${SUB_CATS.map(c=>`<option value="${c}" ${sub?.category===c?'selected':''}>${esc(subCatLabel(c))}</option>`).join('')}</select></div>
    ${allocEnabled?`<div class="field"><label class="field-label field-label--tip">${tipLabel(t('alloc_label'),'alloc_label_hint',true)}</label><select class="select" id="subAlloc"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}"${sub?.allocation===b.id?' selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select></div>`:''}
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('sub_date_label'),'sub_date_hint',true)}</label>${styledDateField('subDate','subDateWrap',sub?.nextBillingDate||'')}</div>
    <div class="tx-error" id="subError" hidden></div>
    <div class="edit-tx-actions"><button class="btn btn-primary" id="saveSubBtn">${isNew?t('sub_add_title'):t('save')}</button><button class="btn btn-ghost btn-sm" id="cancelSubBtn">${t('cancel')}</button>${!isNew?`<button class="btn btn-danger btn-sm" id="deleteSubBtn">${t('delete')}</button>`:''}</div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  initFieldTips(document.getElementById('modalBody'));
  bindDateField('subDate','subDateWrap');
  const clearSubErr=()=>{const e=document.getElementById('subError');if(e)e.hidden=true;};
  ['subName','subAmount'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{document.getElementById(id)?.classList.remove('fk-invalid');clearSubErr();}));
  document.getElementById('subAlloc')?.addEventListener('change',()=>{document.getElementById('subAlloc')?.classList.remove('fk-invalid');clearSubErr();});
  document.getElementById('subDate')?.addEventListener('change',()=>{document.getElementById('subDateWrap')?.classList.remove('fk-invalid');clearSubErr();});
  document.getElementById('saveSubBtn')?.addEventListener('click',()=>{
    const nameEl=document.getElementById('subName'),amountEl=document.getElementById('subAmount'),dateWrap=document.getElementById('subDateWrap'),allocEl=document.getElementById('subAlloc'),errEl=document.getElementById('subError');
    const name=nameEl?.value.trim(),amount=parseFloat(amountEl?.value)||0,freq=document.getElementById('subFreq')?.value,cat=document.getElementById('subCat')?.value,date=document.getElementById('subDate')?.value||'';
    const alloc=allocEnabled?(allocEl?.value||null):null;
    [nameEl,amountEl,dateWrap,allocEl].forEach(x=>x&&x.classList.remove('fk-invalid'));
    let bad=false;
    if(!name){nameEl?.classList.add('fk-invalid');bad=true;}
    if(!(amount>0)){amountEl?.classList.add('fk-invalid');bad=true;}
    if(!date){dateWrap?.classList.add('fk-invalid');bad=true;}
    if(allocEnabled&&!alloc){allocEl?.classList.add('fk-invalid');bad=true;}
    if(bad){if(errEl){errEl.textContent=t('sf_error_required');errEl.hidden=false;}return;}
    if(errEl)errEl.hidden=true;
    const billKind=document.getElementById('subKind')?.value==='subscription'?'subscription':'bill';
    let sid;
    if(isNew){sid=uid();state.bills.push({id:sid,name,amount,frequency:freq,category:cat,nextBillingDate:date,active:true,allocation:alloc,kind:billKind,payTxIds:[]});trialUse('subscriptions');trackEvent('feature_used',{feature:'subscription_added'});}
    else{sid=subId;const s=state.bills.find(s=>s.id===subId);if(s){if(amount!==s.amount)(s.priceHistory=s.priceHistory||[]).push({date:today(),from:s.amount,to:amount});renameTxCategory('bill',s.name,name);if(date!==s.nextBillingDate)s.paidCycles=[];s.name=name;s.amount=amount;s.frequency=freq;s.category=cat;s.nextBillingDate=date;s.allocation=alloc;s.kind=billKind;}}
    saveState();closeModal();renderSubscriptions();showToast(t(isNew?'toast_sub_added':'toast_sub_updated'));
  });
  document.getElementById('cancelSubBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteSubBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_sub'),confirmText:t('delete')}))return;state.bills=state.bills.filter(s=>s.id!==subId);saveState();closeModal();renderSubscriptions();});
}

// ── SETTINGS ──────────────────────────────────────────────────────────
function exportCSV(){
  trackEvent('feature_used', { feature: 'csv_exported' });
  const rows=[['Date','Type','Category','Amount','Description','Allocation']];
  for(const tx of state.transactions)rows.push([tx.date,tx.type,tx.category,tx.amount,tx.description||'',tx.allocation||'']);
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`evobudget-${state.settings.periodStart||'export'}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(t('toast_export'));
}

// ── Settings, arranged ───────────────────────────────────────────────────
// The cards are built as before and then sorted into titled groups, each
// title's emoji traded for the app's own outline icon. Moving a card keeps
// every listener it was given.
const SET_CARDS = { '\ud83e\uddf0': ['tools', 'general'], '\ud83c\udfad': ['persona', 'general'], '\ud83c\udfc6': ['challenges', 'challenges'], '\ud83d\udcc5': ['calendar', 'budget'], '\ud83d\udcb1': ['coins', 'general'], '\ud83d\udd04': ['transactions', 'budget'],
  '\u2728': ['assistant', 'assist'], '\u26a1': ['bolt', 'assist'], '\ud83e\udded': ['list', 'look'], '\ud83d\udcca': ['dashboard', 'look'],
  '\ud83c\udf19': ['moon', 'look'], '\u2601\ufe0f': ['cloud', 'data'], '\u2601': ['cloud', 'data'], '\ud83c\udf10': ['globe', 'general'],
  '\ud83c\udfaf': ['sinking', 'budget'], '\ud83c\udff7\ufe0f': ['tag', 'general'], '\ud83d\udc64': ['user', 'general'], '\ud83c\udff7': ['tag', 'general'], '\ud83d\udd11': ['key', 'data'], '\ud83d\udce4': ['upload', 'data'], '\u26a0\ufe0f': ['alert', 'data'], '\u26a0': ['alert', 'data'] };
const SET_GROUPS = ['general', 'budget', 'challenges', 'look', 'assist', 'data', 'more'];
// The cards most people need. Everything else waits behind "Show all
// settings", which is remembered while the planner stays open.
// A switched-on tool's own setting counts as essential too.
const STG_ESSENTIAL = '[data-tool], #settStart, #settCurrency, .theme-opt, [data-sync-mode], #exportCsvBtn, .persona-grid, #cfMinInput';
let _stgAll = false;
function applyWidthPref() {
  document.documentElement.dataset.width = state?.settings?.fullWidth === false ? 'fixed' : 'full';
}
function enhanceSettings(el) {
  const grid = el.querySelector('.settings-grid');
  if (!grid || grid.dataset.arranged) return;
  const groups = {};
  SET_GROUPS.forEach(g => {
    const sec = document.createElement('section');
    sec.className = 'stg';
    sec.innerHTML = `<h3 class="stg-title">${t('stg_' + g)}</h3><div class="stg-grid"></div>`;
    groups[g] = sec;
  });
  [...grid.children].forEach(card => {
    const title = card.querySelector('.settings-card-title');
    let group = 'more', icon = 'settings';
    if (title) {
      const m = title.textContent.trim().match(/^(\p{Extended_Pictographic}\ufe0f?)\s*/u);
      const hit = m && (SET_CARDS[m[1]] || SET_CARDS[m[1].replace('\ufe0f', '')]);
      if (hit) { icon = hit[0]; group = hit[1]; }
      if (card.querySelector('#settDashboardAnimations')) { icon = 'dashboard'; group = 'look'; }
      // The emoji goes; the icon chip takes its place.
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      if (first && m) first.textContent = first.textContent.replace(m[0].trim(), '').replace(/^\s+/, '');
      title.insertAdjacentHTML('afterbegin', `<span class="sct-ico" aria-hidden="true">${appIconSvg(icon)}</span>`);
      if (icon === 'alert') card.classList.add('stg-card--danger');
    }
    card.classList.add('stg-card');
    if (!card.querySelector(STG_ESSENTIAL + (typeof toolOn === 'function' && toolOn('alloc') ? ', #allocEnabled' : ''))) card.classList.add('stg-card--more');
    groups[group].querySelector('.stg-grid').appendChild(card);
  });
  // Layout width: the whole window by default, or the fixed column.
  const wcard = document.createElement('div');
  wcard.className = 'panel stg-card stg-card--more';
  wcard.innerHTML = `<div class="panel-inner"><div class="settings-card-title"><span class="sct-ico" aria-hidden="true">${appIconSvg('width')}</span>${t('set_width_title')}</div>
    <p class="settings-desc">${t('set_width_desc')}</p>
    <label class="stg-switch"><span class="recurring-toggle"><input type="checkbox" id="settFullWidth" ${state.settings.fullWidth === false ? '' : 'checked'}><span class="rec-toggle-track"></span></span><span>${t('set_width_full')}</span></label></div>`;
  groups.look.querySelector('.stg-grid').prepend(wcard);
  wcard.querySelector('#settFullWidth').addEventListener('change', e => {
    state.settings.fullWidth = e.target.checked; saveState(); applyWidthPref();
  });
  grid.innerHTML = '';
  SET_GROUPS.forEach(g => { if (groups[g].querySelector('.stg-card')) grid.appendChild(groups[g]); });
  grid.dataset.arranged = '1';
  const more = grid.querySelectorAll('.stg-card--more').length;
  if (more) {
    grid.classList.toggle('is-all', _stgAll);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-secondary stg-all-btn';
    const label = () => { btn.textContent = _stgAll ? t('stg_show_less') : tf('stg_show_all', more); btn.setAttribute('aria-expanded', String(_stgAll)); };
    label();
    btn.addEventListener('click', () => { _stgAll = !_stgAll; grid.classList.toggle('is-all', _stgAll); label(); });
    grid.after(btn);
  }
}

function renderSettings(){
  const s=state.settings, el=document.getElementById('bview-settings');

  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">${appIconSvg('settings')} ${t('tab_settings')}</h2>
      ${helpBtn('settings')}
    </div>

    <div class="settings-grid">
      ${typeof toolsCardHtml === 'function' ? toolsCardHtml() : ''}
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🏷️ ${t('set_name_title')}</div>
        <p class="settings-desc">${t('set_name_desc')}</p>
        <div class="field"><label class="field-label" for="settPlannerName">${t('set_name_label')}</label>
          <input class="input" type="text" id="settPlannerName" maxlength="40" autocomplete="off" value="${esc(s.appTitle||'')}" placeholder="${esc(APP_DEFAULT_TITLE)}">
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">👤 ${t('own_title')}</div>
        <p class="settings-desc">${t('own_desc')}</p>
        <div class="own-names" id="ownNames">${ownNamesHtml()}</div>
        <div class="own-add">
          <input class="input" type="text" id="ownNameInput" maxlength="60" autocomplete="name" placeholder="${esc(t('own_ph'))}" aria-label="${esc(t('own_ph'))}">
          <button class="btn btn-primary btn-sm" id="ownNameAdd" type="button">${t('own_add')}</button>
        </div>
        <p class="own-err" id="ownNameErr" hidden></p>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">📅 ${t('budget_period')}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${t('start_date')}</label>
            ${styledDateField('settStart','settStartWrap',s.periodStart)}
          </div>
          <div class="field">
            <label class="field-label">${t('end_date')}</label>
            ${styledDateField('settEnd','settEndWrap',s.periodEnd)}
          </div>
        </div>
        <div class="preset-row">
          <span class="field-label">${t('quick_presets')}</span>
          ${(()=>{
            const now=new Date(),d=now.getDay();
            const mo=new Date(now.getFullYear(),now.getMonth(),1),me=new Date(now.getFullYear(),now.getMonth()+1,0);
            const thisMonday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(d===0?6:d-1));
            const q=Math.floor(now.getMonth()/3);
            const presets={
              week:[toLocalISO(thisMonday),toLocalISO(new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()+6))],
              last_week:[toLocalISO(new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()-7)),toLocalISO(new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()-1))],
              month:[toLocalISO(mo),toLocalISO(me)],
              last_month:[toLocalISO(new Date(now.getFullYear(),now.getMonth()-1,1)),toLocalISO(new Date(now.getFullYear(),now.getMonth(),0))],
              last_30:[toLocalISO(new Date(now.getFullYear(),now.getMonth(),now.getDate()-29)),toLocalISO(now)],
              quarter:[toLocalISO(new Date(now.getFullYear(),q*3,1)),toLocalISO(new Date(now.getFullYear(),q*3+3,0))],
              year:[toLocalISO(new Date(now.getFullYear(),0,1)),toLocalISO(new Date(now.getFullYear(),11,31))],
            };
            const ps=s.periodStart,pe=s.periodEnd;
            const active=Object.entries(presets).find(([,v])=>v[0]===ps&&v[1]===pe)?.[0]||null;
            return['month'].map(k=>`<button class="btn btn-ghost btn-sm${active===k?' preset-active':''}" data-preset="${k}" type="button">${t({week:'this_week',last_week:'last_week',month:'this_month',last_month:'last_month',last_30:'last_30_days',quarter:'this_quarter',year:'this_year'}[k])}</button>`).join('');
          })()}
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">💱 ${t('currency')}</div>
        <div class="field"><label class="field-label">${t('select_currency')}</label>
          <select class="select" id="settCurrency">
            ${[['USD','$'],['EUR','€'],['GBP','£'],['PLN','zł'],['JPY','¥'],['CAD','$'],
               ['AUD','$'],['CHF','CHF'],['SEK','kr'],['NOK','kr'],['DKK','kr'],
               ['INR','₹'],['BRL','R$'],['MXN','$'],['ZAR','R']]
              .map(([c,sy]) => `<option value="${c}|${sy}" ${s.currency===c?'selected':''}>${c} (${sy})</option>`).join('')}
          </select>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🔄 ${t('rollover')}</div>
        <p class="settings-desc">${t('rollover_desc')}</p>
        <div class="field"><label class="field-label">${t('rollover_amount')} (${s.symbol})</label>
          <input class="input" type="number" id="settRollover" min="0" step="0.01"
                 value="${state.rollover||''}" placeholder="0.00">
        </div>
        <label class="field-hint" style="display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer">
          <input type="checkbox" id="settRolloverAuto" ${state.settings.rolloverAutoCarry!==false?'checked':''}>
          ${t('rollover_autocarry_label')}
        </label>
        <p class="settings-desc" style="margin-top:2px">${t('rollover_autocarry_hint')}</p>
      </div></div>
      ${pennySettingsCardHtml()}
      ${navPositionCardHtml()}
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🌙 ${t('appearance')}</div>
        <p class="settings-desc">${t('appearance_desc')}</p>
        <div class="theme-setting-row">
          <div class="theme-pill" role="group" aria-label="${t('appearance')}">
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='light'?' is-active':''}" data-theme-val="light" type="button" title="${t('light')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              ${t('light')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='peachy'?' is-active':''}" data-theme-val="peachy" type="button" title="${t('theme_peachy')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="5"/><path d="M9 12h6"/></svg>
              ${t('theme_peachy')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='dark'?' is-active':''}" data-theme-val="dark" type="button" title="${t('dark')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ${t('dark')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='vintage-ledger'?' is-active':''}" data-theme-val="vintage-ledger" type="button" title="${t('theme_vintage_ledger')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5c3-1.5 6-1.5 8 0v14c-2-1.5-5-1.5-8 0V5z"/><path d="M20 5c-3-1.5-6-1.5-8 0v14c2-1.5 5-1.5 8 0V5z"/></svg>
              ${t('theme_vintage_ledger')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='jolly'?' is-active':''}" data-theme-val="jolly" type="button" title="${t('theme_jolly')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.2a4.6 4.6 0 0 0 7 0"/><path d="M9 9.6h.01"/><path d="M15 9.6h.01"/></svg>
              ${t('theme_jolly')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='frosty'?' is-active':''}" data-theme-val="frosty" type="button" title="${t('theme_frosty')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m4.9 6.5 14.2 11"/><path d="m19.1 6.5-14.2 11"/><path d="m9 3.5 3 2.5 3-2.5"/><path d="m9 20.5 3-2.5 3 2.5"/></svg>
              ${t('theme_frosty')}
            </button>
          </div>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">${t('sync_card_title')}</div>
        <p class="settings-desc">${t('sync_card_desc')}</p>
        <div class="sync-mode-row">
          <button class="sync-mode-opt${(syncGetMode('ubp')||'local')!=='google'?' is-active':''}" data-sync-mode="local" type="button">
            ${(syncGetMode('ubp')||'local')!=='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon">${SYNC_ICON_LOCAL}</span>
            <span class="sync-mode-title">${t('sync_mode_local_title')}</span>
            <span class="sync-mode-desc">${t('sync_mode_local_desc')}</span>
          </button>
          <button class="sync-mode-opt sync-mode-opt--google${(syncGetMode('ubp')||'local')==='google'?' is-active':''}" data-sync-mode="google" type="button">
            <span class="sync-mode-badge">${t('sync_recommended')}</span>
            ${(syncGetMode('ubp')||'local')==='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon sync-mode-icon--google">${SYNC_ICON_GOOGLE}</span>
            <span class="sync-mode-title">${t('sync_mode_google_title')}</span>
            <span class="sync-mode-desc">${t('sync_mode_google_desc')}</span>
          </button>
        </div>
        ${(syncGetMode('ubp')==='google'&&syncGetEmail('ubp'))?`<p class="sync-status-line">${tf('sync_signed_in_as',`<strong>${esc(syncGetEmail('ubp'))}</strong>`)}</p>`:''}
        <p class="sync-error" id="syncSettError" hidden>${t('sync_error_generic')}</p>
      </div></div>
      ${typeof personaCardHtml === 'function' ? personaCardHtml() : ''}
      ${typeof chRangeCardHtml === 'function' && (typeof toolOn !== 'function' || toolOn('challenges')) ? chRangeCardHtml() : ''}
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">${t('alloc_sett_title')}</div>
        <p class="settings-desc">${t('alloc_desc')}</p>
        <label class="automate-row alloc-switch">
          <span class="automate-row-text"><span class="automate-row-title">${t('alloc_enabled_label')}</span></span>
          <span class="recurring-toggle"><input type="checkbox" id="allocEnabled" ${state.allocation?.enabled?'checked':''}><span class="rec-toggle-track"></span></span>
        </label>
        <div class="alloc-editor" id="allocBucketsWrap" ${!state.allocation?.enabled?'style="display:none"':''}>
          <div class="alloc-split" aria-hidden="true">${(state.allocation?.buckets||[]).map((b,i)=>`<span data-split="${i}" style="flex-grow:${Math.max(0,b.pct||0)};background:${b.color}"></span>`).join('')}</div>
          <div class="alloc-bucket-list">
          ${(state.allocation?.buckets||[]).map((b,i)=>{const removable=(state.allocation.buckets||[]).length>2;return`<div class="alloc-bucket-row" data-bucket="${i}" style="--bc:${b.color || ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4'][i % 5]}">
            <button type="button" class="alloc-color-swatch" style="background:${b.color}" data-bi="${i}" title="${t('alloc_color_title')}" aria-label="${t('alloc_color_title')}"></button>
            <input class="input input-sm alloc-name-inp" type="text" value="${esc(b.name)}" data-bi="${i}" placeholder="${t('alloc_name_ph')}" aria-label="${t('alloc_name_ph')}">
            <div class="alloc-pct-field"><input class="alloc-pct-inp" type="number" min="0" max="100" step="1" value="${b.pct}" data-bi="${i}" aria-label="%"><span class="alloc-pct-sign">%</span></div>
            ${removable?`<button class="alloc-remove-btn" data-bi="${i}" type="button" title="${t('alloc_remove_btn')}" aria-label="${t('alloc_remove_btn')}">\u00d7</button>`:'<span class="alloc-remove-spacer"></span>'}
          </div>`;}).join('')}
          </div>
          <div class="alloc-actions">
            <button class="btn btn-ghost btn-sm" id="allocAddBtn" type="button">${t('alloc_add_bucket')}</button>
            ${(()=>{const sum=(state.allocation?.buckets||[]).reduce((a,b)=>a+(b.pct||0),0);return`<div class="alloc-total ${sum===100?'is-ok':'is-bad'}"><span>${t('alloc_total_label')}</span> <strong>${sum}%</strong>${sum===100?' \u2713':''}</div>`;})()}
          </div>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">${t('sett_upcoming_title')}</div>
        <p class="settings-desc">${t('sett_upcoming_desc')}</p>
        <div class="field"><label class="field-label">${t('sett_upcoming_label')}</label>
          <input class="input" type="number" id="settUpcomingDays" min="1" max="90" step="1"
                 value="${s.upcomingDays||30}">
        </div>
      </div></div>
      <div class="panel settings-card"><div class="panel-inner">
        <div class="settings-card-title">${t('sett_export_title')}</div>
        <p class="settings-desc">${t('sett_export_desc')}</p>
        <button class="btn btn-secondary btn-sm" id="exportCsvBtn" type="button">${t('export_csv_btn')}</button>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🔑 ${t('lic_title')}</div>
        <p class="settings-desc">${t('lic_desc')}</p>
        ${(()=>{ const k=licenseKeyOnFile(); return k
          ? `<div class="lic-row"><code class="lic-key" id="licKey">${esc(licenseMask(k))}</code><div class="lic-btns"><button class="btn btn-ghost btn-sm" id="licShowBtn" type="button" aria-pressed="false">${t('lic_show')}</button><button class="btn btn-ghost btn-sm" id="licCopyBtn" type="button">${t('lic_copy')}</button></div></div>`
          : `<p class="lic-none">${t('lic_none')}</p>`; })()}
      </div></div>
      <div class="panel settings-card--danger"><div class="panel-inner">
        <div class="settings-card-title">⚠️ ${t('reset_data')}</div>
        <p class="settings-desc">${t('reset_desc')}</p>
        <button class="btn btn-danger btn-sm" id="resetBtn" type="button">${t('reset_btn')}</button>
      </div></div>
    </div>

    <div class="settings-save-row"><p class="settings-desc" style="margin:0;font-size:12px">${t('changes_autosaved')}</p></div>
  `;

  el.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => { applyTheme(btn.dataset.themeVal); trackEvent('theme_changed', { theme: btn.dataset.themeVal }); });
  });
  wireNavPositionPicker(el);
  if (typeof chWireRangeCard === 'function') chWireRangeCard(el);
  if (typeof personaWireCard === 'function') personaWireCard(el);
  if (typeof wireToolRows === 'function') wireToolRows(el);
  wireDashboardLayoutPicker(el);

  el.querySelectorAll('[data-sync-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.syncMode;
      const current = syncGetMode('ubp') || 'local';
      if (target === current) return;
      const errEl = document.getElementById('syncSettError');
      if (errEl) errEl.hidden = true;
      el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = true);
      try {
        if (target === 'google') { saveState(); await syncSwitchToGoogle('ubp'); showToast(t('toast_synced_google')); }
        else { await syncSwitchToLocal('ubp'); showToast(t('toast_synced_local')); }
        trackEvent('sync_mode_chosen', { mode: target });
        state = loadState() || defaultState(); syncSymbol(); settingsCatchUp();
        renderSettings();
      } catch (e) {
        if (errEl) { errEl.textContent = syncFriendlyError(e); errEl.hidden = false; }
        el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = false);
      }
    });
  });

  el.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const now = new Date(), d = now.getDay();
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1));
      let start, end;
      switch (btn.dataset.preset) {
        case 'week':
          start = toLocalISO(thisMonday);
          end   = toLocalISO(new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() + 6));
          break;
        case 'last_week': {
          const lm = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
          start = toLocalISO(lm);
          end   = toLocalISO(new Date(lm.getFullYear(), lm.getMonth(), lm.getDate() + 6));
          break;
        }
        case 'month':
          ({start, end} = getMonthBounds());
          break;
        case 'last_month':
          start = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
          end   = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0));
          break;
        case 'last_30':
          start = toLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
          end   = toLocalISO(now);
          break;
        case 'quarter': {
          const q = Math.floor(now.getMonth() / 3);
          start = toLocalISO(new Date(now.getFullYear(), q * 3, 1));
          end   = toLocalISO(new Date(now.getFullYear(), q * 3 + 3, 0));
          break;
        }
        case 'year':
          start = toLocalISO(new Date(now.getFullYear(), 0, 1));
          end   = toLocalISO(new Date(now.getFullYear(), 11, 31));
          break;
        default: return;
      }
      document.getElementById('settStart').value = start;
      document.getElementById('settEnd').value   = end;
      document.getElementById('settStartDisp').textContent = formatDateDisplay(start);
      document.getElementById('settEndDisp').textContent   = formatDateDisplay(end);
      state.settings.periodStart = start;
      state.settings.periodEnd   = end;
      bpMarkChosen();
      saveState();
      el.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('preset-active',b===btn));
      showToast(t('toast_period_updated'));
      maybeAutoCarryRollover();
    });
  });

  // Click on styled date fields → open the custom calendar
  document.getElementById('settStartWrap')?.addEventListener('click', () => {
    openDatePicker(document.getElementById('settStart'), document.getElementById('settStartWrap'));
  });
  document.getElementById('settEndWrap')?.addEventListener('click', () => {
    openDatePicker(document.getElementById('settEnd'), document.getElementById('settEndWrap'));
  });

  // Save date changes to state and update display
  document.getElementById('settStart')?.addEventListener('change', e => {
    if(e.target.value && state.settings.periodEnd && e.target.value > state.settings.periodEnd){showToast(t('toast_period_error'));e.target.value=state.settings.periodStart;document.getElementById('settStartDisp').textContent=formatDateDisplay(state.settings.periodStart);return;}
    state.settings.periodStart = e.target.value; bpMarkChosen(); saveState();
    document.getElementById('settStartDisp').textContent = formatDateDisplay(e.target.value);
    maybeAutoCarryRollover();
  });
  document.getElementById('settEnd')?.addEventListener('change', e => {
    if(e.target.value && state.settings.periodStart && e.target.value < state.settings.periodStart){showToast(t('toast_period_error'));e.target.value=state.settings.periodEnd;document.getElementById('settEndDisp').textContent=formatDateDisplay(state.settings.periodEnd);return;}
    state.settings.periodEnd = e.target.value; bpMarkChosen(); saveState();
    document.getElementById('settEndDisp').textContent = formatDateDisplay(e.target.value);
    maybeAutoCarryRollover();
  });
  document.getElementById('settRolloverAuto')?.addEventListener('change', e => {
    state.settings.rolloverAutoCarry = e.target.checked; saveState();
  });

  document.getElementById('settCurrency')?.addEventListener('change', e => {
    const [curr, sym] = e.target.value.split('|');
    state.settings.currency = curr; state.settings.symbol = sym; SYM = sym;
    saveState();
    showToast(t('toast_currency_updated'));
    switchTab(currentTab);
  });

  document.getElementById('settRollover')?.addEventListener('change', e => {
    state.rollover = Math.max(0, parseFloat(e.target.value) || 0);
    rolloverMaps();
    state.rolloverHistory[state.settings.periodStart] = state.rollover;
    state.rolloverManual[state.settings.periodStart] = true;
    saveState();
    showToast(t('toast_saved'));
  });

  document.getElementById('settUpcomingDays')?.addEventListener('change', e => {
    const days = parseInt(e.target.value, 10);
    state.settings.upcomingDays = (days>=1&&days<=90) ? days : 30;
    e.target.value = state.settings.upcomingDays;
    saveState();
    showToast(t('toast_saved'));
  });

  pennyWireSettingsCard();

  // The name at the top of the sidebar follows as it is typed; an empty
  // box goes back to the planner's own name.
  const nameInp = document.getElementById('settPlannerName');
  nameInp?.addEventListener('input', () => {
    const tEl = document.getElementById('appTitleText');
    if (tEl) tEl.textContent = nameInp.value.trim() || APP_DEFAULT_TITLE;
  });
  // Names on the person's own accounts: a first and a last name each, so a
  // common word alone is never taken for them.
  const ownErr = document.getElementById('ownNameErr');
  const ownPaint = () => { const box = document.getElementById('ownNames'); if (box) box.innerHTML = ownNamesHtml(); wireOwnRemove(); try { buildNavRail(); } catch (e) {} };
  const wireOwnRemove = () => document.querySelectorAll('[data-own-del]').forEach(b => b.addEventListener('click', () => {
    const list = (state.settings.ownNames || []).slice(); list.splice(Number(b.dataset.ownDel), 1);
    state.settings.ownNames = list; saveState(); ownPaint();
  }));
  const ownAdd = () => {
    const inp = document.getElementById('ownNameInput'), v = inp.value.replace(/\s+/g, ' ').trim();
    if (!v) return;
    const words = v.split(' ').filter(w => w.replace(/[^\p{L}]/gu, '').length >= 2);
    const list = state.settings.ownNames || [];
    const key = x => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).sort().join(' ');
    if (words.length < 2) { ownErr.textContent = t('own_one_word'); ownErr.hidden = false; return; }
    if (list.some(x => key(x) === key(v))) { ownErr.textContent = t('own_dupe'); ownErr.hidden = false; return; }
    ownErr.hidden = true;
    state.settings.ownNames = list.concat([v]); inp.value = '';
    saveState(); ownPaint(); showToast(t('toast_saved'));
  };
  document.getElementById('ownNameAdd')?.addEventListener('click', ownAdd);
  document.getElementById('ownNameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ownAdd(); } });
  document.getElementById('ownNameInput')?.addEventListener('input', () => { ownErr.hidden = true; });
  wireOwnRemove();
  nameInp?.addEventListener('change', () => {
    const v = nameInp.value.trim();
    if (v) state.settings.appTitle = v; else delete state.settings.appTitle;
    nameInp.value = v;
    saveState(); applyAppTitle();
    showToast(t('toast_saved'));
  });
  document.getElementById('licShowBtn')?.addEventListener('click', e => {
    const k = licenseKeyOnFile(), on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    document.getElementById('licKey').textContent = on ? k : licenseMask(k);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? t('lic_hide') : t('lic_show');
  });
  document.getElementById('licCopyBtn')?.addEventListener('click', async () => {
    const k = licenseKeyOnFile();
    try { await navigator.clipboard.writeText(k); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = k; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove();
    }
    showToast(t('lic_copied'));
  });

  document.getElementById('allocEnabled')?.addEventListener('change', e => {
    state.allocation.enabled = e.target.checked;
    saveState();
    if (e.target.checked) trackEvent('feature_used', { feature: 'allocation_enabled' });
    document.getElementById('allocBucketsWrap').style.display = e.target.checked ? '' : 'none';
    showToast(t(e.target.checked?'toast_alloc_enabled':'toast_alloc_disabled'));
  });
  el.querySelectorAll('.alloc-name-inp').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = parseInt(inp.dataset.bi);
      if (state.allocation.buckets[i]) { state.allocation.buckets[i].name = inp.value.trim() || state.allocation.buckets[i].name; saveState(); }
    });
  });
  el.querySelectorAll('.alloc-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const i = parseInt(sw.dataset.bi);
      openColorPicker(sw, state.allocation.buckets[i]?.color, color => {
        if (state.allocation.buckets[i]) { state.allocation.buckets[i].color = color; sw.style.background = color; const seg = el.querySelector(`[data-split="${i}"]`); if (seg) seg.style.background = color; saveState(); }
      });
    });
  });
  el.querySelectorAll('.alloc-pct-inp').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.bi);
      if (state.allocation.buckets[i]) {
        state.allocation.buckets[i].pct = parseFloat(inp.value) || 0;
        saveState();
        const seg = el.querySelector(`[data-split="${i}"]`);
        if (seg) seg.style.flexGrow = Math.max(0, state.allocation.buckets[i].pct);
        const total = state.allocation.buckets.reduce((s,b) => s + (b.pct||0), 0);
        const totalEl = el.querySelector('.alloc-total');
        if (totalEl) { totalEl.className = 'alloc-total ' + (total===100?'is-ok':'is-bad'); totalEl.innerHTML = `<span>${t('alloc_total_label')}</span> <strong>${total}%</strong>${total===100?' \u2713':''}`; }
      }
    });
  });

  document.getElementById('allocAddBtn')?.addEventListener('click', () => {
    const usedColors = state.allocation.buckets.map(b => b.color);
    const nextColor = BUCKET_COLORS.find(c => !usedColors.includes(c)) || BUCKET_COLORS[state.allocation.buckets.length % BUCKET_COLORS.length];
    state.allocation.buckets.push({id: uid(), name: t('alloc_new_bucket'), pct: 0, color: nextColor});
    saveState(); renderSettings();
    showToast(t('toast_alloc_bucket_added'));
  });

  el.querySelectorAll('.alloc-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.bi);
      if (state.allocation.buckets.length <= 2) { showToast(t('alloc_min_buckets')); return; }
      state.allocation.buckets.splice(i, 1);
      saveState(); renderSettings();
      showToast(t('toast_saved'));
    });
  });

  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);

  document.getElementById('resetBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog({ message: t('confirm_reset_1'), confirmText: t('reset_btn') })) return;
    if (!await confirmDialog({ message: t('confirm_reset_2'), confirmText: t('reset_btn') })) return;
    localStorage.removeItem(UBP_KEY);
    state = defaultState(); SYM = '$'; saveState();
    showToast(t('toast_reset'));
    switchTab('dashboard');
  });

  el.querySelector('[data-help]')?.addEventListener('click', e => showHelp(e.currentTarget.dataset.help));
  enhanceSettings(el);
}

// ── HELP ──────────────────────────────────────────────────────────────
const HELP={
  dashboard:{
    title: () => `📊 ${t('tab_dashboard')}`,
    body:  () => `
<p>${t('help_dash_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dash_hero_h')}</h4>
<p>${t('help_dash_hero_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dash_leftover_h')}</h4>
<p>${t('help_dash_leftover_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dash_cashflow_h')}</h4>
<p>${t('help_dash_cashflow_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dash_donut_h')}</h4>
<p>${t('help_dash_donut_p')}</p>

<div style="border-top:1px solid var(--border-faint);margin:16px 0 14px"></div>
<h4 style="margin:0 0 8px;font-size:14px">🎯 ${t('help_dash_alloc_h')}</h4>

<h5 style="margin:12px 0 4px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em">${t('help_dash_alloc_what_h')}</h5>
<p style="margin:0">${t('help_dash_alloc_what_p')}</p>

<h5 style="margin:12px 0 4px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em">${t('help_dash_alloc_tag_h')}</h5>
<p style="margin:0">${t('help_dash_alloc_tag_p')}</p>

<h5 style="margin:12px 0 4px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em">${t('help_dash_alloc_read_h')}</h5>
<p style="margin:0">${t('help_dash_alloc_read_p')}</p>

<h5 style="margin:12px 0 6px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em">${t('help_dash_alloc_col_h')}</h5>
<ul style="margin:0;padding-left:16px;line-height:2">
  <li><span style="color:#f43f5e;font-weight:700">■</span> ${t('help_dash_alloc_col_over')}</li>
  <li><span style="color:#fb923c;font-weight:700">■</span> ${t('help_dash_alloc_col_near')}</li>
  <li><span style="color:${(state.allocation?.buckets?.[0]?.color)||'#6366f1'};font-weight:700">■</span> ${t('help_dash_alloc_col_norm')}</li>
</ul>

<h5 style="margin:12px 0 4px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em">${t('help_dash_alloc_setup_h')}</h5>
<p style="margin:0">${t('help_dash_alloc_setup_p')}</p>

<div style="border-top:1px solid var(--border-faint);margin:16px 0 14px"></div>
<h4 style="margin:0 0 6px;font-size:14px">${t('help_dash_bottom_h')}</h4>
<p>${t('help_dash_bottom_p')}</p>
<p style="margin-top:10px"><em>${t('help_dash_tip')}</em></p>
`
  },

  budget:{
    title: () => `💰 ${t('tab_budget')}`,
    body:  () => `
<p>${t('help_bud_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_bud_how_h')}</h4>
<ol style="margin:0;padding-left:18px;line-height:2">
  <li>${t('help_bud_step1')}</li>
  <li>${t('help_bud_step2')}</li>
  <li>${t('help_bud_step3')}</li>
</ol>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_bud_colours_h')}</h4>
<ul>
  <li><span style="color:#10b981">■</span> <strong style="color:#10b981">${t('help_bud_col_green').split(' - ')[0]}</strong> - ${t('help_bud_col_green').split(' - ')[1]}</li>
  <li><span style="color:#6366f1">■</span> <strong style="color:#6366f1">${t('help_bud_col_indigo').split(' - ')[0]}</strong> - ${t('help_bud_col_indigo').split(' - ')[1]}</li>
  <li><span style="color:#f43f5e">■</span> <strong style="color:#f43f5e">${t('help_bud_col_red').split(' - ')[0]}</strong> - ${t('help_bud_col_red').split(' - ')[1]}</li>
</ul>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_bud_bills_h')}</h4>
<p>${t('help_bud_bills_p')}</p>
<p style="margin-top:10px"><em>${t('help_bud_tip')}</em></p>
`
  },

  transactions:{
    title: () => `📋 ${t('tab_transactions')}`,
    body:  () => `
<p>${t('help_tx_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_tx_adding_h')}</h4>
<ol style="margin:0;padding-left:18px;line-height:2">
  <li>${t('help_tx_step1')}</li>
  <li>${t('help_tx_step2')}</li>
  <li>${t('help_tx_step3')}</li>
  <li>${t('help_tx_step4')}</li>
  <li>${t('help_tx_step5')}</li>
</ol>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_tx_edit_h')}</h4>
<p>${t('help_tx_edit_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_tx_bulk_h')}</h4>
<p>${t('help_tx_bulk_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_tx_csv_h')}</h4>
<p>${t('help_tx_csv_p1')}</p>
<p>${t('help_tx_csv_p2')}</p>
`
  },

  debt:{
    title: () => `💳 ${t('dpc_title')}`,
    body:  () => `
<p>${t('help_dpc_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dpc_entries_h')}</h4>
<ul>
  <li><strong>${t('dpc_th_balance')}</strong> - ${t('help_dpc_balance_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_th_apr')}</strong> - ${t('help_dpc_apr_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_th_min')}</strong> - ${t('help_dpc_min_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_th_due')}</strong> - ${t('help_dpc_due_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_term_label')}</strong> - ${t('help_dpc_term_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_min_mode_label')}</strong> - ${t('help_dpc_percent_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_escrow_label')}</strong> - ${t('help_dpc_escrow_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_amort_type_label')}</strong> - ${t('help_dpc_amort_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_escrow_mode_label')}</strong> - ${t('help_dpc_escrow_mode_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_rate_type_label')}</strong> - ${t('help_dpc_rate_type_li').split(' - ')[1]}</li>
  <li><strong>${t('dpc_th_extra')}</strong> - ${t('help_dpc_extra_targeted_li').split(' - ')[1]}</li>
</ul>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dpc_strategies_h')}</h4>
<ul>
  <li>${t('help_dpc_snowball_li')}</li>
  <li>${t('help_dpc_avalanche_li')}</li>
</ul>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_dpc_extra_h')}</h4>
<p>${t('help_dpc_extra_p')}</p>
<p style="margin-top:10px"><em>${t('help_dpc_tip')}</em></p>
`
  },

  sinking:{
    title: () => `🏺 ${t('tab_sinking')}`,
    body:  () => `
<p>${t('help_sf_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sf_how_to_h')}</h4>
<ol style="margin:0;padding-left:18px;line-height:2">
  <li>${t('help_sf_step1')}</li>
  <li>${t('help_sf_step2')}</li>
  <li>${t('help_sf_step3')}</li>
  <li>${t('help_sf_step4')}</li>
  <li>${t('help_sf_step5')}</li>
</ol>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sf_reading_h')}</h4>
<p>${t('help_sf_reading_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sf_contrib_h')}</h4>
<p>${t('help_sf_contrib_p')}</p>
<p style="margin-top:10px"><em>${t('help_sf_tip')}</em></p>
`
  },

  calendar:{
    title: () => `📅 ${t('cal_title')}`,
    body:  () => `
<p>${t('help_cal_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_cal_ev_types_h')}</h4>
<ul>
  <li><span style="color:#fb923c">●</span> ${t('help_cal_bill_li')}</li>
  <li><span style="color:#a855f7">●</span> ${t('help_cal_debt_li')}</li>
  <li><span style="color:#10b981">●</span> ${t('help_cal_sub_li')}</li>
  <li><span style="color:#6366f1">●</span> ${t('help_cal_tx_li')}</li>
</ul>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_cal_nav_h')}</h4>
<p>${t('help_cal_nav_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_cal_paid_h')}</h4>
<p>${t('help_cal_paid_p')}</p>
<p style="margin-top:10px"><em>${t('help_cal_tip')}</em></p>
`
  },

  subscriptions:{
    title: () => `🔄 ${t('tab_subscriptions')}`,
    body:  () => `
<p>${t('help_sub_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sub_how_h')}</h4>
<ol style="margin:0;padding-left:18px;line-height:2">
  <li>${t('help_sub_step1')}</li>
  <li>${t('help_sub_step2')}</li>
  <li>${t('help_sub_step3')}</li>
  <li>${t('help_sub_step4')}</li>
</ol>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sub_monthly_h')}</h4>
<p>${t('help_sub_monthly_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sub_pause_h')}</h4>
<p>${t('help_sub_pause_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sub_price_h')}</h4>
<p>${t('help_sub_price_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sub_chart_h')}</h4>
<p>${t('help_sub_chart_p')}</p>
<p style="margin-top:10px"><em>${t('help_sub_tip')}</em></p>
`
  },

  settings:{
    title: () => `⚙️ ${t('tab_settings')}`,
    body:  () => `
<p>${t('help_sett_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('currency')}</h4>
<p>${t('help_sett_currency_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('appearance')}</h4>
<p>${t('help_sett_appearance_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sett_nav_h')}</h4>
<p><strong>${t('help_sett_nav_top')}</strong><br><strong>${t('help_sett_nav_side')}</strong></p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('budget_period')}</h4>
<p>${t('help_sett_period_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('rollover')}</h4>
<p>${t('help_sett_rollover_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">✨ ${t('sett_penny_h')}</h4>
<p>${t('help_sett_penny_p')}</p>
`
  },

  penny_api_key:{
    title: () => `✨ ${t('help_penny_title')}`,
    body:  () => `
<p>${t('help_penny_intro')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_penny_steps_h')}</h4>
<ol style="margin:0;padding-left:18px;line-height:2">
  <li>${t('help_penny_step1')}</li>
  <li>${t('help_penny_step2')}</li>
  <li>${t('help_penny_step3')}</li>
  <li>${t('help_penny_step4')}</li>
</ol>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_penny_cost_h')}</h4>
<p>${t('help_penny_cost_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_penny_safety_h')}</h4>
<p>${t('help_penny_safety_p')}</p>
<div style="margin-top:18px;text-align:center"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg> ${t('help_penny_cta')}</a></div>`
  }
};
function showHelp(k){const h=HELP[k];if(!h)return;document.getElementById('modalTitle').textContent=typeof h.title==='function'?h.title():h.title;document.getElementById('modalBody').innerHTML='<div class="hs">'+(typeof h.body==='function'?h.body():h.body)+'</div>';document.getElementById('tutorialOverlay').hidden=false;document.getElementById('modalClose')?.focus();}
function closeModal(){document.getElementById('tutorialOverlay').hidden=true;}

// ── Guide ─────────────────────────────────────────────────────────────
const GUIDE_TOPICS = [
  { id: 'welcome',      group: 'guide_group_start',    icon: '👋', steps: 0, connects: 0, tip: false },
  { id: 'dashboard',    group: 'guide_group_start',    icon: '📊', steps: 3, connects: 3, tip: true  },
  { id: 'transactions', group: 'guide_group_track',    icon: '📋', steps: 4, connects: 3, tip: true  },
  { id: 'budget',       group: 'guide_group_track',    icon: '💰', steps: 4, connects: 3, tip: true  },
  { id: 'debt',         group: 'guide_group_plan',     icon: '💳', steps: 8, connects: 3, tip: true  },
  { id: 'sinking',      group: 'guide_group_plan',     icon: '🏦', steps: 3, connects: 3, tip: true  },
  { id: 'subscriptions',group: 'guide_group_plan',     icon: '🧾', steps: 3, connects: 3, tip: true  },
  { id: 'calendar',     group: 'guide_group_plan',     icon: '📅', steps: 3, connects: 3, tip: true  },
  { id: 'rollover',     group: 'guide_group_smart',    icon: '↩️', steps: 3, connects: 3, tip: true  },
  { id: 'penny',        group: 'guide_group_smart',    icon: '✨', steps: 4, connects: 3, tip: true  },
  { id: 'settings',     group: 'guide_group_settings', icon: '⚙️', steps: 6, connects: 3, tip: true  }
];
let guideActiveTopic = null;
let guideKeydownHandler = null;
let debtSchedKeydownHandler = null;

function guideFocusableEls(overlay) {
  return Array.from(overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
    .filter(el => el.offsetParent !== null);
}
function guideHandleKeydown(e) {
  const overlay = document.getElementById('guideOverlay');
  if (!overlay || overlay.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeGuide(); return; }
  if (e.key === 'Tab') {
    const els = guideFocusableEls(overlay);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    return;
  }
  const sidebar = document.getElementById('guideSidebar');
  if (sidebar && sidebar.contains(document.activeElement) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const idx = GUIDE_TOPICS.findIndex(x => x.id === guideActiveTopic);
    const next = e.key === 'ArrowDown' ? Math.min(idx + 1, GUIDE_TOPICS.length - 1) : Math.max(idx - 1, 0);
    selectGuideTopic(GUIDE_TOPICS[next].id);
    document.querySelector(`.guide-topic-btn[data-topic="${GUIDE_TOPICS[next].id}"]`)?.focus();
  }
}
function renderGuideSidebar() {
  const sidebar = document.getElementById('guideSidebar');
  if (!sidebar) return;
  let lastGroup = null;
  sidebar.innerHTML = GUIDE_TOPICS.map(topic => {
    let groupHtml = '';
    if (topic.group !== lastGroup) { groupHtml = `<div class="guide-group-label">${esc(t(topic.group))}</div>`; lastGroup = topic.group; }
    return `${groupHtml}<button class="guide-topic-btn" data-topic="${topic.id}" type="button">
      <span class="guide-topic-icon">${topic.icon}</span><span>${esc(t('guide_' + topic.id + '_title'))}</span>
    </button>`;
  }).join('');
  sidebar.querySelectorAll('.guide-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => selectGuideTopic(btn.dataset.topic));
  });
}
function renderGuideTopic(id) {
  const topic = GUIDE_TOPICS.find(x => x.id === id);
  const content = document.getElementById('guideContent');
  if (!topic || !content) return;
  const stepsHtml = topic.steps > 0
    ? `<div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_how'))}</div>
        <ol class="guide-steps">${Array.from({ length: topic.steps }, (_, i) => `<li><span class="guide-step-num">${i + 1}</span><span>${t('guide_' + id + '_step' + (i + 1))}</span></li>`).join('')}</ol>
       </div>` : '';
  const connectsHtml = topic.connects > 0
    ? `<div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_connects'))}</div>
        <ul class="guide-connects">${Array.from({ length: topic.connects }, (_, i) => `<li><span class="guide-connect-dot"></span><span>${t('guide_' + id + '_connect' + (i + 1))}</span></li>`).join('')}</ul>
       </div>` : '';
  const tipHtml = topic.tip
    ? `<div class="guide-section"><div class="guide-tip"><span class="guide-tip-icon">💡</span><span>${t('guide_' + id + '_tip')}</span></div></div>` : '';
  const useCaseHtml = topic.steps > 0
    ? `<div class="guide-section"><details class="recurring-panel panel guide-usecase">
        <summary class="recurring-summary"><span class="recurring-summary-title"><span class="recurring-summary-icon" aria-hidden="true">👤</span>${esc(t('guide_' + id + '_usecase_h'))}</span></summary>
        <div class="recurring-body">${t('guide_' + id + '_usecase_p')}</div>
      </details></div>` : '';
  // Prev/next footer so the guide also reads linearly, like a short book
  const topicIdx = GUIDE_TOPICS.findIndex(x => x.id === id);
  const prev = GUIDE_TOPICS[topicIdx - 1], next = GUIDE_TOPICS[topicIdx + 1];
  const pagerHtml = `<div class="guide-pager">
      ${prev ? `<button class="guide-pager-btn guide-pager-btn--prev" data-goto="${prev.id}" type="button"><span class="guide-pager-dir">←</span><span class="guide-pager-label">${prev.icon} ${esc(t('guide_' + prev.id + '_title'))}</span></button>` : '<span></span>'}
      ${next ? `<button class="guide-pager-btn guide-pager-btn--next" data-goto="${next.id}" type="button"><span class="guide-pager-label">${next.icon} ${esc(t('guide_' + next.id + '_title'))}</span><span class="guide-pager-dir">→</span></button>` : '<span></span>'}
    </div>`;
  content.innerHTML = `
    <button class="guide-back-btn" type="button">← ${esc(t('guide_back'))}</button>
    <div class="guide-topic-header">
      <div class="guide-topic-icon-badge">${topic.icon}</div>
      <h3 class="guide-topic-title">${esc(t('guide_' + id + '_title'))}</h3>
      <span class="guide-topic-count">${topicIdx + 1} / ${GUIDE_TOPICS.length}</span>
    </div>
    <div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_big'))}</div><p class="guide-big-picture">${t('guide_' + id + '_big')}</p></div>
    ${stepsHtml}${connectsHtml}${tipHtml}${useCaseHtml}${pagerHtml}`;
  content.querySelector('.guide-back-btn')?.addEventListener('click', () => {
    document.getElementById('guideModal')?.classList.remove('is-topic-open');
  });
  content.querySelectorAll('.guide-pager-btn[data-goto]').forEach(btn =>
    btn.addEventListener('click', () => selectGuideTopic(btn.dataset.goto)));
}
function selectGuideTopic(id, userInitiated = true) {
  guideActiveTopic = id;
  document.querySelectorAll('.guide-topic-btn').forEach(btn => btn.classList.toggle('is-active', btn.dataset.topic === id));
  renderGuideTopic(id);
  if (userInitiated) document.getElementById('guideModal')?.classList.add('is-topic-open');
  const content = document.getElementById('guideContent');
  if (content) { content.scrollTop = 0; if (userInitiated) content.focus(); }
}
function openGuide(initialId) {
  const overlay = document.getElementById('guideOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  document.getElementById('guideModal')?.classList.remove('is-topic-open');
  renderGuideSidebar();
  selectGuideTopic(initialId || guideActiveTopic || GUIDE_TOPICS[0].id, false);
  guideKeydownHandler = e => guideHandleKeydown(e);
  document.addEventListener('keydown', guideKeydownHandler, true);
  setTimeout(() => {
    const overlayEl = document.getElementById('guideOverlay');
    (overlayEl?.querySelector('.guide-topic-btn.is-active') || overlayEl?.querySelector('.guide-close'))?.focus();
  }, 40);
}
function closeGuide() {
  const overlay = document.getElementById('guideOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  if (guideKeydownHandler) { document.removeEventListener('keydown', guideKeydownHandler, true); guideKeydownHandler = null; }
}

function openDebtSchedule(debtId) {
  const DT=debtTypes();
  const result=runDebtPayoff();
  const debt=result?.payoffOrder.find(x=>x.id===debtId);
  const overlay=document.getElementById('debtSchedOverlay');
  const headEl=document.getElementById('debtSchedHead');
  const bodyEl=document.getElementById('debtSchedBody');
  if(!overlay||!headEl||!bodyEl||!debt) return;
  const schedule=debt.schedule||[];
  const hasEscrow=schedule.some(r=>r.escrow!==undefined);
  const parts=[DT[debt.type]||debt.type, `${fmt(debt.balance)} ${t('dpc_balance_word')}`, `${debt.interestRate}% ${t('dpc_apr_word')}`];
  if(AMORTIZING_DEBT_TYPES.includes(debt.type)) parts.push(debt.amortType==='equal_principal'?t('dpc_amort_equal_principal'):t('dpc_amort_equal_payment'));
  if(debt.rateType==='arm') parts.push(t('dpc_rate_type_arm'));
  const colClass=hasEscrow?'debt-sched-row--6col':'debt-sched-row--5col';
  const colHeaderHtml=`<div class="debt-sched-colheader ${colClass}">
    <div>${t('dsched_col_date')}</div><div>${t('dsched_col_payment')}</div><div class="sched-col-secondary">${t('dsched_col_principal')}</div><div class="sched-col-secondary">${t('dsched_col_interest')}</div>
    ${hasEscrow?`<div class="sched-col-secondary">${t('dsched_col_escrow')}</div>`:''}<div>${t('dsched_col_balance')}</div>
  </div>`;
  headEl.innerHTML=`<h3 class="debt-sched-title">${esc(debt.name)}</h3><div class="debt-sched-summary">${parts.map(esc).join(' • ')}</div>`+colHeaderHtml;
  const neverPaidOff=debt.paidOffMonth===null&&schedule.length>=600;
  const warningHtml=neverPaidOff?`<div class="debt-sched-warning"><span aria-hidden="true">⚠️</span><span>${t('dsched_never_payoff_warning')}</span></div>`:'';
  const rowsHtml=schedule.map(row=>`<div class="debt-sched-row ${colClass}">
    <div>${formatDateDisplay(row.date)}</div><div>${fmt(row.payment)}</div><div class="col-principal sched-col-secondary">${fmt(row.principal)}</div><div class="col-interest sched-col-secondary">${fmt(row.interest)}</div>
    ${hasEscrow?`<div class="sched-col-secondary">${row.escrow!==undefined?fmt(row.escrow):'-'}</div>`:''}<div class="col-balance">${fmt(row.balance)}</div>
  </div>`).join('');
  bodyEl.innerHTML=warningHtml+rowsHtml;
  overlay.hidden=false;
  debtSchedKeydownHandler = e => debtSchedHandleKeydown(e);
  document.addEventListener('keydown', debtSchedKeydownHandler, true);
  setTimeout(() => { document.getElementById('debtSchedClose')?.focus(); }, 40);
}
function closeDebtSchedule() {
  const overlay = document.getElementById('debtSchedOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  if (debtSchedKeydownHandler) { document.removeEventListener('keydown', debtSchedKeydownHandler, true); debtSchedKeydownHandler = null; }
}
function debtSchedHandleKeydown(e) {
  const overlay = document.getElementById('debtSchedOverlay');
  if (!overlay || overlay.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeDebtSchedule(); return; }
  if (e.key === 'Tab') {
    const els = guideFocusableEls(overlay);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

// A toast can carry one button. With one it stays a little longer and
// takes clicks; without, it is the plain notice it always was.
function showToast(msg, opts) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
  t.innerHTML = '';
  const m = document.createElement('span'); m.className = 'toast-msg'; m.textContent = msg; t.appendChild(m);
  const act = opts && opts.action;
  if (act) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-act'; b.textContent = act.label;
    b.addEventListener('click', () => { clearTimeout(t._timer); t.classList.remove('show', 'has-act'); act.run(); });
    t.appendChild(b);
  }
  t.classList.toggle('has-act', !!act);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show', 'has-act'), act ? 6000 : 2800);
}
// Every way of adding a transaction notes what it added, and the toast that
// follows offers to take exactly that back.
let _justAdded = [];
function noteAdded(tx) { if (tx && tx.id) _justAdded.push(tx.id); }
function showUndoToast(msg) {
  const ids = _justAdded.slice(); _justAdded = [];
  if (!ids.length) { showToast(msg); return; }
  showToast(msg, { action: { label: t('toast_undo_btn'), run: () => undoAddedTx(ids) } });
}
// Takes back what was just added, the same way deleting it would: a goal
// gives back the contribution, and a bill or debt it paid is owed again.
function undoAddedTx(ids) {
  const set = new Set(ids);
  const gone = state.transactions.filter(tx => set.has(tx.id));
  if (!gone.length) return;
  gone.forEach(tx => applySinkingFundDelta(tx, -1));
  state.transactions = state.transactions.filter(tx => !set.has(tx.id));
  try { syncBillPaidLinks(); } catch (e) {}
  saveState();
  dispatchRender(currentTab);
  try { renderNavWidgets(); } catch (e) {}
  showToast(t('toast_undone'));
}

// ── In-app dialog (replaces native confirm / alert) ───────────────────
function fkDialog({ message, confirmText, cancelText, danger = false, alertOnly = false, icon }) {
  return new Promise(resolve => {
    document.getElementById('fkDialogOverlay')?.remove();
    const ov = document.createElement('div');
    ov.className = 'fk-dialog-overlay';
    ov.id = 'fkDialogOverlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const glyph = icon || (danger ? '\u26A0\uFE0F' : alertOnly ? '\u2139\uFE0F' : '\u2753');
    ov.innerHTML =
      `<div class="fk-dialog${danger ? ' fk-dialog--danger' : ''}" role="document">
        <div class="fk-dialog-icon" aria-hidden="true">${glyph}</div>
        <p class="fk-dialog-msg">${esc(message)}</p>
        <div class="fk-dialog-actions">
          ${alertOnly ? '' : `<button class="btn btn-ghost" data-act="cancel" type="button">${esc(cancelText || t('cancel'))}</button>`}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmText || (alertOnly ? t('ok') : t('save')))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-open'));
    const done = val => {
      ov.classList.remove('is-open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => ov.remove(), 200);
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(alertOnly ? true : false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if (e.key === 'Tab') {
        const els = Array.from(ov.querySelectorAll('button')).filter(el => el.offsetParent !== null);
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!els.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('[data-act="ok"]')?.addEventListener('click', () => done(true));
    ov.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(false));
    ov.addEventListener('click', e => { if (e.target === ov) done(alertOnly ? true : false); });
    setTimeout(() => ov.querySelector('[data-act="ok"]')?.focus(), 40);
  });
}
function confirmDialog(opts)         { return fkDialog({ danger: true, ...opts }); }
function alertDialog(message, icon)  { return fkDialog({ message, alertOnly: true, icon }); }

// The names on the person's own accounts, as chips.
function ownNamesHtml() {
  return (state.settings.ownNames || []).map((n, i) => `<span class="own-chip">${appIconSvg('user')}<span>${esc(n)}</span><button type="button" data-own-del="${i}" aria-label="${esc(tf('own_remove', n))}" title="${esc(tf('own_remove', n))}">\u00d7</button></span>`).join('');
}
// ── Editable planner title ────────────────────────────────────────────
const APP_DEFAULT_TITLE = 'Ultimate Budget';
function applyAppTitle(){ const el=document.getElementById('appTitleText'); if(el) el.textContent=state?.settings?.appTitle||APP_DEFAULT_TITLE; }
// The key that unlocked this device, as it was recorded on redeeming it.
// Only ever read here, for showing to the person.
function licenseKeyOnFile(){ try { return localStorage.getItem('evobudget_ubp_key') || ''; } catch (e) { return ''; } }
function licenseMask(k){ const n=k.length; return k.replace(/[A-Za-z0-9]/g,(c,i)=> i<4 || i>=n-4 ? c : '\u2022'); }
function bindAppTitle(defaultTitle){
  const el=document.getElementById('appTitleText'); if(!el) return;
  const open=()=>openRenameDialog(el.textContent.trim(), defaultTitle, v=>{ state.settings.appTitle=v; saveState(); el.textContent=v; showToast(t('toast_saved')); });
  el.addEventListener('click',open);
  el.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
}
function openRenameDialog(current, defaultTitle, onSave){
  document.getElementById('fkRenameOverlay')?.remove();
  const ov=document.createElement('div'); ov.className='fk-dialog-overlay'; ov.id='fkRenameOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true');
  ov.innerHTML=`<div class="fk-dialog" role="document">
    <div class="fk-dialog-icon">\u270F\uFE0F</div>
    <p class="fk-dialog-msg">${t('rename_title_prompt')}</p>
    <input class="input fk-rename-input" id="fkRenameInput" type="text" maxlength="40" value="${esc(current)}" placeholder="${esc(defaultTitle)}">
    <div class="fk-dialog-actions">
      <button class="btn btn-ghost" data-act="cancel" type="button">${t('cancel')}</button>
      <button class="btn btn-primary" data-act="ok" type="button">${t('save')}</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(()=>ov.classList.add('is-open'));
  const inp=ov.querySelector('#fkRenameInput');
  setTimeout(()=>{inp.focus();inp.select();},50);
  const close=()=>{ov.classList.remove('is-open');document.removeEventListener('keydown',onKey,true);setTimeout(()=>ov.remove(),180);};
  const submit=()=>{const v=inp.value.trim();if(v)onSave(v);close();};
  function onKey(e){ if(e.key==='Escape'){e.preventDefault();close();} else if(e.key==='Enter'){e.preventDefault();submit();} }
  document.addEventListener('keydown',onKey,true);
  ov.querySelector('[data-act="ok"]').addEventListener('click',submit);
  ov.querySelector('[data-act="cancel"]').addEventListener('click',close);
  ov.addEventListener('click',e=>{if(e.target===ov)close();});
}

// ── Custom color picker (allocation buckets), styled like the date picker ──
function openColorPicker(anchor, current, onPick){
  document.getElementById('fkColorPop')?.remove();
  const cur=(current||'').toLowerCase();
  const pop=document.createElement('div'); pop.className='fk-colorpop'; pop.id='fkColorPop';
  pop.innerHTML=`<div class="fk-colorpop-grid">${BUCKET_COLORS.map(c=>`<button type="button" class="fk-color-swatch${c.toLowerCase()===cur?' is-sel':''}" style="background:${c}" data-c="${c}" title="${c}"></button>`).join('')}</div>
    <label class="fk-colorpop-custom">${t('alloc_custom_color')}<input type="color" class="fk-colorpop-input" value="${/^#[0-9a-f]{6}$/i.test(current||'')?current:'#6366f1'}"></label>`;
  document.body.appendChild(pop);
  if(!window.matchMedia('(max-width:480px)').matches){
    const r=anchor.getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight, vw=document.documentElement.clientWidth, vh=window.innerHeight;
    let top=r.bottom+6+window.scrollY, left=r.left+window.scrollX;
    if(left-window.scrollX+pw>vw-8) left=window.scrollX+vw-pw-8;
    if(r.bottom+6+ph>vh && r.top-6-ph>0) top=r.top+window.scrollY-ph-6;
    pop.style.top=Math.max(8+window.scrollY,top)+'px'; pop.style.left=Math.max(8,left)+'px';
  }
  const close=()=>{pop.remove();document.removeEventListener('mousedown',outside,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',close);};
  function outside(e){ if(!pop.contains(e.target)&&e.target!==anchor) close(); }
  function onKey(e){ if(e.key==='Escape'){e.preventDefault();close();} }
  pop.querySelectorAll('.fk-color-swatch').forEach(b=>b.addEventListener('click',ev=>{ev.stopPropagation();onPick(b.dataset.c);close();}));
  const ci=pop.querySelector('.fk-colorpop-input');
  ci.addEventListener('input',ev=>onPick(ev.target.value));
  ci.addEventListener('change',()=>close());
  setTimeout(()=>{document.addEventListener('mousedown',outside,true);document.addEventListener('keydown',onKey,true);window.addEventListener('resize',close);},0);
}

// ── Net-leftover hero ────────────────────────────────────────────────
// The dashboard's headline figure, sitting above everything else. It
// replaces the four stat cards outright: every number they carried is in
// the breakdown on the right, so keeping both would state the same totals
// twice on one screen.
//
// The breakdown lists the same components the old inline strip did, in the
// same colours, so the arithmetic still reconciles to the figure on the left.
function nlDaysInPeriod() {
  const s = new Date(state.settings.periodStart + 'T00:00:00');
  const e = new Date(state.settings.periodEnd + 'T00:00:00');
  if (isNaN(s) || isNaN(e)) return { total: 0, dayOf: 0, left: 0, pct: 0 };
  const DAY = 86400000;
  const total = Math.max(1, Math.round((e - s) / DAY) + 1);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  // Clamped, so a period entirely in the past or future still reads sanely
  // rather than reporting a negative day or more days than the period has.
  const dayOf = Math.min(total, Math.max(1, Math.round((now - s) / DAY) + 1));
  return { total, dayOf, left: Math.max(0, total - dayOf), pct: Math.round(dayOf / total * 100) };
}

// Spending dated today. Uses the same types the breakdown's outgoing side
// counts, so the two agree: savings is money moved aside rather than spent,
// and is excluded here too. The list is per app because each one defines its
// outgoings differently - only UBP treats subscriptions as a separate type.
const NL_SPEND_TYPES = ['expense', 'bill', 'debt'];
// Bill and debt payments made today. They are not everyday spending, so they
// stay out of Spent today and today's allowance, but they did leave the
// account, so the Spent today tile notes them underneath.
function nlBillsPaidToday() {
  const today = toLocalISO(new Date());
  return (state.transactions || []).reduce(
    (s, tx) => (tx.date === today && (tx.type === 'bill' || tx.type === 'debt')) ? s + (Number(tx.amount) || 0) : s, 0);
}
// Today's everyday spending. Bill and debt payments are left out: what is
// due was already set aside, so paying it does not touch what is free, and
// counting it here would wipe out today's allowance on the day the rent
// goes, which is exactly when it has not changed.
function nlSpentToday() {
  const today = toLocalISO(new Date());
  return (state.transactions || []).reduce(
    (s, tx) => (tx.date === today && tx.type === 'expense') ? s + (Number(tx.amount) || 0) : s, 0);
}

// rows: [op, label, amount, colour][] - each app supplies the components its
// own leftover formula uses, so the sum shown always matches the sum used.
// Money already spoken for. Reuses the same event source the Upcoming panel
// draws from, widened from its 7-day window to the rest of the period, so
// the two can never disagree about what is still due. That also brings in
// debts, subscriptions and scheduled automatic transactions for free.
function nlCommitted() {
  const p = nlDaysInPeriod();
  const end = state.settings.periodEnd || '';
  let events = [];
  try { events = getUpcomingEvents(Math.max(0, p.left), computeActuals()) || []; } catch (e) { events = []; }
  // A bill whose date has passed unpaid has not stopped being owed. It is
  // not upcoming, so the event list leaves it out; it is added here, so it
  // comes off what is free to spend and heads the Coming up list.
  const today = toLocalISO(new Date());
  // A bill several cycles behind owes each missed cycle that fell inside
  // this period, not just the oldest one.
  const pStart = state.settings.periodStart || '';
  const overdue = [];
  (state.bills || []).filter(b => b.active !== false && b.nextBillingDate && b.nextBillingDate < today).forEach(b => {
    const exp = rowExpected(b), done = rowPaidAmount(b);
    let d = b.nextBillingDate;
    // Nothing dated after the period's end belongs to it, overdue or not.
    for (let i = 0; i < 400 && d < today && (!end || d <= end); i++) {
      if (i === 0) {
        const amt = rowPayState(b) === 'paid' ? 0 : (Math.max(0, payRound2(exp - done)) || exp);
        if (amt > 0) overdue.push({ label: b.name, date: d, amount: amt, type: 'bill', id: b.id, occDate: d, paidSoFar: done, expected: exp });
      } else if ((!pStart || d >= pStart) && exp > 0) {
        overdue.push({ label: b.name, date: d, amount: exp, type: 'bill', id: b.id, occDate: d, paidSoFar: 0, expected: exp });
      }
      d = stepBillDate(d, b.frequency);
    }
  });
  let debtAct = {};
  try { debtAct = computeActuals().debt || {}; } catch (e) { debtAct = {}; }
  const debtLeft = {};
  (state.debts || []).forEach(d => {
    const o = debtOverdueDates(d, debtAct);
    o.dates.forEach(x => overdue.push({ label: d.name, date: x.date, amount: x.owe, type: 'debt', id: d.id, occDate: x.date, paidSoFar: x.paid, expected: x.min }));
    debtLeft[d.id] = o.left;
  });
  // The next date in the period is settled by what the missed ones left over.
  events = events.map(ev => {
    if (ev.type !== 'debt' || !(ev.srcId in debtLeft) || (end && ev.date > end)) return ev;
    const exp = Number(ev.expected) || 0, cover = Math.min(exp, debtLeft[ev.srcId]);
    debtLeft[ev.srcId] = payRound2(debtLeft[ev.srcId] - cover);
    return { ...ev, amount: payRound2(exp - cover), paid: exp > 0 && cover >= exp - 0.005, paidSoFar: cover };
  });
  const items = overdue.concat(events
    .filter(ev => !ev.paid && (Number(ev.amount) || 0) > 0 && (!end || ev.date <= end))
    .map(ev => ({ label: ev.label, date: ev.date, amount: Number(ev.amount) || 0,
                  type: ev.type, id: ev.srcId, occDate: ev.occDate || ev.date,
                  paidSoFar: ev.paidSoFar || 0, expected: ev.expected || 0 })))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { total: items.reduce((s, i) => s + i.amount, 0), items: items };
}

// The breakdown beside the headline. The hero states what is free to spend,
// so this is where the two figures behind it sit: the period's raw leftover
// and the part of it that is already committed.
function nlYoursPanelHtml(leftover, committed) {
  // The caller usually holds the committed figure already, because the hero
  // needs it to work out what is free. Recomputing here would walk every
  // upcoming event a second time for the same answer, so it is passed in
  // where there is one. The disclosure toggle redraws this panel on its own
  // with nothing else to hand, so the fallback stays.
  const c = committed || nlCommitted();
  const endLabel = state.settings.periodEnd ? formatDateDisplay(state.settings.periodEnd) : '';
  // Hidden unless asked for, so the panel stays quiet by default.
  const open = state.settings.nlDueOpen === true;
  // The leftover has no note of its own: the rate belongs to free-to-spend
  // and followed it up into the hero. The empty slot stays so both figures
  // keep the same label/amount/note rhythm, which is what holds them level
  // at phone widths where they sit side by side. Empty, it is 5px of margin
  // and no height, the same as this slot rendered whenever there was no
  // rate to show.
  return `
    <div class="nl-figs">
      <div class="nl-fig">
        <span>${t('nl_total')}</span>
        <strong style="color:${leftover < 0 ? 'var(--expense)' : 'var(--income)'}">${leftover < 0 ? '\u2212' : ''}${fmt(Math.abs(leftover))}</strong>
        <em></em>
      </div>
      <div class="nl-fig">
        <span>${t('nl_still_to_pay')}${c.items.length ? `<button class="nl-due-toggle" type="button" id="nlDueToggle"
        aria-expanded="${open}">${open ? t('nl_hide') : t('nl_show')}</button>` : ''}</span>
        <strong style="color:var(--expense)">${fmt(c.total)}</strong>
        <em>${c.total > 0 ? (endLabel ? tf('nl_due_before', endLabel) : '') : t('nl_nothing_due')}</em>
      </div>
    </div>
    ${c.items.length && open ? `<div class="nl-due" id="nlDueList">
      ${c.items.map(nlDueRowHtml).join('')}
    </div>` : ''}`;
}

const PAYABLE_KINDS = new Set(['bill', 'debt']);

// One row per payment still owed. The list is shown only when asked for,
// so the panel stays quiet by default.
function nlDueRowHtml(i) {
  const payable = i.id && PAYABLE_KINDS.has(i.type);
  // The paid-so-far note is its own grid row rather than part of the label
  // cell, so it has the full width to sit on and never has to wrap.
  return `<div class="nl-due-row${payable ? ' nl-due-row--pay' : ''}">
    <span><i class="nl-lbl">${esc(i.label)}</i></span>
    <time>${esc(formatDateShort(i.date))}</time><b>${fmt(i.amount)}</b>
    ${payable ? `<button class="pay-btn" type="button" data-pay-type="${esc(i.type)}" data-pay-id="${esc(i.id)}" data-pay-date="${esc(i.occDate || i.date)}">${t('pay_btn')}</button>` : ''}
    ${i.paidSoFar > 0 ? `<em class="nl-part">${tf('nl_partial_of', fmt(i.paidSoFar), fmt(i.expected))}</em>` : ''}
  </div>`;
}

// The hero's own controls. Re-rendering the whole dashboard is what every
// other write on this screen does, so paying keeps the figures in step.
function wireNlHero(scope) {
  scope.querySelectorAll('[data-nl-explain]').forEach(b => b.addEventListener('click', () => openFreeExplain()));
  scope.querySelector('#nlDueToggle')?.addEventListener('click', () => {
    state.settings.nlDueOpen = state.settings.nlDueOpen !== true;
    saveState();
    // Only this panel changes, and redrawing the whole dashboard for a
    // disclosure toggle replayed its entrance animation every time. The
    // figures are recomputed the same way the render computed them.
    const right = scope.querySelector('.nl-right');
    if (!right) { renderDashboard(); return; }
    right.innerHTML = nlYoursPanelHtml(computeSummary(computeActuals()).leftover);
    wireNlHero(scope);   // the toggle and any Pay buttons are new elements
  });
  scope.querySelectorAll('.pay-btn[data-pay-id]').forEach(btn => {
    btn.addEventListener('click', () =>
      promptPay(btn.dataset.payType, btn.dataset.payId, () => renderDashboard(), btn.dataset.payDate));
  });
}

// The decimals get their own span so a theme can tint them apart from the
// whole units. fmt always formats en-US with two places, whichever side the
// currency symbol lands on, so the last dot is always the decimal point.
function nlAmountHtml(v) {
  const s = fmt(Math.abs(Number(v) || 0));
  const i = s.lastIndexOf('.');
  return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<i class="nl-dec">' + esc(s.slice(i)) + '</i>';
}

// The headline figure, read back off the element the render just wrote.
// The entrance count-up has to land on the same number the markup used,
// and the render has already paid for working it out.
function nlHeroTarget(scope) {
  const el = scope.querySelector('.leftover-value');
  return el ? (parseFloat(el.dataset.nlValue) || 0) : 0;
}

function nlHeroHtml(leftover, opts) {
  const o = opts || {};
  const p = nlDaysInPeriod();

  // The headline is what is genuinely free to spend rather than the raw
  // leftover: a leftover of 3,000 with rent still to go is not 3,000 you
  // can spend, so the figure a glance lands on is the one that can be
  // acted on. The leftover keeps its place in the breakdown beside it.
  //
  // Committed is worked out once here and handed to the panel, so the walk
  // over upcoming events runs once and the two figures cannot disagree.
  const c = nlCommitted();
  const free = leftover - c.total;
  const neg = free < 0;

  // The rate describes the free figure, so it moves up here with it. When
  // there is nothing free to spend the sub-line has the more urgent thing
  // to say instead.
  const rate = (p.left > 0 && free > 0) ? tf('nl_free_rate', fmt(free / p.left), p.left) : '';
  const sub = !o.income && !((state.rollover || 0) > 0)
    ? t('nl_empty')
    : neg
      ? tf('nl_over_by', fmt(Math.abs(free)), p.left)
      : rate;

  const spentToday = nlSpentToday(), billsToday = nlBillsPaidToday();
  const freeToday = p.left >= 0 && free > 0 ? Math.max(0, (free + spentToday) / (p.left + 1) - spentToday) : 0;
  const pills = [
    `<div class="nl-pill nl-pill--today"><span>${t('nl_free_today')}</span><strong data-v="${freeToday}">${fmt(freeToday)}</strong></div>`,
    `<div class="nl-pill"><span>${t('nl_spent_today')}</span><strong data-v="${spentToday}">${fmt(spentToday)}</strong>${billsToday > 0 ? `<em class="nl-pill-sub">${esc(tf('nl_bills_today', fmt(billsToday)))}</em>` : ''}</div>`,
    o.subsMonthly
      ? `<div class="nl-pill"><span>${t('dash_subscriptions')}</span><strong>${fmt(o.subsMonthly * 12)}${t('dash_per_year')}</strong></div>`
      : ''
  ].join('');

  // The figure sizes itself to the room it has: its length goes to the
  // stylesheet, which fits it to the column instead of letting a long
  // amount run off a phone screen.
  const figLen = fmt(Math.abs(free)).length + (neg ? 1 : 0);
  return `<div class="panel nl-hero nl-hero--cu${neg ? ' is-negative' : ''}">
    <div class="nl-left">
      <div class="nl-label">${t('nl_free_to_spend')}</div>
      <div class="nl-value leftover-value" style="--nl-len:${figLen}" data-nl-value="${free}">${neg ? '\u2212' : ''}${nlAmountHtml(free)}</div>
      ${sub ? `<div class="nl-sub">${sub}</div>` : ''}
      ${o.income || state.rollover ? `<button class="nl-explain" type="button" data-nl-explain>${t('nl_explain')}</button>` : ''}
      <div class="nl-meta">${pills}</div>
      <div class="nl-track"><i style="width:${p.pct}%"></i></div>
      <div class="nl-track-cap">${tf('nl_day_of', p.dayOf, p.total)}</div>
    </div>
    <div class="nl-right">${comingUpHtml(c, o.cuLimit)}</div>
  </div>`;
}

// ── Budget-period bar (sits under the dashboard heading) ─────────────
// Mirrors the admin dashboard's range bar: the two dates on the left, the
// quick ranges pushed to the right, and the app's own calendar popup on the
// date fields. Changing the period used to mean a round trip to Settings.
// Settings keeps the full preset list (quarter, year, last 30 days) and
// stays the single source of truth: both write through applyBudgetPeriod,
// so neither can drift from the other.
function periodQuickRanges() {
  const now = new Date(), m = getMonthBounds();
  return {
    month:      [m.start, m.end],
    last_month: [toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
                 toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0))]
  };
}
function activePeriodRange() {
  const r = periodQuickRanges(), s = state.settings.periodStart, e = state.settings.periodEnd;
  return Object.keys(r).find(k => r[k][0] === s && r[k][1] === e) || '';
}
// The one write path for the period, so the bar, the Settings presets and
// the Settings date fields cannot disagree about what happens.
function applyBudgetPeriod(start, end, opts) {
  state.settings.periodStart = start;
  state.settings.periodEnd = end;
  bpMarkChosen();
  saveState();
  try { maybeAutoCarryRollover(); } catch (e) {}
  dispatchRender(currentTab);
  if (!(opts && opts.silent)) showToast(t('toast_period_updated'));
}

// ══ Budget period ═══════════════════════════════════════════════════════
// A period follows a rhythm: the calendar month, a month running from one
// payday to the next, or a run of one, two or four weeks from a start date.
// Dates picked by hand are a rhythm of their own that never moves on.
const BP_RHYTHMS = ['month', 'payday', 'w2', 'w4', 'w1', 'custom'];
const BP_WEEKS = { w1: 7, w2: 14, w4: 28 };
// What the sheet offers: dates picked by hand, or monthly from a start day
// (day 1 is the calendar month).
const BP_CHIPS = ['custom', 'payday'];
function bpRhythm() {
  const r = state.settings.periodRhythm;
  return r && BP_RHYTHMS.includes(r.kind) ? r : null;
}
const bpDate = iso => new Date(iso + 'T00:00:00');
const bpAdd = (iso, days) => { const d = bpDate(iso); d.setDate(d.getDate() + days); return toLocalISO(d); };
const bpSpan = (a, b) => Math.round((bpDate(b) - bpDate(a)) / 86400000) + 1;
// The payday in a given month, pulled back to the month's last day when
// the month is too short for it.
function bpPayday(y, m, day) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}
// The period of this rhythm that contains the given date.
function bpPeriodFor(r, refISO) {
  const ref = bpDate(refISO);
  if (!r || r.kind === 'month') {
    return [toLocalISO(new Date(ref.getFullYear(), ref.getMonth(), 1)),
            toLocalISO(new Date(ref.getFullYear(), ref.getMonth() + 1, 0))];
  }
  if (r.kind === 'payday') {
    const day = Math.min(31, Math.max(1, r.day || 1));
    let start = bpPayday(ref.getFullYear(), ref.getMonth(), day);
    if (start > ref) start = bpPayday(ref.getFullYear(), ref.getMonth() - 1, day);
    const next = bpPayday(start.getFullYear(), start.getMonth() + 1, day);
    next.setDate(next.getDate() - 1);
    return [toLocalISO(start), toLocalISO(next)];
  }
  const len = BP_WEEKS[r.kind];
  if (len) {
    const anchor = r.anchor || refISO;
    const k = Math.floor((bpSpan(anchor, refISO) - 1) / len);
    const start = bpAdd(anchor, k * len);
    return [start, bpAdd(start, len - 1)];
  }
  return null;
}
// The rhythm in force, or, before one has been chosen, the one the current
// dates already follow: a whole calendar month reads as one.
function bpRhythmNow() {
  const r = bpRhythm();
  if (r) return r;
  const a = state.settings.periodStart, b = state.settings.periodEnd;
  if (!a || !b) return { kind: 'custom' };
  const m = bpPeriodFor({ kind: 'month' }, a);
  if (m[0] === a && m[1] === b) return { kind: 'month' };
  const day = bpDate(a).getDate(), p = bpPeriodFor({ kind: 'payday', day }, a);
  return p[0] === a && p[1] === b ? { kind: 'payday', day } : { kind: 'custom' };
}
// Dates set by hand (in Settings or the sheet) are stamped with the day they
// were set, so a past period chosen on purpose is never moved on.
function bpMarkChosen() { state.settings.periodSetOn = toLocalISO(new Date()); }
// The year is only said when it is not this one, so a range fits a phone.
function bpEndText(a, b) {
  const y = String(new Date().getFullYear());
  return (b.slice(0, 4) !== y || a.slice(0, 4) !== b.slice(0, 4)) ? formatDateDisplay(b) : formatDateShort(b);
}
function bpRangeText(a, b) { return `${formatDateShort(a)} \u2013 ${bpEndText(a, b)}`; }
function bpRhythmLabel(r) { return t('bp_r_' + ((r && r.kind) || 'custom')); }

// A rhythm set to move on by itself starts the next period once the
// current one is over, as long as the current one is still the one the
// rhythm made. Dates changed in Settings are left exactly where they were,
// and so is a past period chosen on purpose: only a period that was current
// or still to come when it was chosen moves on.
function maybeAdvancePeriod() {
  if (!state || !state.settings) return false;
  const r = bpRhythm() || bpRhythmNow();
  if (!r || r.kind === 'custom' || r.auto === false) return false;
  const s0 = state.settings.periodStart, e0 = state.settings.periodEnd;
  const today = toLocalISO(new Date());
  if (!s0 || !e0 || today <= e0) return false;
  const since = [r.since, state.settings.periodSetOn].filter(Boolean).sort().pop();
  if (since && e0 < since) return false;
  const mine = bpPeriodFor(r, s0);
  if (!mine || mine[0] !== s0 || mine[1] !== e0) return false;
  const next = bpPeriodFor(r, today);
  if (!next) return false;
  state.settings.periodStart = next[0];
  state.settings.periodEnd = next[1];
  saveState();
  try { maybeAutoCarryRollover(); } catch (e) {}
  setTimeout(() => showToast(tf('bp_moved', bpRangeText(next[0], next[1]))), 600);
  return true;
}
// A page left open past the end of a period moves on when it is next
// looked at, or within a minute while it is on screen.
function bpWatch() {
  try { if (!document.hidden && maybeAdvancePeriod()) dispatchRender(currentTab); } catch (e) {}
}
document.addEventListener('visibilitychange', bpWatch);
setInterval(bpWatch, 60000);

// The button that stands in for the old bar: the range, and under it the
// rhythm and how many days are left.
function periodBarHtml() {
  const s0 = state.settings.periodStart, e0 = state.settings.periodEnd;
  const p = nlDaysInPeriod();
  const today = toLocalISO(new Date());
  return `<button class="period-btn" id="periodBtn" type="button" aria-haspopup="dialog" title="${esc(t('bp_title'))}">
    <span class="period-btn-ico" aria-hidden="true">${appIconSvg('calendar')}</span>
    <span class="period-btn-txt"><b>${esc(bpRangeText(s0, e0))}</b></span>
    <svg class="period-btn-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </button>`;
}
function wirePeriodBar(scope) {
  (scope || document).querySelector('#periodBtn')?.addEventListener('click', openPeriodPicker);
}

function openPeriodPicker() {
  const today = toLocalISO(new Date());
  let range = [state.settings.periodStart, state.settings.periodEnd];
  // What the sheet opens on: the rhythm last chosen, or whatever the
  // current dates already look like.
  let r = { ...bpRhythmNow() };
  if (r.auto === undefined) r.auto = true;
  // Rhythms no longer offered open as their nearest quick pick.
  if (r.kind === 'month') r = { ...r, kind: 'payday', day: 1 };
  else if (!BP_CHIPS.includes(r.kind)) r = { ...r, kind: 'custom' };
  let view = bpDate(range[0]);
  let picking = false;           // dates picked by hand: waiting for the last day
  const lang = 'en';
  let monthFmt, dowFmt;
  try { monthFmt = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }); dowFmt = new Intl.DateTimeFormat(lang, { weekday: 'narrow' }); }
  catch (e) { monthFmt = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }); dowFmt = new Intl.DateTimeFormat('en', { weekday: 'narrow' }); }
  const planned = (state.budgets?.income || []).reduce((t, x) => t + (x.expected || 0), 0);

  document.getElementById('modalTitle').textContent = t('bp_title');
  document.getElementById('modalBody').innerHTML = `<div class="bp">
    <div class="bp-hero">
      <button class="bp-step" type="button" data-bp-step="-1" aria-label="${esc(t('bp_prev'))}" title="${esc(t('bp_prev'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
      <div class="bp-range" aria-live="polite">
        <div class="bp-dates"><span id="bpFrom"></span><i aria-hidden="true">\u2192</i><span id="bpTo"></span></div>
        <div class="bp-meta" id="bpMeta"></div>
      </div>
      <button class="bp-step" type="button" data-bp-step="1" aria-label="${esc(t('bp_next'))}" title="${esc(t('bp_next'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="bp-grid">
      <section class="bp-side">
        <p class="qa-label">${t('bp_how')}</p>
        <div class="bp-rhythms" role="radiogroup" aria-label="${esc(t('bp_how'))}">${BP_CHIPS.map(k =>
          `<button class="qa-chip bp-rhythm" type="button" role="radio" data-bp-r="${k}">${esc(t('bp_r_' + k))}</button>`).join('')}</div>
        <div class="bp-opt" id="bpOpt"></div>
        <label class="bp-auto" id="bpAutoRow"><span class="recurring-toggle"><input type="checkbox" id="bpAuto"><span class="rec-toggle-track"></span></span><span>${t('bp_auto')}</span></label>
        <p class="bp-note" id="bpNote" hidden></p>
      </section>
      <section class="bp-cal">
        <div class="bp-cal-head">
          <button class="bp-cal-nav" type="button" data-bp-mon="-1" aria-label="${esc(t('cal_prev'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
          <span class="bp-cal-title" id="bpCalTitle"></span>
          <button class="bp-cal-nav" type="button" data-bp-mon="1" aria-label="${esc(t('cal_next'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
        </div>
        <div class="bp-dow">${[0, 1, 2, 3, 4, 5, 6].map(i => `<span>${esc(dowFmt.format(new Date(2024, 0, 1 + i)))}</span>`).join('')}</div>
        <div class="bp-days" id="bpDays"></div>
        <p class="bp-hint" id="bpHint"></p>
      </section>
    </div>
    <div class="qa-actions bp-actions">
      <button class="btn btn-ghost" id="bpCancel" type="button">${t('cancel')}</button>
      <button class="btn btn-primary qa-go" id="bpSaveBtn" type="button"></button>
    </div>
  </div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  const $ = id => document.getElementById(id);

  const paint = () => {
    const [a, b] = range;
    $('bpFrom').textContent = formatDateShort(a);
    $('bpTo').textContent = bpEndText(a, b);
    const len = bpSpan(a, b);
    const where = today < a ? tf('bp_starts_in', bpSpan(today, a) - 1)
      : today > b ? t('bp_over') : tf('bp_day_of', bpSpan(a, today), len);
    $('bpMeta').textContent = `${tf('bp_days', len)} \u00b7 ${where}`;
    document.querySelectorAll('[data-bp-r]').forEach(c => {
      const on = c.dataset.bpR === r.kind;
      c.classList.toggle('is-on', on); c.setAttribute('aria-checked', on);
    });
    // The one thing each rhythm needs set, beside the chips.
    const opt = $('bpOpt');
    if (r.kind === 'payday') {
      opt.innerHTML = `<div class="bp-stepper"><span class="qa-label">${t('bp_payday')}</span>
        <button class="qa-chip" type="button" data-bp-day="-1" aria-label="-">\u2212</button>
        <b>${tf('bp_day_n', r.day || 1)}</b>
        <button class="qa-chip" type="button" data-bp-day="1" aria-label="+">+</button></div>`;
    } else if (BP_WEEKS[r.kind]) {
      opt.innerHTML = `<p class="bp-sub">${tf('bp_starts', formatDateDisplay(r.anchor || a))}</p>`;
    } else opt.innerHTML = '';
    opt.querySelectorAll('[data-bp-day]').forEach(btn => btn.addEventListener('click', () => {
      r.day = Math.min(31, Math.max(1, (r.day || 1) + Number(btn.dataset.bpDay)));
      range = bpPeriodFor(r, today >= range[0] && today <= range[1] ? today : range[0]);
      view = bpDate(range[0]); paint(); btn.blur();
    }));
    $('bpAutoRow').hidden = r.kind === 'custom';
    $('bpAuto').checked = r.auto !== false;
    $('bpHint').textContent = r.kind === 'custom' ? t(picking ? 'bp_tap_last' : 'bp_tap_custom') : t('bp_tap_rhythm');
    const note = $('bpNote');
    if (planned > 0) { note.textContent = tf('bp_daily', fmt(planned), fmt(planned / len)); note.hidden = false; }
    else note.hidden = true;
    $('bpSaveBtn').textContent = tf('bp_use', `${formatDateShort(a)} \u2013 ${formatDateShort(b)}`);
    // The calendar: the chosen range as one band, its ends as solid caps.
    const y = view.getFullYear(), m = view.getMonth();
    $('bpCalTitle').textContent = monthFmt.format(view);
    const lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="bp-day is-blank"></span>';
    for (let d = 1; d <= days; d++) {
      const iso = toLocalISO(new Date(y, m, d));
      const cls = ['bp-day'];
      if (iso >= a && iso <= b) cls.push('in-range');
      if (iso === a) cls.push('is-start');
      if (iso === b) cls.push('is-end');
      if (iso === today) cls.push('is-today');
      cells += `<button type="button" class="${cls.join(' ')}" data-bp-iso="${iso}">${d}</button>`;
    }
    $('bpDays').innerHTML = cells;
  };

  const setRhythm = k => {
    const ref = today >= range[0] && today <= range[1] ? today : range[0];
    r = { ...r, kind: k };
    picking = false;
    if (k === 'payday' && !r.day) r.day = bpDate(range[0]).getDate();
    if (BP_WEEKS[k]) r.anchor = range[0];
    if (k !== 'custom') range = bpPeriodFor(r, ref);
    view = bpDate(range[0]);
    paint();
  };
  document.querySelectorAll('[data-bp-r]').forEach(c => c.addEventListener('click', () => { setRhythm(c.dataset.bpR); c.blur(); }));
  document.querySelectorAll('[data-bp-step]').forEach(btn => btn.addEventListener('click', () => {
    const dir = Number(btn.dataset.bpStep);
    if (r.kind === 'custom') {
      const len = bpSpan(range[0], range[1]);
      range = [bpAdd(range[0], dir * len), bpAdd(range[1], dir * len)];
    } else {
      range = bpPeriodFor(r, dir > 0 ? bpAdd(range[1], 1) : bpAdd(range[0], -1));
    }
    view = bpDate(range[0]); paint(); btn.blur();
  }));
  document.querySelectorAll('[data-bp-mon]').forEach(btn => btn.addEventListener('click', () => {
    view = new Date(view.getFullYear(), view.getMonth() + Number(btn.dataset.bpMon), 1); paint(); btn.blur();
  }));
  // A tap on a day: with dates picked by hand it sets the first day and
  // then the last; with a rhythm it starts the period on that day.
  $('bpDays').addEventListener('click', e => {
    const d = e.target.closest('[data-bp-iso]');
    if (!d) return;
    const iso = d.dataset.bpIso;
    if (r.kind === 'custom') {
      if (!picking || iso < range[0]) { range = [iso, iso]; picking = true; }
      else { range = [range[0], iso]; picking = false; }
    } else if (r.kind === 'month') {
      range = bpPeriodFor(r, iso);
    } else if (r.kind === 'payday') {
      r.day = bpDate(iso).getDate();
      range = bpPeriodFor(r, iso);
    } else {
      r.anchor = iso;
      range = bpPeriodFor(r, iso);
    }
    const keepView = view;
    paint();
    view = keepView;
  });
  $('bpAuto').addEventListener('change', e => { r.auto = e.target.checked; });
  $('bpCancel').addEventListener('click', closeModal);
  $('bpSaveBtn').addEventListener('click', () => {
    if (!range[0] || !range[1] || range[0] > range[1]) { showToast(t('toast_period_error')); return; }
    state.settings.periodRhythm = { kind: r.kind, day: r.day || null, anchor: r.anchor || null, auto: r.auto !== false, since: today };
    closeModal();
    applyBudgetPeriod(range[0], range[1]);
  });
  paint();
}

// ── Custom themed date picker (replaces native calendar popup) ────────
function openDatePicker(input, anchor){
  if(!input) return;
  const existing=document.getElementById('fkDatePop');
  const wasFor=existing&&existing._for;
  if(existing) existing.remove();
  if(wasFor===input) return; // toggle off if re-clicking same field
  const lang='en';
  const parse=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null;};
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const sel=parse(input.value), base=sel||new Date();
  let vy=base.getFullYear(), vm=base.getMonth();
  const today0=new Date(); today0.setHours(0,0,0,0);
  const pop=document.createElement('div'); pop.className='fk-datepop'; pop.id='fkDatePop'; pop._for=input;
  let titleFmt,dowFmt; try{titleFmt=new Intl.DateTimeFormat(lang,{month:'long',year:'numeric'});dowFmt=new Intl.DateTimeFormat(lang,{weekday:'short'});}catch(e){titleFmt=new Intl.DateTimeFormat('en',{month:'long',year:'numeric'});dowFmt=new Intl.DateTimeFormat('en',{weekday:'short'});}
  const dow=[]; for(let i=0;i<7;i++) dow.push(dowFmt.format(new Date(2024,0,1+i))); // 2024-01-01 = Monday
  function draw(){
    const startDow=(new Date(vy,vm,1).getDay()+6)%7, dim=new Date(vy,vm+1,0).getDate();
    let cells='';
    for(let i=0;i<startDow;i++) cells+='<span class="fk-dp-day fk-dp-empty"></span>';
    for(let d=1;d<=dim;d++){const dd=new Date(vy,vm,d),sd=sel&&iso(sel)===iso(dd),td=dd.getTime()===today0.getTime();cells+=`<button type="button" class="fk-dp-day${sd?' is-sel':''}${td?' is-today':''}" data-iso="${iso(dd)}">${d}</button>`;}
    pop.innerHTML=`<div class="fk-dp-head"><button type="button" class="fk-dp-nav" data-nav="-1">\u2039</button><span class="fk-dp-title">${titleFmt.format(new Date(vy,vm,1))}</span><button type="button" class="fk-dp-nav" data-nav="1">\u203A</button></div><div class="fk-dp-dow">${dow.map(n=>`<span>${n}</span>`).join('')}</div><div class="fk-dp-grid">${cells}</div><div class="fk-dp-foot"><button type="button" class="fk-dp-today">${t('dp_today')}</button><button type="button" class="fk-dp-clear">${t('dp_clear')}</button></div>`;
    pop.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',ev=>{ev.stopPropagation();vm+=+b.dataset.nav;if(vm<0){vm=11;vy--;}else if(vm>11){vm=0;vy++;}draw();}));
    pop.querySelectorAll('.fk-dp-day[data-iso]').forEach(b=>b.addEventListener('click',ev=>{ev.stopPropagation();commit(b.dataset.iso);}));
    pop.querySelector('.fk-dp-today').addEventListener('click',ev=>{ev.stopPropagation();commit(iso(new Date()));});
    pop.querySelector('.fk-dp-clear').addEventListener('click',ev=>{ev.stopPropagation();commit('');});
  }
  function commit(v){input.value=v;input.dispatchEvent(new Event('change',{bubbles:true}));close();}
  function close(){pop.remove();document.removeEventListener('mousedown',outside,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',close);}
  function outside(e){if(!pop.contains(e.target))close();}
  function onKey(e){if(e.key==='Escape'){e.preventDefault();close();}}
  document.body.appendChild(pop); draw();
  if(!window.matchMedia('(max-width:480px)').matches){
    const r=(anchor||input).getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight, vw=document.documentElement.clientWidth, vh=window.innerHeight;
    let top=r.bottom+6+window.scrollY, left=r.left+window.scrollX;
    if(left-window.scrollX+pw>vw-8) left=window.scrollX+vw-pw-8;
    if(r.bottom+6+ph>vh && r.top-6-ph>0) top=r.top+window.scrollY-ph-6;
    pop.style.top=Math.max(8+window.scrollY,top)+'px'; pop.style.left=Math.max(8,left)+'px';
  }
  setTimeout(()=>{document.addEventListener('mousedown',outside,true);document.addEventListener('keydown',onKey,true);window.addEventListener('resize',close);},0);
}
// Intercept raw native date inputs (not behind a styled wrapper)
document.addEventListener('mousedown',e=>{
  const inp=e.target.closest?.('input[type="date"]');
  if(inp && !inp.closest('.date-field-styled') && !inp.closest('.date-cell-styled')){ e.preventDefault(); openDatePicker(inp,inp); }
},true);

// ── Themed number steppers (replaces native spinner arrows) ───────────
// A minus and a plus side by side after the field. Each press moves the
// value by one (a dollar, a day, a percent); holding it down keeps going.
const FK_NUM_SEL='input[type="number"]:not([data-stepper]):not([data-no-stepper])';
function fkAddStepper(inp){
  if(inp.dataset.stepper||!inp.parentNode) return; inp.dataset.stepper='1';
  const wrap=document.createElement('span');
  wrap.className='num-field'+(inp.classList.contains('input')?'':' num-field--inline');
  inp.parentNode.insertBefore(wrap,inp); wrap.appendChild(inp);
  const st=document.createElement('span'); st.className='num-steppers';
  st.innerHTML='<button type="button" class="num-step" data-d="-1" tabindex="-1" aria-label="-1">\u2212</button><button type="button" class="num-step" data-d="1" tabindex="-1" aria-label="+1">+</button>';
  wrap.appendChild(st);
  const bump=dir=>{
    const cur=parseFloat(inp.value)||0, mn=parseFloat(inp.min), mx=parseFloat(inp.max);
    let n=Math.round((cur+dir)*100)/100; if(!isNaN(mn)&&n<mn)n=mn; if(!isNaN(mx)&&n>mx)n=mx;
    if(String(n)===inp.value) return;
    inp.value=n; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true}));
  };
  st.querySelectorAll('.num-step').forEach(b=>{
    const dir=+b.dataset.d; let wait=0, rep=0, held=false;
    const stop=()=>{clearTimeout(wait);clearInterval(rep);wait=rep=0;};
    b.addEventListener('pointerdown',e=>{
      if(e.button!==0) return; e.preventDefault(); held=true; bump(dir);
      wait=setTimeout(()=>{rep=setInterval(()=>bump(dir),70);},420);
    });
    b.addEventListener('pointerup',stop);
    ['pointerleave','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>{stop();held=false;}));
    // A click from the keyboard or a script, which has no pointer press before it.
    b.addEventListener('click',()=>{ if(held){held=false;return;} bump(dir); });
  });
}
function fkScanSteppers(root){ root&&root.querySelectorAll&&root.querySelectorAll(FK_NUM_SEL).forEach(fkAddStepper); }
function fkInitUIEnhancers(){
  fkScanSteppers(document);
  new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.matches&&n.matches(FK_NUM_SEL))fkAddStepper(n);fkScanSteppers(n);}}).observe(document.body,{childList:true,subtree:true});
}

// ── SBP IMPORT ────────────────────────────────────────────────────────
function checkSBPImport(){
  let sbp;try{const r=localStorage.getItem(SBP_KEY);sbp=r?JSON.parse(r):null;}catch{return;}
  if(!sbp)return;
  const txCount=sbp.transactions?.length||0;
  const hasData=txCount>0||Object.values(sbp.budgets||{}).some(a=>a.some(r=>r.expected>0));
  if(!hasData)return;
  const banner=document.createElement('div');banner.className='import-banner';banner.id='sbpBanner';
  banner.innerHTML=`<div class="import-banner-inner"><div class="import-banner-text"><strong>📥 Simple Budget data found!</strong><br>Import your ${txCount} transaction${txCount!==1?'s':''} and budget categories to get started instantly.</div><div class="import-banner-btns"><button class="btn btn-primary btn-sm" id="importSBPBtn">Import data</button><button class="btn btn-ghost btn-sm" id="dismissImportBtn">Start fresh</button></div></div>`;
  document.getElementById('app').prepend(banner);
  document.getElementById('importSBPBtn')?.addEventListener('click',()=>{
    state.settings={...sbp.settings};state.rollover=sbp.rollover||0;
    // The simple planner still budgets bills and savings as sections. Here
    // they belong to the Bills and Savings Goals tabs, so they are moved on
    // the way in rather than landing in a budget with nowhere for them.
    state.budgets=JSON.parse(JSON.stringify({income:sbp.budgets.income||[],expenses:sbp.budgets.expenses||[]}));
    state.bills=[...(state.bills||[]),...(sbp.budgets.bills||[]).map(r=>({
      id:uid(),name:r.category,category:r.category,amount:r.expected||0,frequency:'monthly',
      nextBillingDate:rowDueDay(r)?nextDueFromDay(rowDueDay(r)):'',active:true,kind:'bill',payTxIds:[]}))];
    state.sinkingFunds=[...(state.sinkingFunds||[]),...(sbp.budgets.savings||[]).map(r=>({
      id:uid(),name:r.category,icon:'\u{1F3E6}',targetAmount:0,currentSaved:0,targetDate:'',
      monthlyContribution:r.expected||0}))];
    state.transactions=sbp.transactions.map(tx=>({...tx,
      type:tx.type==='subscription'?'bill':tx.type==='savings'?'sinking_fund':tx.type}));
    if(sbp.budgets.debt?.length>0)state.debts=sbp.budgets.debt.map(d=>({id:uid(),name:d.category,type:'other',balance:0,interestRate:5,minimumPayment:d.expected||0,dueDay:rowDueDay(d)||''}));
    SYM=state.settings.symbol;saveState();banner.remove();
    const cs=document.getElementById('currencySelect');if(cs)cs.value=`${state.settings.currency}|${state.settings.symbol}`;
    showToast(tf('toast_imported',txCount));switchTab('dashboard');
  });
  document.getElementById('dismissImportBtn')?.addEventListener('click',()=>{banner.remove();maybeStartOnboarding();});
}

// ── Layout (top bar only) ─────────────────────────────────────────────
function applyLayout() {
  document.body.classList.remove('layout-sidebar');
  document.body.classList.add('layout-classic');
}

// ── INIT ──────────────────────────────────────────────────────────────
async function init(){
  syncAdoptHandoffToken('ubp');
  if(syncGetMode('ubp')==='google'){await syncSilentResync('ubp').catch(()=>{});}
  state=loadState()||defaultState();syncSymbol();
  settingsCatchUp();
  // One-time handoff from a launch code redeemed on the hub page (script.js)
  // - it can't touch this tool's own `state` directly since redeeming
  // happens on a different page/script before this one ever loads.
  const pendingLayout=localStorage.getItem('evobudget_ubp_pending_layout');
  if(pendingLayout){state.settings.dashboardLayout=parseInt(pendingLayout,10)||1;localStorage.removeItem('evobudget_ubp_pending_layout');}
  saveState(); // ensures localStorage always mirrors state, so Google sync has real data to seed a Drive file with right away

  // A failure anywhere in this optional setup must never leave the whole
  // page blank - log it loudly (visible as a red error in DevTools) and
  // still fall through to rendering the dashboard below.
  try {
    const now=new Date();calYear=now.getFullYear();calMonth=now.getMonth();
    initTheme();
    applyLanguage();

    // Offer to import Simple Budget data only when this tool is empty
    if(!isTrial()&&state.transactions.length===0&&state.debts.length===0&&state.sinkingFunds.length===0)checkSBPImport();

    // Classic top tabs
    document.getElementById('ubpTabs')?.querySelectorAll('.btab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));
    enableDragScroll(document.getElementById('ubpTabs'));
    applyNavPosition();
    initSwipeNav();

    // Content dissolves under the empty nav ONLY while scrolled - at rest the
    // scroll region is fully transparent with no fade (see .app-scroll.is-scrolled).
    const _scroller=document.querySelector('.app-scroll');
    if(_scroller)_scroller.addEventListener('scroll',()=>_scroller.classList.toggle('is-scrolled',_scroller.scrollTop>4),{passive:true});

    // Command nav items
    document.getElementById('heroHeader')?.querySelectorAll('.cnav-btn[data-btab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));

    // Back to hub
    // Once the planner is open, the tools page is not where "home" means.
    // The dashboard is. Upgrading still reaches it from the banner, which
    // goes straight to the other planner.
    document.getElementById('backToHub')?.addEventListener('click',()=>switchTab('dashboard'));
    syncHomeLabel();

    // Settings gear
    document.getElementById('settingsNavBtn')?.addEventListener('click',()=>switchTab('settings'));
    document.getElementById('notifNavBtn')?.addEventListener('click',()=>switchTab('notifications'));

    // Guide
    // Open the guide on the topic for wherever the user currently is -
    // opening it from the Debt tab should land on the Debt guide page.
    document.getElementById('guideNavBtn')?.addEventListener('click',()=>{
      const topicIds=new Set(GUIDE_TOPICS.map(x=>x.id));
      openGuide(topicIds.has(currentTab)?currentTab:undefined);
    });
    // Can I afford it? has no button in the top bar. The sidebar and the
    // phone menu press this one, the same way they press the assistant's.
    if (!document.getElementById('affordNavBtn')) {
      const ab = document.createElement('button');
      ab.type = 'button'; ab.id = 'affordNavBtn'; ab.hidden = true;
      ab.addEventListener('click', () => openAffordCheck());
      document.body.appendChild(ab);
    }
    document.getElementById('guideClose')?.addEventListener('click',closeGuide);
    document.getElementById('guideOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeGuide();});
    document.getElementById('debtSchedClose')?.addEventListener('click',closeDebtSchedule);
    document.getElementById('debtSchedOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeDebtSchedule();});

    // Ezzo (AI assistant) - failure here must never block the rest of init
    try { await pennyInit(); } catch (e) { console.error('[init] Ezzo setup failed:', e); }

    // Modal
    document.getElementById('modalClose')?.addEventListener('click',closeModal);
    document.getElementById('tutorialOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
    document.addEventListener('keydown',e=>{
      const overlay=document.getElementById('tutorialOverlay');
      if(!overlay||overlay.hidden)return;
      if(e.key==='Escape'){closeModal();return;}
      if(e.key==='Tab'){
        const els=guideFocusableEls(overlay);
        if(!els.length)return;
        const first=els[0],last=els[els.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
    // Move focus into the modal whenever it opens, so keyboard users don't
    // start tabbing through the (visually hidden) page behind the overlay.
    new MutationObserver(muts=>{
      for(const m of muts){
        if(m.attributeName==='hidden'){
          const overlay=document.getElementById('tutorialOverlay');
          if(overlay&&!overlay.hidden){
            const els=guideFocusableEls(overlay);
            (els[0]||overlay).focus();
          }
        }
      }
    }).observe(document.getElementById('tutorialOverlay'),{attributes:true});

    applyLayout(state.settings?.layout||'classic');
  } catch (e) {
    console.error('[init] error during startup setup (rendering the dashboard anyway):', e);
  }

  try { if (typeof applyTools === 'function') applyTools(); }
  catch (e) { console.error('[init] tools setup failed:', e); }
  try { switchTab('dashboard'); }
  catch (e) { console.error('[init] switchTab(dashboard) failed - this is why the page can appear blank:', e); }

  try { fkInitUIEnhancers(); applyAppTitle(); bindAppTitle(APP_DEFAULT_TITLE); }
  catch (e) { console.error('[init] post-render setup failed:', e); }

  // Skip the walkthrough if an SBP-import banner is offering real data instead -
  // importing beats manually re-entering it, and dismissing that banner
  // re-triggers this check (see checkSBPImport's dismiss handler).
  try { if (!document.getElementById('sbpBanner')) maybeStartOnboarding(); }
  catch (e) { console.error('[init] onboarding start failed:', e); }
}
// The first-run setup lives in simple.js (maybeStartOnboarding).

document.addEventListener('DOMContentLoaded',init);

// This page is the paid product, so an unlock withdrawn while it is open
// has to take effect rather than wait for the next visit. script.js is not
// loaded here, so the check is done directly against the same endpoint it
// uses, with the same fail-open rule: only a definite revoked/not_found
// from the server withdraws access.
(function watchUnlock(){
  const KEY_STORE = 'evobudget_ubp_key';
  const CHECK_STORE = 'evobudget_ubp_checked';
  const RECHECK_MS = 86400000;
  let seq = 0;
  function ask(key){
    return new Promise(resolve => {
      const endpoint = (typeof ANALYTICS_ENDPOINT === 'string') ? ANALYTICS_ENDPOINT : '';
      if (!endpoint) { resolve(null); return; }
      const cb = 'ezzoUbpKeyCb' + (++seq) + '_' + Math.floor(Math.random()*1e6);
      const sc = document.createElement('script');
      let done = false;
      const finish = r => { if(done) return; done = true; clearTimeout(tm); window[cb] = function(){}; sc.parentNode && sc.parentNode.removeChild(sc); resolve(r); };
      const tm = setTimeout(() => finish(null), 15000);
      window[cb] = res => finish(res || null);
      const isEtsy = /^ETSY(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(key);
      const qs = new URLSearchParams(isEtsy
        ? { action:'validate', key: key, vid: (typeof _analyticsVisitorId === 'function' ? _analyticsVisitorId() : ''), cb: cb, _: String(Date.now()) }
        : { action:'code', code: key, cb: cb, _: String(Date.now()) });
      sc.src = endpoint + '?' + qs;
      sc.onerror = () => finish(null);
      document.head.appendChild(sc);
    });
  }
  setTimeout(async () => {
    try {
      if (!isUnlockedUbp()) return;
      const key = localStorage.getItem(KEY_STORE) || '';
      if (!key) return;                               // unlocked before keys were recorded
      const last = Number(localStorage.getItem(CHECK_STORE) || '0');
      if (Date.now() - last < RECHECK_MS) return;
      const res = await ask(key);
      if (res && res.ok) { localStorage.setItem(CHECK_STORE, String(Date.now())); return; }
      // "not_found" means different things per key type. An Etsy key is
      // issued per buyer, so its disappearance is a real withdrawal. A
      // launch code is a shared one that gets retired, and retiring it must
      // never evict the people who already redeemed it.
      const isEtsyKey = /^ETSY(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(key);
      if (res && (res.error === 'revoked' || (res.error === 'not_found' && isEtsyKey))) {
        localStorage.removeItem('evobudget_ubp_unlocked');
        localStorage.removeItem(KEY_STORE);
        localStorage.removeItem(CHECK_STORE);
        try { trackEvent('unlock_revoked', { tool: 'ubp' }); } catch (e) {}
        location.replace('budgetplanner');
      }
      // Anything else (offline, busy, device_limit) is inconclusive: leave it.
    } catch (e) {}
  }, 5000);
})();

// ── Keyboard Navigation (UBP) ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.activeElement;
  if (!active) return;

  // Subscription name / amount in modal
  if (active.id === 'subName' || active.id === 'subAmount') {
    e.preventDefault(); document.getElementById('saveSubBtn')?.click(); return;
  }

  // Savings goal modal
  if (active.id === 'fundName' || active.id === 'fundTarget' || active.id === 'fundSaved') {
    e.preventDefault(); document.getElementById('saveFundBtn')?.click(); return;
  }

  // Generic modal: Enter confirms primary button
  if (active.tagName !== 'SELECT' && active.tagName !== 'TEXTAREA' && active.tagName !== 'BUTTON') {
    const overlay = document.getElementById('tutorialOverlay');
    if (overlay && !overlay.hidden) {
      e.preventDefault();
      overlay.querySelector('.btn-primary')?.click();
    }
  }
});

// Calendar: arrow keys navigate months, Escape clears day selection
document.addEventListener('keydown', e => {
  if (!document.getElementById('bview-calendar')?.classList.contains('is-active')) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); document.getElementById('calPrev')?.click(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('calNext')?.click(); }
  if (e.key === 'Escape' && typeof calSelectedDay !== 'undefined' && calSelectedDay !== null) {
    calSelectedDay = null; renderCalendar();
  }
});

// The tab bars ship empty icon slots naming what belongs in them. Fill them
// as soon as the markup exists, not only when the language changes, since
// the language only changes if someone asks for it.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintTabIcons);
else paintTabIcons();
