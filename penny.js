'use strict';
/* =====================================================================
   penny.js - Penny, the Ultimate Budget Planner's AI assistant

   Bring-your-own-key: the user pastes their own free Gemini API key and
   every request goes straight from their browser to Google - there is
   no Evo Budget backend to route through (this app doesn't have one).
   The key is encrypted at rest with a non-extractable AES-GCM CryptoKey
   stored in IndexedDB (never localStorage, never in `state`, so it can
   never leave the device via sync.js's Google Drive sync either).

   Penny can only ever READ budgeting data - every function Gemini is
   allowed to call is a pure getter (see pennyExecuteTool's switch),
   nothing here can call saveState() or mutate `state`.
   ===================================================================== */

const PENNY_MODEL = 'gemini-2.5-flash';
// NOTE: v1beta is deprecated for generateContent/streamGenerateContent on
// production API keys as of mid-2026 (returns 404 even for valid, current
// models like gemini-2.5-flash) - v1 is the correct stable endpoint now.
const PENNY_API_BASE = 'https://generativelanguage.googleapis.com/v1';
const PENNY_DB_NAME = 'EvoBudgetPennyVault';
const PENNY_DB_VERSION = 1;
const PENNY_STORE = 'secrets';
const PENNY_USAGE_KEY = 'evobudget_penny_usage_v1';
const PENNY_VOICE_KEY = 'evobudget_penny_voice_on';

