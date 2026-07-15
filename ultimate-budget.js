/* Evo Budget - v2.7 "Onboarding & Upgrade"  (2026-07-01)
   Change set vs v1.0 "Baseline":
   - All native browser confirm()/alert() popups replaced with in-app
     glass dialogs (confirmDialog / alertDialog) - mobile-friendly.
   - UBP: duplicated init()/applyLayout() collapsed into one; recurring
     engine restored and init now runs exactly once. */
'use strict';
/* =====================================================================
   Evo Budget - Ultimate Budget Planner  (ultimate-budget.js)
   ===================================================================== */

// ── Utilities ─────────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2, 11);
const esc   = s  => { const d = document.createElement('div'); d.appendChild(document.createTextNode(String(s ?? ''))); return d.innerHTML; };
const today = () => new Date().toISOString().slice(0, 10);

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

const POST_SYM = new Set(['PLN','SEK','NOK','DKK','HUF','CZK','RON','HRK']);
let SYM = '$';
const fmt = v => {
  const n = Math.abs(Number(v||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return POST_SYM.has(state?.settings?.currency) ? `${n}\u00a0${SYM}` : `${SYM}${n}`;
};
const pct = (a,e) => (!e||e===0) ? 0 : Math.min(999, Math.round((a/e)*100));

const calIcon = () => `<svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const helpBtn = k => `<button class="help-icon-btn" data-help="${k}" type="button" aria-label="Help">?</button>`;

function styledDateField(inputId, wrapId, value) {
  return `<div class="date-field-styled" id="${wrapId}">${calIcon()}<span class="date-field-val" id="${inputId}Disp">${value ? formatDateDisplay(value) : '<span class="no-date">Set date</span>'}</span><input type="date" id="${inputId}" value="${value||''}"></div>`;
}
function bindDateField(inputId, wrapId, onChange) {
  document.getElementById(wrapId)?.addEventListener('click', () => { openDatePicker(document.getElementById(inputId), document.getElementById(wrapId)); });
  document.getElementById(inputId)?.addEventListener('change', e => {
    const disp = document.getElementById(inputId+'Disp');
    if (disp) disp.innerHTML = e.target.value ? formatDateDisplay(e.target.value) : '<span class="no-date">Set date</span>';
    if (onChange) onChange(e.target.value);
  });
}

// ── State ─────────────────────────────────────────────────────────────
const UBP_KEY = 'evobudget_ubp_v1';
const SBP_KEY = 'evobudget_v1';

function defaultState() {
  const {start,end} = getMonthBounds();
  return {
    settings: { currency:'USD', symbol:'$', periodStart:start, periodEnd:end, language:'en', automationEnabled:true, pennyEnabled:false },
    rollover: 0,
    budgets: {
      income:   [{id:uid(),category:'Paycheck',expected:0}],
      expenses: [{id:uid(),category:'Food',expected:0}],
      bills:    [{id:uid(),category:'Rent',expected:0,dueDate:'',paid:false}],
      savings:  [{id:uid(),category:'Emergency Fund',expected:0}]
    },
    transactions: [],
    debts: [],
    debtSettings: { method:'avalanche', extraPayment:0 },
    sinkingFunds: [],
    subscriptions: [],
    recurringTemplates: [],
    allocation: {
      enabled: true,
      buckets: [
        {id:'need', name:'Need', pct:50, color:'#6366f1'},
        {id:'want', name:'Want', pct:30, color:'#ec4899'},
        {id:'save', name:'Save', pct:20, color:'#10b981'},
      ]
    }
  };
}

let state;
function loadState() {
  try {
    const r = localStorage.getItem(UBP_KEY);
    const s = r ? JSON.parse(r) : null;
    if (!s || !s.settings || !s.budgets) return null;
    // Migration: add allocation if missing (existing users)
    if (!s.allocation) s.allocation = defaultState().allocation;
    if (!s.recurringTemplates) s.recurringTemplates = [];
    if (s.settings.pennyEnabled === undefined) s.settings.pennyEnabled = false;
    return s;
  } catch { return null; }
}
function saveState()  { localStorage.setItem(UBP_KEY, JSON.stringify(state)); SYM=state.settings.symbol; syncPushDebounced('ubp'); }
function syncSymbol() { SYM=state.settings.symbol; }

// ══════════════════════════════════════════════════════════════════════
//  FREE TRIAL GATING (UBP)
//  Entering via "TRY FOR FREE" caps usage; entering via "Open" is full.
// ══════════════════════════════════════════════════════════════════════
const UBP_MODE_KEY = 'evobudget_ubp_mode';                 // 'trial' | 'full'
const TRIAL_LIMITS = { transactions:3, recurring:3, income:3, expenses:3, bills:3, savings:3, subscriptions:1, sinkingFunds:1, debts:1 };

// ▼▼ EDIT THESE: drop in your real checkout links + prices ▼▼
const PURCHASE_URLS = { sbp:'', ubp:'' };  // leave '' to show a placeholder toast
const PRICES        = { sbp:'$9.99', ubp:'$24.99' };
// ▲▲ ─────────────────────────────────────────────────────── ▲▲

function isTrial(){ return localStorage.getItem(UBP_MODE_KEY) === 'trial'; }

// Returns true when the action is blocked (caller should stop and show the upgrade prompt).
function trialBlocks(kind){
  if(!isTrial()) return false;
  switch(kind){
    case 'transaction':   return state.transactions.length >= TRIAL_LIMITS.transactions;
    case 'recurring':     return (state.recurringTemplates||[]).length >= TRIAL_LIMITS.recurring;
    case 'debts':         return (state.debts||[]).length >= TRIAL_LIMITS.debts;
    case 'subscriptions': return (state.subscriptions||[]).length >= TRIAL_LIMITS.subscriptions;
    case 'sinkingFunds':  return (state.sinkingFunds||[]).length >= TRIAL_LIMITS.sinkingFunds;
    default:              return (state.budgets[kind]?.length||0) >= (TRIAL_LIMITS[kind]||Infinity);
  }
}

function goToPurchase(product){
  const url = PURCHASE_URLS[product];
  if(url){ window.open(url,'_blank','noopener'); }
  else { showToast('Add your checkout link in PURCHASE_URLS.'+product); }
}

function upgradeChip(ctx){
  const L = {
    transaction:  `${TRIAL_LIMITS.transactions} / ${TRIAL_LIMITS.transactions} free transactions used`,
    recurring:    `${TRIAL_LIMITS.recurring} / ${TRIAL_LIMITS.recurring} free automatic transactions used`,
    subscriptions:`${TRIAL_LIMITS.subscriptions} / ${TRIAL_LIMITS.subscriptions} free subscription used`,
    sinkingFunds: `${TRIAL_LIMITS.sinkingFunds} / ${TRIAL_LIMITS.sinkingFunds} free sinking fund used`,
    debts:        `${TRIAL_LIMITS.debts} / ${TRIAL_LIMITS.debts} free debt used`,
  };
  if(L[ctx.reason]) return L[ctx.reason];
  const names = { income:'Income', expenses:'Expenses', bills:'Bills', savings:'Savings' };
  if(ctx.reason==='category' && names[ctx.type]) return `${TRIAL_LIMITS[ctx.type]} / ${TRIAL_LIMITS[ctx.type]} free ${names[ctx.type]} categories used`;
  return 'Free trial limit reached';
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
  ov.setAttribute('aria-label','Upgrade to unlock the full planner');
  ov.innerHTML = `
    <div class="fk-up-card" role="document">
      <button class="fk-up-x" id="fkUpClose" type="button" aria-label="Close">&times;</button>
      <div class="fk-up-hero">
        <div class="fk-up-glow" aria-hidden="true"></div>
        <div class="fk-up-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${esc(upgradeChip(ctx))}
        </div>
        <h2 class="fk-up-title">Unlock the full<br>Ultimate Budget Planner</h2>
        <p class="fk-up-sub">You're at the free trial limit. Upgrade once to remove every cap. No subscription, ever.</p>
      </div>
      <div class="fk-up-body">
        <ul class="fk-up-list">
          <li>${check}<span><strong>Unlimited</strong> transactions &amp; automatic transactions</span></li>
          <li>${check}<span><strong>Unlimited</strong> budget categories in every section</span></li>
          <li>${check}<span><strong>Unlimited</strong> debts, subscriptions &amp; sinking funds</span></li>
          <li>${check}<span>One-time payment · free updates for life</span></li>
        </ul>
        <div class="fk-up-price-row">
          <div class="fk-up-price"><span class="fk-up-price-num">${esc(PRICES.ubp)}</span><span class="fk-up-price-tag">one-time</span></div>
          <span class="fk-up-price-note">No subscription</span>
        </div>
        <button class="fk-up-cta" id="fkUpBuyUbp" type="button">Unlock Ultimate for ${esc(PRICES.ubp)}</button>
        <button class="fk-up-upsell" id="fkUpBuySbp" type="button">
          <span class="fk-up-upsell-lead">💰 Just need the basics?</span>
          <span class="fk-up-upsell-cta">Get Simple for ${esc(PRICES.sbp)} →</span>
        </button>
        <div class="fk-up-foot">
          <button class="fk-up-later" id="fkUpLater" type="button">Maybe later</button>
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
function advanceByFreq(dateStr, freq) {
  const d=new Date(dateStr+'T00:00:00');
  switch(freq){case'daily':d.setDate(d.getDate()+1);break;case'weekly':d.setDate(d.getDate()+7);break;case'quarterly':d.setMonth(d.getMonth()+3);break;case'annual':d.setFullYear(d.getFullYear()+1);break;default:d.setMonth(d.getMonth()+1);}
  return toLocalISO(d);
}
function processRecurring() {
  if (state.settings && state.settings.automationEnabled === false) return 0;
  const todayStr=today();
  let generated=0;
  for(const tmpl of state.recurringTemplates||[]){
    if(!tmpl.enabled||!tmpl.nextDue)continue;
    let guard=0;
    while(tmpl.nextDue<=todayStr && guard++<3660){
      let genAmount=tmpl.amount;
      if(tmpl.sourceType==='sinking_fund'){
        const fundRef=(state.sinkingFunds||[]).find(f=>f.id===tmpl.sourceId);
        if(fundRef){genAmount=Math.round((calcFund(fundRef).requiredMonthly||0)*100)/100;tmpl.amount=genAmount;}
      }
      const already=state.transactions.some(tx=>tx.recurringId===tmpl.id&&tx.date===tmpl.nextDue);
      if(!already&&genAmount>0){
        const tx={id:uid(),date:tmpl.nextDue,type:tmpl.type,category:tmpl.category,amount:genAmount,description:tmpl.label,recurringId:tmpl.id,allocation:tmpl.allocation||null};
        if(tmpl.type==='sinking_fund'&&state.allocation?.enabled){const sb=(state.allocation.buckets||[]).find(b=>b.id==='save');if(sb)tx.allocation=sb.id;}
        applySinkingFundDelta(tx,+1);
        state.transactions.push(tx);generated++;
      }
      tmpl.nextDue=advanceByFreq(tmpl.nextDue,tmpl.frequency);
    }
    // keep a linked subscription's own date in sync with its schedule
    if(tmpl.sourceType==='subscription'){const s=(state.subscriptions||[]).find(x=>x.id===tmpl.sourceId);if(s)s.nextBillingDate=tmpl.nextDue;}
  }
  if(generated>0){saveState();return generated;}
  return 0;
}

// ── Automation link helpers (subscriptions / funds / debts ↔ templates) ──
function automationOn(){ return state.settings?.automationEnabled!==false; }
function findLinkedTemplate(sourceType, sourceId){ return (state.recurringTemplates||[]).find(x=>x.sourceType===sourceType&&x.sourceId===sourceId); }
function upsertLinkedTemplate(sourceType, sourceId, data){
  state.recurringTemplates=state.recurringTemplates||[];
  const tmpl=findLinkedTemplate(sourceType,sourceId);
  if(tmpl){ tmpl.type=data.type; tmpl.category=data.category; tmpl.label=data.label; tmpl.amount=data.amount; tmpl.frequency=data.frequency; if(data.nextDue)tmpl.nextDue=data.nextDue; if('allocation' in data)tmpl.allocation=data.allocation; }
  else { state.recurringTemplates.push({id:uid(),sourceType,sourceId,type:data.type,category:data.category,label:data.label,amount:data.amount,frequency:data.frequency,nextDue:data.nextDue||today(),allocation:data.allocation||null,enabled:true}); }
}
function removeLinkedTemplate(sourceType, sourceId){ state.recurringTemplates=(state.recurringTemplates||[]).filter(x=>!(x.sourceType===sourceType&&x.sourceId===sourceId)); }
// Next occurrence (>= today) of a given day-of-month
function nextDueFromDay(day){
  day=Math.min(31,Math.max(1,parseInt(day)||1));
  const now=new Date(); now.setHours(0,0,0,0);
  let y=now.getFullYear(), m=now.getMonth();
  const mk=(yy,mm)=>{const last=new Date(yy,mm+1,0).getDate();return new Date(yy,mm,Math.min(day,last));};
  let d=mk(y,m);
  if(d<now){ m++; if(m>11){m=0;y++;} d=mk(y,m); }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Reusable "Automate this" toggle row for entity modals
function automateRow(checked){
  const on=automationOn();
  return `<div class="field"><label class="automate-row${on?'':' is-off'}">
      <span class="automate-row-text"><span class="automate-row-title">${t('automate_label')}</span><span class="automate-row-hint">${on?t('automate_hint'):t('automate_hint_off')}</span></span>
      <span class="recurring-toggle"><input type="checkbox" id="automateToggle" ${checked?'checked':''} ${on?'':'disabled'}><span class="rec-toggle-track"></span></span>
    </label></div>`;
}

// ── Aggregation ───────────────────────────────────────────────────────
function computeActuals() {
  const a={income:{},expenses:{},bills:{},savings:{},debt:{},subscription:{}};
  const MAP={income:'income',expense:'expenses',bill:'bills',savings:'savings',debt:'debt',subscription:'subscription',sinking_fund:'savings'};
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
        totalBills=sum(act.bills), totalSavings=sum(act.savings),
        totalDebt=sum(act.debt), totalSubscriptions=sum(act.subscription);
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
  const a={income:{},expenses:{},bills:{},savings:{},debt:{},subscription:{}};
  const MAP={income:'income',expense:'expenses',bill:'bills',savings:'savings',debt:'debt',subscription:'subscription',sinking_fund:'savings'};
  for(const tx of state.transactions){
    if(tx.date<ps||tx.date>pe)continue;
    const sec=MAP[tx.type];if(sec)a[sec][tx.category]=(a[sec][tx.category]||0)+tx.amount;
  }
  const hasTx=Object.values(a).some(o=>Object.keys(o).length>0);
  return hasTx?computeSummary(a):null;
}
function monthlySubAmt(s) {
  switch(s.frequency){case'annual':return s.amount/12;case'weekly':return s.amount*52/12;case'quarterly':return s.amount/3;default:return s.amount;}
}
function annualSubAmt(s) {
  switch(s.frequency){case'annual':return s.amount;case'weekly':return s.amount*52;case'quarterly':return s.amount*4;default:return s.amount*12;}
}
function totalSubMonthly() { return state.subscriptions.filter(s=>s.active!==false).reduce((t,s)=>t+monthlySubAmt(s),0); }

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
  let month=0,totalInterest=0;
  const now=new Date();
  while (working.some(d=>d.remaining>0.01)&&month<600) {
    month++; let freed=0;
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
      const pay=Math.min(d.remaining,minPay+targeted);
      d.remaining-=pay;
      d._monthPayment=pay; d._monthInterest=interest; d._monthPrincipal=pay-interest;
      if (d.remaining<0.01){freed+=(minPay+targeted)-Math.max(0,(minPay+targeted)-pay);d.remaining=0;if(!d.paidOffMonth)d.paidOffMonth=month;}
    }
    let avail=extraPayment+freed;
    for (const p of priority) {
      const a=working.find(w=>w.id===p.id); if(!a||a.remaining<=0) continue;
      const pay=Math.min(a.remaining,avail); a.remaining-=pay; avail-=pay;
      a._monthPayment=(a._monthPayment||0)+pay; a._monthPrincipal=(a._monthPrincipal||0)+pay;
      if(a.remaining<0.01){if(!a.paidOffMonth)a.paidOffMonth=month;a.remaining=0;}
      if(avail<=0) break;
    }
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
    payoffOrder:priority.map(p=>{
      const w=working.find(x=>x.id===p.id),mo=w.paidOffMonth;
      const dt=mo?toLocalISO(new Date(now.getFullYear(),now.getMonth()+mo,1)):null;
      return {...p,paidOffMonth:mo,paidOffDate:dt?formatDateDisplay(dt):'-'};
    })
  };
}

// ── Sinking Fund Calculations ─────────────────────────────────────────
function calcFund(f) {
  const now=new Date();
  const td=f.targetDate?new Date(f.targetDate+'T00:00:00'):null;
  const monthsLeft=td?Math.max(1,(td.getFullYear()-now.getFullYear())*12+(td.getMonth()-now.getMonth())):12;
  const remaining=Math.max(0,(f.targetAmount||0)-(f.currentSaved||0));
  return {monthsLeft,remaining,requiredMonthly:remaining/monthsLeft,pctComplete:f.targetAmount>0?Math.min(100,((f.currentSaved||0)/f.targetAmount)*100):0};
}

// ── Upcoming Events ───────────────────────────────────────────────────
function getUpcomingEvents(days, act) {
  const events=[], now=new Date();
  const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+days);
  const debtAct=act?.debt||{}, subAct=act?.subscription||{};
  const push=(day,label,type,amount,color,paid)=>{
    for(let mo=0;mo<=2;mo++){
      const d=new Date(now.getFullYear(),now.getMonth()+mo,day);
      if(d>=now&&d<=end) events.push({date:toLocalISO(d),label,type,amount,color,paid:!!paid});
    }
  };
  for(const b of state.budgets.bills||[])
    if(b.dueDate) push(parseInt(b.dueDate.split('-')[2]),b.category,'bill',b.expected||0,'#fb923c',b.paid);
  for(const d of state.debts)
    if(d.dueDay) push(d.dueDay,d.name,'debt',d.minimumPayment||0,'#a855f7',(debtAct[d.name]||0)>=(d.minimumPayment||0)&&d.minimumPayment>0);
  for(const s of state.subscriptions.filter(s=>s.active!==false))
    if(s.nextBillingDate) push(parseInt(s.nextBillingDate.split('-')[2]),s.name,'subscription',monthlySubAmt(s),'#10b981',(subAct[s.name]||0)>0);
  // Scheduled automatic transactions (manual + sinking-fund contributions)
  if(state.settings?.automationEnabled!==false){
    const startISO=toLocalISO(now), endISO=toLocalISO(end);
    for(const tmpl of state.recurringTemplates||[]){
      if(!tmpl.enabled||tmpl.sourceType==='subscription'||tmpl.sourceType==='debt') continue;
      const isSink=tmpl.sourceType==='sinking_fund';
      templateDatesInRange(tmpl,startISO,endISO).forEach(iso=>events.push({date:iso,label:tmpl.label||tmpl.category,type:isSink?'sinking':'auto',amount:tmpl.amount||0,color:isSink?'#06b6d4':'#8b5cf6',paid:false}));
    }
  }
  events.sort((a,b)=>a.date.localeCompare(b.date));
  return events;
}
// Dates a recurring template fires within [startISO, endISO] (inclusive)
function templateDatesInRange(tmpl, startISO, endISO){
  const out=[]; if(!tmpl.nextDue) return out;
  let cur=tmpl.nextDue, guard=0;
  while(cur<startISO && guard++<800) cur=advanceByFreq(cur,tmpl.frequency);
  guard=0;
  while(cur<=endISO && guard++<400){ out.push(cur); cur=advanceByFreq(cur,tmpl.frequency); }
  return out;
}

// ── SVG Donut ─────────────────────────────────────────────────────────
const COLORS=['#6366f1','#10b981','#fb923c','#a855f7','#ec4899','#06b6d4','#eab308','#8b5cf6','#f43f5e','#3b82f6','#14b8a6','#f97316'];
// ── Internationalisation ─────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    lang_name:'English',
    // Tabs
    tab_dashboard:'Dashboard', tab_budget:'Budget', tab_transactions:'Transactions',
    tab_income:'Income', tab_expenses:'Expenses', tab_bills:'Bills',
    tab_debt:'Debt', tab_savings:'Savings', tab_settings:'Settings',
    tab_debt_payoff:'Debt Payoff', tab_sinking:'Sinking Funds',
    tab_calendar:'Calendar', tab_subscriptions:'Subscriptions',
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
    light:'Light', dark:'Dark',
    changes_autosaved:'✅ Changes are saved automatically.',
    rollover_desc:'Carry unspent money from your previous period into this one.',
    rollover_amount:'Rollover amount',
    reset_desc:'Permanently deletes all your data. This cannot be undone.',
    reset_btn:'Reset everything',
    // Common
    add:'Add', cancel:'Cancel',rename_title_prompt:'Rename your budget planner', save:'Save', delete:'Delete',dp_today:'Today',dp_clear:'Clear', edit:'Edit',
    paid:'Paid', due_date:'Due Date', category:'Category', amount:'Amount',
    description:'Description', date:'Date', type:'Type',
    add_category:'+ Add category', no_transactions:'No transactions yet.',
    // Upgrade
    upgrade_title:'Ready for the pro experience?',
    upgrade_desc:'Unlock Debt Payoff Calculator, Sinking Funds Tracker, Smart Calendar & Subscription Tracker.',
    upgrade_now:'Upgrade Now →',
    // Calendar days
    mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun',
    quick_presets:'Quick presets:',select_currency:'Select your currency',select_language:'Select language',
    appearance_desc:'Switch between light and dark mode.',video_tutorial:'▶ Video Tutorial',
    help_sett_intro:'All your preferences for the Ultimate Budget Planner. Changes are saved automatically as you make them.',
    help_sett_currency_p:'Changes the currency symbol everywhere in the app immediately on selection.',
    help_sett_appearance_p:'Switch between Light and Dark mode. Your preference is remembered across sessions.',
    help_sett_nav_h:'Navigation',
    help_sett_nav_top:'Top Navigation - Classic horizontal tab bar at the top (default).',
    help_sett_nav_side:'Side Navigation - A floating icon rail to the left of your content. Click the arrow to expand and see full labels.',
    help_sett_period_p:'The date range that defines “this budget”. Only transactions within this range count toward actuals. Use the 7 presets (This Month, Last Month, This Week, Last Week, Last 30 Days, This Quarter, This Year) for quick setup.',
    help_sett_rollover_p:"Any unspent money you want to carry forward from your previous period. It's added to your Net Leftover on the dashboard.",
    // Calendar
    cal_title:'Smart Calendar',
    cal_desc:'All your bills, debt payments, subscriptions, and transactions in one live calendar. Click any day to see its events.',
    cal_prev:'\u2190 Prev',cal_next:'Next \u2192',
    cal_all_events:'All events - ',
    cal_no_events_day:'No events on this day.',
    cal_no_events_month:'No events this month.',
    cal_no_events_sub:'Add bills, debts, or subscriptions to see them here.',
    cal_event_one:'event',cal_event_many:'events',cal_clear:'Clear \u00d7',
    cal_leg_bill:'Bill',cal_leg_debt:'Debt',cal_leg_sub:'Subscription',cal_leg_tx:'Transaction',cal_leg_sinking:'Sinking fund',cal_leg_goal:'Goal date',cal_leg_auto:'Automatic',
    cal_paid:'\u2713 Paid',cal_unpaid:'Unpaid',
    help_cal_intro:'The Smart Calendar pulls together all your financial commitments in one monthly view - updated automatically as you add data.',
    help_cal_ev_types_h:'Event types',
    help_cal_bill_li:'Bills - from your Bills budget section (recurring monthly on the due day you set)',
    help_cal_debt_li:'Debt payments - from your Debt Payoff section (recurring on the due day)',
    help_cal_sub_li:'Subscriptions - from your Subscriptions tracker (on the next billing date day)',
    help_cal_tx_li:'Transactions - dates you logged income or spending',
    help_cal_nav_h:'Navigating',
    help_cal_nav_p:'Use \u2190 Prev and Next \u2192 to move between months. Click any day to see its events highlighted in a panel below the calendar. Click the same day again or \u201cClear \u00d7\u201d to deselect.',
    help_cal_tip:'\uD83D\uDCA1 Set due dates on bills and debts to get the most out of the calendar.',
    sf_add_btn:'+ Add fund',
    sf_desc:"A sinking fund lets you save gradually for a big future expense - no nasty surprises. Set a goal amount and date, and we'll tell you exactly how much to save each month.",
    sf_empty_title:'No sinking funds yet.',
    sf_empty_sub:'Great for: holidays, car repairs, weddings, new tech, annual bills.',
    sf_pct_complete:'complete',
    sf_save_prefix:'Save',sf_per_month:'/month',
    sf_month_left_one:'month left',sf_month_left_many:'months left',
    sf_total_contrib:'Total monthly contributions needed:',
    sf_modal_new:'\uD83C\uDFFA New Sinking Fund',sf_modal_edit:'\u270F\uFE0F Edit Fund',
    sf_fund_name_label:'Fund name',sf_fund_name_ph:'e.g. Holiday Fund',
    sf_icon_label:'Icon',sf_target_amount_label:'Target amount',
    sf_currently_saved_label:'Currently saved',sf_target_date_label:'Target date',
    sf_create_btn:'Create fund',
    help_sf_intro:'A sinking fund is money you set aside in advance for a big planned expense - no nasty surprises when the bill arrives.',
    help_sf_how_to_h:'How to use it',
    help_sf_step1:'Click + Add fund',
    help_sf_step2:'Name your fund (e.g. "Summer Holiday"), pick an icon',
    help_sf_step3:'Set a target amount (how much you need total)',
    help_sf_step4:'Set a target date (when you need the money)',
    help_sf_step5:"Enter how much you've already saved toward it",
    help_sf_reading_h:'Reading the card',
    help_sf_reading_p:'Each card shows your saved vs target, a progress bar, and exactly how much to save per month to hit your goal on time.',
    help_sf_contrib_h:'Adding contributions',
    help_sf_contrib_p:"Click the + icon on a card to log a contribution - enter the amount you're adding this month.",
    help_sf_tip:'\uD83D\uDCA1 Great for: holidays, car repairs, annual insurance, weddings, electronics, home improvements.',
    dpc_title:'Debt Payoff Calculator',dpc_add_btn:'+ Add debt',
    dpc_desc:"Enter every debt, pick a payoff strategy, and see exactly when you'll be debt-free and how much interest you'll pay in total.",
    dpc_method_label:'Payoff method',
    dpc_snowball_desc:'Lowest balance first - quick wins keep you motivated',
    dpc_avalanche_desc:'Highest rate first - saves the most money overall',
    dpc_extra_label:'Extra monthly payment',
    dpc_extra_hint:'Amount above your minimum payments to throw at debt each month.',
    dpc_empty_title:'No debts added yet.',
    dpc_empty_sub:'Click \u201c+ Add debt\u201d to build your payoff plan.',
    dpc_th_name:'Debt',dpc_th_type:'Type',dpc_th_balance:'Balance',
    dpc_th_apr:'APR %',dpc_th_min:'Min. payment',dpc_th_due:'Due day',
    dpc_totals:'Totals',dpc_name_ph:'e.g. Visa Card',
    dpc_term_label:'Loan term (years)',dpc_term_hint:'Sets how long this loan runs, so Auto-calculate can work out an accurate minimum payment.',
    dpc_autocalc_btn:'Auto-calculate',dpc_autocalc_done:'Calculated: {0}/mo',
    dpc_min_mode_label:'Minimum payment type',dpc_min_mode_fixed:'Fixed amount',dpc_min_mode_percent:'% of balance',
    dpc_min_percent_label:'Percent of balance (%)',dpc_min_floor_label:'Minimum floor amount',
    dpc_min_calculated_hint:'Calculated automatically - whichever is higher of the percentage or the floor amount.',
    dpc_escrow_label:'Escrow (taxes & insurance)',
    dpc_escrow_hint:"Adds to your real monthly cost, but is excluded from the payoff simulation since it doesn't reduce your balance.",
    dpc_min_pct_caption:'{0}% of balance',dpc_escrow_note:'{0} escrow',
    dpc_term_note_faster:'{0} mo faster than your {1}-yr term',dpc_term_note_slower:'{0} mo slower than your {1}-yr term',
    dpc_term_note_onschedule:'right on schedule for your {0}-yr term',
    dpc_escrow_mode_label:'Escrow type',dpc_escrow_mode_fixed:'Fixed amount',dpc_escrow_mode_declining:'Declining with balance',
    dpc_escrow_mode_hint:"This only affects the payment schedule below. Today's automated amount and dashboard total always use the current flat escrow amount.",
    dpc_rate_type_label:'Rate type',dpc_rate_type_fixed:'Fixed for the whole term',dpc_rate_type_arm:'Adjusts after a fixed period (ARM)',
    dpc_rate_type_hint:'A simplified model: one rate for the fixed period, then a single new rate for the rest of the loan - not a full index/cap simulation.',
    dpc_arm_fixed_years_label:'Fixed-rate period (years)',dpc_arm_rate_label:'Rate after adjustment',
    dpc_arm_caption:'adjusts after {0}-yr fixed period',
    dpc_recalc_link:'↺ Recalculate',
    dpc_th_extra:'Extra/mo',
    dpc_extra_col_hint:"Paid on top of this debt's minimum every month, before the shared Extra Monthly Payment above is distributed. Stops once this debt is paid off - it isn't redirected elsewhere.",
    dpc_targeted_extra_note:'{0} targeted extra',
    dpc_schedule_btn_title:'View payment schedule',
    dpc_amort_type_label:'Repayment style',dpc_amort_equal_payment:'Equal payments',dpc_amort_equal_principal:'Declining payments (equal principal)',
    dpc_amort_type_hint:'Equal payments stay the same every month. Declining payments keep the amount going to principal fixed, so the total payment shrinks over time as interest reduces - common for some mortgages.',
    dpc_autocalc_done_declining:'First payment: {0}/mo (decreases monthly)',dpc_declining_caption:'declining payment',
    dtype_credit_card:'Credit Card',dtype_student_loan:'Student Loan',
    dtype_mortgage:'Mortgage',dtype_car_loan:'Car Loan',
    dtype_personal_loan:'Personal Loan',dtype_other:'Other',
    dpc_debt_free_label:'\uD83C\uDFAF Debt-free date',dpc_months_from_now:'months from now',
    dpc_interest_label:'\uD83D\uDCB8 Total interest',dpc_on_top:'on top of',dpc_principal:'principal',
    dpc_monthly_label:'\uD83D\uDCC5 Monthly total',dpc_min_abbr:'min',dpc_extra_abbr:'extra',
    dpc_payoff_order_sf:'Payoff order - \u26c4 Snowball (lowest balance first)',
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
    tx_import_csv:'\uD83D\uDCE5 Import CSV',
    tx_add_title:'Add a transaction',
    tx_date:'Date',tx_type:'Type',tx_category:'Category',tx_amount:'Amount',
    tx_desc_label:'Description',tx_desc_ph:'e.g. Grocery run\u2026',
    tx_add_btn:'Add',tx_error_required:'Please fill all required fields.',
    tx_transaction_one:'transaction',tx_transaction_many:'transactions',
    tx_clear_all:'Clear all',tx_empty:'No transactions yet.',
    tx_type_income:'Income',tx_type_expense:'Expense',tx_type_bill:'Bill',tx_type_savings:'Savings',
    tx_th_amount:'Amount',tx_th_desc:'Description',
    tx_edit_title:'\u270F\uFE0F Edit Transaction',tx_save_changes:'Save changes',
    help_tx_intro:'Every money movement goes here. Your Budget actuals and Dashboard update automatically each time you add one.',
    help_tx_adding_h:'Adding a transaction',
    help_tx_step1:'Pick a Date - click the date field to open the calendar picker',
    help_tx_step2:'Choose a Type: Income, Expense, Bill, Savings, Debt, Subscription, or Sinking Fund',
    help_tx_step3:'Select the matching Category (set up in the Budget tab)',
    help_tx_step4:'Enter the Amount and an optional description',
    help_tx_step5:'Hit Add',
    help_tx_edit_h:'Editing & deleting',
    help_tx_edit_p:'Click \u270F\uFE0F on any transaction to edit it, or \u00d7 to delete it. To wipe everything, use \u201cClear all\u201d.',help_tx_auto_h:'Automatic transactions',help_tx_auto_p:'Create a rule for anything that repeats (like rent or salary) and pick how often. The app adds it to your list automatically on each due date. Use the toggle to pause a rule, or the pencil to edit it.',
    help_tx_csv_h:'CSV import',
    help_tx_csv_p1:'Import a spreadsheet export using the format: Date,Type,Category,Amount,Description (header row required).',
    help_tx_csv_p2:'Dates should be in YYYY-MM-DD format. Type must be one of: income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_section_income:'Income',bud_section_expenses:'Expenses',
    bud_section_bills:'Bills',bud_section_savings:'Savings',
    bud_th_category:'Category',bud_th_expected:'Expected',
    bud_th_actual:'Actual',bud_th_progress:'Progress',
    bud_th_due_date:'Due Date',bud_th_paid:'Paid',
    bud_total:'Total',bud_set_date:'Set date',
    bud_add_btn:'+ Add',bud_add_cat_title:'Add new category',
    bud_cat_name_label:'Category name',bud_cat_name_ph:'e.g. Freelance',
    bud_add_cat_btn:'Add',bud_due_date_label:'Due date',
    help_bud_intro:'The Budget tab is where you plan your money. Set expected amounts for every category - actuals fill in automatically from your Transactions.',
    help_bud_how_h:'How it works',
    help_bud_step1:'Click an Expected field and type your budget amount',
    help_bud_step2:'Log transactions in the Transactions tab',
    help_bud_step3:'The Actual column and progress bars update automatically',
    help_bud_colours_h:'Progress bar colours',
    help_bud_col_green:'Green - income at or above target',
    help_bud_col_indigo:'Indigo - expense within budget',
    help_bud_col_red:'Red - expense over budget',
    help_bud_bills_h:'Bills section',
    help_bud_bills_p:'Bills have a Due Date (click to open the date picker) and a Paid checkbox. These dates also appear on the Smart Calendar.',
    help_bud_tip:'\uD83D\uDCA1 Use "+ Add category" to create custom categories for any section.',
    dash_total_income:'Total Income',dash_of:'of',dash_expected_sfx:'expected',
    dash_total_outgoing:'Total Outgoing',dash_budgeted_sfx:'budgeted',
    dash_savings_rate:'Savings Rate',dash_saved_sfx:'saved',
    dash_subscriptions:'Subscriptions',dash_per_year:'/year',
    dash_net_leftover:'Net Leftover this period',
    dash_in_sfx:'in',dash_out_sfx:'out',
    dash_includes:'Includes',dash_rollover_sfx:'rollover',
    dash_cash_flow:'Cash Flow',
    dash_expected_legend:'Expected',dash_actual_legend:'Actual',
    dash_income_sources:'Income Sources',dash_no_income:'No income logged yet.',
    dash_spending_breakdown:'Spending Breakdown',dash_no_spending:'No spending logged yet.',
    dash_no_debts:'No debts added.',dash_set_up:'Set up \u2192',
    dash_debt_free_label:'Debt-free',dash_interest_label:'Interest',
    dash_months_label:'Months',dash_method_label:'Method',
    dash_set_balances:'Set balances to see results.',
    dash_upcoming_7:'\uD83D\uDCC5 Upcoming (7 days)',dash_nothing_scheduled:'Nothing scheduled.',
    dash_no_sinking:'No sinking funds.',dash_create_one:'Create one \u2192',
    help_dash_intro:'The Dashboard gives you a real-time financial overview. All numbers update automatically as you log transactions.',
    help_dash_hero_h:'Hero stats row',
    help_dash_hero_p:'The four cards at the top show your period totals: Total Income received, Total Outgoing (expenses, bills, debt & subscriptions), Savings Rate (% of income saved), and your Subscription monthly cost.',
    help_dash_leftover_h:'Net Leftover',
    help_dash_leftover_p:"Money remaining after all spending and savings. Green = you're ahead. Red = you've overspent your budget.",
    help_dash_cashflow_h:'Cash Flow chart',
    help_dash_cashflow_p:'Each row shows Expected (grey bar) vs Actual (coloured bar) for Income, Expenses, Bills and Savings. A red Expenses bar means you went over budget.',
    help_dash_donut_h:'Donut charts',
    help_dash_donut_p:'Hover or tap a segment to see the label and percentage. These show where your money comes from and where it goes.',
    help_dash_bottom_h:'Bottom panels',
    help_dash_bottom_p:'Quick snapshots of your Debt Payoff progress, upcoming bills/subscriptions in the next 30 days, and Sinking Fund goals.',
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
    alloc_sett_title:'\uD83C\uDFAF Spending Allocation',
    alloc_nearing:'Nearing',
    alloc_required:'Allocation is required for spending transactions.',
    toast_tx_added:'Transaction added \u2713',toast_tx_updated:'Updated \u2713',toast_tx_deleted:'Deleted',
    toast_period_updated:'Period updated \u2713',toast_period_error:'End date must be after start date',
    toast_currency_updated:'Currency updated \u2713',toast_imported:'Imported {0} \u2713',
    toast_fund_created:'Fund created \u2713',toast_fund_updated:'Fund updated \u2713',
    toast_fund_contrib:'Added {amt} to {name} \u2713',
    toast_sub_added:'Subscription added \u2713',toast_sub_updated:'Subscription updated \u2713',
    toast_alloc_enabled:'Allocation enabled \u2713',toast_alloc_disabled:'Allocation disabled',
    toast_lang_updated:'Language updated \u2713',toast_export:'Exported \u2713',
    toast_saved:'Saved \u2713',toast_reset:'All data cleared',toast_alloc_bucket_added:'Bucket added \u2713',
    confirm_remove_cat:'Remove this category?',confirm_delete_all_tx:'Delete ALL transactions? This cannot be undone.',
    confirm_delete_tx:'Delete this transaction?',confirm_remove_debt:'Remove this debt?',
    confirm_delete_fund:'Delete this fund?',confirm_remove_sub:'Remove this subscription?',
    confirm_reset_1:'Are you sure? All data will be permanently deleted.',
    confirm_reset_2:'Last chance - this cannot be undone. Continue?',
    export_csv_btn:'\uD83D\uDCE5 Export CSV',sett_export_title:'\uD83D\uDCE4 Export Data',
    sett_export_desc:'Download all transactions as a CSV file for backup or use in another app.',
    sf_add_contribution:'Add Contribution',sf_contribution_label:'Amount to add',sf_currently_saved:'Currently saved',
    tx_search_ph:'Search by description or category\u2026',tx_filter_all_types:'All types',tx_filter_all_alloc:'All allocations',
    tx_sort_date_new:'Newest first',tx_sort_date_old:'Oldest first',tx_sort_amt_high:'Highest amount',tx_sort_amt_low:'Lowest amount',
    tx_showing:'Showing {n} of {total}',tx_no_results:'No transactions match your filter.',
    alloc_add_bucket:'+ Add bucket',alloc_remove_btn:'Remove',alloc_total_label:'Total',alloc_new_bucket:'New bucket',alloc_color_title:'Pick a color',alloc_custom_color:'Custom',alloc_min_buckets:'Minimum 2 buckets required',
    alloc_auto_tag:'Auto-tagged \u2192 {name}',
    tx_prev:'\u2190 Prev',tx_next:'Next \u2192',tx_page_of:'Page {n} of {total}',
    debt_due_day_note:'Days 29-31 won\u2019t show in shorter months',
    sub_advanced:'Billing date advanced to {date}',
    sf_days_left:'{n} days left',sf_days_overdue:'{n} days overdue',
    sf_due_today:'Due today!',sf_target_complete:'Target reached! \u2713',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs Previous Period',dash_compare_no_data:'No previous period data',
    recurring_title:'Automatic Transactions',recurring_desc:"Set up transactions that repeat on a schedule (example: rent, salary or subscriptions). They're added to your list automatically on each due date.",recurring_add_rule:'+ Add Automatic Transaction',
    recurring_empty:'No automatic transactions added yet.',recurring_label_ph:'Transaction name (e.g. Netflix)',
    recurring_freq:'Frequency',freq_daily:'Daily',freq_weekly:'Weekly',
    freq_monthly:'Monthly',freq_quarterly:'Quarterly',freq_annual:'Annual',
    recurring_next_due:'Next Due',recurring_generated:'Automated {0} new transactions',
    recurring_remove:'Remove rule',recurring_paused:'Paused',recurring_active:'Active',recurring_saved:'Automatic transaction saved ✓',dpc_add_debt_title:'Add debt',dpc_edit_debt_title:'Edit debt',debt_due_day_modal_hint:'The day of the month this payment is due',toast_debt_added:'Debt added',toast_debt_updated:'Debt updated',sf_billing_day_label:'Billing day of month',sf_billing_day_hint:'The day each month the contribution is logged automatically',sf_error_required:'Please fill in all required fields',sub_active:'Active',sub_paused:'Paused',sub_desc:"Track every recurring payment and understand your true annual cost. Pause subscriptions you're not using to keep costs in check.",sub_add_btn:'+ Add subscription',sub_add_title:'Add subscription',sub_edit_title:'Edit subscription',sub_empty_title:'No subscriptions yet.',sub_empty_sub:'Add your recurring payments - Netflix, Spotify, gym memberships, etc.',sub_sum_monthly:'Monthly total',sub_sum_annual:'Annual total',sub_by_category:'By category',sub_per_month:'/month',sub_next_label:'Next',sub_name_label:'Subscription name',sub_name_ph:'e.g. Netflix',sub_amount_label:'Amount',sub_freq_label:'Billing frequency',sub_freq_monthly:'Monthly',sub_freq_annual:'Annual',sub_freq_quarterly:'Quarterly',sub_freq_weekly:'Weekly',sub_unit_month:'month',sub_unit_year:'year',sub_unit_quarter:'quarter',sub_cat_label:'Category',sub_date_label:'Next billing date',sub_cat_entertainment:'Entertainment',sub_cat_productivity:'Productivity',sub_cat_health:'Health & Fitness',sub_cat_food:'Food & Drink',sub_cat_cloud:'Cloud Storage',sub_cat_finance:'Finance',sub_cat_education:'Education',sub_cat_gaming:'Gaming',sub_cat_news:'News & Media',sub_cat_other:'Other',help_sub_intro:"Track every recurring payment and understand your true monthly and annual cost. Subscriptions that quietly drain your account are easy to miss - this keeps them visible.",help_sub_how_h:'Adding a subscription',help_sub_step1:'Click + Add subscription',help_sub_step2:'Enter the name, amount, and billing frequency (monthly, annual, quarterly, weekly)',help_sub_step3:'Pick a category to group similar subscriptions',help_sub_step4:'Set the next billing date - it will appear on the Smart Calendar',help_sub_monthly_h:'Monthly equivalent',help_sub_monthly_p:'Annual and quarterly subscriptions are converted to a monthly cost so you can see your true monthly spend at a glance.',help_sub_pause_h:'Pausing subscriptions',help_sub_pause_p:"Switch the Active toggle off on any subscription you're not currently using. It won't count toward your totals until you switch it back on.",help_sub_chart_h:'Category chart',help_sub_chart_p:'The donut chart shows how your subscription spending breaks down by category - hover a segment to see the details.',help_sub_tip:"💡 Turn on Automate for a subscription so it's added to your transactions automatically each billing cycle.",automate_auto_pay:'Auto-pay',sf_auto_contribute:'Auto-contribute',sf_auto_need_amount:'Add a target amount and date first',sf_auto_set:'Monthly contribution set to {0}',automate_label:'Automate',automate_hint:'Adds it to your transactions automatically on schedule',automate_hint_off:'Turn on Automation in Settings to use this',automate_th:'Autopay',automate_need_amount:'Set a minimum payment first',automate_payment_word:'payment',automate_linked:'Linked automatic transaction',sf_contribution_label:'Monthly contribution',sf_contribution_hint:'Logged automatically each month to grow this fund',sett_automation_h:'Automation',sett_automation_desc:'Master switch for automatic transactions. When off, no scheduled transactions are generated and the Automate options are disabled.',sett_automation_toggle:'Automatic transactions',sett_automation_hint:'Applies to the Transactions tab, subscriptions, funds and debts',
    tx_type_sinking_fund:'Sinking Fund',
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
    help_dash_alloc_setup_p:'Open Settings \u2192 Spending Allocation. Edit the bucket names, adjust the percentages, and toggle the panel on or off. Percentages must total 100% before changes take effect.',
    // Penny (AI assistant)
    sett_penny_h:'Penny (AI Budget Assistant)',
    sett_penny_desc:'Ask Penny questions about your budget & spending habits',
    sett_penny_toggle:'Enable Penny',
    sett_penny_hint:'Turns on the Penny assistant and its icon in the navigation bar.',
    sett_penny_key_label:'Gemini API Key',
    sett_penny_key_placeholder:'Paste your Gemini API key',
    sett_penny_howto:'How to create my key',
    sett_penny_save_btn:'Save key',
    sett_penny_key_saved:'Gemini API key saved and encrypted',
    sett_penny_remove:'Remove key',
    sett_penny_available:'Penny is now available in the navigation menu.',
    sett_penny_usage_count:'Penny has answered {0} questions this month',
    sett_penny_key_error_short:"That doesn't look like a valid key. Please check and try again.",
    confirm_penny_remove_key:'Remove your saved Gemini API key? Penny will be turned off until you add a new one.',
    toast_penny_key_saved:'Gemini key saved securely.',
    penny_nav_pill_off:'Enable Penny',
    penny_nav_pill_on:'Ask Penny',
    penny_nav_aria_off:'Enable Penny',
    penny_nav_aria_on:'Ask Penny',
    penny_chat_title:'Ask Penny',
    penny_input_placeholder:'Ask about your budget\u2026',
    penny_send:'Ask',
    penny_thinking:'Penny is thinking\u2026',
    penny_voice_on:'Voice replies on',
    penny_voice_off:'Voice replies off',
    penny_disclaimer:'Your very own AI Budget Assistant',
    penny_no_key_notice:'Add your Gemini API key in Settings to start chatting with Penny.',
    penny_open_settings:'Open Settings',
    penny_close:'Close Penny',
    penny_qp_leftover:'How much do I have left this period?',
    penny_qp_top_category:"What's my biggest spending category?",
    penny_qp_on_track:'Am I on track with my budget?',
    penny_qp_subscriptions:'What am I paying in subscriptions?',
    penny_qp_debt:"How's my debt payoff going?",
    penny_qp_chart:'Show me a chart of my spending',
    penny_err_invalid_key:'Your Gemini API key looks invalid or has been revoked. Update it in Settings.',
    penny_err_rate_limited:"You've hit Gemini's rate limit for now. This is a limit from Google on your key, not the counter above. Wait a bit and try again.",
    penny_err_network:"Penny couldn't reach Google's servers. Check your connection and try again.",
    penny_err_blocked:"Penny couldn't come up with a safe answer to that. Try rephrasing your question about your budget.",
    penny_err_unknown:"Something went wrong on Penny's end. Please try again in a moment.",
    penny_err_key_unreadable:"Your saved key couldn't be read. Please re-enter it in Settings.",
    penny_err_retry:'Retry',
    help_sett_penny_p:'Turn on Penny below to ask questions about your budget in plain English. Tap "How to create my key" for setup steps.',
    help_penny_title:'Setting up Penny',
    help_penny_intro:"Penny is Evo Budget's AI assistant. Since this app has no server of its own, Penny talks directly from your browser to Google using your own free Gemini API key. Nothing ever passes through an Evo Budget server, because there isn't one.",
    help_penny_steps_h:'How to create your key',
    help_penny_step1:'Go to Google AI Studio (aistudio.google.com/apikey) and sign in with a Google account.',
    help_penny_step2:'Click "Create API key" (choose "Create key in new project" if you don\u2019t have one yet).',
    help_penny_step3:'Copy the generated key (it starts with AIza\u2026).',
    help_penny_step4:'Paste it into the "Gemini API Key" field in Evo Budget\u2019s Settings and click "Save key".',
    help_penny_cost_h:'Is this free?',
    help_penny_cost_p:'Gemini\u2019s API has a free tier with limits set by Google, which can change. Check your current limits any time at aistudio.google.com. The "questions asked" counter you see in Settings is a personal counter kept on your own device for your own awareness. It isn\u2019t a live reading of your Google quota.',
    help_penny_safety_h:'Is my key safe?',
    help_penny_safety_p:"Your key is encrypted before it's saved in your browser's own storage, and it's only ever sent directly to Google's API when you ask Penny a question. It never goes to any Evo Budget server.",
    help_penny_cta:'Open Google AI Studio \u2192',
    // Guide
    guide_group_start:'Getting Started', guide_group_track:'Tracking Your Money', guide_group_plan:'Planning Ahead',
    guide_group_smart:'Working Smarter', guide_group_settings:'Making It Yours',
    guide_section_big:'The Big Picture', guide_section_how:'How to Use It', guide_section_connects:'How It Connects', guide_back:'Back to topics',
    guide_welcome_title:'Welcome to Ultimate Budget Planner',
    guide_welcome_big:"Ultimate Budget Planner takes the simple idea of tracking income and spending and gives it superpowers - a real debt payoff plan, savings goals with progress bars, a bird's-eye calendar, subscription tracking, and Penny, an AI assistant who already knows your numbers. Start with the Dashboard, and explore the rest whenever you're ready.",
    guide_dashboard_title:'Dashboard',
    guide_dashboard_big:"The Dashboard is your command center - everything important about your money lives on this one screen, from your bottom line to what's coming up this week.",
    guide_dashboard_step1:'Check the summary cards at the top for your <strong>Total Income</strong>, <strong>Total Outgoing</strong>, <strong>Savings Rate</strong>, and <strong>Net Leftover</strong>.',
    guide_dashboard_step2:'Scroll to the <strong>Upcoming</strong> list to see everything due in the next 7 days - bills, debt payments, and subscriptions all in one place.',
    guide_dashboard_step3:'Check your <strong>Debt Payoff</strong> and <strong>Sinking Funds</strong> snapshots to see progress toward your bigger goals at a glance.',
    guide_dashboard_connect1:"Every number here is pulled live from Transactions, Budget, Debt Payoff, Sinking Funds, and Subscriptions - there's nothing to calculate by hand.",
    guide_dashboard_connect2:'The Net Leftover figure includes your <strong>Rollover</strong> setting, so unspent money from last period can carry forward automatically.',
    guide_dashboard_connect3:"If something looks off, it's almost always worth checking the page it came from - the Dashboard is a mirror, not a source.",
    guide_dashboard_tip:"Set aside 30 seconds each morning to scan the Dashboard - it's the fastest way to catch a bill or debt payment before it's overdue.",
    guide_transactions_title:'Transactions',
    guide_transactions_big:"Transactions are the foundation of everything in this app - every dollar you log here powers your Dashboard, your budget, and every chart you see. Ultimate Budget Planner also lets you automate the repetitive parts so you don't have to log the same thing every single period.",
    guide_transactions_step1:'Tap <strong>Add Transaction</strong>, pick a type and category, and fill in the amount.',
    guide_transactions_step2:'Set up a <strong>Recurring Rule</strong> for anything that repeats, like rent or a paycheck, so it posts automatically instead of you typing it every time.',
    guide_transactions_step3:'Use <strong>Import CSV</strong> to bring in existing spending data all at once instead of entering it by hand.',
    guide_transactions_step4:'Tap any transaction to edit it, or use the filters above the list to find one quickly.',
    guide_transactions_connect1:"Recurring rules set up here are what powers the <strong>Automation</strong> feature - once a rule exists, it keeps posting on schedule without you lifting a finger.",
    guide_transactions_connect2:'Every transaction counts toward its matching category in Budget, Debt Payoff, or Subscriptions automatically.',
    guide_transactions_connect3:"Your Dashboard totals and charts are built entirely from what's logged here.",
    guide_transactions_tip:"Set up recurring rules for your regular bills and paycheck first - it's the single biggest time-saver in the whole app.",
    guide_budget_title:'Budget',
    guide_budget_big:'Budget is where you set your targets - how much you expect to earn and spend across Income, Expenses, Bills, and Savings - all from one screen instead of jumping between separate tabs.',
    guide_budget_step1:'Add a category under <strong>Income</strong>, <strong>Expenses</strong>, <strong>Bills</strong>, or <strong>Savings</strong> and set its <strong>Expected</strong> amount.',
    guide_budget_step2:'As you log transactions, watch the <strong>Actual</strong> column fill in automatically for each category.',
    guide_budget_step3:'Compare Expected to Actual to see which categories are on track and which need attention.',
    guide_budget_step4:"Adjust any Expected amount as your life changes - your budget should flex with you, not the other way around.",
    guide_budget_connect1:'Every transaction you log in Transactions flows straight into the matching category here.',
    guide_budget_connect2:'Your Spending Breakdown chart and Net Leftover on the Dashboard are both built from these categories.',
    guide_budget_connect3:"If you've turned on <strong>Allocation Buckets</strong> in Settings, this page is also where you'll see how your spending lines up against those percentage targets.",
    guide_budget_tip:"Review your Expected amounts once a month - budgets that never change stop reflecting reality pretty quickly.",
    guide_debt_title:'Debt Payoff Calculator',
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
    guide_debt_tip:'Try switching between Snowball and Avalanche to compare - Snowball feels more motivating early on, but Avalanche usually saves more money overall.',
    guide_sinking_title:'Sinking Funds',
    guide_sinking_big:"A sinking fund is money you set aside a little at a time for something specific you know is coming - a vacation, a new laptop, holiday gifts - so it never has to be an emergency when the bill actually arrives.",
    guide_sinking_step1:'Create a fund and give it a <strong>Target Amount</strong> and, if you like, a target date.',
    guide_sinking_step2:'Add contributions whenever you set money aside for it, and watch the <strong>progress bar</strong> fill in.',
    guide_sinking_step3:"Once a fund reaches its target, you're ready for that expense without touching your regular budget.",
    guide_sinking_connect1:"Sinking funds are separate from your regular Savings category - they're for specific, planned goals rather than general saving.",
    guide_sinking_connect2:"Your Dashboard shows a snapshot of all your funds' progress in one place.",
    guide_sinking_connect3:'Contributing to a fund regularly, even a small amount, is what turns a big expense into something that never derails your budget.',
    guide_sinking_tip:"Break big goals into round monthly numbers - it's much easier to commit to $50 a month than to 'save up for a vacation eventually.'",
    guide_subscriptions_title:'Subscriptions',
    guide_subscriptions_big:'Subscriptions have a way of quietly piling up - this page lists every recurring service you pay for in one place, so nothing keeps charging you without your knowledge.',
    guide_subscriptions_step1:'Add each subscription along with its cost and how often it bills (monthly, yearly, etc.).',
    guide_subscriptions_step2:'Check the <strong>Monthly Cost</strong> total to see what all your subscriptions add up to.',
    guide_subscriptions_step3:"Pause or cancel anything you're not using, right from this page.",
    guide_subscriptions_connect1:'Your total subscription cost feeds directly into your Dashboard summary and your Total Outgoing.',
    guide_subscriptions_connect2:'Subscription due dates also show up on your Calendar, so you can see them alongside bills and debt payments.',
    guide_subscriptions_connect3:"Reviewing this list every few months is one of the easiest ways to find money you didn't know you were losing.",
    guide_subscriptions_tip:"Do a subscription review right after your bank statement comes in each month - it's the easiest time to spot something you forgot you were paying for.",
    guide_calendar_title:'Calendar',
    guide_calendar_big:'The Calendar pulls every bill, debt payment, subscription charge, and transaction into one month view, so you can see everything happening with your money at a glance instead of checking five different pages.',
    guide_calendar_step1:'Browse to any month to see color-coded dots marking bills, debt payments, and subscriptions due that day.',
    guide_calendar_step2:'Tap a day to see the full list of everything happening on it.',
    guide_calendar_step3:'Use this view before you make a big purchase to see what else is due around the same time.',
    guide_calendar_connect1:"Everything shown here comes from Bills, Debt Payoff, Subscriptions, and Transactions - the Calendar doesn't hold any of its own data.",
    guide_calendar_connect2:"It's the fastest way to spot a week where several due dates land close together, before it catches you off guard.",
    guide_calendar_connect3:"Nothing you do on the Calendar changes your budget - it's purely a view, so it's completely safe to browse.",
    guide_calendar_tip:'Check the Calendar at the start of each week - it takes seconds and means due dates are never a surprise.',
    guide_rollover_title:'Rollover',
    guide_rollover_big:"Rollover means unspent money from last period doesn't just disappear - it automatically carries forward and adds to what you have available this period.",
    guide_rollover_step1:'Open <strong>Settings</strong> and find the <strong>Rollover</strong> card.',
    guide_rollover_step2:'Turn it on so any leftover amount from the previous period carries into the new one automatically.',
    guide_rollover_step3:"Check your Dashboard's Net Leftover - it will now include that carried-forward amount.",
    guide_rollover_connect1:"Rollover works directly off your Net Leftover from the previous period - the better you stick to your budget, the more it has to carry forward.",
    guide_rollover_connect2:'This is different from Sinking Funds, which are for planned future goals - Rollover is just about not losing track of money you already have.',
    guide_rollover_connect3:"A string of good months compounds nicely here, since each period's leftover adds to the next.",
    guide_rollover_tip:"If a big rollover amount is burning a hole in your pocket, consider moving some of it into a Sinking Fund so it's earmarked for something specific.",
    guide_automation_title:'Automation',
    guide_automation_big:'Automation takes the recurring rules you set up in Transactions and posts them for you automatically, so your regular bills, paychecks, and subscriptions show up right on schedule without you lifting a finger.',
    guide_automation_step1:'Open <strong>Settings</strong> and find the <strong>Automation</strong> card.',
    guide_automation_step2:"Turn it on so recurring transaction rules post automatically when they're due.",
    guide_automation_step3:'Check Transactions afterward to confirm everything posted the way you expected.',
    guide_automation_connect1:"This feature only works with recurring rules you've already created in Transactions - set those up first.",
    guide_automation_connect2:'Every transaction it posts flows into Budget, Debt Payoff, and Subscriptions exactly like one you entered by hand.',
    guide_automation_connect3:"It's the difference between a budgeting app you have to remember to update, and one that keeps itself current.",
    guide_automation_tip:'Turn on Automation once your recurring rules feel accurate - it is most useful once you trust the numbers it will post.',
    guide_penny_title:'Penny',
    guide_penny_big:'Penny is your own AI budget assistant, built right into the app - ask her a question about your money in plain English, and she reads your real budget data to give you a real answer, complete with charts when it helps.',
    guide_penny_step1:"Open <strong>Settings</strong>, turn on Penny, and paste in your own Gemini API key (there's a link right there showing exactly how to get one for free).",
    guide_penny_step2:'Tap the sparkle icon in the top navigation to open the chat.',
    guide_penny_step3:"Ask a question in your own words, like 'what's my biggest spending category this month?', or tap one of the quick-question buttons to get started.",
    guide_penny_step4:"Toggle her voice reply on or off with the speaker icon if you'd rather listen than read.",
    guide_penny_connect1:'Penny can only see your budget data to answer questions - she can never add, edit, or delete anything for you.',
    guide_penny_connect2:"She pulls straight from Dashboard, Transactions, Debt Payoff, Subscriptions, and Sinking Funds, so her answers always match what you'd see on those pages yourself.",
    guide_penny_connect3:"Your API key is encrypted and stored only on your own device - it's never sent anywhere except directly to Google when you ask Penny a question.",
    guide_penny_tip:"Start with one of the quick-question buttons the first time - it's the fastest way to see what she can do before asking your own questions.",
    guide_settings_title:'Settings',
    guide_settings_big:'Settings is where the app adapts to you - currency, budgeting period, rollover, automation, appearance, language, and how your data is stored and backed up.',
    guide_settings_step1:'Pick your <strong>Currency</strong> and <strong>Budget Period</strong> so the app matches how you actually get paid and spend.',
    guide_settings_step2:'Turn on <strong>Rollover</strong> and <strong>Automation</strong> if you want unspent money and recurring transactions to be handled for you automatically.',
    guide_settings_step3:'Switch <strong>Appearance</strong> between light and dark, and choose your <strong>Language</strong> from the list.',
    guide_settings_step4:'Set up <strong>Allocation Buckets</strong> if you want to budget by percentage (like 50% needs, 30% wants, 20% savings) instead of fixed category amounts.',
    guide_settings_step5:'Choose how your data is stored under <strong>Data & Sync</strong> - locally on this device, or synced with Google Drive so it follows you across devices.',
    guide_settings_step6:'Use <strong>Export Data</strong> to back up everything, or <strong>Reset Data</strong> if you ever want to start completely fresh.',
    guide_settings_connect1:'Your Currency, Budget Period, Rollover, and Automation choices here shape how every other page in the app calculates and displays numbers.',
    guide_settings_connect2:'Turning on Google sync here is what lets your data follow you if you open the app on a different device.',
    guide_settings_connect3:"Exporting your data here is the safest habit to build before making any big change you're not sure about.",
    guide_settings_tip:'Set up Currency, Budget Period, and Data & Sync first, before anything else - they are the foundation everything else in the app is built on.',
  },
  de: {
    lang_name:'Deutsch',
    tab_dashboard:'Dashboard',tab_budget:'Budget',tab_transactions:'Transaktionen',
    tab_income:'Einnahmen',tab_expenses:'Ausgaben',tab_bills:'Rechnungen',
    tab_debt:'Schulden',tab_savings:'Ersparnisse',tab_settings:'Einstellungen',
    tab_debt_payoff:'Schuldenabbau',tab_sinking:'Rücklagen',
    tab_calendar:'Kalender',tab_subscriptions:'Abonnements',
    total_income:'Gesamteinnahmen',expenses_bills:'Ausgaben & Rechnungen',
    debt_payments:'Schuldenzahlungen',total_savings:'Gesamtersparnis',
    total_outgoing:'Gesamtausgaben',savings_rate:'Sparquote',
    net_leftover:'Verbleibend',cash_flow:'Cashflow',
    income_sources:'Einkommensquellen',spending_breakdown:'Ausgabenübersicht',
    expected:'Geplant',actual:'Tatsächlich',
    of:'von',budgeted:'budgetiert',saved:'gespart',
    budget_period:'Budgetzeitraum',start_date:'Startdatum',end_date:'Enddatum',
    this_month:'Diesen Monat',this_week:'Diese Woche',last_week:'Letzte Woche',last_month:'Letzter Monat',last_30_days:'Letzte 30 Tage',this_quarter:'Dieses Quartal',this_year:'Dieses Jahr',
    currency:'Währung',rollover:'Übertrag',appearance:'Erscheinungsbild',
    language:'Sprache',reset_data:'Alle Daten zurücksetzen',
    light:'Hell',dark:'Dunkel',
    changes_autosaved:'✅ Änderungen werden automatisch gespeichert.',
    rollover_desc:'Überträgt nicht ausgegebenes Geld aus der vorherigen Periode.',
    rollover_amount:'Übertragsbetrag',
    reset_desc:'Löscht alle Daten dauerhaft. Dies kann nicht rückgängig gemacht werden.',
    reset_btn:'Alles zurücksetzen',
    add:'Hinzufügen',cancel:'Abbrechen',rename_title_prompt:'Budgetplaner umbenennen',save:'Speichern',delete:'Löschen',dp_today:'Heute',dp_clear:'Löschen',edit:'Bearbeiten',
    paid:'Bezahlt',due_date:'Fälligkeitsdatum',category:'Kategorie',amount:'Betrag',
    description:'Beschreibung',date:'Datum',type:'Typ',
    add_category:'+ Kategorie hinzufügen',no_transactions:'Noch keine Transaktionen.',
    upgrade_title:'Bereit für das Pro-Erlebnis?',
    upgrade_desc:'Schuldenabbau-Rechner, Rücklagenplaner, Smart-Kalender und Abonnement-Tracker freischalten.',
    upgrade_now:'Jetzt upgraden →',
    mon:'Mo',tue:'Di',wed:'Mi',thu:'Do',fri:'Fr',sat:'Sa',sun:'So',
    quick_presets:'Schnellauswahl:',select_currency:'Währung auswählen',select_language:'Sprache auswählen',
    appearance_desc:'Zwischen hellem und dunklem Modus wechseln.',video_tutorial:'▶ Video-Tutorial',
    help_sett_intro:'Alle deine Einstellungen für den Ultimate Budget Planner. Änderungen werden automatisch gespeichert, sobald du sie vornimmst.',
    help_sett_currency_p:'Ändert das Währungssymbol sofort bei Auswahl überall in der App.',
    help_sett_appearance_p:'Zwischen Hell- und Dunkelmodus wechseln. Deine Einstellung wird sitzungsübergreifend gespeichert.',
    help_sett_nav_h:'Navigation',
    help_sett_nav_top:'Obere Navigation - Klassische horizontale Tab-Leiste oben (Standard).',
    help_sett_nav_side:'Seitennavigation - Eine schwebende Icon-Leiste links neben deinem Inhalt. Klicke auf den Pfeil, um sie zu erweitern und vollständige Beschriftungen zu sehen.',
    help_sett_period_p:'Der Datumsbereich, der „dieses Budget“ definiert. Nur Transaktionen in diesem Bereich zählen zu deinen Istwerten. Nutze die 7 Schnellauswahlen (Diesen Monat, Letzten Monat, Diese Woche, Letzte Woche, Letzte 30 Tage, Dieses Quartal, Dieses Jahr) für eine schnelle Einrichtung.',
    help_sett_rollover_p:'Nicht ausgegebenes Geld, das du aus der vorherigen Periode übertragen möchtest. Es wird zu deinem Nettosaldo im Dashboard hinzugefügt.',
    cal_title:'Smart-Kalender',
    cal_desc:'Alle deine Rechnungen, Schuldenzahlungen, Abonnements und Transaktionen in einem Live-Kalender. Klicke auf einen beliebigen Tag, um seine Ereignisse zu sehen.',
    cal_prev:'← Zurück',cal_next:'Weiter →',
    cal_all_events:'Alle Ereignisse - ',
    cal_no_events_day:'Keine Ereignisse an diesem Tag.',
    cal_no_events_month:'Keine Ereignisse in diesem Monat.',
    cal_no_events_sub:'Füge Rechnungen, Schulden oder Abonnements hinzu, um sie hier zu sehen.',
    cal_event_one:'Ereignis',cal_event_many:'Ereignisse',cal_clear:'Schließen ×',
    cal_leg_bill:'Rechnung',cal_leg_debt:'Schulden',cal_leg_sub:'Abonnement',cal_leg_tx:'Transaktion',cal_leg_sinking:'Rücklage',cal_leg_goal:'Zieldatum',cal_leg_auto:'Automatisch',
    cal_paid:'✓ Bezahlt',cal_unpaid:'Unbezahlt',
    help_cal_intro:'Der Smart-Kalender fasst alle deine finanziellen Verpflichtungen in einer monatlichen Ansicht zusammen - wird automatisch aktualisiert, wenn du Daten hinzufügst.',
    help_cal_ev_types_h:'Ereignistypen',
    help_cal_bill_li:'Rechnungen - aus deinem Rechnungsbudget (monatlich wiederkehrend am festgelegten Fälligkeitstag)',
    help_cal_debt_li:'Schuldenzahlungen - aus deinem Schuldenabbau-Bereich (wiederkehrend am Fälligkeitstag)',
    help_cal_sub_li:'Abonnements - aus deinem Abonnement-Tracker (am Tag des nächsten Abrechnungsdatums)',
    help_cal_tx_li:'Transaktionen - Daten, an denen du Einnahmen oder Ausgaben erfasst hast',
    help_cal_nav_h:'Navigation',
    help_cal_nav_p:'Nutze ← Zurück und Weiter →, um zwischen Monaten zu wechseln. Klicke auf einen Tag, um Ereignisse darunter anzuzeigen. Klicke erneut oder auf „Schließen ×" zum Aufheben.',
    help_cal_tip:'💡 Setze Fälligkeitsdaten für Rechnungen und Schulden, um den Kalender optimal zu nutzen.',
    sf_add_btn:'+ Fonds hinzufügen',
    sf_desc:'Ein Sparzielfonds ermöglicht dir, schrittweise für eine große zukünftige Ausgabe zu sparen - keine bösen Überraschungen. Lege Zielbetrag und Datum fest, und wir sagen dir genau, wie viel du monatlich sparen musst.',
    sf_empty_title:'Noch keine Sparzielfonds.',
    sf_empty_sub:'Ideal für: Urlaub, Autoreparaturen, Hochzeiten, neue Technik, Jahresrechnungen.',
    sf_pct_complete:'erreicht',
    sf_save_prefix:'Sparen',sf_per_month:'/Monat',
    sf_month_left_one:'Monat übrig',sf_month_left_many:'Monate übrig',
    sf_total_contrib:'Gesamt benötigte monatliche Beiträge:',
    sf_modal_new:'🏺 Neuer Sparzielfonds',sf_modal_edit:'✏️ Fonds bearbeiten',
    sf_fund_name_label:'Fondsname',sf_fund_name_ph:'z.B. Urlaubsfonds',
    sf_icon_label:'Symbol',sf_target_amount_label:'Zielbetrag',
    sf_currently_saved_label:'Bereits gespart',sf_target_date_label:'Zieldatum',
    sf_create_btn:'Fonds erstellen',
    help_sf_intro:'Ein Sparzielfonds ist Geld, das du im Voraus für eine große geplante Ausgabe zurücklegst - keine bösen Überraschungen, wenn die Rechnung kommt.',
    help_sf_how_to_h:'So verwendest du ihn',
    help_sf_step1:'Klicke auf + Fonds hinzufügen',
    help_sf_step2:'Benenne deinen Fonds (z.B. „Sommerurlaub"), wähle ein Symbol',
    help_sf_step3:'Lege einen Zielbetrag fest (wie viel du insgesamt benötigst)',
    help_sf_step4:'Lege ein Zieldatum fest (wann du das Geld benötigst)',
    help_sf_step5:'Gib ein, wie viel du bereits darauf gespart hast',
    help_sf_reading_h:'Die Karte verstehen',
    help_sf_reading_p:'Jede Karte zeigt gespartes Geld vs. Ziel, einen Fortschrittsbalken und genau, wie viel du monatlich sparen musst, um rechtzeitig dein Ziel zu erreichen.',
    help_sf_contrib_h:'Beiträge hinzufügen',
    help_sf_contrib_p:'Klicke auf das +-Symbol auf einer Karte, um einen Beitrag zu erfassen - gib den Betrag ein, den du diesen Monat hinzufügst.',
    help_sf_tip:'💡 Ideal für: Urlaub, Autoreparaturen, Jahresversicherungen, Hochzeiten, Elektronik, Heimverbesserungen.',
    dpc_title:'Schuldenrechner',dpc_add_btn:'+ Schuld hinzufügen',
    dpc_desc:'Trage jede Schuld ein, wähle eine Rückzahlungsstrategie und sieh genau, wann du schuldenfrei bist und wie viel Zinsen du insgesamt zahlst.',
    dpc_method_label:'Rückzahlungsmethode',
    dpc_snowball_desc:'Niedrigstes Saldo zuerst - schnelle Erfolge halten dich motiviert',
    dpc_avalanche_desc:'Höchste Zinsen zuerst - spart insgesamt am meisten Geld',
    dpc_extra_label:'Zusätzliche monatliche Zahlung',
    dpc_extra_hint:'Betrag über deinen Mindestzahlungen, den du jeden Monat zusätzlich in die Schuldenrückzahlung steckst.',
    dpc_empty_title:'Noch keine Schulden hinzugefügt.',
    dpc_empty_sub:'Klicke auf „+ Schuld hinzufügen", um deinen Tilgungsplan zu erstellen.',
    dpc_th_name:'Schuld',dpc_th_type:'Art',dpc_th_balance:'Saldo',
    dpc_th_apr:'Zins %',dpc_th_min:'Mind.-Zahlung',dpc_th_due:'Fälligkeitstag',
    dpc_totals:'Gesamt',dpc_name_ph:'z.B. Visa Karte',
    dpc_term_label:'Laufzeit (Jahre)',dpc_term_hint:'Legt fest, wie lange dieser Kredit läuft, damit die automatische Berechnung eine genaue Mindestrate ermitteln kann.',
    dpc_autocalc_btn:'Automatisch berechnen',dpc_autocalc_done:'Berechnet: {0}/Monat',
    dpc_min_mode_label:'Art der Mindestrate',dpc_min_mode_fixed:'Fester Betrag',dpc_min_mode_percent:'% vom Saldo',
    dpc_min_percent_label:'Prozent vom Saldo (%)',dpc_min_floor_label:'Mindestbetrag',
    dpc_min_calculated_hint:'Wird automatisch berechnet - je nachdem, was höher ist: der Prozentsatz oder der Mindestbetrag.',
    dpc_escrow_label:'Treuhand (Steuern & Versicherung)',
    dpc_escrow_hint:'Wird zu deinen tatsächlichen monatlichen Kosten addiert, aber von der Tilgungssimulation ausgeschlossen, da es den Saldo nicht verringert.',
    dpc_min_pct_caption:'{0}% vom Saldo',dpc_escrow_note:'{0} Treuhand',
    dpc_term_note_faster:'{0} Monate schneller als deine {1}-jährige Laufzeit',dpc_term_note_slower:'{0} Monate langsamer als deine {1}-jährige Laufzeit',
    dpc_term_note_onschedule:'genau im Zeitplan für deine {0}-jährige Laufzeit',
    dpc_escrow_mode_label:'Treuhandart',dpc_escrow_mode_fixed:'Fester Betrag',dpc_escrow_mode_declining:'Fallend mit dem Saldo',
    dpc_escrow_mode_hint:'Dies wirkt sich nur auf den Zahlungsplan unten aus. Dein automatisierter Betrag und die Dashboard-Summe verwenden immer den aktuellen festen Treuhandbetrag.',
    dpc_rate_type_label:'Zinsart',dpc_rate_type_fixed:'Fest für die gesamte Laufzeit',dpc_rate_type_arm:'Passt sich nach einer festen Periode an (variabel)',
    dpc_rate_type_hint:'Ein vereinfachtes Modell: ein Zinssatz für die feste Periode, danach ein einzelner neuer Zinssatz für den Rest des Kredits - keine vollständige Index-/Obergrenzen-Simulation.',
    dpc_arm_fixed_years_label:'Feste Zinsperiode (Jahre)',dpc_arm_rate_label:'Zinssatz nach Anpassung',
    dpc_arm_caption:'passt sich nach {0}-jähriger fester Periode an',
    dpc_recalc_link:'↺ Neu berechnen',
    dpc_th_extra:'Extra/Monat',
    dpc_extra_col_hint:'Wird jeden Monat zusätzlich zur Mindestzahlung dieser Schuld gezahlt, bevor die gemeinsame Extrazahlung oben verteilt wird. Endet, sobald diese Schuld abbezahlt ist - wird nicht anderswo umgeleitet.',
    dpc_targeted_extra_note:'{0} gezielte Extra',
    dpc_schedule_btn_title:'Zahlungsplan ansehen',
    dpc_amort_type_label:'Rückzahlungsart',dpc_amort_equal_payment:'Gleichbleibende Raten',dpc_amort_equal_principal:'Fallende Raten (gleicher Tilgungsanteil)',
    dpc_amort_type_hint:'Bei gleichbleibenden Raten bleibt die Zahlung jeden Monat gleich. Bei fallenden Raten bleibt der Tilgungsanteil fest, sodass die Gesamtrate mit der Zeit sinkt, da die Zinsen abnehmen - üblich bei manchen Hypotheken.',
    dpc_autocalc_done_declining:'Erste Rate: {0}/Monat (sinkt monatlich)',dpc_declining_caption:'fallende Rate',
    dtype_credit_card:'Kreditkarte',dtype_student_loan:'Studienkredit',
    dtype_mortgage:'Hypothek',dtype_car_loan:'Autokredit',
    dtype_personal_loan:'Privatkredit',dtype_other:'Sonstiges',
    dpc_debt_free_label:'🎯 Schuldenfreiheit',dpc_months_from_now:'Monate ab jetzt',
    dpc_interest_label:'💸 Gesamtzinsen',dpc_on_top:'zusätzlich zu',dpc_principal:'Hauptbetrag',
    dpc_monthly_label:'📅 Monatlich gesamt',dpc_min_abbr:'Min.',dpc_extra_abbr:'Extra',
    dpc_payoff_order_sf:'Tilgungsreihenfolge - ⛄ Schneeball (niedrigstes Saldo zuerst)',
    dpc_payoff_order_av:'Tilgungsreihenfolge - 🌊 Lawine (höchste Zinsen zuerst)',
    dpc_paid_off:'Abbezahlt:',dpc_balance_word:'Saldo',dpc_apr_word:'Zinssatz',
    help_dpc_intro:'Dieser Rechner erstellt einen personalisierten Tilgungsplan basierend auf deinen Schulden und der gewählten Strategie.',
    help_dpc_entries_h:'Deine Schuldeneinträge',
    help_dpc_balance_li:'Saldo - Wie viel du aktuell auf dieser Schuld schuldest.',
    help_dpc_apr_li:'Zins % - Der effektive Jahreszins (auf deinem Kontoauszug). Z.B. 18,9 bedeutet 18,9%.',
    help_dpc_min_li:'Mind.-Zahlung - Die monatliche Mindestzahlung, die vom Kreditgeber verlangt wird.',
    help_dpc_due_li:'Fälligkeitstag - Der Fälligkeitstag im Monat (erscheint im Smart-Kalender).',
    help_dpc_strategies_h:'Rückzahlungsstrategien',
    help_dpc_snowball_li:'\u26c4 Schneeball - Schulden werden nach dem niedrigsten Saldo getilgt. Nach der Tilgung wird die Zahlung auf die nächste übertragen. Beste Methode für Motivation.',
    help_dpc_avalanche_li:'\uD83C\uDF0A Lawine - Schulden werden nach dem höchsten Zinssatz getilgt. Spart insgesamt am meisten Geld.',
    help_dpc_extra_h:'Zusätzliche monatliche Zahlung',
    help_dpc_extra_p:'Jeder Überschuss über deinen Mindestzahlungen kann zur Schuldentilgung eingesetzt werden. Selbst eine kleine Extrazahlung kann Hunderte an Zinsen sparen und Monate verkürzen. Ergebnisse werden beim Tippen aktualisiert.',
    help_dpc_term_li:'Laufzeit - Lege bei Hypotheken, Studien-, Auto- und Privatkrediten die Laufzeit in Jahren fest und klicke auf "Automatisch berechnen", um eine genaue Mindestrate zu ermitteln.',
    help_dpc_percent_li:'Prozentbasierte Mindestrate - Wechsle bei Kreditkarten zu "% vom Saldo", damit es genauso funktioniert wie auf deiner Abrechnung (z. B. 2% vom Saldo oder 25 €, je nachdem, was höher ist).',
    help_dpc_escrow_li:'Treuhand - Füge bei Hypotheken deine monatlichen Steuern & Versicherungen hinzu, damit deine tatsächlichen monatlichen Kosten überall stimmen; sie werden von der Tilgungsprognose ausgeschlossen, da sie den Saldo nicht verringern.',
    help_dpc_amort_li:'Rückzahlungsart - Bei gleichbleibenden Raten bleibt deine Zahlung jeden Monat gleich. Bei fallenden Raten (gleicher Tilgungsanteil) bleibt der Betrag, der zur Tilgung geht, fest, sodass deine Gesamtrate mit der Zeit sinkt; prüfe deine Kreditunterlagen, um zu sehen, welche Art du hast.',
    help_dpc_escrow_mode_li:'Treuhandart - wähle "Fallend mit dem Saldo", wenn deine Treuhand mit deinem Kreditsaldo sinkt, wie bei manchen fallenden Versicherungsprämien; du kannst das im Zahlungsplan sehen.',
    help_dpc_rate_type_li:'Zinsart - wähle "Passt sich nach einer festen Periode an" für variable Kredite, und lege dann fest, wie viele Jahre der Zinssatz fest ist und worauf er sich danach ändert.',
    help_dpc_extra_targeted_li:'Extra/Monat (pro Schuld) - ein optionaler Betrag, der jeden Monat nur für diese eine Schuld zusätzlich zur Mindestzahlung gezahlt wird, unabhängig von deiner Schneeball-/Lawinen-Reihenfolge.',
    dsched_col_date:'Datum',dsched_col_payment:'Zahlung',dsched_col_principal:'Tilgung',dsched_col_interest:'Zinsen',dsched_col_escrow:'Treuhand',dsched_col_balance:'Saldo',
    dsched_never_payoff_warning:'In diesem Tempo wird diese Schuld innerhalb von 50 Jahren nicht vollständig abbezahlt sein - die Zahlung übertrifft die Zinsen kaum. Erwäge eine höhere Mindestzahlung, einen höheren Prozentsatz-Mindestbetrag oder eine Extrazahlung.',
    help_dpc_tip:'\uD83D\uDCA1 Wechsle zwischen den Methoden, um zu sehen, wie viele Zinsen du mit jedem Ansatz sparen würdest.',
    tx_import_csv:'\uD83D\uDCE5 CSV importieren',
    tx_add_title:'Transaktion hinzufügen',
    tx_date:'Datum',tx_type:'Art',tx_category:'Kategorie',tx_amount:'Betrag',
    tx_desc_label:'Beschreibung',tx_desc_ph:'z.B. Einkaufen\u2026',
    tx_add_btn:'Hinzufügen',tx_error_required:'Bitte alle Pflichtfelder ausfüllen.',
    tx_transaction_one:'Transaktion',tx_transaction_many:'Transaktionen',
    tx_clear_all:'Alle löschen',tx_empty:'Noch keine Transaktionen.',
    tx_type_income:'Einnahmen',tx_type_expense:'Ausgaben',tx_type_bill:'Rechnung',tx_type_savings:'Ersparnisse',
    tx_th_amount:'Betrag',tx_th_desc:'Beschreibung',
    tx_edit_title:'\u270F\uFE0F Transaktion bearbeiten',tx_save_changes:'Änderungen speichern',
    help_tx_intro:'Jede Geldbewegung wird hier erfasst. Deine Budget-Istwerte und das Dashboard werden automatisch aktualisiert, sobald du eine hinzufügst.',
    help_tx_adding_h:'Transaktion hinzufügen',
    help_tx_step1:'Wähle ein Datum - klicke auf das Datumsfeld, um den Kalender zu öffnen',
    help_tx_step2:'Wähle einen Typ: Einnahme, Ausgabe, Rechnung, Ersparnis, Schuld, Abonnement oder Spartopf',
    help_tx_step3:'Wähle die passende Kategorie (in der Budget-Registerkarte einrichten)',
    help_tx_step4:'Gib den Betrag und eine optionale Beschreibung ein',
    help_tx_step5:'Klicke auf Hinzufügen',
    help_tx_edit_h:'Bearbeiten & löschen',
    help_tx_edit_p:'Klicke \u270F\uFE0F auf eine Transaktion zum Bearbeiten, oder \u00d7 zum Löschen. Um alles zu löschen, nutze „Alle löschen".',help_tx_auto_h:'Automatische Transaktionen',help_tx_auto_p:'Erstelle eine Regel für alles, was sich wiederholt (z.B. Miete oder Gehalt) und wähle die Häufigkeit. Die App fügt sie an jedem Fälligkeitsdatum automatisch zur Liste hinzu. Mit dem Schalter pausierst du eine Regel, mit dem Stift bearbeitest du sie.',
    help_tx_csv_h:'CSV-Import',
    help_tx_csv_p1:'Importiere einen Tabellenexport im Format: Date,Type,Category,Amount,Description (Kopfzeile erforderlich).',
    help_tx_csv_p2:'Daten sollten im Format YYYY-MM-DD vorliegen. Type muss eines von Folgendem sein: income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_section_income:'Einnahmen',bud_section_expenses:'Ausgaben',
    bud_section_bills:'Rechnungen',bud_section_savings:'Ersparnisse',
    bud_th_category:'Kategorie',bud_th_expected:'Geplant',
    bud_th_actual:'Tatsächlich',bud_th_progress:'Fortschritt',
    bud_th_due_date:'Fälligkeitsdatum',bud_th_paid:'Bezahlt',
    bud_total:'Gesamt',bud_set_date:'Datum wählen',
    bud_add_btn:'+ Hinzufügen',bud_add_cat_title:'Neue Kategorie hinzufügen',
    bud_cat_name_label:'Kategoriename',bud_cat_name_ph:'z.B. Freiberuflich',
    bud_add_cat_btn:'Hinzufügen',bud_due_date_label:'Fälligkeitsdatum',
    help_bud_intro:'Die Budget-Registerkarte ist der Ort, an dem du dein Geld planst. Lege erwartete Beträge für jede Kategorie fest - die Istwerte werden automatisch aus deinen Transaktionen übernommen.',
    help_bud_how_h:'So funktioniert es',
    help_bud_step1:'Klicke auf ein Geplant-Feld und gib deinen Budgetbetrag ein',
    help_bud_step2:'Trage Transaktionen in der Transaktionen-Registerkarte ein',
    help_bud_step3:'Die Spalte Tatsächlich und die Fortschrittsbalken werden automatisch aktualisiert',
    help_bud_colours_h:'Farben der Fortschrittsbalken',
    help_bud_col_green:'Grün - Einnahmen auf oder über dem Ziel',
    help_bud_col_indigo:'Indigo - Ausgaben im Rahmen des Budgets',
    help_bud_col_red:'Rot - Ausgaben über dem Budget',
    help_bud_bills_h:'Bereich Rechnungen',
    help_bud_bills_p:'Rechnungen haben ein Fälligkeitsdatum (klicke darauf, um die Datumsauswahl zu öffnen) und ein Bezahlt-Kontrollkästchen. Diese Daten erscheinen auch im Smart-Kalender.',
    help_bud_tip:'\uD83D\uDCA1 Verwende "+ Kategorie hinzufügen", um benutzerdefinierte Kategorien für jeden Bereich zu erstellen.',
    dash_total_income:'Gesamteinnahmen',dash_of:'von',dash_expected_sfx:'erwartet',
    dash_total_outgoing:'Gesamtausgaben',dash_budgeted_sfx:'budgetiert',
    dash_savings_rate:'Sparquote',dash_saved_sfx:'gespart',
    dash_subscriptions:'Abonnements',dash_per_year:'/Jahr',
    dash_net_leftover:'Nettosaldo dieser Periode',
    dash_in_sfx:'eingenommen',dash_out_sfx:'ausgegeben',
    dash_includes:'Inkl.',dash_rollover_sfx:'Übertrag',
    dash_cash_flow:'Cashflow',
    dash_expected_legend:'Geplant',dash_actual_legend:'Tatsächlich',
    dash_income_sources:'Einnahmequellen',dash_no_income:'Noch keine Einnahmen erfasst.',
    dash_spending_breakdown:'Ausgabenübersicht',dash_no_spending:'Noch keine Ausgaben erfasst.',
    dash_no_debts:'Noch keine Schulden hinzugefügt.',dash_set_up:'Einrichten \u2192',
    dash_debt_free_label:'Schuldenfrei',dash_interest_label:'Zinsen',
    dash_months_label:'Monate',dash_method_label:'Methode',
    dash_set_balances:'Salden eingeben, um Ergebnisse zu sehen.',
    dash_upcoming_7:'\uD83D\uDCC5 Bevorstehend (7 Tage)',dash_nothing_scheduled:'Nichts geplant.',
    dash_no_sinking:'Keine Sparzielfonds.',dash_create_one:'Einen erstellen \u2192',
    help_dash_intro:'Das Dashboard gibt dir einen Echtzeit-Überblick über deine Finanzen. Alle Zahlen werden automatisch aktualisiert, wenn du Transaktionen erfasst.',
    help_dash_hero_h:'Statistikübersicht',
    help_dash_hero_p:'Die vier Karten oben zeigen deine Periodensummen: Erhaltene Gesamteinnahmen, Gesamtausgaben (Ausgaben, Rechnungen, Schulden & Abonnements), Sparquote (% des gesparten Einkommens) und monatliche Abonnementkosten.',
    help_dash_leftover_h:'Nettosaldo',
    help_dash_leftover_p:'Verbleibendes Geld nach allen Ausgaben und Ersparnissen. Grün = du liegst im Plan. Rot = du hast dein Budget überschritten.',
    help_dash_cashflow_h:'Cashflow-Diagramm',
    help_dash_cashflow_p:'Jede Zeile zeigt Geplant (grauer Balken) vs. Tatsächlich (farbiger Balken) für Einnahmen, Ausgaben, Rechnungen und Ersparnisse. Ein roter Balken bedeutet, dass du das Budget überschritten hast.',
    help_dash_donut_h:'Donut-Diagramme',
    help_dash_donut_p:'Bewege die Maus über ein Segment oder tippe darauf, um Beschriftung und Prozentsatz zu sehen. Sie zeigen, woher dein Geld kommt und wohin es geht.',
    help_dash_bottom_h:'Untere Panels',
    help_dash_bottom_p:'Schnellübersichten über deinen Schuldenabbau, bevorstehende Rechnungen/Abonnements in den nächsten 30 Tagen und Sparzielfonds-Ziele.',
    help_dash_tip:'\uD83D\uDCA1 Klicke auf das Datums-Badge oben, um deinen Budgetzeitraum zu ändern.',
    tx_type_debt:'Schulden',
    dash_debt_payments:'Schulden',
    dash_debts_paid:'Schuld diese Periode bezahlt',dash_debts_paid_many:'Schulden diese Periode bezahlt',
    tx_type_subscription:'Abonnement',
    alloc_title:'Budgetaufteilung',
    alloc_desc:'Markiere Ausgaben als Bedarf, Wunsch oder Sparen, um zu sehen, wie dein Geld mit deiner Zielaufteilung übereinstimmt.',
    alloc_label:'Zuordnung',alloc_optional:'Ausgabe markieren',
    alloc_target:'Ziel',alloc_on_track:'Im Plan',alloc_over:'Überschritten',alloc_under:'Darunter',
    alloc_enabled_label:'Budgetaufteilung aktivieren',
    alloc_name_ph:'Kategoriename',alloc_pct_label:'% des Einkommens',
    alloc_sum_ok:'\u2713 100%',alloc_sum_bad:'\u26a0 Muss 100% ergeben',
    alloc_based_on:'Basierend auf',alloc_income_period:'Einnahmen in dieser Periode',
    alloc_untagged:'Nicht markiert',alloc_untagged_desc:'der Ausgaben noch nicht markiert',
    alloc_def_need:'Bedarf',alloc_def_want:'Wunsch',alloc_def_save:'Sparen',
    alloc_sett_title:'\uD83C\uDFAF Ausgabenaufteilung',
    alloc_nearing:'Nähert sich',
    alloc_required:'Zuordnung ist für Ausgabentransaktionen erforderlich.',
    toast_tx_added:'Transaktion hinzugef\u00fcgt \u2713',toast_tx_updated:'Aktualisiert \u2713',toast_tx_deleted:'Gel\u00f6scht',
    toast_period_updated:'Zeitraum aktualisiert \u2713',toast_period_error:'Enddatum muss nach dem Startdatum liegen',
    toast_currency_updated:'W\u00e4hrung aktualisiert \u2713',toast_imported:'{0} importiert \u2713',
    toast_fund_created:'Fonds erstellt \u2713',toast_fund_updated:'Fonds aktualisiert \u2713',
    toast_fund_contrib:'{amt} zu {name} hinzugef\u00fcgt \u2713',
    toast_sub_added:'Abonnement hinzugef\u00fcgt \u2713',toast_sub_updated:'Abonnement aktualisiert \u2713',
    toast_alloc_enabled:'Aufteilung aktiviert \u2713',toast_alloc_disabled:'Aufteilung deaktiviert',
    toast_lang_updated:'Sprache aktualisiert \u2713',toast_export:'Exportiert \u2713',
    toast_saved:'Gespeichert \u2713',toast_reset:'Alle Daten gel\u00f6scht',toast_alloc_bucket_added:'Kategorie hinzugef\u00fcgt \u2713',
    confirm_remove_cat:'Diese Kategorie entfernen?',confirm_delete_all_tx:'ALLE Transaktionen l\u00f6schen? Das kann nicht r\u00fcckg\u00e4ngig gemacht werden.',
    confirm_delete_tx:'Diese Transaktion l\u00f6schen?',confirm_remove_debt:'Diese Schuld entfernen?',
    confirm_delete_fund:'Diesen Fonds l\u00f6schen?',confirm_remove_sub:'Dieses Abonnement entfernen?',
    confirm_reset_1:'Bist du sicher? Alle Daten werden dauerhaft gel\u00f6scht.',
    confirm_reset_2:'Letzte Chance - das kann nicht r\u00fcckg\u00e4ngig gemacht werden. Fortfahren?',
    export_csv_btn:'\uD83D\uDCE5 CSV exportieren',sett_export_title:'\uD83D\uDCE4 Daten exportieren',
    sett_export_desc:'Alle Transaktionen als CSV-Datei herunterladen, zur Sicherung oder Nutzung in einer anderen App.',
    sf_add_contribution:'Beitrag hinzuf\u00fcgen',sf_contribution_label:'Hinzuzuf\u00fcgender Betrag',sf_currently_saved:'Bisher gespart',
    tx_search_ph:'Nach Beschreibung oder Kategorie suchen\u2026',tx_filter_all_types:'Alle Arten',tx_filter_all_alloc:'Alle Zuordnungen',
    tx_sort_date_new:'Neueste zuerst',tx_sort_date_old:'\u00c4lteste zuerst',tx_sort_amt_high:'H\u00f6chster Betrag',tx_sort_amt_low:'Niedrigster Betrag',
    tx_showing:'{n} von {total} angezeigt',tx_no_results:'Keine Transaktionen entsprechen deinem Filter.',
    alloc_add_bucket:'+ Kategorie hinzuf\u00fcgen',alloc_remove_btn:'Entfernen',alloc_total_label:'Gesamt',alloc_new_bucket:'Neue Kategorie',alloc_color_title:'Farbe wählen',alloc_custom_color:'Eigene',alloc_min_buckets:'Mindestens 2 Kategorien erforderlich',
    alloc_auto_tag:'Automatisch markiert \u2192 {name}',
    tx_prev:'\u2190 Zur\u00fcck',tx_next:'Weiter \u2192',tx_page_of:'Seite {n} von {total}',
    debt_due_day_note:'Tage 29-31 erscheinen nicht in k\u00fcrzeren Monaten',
    sub_advanced:'Abrechnungsdatum vorger\u00fcckt auf {date}',
    sf_days_left:'{n} Tage verbleibend',sf_days_overdue:'{n} Tage \u00fcberf\u00e4llig',
    sf_due_today:'Heute f\u00e4llig!',sf_target_complete:'Ziel erreicht! \u2713',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs Vorherige Periode',dash_compare_no_data:'Keine Daten f\u00fcr vorherige Periode',
    recurring_title:'Automatische Transaktionen',recurring_desc:'Richte Transaktionen ein, die sich regelmäßig wiederholen (Beispiel: Miete, Gehalt oder Abos). Sie werden an jedem Fälligkeitsdatum automatisch zur Liste hinzugefügt.',recurring_add_rule:'+ Automatische Transaktion hinzuf\u00fcgen',
    recurring_empty:'Noch keine automatischen Transaktionen hinzugef\u00fcgt.',recurring_label_ph:'Transaktionsname (z.B. Netflix)',
    recurring_freq:'H\u00e4ufigkeit',freq_daily:'T\u00e4glich',freq_weekly:'W\u00f6chentlich',
    freq_monthly:'Monatlich',freq_quarterly:'Viertelj\u00e4hrlich',freq_annual:'J\u00e4hrlich',
    recurring_next_due:'N\u00e4chst f\u00e4llig',recurring_generated:'{0} neue Transaktionen automatisch hinzugefügt',
    recurring_remove:'Regel entfernen',recurring_paused:'Pausiert',recurring_active:'Aktiv',recurring_saved:'Automatische Transaktion gespeichert ✓',dpc_add_debt_title:'Schuld hinzufügen',dpc_edit_debt_title:'Schuld bearbeiten',debt_due_day_modal_hint:'Der Tag im Monat, an dem diese Zahlung fällig ist',toast_debt_added:'Schuld hinzugefügt',toast_debt_updated:'Schuld aktualisiert',sf_billing_day_label:'Abrechnungstag des Monats',sf_billing_day_hint:'Der Tag im Monat, an dem der Beitrag automatisch gebucht wird',sf_error_required:'Bitte fülle alle Pflichtfelder aus',sub_active:'Aktiv',sub_paused:'Pausiert',sub_desc:'Behalte jede wiederkehrende Zahlung im Blick und verstehe deine tatsächlichen Jahreskosten. Pausiere Abos, die du nicht nutzt, um die Kosten im Griff zu behalten.',sub_add_btn:'+ Abo hinzufügen',sub_add_title:'Abo hinzufügen',sub_edit_title:'Abo bearbeiten',sub_empty_title:'Noch keine Abos.',sub_empty_sub:'Füge deine wiederkehrenden Zahlungen hinzu - Netflix, Spotify, Fitnessstudio usw.',sub_sum_monthly:'Monatlich gesamt',sub_sum_annual:'Jährlich gesamt',sub_by_category:'Nach Kategorie',sub_per_month:'/Monat',sub_next_label:'Nächste',sub_name_label:'Name des Abos',sub_name_ph:'z.B. Netflix',sub_amount_label:'Betrag',sub_freq_label:'Abrechnungsintervall',sub_freq_monthly:'Monatlich',sub_freq_annual:'Jährlich',sub_freq_quarterly:'Vierteljährlich',sub_freq_weekly:'Wöchentlich',sub_unit_month:'Monat',sub_unit_year:'Jahr',sub_unit_quarter:'Quartal',sub_cat_label:'Kategorie',sub_date_label:'Nächstes Abrechnungsdatum',sub_cat_entertainment:'Unterhaltung',sub_cat_productivity:'Produktivität',sub_cat_health:'Gesundheit & Fitness',sub_cat_food:'Essen & Trinken',sub_cat_cloud:'Cloud-Speicher',sub_cat_finance:'Finanzen',sub_cat_education:'Bildung',sub_cat_gaming:'Gaming',sub_cat_news:'Nachrichten & Medien',sub_cat_other:'Sonstiges',help_sub_intro:'Behalte jede wiederkehrende Zahlung im Blick und verstehe deine tatsächlichen monatlichen und jährlichen Kosten. Abos, die unbemerkt dein Konto belasten, gehen leicht unter - so bleiben sie sichtbar.',help_sub_how_h:'Ein Abo hinzufügen',help_sub_step1:'Klicke auf + Abo hinzufügen',help_sub_step2:'Gib Name, Betrag und Abrechnungsintervall ein (monatlich, jährlich, vierteljährlich, wöchentlich)',help_sub_step3:'Wähle eine Kategorie, um ähnliche Abos zu gruppieren',help_sub_step4:'Lege das nächste Abrechnungsdatum fest - es erscheint im intelligenten Kalender',help_sub_monthly_h:'Monatliches Äquivalent',help_sub_monthly_p:'Jährliche und vierteljährliche Abos werden in monatliche Kosten umgerechnet, damit du deine tatsächlichen monatlichen Ausgaben auf einen Blick siehst.',help_sub_pause_h:'Abos pausieren',help_sub_pause_p:'Schalte den Aktiv-Schalter bei einem Abo aus, das du gerade nicht nutzt. Es zählt dann nicht mehr zu deinen Summen, bis du ihn wieder einschaltest.',help_sub_chart_h:'Kategorie-Diagramm',help_sub_chart_p:'Das Kreisdiagramm zeigt, wie sich deine Abo-Ausgaben auf Kategorien verteilen - fahre über ein Segment für Details.',help_sub_tip:'💡 Aktiviere „Automatisieren“ bei einem Abo, damit es bei jedem Abrechnungszyklus automatisch zu deinen Transaktionen hinzugefügt wird.',automate_auto_pay:'Auto-Zahlung',sf_auto_contribute:'Auto-Beitrag',sf_auto_need_amount:'Füge zuerst Zielbetrag und Datum hinzu',sf_auto_set:'Monatlicher Beitrag: {0}',automate_label:'Automatisieren',automate_hint:'Fügt es planmäßig automatisch zu deinen Transaktionen hinzu',automate_hint_off:'Aktiviere die Automatisierung in den Einstellungen',automate_th:'Auto-Zahlung',automate_need_amount:'Lege zuerst eine Mindestzahlung fest',automate_payment_word:'Zahlung',automate_linked:'Verknüpfte automatische Transaktion',sf_contribution_label:'Monatlicher Beitrag',sf_contribution_hint:'Wird monatlich automatisch gebucht, um diesen Fonds zu erhöhen',sett_automation_h:'Automatisierung',sett_automation_desc:'Hauptschalter für automatische Transaktionen. Wenn aus, werden keine geplanten Transaktionen erstellt und die Automatisierungs-Optionen sind deaktiviert.',sett_automation_toggle:'Automatische Transaktionen',sett_automation_hint:'Gilt für Transaktionen, Abos, Fonds und Schulden',
    tx_type_sinking_fund:'Spartopf',
    help_dash_alloc_h:'Budget-Aufteilungs-Panel',
    help_dash_alloc_what_h:'Was es ist',
    help_dash_alloc_what_p:'Verfolgt deine Ausgaben im Vergleich zu anpassbaren Zielprozentwerten deines Einkommens. Die klassische 50/30/20-Regel teilt das Einkommen auf: Bedarf (Grundbedürfnisse: Miete, Essen, Nebenkosten), Wunsch (Lifestyle: Ausgehen, Streaming, Hobbys) und Sparen (Vermögensaufbau und Schuldenabbau). Du kannst jede Aufteilung festlegen - die Prozentsätze müssen nur 100% ergeben.',
    help_dash_alloc_tag_h:'Transaktionen markieren',
    help_dash_alloc_tag_p:'Wähle beim Erfassen einer Transaktion eine Zuordnung (Bedarf / Wunsch / Sparen) aus dem Dropdown. Einnahmen und Spareinlagen werden nicht markiert. Ein ? Badge zeigt, dass diese Ausgabe noch nicht markiert wurde.',
    help_dash_alloc_read_h:'Die Karten verstehen',
    help_dash_alloc_read_p:'Jede Karte zeigt den Kategorienamen, deinen Zielwert in % und deinen tatsächlichen %-Anteil am Einkommen für den Zeitraum. Der schmale Balken füllt sich proportional - ist er voll, hast du dein Limit erreicht.',
    help_dash_alloc_col_h:'Farbkodierung',
    help_dash_alloc_col_over:'Rot - du hast das Ziel überschritten. Prozentsatz und Balken werden rot.',
    help_dash_alloc_col_near:'Orange - innerhalb von 5 Prozentpunkten des Ziels. Ein Hinweis, dass du dich annäherst.',
    help_dash_alloc_col_norm:'Kategoriefarbe - bequem innerhalb deines Ziels für diesen Zeitraum.',
    help_dash_alloc_setup_h:'Anpassen',
    // Penny (KI-Assistentin)
    sett_penny_h:'Penny (KI-Budget-Assistentin)',
    sett_penny_desc:'Stelle Penny Fragen zu deinem Budget & deinen Ausgabengewohnheiten',
    sett_penny_toggle:'Penny aktivieren',
    sett_penny_hint:'Schaltet die Assistentin Penny und ihr Symbol in der Navigationsleiste ein.',
    sett_penny_key_label:'Gemini API-Schlüssel',
    sett_penny_key_placeholder:'Füge deinen Gemini API-Schlüssel ein',
    sett_penny_howto:'So erstelle ich meinen Schlüssel',
    sett_penny_save_btn:'Schlüssel speichern',
    sett_penny_key_saved:'Gemini API-Schlüssel gespeichert und verschlüsselt',
    sett_penny_remove:'Schlüssel entfernen',
    sett_penny_available:'Penny ist jetzt im Navigationsmenü verfügbar.',
    sett_penny_usage_count:'Penny hat diesen Monat {0} Fragen beantwortet',
    sett_penny_key_error_short:'Das sieht nicht wie ein gültiger Schlüssel aus. Bitte überprüfen und erneut versuchen.',
    confirm_penny_remove_key:'Deinen gespeicherten Gemini API-Schlüssel entfernen? Penny wird deaktiviert, bis du einen neuen hinzufügst.',
    toast_penny_key_saved:'Gemini-Schlüssel sicher gespeichert.',
    penny_nav_pill_off:'Penny aktivieren',
    penny_nav_pill_on:'Penny fragen',
    penny_nav_aria_off:'Penny aktivieren',
    penny_nav_aria_on:'Penny fragen',
    penny_chat_title:'Penny fragen',
    penny_input_placeholder:'Frage zu deinem Budget…',
    penny_send:'Fragen',
    penny_thinking:'Penny überlegt…',
    penny_voice_on:'Sprachantworten an',
    penny_voice_off:'Sprachantworten aus',
    penny_disclaimer:'Deine ganz persönliche KI-Budget-Assistentin',
    penny_no_key_notice:'Füge deinen Gemini API-Schlüssel in den Einstellungen hinzu, um mit Penny zu chatten.',
    penny_open_settings:'Einstellungen öffnen',
    penny_close:'Penny schließen',
    penny_qp_leftover:'Wie viel habe ich in diesem Zeitraum noch übrig?',
    penny_qp_top_category:'Was ist meine größte Ausgabenkategorie?',
    penny_qp_on_track:'Liege ich in meinem Budget im Plan?',
    penny_qp_subscriptions:'Was zahle ich für Abonnements?',
    penny_qp_debt:'Wie läuft meine Schuldentilgung?',
    penny_qp_chart:'Zeig mir ein Diagramm meiner Ausgaben',
    penny_err_invalid_key:'Dein Gemini API-Schlüssel scheint ungültig oder widerrufen zu sein. Aktualisiere ihn in den Einstellungen.',
    penny_err_rate_limited:'Du hast gerade das Ratenlimit von Gemini erreicht. Das ist ein Limit von Google für deinen Schlüssel, nicht der Zähler oben. Warte kurz und versuche es erneut.',
    penny_err_network:'Penny konnte die Server von Google nicht erreichen. Überprüfe deine Verbindung und versuche es erneut.',
    penny_err_blocked:'Penny konnte darauf keine sichere Antwort finden. Versuche, deine Frage zum Budget anders zu formulieren.',
    penny_err_unknown:'Bei Penny ist etwas schiefgelaufen. Bitte versuche es gleich noch einmal.',
    penny_err_key_unreadable:'Dein gespeicherter Schlüssel konnte nicht gelesen werden. Bitte gib ihn in den Einstellungen erneut ein.',
    penny_err_retry:'Erneut versuchen',
    help_sett_penny_p:'Schalte Penny unten ein, um Fragen zu deinem Budget in einfacher Sprache zu stellen. Tippe auf „So erstelle ich meinen Schlüssel“ für die Einrichtungsschritte.',
    help_penny_title:'Penny einrichten',
    help_penny_intro:'Penny ist der KI-Assistent von Evo Budget. Da diese App keinen eigenen Server hat, spricht Penny direkt von deinem Browser aus mit Google, über deinen eigenen kostenlosen Gemini API-Schlüssel. Es läuft nie über einen Evo-Budget-Server, denn den gibt es nicht.',
    help_penny_steps_h:'So erstellst du deinen Schlüssel',
    help_penny_step1:'Öffne Google AI Studio (aistudio.google.com/apikey) und melde dich mit einem Google-Konto an.',
    help_penny_step2:'Klicke auf „API-Schlüssel erstellen“ (wähle „Schlüssel in neuem Projekt erstellen“, falls du noch keins hast).',
    help_penny_step3:'Kopiere den erzeugten Schlüssel (er beginnt mit AIza…).',
    help_penny_step4:'Füge ihn in das Feld „Gemini API-Schlüssel“ in den Einstellungen von Evo Budget ein und klicke auf „Schlüssel speichern“.',
    help_penny_cost_h:'Ist das kostenlos?',
    help_penny_cost_p:'Die Gemini-API hat eine kostenlose Stufe mit Limits, die von Google festgelegt werden und sich ändern können. Aktuelle Limits findest du jederzeit auf aistudio.google.com. Der Zähler „gestellte Fragen” in den Einstellungen ist ein persönlicher Zähler auf deinem eigenen Gerät zu deiner Information. Er zeigt nicht dein tatsächliches Google-Kontingent an.',
    help_penny_safety_h:'Ist mein Schlüssel sicher?',
    help_penny_safety_p:'Dein Schlüssel wird verschlüsselt, bevor er im Speicher deines eigenen Browsers gespeichert wird, und wird nur direkt an die API von Google gesendet, wenn du Penny eine Frage stellst. Er geht niemals an einen Server von Evo Budget.',
    help_penny_cta:'Google AI Studio öffnen →',
    help_dash_alloc_setup_p:'Öffne Einstellungen \u2192 Ausgabenaufteilung. Bearbeite Kategorienamen, passe Prozentsätze an und aktiviere oder deaktiviere das Panel. Prozentsätze müssen 100% ergeben.',
    // Guide
    guide_group_start:'Erste Schritte', guide_group_track:'Deine Finanzen im Blick', guide_group_plan:'Größer planen',
    guide_group_smart:'Schlauer wirtschaften', guide_group_settings:'Ganz nach deinen Wünschen',
    guide_section_big:'Worum es geht', guide_section_how:'So funktioniert’s', guide_section_connects:'Die Zusammenhänge', guide_back:'Zurück zur Übersicht',
    guide_welcome_title:'Willkommen bei Ultimate Budget Planner',
    guide_welcome_big:'Ultimate Budget Planner nimmt die einfache Idee, Einnahmen und Ausgaben zu verfolgen, und verleiht ihr Superkräfte - einen echten Tilgungsplan für Schulden, Sparziele mit Fortschrittsbalken, einen Kalender mit Rundumblick, eine Abo-Übersicht und Penny, eine KI-Assistentin, die deine Zahlen schon kennt. Starte mit dem Dashboard und erkunde den Rest, wann immer du bereit bist.',
    guide_dashboard_title:'Dashboard',
    guide_dashboard_big:'Das Dashboard ist deine Kommandozentrale - alles Wichtige rund um dein Geld findet sich auf diesem einen Bildschirm, vom Endergebnis bis zu dem, was diese Woche ansteht.',
    guide_dashboard_step1:'Wirf einen Blick auf die Übersichtskarten oben für dein <strong>Gesamteinkommen</strong>, deine <strong>Gesamtausgaben</strong>, deine <strong>Sparquote</strong> und deinen <strong>Nettoüberschuss</strong>.',
    guide_dashboard_step2:'Schau in die Liste <strong>Demnächst</strong>, um alles zu sehen, was in den nächsten 7 Tagen fällig wird - Rechnungen, Schuldenzahlungen und Abos an einem Ort.',
    guide_dashboard_step3:'Prüfe deine Übersichten zu <strong>Schuldentilgung</strong> und <strong>Rücklagen</strong>, um den Fortschritt bei deinen größeren Zielen auf einen Blick zu sehen.',
    guide_dashboard_connect1:'Jede Zahl hier stammt live aus Transaktionen, Budget, Schuldentilgung, Rücklagen und Abos - es gibt nichts von Hand zu berechnen.',
    guide_dashboard_connect2:'Der Nettoüberschuss enthält deine <strong>Übertrag</strong>-Einstellung, sodass nicht ausgegebenes Geld aus der letzten Periode automatisch übertragen werden kann.',
    guide_dashboard_connect3:'Wenn etwas nicht stimmt, lohnt sich fast immer ein Blick auf die Seite, von der die Zahl stammt - das Dashboard ist ein Spiegel, keine Quelle.',
    guide_dashboard_tip:'Nimm dir jeden Morgen 30 Sekunden Zeit für einen Blick aufs Dashboard - so entdeckst du eine Rechnung oder Schuldenzahlung, bevor sie überfällig wird.',
    guide_transactions_title:'Transaktionen',
    guide_transactions_big:'Transaktionen sind das Fundament für alles in dieser App - jeder Euro, den du hier einträgst, treibt dein Dashboard, dein Budget und jedes Diagramm an, das du siehst. Ultimate Budget Planner lässt dich zudem die sich wiederholenden Teile automatisieren, damit du nicht jede Periode dasselbe eintragen musst.',
    guide_transactions_step1:'Tippe auf <strong>Transaktion hinzufügen</strong>, wähle Art und Kategorie und trage den Betrag ein.',
    guide_transactions_step2:'Richte eine <strong>wiederkehrende Regel</strong> für alles ein, was sich wiederholt, etwa Miete oder Gehalt, damit es automatisch gebucht wird, statt dass du es jedes Mal eintippst.',
    guide_transactions_step3:'Nutze <strong>CSV importieren</strong>, um vorhandene Ausgabendaten auf einmal einzuspielen, statt sie von Hand einzutragen.',
    guide_transactions_step4:'Tippe auf eine Transaktion, um sie zu bearbeiten, oder nutze die Filter über der Liste, um schnell etwas zu finden.',
    guide_transactions_connect1:'Wiederkehrende Regeln, die du hier einrichtest, treiben die Funktion <strong>Automatisierung</strong> an - sobald eine Regel existiert, bucht sie planmäßig weiter, ohne dass du etwas tun musst.',
    guide_transactions_connect2:'Jede Transaktion zählt automatisch zur passenden Kategorie in Budget, Schuldentilgung oder Abos.',
    guide_transactions_connect3:'Deine Dashboard-Summen und -Diagramme basieren vollständig auf dem, was hier eingetragen wird.',
    guide_transactions_tip:'Richte zuerst wiederkehrende Regeln für deine regelmäßigen Rechnungen und dein Gehalt ein - das ist der größte Zeitspar-Trick der ganzen App.',
    guide_budget_title:'Budget',
    guide_budget_big:'Beim Budget legst du deine Ziele fest - wie viel du bei Einnahmen, Ausgaben, Rechnungen und Ersparnissen erwartest - alles auf einem Bildschirm, statt zwischen einzelnen Tabs zu wechseln.',
    guide_budget_step1:'Füge eine Kategorie unter <strong>Einnahmen</strong>, <strong>Ausgaben</strong>, <strong>Rechnungen</strong> oder <strong>Ersparnisse</strong> hinzu und lege den <strong>erwarteten</strong> Betrag fest.',
    guide_budget_step2:'Während du Transaktionen einträgst, beobachte, wie sich die Spalte <strong>Tatsächlich</strong> für jede Kategorie automatisch füllt.',
    guide_budget_step3:'Vergleiche Erwartet mit Tatsächlich, um zu sehen, welche Kategorien im Plan liegen und welche Aufmerksamkeit brauchen.',
    guide_budget_step4:'Passe jeden erwarteten Betrag an, wenn sich dein Leben ändert - dein Budget sollte sich dir anpassen, nicht umgekehrt.',
    guide_budget_connect1:'Jede Transaktion, die du bei Transaktionen einträgst, fließt direkt in die passende Kategorie hier ein.',
    guide_budget_connect2:'Dein Ausgabenverteilung-Diagramm und dein Nettoüberschuss im Dashboard basieren beide auf diesen Kategorien.',
    guide_budget_connect3:'Wenn du <strong>Budget-Buckets</strong> in den Einstellungen aktiviert hast, siehst du hier auch, wie deine Ausgaben zu diesen prozentualen Zielen passen.',
    guide_budget_tip:'Überprüfe deine erwarteten Beträge einmal im Monat - ein Budget, das sich nie ändert, spiegelt die Realität ziemlich schnell nicht mehr wider.',
    guide_debt_title:'Schuldentilgungsrechner',
    guide_debt_big:'Das ist mehr als eine Liste dessen, was du schuldest - hier bekommst du einen echten Plan, um schuldenfrei zu werden, mit genauer Angabe, welche Schuld du zuerst angehen solltest und wie viel Zinsen du dabei sparst.',
    guide_debt_step1:'Füge jede Schuld mit ihrem <strong>Saldo</strong>, ihrem <strong>Zinssatz</strong> und ihrer <strong>Mindestzahlung</strong> hinzu.',
    guide_debt_step2:'Wähle eine Strategie: <strong>Schneeball</strong> (erst den kleinsten Saldo tilgen für schnelle Erfolge) oder <strong>Lawine</strong> (erst den höchsten Zinssatz tilgen, um am meisten zu sparen).',
    guide_debt_step3:'Füge jeden zusätzlichen Betrag hinzu, den du pro Periode für Schulden aufbringen kannst - der Rechner wendet ihn auf die Schuld an, die deine Strategie zuerst anvisiert.',
    guide_debt_step4:'Prüfe dein voraussichtliches <strong>schuldenfreies Datum</strong> und die Gesamtzinsen, um zu sehen, wie zusätzliche Zahlungen das Bild verändern.',
    guide_debt_step5:'Lege bei Hypotheken und Krediten eine <strong>Laufzeit</strong> fest und klicke auf <strong>Automatisch berechnen</strong> für eine genaue Mindestrate. Wechsle bei Kreditkarten zu <strong>% vom Saldo</strong>, damit es deiner echten Abrechnung entspricht.',
    guide_debt_step6:'Manche Kredite verwenden <strong>fallende Raten</strong> statt gleichbleibender Raten - der Tilgungsanteil bleibt fest und die Gesamtrate sinkt mit der Zeit. Prüfe die <strong>Rückzahlungsart</strong>, damit sie zu deinem Kredit passt.',
    guide_debt_step7:'Wechsle bei einem variablen Kredit die <strong>Zinsart</strong> zu "Passt sich nach einer festen Periode an" und lege fest, wann sie sich ändert. Für eine Hypotheken-Treuhand, die mit der Zeit sinkt, wechsle die <strong>Treuhandart</strong> zu "Fallend mit dem Saldo".',
    guide_debt_step8:'Klicke auf das <strong>ℹ️-Info-Symbol</strong> bei einer Schuld, um ihren vollständigen monatlichen Zahlungsplan zu sehen. Nutze die Spalte <strong>Extra/Monat</strong>, um zusätzliche Zahlungen gezielt auf eine bestimmte Schuld zu richten, unabhängig von deiner Schneeball-/Lawinen-Reihenfolge.',
    guide_debt_connect1:'Schuldenzahlungen, die du bei Transaktionen einträgst, zählen hier zum Saldo jeder Schuld.',
    guide_debt_connect2:'Dein Dashboard zeigt eine Momentaufnahme dieses Tilgungsplans, damit du immer weißt, wo du stehst, ohne diese Seite zu öffnen.',
    guide_debt_connect3:'Mehr als die Mindestzahlung zu leisten - selbst ein wenig mehr - ist meist der größte Hebel, um deine Tilgungszeit zu verkürzen.',
    guide_debt_tip:'Wechsle testweise zwischen Schneeball und Lawine - Schneeball motiviert anfangs mehr, Lawine spart insgesamt meist mehr Geld.',
    guide_sinking_title:'Rücklagen',
    guide_sinking_big:'Eine Rücklage ist Geld, das du Stück für Stück für etwas Bestimmtes zurücklegst, von dem du weißt, dass es kommt - einen Urlaub, einen neuen Laptop, Geschenke -, damit es nie zum Notfall wird, wenn die Rechnung tatsächlich eintrifft.',
    guide_sinking_step1:'Erstelle eine Rücklage und gib ihr einen <strong>Zielbetrag</strong> und, wenn du magst, ein Zieldatum.',
    guide_sinking_step2:'Trage Einzahlungen ein, sobald du Geld dafür zurücklegst, und beobachte, wie sich der <strong>Fortschrittsbalken</strong> füllt.',
    guide_sinking_step3:'Sobald eine Rücklage ihr Ziel erreicht, bist du für diese Ausgabe bereit, ohne dein reguläres Budget anzurühren.',
    guide_sinking_connect1:'Rücklagen sind von deiner regulären Ersparnisse-Kategorie getrennt - sie sind für konkrete, geplante Ziele gedacht statt für allgemeines Sparen.',
    guide_sinking_connect2:'Dein Dashboard zeigt eine Momentaufnahme des Fortschritts aller deiner Rücklagen an einem Ort.',
    guide_sinking_connect3:'Regelmäßig in eine Rücklage einzuzahlen, selbst ein kleiner Betrag, macht aus einer großen Ausgabe etwas, das dein Budget nie aus der Bahn wirft.',
    guide_sinking_tip:'Teile große Ziele in runde Monatsbeträge auf - es ist viel leichter, sich auf 50 € im Monat festzulegen, als "irgendwann für den Urlaub zu sparen."',
    guide_subscriptions_title:'Abos',
    guide_subscriptions_big:'Abos häufen sich gerne still und leise an - diese Seite listet jeden wiederkehrenden Dienst, den du bezahlst, an einem Ort, damit nichts unbemerkt weiter abgebucht wird.',
    guide_subscriptions_step1:'Füge jedes Abo mit seinen Kosten und seinem Abrechnungsintervall (monatlich, jährlich usw.) hinzu.',
    guide_subscriptions_step2:'Prüfe die Summe der <strong>monatlichen Kosten</strong>, um zu sehen, was all deine Abos zusammen ausmachen.',
    guide_subscriptions_step3:'Pausiere oder kündige alles, was du nicht nutzt, direkt von dieser Seite aus.',
    guide_subscriptions_connect1:'Deine gesamten Abo-Kosten fließen direkt in deine Dashboard-Übersicht und deine Gesamtausgaben ein.',
    guide_subscriptions_connect2:'Abo-Fälligkeiten erscheinen auch im Kalender, sodass du sie zusammen mit Rechnungen und Schuldenzahlungen sehen kannst.',
    guide_subscriptions_connect3:'Diese Liste alle paar Monate zu überprüfen, ist einer der einfachsten Wege, Geld zu finden, von dem du nicht wusstest, dass du es verlierst.',
    guide_subscriptions_tip:'Mach die Abo-Überprüfung direkt nach deinem Kontoauszug jeden Monat - das ist der einfachste Zeitpunkt, um etwas zu entdecken, das du vergessen hattest zu bezahlen.',
    guide_calendar_title:'Kalender',
    guide_calendar_big:'Der Kalender bringt jede Rechnung, Schuldenzahlung, jedes Abo und jede Transaktion in eine Monatsansicht, damit du alles rund um dein Geld auf einen Blick siehst, statt fünf verschiedene Seiten zu prüfen.',
    guide_calendar_step1:'Blättere zu einem beliebigen Monat, um farbcodierte Punkte für fällige Rechnungen, Schuldenzahlungen und Abos zu sehen.',
    guide_calendar_step2:'Tippe auf einen Tag, um die vollständige Liste von allem zu sehen, was an diesem Tag ansteht.',
    guide_calendar_step3:'Nutze diese Ansicht vor einem größeren Kauf, um zu sehen, was sonst noch im selben Zeitraum fällig ist.',
    guide_calendar_connect1:'Alles hier stammt aus Rechnungen, Schuldentilgung, Abos und Transaktionen - der Kalender speichert keine eigenen Daten.',
    guide_calendar_connect2:'Es ist der schnellste Weg, eine Woche zu erkennen, in der mehrere Fälligkeiten eng beieinanderliegen, bevor sie dich überrascht.',
    guide_calendar_connect3:'Nichts, was du im Kalender tust, verändert dein Budget - er ist reine Ansicht, also völlig gefahrlos zu durchstöbern.',
    guide_calendar_tip:'Wirf zu Beginn jeder Woche einen Blick in den Kalender - es dauert Sekunden und Fälligkeiten sind nie mehr eine Überraschung.',
    guide_rollover_title:'Übertrag',
    guide_rollover_big:'Übertrag bedeutet, dass nicht ausgegebenes Geld aus der letzten Periode nicht einfach verschwindet - es wird automatisch übertragen und zu dem hinzugefügt, was dir in dieser Periode zur Verfügung steht.',
    guide_rollover_step1:'Öffne die <strong>Einstellungen</strong> und finde die Karte <strong>Übertrag</strong>.',
    guide_rollover_step2:'Schalte ihn ein, damit jeder Restbetrag aus der vorherigen Periode automatisch in die neue übertragen wird.',
    guide_rollover_step3:'Prüfe den Nettoüberschuss auf deinem Dashboard - er enthält jetzt diesen übertragenen Betrag.',
    guide_rollover_connect1:'Übertrag arbeitet direkt mit deinem Nettoüberschuss aus der vorherigen Periode - je besser du dein Budget einhältst, desto mehr hat er zu übertragen.',
    guide_rollover_connect2:'Das unterscheidet sich von Rücklagen, die für geplante zukünftige Ziele gedacht sind - beim Übertrag geht es nur darum, Geld, das du bereits hast, nicht aus den Augen zu verlieren.',
    guide_rollover_connect3:'Eine Reihe guter Monate summiert sich hier schön auf, da der Überschuss jeder Periode zur nächsten hinzukommt.',
    guide_rollover_tip:'Wenn ein großer Übertrag-Betrag in der Tasche brennt, überlege, einen Teil davon in eine Rücklage zu verschieben, damit er für etwas Bestimmtes reserviert ist.',
    guide_automation_title:'Automatisierung',
    guide_automation_big:'Automatisierung nimmt die wiederkehrenden Regeln, die du bei Transaktionen eingerichtet hast, und bucht sie automatisch für dich, damit deine regelmäßigen Rechnungen, Gehälter und Abos genau planmäßig erscheinen, ohne dass du etwas tun musst.',
    guide_automation_step1:'Öffne die <strong>Einstellungen</strong> und finde die Karte <strong>Automatisierung</strong>.',
    guide_automation_step2:'Schalte sie ein, damit wiederkehrende Transaktionsregeln automatisch gebucht werden, sobald sie fällig sind.',
    guide_automation_step3:'Prüfe danach die Transaktionen, um zu bestätigen, dass alles wie erwartet gebucht wurde.',
    guide_automation_connect1:'Diese Funktion arbeitet nur mit wiederkehrenden Regeln, die du bereits bei Transaktionen erstellt hast - richte diese zuerst ein.',
    guide_automation_connect2:'Jede damit gebuchte Transaktion fließt genau wie eine von Hand eingetragene in Budget, Schuldentilgung und Abos ein.',
    guide_automation_connect3:'Es ist der Unterschied zwischen einer Budget-App, an die du dich zum Aktualisieren erinnern musst, und einer, die sich selbst auf dem Laufenden hält.',
    guide_automation_tip:'Schalte die Automatisierung ein, sobald sich deine wiederkehrenden Regeln korrekt anfühlen - sie ist am nützlichsten, sobald du den Zahlen vertraust, die sie bucht.',
    guide_penny_title:'Penny',
    guide_penny_big:'Penny ist deine eigene KI-Budget-Assistentin, direkt in die App eingebaut - stell ihr eine Frage zu deinem Geld in normaler Sprache, und sie liest deine echten Budgetdaten, um dir eine echte Antwort zu geben, bei Bedarf mit Diagrammen.',
    guide_penny_step1:'Öffne die <strong>Einstellungen</strong>, aktiviere Penny und füge deinen eigenen Gemini-API-Schlüssel ein (dort findest du auch einen Link, der genau zeigt, wie du einen kostenlos bekommst).',
    guide_penny_step2:'Tippe auf das Funkeln-Symbol in der oberen Navigation, um den Chat zu öffnen.',
    guide_penny_step3:'Stell eine Frage in deinen eigenen Worten, etwa "Was ist meine größte Ausgabenkategorie diesen Monat?", oder tippe auf eine der Schnellfragen-Schaltflächen, um loszulegen.',
    guide_penny_step4:'Schalte ihre Sprachantwort über das Lautsprecher-Symbol ein oder aus, wenn du lieber zuhören statt lesen möchtest.',
    guide_penny_connect1:'Penny kann deine Budgetdaten nur lesen, um Fragen zu beantworten - sie kann nie etwas für dich hinzufügen, ändern oder löschen.',
    guide_penny_connect2:'Sie greift direkt auf Dashboard, Transaktionen, Schuldentilgung, Abos und Rücklagen zu, sodass ihre Antworten immer dem entsprechen, was du auf diesen Seiten selbst sehen würdest.',
    guide_penny_connect3:'Dein API-Schlüssel wird verschlüsselt und nur auf deinem eigenen Gerät gespeichert - er wird nirgendwohin gesendet außer direkt an Google, wenn du Penny eine Frage stellst.',
    guide_penny_tip:'Starte beim ersten Mal mit einer der Schnellfragen-Schaltflächen - so siehst du am schnellsten, was sie kann, bevor du eigene Fragen stellst.',
    guide_settings_title:'Einstellungen',
    guide_settings_big:'In den Einstellungen passt sich die App an dich an - Währung, Budgetzeitraum, Übertrag, Automatisierung, Erscheinungsbild, Sprache und wie deine Daten gespeichert und gesichert werden.',
    guide_settings_step1:'Wähle deine <strong>Währung</strong> und deinen <strong>Budgetzeitraum</strong>, damit die App zu deinem tatsächlichen Zahlungs- und Ausgabenrhythmus passt.',
    guide_settings_step2:'Schalte <strong>Übertrag</strong> und <strong>Automatisierung</strong> ein, wenn nicht ausgegebenes Geld und wiederkehrende Transaktionen automatisch für dich erledigt werden sollen.',
    guide_settings_step3:'Wechsle das <strong>Erscheinungsbild</strong> zwischen Hell und Dunkel und wähle deine <strong>Sprache</strong> aus der Liste.',
    guide_settings_step4:'Richte <strong>Budget-Buckets</strong> ein, wenn du lieber prozentual budgetieren möchtest (etwa 50 % Bedürfnisse, 30 % Wünsche, 20 % Sparen) statt mit festen Kategoriebeträgen.',
    guide_settings_step5:'Wähle unter <strong>Daten & Sync</strong>, wie deine Daten gespeichert werden - lokal auf diesem Gerät oder mit Google Drive synchronisiert, sodass sie dir auf andere Geräte folgen.',
    guide_settings_step6:'Nutze <strong>Daten exportieren</strong>, um alles zu sichern, oder <strong>Daten zurücksetzen</strong>, wenn du jemals ganz neu anfangen möchtest.',
    guide_settings_connect1:'Deine Wahl bei Währung, Budgetzeitraum, Übertrag und Automatisierung bestimmt, wie jede andere Seite in der App Zahlen berechnet und anzeigt.',
    guide_settings_connect2:'Google-Sync hier zu aktivieren, sorgt dafür, dass deine Daten dir folgen, wenn du die App auf einem anderen Gerät öffnest.',
    guide_settings_connect3:'Deine Daten hier zu exportieren, ist die sicherste Gewohnheit, bevor du eine größere Änderung vornimmst, bei der du dir unsicher bist.',
    guide_settings_tip:'Richte zuerst Währung, Budgetzeitraum und Daten & Sync ein, bevor du etwas anderes tust - sie sind das Fundament, auf dem alles andere in der App aufbaut.',
  },
  fr: {
    lang_name:'Français',
    tab_dashboard:'Tableau de bord',tab_budget:'Budget',tab_transactions:'Transactions',
    tab_income:'Revenus',tab_expenses:'Dépenses',tab_bills:'Factures',
    tab_debt:'Dettes',tab_savings:'Épargne',tab_settings:'Paramètres',
    tab_debt_payoff:'Remboursement',tab_sinking:'Provisions',
    tab_calendar:'Calendrier',tab_subscriptions:'Abonnements',
    total_income:'Revenus totaux',expenses_bills:'Dépenses & Factures',
    debt_payments:'Remboursements',total_savings:'Épargne totale',
    total_outgoing:'Sorties totales',savings_rate:"Taux d'épargne",
    net_leftover:'Solde net',cash_flow:'Flux de trésorerie',
    income_sources:'Sources de revenus',spending_breakdown:'Répartition des dépenses',
    expected:'Prévu',actual:'Réel',
    of:'sur',budgeted:'budgété',saved:'épargné',
    budget_period:'Période budgétaire',start_date:'Date de début',end_date:'Date de fin',
    this_month:'Ce mois',this_week:'Cette semaine',last_week:'Semaine pr\u00e9c.',last_month:'Mois pr\u00e9c.',last_30_days:'30 derniers jours',this_quarter:'Ce trimestre',this_year:'Cette ann\u00e9e',
    currency:'Devise',rollover:'Report',appearance:'Apparence',
    language:'Langue',reset_data:'Réinitialiser les données',
    light:'Clair',dark:'Sombre',
    changes_autosaved:'✅ Les modifications sont enregistrées automatiquement.',
    rollover_desc:"Reporte l'argent non dépensé de la période précédente.",
    rollover_amount:'Montant du report',
    reset_desc:'Supprime définitivement toutes vos données. Irréversible.',
    reset_btn:'Tout réinitialiser',
    add:'Ajouter',cancel:'Annuler',rename_title_prompt:'Renommer votre planificateur de budget',save:'Enregistrer',delete:'Supprimer',dp_today:"Aujourd'hui",dp_clear:'Effacer',edit:'Modifier',
    paid:'Payé',due_date:"Date d'échéance",category:'Catégorie',amount:'Montant',
    description:'Description',date:'Date',type:'Type',
    add_category:'+ Ajouter une catégorie',no_transactions:'Aucune transaction.',
    upgrade_title:"Prêt pour l'expérience pro ?",
    upgrade_desc:'Débloquez le calculateur de remboursement, les provisions, le calendrier intelligent et le suivi des abonnements.',
    upgrade_now:'Mettre à niveau →',
    mon:'Lun',tue:'Mar',wed:'Mer',thu:'Jeu',fri:'Ven',sat:'Sam',sun:'Dim',
    quick_presets:'Raccourcis :',select_currency:'Sélectionnez votre devise',select_language:'Sélectionner la langue',
    appearance_desc:'Basculer entre le mode clair et sombre.',video_tutorial:'▶ Tutoriel vidéo',
    help_sett_intro:'Toutes vos préférences pour Ultimate Budget Planner. Les modifications sont enregistrées automatiquement à mesure que vous les effectuez.',
    help_sett_currency_p:"Change le symbole de devise partout dans l'application dès la sélection.",
    help_sett_appearance_p:'Basculer entre le mode clair et sombre. Votre préférence est mémorisée entre les sessions.',
    help_sett_nav_h:'Navigation',
    help_sett_nav_top:"Navigation supérieure - Barre d'onglets horizontale classique en haut (par défaut).",
    help_sett_nav_side:"Navigation latérale - Une barre d'icônes flottante à gauche de votre contenu. Cliquez sur la flèche pour développer et voir les libellés complets.",
    help_sett_period_p:'La plage de dates définit « ce budget ». Seules les transactions dans cette plage comptent dans vos réels. Utilisez les 7 préréglages (Ce mois, Mois préc., Cette semaine, Semaine préc., 30 derniers jours, Ce trimestre, Cette année) pour une configuration rapide.',
    help_sett_rollover_p:"Tout argent non dépensé que vous souhaitez reporter de la période précédente. Il est ajouté à votre solde net sur le tableau de bord.",
    cal_title:'Calendrier intelligent',
    cal_desc:"Toutes vos factures, remboursements, abonnements et transactions en un seul calendrier en direct. Cliquez sur n'importe quel jour pour voir ses événements.",
    cal_prev:'← Préc.',cal_next:'Suiv. →',
    cal_all_events:'Tous les événements - ',
    cal_no_events_day:'Aucun événement ce jour-là.',
    cal_no_events_month:'Aucun événement ce mois-ci.',
    cal_no_events_sub:'Ajoutez des factures, dettes ou abonnements pour les voir ici.',
    cal_event_one:'événement',cal_event_many:'événements',cal_clear:'Effacer ×',
    cal_leg_bill:'Facture',cal_leg_debt:'Dette',cal_leg_sub:'Abonnement',cal_leg_tx:'Transaction',cal_leg_sinking:"Fonds d'épargne",cal_leg_goal:"Date d'objectif",cal_leg_auto:'Automatique',
    cal_paid:'✓ Payé',cal_unpaid:'Non payé',
    help_cal_intro:"Le Calendrier intelligent regroupe tous vos engagements financiers en une vue mensuelle - mis à jour automatiquement à mesure que vous ajoutez des données.",
    help_cal_ev_types_h:"Types d'événements",
    help_cal_bill_li:"Factures - depuis votre section Factures (récurrent mensuellement le jour d'échéance défini)",
    help_cal_debt_li:"Remboursements - depuis votre section Remboursement de dettes (récurrent le jour d'échéance)",
    help_cal_sub_li:"Abonnements - depuis votre suivi d'abonnements (le jour de la prochaine date de facturation)",
    help_cal_tx_li:'Transactions - les dates auxquelles vous avez enregistré des revenus ou des dépenses',
    help_cal_nav_h:'Navigation',
    help_cal_nav_p:'Utilisez ← Préc. et Suiv. → pour naviguer entre les mois. Cliquez sur un jour pour voir ses événements. Cliquez de nouveau ou sur « Effacer × » pour désélectionner.',
    help_cal_tip:"💡 Définissez des dates d'échéance sur les factures et dettes pour profiter au maximum du calendrier.",
    sf_add_btn:'+ Ajouter un fonds',
    sf_desc:"Un fonds de prévision vous permet d'épargner progressivement pour une grande dépense future - sans mauvaises surprises. Fixez un objectif et une date, et nous vous dirons exactement combien épargner chaque mois.",
    sf_empty_title:'Aucun fonds de prévision pour le moment.',
    sf_empty_sub:'Idéal pour : vacances, réparations auto, mariages, nouvelles technologies, factures annuelles.',
    sf_pct_complete:'atteint',
    sf_save_prefix:'Épargner',sf_per_month:'/mois',
    sf_month_left_one:'mois restant',sf_month_left_many:'mois restants',
    sf_total_contrib:'Total des contributions mensuelles nécessaires :',
    sf_modal_new:'🏺 Nouveau fonds de prévision',sf_modal_edit:'✏️ Modifier le fonds',
    sf_fund_name_label:'Nom du fonds',sf_fund_name_ph:'ex. Fonds vacances',
    sf_icon_label:'Icône',sf_target_amount_label:'Montant cible',
    sf_currently_saved_label:'Déjà épargné',sf_target_date_label:'Date cible',
    sf_create_btn:'Créer le fonds',
    help_sf_intro:"Un fonds de prévision est de l'argent mis de côté à l'avance pour une grande dépense planifiée - sans mauvaises surprises à l'arrivée de la facture.",
    help_sf_how_to_h:"Comment l'utiliser",
    help_sf_step1:'Cliquez sur + Ajouter un fonds',
    help_sf_step2:"Nommez votre fonds (ex. \u00ab\u00a0Vacances d'\u00e9t\u00e9\u00a0\u00bb), choisissez une ic\u00f4ne",
    help_sf_step3:'Fixez un montant cible (combien vous avez besoin au total)',
    help_sf_step4:"Fixez une date cible (quand vous avez besoin de l'argent)",
    help_sf_step5:'Indiquez combien vous avez déjà épargné',
    help_sf_reading_h:'Lire la carte',
    help_sf_reading_p:'Chaque carte affiche votre épargne vs objectif, une barre de progression et exactement combien épargner par mois pour atteindre votre objectif à temps.',
    help_sf_contrib_h:'Ajouter des contributions',
    help_sf_contrib_p:"Cliquez sur l'icône + d'une carte pour enregistrer une contribution - entrez le montant que vous ajoutez ce mois-ci.",
    help_sf_tip:'💡 Idéal pour : vacances, réparations auto, assurances annuelles, mariages, électronique, travaux domestiques.',
    dpc_title:'Calculateur de remboursement',dpc_add_btn:'+ Ajouter une dette',
    dpc_desc:"Saisissez chaque dette, choisissez une stratégie de remboursement et voyez exactement quand vous serez libre de dettes et combien d'intérêts vous paierez au total.",
    dpc_method_label:'Méthode de remboursement',
    dpc_snowball_desc:"Solde le plus bas d'abord - les petites victoires vous gardent motivé",
    dpc_avalanche_desc:"Taux le plus élevé d'abord - économise le plus d'argent au total",
    dpc_extra_label:'Paiement mensuel supplémentaire',
    dpc_extra_hint:'Montant au-dessus de vos paiements minimums à consacrer aux dettes chaque mois.',
    dpc_empty_title:'Aucune dette ajoutée pour le moment.',
    dpc_empty_sub:'Cliquez sur « + Ajouter une dette » pour créer votre plan de remboursement.',
    dpc_th_name:'Dette',dpc_th_type:'Type',dpc_th_balance:'Solde',
    dpc_th_apr:'Taux %',dpc_th_min:'Paiement min.',dpc_th_due:"Jour d'éch.",
    dpc_totals:'Totaux',dpc_name_ph:'ex. Carte Visa',
    dpc_term_label:'Durée du prêt (années)',dpc_term_hint:'Définit la durée de ce prêt, afin que le calcul automatique puisse déterminer un paiement minimum précis.',
    dpc_autocalc_btn:'Calculer automatiquement',dpc_autocalc_done:'Calculé : {0}/mois',
    dpc_min_mode_label:'Type de paiement minimum',dpc_min_mode_fixed:'Montant fixe',dpc_min_mode_percent:'% du solde',
    dpc_min_percent_label:'Pourcentage du solde (%)',dpc_min_floor_label:'Montant plancher',
    dpc_min_calculated_hint:'Calculé automatiquement - le plus élevé entre le pourcentage et le montant plancher.',
    dpc_escrow_label:'Séquestre (taxes & assurance)',
    dpc_escrow_hint:"S'ajoute à votre coût mensuel réel, mais est exclu de la simulation de remboursement puisque cela ne réduit pas votre solde.",
    dpc_min_pct_caption:'{0}% du solde',dpc_escrow_note:'{0} séquestre',
    dpc_term_note_faster:'{0} mois plus rapide que votre durée de {1} ans',dpc_term_note_slower:'{0} mois plus lent que votre durée de {1} ans',
    dpc_term_note_onschedule:'exactement dans les temps pour votre durée de {0} ans',
    dpc_escrow_mode_label:'Type de séquestre',dpc_escrow_mode_fixed:'Montant fixe',dpc_escrow_mode_declining:'Dégressif avec le solde',
    dpc_escrow_mode_hint:"Cela n'affecte que l'échéancier ci-dessous. Votre montant automatisé et le total du tableau de bord utilisent toujours le montant de séquestre fixe actuel.",
    dpc_rate_type_label:'Type de taux',dpc_rate_type_fixed:'Fixe pour toute la durée',dpc_rate_type_arm:'Ajustable après une période fixe (taux variable)',
    dpc_rate_type_hint:"Un modèle simplifié : un taux pour la période fixe, puis un seul nouveau taux pour le reste du prêt - pas une simulation complète d'indice/plafond.",
    dpc_arm_fixed_years_label:'Période à taux fixe (années)',dpc_arm_rate_label:'Taux après ajustement',
    dpc_arm_caption:"s'ajuste après {0} ans de période fixe",
    dpc_recalc_link:'↺ Recalculer',
    dpc_th_extra:'Extra/mois',
    dpc_extra_col_hint:"Payé en plus du minimum de cette dette chaque mois, avant que le paiement supplémentaire partagé ci-dessus ne soit distribué. S'arrête une fois cette dette remboursée - il n'est pas redirigé ailleurs.",
    dpc_targeted_extra_note:'{0} extra ciblé',
    dpc_schedule_btn_title:"Voir l'échéancier de paiement",
    dpc_amort_type_label:'Type de remboursement',dpc_amort_equal_payment:'Mensualités égales',dpc_amort_equal_principal:'Mensualités dégressives (capital constant)',
    dpc_amort_type_hint:"Avec les mensualités égales, le paiement reste le même chaque mois. Avec les mensualités dégressives, la part de capital reste fixe, donc le paiement total diminue avec le temps à mesure que les intérêts baissent - courant pour certains prêts immobiliers.",
    dpc_autocalc_done_declining:'Première mensualité : {0}/mois (diminue chaque mois)',dpc_declining_caption:'mensualité dégressive',
    dtype_credit_card:'Carte de crédit',dtype_student_loan:'Prêt étudiant',
    dtype_mortgage:'Hypothèque',dtype_car_loan:'Prêt auto',
    dtype_personal_loan:'Prêt personnel',dtype_other:'Autre',
    dpc_debt_free_label:'🎯 Date sans dette',dpc_months_from_now:'mois à partir de maintenant',
    dpc_interest_label:'💸 Intérêts totaux',dpc_on_top:'en plus de',dpc_principal:'principal',
    dpc_monthly_label:'📅 Total mensuel',dpc_min_abbr:'min',dpc_extra_abbr:'suppl.',
    dpc_payoff_order_sf:"Ordre de remboursement - ⛄ Boule de neige (solde le plus bas d'abord)",
    dpc_payoff_order_av:"Ordre de remboursement - 🌊 Avalanche (taux le plus élevé d'abord)",
    dpc_paid_off:'Remboursé :',dpc_balance_word:'solde',dpc_apr_word:'taux',
    help_dpc_intro:"Ce calculateur établit un plan de remboursement personnalisé basé sur vos dettes et la stratégie choisie.",
    help_dpc_entries_h:'Vos entrées de dettes',
    help_dpc_balance_li:'Solde - Le montant que vous devez actuellement sur cette dette.',
    help_dpc_apr_li:"Taux % - Le taux d'intérêt annuel (trouvez-le sur votre relevé). Ex. 18,9 signifie 18,9%.",
    help_dpc_min_li:"Paiement min. - Le paiement mensuel minimum requis par le prêteur.",
    help_dpc_due_li:"Jour d'éch. - Le jour du mois où le paiement est dû (affiché dans le Calendrier intelligent).",
    help_dpc_strategies_h:'Stratégies de remboursement',
    help_dpc_snowball_li:"\u26c4 Boule de neige - Remboursez les dettes du solde le plus bas d'abord. Une fois soldée, reportez ce paiement sur la suivante. Idéal pour la motivation.",
    help_dpc_avalanche_li:"\uD83C\uDF0A Avalanche - Remboursez les dettes du taux le plus élevé d'abord. Économise le plus d'argent au total.",
    help_dpc_extra_h:'Paiement mensuel supplémentaire',
    help_dpc_extra_p:"Tout surplus au-dessus de vos minimums peut être consacré aux dettes. Même un petit paiement supplémentaire peut économiser des centaines d'intérêts et réduire les délais. Les résultats se mettent à jour en temps réel.",
    help_dpc_term_li:"Durée du prêt - Pour les prêts hypothécaires, étudiants, auto et personnels, définissez la durée en années et cliquez sur Calculer automatiquement pour obtenir un paiement minimum précis.",
    help_dpc_percent_li:'Paiement minimum en pourcentage - Pour les cartes de crédit, passez à "% du solde" pour correspondre au fonctionnement réel du paiement minimum de votre relevé (ex. 2% du solde ou 25 $, le plus élevé des deux).',
    help_dpc_escrow_li:"Séquestre - Pour les prêts hypothécaires, ajoutez vos taxes et assurances mensuelles afin que votre coût mensuel réel soit exact partout ; il est exclu de la projection de remboursement puisqu'il ne réduit pas votre solde.",
    help_dpc_amort_li:"Type de remboursement - Avec les mensualités égales, votre paiement reste le même chaque mois. Avec les mensualités dégressives (capital constant), le montant affecté au capital reste fixe, donc votre mensualité totale diminue avec le temps ; vérifiez vos documents de prêt pour savoir lequel s'applique à vous.",
    help_dpc_escrow_mode_li:"Type de séquestre - choisissez \"Dégressif avec le solde\" si votre séquestre diminue avec le solde de votre prêt, comme certaines primes d'assurance dégressives ; vous pouvez le voir diminuer dans l'échéancier.",
    help_dpc_rate_type_li:'Type de taux - choisissez "Ajustable après une période fixe" pour un taux variable, puis définissez le nombre d\'années à taux fixe et le nouveau taux ensuite.',
    help_dpc_extra_targeted_li:"Extra/mois (par dette) - un montant optionnel payé uniquement pour cette dette chaque mois, en plus de son minimum, indépendamment de votre ordre boule de neige/avalanche.",
    dsched_col_date:'Date',dsched_col_payment:'Paiement',dsched_col_principal:'Capital',dsched_col_interest:'Intérêts',dsched_col_escrow:'Séquestre',dsched_col_balance:'Solde',
    dsched_never_payoff_warning:"À ce rythme, cette dette ne sera pas entièrement remboursée avant 50 ans - le paiement dépasse à peine les intérêts. Envisagez un minimum plus élevé, un plancher en pourcentage plus élevé, ou un paiement supplémentaire.",
    help_dpc_tip:"\uD83D\uDCA1 Basculez entre les méthodes pour voir combien d'intérêts vous économiseriez avec chaque approche.",
    tx_import_csv:'\uD83D\uDCE5 Importer CSV',
    tx_add_title:'Ajouter une transaction',
    tx_date:'Date',tx_type:'Type',tx_category:'Catégorie',tx_amount:'Montant',
    tx_desc_label:'Description',tx_desc_ph:'ex. Courses\u2026',
    tx_add_btn:'Ajouter',tx_error_required:'Veuillez remplir tous les champs obligatoires.',
    tx_transaction_one:'transaction',tx_transaction_many:'transactions',
    tx_clear_all:'Tout effacer',tx_empty:'Aucune transaction encore.',
    tx_type_income:'Revenu',tx_type_expense:'Dépense',tx_type_bill:'Facture',tx_type_savings:'Épargne',
    tx_th_amount:'Montant',tx_th_desc:'Description',
    tx_edit_title:'\u270F\uFE0F Modifier la transaction',tx_save_changes:'Enregistrer les modifications',
    help_tx_intro:"Chaque mouvement d'argent va ici. Vos montants réels du budget et le tableau de bord se mettent à jour automatiquement à chaque ajout.",
    help_tx_adding_h:'Ajouter une transaction',
    help_tx_step1:'Choisissez une Date - cliquez sur le champ de date pour ouvrir le calendrier',
    help_tx_step2:'Choisissez un type : Revenu, Dépense, Facture, Épargne, Dette, Abonnement ou Fonds projet',
    help_tx_step3:"Sélectionnez la Catégorie correspondante (configurée dans l'onglet Budget)",
    help_tx_step4:'Entrez le Montant et une description optionnelle',
    help_tx_step5:'Cliquez sur Ajouter',
    help_tx_edit_h:'Modification & suppression',
    help_tx_edit_p:'Cliquez sur \u270F\uFE0F pour modifier une transaction, ou \u00d7 pour la supprimer. Pour tout effacer, utilisez « Tout effacer ».',help_tx_auto_h:'Transactions automatiques',help_tx_auto_p:"Créez une règle pour tout ce qui se répète (loyer, salaire) et choisissez la fréquence. L'app l'ajoute automatiquement à votre liste à chaque échéance. Utilisez l'interrupteur pour mettre en pause, ou le crayon pour modifier.",
    help_tx_csv_h:'Import CSV',
    help_tx_csv_p1:"Importez un export de tableur au format : Date,Type,Category,Amount,Description (ligne d'en-tête requise).",
    help_tx_csv_p2:'Les dates doivent être au format YYYY-MM-DD. Type doit être : income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_section_income:'Revenus',bud_section_expenses:'Dépenses',
    bud_section_bills:'Factures',bud_section_savings:'Épargne',
    bud_th_category:'Catégorie',bud_th_expected:'Prévu',
    bud_th_actual:'Réel',bud_th_progress:'Progression',
    bud_th_due_date:"Date d'éch.",bud_th_paid:'Payé',
    bud_total:'Total',bud_set_date:'Définir date',
    bud_add_btn:'+ Ajouter',bud_add_cat_title:'Ajouter une catégorie',
    bud_cat_name_label:'Nom de la catégorie',bud_cat_name_ph:'ex. Freelance',
    bud_add_cat_btn:'Ajouter',bud_due_date_label:"Date d'échéance",
    help_bud_intro:"L'onglet Budget est l'endroit où vous planifiez votre argent. Définissez des montants prévus pour chaque catégorie - les montants réels se remplissent automatiquement depuis vos Transactions.",
    help_bud_how_h:'Comment ça marche',
    help_bud_step1:'Cliquez sur un champ Prévu et saisissez votre montant budgétaire',
    help_bud_step2:"Enregistrez les transactions dans l'onglet Transactions",
    help_bud_step3:'La colonne Réel et les barres de progression se mettent à jour automatiquement',
    help_bud_colours_h:'Couleurs des barres de progression',
    help_bud_col_green:"Vert - revenus égaux ou supérieurs à l'objectif",
    help_bud_col_indigo:'Indigo - dépense dans le budget',
    help_bud_col_red:'Rouge - dépense dépassant le budget',
    help_bud_bills_h:'Section Factures',
    help_bud_bills_p:"Les factures ont une Date d'échéance (cliquez pour ouvrir le sélecteur de date) et une case Payé. Ces dates apparaissent aussi dans le Calendrier intelligent.",
    help_bud_tip:'\uD83D\uDCA1 Utilisez « + Ajouter une catégorie » pour créer des catégories personnalisées pour chaque section.',
    dash_total_income:'Revenus totaux',dash_of:'de',dash_expected_sfx:'prévu',
    dash_total_outgoing:'Dépenses totales',dash_budgeted_sfx:'budgété',
    dash_savings_rate:"Taux d'épargne",dash_saved_sfx:'épargné',
    dash_subscriptions:'Abonnements',dash_per_year:'/an',
    dash_net_leftover:'Solde net de la période',
    dash_in_sfx:'perçu',dash_out_sfx:'dépensé',
    dash_includes:'Dont',dash_rollover_sfx:'report',
    dash_cash_flow:'Flux de trésorerie',
    dash_expected_legend:'Prévu',dash_actual_legend:'Réel',
    dash_income_sources:'Sources de revenus',dash_no_income:'Aucun revenu enregistré.',
    dash_spending_breakdown:'Détail des dépenses',dash_no_spending:'Aucune dépense enregistrée.',
    dash_no_debts:'Aucune dette ajoutée.',dash_set_up:'Configurer \u2192',
    dash_debt_free_label:'Sans dette',dash_interest_label:'Intérêts',
    dash_months_label:'Mois',dash_method_label:'Méthode',
    dash_set_balances:'Entrez les soldes pour voir les résultats.',
    dash_upcoming_7:'\uD83D\uDCC5 À venir (7 jours)',dash_nothing_scheduled:'Rien de planifié.',
    dash_no_sinking:'Aucun fonds de prévision.',dash_create_one:'En créer un \u2192',
    help_dash_intro:"Le tableau de bord vous donne un aperçu financier en temps réel. Tous les chiffres se mettent à jour automatiquement lorsque vous enregistrez des transactions.",
    help_dash_hero_h:'Statistiques principales',
    help_dash_hero_p:"Les quatre cartes en haut affichent vos totaux de période : Revenus totaux reçus, Dépenses totales (dépenses, factures, dettes & abonnements), Taux d’épargne (% du revenu épargné) et votre coût mensuel d’abonnement.",
    help_dash_leftover_h:'Solde net',
    help_dash_leftover_p:"Argent restant après toutes les dépenses et l'épargne. Vert = vous êtes en avance. Rouge = vous avez dépassé votre budget.",
    help_dash_cashflow_h:'Graphique des flux de trésorerie',
    help_dash_cashflow_p:'Chaque ligne montre le Prévu (barre grise) vs le Réel (barre colorée) pour les Revenus, Dépenses, Factures et Épargne. Une barre rouge signifie dépassement du budget.',
    help_dash_donut_h:'Graphiques en anneau',
    help_dash_donut_p:"Survolez ou appuyez sur un segment pour voir le libellé et le pourcentage. Ces graphiques montrent d'où vient votre argent et où il va.",
    help_dash_bottom_h:'Panneaux inférieurs',
    help_dash_bottom_p:'Aperçus rapides de votre remboursement de dettes, des factures/abonnements à venir dans les 30 prochains jours et de vos objectifs de fonds de prévision.',
    help_dash_tip:'\uD83D\uDCA1 Cliquez sur le badge de date en haut pour modifier votre période budgétaire.',
    tx_type_debt:'Dette',
    dash_debt_payments:'Dettes',
    dash_debts_paid:'dette remboursée cette période',dash_debts_paid_many:'dettes remboursées cette période',
    tx_type_subscription:'Abonnement',
    alloc_title:'Répartition budgétaire',
    alloc_desc:"Étiquetez vos dépenses en Besoin, Envie ou Épargne pour voir comment votre argent s'aligne sur votre répartition cible.",
    alloc_label:'Répartition',alloc_optional:'Étiqueter la dépense',
    alloc_target:'Cible',alloc_on_track:'Dans les clous',alloc_over:'Dépassé',alloc_under:'En dessous',
    alloc_enabled_label:'Activer la répartition budgétaire',
    alloc_name_ph:'Nom du segment',alloc_pct_label:'% du revenu',
    alloc_sum_ok:'\u2713 100%',alloc_sum_bad:'\u26a0 Doit totaliser 100%',
    alloc_based_on:'Basé sur',alloc_income_period:'revenus de cette période',
    alloc_untagged:'Non étiquetée',alloc_untagged_desc:'de dépenses pas encore étiquetées',
    alloc_def_need:'Besoin',alloc_def_want:'Envie',alloc_def_save:'Épargne',
    alloc_sett_title:'\uD83C\uDFAF Répartition des dépenses',
    alloc_nearing:'Proche',
    alloc_required:'La répartition est obligatoire pour les transactions de dépenses.',
    toast_tx_added:'Transaction ajout\u00e9e \u2713',toast_tx_updated:'Mis \u00e0 jour \u2713',toast_tx_deleted:'Supprim\u00e9',
    toast_period_updated:'P\u00e9riode mise \u00e0 jour \u2713',toast_period_error:'La date de fin doit \u00eatre apr\u00e8s la date de d\u00e9but',
    toast_currency_updated:'Devise mise \u00e0 jour \u2713',toast_imported:'{0} import\u00e9(s) \u2713',
    toast_fund_created:'Fonds cr\u00e9\u00e9 \u2713',toast_fund_updated:'Fonds mis \u00e0 jour \u2713',
    toast_fund_contrib:'{amt} ajout\u00e9 \u00e0 {name} \u2713',
    toast_sub_added:'Abonnement ajout\u00e9 \u2713',toast_sub_updated:'Abonnement mis \u00e0 jour \u2713',
    toast_alloc_enabled:'R\u00e9partition activ\u00e9e \u2713',toast_alloc_disabled:'R\u00e9partition d\u00e9sactiv\u00e9e',
    toast_lang_updated:'Langue mise \u00e0 jour \u2713',toast_export:'Export\u00e9 \u2713',
    toast_saved:'Enregistr\u00e9 \u2713',toast_reset:'Toutes les donn\u00e9es effac\u00e9es',toast_alloc_bucket_added:'Segment ajout\u00e9 \u2713',
    confirm_remove_cat:'Supprimer cette cat\u00e9gorie ?',confirm_delete_all_tx:'Supprimer TOUTES les transactions ? Cela est irr\u00e9versible.',
    confirm_delete_tx:'Supprimer cette transaction ?',confirm_remove_debt:'Supprimer cette dette ?',
    confirm_delete_fund:'Supprimer ce fonds ?',confirm_remove_sub:'Supprimer cet abonnement ?',
    confirm_reset_1:'\u00cates-vous s\u00fbr ? Toutes les donn\u00e9es seront d\u00e9finitivement supprim\u00e9es.',
    confirm_reset_2:'Derni\u00e8re chance - c\u2019est irr\u00e9versible. Continuer ?',
    export_csv_btn:'\uD83D\uDCE5 Exporter CSV',sett_export_title:'\uD83D\uDCE4 Exporter les donn\u00e9es',
    sett_export_desc:'T\u00e9l\u00e9chargez toutes les transactions en fichier CSV pour sauvegarde ou utilisation dans une autre application.',
    sf_add_contribution:'Ajouter une contribution',sf_contribution_label:'Montant \u00e0 ajouter',sf_currently_saved:'Actuellement \u00e9pargn\u00e9',
    tx_search_ph:'Rechercher par description ou cat\u00e9gorie\u2026',tx_filter_all_types:'Tous les types',tx_filter_all_alloc:'Toutes les r\u00e9partitions',
    tx_sort_date_new:'Plus r\u00e9cent d\u2019abord',tx_sort_date_old:'Plus ancien d\u2019abord',tx_sort_amt_high:'Montant le plus \u00e9lev\u00e9',tx_sort_amt_low:'Montant le moins \u00e9lev\u00e9',
    tx_showing:'{n} sur {total} affich\u00e9(s)',tx_no_results:'Aucune transaction ne correspond \u00e0 votre filtre.',
    alloc_add_bucket:'+ Ajouter un segment',alloc_remove_btn:'Supprimer',alloc_total_label:'Total',alloc_new_bucket:'Nouveau segment',alloc_color_title:'Choisir une couleur',alloc_custom_color:'Autre',alloc_min_buckets:'Au moins 2 segments requis',
    alloc_auto_tag:'Tag automatique \u2192 {name}',
    tx_prev:'\u2190 Pr\u00e9c.',tx_next:'Suiv. \u2192',tx_page_of:'Page {n} sur {total}',
    debt_due_day_note:'Les jours 29-31 n\u2019apparaissent pas dans les mois courts',
    sub_advanced:'Date de facturation avanc\u00e9e au {date}',
    sf_days_left:'{n} jours restants',sf_days_overdue:'{n} jours de retard',
    sf_due_today:'Aujourd\u2019hui!',sf_target_complete:'Objectif atteint ! \u2713',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs P\u00e9riode pr\u00e9c\u00e9dente',dash_compare_no_data:'Aucune donn\u00e9e pour la p\u00e9riode pr\u00e9c\u00e9dente',
    recurring_title:'Transactions automatiques',recurring_desc:'Créez des transactions qui se répètent (exemple : loyer, salaire ou abonnements). Elles sont ajoutées automatiquement à votre liste à chaque échéance.',recurring_add_rule:'+ Ajouter une transaction automatique',
    recurring_empty:'Aucune transaction automatique ajout\u00e9e.',recurring_label_ph:'Nom de la transaction (ex. Netflix)',
    recurring_freq:'Fr\u00e9quence',freq_daily:'Quotidien',freq_weekly:'Hebdomadaire',
    freq_monthly:'Mensuel',freq_quarterly:'Trimestriel',freq_annual:'Annuel',
    recurring_next_due:'Prochaine \u00e9ch\u00e9ance',recurring_generated:'{0} nouvelles transactions automatisées ajoutées',
    recurring_remove:'Supprimer la r\u00e8gle',recurring_paused:'En pause',recurring_active:'Actif',recurring_saved:'Transaction automatique enregistrée ✓',dpc_add_debt_title:'Ajouter une dette',dpc_edit_debt_title:'Modifier la dette',debt_due_day_modal_hint:'Le jour du mois où ce paiement est dû',toast_debt_added:'Dette ajoutée',toast_debt_updated:'Dette mise à jour',sf_billing_day_label:'Jour de prélèvement du mois',sf_billing_day_hint:'Le jour du mois où la contribution est enregistrée automatiquement',sf_error_required:'Veuillez remplir tous les champs obligatoires',sub_active:'Actif',sub_paused:'En pause',sub_desc:"Suivez chaque paiement récurrent et comprenez votre coût annuel réel. Mettez en pause les abonnements que vous n'utilisez pas pour maîtriser vos dépenses.",sub_add_btn:'+ Ajouter un abonnement',sub_add_title:'Ajouter un abonnement',sub_edit_title:"Modifier l'abonnement",sub_empty_title:'Aucun abonnement pour le moment.',sub_empty_sub:'Ajoutez vos paiements récurrents - Netflix, Spotify, abonnement de sport, etc.',sub_sum_monthly:'Total mensuel',sub_sum_annual:'Total annuel',sub_by_category:'Par catégorie',sub_per_month:'/mois',sub_next_label:'Prochain',sub_name_label:"Nom de l'abonnement",sub_name_ph:'ex. Netflix',sub_amount_label:'Montant',sub_freq_label:'Fréquence de facturation',sub_freq_monthly:'Mensuelle',sub_freq_annual:'Annuelle',sub_freq_quarterly:'Trimestrielle',sub_freq_weekly:'Hebdomadaire',sub_unit_month:'mois',sub_unit_year:'an',sub_unit_quarter:'trimestre',sub_cat_label:'Catégorie',sub_date_label:'Prochaine date de facturation',sub_cat_entertainment:'Divertissement',sub_cat_productivity:'Productivité',sub_cat_health:'Santé & Fitness',sub_cat_food:'Alimentation',sub_cat_cloud:'Stockage cloud',sub_cat_finance:'Finance',sub_cat_education:'Éducation',sub_cat_gaming:'Jeux vidéo',sub_cat_news:'Actualités & Médias',sub_cat_other:'Autre',help_sub_intro:"Suivez chaque paiement récurrent et comprenez votre coût mensuel et annuel réel. Les abonnements qui grignotent votre compte discrètement sont faciles à manquer - ceci les garde visibles.",help_sub_how_h:'Ajouter un abonnement',help_sub_step1:'Cliquez sur + Ajouter un abonnement',help_sub_step2:'Saisissez le nom, le montant et la fréquence de facturation (mensuelle, annuelle, trimestrielle, hebdomadaire)',help_sub_step3:'Choisissez une catégorie pour regrouper les abonnements similaires',help_sub_step4:"Définissez la prochaine date de facturation - elle apparaîtra dans le calendrier intelligent",help_sub_monthly_h:'Équivalent mensuel',help_sub_monthly_p:"Les abonnements annuels et trimestriels sont convertis en coût mensuel afin que vous puissiez voir vos dépenses mensuelles réelles en un coup d'œil.",help_sub_pause_h:'Mettre en pause un abonnement',help_sub_pause_p:"Désactivez le bouton Actif d'un abonnement que vous n'utilisez plus actuellement. Il ne comptera plus dans vos totaux tant que vous ne le réactivez pas.",help_sub_chart_h:'Graphique par catégorie',help_sub_chart_p:'Le graphique en anneau montre la répartition de vos dépenses d\'abonnement par catégorie - survolez un segment pour voir les détails.',help_sub_tip:"💡 Activez « Automatiser » sur un abonnement pour qu'il soit ajouté automatiquement à vos transactions à chaque cycle de facturation.",automate_auto_pay:'Paiement auto',sf_auto_contribute:'Contribution auto',sf_auto_need_amount:"Ajoutez d'abord un montant et une date cibles",sf_auto_set:'Contribution mensuelle : {0}',automate_label:'Automatiser',automate_hint:"L'ajoute automatiquement à vos transactions selon le calendrier",automate_hint_off:"Activez l'automatisation dans les Paramètres pour l'utiliser",automate_th:'Paiement auto',automate_need_amount:"Définissez d'abord un paiement minimum",automate_payment_word:'paiement',automate_linked:'Transaction automatique liée',sf_contribution_label:'Contribution mensuelle',sf_contribution_hint:'Enregistrée automatiquement chaque mois pour alimenter ce fonds',sett_automation_h:'Automatisation',sett_automation_desc:"Interrupteur principal des transactions automatiques. Désactivé, aucune transaction planifiée n'est générée et les options d'automatisation sont désactivées.",sett_automation_toggle:'Transactions automatiques',sett_automation_hint:"S'applique aux transactions, abonnements, fonds et dettes",
    tx_type_sinking_fund:'Fonds projet',
    help_dash_alloc_h:'Panneau de répartition budgétaire',
    help_dash_alloc_what_h:'Ce que c\'est',
    help_dash_alloc_what_p:"Suit vos dépenses par rapport à des pourcentages cibles personnalisables de vos revenus. La règle classique 50/30/20 divise les revenus en : Besoins (essentiels : loyer, nourriture, factures), Envies (style de vie : restaurants, streaming, loisirs) et Épargne (constitution de patrimoine et remboursement de dettes). Vous pouvez définir n'importe quelle répartition - les pourcentages doivent juste totaliser 100%.",
    help_dash_alloc_tag_h:'Étiqueter les transactions',
    help_dash_alloc_tag_p:"Lors de l'enregistrement d'une transaction, choisissez une répartition (Besoin / Envie / Épargne) dans la liste déroulante. Les revenus et les contributions d'épargne ne sont pas étiquetés. Un badge ? sur une ligne signifie que cette dépense n'est pas encore étiquetée.",
    help_dash_alloc_read_h:'Lire les cartes',
    help_dash_alloc_read_p:'Chaque carte affiche le nom du segment, votre % cible et votre % réel des revenus pour la période. La fine barre se remplit proportionnellement - lorsqu\'elle est pleine, vous avez atteint votre limite.',
    help_dash_alloc_col_h:'Code couleur',
    help_dash_alloc_col_over:'Rouge - vous avez dépassé la cible. Le pourcentage et la barre deviennent rouges.',
    help_dash_alloc_col_near:'Orange - dans les 5 points de pourcentage de la cible. Un avertissement que vous approchez.',
    help_dash_alloc_col_norm:'Couleur du segment - confortablement dans votre cible pour cette période.',
    help_dash_alloc_setup_h:'Personnaliser',
    // Penny (assistante IA)
    sett_penny_h:'Penny (Assistante budgétaire IA)',
    sett_penny_desc:'Posez des questions à Penny sur votre budget & vos habitudes de dépenses',
    sett_penny_toggle:'Activer Penny',
    sett_penny_hint:'Active l’assistante Penny et son icône dans la barre de navigation.',
    sett_penny_key_label:'Clé API Gemini',
    sett_penny_key_placeholder:'Collez votre clé API Gemini',
    sett_penny_howto:'Comment créer ma clé',
    sett_penny_save_btn:'Enregistrer la clé',
    sett_penny_key_saved:'Clé API Gemini enregistrée et chiffrée',
    sett_penny_remove:'Supprimer la clé',
    sett_penny_available:'Penny est maintenant disponible dans le menu de navigation.',
    sett_penny_usage_count:'Penny a répondu à {0} questions ce mois-ci',
    sett_penny_key_error_short:'Cela ne ressemble pas à une clé valide. Vérifiez et réessayez.',
    confirm_penny_remove_key:'Supprimer votre clé API Gemini enregistrée ? Penny sera désactivée jusqu’à ce que vous en ajoutiez une nouvelle.',
    toast_penny_key_saved:'Clé Gemini enregistrée en toute sécurité.',
    penny_nav_pill_off:'Activer Penny',
    penny_nav_pill_on:'Demander à Penny',
    penny_nav_aria_off:'Activer Penny',
    penny_nav_aria_on:'Demander à Penny',
    penny_chat_title:'Demander à Penny',
    penny_input_placeholder:'Posez une question sur votre budget…',
    penny_send:'Demander',
    penny_thinking:'Penny réfléchit…',
    penny_voice_on:'Réponses vocales activées',
    penny_voice_off:'Réponses vocales désactivées',
    penny_disclaimer:'Votre toute personnelle assistante budgétaire IA',
    penny_no_key_notice:'Ajoutez votre clé API Gemini dans les Paramètres pour commencer à discuter avec Penny.',
    penny_open_settings:'Ouvrir les paramètres',
    penny_close:'Fermer Penny',
    penny_qp_leftover:'Combien me reste-t-il pour cette période ?',
    penny_qp_top_category:'Quelle est ma plus grosse catégorie de dépenses ?',
    penny_qp_on_track:'Est-ce que je respecte mon budget ?',
    penny_qp_subscriptions:'Combien je paie en abonnements ?',
    penny_qp_debt:'Où en est le remboursement de mes dettes ?',
    penny_qp_chart:'Montre-moi un graphique de mes dépenses',
    penny_err_invalid_key:'Votre clé API Gemini semble invalide ou a été révoquée. Mettez-la à jour dans les Paramètres.',
    penny_err_rate_limited:'Vous avez atteint la limite de débit de Gemini pour le moment. C’est une limite imposée par Google sur votre clé, pas le compteur ci-dessus. Attendez un peu et réessayez.',
    penny_err_network:'Penny n’a pas pu joindre les serveurs de Google. Vérifiez votre connexion et réessayez.',
    penny_err_blocked:'Penny n’a pas trouvé de réponse sûre à cela. Essayez de reformuler votre question sur votre budget.',
    penny_err_unknown:'Une erreur s’est produite du côté de Penny. Veuillez réessayer dans un instant.',
    penny_err_key_unreadable:'Votre clé enregistrée n’a pas pu être lue. Veuillez la ressaisir dans les Paramètres.',
    penny_err_retry:'Réessayer',
    help_sett_penny_p:'Activez Penny ci-dessous pour poser des questions sur votre budget en langage simple. Touchez « Comment créer ma clé » pour les étapes de configuration.',
    help_penny_title:'Configurer Penny',
    help_penny_intro:'Penny est l’assistante IA d’Evo Budget. Comme cette application n’a pas de serveur, Penny parle directement depuis votre navigateur à Google grâce à votre propre clé API Gemini gratuite. Rien ne transite jamais par un serveur Evo Budget, puisqu’il n’y en a pas.',
    help_penny_steps_h:'Comment créer votre clé',
    help_penny_step1:'Allez sur Google AI Studio (aistudio.google.com/apikey) et connectez-vous avec un compte Google.',
    help_penny_step2:'Cliquez sur « Créer une clé API » (choisissez « Créer une clé dans un nouveau projet » si vous n’en avez pas encore).',
    help_penny_step3:'Copiez la clé générée (elle commence par AIza…).',
    help_penny_step4:'Collez-la dans le champ « Clé API Gemini » des Paramètres d’Evo Budget et cliquez sur « Enregistrer la clé ».',
    help_penny_cost_h:'Est-ce gratuit ?',
    help_penny_cost_p:'L’API Gemini propose un niveau gratuit avec des limites fixées par Google, qui peuvent changer. Consultez vos limites actuelles à tout moment sur aistudio.google.com. Le compteur « questions posées » affiché dans les Paramètres est un compteur personnel conservé sur votre propre appareil pour votre information. Ce n’est pas une lecture en direct de votre quota Google.',
    help_penny_safety_h:'Ma clé est-elle en sécurité ?',
    help_penny_safety_p:'Votre clé est chiffrée avant d’être enregistrée dans le stockage de votre propre navigateur, et elle n’est envoyée directement à l’API de Google que lorsque vous posez une question à Penny. Elle ne va jamais à un serveur d’Evo Budget.',
    help_penny_cta:'Ouvrir Google AI Studio →',
    help_dash_alloc_setup_p:'Ouvrez Paramètres \u2192 Répartition des dépenses. Modifiez les noms des segments, ajustez les pourcentages et activez ou désactivez le panneau. Les pourcentages doivent totaliser 100%.',
    // Guide
    guide_group_start:'Pour commencer', guide_group_track:'Suivre votre argent', guide_group_plan:'Voir plus loin',
    guide_group_smart:'Travailler plus malin', guide_group_settings:"Personnaliser l'application",
    guide_section_big:"L'essentiel", guide_section_how:"Comment l'utiliser", guide_section_connects:"Comment ça s'articule", guide_back:'Retour aux sujets',
    guide_welcome_title:'Bienvenue dans Ultimate Budget Planner',
    guide_welcome_big:"Ultimate Budget Planner reprend l'idée simple de suivre revenus et dépenses et lui donne des super-pouvoirs - un vrai plan de remboursement de dettes, des objectifs d'épargne avec barres de progression, un calendrier qui donne une vue d'ensemble, un suivi des abonnements, et Penny, une assistante IA qui connaît déjà vos chiffres. Commencez par le tableau de bord, et explorez le reste quand vous serez prêt.",
    guide_dashboard_title:'Tableau de bord',
    guide_dashboard_big:"Le tableau de bord est votre poste de commande - tout ce qui compte pour votre argent se trouve sur cet unique écran, de votre solde final à ce qui arrive cette semaine.",
    guide_dashboard_step1:"Consultez les cartes récapitulatives en haut pour votre <strong>Revenu total</strong>, vos <strong>Dépenses totales</strong>, votre <strong>Taux d'épargne</strong> et votre <strong>Solde net</strong>.",
    guide_dashboard_step2:"Consultez la liste <strong>À venir</strong> pour voir tout ce qui est dû dans les 7 prochains jours - factures, paiements de dettes et abonnements, tout au même endroit.",
    guide_dashboard_step3:"Vérifiez vos aperçus <strong>Remboursement de dette</strong> et <strong>Réserves</strong> pour voir d'un coup d'œil votre progression vers vos objectifs plus importants.",
    guide_dashboard_connect1:"Chaque chiffre ici provient en direct de Transactions, Budget, Remboursement de dette, Réserves et Abonnements - rien à calculer à la main.",
    guide_dashboard_connect2:"Le Solde net inclut votre paramètre de <strong>Report</strong>, si bien que l'argent non dépensé de la période précédente peut se répercuter automatiquement.",
    guide_dashboard_connect3:"Si quelque chose semble faux, il vaut presque toujours la peine de vérifier la page d'origine - le tableau de bord est un miroir, pas une source.",
    guide_dashboard_tip:"Prenez 30 secondes chaque matin pour parcourir le tableau de bord - c'est le moyen le plus rapide de repérer une facture ou un paiement de dette avant qu'il ne soit en retard.",
    guide_transactions_title:'Transactions',
    guide_transactions_big:"Les transactions sont le fondement de tout dans cette application - chaque euro que vous saisissez ici alimente votre tableau de bord, votre budget et chaque graphique que vous voyez. Ultimate Budget Planner vous permet aussi d'automatiser les tâches répétitives pour ne pas avoir à tout ressaisir chaque période.",
    guide_transactions_step1:'Appuyez sur <strong>Ajouter une transaction</strong>, choisissez un type et une catégorie, puis renseignez le montant.',
    guide_transactions_step2:"Configurez une <strong>règle récurrente</strong> pour tout ce qui se répète, comme un loyer ou un salaire, pour qu'elle se saisisse automatiquement au lieu de la retaper à chaque fois.",
    guide_transactions_step3:"Utilisez <strong>Importer un CSV</strong> pour importer des dépenses existantes d'un coup plutôt que de les saisir à la main.",
    guide_transactions_step4:"Appuyez sur une transaction pour la modifier, ou utilisez les filtres au-dessus de la liste pour en retrouver une rapidement.",
    guide_transactions_connect1:"Les règles récurrentes configurées ici alimentent la fonction <strong>Automatisation</strong> - une fois qu'une règle existe, elle continue de se saisir selon le calendrier prévu, sans que vous ayez à intervenir.",
    guide_transactions_connect2:'Chaque transaction compte automatiquement dans la catégorie correspondante dans Budget, Remboursement de dette ou Abonnements.',
    guide_transactions_connect3:"Les totaux et graphiques de votre tableau de bord sont entièrement construits à partir de ce qui est saisi ici.",
    guide_transactions_tip:"Configurez d'abord les règles récurrentes pour vos factures régulières et votre salaire - c'est le plus grand gain de temps de toute l'application.",
    guide_budget_title:'Budget',
    guide_budget_big:"Budget est l'endroit où vous définissez vos objectifs - combien vous comptez gagner et dépenser en Revenus, Dépenses, Factures et Épargne - le tout depuis un seul écran plutôt que de passer d'un onglet à l'autre.",
    guide_budget_step1:'Ajoutez une catégorie sous <strong>Revenus</strong>, <strong>Dépenses</strong>, <strong>Factures</strong> ou <strong>Épargne</strong> et définissez son montant <strong>Prévu</strong>.',
    guide_budget_step2:'Au fil de vos saisies de transactions, regardez la colonne <strong>Réel</strong> se remplir automatiquement pour chaque catégorie.',
    guide_budget_step3:'Comparez Prévu et Réel pour voir quelles catégories sont dans les temps et lesquelles demandent votre attention.',
    guide_budget_step4:"Ajustez n'importe quel montant Prévu quand votre vie change - votre budget doit s'adapter à vous, pas l'inverse.",
    guide_budget_connect1:"Chaque transaction saisie dans Transactions alimente directement la catégorie correspondante ici.",
    guide_budget_connect2:"Votre graphique de Répartition des dépenses et votre Solde net au tableau de bord sont tous deux construits à partir de ces catégories.",
    guide_budget_connect3:"Si vous avez activé les <strong>Enveloppes budgétaires</strong> dans les Paramètres, c'est aussi ici que vous verrez comment vos dépenses se comparent à ces objectifs en pourcentage.",
    guide_budget_tip:"Revoyez vos montants Prévus une fois par mois - un budget qui ne change jamais cesse assez vite de refléter la réalité.",
    guide_debt_title:'Calculateur de remboursement de dette',
    guide_debt_big:"C'est plus qu'un simple relevé de ce que vous devez - cela vous construit un vrai plan pour devenir libre de dettes, en montrant exactement quelle dette privilégier en premier et combien d'intérêts vous économiserez.",
    guide_debt_step1:'Ajoutez chaque dette avec son <strong>Solde</strong>, son <strong>Taux</strong> (intérêt) et son <strong>Paiement minimum</strong>.',
    guide_debt_step2:'Choisissez une stratégie : <strong>Boule de neige</strong> (rembourser le plus petit solde en premier pour des victoires rapides) ou <strong>Avalanche</strong> (rembourser le taux le plus élevé en premier pour économiser le plus).',
    guide_debt_step3:"Ajoutez tout montant supplémentaire que vous pouvez consacrer aux dettes chaque période - le calculateur l'applique à la dette ciblée en premier par votre stratégie.",
    guide_debt_step4:"Consultez votre <strong>date de libération</strong> projetée et le total des intérêts pour voir comment des paiements supplémentaires changent la donne.",
    guide_debt_step5:'Pour les prêts hypothécaires et autres prêts, définissez une <strong>durée</strong> et cliquez sur <strong>Calculer automatiquement</strong> pour un paiement minimum précis. Pour les cartes de crédit, passez à <strong>% du solde</strong> pour correspondre à votre relevé réel.',
    guide_debt_step6:'Certains prêts utilisent des <strong>mensualités dégressives</strong> au lieu de mensualités égales - la part de capital reste fixe et la mensualité totale diminue avec le temps. Vérifiez le <strong>type de remboursement</strong> pour qu\'il corresponde à votre prêt.',
    guide_debt_step7:'Pour un taux variable, réglez le <strong>type de taux</strong> sur "Ajustable après une période fixe" et définissez quand il change. Pour un séquestre hypothécaire qui diminue avec le temps, réglez le <strong>type de séquestre</strong> sur "Dégressif avec le solde".',
    guide_debt_step8:"Cliquez sur l'<strong>icône ℹ️ info</strong> d'une dette pour voir son échéancier de paiement mensuel complet. Utilisez la colonne <strong>Extra/mois</strong> pour diriger des paiements supplémentaires vers une dette précise, indépendamment de votre ordre boule de neige/avalanche.",
    guide_debt_connect1:"Les paiements de dette saisis dans Transactions comptent dans le solde de chaque dette ici.",
    guide_debt_connect2:"Votre tableau de bord affiche un aperçu de ce plan de remboursement pour que vous sachiez toujours où vous en êtes sans ouvrir cette page.",
    guide_debt_connect3:"Payer plus que le minimum ici - même un peu plus - est généralement le plus grand levier pour raccourcir votre calendrier de remboursement.",
    guide_debt_tip:"Listez même les petites dettes, comme un prêt familial - ce qui compte n'est pas le montant, mais de savoir tout ce que vous devez au même endroit.",
    guide_sinking_title:'Réserves',
    guide_sinking_big:"Une réserve, c'est de l'argent que vous mettez de côté petit à petit pour quelque chose de précis que vous savez arriver - des vacances, un nouvel ordinateur, des cadeaux - pour que ça ne devienne jamais une urgence quand la dépense arrive vraiment.",
    guide_sinking_step1:'Créez une réserve et donnez-lui un <strong>Montant cible</strong> et, si vous le souhaitez, une date cible.',
    guide_sinking_step2:"Ajoutez des contributions chaque fois que vous mettez de l'argent de côté, et regardez la <strong>barre de progression</strong> se remplir.",
    guide_sinking_step3:"Une fois qu'une réserve atteint sa cible, vous êtes prêt pour cette dépense sans toucher à votre budget habituel.",
    guide_sinking_connect1:"Les réserves sont distinctes de votre catégorie Épargne habituelle - elles servent des objectifs précis et planifiés plutôt qu'une épargne générale.",
    guide_sinking_connect2:"Votre tableau de bord affiche un aperçu de la progression de toutes vos réserves au même endroit.",
    guide_sinking_connect3:"Contribuer régulièrement à une réserve, même un petit montant, transforme une grosse dépense en quelque chose qui ne déstabilise jamais votre budget.",
    guide_sinking_tip:"Découpez les grands objectifs en montants mensuels ronds - il est bien plus facile de s'engager à 50 € par mois que de « économiser pour des vacances un jour ».",
    guide_subscriptions_title:'Abonnements',
    guide_subscriptions_big:"Les abonnements ont tendance à s'accumuler discrètement - cette page liste chaque service récurrent que vous payez au même endroit, pour que rien ne continue à vous facturer à votre insu.",
    guide_subscriptions_step1:"Ajoutez chaque abonnement avec son coût et sa fréquence de facturation (mensuelle, annuelle, etc.).",
    guide_subscriptions_step2:'Consultez le total du <strong>Coût mensuel</strong> pour voir ce que représentent tous vos abonnements ensemble.',
    guide_subscriptions_step3:"Mettez en pause ou annulez tout ce que vous n'utilisez pas, directement depuis cette page.",
    guide_subscriptions_connect1:"Le coût total de vos abonnements alimente directement le résumé de votre tableau de bord et vos Dépenses totales.",
    guide_subscriptions_connect2:"Les échéances d'abonnement apparaissent aussi sur le Calendrier, pour les voir aux côtés des factures et des paiements de dettes.",
    guide_subscriptions_connect3:"Revoir cette liste tous les quelques mois est l'un des moyens les plus simples de retrouver de l'argent que vous ne saviez pas perdre.",
    guide_subscriptions_tip:"Faites une revue de vos abonnements juste après la réception de votre relevé bancaire chaque mois - c'est le moment le plus facile pour repérer quelque chose que vous aviez oublié de payer.",
    guide_calendar_title:'Calendrier',
    guide_calendar_big:"Le Calendrier rassemble chaque facture, paiement de dette, prélèvement d'abonnement et transaction dans une vue mensuelle, pour voir tout ce qui se passe avec votre argent d'un coup d'œil plutôt que de vérifier cinq pages différentes.",
    guide_calendar_step1:"Parcourez n'importe quel mois pour voir des points colorés marquant les factures, paiements de dettes et abonnements dus ce jour-là.",
    guide_calendar_step2:"Appuyez sur un jour pour voir la liste complète de tout ce qui s'y passe.",
    guide_calendar_step3:"Utilisez cette vue avant un achat important pour voir ce qui est dû à peu près au même moment.",
    guide_calendar_connect1:"Tout ce qui est affiché ici provient de Factures, Remboursement de dette, Abonnements et Transactions - le Calendrier ne conserve aucune donnée propre.",
    guide_calendar_connect2:"C'est le moyen le plus rapide de repérer une semaine où plusieurs échéances tombent proches les unes des autres, avant d'être pris au dépourvu.",
    guide_calendar_connect3:"Rien de ce que vous faites sur le Calendrier ne change votre budget - c'est une vue pure, donc totalement sûre à parcourir.",
    guide_calendar_tip:"Consultez le Calendrier en début de semaine - cela prend quelques secondes et les échéances ne sont plus jamais une surprise.",
    guide_rollover_title:'Report',
    guide_rollover_big:"Le Report signifie que l'argent non dépensé de la période précédente ne disparaît pas simplement - il se répercute automatiquement et s'ajoute à ce dont vous disposez cette période.",
    guide_rollover_step1:'Ouvrez les <strong>Paramètres</strong> et trouvez la carte <strong>Report</strong>.',
    guide_rollover_step2:"Activez-le pour que tout montant restant de la période précédente se répercute automatiquement sur la nouvelle.",
    guide_rollover_step3:"Vérifiez le Solde net de votre tableau de bord - il inclura désormais ce montant reporté.",
    guide_rollover_connect1:"Le Report fonctionne directement à partir de votre Solde net de la période précédente - plus vous respectez votre budget, plus il a de quoi se reporter.",
    guide_rollover_connect2:'Ceci est différent des Réserves, qui servent des objectifs futurs planifiés - le Report consiste simplement à ne pas perdre la trace de l argent que vous avez déjà.',
    guide_rollover_connect3:"Une série de bons mois s'accumule bien ici, puisque le surplus de chaque période s'ajoute à la suivante.",
    guide_rollover_tip:"Si un gros montant de report vous brûle les doigts, envisagez d'en transférer une partie vers une Réserve pour qu'il soit destiné à quelque chose de précis.",
    guide_automation_title:'Automatisation',
    guide_automation_big:"L'Automatisation prend les règles récurrentes que vous avez configurées dans Transactions et les saisit automatiquement pour vous, pour que vos factures, salaires et abonnements réguliers apparaissent pile à temps sans que vous leviez le petit doigt.",
    guide_automation_step1:'Ouvrez les <strong>Paramètres</strong> et trouvez la carte <strong>Automatisation</strong>.',
    guide_automation_step2:"Activez-la pour que les règles de transaction récurrentes se saisissent automatiquement à échéance.",
    guide_automation_step3:"Vérifiez ensuite Transactions pour confirmer que tout s'est saisi comme prévu.",
    guide_automation_connect1:"Cette fonction ne fonctionne qu'avec des règles récurrentes déjà créées dans Transactions - configurez-les d'abord.",
    guide_automation_connect2:"Chaque transaction qu'elle saisit alimente Budget, Remboursement de dette et Abonnements exactement comme une saisie manuelle.",
    guide_automation_connect3:"C'est la différence entre une application de budget qu'il faut penser à mettre à jour, et une qui se tient à jour toute seule.",
    guide_automation_tip:"Activez l'Automatisation une fois que vos règles récurrentes vous semblent justes - elle est surtout utile une fois que vous faites confiance aux chiffres qu'elle va saisir.",
    guide_penny_title:'Penny',
    guide_penny_big:"Penny est votre propre assistante IA pour le budget, intégrée directement à l'application - posez-lui une question sur votre argent en langage courant, et elle lit vos vraies données budgétaires pour vous donner une vraie réponse, avec des graphiques quand c'est utile.",
    guide_penny_step1:"Ouvrez les <strong>Paramètres</strong>, activez Penny, et collez votre propre clé API Gemini (un lien est juste là pour montrer exactement comment en obtenir une gratuitement).",
    guide_penny_step2:"Appuyez sur l'icône étincelle dans la navigation du haut pour ouvrir le chat.",
    guide_penny_step3:"Posez une question avec vos propres mots, comme « quelle est ma plus grosse catégorie de dépenses ce mois-ci ? », ou appuyez sur l'un des boutons de question rapide pour commencer.",
    guide_penny_step4:"Activez ou désactivez sa réponse vocale avec l'icône haut-parleur si vous préférez écouter plutôt que lire.",
    guide_penny_connect1:"Penny ne peut que lire vos données budgétaires pour répondre aux questions - elle ne peut jamais rien ajouter, modifier ou supprimer pour vous.",
    guide_penny_connect2:"Elle puise directement dans Tableau de bord, Transactions, Remboursement de dette, Abonnements et Réserves, donc ses réponses correspondent toujours à ce que vous verriez vous-même sur ces pages.",
    guide_penny_connect3:"Votre clé API est chiffrée et stockée uniquement sur votre propre appareil - elle n'est jamais envoyée nulle part, sauf directement à Google quand vous posez une question à Penny.",
    guide_penny_tip:"Commencez par l'un des boutons de question rapide la première fois - c'est le moyen le plus rapide de voir ce qu'elle sait faire avant de poser vos propres questions.",
    guide_settings_title:'Paramètres',
    guide_settings_big:"Les Paramètres, c'est là où l'application s'adapte à vous - devise, période budgétaire, report, automatisation, apparence, langue, et la façon dont vos données sont stockées et sauvegardées.",
    guide_settings_step1:"Choisissez votre <strong>Devise</strong> et votre <strong>Période budgétaire</strong> pour que l'application corresponde à votre rythme réel de paiement et de dépenses.",
    guide_settings_step2:"Activez <strong>Report</strong> et <strong>Automatisation</strong> si vous voulez que l'argent non dépensé et les transactions récurrentes soient gérés automatiquement pour vous.",
    guide_settings_step3:"Basculez l'<strong>Apparence</strong> entre clair et sombre, et choisissez votre <strong>Langue</strong> dans la liste.",
    guide_settings_step4:"Configurez les <strong>Enveloppes budgétaires</strong> si vous préférez budgétiser par pourcentage (comme 50 % besoins, 30 % envies, 20 % épargne) plutôt qu'avec des montants de catégorie fixes.",
    guide_settings_step5:"Choisissez comment vos données sont stockées sous <strong>Données et synchronisation</strong> - localement sur cet appareil, ou synchronisées avec Google Drive pour qu'elles vous suivent sur d'autres appareils.",
    guide_settings_step6:"Utilisez <strong>Exporter les données</strong> pour tout sauvegarder, ou <strong>Réinitialiser les données</strong> si vous voulez repartir complètement à zéro.",
    guide_settings_connect1:"Vos choix de Devise, Période budgétaire, Report et Automatisation ici déterminent comment chaque autre page de l'application calcule et affiche les chiffres.",
    guide_settings_connect2:"Activer la synchronisation Google ici permet à vos données de vous suivre si vous ouvrez l'application sur un autre appareil.",
    guide_settings_connect3:"Exporter vos données ici est l'habitude la plus sûre à prendre avant tout changement important dont vous n'êtes pas sûr.",
    guide_settings_tip:"Configurez d'abord Devise, Période budgétaire et Données et synchronisation, avant tout le reste - ce sont les fondations sur lesquelles tout le reste de l'application est construit.",
  },
  es: {
    lang_name:'Español',
    tab_dashboard:'Panel',tab_budget:'Presupuesto',tab_transactions:'Transacciones',
    tab_income:'Ingresos',tab_expenses:'Gastos',tab_bills:'Facturas',
    tab_debt:'Deudas',tab_savings:'Ahorros',tab_settings:'Ajustes',
    tab_debt_payoff:'Pago de deudas',tab_sinking:'Fondos de ahorro',
    tab_calendar:'Calendario',tab_subscriptions:'Suscripciones',
    total_income:'Ingresos totales',expenses_bills:'Gastos y facturas',
    debt_payments:'Pagos de deuda',total_savings:'Ahorros totales',
    total_outgoing:'Gastos totales',savings_rate:'Tasa de ahorro',
    net_leftover:'Saldo neto',cash_flow:'Flujo de caja',
    income_sources:'Fuentes de ingresos',spending_breakdown:'Desglose de gastos',
    expected:'Previsto',actual:'Real',
    of:'de',budgeted:'presupuestado',saved:'ahorrado',
    budget_period:'Período presupuestario',start_date:'Fecha de inicio',end_date:'Fecha de fin',
    this_month:'Este mes',this_week:'Esta semana',last_week:'Sem. pasada',last_month:'Mes pasado',last_30_days:'\u00daltimos 30 d\u00edas',this_quarter:'Este trimestre',this_year:'Este a\u00f1o',
    currency:'Moneda',rollover:'Saldo anterior',appearance:'Apariencia',
    language:'Idioma',reset_data:'Restablecer datos',
    light:'Claro',dark:'Oscuro',
    changes_autosaved:'✅ Los cambios se guardan automáticamente.',
    rollover_desc:'Traspasa el dinero no gastado del período anterior.',
    rollover_amount:'Importe de saldo anterior',
    reset_desc:'Elimina permanentemente todos tus datos. No se puede deshacer.',
    reset_btn:'Restablecer todo',
    add:'Añadir',cancel:'Cancelar',rename_title_prompt:'Renombrar tu planificador de presupuesto',save:'Guardar',delete:'Eliminar',dp_today:'Hoy',dp_clear:'Borrar',edit:'Editar',
    paid:'Pagado',due_date:'Fecha de vencimiento',category:'Categoría',amount:'Importe',
    description:'Descripción',date:'Fecha',type:'Tipo',
    add_category:'+ Añadir categoría',no_transactions:'Sin transacciones aún.',
    upgrade_title:'¿Listo para la experiencia pro?',
    upgrade_desc:'Desbloquea el calculador de pago de deudas, fondos de ahorro, calendario inteligente y seguimiento de suscripciones.',
    upgrade_now:'Actualizar ahora →',
    mon:'Lun',tue:'Mar',wed:'Mié',thu:'Jue',fri:'Vie',sat:'Sáb',sun:'Dom',
    quick_presets:'Accesos rápidos:',select_currency:'Selecciona tu moneda',select_language:'Seleccionar idioma',
    appearance_desc:'Cambiar entre modo claro y oscuro.',video_tutorial:'▶ Tutorial en vídeo',
    help_sett_intro:'Todas tus preferencias para Ultimate Budget Planner. Los cambios se guardan automáticamente a medida que los realizas.',
    help_sett_currency_p:'Cambia el símbolo de moneda en toda la aplicación inmediatamente al seleccionarlo.',
    help_sett_appearance_p:'Cambiar entre modo claro y oscuro. Tu preferencia se recuerda entre sesiones.',
    help_sett_nav_h:'Navegación',
    help_sett_nav_top:'Navegación superior - Barra de pestañas horizontal clásica en la parte superior (predeterminado).',
    help_sett_nav_side:'Navegación lateral - Una barra de iconos flotante a la izquierda de tu contenido. Haz clic en la flecha para expandirla y ver las etiquetas completas.',
    help_sett_period_p:'El rango de fechas que define “este presupuesto”. Solo las transacciones en este rango cuentan en tus datos reales. Usa los 7 preajustes (Este mes, Mes pasado, Esta semana, Sem. pasada, Últimos 30 días, Este trimestre, Este año) para configurar rápidamente.',
    help_sett_rollover_p:'Cualquier dinero no gastado que quieras traspasar del período anterior. Se añade a tu saldo neto en el panel.',
    cal_title:'Calendario inteligente',
    cal_desc:'Todas tus facturas, pagos de deudas, suscripciones y transacciones en un calendario en vivo. Haz clic en cualquier día para ver sus eventos.',
    cal_prev:'← Ant.',cal_next:'Sig. →',
    cal_all_events:'Todos los eventos - ',
    cal_no_events_day:'No hay eventos este día.',
    cal_no_events_month:'No hay eventos este mes.',
    cal_no_events_sub:'Añade facturas, deudas o suscripciones para verlas aquí.',
    cal_event_one:'evento',cal_event_many:'eventos',cal_clear:'Borrar ×',
    cal_leg_bill:'Factura',cal_leg_debt:'Deuda',cal_leg_sub:'Suscripción',cal_leg_tx:'Transacción',cal_leg_sinking:'Fondo de reserva',cal_leg_goal:'Fecha objetivo',cal_leg_auto:'Automático',
    cal_paid:'✓ Pagado',cal_unpaid:'No pagado',
    help_cal_intro:'El Calendario inteligente reúne todos tus compromisos financieros en una vista mensual - actualizado automáticamente a medida que añades datos.',
    help_cal_ev_types_h:'Tipos de eventos',
    help_cal_bill_li:'Facturas - desde tu sección de Facturas (recurrente mensualmente el día de vencimiento que estableces)',
    help_cal_debt_li:'Pagos de deudas - desde tu sección de Pago de deudas (recurrente el día de vencimiento)',
    help_cal_sub_li:'Suscripciones - desde tu rastreador de Suscripciones (el día de la próxima fecha de facturación)',
    help_cal_tx_li:'Transacciones - fechas en las que registraste ingresos o gastos',
    help_cal_nav_h:'Navegación',
    help_cal_nav_p:'Usa ← Ant. y Sig. → para moverte entre meses. Haz clic en cualquier día para ver sus eventos. Haz clic de nuevo o en «Borrar ×» para deseleccionar.',
    help_cal_tip:'💡 Establece fechas de vencimiento en facturas y deudas para aprovechar al máximo el calendario.',
    sf_add_btn:'+ Añadir fondo',
    sf_desc:'Un fondo de ahorro te permite ahorrar gradualmente para un gran gasto futuro - sin sorpresas desagradables. Establece un objetivo y una fecha, y te diremos exactamente cuánto ahorrar cada mes.',
    sf_empty_title:'Aún no hay fondos de ahorro.',
    sf_empty_sub:'Perfecto para: vacaciones, reparaciones de coche, bodas, nueva tecnología, facturas anuales.',
    sf_pct_complete:'completado',
    sf_save_prefix:'Ahorrar',sf_per_month:'/mes',
    sf_month_left_one:'mes restante',sf_month_left_many:'meses restantes',
    sf_total_contrib:'Total de contribuciones mensuales necesarias:',
    sf_modal_new:'🏺 Nuevo fondo de ahorro',sf_modal_edit:'✏️ Editar fondo',
    sf_fund_name_label:'Nombre del fondo',sf_fund_name_ph:'p.ej. Fondo vacaciones',
    sf_icon_label:'Icono',sf_target_amount_label:'Importe objetivo',
    sf_currently_saved_label:'Ya ahorrado',sf_target_date_label:'Fecha objetivo',
    sf_create_btn:'Crear fondo',
    help_sf_intro:'Un fondo de ahorro es dinero que apartas con antelación para un gran gasto planificado - sin sorpresas desagradables cuando llega la factura.',
    help_sf_how_to_h:'Cómo usarlo',
    help_sf_step1:'Haz clic en + Añadir fondo',
    help_sf_step2:'Nombra tu fondo (p.ej. "Vacaciones de verano"), elige un icono',
    help_sf_step3:'Establece un importe objetivo (cuánto necesitas en total)',
    help_sf_step4:'Establece una fecha objetivo (cuándo necesitas el dinero)',
    help_sf_step5:'Indica cuánto has ahorrado ya',
    help_sf_reading_h:'Leer la tarjeta',
    help_sf_reading_p:'Cada tarjeta muestra tu ahorro vs objetivo, una barra de progreso y exactamente cuánto ahorrar por mes para alcanzar tu meta a tiempo.',
    help_sf_contrib_h:'Añadir contribuciones',
    help_sf_contrib_p:'Haz clic en el icono + de una tarjeta para registrar una contribución - introduce el importe que añades este mes.',
    help_sf_tip:'💡 Perfecto para: vacaciones, reparaciones de coche, seguros anuales, bodas, electrónica, mejoras del hogar.',
    dpc_title:'Calculadora de deudas',dpc_add_btn:'+ Añadir deuda',
    dpc_desc:'Introduce cada deuda, elige una estrategia de pago y ve exactamente cuándo estarás libre de deudas y cuántos intereses pagarás en total.',
    dpc_method_label:'Método de pago',
    dpc_snowball_desc:'Saldo más bajo primero - las victorias rápidas te mantienen motivado',
    dpc_avalanche_desc:'Tasa más alta primero - ahorra más dinero en total',
    dpc_extra_label:'Pago mensual extra',
    dpc_extra_hint:'Importe por encima de tus pagos mínimos para destinar a la deuda cada mes.',
    dpc_empty_title:'Aún no hay deudas añadidas.',
    dpc_empty_sub:'Haz clic en «+ Añadir deuda» para crear tu plan de pago.',
    dpc_th_name:'Deuda',dpc_th_type:'Tipo',dpc_th_balance:'Saldo',
    dpc_th_apr:'TAE %',dpc_th_min:'Pago mín.',dpc_th_due:'Día venc.',
    dpc_totals:'Totales',dpc_name_ph:'p.ej. Tarjeta Visa',
    dpc_term_label:'Plazo del préstamo (años)',dpc_term_hint:'Define cuánto dura este préstamo, para que el cálculo automático pueda determinar un pago mínimo preciso.',
    dpc_autocalc_btn:'Calcular automáticamente',dpc_autocalc_done:'Calculado: {0}/mes',
    dpc_min_mode_label:'Tipo de pago mínimo',dpc_min_mode_fixed:'Monto fijo',dpc_min_mode_percent:'% del saldo',
    dpc_min_percent_label:'Porcentaje del saldo (%)',dpc_min_floor_label:'Monto mínimo',
    dpc_min_calculated_hint:'Se calcula automáticamente - lo que sea mayor entre el porcentaje y el monto mínimo.',
    dpc_escrow_label:'Depósito en garantía (impuestos y seguro)',
    dpc_escrow_hint:'Se suma a tu costo mensual real, pero se excluye de la simulación de pago ya que no reduce tu saldo.',
    dpc_min_pct_caption:'{0}% del saldo',dpc_escrow_note:'{0} en depósito',
    dpc_term_note_faster:'{0} meses más rápido que tu plazo de {1} años',dpc_term_note_slower:'{0} meses más lento que tu plazo de {1} años',
    dpc_term_note_onschedule:'justo a tiempo para tu plazo de {0} años',
    dpc_escrow_mode_label:'Tipo de depósito en garantía',dpc_escrow_mode_fixed:'Monto fijo',dpc_escrow_mode_declining:'Decreciente con el saldo',
    dpc_escrow_mode_hint:'Esto solo afecta el cronograma de pagos de abajo. Tu monto automatizado y el total del panel siempre usan el monto fijo actual del depósito en garantía.',
    dpc_rate_type_label:'Tipo de tasa',dpc_rate_type_fixed:'Fija durante todo el plazo',dpc_rate_type_arm:'Se ajusta después de un período fijo (tasa variable)',
    dpc_rate_type_hint:'Un modelo simplificado: una tasa durante el período fijo, luego una única tasa nueva para el resto del préstamo - no es una simulación completa de índice/límite.',
    dpc_arm_fixed_years_label:'Período de tasa fija (años)',dpc_arm_rate_label:'Tasa después del ajuste',
    dpc_arm_caption:'se ajusta después de {0} años de período fijo',
    dpc_recalc_link:'↺ Recalcular',
    dpc_th_extra:'Extra/mes',
    dpc_extra_col_hint:'Se paga además del mínimo de esta deuda cada mes, antes de distribuir el pago extra compartido de arriba. Se detiene una vez que esta deuda está pagada - no se redirige a otra parte.',
    dpc_targeted_extra_note:'{0} extra dirigido',
    dpc_schedule_btn_title:'Ver cronograma de pagos',
    dpc_amort_type_label:'Tipo de amortización',dpc_amort_equal_payment:'Cuotas iguales',dpc_amort_equal_principal:'Cuotas decrecientes (capital constante)',
    dpc_amort_type_hint:'Con cuotas iguales, el pago es el mismo cada mes. Con cuotas decrecientes, la parte destinada al capital se mantiene fija, por lo que el pago total disminuye con el tiempo a medida que bajan los intereses - común en algunas hipotecas.',
    dpc_autocalc_done_declining:'Primera cuota: {0}/mes (disminuye cada mes)',dpc_declining_caption:'cuota decreciente',
    dtype_credit_card:'Tarjeta de crédito',dtype_student_loan:'Préstamo estudiantil',
    dtype_mortgage:'Hipoteca',dtype_car_loan:'Préstamo de coche',
    dtype_personal_loan:'Préstamo personal',dtype_other:'Otro',
    dpc_debt_free_label:'🎯 Fecha libre de deudas',dpc_months_from_now:'meses desde ahora',
    dpc_interest_label:'💸 Intereses totales',dpc_on_top:'además de',dpc_principal:'principal',
    dpc_monthly_label:'📅 Total mensual',dpc_min_abbr:'mín',dpc_extra_abbr:'extra',
    dpc_payoff_order_sf:'Orden de pago - ⛄ Bola de nieve (saldo más bajo primero)',
    dpc_payoff_order_av:'Orden de pago - 🌊 Avalancha (tasa más alta primero)',
    dpc_paid_off:'Pagado:',dpc_balance_word:'saldo',dpc_apr_word:'TAE',
    help_dpc_intro:'Esta calculadora elabora un plan de pago de deudas personalizado basado en tus deudas y la estrategia elegida.',
    help_dpc_entries_h:'Tus entradas de deudas',
    help_dpc_balance_li:'Saldo - Cuánto debes actualmente en esa deuda.',
    help_dpc_apr_li:'TAE % - La tasa de interés anual (encuéntrala en tu extracto). P.ej. 18,9 significa 18,9%.',
    help_dpc_min_li:'Pago mín. - El pago mensual mínimo requerido por el prestamista.',
    help_dpc_due_li:'Día venc. - El día del mes en que vence el pago (aparece en el Calendario inteligente).',
    help_dpc_strategies_h:'Estrategias de pago',
    help_dpc_snowball_li:'\u26c4 Bola de nieve - Paga las deudas empezando por el saldo más bajo. Una vez liquidada, aplica ese pago a la siguiente. La mejor para la motivación.',
    help_dpc_avalanche_li:'\uD83C\uDF0A Avalancha - Paga las deudas empezando por la tasa más alta. Ahorra más dinero en total.',
    help_dpc_extra_h:'Pago mensual extra',
    help_dpc_extra_p:'Cualquier excedente sobre tus pagos mínimos puede aplicarse a la deuda. Incluso un pequeño pago extra puede ahorrar cientos en intereses y reducir meses. Los resultados se actualizan mientras escribes.',
    help_dpc_term_li:'Plazo del préstamo - Para hipotecas, préstamos estudiantiles, de auto y personales, define el plazo en años y haz clic en Calcular automáticamente para obtener un pago mínimo preciso.',
    help_dpc_percent_li:'Pago mínimo por porcentaje - Para tarjetas de crédito, cambia a "% del saldo" para que funcione igual que el pago mínimo real de tu estado de cuenta (p. ej. 2% del saldo o $25, lo que sea mayor).',
    help_dpc_escrow_li:'Depósito en garantía - Para hipotecas, agrega tus impuestos y seguro mensuales para que tu costo mensual real sea preciso en todas partes; se excluye de la proyección de pago ya que no reduce tu saldo.',
    help_dpc_amort_li:'Tipo de amortización - Con cuotas iguales, tu pago es el mismo cada mes. Con cuotas decrecientes (capital constante), el monto destinado al capital se mantiene fijo, por lo que tu cuota total disminuye con el tiempo; revisa los documentos de tu préstamo para saber cuál tienes.',
    help_dpc_escrow_mode_li:'Tipo de depósito en garantía - elige "Decreciente con el saldo" si tu depósito disminuye junto con el saldo de tu préstamo, como algunas primas de seguro decrecientes; puedes verlo disminuir en el cronograma de pagos.',
    help_dpc_rate_type_li:'Tipo de tasa - elige "Se ajusta después de un período fijo" para una tasa variable, luego define cuántos años la tasa es fija y a qué cambia después.',
    help_dpc_extra_targeted_li:'Extra/mes (por deuda) - un monto opcional pagado solo hacia esa deuda cada mes, además de su mínimo, sin importar tu orden de bola de nieve/avalancha.',
    dsched_col_date:'Fecha',dsched_col_payment:'Pago',dsched_col_principal:'Capital',dsched_col_interest:'Interés',dsched_col_escrow:'Depósito',dsched_col_balance:'Saldo',
    dsched_never_payoff_warning:'A este ritmo, esta deuda no se pagará por completo dentro de 50 años - el pago apenas supera el interés. Considera un mínimo más alto, un piso porcentual más alto, o un pago extra.',
    help_dpc_tip:'\uD83D\uDCA1 Alterna entre métodos para ver cuántos intereses ahorrarías con cada enfoque.',
    tx_import_csv:'\uD83D\uDCE5 Importar CSV',
    tx_add_title:'Añadir una transacción',
    tx_date:'Fecha',tx_type:'Tipo',tx_category:'Categoría',tx_amount:'Importe',
    tx_desc_label:'Descripción',tx_desc_ph:'p.ej. Compra en supermercado\u2026',
    tx_add_btn:'Añadir',tx_error_required:'Por favor, completa todos los campos obligatorios.',
    tx_transaction_one:'transacción',tx_transaction_many:'transacciones',
    tx_clear_all:'Borrar todo',tx_empty:'Aún no hay transacciones.',
    tx_type_income:'Ingreso',tx_type_expense:'Gasto',tx_type_bill:'Factura',tx_type_savings:'Ahorro',
    tx_th_amount:'Importe',tx_th_desc:'Descripción',
    tx_edit_title:'\u270F\uFE0F Editar transacción',tx_save_changes:'Guardar cambios',
    help_tx_intro:'Cada movimiento de dinero va aquí. Tus importes reales del presupuesto y el panel se actualizan automáticamente cada vez que añades uno.',
    help_tx_adding_h:'Añadir una transacción',
    help_tx_step1:'Elige una Fecha - haz clic en el campo de fecha para abrir el calendario',
    help_tx_step2:'Elige un tipo: Ingreso, Gasto, Factura, Ahorro, Deuda o Suscripción o Fondo objetivo',
    help_tx_step3:'Selecciona la Categoría correspondiente (configurada en la pestaña Presupuesto)',
    help_tx_step4:'Introduce el Importe y una descripción opcional',
    help_tx_step5:'Haz clic en Añadir',
    help_tx_edit_h:'Edición & eliminación',
    help_tx_edit_p:'Haz clic en \u270F\uFE0F en cualquier transacción para editarla, o \u00d7 para eliminarla. Para borrar todo, usa «Borrar todo».',help_tx_auto_h:'Transacciones automáticas',help_tx_auto_p:'Crea una regla para todo lo que se repite (como alquiler o salario) y elige la frecuencia. La app la añade a tu lista automáticamente en cada vencimiento. Usa el interruptor para pausar una regla, o el lápiz para editarla.',
    help_tx_csv_h:'Importación CSV',
    help_tx_csv_p1:'Importa un export de hoja de cálculo con el formato: Date,Type,Category,Amount,Description (fila de encabezado obligatoria).',
    help_tx_csv_p2:'Las fechas deben estar en formato YYYY-MM-DD. Type debe ser: income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_section_income:'Ingresos',bud_section_expenses:'Gastos',
    bud_section_bills:'Facturas',bud_section_savings:'Ahorros',
    bud_th_category:'Categoría',bud_th_expected:'Previsto',
    bud_th_actual:'Real',bud_th_progress:'Progreso',
    bud_th_due_date:'Fecha venc.',bud_th_paid:'Pagado',
    bud_total:'Total',bud_set_date:'Seleccionar fecha',
    bud_add_btn:'+ Añadir',bud_add_cat_title:'Añadir nueva categoría',
    bud_cat_name_label:'Nombre de categoría',bud_cat_name_ph:'p.ej. Autónomo',
    bud_add_cat_btn:'Añadir',bud_due_date_label:'Fecha de vencimiento',
    help_bud_intro:'La pestaña Presupuesto es donde planificas tu dinero. Establece importes previstos para cada categoría - los reales se rellenan automáticamente desde tus Transacciones.',
    help_bud_how_h:'Cómo funciona',
    help_bud_step1:'Haz clic en un campo Previsto e introduce tu importe presupuestario',
    help_bud_step2:'Registra las transacciones en la pestaña Transacciones',
    help_bud_step3:'La columna Real y las barras de progreso se actualizan automáticamente',
    help_bud_colours_h:'Colores de las barras de progreso',
    help_bud_col_green:'Verde - ingreso igual o superior al objetivo',
    help_bud_col_indigo:'Índigo - gasto dentro del presupuesto',
    help_bud_col_red:'Rojo - gasto por encima del presupuesto',
    help_bud_bills_h:'Sección Facturas',
    help_bud_bills_p:'Las facturas tienen una Fecha de vencimiento (haz clic para abrir el selector de fecha) y una casilla Pagado. Estas fechas también aparecen en el Calendario inteligente.',
    help_bud_tip:'\uD83D\uDCA1 Usa «+ Añadir categoría» para crear categorías personalizadas en cualquier sección.',
    dash_total_income:'Ingresos totales',dash_of:'de',dash_expected_sfx:'previsto',
    dash_total_outgoing:'Gastos totales',dash_budgeted_sfx:'presupuestado',
    dash_savings_rate:'Tasa de ahorro',dash_saved_sfx:'ahorrado',
    dash_subscriptions:'Suscripciones',dash_per_year:'/año',
    dash_net_leftover:'Saldo neto del período',
    dash_in_sfx:'recibido',dash_out_sfx:'gastado',
    dash_includes:'Incluye',dash_rollover_sfx:'arrastre',
    dash_cash_flow:'Flujo de caja',
    dash_expected_legend:'Previsto',dash_actual_legend:'Real',
    dash_income_sources:'Fuentes de ingresos',dash_no_income:'Aún no se han registrado ingresos.',
    dash_spending_breakdown:'Desglose de gastos',dash_no_spending:'Aún no se han registrado gastos.',
    dash_no_debts:'No se han añadido deudas.',dash_set_up:'Configurar \u2192',
    dash_debt_free_label:'Sin deuda',dash_interest_label:'Intereses',
    dash_months_label:'Meses',dash_method_label:'Método',
    dash_set_balances:'Introduce los saldos para ver los resultados.',
    dash_upcoming_7:'\uD83D\uDCC5 Próximos (7 días)',dash_nothing_scheduled:'Nada programado.',
    dash_no_sinking:'No hay fondos de ahorro.',dash_create_one:'Crear uno \u2192',
    help_dash_intro:'El panel te ofrece un resumen financiero en tiempo real. Todos los números se actualizan automáticamente cuando registras transacciones.',
    help_dash_hero_h:'Fila de estadísticas principales',
    help_dash_hero_p:'Las cuatro tarjetas en la parte superior muestran tus totales del período: Ingresos totales recibidos, Gastos totales (gastos, facturas, deudas & suscripciones), Tasa de ahorro (% de ingresos ahorrados) y tu costo mensual de suscripciones.',
    help_dash_leftover_h:'Saldo neto',
    help_dash_leftover_p:'Dinero restante después de todos los gastos y el ahorro. Verde = estás por delante. Rojo = has excedido tu presupuesto.',
    help_dash_cashflow_h:'Gráfico de flujo de caja',
    help_dash_cashflow_p:'Cada fila muestra lo Previsto (barra gris) vs lo Real (barra de color) para Ingresos, Gastos, Facturas y Ahorros. Una barra roja de Gastos significa que has superado el presupuesto.',
    help_dash_donut_h:'Gráficos de anillo',
    help_dash_donut_p:"Pasa el ratón o toca un segmento para ver la etiqueta y el porcentaje. Muestran de dónde viene tu dinero y adónde va.",
    help_dash_bottom_h:'Paneles inferiores',
    help_dash_bottom_p:'Instantáneas rápidas de tu progreso en el pago de deudas, facturas/suscripciones próximas en los 30 días siguientes y objetivos de fondos de ahorro.',
    help_dash_tip:'\uD83D\uDCA1 Haz clic en el distintivo de fecha en la parte superior para cambiar tu período presupuestario.',
    tx_type_debt:'Deuda',
    dash_debt_payments:'Deudas',
    dash_debts_paid:'deuda pagada este período',dash_debts_paid_many:'deudas pagadas este período',
    tx_type_subscription:'Suscripci\u00f3n',
    alloc_title:'Distribución presupuestaria',
    alloc_desc:'Etiqueta los gastos como Necesidad, Deseo o Ahorro para ver cómo se alinea tu dinero con tu reparto objetivo.',
    alloc_label:'Distribución',alloc_optional:'Etiquetar gasto',
    alloc_target:'Objetivo',alloc_on_track:'En el objetivo',alloc_over:'Excedido',alloc_under:'Por debajo',
    alloc_enabled_label:'Activar distribución presupuestaria',
    alloc_name_ph:'Nombre del segmento',alloc_pct_label:'% de ingresos',
    alloc_sum_ok:'\u2713 100%',alloc_sum_bad:'\u26a0 Debe sumar 100%',
    alloc_based_on:'Basado en',alloc_income_period:'ingresos de este período',
    alloc_untagged:'Sin etiquetar',alloc_untagged_desc:'del gasto aún sin etiquetar',
    alloc_def_need:'Necesidad',alloc_def_want:'Deseo',alloc_def_save:'Ahorro',
    alloc_sett_title:'\uD83C\uDFAF Distribución del gasto',
    alloc_nearing:'Cercano',
    alloc_required:'La distribución es obligatoria para las transacciones de gasto.',
    toast_tx_added:'Transacci\u00f3n a\u00f1adida \u2713',toast_tx_updated:'Actualizado \u2713',toast_tx_deleted:'Eliminado',
    toast_period_updated:'Per\u00edodo actualizado \u2713',toast_period_error:'La fecha de fin debe ser posterior a la fecha de inicio',
    toast_currency_updated:'Moneda actualizada \u2713',toast_imported:'{0} importado(s) \u2713',
    toast_fund_created:'Fondo creado \u2713',toast_fund_updated:'Fondo actualizado \u2713',
    toast_fund_contrib:'{amt} a\u00f1adido a {name} \u2713',
    toast_sub_added:'Suscripci\u00f3n a\u00f1adida \u2713',toast_sub_updated:'Suscripci\u00f3n actualizada \u2713',
    toast_alloc_enabled:'Distribuci\u00f3n activada \u2713',toast_alloc_disabled:'Distribuci\u00f3n desactivada',
    toast_lang_updated:'Idioma actualizado \u2713',toast_export:'Exportado \u2713',
    toast_saved:'Guardado \u2713',toast_reset:'Todos los datos borrados',toast_alloc_bucket_added:'Segmento a\u00f1adido \u2713',
    confirm_remove_cat:'\u00bfEliminar esta categor\u00eda?',confirm_delete_all_tx:'\u00bfEliminar TODAS las transacciones? Esto no se puede deshacer.',
    confirm_delete_tx:'\u00bfEliminar esta transacci\u00f3n?',confirm_remove_debt:'\u00bfEliminar esta deuda?',
    confirm_delete_fund:'\u00bfEliminar este fondo?',confirm_remove_sub:'\u00bfEliminar esta suscripci\u00f3n?',
    confirm_reset_1:'\u00bfEst\u00e1s seguro? Todos los datos se eliminar\u00e1n permanentemente.',
    confirm_reset_2:'\u00daltima oportunidad - no se puede deshacer. \u00bfContinuar?',
    export_csv_btn:'\uD83D\uDCE5 Exportar CSV',sett_export_title:'\uD83D\uDCE4 Exportar datos',
    sett_export_desc:'Descarga todas las transacciones como archivo CSV para copia de seguridad o uso en otra app.',
    sf_add_contribution:'A\u00f1adir aportaci\u00f3n',sf_contribution_label:'Importe a a\u00f1adir',sf_currently_saved:'Actualmente ahorrado',
    tx_search_ph:'Buscar por descripci\u00f3n o categor\u00eda\u2026',tx_filter_all_types:'Todos los tipos',tx_filter_all_alloc:'Todas las distribuciones',
    tx_sort_date_new:'M\u00e1s reciente primero',tx_sort_date_old:'M\u00e1s antiguo primero',tx_sort_amt_high:'Mayor importe',tx_sort_amt_low:'Menor importe',
    tx_showing:'Mostrando {n} de {total}',tx_no_results:'Ninguna transacci\u00f3n coincide con tu filtro.',
    alloc_add_bucket:'+ A\u00f1adir segmento',alloc_remove_btn:'Eliminar',alloc_total_label:'Total',alloc_new_bucket:'Nuevo segmento',alloc_color_title:'Elegir un color',alloc_custom_color:'Otro',alloc_min_buckets:'Se requieren al menos 2 segmentos',
    alloc_auto_tag:'Etiquetado autom\u00e1tico \u2192 {name}',
    tx_prev:'\u2190 Ant.',tx_next:'Sig. \u2192',tx_page_of:'P\u00e1gina {n} de {total}',
    debt_due_day_note:'Los d\u00edas 29-31 no aparecen en meses cortos',
    sub_advanced:'Fecha de facturaci\u00f3n avanzada al {date}',
    sf_days_left:'{n} d\u00edas restantes',sf_days_overdue:'{n} d\u00edas de retraso',
    sf_due_today:'\u00a1Hoy!',sf_target_complete:'\u00a1Objetivo alcanzado! \u2713',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs Per\u00edodo anterior',dash_compare_no_data:'Sin datos del per\u00edodo anterior',
    recurring_title:'Transacciones automáticas',recurring_desc:'Crea transacciones que se repiten (ejemplo: alquiler, salario o suscripciones). Se añaden automáticamente a tu lista en cada fecha de vencimiento.',recurring_add_rule:'+ A\u00f1adir transacci\u00f3n autom\u00e1tica',
    recurring_empty:'A\u00fan no se han a\u00f1adido transacciones autom\u00e1ticas.',recurring_label_ph:'Nombre de la transacción (p.ej. Netflix)',
    recurring_freq:'Frecuencia',freq_daily:'Diario',freq_weekly:'Semanal',
    freq_monthly:'Mensual',freq_quarterly:'Trimestral',freq_annual:'Anual',
    recurring_next_due:'Pr\u00f3ximo vencimiento',recurring_generated:'{0} nuevas transacciones automatizadas',
    recurring_remove:'Eliminar regla',recurring_paused:'En pausa',recurring_active:'Activo',recurring_saved:'Transacción automática guardada ✓',dpc_add_debt_title:'Añadir deuda',dpc_edit_debt_title:'Editar deuda',debt_due_day_modal_hint:'El día del mes en que vence este pago',toast_debt_added:'Deuda añadida',toast_debt_updated:'Deuda actualizada',sf_billing_day_label:'Día de cargo del mes',sf_billing_day_hint:'El día del mes en que se registra la contribución automáticamente',sf_error_required:'Por favor, completa todos los campos obligatorios',sub_active:'Activo',sub_paused:'Pausado',sub_desc:'Controla cada pago recurrente y comprende tu coste anual real. Pausa las suscripciones que no uses para mantener los gastos bajo control.',sub_add_btn:'+ Añadir suscripción',sub_add_title:'Añadir suscripción',sub_edit_title:'Editar suscripción',sub_empty_title:'Aún no hay suscripciones.',sub_empty_sub:'Añade tus pagos recurrentes - Netflix, Spotify, el gimnasio, etc.',sub_sum_monthly:'Total mensual',sub_sum_annual:'Total anual',sub_by_category:'Por categoría',sub_per_month:'/mes',sub_next_label:'Próximo',sub_name_label:'Nombre de la suscripción',sub_name_ph:'ej. Netflix',sub_amount_label:'Importe',sub_freq_label:'Frecuencia de facturación',sub_freq_monthly:'Mensual',sub_freq_annual:'Anual',sub_freq_quarterly:'Trimestral',sub_freq_weekly:'Semanal',sub_unit_month:'mes',sub_unit_year:'año',sub_unit_quarter:'trimestre',sub_cat_label:'Categoría',sub_date_label:'Próxima fecha de facturación',sub_cat_entertainment:'Entretenimiento',sub_cat_productivity:'Productividad',sub_cat_health:'Salud y ejercicio',sub_cat_food:'Comida y bebida',sub_cat_cloud:'Almacenamiento en la nube',sub_cat_finance:'Finanzas',sub_cat_education:'Educación',sub_cat_gaming:'Videojuegos',sub_cat_news:'Noticias y medios',sub_cat_other:'Otro',help_sub_intro:'Controla cada pago recurrente y comprende tu coste mensual y anual real. Las suscripciones que consumen tu cuenta en silencio son fáciles de pasar por alto - esto las mantiene visibles.',help_sub_how_h:'Añadir una suscripción',help_sub_step1:'Haz clic en + Añadir suscripción',help_sub_step2:'Introduce el nombre, el importe y la frecuencia de facturación (mensual, anual, trimestral, semanal)',help_sub_step3:'Elige una categoría para agrupar suscripciones similares',help_sub_step4:'Define la próxima fecha de facturación - aparecerá en el calendario inteligente',help_sub_monthly_h:'Equivalente mensual',help_sub_monthly_p:'Las suscripciones anuales y trimestrales se convierten a un coste mensual para que veas tu gasto mensual real de un vistazo.',help_sub_pause_h:'Pausar suscripciones',help_sub_pause_p:'Desactiva el interruptor Activo de cualquier suscripción que no estés usando. No contará en tus totales hasta que vuelvas a activarlo.',help_sub_chart_h:'Gráfico por categoría',help_sub_chart_p:'El gráfico circular muestra cómo se reparte tu gasto en suscripciones por categoría - pasa el cursor sobre un segmento para ver los detalles.',help_sub_tip:'💡 Activa «Automatizar» en una suscripción para que se añada automáticamente a tus transacciones en cada ciclo de facturación.',automate_auto_pay:'Pago auto',sf_auto_contribute:'Auto-contribución',sf_auto_need_amount:'Primero añade un importe y fecha objetivo',sf_auto_set:'Contribución mensual: {0}',automate_label:'Automatizar',automate_hint:'Lo añade a tus transacciones automáticamente según el calendario',automate_hint_off:'Activa la Automatización en Ajustes para usarlo',automate_th:'Pago auto',automate_need_amount:'Primero establece un pago mínimo',automate_payment_word:'pago',automate_linked:'Transacción automática vinculada',sf_contribution_label:'Contribución mensual',sf_contribution_hint:'Se registra automáticamente cada mes para aumentar este fondo',sett_automation_h:'Automatización',sett_automation_desc:'Interruptor principal de las transacciones automáticas. Si está apagado, no se generan transacciones programadas y las opciones de automatización se desactivan.',sett_automation_toggle:'Transacciones automáticas',sett_automation_hint:'Se aplica a transacciones, suscripciones, fondos y deudas',
    tx_type_sinking_fund:'Fondo objetivo',
    help_dash_alloc_h:'Panel de distribución presupuestaria',
    help_dash_alloc_what_h:'Qué es',
    help_dash_alloc_what_p:'Hace un seguimiento de tus gastos en relación con porcentajes objetivo personalizables de tus ingresos. La clásica regla 50/30/20 divide los ingresos en: Necesidades (esenciales: alquiler, comida, facturas), Deseos (estilo de vida: restaurantes, streaming, hobbies) y Ahorro (crear patrimonio y pagar deudas). Puedes establecer cualquier reparto - los porcentajes solo deben sumar 100%.',
    help_dash_alloc_tag_h:'Etiquetar transacciones',
    help_dash_alloc_tag_p:'Al registrar una transacción, elige una distribución (Necesidad / Deseo / Ahorro) en el desplegable. Los ingresos y las contribuciones de ahorro no se etiquetan. Un badge ? en una fila significa que ese gasto aún no está etiquetado.',
    help_dash_alloc_read_h:'Leer las tarjetas',
    help_dash_alloc_read_p:'Cada tarjeta muestra el nombre del segmento, tu % objetivo y tu % real de los ingresos del período. La barra delgada se llena proporcionalmente - cuando está llena, has alcanzado tu límite.',
    help_dash_alloc_col_h:'Código de color',
    help_dash_alloc_col_over:'Rojo - has superado el objetivo. El porcentaje y la barra se vuelven rojos.',
    help_dash_alloc_col_near:'Naranja - dentro de 5 puntos porcentuales del objetivo. Un aviso de que te estás acercando.',
    help_dash_alloc_col_norm:'Color del segmento - cómodamente dentro de tu objetivo para este período.',
    help_dash_alloc_setup_h:'Personalizar',
    // Penny (asistente IA)
    sett_penny_h:'Penny (Asistente de presupuesto con IA)',
    sett_penny_desc:'Pregúntale a Penny sobre tu presupuesto & tus hábitos de gasto',
    sett_penny_toggle:'Activar Penny',
    sett_penny_hint:'Activa la asistente Penny y su icono en la barra de navegación.',
    sett_penny_key_label:'Clave de API de Gemini',
    sett_penny_key_placeholder:'Pega tu clave de API de Gemini',
    sett_penny_howto:'Cómo crear mi clave',
    sett_penny_save_btn:'Guardar clave',
    sett_penny_key_saved:'Clave de API de Gemini guardada y cifrada',
    sett_penny_remove:'Eliminar clave',
    sett_penny_available:'Penny ya está disponible en el menú de navegación.',
    sett_penny_usage_count:'Penny ha respondido {0} preguntas este mes',
    sett_penny_key_error_short:'Eso no parece una clave válida. Revísala e inténtalo de nuevo.',
    confirm_penny_remove_key:'¿Eliminar tu clave de API de Gemini guardada? Penny se desactivará hasta que agregues una nueva.',
    toast_penny_key_saved:'Clave de Gemini guardada de forma segura.',
    penny_nav_pill_off:'Activar Penny',
    penny_nav_pill_on:'Preguntar a Penny',
    penny_nav_aria_off:'Activar Penny',
    penny_nav_aria_on:'Preguntar a Penny',
    penny_chat_title:'Preguntar a Penny',
    penny_input_placeholder:'Pregunta sobre tu presupuesto…',
    penny_send:'Preguntar',
    penny_thinking:'Penny está pensando…',
    penny_voice_on:'Respuestas por voz activadas',
    penny_voice_off:'Respuestas por voz desactivadas',
    penny_disclaimer:'Tu propia asistente de presupuesto con IA',
    penny_no_key_notice:'Añade tu clave de API de Gemini en Ajustes para empezar a chatear con Penny.',
    penny_open_settings:'Abrir ajustes',
    penny_close:'Cerrar Penny',
    penny_qp_leftover:'¿Cuánto me queda en este período?',
    penny_qp_top_category:'¿Cuál es mi mayor categoría de gasto?',
    penny_qp_on_track:'¿Voy bien con mi presupuesto?',
    penny_qp_subscriptions:'¿Cuánto pago en suscripciones?',
    penny_qp_debt:'¿Cómo va el pago de mis deudas?',
    penny_qp_chart:'Muéstrame un gráfico de mis gastos',
    penny_err_invalid_key:'Tu clave de API de Gemini parece inválida o ha sido revocada. Actualízala en Ajustes.',
    penny_err_rate_limited:'Has alcanzado el límite de solicitudes de Gemini por ahora. Es un límite de Google sobre tu clave, no el contador de arriba. Espera un poco e inténtalo de nuevo.',
    penny_err_network:'Penny no pudo conectarse con los servidores de Google. Revisa tu conexión e inténtalo de nuevo.',
    penny_err_blocked:'Penny no pudo dar una respuesta segura a eso. Intenta reformular tu pregunta sobre tu presupuesto.',
    penny_err_unknown:'Algo salió mal del lado de Penny. Inténtalo de nuevo en un momento.',
    penny_err_key_unreadable:'No se pudo leer tu clave guardada. Vuelve a introducirla en Ajustes.',
    penny_err_retry:'Reintentar',
    help_sett_penny_p:'Activa Penny abajo para hacer preguntas sobre tu presupuesto en lenguaje sencillo. Toca «Cómo crear mi clave» para ver los pasos de configuración.',
    help_penny_title:'Configurar a Penny',
    help_penny_intro:'Penny es la asistente de IA de Evo Budget. Como esta app no tiene servidor propio, Penny habla directamente desde tu navegador con Google usando tu propia clave de API de Gemini gratuita. Nada pasa nunca por un servidor de Evo Budget, porque no existe ninguno.',
    help_penny_steps_h:'Cómo crear tu clave',
    help_penny_step1:'Ve a Google AI Studio (aistudio.google.com/apikey) e inicia sesión con una cuenta de Google.',
    help_penny_step2:'Haz clic en «Crear clave de API» (elige «Crear clave en un proyecto nuevo» si aún no tienes uno).',
    help_penny_step3:'Copia la clave generada (empieza con AIza…).',
    help_penny_step4:'Pégala en el campo «Clave de API de Gemini» en los Ajustes de Evo Budget y haz clic en «Guardar clave».',
    help_penny_cost_h:'¿Esto es gratis?',
    help_penny_cost_p:'La API de Gemini tiene un nivel gratuito con límites establecidos por Google, que pueden cambiar. Consulta tus límites actuales en cualquier momento en aistudio.google.com. El contador de «preguntas realizadas» que ves en Ajustes es un contador personal guardado en tu propio dispositivo para tu información. No refleja en tiempo real tu cuota de Google.',
    help_penny_safety_h:'¿Mi clave está segura?',
    help_penny_safety_p:'Tu clave se cifra antes de guardarse en el almacenamiento de tu propio navegador, y solo se envía directamente a la API de Google cuando le haces una pregunta a Penny. Nunca se envía a un servidor de Evo Budget.',
    help_penny_cta:'Abrir Google AI Studio →',
    help_dash_alloc_setup_p:'Abre Ajustes \u2192 Distribución del gasto. Edita los nombres de los segmentos, ajusta los porcentajes y activa o desactiva el panel. Los porcentajes deben sumar 100%.',
    // Guide
    guide_group_start:'Primeros pasos', guide_group_track:'Controla tu dinero', guide_group_plan:'Planifica en grande',
    guide_group_smart:'Trabaja de forma más inteligente', guide_group_settings:'A tu manera',
    guide_section_big:'La idea general', guide_section_how:'Cómo usarlo', guide_section_connects:'Cómo se conecta', guide_back:'Volver a los temas',
    guide_welcome_title:'Bienvenido a Ultimate Budget Planner',
    guide_welcome_big:'Ultimate Budget Planner toma la idea simple de seguir ingresos y gastos y le da superpoderes - un plan real para pagar deudas, metas de ahorro con barras de progreso, un calendario con vista panorámica, seguimiento de suscripciones y Penny, una asistente de IA que ya conoce tus números. Empieza por el Panel y explora el resto cuando estés listo.',
    guide_dashboard_title:'Panel',
    guide_dashboard_big:'El Panel es tu centro de control - todo lo importante sobre tu dinero vive en esta única pantalla, desde tu resultado final hasta lo que se avecina esta semana.',
    guide_dashboard_step1:'Revisa las tarjetas de resumen arriba para tu <strong>Ingreso total</strong>, tu <strong>Gasto total</strong>, tu <strong>Tasa de ahorro</strong> y tu <strong>Sobrante neto</strong>.',
    guide_dashboard_step2:'Consulta la lista <strong>Próximamente</strong> para ver todo lo que vence en los próximos 7 días - facturas, pagos de deudas y suscripciones, todo en un solo lugar.',
    guide_dashboard_step3:'Revisa tus resúmenes de <strong>Pago de deudas</strong> y <strong>Fondos de reserva</strong> para ver de un vistazo el progreso hacia tus metas más grandes.',
    guide_dashboard_connect1:'Cada cifra aquí proviene en vivo de Transacciones, Presupuesto, Pago de deudas, Fondos de reserva y Suscripciones - no hay nada que calcular a mano.',
    guide_dashboard_connect2:'El Sobrante neto incluye tu ajuste de <strong>Saldo anterior</strong>, así que el dinero no gastado del período previo puede pasar automáticamente.',
    guide_dashboard_connect3:'Si algo no cuadra, casi siempre vale la pena revisar la página de origen - el Panel es un espejo, no una fuente.',
    guide_dashboard_tip:'Dedica 30 segundos cada mañana a repasar el Panel - es la forma más rápida de detectar una factura o pago de deuda antes de que se retrase.',
    guide_transactions_title:'Transacciones',
    guide_transactions_big:'Las transacciones son la base de todo en esta app - cada euro que registras aquí impulsa tu Panel, tu presupuesto y cada gráfico que ves. Ultimate Budget Planner también te permite automatizar las partes repetitivas para que no tengas que registrar lo mismo cada período.',
    guide_transactions_step1:'Toca <strong>Agregar transacción</strong>, elige un tipo y una categoría, y completa el importe.',
    guide_transactions_step2:'Configura una <strong>Regla recurrente</strong> para todo lo que se repite, como el alquiler o el sueldo, para que se registre automáticamente en lugar de escribirlo cada vez.',
    guide_transactions_step3:'Usa <strong>Importar CSV</strong> para traer gastos existentes de una sola vez en lugar de ingresarlos a mano.',
    guide_transactions_step4:'Toca cualquier transacción para editarla, o usa los filtros sobre la lista para encontrar una rápidamente.',
    guide_transactions_connect1:'Las reglas recurrentes configuradas aquí impulsan la función <strong>Automatización</strong> - una vez que existe una regla, sigue registrándose según lo previsto sin que muevas un dedo.',
    guide_transactions_connect2:'Cada transacción cuenta automáticamente para la categoría correspondiente en Presupuesto, Pago de deudas o Suscripciones.',
    guide_transactions_connect3:'Los totales y gráficos de tu Panel se construyen enteramente a partir de lo registrado aquí.',
    guide_transactions_tip:'Configura primero las reglas recurrentes para tus facturas habituales y tu sueldo - es el mayor ahorro de tiempo de toda la app.',
    guide_budget_title:'Presupuesto',
    guide_budget_big:'Presupuesto es donde fijas tus metas - cuánto esperas ganar y gastar en Ingresos, Gastos, Facturas y Ahorros - todo desde una sola pantalla en lugar de saltar entre pestañas separadas.',
    guide_budget_step1:'Agrega una categoría bajo <strong>Ingresos</strong>, <strong>Gastos</strong>, <strong>Facturas</strong> o <strong>Ahorros</strong> y fija su importe <strong>Esperado</strong>.',
    guide_budget_step2:'A medida que registras transacciones, observa cómo se llena automáticamente la columna <strong>Real</strong> para cada categoría.',
    guide_budget_step3:'Compara Esperado con Real para ver qué categorías van bien y cuáles necesitan atención.',
    guide_budget_step4:'Ajusta cualquier importe Esperado cuando tu vida cambie - tu presupuesto debe adaptarse a ti, no al revés.',
    guide_budget_connect1:'Cada transacción que registras en Transacciones fluye directamente a la categoría correspondiente aquí.',
    guide_budget_connect2:'Tu gráfico de Distribución del gasto y tu Sobrante neto en el Panel se construyen a partir de estas categorías.',
    guide_budget_connect3:'Si has activado <strong>Distribución por porcentajes</strong> en Ajustes, aquí también verás cómo se compara tu gasto con esas metas porcentuales.',
    guide_budget_tip:'Revisa tus importes Esperados una vez al mes - un presupuesto que nunca cambia deja de reflejar la realidad bastante rápido.',
    guide_debt_title:'Calculadora de pago de deudas',
    guide_debt_big:'Esto es más que un registro de lo que debes - te construye un plan real para quedar libre de deudas, mostrando exactamente qué deuda priorizar primero y cuánto interés ahorrarás haciéndolo.',
    guide_debt_step1:'Agrega cada deuda con su <strong>Saldo</strong>, su <strong>Tasa</strong> (interés) y su <strong>Pago mínimo</strong>.',
    guide_debt_step2:'Elige una estrategia: <strong>Bola de nieve</strong> (pagar primero el saldo más pequeño para ganar impulso) o <strong>Avalancha</strong> (pagar primero la tasa más alta para ahorrar más).',
    guide_debt_step3:'Agrega cualquier importe extra que puedas destinar a deudas cada período - la calculadora lo aplica a la deuda que tu estrategia prioriza primero.',
    guide_debt_step4:'Revisa tu <strong>fecha estimada sin deudas</strong> y el interés total para ver cómo cambian las cosas con pagos extra.',
    guide_debt_step5:'Para hipotecas y préstamos, define un <strong>plazo</strong> y haz clic en <strong>Calcular automáticamente</strong> para un pago mínimo preciso. Para tarjetas de crédito, cambia a <strong>% del saldo</strong> para igualar tu estado de cuenta real.',
    guide_debt_step6:'Algunos préstamos usan <strong>cuotas decrecientes</strong> en lugar de cuotas iguales - la parte de capital se mantiene fija y la cuota total disminuye con el tiempo. Revisa el <strong>tipo de amortización</strong> para que coincida con tu préstamo.',
    guide_debt_step7:'Para una tasa variable, cambia el <strong>tipo de tasa</strong> a "Se ajusta después de un período fijo" y define cuándo cambia. Para un depósito en garantía hipotecario que disminuye con el tiempo, cambia el <strong>tipo de depósito en garantía</strong> a "Decreciente con el saldo".',
    guide_debt_step8:'Haz clic en el <strong>ícono ℹ️ de información</strong> de cualquier deuda para ver su cronograma de pagos mensual completo. Usa la columna <strong>Extra/mes</strong> para dirigir pagos extra hacia una deuda específica, sin importar tu orden de bola de nieve/avalancha.',
    guide_debt_connect1:'Los pagos de deuda que registras en Transacciones cuentan para el saldo de cada deuda aquí.',
    guide_debt_connect2:'Tu Panel muestra un resumen de este plan de pago para que siempre sepas dónde estás sin abrir esta página.',
    guide_debt_connect3:'Pagar más del mínimo aquí - incluso un poco más - suele ser la mejor palanca para acortar tu calendario de pago.',
    guide_debt_tip:'Prueba a alternar entre Bola de nieve y Avalancha para comparar - Bola de nieve motiva más al principio, pero Avalancha suele ahorrar más dinero en total.',
    guide_sinking_title:'Fondos de reserva',
    guide_sinking_big:'Un fondo de reserva es dinero que apartas poco a poco para algo específico que sabes que se acerca - unas vacaciones, una laptop nueva, regalos - así nunca se convierte en una emergencia cuando el gasto realmente llega.',
    guide_sinking_step1:'Crea un fondo y dale un <strong>Importe objetivo</strong> y, si quieres, una fecha objetivo.',
    guide_sinking_step2:'Agrega aportes cada vez que apartes dinero para él, y observa cómo se llena la <strong>barra de progreso</strong>.',
    guide_sinking_step3:'Una vez que un fondo alcanza su objetivo, estás listo para ese gasto sin tocar tu presupuesto habitual.',
    guide_sinking_connect1:'Los fondos de reserva son distintos de tu categoría de Ahorros habitual - sirven para metas específicas y planeadas en lugar de un ahorro general.',
    guide_sinking_connect2:'Tu Panel muestra un resumen del progreso de todos tus fondos en un solo lugar.',
    guide_sinking_connect3:'Aportar a un fondo con regularidad, incluso un importe pequeño, convierte un gasto grande en algo que nunca descarrila tu presupuesto.',
    guide_sinking_tip:'Divide las metas grandes en importes mensuales redondos - es mucho más fácil comprometerse a 50 € al mes que a "ahorrar para unas vacaciones algún día".',
    guide_subscriptions_title:'Suscripciones',
    guide_subscriptions_big:'Las suscripciones tienden a acumularse silenciosamente - esta página lista cada servicio recurrente que pagas en un solo lugar, para que nada te siga cobrando sin que lo sepas.',
    guide_subscriptions_step1:'Agrega cada suscripción junto con su costo y frecuencia de facturación (mensual, anual, etc.).',
    guide_subscriptions_step2:'Revisa el total de <strong>Costo mensual</strong> para ver a cuánto suman todas tus suscripciones.',
    guide_subscriptions_step3:'Pausa o cancela lo que no uses, directamente desde esta página.',
    guide_subscriptions_connect1:'El costo total de tus suscripciones alimenta directamente el resumen de tu Panel y tu Gasto total.',
    guide_subscriptions_connect2:'Los vencimientos de suscripciones también aparecen en el Calendario, para verlos junto con facturas y pagos de deudas.',
    guide_subscriptions_connect3:'Revisar esta lista cada pocos meses es una de las formas más fáciles de encontrar dinero que no sabías que estabas perdiendo.',
    guide_subscriptions_tip:'Haz una revisión de suscripciones justo después de recibir tu estado de cuenta cada mes - es el momento más fácil para detectar algo que olvidaste que estabas pagando.',
    guide_calendar_title:'Calendario',
    guide_calendar_big:'El Calendario reúne cada factura, pago de deuda, cargo de suscripción y transacción en una vista mensual, para que veas todo lo que pasa con tu dinero de un vistazo en lugar de revisar cinco páginas distintas.',
    guide_calendar_step1:'Navega a cualquier mes para ver puntos de colores que marcan facturas, pagos de deudas y suscripciones que vencen ese día.',
    guide_calendar_step2:'Toca un día para ver la lista completa de todo lo que ocurre en él.',
    guide_calendar_step3:'Usa esta vista antes de una compra importante para ver qué más vence alrededor de la misma fecha.',
    guide_calendar_connect1:'Todo lo que se muestra aquí proviene de Facturas, Pago de deudas, Suscripciones y Transacciones - el Calendario no guarda datos propios.',
    guide_calendar_connect2:'Es la forma más rápida de detectar una semana en la que varios vencimientos caen cerca unos de otros, antes de que te tome por sorpresa.',
    guide_calendar_connect3:'Nada de lo que hagas en el Calendario cambia tu presupuesto - es una vista pura, así que es totalmente seguro explorarlo.',
    guide_calendar_tip:'Revisa el Calendario al inicio de cada semana - toma unos segundos y los vencimientos ya nunca son una sorpresa.',
    guide_rollover_title:'Saldo anterior',
    guide_rollover_big:'Saldo anterior significa que el dinero no gastado del período previo no simplemente desaparece - pasa automáticamente y se suma a lo que tienes disponible este período.',
    guide_rollover_step1:'Abre <strong>Ajustes</strong> y busca la tarjeta de <strong>Saldo anterior</strong>.',
    guide_rollover_step2:'Actívalo para que cualquier importe sobrante del período previo pase automáticamente al nuevo.',
    guide_rollover_step3:'Revisa el Sobrante neto de tu Panel - ahora incluirá ese importe traspasado.',
    guide_rollover_connect1:'El Saldo anterior funciona directamente con tu Sobrante neto del período previo - cuanto mejor sigas tu presupuesto, más tendrá para traspasar.',
    guide_rollover_connect2:'Esto es distinto de los Fondos de reserva, que sirven para metas futuras planeadas - el Saldo anterior solo se trata de no perder de vista el dinero que ya tienes.',
    guide_rollover_connect3:'Una racha de buenos meses se acumula bien aquí, ya que el sobrante de cada período se suma al siguiente.',
    guide_rollover_tip:'Si un importe grande de saldo anterior te quema en el bolsillo, considera mover parte de él a un Fondo de reserva para que quede destinado a algo específico.',
    guide_automation_title:'Automatización',
    guide_automation_big:'Automatización toma las reglas recurrentes que configuraste en Transacciones y las registra automáticamente por ti, para que tus facturas, sueldos y suscripciones habituales aparezcan justo a tiempo sin que muevas un dedo.',
    guide_automation_step1:'Abre <strong>Ajustes</strong> y busca la tarjeta de <strong>Automatización</strong>.',
    guide_automation_step2:'Actívala para que las reglas de transacción recurrentes se registren automáticamente cuando vencen.',
    guide_automation_step3:'Revisa después Transacciones para confirmar que todo se registró como esperabas.',
    guide_automation_connect1:'Esta función solo funciona con reglas recurrentes que ya hayas creado en Transacciones - configúralas primero.',
    guide_automation_connect2:'Cada transacción que registra fluye a Presupuesto, Pago de deudas y Suscripciones exactamente igual que una ingresada a mano.',
    guide_automation_connect3:'Es la diferencia entre una app de presupuesto que tienes que recordar actualizar, y una que se mantiene al día sola.',
    guide_automation_tip:'Activa la Automatización una vez que tus reglas recurrentes te parezcan correctas - es más útil cuando confías en los números que va a registrar.',
    guide_penny_title:'Penny',
    guide_penny_big:'Penny es tu propia asistente de IA para el presupuesto, integrada directamente en la app - hazle una pregunta sobre tu dinero en lenguaje sencillo, y ella lee tus datos reales de presupuesto para darte una respuesta real, con gráficos cuando ayuda.',
    guide_penny_step1:'Abre <strong>Ajustes</strong>, activa Penny, y pega tu propia clave de API de Gemini (hay un enlace justo ahí que muestra exactamente cómo conseguir una gratis).',
    guide_penny_step2:'Toca el ícono de destello en la navegación superior para abrir el chat.',
    guide_penny_step3:'Haz una pregunta con tus propias palabras, como "¿cuál es mi mayor categoría de gasto este mes?", o toca uno de los botones de pregunta rápida para empezar.',
    guide_penny_step4:'Activa o desactiva su respuesta por voz con el ícono de altavoz si prefieres escuchar en vez de leer.',
    guide_penny_connect1:'Penny solo puede leer tus datos de presupuesto para responder preguntas - nunca puede agregar, editar ni eliminar nada por ti.',
    guide_penny_connect2:'Consulta directamente el Panel, Transacciones, Pago de deudas, Suscripciones y Fondos de reserva, así que sus respuestas siempre coinciden con lo que verías tú mismo en esas páginas.',
    guide_penny_connect3:'Tu clave de API se cifra y se guarda solo en tu propio dispositivo - nunca se envía a ningún lado excepto directamente a Google cuando le haces una pregunta a Penny.',
    guide_penny_tip:'Empieza con uno de los botones de pregunta rápida la primera vez - es la forma más rápida de ver lo que puede hacer antes de hacer tus propias preguntas.',
    guide_settings_title:'Ajustes',
    guide_settings_big:'Ajustes es donde la app se adapta a ti - moneda, período de presupuesto, saldo anterior, automatización, apariencia, idioma y cómo se guardan y respaldan tus datos.',
    guide_settings_step1:'Elige tu <strong>Moneda</strong> y tu <strong>Período de presupuesto</strong> para que la app coincida con tu ritmo real de pago y gasto.',
    guide_settings_step2:'Activa <strong>Saldo anterior</strong> y <strong>Automatización</strong> si quieres que el dinero no gastado y las transacciones recurrentes se manejen automáticamente por ti.',
    guide_settings_step3:'Cambia la <strong>Apariencia</strong> entre clara y oscura, y elige tu <strong>Idioma</strong> de la lista.',
    guide_settings_step4:'Configura la <strong>Distribución por porcentajes</strong> si prefieres presupuestar por porcentaje (como 50% necesidades, 30% deseos, 20% ahorro) en lugar de importes fijos por categoría.',
    guide_settings_step5:'Elige cómo se guardan tus datos en <strong>Datos y sincronización</strong> - localmente en este dispositivo, o sincronizados con Google Drive para que te sigan a otros dispositivos.',
    guide_settings_step6:'Usa <strong>Exportar datos</strong> para respaldar todo, o <strong>Restablecer datos</strong> si alguna vez quieres empezar completamente de cero.',
    guide_settings_connect1:'Tus elecciones de Moneda, Período de presupuesto, Saldo anterior y Automatización aquí determinan cómo cada otra página de la app calcula y muestra los números.',
    guide_settings_connect2:'Activar la sincronización con Google aquí permite que tus datos te sigan si abres la app en otro dispositivo.',
    guide_settings_connect3:'Exportar tus datos aquí es el hábito más seguro antes de hacer cualquier cambio importante del que no estés seguro.',
    guide_settings_tip:'Configura Moneda, Período de presupuesto y Datos y sincronización primero, antes que cualquier otra cosa - son la base sobre la que se construye todo lo demás en la app.',
  },
  it: {
    lang_name:'Italiano',
    tab_dashboard:'Dashboard',tab_budget:'Budget',tab_transactions:'Transazioni',
    tab_income:'Entrate',tab_expenses:'Spese',tab_bills:'Bollette',
    tab_debt:'Debiti',tab_savings:'Risparmi',tab_settings:'Impostazioni',
    tab_debt_payoff:'Estinzione debiti',tab_sinking:'Accantonamenti',
    tab_calendar:'Calendario',tab_subscriptions:'Abbonamenti',
    total_income:'Entrate totali',expenses_bills:'Spese e bollette',
    debt_payments:'Pagamenti debiti',total_savings:'Risparmi totali',
    total_outgoing:'Uscite totali',savings_rate:'Tasso di risparmio',
    net_leftover:'Saldo netto',cash_flow:'Flusso di cassa',
    income_sources:'Fonti di reddito',spending_breakdown:'Ripartizione spese',
    expected:'Previsto',actual:'Effettivo',
    of:'di',budgeted:'preventivato',saved:'risparmiato',
    budget_period:'Periodo di budget',start_date:'Data inizio',end_date:'Data fine',
    this_month:'Questo mese',this_week:'Questa settimana',last_week:'Sett. scorsa',last_month:'Mese scorso',last_30_days:'Ultimi 30 giorni',this_quarter:'Questo trimestre',this_year:'Quest\u2019anno',
    currency:'Valuta',rollover:'Riporto',appearance:'Aspetto',
    language:'Lingua',reset_data:'Reimposta dati',
    light:'Chiaro',dark:'Scuro',
    changes_autosaved:'✅ Le modifiche vengono salvate automaticamente.',
    rollover_desc:'Riporta il denaro non speso dal periodo precedente.',
    rollover_amount:'Importo riporto',
    reset_desc:'Elimina definitivamente tutti i dati. Non reversibile.',
    reset_btn:'Reimposta tutto',
    add:'Aggiungi',cancel:'Annulla',rename_title_prompt:'Rinomina il tuo pianificatore di budget',save:'Salva',delete:'Elimina',dp_today:'Oggi',dp_clear:'Cancella',edit:'Modifica',
    paid:'Pagato',due_date:'Data di scadenza',category:'Categoria',amount:'Importo',
    description:'Descrizione',date:'Data',type:'Tipo',
    add_category:'+ Aggiungi categoria',no_transactions:'Nessuna transazione.',
    upgrade_title:"Pronto per l'esperienza pro?",
    upgrade_desc:'Sblocca il calcolatore di estinzione debiti, accantonamenti, calendario intelligente e monitoraggio abbonamenti.',
    upgrade_now:'Aggiorna ora →',
    mon:'Lun',tue:'Mar',wed:'Mer',thu:'Gio',fri:'Ven',sat:'Sab',sun:'Dom',
    quick_presets:'Selezione rapida:',select_currency:'Seleziona la tua valuta',select_language:'Seleziona lingua',
    appearance_desc:'Passa dalla modalità chiara a quella scura.',video_tutorial:'▶ Video Tutorial',
    help_sett_intro:'Tutte le tue preferenze per Ultimate Budget Planner. Le modifiche vengono salvate automaticamente man mano che le apporti.',
    help_sett_currency_p:"Modifica il simbolo di valuta ovunque nell'app immediatamente alla selezione.",
    help_sett_appearance_p:'Passa dalla modalità chiara a quella scura. Le tue preferenze vengono ricordate tra le sessioni.',
    help_sett_nav_h:'Navigazione',
    help_sett_nav_top:'Navigazione superiore - Barra a schede orizzontale classica in alto (predefinita).',
    help_sett_nav_side:'Navigazione laterale - Una barra di icone fluttuante a sinistra del tuo contenuto. Fai clic sulla freccia per espanderla e vedere le etichette complete.',
    help_sett_period_p:'L\'intervallo di date che definisce “questo budget”. Solo le transazioni in questo intervallo contano nei valori effettivi. Usa i 7 preset (Questo mese, Mese scorso, Questa settimana, Sett. scorsa, Ultimi 30 giorni, Questo trimestre, Quest’anno) per una configurazione rapida.',
    help_sett_rollover_p:'Qualsiasi denaro non speso che vuoi riportare dal periodo precedente. Viene aggiunto al tuo saldo netto nel pannello.',
    // Calendario
    cal_title:'Calendario intelligente',
    cal_desc:'Tutte le tue bollette, pagamenti debiti, abbonamenti e transazioni in un calendario live. Clicca su qualsiasi giorno per vedere i suoi eventi.',
    cal_prev:'\u2190 Prec.',cal_next:'Succ. \u2192',
    cal_all_events:'Tutti gli eventi - ',
    cal_no_events_day:'Nessun evento in questo giorno.',
    cal_no_events_month:'Nessun evento questo mese.',
    cal_no_events_sub:'Aggiungi bollette, debiti o abbonamenti per vederli qui.',
    cal_event_one:'evento',cal_event_many:'eventi',cal_clear:'Cancella \u00d7',
    cal_leg_bill:'Bolletta',cal_leg_debt:'Debito',cal_leg_sub:'Abbonamento',cal_leg_tx:'Transazione',cal_leg_sinking:'Fondo accantonamento',cal_leg_goal:'Data obiettivo',cal_leg_auto:'Automatico',
    cal_paid:'\u2713 Pagato',cal_unpaid:'Non pagato',
    help_cal_intro:'Il Calendario intelligente raccoglie tutti i tuoi impegni finanziari in una vista mensile - aggiornato automaticamente man mano che aggiungi dati.',
    help_cal_ev_types_h:'Tipi di eventi',
    help_cal_bill_li:'Bollette - dalla sezione Bollette del tuo budget (ricorrente mensilmente il giorno di scadenza impostato)',
    help_cal_debt_li:'Pagamenti debiti - dalla sezione Estinzione debiti (ricorrente il giorno di scadenza)',
    help_cal_sub_li:'Abbonamenti - dal tracker Abbonamenti (il giorno della prossima data di fatturazione)',
    help_cal_tx_li:'Transazioni - date in cui hai registrato entrate o spese',
    help_cal_nav_h:'Navigazione',
    help_cal_nav_p:'Usa \u2190 Prec. e Succ. \u2192 per spostarti tra i mesi. Clicca su qualsiasi giorno per vedere i suoi eventi. Clicca di nuovo o su \u00abCancella \u00d7\u00bb per deselezionare.',
    help_cal_tip:'\uD83D\uDCA1 Imposta date di scadenza su bollette e debiti per sfruttare al massimo il calendario.',
    sf_add_btn:'+ Aggiungi fondo',
    sf_desc:"Un fondo di accantonamento ti permette di risparmiare gradualmente per una grande spesa futura - nessuna sorpresa spiacevole. Imposta un obiettivo e una data, e ti diremo esattamente quanto risparmiare ogni mese.",
    sf_empty_title:'Nessun fondo di accantonamento ancora.',
    sf_empty_sub:'Ottimo per: vacanze, riparazioni auto, matrimoni, nuova tecnologia, bollette annuali.',
    sf_pct_complete:'completato',
    sf_save_prefix:'Risparmiare',sf_per_month:'/mese',
    sf_month_left_one:'mese rimasto',sf_month_left_many:'mesi rimasti',
    sf_total_contrib:'Contributi mensili totali necessari:',
    sf_modal_new:'🏺 Nuovo fondo di accantonamento',sf_modal_edit:'✏️ Modifica fondo',
    sf_fund_name_label:'Nome del fondo',sf_fund_name_ph:'es. Fondo vacanze',
    sf_icon_label:'Icona',sf_target_amount_label:'Importo obiettivo',
    sf_currently_saved_label:'Già risparmiato',sf_target_date_label:'Data obiettivo',
    sf_create_btn:'Crea fondo',
    help_sf_intro:"Un fondo di accantonamento è denaro messo da parte in anticipo per una grande spesa pianificata - nessuna sorpresa spiacevole all'arrivo della bolletta.",
    help_sf_how_to_h:'Come usarlo',
    help_sf_step1:'Clicca su + Aggiungi fondo',
    help_sf_step2:'Dai un nome al tuo fondo (es. "Vacanze estive"), scegli un\'icona',
    help_sf_step3:'Imposta un importo obiettivo (quanto ti serve in totale)',
    help_sf_step4:'Imposta una data obiettivo (quando hai bisogno dei soldi)',
    help_sf_step5:'Inserisci quanto hai già risparmiato',
    help_sf_reading_h:'Leggere la scheda',
    help_sf_reading_p:'Ogni scheda mostra il tuo risparmio vs obiettivo, una barra di avanzamento e esattamente quanto risparmiare al mese per raggiungere il tuo obiettivo in tempo.',
    help_sf_contrib_h:'Aggiungere contributi',
    help_sf_contrib_p:"Clicca sull'icona + su una scheda per registrare un contributo - inserisci l'importo che stai aggiungendo questo mese.",
    help_sf_tip:'\uD83D\uDCA1 Ottimo per: vacanze, riparazioni auto, assicurazioni annuali, matrimoni, elettronica, miglioramenti domestici.',
    dpc_title:'Calcolatore debiti',dpc_add_btn:'+ Aggiungi debito',
    dpc_desc:'Inserisci ogni debito, scegli una strategia di rimborso e scopri esattamente quando sarai libero dai debiti e quanti interessi pagherai in totale.',
    dpc_method_label:'Metodo di rimborso',
    dpc_snowball_desc:'Saldo più basso prima - le piccole vittorie ti mantengono motivato',
    dpc_avalanche_desc:'Tasso più alto prima - risparmia di più nel complesso',
    dpc_extra_label:'Pagamento mensile extra',
    dpc_extra_hint:'Importo sopra i tuoi pagamenti minimi da destinare ai debiti ogni mese.',
    dpc_empty_title:'Nessun debito aggiunto ancora.',
    dpc_empty_sub:'Clicca su «+ Aggiungi debito» per creare il tuo piano di rimborso.',
    dpc_th_name:'Debito',dpc_th_type:'Tipo',dpc_th_balance:'Saldo',
    dpc_th_apr:'TAEG %',dpc_th_min:'Pag. min.',dpc_th_due:'Giorno scad.',
    dpc_totals:'Totali',dpc_name_ph:'es. Carta Visa',
    dpc_term_label:'Durata del prestito (anni)',dpc_term_hint:'Imposta la durata di questo prestito, così il calcolo automatico può determinare una rata minima accurata.',
    dpc_autocalc_btn:'Calcola automaticamente',dpc_autocalc_done:'Calcolato: {0}/mese',
    dpc_min_mode_label:'Tipo di rata minima',dpc_min_mode_fixed:'Importo fisso',dpc_min_mode_percent:'% del saldo',
    dpc_min_percent_label:'Percentuale del saldo (%)',dpc_min_floor_label:'Importo minimo',
    dpc_min_calculated_hint:'Calcolato automaticamente - il valore più alto tra la percentuale e l’importo minimo.',
    dpc_escrow_label:'Deposito vincolato (tasse e assicurazione)',
    dpc_escrow_hint:'Si aggiunge al tuo costo mensile reale, ma è escluso dalla simulazione di rimborso poiché non riduce il saldo.',
    dpc_min_pct_caption:'{0}% del saldo',dpc_escrow_note:'{0} deposito vincolato',
    dpc_term_note_faster:'{0} mesi più veloce della tua durata di {1} anni',dpc_term_note_slower:'{0} mesi più lento della tua durata di {1} anni',
    dpc_term_note_onschedule:'perfettamente in linea con la tua durata di {0} anni',
    dpc_escrow_mode_label:'Tipo di deposito vincolato',dpc_escrow_mode_fixed:'Importo fisso',dpc_escrow_mode_declining:'Decrescente con il saldo',
    dpc_escrow_mode_hint:'Questo influisce solo sul piano di ammortamento qui sotto. Il tuo importo automatizzato e il totale della dashboard usano sempre l’importo fisso attuale del deposito vincolato.',
    dpc_rate_type_label:'Tipo di tasso',dpc_rate_type_fixed:'Fisso per tutta la durata',dpc_rate_type_arm:'Si adegua dopo un periodo fisso (tasso variabile)',
    dpc_rate_type_hint:'Un modello semplificato: un tasso per il periodo fisso, poi un unico nuovo tasso per il resto del prestito - non una simulazione completa di indice/tetto massimo.',
    dpc_arm_fixed_years_label:'Periodo a tasso fisso (anni)',dpc_arm_rate_label:'Tasso dopo l’adeguamento',
    dpc_arm_caption:'si adegua dopo {0} anni di periodo fisso',
    dpc_recalc_link:'↺ Ricalcola',
    dpc_th_extra:'Extra/mese',
    dpc_extra_col_hint:'Pagato in aggiunta alla rata minima di questo debito ogni mese, prima che il pagamento extra condiviso sopra venga distribuito. Si ferma una volta che questo debito è saldato - non viene reindirizzato altrove.',
    dpc_targeted_extra_note:'{0} extra mirato',
    dpc_schedule_btn_title:'Visualizza piano di ammortamento',
    dpc_amort_type_label:'Tipo di ammortamento',dpc_amort_equal_payment:'Rate costanti',dpc_amort_equal_principal:'Rate decrescenti (capitale costante)',
    dpc_amort_type_hint:'Con le rate costanti, il pagamento resta uguale ogni mese. Con le rate decrescenti, la quota capitale resta fissa, quindi la rata totale diminuisce nel tempo man mano che gli interessi calano - comune per alcuni mutui.',
    dpc_autocalc_done_declining:'Prima rata: {0}/mese (diminuisce ogni mese)',dpc_declining_caption:'rata decrescente',
    dtype_credit_card:'Carta di credito',dtype_student_loan:'Prestito studentesco',
    dtype_mortgage:'Mutuo',dtype_car_loan:'Prestito auto',
    dtype_personal_loan:'Prestito personale',dtype_other:'Altro',
    dpc_debt_free_label:'🎯 Data libera dai debiti',dpc_months_from_now:'mesi da ora',
    dpc_interest_label:'💸 Interessi totali',dpc_on_top:'oltre a',dpc_principal:'capitale',
    dpc_monthly_label:'📅 Totale mensile',dpc_min_abbr:'min',dpc_extra_abbr:'extra',
    dpc_payoff_order_sf:'Ordine di rimborso - ⛄ Palla di neve (saldo più basso prima)',
    dpc_payoff_order_av:'Ordine di rimborso - 🌊 Valanga (tasso più alto prima)',
    dpc_paid_off:'Pagato:',dpc_balance_word:'saldo',dpc_apr_word:'TAEG',
    help_dpc_intro:'Questo calcolatore elabora un piano di rimborso personalizzato basato sui tuoi debiti e sulla strategia scelta.',
    help_dpc_entries_h:'I tuoi debiti',
    help_dpc_balance_li:'Saldo - Quanto devi attualmente su quel debito.',
    help_dpc_apr_li:'TAEG % - Il tasso di interesse annuo (trovalo sul tuo estratto conto). Es. 18,9 significa 18,9%.',
    help_dpc_min_li:'Pag. min. - Il pagamento mensile minimo richiesto dal creditore.',
    help_dpc_due_li:'Giorno scad. - Il giorno del mese in cui scade il pagamento (mostrato nel Calendario intelligente).',
    help_dpc_strategies_h:'Strategie di rimborso',
    help_dpc_snowball_li:"\u26c4 Palla di neve - Ripaga i debiti partendo dal saldo più basso. Una volta estinto, trasferisci quel pagamento al successivo. Ottimo per la motivazione.",
    help_dpc_avalanche_li:'\uD83C\uDF0A Valanga - Ripaga i debiti partendo dal tasso più alto. Risparmia di più nel complesso.',
    help_dpc_extra_h:'Pagamento mensile extra',
    help_dpc_extra_p:'Qualsiasi surplus oltre i pagamenti minimi può essere destinato ai debiti. Anche un piccolo pagamento extra può risparmiare centinaia di interessi e ridurre i mesi. I risultati si aggiornano mentre scrivi.',
    help_dpc_term_li:'Durata del prestito - Per mutui, prestiti studenteschi, auto e personali, imposta la durata in anni e clicca su Calcola automaticamente per ottenere una rata minima accurata.',
    help_dpc_percent_li:'Rata minima percentuale - Per le carte di credito, passa a "% del saldo" per rispecchiare come funziona davvero la rata minima del tuo estratto conto (es. 2% del saldo o 25€, il valore più alto).',
    help_dpc_escrow_li:'Deposito vincolato - Per i mutui, aggiungi le tue tasse e assicurazione mensili così il tuo costo mensile reale è accurato ovunque; è escluso dalla proiezione di rimborso poiché non riduce il saldo.',
    help_dpc_amort_li:'Tipo di ammortamento - Con le rate costanti, il tuo pagamento resta uguale ogni mese. Con le rate decrescenti (capitale costante), la quota capitale resta fissa, quindi la rata totale diminuisce nel tempo; controlla i documenti del tuo prestito per sapere quale tipo hai.',
    help_dpc_escrow_mode_li:'Tipo di deposito vincolato - scegli "Decrescente con il saldo" se il tuo deposito diminuisce insieme al saldo del prestito, come alcuni premi assicurativi decrescenti; puoi vederlo diminuire nel piano di ammortamento.',
    help_dpc_rate_type_li:'Tipo di tasso - scegli "Si adegua dopo un periodo fisso" per un tasso variabile, poi imposta per quanti anni il tasso è fisso e a cosa cambia in seguito.',
    help_dpc_extra_targeted_li:'Extra/mese (per debito) - un importo opzionale pagato solo verso quel debito ogni mese, in aggiunta al suo minimo, indipendentemente dal tuo ordine palla di neve/valanga.',
    dsched_col_date:'Data',dsched_col_payment:'Pagamento',dsched_col_principal:'Capitale',dsched_col_interest:'Interessi',dsched_col_escrow:'Deposito',dsched_col_balance:'Saldo',
    dsched_never_payoff_warning:'A questo ritmo, questo debito non sarà completamente saldato entro 50 anni - il pagamento supera appena gli interessi. Considera una rata minima più alta, una soglia percentuale più alta o un pagamento extra.',
    help_dpc_tip:'\uD83D\uDCA1 Alterna tra i metodi per vedere quanti interessi risparmieresti con ciascun approccio.',
    tx_import_csv:'\uD83D\uDCE5 Importa CSV',
    tx_add_title:'Aggiungi una transazione',
    tx_date:'Data',tx_type:'Tipo',tx_category:'Categoria',tx_amount:'Importo',
    tx_desc_label:'Descrizione',tx_desc_ph:'es. Spesa al supermercato\u2026',
    tx_add_btn:'Aggiungi',tx_error_required:'Compila tutti i campi obbligatori.',
    tx_transaction_one:'transazione',tx_transaction_many:'transazioni',
    tx_clear_all:'Cancella tutto',tx_empty:'Nessuna transazione ancora.',
    tx_type_income:'Entrata',tx_type_expense:'Spesa',tx_type_bill:'Bolletta',tx_type_savings:'Risparmio',
    tx_th_amount:'Importo',tx_th_desc:'Descrizione',
    tx_edit_title:'\u270F\uFE0F Modifica transazione',tx_save_changes:'Salva modifiche',
    help_tx_intro:"Ogni movimento di denaro va qui. I tuoi importi effettivi del budget e il pannello si aggiornano automaticamente ogni volta che ne aggiungi uno.",
    help_tx_adding_h:'Aggiungere una transazione',
    help_tx_step1:'Scegli una Data - clicca sul campo data per aprire il calendario',
    help_tx_step2:'Scegli un tipo: Entrata, Spesa, Bolletta, Risparmio, Debito, Abbonamento o Fondo dedicato',
    help_tx_step3:'Seleziona la Categoria corrispondente (configurata nella scheda Budget)',
    help_tx_step4:"Inserisci l'Importo e una descrizione opzionale",
    help_tx_step5:'Clicca su Aggiungi',
    help_tx_edit_h:'Modifica & eliminazione',
    help_tx_edit_p:'Clicca \u270F\uFE0F su qualsiasi transazione per modificarla, o \u00d7 per eliminarla. Per cancellare tutto, usa "Cancella tutto".',help_tx_auto_h:'Transazioni automatiche',help_tx_auto_p:"Crea una regola per tutto ciò che si ripete (come affitto o stipendio) e scegli la frequenza. L'app la aggiunge automaticamente alla lista a ogni scadenza. Usa l'interruttore per mettere in pausa, o la matita per modificare.",
    help_tx_csv_h:'Import CSV',
    help_tx_csv_p1:'Importa un export di foglio di calcolo nel formato: Date,Type,Category,Amount,Description (riga di intestazione richiesta).',
    help_tx_csv_p2:'Le date devono essere nel formato YYYY-MM-DD. Type deve essere: income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_section_income:'Entrate',bud_section_expenses:'Spese',
    bud_section_bills:'Bollette',bud_section_savings:'Risparmi',
    bud_th_category:'Categoria',bud_th_expected:'Previsto',
    bud_th_actual:'Effettivo',bud_th_progress:'Avanzamento',
    bud_th_due_date:'Scadenza',bud_th_paid:'Pagato',
    bud_total:'Totale',bud_set_date:'Imposta data',
    bud_add_btn:'+ Aggiungi',bud_add_cat_title:'Aggiungi nuova categoria',
    bud_cat_name_label:'Nome categoria',bud_cat_name_ph:'es. Freelance',
    bud_add_cat_btn:'Aggiungi',bud_due_date_label:'Data di scadenza',
    help_bud_intro:"La scheda Budget è dove pianifichi i tuoi soldi. Imposta importi previsti per ogni categoria - gli effettivi si compilano automaticamente dalle tue Transazioni.",
    help_bud_how_h:'Come funziona',
    help_bud_step1:'Clicca su un campo Previsto e inserisci il tuo importo di budget',
    help_bud_step2:'Registra le transazioni nella scheda Transazioni',
    help_bud_step3:'La colonna Effettivo e le barre di avanzamento si aggiornano automaticamente',
    help_bud_colours_h:'Colori delle barre di avanzamento',
    help_bud_col_green:"Verde - entrate pari o superiori all'obiettivo",
    help_bud_col_indigo:'Indigo - spesa entro il budget',
    help_bud_col_red:'Rosso - spesa oltre il budget',
    help_bud_bills_h:'Sezione Bollette',
    help_bud_bills_p:"Le bollette hanno una Data di scadenza (clicca per aprire il selettore data) e una casella Pagato. Queste date appaiono anche nel Calendario intelligente.",
    help_bud_tip:'\uD83D\uDCA1 Usa "+ Aggiungi categoria" per creare categorie personalizzate per qualsiasi sezione.',
    dash_total_income:'Entrate totali',dash_of:'di',dash_expected_sfx:'previsto',
    dash_total_outgoing:'Uscite totali',dash_budgeted_sfx:'a budget',
    dash_savings_rate:'Tasso di risparmio',dash_saved_sfx:'risparmiato',
    dash_subscriptions:'Abbonamenti',dash_per_year:'/anno',
    dash_net_leftover:'Saldo netto del periodo',
    dash_in_sfx:'ricevuto',dash_out_sfx:'speso',
    dash_includes:'Incluso',dash_rollover_sfx:'riporto',
    dash_cash_flow:'Flusso di cassa',
    dash_expected_legend:'Previsto',dash_actual_legend:'Effettivo',
    dash_income_sources:'Fonti di entrata',dash_no_income:'Nessuna entrata registrata.',
    dash_spending_breakdown:'Dettaglio spese',dash_no_spending:'Nessuna spesa registrata.',
    dash_no_debts:'Nessun debito aggiunto.',dash_set_up:'Configura \u2192',
    dash_debt_free_label:'Senza debiti',dash_interest_label:'Interessi',
    dash_months_label:'Mesi',dash_method_label:'Metodo',
    dash_set_balances:'Inserisci i saldi per vedere i risultati.',
    dash_upcoming_7:'\uD83D\uDCC5 In arrivo (7 giorni)',dash_nothing_scheduled:'Niente in programma.',
    dash_no_sinking:'Nessun fondo di accantonamento.',dash_create_one:'Creane uno \u2192',
    help_dash_intro:'Il pannello offre una panoramica finanziaria in tempo reale. Tutti i numeri si aggiornano automaticamente quando registri le transazioni.',
    help_dash_hero_h:'Statistiche principali',
    help_dash_hero_p:"Le quattro schede in alto mostrano i totali del periodo: Entrate totali ricevute, Uscite totali (spese, bollette, debiti & abbonamenti), Tasso di risparmio (% del reddito risparmiato) e il costo mensile degli abbonamenti.",
    help_dash_leftover_h:'Saldo netto',
    help_dash_leftover_p:'Denaro rimanente dopo tutte le spese e i risparmi. Verde = sei in attivo. Rosso = hai superato il budget.',
    help_dash_cashflow_h:'Grafico del flusso di cassa',
    help_dash_cashflow_p:"Ogni riga mostra il Previsto (barra grigia) vs l'Effettivo (barra colorata) per Entrate, Spese, Bollette e Risparmi. Una barra rossa delle Spese indica che hai superato il budget.",
    help_dash_donut_h:'Grafici a ciambella',
    help_dash_donut_p:"Passa il cursore su un segmento o toccalo per vedere l'etichetta e la percentuale. Mostrano da dove viene il tuo denaro e dove va.",
    help_dash_bottom_h:'Pannelli inferiori',
    help_dash_bottom_p:"Istantanee rapide del progresso nel rimborso dei debiti, bollette/abbonamenti in arrivo nei prossimi 30 giorni e obiettivi dei fondi di accantonamento.",
    help_dash_tip:'\uD83D\uDCA1 Clicca sul badge della data in alto per cambiare il periodo del budget.',
    tx_type_debt:'Debito',
    dash_debt_payments:'Debiti',
    dash_debts_paid:'debito pagato in questo periodo',dash_debts_paid_many:'debiti pagati in questo periodo',
    tx_type_subscription:'Abbonamento',
    alloc_title:'Distribuzione budget',
    alloc_desc:'Etichetta le spese come Bisogno, Desiderio o Risparmio per vedere come i tuoi soldi si allineano con la tua distribuzione target.',
    alloc_label:'Distribuzione',alloc_optional:'Tagga la spesa',
    alloc_target:'Obiettivo',alloc_on_track:'In linea',alloc_over:'Superato',alloc_under:'Al di sotto',
    alloc_enabled_label:'Attiva distribuzione budget',
    alloc_name_ph:'Nome segmento',alloc_pct_label:'% del reddito',
    alloc_sum_ok:'\u2713 100%',alloc_sum_bad:'\u26a0 Deve totalizzare 100%',
    alloc_based_on:'Basato su',alloc_income_period:'entrate di questo periodo',
    alloc_untagged:'Non etichettato',alloc_untagged_desc:'di spese non ancora etichettate',
    alloc_def_need:'Bisogno',alloc_def_want:'Desiderio',alloc_def_save:'Risparmio',
    alloc_sett_title:'\uD83C\uDFAF Distribuzione spese',
    alloc_nearing:'Vicino',
    alloc_required:'La distribuzione è obbligatoria per le transazioni di spesa.',
    toast_tx_added:'Transazione aggiunta \u2713',toast_tx_updated:'Aggiornato \u2713',toast_tx_deleted:'Eliminato',
    toast_period_updated:'Periodo aggiornato \u2713',toast_period_error:'La data di fine deve essere successiva alla data di inizio',
    toast_currency_updated:'Valuta aggiornata \u2713',toast_imported:'{0} importato/i \u2713',
    toast_fund_created:'Fondo creato \u2713',toast_fund_updated:'Fondo aggiornato \u2713',
    toast_fund_contrib:'{amt} aggiunto a {name} \u2713',
    toast_sub_added:'Abbonamento aggiunto \u2713',toast_sub_updated:'Abbonamento aggiornato \u2713',
    toast_alloc_enabled:'Distribuzione attivata \u2713',toast_alloc_disabled:'Distribuzione disattivata',
    toast_lang_updated:'Lingua aggiornata \u2713',toast_export:'Esportato \u2713',
    toast_saved:'Salvato \u2713',toast_reset:'Tutti i dati cancellati',toast_alloc_bucket_added:'Segmento aggiunto \u2713',
    confirm_remove_cat:'Rimuovere questa categoria?',confirm_delete_all_tx:'Eliminare TUTTE le transazioni? Questa azione \u00e8 irreversibile.',
    confirm_delete_tx:'Eliminare questa transazione?',confirm_remove_debt:'Rimuovere questo debito?',
    confirm_delete_fund:'Eliminare questo fondo?',confirm_remove_sub:'Rimuovere questo abbonamento?',
    confirm_reset_1:'Sei sicuro? Tutti i dati verranno eliminati definitivamente.',
    confirm_reset_2:'Ultima possibilit\u00e0 - non \u00e8 reversibile. Continuare?',
    export_csv_btn:'\uD83D\uDCE5 Esporta CSV',sett_export_title:'\uD83D\uDCE4 Esporta dati',
    sett_export_desc:"Scarica tutte le transazioni come file CSV per backup o utilizzo in un'altra app.",
    sf_add_contribution:'Aggiungi contributo',sf_contribution_label:'Importo da aggiungere',sf_currently_saved:'Attualmente risparmiato',
    tx_search_ph:'Cerca per descrizione o categoria\u2026',tx_filter_all_types:'Tutti i tipi',tx_filter_all_alloc:'Tutte le distribuzioni',
    tx_sort_date_new:'Pi\u00f9 recente prima',tx_sort_date_old:'Pi\u00f9 vecchio prima',tx_sort_amt_high:'Importo maggiore',tx_sort_amt_low:'Importo minore',
    tx_showing:'Visualizzando {n} di {total}',tx_no_results:'Nessuna transazione corrisponde al tuo filtro.',
    alloc_add_bucket:'+ Aggiungi segmento',alloc_remove_btn:'Rimuovi',alloc_total_label:'Totale',alloc_new_bucket:'Nuovo segmento',alloc_color_title:'Scegli un colore',alloc_custom_color:'Altro',alloc_min_buckets:'Sono necessari almeno 2 segmenti',
    alloc_auto_tag:'Taggato automaticamente \u2192 {name}',
    tx_prev:'\u2190 Prec.',tx_next:'Succ. \u2192',tx_page_of:'Pagina {n} di {total}',
    debt_due_day_note:'I giorni 29-31 non appaiono nei mesi pi\u00f9 corti',
    sub_advanced:'Data di fatturazione avanzata al {date}',
    sf_days_left:'{n} giorni rimanenti',sf_days_overdue:'{n} giorni di ritardo',
    sf_due_today:'Oggi!',sf_target_complete:'Obiettivo raggiunto! \u2713',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs Periodo precedente',dash_compare_no_data:'Nessun dato per il periodo precedente',
    recurring_title:'Transazioni automatiche',recurring_desc:'Crea transazioni che si ripetono (esempio: affitto, stipendio o abbonamenti). Vengono aggiunte automaticamente alla tua lista a ogni scadenza.',recurring_add_rule:'+ Aggiungi transazione automatica',
    recurring_empty:'Nessuna transazione automatica aggiunta.',recurring_label_ph:'Nome della transazione (es. Netflix)',
    recurring_freq:'Frequenza',freq_daily:'Giornaliero',freq_weekly:'Settimanale',
    freq_monthly:'Mensile',freq_quarterly:'Trimestrale',freq_annual:'Annuale',
    recurring_next_due:'Prossima scadenza',recurring_generated:'{0} nuove transazioni automatizzate',
    recurring_remove:'Rimuovi regola',recurring_paused:'In pausa',recurring_active:'Attivo',recurring_saved:'Transazione automatica salvata ✓',dpc_add_debt_title:'Aggiungi debito',dpc_edit_debt_title:'Modifica debito',debt_due_day_modal_hint:'Il giorno del mese in cui è dovuto questo pagamento',toast_debt_added:'Debito aggiunto',toast_debt_updated:'Debito aggiornato',sf_billing_day_label:'Giorno di addebito del mese',sf_billing_day_hint:'Il giorno del mese in cui il contributo viene registrato automaticamente',sf_error_required:'Compila tutti i campi obbligatori',sub_active:'Attivo',sub_paused:'In pausa',sub_desc:'Tieni traccia di ogni pagamento ricorrente e scopri il tuo costo annuale reale. Metti in pausa gli abbonamenti che non usi per tenere sotto controllo le spese.',sub_add_btn:'+ Aggiungi abbonamento',sub_add_title:'Aggiungi abbonamento',sub_edit_title:'Modifica abbonamento',sub_empty_title:'Nessun abbonamento ancora.',sub_empty_sub:'Aggiungi i tuoi pagamenti ricorrenti - Netflix, Spotify, palestra, ecc.',sub_sum_monthly:'Totale mensile',sub_sum_annual:'Totale annuale',sub_by_category:'Per categoria',sub_per_month:'/mese',sub_next_label:'Prossimo',sub_name_label:"Nome dell'abbonamento",sub_name_ph:'es. Netflix',sub_amount_label:'Importo',sub_freq_label:'Frequenza di fatturazione',sub_freq_monthly:'Mensile',sub_freq_annual:'Annuale',sub_freq_quarterly:'Trimestrale',sub_freq_weekly:'Settimanale',sub_unit_month:'mese',sub_unit_year:'anno',sub_unit_quarter:'trimestre',sub_cat_label:'Categoria',sub_date_label:'Prossima data di fatturazione',sub_cat_entertainment:'Intrattenimento',sub_cat_productivity:'Produttività',sub_cat_health:'Salute e fitness',sub_cat_food:'Cibo e bevande',sub_cat_cloud:'Archiviazione cloud',sub_cat_finance:'Finanza',sub_cat_education:'Istruzione',sub_cat_gaming:'Videogiochi',sub_cat_news:'Notizie e media',sub_cat_other:'Altro',help_sub_intro:"Tieni traccia di ogni pagamento ricorrente e scopri il tuo costo mensile e annuale reale. Gli abbonamenti che silenziosamente prosciugano il tuo conto sono facili da perdere di vista - questo li tiene visibili.",help_sub_how_h:'Aggiungere un abbonamento',help_sub_step1:'Clicca su + Aggiungi abbonamento',help_sub_step2:'Inserisci nome, importo e frequenza di fatturazione (mensile, annuale, trimestrale, settimanale)',help_sub_step3:'Scegli una categoria per raggruppare abbonamenti simili',help_sub_step4:'Imposta la prossima data di fatturazione - apparirà nel calendario intelligente',help_sub_monthly_h:'Equivalente mensile',help_sub_monthly_p:"Gli abbonamenti annuali e trimestrali vengono convertiti in un costo mensile così puoi vedere la tua spesa mensile reale a colpo d'occhio.",help_sub_pause_h:'Mettere in pausa gli abbonamenti',help_sub_pause_p:"Disattiva l'interruttore Attivo di un abbonamento che non stai usando. Non verrà conteggiato nei totali finché non lo riattivi.",help_sub_chart_h:'Grafico per categoria',help_sub_chart_p:'Il grafico a ciambella mostra come si distribuisce la spesa per abbonamenti tra le categorie - passa sopra un segmento per i dettagli.',help_sub_tip:'💡 Attiva "Automatizza" su un abbonamento perché venga aggiunto automaticamente alle tue transazioni a ogni ciclo di fatturazione.',automate_auto_pay:'Pagamento auto',sf_auto_contribute:'Auto-contributo',sf_auto_need_amount:'Aggiungi prima un importo e una data obiettivo',sf_auto_set:'Contributo mensile: {0}',automate_label:'Automatizza',automate_hint:'Lo aggiunge automaticamente alle transazioni secondo la pianificazione',automate_hint_off:"Attiva l'Automazione nelle Impostazioni per usarlo",automate_th:'Pagamento auto',automate_need_amount:'Imposta prima un pagamento minimo',automate_payment_word:'pagamento',automate_linked:'Transazione automatica collegata',sf_contribution_label:'Contributo mensile',sf_contribution_hint:'Registrato automaticamente ogni mese per far crescere questo fondo',sett_automation_h:'Automazione',sett_automation_desc:'Interruttore principale delle transazioni automatiche. Se disattivato, non vengono generate transazioni pianificate e le opzioni di automazione sono disattivate.',sett_automation_toggle:'Transazioni automatiche',sett_automation_hint:'Si applica a transazioni, abbonamenti, fondi e debiti',
    tx_type_sinking_fund:'Fondo dedicato',
    help_dash_alloc_h:'Pannello distribuzione budget',
    help_dash_alloc_what_h:'Cos\u2019è',
    help_dash_alloc_what_p:"Tiene traccia delle tue spese rispetto a percentuali target personalizzabili del tuo reddito. La classica regola 50/30/20 divide il reddito in: Bisogni (essenziali: affitto, cibo, bollette), Desideri (stile di vita: ristoranti, streaming, hobby) e Risparmio (costruzione di ricchezza e rimborso debiti). Puoi impostare qualsiasi suddivisione - le percentuali devono solo totalizzare il 100%.",
    help_dash_alloc_tag_h:'Etichettare le transazioni',
    help_dash_alloc_tag_p:"Quando registri una transazione, scegli una distribuzione (Bisogno / Desiderio / Risparmio) dal menu a discesa. Le entrate e i contributi di risparmio non vengono etichettati. Un badge ? su una riga significa che quella spesa non è ancora etichettata.",
    help_dash_alloc_read_h:'Leggere le schede',
    help_dash_alloc_read_p:"Ogni scheda mostra il nome del segmento, la tua % target e la tua % effettiva del reddito per il periodo. La barra sottile si riempie proporzionalmente - quando è piena, hai raggiunto il tuo limite.",
    help_dash_alloc_col_h:'Codice colore',
    help_dash_alloc_col_over:'Rosso - hai superato l\u2019obiettivo. La percentuale e la barra diventano rosse.',
    help_dash_alloc_col_near:'Arancione - entro 5 punti percentuali dall\u2019obiettivo. Un avviso che ti stai avvicinando.',
    help_dash_alloc_col_norm:'Colore del segmento - comodamente entro il tuo obiettivo per questo periodo.',
    help_dash_alloc_setup_h:'Personalizzare',
    // Penny (assistente IA)
    sett_penny_h:'Penny (Assistente di budget IA)',
    sett_penny_desc:'Chiedi a Penny del tuo budget & delle tue abitudini di spesa',
    sett_penny_toggle:'Attiva Penny',
    sett_penny_hint:'Attiva l’assistente Penny e la sua icona nella barra di navigazione.',
    sett_penny_key_label:'Chiave API Gemini',
    sett_penny_key_placeholder:'Incolla la tua chiave API Gemini',
    sett_penny_howto:'Come creare la mia chiave',
    sett_penny_save_btn:'Salva chiave',
    sett_penny_key_saved:'Chiave API Gemini salvata e crittografata',
    sett_penny_remove:'Rimuovi chiave',
    sett_penny_available:'Penny è ora disponibile nel menu di navigazione.',
    sett_penny_usage_count:'Penny ha risposto a {0} domande questo mese',
    sett_penny_key_error_short:'Non sembra una chiave valida. Controlla e riprova.',
    confirm_penny_remove_key:'Rimuovere la chiave API Gemini salvata? Penny verrà disattivata finché non ne aggiungi una nuova.',
    toast_penny_key_saved:'Chiave Gemini salvata in modo sicuro.',
    penny_nav_pill_off:'Attiva Penny',
    penny_nav_pill_on:'Chiedi a Penny',
    penny_nav_aria_off:'Attiva Penny',
    penny_nav_aria_on:'Chiedi a Penny',
    penny_chat_title:'Chiedi a Penny',
    penny_input_placeholder:'Fai una domanda sul tuo budget…',
    penny_send:'Chiedi',
    penny_thinking:'Penny sta pensando…',
    penny_voice_on:'Risposte vocali attive',
    penny_voice_off:'Risposte vocali disattivate',
    penny_disclaimer:'La tua assistente di budget IA personale',
    penny_no_key_notice:'Aggiungi la tua chiave API Gemini nelle Impostazioni per iniziare a chattare con Penny.',
    penny_open_settings:'Apri Impostazioni',
    penny_close:'Chiudi Penny',
    penny_qp_leftover:'Quanto mi rimane in questo periodo?',
    penny_qp_top_category:'Qual è la mia categoria di spesa maggiore?',
    penny_qp_on_track:'Sto rispettando il mio budget?',
    penny_qp_subscriptions:'Quanto pago in abbonamenti?',
    penny_qp_debt:'A che punto è l’estinzione dei miei debiti?',
    penny_qp_chart:'Mostrami un grafico delle mie spese',
    penny_err_invalid_key:'La tua chiave API Gemini non sembra valida o è stata revocata. Aggiornala nelle Impostazioni.',
    penny_err_rate_limited:'Hai raggiunto il limite di richieste di Gemini per ora. È un limite imposto da Google sulla tua chiave, non il contatore qui sopra. Attendi un po’ e riprova.',
    penny_err_network:'Penny non è riuscita a raggiungere i server di Google. Controlla la connessione e riprova.',
    penny_err_blocked:'Penny non è riuscita a trovare una risposta sicura. Prova a riformulare la tua domanda sul budget.',
    penny_err_unknown:'Qualcosa è andato storto dal lato di Penny. Riprova tra un momento.',
    penny_err_key_unreadable:'Non è stato possibile leggere la tua chiave salvata. Reinseriscila nelle Impostazioni.',
    penny_err_retry:'Riprova',
    help_sett_penny_p:'Attiva Penny qui sotto per fare domande sul tuo budget in linguaggio semplice. Tocca «Come creare la mia chiave» per i passaggi di configurazione.',
    help_penny_title:'Configurare Penny',
    help_penny_intro:'Penny è l’assistente IA di Evo Budget. Poiché questa app non ha un proprio server, Penny parla direttamente dal tuo browser con Google usando la tua chiave API Gemini gratuita. Nulla passa mai da un server di Evo Budget, perché non ne esiste uno.',
    help_penny_steps_h:'Come creare la tua chiave',
    help_penny_step1:'Vai su Google AI Studio (aistudio.google.com/apikey) e accedi con un account Google.',
    help_penny_step2:'Fai clic su «Crea chiave API» (scegli «Crea chiave in un nuovo progetto» se non ne hai ancora uno).',
    help_penny_step3:'Copia la chiave generata (inizia con AIza…).',
    help_penny_step4:'Incollala nel campo «Chiave API Gemini» nelle Impostazioni di Evo Budget e fai clic su «Salva chiave».',
    help_penny_cost_h:'È gratis?',
    help_penny_cost_p:'L’API Gemini ha un livello gratuito con limiti stabiliti da Google, che possono cambiare. Controlla i tuoi limiti attuali in qualsiasi momento su aistudio.google.com. Il contatore «domande poste» che vedi nelle Impostazioni è un contatore personale conservato sul tuo dispositivo per tua informazione. Non riflette in tempo reale la tua quota Google.',
    help_penny_safety_h:'La mia chiave è al sicuro?',
    help_penny_safety_p:'La tua chiave viene crittografata prima di essere salvata nell’archivio del tuo browser, e viene inviata direttamente all’API di Google solo quando fai una domanda a Penny. Non viene mai inviata a un server di Evo Budget.',
    help_penny_cta:'Apri Google AI Studio →',
    help_dash_alloc_setup_p:'Apri Impostazioni \u2192 Distribuzione spese. Modifica i nomi dei segmenti, regola le percentuali e attiva o disattiva il pannello. Le percentuali devono totalizzare il 100%.',
    // Guide
    guide_group_start:"Per iniziare", guide_group_track:"Tieni traccia dei tuoi soldi", guide_group_plan:"Pianifica in grande",
    guide_group_smart:"Lavora in modo più intelligente", guide_group_settings:"A modo tuo",
    guide_section_big:"Il quadro generale", guide_section_how:"Come si usa", guide_section_connects:"Come si collega", guide_back:"Torna agli argomenti",
    guide_welcome_title:"Benvenuto in Ultimate Budget Planner",
    guide_welcome_big:"Ultimate Budget Planner prende l'idea semplice di tracciare entrate e uscite e le dà superpoteri - un vero piano di rimborso debiti, obiettivi di risparmio con barre di progresso, un calendario con vista d'insieme, tracciamento degli abbonamenti e Penny, un'assistente IA che conosce già i tuoi numeri. Inizia dalla Dashboard ed esplora il resto quando sei pronto.",
    guide_dashboard_title:"Dashboard",
    guide_dashboard_big:"La Dashboard è il tuo centro di controllo - tutto ciò che conta per il tuo denaro vive in questa unica schermata, dal saldo finale a quello che ti aspetta questa settimana.",
    guide_dashboard_step1:"Controlla le schede riepilogo in alto per le tue <strong>Entrate totali</strong>, le tue <strong>Uscite totali</strong>, il tuo <strong>Tasso di risparmio</strong> e il tuo <strong>Avanzo netto</strong>.",
    guide_dashboard_step2:"Consulta l'elenco <strong>In arrivo</strong> per vedere tutto ciò che scade nei prossimi 7 giorni - bollette, pagamenti di debiti e abbonamenti, tutto in un unico posto.",
    guide_dashboard_step3:"Controlla i tuoi riepiloghi di <strong>Rimborso debiti</strong> e <strong>Fondi accantonamento</strong> per vedere a colpo d'occhio i progressi verso i tuoi obiettivi più grandi.",
    guide_dashboard_connect1:"Ogni numero qui proviene in tempo reale da Transazioni, Budget, Rimborso debiti, Fondi accantonamento e Abbonamenti - non c'è nulla da calcolare a mano.",
    guide_dashboard_connect2:"L'Avanzo netto include la tua impostazione di <strong>Riporto</strong>, così i soldi non spesi del periodo precedente possono ripercuotersi automaticamente.",
    guide_dashboard_connect3:"Se qualcosa non torna, vale quasi sempre la pena controllare la pagina di origine - la Dashboard è uno specchio, non una fonte.",
    guide_dashboard_tip:"Dedica 30 secondi ogni mattina a scorrere la Dashboard - è il modo più veloce per notare una bolletta o un pagamento di debito prima che sia in ritardo.",
    guide_transactions_title:"Transazioni",
    guide_transactions_big:"Le transazioni sono la base di tutto in quest'app - ogni euro che registri qui alimenta la tua Dashboard, il tuo budget e ogni grafico che vedi. Ultimate Budget Planner ti permette anche di automatizzare le parti ripetitive così non devi registrare la stessa cosa ogni periodo.",
    guide_transactions_step1:"Tocca <strong>Aggiungi transazione</strong>, scegli tipo e categoria, e inserisci l'importo.",
    guide_transactions_step2:"Configura una <strong>Regola ricorrente</strong> per tutto ciò che si ripete, come l'affitto o lo stipendio, così viene registrato automaticamente invece di doverlo digitare ogni volta.",
    guide_transactions_step3:"Usa <strong>Importa CSV</strong> per importare spese esistenti tutte insieme invece di inserirle a mano.",
    guide_transactions_step4:"Tocca una transazione per modificarla, o usa i filtri sopra l'elenco per trovarne una rapidamente.",
    guide_transactions_connect1:"Le regole ricorrenti configurate qui alimentano la funzione <strong>Automazione</strong> - una volta che una regola esiste, continua a registrarsi come previsto senza che tu debba fare nulla.",
    guide_transactions_connect2:"Ogni transazione conta automaticamente per la categoria corrispondente in Budget, Rimborso debiti o Abbonamenti.",
    guide_transactions_connect3:"I totali e i grafici della tua Dashboard si basano interamente su ciò che viene registrato qui.",
    guide_transactions_tip:"Configura prima le regole ricorrenti per le tue bollette abituali e il tuo stipendio - è il più grande risparmio di tempo di tutta l'app.",
    guide_budget_title:"Budget",
    guide_budget_big:"Budget è dove imposti i tuoi obiettivi - quanto prevedi di guadagnare e spendere in Entrate, Uscite, Bollette e Risparmi - tutto da una sola schermata invece di passare tra schede separate.",
    guide_budget_step1:"Aggiungi una categoria sotto <strong>Entrate</strong>, <strong>Uscite</strong>, <strong>Bollette</strong> o <strong>Risparmi</strong> e imposta il suo importo <strong>Previsto</strong>.",
    guide_budget_step2:"Mentre registri transazioni, osserva come la colonna <strong>Effettivo</strong> si riempie automaticamente per ogni categoria.",
    guide_budget_step3:"Confronta Previsto ed Effettivo per vedere quali categorie sono in linea e quali richiedono attenzione.",
    guide_budget_step4:"Regola qualsiasi importo Previsto quando la tua vita cambia - il tuo budget dovrebbe adattarsi a te, non il contrario.",
    guide_budget_connect1:"Ogni transazione che registri in Transazioni confluisce direttamente nella categoria corrispondente qui.",
    guide_budget_connect2:"Il tuo grafico Distribuzione spese e il tuo Avanzo netto nella Dashboard si basano entrambi su queste categorie.",
    guide_budget_connect3:"Se hai attivato le <strong>Distribuzioni percentuali</strong> nelle Impostazioni, qui vedrai anche come le tue spese si confrontano con quegli obiettivi percentuali.",
    guide_budget_tip:"Rivedi i tuoi importi Previsti una volta al mese - un budget che non cambia mai smette abbastanza rapidamente di riflettere la realtà.",
    guide_debt_title:"Calcolatore di rimborso debiti",
    guide_debt_big:"Questo è più di un semplice elenco di ciò che devi - ti costruisce un vero piano per diventare libero dai debiti, mostrando esattamente quale debito affrontare prima e quanti interessi risparmierai facendolo.",
    guide_debt_step1:"Aggiungi ogni debito con il suo <strong>Saldo</strong>, il suo <strong>Tasso</strong> (interesse) e il suo <strong>Pagamento minimo</strong>.",
    guide_debt_step2:"Scegli una strategia: <strong>Palla di neve</strong> (ripaga prima il saldo più piccolo per vittorie rapide) oppure <strong>Valanga</strong> (ripaga prima il tasso più alto per risparmiare di più).",
    guide_debt_step3:"Aggiungi qualsiasi importo extra che puoi destinare ai debiti ogni periodo - il calcolatore lo applica al debito che la tua strategia punta per primo.",
    guide_debt_step4:"Controlla la tua <strong>data prevista senza debiti</strong> e gli interessi totali per vedere come i pagamenti extra cambiano il quadro.",
    guide_debt_step5:'Per mutui e prestiti, imposta una <strong>durata</strong> e clicca su <strong>Calcola automaticamente</strong> per una rata minima accurata. Per le carte di credito, passa a <strong>% del saldo</strong> per rispecchiare il tuo estratto conto reale.',
    guide_debt_step6:'Alcuni prestiti usano <strong>rate decrescenti</strong> invece di rate costanti - la quota capitale resta fissa e la rata totale diminuisce nel tempo. Controlla il <strong>tipo di ammortamento</strong> per farlo corrispondere al tuo prestito.',
    guide_debt_step7:'Per un tasso variabile, imposta il <strong>tipo di tasso</strong> su "Si adegua dopo un periodo fisso" e stabilisci quando cambia. Per un deposito vincolato del mutuo che diminuisce nel tempo, imposta il <strong>tipo di deposito vincolato</strong> su "Decrescente con il saldo".',
    guide_debt_step8:'Clicca sull’<strong>icona ℹ️ info</strong> di un debito per vedere il suo piano di ammortamento mensile completo. Usa la colonna <strong>Extra/mese</strong> per indirizzare pagamenti extra verso un debito specifico, indipendentemente dal tuo ordine palla di neve/valanga.',
    guide_debt_connect1:"I pagamenti di debiti che registri in Transazioni contano per il saldo di ogni debito qui.",
    guide_debt_connect2:"La tua Dashboard mostra un riepilogo di questo piano di rimborso così sai sempre a che punto sei senza aprire questa pagina.",
    guide_debt_connect3:"Pagare più del minimo qui - anche solo un po' di più - è di solito la leva più grande per accorciare i tempi di rimborso.",
    guide_debt_tip:"Elenca anche i debiti piccoli, come un prestito familiare - non conta l'importo, ma sapere tutto ciò che devi in un unico posto.",
    guide_sinking_title:"Fondi accantonamento",
    guide_sinking_big:"Un fondo di accantonamento è denaro che metti da parte poco alla volta per qualcosa di specifico che sai che arriverà - una vacanza, un nuovo laptop, dei regali - così non diventa mai un'emergenza quando la spesa arriva davvero.",
    guide_sinking_step1:"Crea un fondo e dagli un <strong>Importo obiettivo</strong> e, se vuoi, una data obiettivo.",
    guide_sinking_step2:"Aggiungi contributi ogni volta che metti da parte denaro per esso, e guarda la <strong>barra di progresso</strong> riempirsi.",
    guide_sinking_step3:"Una volta che un fondo raggiunge il suo obiettivo, sei pronto per quella spesa senza toccare il tuo budget abituale.",
    guide_sinking_connect1:"I fondi di accantonamento sono separati dalla tua normale categoria Risparmi - servono per obiettivi specifici e pianificati invece che per un risparmio generico.",
    guide_sinking_connect2:"La tua Dashboard mostra un riepilogo dei progressi di tutti i tuoi fondi in un unico posto.",
    guide_sinking_connect3:"Contribuire regolarmente a un fondo, anche con un piccolo importo, trasforma una grande spesa in qualcosa che non fa mai deragliare il tuo budget.",
    guide_sinking_tip:"Suddividi i grandi obiettivi in importi mensili tondi - è molto più facile impegnarsi per 50 € al mese che per \"risparmiare per una vacanza prima o poi\".",
    guide_subscriptions_title:"Abbonamenti",
    guide_subscriptions_big:"Gli abbonamenti tendono ad accumularsi silenziosamente - questa pagina elenca ogni servizio ricorrente che paghi in un unico posto, così nulla continua ad addebitarti senza che tu lo sappia.",
    guide_subscriptions_step1:"Aggiungi ogni abbonamento con il suo costo e la frequenza di fatturazione (mensile, annuale, ecc.).",
    guide_subscriptions_step2:"Controlla il totale del <strong>Costo mensile</strong> per vedere a quanto ammontano tutti i tuoi abbonamenti insieme.",
    guide_subscriptions_step3:"Metti in pausa o cancella tutto ciò che non usi, direttamente da questa pagina.",
    guide_subscriptions_connect1:"Il costo totale dei tuoi abbonamenti alimenta direttamente il riepilogo della tua Dashboard e le tue Uscite totali.",
    guide_subscriptions_connect2:"Le scadenze degli abbonamenti compaiono anche nel Calendario, così puoi vederle insieme a bollette e pagamenti di debiti.",
    guide_subscriptions_connect3:"Rivedere questo elenco ogni pochi mesi è uno dei modi più semplici per trovare denaro che non sapevi di star perdendo.",
    guide_subscriptions_tip:"Fai una revisione degli abbonamenti subito dopo aver ricevuto l'estratto conto ogni mese - è il momento più facile per notare qualcosa che avevi dimenticato di pagare.",
    guide_calendar_title:"Calendario",
    guide_calendar_big:"Il Calendario riunisce ogni bolletta, pagamento di debito, addebito di abbonamento e transazione in una vista mensile, così vedi tutto ciò che succede al tuo denaro a colpo d'occhio invece di controllare cinque pagine diverse.",
    guide_calendar_step1:"Sfoglia un mese qualsiasi per vedere puntini colorati che segnano bollette, pagamenti di debiti e abbonamenti in scadenza quel giorno.",
    guide_calendar_step2:"Tocca un giorno per vedere l'elenco completo di tutto ciò che accade in esso.",
    guide_calendar_step3:"Usa questa vista prima di un acquisto importante per vedere cos'altro scade più o meno nello stesso periodo.",
    guide_calendar_connect1:"Tutto ciò che viene mostrato qui proviene da Bollette, Rimborso debiti, Abbonamenti e Transazioni - il Calendario non conserva dati propri.",
    guide_calendar_connect2:"È il modo più veloce per individuare una settimana in cui più scadenze cadono vicine tra loro, prima che ti colgano di sorpresa.",
    guide_calendar_connect3:"Nulla di ciò che fai sul Calendario cambia il tuo budget - è una vista pura, quindi è completamente sicuro esplorarlo.",
    guide_calendar_tip:"Controlla il Calendario a inizio settimana - richiede pochi secondi e le scadenze non sono più una sorpresa.",
    guide_rollover_title:"Riporto",
    guide_rollover_big:"Riporto significa che il denaro non speso del periodo precedente non scompare semplicemente - si ripercuote automaticamente e si aggiunge a ciò che hai disponibile in questo periodo.",
    guide_rollover_step1:"Apri le <strong>Impostazioni</strong> e trova la scheda <strong>Riporto</strong>.",
    guide_rollover_step2:"Attivalo così qualsiasi importo residuo del periodo precedente si riporta automaticamente su quello nuovo.",
    guide_rollover_step3:"Controlla l'Avanzo netto della tua Dashboard - ora includerà quell'importo riportato.",
    guide_rollover_connect1:"Il Riporto funziona direttamente a partire dal tuo Avanzo netto del periodo precedente - meglio rispetti il tuo budget, più avrà da riportare.",
    guide_rollover_connect2:"Questo è diverso dai Fondi accantonamento, che servono per obiettivi futuri pianificati - il Riporto riguarda solo il non perdere traccia del denaro che hai già.",
    guide_rollover_connect3:"Una serie di buoni mesi si accumula bene qui, poiché l'avanzo di ogni periodo si aggiunge al successivo.",
    guide_rollover_tip:"Se un grande importo di riporto ti scotta in tasca, valuta di spostarne una parte in un Fondo di accantonamento così è destinato a qualcosa di specifico.",
    guide_automation_title:"Automazione",
    guide_automation_big:"L'Automazione prende le regole ricorrenti che hai configurato in Transazioni e le registra automaticamente per te, così le tue bollette, stipendi e abbonamenti abituali appaiono esattamente in tempo senza che tu debba fare nulla.",
    guide_automation_step1:"Apri le <strong>Impostazioni</strong> e trova la scheda <strong>Automazione</strong>.",
    guide_automation_step2:"Attivala così le regole di transazione ricorrenti si registrano automaticamente quando scadono.",
    guide_automation_step3:"Controlla poi Transazioni per confermare che tutto si sia registrato come previsto.",
    guide_automation_connect1:"Questa funzione funziona solo con regole ricorrenti che hai già creato in Transazioni - configurale prima.",
    guide_automation_connect2:"Ogni transazione che registra confluisce in Budget, Rimborso debiti e Abbonamenti esattamente come una inserita a mano.",
    guide_automation_connect3:"È la differenza tra un'app di budget che devi ricordarti di aggiornare, e una che si mantiene aggiornata da sola.",
    guide_automation_tip:"Attiva l'Automazione una volta che le tue regole ricorrenti ti sembrano corrette - è più utile quando ti fidi dei numeri che registrerà.",
    guide_penny_title:"Penny",
    guide_penny_big:"Penny è la tua assistente IA personale per il budget, integrata direttamente nell'app - fai una domanda sul tuo denaro in linguaggio semplice, e lei legge i tuoi dati di budget reali per darti una risposta reale, con grafici quando è utile.",
    guide_penny_step1:"Apri le <strong>Impostazioni</strong>, attiva Penny, e incolla la tua chiave API Gemini personale (c'è un link proprio lì che mostra esattamente come ottenerne una gratis).",
    guide_penny_step2:"Tocca l'icona scintilla nella navigazione in alto per aprire la chat.",
    guide_penny_step3:"Fai una domanda con parole tue, tipo \"qual è la mia categoria di spesa più grande questo mese?\", oppure tocca uno dei pulsanti di domanda rapida per iniziare.",
    guide_penny_step4:"Attiva o disattiva la sua risposta vocale con l'icona altoparlante se preferisci ascoltare invece di leggere.",
    guide_penny_connect1:"Penny può solo leggere i tuoi dati di budget per rispondere alle domande - non può mai aggiungere, modificare o eliminare nulla per te.",
    guide_penny_connect2:"Attinge direttamente da Dashboard, Transazioni, Rimborso debiti, Abbonamenti e Fondi accantonamento, così le sue risposte corrispondono sempre a ciò che vedresti tu stesso su quelle pagine.",
    guide_penny_connect3:"La tua chiave API viene cifrata e conservata solo sul tuo dispositivo - non viene mai inviata da nessuna parte tranne direttamente a Google quando fai una domanda a Penny.",
    guide_penny_tip:"Inizia con uno dei pulsanti di domanda rapida la prima volta - è il modo più veloce per vedere cosa sa fare prima di fare domande tue.",
    guide_settings_title:"Impostazioni",
    guide_settings_big:"Le Impostazioni sono dove l'app si adatta a te - valuta, periodo di budget, riporto, automazione, aspetto, lingua e come vengono salvati e sottoposti a backup i tuoi dati.",
    guide_settings_step1:"Scegli la tua <strong>Valuta</strong> e il tuo <strong>Periodo di budget</strong> così l'app corrisponde al tuo reale ritmo di pagamento e spesa.",
    guide_settings_step2:"Attiva <strong>Riporto</strong> e <strong>Automazione</strong> se vuoi che il denaro non speso e le transazioni ricorrenti vengano gestiti automaticamente per te.",
    guide_settings_step3:"Passa dall'<strong>Aspetto</strong> chiaro a scuro, e scegli la tua <strong>Lingua</strong> dall'elenco.",
    guide_settings_step4:"Configura le <strong>Distribuzioni percentuali</strong> se preferisci fare budget per percentuale (come 50% bisogni, 30% desideri, 20% risparmio) invece di importi fissi per categoria.",
    guide_settings_step5:"Scegli come vengono salvati i tuoi dati in <strong>Dati e sincronizzazione</strong> - localmente su questo dispositivo, o sincronizzati con Google Drive così ti seguono su altri dispositivi.",
    guide_settings_step6:"Usa <strong>Esporta dati</strong> per fare un backup di tutto, o <strong>Ripristina dati</strong> se vuoi mai ricominciare completamente da zero.",
    guide_settings_connect1:"Le tue scelte di Valuta, Periodo di budget, Riporto e Automazione qui determinano come ogni altra pagina dell'app calcola e mostra i numeri.",
    guide_settings_connect2:"Attivare la sincronizzazione Google qui permette ai tuoi dati di seguirti se apri l'app su un altro dispositivo.",
    guide_settings_connect3:"Esportare i tuoi dati qui è l'abitudine più sicura prima di qualsiasi cambiamento importante di cui non sei sicuro.",
    guide_settings_tip:"Configura Valuta, Periodo di budget e Dati e sincronizzazione per prima cosa, prima di tutto il resto - sono le fondamenta su cui è costruito tutto il resto dell'app.",
  },
  pl: {
    lang_name:'Polski',
    tab_dashboard:'Panel',tab_budget:'Budżet',tab_transactions:'Transakcje',
    tab_income:'Przychody',tab_expenses:'Wydatki',tab_bills:'Rachunki',
    tab_debt:'Długi',tab_savings:'Oszczędności',tab_settings:'Ustawienia',
    tab_debt_payoff:'Spłata długów',tab_sinking:'Fundusze celowe',
    tab_calendar:'Kalendarz',tab_subscriptions:'Subskrypcje',
    total_income:'Łączne przychody',expenses_bills:'Wydatki i rachunki',
    debt_payments:'Spłaty długów',total_savings:'Łączne oszczędności',
    total_outgoing:'Łączne wydatki',savings_rate:'Stopa oszczędności',
    net_leftover:'Saldo netto',cash_flow:'Przepływ gotówki',
    income_sources:'Źródła dochodów',spending_breakdown:'Podział wydatków',
    expected:'Planowane',actual:'Rzeczywiste',
    of:'z',budgeted:'zaplanowane',saved:'zaoszczędzone',
    budget_period:'Okres budżetowy',start_date:'Data rozpoczęcia',end_date:'Data zakończenia',
    this_month:'Ten miesiąc',this_week:'Ten tydzień',last_week:'Poprz. tydzień',last_month:'Poprz. miesiąc',last_30_days:'Ostatnie 30 dni',this_quarter:'Ten kwartał',this_year:'Ten rok',
    currency:'Waluta',rollover:'Przeniesienie',appearance:'Wygląd',
    language:'Język',reset_data:'Zresetuj dane',
    light:'Jasny',dark:'Ciemny',
    changes_autosaved:'✅ Zmiany są zapisywane automatycznie.',
    rollover_desc:'Przenieś niewydane środki z poprzedniego okresu.',
    rollover_amount:'Kwota przeniesienia',
    reset_desc:'Trwale usuwa wszystkie dane. Nie można cofnąć.',
    reset_btn:'Zresetuj wszystko',
    add:'Dodaj',cancel:'Anuluj',rename_title_prompt:'Zmień nazwę planera budżetu',save:'Zapisz',delete:'Usuń',dp_today:'Dziś',dp_clear:'Wyczyść',edit:'Edytuj',
    paid:'Zapłacone',due_date:'Termin płatności',category:'Kategoria',amount:'Kwota',
    description:'Opis',date:'Data',type:'Typ',
    add_category:'+ Dodaj kategorię',no_transactions:'Brak transakcji.',
    upgrade_title:'Gotowy na doświadczenie pro?',
    upgrade_desc:'Odblokuj kalkulator spłaty długów, fundusze celowe, inteligentny kalendarz i śledzenie subskrypcji.',
    upgrade_now:'Ulepsz teraz →',
    mon:'Pon',tue:'Wt',wed:'Śr',thu:'Czw',fri:'Pt',sat:'Sob',sun:'Nd',
    quick_presets:'Szybki wybór:',select_currency:'Wybierz walutę',select_language:'Wybierz język',
    appearance_desc:'Przełącz między trybem jasnym a ciemnym.',video_tutorial:'▶ Samouczek wideo',
    help_sett_intro:'Wszystkie Twoje preferencje dla Ultimate Budget Planner. Zmiany są zapisywane automatycznie w trakcie ich wprowadzania.',
    help_sett_currency_p:'Zmienia symbol waluty wszędzie w aplikacji natychmiast po wybraniu.',
    help_sett_appearance_p:'Przełącz między trybem jasnym a ciemnym. Twoje ustawienie jest zapamiętywane między sesjami.',
    help_sett_nav_h:'Nawigacja',
    help_sett_nav_top:'Górna nawigacja - Klasyczny poziomy pasek kart na górze (domyślny).',
    help_sett_nav_side:'Boczna nawigacja - Pływający pasek ikon po lewej stronie treści. Kliknij strzałkę, aby rozwinąć i zobaczyć pełne etykiety.',
    help_sett_period_p:'Zakres dat określający „ten budżet“. Tylko transakcje w tym zakresie liczą się do wartości rzeczywistych. Użyj 7 ustawień (Ten miesiąc, Poprz. miesiąc, Ten tydzień, Poprz. tydzień, Ostatnie 30 dni, Ten kwartał, Ten rok) do szybkiej konfiguracji.',
    help_sett_rollover_p:'Niewydane pieniądze, które chcesz przenieść z poprzedniego okresu. Są dodawane do salda netto na panelu.',
    cal_title:'Inteligentny Kalendarz',
    cal_desc:'Wszystkie Twoje rachunki, spłaty długów, subskrypcje i transakcje w jednym kalendarzu na żywo. Kliknij dowolny dzień, aby zobaczyć jego zdarzenia.',
    cal_prev:'← Wstecz',cal_next:'Dalej →',
    cal_all_events:'Wszystkie zdarzenia - ',
    cal_no_events_day:'Brak zdarzeń w tym dniu.',
    cal_no_events_month:'Brak zdarzeń w tym miesiącu.',
    cal_no_events_sub:'Dodaj rachunki, długi lub subskrypcje, aby zobaczyć je tutaj.',
    cal_event_one:'zdarzenie',cal_event_many:'zdarzeń',cal_clear:'Wyczyść ×',
    cal_leg_bill:'Rachunek',cal_leg_debt:'Dług',cal_leg_sub:'Subskrypcja',cal_leg_tx:'Transakcja',cal_leg_sinking:'Fundusz celowy',cal_leg_goal:'Data celu',cal_leg_auto:'Automatyczne',
    cal_paid:'✓ Zapłacono',cal_unpaid:'Niezapłacone',
    help_cal_intro:'Inteligentny Kalendarz łączy wszystkie Twoje zobowiązania finansowe w jednym widoku miesięcznym - aktualizowany automatycznie w miarę dodawania danych.',
    help_cal_ev_types_h:'Typy zdarzeń',
    help_cal_bill_li:'Rachunki - z sekcji budżetu Rachunki (powtarzające się co miesiąc w wybranym dniu płatności)',
    help_cal_debt_li:'Spłaty długów - z sekcji Spłata długów (powtarzające się w dniu płatności)',
    help_cal_sub_li:'Subskrypcje - z trackera Subskrypcji (w dniu następnej daty rozliczenia)',
    help_cal_tx_li:'Transakcje - daty rejestrowania przychodów lub wydatków',
    help_cal_nav_h:'Nawigacja',
    help_cal_nav_p:'Użyj ← Wstecz i Dalej →, aby przechodzić między miesiącami. Kliknij dowolny dzień, aby zobaczyć jego zdarzenia. Kliknij ponownie lub „Wyczyść ×", aby cofnąć zaznaczenie.',
    help_cal_tip:'💡 Ustaw daty płatności dla rachunków i długów, aby w pełni wykorzystać możliwości kalendarza.',
    sf_add_btn:'+ Dodaj fundusz',
    sf_desc:'Fundusz celowy pozwala Ci stopniowo oszczędzać na duży przyszły wydatek - bez nieprzyjemnych niespodzianek. Ustal docelową kwotę i datę, a my powiemy Ci dokładnie, ile oszczędzać co miesiąc.',
    sf_empty_title:'Brak funduszy celowych.',
    sf_empty_sub:'Idealny na: wakacje, naprawy samochodu, wesela, nowy sprzęt, rachunki roczne.',
    sf_pct_complete:'ukończono',
    sf_save_prefix:'Oszczędź',sf_per_month:'/miesiąc',
    sf_month_left_one:'miesiąc pozostał',sf_month_left_many:'miesięcy pozostało',
    sf_total_contrib:'Łączne wymagane miesięczne wpłaty:',
    sf_modal_new:'🏺 Nowy fundusz celowy',sf_modal_edit:'✏️ Edytuj fundusz',
    sf_fund_name_label:'Nazwa funduszu',sf_fund_name_ph:'np. Fundusz wakacyjny',
    sf_icon_label:'Ikona',sf_target_amount_label:'Kwota docelowa',
    sf_currently_saved_label:'Już zaoszczędzono',sf_target_date_label:'Data docelowa',
    sf_create_btn:'Utwórz fundusz',
    help_sf_intro:'Fundusz celowy to pieniądze odkładane z góry na duży zaplanowany wydatek - bez nieprzyjemnych niespodzianek, gdy przychodzi rachunek.',
    help_sf_how_to_h:'Jak go używać',
    help_sf_step1:'Kliknij + Dodaj fundusz',
    help_sf_step2:'Nazwij fundusz (np. „Letnie wakacje"), wybierz ikonę',
    help_sf_step3:'Ustaw kwotę docelową (ile łącznie potrzebujesz)',
    help_sf_step4:'Ustaw datę docelową (kiedy potrzebujesz pieniędzy)',
    help_sf_step5:'Podaj, ile już zaoszczędziłeś',
    help_sf_reading_h:'Czytanie karty',
    help_sf_reading_p:'Każda karta pokazuje zaoszczędzone vs cel, pasek postępu i dokładnie ile oszczędzać miesięcznie, aby osiągnąć cel na czas.',
    help_sf_contrib_h:'Dodawanie wpłat',
    help_sf_contrib_p:'Kliknij ikonę + na karcie, aby zarejestrować wpłatę - podaj kwotę, którą dodajesz w tym miesiącu.',
    help_sf_tip:'💡 Idealny na: wakacje, naprawy samochodu, ubezpieczenia roczne, wesela, elektronikę, remonty domu.',
    dpc_title:'Kalkulator spłaty długów',dpc_add_btn:'+ Dodaj dług',
    dpc_desc:'Wprowadź każdy dług, wybierz strategię spłaty i sprawdź dokładnie, kiedy będziesz wolny od długów i ile odsetek zapłacisz łącznie.',
    dpc_method_label:'Metoda spłaty',
    dpc_snowball_desc:'Najniższe saldo najpierw - szybkie sukcesy utrzymują motywację',
    dpc_avalanche_desc:'Najwyższe oprocentowanie najpierw - oszczędza najwięcej pieniędzy',
    dpc_extra_label:'Dodatkowa miesięczna płatność',
    dpc_extra_hint:'Kwota powyżej minimalnych płatności, którą przeznaczasz na spłatę długu co miesiąc.',
    dpc_empty_title:'Nie dodano jeszcze żadnych długów.',
    dpc_empty_sub:'Kliknij „+ Dodaj dług", aby zbudować plan spłaty.',
    dpc_th_name:'Dług',dpc_th_type:'Typ',dpc_th_balance:'Saldo',
    dpc_th_apr:'Oprocent. %',dpc_th_min:'Min. płatność',dpc_th_due:'Dzień zapłaty',
    dpc_totals:'Suma',dpc_name_ph:'np. Karta Visa',
    dpc_term_label:'Okres kredytowania (lata)',dpc_term_hint:'Określa, jak długo trwa ten kredyt, aby automatyczne obliczenie mogło ustalić dokładną minimalną ratę.',
    dpc_autocalc_btn:'Oblicz automatycznie',dpc_autocalc_done:'Obliczono: {0}/mies.',
    dpc_min_mode_label:'Typ minimalnej raty',dpc_min_mode_fixed:'Stała kwota',dpc_min_mode_percent:'% salda',
    dpc_min_percent_label:'Procent salda (%)',dpc_min_floor_label:'Minimalna kwota',
    dpc_min_calculated_hint:'Obliczane automatycznie - wyższa wartość spośród procentu i minimalnej kwoty.',
    dpc_escrow_label:'Depozyt (podatki i ubezpieczenie)',
    dpc_escrow_hint:'Dolicza się do rzeczywistego kosztu miesięcznego, ale jest wykluczony z symulacji spłaty, ponieważ nie zmniejsza salda.',
    dpc_min_pct_caption:'{0}% salda',dpc_escrow_note:'{0} depozytu',
    dpc_term_note_faster:'{0} mies. szybciej niż Twój {1}-letni okres',dpc_term_note_slower:'{0} mies. wolniej niż Twój {1}-letni okres',
    dpc_term_note_onschedule:'dokładnie zgodnie z harmonogramem dla {0}-letniego okresu',
    dpc_escrow_mode_label:'Typ depozytu',dpc_escrow_mode_fixed:'Stała kwota',dpc_escrow_mode_declining:'Malejący wraz z saldem',
    dpc_escrow_mode_hint:'Dotyczy to tylko harmonogramu spłat poniżej. Twoja zautomatyzowana kwota i suma na pulpicie zawsze używają aktualnej stałej kwoty depozytu.',
    dpc_rate_type_label:'Typ oprocentowania',dpc_rate_type_fixed:'Stałe przez cały okres',dpc_rate_type_arm:'Zmienia się po okresie stałym (zmienne)',
    dpc_rate_type_hint:'Uproszczony model: jedna stawka przez okres stały, a potem jedna nowa stawka na resztę kredytu - nie jest to pełna symulacja indeksu/limitu.',
    dpc_arm_fixed_years_label:'Okres stałego oprocentowania (lata)',dpc_arm_rate_label:'Oprocentowanie po zmianie',
    dpc_arm_caption:'zmienia się po {0}-letnim okresie stałym',
    dpc_recalc_link:'↺ Przelicz ponownie',
    dpc_th_extra:'Dodatkowo/mies.',
    dpc_extra_col_hint:'Płacone dodatkowo do minimalnej raty tego długu co miesiąc, zanim wspólna dodatkowa płatność powyżej zostanie rozdzielona. Zatrzymuje się, gdy ten dług zostanie spłacony - nie jest przekierowywane gdzie indziej.',
    dpc_targeted_extra_note:'{0} celowanej nadpłaty',
    dpc_schedule_btn_title:'Zobacz harmonogram spłat',
    dpc_amort_type_label:'Rodzaj rat',dpc_amort_equal_payment:'Raty równe',dpc_amort_equal_principal:'Raty malejące (stały kapitał)',
    dpc_amort_type_hint:'Przy ratach równych płatność jest taka sama co miesiąc. Przy ratach malejących część kapitałowa jest stała, więc całkowita rata maleje w czasie wraz ze spadkiem odsetek - typowe dla niektórych kredytów hipotecznych.',
    dpc_autocalc_done_declining:'Pierwsza rata: {0}/mies. (maleje co miesiąc)',dpc_declining_caption:'rata malejąca',
    dtype_credit_card:'Karta kredytowa',dtype_student_loan:'Kredyt studencki',
    dtype_mortgage:'Hipoteka',dtype_car_loan:'Kredyt samochodowy',
    dtype_personal_loan:'Kredyt osobisty',dtype_other:'Inne',
    dpc_debt_free_label:'🎯 Data wolności od długów',dpc_months_from_now:'miesięcy od teraz',
    dpc_interest_label:'💸 Łączne odsetki',dpc_on_top:'ponad',dpc_principal:'kapitału',
    dpc_monthly_label:'📅 Suma miesięczna',dpc_min_abbr:'min',dpc_extra_abbr:'dod.',
    dpc_payoff_order_sf:'Kolejność spłaty - ⛄ Śnieżka (najniższe saldo najpierw)',
    dpc_payoff_order_av:'Kolejność spłaty - 🌊 Lawina (najwyższe oprocentowanie najpierw)',
    dpc_paid_off:'Spłacono:',dpc_balance_word:'saldo',dpc_apr_word:'Oprocent.',
    help_dpc_intro:'Ten kalkulator tworzy spersonalizowany plan spłaty długów na podstawie Twoich długów i wybranej strategii.',
    help_dpc_entries_h:'Twoje długi',
    help_dpc_balance_li:'Saldo - Ile aktualnie jesteś winien na tym długu.',
    help_dpc_apr_li:'Oprocent. % - Roczna stopa procentowa (znajdź ją na wyciągu). Np. 18,9 oznacza 18,9%.',
    help_dpc_min_li:'Min. płatność - Minimalna miesięczna płatność wymagana przez pożyczkodawcę.',
    help_dpc_due_li:'Dzień zapłaty - Dzień miesiąca, w którym płatność jest wymagana (widoczny w Inteligentnym Kalendarzu).',
    help_dpc_strategies_h:'Strategie spłaty',
    help_dpc_snowball_li:'\u26c4 Śnieżka - Spłacaj długi zaczynając od najniższego salda. Po spłacie przenieś tę płatność na następny dług. Najlepsza dla motywacji.',
    help_dpc_avalanche_li:'\uD83C\uDF0A Lawina - Spłacaj długi zaczynając od najwyższego oprocentowania. Oszczędza najwięcej pieniędzy.',
    help_dpc_extra_h:'Dodatkowa miesięczna płatność',
    help_dpc_extra_p:'Każda nadwyżka ponad minimalne płatności może być przeznaczona na spłatę długu. Nawet mała dodatkowa płatność może zaoszczędzić setki na odsetkach i skrócić harmonogram. Wyniki aktualizują się podczas pisania.',
    help_dpc_term_li:'Okres kredytowania - Dla kredytów hipotecznych, studenckich, samochodowych i osobistych ustaw okres w latach i kliknij Oblicz automatycznie, aby uzyskać dokładną minimalną ratę.',
    help_dpc_percent_li:'Minimalna rata procentowa - Dla kart kredytowych przełącz na "% salda", aby odpowiadało to rzeczywistemu działaniu minimalnej raty z wyciągu (np. 2% salda lub 25 zł, w zależności od tego, co jest wyższe).',
    help_dpc_escrow_li:'Depozyt - Dla kredytów hipotecznych dodaj miesięczne podatki i ubezpieczenie, aby Twój rzeczywisty koszt miesięczny był wszędzie dokładny; jest wykluczony z prognozy spłaty, ponieważ nie zmniejsza salda.',
    help_dpc_amort_li:'Rodzaj rat - Przy ratach równych Twoja płatność jest taka sama co miesiąc. Przy ratach malejących (stały kapitał) kwota przeznaczona na kapitał jest stała, więc Twoja całkowita rata maleje w czasie; sprawdź dokumenty kredytowe, aby dowiedzieć się, który rodzaj Cię dotyczy.',
    help_dpc_escrow_mode_li:'Typ depozytu - wybierz "Malejący wraz z saldem", jeśli Twój depozyt maleje razem z saldem kredytu, jak niektóre malejące składki ubezpieczeniowe; możesz zobaczyć, jak maleje w harmonogramie spłat.',
    help_dpc_rate_type_li:'Typ oprocentowania - wybierz "Zmienia się po okresie stałym" dla oprocentowania zmiennego, a następnie ustaw, ile lat oprocentowanie jest stałe i na co się zmienia potem.',
    help_dpc_extra_targeted_li:'Dodatkowo/mies. (na dług) - opcjonalna kwota płacona tylko na ten jeden dług co miesiąc, dodatkowo do jego minimalnej raty, niezależnie od kolejności śnieżki/lawiny.',
    dsched_col_date:'Data',dsched_col_payment:'Płatność',dsched_col_principal:'Kapitał',dsched_col_interest:'Odsetki',dsched_col_escrow:'Depozyt',dsched_col_balance:'Saldo',
    dsched_never_payoff_warning:'W tym tempie ten dług nie zostanie w pełni spłacony w ciągu 50 lat - płatność ledwo przewyższa odsetki. Rozważ wyższą minimalną ratę, wyższy próg procentowy lub dodatkową płatność.',
    help_dpc_tip:'\uD83D\uDCA1 Przełącz między metodami, aby zobaczyć, ile odsetek zaoszczędziłbyś przy każdym podejściu.',
    tx_import_csv:'\uD83D\uDCE5 Importuj CSV',
    tx_add_title:'Dodaj transakcję',
    tx_date:'Data',tx_type:'Typ',tx_category:'Kategoria',tx_amount:'Kwota',
    tx_desc_label:'Opis',tx_desc_ph:'np. Zakupy spożywcze\u2026',
    tx_add_btn:'Dodaj',tx_error_required:'Proszę wypełnić wszystkie wymagane pola.',
    tx_transaction_one:'transakcja',tx_transaction_many:'transakcji',
    tx_clear_all:'Wyczyść wszystko',tx_empty:'Brak transakcji.',
    tx_type_income:'Przychód',tx_type_expense:'Wydatek',tx_type_bill:'Rachunek',tx_type_savings:'Oszczędności',
    tx_th_amount:'Kwota',tx_th_desc:'Opis',
    tx_edit_title:'\u270F\uFE0F Edytuj transakcję',tx_save_changes:'Zapisz zmiany',
    help_tx_intro:'Każdy ruch pieniędzy trafia tutaj. Twoje rzeczywiste kwoty budżetu i panel aktualizują się automatycznie za każdym razem, gdy dodajesz transakcję.',
    help_tx_adding_h:'Dodawanie transakcji',
    help_tx_step1:'Wybierz Datę - kliknij pole daty, aby otworzyć kalendarz',
    help_tx_step2:'Wybierz typ: Przychód, Wydatek, Rachunek, Oszczędności, Dług, Subskrypcja lub Fundusz celowy',
    help_tx_step3:'Wybierz pasującą Kategorię (skonfigurowaną w zakładce Budżet)',
    help_tx_step4:'Wprowadź Kwotę i opcjonalny opis',
    help_tx_step5:'Kliknij Dodaj',
    help_tx_edit_h:'Edycja & usuwanie',
    help_tx_edit_p:'Kliknij \u270F\uFE0F na dowolnej transakcji, aby ją edytować, lub \u00d7, aby ją usunąć. Aby usunąć wszystko, użyj „Wyczyść wszystko".',help_tx_auto_h:'Transakcje automatyczne',help_tx_auto_p:'Utwórz regułę dla wszystkiego, co się powtarza (np. czynsz lub wypłata) i wybierz częstotliwość. Aplikacja doda ją do listy automatycznie w każdym terminie. Użyj przełącznika, aby wstrzymać regułę, lub ołówka, aby ją edytować.',
    help_tx_csv_h:'Import CSV',
    help_tx_csv_p1:'Zaimportuj eksport arkusza kalkulacyjnego w formacie: Date,Type,Category,Amount,Description (wymagana linia nagłówka).',
    help_tx_csv_p2:'Daty powinny być w formacie YYYY-MM-DD. Type musi być jednym z: income, expense, bill, savings, debt, subscription, sinking_fund.',
    bud_section_income:'Przychody',bud_section_expenses:'Wydatki',
    bud_section_bills:'Rachunki',bud_section_savings:'Oszczędności',
    bud_th_category:'Kategoria',bud_th_expected:'Planowane',
    bud_th_actual:'Rzeczywiste',bud_th_progress:'Postęp',
    bud_th_due_date:'Data zapłaty',bud_th_paid:'Zapłacono',
    bud_total:'Suma',bud_set_date:'Ustaw datę',
    bud_add_btn:'+ Dodaj',bud_add_cat_title:'Dodaj nową kategorię',
    bud_cat_name_label:'Nazwa kategorii',bud_cat_name_ph:'np. Freelance',
    bud_add_cat_btn:'Dodaj',bud_due_date_label:'Data płatności',
    help_bud_intro:'Zakładka Budżet to miejsce, w którym planujesz swoje finanse. Ustaw planowane kwoty dla każdej kategorii - rzeczywiste wartości są automatycznie uzupełniane z Twoich Transakcji.',
    help_bud_how_h:'Jak to działa',
    help_bud_step1:'Kliknij pole Planowane i wpisz kwotę budżetu',
    help_bud_step2:'Rejestruj transakcje w zakładce Transakcje',
    help_bud_step3:'Kolumna Rzeczywiste i paski postępu aktualizują się automatycznie',
    help_bud_colours_h:'Kolory pasków postępu',
    help_bud_col_green:'Zielony - przychód równy lub wyższy od celu',
    help_bud_col_indigo:'Indigo - wydatek w ramach budżetu',
    help_bud_col_red:'Czerwony - wydatek powyżej budżetu',
    help_bud_bills_h:'Sekcja Rachunki',
    help_bud_bills_p:'Rachunki mają Datę płatności (kliknij, aby otworzyć wybierak daty) i pole wyboru Zapłacono. Daty te pojawiają się też w Inteligentnym Kalendarzu.',
    help_bud_tip:'\uD83D\uDCA1 Użyj "+ Dodaj kategorię", aby tworzyć niestandardowe kategorie dla każdej sekcji.',
    dash_total_income:'Łączne przychody',dash_of:'z',dash_expected_sfx:'planowanych',
    dash_total_outgoing:'Łączne wydatki',dash_budgeted_sfx:'budżetowanych',
    dash_savings_rate:'Stopa oszczędności',dash_saved_sfx:'zaoszczędzono',
    dash_subscriptions:'Subskrypcje',dash_per_year:'/rok',
    dash_net_leftover:'Saldo netto okresu',
    dash_in_sfx:'wpłynęło',dash_out_sfx:'wyszło',
    dash_includes:'W tym',dash_rollover_sfx:'przeniesienie',
    dash_cash_flow:'Przepływ gotówki',
    dash_expected_legend:'Planowane',dash_actual_legend:'Rzeczywiste',
    dash_income_sources:'Źródła przychodów',dash_no_income:'Brak zarejestrowanych przychodów.',
    dash_spending_breakdown:'Zestawienie wydatków',dash_no_spending:'Brak zarejestrowanych wydatków.',
    dash_no_debts:'Nie dodano jeszcze długów.',dash_set_up:'Skonfiguruj \u2192',
    dash_debt_free_label:'Wolny od długów',dash_interest_label:'Odsetki',
    dash_months_label:'Miesiące',dash_method_label:'Metoda',
    dash_set_balances:'Wpisz salda, aby zobaczyć wyniki.',
    dash_upcoming_7:'\uD83D\uDCC5 Nadchodzące (7 dni)',dash_nothing_scheduled:'Nic zaplanowanego.',
    dash_no_sinking:'Brak funduszy celowych.',dash_create_one:'Utwórz jeden \u2192',
    help_dash_intro:'Panel zapewnia przegląd finansów w czasie rzeczywistym. Wszystkie liczby aktualizują się automatycznie po dodaniu transakcji.',
    help_dash_hero_h:'Główne statystyki',
    help_dash_hero_p:'Cztery karty na górze pokazują sumy okresu: Łączne przychody, Łączne wyjścia (wydatki, rachunki, długi & subskrypcje), Stopa oszczędności (% dochodu zaoszczędzonego) i miesięczny koszt subskrypcji.',
    help_dash_leftover_h:'Saldo netto',
    help_dash_leftover_p:'Pieniądze pozostałe po wszystkich wydatkach i oszczędnościach. Zielony = jesteś na plusie. Czerwony = przekroczyłeś budżet.',
    help_dash_cashflow_h:'Wykres przepływu gotówki',
    help_dash_cashflow_p:'Każdy wiersz pokazuje Planowane (szary pasek) vs Rzeczywiste (kolorowy pasek) dla Przychodów, Wydatków, Rachunków i Oszczędności. Czerwony pasek Wydatków oznacza przekroczenie budżetu.',
    help_dash_donut_h:'Wykresy pierścieniowe',
    help_dash_donut_p:'Najedź kursorem lub dotknij segmentu, aby zobaczyć etykietę i procent. Pokazują skąd pochodzą Twoje pieniądze i gdzie trafiają.',
    help_dash_bottom_h:'Dolne panele',
    help_dash_bottom_p:'Szybkie podsumowania postępu spłaty długów, nadchodzących rachunków/subskrypcji w ciągu 30 dni i celów funduszy celowych.',
    help_dash_tip:'\uD83D\uDCA1 Kliknij znacznik daty u góry, aby zmienić okres budżetowy.',
    tx_type_debt:'Dług',
    dash_debt_payments:'Długi',
    dash_debts_paid:'dług spłacony w tym okresie',dash_debts_paid_many:'długów spłaconych w tym okresie',
    tx_type_subscription:'Subskrypcja',
    alloc_title:'Podział budżetu',
    alloc_desc:'Oznaczaj wydatki jako Potrzeba, Chęć lub Oszczędność, aby zobaczyć, jak Twoje pieniądze pasują do docelowego podziału.',
    alloc_label:'Podział',alloc_optional:'Oznacz wydatek',
    alloc_target:'Cel',alloc_on_track:'W planie',alloc_over:'Przekroczono',alloc_under:'Poniżej',
    alloc_enabled_label:'Włącz podział budżetu',
    alloc_name_ph:'Nazwa segmentu',alloc_pct_label:'% dochodu',
    alloc_sum_ok:'\u2713 100%',alloc_sum_bad:'\u26a0 Musi sumować się do 100%',
    alloc_based_on:'Na podstawie',alloc_income_period:'dochodów w tym okresie',
    alloc_untagged:'Nieoznaczone',alloc_untagged_desc:'wydatków jeszcze nieoznaczonych',
    alloc_def_need:'Potrzeba',alloc_def_want:'Chęć',alloc_def_save:'Oszczędność',
    alloc_sett_title:'\uD83C\uDFAF Podział wydatków',
    alloc_nearing:'Blisko',
    alloc_required:'Podział jest wymagany dla transakcji wydatkowych.',
    toast_tx_added:'Transakcja dodana \u2713',toast_tx_updated:'Zaktualizowano \u2713',toast_tx_deleted:'Usuni\u0119to',
    toast_period_updated:'Okres zaktualizowany \u2713',toast_period_error:'Data ko\u0144cowa musi by\u0107 po dacie pocz\u0105tkowej',
    toast_currency_updated:'Waluta zaktualizowana \u2713',toast_imported:'Zaimportowano {0} \u2713',
    toast_fund_created:'Fundusz utworzony \u2713',toast_fund_updated:'Fundusz zaktualizowany \u2713',
    toast_fund_contrib:'Dodano {amt} do {name} \u2713',
    toast_sub_added:'Subskrypcja dodana \u2713',toast_sub_updated:'Subskrypcja zaktualizowana \u2713',
    toast_alloc_enabled:'Podzia\u0142 w\u0142\u0105czony \u2713',toast_alloc_disabled:'Podzia\u0142 wy\u0142\u0105czony',
    toast_lang_updated:'J\u0119zyk zaktualizowany \u2713',toast_export:'Wyeksportowano \u2713',
    toast_saved:'Zapisano \u2713',toast_reset:'Wszystkie dane usuni\u0119te',toast_alloc_bucket_added:'Segment dodany \u2713',
    confirm_remove_cat:'Usun\u0105\u0107 t\u0119 kategori\u0119?',confirm_delete_all_tx:'Usun\u0105\u0107 WSZYSTKIE transakcje? Tej operacji nie mo\u017cna cofn\u0105\u0107.',
    confirm_delete_tx:'Usun\u0105\u0107 t\u0119 transakcj\u0119?',confirm_remove_debt:'Usun\u0105\u0107 ten d\u0142ug?',
    confirm_delete_fund:'Usun\u0105\u0107 ten fundusz?',confirm_remove_sub:'Usun\u0105\u0107 t\u0119 subskrypcj\u0119?',
    confirm_reset_1:'Jeste\u015b pewny? Wszystkie dane zostan\u0105 trwale usuni\u0119te.',
    confirm_reset_2:'Ostatnia szansa - tego nie mo\u017cna cofn\u0105\u0107. Kontynuowa\u0107?',
    export_csv_btn:'\uD83D\uDCE5 Eksportuj CSV',sett_export_title:'\uD83D\uDCE4 Eksportuj dane',
    sett_export_desc:'Pobierz wszystkie transakcje jako plik CSV do kopii zapasowej lub u\u017cycia w innej aplikacji.',
    sf_add_contribution:'Dodaj wp\u0142at\u0119',sf_contribution_label:'Kwota do dodania',sf_currently_saved:'Dotychczas zaoszcz\u0119dzono',
    tx_search_ph:'Szukaj po opisie lub kategorii\u2026',tx_filter_all_types:'Wszystkie typy',tx_filter_all_alloc:'Wszystkie podzia\u0142y',
    tx_sort_date_new:'Najnowsze najpierw',tx_sort_date_old:'Najstarsze najpierw',tx_sort_amt_high:'Najwy\u017csza kwota',tx_sort_amt_low:'Najni\u017csza kwota',
    tx_showing:'Wy\u015bwietlono {n} z {total}',tx_no_results:'\u017badna transakcja nie odpowiada filtrowi.',
    alloc_add_bucket:'+ Dodaj segment',alloc_remove_btn:'Usu\u0144',alloc_total_label:'Razem',alloc_new_bucket:'Nowa kategoria',alloc_color_title:'Wybierz kolor',alloc_custom_color:'Własny',alloc_min_buckets:'Wymagane co najmniej 2 segmenty',
    alloc_auto_tag:'Automatycznie oznaczono \u2192 {name}',
    tx_prev:'\u2190 Poprz.',tx_next:'Nast. \u2192',tx_page_of:'Strona {n} z {total}',
    debt_due_day_note:'Dni 29-31 nie pojawiaj\u0105 si\u0119 w kr\u00f3tszych miesi\u0105cach',
    sub_advanced:'Data rozliczenia przeniesiona na {date}',
    sf_days_left:'Pozosta\u0142o {n} dni',sf_days_overdue:'{n} dni po terminie',
    sf_due_today:'Dzi\u015b!',sf_target_complete:'Cel osi\u0105gni\u0119ty! \u2713',
    alloc_icon_over:'\u25b2',alloc_icon_near:'!',alloc_icon_ok:'\u2713',
    dash_compare_title:'vs Poprzedni okres',dash_compare_no_data:'Brak danych z poprzedniego okresu',
    recurring_title:'Transakcje automatyczne',recurring_desc:'Ustaw transakcje, które powtarzają się (przykład: czynsz, wypłata lub subskrypcje). Są dodawane automatycznie do listy w każdym terminie.',recurring_add_rule:'+ Dodaj transakcj\u0119 automatyczn\u0105',
    recurring_empty:'Nie dodano jeszcze transakcji automatycznych.',recurring_label_ph:'Nazwa transakcji (np. Netflix)',
    recurring_freq:'Cz\u0119stotliwo\u015b\u0107',freq_daily:'Codziennie',freq_weekly:'Co tydzie\u0144',
    freq_monthly:'Co miesi\u0105c',freq_quarterly:'Co kwarta\u0142',freq_annual:'Co rok',
    recurring_next_due:'Nast\u0119pny termin',recurring_generated:'Zautomatyzowano {0} nowych transakcji',
    recurring_remove:'Usu\u0144 regu\u0142\u0119',recurring_paused:'Wstrzymano',recurring_active:'Aktywna',recurring_saved:'Transakcja automatyczna zapisana ✓',dpc_add_debt_title:'Dodaj dług',dpc_edit_debt_title:'Edytuj dług',debt_due_day_modal_hint:'Dzień miesiąca, w którym przypada ta płatność',toast_debt_added:'Dług dodany',toast_debt_updated:'Dług zaktualizowany',sf_billing_day_label:'Dzień miesiąca płatności',sf_billing_day_hint:'Dzień miesiąca, w którym wpłata jest księgowana automatycznie',sf_error_required:'Wypełnij wszystkie wymagane pola',sub_active:'Aktywna',sub_paused:'Wstrzymana',sub_desc:'Śledź każdą powtarzającą się płatność i poznaj swój rzeczywisty roczny koszt. Wstrzymaj subskrypcje, z których nie korzystasz, aby kontrolować wydatki.',sub_add_btn:'+ Dodaj subskrypcję',sub_add_title:'Dodaj subskrypcję',sub_edit_title:'Edytuj subskrypcję',sub_empty_title:'Brak subskrypcji.',sub_empty_sub:'Dodaj swoje powtarzające się płatności - Netflix, Spotify, siłownia itp.',sub_sum_monthly:'Suma miesięczna',sub_sum_annual:'Suma roczna',sub_by_category:'Według kategorii',sub_per_month:'/miesiąc',sub_next_label:'Następna',sub_name_label:'Nazwa subskrypcji',sub_name_ph:'np. Netflix',sub_amount_label:'Kwota',sub_freq_label:'Częstotliwość rozliczeń',sub_freq_monthly:'Miesięcznie',sub_freq_annual:'Rocznie',sub_freq_quarterly:'Kwartalnie',sub_freq_weekly:'Tygodniowo',sub_unit_month:'miesiąc',sub_unit_year:'rok',sub_unit_quarter:'kwartał',sub_cat_label:'Kategoria',sub_date_label:'Data następnego rozliczenia',sub_cat_entertainment:'Rozrywka',sub_cat_productivity:'Produktywność',sub_cat_health:'Zdrowie i fitness',sub_cat_food:'Jedzenie i napoje',sub_cat_cloud:'Chmura',sub_cat_finance:'Finanse',sub_cat_education:'Edukacja',sub_cat_gaming:'Gry',sub_cat_news:'Wiadomości i media',sub_cat_other:'Inne',help_sub_intro:'Śledź każdą powtarzającą się płatność i poznaj swój rzeczywisty miesięczny i roczny koszt. Subskrypcje, które po cichu obciążają konto, łatwo przeoczyć - dzięki temu pozostają widoczne.',help_sub_how_h:'Dodawanie subskrypcji',help_sub_step1:'Kliknij + Dodaj subskrypcję',help_sub_step2:'Wpisz nazwę, kwotę i częstotliwość rozliczeń (miesięcznie, rocznie, kwartalnie, tygodniowo)',help_sub_step3:'Wybierz kategorię, aby grupować podobne subskrypcje',help_sub_step4:'Ustaw datę następnego rozliczenia - pojawi się w inteligentnym kalendarzu',help_sub_monthly_h:'Odpowiednik miesięczny',help_sub_monthly_p:'Subskrypcje roczne i kwartalne są przeliczane na koszt miesięczny, dzięki czemu od razu widzisz swój rzeczywisty miesięczny wydatek.',help_sub_pause_h:'Wstrzymywanie subskrypcji',help_sub_pause_p:'Wyłącz przełącznik Aktywna przy subskrypcji, z której obecnie nie korzystasz. Nie będzie liczona w sumach, dopóki nie włączysz go ponownie.',help_sub_chart_h:'Wykres według kategorii',help_sub_chart_p:'Wykres kołowy pokazuje, jak Twoje wydatki na subskrypcje rozkładają się na kategorie - najedź na segment, aby zobaczyć szczegóły.',help_sub_tip:'💡 Włącz „Automatyzuj” przy subskrypcji, aby była automatycznie dodawana do transakcji w każdym cyklu rozliczeniowym.',automate_auto_pay:'Auto-płatność',sf_auto_contribute:'Auto-wpłata',sf_auto_need_amount:'Najpierw dodaj kwotę docelową i datę',sf_auto_set:'Miesięczna wpłata: {0}',automate_label:'Automatyzuj',automate_hint:'Dodaje to automatycznie do transakcji według harmonogramu',automate_hint_off:'Włącz Automatyzację w Ustawieniach, aby użyć',automate_th:'Auto-płatność',automate_need_amount:'Najpierw ustaw minimalną płatność',automate_payment_word:'płatność',automate_linked:'Powiązana transakcja automatyczna',sf_contribution_label:'Miesięczna wpłata',sf_contribution_hint:'Księgowana automatycznie co miesiąc, aby zwiększać ten fundusz',sett_automation_h:'Automatyzacja',sett_automation_desc:'Główny przełącznik transakcji automatycznych. Gdy wyłączony, nie są generowane zaplanowane transakcje, a opcje automatyzacji są nieaktywne.',sett_automation_toggle:'Transakcje automatyczne',sett_automation_hint:'Dotyczy transakcji, subskrypcji, funduszy i długów',
    tx_type_sinking_fund:'Fundusz celowy',
    help_dash_alloc_h:'Panel podziału budżetu',
    help_dash_alloc_what_h:'Czym jest',
    help_dash_alloc_what_p:'Śledzi Twoje wydatki w odniesieniu do dostosowywalnych procentów docelowych Twoich dochodów. Klasyczna zasada 50/30/20 dzieli dochód na: Potrzeby (niezbędne: czynsz, jedzenie, rachunki), Chęci (styl życia: restauracje, streaming, hobby) i Oszczędności (budowanie majątku i spłata długów). Możesz ustawić dowolny podział - procenty muszą tylko sumować się do 100%.',
    help_dash_alloc_tag_h:'Oznaczanie transakcji',
    help_dash_alloc_tag_p:'Podczas rejestrowania transakcji wybierz podział (Potrzeba / Chęć / Oszczędność) z listy rozwijanej. Przychody i wpłaty oszczędnościowe nie są oznaczane. Odznaka ? w wierszu oznacza, że ten wydatek nie jest jeszcze oznaczony.',
    help_dash_alloc_read_h:'Czytanie kart',
    help_dash_alloc_read_p:'Każda karta pokazuje nazwę segmentu, docelowy % i rzeczywisty % dochodu za okres. Cienki pasek wypełnia się proporcjonalnie - gdy jest pełny, osiągnąłeś swój limit.',
    help_dash_alloc_col_h:'Kodowanie kolorami',
    help_dash_alloc_col_over:'Czerwony - przekroczyłeś cel. Procent i pasek stają się czerwone.',
    help_dash_alloc_col_near:'Pomarańczowy - w odległości 5 punktów procentowych od celu. Ostrzeżenie, że zbliżasz się do limitu.',
    help_dash_alloc_col_norm:'Kolor segmentu - wygodnie w ramach celu na ten okres.',
    help_dash_alloc_setup_h:'Dostosowanie',
    // Penny (asystentka AI)
    sett_penny_h:'Penny (Asystentka budżetu AI)',
    sett_penny_desc:'Zapytaj Penny o swój budżet & nawyki wydatkowe',
    sett_penny_toggle:'Włącz Penny',
    sett_penny_hint:'Włącza asystentkę Penny i jej ikonę na pasku nawigacji.',
    sett_penny_key_label:'Klucz API Gemini',
    sett_penny_key_placeholder:'Wklej swój klucz API Gemini',
    sett_penny_howto:'Jak utworzyć swój klucz',
    sett_penny_save_btn:'Zapisz klucz',
    sett_penny_key_saved:'Klucz API Gemini zapisany i zaszyfrowany',
    sett_penny_remove:'Usuń klucz',
    sett_penny_available:'Penny jest teraz dostępna w menu nawigacji.',
    sett_penny_usage_count:'Penny odpowiedziała na {0} pytań w tym miesiącu',
    sett_penny_key_error_short:'To nie wygląda na prawidłowy klucz. Sprawdź i spróbuj ponownie.',
    confirm_penny_remove_key:'Usunąć zapisany klucz API Gemini? Penny zostanie wyłączona, dopóki nie dodasz nowego.',
    toast_penny_key_saved:'Klucz Gemini zapisany bezpiecznie.',
    penny_nav_pill_off:'Włącz Penny',
    penny_nav_pill_on:'Zapytaj Penny',
    penny_nav_aria_off:'Włącz Penny',
    penny_nav_aria_on:'Zapytaj Penny',
    penny_chat_title:'Zapytaj Penny',
    penny_input_placeholder:'Zapytaj o swój budżet…',
    penny_send:'Zapytaj',
    penny_thinking:'Penny się zastanawia…',
    penny_voice_on:'Odpowiedzi głosowe włączone',
    penny_voice_off:'Odpowiedzi głosowe wyłączone',
    penny_disclaimer:'Twoja własna asystentka budżetu AI',
    penny_no_key_notice:'Dodaj swój klucz API Gemini w Ustawieniach, aby zacząć rozmowę z Penny.',
    penny_open_settings:'Otwórz ustawienia',
    penny_close:'Zamknij Penny',
    penny_qp_leftover:'Ile mi zostało w tym okresie?',
    penny_qp_top_category:'Jaka jest moja największa kategoria wydatków?',
    penny_qp_on_track:'Czy trzymam się budżetu?',
    penny_qp_subscriptions:'Ile płacę za subskrypcje?',
    penny_qp_debt:'Jak przebiega spłata moich długów?',
    penny_qp_chart:'Pokaż mi wykres moich wydatków',
    penny_err_invalid_key:'Twój klucz API Gemini wygląda na nieprawidłowy lub został cofnięty. Zaktualizuj go w Ustawieniach.',
    penny_err_rate_limited:'Osiągnięto limit zapytań Gemini. To limit Google dotyczący Twojego klucza, a nie licznik powyżej. Poczekaj chwilę i spróbuj ponownie.',
    penny_err_network:'Penny nie mogła połączyć się z serwerami Google. Sprawdź połączenie i spróbuj ponownie.',
    penny_err_blocked:'Penny nie znalazła bezpiecznej odpowiedzi na to pytanie. Spróbuj inaczej sformułować pytanie o budżet.',
    penny_err_unknown:'Coś poszło nie tak po stronie Penny. Spróbuj ponownie za chwilę.',
    penny_err_key_unreadable:'Nie udało się odczytać zapisanego klucza. Wprowadź go ponownie w Ustawieniach.',
    penny_err_retry:'Spróbuj ponownie',
    help_sett_penny_p:'Włącz Penny poniżej, aby zadawać pytania o swój budżet prostym językiem. Dotknij „Jak utworzyć swój klucz”, aby zobaczyć kroki konfiguracji.',
    help_penny_title:'Konfiguracja Penny',
    help_penny_intro:'Penny to asystentka AI Evo Budget. Ponieważ ta aplikacja nie ma własnego serwera, Penny rozmawia bezpośrednio z Google z poziomu Twojej przeglądarki, korzystając z Twojego własnego, darmowego klucza API Gemini. Żadne dane nigdy nie przechodzą przez serwer Evo Budget, bo taki serwer po prostu nie istnieje.',
    help_penny_steps_h:'Jak utworzyć swój klucz',
    help_penny_step1:'Przejdź do Google AI Studio (aistudio.google.com/apikey) i zaloguj się na konto Google.',
    help_penny_step2:'Kliknij „Utwórz klucz API” (wybierz „Utwórz klucz w nowym projekcie”, jeśli jeszcze go nie masz).',
    help_penny_step3:'Skopiuj wygenerowany klucz (zaczyna się od AIza…).',
    help_penny_step4:'Wklej go w polu „Klucz API Gemini” w Ustawieniach Evo Budget i kliknij „Zapisz klucz”.',
    help_penny_cost_h:'Czy to jest darmowe?',
    help_penny_cost_p:'API Gemini ma darmowy poziom z limitami ustalanymi przez Google, które mogą się zmieniać. Aktualne limity możesz sprawdzić w dowolnym momencie na aistudio.google.com. Licznik „zadanych pytań” widoczny w Ustawieniach to osobisty licznik przechowywany na Twoim urządzeniu. Nie jest to odczyt rzeczywistego limitu Google w czasie rzeczywistym.',
    help_penny_safety_h:'Czy mój klucz jest bezpieczny?',
    help_penny_safety_p:'Twój klucz jest szyfrowany przed zapisaniem w pamięci Twojej przeglądarki i jest wysyłany bezpośrednio do API Google tylko wtedy, gdy zadajesz Penny pytanie. Nigdy nie trafia do żadnego serwera Evo Budget.',
    help_penny_cta:'Otwórz Google AI Studio →',
    help_dash_alloc_setup_p:'Otwórz Ustawienia \u2192 Podział wydatków. Edytuj nazwy segmentów, dostosuj procenty i włącz lub wyłącz panel. Procenty muszą sumować się do 100%.',
    // Guide
    guide_group_start:'Pierwsze kroki', guide_group_track:'Kontroluj swoje pieniądze', guide_group_plan:'Planuj z rozmachem',
    guide_group_smart:'Pracuj mądrzej', guide_group_settings:'Dostosuj do siebie',
    guide_section_big:'Ogólny obraz', guide_section_how:'Jak z tego korzystać', guide_section_connects:'Jak to się łączy', guide_back:'Wróć do tematów',
    guide_welcome_title:'Witamy w Ultimate Budget Planner',
    guide_welcome_big:'Ultimate Budget Planner bierze prostą ideę śledzenia przychodów i wydatków i nadaje jej supermoce - prawdziwy plan spłaty długów, cele oszczędnościowe z paskami postępu, kalendarz z widokiem z lotu ptaka, śledzenie subskrypcji oraz Penny, asystentkę AI, która już zna twoje liczby. Zacznij od Pulpitu i eksploruj resztę, gdy będziesz gotowy.',
    guide_dashboard_title:'Pulpit',
    guide_dashboard_big:'Pulpit to twoje centrum dowodzenia - wszystko, co ważne w twoich finansach, znajduje się na tym jednym ekranie, od wyniku końcowego po to, co czeka cię w tym tygodniu.',
    guide_dashboard_step1:'Sprawdź karty podsumowania u góry, aby zobaczyć swój <strong>Całkowity przychód</strong>, <strong>Całkowite wydatki</strong>, <strong>Wskaźnik oszczędności</strong> i <strong>Saldo netto</strong>.',
    guide_dashboard_step2:'Sprawdź listę <strong>Nadchodzące</strong>, aby zobaczyć wszystko, co jest wymagalne w ciągu następnych 7 dni - rachunki, płatności długów i subskrypcje w jednym miejscu.',
    guide_dashboard_step3:'Sprawdź swoje podsumowania <strong>Spłaty długów</strong> i <strong>Funduszy celowych</strong>, aby zobaczyć postęp w realizacji większych celów na pierwszy rzut oka.',
    guide_dashboard_connect1:'Każda liczba tutaj pochodzi na żywo z Transakcji, Budżetu, Spłaty długów, Funduszy celowych i Subskrypcji - nie ma nic do obliczania ręcznie.',
    guide_dashboard_connect2:'Saldo netto uwzględnia twoje ustawienie <strong>Przeniesienia</strong>, dzięki czemu niewydane pieniądze z poprzedniego okresu mogą przejść automatycznie.',
    guide_dashboard_connect3:'Jeśli coś się nie zgadza, prawie zawsze warto sprawdzić stronę źródłową - Pulpit jest lustrem, a nie źródłem.',
    guide_dashboard_tip:'Poświęć 30 sekund każdego ranka na przejrzenie Pulpitu - to najszybszy sposób, by zauważyć rachunek lub płatność długu, zanim się spóźni.',
    guide_transactions_title:'Transakcje',
    guide_transactions_big:'Transakcje są fundamentem wszystkiego w tej aplikacji - każda złotówka, którą tu zapiszesz, napędza twój Pulpit, twój budżet i każdy wykres, który widzisz. Ultimate Budget Planner pozwala też zautomatyzować powtarzalne czynności, abyś nie musiał zapisywać tego samego co okres.',
    guide_transactions_step1:'Dotknij <strong>Dodaj transakcję</strong>, wybierz typ i kategorię, i wpisz kwotę.',
    guide_transactions_step2:'Skonfiguruj <strong>Regułę cykliczną</strong> dla wszystkiego, co się powtarza, na przykład czynszu lub pensji, aby zapisywało się automatycznie zamiast wpisywać to za każdym razem.',
    guide_transactions_step3:'Użyj <strong>Importuj CSV</strong>, aby wprowadzić istniejące wydatki naraz zamiast wpisywać je ręcznie.',
    guide_transactions_step4:'Dotknij dowolnej transakcji, aby ją edytować, lub użyj filtrów nad listą, aby szybko coś znaleźć.',
    guide_transactions_connect1:'Reguły cykliczne skonfigurowane tutaj napędzają funkcję <strong>Automatyzacji</strong> - gdy reguła istnieje, nadal zapisuje się zgodnie z planem bez twojego udziału.',
    guide_transactions_connect2:'Każda transakcja automatycznie liczy się do odpowiedniej kategorii w Budżecie, Spłacie długów lub Subskrypcjach.',
    guide_transactions_connect3:'Sumy i wykresy na twoim Pulpicie są budowane wyłącznie na podstawie tego, co tu zapisano.',
    guide_transactions_tip:'Skonfiguruj najpierw reguły cykliczne dla swoich stałych rachunków i pensji - to największa oszczędność czasu w całej aplikacji.',
    guide_budget_title:'Budżet',
    guide_budget_big:'Budżet to miejsce, w którym ustawiasz swoje cele - ile spodziewasz się zarobić i wydać w Przychodach, Wydatkach, Rachunkach i Oszczędnościach - wszystko z jednego ekranu zamiast przeskakiwania między osobnymi kartami.',
    guide_budget_step1:'Dodaj kategorię w <strong>Przychodach</strong>, <strong>Wydatkach</strong>, <strong>Rachunkach</strong> lub <strong>Oszczędnościach</strong> i ustaw jej kwotę <strong>Oczekiwaną</strong>.',
    guide_budget_step2:'W miarę zapisywania transakcji obserwuj, jak kolumna <strong>Rzeczywista</strong> wypełnia się automatycznie dla każdej kategorii.',
    guide_budget_step3:'Porównaj Oczekiwaną z Rzeczywistą, aby zobaczyć, które kategorie są na dobrej drodze, a które wymagają uwagi.',
    guide_budget_step4:'Dostosuj każdą Oczekiwaną kwotę, gdy zmienia się twoje życie - twój budżet powinien dopasowywać się do ciebie, a nie odwrotnie.',
    guide_budget_connect1:'Każda transakcja zapisana w Transakcjach trafia bezpośrednio do odpowiedniej kategorii tutaj.',
    guide_budget_connect2:'Twój wykres Podziału wydatków i Saldo netto na Pulpicie są budowane na podstawie tych kategorii.',
    guide_budget_connect3:'Jeśli włączyłeś <strong>Podział procentowy budżetu</strong> w Ustawieniach, tutaj również zobaczysz, jak twoje wydatki wypadają na tle tych procentowych celów.',
    guide_budget_tip:'Przeglądaj swoje Oczekiwane kwoty raz w miesiącu - budżet, który nigdy się nie zmienia, dość szybko przestaje odzwierciedlać rzeczywistość.',
    guide_debt_title:'Kalkulator spłaty długów',
    guide_debt_big:'To coś więcej niż zapis tego, co jesteś winien - buduje dla ciebie prawdziwy plan, jak stać się wolnym od długów, pokazując dokładnie, który dług potraktować priorytetowo i ile odsetek dzięki temu zaoszczędzisz.',
    guide_debt_step1:'Dodaj każdy dług z jego <strong>Saldem</strong>, <strong>Oprocentowaniem</strong> i <strong>Minimalną płatnością</strong>.',
    guide_debt_step2:'Wybierz strategię: <strong>Kula śnieżna</strong> (najpierw spłać najmniejsze saldo dla szybkich sukcesów) lub <strong>Lawina</strong> (najpierw spłać najwyższe oprocentowanie, aby zaoszczędzić najwięcej).',
    guide_debt_step3:'Dodaj każdą dodatkową kwotę, którą możesz przeznaczyć na długi w danym okresie - kalkulator zastosuje ją do długu, na który wskazuje twoja strategia jako pierwszy.',
    guide_debt_step4:'Sprawdź swoją przewidywaną <strong>datę wolności od długów</strong> i łączne odsetki, aby zobaczyć, jak dodatkowe płatności zmieniają sytuację.',
    guide_debt_step5:'W przypadku kredytów hipotecznych i innych pożyczek ustaw <strong>okres kredytowania</strong> i kliknij <strong>Oblicz automatycznie</strong>, aby uzyskać dokładną minimalną ratę. W przypadku kart kredytowych przełącz na <strong>% salda</strong>, aby dopasować się do rzeczywistego wyciągu.',
    guide_debt_step6:'Niektóre kredyty korzystają z <strong>rat malejących</strong> zamiast rat równych - część kapitałowa jest stała, a całkowita rata maleje w czasie. Sprawdź <strong>rodzaj rat</strong>, aby dopasować go do swojego kredytu.',
    guide_debt_step7:'W przypadku oprocentowania zmiennego przełącz <strong>typ oprocentowania</strong> na "Zmienia się po okresie stałym" i ustaw, kiedy się zmienia. W przypadku depozytu hipotecznego, który maleje z czasem, przełącz <strong>typ depozytu</strong> na "Malejący wraz z saldem".',
    guide_debt_step8:'Kliknij <strong>ikonę ℹ️ informacji</strong> przy dowolnym długu, aby zobaczyć pełny miesięczny harmonogram spłat. Użyj kolumny <strong>Dodatkowo/mies.</strong>, aby skierować dodatkowe płatności na konkretny dług, niezależnie od kolejności śnieżki/lawiny.',
    guide_debt_connect1:'Płatności długów zapisane w Transakcjach liczą się do salda każdego długu tutaj.',
    guide_debt_connect2:'Twój Pulpit pokazuje podsumowanie tego planu spłaty, dzięki czemu zawsze wiesz, na czym stoisz, bez otwierania tej strony.',
    guide_debt_connect3:'Płacenie więcej niż minimum tutaj - nawet trochę więcej - jest zwykle największą dźwignią do skrócenia czasu spłaty.',
    guide_debt_tip:'Wypisz nawet małe długi, takie jak pożyczka rodzinna - liczy się nie kwota, lecz wiedza o wszystkim, co jesteś winien, w jednym miejscu.',
    guide_sinking_title:'Fundusze celowe',
    guide_sinking_big:'Fundusz celowy to pieniądze, które odkładasz po trochu na coś konkretnego, o czym wiesz, że nadejdzie - wakacje, nowy laptop, prezenty - dzięki czemu nigdy nie staje się to nagłym wydatkiem, gdy koszt faktycznie się pojawi.',
    guide_sinking_step1:'Utwórz fundusz i nadaj mu <strong>Kwotę docelową</strong> oraz, jeśli chcesz, datę docelową.',
    guide_sinking_step2:'Dodawaj wpłaty za każdym razem, gdy odkładasz na niego pieniądze, i obserwuj, jak wypełnia się <strong>pasek postępu</strong>.',
    guide_sinking_step3:'Gdy fundusz osiągnie swój cel, jesteś gotowy na ten wydatek bez naruszania regularnego budżetu.',
    guide_sinking_connect1:'Fundusze celowe różnią się od twojej zwykłej kategorii Oszczędności - służą konkretnym, zaplanowanym celom, a nie ogólnemu oszczędzaniu.',
    guide_sinking_connect2:'Twój Pulpit pokazuje podsumowanie postępu wszystkich twoich funduszy w jednym miejscu.',
    guide_sinking_connect3:'Regularne wpłacanie do funduszu, nawet niewielkiej kwoty, zamienia duży wydatek w coś, co nigdy nie wykoleja twojego budżetu.',
    guide_sinking_tip:'Podziel duże cele na okrągłe miesięczne kwoty - o wiele łatwiej zobowiązać się do 200 zł miesięcznie niż do "zaoszczędzenia kiedyś na wakacje".',
    guide_subscriptions_title:'Subskrypcje',
    guide_subscriptions_big:'Subskrypcje mają tendencję do cichego narastania - ta strona wymienia każdą cykliczną usługę, za którą płacisz, w jednym miejscu, dzięki czemu nic nie obciąża cię bez twojej wiedzy.',
    guide_subscriptions_step1:'Dodaj każdą subskrypcję wraz z jej kosztem i częstotliwością rozliczeń (miesięczna, roczna itd.).',
    guide_subscriptions_step2:'Sprawdź sumę <strong>Kosztu miesięcznego</strong>, aby zobaczyć, ile wynoszą wszystkie twoje subskrypcje razem.',
    guide_subscriptions_step3:'Wstrzymaj lub anuluj wszystko, czego nie używasz, bezpośrednio z tej strony.',
    guide_subscriptions_connect1:'Łączny koszt twoich subskrypcji trafia bezpośrednio do podsumowania na Pulpicie i twoich Całkowitych wydatków.',
    guide_subscriptions_connect2:'Terminy subskrypcji pojawiają się również w Kalendarzu, dzięki czemu widzisz je obok rachunków i płatności długów.',
    guide_subscriptions_connect3:'Przeglądanie tej listy co kilka miesięcy to jeden z najłatwiejszych sposobów na znalezienie pieniędzy, o których stracie nawet nie wiedziałeś.',
    guide_subscriptions_tip:'Zrób przegląd subskrypcji tuż po otrzymaniu wyciągu bankowego co miesiąc - to najłatwiejszy moment, by zauważyć coś, o czym zapomniałeś, że płacisz.',
    guide_calendar_title:'Kalendarz',
    guide_calendar_big:'Kalendarz zbiera każdy rachunek, płatność długu, opłatę subskrypcji i transakcję w widoku miesięcznym, dzięki czemu widzisz wszystko, co dzieje się z twoimi pieniędzmi, na pierwszy rzut oka, zamiast sprawdzać pięć różnych stron.',
    guide_calendar_step1:'Przeglądaj dowolny miesiąc, aby zobaczyć kolorowe kropki oznaczające rachunki, płatności długów i subskrypcje wymagalne danego dnia.',
    guide_calendar_step2:'Dotknij dnia, aby zobaczyć pełną listę wszystkiego, co się w nim dzieje.',
    guide_calendar_step3:'Skorzystaj z tego widoku przed większym zakupem, aby zobaczyć, co jeszcze jest wymagalne w podobnym czasie.',
    guide_calendar_connect1:'Wszystko, co jest tu pokazane, pochodzi z Rachunków, Spłaty długów, Subskrypcji i Transakcji - Kalendarz nie przechowuje własnych danych.',
    guide_calendar_connect2:'To najszybszy sposób, by zauważyć tydzień, w którym kilka terminów wypada blisko siebie, zanim zaskoczy cię to znienacka.',
    guide_calendar_connect3:'Nic, co robisz w Kalendarzu, nie zmienia twojego budżetu - to czysty widok, więc jest całkowicie bezpieczny do przeglądania.',
    guide_calendar_tip:'Sprawdzaj Kalendarz na początku każdego tygodnia - zajmuje to kilka sekund, a terminy nigdy nie są niespodzianką.',
    guide_rollover_title:'Przeniesienie',
    guide_rollover_big:'Przeniesienie oznacza, że niewydane pieniądze z poprzedniego okresu po prostu nie znikają - przechodzą automatycznie i dodają się do tego, co masz dostępne w tym okresie.',
    guide_rollover_step1:'Otwórz <strong>Ustawienia</strong> i znajdź kartę <strong>Przeniesienie</strong>.',
    guide_rollover_step2:'Włącz je, aby każda pozostała kwota z poprzedniego okresu automatycznie przechodziła do nowego.',
    guide_rollover_step3:'Sprawdź Saldo netto na swoim Pulpicie - będzie teraz zawierać tę przeniesioną kwotę.',
    guide_rollover_connect1:'Przeniesienie działa bezpośrednio w oparciu o twoje Saldo netto z poprzedniego okresu - im lepiej trzymasz się budżetu, tym więcej ma do przeniesienia.',
    guide_rollover_connect2:'To różni się od Funduszy celowych, które służą zaplanowanym przyszłym celom - Przeniesienie dotyczy tylko tego, by nie stracić z oczu pieniędzy, które już masz.',
    guide_rollover_connect3:'Seria dobrych miesięcy ładnie się tu kumuluje, ponieważ nadwyżka z każdego okresu dodaje się do kolejnego.',
    guide_rollover_tip:'Jeśli duża kwota przeniesienia pali cię w kieszeni, rozważ przeniesienie jej części do Funduszu celowego, aby była przeznaczona na coś konkretnego.',
    guide_automation_title:'Automatyzacja',
    guide_automation_big:'Automatyzacja bierze reguły cykliczne skonfigurowane w Transakcjach i zapisuje je automatycznie za ciebie, dzięki czemu twoje stałe rachunki, pensje i subskrypcje pojawiają się dokładnie na czas bez twojego udziału.',
    guide_automation_step1:'Otwórz <strong>Ustawienia</strong> i znajdź kartę <strong>Automatyzacja</strong>.',
    guide_automation_step2:'Włącz ją, aby cykliczne reguły transakcji zapisywały się automatycznie, gdy staną się wymagalne.',
    guide_automation_step3:'Sprawdź później Transakcje, aby potwierdzić, że wszystko zapisało się zgodnie z oczekiwaniami.',
    guide_automation_connect1:'Ta funkcja działa tylko z regułami cyklicznymi, które już utworzyłeś w Transakcjach - skonfiguruj je najpierw.',
    guide_automation_connect2:'Każda zapisana przez nią transakcja trafia do Budżetu, Spłaty długów i Subskrypcji dokładnie tak jak wpisana ręcznie.',
    guide_automation_connect3:'To różnica między aplikacją budżetową, o której aktualizacji musisz pamiętać, a taką, która sama się aktualizuje.',
    guide_automation_tip:'Włącz Automatyzację, gdy twoje reguły cykliczne wydają się poprawne - jest najbardziej przydatna, gdy ufasz liczbom, które będzie zapisywać.',
    guide_penny_title:'Penny',
    guide_penny_big:'Penny to twoja własna asystentka AI do budżetu, wbudowana bezpośrednio w aplikację - zadaj jej pytanie o swoje pieniądze prostym językiem, a ona odczyta twoje prawdziwe dane budżetowe, aby dać ci prawdziwą odpowiedź, z wykresami, gdy to pomaga.',
    guide_penny_step1:'Otwórz <strong>Ustawienia</strong>, włącz Penny i wklej swój własny klucz API Gemini (jest tam link pokazujący dokładnie, jak zdobyć jeden za darmo).',
    guide_penny_step2:'Dotknij ikony błysku w górnej nawigacji, aby otworzyć czat.',
    guide_penny_step3:'Zadaj pytanie własnymi słowami, na przykład "jaka jest moja największa kategoria wydatków w tym miesiącu?", albo dotknij jednego z przycisków szybkich pytań, aby zacząć.',
    guide_penny_step4:'Włącz lub wyłącz jej odpowiedź głosową za pomocą ikony głośnika, jeśli wolisz słuchać niż czytać.',
    guide_penny_connect1:'Penny może jedynie odczytywać twoje dane budżetowe, aby odpowiadać na pytania - nigdy nie może niczego dodać, edytować ani usunąć za ciebie.',
    guide_penny_connect2:'Korzysta bezpośrednio z Pulpitu, Transakcji, Spłaty długów, Subskrypcji i Funduszy celowych, dzięki czemu jej odpowiedzi zawsze zgadzają się z tym, co zobaczyłbyś sam na tych stronach.',
    guide_penny_connect3:'Twój klucz API jest szyfrowany i przechowywany wyłącznie na twoim urządzeniu - nigdy nie jest wysyłany nigdzie indziej poza bezpośrednio do Google, gdy zadajesz Penny pytanie.',
    guide_penny_tip:'Zacznij od jednego z przycisków szybkich pytań za pierwszym razem - to najszybszy sposób, by zobaczyć, co potrafi, zanim zadasz własne pytania.',
    guide_settings_title:'Ustawienia',
    guide_settings_big:'Ustawienia to miejsce, w którym aplikacja dostosowuje się do ciebie - waluta, okres budżetowy, przeniesienie, automatyzacja, wygląd, język oraz sposób zapisywania i tworzenia kopii zapasowych twoich danych.',
    guide_settings_step1:'Wybierz swoją <strong>Walutę</strong> i <strong>Okres budżetowy</strong>, aby aplikacja pasowała do twojego rzeczywistego rytmu płatności i wydatków.',
    guide_settings_step2:'Włącz <strong>Przeniesienie</strong> i <strong>Automatyzację</strong>, jeśli chcesz, aby niewydane pieniądze i cykliczne transakcje były obsługiwane automatycznie za ciebie.',
    guide_settings_step3:'Przełącz <strong>Wygląd</strong> między jasnym a ciemnym i wybierz swój <strong>Język</strong> z listy.',
    guide_settings_step4:'Skonfiguruj <strong>Podział procentowy budżetu</strong>, jeśli wolisz budżetować procentowo (na przykład 50% potrzeby, 30% zachcianki, 20% oszczędności) zamiast stałych kwot dla kategorii.',
    guide_settings_step5:'Wybierz, jak przechowywane są twoje dane w <strong>Danych i synchronizacji</strong> - lokalnie na tym urządzeniu lub zsynchronizowane z Google Drive, aby podążały za tobą na inne urządzenia.',
    guide_settings_step6:'Użyj <strong>Eksportuj dane</strong>, aby zrobić kopię zapasową wszystkiego, lub <strong>Zresetuj dane</strong>, jeśli kiedykolwiek zechcesz zacząć zupełnie od nowa.',
    guide_settings_connect1:'Twoje wybory Waluty, Okresu budżetowego, Przeniesienia i Automatyzacji tutaj określają, jak każda inna strona aplikacji oblicza i wyświetla liczby.',
    guide_settings_connect2:'Włączenie synchronizacji Google tutaj sprawia, że twoje dane podążają za tobą, gdy otworzysz aplikację na innym urządzeniu.',
    guide_settings_connect3:'Eksportowanie danych tutaj to najbezpieczniejszy nawyk przed dokonaniem większej zmiany, co do której nie masz pewności.',
    guide_settings_tip:'Skonfiguruj Walutę, Okres budżetowy oraz Dane i synchronizację jako pierwsze, zanim zrobisz cokolwiek innego - to fundament, na którym zbudowana jest reszta aplikacji.',
  }
};

function t(key) {
  const lang = state?.settings?.language || 'en';
  const v = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key];
  if (v != null) return v;
  // Last-resort safeguard: never render a raw key identifier in the UI
  return String(key).replace(/^(tx|sf|dpc|cal|sett|alloc|bud|dtype|help|toast|freq|dash|sub|rec|dp|sett)_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
function tf(key, ...args) { let s=t(key); args.forEach((v,i)=>s=s.replace(`{${i}}`,v)); return s; }

function applyLanguage() {
  const lang = state?.settings?.language || 'en';
  document.documentElement.lang = lang;
  // Update tab labels live
  document.querySelectorAll('.btab[data-btab]').forEach(btn => {
    const key = 'tab_' + btn.dataset.btab;
    const tx = TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key];
    if (tx) {
      // Preserve emoji prefix if present
      const current = btn.textContent.trim();
      const emoji = current.match(/^(\p{Emoji}[\uFE0F\u20E3]?\s*)/u)?.[0] || '';
      btn.textContent = emoji + tx;
    }
  });
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
  for(const s of segs){
    const p=s.pct||0;if(p<=0){cum+=p;continue;}
    const dash=(p/100)*c,gap=c-dash,rot=-90+(cum/100)*360;
    arcs+=`<circle class="dseg" data-label="${esc(s.label||'')}" data-pct="${p.toFixed(1)}" data-val="${s.value||0}"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"
      style="cursor:pointer;transition:stroke-width .18s,opacity .18s"/>`;
    cum+=p;
  }
  // Gradient overlay for depth effect
  const overlay=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#rg${gid})" stroke-width="${sw+6}" pointer-events="none"/>`;
  // Center hover label
  const fs1=(size*.14).toFixed(0),fs2=(size*.085).toFixed(0);
  const center=`<g class="donut-center" pointer-events="none">
    <text class="donut-hover-pct" x="${cx}" y="${cy+2}" text-anchor="middle" dominant-baseline="middle"
      style="font-family:Sora,sans-serif;font-weight:800;font-size:${fs1}px;fill:var(--text-primary);opacity:0;transition:opacity .15s"></text>
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
    const show=seg=>{
      segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='0.45';});
      seg.setAttribute('stroke-width',baseSW+5);seg.style.opacity='1';
      if(pctEl){pctEl.textContent=seg.dataset.pct+'%';pctEl.style.opacity='1';}
      if(lblEl){lblEl.textContent=seg.dataset.label;lblEl.style.opacity='1';}
    };
    const hide=()=>{
      segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='1';});
      if(pctEl)pctEl.style.opacity='0';
      if(lblEl)lblEl.style.opacity='0';
    };
    segs.forEach(seg=>{
      seg.addEventListener('mouseenter',()=>show(seg));
      seg.addEventListener('mouseleave',hide);
      seg.addEventListener('touchstart',e=>{e.preventDefault();show(seg);},{passive:false});
      seg.addEventListener('touchend',()=>setTimeout(hide,1600));
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
function initTheme(){applyTheme(localStorage.getItem('evobudget_theme')||'dark');}

let currentTab='dashboard', calYear, calMonth, calSelectedDay=null;
let txFilter={search:'',type:'',alloc:'',sort:'date_desc'};
let txPage=0;
const TX_PAGE_SIZE=25;

function switchTab(tab) {
  currentTab=tab;
  // Sync all navigation variants
  ['.btab','.side-nav-item','.cnav-btn'].forEach(sel =>
    document.querySelectorAll(sel).forEach(b=>b.classList.toggle('is-active',b.dataset.btab===tab))
  );
  document.querySelectorAll('.bview').forEach(v=>v.classList.remove('is-active'));
  document.getElementById(`bview-${tab}`)?.classList.add('is-active');
  if(tab==='transactions'){const g=processRecurring();if(g>0)setTimeout(()=>showToast(tf('recurring_generated',g)),300);}
  ({dashboard:renderDashboard,budget:renderBudget,transactions:renderTransactions,debt:renderDebt,sinking:renderSinking,calendar:renderCalendar,subscriptions:renderSubscriptions,settings:renderSettings}[tab]||renderDashboard)();
}

// ── PRO DASHBOARD ─────────────────────────────────────────────────────
function renderDashboard() {
  const act=computeActuals(),sum=computeSummary(act),result=runDebtPayoff(),subMo=totalSubMonthly();
  const expInc=state.budgets.income.reduce((t,r)=>t+(r.expected||0),0);
  const expExp=state.budgets.expenses.reduce((t,r)=>t+(r.expected||0),0);
  const expBil=state.budgets.bills.reduce((t,r)=>t+(r.expected||0),0);
  const expSav=state.budgets.savings.reduce((t,r)=>t+(r.expected||0),0);
  const expDebt=state.debts.reduce((s,d)=>s+totalMonthlyDebtCost(d),0);
  const expOut=expExp+expBil+expDebt+subMo,leftColor=sum.leftover>=0?'#10b981':'#f43f5e';
  const upcoming=getUpcomingEvents(7,act);
  const incSegs=state.budgets.income.map((r,i)=>({label:r.category,value:act.income[r.category]||0,color:COLORS[i%COLORS.length]})).filter(s=>s.value>0).sort((a,b)=>b.value-a.value);
  const incTot=incSegs.reduce((t,s)=>t+s.value,0);
  const spendSegs=[
    ...state.budgets.expenses.map((r,i)=>({label:r.category,value:act.expenses[r.category]||0,color:COLORS[i%COLORS.length]})),
    ...state.budgets.bills.map((r,i)=>({label:r.category,value:act.bills[r.category]||0,color:COLORS[(i+5)%COLORS.length]})),
    ...Object.entries(act.debt||{}).map(([name,val],i)=>({label:name,value:val,color:['#a855f7','#9333ea','#7c3aed','#c026d3'][i%4]})),
    ...Object.entries(act.subscription||{}).map(([name,val],i)=>({label:name,value:val,color:['#10b981','#06b6d4','#14b8a6','#059669'][i%4]})),
  ].filter(s=>s.value>0).sort((a,b)=>b.value-a.value);
  const spTot=spendSegs.reduce((t,s)=>t+s.value,0);
  const flowRows=[
    {label:t('bud_section_income'),  exp:expInc, act:sum.totalIncome,          color:'#10b981',isInc:true},
    {label:t('bud_section_expenses'),exp:expExp, act:sum.totalExpenses,        color:'#f43f5e',isInc:false},
    {label:t('bud_section_bills'),   exp:expBil, act:sum.totalBills,           color:'#fb923c',isInc:false},
    {label:t('bud_section_savings'), exp:expSav, act:sum.totalSavings,         color:'#3b82f6',isInc:false},
    {label:t('dash_debt_payments'),  exp:expDebt,act:sum.totalDebt||0,         color:'#a855f7',isInc:false},
    {label:t('dash_subscriptions'),  exp:subMo,  act:sum.totalSubscriptions||0,color:'#10b981',isInc:false},
  ];

  // Welcome card - show when state is fresh
  const showWelcome = state.transactions.length === 0 && state.debts.length === 0 && state.sinkingFunds.length === 0 && (state.subscriptions||[]).length === 0;
  const welcomeHtml = showWelcome ? `
    <div class="onboard-banner">
      <div class="onboard-title">\uD83D\uDC4B Welcome! Here's how to get started:</div>
      <div class="onboard-steps">
        <div class="onboard-step"><span class="onboard-num">1</span>Open <strong>Settings</strong> to set your currency and budget period.</div>
        <div class="onboard-step"><span class="onboard-num">2</span>Go to <strong>Budget</strong> and enter expected amounts for Income, Expenses, Bills &amp; Savings.</div>
        <div class="onboard-step"><span class="onboard-num">3</span>Use <strong>Transactions</strong> to log what you actually earn and spend.</div>
        <div class="onboard-step"><span class="onboard-num">4</span>Explore the pro tools: <strong>Debt Payoff, Sinking Funds, Subscriptions &amp; the Smart Calendar</strong>.</div>
      </div>
    </div>` : '';
  const el=document.getElementById('bview-dashboard');
  el.innerHTML=welcomeHtml+`
    <div class="section-header">
      <h2 class="section-title">✨ ${t('tab_dashboard')}</h2>
      <button class="period-badge period-badge--btn" id="periodBadgeBtn" title="Change period">${formatDateDisplay(state.settings.periodStart)} - ${formatDateDisplay(state.settings.periodEnd)}</button>
      ${helpBtn('dashboard')}
    </div>
    <div class="pro-stats-row">
      <div class="pro-stat"><div class="pro-stat-label">${t('dash_total_income')}</div><div class="pro-stat-value" style="color:#10b981">${fmt(sum.totalIncome)}</div><div class="pro-stat-sub">${t('dash_of')} ${fmt(expInc)} ${t('dash_expected_sfx')}</div></div>
      <div class="pro-stat"><div class="pro-stat-label">${t('dash_total_outgoing')}</div><div class="pro-stat-value" style="color:#f43f5e">${fmt(sum.totalOut)}</div><div class="pro-stat-sub">${t('dash_of')} ${fmt(expOut)} ${t('dash_budgeted_sfx')}</div></div>
      <div class="pro-stat"><div class="pro-stat-label">${t('dash_savings_rate')}</div><div class="pro-stat-value" style="color:#6366f1">${sum.savingsRate}%</div><div class="pro-stat-sub">${fmt(sum.totalSavings)} ${t('dash_saved_sfx')}</div></div>
      <div class="pro-stat"><div class="pro-stat-label">${t('dash_subscriptions')}</div><div class="pro-stat-value" style="color:#a855f7">${fmt(subMo)}${t('sf_per_month')}</div><div class="pro-stat-sub">${fmt(subMo*12)}${t('dash_per_year')}</div></div>
    </div>
    <div class="panel leftover-panel">
      <div class="leftover-inner">
        <div><div class="leftover-label">${t('dash_net_leftover')}</div><div class="leftover-value" style="color:${leftColor}">${sum.leftover<0?'\u2212':''}${fmt(Math.abs(sum.leftover))}</div>${state.rollover?`<div class="leftover-rollover">${t('dash_includes')} ${fmt(state.rollover)} ${t('dash_rollover_sfx')}</div>`:''}</div>
        <div class="leftover-formula">
          <span class="lf-chip lf-income">${fmt(sum.totalIncome)} ${t('dash_in_sfx')}</span><span class="lf-sep">\u2212</span><span class="lf-chip lf-expense">${fmt(sum.totalOut)} ${t('dash_out_sfx')}</span><span class="lf-sep">\u2212</span><span class="lf-chip lf-savings">${fmt(sum.totalSavings)} ${t('dash_saved_sfx')}</span>${state.rollover?`<span class="lf-sep">+</span><span class="lf-chip lf-rollover">${fmt(state.rollover)} ${t('dash_rollover_sfx')}</span>`:''}
        </div>
      </div>
    </div>
    </div>
    <div class="dashboard-grid" style="margin-bottom:16px">
      <div class="panel cash-flow-panel"><div class="panel-inner-sm">
        <div class="panel-titlebar"><span class="panel-title-sm">${t('dash_cash_flow')}</span><div class="flow-legend"><span class="legend-item"><span class="legend-dot" style="background:rgba(30,27,46,.22)"></span>${t('dash_expected_legend')}</span><span class="legend-item"><span class="legend-dot" style="background:#6366f1"></span>${t('dash_actual_legend')}</span></div></div>
        <div class="flow-table">${flowRows.map(row=>{const max=Math.max(row.exp,row.act,1),ew=(row.exp/max*100).toFixed(1),aw=(row.act/max*100).toFixed(1),over=!row.isInc&&row.act>row.exp&&row.exp>0;return`<div class="flow-row"><span class="flow-label">${esc(row.label)}</span><div class="flow-bars"><div class="flow-bar-wrap"><div class="flow-bar flow-bar--exp" style="width:${ew}%"></div></div><div class="flow-bar-wrap"><div class="flow-bar" style="width:${aw}%;background:${over?'#f43f5e':row.color}"></div></div></div><div class="flow-amounts"><div class="flow-amt flow-amt--exp">${fmt(row.exp)}</div><div class="flow-amt" style="color:${row.color};font-weight:700">${fmt(row.act)}</div></div></div>`;}).join('')}</div>
      </div></div>
      <div class="charts-col">
        <div class="panel chart-panel"><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('dash_income_sources')}</div>${incSegs.length===0?`<div class="chart-empty">${t('dash_no_income')}</div>`:`<div class="donut-block">${svgDonut(incSegs.map(s=>({...s,pct:incTot>0?s.value/incTot*100:0})),110,16)}<div class="donut-legend">${incSegs.slice(0,5).map(s=>`<div class="dleg-row"><span class="dleg-swatch" style="background:${s.color}"></span><span class="dleg-label">${esc(s.label)}</span><span class="dleg-pct">${(incTot>0?s.value/incTot*100:0).toFixed(0)}%</span></div>`).join('')}</div></div>`}</div></div>
        <div class="panel chart-panel"><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('dash_spending_breakdown')}</div>${spendSegs.length===0?`<div class="chart-empty">${t('dash_no_spending')}</div>`:`<div class="donut-block">${svgDonut(spendSegs.map(s=>({...s,pct:spTot>0?s.value/spTot*100:0})).slice(0,50),110,16)}<div class="donut-legend">${spendSegs.slice(0,5).map(s=>`<div class="dleg-row"><span class="dleg-swatch" style="background:${s.color}"></span><span class="dleg-label">${esc(s.label)}</span><span class="dleg-pct">${(spTot>0?s.value/spTot*100:0).toFixed(0)}%</span></div>`).join('')}</div></div>`}</div></div>
      </div>
    </div>
    ${(()=>{
      if (!state.allocation?.enabled) return '';
      const {totals, untagged} = computeAllocation();
      const income = sum.totalIncome > 0 ? sum.totalIncome : expInc;
      const buckets = state.allocation.buckets || [];
      if (income <= 0 && Object.values(totals).every(v=>v===0)) return '';
      const pctOf = v => income > 0 ? (v / income * 100) : 0;
      const cards = buckets.map(b => {
        const actual = totals[b.id] || 0;
        const ap = pctOf(actual);
        const tp = b.pct;
        const fill = tp > 0 ? Math.min(ap / tp * 100, 100) : 0;
        const over = ap > tp && tp > 0;
        const nearing = !over && tp > 0 && (tp - ap) <= 5 && ap > 0;
        const accentColor = over ? '#f43f5e' : nearing ? '#fb923c' : b.color;
        const statusKey = over ? 'alloc_over' : nearing ? 'alloc_nearing' : 'alloc_under';
        const statusColor = over ? '#f43f5e' : nearing ? '#fb923c' : '#10b981';
        const displayName = getAllocBucketDisplayName(b);
        return `<div class="alloc-card"><div class="alloc-card-header"><span class="alloc-card-name">${esc(displayName)}</span><span class="alloc-target-badge">${t('alloc_target')} ${tp}%</span></div><div class="alloc-pct-big" style="color:${accentColor}">${ap.toFixed(1)}%</div><div class="alloc-amount">${fmt(actual)}</div><div class="alloc-bar-row"><div class="alloc-strip-wrap"><div class="alloc-strip" style="width:${fill}%;background:${accentColor}"></div></div><span class="alloc-fill-pct" style="color:${accentColor}">${Math.round(fill)}%</span></div><div class="alloc-status" style="color:${statusColor}"><span class="alloc-status-icon">${over?t('alloc_icon_over'):nearing?t('alloc_icon_near'):t('alloc_icon_ok')}</span> ${t(statusKey)}</div></div>`;
      }).join('');
      const untaggedLine = untagged > 0 ? `<div class="alloc-untagged">⚠ ${fmt(untagged)} ${t('alloc_untagged_desc')}</div>` : '';
      return `<div class="panel alloc-panel"><div class="panel-inner-sm"><div class="alloc-header"><span class="panel-title-sm">${t('alloc_title')}</span><span class="alloc-income-base">${t('alloc_based_on')} ${fmt(income)} ${t('alloc_income_period')}</span></div><div class="alloc-grid">${cards}</div>${untaggedLine}</div></div>`;
    })()}
    <div class="pro-bottom-row">
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">💳 ${t('tab_debt')}</div>
        ${state.debts.length===0?`<div class="chart-empty">${t('dash_no_debts')}<br><button class="link-btn" data-btab="debt">${t('dash_set_up')}</button></div>`:result?`<div class="debt-teaser"><div class="dt-item"><span class="dt-label">${t('dash_debt_free_label')}</span><span class="dt-value">${formatDateDisplay(result.debtFreeDate)}</span></div><div class="dt-item"><span class="dt-label">${t('dash_interest_label')}</span><span class="dt-value" style="color:#f43f5e">${fmt(result.totalInterest)}</span></div><div class="dt-item"><span class="dt-label">${t('dash_months_label')}</span><span class="dt-value">${result.months}</span></div><div class="dt-item"><span class="dt-label">${t('dash_method_label')}</span><span class="dt-value">${state.debtSettings.method==='snowball'?'⛄ Snowball':'🌊 Avalanche'}</span></div></div>${(()=>{const dp=act.debt||{},paid=state.debts.filter(d=>(dp[d.name]||0)>=(d.minimumPayment||0)&&d.minimumPayment>0).length,total=state.debts.filter(d=>d.minimumPayment>0).length;return total>0?`<div style="margin-top:7px;font-size:11px;color:${paid===total?'#10b981':'#f43f5e'};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${paid}/${total} ${paid===1?t('dash_debts_paid'):t('dash_debts_paid_many')}</div>`:'';})()}`:`<div class="chart-empty">${t('dash_set_balances')}</div>`}
      </div></div>
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">${t('dash_upcoming_7')}</div>
        ${upcoming.length===0?`<div class="chart-empty">${t('dash_nothing_scheduled')}</div>`:`<div class="upcoming-list">${upcoming.slice(0,6).map(ev=>{const p=ev.paid;return`<div class="upcoming-item"><span class="up-dot" style="background:${p?'var(--text-faint)':ev.color}"></span><span class="up-label" style="${p?'text-decoration:line-through;color:var(--text-faint)':''}">${esc(ev.label)}</span><span class="up-date" style="${p?'color:var(--text-faint)':''}">${formatDateDisplay(ev.date)}</span><span class="up-amt" style="${p?'color:var(--text-faint)':''}">${fmt(ev.amount)}</span></div>`;}).join('')}</div>`}
      </div></div>
      <div class="panel pro-card"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:12px">🏺 ${t('tab_sinking')}</div>
        ${state.sinkingFunds.length===0?`<div class="chart-empty">${t('dash_no_sinking')}<br><button class="link-btn" data-btab="sinking">${t('dash_create_one')}</button></div>`:`<div class="sf-snap">${state.sinkingFunds.slice(0,4).map(f=>{const p=f.targetAmount>0?Math.min(100,Math.round((f.currentSaved||0)/f.targetAmount*100)):0;return`<div class="sf-snap-item"><div class="sf-snap-header"><span>${esc(f.icon||'🏺')} ${esc(f.name)}</span><span class="sf-snap-pct">${p}%</span></div><div class="prog-bar-wrap"><div class="prog-bar prog-bar--income" style="width:${p}%"></div></div><div style="font-size:11px;color:var(--text-faint);margin-top:2px;display:flex;justify-content:space-between">${fmt(f.currentSaved||0)} / ${fmt(f.targetAmount||0)}</div></div>`;}).join('')}</div>`}
      </div></div>
    </div>`;
  el.querySelector('#periodBadgeBtn')?.addEventListener('click',()=>switchTab('settings'));
  requestAnimationFrame(()=>initDonuts(el));
  el.querySelectorAll('[data-btab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

// ── Spending Allocation ────────────────────────────────────────────────
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
function getAllocBucketDisplayName(b) {
  const keyMap = {need:'alloc_def_need', want:'alloc_def_want', save:'alloc_def_save'};
  if (keyMap[b.id] && ALLOC_DEFAULTS[b.id]?.has(b.name)) return t(keyMap[b.id]);
  return b.name;
}
function getModMeta(){return{
  income: {icon:'💰',title:t('bud_section_income'),isInc:true, hasDates:false},
  expenses:{icon:'🛒',title:t('bud_section_expenses'),isInc:false,hasDates:false},
  bills:  {icon:'🧾',title:t('bud_section_bills'),  isInc:false,hasDates:true},
  savings:{icon:'🏦',title:t('bud_section_savings'), isInc:true, hasDates:false},
};}

function renderBudget() {
  const act=computeActuals(), MOD_META=getModMeta();
  const el=document.getElementById('bview-budget');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">💰 ${t('tab_budget')}</h2>${helpBtn('budget')}</div>`+
    Object.entries(MOD_META).map(([type,meta])=>buildModuleHTML(type,meta,act)).join('');
  Object.entries(MOD_META).forEach(([type,meta])=>bindModuleEvents(type,meta,el,act));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

function buildModuleHTML(type,meta,act) {
  const rows=state.budgets[type]||[],typeAct=act[type]||{};
  const totExp=rows.reduce((t,r)=>t+(r.expected||0),0),totAct=rows.reduce((t,r)=>t+(typeAct[r.category]||0),0);
  const totP=pct(totAct,totExp),totOvr=!meta.isInc&&totAct>totExp&&totExp>0;
  const noDate=`<span class="no-date">${t('bud_set_date')}</span>`;
  return `<div class="budget-module-section"><div class="module-section-header"><h3 class="module-section-title">${meta.icon} ${meta.title}</h3><button class="btn btn-ghost btn-sm mod-add-btn" data-type="${type}" type="button">${t('bud_add_btn')}</button></div>
    <div class="panel" style="margin-bottom:18px"><div class="module-table-wrap"><table class="module-table"><thead><tr>
      <th>${t('bud_th_category')}</th><th>${t('bud_th_expected')} (${SYM})</th>
      ${meta.hasDates?`<th>${t('bud_th_due_date')}</th>`:''}
      <th>${t('bud_th_actual')} (${SYM})</th><th class="prog-cell">${t('bud_th_progress')}</th>
      ${meta.hasDates?`<th>${t('bud_th_paid')}</th>`:''}<th></th>
    </tr></thead>
    <tbody>${rows.map(row=>{
      const a=typeAct[row.category]||0,p=pct(a,row.expected),ovr=!meta.isInc&&p>100;
      return`<tr class="module-row"><td><span class="cat-name">${esc(row.category)}</span></td>
        <td><input class="expected-input mod-exp" type="number" min="0" step="0.01" value="${row.expected||''}" placeholder="0.00" data-id="${row.id}" data-type="${type}"></td>
        ${meta.hasDates?`<td><div class="date-cell-styled" id="dw-${row.id}" data-input-id="di-${row.id}"><span class="date-cell-val" id="dc-${row.id}">${row.dueDate?formatDateDisplay(row.dueDate):noDate}</span><input type="date" id="di-${row.id}" class="mod-date" value="${row.dueDate||''}" data-id="${row.id}" data-type="${type}"></div></td>`:''}
        <td><span class="actual-val${ovr?' is-over':meta.isInc&&p>=100?' is-good':''}">${fmt(a)}</span></td>
        <td class="prog-cell"><div class="prog-bar-wrap"><div class="prog-bar${meta.isInc?' prog-bar--income':ovr?' prog-bar--over':' prog-bar--normal'}" id="pb-${row.id}" style="width:${Math.min(p,100)}%"></div></div><span class="prog-label${ovr?' is-over':''}" id="pl-${row.id}">${p}%</span></td>
        ${meta.hasDates?`<td class="paid-cell"><label class="check-label"><input type="checkbox" class="mod-paid" ${row.paid?'checked':''} data-id="${row.id}" data-type="${type}"><span class="checkmark"></span></label></td>`:''}
        <td><button class="del-btn mod-del" data-id="${row.id}" data-type="${type}" type="button">×</button></td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr class="total-row"><td><strong>${t('bud_total')}</strong></td><td><strong id="te-${type}">${fmt(totExp)}</strong></td>
      ${meta.hasDates?'<td></td>':''}
      <td><strong>${fmt(totAct)}</strong></td>
      <td class="prog-cell"><div class="prog-bar-wrap"><div class="prog-bar${meta.isInc?' prog-bar--income':totOvr?' prog-bar--over':' prog-bar--normal'}" id="tpb-${type}" style="width:${Math.min(totP,100)}%"></div></div><span class="prog-label${totOvr?' is-over':''}" id="tpl-${type}">${totP}%</span></td>
      ${meta.hasDates?'<td></td>':''}<td></td></tr></tfoot></table></div></div>
    <div class="panel add-cat-card" id="addCatCard-${type}" style="display:none">
      <div class="panel-inner-sm">
        <div class="add-cat-title">${t('bud_add_cat_title')}</div>
        <div class="add-cat-row">
          <div class="field"><label class="field-label">${t('bud_cat_name_label')}</label><input class="input input-sm" type="text" id="newCatName-${type}" placeholder="${t('bud_cat_name_ph')}"></div>
          ${meta.hasDates?`<div class="field"><label class="field-label">${t('bud_due_date_label')}</label><input class="input input-sm" type="date" id="newCatDate-${type}"></div>`:''}
          <div class="add-cat-btns">
            <button class="btn btn-primary btn-sm" id="saveCatBtn-${type}" type="button">${t('bud_add_cat_btn')}</button>
            <button class="btn btn-ghost btn-sm" id="cancelCatBtn-${type}" type="button">${t('cancel')}</button>
          </div>
        </div>
      </div>
    </div></div>`;
}

function bindModuleEvents(type,meta,container,act) {
  container.querySelectorAll(`.mod-exp[data-type="${type}"]`).forEach(inp=>{
    inp.addEventListener('input',()=>{
      const lv=parseFloat(inp.value)||0,rowId=inp.dataset.id,typeAct=computeActuals()[type]||{};
      const rowObj=(state.budgets[type]||[]).find(r=>r.id===rowId); if(!rowObj) return;
      const a=typeAct[rowObj.category]||0,p=pct(a,lv),over=!meta.isInc&&p>100;
      const bar=document.getElementById('pb-'+rowId),lbl=document.getElementById('pl-'+rowId);
      if(bar){bar.className=`prog-bar${meta.isInc?' prog-bar--income':over?' prog-bar--over':' prog-bar--normal'}`;bar.style.width=`${Math.min(p,100)}%`;}
      if(lbl){lbl.className=`prog-label${over?' is-over':''}`;lbl.textContent=`${p}%`;}
      const totExp=(state.budgets[type]||[]).reduce((s,r)=>s+(r.id===rowId?lv:(r.expected||0)),0);
      const totAct=(state.budgets[type]||[]).reduce((s,r)=>s+(typeAct[r.category]||0),0);
      const tP=pct(totAct,totExp),tO=!meta.isInc&&totAct>totExp&&totExp>0;
      const te=document.getElementById('te-'+type),tpb=document.getElementById('tpb-'+type),tpl=document.getElementById('tpl-'+type);
      if(te)te.textContent=fmt(totExp);
      if(tpb){tpb.className=`prog-bar${meta.isInc?' prog-bar--income':tO?' prog-bar--over':' prog-bar--normal'}`;tpb.style.width=`${Math.min(tP,100)}%`;}
      if(tpl){tpl.className=`prog-label${tO?' is-over':''}`;tpl.textContent=`${tP}%`;}
    });
    inp.addEventListener('change',()=>{const row=(state.budgets[type]||[]).find(r=>r.id===inp.dataset.id);if(row){row.expected=parseFloat(inp.value)||0;saveState();}});
  });
  if(meta.hasDates){
    container.querySelectorAll(`.mod-date[data-type="${type}"]`).forEach(inp=>{
      inp.addEventListener('change',()=>{const row=(state.budgets[type]||[]).find(r=>r.id===inp.dataset.id);if(row){row.dueDate=inp.value;saveState();}const dc=document.getElementById('dc-'+inp.dataset.id);if(dc)dc.innerHTML=inp.value?formatDateDisplay(inp.value):`<span class="no-date">${t('bud_set_date')}</span>`;});
    });
    container.querySelectorAll('.date-cell-styled').forEach(wrap=>{wrap.addEventListener('click',()=>{openDatePicker(document.getElementById(wrap.dataset.inputId),wrap);});});
    container.querySelectorAll(`.mod-paid[data-type="${type}"]`).forEach(cb=>{cb.addEventListener('change',()=>{const row=(state.budgets[type]||[]).find(r=>r.id===cb.dataset.id);if(row){row.paid=cb.checked;saveState();}});});
  }
  container.querySelectorAll(`.mod-del[data-type="${type}"]`).forEach(btn=>{
    btn.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_cat'),confirmText:t('delete')}))return;state.budgets[type]=(state.budgets[type]||[]).filter(r=>r.id!==btn.dataset.id);saveState();renderBudget();});
  });
  container.querySelectorAll(`.mod-add-btn[data-type="${type}"]`).forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(trialBlocks(type)){ showUpgradeModal({reason:'category',type}); return; }
      const card=document.getElementById(`addCatCard-${type}`);
      if(card){card.style.display='';document.getElementById(`newCatName-${type}`)?.focus();}
    });
  });
  document.getElementById(`saveCatBtn-${type}`)?.addEventListener('click',()=>{
    if(trialBlocks(type)){ showUpgradeModal({reason:'category',type}); return; }
    const name=document.getElementById(`newCatName-${type}`)?.value.trim();
    if(!name){document.getElementById(`newCatName-${type}`)?.focus();return;}
    const newRow={id:uid(),category:name,expected:0};
    if(meta.hasDates){newRow.dueDate=document.getElementById(`newCatDate-${type}`)?.value||'';newRow.paid=false;}
    (state.budgets[type]=state.budgets[type]||[]).push(newRow);
    saveState();renderBudget();
  });
  document.getElementById(`cancelCatBtn-${type}`)?.addEventListener('click',()=>{
    const card=document.getElementById(`addCatCard-${type}`);
    if(card)card.style.display='none';
    const n=document.getElementById(`newCatName-${type}`);if(n)n.value='';
  });
}

// ── TRANSACTIONS ──────────────────────────────────────────────────────
function getCats(txType){const MAP={income:'income',expense:'expenses',bill:'bills',savings:'savings'};const key=MAP[txType];if(key&&state.budgets[key])return state.budgets[key].map(r=>r.category);if(txType==='debt')return state.debts.map(d=>d.name).filter(Boolean);if(txType==='subscription')return state.subscriptions.filter(s=>s.active!==false).map(s=>s.name).filter(Boolean);if(txType==='sinking_fund')return(state.sinkingFunds||[]).map(f=>f.name).filter(Boolean);return[];}
function txTypeLabel(type){return{income:t('tx_type_income'),expense:t('tx_type_expense'),bill:t('tx_type_bill'),savings:t('tx_type_savings'),debt:t('tx_type_debt'),subscription:t('tx_type_subscription'),sinking_fund:t('tx_type_sinking_fund')}[type]||type;}
function renderTxList(){
  const el=document.getElementById('txListWrap');
  if(!el)return;
  let filtered=[...state.transactions];
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
    default:filtered.sort((a,b)=>b.date.localeCompare(a.date));
  }
  const total=state.transactions.length,count=filtered.length;
  const totalPages=Math.max(1,Math.ceil(count/TX_PAGE_SIZE));
  if(txPage>=totalPages)txPage=totalPages-1;
  const page=txPage;
  const paged=filtered.slice(page*TX_PAGE_SIZE,(page+1)*TX_PAGE_SIZE);
  const isFiltered=txFilter.search||txFilter.type||(state.allocation?.enabled&&txFilter.alloc);
  const countLabel=isFiltered?t('tx_showing').replace('{n}',count).replace('{total}',total):`${total} ${total===1?t('tx_transaction_one'):t('tx_transaction_many')}`;
  const pagination=count>TX_PAGE_SIZE?`<div class="tx-pagination"><button class="btn btn-ghost btn-sm" id="txPrevBtn" ${page===0?'disabled':''}>${t('tx_prev')}</button><span class="tx-page-label">${t('tx_page_of').replace('{n}',page+1).replace('{total}',totalPages)}</span><button class="btn btn-ghost btn-sm" id="txNextBtn" ${page>=totalPages-1?'disabled':''}>${t('tx_next')}</button></div>`:'';
  el.innerHTML=`<div class="tx-list-header"><span>${countLabel}</span>${total>0?`<button class="link-btn" id="clearAllBtn2">${t('tx_clear_all')}</button>`:''}</div>
    ${count===0&&total===0
      ?`<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><p class="empty-title">${t('tx_empty')}</p><button class="btn btn-primary btn-sm empty-cta" id="txEmptyAdd" type="button">\u002B ${t('tx_add_title')}</button></div>`
      :count===0
      ?`<div class="empty-state"><div class="empty-icon">\uD83D\uDD0D</div><p>${t('tx_no_results')}</p></div>`
      :`<div class="panel"><div class="tx-table-wrap"><table class="tx-table"><thead><tr>
          <th>${t('tx_date')}</th><th>${t('tx_type')}</th><th>${t('tx_category')}</th>
          <th>${t('tx_th_amount')}</th><th>${t('tx_th_desc')}</th><th></th>
        </tr></thead><tbody>
        ${paged.map(tx=>`<tr class="tx-row">
          <td class="tx-date">${formatDateDisplay(tx.date)}</td>
          <td><span class="tx-pill tx-pill--${tx.type}">${esc(txTypeLabel(tx.type))}</span></td>
          <td class="tx-cat">${esc(tx.category)}</td>
          <td class="tx-amt tx-amt--${tx.type}">${tx.type==='income'?'+':'\u2212'}${fmt(tx.amount)}</td>
          <td class="tx-desc">${esc(tx.description||'-')}</td>
          <td>${state.allocation?.enabled&&tx.allocation?`<span class="alloc-badge" style="background:${(state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.color||'#94a3b8'}22;color:${(state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.color||'#94a3b8'};border:1px solid ${(state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.color||'#94a3b8'}44">${esc((state.allocation.buckets||[]).find(b=>b.id===tx.allocation)?.name||tx.allocation)}</span>`:''}${tx.type!=='income'&&tx.type!=='savings'&&tx.type!=='sinking_fund'&&state.allocation?.enabled&&!tx.allocation?'<span class="alloc-badge alloc-badge--unset">?</span>':''}</td>
          <td><div class="tx-actions"><button class="edit-btn" data-tx="${tx.id}" title="Edit">\u270f\ufe0f</button><button class="del-btn" data-tx="${tx.id}" title="Delete">\xd7</button></div></td>
        </tr>`).join('')}</tbody></table></div></div>${pagination}`}`;
  el.querySelectorAll('.edit-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>openEditTx(b.dataset.tx)));
  el.querySelectorAll('.del-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>{const tx=state.transactions.find(t=>t.id===b.dataset.tx);applySinkingFundDelta(tx,-1);state.transactions=state.transactions.filter(t=>t.id!==b.dataset.tx);saveState();renderTxList();}));
  document.getElementById('clearAllBtn2')?.addEventListener('click',async()=>{if(await confirmDialog({message:t('confirm_delete_all_tx'),confirmText:t('delete')})){state.transactions=[];saveState();renderTxList();}});
  document.getElementById('txPrevBtn')?.addEventListener('click',()=>{if(txPage>0){txPage--;renderTxList();}});
  document.getElementById('txNextBtn')?.addEventListener('click',()=>{if(txPage<totalPages-1){txPage++;renderTxList();}});
  refreshRecurringAmounts();
}
// Update the amounts shown in the Automatic Transactions panel in place (preserves open state / scroll / form)
function refreshRecurringAmounts(){
  (state.recurringTemplates||[]).forEach(tmpl=>{
    const amtEl=document.querySelector(`.recurring-row[data-rid="${tmpl.id}"] .recurring-row-amt`);
    if(amtEl)amtEl.textContent=`${SYM}${(tmpl.amount||0).toFixed(2)}`;
  });
}
function renderTransactions() {
  const el=document.getElementById('bview-transactions');
  const allocEnabled=state.allocation?.enabled;
  el.innerHTML=`<div class="section-header"><h2 class="section-title">\uD83D\uDCCB ${t('tab_transactions')}</h2><div class="section-header-actions">${helpBtn('transactions')}<label class="btn btn-ghost btn-sm csv-label">${t('tx_import_csv')}<input type="file" id="csvInput" accept=".csv" style="display:none"></label></div></div>
    <details class="recurring-panel panel">
      <summary class="recurring-summary"><span class="recurring-summary-title"><span class="recurring-summary-icon" aria-hidden="true">⚡</span>${t('recurring_title')}</span><span class="recurring-count">${(state.recurringTemplates||[]).length||''}</span></summary>
      <div class="recurring-body">
        <p class="recurring-desc">${t('recurring_desc')}</p>
        ${(state.recurringTemplates||[]).length===0
          ?`<p class="recurring-empty">${t('recurring_empty')}</p>`
          :`<div class="recurring-list">${(state.recurringTemplates||[]).map(tmpl=>`<div class="recurring-row" data-rid="${tmpl.id}">
            <span class="tx-pill tx-pill--${tmpl.type}" style="font-size:10px">${esc(txTypeLabel(tmpl.type))}</span>
            <span class="recurring-row-label">${esc(tmpl.label||tmpl.category)}${tmpl.sourceType?`<span class="rec-source-badge" title="${t('automate_linked')}">${({subscription:'🔄',sinking_fund:'🏺',debt:'💳'})[tmpl.sourceType]||'🔗'}</span>`:''}</span>
            <span class="recurring-row-cat">${esc(tmpl.category)}</span>
            <span class="recurring-row-amt">${SYM}${(tmpl.amount||0).toFixed(2)}</span>
            <span class="recurring-row-freq">${t('freq_'+tmpl.frequency)||tmpl.frequency}</span>
            <span class="recurring-row-due">${tmpl.nextDue}</span>
            <span class="recurring-actions">
              <label class="recurring-toggle" title="${t(tmpl.enabled?'recurring_active':'recurring_paused')}"><input type="checkbox" class="rec-toggle-cb" data-rid="${tmpl.id}" ${tmpl.enabled?'checked':''}><span class="rec-toggle-track"></span></label>
              <button class="sf-edit-btn btn-icon-tiny rec-edit-btn" data-rid="${tmpl.id}" type="button" title="${t('edit')}">✏️</button>
              <button class="del-btn btn-icon-tiny rec-del-btn" data-rid="${tmpl.id}" type="button" title="${t('recurring_remove')}">×</button>
            </span>
          </div>`).join('')}</div>`}
        <button class="btn btn-ghost btn-sm" id="addRecurringBtn" type="button">${t('recurring_add_rule')}</button>
      </div>
    </details>
    <div class="panel tx-form-panel"><div class="panel-inner-sm"><div class="panel-title-sm" style="margin-bottom:14px">${t('tx_add_title')}</div>
      <div class="tx-form-row">
        <div class="field"><label class="field-label">${t('tx_date')}</label>${styledDateField('txDate','txDateWrap',today())}</div>
        <div class="field"><label class="field-label">${t('tx_type')}</label><select class="select" id="txType">
          <option value="expense" selected>${t('tx_type_expense')}</option>
          <option value="bill">${t('tx_type_bill')}</option>
          <option value="subscription">${t('tx_type_subscription')}</option>
          <option value="savings">${t('tx_type_savings')}</option>
          <option value="sinking_fund">${t('tx_type_sinking_fund')}</option>
          <option value="debt">${t('tx_type_debt')}</option>
          <option value="income">${t('tx_type_income')}</option>
        </select></div>
        <div class="field"><label class="field-label">${t('tx_category')}</label><select class="select" id="txCategory"></select></div>
        ${allocEnabled?`<div class="field" id="txAllocWrap"><label class="field-label">${t('alloc_label')} <span class="required-star" aria-hidden="true">*</span></label><select class="select" id="txAlloc"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}">${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select></div><div class="field" id="txSaveHint" style="display:none"><label class="field-label">${t('alloc_label')}</label><span class="alloc-auto-tag-badge">${(()=>{const sb=(state.allocation.buckets||[]).find(b=>b.id==='save');return`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sb?.color||'#10b981'};margin-right:6px;flex-shrink:0"></span>${tf('alloc_auto_tag',sb?getAllocBucketDisplayName(sb):'Save')}`;})()}</span></div>`:''}
        <div class="field"><label class="field-label">${t('tx_amount')} (${SYM})</label><input class="input" type="number" id="txAmount" min="0" step="0.01" placeholder="0.00"></div>
        <div class="field field-grow"><label class="field-label">${t('tx_desc_label')}</label><input class="input" type="text" id="txDesc" placeholder="${t('tx_desc_ph')}" maxlength="120"></div>
        <div class="field field-btn"><label class="field-label" style="visibility:hidden">.</label><button class="btn btn-primary" id="addTxBtn" type="button">${t('tx_add_btn')}</button></div>
      </div><div class="tx-error" id="txError" hidden></div>
    </div></div>
    <div class="tx-filter-bar${allocEnabled?'':' tx-filter-bar--3col'}">
      <input class="input input-sm" type="text" id="txSearch" placeholder="${t('tx_search_ph')}" value="${esc(txFilter.search)}">
      <select class="select select-sm" id="txTypeFilter">
        <option value="">${t('tx_filter_all_types')}</option>
        <option value="income"${txFilter.type==='income'?' selected':''}>${t('tx_type_income')}</option>
        <option value="expense"${txFilter.type==='expense'?' selected':''}>${t('tx_type_expense')}</option>
        <option value="bill"${txFilter.type==='bill'?' selected':''}>${t('tx_type_bill')}</option>
        <option value="savings"${txFilter.type==='savings'?' selected':''}>${t('tx_type_savings')}</option>
        <option value="debt"${txFilter.type==='debt'?' selected':''}>${t('tx_type_debt')}</option>
        <option value="subscription"${txFilter.type==='subscription'?' selected':''}>${t('tx_type_subscription')}</option>
        <option value="sinking_fund"${txFilter.type==='sinking_fund'?' selected':''}>${t('tx_type_sinking_fund')}</option>
      </select>
      ${allocEnabled?`<select class="select select-sm" id="txAllocFilter">
        <option value="">${t('tx_filter_all_alloc')}</option>
        <option value="untagged"${txFilter.alloc==='untagged'?' selected':''}>${t('alloc_untagged')}</option>
        ${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}"${txFilter.alloc===b.id?' selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}
      </select>`:''}
      <select class="select select-sm" id="txSort">
        <option value="date_desc"${txFilter.sort==='date_desc'?' selected':''}>${t('tx_sort_date_new')}</option>
        <option value="date_asc"${txFilter.sort==='date_asc'?' selected':''}>${t('tx_sort_date_old')}</option>
        <option value="amount_desc"${txFilter.sort==='amount_desc'?' selected':''}>${t('tx_sort_amt_high')}</option>
        <option value="amount_asc"${txFilter.sort==='amount_asc'?' selected':''}>${t('tx_sort_amt_low')}</option>
      </select>
    </div>
    <div id="txListWrap"></div>`;
  renderTxList();
  bindDateField('txDate','txDateWrap');
  populateTxCats();
  const updateAllocVisibility=()=>{
    const type=document.getElementById('txType')?.value;
    const wrap=document.getElementById('txAllocWrap');
    if(wrap)wrap.style.display=(type==='income'||type==='savings'||type==='sinking_fund')?'none':'';
    const hint=document.getElementById('txSaveHint');
    // savings shows hint; sinking_fund runs silently (allocation stamped on save)
    if(hint)hint.style.display=(type==='savings'&&allocEnabled)?'':'none';
  };
  document.getElementById('txType')?.addEventListener('change',()=>{populateTxCats();updateAllocVisibility();});
  document.getElementById('txAlloc')?.addEventListener('change',()=>{document.getElementById('txAlloc')?.classList.remove('select--error');document.getElementById('txAllocWrap')?.querySelector('.field-error-msg')?.remove();});
  updateAllocVisibility();
  document.getElementById('addTxBtn')?.addEventListener('click',addTransaction);
  document.getElementById('txEmptyAdd')?.addEventListener('click',()=>{const a=document.getElementById('txAmount');a?.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>a?.focus(),200);});
  document.getElementById('csvInput')?.addEventListener('change',handleCSV);
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
  document.getElementById('txSearch')?.addEventListener('input',e=>{txFilter.search=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txTypeFilter')?.addEventListener('change',e=>{txFilter.type=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txAllocFilter')?.addEventListener('change',e=>{txFilter.alloc=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txSort')?.addEventListener('change',e=>{txFilter.sort=e.target.value;txPage=0;renderTxList();});
  // Recurring rules listeners
  document.getElementById('addRecurringBtn')?.addEventListener('click',()=>openRecurringModal(null));
  el.querySelectorAll('.rec-edit-btn[data-rid]').forEach(b=>b.addEventListener('click',()=>{
    const tmpl=(state.recurringTemplates||[]).find(x=>x.id===b.dataset.rid);
    if(tmpl?.sourceType==='subscription'){switchTab('subscriptions');openSubModal(tmpl.sourceId);}
    else if(tmpl?.sourceType==='sinking_fund'){switchTab('sinking');openFundModal(tmpl.sourceId);}
    else if(tmpl?.sourceType==='debt'){switchTab('debt');openDebtModal(tmpl.sourceId);}
    else openRecurringModal(b.dataset.rid);
  }));
  el.querySelectorAll('.rec-del-btn[data-rid]').forEach(b=>b.addEventListener('click',()=>{state.recurringTemplates=(state.recurringTemplates||[]).filter(r=>r.id!==b.dataset.rid);saveState();renderTransactions();document.querySelector('#bview-transactions .recurring-panel')?.setAttribute('open','');}));
  el.querySelectorAll('.rec-toggle-cb[data-rid]').forEach(cb=>cb.addEventListener('change',()=>{const r=(state.recurringTemplates||[]).find(r=>r.id===cb.dataset.rid);if(r){r.enabled=cb.checked;saveState();}}));
}
function populateTxCats(){const type=document.getElementById('txType')?.value,cats=getCats(type),sel=document.getElementById('txCategory');if(!sel)return;sel.innerHTML=cats.length>0?cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''):'<option value="">- set up categories first -</option>';}
// Adjust a sinking fund's currentSaved when a sinking_fund tx is added (+1) or removed (-1)
function applySinkingFundDelta(tx, sign) {
  if (tx?.type !== 'sinking_fund') return;
  const fund = (state.sinkingFunds||[]).find(f => f.name === tx.category);
  if (fund) {
    fund.currentSaved = Math.max(0, (fund.currentSaved || 0) + sign * tx.amount);
    syncFundLinkedTemplate(fund);
  }
}
// Keep a fund's linked automatic transaction amount in step with its required monthly contribution
function syncFundLinkedTemplate(fund) {
  if (!fund) return;
  const lt = findLinkedTemplate('sinking_fund', fund.id);
  if (lt) lt.amount = Math.round((calcFund(fund).requiredMonthly || 0) * 100) / 100;
}
function addTransaction(){
  if(trialBlocks('transaction')){ showUpgradeModal({reason:'transaction'}); return; }
  const date=document.getElementById('txDate')?.value,
        type=document.getElementById('txType')?.value,
        cat=document.getElementById('txCategory')?.value,
        amount=parseFloat(document.getElementById('txAmount')?.value),
        desc=document.getElementById('txDesc')?.value?.trim()||'',
        errEl=document.getElementById('txError');
  let alloc=document.getElementById('txAlloc')?.value||'';
  if(!date||!type||!cat||isNaN(amount)||amount<=0){
    if(errEl){errEl.textContent=t('tx_error_required');errEl.hidden=false;}
    return;
  }
  if(errEl) errEl.hidden=true;
  const allocRequired=state.allocation?.enabled&&type!=='income'&&type!=='savings'&&type!=='sinking_fund';
  if(allocRequired&&!alloc){
    const sel=document.getElementById('txAlloc');
    const wrap=document.getElementById('txAllocWrap');
    if(sel) sel.classList.add('select--error');
    if(wrap&&!wrap.querySelector('.field-error-msg')){
      const msg=document.createElement('span');
      msg.className='field-error-msg'; msg.textContent=t('alloc_required');
      wrap.appendChild(msg);
    }
    return;
  }
  // sinking_fund: auto-assign to save allocation bucket (runs silently, shows in list)
  if(type==='sinking_fund'&&state.allocation?.enabled){
    const saveB=(state.allocation.buckets||[]).find(b=>b.id==='save');
    if(saveB)alloc=saveB.id;
  }
  const newTx={id:uid(),date,type,category:cat,amount,description:desc,allocation:alloc||null};
  state.transactions.push(newTx);
  applySinkingFundDelta(newTx, +1);
  // Issue 13: auto-advance subscription billing date
  if(type==='subscription'){
    const sub=state.subscriptions.find(s=>s.name===cat||s.category===cat);
    if(sub&&sub.nextBillingDate){
      const d=new Date(sub.nextBillingDate+'T00:00:00');
      switch(sub.frequency){
        case'weekly': d.setDate(d.getDate()+7); break;
        case'quarterly': d.setMonth(d.getMonth()+3); break;
        case'annual': d.setFullYear(d.getFullYear()+1); break;
        default: d.setMonth(d.getMonth()+1); // monthly
      }
      sub.nextBillingDate=toLocalISO(d);
    }
  }
  saveState();
  document.getElementById('txAmount').value='';
  document.getElementById('txDesc').value='';
  const allocSel=document.getElementById('txAlloc');
  if(allocSel){allocSel.value='';allocSel.classList.remove('select--error');}
  document.getElementById('txAllocWrap')?.querySelector('.field-error-msg')?.remove();
  renderTxList();
  showToast(t('toast_tx_added'));
}
function openEditTx(txId){
  const tx=state.transactions.find(t=>t.id===txId);if(!tx)return;
  document.getElementById('modalTitle').textContent=t('tx_edit_title');
  document.getElementById('modalBody').innerHTML=`
    <div class="field"><label class="field-label">${t('tx_date')}</label>${styledDateField('editDate','editDateWrap',tx.date)}</div>
    <div class="field"><label class="field-label">${t('tx_type')}</label><select class="select" id="editType">
      <option value="expense" ${tx.type==='expense'?'selected':''}>${t('tx_type_expense')}</option>
      <option value="bill" ${tx.type==='bill'?'selected':''}>${t('tx_type_bill')}</option>
      <option value="subscription" ${tx.type==='subscription'?'selected':''}>${t('tx_type_subscription')}</option>
      <option value="savings" ${tx.type==='savings'?'selected':''}>${t('tx_type_savings')}</option>
      <option value="sinking_fund" ${tx.type==='sinking_fund'?'selected':''}>${t('tx_type_sinking_fund')}</option>
      <option value="debt" ${tx.type==='debt'?'selected':''}>${t('tx_type_debt')}</option>
      <option value="income" ${tx.type==='income'?'selected':''}>${t('tx_type_income')}</option>
    </select></div>
    <div class="field"><label class="field-label">${t('tx_category')}</label><select class="select" id="editCategory"></select></div>
    <div class="field"><label class="field-label">${t('tx_amount')} (${SYM})</label><input class="input" type="number" id="editAmount" min="0" step="0.01" value="${tx.amount}"></div>
    <div class="field"><label class="field-label">${t('tx_desc_label')}</label><input class="input" type="text" id="editDesc" value="${esc(tx.description||'')}" maxlength="120"></div>
    ${state.allocation?.enabled&&tx.type!=='income'&&tx.type!=='savings'&&tx.type!=='sinking_fund'?`<div class="field" id="editAllocWrap"><label class="field-label">${t('alloc_label')} <span class="required-star" aria-hidden="true">*</span></label><select class="select" id="editAlloc"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}" ${tx.allocation===b.id?'selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select></div>`:''}
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="saveEditBtn">${t('tx_save_changes')}</button>
      <button class="btn btn-ghost btn-sm" id="cancelEditBtn">${t('cancel')}</button>
      <button class="btn btn-danger btn-sm" id="deleteEditBtn">${t('delete')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  bindDateField('editDate','editDateWrap');
  const fillCats=()=>{const type=document.getElementById('editType')?.value,sel=document.getElementById('editCategory'),cats=getCats(type);if(sel)sel.innerHTML=cats.map(c=>`<option value="${esc(c)}" ${c===tx.category?'selected':''}>${esc(c)}</option>`).join('')||'<option value="">- no categories -</option>';};
  fillCats();document.getElementById('editType')?.addEventListener('change',fillCats);
  document.getElementById('editAlloc')?.addEventListener('change', () => {
    document.getElementById('editAlloc')?.classList.remove('select--error');
    document.getElementById('editAllocWrap')?.querySelector('.field-error-msg')?.remove();
  });
  document.getElementById('saveEditBtn')?.addEventListener('click',()=>{
    const date=document.getElementById('editDate')?.value,
          type=document.getElementById('editType')?.value,
          cat=document.getElementById('editCategory')?.value,
          amount=parseFloat(document.getElementById('editAmount')?.value),
          desc=document.getElementById('editDesc')?.value?.trim()||'',
          alloc=document.getElementById('editAlloc')?.value||null;
    if(!date||!type||!cat||isNaN(amount)||amount<=0) return;
    const allocRequired=state.allocation?.enabled&&type!=='income'&&type!=='savings'&&type!=='sinking_fund';
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
      const updated={id:txId,date,type,category:cat,amount,description:desc,allocation:alloc||null};
      state.transactions[idx]=updated;
      applySinkingFundDelta(updated, +1); // apply new
    }
    saveState(); closeModal(); renderTxList(); showToast(t('toast_tx_updated'));
  });
  document.getElementById('cancelEditBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteEditBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_delete_tx'),confirmText:t('delete')}))return;const dtx=state.transactions.find(t=>t.id===txId);applySinkingFundDelta(dtx,-1);state.transactions=state.transactions.filter(t=>t.id!==txId);saveState();closeModal();renderTxList();showToast(t('toast_tx_deleted'));});
}
function openRecurringModal(ruleId){
  const r=ruleId?(state.recurringTemplates||[]).find(x=>x.id===ruleId):null,isNew=!r;
  if(isNew&&trialBlocks('recurring')){ showUpgradeModal({reason:'recurring'}); return; }
  const allocEnabled=state.allocation?.enabled;
  document.getElementById('modalTitle').textContent=t('recurring_title');
  document.getElementById('modalBody').innerHTML=`
    <div class="field"><label class="field-label">${t('recurring_label_ph')} <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="text" id="recLabel" placeholder="${t('recurring_label_ph')}" value="${esc(r?.label||'')}"></div>
    <div class="field-grid">
      <div class="field"><label class="field-label">${t('tx_type')}</label><select class="select" id="recType">
        <option value="expense"${(!r||r.type==='expense')?' selected':''}>${t('tx_type_expense')}</option>
        <option value="bill"${r?.type==='bill'?' selected':''}>${t('tx_type_bill')}</option>
        <option value="savings"${r?.type==='savings'?' selected':''}>${t('tx_type_savings')}</option>
        <option value="income"${r?.type==='income'?' selected':''}>${t('tx_type_income')}</option>
      </select></div>
      <div class="field"><label class="field-label">${t('tx_category')} <span class="required-star" aria-hidden="true">*</span></label><select class="select" id="recCat"></select></div>
    </div>
    <div class="field-grid">
      <div class="field"><label class="field-label">${t('tx_amount')} (${SYM}) <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="number" id="recAmt" min="0" step="0.01" placeholder="0.00" value="${r?.amount||''}"></div>
      <div class="field"><label class="field-label">${t('recurring_freq')}</label><select class="select" id="recFreq">
        <option value="daily"${r?.frequency==='daily'?' selected':''}>${t('freq_daily')}</option>
        <option value="weekly"${r?.frequency==='weekly'?' selected':''}>${t('freq_weekly')}</option>
        <option value="monthly"${(!r||r.frequency==='monthly')?' selected':''}>${t('freq_monthly')}</option>
        <option value="quarterly"${r?.frequency==='quarterly'?' selected':''}>${t('freq_quarterly')}</option>
        <option value="annual"${r?.frequency==='annual'?' selected':''}>${t('freq_annual')}</option>
      </select></div>
    </div>
    ${allocEnabled?`<div class="field" id="recAllocWrap"><label class="field-label">${t('alloc_label')} <span class="required-star" aria-hidden="true">*</span></label><select class="select" id="recAlloc"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}"${r?.allocation===b.id?' selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select></div>`:''}
    <div class="field"><label class="field-label">${t('recurring_next_due')}</label>${styledDateField('recNextDue','recNextDueWrap',r?.nextDue||today())}</div>
    <div class="tx-error" id="recError" hidden></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="recSaveBtn" type="button">${t('tx_add_btn')}</button>
      <button class="btn btn-ghost btn-sm" id="recCancelBtn" type="button">${t('cancel')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  // populate recCat based on type
  const populateRecCat=()=>{const type=document.getElementById('recType')?.value,cats=getCats(type),sel=document.getElementById('recCat');if(!sel)return;sel.innerHTML=cats.length>0?cats.map(c=>`<option value="${esc(c)}"${c===(r?.category||'')?' selected':''}>${esc(c)}</option>`).join(''):'<option value="">-</option>';};
  // allocation only applies to spending types
  const updateRecAlloc=()=>{const type=document.getElementById('recType')?.value,wrap=document.getElementById('recAllocWrap');if(wrap)wrap.style.display=(type==='income'||type==='savings'||type==='sinking_fund')?'none':'';};
  populateRecCat();updateRecAlloc();
  document.getElementById('recType')?.addEventListener('change',()=>{populateRecCat();updateRecAlloc();});
  bindDateField('recNextDue','recNextDueWrap');
  document.getElementById('recCancelBtn')?.addEventListener('click',()=>{document.getElementById('tutorialOverlay').hidden=true;});
  document.getElementById('recAlloc')?.addEventListener('change',()=>{document.getElementById('recAlloc')?.classList.remove('select--error');document.getElementById('recAllocWrap')?.querySelector('.field-error-msg')?.remove();});
  document.getElementById('recSaveBtn')?.addEventListener('click',()=>{
    const label=document.getElementById('recLabel')?.value.trim();
    const type=document.getElementById('recType')?.value;
    const cat=document.getElementById('recCat')?.value;
    const amt=parseFloat(document.getElementById('recAmt')?.value);
    const freq=document.getElementById('recFreq')?.value;
    const nextDue=document.getElementById('recNextDue')?.value;
    const allocApplies=allocEnabled&&type!=='income'&&type!=='savings'&&type!=='sinking_fund';
    const alloc=allocApplies?(document.getElementById('recAlloc')?.value||null):null;
    const errEl=document.getElementById('recError');
    if(!label||!cat||isNaN(amt)||amt<=0||!nextDue){
      if(errEl){errEl.textContent=t('tx_error_required');errEl.hidden=false;}
      return;
    }
    if(allocApplies&&!alloc){
      const sel=document.getElementById('recAlloc'),wrap=document.getElementById('recAllocWrap');
      if(sel)sel.classList.add('select--error');
      if(wrap&&!wrap.querySelector('.field-error-msg')){const msg=document.createElement('span');msg.className='field-error-msg';msg.textContent=t('alloc_required');wrap.appendChild(msg);}
      return;
    }
    if(errEl)errEl.hidden=true;
    const entry={id:ruleId||uid(),label,type,category:cat,amount:amt,frequency:freq,nextDue,allocation:alloc,enabled:r?r.enabled:true,sourceType:r?.sourceType||null,sourceId:r?.sourceId||null};
    if(isNew)state.recurringTemplates.push(entry);
    else{const idx=(state.recurringTemplates||[]).findIndex(x=>x.id===ruleId);if(idx!==-1)state.recurringTemplates[idx]=entry;}
    saveState();document.getElementById('tutorialOverlay').hidden=true;renderTransactions();
    showToast(t('recurring_saved'));
  });
}
function handleCSV(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{const lines=ev.target.result.split('\n').filter(l=>l.trim()),TYPES=new Set(['income','expense','bill','savings','debt','subscription','sinking_fund']);let imported=0,limitHit=false;for(let i=1;i<lines.length;i++){if(trialBlocks('transaction')){limitHit=true;break;}const parts=lines[i].split(',').map(p=>p.trim().replace(/^"|"$/g,''));if(parts.length<4)continue;const[date,type,category,amtStr,desc='',alloc='']=parts,amount=parseFloat(amtStr);if(!date||!TYPES.has(type)||!category||isNaN(amount)||amount<=0)continue;const tx={id:uid(),date,type,category,amount,description:desc};if(alloc)tx.allocation=alloc;applySinkingFundDelta(tx,+1);state.transactions.push(tx);imported++;}saveState();renderTransactions();if(imported>0)showToast(tf('toast_imported',imported));e.target.value='';if(limitHit)showUpgradeModal({reason:'transaction'});};reader.readAsText(file);}

// ── DEBT PAYOFF ────────────────────────────────────────────────────────
const AMORTIZING_DEBT_TYPES=['mortgage','student_loan','car_loan','personal_loan'];
function debtTypes(){return{credit_card:t('dtype_credit_card'),student_loan:t('dtype_student_loan'),mortgage:t('dtype_mortgage'),car_loan:t('dtype_car_loan'),personal_loan:t('dtype_personal_loan'),other:t('dtype_other')};}
function openDebtModal(debtId){
  const d=debtId?state.debts.find(x=>x.id===debtId):null,isNew=!d;
  if(isNew&&trialBlocks('debts')){ showUpgradeModal({reason:'debts'}); return; }
  const DT=debtTypes(),existingLink=findLinkedTemplate('debt',debtId);
  document.getElementById('modalTitle').textContent=isNew?'💳 '+t('dpc_add_debt_title'):'✏️ '+t('dpc_edit_debt_title');
  document.getElementById('modalBody').innerHTML=`
    <div class="field"><label class="field-label">${t('dpc_th_name')} <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="text" id="debtName" placeholder="${t('dpc_name_ph')}" value="${esc(d?.name||'')}"></div>
    <div class="field"><label class="field-label">${t('dpc_th_type')}</label><select class="select" id="debtType">${Object.entries(DT).map(([v,l])=>`<option value="${v}" ${(d?.type||'credit_card')===v?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="field-grid">
      <div class="field"><label class="field-label">${t('dpc_th_balance')} (${SYM}) <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="number" id="debtBalance" min="0" step="0.01" placeholder="0.00" value="${d?.balance||''}"></div>
      <div class="field"><label class="field-label">${t('dpc_apr_word')} (%)</label><input class="input" type="number" id="debtApr" min="0" max="100" step="0.01" placeholder="0.00" value="${d?.interestRate||''}"></div>
    </div>
    <div class="field" id="debtTermRow" style="display:none">
      <label class="field-label">${t('dpc_term_label')}</label>
      <input class="input" type="number" id="debtTermYears" min="0" step="1" placeholder="30" value="${d?.termMonths?Math.round(d.termMonths/12):''}">
      <div class="field-hint">${t('dpc_term_hint')}</div>
    </div>
    <div class="field" id="debtAmortTypeRow" style="display:none">
      <label class="field-label">${t('dpc_amort_type_label')}</label>
      <select class="select" id="debtAmortType">
        <option value="equal_payment" ${(d?.amortType||'equal_payment')==='equal_payment'?'selected':''}>${t('dpc_amort_equal_payment')}</option>
        <option value="equal_principal" ${d?.amortType==='equal_principal'?'selected':''}>${t('dpc_amort_equal_principal')}</option>
      </select>
      <div class="field-hint">${t('dpc_amort_type_hint')}</div>
    </div>
    <div class="field" id="debtRateTypeRow" style="display:none">
      <label class="field-label">${t('dpc_rate_type_label')}</label>
      <select class="select" id="debtRateType">
        <option value="fixed" ${(d?.rateType||'fixed')==='fixed'?'selected':''}>${t('dpc_rate_type_fixed')}</option>
        <option value="arm" ${d?.rateType==='arm'?'selected':''}>${t('dpc_rate_type_arm')}</option>
      </select>
      <div class="field-hint">${t('dpc_rate_type_hint')}</div>
      <div class="field-grid" id="debtArmFieldsRow" style="display:none;margin-top:10px">
        <div class="field"><label class="field-label">${t('dpc_arm_fixed_years_label')}</label><input class="input" type="number" id="debtArmFixedYears" min="0" step="1" placeholder="5" value="${d?.armFixedMonths?Math.round(d.armFixedMonths/12):''}"></div>
        <div class="field"><label class="field-label">${t('dpc_arm_rate_label')} (%)</label><input class="input" type="number" id="debtArmRate" min="0" max="100" step="0.01" placeholder="0.00" value="${d?.armAdjustedRate??''}"></div>
      </div>
    </div>
    <div class="field" id="debtEscrowRow" style="display:none">
      <label class="field-label">${t('dpc_escrow_label')} (${SYM})</label>
      <input class="input" type="number" id="debtEscrow" min="0" step="0.01" placeholder="0.00" value="${d?.escrowMonthly||''}">
      <div class="field-hint">${t('dpc_escrow_hint')}</div>
      <label class="field-label" style="margin-top:8px;display:block">${t('dpc_escrow_mode_label')}</label>
      <select class="select" id="debtEscrowMode">
        <option value="fixed" ${(d?.escrowMode||'fixed')==='fixed'?'selected':''}>${t('dpc_escrow_mode_fixed')}</option>
        <option value="declining" ${d?.escrowMode==='declining'?'selected':''}>${t('dpc_escrow_mode_declining')}</option>
      </select>
      <div class="field-hint">${t('dpc_escrow_mode_hint')}</div>
    </div>
    <div class="field-grid">
      <div class="field"><label class="field-label">${t('dpc_th_min')} (${SYM}) <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="number" id="debtMin" min="0" step="0.01" placeholder="0.00" value="${d?.minimumPayment||''}">
        <div id="debtAutoCalcRow" style="display:none;margin-top:6px"><div class="field-hint" id="debtAutoCalcResult"></div><button type="button" class="link-btn" id="debtRecalcBtn" style="display:none">${t('dpc_recalc_link')}</button></div>
      </div>
      <div class="field"><label class="field-label">${t('dpc_th_due')} <span class="required-star" id="debtDueStar" aria-hidden="true" style="display:${existingLink?'inline':'none'}">*</span></label><input class="input" type="number" id="debtDueDay" min="1" max="31" placeholder="1-31" value="${d?.dueDay||''}"><div class="field-hint">${t('debt_due_day_modal_hint')}</div></div>
    </div>
    <div id="debtMinModeRow" style="display:none">
      <div class="field"><label class="field-label">${t('dpc_min_mode_label')}</label><select class="select" id="debtMinMode">
        <option value="fixed" ${(d?.minPayMode||'fixed')==='fixed'?'selected':''}>${t('dpc_min_mode_fixed')}</option>
        <option value="percent" ${d?.minPayMode==='percent'?'selected':''}>${t('dpc_min_mode_percent')}</option>
      </select></div>
      <div class="field-grid" id="debtPercentRow" style="display:none">
        <div class="field"><label class="field-label">${t('dpc_min_percent_label')}</label><input class="input" type="number" id="debtMinPercent" min="0" step="0.1" placeholder="2" value="${d?.minPayPercent||''}"></div>
        <div class="field"><label class="field-label">${t('dpc_min_floor_label')} (${SYM})</label><input class="input" type="number" id="debtMinFloor" min="0" step="1" placeholder="25" value="${d?.minPayFloor||''}"></div>
      </div>
      <div class="field-hint" id="debtMinCalcHint" style="display:none">${t('dpc_min_calculated_hint')}</div>
    </div>
    ${automateRow(!!existingLink)}
    <div class="tx-error" id="debtError" hidden></div>
    <div class="edit-tx-actions"><button class="btn btn-primary" id="saveDebtBtn">${isNew?t('dpc_add_debt_title'):t('save')}</button><button class="btn btn-ghost btn-sm" id="cancelDebtBtn">${t('cancel')}</button>${!isNew?`<button class="btn btn-danger btn-sm" id="deleteDebtBtn">${t('delete')}</button>`:''}</div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  const clearDebtErr=()=>{const e=document.getElementById('debtError');if(e)e.hidden=true;};
  ['debtName','debtBalance','debtMin','debtDueDay','debtMinPercent','debtMinFloor'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{document.getElementById(id)?.classList.remove('fk-invalid');clearDebtErr();}));
  document.getElementById('automateToggle')?.addEventListener('change',e=>{const star=document.getElementById('debtDueStar');if(star)star.style.display=e.target.checked?'inline':'none';if(!e.target.checked)document.getElementById('debtDueDay')?.classList.remove('fk-invalid');clearDebtErr();});
  document.getElementById('cancelDebtBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteDebtBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_debt'),confirmText:t('delete')}))return;removeLinkedTemplate('debt',debtId);state.debts=state.debts.filter(x=>x.id!==debtId);saveState();closeModal();renderDebt();});
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
  document.getElementById('saveDebtBtn')?.addEventListener('click',()=>{
    const nameEl=document.getElementById('debtName'),balEl=document.getElementById('debtBalance'),minEl=document.getElementById('debtMin'),dueEl=document.getElementById('debtDueDay'),errEl=document.getElementById('debtError');
    const percentEl=document.getElementById('debtMinPercent'),floorEl=document.getElementById('debtMinFloor');
    const name=nameEl?.value.trim(),type=document.getElementById('debtType')?.value,balance=parseFloat(balEl?.value)||0,apr=parseFloat(document.getElementById('debtApr')?.value)||0,dueDay=parseInt(dueEl?.value,10);
    const auto=document.getElementById('automateToggle')?.checked;
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
    if(auto&&!(dueDay>=1&&dueDay<=31)){dueEl?.classList.add('fk-invalid');bad=true;}
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
    if(isNew){did=uid();debtObj={id:did,...fields};state.debts.push(debtObj);}
    else{did=debtId;debtObj=state.debts.find(x=>x.id===debtId);if(debtObj){Object.assign(debtObj,fields);Object.keys(fields).forEach(k=>{if(fields[k]===undefined)delete debtObj[k];});}}
    if(automationOn()&&debtObj){if(auto)upsertLinkedTemplate('debt',did,{type:'debt',category:name||'Debt',label:(name||'Debt')+' '+t('automate_payment_word'),amount:totalMonthlyDebtCost(debtObj),frequency:'monthly',nextDue:nextDueFromDay(dueDay)});else removeLinkedTemplate('debt',did);}
    saveState();closeModal();renderDebt();showToast(t(isNew?'toast_debt_added':'toast_debt_updated'));
  });
}
function renderDebt(){
  const DT=debtTypes(),result=runDebtPayoff(),{method,extraPayment}=state.debtSettings;
  const totDebt=state.debts.reduce((s,d)=>s+d.balance,0),totMin=state.debts.reduce((s,d)=>s+d.minimumPayment,0);
  const totEscrow=state.debts.reduce((s,d)=>s+(d.type==='mortgage'?(d.escrowMonthly||0):0),0);
  const totExtra=state.debts.reduce((s,d)=>s+(d.targetedExtra||0),0);
  const el=document.getElementById('bview-debt');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">💳 ${t('dpc_title')}</h2><div class="section-header-actions">${helpBtn('debt')}<button class="btn btn-ghost btn-sm" id="addDebtBtn">${t('dpc_add_btn')}</button></div></div>
    <p class="section-desc">${t('dpc_desc')}</p>
    <div class="panel" style="margin-bottom:16px"><div class="panel-inner-sm">
      <div class="debt-config-row">
        <div><label class="field-label" style="margin-bottom:8px">${t('dpc_method_label')}</label>
          <div class="method-toggle">
            <button class="method-btn${method==='snowball'?' is-active':''}" data-method="snowball" type="button"><div class="method-btn-title">⛄ Snowball</div><div class="method-btn-desc">${t('dpc_snowball_desc')}</div></button>
            <button class="method-btn${method==='avalanche'?' is-active':''}" data-method="avalanche" type="button"><div class="method-btn-title">🌊 Avalanche</div><div class="method-btn-desc">${t('dpc_avalanche_desc')}</div></button>
          </div>
        </div>
        <div class="field" style="min-width:200px"><label class="field-label">${t('dpc_extra_label')} (${SYM})</label><input class="input" type="number" id="extraPayment" min="0" step="10" value="${extraPayment||''}" placeholder="0.00"><div class="field-hint">${t('dpc_extra_hint')}</div></div>
      </div>
    </div></div>
    ${state.debts.length===0
      ?`<div class="empty-state"><div class="empty-icon">💳</div><p class="empty-title">${t('dpc_empty_title')}</p><p class="empty-sub">${t('dpc_empty_sub')}</p><button class="btn btn-primary btn-sm empty-cta" id="debtEmptyAdd" type="button">${t('dpc_add_btn')}</button></div>`
      :`<div class="panel" style="margin-bottom:16px"><div class="module-table-wrap"><table class="module-table debt-table"><thead><tr>
          <th>${t('dpc_th_name')}</th><th>${t('dpc_th_type')}</th><th>${t('dpc_th_balance')} (${SYM})</th>
          <th>${t('dpc_th_apr')}</th><th>${t('dpc_th_min')}</th><th title="${t('dpc_extra_col_hint')}">${t('dpc_th_extra')}</th><th>${t('automate_th')}</th><th></th>
        </tr></thead><tbody>
        ${state.debts.map(d=>`<tr class="module-row">
          <td><strong>${esc(d.name)||'<span style="color:var(--text-faint)">-</span>'}</strong></td>
          <td>${DT[d.type]||esc(d.type)}</td>
          <td>${fmt(d.balance)}</td>
          <td>${(d.interestRate||0)}%${d.rateType==='arm'?`<div class="field-hint" style="margin:2px 0 0">${tf('dpc_arm_caption',Math.round((d.armFixedMonths||0)/12))}</div>`:''}</td>
          <td>${fmt(d.minimumPayment)}${d.minPayMode==='percent'?`<div class="field-hint" style="margin:2px 0 0">${tf('dpc_min_pct_caption',d.minPayPercent||0)}</div>`:d.amortType==='equal_principal'?`<div class="field-hint" style="margin:2px 0 0">${t('dpc_declining_caption')}</div>`:''}</td>
          <td><input class="expected-input" type="number" min="0" step="10" value="${d.targetedExtra||''}" placeholder="0.00" data-debt-extra="${d.id}"></td>
          <td><label class="recurring-toggle" title="${t('automate_label')}"><input type="checkbox" class="debt-auto-cb" data-debt-auto="${d.id}" ${findLinkedTemplate('debt',d.id)?'checked':''} ${automationOn()?'':'disabled'}><span class="rec-toggle-track"></span></label></td>
          <td><div class="row-actions"><button class="btn-icon-tiny" data-debt-schedule="${d.id}" type="button" title="${t('dpc_schedule_btn_title')}">ℹ️</button><button class="sf-edit-btn btn-icon-tiny" data-debt-edit="${d.id}" type="button" title="${t('edit')}">✏️</button><button class="btn-icon-tiny del-btn" data-debt-id="${d.id}" type="button">×</button></div></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr class="total-row"><td colspan="2"><strong>${t('dpc_totals')}</strong></td><td><strong>${fmt(totDebt)}</strong></td><td></td><td><strong>${fmt(totMin)}${t('sf_per_month')}</strong></td><td><strong>${fmt(totExtra)}</strong></td><td colspan="2"></td></tr></tfoot>
      </table></div></div>`}
    ${state.debts.length>0&&result?`<div class="debt-results">
      <div class="debt-results-cards">
        <div class="dr-card dr-card--green"><div class="dr-label">${t('dpc_debt_free_label')}</div><div class="dr-value">${formatDateDisplay(result.debtFreeDate)}</div><div class="dr-sub">${result.months} ${t('dpc_months_from_now')}</div></div>
        <div class="dr-card dr-card--red"><div class="dr-label">${t('dpc_interest_label')}</div><div class="dr-value">${fmt(result.totalInterest)}</div><div class="dr-sub">${t('dpc_on_top')} ${fmt(totDebt)} ${t('dpc_principal')}</div></div>
        <div class="dr-card dr-card--blue"><div class="dr-label">${t('dpc_monthly_label')}</div><div class="dr-value">${fmt(totMin+(extraPayment||0)+totExtra+totEscrow)}</div><div class="dr-sub">${fmt(totMin)} ${t('dpc_min_abbr')} + ${fmt(extraPayment||0)} ${t('dpc_extra_abbr')}${totExtra>0?` + ${tf('dpc_targeted_extra_note',fmt(totExtra))}`:''}${totEscrow>0?` + ${tf('dpc_escrow_note',fmt(totEscrow))}`:''}</div></div>
      </div>
      <div class="panel" style="margin-top:16px"><div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:14px">${method==='snowball'?t('dpc_payoff_order_sf'):t('dpc_payoff_order_av')}</div>
        ${result.payoffOrder.map((d,i)=>{
          let termNote='';
          if(d.termMonths>0&&d.paidOffMonth){
            const years=Math.round(d.termMonths/12),diff=d.termMonths-d.paidOffMonth;
            termNote=diff>0?` • ${tf('dpc_term_note_faster',diff,years)}`:diff<0?` • ${tf('dpc_term_note_slower',-diff,years)}`:` • ${tf('dpc_term_note_onschedule',years)}`;
          }
          return `<div class="payoff-order-row"><span class="po-num">${i+1}</span><div class="po-info"><div class="po-name">${esc(d.name)}</div><div class="po-detail">${DT[d.type]||d.type} • ${fmt(d.balance)} ${t('dpc_balance_word')} • ${d.interestRate}% ${t('dpc_apr_word')}${termNote}</div></div><div class="po-date">${t('dpc_paid_off')} <strong>${d.paidOffDate}</strong></div></div>`;
        }).join('')}
      </div></div>
    </div>`:''}`;
  document.getElementById('addDebtBtn')?.addEventListener('click',()=>openDebtModal(null));
  document.getElementById('debtEmptyAdd')?.addEventListener('click',()=>openDebtModal(null));
  el.querySelectorAll('[data-debt-edit]').forEach(b=>b.addEventListener('click',()=>openDebtModal(b.dataset.debtEdit)));
  el.querySelectorAll('[data-method]').forEach(b=>b.addEventListener('click',()=>{state.debtSettings.method=b.dataset.method;saveState();renderDebt();}));
  document.getElementById('extraPayment')?.addEventListener('change',e=>{state.debtSettings.extraPayment=parseFloat(e.target.value)||0;saveState();renderDebt();});
  el.querySelectorAll('.debt-auto-cb[data-debt-auto]').forEach(cb=>cb.addEventListener('change',()=>{
    const d=state.debts.find(x=>x.id===cb.dataset.debtAuto);if(!d)return;
    if(cb.checked){
      if(!(d.minimumPayment>0)||!(d.dueDay>=1&&d.dueDay<=31)){cb.checked=false;openDebtModal(d.id);return;}
      upsertLinkedTemplate('debt',d.id,{type:'debt',category:d.name||'Debt',label:(d.name||'Debt')+' '+t('automate_payment_word'),amount:totalMonthlyDebtCost(d),frequency:'monthly',nextDue:nextDueFromDay(d.dueDay)});
      showToast(t('recurring_saved'));
    } else removeLinkedTemplate('debt',d.id);
    saveState();
  }));
  el.querySelectorAll('[data-debt-id]').forEach(b=>b.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_debt'),confirmText:t('delete')}))return;removeLinkedTemplate('debt',b.dataset.debtId);state.debts=state.debts.filter(d=>d.id!==b.dataset.debtId);saveState();renderDebt();}));
  el.querySelectorAll('[data-debt-extra]').forEach(inp=>inp.addEventListener('change',()=>{const d=state.debts.find(x=>x.id===inp.dataset.debtExtra);if(d){d.targetedExtra=Math.max(0,parseFloat(inp.value)||0);saveState();renderDebt();}}));
  el.querySelectorAll('[data-debt-schedule]').forEach(b=>b.addEventListener('click',()=>openDebtSchedule(b.dataset.debtSchedule)));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}

// ── SINKING FUNDS ─────────────────────────────────────────────────────
const FUND_ICONS=['🏖️','🚗','🏠','💒','✈️','🎓','💻','🏥','🎁','🐾','🌱','⚡','🎵','🏋️','🍽️','💡','🎮','📱','🛒','🚀'];
function renderSinking(){
  const totMo=state.sinkingFunds.reduce((t,f)=>{const{requiredMonthly}=calcFund(f);return t+requiredMonthly;},0);
  const el=document.getElementById('bview-sinking');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">🏺 ${t('tab_sinking')}</h2><div class="section-header-actions">${helpBtn('sinking')}<button class="btn btn-ghost btn-sm" id="addFundBtn">${t('sf_add_btn')}</button></div></div>
    <p class="section-desc">${t('sf_desc')}</p>
    ${state.sinkingFunds.length===0
      ?`<div class="empty-state"><div class="empty-icon">🏺</div><p class="empty-title">${t('sf_empty_title')}</p><p class="empty-sub">${t('sf_empty_sub')}</p><button class="btn btn-primary btn-sm empty-cta" id="fundEmptyAdd" type="button">${t('sf_add_btn')}</button></div>`
      :`<div class="sf-grid">${state.sinkingFunds.map(f=>{
        const{monthsLeft,requiredMonthly,pctComplete}=calcFund(f),p=Math.round(pctComplete);
        const barColor=p>=100?'#10b981':p>=60?'#6366f1':'#fb923c';
        const moLabel=monthsLeft===1?t('sf_month_left_one'):t('sf_month_left_many');
        return`<div class="sf-card panel"><div class="sf-card-inner">
          <div class="sf-card-top"><span class="sf-icon">${f.icon||'🏺'}</span><div class="sf-card-actions">
            <button class="sf-add-btn btn-icon-tiny" data-fund="${f.id}" title="${t('sf_add_btn')}" type="button">+</button>
            <button class="sf-edit-btn btn-icon-tiny" data-fund="${f.id}" title="${t('edit')}" type="button">✏️</button>
            <button class="sf-del-btn btn-icon-tiny del-btn" data-fund="${f.id}" title="${t('delete')}" type="button">×</button>
          </div></div>
          <div class="sf-name">${esc(f.name)}</div>
          <div class="sf-amounts"><span class="sf-saved">${fmt(f.currentSaved||0)}</span><span class="sf-divider"> / </span><span class="sf-target">${fmt(f.targetAmount||0)}</span></div>
          <div class="prog-bar-wrap" style="margin:10px 0 5px"><div class="prog-bar" style="width:${p}%;background:${barColor}"></div></div>
          <div class="sf-pct">${p}% ${t('sf_pct_complete')}</div>
          ${(()=>{if(!f.targetDate)return'';if(p>=100)return`<div class="sf-date sf-complete">${t('sf_target_complete')}</div>`;const td=new Date(f.targetDate+'T00:00:00'),now=new Date();now.setHours(0,0,0,0);const dl=Math.ceil((td-now)/86400000);const cls=dl<0?'sf-date sf-overdue':dl===0?'sf-date sf-today':'sf-date';return`<div class="${cls}">\uD83C\uDFAF ${formatDateDisplay(f.targetDate)}</div>`;})()} 
          <div class="sf-monthly">${t('sf_save_prefix')} ${fmt(requiredMonthly)}${t('sf_per_month')}</div>
          <div class="sf-months-left">${monthsLeft} ${moLabel}</div>
          <div class="sf-auto-row${automationOn()?'':' is-off'}" title="${automationOn()?t('automate_hint'):t('automate_hint_off')}"><span class="sf-auto-label">${t('automate_label')}</span><label class="recurring-toggle"><input type="checkbox" class="sf-auto-cb" data-fund-auto="${f.id}" ${findLinkedTemplate('sinking_fund',f.id)?'checked':''} ${automationOn()?'':'disabled'}><span class="rec-toggle-track"></span></label></div>
        </div></div>`;
      }).join('')}</div>
      <div class="sf-total-row"><span>${t('sf_total_contrib')}</span><strong>${fmt(totMo)}${t('sf_per_month')}</strong></div>`
    }`;
  document.getElementById('addFundBtn')?.addEventListener('click',()=>openFundModal(null));
  document.getElementById('fundEmptyAdd')?.addEventListener('click',()=>openFundModal(null));
  el.querySelectorAll('.sf-edit-btn').forEach(b=>b.addEventListener('click',()=>openFundModal(b.dataset.fund)));
  el.querySelectorAll('.sf-del-btn').forEach(b=>b.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_delete_fund'),confirmText:t('delete')}))return;removeLinkedTemplate('sinking_fund',b.dataset.fund);state.sinkingFunds=state.sinkingFunds.filter(f=>f.id!==b.dataset.fund);saveState();renderSinking();}));
  el.querySelectorAll('.sf-auto-cb[data-fund-auto]').forEach(cb=>cb.addEventListener('change',()=>{
    const f=state.sinkingFunds.find(x=>x.id===cb.dataset.fundAuto);if(!f)return;
    if(cb.checked){
      if(!(f.billingDay>=1&&f.billingDay<=31)){cb.checked=false;openFundModal(f.id);return;}
      const amount=Math.round((calcFund(f).requiredMonthly||0)*100)/100;
      upsertLinkedTemplate('sinking_fund',f.id,{type:'sinking_fund',category:f.name,label:f.name,amount,frequency:'monthly',nextDue:nextDueFromDay(f.billingDay)});
      showToast(t('recurring_saved'));
    } else removeLinkedTemplate('sinking_fund',f.id);
    saveState();renderSinking();
  }));
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
      state.transactions.push(tx);
      applySinkingFundDelta(tx,+1);
      saveState();
      document.getElementById('tutorialOverlay').hidden=true;
      renderSinking();showToast(tf('toast_fund_contrib',fmt(amt),f.name));
    });
    document.getElementById('sfContribCancel')?.addEventListener('click',()=>{document.getElementById('tutorialOverlay').hidden=true;});
  }));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}
function openFundModal(fundId){
  const f=fundId?state.sinkingFunds.find(sf=>sf.id===fundId):null,isNew=!f;
  if(isNew&&trialBlocks('sinkingFunds')){ showUpgradeModal({reason:'sinkingFunds'}); return; }
  let selIcon=f?.icon||FUND_ICONS[0];
  const existingLink=findLinkedTemplate('sinking_fund',fundId);
  const billDay=f?.billingDay||(existingLink?.nextDue?parseInt(existingLink.nextDue.slice(8,10),10):'');
  document.getElementById('modalTitle').textContent=isNew?t('sf_modal_new'):t('sf_modal_edit');
  document.getElementById('modalBody').innerHTML=`<div class="field"><label class="field-label">${t('sf_fund_name_label')} <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="text" id="fundName" placeholder="${t('sf_fund_name_ph')}" value="${esc(f?.name||'')}"></div>
    <div class="field"><label class="field-label">${t('sf_icon_label')}</label><div class="icon-picker">${FUND_ICONS.map(ic=>`<button class="icon-pick-btn${(f?.icon||FUND_ICONS[0])===ic?' is-active':''}" data-icon="${ic}" type="button">${ic}</button>`).join('')}</div></div>
    <div class="field-grid"><div class="field"><label class="field-label">${t('sf_target_amount_label')} (${SYM}) <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="number" id="fundTarget" min="0" step="10" placeholder="0.00" value="${f?.targetAmount||''}"></div><div class="field"><label class="field-label">${t('sf_currently_saved_label')} (${SYM})</label><input class="input" type="number" id="fundSaved" min="0" step="10" placeholder="0.00" value="${f?.currentSaved||''}"></div></div>
    <div class="field"><label class="field-label">${t('sf_target_date_label')} <span class="required-star" aria-hidden="true">*</span></label>${styledDateField('fundDate','fundDateWrap',f?.targetDate||'')}</div>
    ${automateRow(!!existingLink)}
    <div class="field" id="fundBillingWrap" style="display:${existingLink&&automationOn()?'block':'none'}"><label class="field-label">${t('sf_billing_day_label')} <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="number" id="fundBillingDay" min="1" max="31" placeholder="1-31" value="${billDay||''}"><div class="field-hint">${t('sf_billing_day_hint')}</div></div>
    <div class="tx-error" id="fundError" hidden></div>
    <div class="edit-tx-actions"><button class="btn btn-primary" id="saveFundBtn">${isNew?t('sf_create_btn'):t('save')}</button><button class="btn btn-ghost btn-sm" id="cancelFundBtn">${t('cancel')}</button>${!isNew?`<button class="btn btn-danger btn-sm" id="deleteFundBtn">${t('delete')}</button>`:''}</div>`;
  document.getElementById('tutorialOverlay').hidden=false;
  bindDateField('fundDate','fundDateWrap');
  document.querySelectorAll('.icon-pick-btn').forEach(b=>{b.addEventListener('click',()=>{selIcon=b.dataset.icon;document.querySelectorAll('.icon-pick-btn').forEach(x=>x.classList.toggle('is-active',x.dataset.icon===selIcon));});});
  const clearFundErr=()=>{document.getElementById('fundError')&&(document.getElementById('fundError').hidden=true);};
  document.getElementById('automateToggle')?.addEventListener('change',e=>{const w=document.getElementById('fundBillingWrap');if(w)w.style.display=e.target.checked?'block':'none';if(!e.target.checked)document.getElementById('fundBillingDay')?.classList.remove('fk-invalid');clearFundErr();});
  ['fundName','fundTarget','fundBillingDay'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{document.getElementById(id)?.classList.remove('fk-invalid');clearFundErr();}));
  document.getElementById('fundDate')?.addEventListener('change',()=>{document.getElementById('fundDateWrap')?.classList.remove('fk-invalid');clearFundErr();});
  document.getElementById('saveFundBtn')?.addEventListener('click',()=>{
    const nameEl=document.getElementById('fundName'),targetEl=document.getElementById('fundTarget'),dateWrap=document.getElementById('fundDateWrap'),billEl=document.getElementById('fundBillingDay'),errEl=document.getElementById('fundError');
    const name=nameEl?.value.trim(),target=parseFloat(targetEl?.value)||0,saved=parseFloat(document.getElementById('fundSaved')?.value)||0,date=document.getElementById('fundDate')?.value||'';
    const auto=document.getElementById('automateToggle')?.checked,billingDay=parseInt(billEl?.value,10);
    [nameEl,targetEl,dateWrap,billEl].forEach(x=>x&&x.classList.remove('fk-invalid'));
    let bad=false;
    if(!name){nameEl?.classList.add('fk-invalid');bad=true;}
    if(!(target>0)){targetEl?.classList.add('fk-invalid');bad=true;}
    if(!date){dateWrap?.classList.add('fk-invalid');bad=true;}
    if(auto&&!(billingDay>=1&&billingDay<=31)){billEl?.classList.add('fk-invalid');bad=true;}
    if(bad){if(errEl){errEl.textContent=t('sf_error_required');errEl.hidden=false;}return;}
    if(errEl)errEl.hidden=true;
    let fid,fundObj;
    if(isNew){fid=uid();fundObj={id:fid,name,icon:selIcon,targetAmount:target,currentSaved:saved,targetDate:date,billingDay:auto?billingDay:null};state.sinkingFunds.push(fundObj);}
    else{fid=fundId;fundObj=state.sinkingFunds.find(sf=>sf.id===fundId);if(fundObj){fundObj.name=name;fundObj.icon=selIcon;fundObj.targetAmount=target;fundObj.currentSaved=saved;fundObj.targetDate=date;if(auto)fundObj.billingDay=billingDay;}}
    if(automationOn()&&fundObj){if(auto){const amt=Math.round((calcFund(fundObj).requiredMonthly||0)*100)/100;upsertLinkedTemplate('sinking_fund',fid,{type:'sinking_fund',category:name,label:name,amount:amt,frequency:'monthly',nextDue:nextDueFromDay(billingDay)});}else removeLinkedTemplate('sinking_fund',fid);}
    saveState();closeModal();renderSinking();showToast(t(isNew?'toast_fund_created':'toast_fund_updated'));
  });
  document.getElementById('cancelFundBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteFundBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_delete_fund'),confirmText:t('delete')}))return;removeLinkedTemplate('sinking_fund',fundId);state.sinkingFunds=state.sinkingFunds.filter(sf=>sf.id!==fundId);saveState();closeModal();renderSinking();});
}

// ── SMART CALENDAR ─────────────────────────────────────────────────────
function calLocale() {
  const map = {en:'en-GB',de:'de-DE',fr:'fr-FR',es:'es-ES',it:'it-IT',pl:'pl-PL'};
  return map[state?.settings?.language || 'en'] || 'en-GB';
}

function renderCalendar(){
  const loc=calLocale(),now=new Date(),y=calYear,m=calMonth;
  const firstDow=(new Date(y,m,1).getDay()+6)%7,daysInMo=new Date(y,m+1,0).getDate();
  const evs={};
  const addEv=(day,ev)=>{(evs[day]=evs[day]||[]).push(ev);};
  for(const b of state.budgets.bills||[])if(b.dueDate){const d=parseInt(b.dueDate.split('-')[2]);if(d>=1&&d<=daysInMo)addEv(d,{type:'bill',label:b.category,amount:b.expected||0,color:'#fb923c',paid:b.paid});}
  for(const d of state.debts)if(d.dueDay&&d.dueDay>=1&&d.dueDay<=daysInMo)addEv(d.dueDay,{type:'debt',label:d.name,amount:d.minimumPayment||0,color:'#a855f7'});
  for(const s of state.subscriptions.filter(s=>s.active!==false))if(s.nextBillingDate){const d=parseInt(s.nextBillingDate.split('-')[2]);if(d>=1&&d<=daysInMo)addEv(d,{type:'subscription',label:s.name,amount:monthlySubAmt(s),color:'#10b981'});}
  const monthStr=`${y}-${String(m+1).padStart(2,'0')}`;
  for(const tx of state.transactions)if(tx.date.startsWith(monthStr)){const d=parseInt(tx.date.split('-')[2]);addEv(d,{type:'transaction',label:tx.category,amount:tx.amount,color:'#6366f1'});}
  // Sinking fund goal/target dates (milestones)
  for(const f of state.sinkingFunds||[])if(f.targetDate&&f.targetDate.startsWith(monthStr)){const d=parseInt(f.targetDate.split('-')[2]);if(d>=1&&d<=daysInMo)addEv(d,{type:'goal',label:f.name,amount:f.targetAmount||0,color:'#ec4899'});}
  // Scheduled automatic transactions: manual ones + sinking-fund contributions
  // (subscription & debt automations already appear via their own entity dates above)
  if(automationOn()){
    const mStart=`${monthStr}-01`, mEnd=`${monthStr}-${String(daysInMo).padStart(2,'0')}`;
    for(const tmpl of state.recurringTemplates||[]){
      if(!tmpl.enabled||tmpl.sourceType==='subscription'||tmpl.sourceType==='debt') continue;
      const isSink=tmpl.sourceType==='sinking_fund';
      templateDatesInRange(tmpl,mStart,mEnd).forEach(iso=>{const d=parseInt(iso.split('-')[2]);if(d>=1&&d<=daysInMo)addEv(d,{type:isSink?'sinking':'auto',label:tmpl.label||tmpl.category,amount:tmpl.amount||0,color:isSink?'#06b6d4':'#8b5cf6'});});
    }
  }

  // Locale-formatted month/year for header
  const monthName=new Date(y,m,1).toLocaleDateString(loc,{month:'long',year:'numeric'});
  const isNowMonth=y===now.getFullYear()&&m===now.getMonth();

  // Translated event type labels
  const typeLabel={'bill':t('cal_leg_bill'),'debt':t('cal_leg_debt'),'subscription':t('cal_leg_sub'),'transaction':t('cal_leg_tx'),'sinking':t('cal_leg_sinking'),'goal':t('cal_leg_goal'),'auto':t('cal_leg_auto')};

  // Build selected day panel
  let selPanel='';
  if(calSelectedDay!==null){
    const dayEvs=evs[calSelectedDay]||[];
    const dayName=`${calSelectedDay} ${new Date(y,m,calSelectedDay).toLocaleDateString(loc,{month:'long'})}`;
    const evCount=dayEvs.length===1?`1 ${t('cal_event_one')}`:`${dayEvs.length} ${t('cal_event_many')}`;
    const evHtml=dayEvs.length===0
      ?`<div class="cal-no-events">${t('cal_no_events_day')}</div>`
      :dayEvs.map(ev=>{
        const statusHtml=ev.paid!==undefined?`<span class="cal-ev-status ${ev.paid?'is-paid':'is-unpaid'}">${ev.paid?t('cal_paid'):t('cal_unpaid')}</span>`:'';
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
        const statusHtml=ev.paid!==undefined?`<span class="cal-ev-status ${ev.paid?'is-paid':'is-unpaid'}">${ev.paid?t('cal_paid'):t('cal_unpaid')}</span>`:'';
        monthList+=`<div class="cal-ev-item"><span class="cal-dot" style="background:${ev.color}"></span><span class="cal-ev-label">${esc(ev.label)}</span><span class="cal-ev-type">${esc(typeLabel[ev.type]||ev.type)}</span><span class="cal-ev-amt">${fmt(ev.amount)}</span>${statusHtml}</div>`;
      });
      monthList+='</div>';
    });
    monthList+='</div>';
  } else {
    monthList=`<div class="empty-state" style="padding:24px 0"><div class="empty-icon">📅</div><p class="empty-title">${t('cal_no_events_month')}</p><p class="empty-sub">${t('cal_no_events_sub')}</p><button class="btn btn-primary btn-sm empty-cta" id="calEmptyAdd" type="button">\u002B ${t('tx_add_title')}</button></div>`;
  }

  const el=document.getElementById('bview-calendar');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">📅 ${t('cal_title')}</h2>${helpBtn('calendar')}</div>
    <p class="section-desc">${t('cal_desc')}</p>
    <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="calPrev">${t('cal_prev')}</button><h3 class="cal-month-title">${monthName}</h3><button class="btn btn-ghost btn-sm" id="calNext">${t('cal_next')}</button></div>
    <div class="panel"><div class="cal-grid-wrap"><div class="cal-grid">
      ${[t('mon'),t('tue'),t('wed'),t('thu'),t('fri'),t('sat'),t('sun')].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${Array(firstDow).fill('<div class="cal-cell cal-empty"></div>').join('')}
      ${Array.from({length:daysInMo},(_,i)=>{const day=i+1,dayEvs=evs[day]||[],isToday=isNowMonth&&day===now.getDate(),isSel=calSelectedDay===day;return`<div class="cal-cell${isToday?' cal-today':''}${isSel?' cal-selected':''}" data-day="${day}"><span class="cal-day-num">${day}</span><div class="cal-dots">${dayEvs.slice(0,3).map(e=>`<span class="cal-dot" style="background:${e.color}"></span>`).join('')}${dayEvs.length>3?`<span class="cal-dot-more">+${dayEvs.length-3}</span>`:''}</div></div>`;}).join('')}
    </div></div></div>
    <div class="cal-legend"><span class="cal-leg-item"><span class="cal-dot" style="background:#fb923c"></span>${t('cal_leg_bill')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#a855f7"></span>${t('cal_leg_debt')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#10b981"></span>${t('cal_leg_sub')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#06b6d4"></span>${t('cal_leg_sinking')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#8b5cf6"></span>${t('cal_leg_auto')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#ec4899"></span>${t('cal_leg_goal')}</span><span class="cal-leg-item"><span class="cal-dot" style="background:#6366f1"></span>${t('cal_leg_tx')}</span></div>`;

  // Inject selected-day panel and month list as DOM (not template)
  if(selPanel) el.insertAdjacentHTML('beforeend', selPanel);
  el.insertAdjacentHTML('beforeend', monthList);

  el.querySelectorAll('.cal-cell[data-day]').forEach(cell=>{
    cell.addEventListener('click',()=>{
      const day=parseInt(cell.dataset.day);
      calSelectedDay=(calSelectedDay===day)?null:day;
      renderCalendar();
      if(calSelectedDay) requestAnimationFrame(()=>document.getElementById('calDayEvents')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    });
  });
  document.getElementById('calClearSel')?.addEventListener('click',()=>{calSelectedDay=null;renderCalendar();});
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
  const el=document.getElementById('bview-subscriptions');
  const active=state.subscriptions.filter(s=>s.active!==false);
  const totMo=active.reduce((t,s)=>t+monthlySubAmt(s),0);
  const totYr=active.reduce((t,s)=>t+annualSubAmt(s),0);
  const byCat={};
  for(const s of active){const c=s.category||'Other';byCat[c]=(byCat[c]||0)+monthlySubAmt(s);}
  const catEntries=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const catSegs=catEntries.map(([label,value],i)=>({label:subCatLabel(label),value,color:COLORS[i%COLORS.length],pct:totMo>0?value/totMo*100:0}));

  // Build summary bar HTML
  const summaryBar = state.subscriptions.length > 0
    ? `<div class="sub-summary-bar">
        <div class="sub-sum-item"><div class="sub-sum-label">${t('sub_sum_monthly')}</div><div class="sub-sum-value">${fmt(totMo)}</div></div>
        <div class="sub-sum-item"><div class="sub-sum-label">${t('sub_sum_annual')}</div><div class="sub-sum-value">${fmt(totYr)}</div></div>
        <div class="sub-sum-item"><div class="sub-sum-label">${t('sub_active')}</div><div class="sub-sum-value">${active.length}</div></div>
        <div class="sub-sum-item"><div class="sub-sum-label">${t('sub_paused')}</div><div class="sub-sum-value">${state.subscriptions.length-active.length}</div></div>
      </div>` : '';

  // Build list HTML
  const listHtml = state.subscriptions.length === 0
    ? `<div class="sub-empty-centered">
        <div class="empty-icon">🔄</div>
        <p class="empty-title" style="font-size:15px;font-weight:600;color:var(--text-primary);margin:0">${t('sub_empty_title')}</p>
        <p class="empty-sub" style="margin:4px 0 0">${t('sub_empty_sub')}</p>
        <button class="btn btn-primary btn-sm empty-cta" id="subEmptyAdd" type="button">${t('sub_add_btn')}</button>
      </div>`
    : state.subscriptions.map(sub => {
        const freqLabel = sub.frequency==='annual'?t('sub_unit_year'):sub.frequency==='quarterly'?t('sub_unit_quarter'):t('sub_unit_month');
        const nextDue = sub.nextBillingDate ? `<span class="sub-due">${t('sub_next_label')}: ${formatDateDisplay(sub.nextBillingDate)}</span>` : '';
        return `<div class="sub-card panel${sub.active===false?' sub-paused':''}">
          <div class="sub-card-inner">
            <div class="sub-card-head">
              <div class="sub-card-left">
                <div class="sub-name">${esc(sub.name)}</div>
                <div class="sub-meta"><span class="sub-cat-pill">${esc(subCatLabel(sub.category))}</span>${nextDue}</div>
              </div>
              <div class="sub-amount-block">
                <div class="sub-amount">${fmt(sub.amount)}<span class="sub-freq">/${freqLabel}</span></div>
                ${sub.frequency!=='monthly'?`<div class="sub-monthly-eq">\u2248 ${fmt(monthlySubAmt(sub))}/mo</div>`:''}
              </div>
            </div>
            <div class="sub-card-foot">
              <div class="sub-toggle-rows">
                <span class="mini-toggle" title="${sub.active===false?t('sub_paused'):t('sub_active')}"><span class="mini-toggle-label">${sub.active===false?t('sub_paused'):t('sub_active')}</span><label class="recurring-toggle"><input type="checkbox" class="sub-toggle-cb" data-sub-toggle="${sub.id}" ${sub.active!==false?'checked':''}><span class="rec-toggle-track"></span></label></span>
                <span class="mini-toggle${automationOn()?'':' is-off'}" title="${automationOn()?t('automate_hint'):t('automate_hint_off')}"><span class="mini-toggle-label">${t('automate_label')}</span><label class="recurring-toggle"><input type="checkbox" class="sub-auto-cb" data-sub-auto="${sub.id}" ${findLinkedTemplate('subscription',sub.id)?'checked':''} ${automationOn()?'':'disabled'}><span class="rec-toggle-track"></span></label></span>
              </div>
              <div class="sub-btn-row">
                <button class="sf-edit-btn btn-icon-tiny" data-sub-edit="${sub.id}" type="button" title="${t('edit')}">✏️</button>
                <button class="del-btn" data-sub-del="${sub.id}" type="button" title="${t('delete')}">×</button>
              </div>
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
      <h2 class="section-title">🔄 ${t('tab_subscriptions')}</h2>
      <div class="section-header-actions">
        ${helpBtn('subscriptions')}
        <button class="btn btn-ghost btn-sm" id="addSubBtn">${t('sub_add_btn')}</button>
      </div>
    </div>
    <p class="section-desc">${t('sub_desc')}</p>
    ${summaryBar}`;

  // Inject body using DOM to avoid template literal nesting
  if (state.subscriptions.length === 0) {
    el.insertAdjacentHTML('beforeend', listHtml);
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
  document.getElementById('addSubBtn')?.addEventListener('click',()=>openSubModal(null));
  document.getElementById('subEmptyAdd')?.addEventListener('click',()=>openSubModal(null));
  el.querySelectorAll('[data-sub-edit]').forEach(b=>b.addEventListener('click',()=>openSubModal(b.dataset.subEdit)));
  el.querySelectorAll('[data-sub-del]').forEach(b=>b.addEventListener('click',async()=>{
    if(!await confirmDialog({message:t('confirm_remove_sub'),confirmText:t('delete')}))return;
    removeLinkedTemplate('subscription',b.dataset.subDel);
    state.subscriptions=state.subscriptions.filter(s=>s.id!==b.dataset.subDel);
    saveState();renderSubscriptions();
  }));
  el.querySelectorAll('.sub-auto-cb[data-sub-auto]').forEach(cb=>cb.addEventListener('change',()=>{
    const s=state.subscriptions.find(x=>x.id===cb.dataset.subAuto);if(!s)return;
    if(cb.checked){
      upsertLinkedTemplate('subscription',s.id,{type:'subscription',category:s.category||'Subscriptions',label:s.name,amount:s.amount,frequency:s.frequency,nextDue:s.nextBillingDate||today()});
      const lt=findLinkedTemplate('subscription',s.id);if(lt)lt.enabled=s.active!==false;
      showToast(t('recurring_saved'));
    } else removeLinkedTemplate('subscription',s.id);
    saveState();renderSubscriptions();
  }));
  el.querySelectorAll('.sub-toggle-cb[data-sub-toggle]').forEach(cb=>cb.addEventListener('change',()=>{
    const s=state.subscriptions.find(s=>s.id===cb.dataset.subToggle);
    if(s){s.active=cb.checked;const lt=findLinkedTemplate('subscription',s.id);if(lt)lt.enabled=cb.checked;saveState();renderSubscriptions();}
  }));
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
}


function openSubModal(subId){
  const sub=subId?state.subscriptions.find(s=>s.id===subId):null,isNew=!sub;
  if(isNew&&trialBlocks('subscriptions')){ showUpgradeModal({reason:'subscriptions'}); return; }
  const allocEnabled=state.allocation?.enabled;
  document.getElementById('modalTitle').textContent=isNew?'🔄 '+t('sub_add_title'):'✏️ '+t('sub_edit_title');
  document.getElementById('modalBody').innerHTML=`<div class="field"><label class="field-label">${t('sub_name_label')} <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="text" id="subName" placeholder="${t('sub_name_ph')}" value="${esc(sub?.name||'')}"></div>
    <div class="field-grid"><div class="field"><label class="field-label">${t('sub_amount_label')} (${SYM}) <span class="required-star" aria-hidden="true">*</span></label><input class="input" type="number" id="subAmount" min="0" step="0.01" placeholder="0.00" value="${sub?.amount||''}"></div><div class="field"><label class="field-label">${t('sub_freq_label')}</label><select class="select" id="subFreq"><option value="monthly" ${sub?.frequency==='monthly'?'selected':''}>${t('sub_freq_monthly')}</option><option value="annual" ${sub?.frequency==='annual'?'selected':''}>${t('sub_freq_annual')}</option><option value="quarterly" ${sub?.frequency==='quarterly'?'selected':''}>${t('sub_freq_quarterly')}</option><option value="weekly" ${sub?.frequency==='weekly'?'selected':''}>${t('sub_freq_weekly')}</option></select></div></div>
    <div class="field"><label class="field-label">${t('sub_cat_label')}</label><select class="select" id="subCat">${SUB_CATS.map(c=>`<option value="${c}" ${sub?.category===c?'selected':''}>${esc(subCatLabel(c))}</option>`).join('')}</select></div>
    ${allocEnabled?`<div class="field"><label class="field-label">${t('alloc_label')} <span class="required-star" aria-hidden="true">*</span></label><select class="select" id="subAlloc"><option value="">${t('alloc_optional')}</option>${(state.allocation.buckets||[]).map(b=>`<option value="${b.id}"${sub?.allocation===b.id?' selected':''}>${esc(getAllocBucketDisplayName(b))}</option>`).join('')}</select></div>`:''}
    <div class="field"><label class="field-label">${t('sub_date_label')} <span class="required-star" aria-hidden="true">*</span></label>${styledDateField('subDate','subDateWrap',sub?.nextBillingDate||'')}</div>
    ${automateRow(!!findLinkedTemplate('subscription',subId))}
    <div class="tx-error" id="subError" hidden></div>
    <div class="edit-tx-actions"><button class="btn btn-primary" id="saveSubBtn">${isNew?t('sub_add_title'):t('save')}</button><button class="btn btn-ghost btn-sm" id="cancelSubBtn">${t('cancel')}</button>${!isNew?`<button class="btn btn-danger btn-sm" id="deleteSubBtn">${t('delete')}</button>`:''}</div>`;
  document.getElementById('tutorialOverlay').hidden=false;
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
    const auto=document.getElementById('automateToggle')?.checked;
    let sid;
    if(isNew){sid=uid();state.subscriptions.push({id:sid,name,amount,frequency:freq,category:cat,nextBillingDate:date,active:true,allocation:alloc});}
    else{sid=subId;const s=state.subscriptions.find(s=>s.id===subId);if(s){s.name=name;s.amount=amount;s.frequency=freq;s.category=cat;s.nextBillingDate=date;s.allocation=alloc;}}
    if(automationOn()){if(auto)upsertLinkedTemplate('subscription',sid,{type:'subscription',category:cat||'Subscriptions',label:name,amount,frequency:freq,nextDue:date||today(),allocation:alloc});else removeLinkedTemplate('subscription',sid);}
    saveState();closeModal();renderSubscriptions();showToast(t(isNew?'toast_sub_added':'toast_sub_updated'));
  });
  document.getElementById('cancelSubBtn')?.addEventListener('click',closeModal);
  document.getElementById('deleteSubBtn')?.addEventListener('click',async()=>{if(!await confirmDialog({message:t('confirm_remove_sub'),confirmText:t('delete')}))return;removeLinkedTemplate('subscription',subId);state.subscriptions=state.subscriptions.filter(s=>s.id!==subId);saveState();closeModal();renderSubscriptions();});
}

// ── SETTINGS ──────────────────────────────────────────────────────────
function exportCSV(){
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

function renderSettings(){
  const s=state.settings, el=document.getElementById('bview-settings');

  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">⚙️ ${t('tab_settings')}</h2>
      ${helpBtn('settings')}
    </div>

    <div class="settings-grid">
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
            return['week','last_week','month','last_month','last_30','quarter','year'].map(k=>`<button class="btn btn-ghost btn-sm${active===k?' preset-active':''}" data-preset="${k}" type="button">${t({week:'this_week',last_week:'last_week',month:'this_month',last_month:'last_month',last_30:'last_30_days',quarter:'this_quarter',year:'this_year'}[k])}</button>`).join('');
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
      </div></div>
      ${pennySettingsCardHtml()}
      <div class="panel settings-card--automation"><div class="panel-inner">
        <div class="settings-card-title">⚡ ${t('sett_automation_h')}</div>
        <p class="settings-desc">${t('sett_automation_desc')}</p>
        <label class="automate-row" style="margin-top:8px">
          <span class="automate-row-text"><span class="automate-row-title">${t('sett_automation_toggle')}</span><span class="automate-row-hint">${t('sett_automation_hint')}</span></span>
          <span class="recurring-toggle"><input type="checkbox" id="settAutomation" ${automationOn()?'checked':''}><span class="rec-toggle-track"></span></span>
        </label>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🌙 ${t('appearance')}</div>
        <p class="settings-desc">${t('appearance_desc')}</p>
        <div class="theme-setting-row">
          <div class="theme-pill" role="group" aria-label="Colour theme">
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='light'?' is-active':''}" data-theme-val="light" type="button" title="Light mode">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              ${t('light')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='dark'?' is-active':''}" data-theme-val="dark" type="button" title="Dark mode">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ${t('dark')}
            </button>
          </div>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">☁️ Data &amp; Sync</div>
        <p class="settings-desc">Choose how your data is stored and kept up to date across devices.</p>
        <div class="sync-mode-row">
          <button class="sync-mode-opt${(syncGetMode('ubp')||'local')!=='google'?' is-active':''}" data-sync-mode="local" type="button">
            ${(syncGetMode('ubp')||'local')!=='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon">${SYNC_ICON_LOCAL}</span>
            <span class="sync-mode-title">This device only</span>
            <span class="sync-mode-desc">Data is saved on this device only</span>
          </button>
          <button class="sync-mode-opt sync-mode-opt--google${(syncGetMode('ubp')||'local')==='google'?' is-active':''}" data-sync-mode="google" type="button">
            <span class="sync-mode-badge">Recommended</span>
            ${(syncGetMode('ubp')||'local')==='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon sync-mode-icon--google">${SYNC_ICON_GOOGLE}</span>
            <span class="sync-mode-title">Sync with Google</span>
            <span class="sync-mode-desc">Data is synced across multiple devices</span>
          </button>
        </div>
        ${(syncGetMode('ubp')==='google'&&syncGetEmail('ubp'))?`<p class="sync-status-line">Signed in as <strong>${esc(syncGetEmail('ubp'))}</strong></p>`:''}
        <p class="sync-error" id="syncSettError" hidden>Sign-in didn't go through. Please try again.</p>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🌐 ${t('language')}</div>
        <div class="field"><label class="field-label">${t('select_language')}</label>
          <select class="select" id="settLanguage">
            ${Object.entries(TRANSLATIONS).map(([code,tr]) => `<option value="${code}" ${(s.language||'en')===code?'selected':''}>${tr.lang_name}</option>`).join('')}
          </select>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">${t('alloc_sett_title')}</div>
        <p class="settings-desc">${t('alloc_desc')}</p>
        <div class="alloc-sett-toggle">
          <label class="check-label" style="gap:8px;cursor:pointer">
            <input type="checkbox" id="allocEnabled" ${state.allocation?.enabled?'checked':''}>
            <span class="checkmark"></span>
            <span style="font-size:13px;font-weight:600">${t('alloc_enabled_label')}</span>
          </label>
        </div>
        <div id="allocBucketsWrap" ${!state.allocation?.enabled?'style="display:none"':''}>
          <div class="alloc-bucket-list">
          ${(state.allocation?.buckets||[]).map((b,i)=>{const removable=(state.allocation.buckets||[]).length>2;return`<div class="alloc-bucket-row" data-bucket="${i}">
            <button type="button" class="alloc-color-swatch" style="background:${b.color}" data-bi="${i}" title="${t('alloc_color_title')}"></button>
            <input class="input input-sm alloc-name-inp" type="text" value="${esc(b.name)}" data-bi="${i}" placeholder="${t('alloc_name_ph')}">
            <div class="alloc-pct-field"><input class="alloc-pct-inp" type="number" min="0" max="100" step="1" value="${b.pct}" data-bi="${i}"><span class="alloc-pct-sign">%</span></div>
            ${removable?`<button class="alloc-remove-btn" data-bi="${i}" type="button" title="${t('alloc_remove_btn')}" aria-label="${t('alloc_remove_btn')}">\u00d7</button>`:'<span class="alloc-remove-spacer"></span>'}
          </div>`;}).join('')}
          </div>
          <div class="alloc-actions">
            <button class="btn btn-ghost btn-sm" id="allocAddBtn" type="button">${t('alloc_add_bucket')}</button>
            ${(()=>{const sum=(state.allocation?.buckets||[]).reduce((a,b)=>a+(b.pct||0),0);return`<div class="alloc-total ${sum===100?'is-ok':'is-bad'}"><span>${t('alloc_total_label')}</span> <strong>${sum}%</strong>${sum===100?' \u2713':''}</div>`;})()}
          </div>
        </div>
      </div></div>
      <div class="panel settings-card"><div class="panel-inner">
        <div class="settings-card-title">${t('sett_export_title')}</div>
        <p class="settings-desc">${t('sett_export_desc')}</p>
        <button class="btn btn-secondary btn-sm" id="exportCsvBtn" type="button">${t('export_csv_btn')}</button>
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
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeVal));
  });

  el.querySelectorAll('[data-sync-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.syncMode;
      const current = syncGetMode('ubp') || 'local';
      if (target === current) return;
      const errEl = document.getElementById('syncSettError');
      if (errEl) errEl.hidden = true;
      el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = true);
      try {
        if (target === 'google') { saveState(); await syncSwitchToGoogle('ubp'); showToast('Synced with Google Drive ✓'); }
        else { await syncSwitchToLocal('ubp'); showToast('Switched to local storage ✓'); }
        state = loadState() || defaultState(); syncSymbol();
        renderSettings();
      } catch (e) {
        if (errEl) { errEl.textContent = syncFriendlyError(e); errEl.hidden = false; }
        el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = false);
      }
    });
  });

  document.getElementById('settLanguage')?.addEventListener('change', e => {
    state.settings.language = e.target.value;
    saveState();
    applyLanguage();
    switchTab(currentTab);
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
      saveState();
      el.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('preset-active',b===btn));
      showToast(t('toast_period_updated'));
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
    state.settings.periodStart = e.target.value; saveState();
    document.getElementById('settStartDisp').textContent = formatDateDisplay(e.target.value);
  });
  document.getElementById('settEnd')?.addEventListener('change', e => {
    if(e.target.value && state.settings.periodStart && e.target.value < state.settings.periodStart){showToast(t('toast_period_error'));e.target.value=state.settings.periodEnd;document.getElementById('settEndDisp').textContent=formatDateDisplay(state.settings.periodEnd);return;}
    state.settings.periodEnd = e.target.value; saveState();
    document.getElementById('settEndDisp').textContent = formatDateDisplay(e.target.value);
  });

  document.getElementById('settCurrency')?.addEventListener('change', e => {
    const [curr, sym] = e.target.value.split('|');
    state.settings.currency = curr; state.settings.symbol = sym; SYM = sym;
    saveState();
    showToast(t('toast_currency_updated'));
    switchTab(currentTab);
  });

  document.getElementById('settRollover')?.addEventListener('change', e => {
    state.rollover = parseFloat(e.target.value) || 0;
    saveState();
    showToast(t('toast_saved'));
  });

  pennyWireSettingsCard();

  document.getElementById('settAutomation')?.addEventListener('change', e => {
    state.settings.automationEnabled = e.target.checked;
    saveState();
    if (e.target.checked) { const g = processRecurring(); if (g > 0) setTimeout(() => showToast(tf('recurring_generated', g)), 300); else showToast(t('toast_saved')); }
    else showToast(t('toast_saved'));
  });

  document.getElementById('allocEnabled')?.addEventListener('change', e => {
    state.allocation.enabled = e.target.checked;
    saveState();
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
        if (state.allocation.buckets[i]) { state.allocation.buckets[i].color = color; sw.style.background = color; saveState(); }
      });
    });
  });
  el.querySelectorAll('.alloc-pct-inp').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.bi);
      if (state.allocation.buckets[i]) {
        state.allocation.buckets[i].pct = parseFloat(inp.value) || 0;
        saveState();
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
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_tx_auto_h')}</h4>
<p>${t('help_tx_auto_p')}</p>
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_tx_csv_h')}</h4>
<p>${t('help_tx_csv_p1')}</p>
<p>${t('help_tx_csv_p2')}</p>
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<p style="margin-top:10px"><em>${t('help_cal_tip')}</em></p>
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<h4 style="margin:14px 0 6px;font-size:14px">${t('help_sub_chart_h')}</h4>
<p>${t('help_sub_chart_p')}</p>
<p style="margin-top:10px"><em>${t('help_sub_tip')}</em></p>
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
<div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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
function showHelp(k){const h=HELP[k];if(!h)return;document.getElementById('modalTitle').textContent=typeof h.title==='function'?h.title():h.title;document.getElementById('modalBody').innerHTML=typeof h.body==='function'?h.body():h.body;document.getElementById('tutorialOverlay').hidden=false;document.getElementById('modalClose')?.focus();}
function closeModal(){document.getElementById('tutorialOverlay').hidden=true;}

// ── Guide ─────────────────────────────────────────────────────────────
const GUIDE_TOPICS = [
  { id: 'welcome',      group: 'guide_group_start',    icon: '👋', steps: 0, connects: 0, tip: false },
  { id: 'dashboard',    group: 'guide_group_start',    icon: '📊', steps: 3, connects: 3, tip: true  },
  { id: 'transactions', group: 'guide_group_track',    icon: '📋', steps: 4, connects: 3, tip: true  },
  { id: 'budget',       group: 'guide_group_track',    icon: '💰', steps: 4, connects: 3, tip: true  },
  { id: 'debt',         group: 'guide_group_plan',     icon: '💳', steps: 8, connects: 3, tip: true  },
  { id: 'sinking',      group: 'guide_group_plan',     icon: '🏺', steps: 3, connects: 3, tip: true  },
  { id: 'subscriptions',group: 'guide_group_plan',     icon: '🔄', steps: 3, connects: 3, tip: true  },
  { id: 'calendar',     group: 'guide_group_plan',     icon: '📅', steps: 3, connects: 3, tip: true  },
  { id: 'rollover',     group: 'guide_group_smart',    icon: '↩️', steps: 3, connects: 3, tip: true  },
  { id: 'automation',   group: 'guide_group_smart',    icon: '⚡', steps: 3, connects: 3, tip: true  },
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
  content.innerHTML = `
    <button class="guide-back-btn" type="button">← ${esc(t('guide_back'))}</button>
    <div class="guide-topic-header">
      <div class="guide-topic-icon-badge">${topic.icon}</div>
      <h3 class="guide-topic-title">${esc(t('guide_' + id + '_title'))}</h3>
    </div>
    <div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_big'))}</div><p class="guide-big-picture">${t('guide_' + id + '_big')}</p></div>
    ${stepsHtml}${connectsHtml}${tipHtml}`;
  content.querySelector('.guide-back-btn')?.addEventListener('click', () => {
    document.getElementById('guideModal')?.classList.remove('is-topic-open');
  });
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
  headEl.innerHTML=`<h3 class="debt-sched-title">${esc(debt.name)}</h3><div class="debt-sched-summary">${parts.map(esc).join(' • ')}</div>`;
  const neverPaidOff=debt.paidOffMonth===null&&schedule.length>=600;
  const warningHtml=neverPaidOff?`<div class="debt-sched-warning"><span aria-hidden="true">⚠️</span><span>${t('dsched_never_payoff_warning')}</span></div>`:'';
  const tableHtml=`<table class="module-table debt-sched-table"><thead><tr>
    <th>${t('dsched_col_date')}</th><th>${t('dsched_col_payment')}</th><th>${t('dsched_col_principal')}</th><th>${t('dsched_col_interest')}</th>
    ${hasEscrow?`<th>${t('dsched_col_escrow')}</th>`:''}<th>${t('dsched_col_balance')}</th>
  </tr></thead><tbody>
    ${schedule.map(row=>`<tr class="module-row">
      <td>${formatDateDisplay(row.date)}</td><td>${fmt(row.payment)}</td><td class="col-principal">${fmt(row.principal)}</td><td class="col-interest">${fmt(row.interest)}</td>
      ${hasEscrow?`<td>${row.escrow!==undefined?fmt(row.escrow):'-'}</td>`:''}<td class="col-balance">${fmt(row.balance)}</td>
    </tr>`).join('')}
  </tbody></table>`;
  bodyEl.innerHTML=warningHtml+tableHtml;
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

function showToast(msg){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t);}t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2800);}

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
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmText || (alertOnly ? 'OK' : t('save')))}</button>
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

// ── Editable planner title ────────────────────────────────────────────
function applyAppTitle(){ const el=document.getElementById('appTitleText'); if(el&&state?.settings?.appTitle) el.textContent=state.settings.appTitle; }
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

// ── Custom themed date picker (replaces native calendar popup) ────────
function openDatePicker(input, anchor){
  if(!input) return;
  const existing=document.getElementById('fkDatePop');
  const wasFor=existing&&existing._for;
  if(existing) existing.remove();
  if(wasFor===input) return; // toggle off if re-clicking same field
  const lang=(typeof state!=='undefined'&&state?.settings?.language)||'en';
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
function fkAddStepper(inp){
  if(inp.dataset.stepper) return; inp.dataset.stepper='1';
  const wrap=document.createElement('span'); wrap.className='num-field';
  inp.parentNode.insertBefore(wrap,inp); wrap.appendChild(inp);
  const st=document.createElement('span'); st.className='num-steppers';
  st.innerHTML='<button type="button" class="num-step" data-d="1" tabindex="-1">\u25B2</button><button type="button" class="num-step" data-d="-1" tabindex="-1">\u25BC</button>';
  wrap.appendChild(st);
  st.querySelectorAll('.num-step').forEach(b=>b.addEventListener('click',()=>{
    const step=parseFloat(inp.step)||1, cur=parseFloat(inp.value)||0, dir=+b.dataset.d, mn=parseFloat(inp.min), mx=parseFloat(inp.max);
    let n=cur+dir*step; if(!isNaN(mn)&&n<mn)n=mn; if(!isNaN(mx)&&n>mx)n=mx; n=Math.round(n*100)/100;
    inp.value=n; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true}));
  }));
}
function fkScanSteppers(root){ root&&root.querySelectorAll&&root.querySelectorAll('input.input[type="number"]:not([data-stepper])').forEach(fkAddStepper); }
function fkInitUIEnhancers(){
  fkScanSteppers(document);
  new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.matches&&n.matches('input.input[type="number"]'))fkAddStepper(n);fkScanSteppers(n);}}).observe(document.body,{childList:true,subtree:true});
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
    state.budgets=JSON.parse(JSON.stringify({income:sbp.budgets.income||[],expenses:sbp.budgets.expenses||[],bills:sbp.budgets.bills||[],savings:sbp.budgets.savings||[]}));
    state.transactions=[...sbp.transactions];
    if(sbp.budgets.debt?.length>0)state.debts=sbp.budgets.debt.map(d=>({id:uid(),name:d.category,type:'other',balance:0,interestRate:5,minimumPayment:d.expected||0,dueDay:d.dueDate?parseInt(d.dueDate.split('-')[2])||'':''}));
    SYM=state.settings.symbol;saveState();banner.remove();
    const cs=document.getElementById('currencySelect');if(cs)cs.value=`${state.settings.currency}|${state.settings.symbol}`;
    showToast(tf('toast_imported',txCount));switchTab('dashboard');
  });
  document.getElementById('dismissImportBtn')?.addEventListener('click',()=>banner.remove());
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
  saveState(); // ensures localStorage always mirrors state, so Google sync has real data to seed a Drive file with right away

  // A failure anywhere in this optional setup must never leave the whole
  // page blank - log it loudly (visible as a red error in DevTools) and
  // still fall through to rendering the dashboard below.
  try {
    // Generate any due recurring transactions for the current period
    const recGen=processRecurring();

    const now=new Date();calYear=now.getFullYear();calMonth=now.getMonth();
    initTheme();
    applyLanguage();

    // Offer to import Simple Budget data only when this tool is empty
    if(!isTrial()&&state.transactions.length===0&&state.debts.length===0&&state.sinkingFunds.length===0)checkSBPImport();

    // Notify if recurring transactions were auto-created
    if(recGen>0)setTimeout(()=>showToast(tf('recurring_generated',recGen)),600);

    // Classic top tabs
    document.getElementById('ubpTabs')?.querySelectorAll('.btab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));
    enableDragScroll(document.getElementById('ubpTabs'));

    // Command nav items
    document.getElementById('heroHeader')?.querySelectorAll('.cnav-btn[data-btab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.btab)));

    // Back to hub
    document.getElementById('backToHub')?.addEventListener('click',()=>{window.location.href='index.html';});

    // Settings gear
    document.getElementById('settingsNavBtn')?.addEventListener('click',()=>switchTab('settings'));

    // Guide
    document.getElementById('guideNavBtn')?.addEventListener('click',()=>openGuide());
    document.getElementById('guideClose')?.addEventListener('click',closeGuide);
    document.getElementById('guideOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeGuide();});
    document.getElementById('debtSchedClose')?.addEventListener('click',closeDebtSchedule);
    document.getElementById('debtSchedOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeDebtSchedule();});

    // Penny (AI assistant) - failure here must never block the rest of init
    try { await pennyInit(); } catch (e) { console.error('[init] Penny setup failed:', e); }

    // Modal
    document.getElementById('modalClose')?.addEventListener('click',closeModal);
    document.getElementById('tutorialOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

    applyLayout(state.settings?.layout||'classic');
  } catch (e) {
    console.error('[init] error during startup setup (rendering the dashboard anyway):', e);
  }

  try { switchTab('dashboard'); }
  catch (e) { console.error('[init] switchTab(dashboard) failed - this is why the page can appear blank:', e); }

  try { fkInitUIEnhancers(); applyAppTitle(); bindAppTitle('Ultimate Budget'); }
  catch (e) { console.error('[init] post-render setup failed:', e); }
}
document.addEventListener('DOMContentLoaded',init);

// ── Keyboard Navigation (UBP) ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.activeElement;
  if (!active) return;

  // Transaction form
  if (active.id === 'txAmount' || active.id === 'txDesc') {
    e.preventDefault(); document.getElementById('addTxBtn')?.click(); return;
  }

  // Add-category inline form
  if (active.id && active.id.startsWith('newCatName-')) {
    e.preventDefault();
    const type = active.id.replace('newCatName-', '');
    document.getElementById('saveCatBtn-' + type)?.click();
    return;
  }

  // Subscription name / amount in modal
  if (active.id === 'subName' || active.id === 'subAmount') {
    e.preventDefault(); document.getElementById('saveSubBtn')?.click(); return;
  }

  // Sinking fund modal
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