const PENNY_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L18.7 9l-4.9 1.8L12 15.7l-1.8-4.9L5.3 9l4.9-1.8L12 3z"/><path d="M19 15l.9 2.4L22.3 18l-2.4.9L19 21.3l-.9-2.4L15.7 18l2.4-.9L19 15z"/></svg>`;
const PENNY_SPEAKER_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ══════════════════════════════════════════════════════════════════════
//  Encrypted key vault (IndexedDB + Web Crypto AES-GCM)
// ══════════════════════════════════════════════════════════════════════
let _pennyDbPromise = null;
function pennyDbOpen() {
  if (_pennyDbPromise) return _pennyDbPromise;
  _pennyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PENNY_DB_NAME, PENNY_DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(PENNY_STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _pennyDbPromise;
}
function pennyDbGet(id) {
  return pennyDbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(PENNY_STORE, 'readonly').objectStore(PENNY_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}
function pennyDbPut(record) {
  return pennyDbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(PENNY_STORE, 'readwrite');
    tx.objectStore(PENNY_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function pennyDbDelete(id) {
  return pennyDbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(PENNY_STORE, 'readwrite');
    tx.objectStore(PENNY_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

let _pennyCryptoKeyCache = null;
async function pennyEnsureCryptoKey() {
  if (_pennyCryptoKeyCache) return _pennyCryptoKeyCache;
  const rec = await pennyDbGet('cryptoKey');
  if (rec && rec.key) { _pennyCryptoKeyCache = rec.key; return rec.key; }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await pennyDbPut({ id: 'cryptoKey', key });
  _pennyCryptoKeyCache = key;
  return key;
}
async function pennyEncryptText(plain) {
  const key = await pennyEnsureCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { iv, ciphertext };
}
async function pennyDecryptText(iv, ciphertext) {
  const key = await pennyEnsureCryptoKey();
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
}

let _pennyHasKeyCache = false;
async function pennySaveApiKey(plainKey) {
  const { iv, ciphertext } = await pennyEncryptText(plainKey);
  await pennyDbPut({ id: 'apiKey', iv, ciphertext, savedAt: new Date().toISOString() });
  _pennyHasKeyCache = true;
}
async function pennyLoadApiKeyPlain() {
  const rec = await pennyDbGet('apiKey');
  if (!rec) return null;
  try { return await pennyDecryptText(rec.iv, rec.ciphertext); }
  catch (e) { console.error('[penny] failed to decrypt saved key:', e); return null; }
}
async function pennyHasApiKey() {
  const rec = await pennyDbGet('apiKey');
  return !!rec;
}
async function pennyRemoveApiKey() {
  await pennyDbDelete('apiKey');
  _pennyHasKeyCache = false;
}

// ══════════════════════════════════════════════════════════════════════
//  Local usage counter (honest labeling - NOT real Google-side quota;
//  the Gemini REST API has no queryable "remaining quota" endpoint for
//  a bare API key, so this is a personal, on-device counter only)
// ══════════════════════════════════════════════════════════════════════
function pennyCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function pennyGetUsage() {
  let rec;
  try { rec = JSON.parse(localStorage.getItem(PENNY_USAGE_KEY) || 'null'); } catch { rec = null; }
  const mk = pennyCurrentMonthKey();
  if (!rec || rec.monthKey !== mk) {
    rec = { monthKey: mk, count: 0 };
    localStorage.setItem(PENNY_USAGE_KEY, JSON.stringify(rec));
  }
  return rec;
}
function pennyIncrementUsage() {
  const rec = pennyGetUsage();
  rec.count += 1;
  localStorage.setItem(PENNY_USAGE_KEY, JSON.stringify(rec));
  return rec.count;
}
function pennyUsageLabel() { return tf('sett_penny_usage_count', pennyGetUsage().count); }

// ══════════════════════════════════════════════════════════════════════
//  Nav icon + Settings orchestration
// ══════════════════════════════════════════════════════════════════════
async function pennyInit() {
  _pennyHasKeyCache = await pennyHasApiKey().catch(() => false);
  document.getElementById('pennyNavBtn')?.addEventListener('click', pennyHandleNavClick);
  pennyRefreshNavIcon();
}
function pennyIsActive() { return !!(state?.settings?.pennyEnabled && _pennyHasKeyCache); }

function pennyRefreshNavIcon() {
  const btn = document.getElementById('pennyNavBtn');
  if (!btn) return;
  const active = pennyIsActive();
  btn.classList.toggle('penny-on', active);
  btn.classList.toggle('penny-off', !active);
  btn.setAttribute('aria-label', active ? t('penny_nav_aria_on') : t('penny_nav_aria_off'));
  const label = document.getElementById('pennyNavPillText');
  if (label) label.textContent = active ? t('penny_nav_pill_on') : t('penny_nav_pill_off');
}
function pennyHandleNavClick() {
  if (!pennyIsActive()) {
    switchTab('settings');
    setTimeout(() => document.querySelector('.penny-settings-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    return;
  }
  pennyOpenChat();
}

function pennySettingsCardHtml() {
  const on = !!state.settings.pennyEnabled;
  return `<div class="panel penny-settings-panel"><div class="panel-inner">
    <div class="settings-card-title">✨ ${t('sett_penny_h')}</div>
    <p class="settings-desc">${t('sett_penny_desc')}</p>
    <label class="automate-row" style="margin-top:8px">
      <span class="automate-row-text"><span class="automate-row-title">${t('sett_penny_toggle')}</span><span class="automate-row-hint">${t('sett_penny_hint')}</span></span>
      <span class="recurring-toggle"><input type="checkbox" id="settPennyEnabled" ${on ? 'checked' : ''}><span class="rec-toggle-track"></span></span>
    </label>
    ${on ? pennyKeySectionHtml() : ''}
  </div></div>`;
}
function pennyKeySectionHtml() {
  if (_pennyHasKeyCache) {
    return `<div class="penny-key-active">
      <div class="penny-key-row">
        <span class="penny-key-icon">🔒</span>
        <span class="penny-key-masked">${t('sett_penny_key_saved')}</span>
        <button class="link-btn penny-key-remove" id="settPennyKeyRemove" type="button">${t('sett_penny_remove')}</button>
      </div>
      <p class="penny-usage-line">${pennyUsageLabel()}</p>
      <p class="penny-active-subtitle">✅ ${t('sett_penny_available')}</p>
    </div>`;
  }
  return `<div class="penny-key-setup">
    <label class="field-label" for="settPennyKeyInput">${t('sett_penny_key_label')}</label>
    <input class="input" type="password" id="settPennyKeyInput" autocomplete="off" spellcheck="false" placeholder="${esc(t('sett_penny_key_placeholder'))}">
    <div class="penny-key-actions">
      <button class="link-btn" id="settPennyHowtoBtn" type="button">${t('sett_penny_howto')}</button>
      <button class="btn btn-primary btn-sm" id="settPennyKeySave" type="button">${t('sett_penny_save_btn')}</button>
    </div>
    <p class="penny-key-error" id="settPennyKeyError" hidden></p>
  </div>`;
}
function pennyWireSettingsCard() {
  document.getElementById('settPennyEnabled')?.addEventListener('change', e => {
    state.settings.pennyEnabled = e.target.checked;
    saveState();
    if (!e.target.checked) { pennyStopSpeaking(); pennyCloseChat(); pennyResetChatState(); }
    renderSettings();
    pennyRefreshNavIcon();
    showToast(t('toast_saved'));
  });
  document.getElementById('settPennyHowtoBtn')?.addEventListener('click', () => showHelp('penny_api_key'));
  document.getElementById('settPennyKeySave')?.addEventListener('click', async () => {
    const input = document.getElementById('settPennyKeyInput');
    const errEl = document.getElementById('settPennyKeyError');
    const val = (input?.value || '').trim();
    if (val.length < 20 || /\s/.test(val)) {
      if (errEl) { errEl.textContent = t('sett_penny_key_error_short'); errEl.hidden = false; }
      return;
    }
    await pennySaveApiKey(val);
    if (input) input.value = '';
    renderSettings();
    pennyRefreshNavIcon();
    showToast(t('toast_penny_key_saved'));
  });
  document.getElementById('settPennyKeyRemove')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ message: t('confirm_penny_remove_key'), confirmText: t('sett_penny_remove') });
    if (!ok) return;
    await pennyRemoveApiKey();
    pennyStopSpeaking();
    pennyCloseChat();
    pennyResetChatState();
    renderSettings();
    pennyRefreshNavIcon();
    showToast(t('toast_saved'));
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Gemini function-calling tools (all pure, read-only getters on `state`)
// ══════════════════════════════════════════════════════════════════════
function pennyBuildSystemInstruction() {
  return { parts: [{ text:
    "You are Penny, a friendly budgeting assistant built into the Ultimate Budget Planner app. " +
    "You ONLY answer questions about the user's own budgeting data (income, expenses, bills, savings, debts, subscriptions, sinking funds, transactions, overall budget health) using the tools provided. " +
    "You must call one of the provided functions to fetch real data before stating any dollar amount, percentage, or count - never invent or estimate numbers yourself. " +
    "If asked about anything unrelated to the user's own budget in this app (general knowledge, other people's finances, coding help, current events, etc.), politely decline and redirect to a budgeting question. " +
    "Keep every answer under about 60 words unless the user explicitly asks for more detail. " +
    "Use the currency symbol returned by the tools, not your own assumption. " +
    "If a tool returns no data, say so plainly rather than guessing. " +
    "You may call render_chart to visualize a breakdown, but only after already retrieving the underlying data via another tool in the same turn."
  }] };
}
function pennyToolDeclarations() {
  return [{
    functionDeclarations: [
      { name: 'get_budget_summary', description: "Returns the user's total income, spending, savings, and leftover amount for a period.",
        parameters: { type: 'OBJECT', properties: { period: { type: 'STRING', enum: ['current', 'previous'], description: 'Which period to summarize.' } }, required: ['period'] } },
      { name: 'get_transactions', description: "Returns a list of the user's recent transactions, optionally filtered.",
        parameters: { type: 'OBJECT', properties: {
          type: { type: 'STRING', enum: ['income', 'expense', 'bill', 'savings', 'debt', 'subscription', 'sinking_fund'], description: 'Filter by transaction type.' },
          category: { type: 'STRING', description: 'Filter by category name.' },
          startDate: { type: 'STRING', description: 'YYYY-MM-DD, inclusive start date filter.' },
          endDate: { type: 'STRING', description: 'YYYY-MM-DD, inclusive end date filter.' },
          limit: { type: 'NUMBER', description: 'Max rows to return (default and max 25).' },
        } } },
      { name: 'get_category_breakdown', description: 'Returns actual vs. expected amounts per category for one budget section for the current period, sorted by actual amount descending.',
        parameters: { type: 'OBJECT', properties: { section: { type: 'STRING', enum: ['income', 'expenses', 'bills', 'savings'] } }, required: ['section'] } },
      { name: 'get_debts', description: "Returns the user's current debts (balance, APR, minimum payment) and an estimated payoff timeline using their chosen strategy.",
        parameters: { type: 'OBJECT', properties: {} } },
      { name: 'get_subscriptions', description: "Returns the user's active subscriptions and monthly/annual totals.",
        parameters: { type: 'OBJECT', properties: {} } },
      { name: 'get_sinking_funds', description: "Returns the user's sinking funds with progress toward each target.",
        parameters: { type: 'OBJECT', properties: {} } },
      { name: 'render_chart', description: 'Displays a chart of previously-fetched data in the chat. Only call after a data-retrieval function in this same turn; pass back its dataRef.',
        parameters: { type: 'OBJECT', properties: {
          chartType: { type: 'STRING', enum: ['category_donut', 'cash_flow'] },
          dataRef: { type: 'STRING', description: 'The dataRef id from the data function result to visualize.' },
        }, required: ['chartType', 'dataRef'] } },
    ],
  }];
}

function pennyToolGetBudgetSummary(args) {
  const s = state.settings;
  if (args?.period === 'previous') {
    const prev = computePrevSummary();
    if (!prev) return { dataRef: 'sum_previous_empty', period: 'previous', note: 'No data logged for the previous period.' };
    return { dataRef: 'sum_previous', period: 'previous', currency: s.currency, symbol: s.symbol,
      totalIncome: round2(prev.totalIncome), totalOut: round2(prev.totalOut), totalSavings: round2(prev.totalSavings),
      leftover: round2(prev.leftover), savingsRate: prev.savingsRate };
  }
  const act = computeActuals(), sum = computeSummary(act);
  return { dataRef: `sum_${s.periodStart}_${s.periodEnd}`, period: 'current', periodStart: s.periodStart, periodEnd: s.periodEnd,
    currency: s.currency, symbol: s.symbol, totalIncome: round2(sum.totalIncome), totalOut: round2(sum.totalOut),
    totalSavings: round2(sum.totalSavings), leftover: round2(sum.leftover), savingsRate: sum.savingsRate };
}
function pennyToolGetTransactions(args) {
  const limit = Math.min(25, Math.max(1, parseInt(args?.limit) || 25));
  let list = state.transactions.slice();
  if (args?.type) list = list.filter(tx => tx.type === args.type);
  if (args?.category) list = list.filter(tx => (tx.category || '').toLowerCase() === String(args.category).toLowerCase());
  if (args?.startDate) list = list.filter(tx => tx.date >= args.startDate);
  if (args?.endDate) list = list.filter(tx => tx.date <= args.endDate);
  list.sort((a, b) => b.date.localeCompare(a.date));
  list = list.slice(0, limit);
  return { dataRef: 'tx_' + uid(), currency: state.settings.currency, symbol: state.settings.symbol,
    count: list.length, transactions: list.map(tx => ({ date: tx.date, type: tx.type, category: tx.category, amount: round2(tx.amount), description: tx.description || '' })) };
}
function pennyToolGetCategoryBreakdown(args) {
  const section = ['income', 'expenses', 'bills', 'savings'].includes(args?.section) ? args.section : 'expenses';
  const act = computeActuals();
  const rows = (state.budgets[section] || []).map(r => ({ category: r.category, expected: round2(r.expected || 0), actual: round2(act[section][r.category] || 0) }));
  rows.sort((a, b) => b.actual - a.actual);
  const total = rows.reduce((s, r) => s + r.actual, 0);
  return { dataRef: 'cat_' + section + '_' + state.settings.periodStart, section, currency: state.settings.currency, symbol: state.settings.symbol,
    items: rows.map(r => ({ ...r, pct: total > 0 ? round2(r.actual / total * 100) : 0 })) };
}
function pennyToolGetDebts() {
  const s = state.settings;
  if (!state.debts.length) return { dataRef: 'debts_empty', currency: s.currency, symbol: s.symbol, debts: [], note: 'No debts added yet.' };
  const payoff = runDebtPayoff();
  const order = payoff ? payoff.payoffOrder : [];
  return { dataRef: 'debts_snapshot', currency: s.currency, symbol: s.symbol, strategy: state.debtSettings.method, extraPayment: round2(state.debtSettings.extraPayment || 0),
    debtFreeDate: payoff ? payoff.debtFreeDate : null, totalInterest: payoff ? round2(payoff.totalInterest) : 0,
    debts: state.debts.map(d => {
      const p = order.find(x => x.id === d.id);
      return { name: d.name, type: d.type, balance: round2(d.balance), interestRate: d.interestRate, minimumPayment: round2(d.minimumPayment), paidOffDate: p ? p.paidOffDate : null };
    }) };
}
function pennyToolGetSubscriptions() {
  const s = state.settings;
  const active = state.subscriptions.filter(x => x.active !== false);
  return { dataRef: 'subs_snapshot', currency: s.currency, symbol: s.symbol,
    monthlyTotal: round2(totalSubMonthly()), annualTotal: round2(state.subscriptions.reduce((t, x) => x.active !== false ? t + annualSubAmt(x) : t, 0)),
    subscriptions: active.map(x => ({ name: x.name, amount: round2(x.amount), frequency: x.frequency, category: x.category, monthlyEquivalent: round2(monthlySubAmt(x)) })) };
}
function pennyToolGetSinkingFunds() {
  const s = state.settings;
  return { dataRef: 'funds_snapshot', currency: s.currency, symbol: s.symbol,
    funds: state.sinkingFunds.map(f => { const c = calcFund(f); return { name: f.name, targetAmount: round2(f.targetAmount || 0), currentSaved: round2(f.currentSaved || 0), pctComplete: round2(c.pctComplete), monthsLeft: c.monthsLeft, requiredMonthly: round2(c.requiredMonthly) }; }) };
}

let _pennyDataCache = new Map();
function pennyCacheResult(result) { _pennyDataCache.set(result.dataRef, result); return result; }
function pennyToolRenderChart(args, bubbleEl) {
  const cached = _pennyDataCache.get(args?.dataRef);
  if (!cached) return { ok: false, error: 'unknown_data_ref' };
  pennyRenderChartInMessage(args.chartType, cached, bubbleEl);
  return { ok: true };
}

// The single, exhaustive bridge from a Gemini response into app code.
// Every branch is a pure getter (or a render-only call for render_chart) -
// nothing here can call saveState() or mutate `state`.
function pennyExecuteTool(name, args, ctx) {
  try {
    switch (name) {
      case 'get_budget_summary':     return pennyCacheResult(pennyToolGetBudgetSummary(args || {}));
      case 'get_transactions':       return pennyCacheResult(pennyToolGetTransactions(args || {}));
      case 'get_category_breakdown': return pennyCacheResult(pennyToolGetCategoryBreakdown(args || {}));
      case 'get_debts':              return pennyCacheResult(pennyToolGetDebts());
      case 'get_subscriptions':      return pennyCacheResult(pennyToolGetSubscriptions());
      case 'get_sinking_funds':      return pennyCacheResult(pennyToolGetSinkingFunds());
      case 'render_chart':           return pennyToolRenderChart(args || {}, ctx && ctx.bubbleEl);
      default:                       return { error: 'unknown_tool' };
    }
  } catch (e) {
    console.error('[penny] tool execution failed:', name, e);
    return { error: 'internal_error' };
  }
}

function pennyRenderChartInMessage(chartType, dataResult, bubbleEl) {
  if (!bubbleEl) return;
  let html = '';
  if (chartType === 'category_donut' && dataResult.items) {
    const total = dataResult.items.reduce((t, i) => t + (i.actual || 0), 0);
    const segs = dataResult.items.filter(i => i.actual > 0).map((i, idx) => ({ label: i.category, value: i.actual, pct: total > 0 ? i.actual / total * 100 : 0, color: COLORS[idx % COLORS.length] }));
    html = `<div class="penny-chart-block"><div class="donut-block">${svgDonut(segs, 96, 13)}<div class="donut-legend">${segs.slice(0, 5).map(s => `<div class="dleg-row"><span class="dleg-swatch" style="background:${s.color}"></span><span class="dleg-label">${esc(s.label)}</span><span class="dleg-pct">${s.pct.toFixed(0)}%</span></div>`).join('')}</div></div></div>`;
  } else if (chartType === 'cash_flow' && dataResult.totalIncome != null) {
    const rows = [
      { label: t('bud_section_income'), val: dataResult.totalIncome, color: '#10b981' },
      { label: t('dash_total_outgoing'), val: dataResult.totalOut, color: '#f43f5e' },
      { label: t('bud_section_savings'), val: dataResult.totalSavings, color: '#3b82f6' },
    ];
    const max = Math.max(...rows.map(r => r.val), 1);
    html = `<div class="penny-chart-block"><div class="flow-table">${rows.map(r => `<div class="flow-row"><span class="flow-label">${esc(r.label)}</span><div class="flow-bar-wrap" style="flex:1"><div class="flow-bar" style="width:${(r.val / max * 100).toFixed(1)}%;background:${r.color}"></div></div><div class="flow-amt" style="color:${r.color};font-weight:700">${fmt(r.val)}</div></div>`).join('')}</div></div>`;
  } else {
    return;
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;
  bubbleEl.appendChild(holder.firstElementChild);
  requestAnimationFrame(() => initDonuts(bubbleEl));
}

// ══════════════════════════════════════════════════════════════════════
//  Gemini streaming request + multi-turn function-calling round trip
// ══════════════════════════════════════════════════════════════════════
async function pennyStreamGenerateContent(requestBody, onEvent) {
  const key = await pennyLoadApiKeyPlain();
  if (!key) throw new Error('penny_no_key');
  const url = `${PENNY_API_BASE}/models/${PENNY_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  } catch (e) {
    const err = new Error('penny_network'); err.cause = e; throw err;
  }
  if (!resp.ok) {
    let bodyJson = null;
    try { bodyJson = await resp.json(); } catch {}
    const err = new Error('penny_http_error'); err.status = resp.status; err.body = bodyJson; throw err;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      try { onEvent(JSON.parse(jsonStr)); }
      catch (e) { console.warn('[penny] failed to parse an SSE frame, skipping:', e); }
    }
  }
}
function pennyClassifyHttpError(err) {
  if (err.message === 'penny_network') return 'network';
  if (err.message === 'penny_no_key') return 'invalid_key';
  if (err.message === 'penny_http_error') {
    const status = err.status;
    const gstatus = err.body?.error?.status;
    if (status === 429) return 'rate_limited';
    if (status === 400 || status === 403 || gstatus === 'INVALID_ARGUMENT' || gstatus === 'PERMISSION_DENIED' || gstatus === 'UNAUTHENTICATED') return 'invalid_key';
    return 'unknown';
  }
  return 'unknown';
}

let _pennyContents = [];
let _pennyTurnInFlight = false;
async function pennySendMessage(userText) {
  if (_pennyTurnInFlight) return;
  if (!pennyIsActive()) { pennyRenderChatError('no_key'); return; }
  const text = (userText || '').trim();
  if (!text) return;
  _pennyTurnInFlight = true;
  pennyAppendMessage('user', text);
  pennySetInputEnabled(false);
  pennyShowTyping();
  _pennyContents.push({ role: 'user', parts: [{ text }] });

  let bubbleEl = null, accumulatedText = '', finishReason = null;
  try {
    let guard = 0;
    while (guard++ < 4) {
      let sawFunctionCall = false;
      const callsThisLeg = [];
      await pennyStreamGenerateContent({
        system_instruction: pennyBuildSystemInstruction(),
        tools: pennyToolDeclarations(),
        generationConfig: { maxOutputTokens: 400, temperature: 0.3 },
        contents: _pennyContents,
      }, chunk => {
        const cand = chunk.candidates && chunk.candidates[0];
        if (!cand) return;
        finishReason = cand.finishReason || finishReason;
        const parts = cand.content?.parts || [];
        for (const part of parts) {
          if (part.functionCall) {
            callsThisLeg.push(part.functionCall);
            sawFunctionCall = true;
          } else if (part.text) {
            if (!bubbleEl) { pennyHideTyping(); bubbleEl = pennyAppendMessage('penny', ''); }
            accumulatedText += part.text;
            const textEl = bubbleEl.querySelector('.penny-msg-text');
            if (textEl) textEl.textContent = accumulatedText;
            const list = document.getElementById('pennyMessages');
            if (list) list.scrollTop = list.scrollHeight;
          }
        }
      });

      if (sawFunctionCall) {
        _pennyContents.push({ role: 'model', parts: callsThisLeg.map(fc => ({ functionCall: fc })) });
        // render_chart needs somewhere to render into, but it can resolve
        // before any text has streamed in this turn - ensure the answer
        // bubble already exists so the chart isn't silently dropped.
        if (callsThisLeg.some(fc => fc.name === 'render_chart') && !bubbleEl) {
          pennyHideTyping();
          bubbleEl = pennyAppendMessage('penny', '');
        }
        const responses = callsThisLeg.map(fc => ({ functionResponse: { name: fc.name, response: pennyExecuteTool(fc.name, fc.args, { bubbleEl }) } }));
        _pennyContents.push({ role: 'user', parts: responses });
        continue;
      }
      break;
    }

    pennyHideTyping();
    if (!bubbleEl || !accumulatedText.trim()) {
      pennyRenderChatError('blocked');
    } else {
      _pennyContents.push({ role: 'model', parts: [{ text: accumulatedText }] });
      pennySpeak(accumulatedText);
      pennyIncrementUsage();
    }
  } catch (e) {
    pennyHideTyping();
    pennyRenderChatError(pennyClassifyHttpError(e), text);
    console.error('[penny] turn failed:', e);
  } finally {
    _pennyTurnInFlight = false;
    pennySetInputEnabled(true);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Voice (browser Web Speech API only - no paid TTS call)
// ══════════════════════════════════════════════════════════════════════
function pennySpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}
let _pennyVoiceCache = null;
function pennyPickFemaleVoice() {
  if (_pennyVoiceCache) return _pennyVoiceCache;
  if (!pennySpeechSupported()) return null;
  const voices = speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  const localePrefix = { en: 'en', de: 'de', fr: 'fr', es: 'es', it: 'it', pl: 'pl' }[state?.settings?.language] || 'en';
  const femaleNamePattern = /female|zira|samantha|victoria|susan|karen|moira|tessa|allison|ava|serena|kyoko|amelie|anna|paulina|zosia/i;
  const scored = voices.map(v => {
    let score = 0;
    if (v.lang && v.lang.toLowerCase().startsWith(localePrefix)) score += 2;
    if (femaleNamePattern.test(v.name)) score += 3;
    return { v, score };
  }).sort((a, b) => b.score - a.score);
  _pennyVoiceCache = scored[0]?.v || voices[0] || null;
  return _pennyVoiceCache;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', () => { _pennyVoiceCache = null; });
}
function pennyVoiceEnabled() {
  const v = localStorage.getItem(PENNY_VOICE_KEY);
  return v === null ? true : v === '1';
}
function pennyToggleVoice() {
  const next = !pennyVoiceEnabled();
  localStorage.setItem(PENNY_VOICE_KEY, next ? '1' : '0');
  if (!next) pennyStopSpeaking();
  return next;
}
function pennySpeak(text) {
  if (!pennySpeechSupported() || !pennyVoiceEnabled() || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pennyPickFemaleVoice();
    if (voice) u.voice = voice;
    u.rate = 1.02; u.pitch = 1.05;
    speechSynthesis.speak(u);
  } catch (e) { console.warn('[penny] speech synthesis failed:', e); }
}
function pennyStopSpeaking() {
  if (pennySpeechSupported()) { try { speechSynthesis.cancel(); } catch {} }
}

// ══════════════════════════════════════════════════════════════════════
//  Chat drawer DOM
// ══════════════════════════════════════════════════════════════════════
let _pennyDrawerBuilt = false;
function pennyOpenChat() {
  if (!pennyIsActive()) { pennyHandleNavClick(); return; }
  if (!_pennyDrawerBuilt) pennyBuildDrawer();
  document.getElementById('pennyDrawer')?.classList.add('is-open');
  document.body.classList.add('penny-drawer-open');
  const messages = document.getElementById('pennyMessages');
  if (messages && !messages.children.length) pennyRenderQuickActions();
  setTimeout(() => document.getElementById('pennyInput')?.focus(), 200);
}
function pennyCloseChat() {
  document.getElementById('pennyDrawer')?.classList.remove('is-open');
  document.body.classList.remove('penny-drawer-open');
  pennyStopSpeaking();
}
function pennyResetChatState() {
  _pennyContents = [];
  _pennyDataCache = new Map();
  const list = document.getElementById('pennyMessages');
  if (list) list.innerHTML = '';
  const qa = document.getElementById('pennyQuickActions');
  if (qa) qa.innerHTML = '';
}

function pennyBuildDrawer() {
  const wrap = document.createElement('div');
  wrap.id = 'pennyDrawer';
  wrap.className = 'penny-drawer';
  const voiceBtn = pennySpeechSupported()
    ? `<button class="penny-icon-btn${pennyVoiceEnabled() ? '' : ' is-muted'}" id="pennyVoiceToggleBtn" type="button" aria-label="${esc(pennyVoiceEnabled() ? t('penny_voice_on') : t('penny_voice_off'))}">${PENNY_SPEAKER_ICON_SVG}</button>`
    : '';
  wrap.innerHTML = `
    <div class="penny-drawer-scrim" id="pennyDrawerScrim"></div>
    <div class="penny-drawer-panel" role="dialog" aria-modal="true" aria-label="${esc(t('penny_chat_title'))}">
      <div class="penny-drawer-header">
        <span class="penny-avatar">${PENNY_ICON_SVG}</span>
        <span class="penny-drawer-title">${t('penny_chat_title')}</span>
        <span class="penny-drawer-header-actions">
          ${voiceBtn}
          <button class="penny-icon-btn" id="pennyDrawerClose" type="button" aria-label="${esc(t('penny_close'))}">✕</button>
        </span>
      </div>
      <p class="penny-disclaimer">✨ ${t('penny_disclaimer')}</p>
      <div class="penny-messages" id="pennyMessages"></div>
      <div class="penny-quick-actions" id="pennyQuickActions"></div>
      <form class="penny-input-row" id="pennyInputForm">
        <input class="input penny-input" id="pennyInput" type="text" placeholder="${esc(t('penny_input_placeholder'))}" autocomplete="off">
        <button class="btn btn-primary btn-sm penny-send-btn" id="pennySendBtn" type="submit">${t('penny_send')}</button>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  _pennyDrawerBuilt = true;

  document.getElementById('pennyDrawerClose')?.addEventListener('click', pennyCloseChat);
  document.getElementById('pennyDrawerScrim')?.addEventListener('click', pennyCloseChat);
  document.getElementById('pennyVoiceToggleBtn')?.addEventListener('click', e => {
    const on = pennyToggleVoice();
    e.currentTarget.classList.toggle('is-muted', !on);
    e.currentTarget.setAttribute('aria-label', on ? t('penny_voice_on') : t('penny_voice_off'));
  });
  document.getElementById('pennyInputForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('pennyInput');
    const val = input.value;
    input.value = '';
    pennySendMessage(val);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('pennyDrawer')?.classList.contains('is-open')) pennyCloseChat();
  });
}

function pennyRenderQuickActions() {
  const wrap = document.getElementById('pennyQuickActions');
  if (!wrap) return;
  const prompts = ['penny_qp_leftover', 'penny_qp_top_category', 'penny_qp_on_track', 'penny_qp_subscriptions', 'penny_qp_debt', 'penny_qp_chart'];
  wrap.innerHTML = prompts.map(k => `<button class="btn btn-ghost btn-sm penny-qp-btn" data-qp="${k}" type="button">${esc(t(k))}</button>`).join('');
  wrap.querySelectorAll('[data-qp]').forEach(b => b.addEventListener('click', () => pennySendMessage(t(b.dataset.qp))));
}
function pennyAppendMessage(role, text) {
  const list = document.getElementById('pennyMessages');
  if (!list) return null;
  const qa = document.getElementById('pennyQuickActions');
  if (qa) qa.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'penny-msg penny-msg--' + (role === 'user' ? 'user' : 'penny');
  if (role !== 'user') row.innerHTML = `<span class="penny-msg-avatar">${PENNY_ICON_SVG}</span>`;
  const bubble = document.createElement('div');
  bubble.className = 'penny-msg-bubble';
  bubble.innerHTML = `<div class="penny-msg-text"></div>`;
  bubble.querySelector('.penny-msg-text').textContent = text;
  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return bubble;
}
function pennyShowTyping() {
  pennyHideTyping();
  const list = document.getElementById('pennyMessages');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'penny-msg penny-msg--penny';
  row.id = 'pennyTypingRow';
  row.innerHTML = `<span class="penny-msg-avatar">${PENNY_ICON_SVG}</span><div class="penny-msg-bubble penny-typing"><span></span><span></span><span></span></div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}
function pennyHideTyping() { document.getElementById('pennyTypingRow')?.remove(); }
function pennySetInputEnabled(on) {
  const input = document.getElementById('pennyInput');
  const btn = document.getElementById('pennySendBtn');
  if (input) input.disabled = !on;
  if (btn) btn.disabled = !on;
}
function pennyRenderChatError(kind, retryText) {
  const list = document.getElementById('pennyMessages');
  if (!list) return;
  const msgKey = { invalid_key: 'penny_err_invalid_key', rate_limited: 'penny_err_rate_limited', network: 'penny_err_network', blocked: 'penny_err_blocked', no_key: 'penny_no_key_notice' }[kind] || 'penny_err_blocked';
  const showSettings = kind === 'invalid_key' || kind === 'no_key';
  const showRetry = (kind === 'rate_limited' || kind === 'network') && !!retryText;
  const row = document.createElement('div');
  row.className = 'penny-msg penny-msg--penny penny-msg--error';
  row.innerHTML = `<span class="penny-msg-avatar">${PENNY_ICON_SVG}</span>
    <div class="penny-msg-bubble penny-msg-bubble--error">
      <div class="penny-msg-text">⚠️ ${esc(t(msgKey))}</div>
      ${showSettings ? `<button class="btn btn-ghost btn-sm penny-err-action" id="pennyErrSettingsBtn" type="button">${esc(t('penny_open_settings'))}</button>` : ''}
      ${showRetry ? `<button class="btn btn-ghost btn-sm penny-err-action" id="pennyErrRetryBtn" type="button">${esc(t('penny_err_retry'))}</button>` : ''}
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  row.querySelector('#pennyErrSettingsBtn')?.addEventListener('click', () => { pennyCloseChat(); switchTab('settings'); });
  row.querySelector('#pennyErrRetryBtn')?.addEventListener('click', () => pennySendMessage(retryText));
}
