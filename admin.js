'use strict';
/* =====================================================================
   admin.js - private analytics dashboard, read path only.

   Reads anonymous, aggregate usage events (never financial data - see
   analytics.js/Code.gs) from a Google Sheet in the site owner's own
   Drive. Auth here is FRESH, parallel code that mirrors sync.js's
   proven OAuth patterns (prewarm-before-click, user-activation gating,
   never-persist-tokens) - sync.js itself is not touched or imported,
   since this page's needs (read-only Sheets access, one-time sign-in)
   are a different shape than sync.js's per-tool local/Drive sync.
   ===================================================================== */

// ══════ Config - fill these in after completing the setup checklist ══════
// Same OAuth Client ID sync.js already uses - this origin is already an
// authorized origin for it, and OAuth clients don't pre-declare scopes,
// so no new Cloud Console client is needed, only a different scope
// requested at token time (below).
const GOOGLE_CLIENT_ID = '1008129505128-4p0kobjks9gb8bloe1epis7ea7333kqd.apps.googleusercontent.com';
// Full (not .readonly) Sheets scope - the Danger Zone feature needs to
// clear cells to delete events, not just read them. Same "Sensitive" (not
// "Restricted") tier as the read-only scope, so this still works fine
// under Testing publishing status. Since tokens are never persisted
// (in-memory only, see _adminAccessToken below), the next sign-in after
// this change simply requests the new scope - no separate migration step.
const ADMIN_SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email profile';
const ADMIN_SPREADSHEET_ID = '1J8q4Q6RjYrZLidROFJDtdu3hKdqWSsgXgI_Fdne9wK0';
const ADMIN_ALLOWED_EMAIL = 'braydonbudde@gmail.com';  // your own Google account address, lowercase
const ADMIN_SHEET_NAME = 'Events';
const ADMIN_SHEET_RANGE = `${ADMIN_SHEET_NAME}!A2:L200000`;
// Same deployed Apps Script the site's analytics posts to - used here only to
// read Lemon Squeezy sales totals. Deliberately duplicated rather than loading
// analytics.js on this page, which would record the owner's own dashboard
// visits as visitor traffic and skew every number on it. Keep in sync with
// ANALYTICS_ENDPOINT in analytics.js.
const ADMIN_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec';
// "Online now" = any event within this window - must comfortably beat
// analytics.js's own heartbeat interval (25s) so a quiet-but-open tab
// doesn't flicker offline between heartbeats.
const ADMIN_ONLINE_WINDOW_MS = 60000;
const ADMIN_POLL_MS = 30000;

// ══════ esc()/fmt() - charts.js expects these as globals (normally ══════
// ══════ supplied by script.js/ultimate-budget.js, neither loaded here) ══
const esc = s => { const d = document.createElement('div'); d.appendChild(document.createTextNode(String(s ?? ''))); return d.innerHTML; };
const fmt = n => Math.round(Number(n) || 0).toLocaleString();

// Same 12-color palette used dashboard-wide (script.js COLOR_WHEEL / ultimate-budget.js COLORS).
const ADMIN_COLORS = ['#06b6d4', '#ec4899', '#fb923c', '#8b5cf6', '#10b981', '#eab308', '#3b82f6', '#f43f5e', '#14b8a6', '#a855f7', '#f97316', '#6366f1'];

// ══════════ Styled date field + calendar popover (ported from ══════════
// ══════════ ultimate-budget.js's fk-dp-*/date-field-styled pattern) ══════
// Copied rather than shared via a script tag because admin.html doesn't
// (and shouldn't) load ultimate-budget.js - this page has none of that
// file's app `state`/i18n. Every `t('dp_today')`/`state.settings.language`
// dependency below is replaced with a fixed English string, since this
// dashboard has exactly one user (the site owner) and no language picker.
// The CSS (.fk-datepop, .date-field-styled, etc.) is already available -
// it lives in the shared style.css, which admin.html links same as always.
function formatDateDisplay(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const calIcon = () => `<svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
function styledDateField(inputId, wrapId, value) {
  return `<div class="date-field-styled" id="${wrapId}">${calIcon()}<span class="date-field-val" id="${inputId}Disp">${value ? formatDateDisplay(value) : '<span class="no-date">Any date</span>'}</span><input type="date" id="${inputId}" value="${value || ''}"></div>`;
}
function bindDateField(inputId, wrapId, onChange) {
  document.getElementById(wrapId)?.addEventListener('click', () => { openDatePicker(document.getElementById(inputId), document.getElementById(wrapId)); });
  document.getElementById(inputId)?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openDatePicker(document.getElementById(inputId), document.getElementById(wrapId));
    }
  });
  document.getElementById(inputId)?.addEventListener('change', e => {
    const disp = document.getElementById(inputId + 'Disp');
    if (disp) disp.innerHTML = e.target.value ? formatDateDisplay(e.target.value) : '<span class="no-date">Any date</span>';
    if (onChange) onChange(e.target.value);
  });
}
function openDatePicker(input, anchor) {
  if (!input) return;
  const existing = document.getElementById('fkDatePop');
  const wasFor = existing && existing._for;
  if (existing) existing.remove();
  if (wasFor === input) return; // toggle off if re-clicking same field
  const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sel = parse(input.value), base = sel || new Date();
  let vy = base.getFullYear(), vm = base.getMonth();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const pop = document.createElement('div'); pop.className = 'fk-datepop'; pop.id = 'fkDatePop'; pop._for = input;
  const titleFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  const dowFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
  const dow = []; for (let i = 0; i < 7; i++) dow.push(dowFmt.format(new Date(2024, 0, 1 + i))); // 2024-01-01 = Monday
  function draw() {
    const startDow = (new Date(vy, vm, 1).getDay() + 6) % 7, dim = new Date(vy, vm + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<span class="fk-dp-day fk-dp-empty"></span>';
    for (let d = 1; d <= dim; d++) { const dd = new Date(vy, vm, d), sd = sel && iso(sel) === iso(dd), td = dd.getTime() === today0.getTime(); cells += `<button type="button" class="fk-dp-day${sd ? ' is-sel' : ''}${td ? ' is-today' : ''}" data-iso="${iso(dd)}">${d}</button>`; }
    pop.innerHTML = `<div class="fk-dp-head"><button type="button" class="fk-dp-nav" data-nav="-1">‹</button><span class="fk-dp-title">${titleFmt.format(new Date(vy, vm, 1))}</span><button type="button" class="fk-dp-nav" data-nav="1">›</button></div><div class="fk-dp-dow">${dow.map(n => `<span>${n}</span>`).join('')}</div><div class="fk-dp-grid">${cells}</div><div class="fk-dp-foot"><button type="button" class="fk-dp-today">Today</button><button type="button" class="fk-dp-clear">Clear</button></div>`;
    pop.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); vm += +b.dataset.nav; if (vm < 0) { vm = 11; vy--; } else if (vm > 11) { vm = 0; vy++; } draw(); }));
    pop.querySelectorAll('.fk-dp-day[data-iso]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); commit(b.dataset.iso); }));
    pop.querySelector('.fk-dp-today').addEventListener('click', ev => { ev.stopPropagation(); commit(iso(new Date())); });
    pop.querySelector('.fk-dp-clear').addEventListener('click', ev => { ev.stopPropagation(); commit(''); });
  }
  function commit(v) { input.value = v; input.dispatchEvent(new Event('change', { bubbles: true })); close(); }
  function close() { pop.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close); }
  function outside(e) { if (!pop.contains(e.target)) close(); }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.body.appendChild(pop); draw();
  if (!window.matchMedia('(max-width:480px)').matches) {
    const r = (anchor || input).getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let top = r.bottom + 6 + window.scrollY, left = r.left + window.scrollX;
    if (left - window.scrollX + pw > vw - 8) left = window.scrollX + vw - pw - 8;
    if (r.bottom + 6 + ph > vh && r.top - 6 - ph > 0) top = r.top + window.scrollY - ph - 6;
    pop.style.top = Math.max(8 + window.scrollY, top) + 'px'; pop.style.left = Math.max(8, left) + 'px';
  }
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', close); }, 0);
}

// ══════════ Info-tooltip ("tiny i sign") - ported from ultimate-budget.js's ══════════
// ══════════ .cc-info/.cc-tip-pop pattern, verbatim (only depends on esc()) ══════════
function initFieldTips(container) {
  const scope = container || document;
  let tipBtn = null, shownViaHover = false;
  const hideAll = () => { document.querySelectorAll('.cc-tip-pop').forEach(el => el.remove()); tipBtn = null; shownViaHover = false; };
  const show = (btn, viaHover) => {
    hideAll();
    const name = btn.parentElement.querySelector('.cc-label-text')?.textContent || '';
    const tipEl = document.createElement('div');
    tipEl.className = 'cc-tip-pop';
    tipEl.innerHTML = `<div class="cc-tip-head"><span class="cc-tip-dot"></span>${esc(name)}</div><div class="cc-tip-body">${esc(btn.dataset.tip)}</div><span class="cc-tip-arrow"></span>`;
    document.body.appendChild(tipEl);
    tipBtn = btn; shownViaHover = !!viaHover;
    const r = btn.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    const iconCenter = r.left + r.width / 2 + window.scrollX;
    let left = iconCenter - tw / 2;
    const minL = window.scrollX + 10, maxL = window.scrollX + window.innerWidth - tw - 10;
    left = Math.max(minL, Math.min(left, maxL));
    let top = r.top + window.scrollY - th - 11;
    if (r.top - th - 11 < 0) { top = r.bottom + window.scrollY + 11; tipEl.classList.add('cc-tip-below'); }
    else { tipEl.classList.add('cc-tip-above'); }
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
    const arrow = tipEl.querySelector('.cc-tip-arrow');
    let ax = iconCenter - left - 6;
    ax = Math.max(14, Math.min(ax, tw - 26));
    arrow.style.left = ax + 'px';
    requestAnimationFrame(() => tipEl.classList.add('is-in'));
  };
  scope.querySelectorAll('.cc-info[data-tip]').forEach(btn => {
    btn.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(btn, true); });
    btn.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && shownViaHover) hideAll(); });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (tipBtn === btn && document.querySelector('.cc-tip-pop')) {
        if (shownViaHover) { shownViaHover = false; return; }
        hideAll(); return;
      }
      show(btn, false);
    });
    btn.addEventListener('blur', hideAll);
  });
}
document.addEventListener('click', () => document.querySelectorAll('.cc-tip-pop').forEach(el => el.remove()));
window.addEventListener('scroll', () => document.querySelectorAll('.cc-tip-pop').forEach(el => el.remove()), true);

// ══════════════════════ OAuth (mirrors sync.js) ══════════════════════
let _adminTokenClient = null;
let _adminAccessToken = null; // in-memory only, never persisted - same rule as sync.js

function _adminGisReady() { return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2; }

function adminPrewarmTokenClient() {
  if (_adminTokenClient || !_adminGisReady()) return;
  _adminTokenClient = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: ADMIN_SCOPES, callback: () => {} });
}
adminPrewarmTokenClient();
window.addEventListener('load', adminPrewarmTokenClient);

function _adminGetTokenClient(onToken) {
  adminPrewarmTokenClient();
  if (!_adminTokenClient) return null;
  _adminTokenClient.callback = onToken;
  return _adminTokenClient;
}

function _adminHasUserActivation() {
  return typeof navigator !== 'undefined' && !!navigator.userActivation && navigator.userActivation.isActive;
}

// This page is a rarely-opened, manually-bookmarked destination gated by
// an explicit "Sign in with Google" click - unlike sync.js there's no
// silent/background resync path to protect, so only the interactive flow
// exists here, always triggered by a real click.
function adminInteractiveToken() {
  if (!_adminHasUserActivation()) return Promise.reject(new Error('popup_blocked_or_timed_out'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; reject(new Error('popup_blocked_or_timed_out')); }, 300000);
    const client = _adminGetTokenClient(resp => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (resp && resp.access_token) { _adminAccessToken = resp.access_token; resolve(resp.access_token); }
      else reject(new Error(resp && resp.error ? resp.error : 'sign_in_failed'));
    });
    if (!client) { clearTimeout(timer); reject(new Error('google_identity_unavailable')); return; }
    try { client.requestAccessToken({ prompt: '' }); }
    catch (e) { clearTimeout(timer); reject(e); }
  });
}

async function _adminFetchEmail(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return '';
  const j = await res.json();
  return j.email || '';
}

function adminFriendlyError(err) {
  const msg = err && err.message;
  if (msg === 'popup_blocked_or_timed_out') return 'Your browser blocked the Google sign-in window. Please allow pop-ups for this site and try again.';
  if (msg === 'access_denied' || msg === 'sign_in_failed') return 'Sign-in was cancelled. Please try again.';
  if (msg === 'not_allowed') return 'That Google account is not authorized to view this dashboard.';
  if (msg === 'sheets_fetch_failed') return "Signed in, but couldn't read the analytics sheet. Confirm ADMIN_SPREADSHEET_ID is correct and this account has access to it.";
  if (msg === 'sheets_delete_failed') return "Couldn't delete those events. Check that this account still has edit access to the sheet, then try again.";
  return "Sign-in didn't go through. Please try again.";
}

// ══════════════════════ Sheets fetch ══════════════════════
function _safeParseJSON(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

// Keys, Notify and Sales are read as raw values, so a date arrives as a
// spreadsheet serial number instead of text formatted in whatever locale the
// sheet happens to use (where "10/11" could be either month). The serial is
// wall-clock time in the sheet's timezone, which is the owner's own.
const SHEET_VALUES_QS = '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
function sheetIso(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && isFinite(v)) {
    const w = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    return new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds()).toISOString();
  }
  return String(v);
}
const _str = v => (v == null ? '' : String(v));

// Traffic that isn't a real visitor: automated browsers (test runs, which
// before Oct 17 also reached the sheet from local previews), crawlers, and
// any device marked as the owner's ("owner_device", sent once when a device
// is marked: signing in here, or ?notrack=1 on any page). Hidden from every
// number unless "Show my own visits and test traffic" is on in Settings.
const ADMIN_BOT_UA = /HeadlessChrome|Playwright|puppeteer|Lighthouse|bot\b|crawler|spider|slurp|facebookexternalhit|Bytespider/i;
const ADMIN_SHOWALL_KEY = 'evobudget_admin_show_all_traffic';
let adminHiddenTraffic = { events: 0, visitors: 0 };
function adminShowAllTraffic() { try { return localStorage.getItem(ADMIN_SHOWALL_KEY) === '1'; } catch (e) { return false; } }
function adminFilterTraffic(events) {
  const owners = new Set(events.filter(e => e.type === 'owner_device').map(e => e.visitorId));
  try { const v = localStorage.getItem('evobudget_analytics_vid'); if (v) owners.add(v); } catch (e) {}
  const hidden = events.filter(e => e.type === 'owner_device' || owners.has(e.visitorId) || ADMIN_BOT_UA.test(e.ua || ''));
  adminHiddenTraffic = { events: hidden.length, visitors: new Set(hidden.map(e => e.visitorId)).size };
  if (adminShowAllTraffic()) return events.filter(e => e.type !== 'owner_device');
  const drop = new Set(hidden);
  return events.filter(e => !drop.has(e));
}
// This browser is the owner's: stop counting it, and tell the sheet so its
// past visits are hidden too. Same event shape analytics.js sends.
function adminMarkOwnerDevice() {
  try {
    if (localStorage.getItem('ezzo_exclude_from_analytics') === '1') return;
    localStorage.setItem('ezzo_exclude_from_analytics', '1');
    const vid = localStorage.getItem('evobudget_analytics_vid');
    if (!vid || !/(^|\.)ezzohub\.com$/.test(location.hostname) || navigator.webdriver) return;
    const body = JSON.stringify({ appKey: 'EVOBUDGETANALYTICS', type: 'owner_device', visitorId: vid, sessionId: 'admin', page: 'admin', tool: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '', referrer: '', ua: navigator.userAgent.slice(0, 256), lang: navigator.language || '', detail: {}, clientTs: new Date().toISOString() });
    navigator.sendBeacon(ADMIN_APPS_SCRIPT_URL, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
  } catch (e) {}
}

async function adminFetchEvents(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_SHEET_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('sheets_fetch_failed');
  const j = await res.json();
  const rows = j.values || [];
  // `row` (1-based sheet row number, ADMIN_SHEET_RANGE starts at row 2
  // since row 1 is the header) is carried on every event purely so the
  // Danger Zone delete feature can clear exactly the right cells later -
  // nothing else in this file reads it.
  const events = rows.map((r, i) => ({
    row: i + 2,
    serverTime: r[0] || '', type: r[1] || '', visitorId: r[2] || '', sessionId: r[3] || '',
    page: r[4] || '', tool: r[5] || '', timezone: r[6] || '', referrer: r[7] || '',
    ua: r[8] || '', lang: r[9] || '', detail: _safeParseJSON(r[10]), clientTs: r[11] || ''
  })).filter(e => e.type); // drop any accidental blank rows
  allEventsRaw = events;
  return adminFilterTraffic(events);
}

// ══════════════════════ Etsy keys ══════════════════════
// Separate sheet from Events: Events is an append-only activity log, Keys is
// a small mutable record of what's been issued. Written by the Apps Script
// when a buyer claims at /claim, and by revoke/restore below.
const ADMIN_KEYS_SHEET = 'Keys';
const ADMIN_KEYS_RANGE = `${ADMIN_KEYS_SHEET}!A2:K10000`;
// Addresses left by the "tell me when this launches" form. Written by
// Code.gs's notify action; the sheet appears the first time one arrives.
const ADMIN_NOTIFY_SHEET = 'Notify';
const ADMIN_NOTIFY_RANGE = `${ADMIN_NOTIFY_SHEET}!A2:E10000`;
let allNotify = [];
let _notifyFetchError = '';
// Orders posted by the Lemon Squeezy webhook. Until this existed the sales
// report returned totals only, so a Lemon Squeezy buyer's address never
// reached the email list.
const ADMIN_SALES_SHEET = 'Sales';
const ADMIN_SALES_RANGE = `${ADMIN_SALES_SHEET}!A2:O10000`;
let allSales = [];
// Test orders are real rows that are not real money. They are always shown
// somewhere, so nothing is ever silently missing, but they only count
// towards revenue when this is on. Off by default so the headline figure
// means money that arrived.
const ADMIN_SHOWTEST_KEY = 'evobudget_admin_show_test';
let showTestData = (() => {
  try { return localStorage.getItem(ADMIN_SHOWTEST_KEY) === '1'; } catch (e) { return false; }
})();
function setShowTestData(on) {
  showTestData = !!on;
  try { localStorage.setItem(ADMIN_SHOWTEST_KEY, showTestData ? '1' : '0'); } catch (e) {}
}
let salesFilters = { channel: '', status: '', q: '' };
let allKeys = [];

// Why the Keys fetch came back empty, if it did. A silently empty tab is
// indistinguishable from "nobody has bought yet", which makes a real
// misconfiguration (wrong sheet, wrong spreadsheet, missing permission)
// impossible to tell apart from normal quiet - so keep Google's own reason.
let _keysFetchError = '';

// A missing Notify sheet is the normal state until the first address is
// collected, so that reads as empty rather than as an error.
async function adminFetchNotify(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_NOTIFY_RANGE)}${SHEET_VALUES_QS}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      _notifyFetchError = res.status === 400 ? '' : String(res.status);
      return [];
    }
    _notifyFetchError = '';
    const j = await res.json();
    return (j.values || []).map(r => ({
      ts: sheetIso(r[0]), email: _str(r[1]), tool: _str(r[2]), source: _str(r[3]) || 'notify', visitorId: _str(r[4])
    })).filter(r => r.email);
  } catch (e) { _notifyFetchError = 'network'; return []; }
}

// Absent until the first webhook lands, which is the normal state. Every
// row comes back, refunds included: salesLedger() pairs each refund with the
// sale it belongs to and takes it off, rather than the refund vanishing.
// Columns M-O (Discount, Affiliate, Gross) only exist from the Apps Script
// update that added them, so older rows simply leave them empty.
async function adminFetchSales(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_SALES_RANGE)}${SHEET_VALUES_QS}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.values || []).map((r, i) => ({
      row: i + 2, ts: sheetIso(r[0]), event: _str(r[1]).toLowerCase(), orderId: _str(r[2]), email: _str(r[3]), name: _str(r[4]),
      product: _str(r[5]), variant: _str(r[6]), total: Number(r[7] || 0), currency: _str(r[8]) || 'USD',
      mode: _str(r[9]) || 'live', status: _str(r[10]), orderNumber: _str(r[11]),
      discount: _str(r[12]), affiliate: _str(r[13]), gross: _str(r[14])
    })).filter(r => r.event);
  } catch (e) { return []; }
}

async function adminFetchKeys(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_KEYS_RANGE)}${SHEET_VALUES_QS}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (e) { /* body wasn't JSON */ }
    _keysFetchError = `${res.status}${detail ? ': ' + detail : ''}`;
    return [];
  }
  _keysFetchError = '';
  const j = await res.json();
  return (j.values || []).map((r, i) => {
    let devices = [];
    try { devices = JSON.parse(r[8] || '[]'); } catch (e) { devices = []; }
    if (!Array.isArray(devices)) devices = [];
    return {
      row: i + 2,
      key: _str(r[0]), tool: _str(r[1]), theme: _str(r[2]), layout: _str(r[3]),
      orderId: _str(r[4]), email: _str(r[5]), issuedAt: sheetIso(r[6]),
      status: (_str(r[7]) || 'active').toLowerCase(), devices,
      redeemCount: Number(r[9] || 0), lastRedeemedAt: sheetIso(r[10])
    };
  }).filter(k => k.key);
}

// Status lives in column H. Revoking blocks any FUTURE redemption of the key;
// it can't reach into a browser that already unlocked, since that unlock is a
// local flag (see the note in claim.html about what this does and doesn't do).
async function adminSetKeyStatus(rowNum, status) {
  const range = `${ADMIN_KEYS_SHEET}!H${rowNum}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${_adminAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[status]] })
  });
  if (!res.ok) throw new Error('sheets_write_failed');
}

// ══════════════════════ Danger zone: delete events in a range ══════════════
// Clears cell CONTENTS (values.batchClear) rather than deleting rows
// (spreadsheets.batchUpdate deleteDimension) - a cleared row is already
// functionally gone on every future read (adminFetchEvents's own
// `.filter(e => e.type)` drops it), and clearing sidesteps needing the
// sheet's numeric grid ID or having to re-index every row below a
// deletion. Requires the read-write ADMIN_SCOPES above.
function eventsInRange(from, to) {
  if (!from && !to) return [];
  // Deleting a range removes everything in it, including hidden test and
  // owner traffic, not only what the dashboard counts.
  return (_sampleDataActive ? allEvents : (allEventsRaw.length ? allEventsRaw : allEvents)).filter(e => {
    const t = eventTime(e);
    if (from && t < new Date(from + 'T00:00:00').getTime()) return false;
    if (to && t > new Date(to + 'T23:59:59').getTime()) return false;
    return true;
  });
}
async function adminDeleteEventsInRange(token, from, to) {
  const rowNums = eventsInRange(from, to).map(e => e.row).filter(Boolean).sort((a, b) => a - b);
  if (!rowNums.length) return 0;
  // Coalesce consecutive row numbers into contiguous ranges so a large
  // deletion is a handful of clear ranges, not one request per row.
  const spans = [];
  let start = rowNums[0], prev = rowNums[0];
  for (let i = 1; i < rowNums.length; i++) {
    if (rowNums[i] === prev + 1) { prev = rowNums[i]; continue; }
    spans.push([start, prev]); start = rowNums[i]; prev = rowNums[i];
  }
  spans.push([start, prev]);
  const ranges = spans.map(([a, b]) => `${ADMIN_SHEET_NAME}!A${a}:L${b}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values:batchClear`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ranges })
  });
  if (!res.ok) throw new Error('sheets_delete_failed');
  return rowNums.length;
}

// ══════════════════════ State ══════════════════════
let allEvents = [];
let allEventsRaw = [];   // before hiding owner devices and automated browsers
let currentATab = 'overview';
let liveTimer = null;
const filters = { from: '', to: '', tool: '' };
const redemptionFilters = { q: '', tool: '', onlyReused: false };
const dangerZoneState = { from: '', to: '', confirmOpen: false, confirmText: '', busy: false, resultMsg: '' };
// Overview's own date range - separate from `filters` (Traffic/Product)
// so changing one never surprises the other. Reset to the current
// calendar month every sign-in (see adminSignIn()), per explicit request.
const overviewFilters = { from: '', to: '' };
function currentMonthBounds() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: iso(start), to: iso(end) };
}

// ══════════════════════ Aggregation helpers ══════════════════════
function eventTime(e) { const t = Date.parse(e.clientTs || e.serverTime); return isNaN(t) ? 0 : t; }
function filteredEvents() {
  return allEvents.filter(e => {
    if (filters.tool && e.tool !== filters.tool) return false;
    const t = eventTime(e);
    if (filters.from && t < new Date(filters.from + 'T00:00:00').getTime()) return false;
    if (filters.to && t > new Date(filters.to + 'T23:59:59').getTime()) return false;
    return true;
  });
}
function uniqueBy(arr, keyFn) { return Array.from(new Set(arr.map(keyFn))); }
function groupCount(arr, keyFn) {
  const m = new Map();
  arr.forEach(x => { const k = keyFn(x) || 'Unknown'; m.set(k, (m.get(k) || 0) + 1); });
  return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
function segmentize(groups) {
  const total = groups.reduce((s, g) => s + (g.value || 0), 0);
  const segs = groups.map(g => ({ ...g, pct: total > 0 ? g.value / total * 100 : 0 }));
  assignSegColors(segs, ADMIN_COLORS);
  return segs;
}
function isOnlineNow(e) { return (Date.now() - eventTime(e)) <= ADMIN_ONLINE_WINDOW_MS; }
function uaBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  return 'Other';
}
function uaDevice(ua) {
  if (/iPad|Tablet/.test(ua)) return 'Tablet';
  if (/Mobi|Android|iPhone/.test(ua)) return 'Mobile';
  return 'Desktop';
}
function toolLabel(tool) { return tool === 'sbp' ? 'Simple Budget' : tool === 'ubp' ? 'Ultimate Budget' : (tool || 'Home'); }
// Distinct from toolLabel() - that one reads the `tool` field ('sbp'/'ubp'/''),
// this one reads the `page` field ('sbp'/'ubp'/'home'), which is always
// truthy so toolLabel's `tool || 'Home'` fallback would incorrectly print
// the raw lowercase 'home' instead of falling through to the nice label.
const PAGE_LABELS = { home: 'Home', budgetplanner: 'Product page', claim: 'Etsy claim', legal: 'Legal pages', partners: 'Partner program', ubp: 'Ultimate Budget', sbp: 'Simple Budget' };
function pageLabel(page) { return PAGE_LABELS[page] || 'Home'; }
function relTime(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Builds a {label,value} series for `days` days ending at `endMs`
// (defaults to now, preserving every existing caller's "last N days"
// behavior), counting UNIQUE visitors per day - reuses svgSpendLine as-is
// (it just wants points:[{value}]), same primitive the app's own
// dashboards use for daily spend.
function dailyUniqueVisitorSeries(events, days, endMs) {
  const byDay = new Map();
  events.forEach(e => { const k = dayKey(eventTime(e)); if (!byDay.has(k)) byDay.set(k, new Set()); byDay.get(k).add(e.visitorId); });
  const points = [];
  const d = endMs ? new Date(endMs) : new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const k = dayKey(d.getTime());
    const set = byDay.get(k);
    points.push({ label: k, value: set ? set.size : 0 });
    d.setDate(d.getDate() + 1);
  }
  return points;
}

// ══════════════════════ Session-derived metrics ══════════════════════
// Everything below is computed purely from events we already collect
// (session_start/heartbeat/page_view/session_end, keyed by sessionId) -
// no new event types or schema fields needed for bounce rate, session
// duration, pages/session, or new-vs-returning.

// Groups events into sessions and derives per-session stats. Duration is
// last-event-time minus first-event-time across ALL of a session's
// events (not just relying on session_end firing, which is reliable via
// sendBeacon/pagehide but this way doesn't strictly depend on it).
function buildSessions(events) {
  const map = new Map();
  events.forEach(e => {
    if (!map.has(e.sessionId)) map.set(e.sessionId, { sessionId: e.sessionId, visitorId: e.visitorId, tool: e.tool, page: e.page, events: [] });
    map.get(e.sessionId).events.push(e);
  });
  return Array.from(map.values()).map(s => {
    const times = s.events.map(eventTime).filter(t => t > 0).sort((a, b) => a - b);
    const first = times[0] || 0, last = times[times.length - 1] || 0;
    const pageViews = s.events.filter(e => e.type === 'page_view').sort((a, b) => eventTime(a) - eventTime(b));
    const hasHeartbeat = s.events.some(e => e.type === 'heartbeat');
    // "Engaged" mirrors the modern GA4-style definition (replacing the old
    // single-page-only bounce rule, which undercounts a visitor who reads
    // one page thoroughly): stayed long enough for a heartbeat to fire
    // (~25s+) OR moved to a second page. Bounce rate is just the inverse.
    const engaged = pageViews.length >= 2 || hasHeartbeat;
    return {
      sessionId: s.sessionId, visitorId: s.visitorId, tool: s.tool,
      first, last, duration: Math.max(0, last - first),
      pageViewCount: pageViews.length, engaged,
      landingPage: pageViews[0] ? pageViews[0].page : (s.page || ''),
      exitPage: pageViews[pageViews.length - 1] ? pageViews[pageViews.length - 1].page : (s.page || '')
    };
  });
}
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), rem = s % 60;
  if (m < 60) return m + 'm ' + rem + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
// A visitor is "returning" if they've ever had more than one distinct
// session, evaluated against the FULL unfiltered dataset (so this stays
// correct regardless of which date range is currently filtered) - not
// scoped to session-open/close events, which keeps it simple and always
// well-defined even with no date filter applied.
function newReturningSplit(events) {
  const sessionsByVisitor = new Map();
  allEvents.forEach(e => { if (!sessionsByVisitor.has(e.visitorId)) sessionsByVisitor.set(e.visitorId, new Set()); sessionsByVisitor.get(e.visitorId).add(e.sessionId); });
  const rangeVisitors = uniqueBy(events, e => e.visitorId);
  let newCount = 0, returningCount = 0;
  rangeVisitors.forEach(vid => { ((sessionsByVisitor.get(vid) || new Set()).size > 1 ? returningCount++ : newCount++); });
  return { newCount, returningCount, total: rangeVisitors.length };
}

// ══════════════════════ Rendering ══════════════════════
// ── Never a sideways scroll ───────────────────────────────────────────
// Every table stays a table while it fits its panel. One that doesn't is
// shown as stacked label/value cards instead (each cell labelled with its
// column), re-checked whenever anything re-renders or the window resizes.
function admStackTables(root) {
  (root || document).querySelectorAll('.admin-table').forEach(t => {
    const heads = [...t.querySelectorAll(':scope > thead th')].map(th => th.textContent.trim());
    t.querySelectorAll(':scope > tbody > tr').forEach(tr => [...tr.children].forEach((td, i) => {
      if (heads[i] && !td.hasAttribute('colspan')) td.dataset.label = heads[i];
    }));
    t.classList.remove('is-stacked');
    const box = t.parentElement;
    if (box && t.scrollWidth > box.clientWidth + 1) t.classList.add('is-stacked');
  });
}
let _admStackFrame = 0;
function admQueueStack() { cancelAnimationFrame(_admStackFrame); _admStackFrame = requestAnimationFrame(() => admStackTables(document)); }
new MutationObserver(admQueueStack).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', admQueueStack);

function kpiRow(tiles) { return `<div class="ist-row">${tiles.map(t => iconStatTile(t.icon, t.label, t.value, t.sub, t.color, t.hint ? esc(t.hint) : '')).join('')}</div>`; }
function panelTitle(text, hint) {
  return `<div class="panel-title-sm" style="margin-bottom:14px"><span class="cc-label-text">${esc(text)}</span>${hint ? `<button class="cc-info" type="button" style="margin-left:6px;vertical-align:middle" data-tip="${esc(hint)}" aria-label="What is this?">i</button>` : ''}</div>`;
}
function pieOrEmpty(groups, empty) {
  if (!groups.length) return `<div class="chart-empty">${esc(empty)}</div>`;
  return pieChartHtml(segmentize(groups), { limit: 6 });
}
function money(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n, d, digits) { return d ? (n / d * 100).toFixed(digits == null ? 1 : digits) + '%' : '0%'; }

// ── Headline stat cards ───────────────────────────────────────────────
// Each card is compared with the stretch of time of the same length just
// before the selected range, so "is this good?" is answered on the card
// itself. `value` is pre-built markup (numbers only), `sub` likewise.
function deltaChip(now, prev, invert, title) {
  if (prev == null || now == null) return '';
  if (!prev && !now) return `<span class="adm-delta adm-delta--flat" title="${esc(title || '')}">no change</span>`;
  if (!prev) return `<span class="adm-delta adm-delta--up" title="${esc(title || '')}">new</span>`;
  const change = (now - prev) / prev * 100;
  if (Math.abs(change) < 0.5) return `<span class="adm-delta adm-delta--flat" title="${esc(title || '')}">no change</span>`;
  const good = invert ? change < 0 : change > 0;
  return `<span class="adm-delta ${good ? 'adm-delta--up' : 'adm-delta--down'}" title="${esc(title || '')}">${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(change > -10 && change < 10 ? 1 : 0)}%</span>`;
}
function statCard(o) {
  return `<div class="adm-stat" style="--tone:${o.tone || 'var(--grad-indigo)'}">
    <div class="adm-stat-top">
      <span class="adm-stat-icon" aria-hidden="true">${o.icon}</span>
      <span class="adm-stat-label cc-label-text">${esc(o.label)}</span>
      ${o.hint ? `<button class="cc-info" type="button" data-tip="${esc(o.hint)}" aria-label="What is this?">i</button>` : ''}
    </div>
    <div class="adm-stat-value">${o.value}</div>
    <div class="adm-stat-foot">${o.delta || ''}<span class="adm-stat-sub">${o.sub || ''}</span></div>
  </div>`;
}
function statGrid(cards) { return `<div class="adm-stat-grid">${cards.map(statCard).join('')}</div>`; }
function pageHead(title, sub, actions) {
  return `<div class="adm-head"><div><h2 class="admin-section-title">${esc(title)}</h2>${sub ? `<p class="admin-section-sub">${sub}</p>` : ''}</div>${actions ? `<div class="adm-head-actions">${actions}</div>` : ''}</div>`;
}

// ── Website vs. in-app ────────────────────────────────────────────────
// Overview is a store dashboard: it should answer "how is the site doing at
// turning visitors into buyers", not "how much do existing customers use the
// planners". Someone budgeting for an hour would otherwise show up as an
// hour-long website session with a great bounce rate, flattering every
// number without meaning anything commercially. The Product tab is where
// in-app activity is read.
const WEBSITE_PAGES = new Set(['home', 'budgetplanner', 'claim', 'legal', '']);
const IN_APP_EVENTS = new Set(['tab_viewed', 'feature_used', 'theme_changed', 'language_changed', 'dashboard_layout_changed', 'sync_mode_chosen', 'nav_position_changed', 'persona_changed', 'save_failed', 'unlock_revoked']);
// Buying signals count wherever they happen - the upgrade prompt lives
// inside the planners, and those are exactly the conversions worth seeing.
const ALWAYS_COUNT_EVENTS = new Set(['purchase_initiated', 'launch_code_redeemed', 'trial_started']);

// Website and product are kept apart: website numbers (visitors, sessions,
// online now) come only from the website's own pages, and the Product tab
// only from inside the planner. The buying signals above still feed the
// Overview funnel from wherever they happen, but without making someone
// using the planner count as a website visitor.
function isWebsiteEvent(e) {
  if (IN_APP_EVENTS.has(e.type)) return false;
  return WEBSITE_PAGES.has(e.page || '');
}
function commerceEventsIn(r) { return allEvents.filter(e => ALWAYS_COUNT_EVENTS.has(e.type) && within(eventTime(e), r)); }

// ── Date range (shared by Overview, Sales and Product) ─────────────────
// One range for all three, so switching tabs never quietly changes the
// period being read. Reset to the current month on every sign-in.
const _isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function todayBounds() { const d = new Date(); return { from: _isoDay(d), to: _isoDay(d) }; }
function last7Bounds() { const d = new Date(), s = new Date(d); s.setDate(d.getDate() - 6); return { from: _isoDay(s), to: _isoDay(d) }; }
function lastMonthBounds() {
  const d = new Date();
  return { from: _isoDay(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: _isoDay(new Date(d.getFullYear(), d.getMonth(), 0)) };
}
const RANGE_CHIPS = [
  ['today', 'Today', todayBounds], ['7d', '7 days', last7Bounds], ['month', 'This month', currentMonthBounds],
  ['lastmonth', 'Last month', lastMonthBounds], ['all', 'All time', () => ({ from: '', to: '' })]
];
function activeQuickRange() {
  const f = overviewFilters.from, to = overviewFilters.to;
  const hit = RANGE_CHIPS.find(([, , fn]) => { const b = fn(); return b.from === f && b.to === to; });
  return hit ? hit[0] : '';
}
function rangeMs() {
  return {
    fromMs: overviewFilters.from ? new Date(overviewFilters.from + 'T00:00:00').getTime() : -Infinity,
    toMs: overviewFilters.to ? new Date(overviewFilters.to + 'T23:59:59.999').getTime() : Infinity
  };
}
function within(t, r) { return t >= r.fromMs && t <= r.toMs; }
// The comparison period: as long as the part of the range that has already
// happened, ending where the range starts. "This month" on the 17th is
// compared with the 17 days before the 1st, not with a whole month.
function previousRangeMs() {
  const r = rangeMs();
  if (!isFinite(r.fromMs)) return null;
  const end = Math.min(r.toMs, Date.now());
  const len = end - r.fromMs;
  if (len <= 0) return null;
  return { fromMs: r.fromMs - len, toMs: r.fromMs - 1, days: Math.max(1, Math.round(len / 86400000)) };
}
function formatRangeLabel() {
  const key = activeQuickRange();
  const named = { today: 'Today', '7d': 'The last 7 days', month: 'This month', lastmonth: 'Last month', all: 'All time' }[key];
  if (named) return named;
  const fromTxt = overviewFilters.from ? formatDateDisplay(overviewFilters.from) : 'the beginning';
  const toTxt = overviewFilters.to ? formatDateDisplay(overviewFilters.to) : 'today';
  return `${fromTxt} to ${toTxt}`;
}
function rangeBarHtml(prefix) {
  const active = activeQuickRange();
  return `<div class="adm-range">
    <div class="adm-range-chips" role="group" aria-label="Date range">
      ${RANGE_CHIPS.map(([key, label]) => `<button class="admin-range-chip${active === key ? ' is-active' : ''}" data-range="${key}" type="button">${label}</button>`).join('')}
    </div>
    <div class="adm-range-dates">
      ${styledDateField(prefix + 'From', prefix + 'FromWrap', overviewFilters.from)}
      <span class="adm-range-sep">to</span>
      ${styledDateField(prefix + 'To', prefix + 'ToWrap', overviewFilters.to)}
    </div>
  </div>`;
}
function wireRangeBar(scope, prefix, rerender) {
  bindDateField(prefix + 'From', prefix + 'FromWrap', v => { overviewFilters.from = v; rerender(); });
  bindDateField(prefix + 'To', prefix + 'ToWrap', v => { overviewFilters.to = v; rerender(); });
  scope.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    const hit = RANGE_CHIPS.find(c => c[0] === b.dataset.range);
    if (hit) { Object.assign(overviewFilters, hit[2]()); rerender(); }
  }));
}
function overviewFilteredEvents() {
  const r = rangeMs();
  return allEvents.filter(e => isWebsiteEvent(e) && within(eventTime(e), r));
}

// ══════════════════════ Sales ledger ══════════════════════
// Every sale, once. Three channels feed it:
//   Dodo Payments  - the Sales sheet (payment.succeeded / refund.succeeded)
//   Lemon Squeezy  - the Sales sheet (order_created / order_refunded), retired
//   Etsy           - the Keys sheet: a buyer claims a key at /claim right
//                    after buying, so each claimed order is one sale at list
//                    price. Etsy has no feed, so these are estimates.
// A webhook retried by the payment provider is recorded once; a refund is
// matched back to its sale and subtracted from it rather than listed as a
// second sale.
const ADMIN_PRICES = { sbp: 19.99, ubp: 49.99 };
const CHANNEL_LABEL = { dodo: 'Dodo Payments', lemonsqueezy: 'Lemon Squeezy', etsy: 'Etsy' };
const CHANNEL_COLOR = { dodo: '#8b5cf6', lemonsqueezy: '#eab308', etsy: '#f97316' };
const PAID_EVENTS = new Set(['order_created', 'payment.succeeded']);
const REFUND_EVENTS = new Set(['order_refunded', 'refund.succeeded']);

function saleChannel(r) { return (r.variant === 'Dodo Payments' || /^(payment|refund)\./.test(r.event)) ? 'dodo' : 'lemonsqueezy'; }
function productTool(name) { return /simple/i.test(name) ? 'sbp' : /ultimate/i.test(name) ? 'ubp' : ''; }
function parseMoney(s) {
  const m = /^\s*(-?[\d.]+)\s*([A-Za-z]{3})?\s*$/.exec(String(s == null ? '' : s));
  return m ? { amount: Number(m[1]) || 0, currency: (m[2] || '').toUpperCase() } : null;
}
// "EZZO10, LAUNCH" -> ['EZZO10', 'LAUNCH']. Lemon Squeezy only ever said how
// much was taken off, so its rows group under one label.
function discountCodes(s) {
  const v = String(s || '').trim();
  if (!v) return [];
  if (/^discount\s/i.test(v)) return ['Lemon Squeezy discount'];
  return v.split(',').map(x => x.trim()).filter(Boolean);
}

function salesLedger() {
  const orders = new Map();
  const refunds = [];
  allSales.forEach(r => {
    const channel = saleChannel(r);
    if (PAID_EVENTS.has(r.event)) {
      const id = String(r.orderId || r.orderNumber || '');
      if (!id) return;
      const key = channel + '|' + id;
      if (orders.has(key)) return;
      orders.set(key, {
        key, channel, orderId: id, orderNumber: String(r.orderNumber || ''), t: Date.parse(r.ts) || 0,
        email: String(r.email || '').trim().toLowerCase(), name: r.name || '',
        product: r.product || '', tool: productTool(r.product), variant: channel === 'dodo' ? '' : (r.variant || ''),
        net: Number(r.total) || 0, currency: r.currency || 'USD', gross: parseMoney(r.gross),
        discount: String(r.discount || ''), codes: discountCodes(r.discount), affiliate: String(r.affiliate || ''),
        test: r.mode === 'test', refunded: 0, refundIds: new Set(), estimated: false
      });
    } else if (REFUND_EVENTS.has(r.event)) refunds.push([r, channel]);
  });
  refunds.forEach(([r, channel]) => {
    // Dodo records a refund under its own refund id, with the payment it
    // belongs to in the OrderNumber column. Lemon Squeezy reuses the order's.
    const target = channel === 'dodo' ? String(r.orderNumber || '') : String(r.orderId || '');
    let o = orders.get(channel + '|' + target);
    if (!o && channel === 'lemonsqueezy' && r.orderNumber) {
      o = [...orders.values()].find(x => x.channel === channel && x.orderNumber === String(r.orderNumber));
    }
    if (!o) return;
    const rid = String(r.orderId || '') + '|' + String(r.total);
    if (o.refundIds.has(rid)) return;
    o.refundIds.add(rid);
    // A refund comes back in the currency the buyer paid in, with tax, while
    // the sale is recorded as what reached you. So the refund is turned into
    // the share of the sale it returned, then applied to what reached you.
    const back = parseMoney(r.gross) || { amount: Number(r.total) || 0, currency: String(r.currency || '').toUpperCase() };
    let amount = o.net;
    if (o.gross && back.currency && back.currency === o.gross.currency && o.gross.amount > 0) amount = o.net * Math.min(1, back.amount / o.gross.amount);
    else if (back.currency && back.currency === String(o.currency).toUpperCase() && back.amount > 0) amount = Math.min(o.net, back.amount);
    o.refunded = Math.min(o.net, o.refunded + amount);
    o.refundT = Date.parse(r.ts) || 0;
  });

  // Etsy: one sale per claimed order. A reissued key is the same order.
  const etsySeen = new Set();
  allKeys.forEach(k => {
    const key = String(k.key || '').trim().toUpperCase();
    if (!key.startsWith('ETSY-')) return;
    const id = String(k.orderId || key);
    if (etsySeen.has(id)) return;
    etsySeen.add(id);
    const tool = k.tool === 'sbp' ? 'sbp' : 'ubp';
    orders.set('etsy|' + id, {
      key: 'etsy|' + id, channel: 'etsy', orderId: id, orderNumber: '', t: Date.parse(k.issuedAt) || 0,
      email: String(k.email || '').trim().toLowerCase(), name: '', product: toolLabel(tool) + ' Planner', tool, variant: k.theme || '',
      net: ADMIN_PRICES[tool], currency: 'USD', gross: null, discount: '', codes: [], affiliate: '',
      test: false, refunded: 0, refundIds: new Set(), estimated: true, etsyKey: key
    });
  });

  // Has the buyer used their key yet? Lemon Squeezy and Etsy redemptions
  // carry something that leads back to the order. A Dodo redemption reports
  // the licence key's own id, which the sale never sees, so for Dodo this
  // stays unknown rather than guessing.
  const redeemedOrders = new Set(), redeemedCodes = new Set();
  redemptionEvents().forEach(e => {
    const d = e.detail || {};
    if (d.orderId) redeemedOrders.add(String(d.orderId));
    if (d.code) redeemedCodes.add(String(d.code).trim().toUpperCase());
  });
  const keyRedeemed = new Map();
  allKeys.forEach(k => { if (k.redeemCount > 0) keyRedeemed.set(String(k.key).trim().toUpperCase(), true); });

  return [...orders.values()].map(o => {
    o.kept = Math.max(0, o.net - o.refunded);
    o.status = o.test ? 'test' : o.refunded >= o.net - 0.005 && o.net > 0 ? 'refunded' : o.refunded > 0 ? 'partial' : 'paid';
    if (o.channel === 'dodo') o.redeemed = null;
    else if (o.channel === 'etsy') o.redeemed = redeemedCodes.has(o.etsyKey) || keyRedeemed.has(o.etsyKey);
    else o.redeemed = redeemedOrders.has(o.orderId) || (!!o.orderNumber && redeemedOrders.has(o.orderNumber));
    return o;
  }).sort((a, b) => b.t - a.t);
}
function ordersWithin(ledger, r) { return ledger.filter(o => within(o.t, r)); }
function isCounted(o) { return !o.test || showTestData; }

// Totals for a list of orders. Refunds come off the day of the sale, so a
// range's figure never goes negative because of an older order.
function salesSummary(list) {
  const counted = list.filter(isCounted);
  const s = {
    gross: 0, refunds: 0, net: 0, orders: 0, refundedOrders: 0, discounted: 0, affiliated: 0,
    tests: list.filter(o => o.test).length, testRevenue: list.filter(o => o.test).reduce((a, o) => a + o.net, 0),
    byChannel: { dodo: { orders: 0, revenue: 0 }, lemonsqueezy: { orders: 0, revenue: 0 }, etsy: { orders: 0, revenue: 0 } },
    estimated: 0
  };
  counted.forEach(o => {
    s.gross += o.net; s.refunds += o.refunded; s.net += o.kept;
    if (o.status === 'refunded') s.refundedOrders++;
    else {
      s.orders++;
      if (o.codes.length) s.discounted++;
      if (o.affiliate) s.affiliated++;
    }
    const c = s.byChannel[o.channel];
    if (c) { if (o.status !== 'refunded') c.orders++; c.revenue += o.kept; }
    if (o.estimated) s.estimated += o.kept;
  });
  s.aov = s.orders ? s.net / s.orders : 0;
  return s;
}

// Lemon Squeezy's own API knows about orders placed before the sale webhook
// was set up, which the Sales sheet never saw. When it reports more orders
// for the range than the sheet has, the difference is added (never the
// whole figure, which would count the sheet's orders twice).
let lsSales = { loaded: false, configured: false, revenue: 0, orders: 0, error: '', rangeKey: null };
let _lsFetchInFlight = false;
function ensureSalesForRange() {
  const key = (overviewFilters.from || '') + '|' + (overviewFilters.to || '');
  if (lsSales.rangeKey === key || _lsFetchInFlight || _sampleDataActive) return;
  _lsFetchInFlight = true;
  fetchLemonSqueezySales().then(() => {
    lsSales.rangeKey = key;
    _lsFetchInFlight = false;
    if (currentATab === 'overview' || currentATab === 'sales') (ADMIN_RENDERERS[currentATab])();
  });
}
function lsTopUp(summary) {
  const key = (overviewFilters.from || '') + '|' + (overviewFilters.to || '');
  if (_sampleDataActive || !lsSales.configured || lsSales.rangeKey !== key) return null;
  const sheet = summary.byChannel.lemonsqueezy;
  const extraOrders = lsSales.orders - sheet.orders;
  if (extraOrders <= 0) return null;
  return { orders: extraOrders, revenue: Math.max(0, lsSales.revenue - sheet.revenue) };
}
function applyLsTopUp(summary) {
  const extra = lsTopUp(summary);
  if (!extra) return summary;
  summary.orders += extra.orders; summary.net += extra.revenue; summary.gross += extra.revenue;
  summary.byChannel.lemonsqueezy.orders += extra.orders; summary.byChannel.lemonsqueezy.revenue += extra.revenue;
  summary.lsExtra = extra;
  summary.aov = summary.orders ? summary.net / summary.orders : 0;
  return summary;
}

function fetchLemonSqueezySales() {
  const endpoint = ADMIN_APPS_SCRIPT_URL;
  if (!endpoint) { lsSales = { loaded: true, configured: false, revenue: 0, orders: 0, error: '' }; return Promise.resolve(); }
  return new Promise(resolve => {
    const cb = `ezzoSalesCb${Date.now()}`;
    const script = document.createElement('script');
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      // Left as a no-op rather than deleted: a redirected or slow JSONP
      // response can still arrive after we have given up, and calling a
      // deleted global throws an uncaught error into the console.
      window[cb] = function () {};
      script.parentNode?.removeChild(script);
      resolve();
    };
    const timer = setTimeout(() => { lsSales = { loaded: true, configured: false, revenue: 0, orders: 0, error: 'timeout' }; finish(); }, 15000);
    window[cb] = res => {
      lsSales = (res && res.ok)
        ? { loaded: true, configured: !!res.configured, revenue: Number(res.revenue || 0), orders: Number(res.orders || 0), error: '' }
        : { loaded: true, configured: false, revenue: 0, orders: 0, error: (res && res.error) || 'failed' };
      finish();
    };
    const qs = new URLSearchParams({ action: 'sales', from: overviewFilters.from || '', to: overviewFilters.to || '', cb, _: String(Date.now()) });
    script.src = `${endpoint}?${qs}`;
    script.onerror = () => { lsSales = { loaded: true, configured: false, revenue: 0, orders: 0, error: 'network' }; finish(); };
    document.head.appendChild(script);
  });
}

// Discount codes and affiliates across a list of orders, refunds excluded.
function discountGroups(list) {
  const m = new Map();
  list.filter(o => isCounted(o) && o.status !== 'refunded').forEach(o => o.codes.forEach(code => {
    const g = m.get(code) || { label: code, orders: 0, revenue: 0 };
    g.orders++; g.revenue += o.kept; m.set(code, g);
  }));
  return [...m.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
}
function affiliateGroups(list) {
  const m = new Map();
  list.filter(o => isCounted(o) && o.status !== 'refunded' && o.affiliate).forEach(o => {
    const g = m.get(o.affiliate) || { label: o.affiliate, orders: 0, revenue: 0 };
    g.orders++; g.revenue += o.kept; m.set(o.affiliate, g);
  });
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}
function moneyTableHtml(groups, firstCol, empty) {
  if (!groups.length) return `<div class="chart-empty">${esc(empty)}</div>`;
  return `<div class="admin-table-wrap"><table class="admin-table adm-compact"><thead><tr><th>${esc(firstCol)}</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead><tbody>
    ${groups.slice(0, 8).map(g => `<tr><td class="admin-table-strong">${esc(g.label)}</td><td class="num">${fmt(g.orders)}</td><td class="num">${money(g.revenue)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function channelBreakdownHtml(summary) {
  const rows = ['dodo', 'lemonsqueezy', 'etsy'].map(c => ({ c, ...summary.byChannel[c] })).filter(r => r.orders || r.revenue);
  if (!rows.length) return '<div class="chart-empty">No sales in this range.</div>';
  const total = rows.reduce((a, r) => a + r.revenue, 0) || 1;
  return `<div class="adm-channels">${rows.map(r => `<div class="adm-channel">
      <div class="adm-channel-head"><span><i style="background:${CHANNEL_COLOR[r.c]}"></i>${esc(CHANNEL_LABEL[r.c])}${r.c === 'etsy' ? ' <small>est.</small>' : ''}</span><strong>${money(r.revenue)}</strong></div>
      <div class="adm-channel-track"><i style="width:${Math.round(r.revenue / total * 100)}%;background:${CHANNEL_COLOR[r.c]}"></i></div>
      <div class="adm-channel-meta">${fmt(r.orders)} order${r.orders === 1 ? '' : 's'} · ${Math.round(r.revenue / total * 100)}% of revenue</div>
    </div>`).join('')}</div>`;
}

// ── Horizontal bar list ───────────────────────────────────────────────
function hBarListHtml(groups, opts) {
  const o = opts || {};
  const rows = (groups || []).slice().sort((a, b) => b.value - a.value).slice(0, o.limit || 8);
  if (!rows.length) return `<div class="chart-empty">${esc(o.empty || 'No data yet.')}</div>`;
  const max = Math.max(...rows.map(r => r.value)) || 1;
  const total = (o.total != null ? o.total : rows.reduce((s, r) => s + r.value, 0));
  // Share is meaningless for money split across products - "$120 (60%)"
  // invites reading the percentage as a margin or a discount. Opt in only
  // where a proportion of a whole is actually the point, like locations.
  const showShare = o.showShare !== false;
  const prefix = o.prefix || '';
  return `<div class="admin-hbars">${rows.map(r => {
    const w = Math.round(r.value / max * 100);
    const share = total ? Math.round(r.value / total * 100) : 0;
    return `<div class="admin-hbar-row">
      <span class="admin-hbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="admin-hbar-track"><i style="width:${w}%"></i></span>
      <span class="admin-hbar-val">${esc(prefix)}${fmt(r.value)}${showShare ? `<small>${share}%</small>` : ''}</span>
    </div>`;
  }).join('')}</div>`;
}

// ── Vertical bar chart ────────────────────────────────────────────────
// For small categorical sets (device type) where a donut makes the reader
// compare arc angles to answer "which is bigger, and by how much".
function vBarChartHtml(groups, opts) {
  const o = opts || {};
  let rows = (groups || []).slice();
  // Always show the full set when one is given, so a category reading zero is
  // visible as a real zero rather than silently absent - "no tablet traffic"
  // is itself a finding.
  if (o.categories) {
    const byLabel = new Map(rows.map(r => [r.label, r.value]));
    rows = o.categories.map(label => ({ label, value: byLabel.get(label) || 0 }));
  } else {
    rows = rows.sort((a, b) => b.value - a.value).slice(0, o.limit || 6);
  }
  if (!rows.length) return `<div class="chart-empty">${esc(o.empty || 'No data yet.')}</div>`;
  const max = Math.max(...rows.map(r => r.value)) || 1;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return `<div class="admin-vbars">${rows.map(r => {
    const h = r.value > 0 ? Math.max(12, Math.round(r.value / max * 100)) : 0;
    const share = total ? Math.round(r.value / total * 100) : 0;
    return `<div class="admin-vbar-col">
      <span class="admin-vbar-track">
        <i style="height:${h}%">${r.value > 0 ? `<b>${fmt(r.value)}</b>` : ''}</i>
        ${r.value === 0 ? `<em class="admin-vbar-zero">0</em>` : ''}
      </span>
      <span class="admin-vbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="admin-vbar-share">${share}%</span>
    </div>`;
  }).join('')}</div>`;
}

// ── Conversion funnel ─────────────────────────────────────────────────
function funnelHtml(steps, opts) {
  const o = opts || {};
  const top = steps[0].value || 0;
  const last = steps[steps.length - 1].value || 0;
  // The headline number: what share of the top step ends in a sale. Shown
  // to two decimals under 1%, because a store at this size will sit there
  // for a while and rounding that to "0%" would hide real movement.
  const overall = top ? (last / top * 100) : 0;
  const overallTxt = overall > 0 && overall < 1 ? overall.toFixed(2) : overall.toFixed(1);
  const header = `<div class="admin-funnel-rate${o.tone ? ' admin-funnel-rate--' + o.tone : ''}">
    <div class="admin-funnel-rate-num">${overallTxt}%</div>
    <div class="admin-funnel-rate-label">${esc(o.label || 'overall conversion')}<small>${o.sub || ''}</small></div>
  </div>`;
  return header + `<div class="admin-funnel">${steps.map((s, i) => {
    const pctOfTop = top ? (s.value / top * 100) : 0;
    const prev = i > 0 ? steps[i - 1].value : null;
    const stepPct = (prev && prev > 0) ? Math.round(s.value / prev * 100) : null;
    // A later step can legitimately exceed an earlier one: a sale can come
    // from a checkout link this site never saw a buy-click for, or from
    // another device. Say so rather than printing "250% of previous step".
    const overflows = stepPct !== null && stepPct > 100;
    return `<div class="admin-funnel-step">
      <div class="admin-funnel-head">
        <span class="admin-funnel-label">${esc(s.label)}</span>
        <span class="admin-funnel-value">${fmt(s.value)}</span>
      </div>
      <div class="admin-funnel-track"><i style="width:${Math.min(100, Math.max(pctOfTop, s.value > 0 ? 2 : 0))}%;background:${s.color}"></i></div>
      <div class="admin-funnel-meta">
        ${stepPct === null
          ? `<span class="admin-funnel-conv">start of funnel</span>`
          : overflows
            ? `<span class="admin-funnel-conv">more than the step above</span>`
            : `<span class="admin-funnel-conv">${stepPct}% of previous step</span>`}
        ${s.note ? `<span class="admin-funnel-note">${esc(s.note)}</span>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── Time series ───────────────────────────────────────────────────────
// Buckets for the chart: by hour for a single day, by day otherwise. "All
// time" starts at the first thing ever recorded rather than at 1970.
function seriesBuckets() {
  const r = rangeMs();
  const now = Date.now();
  const single = overviewFilters.from && overviewFilters.from === overviewFilters.to;
  if (single) {
    const d = new Date(overviewFilters.from + 'T00:00:00');
    const isToday = overviewFilters.from === _isoDay(new Date());
    const hours = isToday ? new Date().getHours() + 1 : 24;
    return Array.from({ length: hours }, (_, h) => {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
      return { label: String(h).padStart(2, '0') + ':00', start, end: start + 3600000 };
    });
  }
  let fromMs = r.fromMs, toMs = Math.min(r.toMs, now);
  if (!isFinite(fromMs)) {
    const times = allEvents.map(eventTime).concat(salesLedger().map(o => o.t)).filter(t => t > 0);
    fromMs = times.length ? Math.min(...times) : now - 29 * 86400000;
  }
  if (!isFinite(toMs) || toMs < fromMs) toMs = Math.max(fromMs, now);
  const d = new Date(fromMs); d.setHours(0, 0, 0, 0);
  const out = [];
  while (d.getTime() <= toMs && out.length < 366) {
    const start = d.getTime();
    d.setDate(d.getDate() + 1);
    out.push({ label: dayKey(start), start, end: d.getTime() });
  }
  return out;
}
function visitorSeries(events, buckets) {
  return buckets.map(b => {
    const seen = new Set();
    events.forEach(e => { const t = eventTime(e); if (t >= b.start && t < b.end) seen.add(e.visitorId); });
    return { label: b.label, value: seen.size };
  });
}
function revenueSeries(orders, buckets) {
  return buckets.map(b => ({
    label: b.label,
    value: Math.round(orders.filter(o => isCounted(o) && o.t >= b.start && o.t < b.end).reduce((a, o) => a + o.kept, 0) * 100) / 100
  }));
}
function wireCharts(el) {
  requestAnimationFrame(() => {
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      const unit = scope.dataset.unit;
      wireChartHover(scope, '.spend-line-dot', { format: d => '<strong>' + esc(d.label) + '</strong><br>' + (unit === 'money' ? esc(money(d.val)) : esc(fmt(d.val)) + ' ' + esc(unit || 'visitor') + (d.val == 1 ? '' : 's')) });
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d => '<strong>' + esc(d.label) + '</strong><br>' + esc(fmt(d.val)) + ' · ' + parseFloat(d.pct || 0).toFixed(0) + '%' });
    });
  });
}
function refHost(e) {
  if (!e.referrer) return 'Direct';
  try {
    const h = new URL(e.referrer).hostname.replace(/^www\./, '');
    // A visitor moving between this site's own pages is not a referral.
    return /(^|\.)ezzohub\.com$/.test(h) || h === location.hostname ? 'Internal' : h;
  } catch (err) { return 'Other'; }
}

// ══════════════════════ Overview ══════════════════════
function renderOverview() {
  const el = document.getElementById('aview-overview');
  ensureSalesForRange();
  const R = rangeMs(), P = previousRangeMs();
  const rangeEvents = overviewFilteredEvents();
  const prevEvents = P ? allEvents.filter(e => isWebsiteEvent(e) && within(eventTime(e), P)) : null;
  const ledger = salesLedger();
  const rangeOrders = ordersWithin(ledger, R);
  const sales = applyLsTopUp(salesSummary(rangeOrders));
  const prevSales = P ? salesSummary(ordersWithin(ledger, P)) : null;

  // "Online now" is deliberately live rather than range-filtered - it answers
  // "who is here right now", which a historical range can't.
  const liveEvents = allEvents.filter(e => isOnlineNow(e) && isWebsiteEvent(e));
  const onlineNow = uniqueBy(liveEvents, e => e.visitorId).length;

  const visitors = uniqueBy(rangeEvents, e => e.visitorId).length;
  const prevVisitors = prevEvents ? uniqueBy(prevEvents, e => e.visitorId).length : null;
  const sessions = buildSessions(rangeEvents);
  const withDuration = sessions.filter(s => s.duration > 0);
  const avgDuration = withDuration.length ? withDuration.reduce((s, x) => s + x.duration, 0) / withDuration.length : 0;
  const engagedCount = sessions.filter(s => s.engaged).length;
  const bounceRate = sessions.length ? Math.round((1 - engagedCount / sessions.length) * 100) : 0;
  const conv = visitors ? sales.orders / visitors * 100 : 0;
  const prevConv = prevSales && prevVisitors ? prevSales.orders / prevVisitors * 100 : (prevSales ? 0 : null);
  const vsTitle = P ? `Compared with the ${P.days} day${P.days === 1 ? '' : 's'} before this range` : '';

  // Funnel, per person: trying the demo one evening and buying the next
  // morning is two sessions and one buyer.
  const commerce = commerceEventsIn(R);
  const demoPeople = new Set(commerce.filter(e => e.type === 'trial_started').map(e => e.visitorId));
  const buyPeople = new Set(commerce.filter(e => e.type === 'purchase_initiated').map(e => e.visitorId));
  const funnelSteps = [
    { label: 'Visitors', value: visitors, color: '#6366f1' },
    { label: 'Tried the demo', value: demoPeople.size, color: '#06b6d4', note: 'opened a free planner' },
    { label: 'Pressed buy', value: buyPeople.size, color: '#a855f7', note: 'reached checkout' },
    { label: 'Paid orders', value: sales.orders, color: '#10b981', note: 'all channels, refunds excluded' }
  ];

  const buckets = seriesBuckets();
  const single = buckets.length && buckets[0].label.includes(':');
  const visSeries = visitorSeries(rangeEvents, buckets);
  const revSeries = revenueSeries(rangeOrders, buckets);
  const visTotal = visSeries.reduce((s, p) => s + p.value, 0);
  const revTotal = revSeries.reduce((s, p) => s + p.value, 0);

  const deviceGroups = groupCount(uniqueVisitorEvents(rangeEvents), e => uaDevice(e.ua));
  const referrerGroups = groupCount(rangeEvents.filter(e => e.type === 'page_view').map(e => ({ _ref: refHost(e) })).filter(e => e._ref !== 'Internal'), e => e._ref);
  const pageGroups = groupCount(rangeEvents.filter(e => e.type === 'page_view'), e => pageLabel(e.page));
  const discounts = discountGroups(rangeOrders);

  const salesSub = [
    sales.refunds > 0 ? money(sales.refunds) + ' refunded' : '',
    sales.estimated > 0 ? 'incl. ' + money(sales.estimated) + ' Etsy est.' : '',
    sales.tests ? sales.tests + ' test' + (showTestData ? ' incl.' : ' excluded') : ''
  ].filter(Boolean).join(' · ') || 'after refunds';

  el.innerHTML = `
    ${pageHead('Overview', esc(formatRangeLabel()) + '. Website traffic and sales; activity inside the planner is on the Product tab.')}
    ${rangeBarHtml('ov')}

    ${statGrid([
      { icon: '💰', label: 'Net revenue', value: money(sales.net), sub: salesSub, tone: '#10b981', delta: deltaChip(sales.net, prevSales && prevSales.net, false, vsTitle),
        hint: 'Money that reached you: Dodo Payments and Lemon Squeezy sales from the sale webhooks, after tax and minus refunds, plus Etsy sales estimated at list price from claimed keys. Test orders only count when "Count test orders" is on (Sales tab).' },
      { icon: '🧾', label: 'Paid orders', value: fmt(sales.orders), sub: sales.orders ? money(sales.aov) + ' average' : 'none yet', tone: '#6366f1', delta: deltaChip(sales.orders, prevSales && prevSales.orders, false, vsTitle),
        hint: 'Orders in this range across every channel. Fully refunded orders are left out.' },
      { icon: '🎯', label: 'Conversion', value: conv.toFixed(conv > 0 && conv < 1 ? 2 : 1) + '%', sub: 'paid orders per visitor', tone: '#a855f7', delta: deltaChip(conv, prevConv, false, vsTitle),
        hint: 'Paid orders divided by unique website visitors in the same range.' },
      { icon: '👥', label: 'Visitors', value: fmt(visitors), sub: fmt(sessions.length) + ' sessions', tone: '#3b82f6', delta: deltaChip(visitors, prevVisitors, false, vsTitle),
        hint: 'Distinct people on the website (home, product page, claim and legal pages), told apart by a random on-device id.' }
    ])}

    <div class="adm-mini-stats">
      <div><span>Avg. visit</span><strong>${formatDuration(avgDuration)}</strong></div>
      <div><span>Bounce rate</span><strong>${bounceRate}%</strong></div>
      <div><span>Tried the demo</span><strong>${fmt(demoPeople.size)}</strong></div>
      <div><span>Pressed buy</span><strong>${fmt(buyPeople.size)}</strong></div>
      <div><span>Used a discount</span><strong>${fmt(sales.discounted)}</strong></div>
      <div><span>Via an affiliate</span><strong>${fmt(sales.affiliated)}</strong></div>
    </div>

    <div class="adm-grid adm-grid--wide-side">
      <div class="panel chart-panel spend-line-panel" data-chart-scope data-unit="money"><div class="panel-inner-sm">
        ${panelTitle(single ? 'Revenue by hour' : 'Revenue by day', 'Net revenue on the day each order was placed, refunds taken off that same order.')}
        ${revTotal > 0 ? svgSpendLine(revSeries, { w: 900, h: 240, curve: true }) + `<div class="spend-line-caption"><span class="spend-line-num">${money(revTotal)}</span><span class="spend-line-label">over this period</span></div>` : '<div class="chart-empty">No sales in this range yet.</div>'}
      </div></div>
      <div class="panel admin-globe-panel"><div class="panel-inner-sm">
        ${panelTitle('Online now', 'Visitors active in the last couple of minutes, placed by their browser-reported timezone. No IP lookup and no third-party geo service, so points are approximate by design. Drag to spin.')}
        <div class="admin-globe-wrap">
          <canvas id="adminGlobe" class="admin-globe" aria-label="Globe showing where visitors are online now"></canvas>
          <div class="admin-globe-count"><span id="adminGlobeNum">${fmt(onlineNow)}</span><small>online now</small></div>
        </div>
        <div class="admin-globe-legend" id="adminGlobeLegend"></div>
      </div></div>
    </div>

    <div class="adm-grid adm-grid--3">
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Visitor to buyer', 'Counted per person rather than per session. Paid orders can include sales from a checkout link this site never saw a buy-click for.')}
        ${funnelHtml(funnelSteps, { label: 'of visitors bought', sub: fmt(sales.orders) + ' paid order' + (sales.orders === 1 ? '' : 's') + ' from ' + fmt(visitors) + ' visitor' + (visitors === 1 ? '' : 's') })}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Sales by channel', 'Dodo Payments is the live checkout. Lemon Squeezy is the retired one. Etsy is estimated at list price from claimed keys.')}
        ${channelBreakdownHtml(sales)}
        ${sales.lsExtra ? `<p class="adm-note">Includes ${fmt(sales.lsExtra.orders)} earlier Lemon Squeezy order${sales.lsExtra.orders === 1 ? '' : 's'} reported by their API that were placed before the sale webhook existed.</p>` : ''}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Discount codes', 'Codes used at Dodo checkout, from the sale webhook. Recorded from the Apps Script update that added the Discount column onwards.')}
        ${moneyTableHtml(discounts, 'Code', 'No discount codes used in this range.')}
      </div></div>
    </div>

    <div class="panel chart-panel spend-line-panel" data-chart-scope data-unit="visitor"><div class="panel-inner-sm">
      ${panelTitle(single ? 'Visitors by hour' : 'Visitors by day', 'Distinct website visitors per ' + (single ? 'hour' : 'calendar day') + '.')}
      ${visTotal > 0 ? svgSpendLine(visSeries, { w: 900, h: 130, curve: true }) + `<div class="spend-line-caption"><span class="spend-line-num">${fmt(visitors)}</span><span class="spend-line-label">unique visitors over this period</span></div>` : '<div class="chart-empty">No visits in this range.</div>'}
    </div></div>

    <div class="adm-grid adm-grid--3">
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Referrers', 'Which site sent each page view here, grouped by domain. "Direct" means no referrer was recorded: a typed URL, a bookmark, or a privacy-blocked referrer. Moves between your own pages are left out.')}
        ${pieOrEmpty(referrerGroups, 'No data yet.')}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Pages viewed')}
        ${hBarListHtml(pageGroups, { empty: 'No page views yet.', limit: 6 })}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Devices', 'One count per visitor, by the device they first arrived on in this range.')}
        ${vBarChartHtml(deviceGroups, { categories: ['Desktop', 'Tablet', 'Mobile'] })}
      </div></div>
    </div>

    <div class="panel chart-panel"><div class="panel-inner-sm">
      ${panelTitle('Where visitors are', 'Grouped by the browser-reported timezone, the only geography signal collected.')}
      ${hBarListHtml(groupCount(uniqueVisitorEvents(rangeEvents), e => e.timezone).filter(g => g.label && g.label !== 'Unknown').map(g => ({ ...g, label: g.label.replace(/_/g, ' ') })), { empty: 'No data yet.', limit: 10 })}
    </div></div>`;

  wireRangeBar(el, 'ov', renderOverview);
  initFieldTips(el);
  mountLiveGlobe(liveEvents);
  wireCharts(el);
}
// The first event per visitor, so a chatty visitor counts once in a split.
function uniqueVisitorEvents(events) {
  const seen = new Map();
  events.forEach(e => { if (!seen.has(e.visitorId)) seen.set(e.visitorId, e); });
  return [...seen.values()];
}

// ── Live globe ────────────────────────────────────────────────────────
const GLOBE_LIVE_WINDOW_MS = 120000;
let _globeInstance = null;
let _globeTimezones = [];

let _globeRotation = 20;
function mountLiveGlobe(liveEvents) {
  const canvas = document.getElementById('adminGlobe');
  if (!canvas || typeof createLiveGlobe !== 'function') return;
  // The panel's innerHTML is rebuilt on every poll, so the old canvas is
  // already detached - keep its angle so the globe carries on from where it
  // was instead of jumping back to the start every refresh.
  if (_globeInstance) {
    _globeRotation = _globeInstance.getRotation();
    _globeInstance.destroy();
    _globeInstance = null;
  }
  updateGlobeData(liveEvents);
  _globeInstance = createLiveGlobe(canvas, () => globePointsFromTimezones(_globeTimezones), _globeRotation);
}

function updateGlobeData(liveEvents) {
  const now = Date.now();
  const recent = liveEvents || allEvents.filter(e => now - eventTime(e) <= GLOBE_LIVE_WINDOW_MS);
  // One entry per visitor, so a chatty tab doesn't outweigh a quiet one.
  const byVisitor = new Map();
  recent.forEach(e => { if (e.timezone) byVisitor.set(e.visitorId, e.timezone); });
  _globeTimezones = Array.from(byVisitor.values());

  const legend = document.getElementById('adminGlobeLegend');
  if (legend) {
    const pts = globePointsFromTimezones(_globeTimezones).sort((a, b) => b.count - a.count).slice(0, 4);
    legend.innerHTML = pts.length
      ? pts.map(p => '<span class="admin-globe-chip"><i></i>' + esc(p.label.split('/').pop().replace(/_/g, ' ')) + (p.count > 1 ? ' ×' + p.count : '') + '</span>').join('')
      : '<span class="admin-globe-empty">Nobody online right now.</span>';
  }
  const num = document.getElementById('adminGlobeNum');
  if (num) num.textContent = fmt(new Set(recent.map(e => e.visitorId)).size);
}

// Hour-by-hour equivalent of dailyUniqueVisitorSeries, for the Today range.
function hourlyUniqueVisitorSeries(events) {
  const now = new Date();
  const out = [];
  for (let h = 0; h <= now.getHours(); h++) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).getTime();
    const end = start + 3600000;
    const seen = new Set();
    events.forEach(e => { const t = eventTime(e); if (t >= start && t < end) seen.add(e.visitorId); });
    out.push({ label: String(h).padStart(2, '0') + ':00', value: seen.size });
  }
  return out;
}

// ── Helpers still needed after the Live/Traffic/Product/Insights tabs were
// removed: Redemptions builds its rows here, and Summary reads per-tool
// engagement from toolInsights.
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayOfWeekCounts(events) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  events.forEach(e => { const t = eventTime(e); if (t) counts[new Date(t).getDay()]++; });
  const max = Math.max(1, ...counts);
  return DOW_LABELS.map((label, i) => ({ label, value: counts[i], pct: Math.round(counts[i] / max * 100) }));
}
function tabUsageGroups(events) {
  return groupCount(events.filter(e => e.type === 'tab_viewed'), e => TAB_LABELS[e.detail && e.detail.tab] || (e.detail && e.detail.tab) || 'Unknown');
}
function featureAdoptionGroups(events) {
  return groupCount(events.filter(e => e.type === 'feature_used'), e => FEATURE_LABELS[e.detail && e.detail.feature] || (e.detail && e.detail.feature) || 'Unknown');
}
function layoutGroups(events) {
  return groupCount(events.filter(e => e.type === 'dashboard_layout_changed'), e => LAYOUT_LABELS[String(e.detail && e.detail.layout)] || 'Unknown');
}

function toolInsights(tool) {
  const events = allEvents.filter(e => e.page === tool);
  const sessions = buildSessions(events);
  const visitors = uniqueBy(events, e => e.visitorId);
  const withDuration = sessions.filter(s => s.duration > 0);
  const avgDuration = withDuration.length ? withDuration.reduce((s, x) => s + x.duration, 0) / withDuration.length : 0;
  const engagedCount = sessions.filter(s => s.engaged).length;
  const bounceRate = sessions.length ? Math.round((1 - engagedCount / sessions.length) * 100) : 0;
  const nr = newReturningSplit(events);
  const returningPct = nr.total ? Math.round(nr.returningCount / nr.total * 100) : 0;

  const redeemers = new Set(allEvents.filter(e => e.type === 'launch_code_redeemed' && e.detail && e.detail.tool === tool).map(e => e.visitorId));
  const redeemedFromVisitors = visitors.filter(v => redeemers.has(v)).length;
  const conversionPct = visitors.length ? Math.round(redeemedFromVisitors / visitors.length * 100) : 0;

  return {
    tool, visitorCount: visitors.length, sessionCount: sessions.length, avgDuration, bounceRate, returningPct,
    redeemedFromVisitors, conversionPct,
    syncGroups: groupCount(events.filter(e => e.type === 'sync_mode_chosen'), e => (e.detail && e.detail.mode) === 'google' ? 'Google Drive' : 'Local device'),
    themeGroups: groupCount(events.filter(e => e.type === 'theme_changed'), e => (e.detail && e.detail.theme) || 'Unknown'),
    deviceGroups: groupCount(events, e => uaDevice(e.ua)),
    dow: dayOfWeekCounts(events),
    tabGroups: tabUsageGroups(events),
    featureGroups: featureAdoptionGroups(events),
    layoutGroups: layoutGroups(events)
  };
}

// ── Which budget planner's insights are on screen ───────────────────────
// Braydon has two tools (Simple Budget / Ultimate Budget) each getting a
// full insights section below. This selector picks WHICH tool's section(s)
// are on screen - it does not hide/show individual metrics; every card
// always renders for whichever tool(s) are selected. Persisted so the
// chosen view survives reloads/sign-outs.
const INSIGHTS_VIEW_KEY = 'evobudget_admin_insights_view';
const INSIGHT_CARD_DEFS = [
  { id: 'funnel', title: 'Activation funnel', full: true },
  { id: 'tabUsage', title: 'Section usage' },
  { id: 'featureAdoption', title: 'Feature adoption' },
  { id: 'layoutPref', title: 'Dashboard layout' },
  { id: 'syncMode', title: 'Sync mode chosen' },
  { id: 'theme', title: 'Theme preference' },
  { id: 'dow', title: 'Busiest day of week' },
  { id: 'device', title: 'Device type' }
];
function redemptionEvents() { return allEvents.filter(e => e.type === 'launch_code_redeemed'); }
function redemptionRows() {
  const events = redemptionEvents();
  // Buyers no longer type an order ID, so for an Etsy key the order lives in
  // the Keys sheet against that key. Resolving it here rather than trusting
  // whatever the event happened to carry means it also fills in for keys
  // redeemed before that lookup existed, instead of only for new ones.
  const orderByKey = new Map();
  allKeys.forEach(k => {
    if (k.key && k.orderId) orderByKey.set(String(k.key).trim().toUpperCase(), String(k.orderId));
  });
  const resolveOrderId = e => {
    const fromEvent = (e.detail && e.detail.orderId) || '';
    if (fromEvent) return fromEvent;
    const code = String((e.detail && e.detail.code) || '').trim().toUpperCase();
    return orderByKey.get(code) || '';
  };

  // Flags order IDs reused across more than one visitor - a strong signal
  // someone is sharing/reusing a single real order ID with an invalid code,
  // even though no format validation could ever catch that on its own.
  const byOrderId = new Map();
  events.forEach(e => {
    const oid = resolveOrderId(e);
    if (!oid) return;
    if (!byOrderId.has(oid)) byOrderId.set(oid, new Set());
    byOrderId.get(oid).add(e.visitorId);
  });
  return events.map(e => {
    const orderId = resolveOrderId(e);
    const reuseCount = orderId ? byOrderId.get(orderId).size : 0;
    return {
      when: eventTime(e), code: (e.detail && e.detail.code) || '', tool: (e.detail && e.detail.tool) || '',
      orderId, visitorId: e.visitorId, timezone: e.timezone, reused: reuseCount > 1, reuseCount
    };
  }).sort((a, b) => b.when - a.when);
}
function redemptionSearchBarHtml() {
  const hasFilters = redemptionFilters.q || redemptionFilters.tool || redemptionFilters.onlyReused;
  return `<div class="admin-filter-bar">
    <input type="text" id="admRedemptionSearch" placeholder="Search order ID, license key, or email..." value="${esc(redemptionFilters.q)}" aria-label="Search redemptions">
    <select id="admRedemptionTool" aria-label="Tool">
      <option value="">All tools</option>
      <option value="sbp"${redemptionFilters.tool === 'sbp' ? ' selected' : ''}>Simple Budget</option>
      <option value="ubp"${redemptionFilters.tool === 'ubp' ? ' selected' : ''}>Ultimate Budget</option>
    </select>
    <label class="admin-search-toggle${redemptionFilters.onlyReused ? ' is-active' : ''}">
      <input type="checkbox" id="admRedemptionOnlyReused"${redemptionFilters.onlyReused ? ' checked' : ''}> ⚠️ Reused order IDs only
    </label>
    ${hasFilters ? `<button class="admin-filter-clear" id="admRedemptionClear" type="button">Clear filters</button>` : ''}
  </div>`;
}
function wireRedemptionFilters() {
  const searchInput = document.getElementById('admRedemptionSearch');
  searchInput?.addEventListener('input', e => {
    redemptionFilters.q = e.target.value;
    const pos = e.target.selectionStart;
    renderRedemptions();
    const el2 = document.getElementById('admRedemptionSearch');
    if (el2) { el2.focus(); el2.setSelectionRange(pos, pos); }
  });
  document.getElementById('admRedemptionTool')?.addEventListener('change', e => { redemptionFilters.tool = e.target.value; renderRedemptions(); });
  document.getElementById('admRedemptionOnlyReused')?.addEventListener('change', e => { redemptionFilters.onlyReused = e.target.checked; renderRedemptions(); });
  document.getElementById('admRedemptionClear')?.addEventListener('click', () => { redemptionFilters.q = ''; redemptionFilters.tool = ''; redemptionFilters.onlyReused = false; renderRedemptions(); });
}
// Mirrors KEY_DEVICE_LIMIT in Code.gs. Only used for display/filtering here -
// the limit is actually enforced server-side, where it cannot be edited.
const ETSY_DEVICE_LIMIT = 3;

// ══════════════════════ Redemption Activity ══════════════════════
// One row per licence key, not per redemption event. These used to be two
// tables ("Redemption activity" and "Issued Etsy keys") showing largely the
// same facts, so revoking meant finding the same key again on the other one.
// A key is what you actually act on, so a key is the row: the redemption
// events behind it collapse into its counts.
//
// Covers both channels. Etsy keys come from the Keys sheet, so they show up
// from the moment they're claimed, redeemed or not. Lemon Squeezy keys and
// the original fixed launch codes never touch that sheet, so they're folded
// in from the redemption events instead.

// Keys are told apart by shape, not by a list. The list used to be here as
// well as in script.js, which meant the launch codes were readable from two
// public files rather than one.
const SOURCE_LABEL = { etsy: 'Etsy', lemonsqueezy: 'Lemon Squeezy', dodo: 'Dodo Payments', launch: 'Launch code' };

function keySource(key, reported) {
  // The app says which checkout validated a key (detail.source); only keys
  // redeemed before it started saying so are told apart by shape.
  if (reported === 'dodo' || reported === 'lemonsqueezy') return reported;
  const k = String(key || '').trim().toUpperCase();
  if (k.startsWith('ETSY-')) return 'etsy';
  // Lemon Squeezy issues UUIDs; a launch code is a short unbroken run of
  // letters and digits.
  if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(k)) return 'lemonsqueezy';
  if (/^[0-9A-Z]{4,12}$/.test(k)) return 'launch';
  return 'dodo';
}

function redemptionActivityRows() {
  const byKey = new Map();

  // Start from the Keys sheet so claimed-but-never-redeemed keys still show.
  allKeys.forEach(k => {
    const key = String(k.key || '').trim();
    if (!key) return;
    byKey.set(key.toUpperCase(), {
      key, tool: k.tool || '', theme: k.theme || '', orderId: String(k.orderId || ''), email: k.email || '',
      devices: k.devices.length, redeemed: Number(k.redeemCount || 0),
      status: k.status === 'revoked' ? 'revoked' : 'active',
      sheetRow: k.row, source: keySource(key), lastSeen: 0, visitors: new Set(), fromEventsOnly: false
    });
  });

  // Fold in what the redemption events know, creating rows for keys that have
  // no sheet record at all (Lemon Squeezy and launch codes).
  redemptionEvents().forEach(e => {
    const raw = String((e.detail && e.detail.code) || '').trim();
    if (!raw) return;
    let row = byKey.get(raw.toUpperCase());
    if (!row) {
      row = {
        key: raw, tool: (e.detail && e.detail.tool) || '', theme: '', orderId: '', email: '',
        devices: 0, redeemed: 0, status: 'active', sheetRow: null,
        source: keySource(raw, e.detail && e.detail.source), lastSeen: 0, visitors: new Set(), fromEventsOnly: true
      };
      byKey.set(raw.toUpperCase(), row);
    }
    if (!row.orderId && e.detail && e.detail.orderId) row.orderId = String(e.detail.orderId);
    if (!row.tool && e.detail && e.detail.tool) row.tool = e.detail.tool;
    row.visitors.add(e.visitorId);
    row.lastSeen = Math.max(row.lastSeen, eventTime(e));
    if (row.fromEventsOnly) row.redeemed++;
  });

  // A Lemon Squeezy redemption carries an order id but no buyer, since all
  // the buyer ever does is type a key. The sale webhook knows who they are,
  // so the two are matched on the order. Either identifier will do, because
  // older rows recorded order_number where newer ones record order_id.
  if (allSales.length) {
    const byOrder = new Map();
    allSales.filter(o => PAID_EVENTS.has(o.event)).forEach(o => {
      const rec = { email: o.email || '', orderNumber: o.orderNumber || '', test: o.mode === 'test' };
      if (o.orderId) byOrder.set(String(o.orderId), rec);
      if (o.orderNumber) byOrder.set(String(o.orderNumber), rec);
    });
    byKey.forEach(r => {
      if (!r.orderId) return;
      const hit = byOrder.get(String(r.orderId));
      if (!hit) return;
      if (!r.email && hit.email) r.email = hit.email;
      // Show the number the buyer was given, keeping the internal one for
      // the detail panel so nothing is lost.
      if (hit.orderNumber && hit.orderNumber !== r.orderId) {
        r.internalOrderId = r.orderId;
        r.orderId = hit.orderNumber;
      }
      r.testOrder = hit.test;
    });
  }

  // An order ID reached from more than one visitor is the strongest abuse
  // signal here, so it survives the merge onto the key row.
  const visitorsByOrder = new Map();
  byKey.forEach(r => {
    if (!r.orderId) return;
    if (!visitorsByOrder.has(r.orderId)) visitorsByOrder.set(r.orderId, new Set());
    const bucket = visitorsByOrder.get(r.orderId);
    r.visitors.forEach(v => bucket.add(v));
  });

  return Array.from(byKey.values()).map(r => {
    const reuseCount = r.orderId ? visitorsByOrder.get(r.orderId).size : 0;
    r.devices = r.fromEventsOnly ? r.visitors.size : r.devices;
    r.reused = reuseCount > 1;
    r.reuseCount = reuseCount;
    return r;
  }).sort((a, b) => b.lastSeen - a.lastSeen);
}

function filteredActivityRows() {
  const q = redemptionFilters.q.trim().toLowerCase();
  return redemptionActivityRows().filter(r => {
    if (redemptionFilters.tool && r.tool !== redemptionFilters.tool) return false;
    if (redemptionFilters.onlyReused && !r.reused) return false;
    if (!q) return true;
    return [r.key, r.orderId, r.email, r.tool].some(v => String(v).toLowerCase().includes(q));
  });
}

function activityTableHtml(rows) {
  const head = `<tr><th class="admin-col-expand"></th><th>Order ID</th><th>Tool</th><th>License Key</th><th class="admin-col-action"></th></tr>`;
  if (!rows.length) {
    const msg = _keysFetchError
      ? `Couldn't read the Keys sheet - Google said: ${esc(_keysFetchError)}. If that mentions a missing range, the sheet doesn't exist yet: it's created automatically the first time someone claims a key. Otherwise check the tab is named exactly "Keys" in the spreadsheet this dashboard reads.`
      : (redemptionActivityRows().length ? 'No keys match your filters.' : 'No keys issued or redeemed yet.');
    return `<div class="admin-table-wrap"><table class="admin-table"><thead>${head}</thead><tbody>
      <tr class="admin-empty-row"><td colspan="5">${msg}</td></tr>
    </tbody></table></div>`;
  }
  return `<div class="admin-table-wrap"><table class="admin-table admin-activity-table"><thead>${head}</thead><tbody>
    ${rows.map((r, i) => {
      const revoked = r.status === 'revoked';
      const id = `k${i}`;
      // Launch codes are one shared list baked into the app, so revoking one
      // would lock out every buyer who was ever sent it. Offering the button
      // would only invite doing real damage by accident.
      const canRevoke = r.source !== 'launch' && r.source !== 'dodo';
      return `<tr class="admin-activity-row${revoked ? ' admin-row-muted' : ''}">
        <td class="admin-col-expand"><button class="admin-expand-btn" type="button" data-expand="${id}" aria-expanded="false" aria-label="Show details for ${esc(r.key)}">▸</button></td>
        <td class="admin-table-strong">${r.orderId ? esc(r.orderId) : '<span class="admin-table-muted">-</span>'}${r.testOrder ? ' <span class="admin-src-badge">TEST</span>' : ''}${r.reused ? ` <span class="admin-reuse-badge" title="This order ID was used by ${r.reuseCount} different visitors">⚠ ×${r.reuseCount}</span>` : ''}</td>
        <td>${esc(toolLabel(r.tool))}</td>
        <td class="admin-key-cell">${esc(r.key)} <span class="admin-src-badge">${esc(SOURCE_LABEL[r.source])}</span></td>
        <td class="admin-col-action">${canRevoke
          ? `<button class="btn btn-ghost btn-sm admin-key-toggle" type="button" data-key="${esc(r.key)}" data-source="${r.source}" data-tool="${esc(r.tool)}" data-order="${esc(r.orderId)}" data-row="${r.sheetRow || ''}" data-next="${revoked ? 'active' : 'revoked'}">${revoked ? 'Restore' : 'Revoke'}</button>`
          : r.source === 'dodo'
            ? `<span class="admin-table-muted" title="Disable this key in the Dodo Payments dashboard. Every device that used it is locked out at its next daily check.">revoke in Dodo</span>`
            : `<span class="admin-table-muted" title="Launch codes are shared by every buyer who received one, so revoking would lock all of them out">shared code</span>`}</td>
      </tr>
      <tr class="admin-activity-detail" data-detail="${id}" hidden><td colspan="5">
        <div class="admin-detail-grid">
          <div><span>Email</span><strong>${r.email ? esc(r.email) : '-'}</strong></div>
          <div><span>Devices</span><strong>${r.source === 'etsy' ? `${r.devices}/${ETSY_DEVICE_LIMIT}${r.devices >= ETSY_DEVICE_LIMIT ? ' <em class="admin-reuse-badge">full</em>' : ''}` : fmt(r.devices)}</strong></div>
          <div><span>Redeemed</span><strong>${fmt(r.redeemed)} time${r.redeemed === 1 ? '' : 's'}</strong></div>
          <div><span>Status</span><strong>${revoked ? 'Revoked' : 'Active'}</strong></div>
          <div><span>Source</span><strong>${esc(SOURCE_LABEL[r.source])}${r.theme ? esc(' · ' + r.theme) : ''}</strong></div>
          <div><span>Last redeemed</span><strong>${r.lastSeen ? esc(relTime(r.lastSeen)) : 'never'}</strong></div>
        </div>
      </td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function renderRedemptions() {
  const el = document.getElementById('aview-keys');
  const all = redemptionActivityRows();
  const rows = filteredActivityRows();
  const uniqueOrderIds = uniqueBy(all.filter(r => r.orderId), r => r.orderId).length;
  const reusedOrderIds = uniqueBy(all.filter(r => r.reused), r => r.orderId).length;
  const revokedCount = all.filter(r => r.status === 'revoked').length;

  el.innerHTML = `
    ${pageHead('License keys', 'Every key from Dodo Payments, Etsy and Lemon Squeezy, all time, one row per key. Expand a row for the buyer, devices and history. Revoking blocks new activations; a Dodo key is also refused at each device\'s next check, while an Etsy or Lemon Squeezy unlock stays on devices that already have it.')}
    ${kpiRow([
      { icon: '🔑', label: 'License keys', value: fmt(all.length), sub: 'issued or redeemed', color: '#6366f1', hint: 'Every key that has been claimed or redeemed, across Dodo Payments, Etsy, Lemon Squeezy and the original launch codes.' },
      { icon: '🧾', label: 'Unique order IDs', value: fmt(uniqueOrderIds), sub: '', color: '#14b8a6', hint: 'Distinct order IDs across all keys. Etsy orders come from the claim at /claim, Lemon Squeezy orders from the checkout, and a Dodo key reports its licence id.' },
      { icon: '⚠️', label: 'Reused order IDs', value: fmt(reusedOrderIds), sub: 'same order, different visitors', color: '#f43f5e', hint: 'An order ID seen from more than one visitor - the strongest signal worth investigating here, since a real order should only ever be used by one person.' },
      { icon: '🚫', label: 'Revoked', value: fmt(revokedCount), sub: '', color: '#64748b', hint: 'Keys you have disabled. They can no longer be redeemed on a new device.' }
    ])}
    ${redemptionSearchBarHtml()}
    <div class="panel"><div class="panel-inner-sm">
      ${activityTableHtml(rows)}
    </div></div>`;
  wireRedemptionFilters();
  wireActivityRows(el);
  initFieldTips(el);
}

function wireActivityRows(scope) {
  scope.querySelectorAll('.admin-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const detail = scope.querySelector(`.admin-activity-detail[data-detail="${btn.dataset.expand}"]`);
      if (!detail) return;
      const opening = detail.hidden;
      detail.hidden = !opening;
      btn.textContent = opening ? '▾' : '▸';
      btn.setAttribute('aria-expanded', String(opening));
      btn.classList.toggle('is-open', opening);
    });
  });

  scope.querySelectorAll('.admin-key-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { key, source, tool, order, next } = btn.dataset;
      const rowNum = Number(btn.dataset.row) || 0;
      if (next === 'revoked' && !await confirmDialog({
        message: source === 'lemonsqueezy'
          ? 'Revoke this key? It gets disabled in Lemon Squeezy itself, so it stops working for any new device. Anyone who already unlocked with it keeps access.'
          : 'Revoke this key? It will stop working for any new device. Anyone who already unlocked with it keeps access.',
        confirmText: 'Revoke'
      })) return;

      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        if (source === 'lemonsqueezy') {
          const res = await lemonSqueezySetKeyDisabled(key, next === 'revoked', tool, order);
          if (!res || !res.ok) throw new Error((res && res.error) || 'failed');
          // The Apps Script mirrors the new status back into the Keys sheet,
          // so re-reading it is what makes the change stick across a reload.
          allKeys = await adminFetchKeys(_adminAccessToken).catch(() => allKeys);
        } else {
          if (!rowNum) throw new Error('no_row');
          await adminSetKeyStatus(rowNum, next);
          const rec = allKeys.find(k => k.row === rowNum);
          if (rec) rec.status = next;
        }
        renderRedemptions();
        showToast(next === 'revoked' ? 'Key revoked' : 'Key restored');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        showToast(
          err.message === 'not_configured' ? 'Add LEMONSQUEEZY_API_KEY in Apps Script Script Properties to revoke their keys.'
          : err.message === 'not_found' ? "Lemon Squeezy doesn't recognise that key."
          : err.message === 'timeout' ? 'Lemon Squeezy took too long to answer. Try again.'
          : "Couldn't update the key. Check your connection and try again."
        );
      }
    });
  });
}

// Lemon Squeezy keys are disabled in Lemon Squeezy itself, not flagged
// locally: they validate their own keys against their own API, so a flag in
// our sheet would stop nothing. Goes through the Apps Script because the API
// key that authorises it must never sit in this public file.
function lemonSqueezySetKeyDisabled(key, disable, tool, orderId) {
  return new Promise(resolve => {
    const cb = `ezzoRevokeCb${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let settled = false;
    const finish = res => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Left as a no-op rather than deleted: a redirected or slow JSONP
      // response can still arrive after we have given up, and calling a
      // deleted global throws an uncaught error into the console.
      window[cb] = function () {};
      script.remove();
      resolve(res);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 25000);
    window[cb] = res => finish(res || { ok: false, error: 'failed' });
    const qs = new URLSearchParams({
      action: 'lsrevoke', key, disable: String(!!disable),
      tool: tool || '', orderId: orderId || '', cb, _: String(Date.now())
    });
    script.src = `${ADMIN_APPS_SCRIPT_URL}?${qs}`;
    script.onerror = () => finish({ ok: false, error: 'network' });
    document.head.appendChild(script);
  });
}

// ══════════════════════ Danger zone UI (Settings tab) ══════════════════════
function dangerZoneMatchCount() { return eventsInRange(dangerZoneState.from, dangerZoneState.to).length; }
function dangerZoneHtml() {
  if (_sampleDataActive) {
    return `
      <div class="settings-card-title">🗑️ Danger zone</div>
      <p class="admin-danger-sub">Permanently delete analytics events recorded in a custom date range. This cannot be undone.</p>
      <p class="admin-danger-count admin-table-muted">Exit sample data first - deletion isn't available while viewing test data.</p>`;
  }
  const hasRange = dangerZoneState.from || dangerZoneState.to;
  const count = dangerZoneMatchCount();
  return `
    <div class="settings-card-title">🗑️ Danger zone</div>
    <p class="admin-danger-sub">Permanently delete analytics events recorded in a custom date range. This cannot be undone.</p>
    <div class="admin-filter-bar" style="margin-bottom:12px">
      ${styledDateField('dzFrom', 'dzFromWrap', dangerZoneState.from)}
      ${styledDateField('dzTo', 'dzToWrap', dangerZoneState.to)}
    </div>
    ${hasRange
      ? `<div class="admin-danger-count${count ? '' : ' admin-table-muted'}">${count ? `<strong>${fmt(count)}</strong> event${count === 1 ? '' : 's'} match this range.` : 'No events match this range.'}</div>`
      : `<div class="admin-danger-count admin-table-muted">Pick a start and/or end date to see how many events would be deleted.</div>`}
    ${!dangerZoneState.confirmOpen
      ? `<button class="btn btn-danger" id="dzDeleteBtn" type="button"${(!count || dangerZoneState.busy) ? ' disabled' : ''}>Delete events in range</button>`
      : `<div class="admin-danger-confirm">
          <p>Type <strong>DELETE</strong> below to permanently remove ${fmt(count)} event${count === 1 ? '' : 's'}. This cannot be undone.</p>
          <input type="text" id="dzConfirmInput" class="admin-danger-confirm-input" placeholder="DELETE" value="${esc(dangerZoneState.confirmText)}" autocomplete="off" autocapitalize="off" spellcheck="false"${dangerZoneState.busy ? ' disabled' : ''}>
          <div class="admin-danger-confirm-actions">
            <button class="btn btn-ghost" id="dzCancelBtn" type="button"${dangerZoneState.busy ? ' disabled' : ''}>Cancel</button>
            <button class="btn btn-danger" id="dzConfirmBtn" type="button"${(dangerZoneState.confirmText.trim().toUpperCase() !== 'DELETE' || dangerZoneState.busy) ? ' disabled' : ''}>${dangerZoneState.busy ? 'Deleting…' : 'Permanently delete'}</button>
          </div>
        </div>`}
    ${dangerZoneState.resultMsg ? `<p class="admin-danger-result">${esc(dangerZoneState.resultMsg)}</p>` : ''}`;
}
function wireDangerZone() {
  bindDateField('dzFrom', 'dzFromWrap', v => { dangerZoneState.from = v; dangerZoneState.resultMsg = ''; renderSettings(); });
  bindDateField('dzTo', 'dzToWrap', v => { dangerZoneState.to = v; dangerZoneState.resultMsg = ''; renderSettings(); });
  document.getElementById('dzDeleteBtn')?.addEventListener('click', () => {
    dangerZoneState.confirmOpen = true; dangerZoneState.confirmText = ''; dangerZoneState.resultMsg = '';
    renderSettings();
  });
  document.getElementById('dzCancelBtn')?.addEventListener('click', () => {
    dangerZoneState.confirmOpen = false; dangerZoneState.confirmText = '';
    renderSettings();
  });
  const confirmInput = document.getElementById('dzConfirmInput');
  confirmInput?.addEventListener('input', e => {
    dangerZoneState.confirmText = e.target.value;
    const pos = e.target.selectionStart;
    renderSettings();
    const el2 = document.getElementById('dzConfirmInput');
    if (el2) { el2.focus(); el2.setSelectionRange(pos, pos); }
  });
  document.getElementById('dzConfirmBtn')?.addEventListener('click', async () => {
    if (dangerZoneState.confirmText.trim().toUpperCase() !== 'DELETE' || dangerZoneState.busy) return;
    dangerZoneState.busy = true; renderSettings();
    try {
      const deletedCount = await adminDeleteEventsInRange(_adminAccessToken, dangerZoneState.from, dangerZoneState.to);
      allEvents = await adminFetchEvents(_adminAccessToken);
      _lastFetched = Date.now();
      dangerZoneState.busy = false;
      dangerZoneState.confirmOpen = false;
      dangerZoneState.confirmText = '';
      dangerZoneState.from = '';
      dangerZoneState.to = '';
      dangerZoneState.resultMsg = `Deleted ${fmt(deletedCount)} event${deletedCount === 1 ? '' : 's'}.`;
      renderSettings();
    } catch (e) {
      dangerZoneState.busy = false;
      dangerZoneState.resultMsg = adminFriendlyError(e);
      renderSettings();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Ezzo integration (penny.js loaded verbatim, unmodified - see admin.html)
// ══════════════════════════════════════════════════════════════════════
// penny.js was written for the budgeting tools and expects a handful of
// globals those tools normally supply (state, t()/tf(), showToast(),
// confirmDialog(), showHelp(), switchTab()). None of that exists here, so
// this section provides admin-appropriate equivalents - minimal shims for
// the generic UI plumbing, and analytics-flavored data access. Nothing
// below EDITS penny.js: pennyBuildSystemInstruction/pennyToolDeclarations/
// pennyExecuteTool/pennyRenderQuickActions are plain `function` re-
// declarations, which - because this script tag loads AFTER penny.js's -
// simply overwrite those three names in the shared global scope, the same
// way any later <script> tag can redefine an earlier one's function. Every
// OTHER Ezzo mechanic (encrypted key vault, Gemini streaming, model
// fallback chain, chat drawer, markdown rendering, voice) is the exact
// same unmodified code the budgeting tools use.

// ── Minimal state/i18n/UI shims penny.js expects as globals ─────────────
const ADMIN_PENNY_SETTINGS_KEY = 'evobudget_admin_penny_settings';
function loadAdminPennySettings() {
  try { return JSON.parse(localStorage.getItem(ADMIN_PENNY_SETTINGS_KEY) || '{}'); } catch (e) { return {}; }
}
// A deliberately tiny stand-in for the app's real `state` - just enough
// for Ezzo's own (unmodified) settings-card wiring to read/write a
// pennyEnabled flag and a language default. Nothing else in admin.js
// reads or writes this.
let state = { settings: { pennyEnabled: !!loadAdminPennySettings().pennyEnabled, language: 'en' } };
function saveState() { localStorage.setItem(ADMIN_PENNY_SETTINGS_KEY, JSON.stringify({ pennyEnabled: !!state.settings.pennyEnabled })); }

// English-only strings for exactly the t()/tf() keys Ezzo's UI code
// reads (this dashboard has one user and no language picker, same
// reasoning as the date-picker port above). A few are reworded from the
// budgeting tools' originals (e.g. "AI Analytics Assistant" instead of
// "AI Budget Assistant") to fit this context; the mechanics they drive
// are 100% the same unmodified penny.js code.
const ADMIN_T_STRINGS = {
  cancel: 'Cancel', save: 'Save', ok: 'OK',
  sett_penny_h: 'Ezzo (AI Analytics Assistant)',
  sett_penny_desc: 'Ask Ezzo questions about your site’s analytics',
  sett_penny_toggle: 'Enable Ezzo',
  sett_penny_hint: 'Turns on the Ezzo assistant and its icon in the navigation bar.',
  sett_penny_key_label: 'Gemini API Key',
  sett_penny_key_placeholder: 'Paste your Gemini API key',
  sett_penny_howto: 'How to create my key',
  sett_penny_save_btn: 'Save key',
  sett_penny_key_saved: 'Gemini API key saved and encrypted',
  sett_penny_remove: 'Remove key',
  sett_penny_available: 'Ezzo is now available in the navigation bar.',
  sett_penny_usage_count: 'Ezzo has answered {0} questions this month',
  sett_penny_key_error_short: "That doesn't look like a valid key. Please check and try again.",
  confirm_penny_remove_key: 'Remove your saved Gemini API key? Ezzo will be turned off until you add a new one.',
  toast_saved: 'Saved.',
  toast_penny_key_saved: 'Gemini key saved securely.',
  penny_nav_pill_off: 'Enable Ezzo', penny_nav_pill_on: 'Ask Ezzo',
  penny_nav_aria_off: 'Enable Ezzo', penny_nav_aria_on: 'Ask Ezzo',
  penny_chat_title: 'Ask Ezzo',
  penny_input_placeholder: 'Ask about your analytics…',
  penny_send: 'Ask',
  penny_voice_on: 'Voice replies on', penny_voice_off: 'Voice replies off',
  penny_disclaimer: 'Your AI analytics assistant',
  penny_no_key_notice: 'Add your Gemini API key in Settings to start chatting with Ezzo.',
  penny_open_settings: 'Open Settings',
  penny_close: 'Close Ezzo',
  penny_err_invalid_key: 'Your Gemini API key looks invalid or has been revoked. Update it in Settings.',
  penny_err_rate_limited: "You've hit Gemini's rate limit for now. This is a limit from Google on your key, not the counter above. Wait a bit and try again.",
  penny_err_overloaded: "Google's Gemini service is temporarily overloaded with requests right now. Please try again in a moment.",
  penny_err_network: "Ezzo couldn't reach Google's servers. Check your connection and try again.",
  penny_err_blocked: "Ezzo couldn't come up with a safe answer to that. Try rephrasing your question.",
  penny_err_unknown: "Something went wrong on Ezzo's end. Please try again in a moment.",
  penny_err_retry: 'Retry'
};
function t(key) { return ADMIN_T_STRINGS[key] || key; }
function tf(key, ...args) { let s = t(key); args.forEach((v, i) => { s = s.replaceAll(`{${i}}`, v); }); return s; }

// penny.js's own pennyHandleNavClick()/pennyRenderChatError() call the
// budgeting tools' tab-switch function by its real name - admin.js's is
// switchATab(), so this alias lets that unmodified code work unchanged.
function switchTab(tab) { switchATab(tab); }

// Tiny, self-contained ports of the budgeting tools' generic toast/confirm-
// dialog/help-modal helpers (none of these live in penny.js - they're
// ordinary app UI penny.js merely calls by name). Reuses the same shared
// style.css classes (#toast, .fk-dialog-*, .modal-*) admin.html already
// has access to, so no new CSS is needed.
function showToast(msg) {
  let toastEl = document.getElementById('toast');
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}
function fkDialog({ message, confirmText, cancelText, danger = false, alertOnly = false, icon }) {
  return new Promise(resolve => {
    document.getElementById('fkDialogOverlay')?.remove();
    const ov = document.createElement('div');
    ov.className = 'fk-dialog-overlay';
    ov.id = 'fkDialogOverlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const glyph = icon || (danger ? '⚠️' : alertOnly ? 'ℹ️' : '❓');
    ov.innerHTML = `<div class="fk-dialog${danger ? ' fk-dialog--danger' : ''}" role="document">
      <div class="fk-dialog-icon" aria-hidden="true">${glyph}</div>
      <p class="fk-dialog-msg">${esc(message)}</p>
      <div class="fk-dialog-actions">
        ${alertOnly ? '' : `<button class="btn btn-ghost" data-act="cancel" type="button">${esc(cancelText || t('cancel'))}</button>`}
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmText || (alertOnly ? t('ok') : t('save')))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-open'));
    const done = val => { ov.classList.remove('is-open'); document.removeEventListener('keydown', onKey, true); setTimeout(() => ov.remove(), 200); resolve(val); };
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
function confirmDialog(opts) { return fkDialog({ danger: true, ...opts }); }
function pennyShowApiKeyHelp() {
  document.getElementById('adminHelpOverlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.id = 'adminHelpOverlay';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'adminHelpTitle');
  ov.innerHTML = `<div class="modal">
    <button class="modal-close" id="adminHelpClose" type="button" aria-label="Close">×</button>
    <h3 class="modal-title" id="adminHelpTitle">✨ Setting up Ezzo</h3>
    <div class="modal-body">
      <p>Ezzo is Ezzo Budget's AI assistant. Since this app has no server of its own, Ezzo talks directly from your browser to Google using your own free Gemini API key. Nothing ever passes through an Ezzo Budget server, because there isn't one.</p>
      <h4 style="margin:14px 0 6px;font-size:14px">How to create your key</h4>
      <ol style="margin:0;padding-left:18px;line-height:2">
        <li>Go to Google AI Studio (aistudio.google.com/apikey) and sign in with a Google account.</li>
        <li>Click "Create API key" (choose "Create key in new project" if you don't have one yet).</li>
        <li>Copy the generated key (it starts with AIza…).</li>
        <li>Paste it into the "Gemini API Key" field below and click "Save key".</li>
      </ol>
      <h4 style="margin:14px 0 6px;font-size:14px">Is this free?</h4>
      <p>Gemini's API has a free tier with limits set by Google, which can change. Check your current limits any time at aistudio.google.com. The "questions asked" counter you see here is a personal counter kept on your own device - it isn't a live reading of your Google quota.</p>
      <h4 style="margin:14px 0 6px;font-size:14px">Is my key safe?</h4>
      <p>Your key is encrypted before it's saved in this browser's own storage, and it's only ever sent directly to Google's API when you ask Ezzo a question. It never goes to any Ezzo Budget server.</p>
      <div style="margin-top:18px;text-align:center"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="help-video-btn">Open Google AI Studio →</a></div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#adminHelpClose')?.addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  const onKey = e => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}
function showHelp(key) { if (key === 'penny_api_key') pennyShowApiKeyHelp(); }

// ── What Ezzo has access to here: analytics, not budgets ───────────────
// These three function names (systemInstruction/tool declarations/tool
// execution) are exactly what penny.js's own pennySendMessage() calls by
// name every turn - redefining them here (after penny.js has already
// declared its budget-flavored originals) is the entire mechanism that
// gives Ezzo "access to the data in admin": everything else about how
// she works (streaming, fallback, formatting, chat UI) is untouched.
function pennyBuildSystemInstruction() {
  const sampleNote = _sampleDataActive
    ? " NOTE: the dashboard is currently showing SAMPLE/TEST data for trying things out, not real analytics - say so plainly if asked whether this reflects real performance."
    : '';
  return { parts: [{ text:
    "You are Ezzo, the site owner's analytics assistant, built into the private Ezzo Hub admin dashboard. The dashboard has these tabs: Overview (traffic, revenue, funnel), Sales (every order from Dodo Payments, the live checkout, plus the retired Lemon Squeezy and Etsy estimates, with refunds, discount codes and affiliates), Customers, License keys, Product (in-app usage) and Blogs. If a number appears in the dashboard, one of your tools can fetch it. " +
    "The only product sold today is the Ultimate Budget Planner ($49.99 one-time). The Simple Budget Planner is retired. " +
    "There is also an Affiliates tab for the site's own partner program (partners share a link or discount code and earn commission on sales); use get_affiliate_summary for it. " +
    "You ONLY answer questions about this site's analytics and sales (visitors, sessions, traffic, revenue, orders, refunds, discount codes, affiliate sales, in-app feature usage and preferences, license key redemptions) using the tools provided. " +
    "You must call one of the provided functions to fetch real data before stating any number, percentage, or count - never invent or estimate numbers yourself. If a specific tool doesn't obviously cover what was asked, use search_events (or search_redemptions for anything about codes/order IDs/redeemers) as a general-purpose fallback before saying data isn't available. " +
    "Visitors are identified only by a random on-device ID. Buyer names and email addresses exist on the Customers tab but are deliberately never given to you, and no IP address or budget data is collected at all - if asked for those, say so plainly and point to the Customers tab for contact details. " +
    "If asked about anything unrelated to this site's analytics (general knowledge, coding help, current events, etc.), politely decline and redirect to an analytics question. " +
    "The owner may ask open-ended strategy questions like 'how should I advertise this' or 'what should I improve' - for those, ground your answer in the actual numbers you fetch (e.g. which tool or region is most active, bounce rate, feature adoption, redemption conversion) rather than generic advice. " +
    "Keep every answer under about 60 words for a typical question. If explicitly asked for more detail or a deeper breakdown, you may write up to about 500 words. " +
    "Format answers with lightweight markdown so they're easy to scan: **bold** key numbers, a short '### Heading' before a distinct section if the answer covers more than one topic, and '- ' bullet points when listing more than two items. " +
    "You may use relevant emoji sparingly - 📊 stats, 👥 visitors, 📈 growth, 📉 decline, 🌍 region, 🔑 redemptions, ⚠️ something worth investigating, 💡 a suggestion - but don't force one into every sentence." +
    sampleNote
  }] };
}
function pennyToolDeclarations() {
  return [{
    functionDeclarations: [
      { name: 'get_sales_summary', description: "Returns sales for a date range (default: this month): net revenue after refunds, paid orders, average order value, refunds, test orders, revenue and orders per channel (Dodo Payments, Lemon Squeezy, Etsy estimated), top discount codes, top affiliates, and revenue per product. Use for any question about money, orders, discounts or affiliates.",
        parameters: { type: 'object', properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive start. Omit both from and to for this month; pass from: "all" for all time.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive end.' },
        } } },
      { name: 'search_orders', description: "Looks up individual orders (never includes buyer names or emails). Filter by free text (order id, discount code, affiliate, product), channel and status.",
        parameters: { type: 'object', properties: {
          q: { type: 'string' },
          channel: { type: 'string', enum: ['dodo', 'lemonsqueezy', 'etsy'] },
          status: { type: 'string', enum: ['paid', 'partial', 'refunded', 'test'] },
          limit: { type: 'number', description: 'Max rows, default 20, max 50.' },
        } } },
      { name: 'get_affiliate_summary', description: "Returns the in-house affiliate (partner) program for a date range (default: this month): program terms, partner counts by status, partner clicks, credited sales and revenue, commission earned, owed and on hold, and per-partner stats by partner code (clicks, demo starts, sales, conversion, revenue, commission). Never includes partner or buyer emails.",
        parameters: { type: 'object', properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive start; "all" for all time.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive end.' },
        } } },
      { name: 'get_overview_stats', description: "Returns headline site-wide analytics for the last 30 days: unique visitors, sessions, online-now count, bounce rate, avg session duration, pages/session, new vs. returning visitor split, and page views today.",
        parameters: { type: 'object', properties: {} } },
      { name: 'get_traffic_breakdown', description: "Returns traffic composition: top regions (by timezone), device types, referrers, top landing/exit pages, and views by page/tool. Filter by a rolling window (days) OR an exact date range (from/to), and optionally by tool.",
        parameters: { type: 'object', properties: {
          days: { type: 'number', description: 'How many recent days to include, default 30. Ignored if from/to are given.' },
          from: { type: 'string', description: 'YYYY-MM-DD, inclusive start date - overrides days.' },
          to: { type: 'string', description: 'YYYY-MM-DD, inclusive end date - overrides days.' },
          tool: { type: 'string', enum: ['sbp', 'ubp', 'home'], description: 'Restrict to one page/tool.' },
        } } },
      { name: 'get_product_breakdown', description: "Returns site-wide product-choice stats (matching the dashboard's Product tab): which license keys were redeemed, theme popularity, language preference, and sync-mode chosen (Google Drive vs. local device) - combined across both tools, optionally filtered by date range or tool.",
        parameters: { type: 'object', properties: {
          from: { type: 'string', description: 'YYYY-MM-DD, inclusive start date.' },
          to: { type: 'string', description: 'YYYY-MM-DD, inclusive end date.' },
          tool: { type: 'string', enum: ['sbp', 'ubp', 'home'], description: 'Restrict to one page/tool.' },
        } } },
      { name: 'get_tool_insights', description: "Returns detailed usage signals for ONE specific budgeting tool: visitor/session counts, bounce rate, returning-visitor %, license key redemption conversion rate, which sections/tabs get opened, which features get used, dashboard layout preference, sync-mode & theme preference (within that tool), busiest day of week, and device types.",
        parameters: { type: 'object', properties: { tool: { type: 'string', enum: ['sbp', 'ubp'], description: "'sbp' = Simple Budget, 'ubp' = Ultimate Budget." } }, required: ['tool'] } },
      { name: 'get_cross_tool_overlap', description: "Returns what share of visitors who've used either budgeting tool have explored BOTH Simple Budget and Ultimate Budget - a signal of cross-tool interest.",
        parameters: { type: 'object', properties: {} } },
      { name: 'get_redemptions_summary', description: "Returns license key redemption AGGREGATE stats: total redemptions, unique order IDs, unique redeemers, which specific order IDs were entered by more than one different visitor (worth investigating for possible access revocation), and which codes were redeemed how often. Use search_redemptions instead for a specific order ID, code, or visitor.",
        parameters: { type: 'object', properties: {} } },
      { name: 'search_redemptions', description: "Looks up individual license key redemption records (mirrors the dashboard's Redemptions tab search). Use this for anything about a SPECIFIC order ID, code, or visitor, or to list only reused/flagged order IDs.",
        parameters: { type: 'object', properties: {
          q: { type: 'string', description: 'Free-text match against order ID, code, or visitor ID.' },
          tool: { type: 'string', enum: ['sbp', 'ubp'] },
          onlyReused: { type: 'boolean', description: 'If true, only return redemptions whose order ID was used by more than one visitor.' },
          limit: { type: 'number', description: 'Max rows to return, default 25, max 50.' },
        } } },
      { name: 'get_recent_activity', description: "Returns the most recent raw events across the whole site (timestamp, event type, tool, region), newest first - useful for 'what's happening right now' questions.",
        parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max events to return, default 20, max 50.' } } } },
      { name: 'search_events', description: "General-purpose raw event search/count - use this as a fallback for ANY analytics question the other tools don't obviously cover (e.g. a specific event type, a specific page, a specific date range combined with a specific tool, or free text matching a visitor ID or an event's detail fields like a theme name, feature name, or tab name).",
        parameters: { type: 'object', properties: {
          type: { type: 'string', description: "Exact event type, e.g. 'page_view', 'heartbeat', 'theme_changed', 'tab_viewed', 'feature_used', 'dashboard_layout_changed', 'sync_mode_chosen', 'language_changed', 'launch_code_redeemed', 'session_start', 'session_end'." },
          page: { type: 'string', enum: ['sbp', 'ubp', 'home'] },
          tool: { type: 'string', enum: ['sbp', 'ubp'] },
          days: { type: 'number', description: 'Rolling window in days. Ignored if from/to are given.' },
          from: { type: 'string', description: 'YYYY-MM-DD, inclusive start date - overrides days.' },
          to: { type: 'string', description: 'YYYY-MM-DD, inclusive end date - overrides days.' },
          q: { type: 'string', description: 'Free-text match against visitor ID, referrer, or the event detail fields.' },
          limit: { type: 'number', description: 'Max matching events to return, default 30, max 100. totalMatches in the response tells you the real count even if truncated.' },
        } } },
    ],
  }];
}
// Shared by every tool below that accepts days/from/to/tool - pure
// function over a given event list, never touches the admin UI's own
// `filters` state (Ezzo's queries shouldn't depend on, or change,
// whatever date range happens to be selected in the Traffic/Product tabs).
function pennyFilterEventsByArgs(events, args) {
  let list = events;
  if (args?.tool) list = list.filter(e => e.tool === args.tool || e.page === args.tool);
  if (args?.from || args?.to) {
    if (args.from) { const t0 = new Date(args.from + 'T00:00:00').getTime(); list = list.filter(e => eventTime(e) >= t0); }
    if (args.to) { const t1 = new Date(args.to + 'T23:59:59').getTime(); list = list.filter(e => eventTime(e) <= t1); }
  } else if (args?.days) {
    const cutoff = Date.now() - Math.min(365, Math.max(1, parseInt(args.days) || 30)) * 86400000;
    list = list.filter(e => eventTime(e) >= cutoff);
  }
  return list;
}
function pennyAdminToolGetOverviewStats() {
  const now = Date.now();
  const last30 = allEvents.filter(e => now - eventTime(e) <= 30 * 86400000);
  const totalVisitors = uniqueBy(allEvents, e => e.visitorId).length;
  const visitors7d = uniqueBy(allEvents.filter(e => now - eventTime(e) <= 7 * 86400000), e => e.visitorId).length;
  const visitors30d = uniqueBy(last30, e => e.visitorId).length;
  const onlineNow = uniqueBy(allEvents.filter(isOnlineNow), e => e.visitorId).length;
  const sessions30 = buildSessions(last30);
  const withDuration = sessions30.filter(s => s.duration > 0);
  const avgDurationMs = withDuration.length ? withDuration.reduce((s, x) => s + x.duration, 0) / withDuration.length : 0;
  const avgPagesPerSession = sessions30.length ? sessions30.reduce((s, x) => s + x.pageViewCount, 0) / sessions30.length : 0;
  const engagedCount = sessions30.filter(s => s.engaged).length;
  const bounceRatePct = sessions30.length ? Math.round((1 - engagedCount / sessions30.length) * 100) : 0;
  const nr = newReturningSplit(last30);
  const newPct = nr.total ? Math.round(nr.newCount / nr.total * 100) : 0;
  const todayViews = allEvents.filter(e => e.type === 'page_view' && dayKey(eventTime(e)) === dayKey(now)).length;
  return {
    dataRef: 'admin_overview', totalVisitorsAllTime: totalVisitors, visitorsLast7Days: visitors7d, visitorsLast30Days: visitors30d,
    onlineNow, sessionsLast30Days: sessions30.length, avgSessionDurationSeconds: Math.round(avgDurationMs / 1000),
    bounceRatePct, pagesPerSession: Math.round(avgPagesPerSession * 10) / 10, newVisitorPct: newPct, returningVisitorPct: 100 - newPct,
    pageViewsToday: todayViews
  };
}
function pennyAdminToolGetTrafficBreakdown(args) {
  const events = pennyFilterEventsByArgs(allEvents, { days: args?.days || 30, from: args?.from, to: args?.to, tool: args?.tool });
  const views = events.filter(e => e.type === 'page_view');
  const referrers = groupCount(views.map(e => ({ ...e, _ref: e.referrer ? (() => { try { return new URL(e.referrer).hostname; } catch (err) { return 'Other'; } })() : 'Direct' })), e => e._ref);
  const sessions = buildSessions(events);
  const landingPages = groupCount(sessions.filter(s => s.landingPage), s => pageLabel(s.landingPage)).sort((a, b) => b.value - a.value);
  const exitPages = groupCount(sessions.filter(s => s.exitPage), s => pageLabel(s.exitPage)).sort((a, b) => b.value - a.value);
  return {
    dataRef: 'admin_traffic', range: args?.from || args?.to ? { from: args.from || null, to: args.to || null } : { lastDays: args?.days || 30 },
    topRegions: groupCount(events, e => e.timezone).slice(0, 8),
    deviceTypes: groupCount(events, e => uaDevice(e.ua)),
    referrers: referrers.slice(0, 8),
    topLandingPages: landingPages.slice(0, 5),
    topExitPages: exitPages.slice(0, 5),
    viewsByPage: groupCount(views, e => toolLabel(e.tool)).sort((a, b) => b.value - a.value)
  };
}
function pennyAdminToolGetProductBreakdown(args) {
  const events = pennyFilterEventsByArgs(allEvents, args || {});
  return {
    dataRef: 'admin_product',
    codesRedeemed: groupCount(events.filter(e => e.type === 'launch_code_redeemed'), e => (e.detail && e.detail.code) || 'Unknown'),
    themePopularity: groupCount(events.filter(e => e.type === 'theme_changed'), e => (e.detail && e.detail.theme) || 'Unknown'),
    languagePreference: groupCount(events.filter(e => e.type === 'language_changed'), e => (e.detail && e.detail.lang) || 'Unknown'),
    syncModeChosen: groupCount(events.filter(e => e.type === 'sync_mode_chosen'), e => (e.detail && e.detail.mode) === 'google' ? 'Google Drive' : 'Local device')
  };
}
function pennyAdminToolSearchRedemptions(args) {
  const q = String(args?.q || '').trim().toLowerCase();
  let rows = redemptionRows();
  if (args?.tool) rows = rows.filter(r => r.tool === args.tool);
  if (args?.onlyReused) rows = rows.filter(r => r.reused);
  if (q) rows = rows.filter(r => r.orderId.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.visitorId.toLowerCase().includes(q));
  const limit = Math.min(50, Math.max(1, parseInt(args?.limit) || 25));
  const total = rows.length;
  rows = rows.slice(0, limit);
  return {
    dataRef: 'admin_redemption_search', totalMatches: total, returned: rows.length,
    redemptions: rows.map(r => ({ when: new Date(r.when).toISOString(), orderId: r.orderId || null, code: r.code, tool: toolLabel(r.tool), visitorId: r.visitorId, region: r.timezone || 'Unknown', reused: r.reused, reuseCount: r.reuseCount }))
  };
}
function pennyAdminToolSearchEvents(args) {
  let list = pennyFilterEventsByArgs(allEvents, args || {});
  if (args?.type) list = list.filter(e => e.type === args.type);
  if (args?.page) list = list.filter(e => e.page === args.page);
  if (args?.q) {
    const q = String(args.q).toLowerCase();
    list = list.filter(e => e.visitorId.toLowerCase().includes(q) || (e.referrer || '').toLowerCase().includes(q) || JSON.stringify(e.detail || {}).toLowerCase().includes(q));
  }
  list = list.slice().sort((a, b) => eventTime(b) - eventTime(a));
  const total = list.length;
  const limit = Math.min(100, Math.max(1, parseInt(args?.limit) || 30));
  list = list.slice(0, limit);
  return {
    dataRef: 'admin_search', totalMatches: total, returned: list.length,
    events: list.map(e => ({ when: new Date(eventTime(e)).toISOString(), type: e.type, visitorId: e.visitorId, page: e.page, tool: e.tool, region: e.timezone || 'Unknown', detail: e.detail || {} }))
  };
}
function pennyAdminToolGetToolInsights(args) {
  const tool = args?.tool === 'ubp' ? 'ubp' : 'sbp';
  const d = toolInsights(tool);
  return {
    dataRef: 'admin_tool_' + tool, tool, toolName: tool === 'ubp' ? 'Ultimate Budget' : 'Simple Budget',
    visitorCount: d.visitorCount, sessionCount: d.sessionCount, avgSessionDurationSeconds: Math.round(d.avgDuration / 1000),
    bounceRatePct: d.bounceRate, returningVisitorPct: d.returningPct, codeRedemptionConversionPct: d.conversionPct,
    sectionUsage: d.tabGroups.slice(0, 10), featureAdoption: d.featureGroups.slice(0, 10), dashboardLayoutPreference: d.layoutGroups,
    syncModePreference: d.syncGroups, themePreference: d.themeGroups, busiestDayOfWeek: d.dow, deviceTypes: d.deviceGroups
  };
}
function pennyAdminToolGetCrossToolOverlap() {
  const sbpVisitors = new Set(allEvents.filter(e => e.page === 'sbp').map(e => e.visitorId));
  const ubpVisitors = new Set(allEvents.filter(e => e.page === 'ubp').map(e => e.visitorId));
  let bothCount = 0;
  sbpVisitors.forEach(v => { if (ubpVisitors.has(v)) bothCount++; });
  const totalToolVisitors = new Set([...sbpVisitors, ...ubpVisitors]).size;
  return { dataRef: 'admin_overlap', simpleBudgetVisitors: sbpVisitors.size, ultimateBudgetVisitors: ubpVisitors.size,
    visitorsWhoUsedBoth: bothCount, totalToolVisitors, bothToolsPct: totalToolVisitors ? Math.round(bothCount / totalToolVisitors * 100) : 0 };
}
function pennyAdminToolGetRedemptionsSummary() {
  const rows = redemptionRows();
  const withOrderId = rows.filter(r => r.orderId);
  const uniqueOrderIds = uniqueBy(withOrderId, r => r.orderId).length;
  const uniqueRedeemers = uniqueBy(rows, r => r.visitorId).length;
  const reused = new Map();
  rows.forEach(r => { if (r.reused) reused.set(r.orderId, r.reuseCount); });
  return {
    dataRef: 'admin_redemptions', totalRedemptions: rows.length, uniqueOrderIds, uniqueRedeemers,
    reusedOrderIds: Array.from(reused.entries()).map(([orderId, count]) => ({ orderId, usedByVisitors: count })).slice(0, 20),
    codesBreakdown: groupCount(rows, r => r.code || 'Unknown').slice(0, 20)
  };
}
function pennyAdminToolGetRecentActivity(args) {
  const limit = Math.min(50, Math.max(1, parseInt(args?.limit) || 20));
  const recent = allEvents.slice().sort((a, b) => eventTime(b) - eventTime(a)).slice(0, limit);
  return { dataRef: 'admin_recent', count: recent.length,
    events: recent.map(e => ({ when: new Date(eventTime(e)).toISOString(), type: e.type, tool: toolLabel(e.tool), region: e.timezone || 'Unknown' })) };
}
// Sales for Ezzo: the same ledger the Sales tab reads, without any buyer's
// name or address. Ezzo's answers go through Google's Gemini API, so contact
// details stay on the dashboard.
function pennyAdminToolGetSalesSummary(args) {
  let r;
  if (args?.from === 'all') r = { fromMs: -Infinity, toMs: Infinity };
  else if (args?.from || args?.to) r = {
    fromMs: args.from ? new Date(args.from + 'T00:00:00').getTime() : -Infinity,
    toMs: args.to ? new Date(args.to + 'T23:59:59.999').getTime() : Infinity
  };
  else { const m = currentMonthBounds(); r = { fromMs: new Date(m.from + 'T00:00:00').getTime(), toMs: new Date(m.to + 'T23:59:59.999').getTime() }; }
  const list = ordersWithin(salesLedger(), r);
  const s = salesSummary(list);
  const byProduct = new Map();
  list.filter(o => isCounted(o) && o.status !== 'refunded').forEach(o => byProduct.set(o.product || 'Unknown', (byProduct.get(o.product || 'Unknown') || 0) + o.kept));
  const round = n => Math.round(n * 100) / 100;
  return {
    dataRef: 'admin_sales', range: args?.from === 'all' ? 'all time' : (args?.from || args?.to) ? { from: args.from || null, to: args.to || null } : 'this month',
    currency: 'USD', netRevenue: round(s.net), grossBeforeRefunds: round(s.gross), refunds: round(s.refunds), paidOrders: s.orders, fullyRefundedOrders: s.refundedOrders,
    averageOrderValue: round(s.aov), etsyEstimatedRevenue: round(s.estimated), testOrdersExcluded: showTestData ? 0 : s.tests, testOrdersCounted: showTestData,
    byChannel: Object.fromEntries(Object.entries(s.byChannel).map(([k, v]) => [CHANNEL_LABEL[k], { orders: v.orders, revenue: round(v.revenue) }])),
    ordersWithDiscount: s.discounted, ordersViaAffiliate: s.affiliated,
    discountCodes: discountGroups(list).slice(0, 10).map(g => ({ code: g.label, orders: g.orders, revenue: round(g.revenue) })),
    affiliates: affiliateGroups(list).slice(0, 10).map(g => ({ affiliate: g.label, orders: g.orders, revenue: round(g.revenue) })),
    revenueByProduct: [...byProduct.entries()].map(([product, revenue]) => ({ product, revenue: round(revenue) })),
    note: 'Etsy sales are estimated at list price from claimed keys. Dodo revenue is after tax, in the settlement currency.'
  };
}
function pennyAdminToolSearchOrders(args) {
  const q = String(args?.q || '').trim().toLowerCase();
  let rows = salesLedger();
  if (args?.channel) rows = rows.filter(o => o.channel === args.channel);
  if (args?.status) rows = rows.filter(o => o.status === args.status);
  if (q) rows = rows.filter(o => [o.orderId, o.orderNumber, o.discount, o.affiliate, o.product].some(v => String(v || '').toLowerCase().includes(q)));
  const limit = Math.min(50, Math.max(1, parseInt(args?.limit) || 20));
  return {
    dataRef: 'admin_orders', totalMatches: rows.length, returned: Math.min(limit, rows.length),
    orders: rows.slice(0, limit).map(o => ({
      date: o.t ? new Date(o.t).toISOString().slice(0, 10) : null, order: o.orderNumber || o.orderId, channel: CHANNEL_LABEL[o.channel], product: o.product,
      amount: Math.round(o.net * 100) / 100, refunded: Math.round(o.refunded * 100) / 100, status: o.status, estimated: o.estimated,
      discountCodes: o.codes, affiliate: o.affiliate || null, keyUsed: o.redeemed
    }))
  };
}
function pennyAdminToolGetAffiliateSummary(args) {
  // Reuses the tab's own maths by borrowing the shared range for one call.
  const saved = { from: overviewFilters.from, to: overviewFilters.to };
  if (args?.from === 'all') Object.assign(overviewFilters, { from: '', to: '' });
  else if (args?.from || args?.to) Object.assign(overviewFilters, { from: args.from || '', to: args.to || '' });
  else Object.assign(overviewFilters, currentMonthBounds());
  try {
    const R = rangeMs();
    const rows = affPartnerRows();
    const round = n => Math.round(n * 100) / 100;
    return {
      dataRef: 'admin_affiliates', range: args?.from === 'all' ? 'all time' : (args?.from || args?.to) ? { from: args.from || null, to: args.to || null } : 'this month',
      setUp: !aff.missing, settings: aff.settings,
      programs: aff.programs.map(p => ({ id: p.id, name: p.name, isDefault: p.isDefault, active: p.active, commission: affRateText(p.type, p.amount), buyerDiscountPct: p.buyerDiscount, linkWindowDays: p.cookieDays, holdDays: p.holdDays, approval: p.approval, minPayout: p.minPayout, tiers: affTiersText(p), tier2Pct: p.tier2Rate })),
      partners: { active: rows.filter(a => a.status === 'approved').length, pendingApplications: rows.filter(a => a.status === 'pending').length, paused: rows.filter(a => a.status === 'paused').length },
      clicks: aff.clicks.filter(c => within(c.t, R)).length,
      creditedSales: rows.reduce((t, a) => t + a.sales, 0), creditedRevenue: round(rows.reduce((t, a) => t + a.revenue, 0)),
      commissionEarned: round(rows.reduce((t, a) => t + a.earned, 0)), owedNow: round(rows.reduce((t, a) => t + a.available, 0)), onHold: round(rows.reduce((t, a) => t + a.held, 0)), awaitingYourApproval: round(rows.reduce((t, a) => t + a.review, 0)),
      payoutsAwaitingPartnerConfirmation: aff.payouts.filter(p => p.status === 'paid' && !p.confirmedAt).length,
      byPartner: rows.filter(a => a.status !== 'pending').sort((a, b) => b.revenue - a.revenue).slice(0, 20).map(a => ({
        code: a.code, status: a.status, program: a.program.name, rate: a.effectiveRate, clicks: a.clicks, demoStarts: a.demos, sales: a.sales, conversionPct: round(a.conv),
        revenue: round(a.revenue), commission: round(a.earned), readyToPay: round(a.available), paidAllTime: round(a.paid)
      }))
    };
  } finally { Object.assign(overviewFilters, saved); }
}
function pennyExecuteTool(name, args, ctx) {
  try {
    switch (name) {
      case 'get_sales_summary':       return pennyCacheResult(pennyAdminToolGetSalesSummary(args || {}));
      case 'search_orders':           return pennyCacheResult(pennyAdminToolSearchOrders(args || {}));
      case 'get_affiliate_summary':   return pennyCacheResult(pennyAdminToolGetAffiliateSummary(args || {}));
      case 'get_overview_stats':      return pennyCacheResult(pennyAdminToolGetOverviewStats());
      case 'get_traffic_breakdown':   return pennyCacheResult(pennyAdminToolGetTrafficBreakdown(args || {}));
      case 'get_product_breakdown':   return pennyCacheResult(pennyAdminToolGetProductBreakdown(args || {}));
      case 'get_tool_insights':       return pennyCacheResult(pennyAdminToolGetToolInsights(args || {}));
      case 'get_cross_tool_overlap':  return pennyCacheResult(pennyAdminToolGetCrossToolOverlap());
      case 'get_redemptions_summary': return pennyCacheResult(pennyAdminToolGetRedemptionsSummary());
      case 'search_redemptions':      return pennyCacheResult(pennyAdminToolSearchRedemptions(args || {}));
      case 'get_recent_activity':     return pennyCacheResult(pennyAdminToolGetRecentActivity(args || {}));
      case 'search_events':           return pennyCacheResult(pennyAdminToolSearchEvents(args || {}));
      default: return { error: 'unknown_tool' };
    }
  } catch (e) {
    console.error('[admin-penny] tool execution failed:', name, e);
    return { error: 'internal_error' };
  }
}
function pennyRenderQuickActions() {
  const wrap = document.getElementById('pennyQuickActions');
  if (!wrap) return;
  const prompts = [
    { key: 'overview', label: "How are sales this month?" },
    { key: 'improve', label: 'What should I improve?' },
    { key: 'advertise', label: 'How should I advertise this?' }
  ];
  wrap.innerHTML = prompts.map(p => `<button class="btn btn-ghost btn-sm penny-qp-btn" data-qp="${esc(p.key)}" type="button">${esc(p.label)}</button>`).join('');
  wrap.querySelectorAll('[data-qp]').forEach(btn => {
    const p = prompts.find(x => x.key === btn.dataset.qp);
    if (p) btn.addEventListener('click', () => pennySendMessage(p.label));
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Sample data (Settings tab) - realistic fake events for trying out the
//  dashboard and Ezzo without waiting for real traffic. Purely in-memory:
//  never written to the real Sheet, never persisted across a reload.
// ══════════════════════════════════════════════════════════════════════
let _sampleDataActive = false;
function generateSampleAdminEvents() {
  const now = Date.now();
  const DAY = 86400000;
  const TIMEZONES = ['America/New_York', 'America/Los_Angeles', 'America/Denver', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Australia/Sydney'];
  const UAS = ['Mozilla/5.0 (Windows NT 10; Win64) Chrome/120', 'Mozilla/5.0 (Macintosh) Safari/605', 'Mozilla/5.0 (iPhone) Safari/604', 'Mozilla/5.0 (Linux; Android) Chrome/119', 'Mozilla/5.0 (iPad) Safari/604'];
  const REFERRERS = ['', '', 'https://google.com/search', 'https://twitter.com/', 'https://reddit.com/r/personalfinance', ''];
  const TABS_SBP = ['dashboard', 'transactions', 'income', 'expenses', 'bills', 'debt', 'savings'];
  const TABS_UBP = ['dashboard', 'transactions', 'budget', 'bills', 'debt', 'goals', 'calendar', 'challenges'];
  const FEATURES_BOTH = ['sample_data_loaded', 'csv_exported'];
  const FEATURES_UBP = ['debt_added', 'sinking_fund_created', 'subscription_added', 'allocation_enabled'];
  const THEMES = ['dark', 'frosty', 'light', 'peachy', 'vintage-ledger', 'jolly'];
  const LANGUAGES = ['en'];
  const CODES_SBP = ['SAMPL1', 'SAMPL2', 'SAMPL3'];
  const CODES_UBP = ['SAMPU1', 'SAMPU2'];
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];
  const events = [];
  // row:0 is a deliberate sentinel - these events don't exist in the real
  // Sheet, so nothing (especially the Danger Zone delete flow) should
  // ever treat them as having a real row to clear. See dangerZoneHtml(),
  // which refuses to run at all while sample data is active anyway.
  const push = (type, ts, page, tool, visitorId, sessionId, detail) => {
    const iso = new Date(ts).toISOString();
    events.push({ row: 0, serverTime: iso, type, visitorId, sessionId, page, tool, timezone: rand(TIMEZONES), referrer: rand(REFERRERS), ua: rand(UAS), lang: 'en', detail: detail || {}, clientTs: iso });
  };
  for (let v = 0; v < 60; v++) {
    const visitorId = 'sample_v' + v;
    const isReturning = Math.random() < 0.35;
    const sessionCount = isReturning ? 2 + Math.floor(Math.random() * 3) : 1;
    const preferredTool = Math.random() < 0.92 ? 'ubp' : 'sbp';
    const usesBoth = Math.random() < 0.25;
    for (let s = 0; s < sessionCount; s++) {
      const daysAgo = Math.random() * 29;
      const sessionId = 'sample_s' + v + '_' + s;
      const tool = usesBoth && s > 0 ? (preferredTool === 'sbp' ? 'ubp' : 'sbp') : preferredTool;
      const tabs = tool === 'ubp' ? TABS_UBP : TABS_SBP;
      let t = now - daysAgo * DAY - Math.random() * 3600000;
      push('page_view', t, 'home', '', visitorId, sessionId);
      t += 2000 + Math.random() * 5000;
      // The website funnel: product page, demo, buy button.
      push('page_view', t, 'budgetplanner', '', visitorId, sessionId);
      if (Math.random() < 0.45) push('trial_started', t + 1500, 'budgetplanner', '', visitorId, sessionId, { tool });
      if (Math.random() < 0.18) push('purchase_initiated', t + 3000, 'budgetplanner', '', visitorId, sessionId, { tool: 'ubp' });
      t += 4000;
      push('page_view', t, tool, tool, visitorId, sessionId);
      if (Math.random() < 0.65) {
        const heartbeats = 1 + Math.floor(Math.random() * 6);
        for (let h = 0; h < heartbeats; h++) { t += 25000 + Math.random() * 20000; push('heartbeat', t, tool, tool, visitorId, sessionId); }
        push('tab_viewed', t, tool, tool, visitorId, sessionId, { tab: rand(tabs) });
        if (Math.random() < 0.4) push('tab_viewed', t + 4000, tool, tool, visitorId, sessionId, { tab: rand(tabs) });
        if (Math.random() < 0.3) push('feature_used', t + 8000, tool, tool, visitorId, sessionId, { feature: rand(tool === 'ubp' ? [...FEATURES_BOTH, ...FEATURES_UBP] : FEATURES_BOTH) });
        if (Math.random() < 0.15) push('dashboard_layout_changed', t + 12000, tool, tool, visitorId, sessionId, { layout: Math.random() < 0.3 ? 2 : 1 });
        if (Math.random() < 0.2) push('theme_changed', t + 16000, tool, tool, visitorId, sessionId, { theme: rand(THEMES) });
        if (Math.random() < 0.15) push('sync_mode_chosen', t + 20000, tool, tool, visitorId, sessionId, { mode: Math.random() < 0.4 ? 'google' : 'local' });
        if (Math.random() < 0.12) push('nav_position_changed', t + 24000, tool, tool, visitorId, sessionId, { position: rand(['top', 'left', 'left', 'right']) });
        if (Math.random() < 0.12) push('persona_changed', t + 26000, tool, tool, visitorId, sessionId, { persona: rand(['cheeky', 'zen', 'concise', 'sarcastic', 'optimist']) });
        if (s === 0 && Math.random() < 0.5) push('feature_used', t + 2000, tool, tool, visitorId, sessionId, { feature: 'setup_done' });
        if (Math.random() < 0.1) push('feature_used', t + 28000, tool, tool, visitorId, sessionId, { feature: 'bank_import', rows: 20 + Math.floor(Math.random() * 120) });
      }
      if (s === 0 && Math.random() < 0.3) {
        const code = rand(tool === 'ubp' ? CODES_UBP : CODES_SBP);
        push('launch_code_redeemed', t + 1000, 'home', '', visitorId, sessionId, { code, tool, orderId: 'SAMPLE-' + (1000 + Math.floor(Math.random() * 900)) });
      }
    }
  }
  // A few redemptions intentionally sharing one order ID, so the
  // Redemptions tab (and Ezzo) have something realistic to flag.
  const sharedOrderId = 'SAMPLE-9001';
  ['sample_reuse_a', 'sample_reuse_b', 'sample_reuse_c'].forEach((vid, i) => {
    push('launch_code_redeemed', now - i * DAY, 'home', '', vid, 'sample_reuse_s' + i, { code: rand(CODES_SBP), tool: 'sbp', orderId: sharedOrderId });
  });
  return events;
}
// Sales, keys and waitlist sign-ups to go with the sample events, shaped
// exactly like the real sheets, so every tab has something to show. Names
// and addresses use example.com and never leave this browser.
function generateSampleCommerce() {
  const now = Date.now(), DAY = 86400000;
  const iso = t => new Date(t).toISOString();
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const FIRST = ['alex', 'sam', 'jordan', 'casey', 'riley', 'morgan', 'taylor', 'jamie', 'robin', 'drew', 'quinn', 'avery'];
  const CODES = ['', '', '', 'WELCOME10', 'SPRING15', 'MIA10', 'BUDGETBOSS'];
  const AFFS = ['', '', '', '', 'mia-saves', 'budgetwithbo'];
  const sales = [], keys = [], notify = [];
  for (let i = 0; i < 26; i++) {
    const t = now - Math.random() * 40 * DAY;
    const who = pick(FIRST) + (i + 1);
    const code = pick(CODES);
    const affiliate = code === 'MIA10' ? 'mia-saves' : pick(AFFS);
    const off = code ? (code === 'SPRING15' ? 0.15 : 0.10) : 0;
    const net = Math.round(49.99 * (1 - off) * 100) / 100;
    const foreign = Math.random() < 0.3;
    const id = 'pay_sample' + (1000 + i);
    sales.push({ row: 0, ts: iso(t), event: 'payment.succeeded', orderId: id, email: who + '@example.com', name: who.replace(/\d+/, '').replace(/^./, c => c.toUpperCase()) + ' Sample',
      product: 'Ultimate Budget Planner', variant: 'Dodo Payments', total: net, currency: 'USD', mode: i === 3 ? 'test' : 'live', status: 'succeeded', orderNumber: id,
      discount: code, affiliate, gross: foreign ? (net * 4.9).toFixed(2) + ' PLN' : (net * 1.08).toFixed(2) + ' USD' });
    if (i === 5 || i === 11) {
      sales.push({ row: 0, ts: iso(t + 2 * DAY), event: 'refund.succeeded', orderId: 'ref_sample' + i, email: who + '@example.com', name: '', product: 'Ultimate Budget Planner',
        variant: 'Dodo Payments', total: foreign ? net * 4.9 : net * 1.08, currency: foreign ? 'PLN' : 'USD', mode: 'live', status: 'succeeded', orderNumber: id, discount: '', affiliate: '',
        gross: (foreign ? (net * 4.9).toFixed(2) + ' PLN' : (net * 1.08).toFixed(2) + ' USD') });
    }
    // A webhook retry: the same payment twice, which must count once.
    if (i === 8) sales.push(Object.assign({}, sales[sales.length - 1]));
  }
  sales.push({ row: 0, ts: iso(now - 45 * DAY), event: 'order_created', orderId: '880001', email: 'early.bird@example.com', name: 'Early Bird', product: 'Ultimate Budget Planner',
    variant: 'Dark / Classic', total: 49.99, currency: 'USD', mode: 'live', status: 'paid', orderNumber: '1001', discount: '', affiliate: '', gross: '' });
  for (let i = 0; i < 6; i++) {
    const t = now - Math.random() * 30 * DAY;
    keys.push({ row: 0, key: 'ETSY-SAMP-' + (4000 + i) + '-8000-SAMPLE' + i, tool: 'ubp', theme: pick(['frosty', 'dark', 'peachy']), layout: '1', orderId: String(3400000000 + i),
      email: 'etsy.buyer' + i + '@example.com', issuedAt: iso(t), status: i === 4 ? 'revoked' : 'active', devices: i % 2 ? ['a'] : ['a', 'b'], redeemCount: i === 2 ? 0 : 1, lastRedeemedAt: iso(t + DAY) });
  }
  ['tool-tasks', 'tool-habits', 'tool-meals', 'tool-tasks'].forEach((tool, i) => {
    notify.push({ ts: iso(now - i * 3 * DAY), email: i === 3 ? 'alex1@example.com' : 'waiting' + i + '@example.com', tool, source: 'notify', visitorId: 'sample_v' + i });
  });
  // One address on the waitlist for two tools, and one buyer who also joined it.
  notify.push({ ts: iso(now - DAY), email: 'waiting0@example.com', tool: 'tool-habits', source: 'notify', visitorId: 'sample_v0' });
  return { sales, keys, notify };
}
function updateSampleBanner() {
  const banner = document.getElementById('adminSampleBanner');
  if (banner) banner.hidden = !_sampleDataActive;
}
function loadSampleData() {
  allEvents = generateSampleAdminEvents();
  const extra = generateSampleCommerce();
  allSales = extra.sales; allKeys = extra.keys; allNotify = extra.notify;
  aff = generateSampleAffiliates();
  _sampleDataActive = true;
  _lastFetched = Date.now();
  pennyResetChatState?.();
  updateSampleBanner();
  (ADMIN_RENDERERS[currentATab] || renderOverview)();
}
async function exitSampleData() {
  _sampleDataActive = false;
  pennyResetChatState?.();
  // Flip the banner/Danger-Zone/UI back instantly on the sample data still
  // on screen - don't make leaving sample mode wait on a network round
  // trip. The real refetch below then updates the numbers once it lands.
  updateSampleBanner();
  (ADMIN_RENDERERS[currentATab] || renderOverview)();
  if (_adminAccessToken) {
    try { await adminFetchAll(_adminAccessToken); } catch (e) { /* keep last-known data */ }
  } else {
    allEvents = []; allKeys = []; allSales = []; allNotify = [];
  }
  (ADMIN_RENDERERS[currentATab] || renderOverview)();
}
function sampleDataSectionHtml() {
  return `
    <div class="settings-card-title">🧪 Sample data</div>
    <p class="admin-danger-sub">Load realistic fake analytics (visitors, sessions, redemptions, feature usage) to try out the dashboard - and Ezzo - without waiting for real traffic. Never written to your real sheet, and cleared when you exit it or sign out.</p>
    ${_sampleDataActive
      ? `<button class="btn btn-ghost" id="sampleDataExitBtn" type="button">Exit sample data</button>`
      : `<button class="btn btn-secondary" id="sampleDataLoadBtn" type="button">Load sample data</button>`}`;
}
function wireSampleDataSection() {
  document.getElementById('sampleDataLoadBtn')?.addEventListener('click', () => { loadSampleData(); renderSettings(); });
  document.getElementById('sampleDataExitBtn')?.addEventListener('click', async () => { await exitSampleData(); renderSettings(); });
}

// The same six themes the planner has. Remembered on this browser only; the
// <head> of admin.html applies it before anything paints.
const ADMIN_THEMES = [['light', 'Light'], ['peachy', 'Peachy'], ['dark', 'Dark'], ['vintage-ledger', 'Vintage Ledger'], ['jolly', 'Jolly'], ['frosty', 'Frosty']];
const ADMIN_THEME_KEY = 'evobudget_admin_theme';
function setAdminTheme(theme) {
  if (!ADMIN_THEMES.some(t => t[0] === theme)) theme = 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(ADMIN_THEME_KEY, theme); } catch (e) {}
  // The globe paints its own canvas colours, so it is rebuilt for the theme.
  if (currentATab === 'overview') renderOverview();
}

function renderSettings() {
  const el = document.getElementById('aview-settings');
  const current = document.documentElement.dataset.theme || 'dark';
  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Settings</h2></div>
    <div class="settings-grid">
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🎨 Appearance</div>
        <div class="theme-setting-row"><div class="theme-pill" role="group">
          ${ADMIN_THEMES.map(([val, label]) => `<button class="theme-opt${val === current ? ' is-active' : ''}" data-theme-val="${val}" type="button">${esc(label)}</button>`).join('')}
        </div></div>
      </div></div>
      ${pennySettingsCardHtml()}
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">ℹ️ About this dashboard</div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Signed in as</div><div class="admin-setting-hint">${esc(_adminEmail || 'unknown')}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Data loaded</div><div class="admin-setting-hint">${fmt(allEvents.length)} events, ${fmt(allSales.length)} sales rows, ${fmt(allKeys.length)} keys, ${fmt(allNotify.length)} waitlist sign-ups${_sampleDataActive ? ' (sample data)' : ''}. Last refreshed ${_lastFetched ? esc(relTime(_lastFetched)) : 'never'}.</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Your own visits and test traffic</div><div class="admin-setting-hint">${adminShowAllTraffic() ? 'Shown in every number.' : `Hidden from every number: ${fmt(adminHiddenTraffic.events)} events from ${fmt(adminHiddenTraffic.visitors)} device${adminHiddenTraffic.visitors === 1 ? '' : 's'} (your own, automated test browsers and crawlers).`} This browser is never counted. To stop counting your phone or another browser, open any page there once with <b>?notrack=1</b> on the end, for example ezzohub.com/?notrack=1.</div></div>
          <label class="admin-search-toggle${adminShowAllTraffic() ? ' is-active' : ''}"><input type="checkbox" id="adminShowAll"${adminShowAllTraffic() ? ' checked' : ''}> Show them</label></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Sales tracking</div><div class="admin-setting-hint">${allSales.some(r => r.discount || r.affiliate || r.gross) || !allSales.some(r => r.event === 'payment.succeeded')
          ? 'Discount codes and affiliates are being recorded with each Dodo sale.'
          : 'Dodo sales are arriving without the Discount, Affiliate and Gross columns. Paste the latest Code.gs into Apps Script and deploy a new version to start recording them.'}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Auto-refresh</div><div class="admin-setting-hint">Every ${Math.round(ADMIN_POLL_MS / 1000)}s while the dashboard is open</div></div></div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        ${dangerZoneHtml()}
      </div></div>
      <div class="panel"><div class="panel-inner">
        <button class="btn btn-ghost" id="adminSignOutBtn2" type="button">Sign out</button>
      </div></div>
    </div>`;
  el.querySelectorAll('.theme-opt').forEach(btn => btn.addEventListener('click', () => { setAdminTheme(btn.dataset.themeVal); el.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('is-active', b === btn)); }));
  el.querySelector('#adminSignOutBtn2')?.addEventListener('click', adminSignOut);
  el.querySelector('#adminShowAll')?.addEventListener('change', async e => {
    try { localStorage.setItem(ADMIN_SHOWALL_KEY, e.target.checked ? '1' : '0'); } catch (x) {}
    if (_adminAccessToken && !_sampleDataActive) { try { allEvents = await adminFetchEvents(_adminAccessToken); } catch (x) {} }
    renderSettings();
  });
  pennyWireSettingsCard();

  wireDangerZone();
}

function filterBarHtml() {
  const tools = [['', 'All tools'], ['sbp', 'Simple Budget'], ['ubp', 'Ultimate Budget'], ['home', 'Home page']];
  return `<div class="admin-filter-bar">
    ${styledDateField('admFilterFrom', 'admFilterFromWrap', filters.from)}
    ${styledDateField('admFilterTo', 'admFilterToWrap', filters.to)}
    <select id="admFilterTool" aria-label="Tool">${tools.map(([v, l]) => `<option value="${v}"${filters.tool === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${(filters.from || filters.to || filters.tool) ? `<button class="admin-filter-clear" id="admFilterClear" type="button">Clear filters</button>` : ''}
  </div>`;
}
function wireFilterBar(rerender) {
  bindDateField('admFilterFrom', 'admFilterFromWrap', v => { filters.from = v; rerender(); });
  bindDateField('admFilterTo', 'admFilterToWrap', v => { filters.to = v; rerender(); });
  document.getElementById('admFilterTool')?.addEventListener('change', e => { filters.tool = e.target.value; rerender(); });
  document.getElementById('admFilterClear')?.addEventListener('click', () => { filters.from = ''; filters.to = ''; filters.tool = ''; rerender(); });
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula,
  // so it is prefixed rather than left to execute on open.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
function downloadCsv(header, rows, name) {
  const body = rows.map(r => r.map(csvCell).join(','));
  const blob = new Blob(['﻿' + [header.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function shortDate(t) { return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
function shortDateTime(t) { return t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'; }
// Keeps the caret where it was while a search box re-renders its own tab.
function wireSearch(id, onValue) {
  const input = document.getElementById(id);
  input?.addEventListener('input', () => {
    clearTimeout(input._t);
    input._t = setTimeout(() => {
      const pos = input.selectionStart;
      onValue(input.value);
      const again = document.getElementById(id);
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} }
    }, 200);
  });
}

// ══════════════════════ Sales ══════════════════════
// Every order from every channel, as it was paid, with what happened to it
// afterwards (refunds) and what brought it in (discount code, affiliate).
const STATUS_LABEL = { paid: 'Paid', partial: 'Part refunded', refunded: 'Refunded', test: 'Test' };
function salesFilteredRows(list) {
  const q = salesFilters.q.trim().toLowerCase();
  return list.filter(o =>
    (!salesFilters.channel || o.channel === salesFilters.channel) &&
    (!salesFilters.status || o.status === salesFilters.status || (salesFilters.status === 'refunded' && o.status === 'partial')) &&
    (!q || [o.email, o.name, o.product, o.orderId, o.orderNumber, o.discount, o.affiliate].some(v => String(v || '').toLowerCase().includes(q))));
}
function renderSales() {
  const el = document.getElementById('aview-sales');
  if (!el) return;
  ensureSalesForRange();
  const R = rangeMs(), P = previousRangeMs();
  const ledger = salesLedger();
  const inRange = ordersWithin(ledger, R);
  const sum = applyLsTopUp(salesSummary(inRange));
  const prev = P ? salesSummary(ordersWithin(ledger, P)) : null;
  const vsTitle = P ? `Compared with the ${P.days} day${P.days === 1 ? '' : 's'} before this range` : '';
  const rows = salesFilteredRows(inRange);
  const discounts = discountGroups(inRange);
  const affiliates = affiliateGroups(inRange);
  const productGroups = (() => {
    const m = new Map();
    inRange.filter(o => isCounted(o) && o.status !== 'refunded').forEach(o => { const k = o.product || 'Unknown'; m.set(k, (m.get(k) || 0) + o.kept); });
    return [...m.entries()].map(([label, value]) => ({ label, value: Math.round(value) }));
  })();
  const awaiting = inRange.filter(o => o.redeemed === false && o.status === 'paid').length;

  el.innerHTML = `
    ${pageHead('Sales', esc(formatRangeLabel()) + '. Every order from Dodo Payments, Lemon Squeezy and Etsy, once each, with refunds taken off.',
      `<button class="btn btn-ghost btn-sm" id="slExport" type="button">⬇ Export CSV</button>`)}
    ${rangeBarHtml('sl')}
    ${statGrid([
      { icon: '💰', label: 'Net revenue', value: money(sum.net), sub: sum.estimated ? 'incl. ' + money(sum.estimated) + ' Etsy est.' : 'after refunds', tone: '#10b981', delta: deltaChip(sum.net, prev && prev.net, false, vsTitle),
        hint: 'What reached you after tax and refunds. Dodo sales are recorded in your settlement currency without the buyer\'s tax, so a sale paid in another currency reads the same as one paid in dollars.' },
      { icon: '🧾', label: 'Paid orders', value: fmt(sum.orders), sub: sum.orders ? money(sum.aov) + ' average order' : 'none yet', tone: '#6366f1', delta: deltaChip(sum.orders, prev && prev.orders, false, vsTitle) },
      { icon: '↩️', label: 'Refunds', value: money(sum.refunds), sub: fmt(sum.refundedOrders) + ' fully refunded', tone: '#f43f5e', delta: deltaChip(sum.refunds, prev && prev.refunds, true, vsTitle) },
      { icon: '🏷️', label: 'With a discount', value: fmt(sum.discounted), sub: pct(sum.discounted, sum.orders, 0) + ' of orders · ' + fmt(sum.affiliated) + ' via affiliates', tone: '#f59e0b' }
    ])}

    <div class="adm-grid adm-grid--3">
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('By channel')}
        ${channelBreakdownHtml(sum)}
        ${sum.lsExtra ? `<p class="adm-note">Includes ${fmt(sum.lsExtra.orders)} earlier Lemon Squeezy order${sum.lsExtra.orders === 1 ? '' : 's'} known only to their API, so they are not listed below.</p>` : ''}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Discount codes', 'Codes applied at checkout. Revenue is what those orders brought in after the discount and any refund.')}
        ${moneyTableHtml(discounts, 'Code', 'No discount codes used in this range.')}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Affiliates', 'Sales that arrived through an affiliate link or an affiliate\'s code.')}
        ${moneyTableHtml(affiliates, 'Affiliate', 'No affiliate sales in this range.')}
      </div></div>
    </div>
    ${productGroups.length > 1 ? `<div class="panel chart-panel"><div class="panel-inner-sm">${panelTitle('By product')}${hBarListHtml(productGroups, { showShare: false, prefix: '$' })}</div></div>` : ''}

    <div class="adm-toolbar">
      <input class="adm-input adm-input--grow" type="search" id="slQ" placeholder="Search buyer, order, code or affiliate…" value="${esc(salesFilters.q)}" aria-label="Search orders">
      <select class="adm-input" id="slChannel" aria-label="Channel">
        <option value="">All channels</option>
        ${Object.entries(CHANNEL_LABEL).map(([v, l]) => `<option value="${v}"${salesFilters.channel === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="adm-input" id="slStatus" aria-label="Status">
        <option value="">Any status</option>
        <option value="paid"${salesFilters.status === 'paid' ? ' selected' : ''}>Paid</option>
        <option value="refunded"${salesFilters.status === 'refunded' ? ' selected' : ''}>Refunded</option>
        <option value="test"${salesFilters.status === 'test' ? ' selected' : ''}>Test</option>
      </select>
      <label class="admin-search-toggle${showTestData ? ' is-active' : ''}" title="Test orders are always listed. This decides whether they count towards revenue everywhere on the dashboard.">
        <input type="checkbox" id="slShowTest"${showTestData ? ' checked' : ''}> Count test orders${sum.tests ? ` (${sum.tests})` : ''}
      </label>
    </div>

    <div class="panel"><div class="panel-inner-sm">
      <div class="admin-table-wrap"><table class="admin-table adm-orders">
        <thead><tr><th>Date</th><th>Order</th><th>Channel</th><th>Product</th><th>Buyer</th><th class="num">Amount</th><th>Discount</th><th>Affiliate</th><th>Status</th><th>Key used</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(o => `<tr class="${o.status === 'refunded' || o.status === 'test' ? 'admin-row-muted' : ''}">
          <td title="${esc(shortDateTime(o.t))}">${esc(shortDate(o.t))}</td>
          <td class="admin-key-cell">${esc(o.orderNumber && o.channel === 'lemonsqueezy' ? o.orderNumber : o.orderId)}</td>
          <td><span class="adm-chip" style="--c:${CHANNEL_COLOR[o.channel]}">${esc(CHANNEL_LABEL[o.channel])}</span></td>
          <td>${esc(o.product || '-')}${o.variant ? ` <span class="admin-table-muted">${esc(o.variant)}</span>` : ''}</td>
          <td>${o.email ? `<span class="admin-table-strong">${esc(o.email)}</span>${o.name ? `<br><span class="admin-table-muted">${esc(o.name)}</span>` : ''}` : '<span class="admin-table-muted">-</span>'}</td>
          <td class="num">${money(o.net)}${o.estimated ? ' <span class="admin-src-badge" title="Etsy has no sales feed, so this is the list price">est.</span>' : ''}${o.refunded > 0 && o.status !== 'refunded' ? `<br><span class="admin-table-muted">-${money(o.refunded)}</span>` : ''}${o.gross && o.gross.currency && o.gross.currency !== String(o.currency).toUpperCase() ? `<br><span class="admin-table-muted" title="What the buyer paid, with tax">${esc(o.gross.amount.toFixed(2) + ' ' + o.gross.currency)}</span>` : ''}</td>
          <td>${o.codes.length ? o.codes.map(c => `<span class="adm-tag">${esc(c)}</span>`).join(' ') : '<span class="admin-table-muted">-</span>'}</td>
          <td>${o.affiliate ? `<span class="adm-tag adm-tag--aff">${esc(o.affiliate)}</span>` : '<span class="admin-table-muted">-</span>'}</td>
          <td><span class="adm-status adm-status--${o.status}">${STATUS_LABEL[o.status]}</span></td>
          <td>${o.redeemed === null ? '<span class="admin-table-muted" title="A Dodo key reports its own id when used, not the order, so this cannot be matched">n/a</span>' : o.redeemed ? '✓' : '<span class="admin-table-muted">not yet</span>'}</td>
        </tr>`).join('') : `<tr class="admin-empty-row"><td colspan="10">${inRange.length ? 'No orders match these filters.' : 'No orders in this range. Sales appear the moment Dodo reports one.'}</td></tr>`}
        </tbody>
      </table></div>
      ${awaiting ? `<p class="adm-note">${fmt(awaiting)} paid order${awaiting === 1 ? ' has' : 's have'} a key that has not been used yet.</p>` : ''}
    </div></div>`;

  wireRangeBar(el, 'sl', renderSales);
  wireSearch('slQ', v => { salesFilters.q = v; renderSales(); });
  document.getElementById('slChannel')?.addEventListener('change', e => { salesFilters.channel = e.target.value; renderSales(); });
  document.getElementById('slStatus')?.addEventListener('change', e => { salesFilters.status = e.target.value; renderSales(); });
  document.getElementById('slShowTest')?.addEventListener('change', e => { setShowTestData(e.target.checked); renderSales(); });
  document.getElementById('slExport')?.addEventListener('click', () => downloadCsv(
    ['Date', 'Order', 'Channel', 'Product', 'Email', 'Name', 'Amount', 'Refunded', 'Currency', 'Paid by buyer', 'Discount', 'Affiliate', 'Status'],
    rows.map(o => [o.t ? new Date(o.t).toISOString() : '', o.orderNumber || o.orderId, CHANNEL_LABEL[o.channel], o.product, o.email, o.name, o.net.toFixed(2), o.refunded.toFixed(2), o.currency,
      o.gross ? o.gross.amount.toFixed(2) + ' ' + o.gross.currency : '', o.discount, o.affiliate, STATUS_LABEL[o.status]]),
    'ezzo-sales-' + new Date().toISOString().slice(0, 10) + '.csv'));
  initFieldTips(el);
}

// ══════════════════════ Customers ══════════════════════
// One row per email address, whatever brought it in: a purchase on any
// channel, an Etsy key claim, or a "tell me when this launches" sign-up.
// An address used three times is still one person.
let customerFilters = { type: '', q: '' };
function notifyToolLabel(id) {
  const k = String(id || '').replace(/^tool-/, '');
  const hit = (typeof BLOG_ADMIN_TOOLS !== 'undefined' ? BLOG_ADMIN_TOOLS : []).find(t => t.id === k);
  return hit ? hit.label : (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Launch list');
}
function customerRows() {
  const byEmail = new Map();
  const get = email => {
    if (!byEmail.has(email)) byEmail.set(email, { email, name: '', orders: 0, spent: 0, refunds: 0, testOrders: 0, channels: new Set(), products: new Set(), waitlist: new Set(), first: 0, last: 0, orderIds: [] });
    return byEmail.get(email);
  };
  const touch = (c, t) => { if (!t) return; c.first = c.first ? Math.min(c.first, t) : t; c.last = Math.max(c.last, t); };
  salesLedger().forEach(o => {
    if (!o.email) return;
    const c = get(o.email);
    if (o.name && !c.name) c.name = o.name;
    touch(c, o.t);
    c.orderIds.push(o.orderNumber || o.orderId);
    if (o.test) { c.testOrders++; return; }
    if (o.status !== 'refunded') c.orders++;
    c.spent += o.kept; c.refunds += o.refunded;
    c.channels.add(CHANNEL_LABEL[o.channel]);
    if (o.product) c.products.add(o.product);
  });
  allNotify.forEach(n => {
    const email = String(n.email || '').trim().toLowerCase();
    if (!email) return;
    const c = get(email);
    c.waitlist.add(notifyToolLabel(n.tool));
    touch(c, Date.parse(n.ts) || 0);
  });
  return [...byEmail.values()].map(c => {
    c.type = c.orders > 0 ? 'customer' : c.testOrders > 0 && !c.waitlist.size ? 'test' : c.waitlist.size ? 'waitlist' : 'refunded';
    return c;
  }).sort((a, b) => b.last - a.last);
}
function customerFilteredRows(all) {
  const q = customerFilters.q.trim().toLowerCase();
  return all.filter(c =>
    (!customerFilters.type || c.type === customerFilters.type || (customerFilters.type === 'waitlist' && c.waitlist.size > 0)) &&
    (!q || c.email.includes(q) || c.name.toLowerCase().includes(q) || c.orderIds.some(id => String(id).toLowerCase().includes(q))));
}
const CUSTOMER_TYPE_LABEL = { customer: 'Customer', waitlist: 'Waitlist', test: 'Test buyer', refunded: 'Refunded' };
function renderCustomers() {
  const el = document.getElementById('aview-customers');
  if (!el) return;
  const all = customerRows();
  const rows = customerFilteredRows(all);
  const customers = all.filter(c => c.type === 'customer');
  const repeat = customers.filter(c => c.orders > 1).length;
  const waitlist = all.filter(c => c.waitlist.size > 0).length;
  const ltv = customers.length ? customers.reduce((a, c) => a + c.spent, 0) / customers.length : 0;
  const csvRows = list => list.map(c => [c.email, c.name, CUSTOMER_TYPE_LABEL[c.type], c.orders, c.spent.toFixed(2), [...c.products].join('; '), [...c.channels].join('; '), [...c.waitlist].join('; '),
    c.first ? new Date(c.first).toISOString().slice(0, 10) : '', c.last ? new Date(c.last).toISOString().slice(0, 10) : '']);
  const header = ['Email', 'Name', 'Type', 'Orders', 'Spent', 'Products', 'Channels', 'Waitlist', 'First seen', 'Last seen'];

  el.innerHTML = `
    ${pageHead('Customers', 'Everyone who has given you an email address, one row per address: buyers on every channel and people on a launch waitlist. All time.',
      `<button class="btn btn-ghost btn-sm" id="cuCopy" type="button">Copy addresses</button><button class="btn btn-primary btn-sm" id="cuExport" type="button">⬇ Export ${fmt(rows.length)}</button>`)}
    ${statGrid([
      { icon: '📇', label: 'Email addresses', value: fmt(all.length), sub: 'unique, all sources', tone: '#6366f1' },
      { icon: '🛒', label: 'Customers', value: fmt(customers.length), sub: fmt(repeat) + ' bought more than once', tone: '#10b981' },
      { icon: '💎', label: 'Average spend', value: money(ltv), sub: 'per customer, after refunds', tone: '#a855f7' },
      { icon: '🔔', label: 'On a waitlist', value: fmt(waitlist), sub: 'asked to hear about a launch', tone: '#f59e0b' }
    ])}
    <div class="adm-toolbar">
      <input class="adm-input adm-input--grow" type="search" id="cuQ" placeholder="Search email, name or order…" value="${esc(customerFilters.q)}" aria-label="Search customers">
      <select class="adm-input" id="cuType" aria-label="Type">
        <option value="">Everyone</option>
        <option value="customer"${customerFilters.type === 'customer' ? ' selected' : ''}>Customers</option>
        <option value="waitlist"${customerFilters.type === 'waitlist' ? ' selected' : ''}>On a waitlist</option>
        <option value="refunded"${customerFilters.type === 'refunded' ? ' selected' : ''}>Refunded only</option>
        <option value="test"${customerFilters.type === 'test' ? ' selected' : ''}>Test buyers</option>
      </select>
    </div>
    <div class="panel"><div class="panel-inner-sm"><div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Email</th><th>Type</th><th>Products</th><th class="num">Orders</th><th class="num">Spent</th><th>Waitlist</th><th>First seen</th><th>Last seen</th></tr></thead>
      <tbody>
      ${rows.length ? rows.map(c => `<tr>
        <td><span class="admin-table-strong">${esc(c.email)}</span>${c.name ? `<br><span class="admin-table-muted">${esc(c.name)}</span>` : ''}</td>
        <td><span class="adm-status adm-status--${c.type === 'customer' ? 'paid' : c.type === 'test' ? 'test' : c.type === 'refunded' ? 'refunded' : 'wait'}">${CUSTOMER_TYPE_LABEL[c.type]}</span></td>
        <td>${c.products.size ? [...c.products].map(p => esc(p)).join('<br>') : '<span class="admin-table-muted">-</span>'}</td>
        <td class="num">${c.orders ? fmt(c.orders) : '<span class="admin-table-muted">0</span>'}${c.testOrders ? ` <span class="admin-src-badge">+${c.testOrders} test</span>` : ''}</td>
        <td class="num">${c.spent ? money(c.spent) : '<span class="admin-table-muted">-</span>'}</td>
        <td>${c.waitlist.size ? [...c.waitlist].map(w => `<span class="adm-tag">${esc(w)}</span>`).join(' ') : '<span class="admin-table-muted">-</span>'}</td>
        <td>${esc(shortDate(c.first))}</td>
        <td>${esc(shortDate(c.last))}</td>
      </tr>`).join('') : `<tr class="admin-empty-row"><td colspan="8">${all.length ? 'Nobody matches these filters.' : 'No addresses yet. They appear as people buy or join a waitlist.'}</td></tr>`}
      </tbody>
    </table></div></div></div>`;

  wireSearch('cuQ', v => { customerFilters.q = v; renderCustomers(); });
  document.getElementById('cuType')?.addEventListener('change', e => { customerFilters.type = e.target.value; renderCustomers(); });
  document.getElementById('cuExport')?.addEventListener('click', () => downloadCsv(header, csvRows(customerFilteredRows(customerRows())), 'ezzo-customers-' + new Date().toISOString().slice(0, 10) + '.csv'));
  document.getElementById('cuCopy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(customerFilteredRows(customerRows()).map(c => c.email).join(', ')); showToast('Addresses copied'); }
    catch (e) { showToast('Could not copy'); }
  });
}

// ══════════════════════ Product (in-app usage) ══════════════════════
// What people do inside the planner, from the events the app already sends.
// Covers both the free demo and the paid planner: they run the same app.
const TAB_LABELS = {
  dashboard: 'Dashboard', transactions: 'Transactions', budget: 'Budget', bills: 'Bills & subscriptions', debt: 'Debt',
  goals: 'Savings goals', calendar: 'Calendar', challenges: 'Challenges', settings: 'Settings', insights: 'Insights', afford: 'Can I afford it?',
  income: 'Income', expenses: 'Expenses', savings: 'Savings', subscriptions: 'Subscriptions', sinking: 'Savings goals'
};
const FEATURE_LABELS = {
  setup_done: 'Finished setup', sample_data_loaded: 'Loaded sample data', csv_exported: 'Exported a CSV', bank_import: 'Imported a bank statement',
  debt_added: 'Added a debt', sinking_fund_created: 'Created a savings goal', subscription_added: 'Added a subscription', allocation_enabled: 'Turned on allocation',
  automation_enabled: 'Turned on automation', trial_deep_link: 'Opened a demo link', etsy_key_claimed: 'Claimed an Etsy key'
};
const LAYOUT_LABELS = { '1': 'Classic', '2': 'Radial', '3': 'Sleek' };
const THEME_LABELS = { light: 'Light', dark: 'Dark', peachy: 'Peachy', 'vintage-ledger': 'Vintage Ledger', jolly: 'Jolly', frosty: 'Frosty', synthwave: 'Synthwave (retired)', terminal: 'Terminal (retired)', minimal: 'Minimal (retired)' };
const NAV_LABELS = { top: 'Top bar', left: 'Left rail', right: 'Right rail' };
function labelled(map, v) { return map[String(v)] || (v ? String(v).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Unknown'); }
function inAppEvents(r) { return allEvents.filter(e => (e.page === 'ubp' || e.page === 'sbp') && within(eventTime(e), r)); }
function detailGroups(events, type, field, map) {
  return groupCount(events.filter(e => e.type === type), e => labelled(map || {}, e.detail && e.detail[field]));
}
// Settings people actually changed, counted once per person (their latest
// choice), so someone flicking through every theme does not count six times.
function latestChoiceGroups(events, type, field, map) {
  const last = new Map();
  events.filter(e => e.type === type).sort((a, b) => eventTime(a) - eventTime(b)).forEach(e => last.set(e.visitorId, e.detail && e.detail[field]));
  const m = new Map();
  last.forEach(v => { const k = labelled(map || {}, v); m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
function renderProduct() {
  const el = document.getElementById('aview-product');
  if (!el) return;
  const R = rangeMs(), P = previousRangeMs();
  const ev = inAppEvents(R);
  const prevEv = P ? inAppEvents(P) : null;
  const vsTitle = P ? `Compared with the ${P.days} day${P.days === 1 ? '' : 's'} before this range` : '';
  const users = uniqueBy(ev, e => e.visitorId).length;
  const prevUsers = prevEv ? uniqueBy(prevEv, e => e.visitorId).length : null;
  const sessions = buildSessions(ev);
  const timed = sessions.filter(s => s.duration > 0);
  const avg = timed.length ? timed.reduce((a, s) => a + s.duration, 0) / timed.length : 0;
  const prevTimed = prevEv ? buildSessions(prevEv).filter(s => s.duration > 0) : null;
  const prevAvg = prevTimed ? (prevTimed.length ? prevTimed.reduce((a, s) => a + s.duration, 0) / prevTimed.length : 0) : null;
  const nr = newReturningSplit(ev);
  const setupPeople = new Set(ev.filter(e => e.type === 'feature_used' && e.detail && e.detail.feature === 'setup_done').map(e => e.visitorId)).size;
  const saveFails = ev.filter(e => e.type === 'save_failed').length;
  const revoked = ev.filter(e => e.type === 'unlock_revoked').length;
  const bankImports = ev.filter(e => e.type === 'feature_used' && e.detail && e.detail.feature === 'bank_import');
  const importedRows = bankImports.reduce((a, e) => a + (Number(e.detail.rows) || 0), 0);
  const dow = dayOfWeekCounts(ev.filter(e => e.type === 'session_start' || e.type === 'page_view'));

  el.innerHTML = `
    ${pageHead('Product', esc(formatRangeLabel()) + '. How people use the planner, demo and paid alike, from the anonymous events the app sends. No budget data is ever collected.')}
    ${rangeBarHtml('pr')}
    ${statGrid([
      { icon: '🧑‍💻', label: 'Active users', value: fmt(users), sub: fmt(nr.returningCount) + ' returning', tone: '#6366f1', delta: deltaChip(users, prevUsers, false, vsTitle), hint: 'Distinct people who opened the planner in this range. Returning means they have had more than one session ever.' },
      { icon: '⏱️', label: 'Avg. time in app', value: formatDuration(avg), sub: fmt(sessions.length) + ' sessions', tone: '#fb923c', delta: deltaChip(avg, prevAvg, false, vsTitle) },
      { icon: '✅', label: 'Finished setup', value: fmt(setupPeople), sub: users ? pct(setupPeople, users, 0) + ' of active users' : '', tone: '#10b981', hint: 'People who completed the first-run setup in this range.' },
      { icon: '🏦', label: 'Bank imports', value: fmt(bankImports.length), sub: fmt(importedRows) + ' transactions brought in', tone: '#3b82f6' }
    ])}
    ${saveFails || revoked ? `<div class="adm-alert">⚠️ ${saveFails ? `${fmt(saveFails)} failed save${saveFails === 1 ? '' : 's'} (the browser refused to store data, usually a full or private-mode storage)` : ''}${saveFails && revoked ? ' · ' : ''}${revoked ? `${fmt(revoked)} unlock${revoked === 1 ? '' : 's'} revoked on a device after a key was disabled` : ''}.</div>` : ''}

    <div class="adm-grid adm-grid--2">
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Sections opened', 'How often each part of the planner was opened.')}
        ${hBarListHtml(detailGroups(ev, 'tab_viewed', 'tab', TAB_LABELS), { empty: 'No sections opened in this range.', limit: 10 })}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Features used')}
        ${hBarListHtml(detailGroups(ev, 'feature_used', 'feature', FEATURE_LABELS), { empty: 'No features used in this range.', limit: 10 })}
      </div></div>
    </div>

    <div class="adm-grid adm-grid--3">
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Themes chosen', 'Each person\'s latest choice, among people who changed theme in this range.')}
        ${pieOrEmpty(latestChoiceGroups(ev, 'theme_changed', 'theme', THEME_LABELS), 'Nobody changed theme in this range.')}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Dashboard layout', 'Each person\'s latest choice.')}
        ${vBarChartHtml(latestChoiceGroups(ev, 'dashboard_layout_changed', 'layout', LAYOUT_LABELS), { empty: 'No layout changes in this range.' })}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Navigation position', 'Each person\'s latest choice.')}
        ${vBarChartHtml(latestChoiceGroups(ev, 'nav_position_changed', 'position', NAV_LABELS), { empty: 'Nobody moved the navigation in this range.' })}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Ezzo personality', 'Which voice people picked for Ezzo, latest choice per person.')}
        ${hBarListHtml(latestChoiceGroups(ev, 'persona_changed', 'persona'), { empty: 'No personality changes in this range.' })}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Where data is kept', 'Google Drive sync or this device only, latest choice per person.')}
        ${pieOrEmpty(latestChoiceGroups(ev, 'sync_mode_chosen', 'mode', { google: 'Google Drive', local: 'This device' }), 'No sync choices in this range.')}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Devices in the app')}
        ${vBarChartHtml(groupCount(uniqueVisitorEvents(ev), e => uaDevice(e.ua)), { categories: ['Desktop', 'Tablet', 'Mobile'] })}
      </div></div>
    </div>

    <div class="panel chart-panel"><div class="panel-inner-sm">
      ${panelTitle('Busiest days', 'Visits to the planner by day of the week.')}
      ${vBarChartHtml(dow.map(d => ({ label: d.label, value: d.value })), { categories: DOW_LABELS.slice(1).concat('Sun') })}
    </div></div>`;

  wireRangeBar(el, 'pr', renderProduct);
  initFieldTips(el);
  wireCharts(el);
}

// ══════════════════════ Affiliates ══════════════════════
// The in-house partner program (AFFILIATE PROGRAM in Code.gs), run entirely
// from here: Analytics, Programs, Partners, Referrals, Payments, Settings.
// The program's sheets are read directly, like every other tab. Every
// change goes through the Apps Script, which checks your own Google sign-in
// first, so the rules (validation, Dodo coupons, emails) live in one place.
const AFF_RANGES = {
  affiliates: 'Affiliates!A2:AA5000', programs: 'AffPrograms!A2:R500', coupons: 'AffCoupons!A2:J5000',
  clicks: 'AffClicks!A2:G200000', events: 'AffEvents!A2:E200000', commissions: 'Commissions!A2:U50000',
  payouts: 'Payouts!A2:O10000', settings: 'AffSettings!A2:C100'
};
const AFF_SETTING_DEFAULTS = {
  programOpen: 'yes', autoApprove: 'yes', applicationProgram: '', payoutSchedule: 'Monthly, in the first week',
  notifySales: 'yes', notifyApplications: 'yes', blockSelf: 'yes'
};
const AFF_PROGRAM_FALLBACK = { id: 'P1', name: 'Standard', description: '', type: 'percent', amount: 30, buyerDiscount: 10, cookieDays: 30, holdDays: 30,
  approval: 'auto', minPayout: 50, tiers: [{ min: 10, amount: 35 }], tierMetric: 'sales', tier2Rate: 0, isDefault: true, active: true };
const AFF_METHOD_LABEL = { paypal: 'PayPal', wise: 'Wise', bank: 'Bank transfer' };
const AFF_STATE_LABEL = { pending: 'On hold', review: 'Needs approval', approved: 'Ready to pay', paid: 'Paid', rejected: 'Denied', reversed: 'Refunded' };
const AFF_STATE_TONE = { pending: 'wait', review: 'partial', approved: 'paid', paid: 'paid', rejected: 'refunded', reversed: 'refunded' };
const AFF_PARTNER_LABEL = { approved: 'Active', pending: 'Applied', paused: 'Paused', rejected: 'Declined', deleted: 'Deleted' };
const AFF_PARTNER_TONE = { approved: 'paid', pending: 'wait', paused: 'partial', rejected: 'refunded', deleted: 'test' };
const AFF_VIA_LABEL = { link: 'Link', code: 'Coupon', manual: 'Added by you', tier2: 'Second tier', '': 'Clawback' };

let aff = { ready: false, missing: false, programs: [], affiliates: [], coupons: [], clicks: [], events: [], commissions: [], payouts: [], settings: Object.assign({}, AFF_SETTING_DEFAULTS) };
let affView = 'analytics';
let affAnalytics = { program: '', partner: '', metric: 'commission' };
let affPartnerFilters = { q: '', status: 'live', program: '' };
let affRefFilters = { q: '', status: '', program: '', partner: '', via: '', flagged: false };
let affPayView = 'ready';
let affPaidFilters = { q: '', partner: '', state: '' };
let affSelectedRefs = new Set();
let affSelectedPay = new Set();
let affOpenRows = new Set();

function affEmpty(extra) {
  return Object.assign({ ready: true, missing: false, programs: [Object.assign({}, AFF_PROGRAM_FALLBACK)], affiliates: [], coupons: [], clicks: [], events: [], commissions: [], payouts: [], settings: Object.assign({}, AFF_SETTING_DEFAULTS) }, extra || {});
}
function affParseTiers(v) {
  let t = [];
  try { t = JSON.parse(v || '[]'); } catch (e) { t = []; }
  return (Array.isArray(t) ? t : []).map(x => ({ min: Number(x.min) || 0, amount: Number(x.amount) || 0 })).filter(x => x.min > 0).sort((a, b) => a.min - b.min);
}
async function adminFetchAffiliates(token) {
  const keys = Object.keys(AFF_RANGES);
  const qs = keys.map(k => 'ranges=' + encodeURIComponent(AFF_RANGES[k])).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    // A missing sheet fails the whole read: setupAffiliates() hasn't been run.
    if (!res.ok) return affEmpty({ missing: res.status === 400 });
    const j = await res.json();
    const v = {};
    keys.forEach((k, i) => { v[k] = ((j.valueRanges || [])[i] || {}).values || []; });
    return affParseSheets(v);
  } catch (e) { return Object.assign({}, aff, { ready: true }); }
}
function affParseSheets(v) {
  const t = x => Date.parse(sheetIso(x)) || 0;
  const settings = Object.assign({}, AFF_SETTING_DEFAULTS);
  v.settings.forEach(r => { const k = _str(r[0]).trim(); if (k in settings) settings[k] = k === 'payoutSchedule' || k === 'applicationProgram' ? _str(r[1]).trim() : _str(r[1]).trim().toLowerCase(); });
  let programs = v.programs.filter(r => _str(r[0]) && _str(r[15]) !== 'deleted').map((r, i) => ({
    id: _str(r[0]), name: _str(r[1]) || 'Program', description: _str(r[2]), type: _str(r[3]) === 'flat' ? 'flat' : 'percent', amount: Number(r[4]) || 0,
    buyerDiscount: Number(r[5]) || 0, cookieDays: Number(r[6]) || 30, holdDays: Number(r[7]) || 0, approval: _str(r[8]) === 'manual' ? 'manual' : 'auto',
    minPayout: Number(r[9]) || 0, tiers: affParseTiers(r[10]), tierMetric: _str(r[11]) === 'revenue' ? 'revenue' : 'sales', tier2Rate: Number(r[12]) || 0,
    isDefault: _str(r[13]) === 'yes', active: _str(r[14]) !== 'no', createdAt: t(r[16])
  }));
  if (!programs.length) programs = [Object.assign({}, AFF_PROGRAM_FALLBACK)];
  if (!programs.some(p => p.isDefault)) (programs.find(p => p.active) || programs[0]).isDefault = true;
  return {
    ready: true, missing: false, settings, programs,
    affiliates: v.affiliates.map((r, i) => ({
      row: i + 2, code: _str(r[0]).toUpperCase(), email: _str(r[1]).toLowerCase(), name: _str(r[2]), status: _str(r[3]) || 'pending', rate: _str(r[4]),
      method: ['wise', 'bank'].includes(_str(r[7])) ? _str(r[7]) : 'paypal', payoutEmail: _str(r[8]), website: _str(r[9]), audience: _str(r[10]),
      application: _str(r[11]), recruitedBy: _str(r[12]).toUpperCase(), createdAt: t(r[13]), approvedAt: t(r[14]), lastLogin: t(r[19]), notes: _str(r[20]),
      programId: _str(r[21]), rateType: _str(r[22]), payoutDetails: _str(r[23]), deletedAt: t(r[26])
    })).filter(a => a.code),
    coupons: v.coupons.filter(r => _str(r[0]) && _str(r[9]) !== 'deleted').map(r => ({
      code: _str(r[0]).toUpperCase(), affiliate: _str(r[1]).toUpperCase(), percent: Number(r[2]) || 0, discountId: _str(r[3]), active: _str(r[4]) || 'no',
      usageLimit: Number(r[5]) || 0, expiresAt: t(r[6]), createdAt: t(r[7]), note: _str(r[8])
    })),
    clicks: v.clicks.map(r => ({ t: t(r[0]), code: _str(r[1]).toUpperCase(), vid: _str(r[2]), landing: _str(r[3]), referrer: _str(r[4]), sub: _str(r[5]), tz: _str(r[6]) })),
    events: v.events.map(r => ({ t: t(r[0]), code: _str(r[1]).toUpperCase(), vid: _str(r[2]), type: _str(r[3]), sub: _str(r[4]) })),
    commissions: v.commissions.map((r, i) => ({
      row: i + 2, t: t(r[0]), code: _str(r[1]).toUpperCase(), orderId: _str(r[2]), type: _str(r[3]), sale: Number(r[4]) || 0, rate: Number(r[5]) || 0,
      amount: Number(r[6]) || 0, currency: _str(r[7]) || 'USD', status: _str(r[8]), availableAt: t(r[9]), paidAt: t(r[10]), payoutId: _str(r[11]),
      via: _str(r[12]), sub: _str(r[13]), note: _str(r[14]), test: _str(r[15]) === 'test', programId: _str(r[16]), approval: _str(r[17]) === 'manual' ? 'manual' : 'auto',
      approvedAt: t(r[18]), manual: _str(r[19]) === 'yes', rateType: _str(r[20]) === 'flat' ? 'flat' : 'percent'
    })).filter(c => c.code),
    payouts: v.payouts.map(r => ({
      t: t(r[0]), id: _str(r[1]), code: _str(r[2]).toUpperCase(), amount: Number(r[3]) || 0, currency: _str(r[4]) || 'USD', method: _str(r[5]) || 'paypal',
      payoutEmail: _str(r[6]), reference: _str(r[7]), note: _str(r[8]), details: _str(r[9]), referrals: Number(r[10]) || 0,
      status: _str(r[11]) === 'void' ? 'void' : 'paid', paidDate: t(r[12]) || t(r[0]), confirmedAt: t(r[13]), voidedAt: t(r[14])
    })).filter(p => p.id)
  };
}

// ── Model helpers (mirror the Apps Script's rules) ─────────────────────
const affProgramById = id => aff.programs.find(p => p.id === id) || null;
const affDefaultProgram = () => aff.programs.find(p => p.isDefault) || aff.programs[0] || AFF_PROGRAM_FALLBACK;
const affPartner = code => aff.affiliates.find(a => a.code === code) || null;
function affProgramOf(a) { const own = a && affProgramById(a.programId); return own && own.active ? own : affDefaultProgram(); }
function affState(c) {
  if (c.status !== 'pending') return c.status;
  const done = c.availableAt && c.availableAt <= Date.now();
  return c.approval === 'manual' ? (done ? 'review' : 'pending') : (done ? 'approved' : 'pending');
}
const affCredited = c => !c.test && c.status !== 'reversed' && c.status !== 'rejected';
function affRateText(type, amount) { return type === 'flat' ? '$' + Number(amount).toFixed(2) : Number(amount) + '%'; }
function affHistory(code) {
  const own = aff.commissions.filter(c => c.code === code && c.type === 'sale' && affCredited(c));
  return { sales: own.length, revenue: own.reduce((t, c) => t + c.sale, 0) };
}
// The rate a partner earns on their next sale, and why.
function affRateFor(a) {
  const p = affProgramOf(a);
  if (a.rate !== '' && isFinite(Number(a.rate))) return { type: a.rateType === 'flat' ? 'flat' : a.rateType === 'percent' ? 'percent' : p.type, amount: Number(a.rate), source: 'custom' };
  const h = affHistory(a.code), val = p.tierMetric === 'revenue' ? h.revenue : h.sales;
  let r = { type: p.type, amount: p.amount, source: 'program' };
  p.tiers.forEach(t => { if (val >= t.min) r = { type: p.type, amount: t.amount, source: 'tier' }; });
  return r;
}
function affCommissionFor(a, sale) { const r = affRateFor(a); return r.type === 'flat' ? Math.min(r.amount, sale) : Math.round(sale * r.amount) / 100; }
function affTiersText(p) {
  if (!p.tiers.length) return 'None';
  return p.tiers.map(t => affRateText(p.type, t.amount) + ' from ' + (p.tierMetric === 'revenue' ? money(t.min) + ' revenue' : t.min + ' sales')).join(', ');
}
function affCouponState(c) { return c.active === 'yes' && c.discountId ? 'live' : c.active === 'paused' ? 'paused' : !c.discountId && /^Not in Dodo/.test(c.note) ? 'waiting' : 'off'; }
// How often each coupon was used, from the Sales ledger.
function affCouponUses() {
  const m = new Map();
  salesLedger().forEach(o => { if (o.status !== 'refunded' && !o.test) o.codes.forEach(code => m.set(code.toUpperCase(), (m.get(code.toUpperCase()) || 0) + 1)); });
  return m;
}
const affOrderMap = () => new Map(salesLedger().map(o => [o.orderId, o]));

// Per-partner figures for a range (and optional program filter).
function affPartnerRows(R, programFilter) {
  R = R || rangeMs();
  const by = new Map(aff.affiliates.map(a => [a.code, Object.assign({}, a, {
    clicks: 0, visitors: new Set(), demos: 0, checkouts: 0, sales: 0, revenue: 0, earned: 0, available: 0, held: 0, review: 0, paid: 0, refunds: 0, allSales: 0, recruits: 0
  })]));
  aff.clicks.forEach(c => { const a = by.get(c.code); if (a && within(c.t, R)) { a.clicks++; a.visitors.add(c.vid || c.t); } });
  aff.events.forEach(e => { const a = by.get(e.code); if (a && within(e.t, R)) { if (e.type === 'demo') a.demos++; else if (e.type === 'checkout') a.checkouts++; } });
  aff.commissions.forEach(c => {
    const a = by.get(c.code);
    if (!a || c.test) return;
    const st = affState(c);
    if (st === 'approved') a.available += c.amount; else if (st === 'pending') a.held += c.amount; else if (st === 'review') a.review += c.amount; else if (st === 'paid') a.paid += c.amount;
    if (c.type === 'sale') { a.allSales++; if (c.status === 'reversed') a.refunds++; }
    if (!within(c.t, R) || !affCredited(c)) return;
    if (c.type === 'sale') { a.sales++; a.revenue += c.sale; }
    a.earned += c.amount;
  });
  aff.affiliates.forEach(x => { if (x.recruitedBy && by.has(x.recruitedBy)) by.get(x.recruitedBy).recruits++; });
  return [...by.values()].filter(a => !programFilter || affProgramOf(a).id === programFilter).map(a => {
    const r = affRateFor(a);
    a.people = a.visitors.size;
    a.conv = a.people ? a.sales / a.people * 100 : 0;
    a.rateInfo = r;
    a.effectiveRate = affRateText(r.type, r.amount);
    a.program = affProgramOf(a);
    a.refundRate = a.allSales ? a.refunds / a.allSales : 0;
    return a;
  });
}
// Signals worth a second look on a referral. None of them proves anything.
const AFF_COMMON_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'example.com']);
function affRiskFlags(c, orders, buyerCounts) {
  const flags = [];
  const a = affPartner(c.code);
  const o = orders.get(c.orderId);
  if (/self-referral/i.test(c.note)) flags.push('Self-referral');
  if (o && o.email && a) {
    if ((buyerCounts.get(c.code + '|' + o.email) || 0) > 1) flags.push('Repeat buyer');
    const d1 = o.email.split('@')[1], d2 = (a.email || '').split('@')[1];
    if (d1 && d1 === d2 && !AFF_COMMON_MAIL.has(d1)) flags.push('Same email domain');
    const first = (a.name || '').split(' ')[0].toLowerCase();
    if (first.length >= 3 && (o.name || '').toLowerCase().includes(first)) flags.push('Similar name');
  }
  if (a && a.allSales >= 3 && a.refundRate >= 0.3) flags.push('High refund rate');
  return flags;
}

// ── Talking to the Apps Script ─────────────────────────────────────────
function adminScriptCall(params) {
  return new Promise(resolve => {
    const cb = `ezzoAdm${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let settled = false;
    const finish = res => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      window[cb] = function () {};
      script.remove();
      resolve(res || { ok: false, error: 'failed' });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 45000);
    window[cb] = res => finish(res);
    const qs = new URLSearchParams(Object.assign({}, params, { token: _adminAccessToken || '', cb, _: String(Date.now()) }));
    script.src = `${ADMIN_APPS_SCRIPT_URL}?${qs}`;
    script.onerror = () => finish({ ok: false, error: 'network' });
    document.head.appendChild(script);
  });
}
const AFF_ERRORS = {
  not_admin: 'The Apps Script did not accept your sign-in. Sign out and back in, then try again.',
  unknown: 'The Apps Script does not know this yet: paste the latest Code.gs and deploy a new version.',
  unknown_op: 'The Apps Script does not know this yet: paste the latest Code.gs and deploy a new version.',
  timeout: 'The Apps Script took too long to answer. Try again.', network: 'Could not reach the Apps Script.', busy: 'The Apps Script is busy. Try again in a moment.',
  nothing_due: 'Nothing is ready to pay for this partner.', not_payable: 'Some of those referrals are no longer ready to pay. Refresh and try again.',
  below_minimum: 'That is below this partner\'s minimum payout. Tick "Pay below the minimum" to pay anyway.',
  bad_name: 'Please add a name.', bad_email: 'That email does not look right.', bad_payout_email: 'The payout email does not look right.',
  exists: 'Someone with that email is already a partner.', code_taken: 'That code is already in use.', bad_code: 'Codes need at least 3 letters or numbers.',
  bad_program: 'Choose a program.', bad_rate: 'Custom commission: up to 100% for a percentage.', bad_percent: 'Discounts go from 1% to 100%.',
  bad_amount: 'Check the commission amount (percentages go up to 100).', bad_discount: 'The buyer discount goes from 0% to 100%.', bad_cookie: 'The link window is 1 to 365 days.',
  bad_hold: 'The hold is 0 to 365 days.', bad_min: 'Check the minimum payout.', bad_tiers: 'Each tier needs a threshold above 0 and an amount.', bad_tier2: 'Second tier goes from 0% to 50%.',
  default_active: 'The default program is always on. Make another program the default first.', is_default: 'Make another program the default before deleting this one.',
  already_paid: 'That referral has been paid. Undo the payout first if it was a mistake.', already_credited: 'That order is already credited to a partner.',
  refunded: 'That order was refunded, so it cannot earn commission.', bad_sale: 'Check the sale amount.', bad_commission: 'Check the commission amount.',
  bad_partner: 'Choose a partner.', not_active: 'That partner is not active.', bad_recruiter: 'Recruited by: use another partner\'s code.',
  already_void: 'That payout was already undone.', no_discount: 'This program has no buyer discount to apply.', bad_limit: 'Check the usage limit.', bad_date: 'Check the date.',
  no_api_key: 'Add DODO_API_KEY in Apps Script Script Properties to create coupons in Dodo.', not_found: 'Not found. Refresh and try again.'
};
function affError(res) { return AFF_ERRORS[res && res.error] || ('Could not do that (' + ((res && res.error) || 'unknown error') + ').'); }
async function affCall(params) {
  if (_sampleDataActive) return { ok: false, error: 'sample' };
  return adminScriptCall(Object.assign({ action: 'aff_admin' }, params));
}
async function affReload() {
  if (_sampleDataActive) return;
  aff = await adminFetchAffiliates(_adminAccessToken);
  allSales = await adminFetchSales(_adminAccessToken).catch(() => allSales);
}
// Runs an action, then refreshes and redraws. Returns the result or null.
async function affDo(params, okMsg) {
  if (_sampleDataActive) { showToast('Not available with sample data. Exit sample data to manage the real program.'); return null; }
  const res = await affCall(params);
  if (!res.ok) { showToast(affError(res)); return null; }
  if (okMsg) showToast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
  await affReload();
  renderAffiliates();
  return res;
}

// ── Modal form ─────────────────────────────────────────────────────────
// Returns false from onSubmit to keep the dialog open (it shows the error).
function affModal(o) {
  document.getElementById('affModal')?.remove();
  const ov = document.createElement('div');
  ov.className = 'adm-modal-ov'; ov.id = 'affModal';
  ov.innerHTML = `<form class="adm-modal${o.wide ? ' adm-modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="affModalTitle" novalidate>
    <div class="adm-modal-head"><h3 id="affModalTitle">${esc(o.title)}</h3><button class="adm-modal-x" type="button" data-close aria-label="Close">×</button></div>
    <div class="adm-modal-body">${o.body}</div>
    <p class="adm-modal-err" role="alert"></p>
    <div class="adm-modal-foot">${o.extraButtons || ''}<span class="adm-modal-spacer"></span><button class="btn btn-ghost btn-sm" type="button" data-close>Cancel</button>
      ${o.submit === false ? '' : `<button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'} btn-sm" type="submit">${esc(o.submit || 'Save')}</button>`}</div>
  </form>`;
  document.body.appendChild(ov);
  const form = ov.querySelector('form');
  const err = ov.querySelector('.adm-modal-err');
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn._t = btn.textContent; btn.textContent = 'Saving…'; }
    let ok = false;
    try { ok = await o.onSubmit(form, msg => { err.textContent = msg; }); } catch (x) { err.textContent = 'Something went wrong: ' + (x && x.message || x); }
    if (ok !== false) close();
    else if (btn) { btn.disabled = false; btn.textContent = btn._t; }
  });
  if (o.onOpen) o.onOpen(form, close);
  // Only if nothing in the dialog has focus yet, so it never yanks the caret away mid-typing.
  setTimeout(() => { if (!form.contains(document.activeElement)) form.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea')?.focus(); }, 30);
  return { form, close };
}
// Submits a modal's action: shows Apps Script errors inside the dialog.
async function affModalDo(params, okMsg, setErr) {
  if (_sampleDataActive) { setErr('Not available with sample data. Exit sample data to manage the real program.'); return false; }
  const res = await affCall(params);
  if (!res.ok) { setErr(affError(res)); return false; }
  if (okMsg) showToast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
  await affReload();
  renderAffiliates();
  return res;
}
const affField = (label, control, hint, wide) => `<label class="adm-field${wide ? ' adm-field--wide' : ''}"><span>${esc(label)}</span>${control}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
const affInput = (name, value, attrs) => `<input class="adm-input" name="${name}" value="${esc(value == null ? '' : value)}" ${attrs || ''}>`;
const affSelect = (name, options, value, attrs) => `<select class="adm-input" name="${name}" ${attrs || ''}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const affCheck = (name, label, on) => `<label class="adm-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> <span>${esc(label)}</span></label>`;
const affProgramOptions = (withEmpty) => (withEmpty ? [['', withEmpty]] : []).concat(aff.programs.map(p => [p.id, p.name + (p.isDefault ? ' (default)' : '') + (p.active ? '' : ' (off)')]));
const affPartnerOptions = (filter, withEmpty) => (withEmpty ? [['', withEmpty]] : []).concat(aff.affiliates.filter(filter || (() => true)).sort((a, b) => a.name.localeCompare(b.name)).map(a => [a.code, a.name + ' (' + a.code + ')']));
const affStatusChip = st => `<span class="adm-status adm-status--${AFF_STATE_TONE[st] || 'test'}">${esc(AFF_STATE_LABEL[st] || st)}</span>`;
const affPartnerChip = st => `<span class="adm-status adm-status--${AFF_PARTNER_TONE[st] || 'test'}">${esc(AFF_PARTNER_LABEL[st] || st)}</span>`;
const affName = code => { const a = affPartner(code); return a ? a.name : code; };

// ══════════════════════ Render ══════════════════════
const AFF_VIEWS = [['analytics', '📈 Analytics'], ['programs', '🧩 Programs'], ['partners', '🤝 Partners'], ['referrals', '🧾 Referrals'], ['payments', '💸 Payments'], ['settings', '⚙️ Settings']];
function affSetupHtml() {
  return `<div class="panel"><div class="panel-inner">
    <div class="settings-card-title">🤝 Switch on the partner program</div>
    <p class="admin-danger-sub">The program runs in your own Apps Script and this spreadsheet, so there is nothing to pay for. Once:</p>
    <ol class="adm-steps">
      <li>Open the Apps Script, replace everything with the latest <b>Code.gs</b> from the repo, and save.</li>
      <li>Choose <b>setupAffiliates</b> in the function menu and press <b>Run</b>. Allow the permissions (it sends partner emails).</li>
      <li>In Project Settings, Script Properties, add <b>DODO_API_KEY</b> with your live Dodo API key, so coupons can be created in Dodo.</li>
      <li><b>Deploy</b>, <b>Manage deployments</b>, edit, <b>New version</b>, deploy. The partner page is <a href="/partners" target="_blank" rel="noopener">ezzohub.com/partners</a>.</li>
    </ol>
  </div></div>`;
}
function renderAffiliates() {
  const el = document.getElementById('aview-affiliates');
  if (!el) return;
  if (!aff.ready) { el.innerHTML = pageHead('Affiliates', 'Loading the partner program…'); return; }
  const pending = aff.affiliates.filter(a => a.status === 'pending').length;
  const review = aff.commissions.filter(c => !c.test && affState(c) === 'review').length;
  const ready = aff.commissions.filter(c => !c.test && affState(c) === 'approved').reduce((t, c) => t + c.amount, 0);
  const badge = { partners: pending, referrals: review, payments: ready > 0 ? money(ready) : '' };
  const usesRange = affView === 'analytics' || affView === 'partners' || affView === 'referrals';
  el.innerHTML = `
    ${pageHead('Affiliates', 'Your own partner program. Every rate, program, partner, referral and payout is set here.',
      `<a class="btn btn-ghost btn-sm" href="/partners" target="_blank" rel="noopener">Partner page ↗</a>`)}
    ${aff.missing ? affSetupHtml() : ''}
    <nav class="adm-subnav" role="tablist" aria-label="Affiliate sections">
      ${AFF_VIEWS.map(([k, l]) => `<button type="button" role="tab" class="${affView === k ? 'is-on' : ''}" data-affview="${k}">${l}${badge[k] ? `<b>${esc(String(badge[k]))}</b>` : ''}</button>`).join('')}
    </nav>
    ${usesRange ? rangeBarHtml('af') : ''}
    <div id="affBody"></div>`;
  el.querySelectorAll('[data-affview]').forEach(b => b.addEventListener('click', () => { affView = b.dataset.affview; renderAffiliates(); }));
  if (usesRange) wireRangeBar(el, 'af', renderAffiliates);
  const body = document.getElementById('affBody');
  ({ analytics: affRenderAnalytics, programs: affRenderPrograms, partners: affRenderPartners, referrals: affRenderReferrals, payments: affRenderPayments, settings: affRenderSettings }[affView] || affRenderAnalytics)(body);
  initFieldTips(el);
}

// ── Analytics ──────────────────────────────────────────────────────────
function affScope(list, getCode, R) {
  return list.filter(x => within(x.t, R) && (!affAnalytics.partner || getCode(x) === affAnalytics.partner) &&
    (!affAnalytics.program || affProgramOf(affPartner(getCode(x))).id === affAnalytics.program));
}
function affTotals(R) {
  const comms = affScope(aff.commissions.filter(c => !c.test), c => c.code, R);
  const refs = comms.filter(c => c.type === 'sale' && affCredited(c));
  const clicks = affScope(aff.clicks, c => c.code, R);
  const people = new Set(clicks.map(c => c.code + c.vid)).size;
  const sales = refs.reduce((t, c) => t + c.sale, 0);
  const commission = comms.filter(affCredited).reduce((t, c) => t + c.amount, 0);
  return { comms, refs, clicks, people, sales, commission, referrals: refs.length };
}
function affRenderAnalytics(el) {
  const R = rangeMs(), P = previousRangeMs();
  const now = affTotals(R), before = P ? affTotals(P) : null;
  const vs = P ? `Compared with the ${P.days} day${P.days === 1 ? '' : 's'} before this range` : '';
  const partners = aff.affiliates.filter(a => a.status === 'approved' && (!affAnalytics.program || affProgramOf(a).id === affAnalytics.program));
  const conv = now.people ? now.referrals / now.people * 100 : 0;
  const aov = now.referrals ? now.sales / now.referrals : 0;
  const cpc = now.clicks.length ? now.commission / now.clicks.length : 0;
  const roi = now.commission ? (now.sales - now.commission) / now.commission * 100 : 0;
  const cac = now.referrals ? now.commission / now.referrals : 0;
  const buckets = seriesBuckets();
  const metric = affAnalytics.metric;
  const series = buckets.map(b => {
    const inB = x => x.t >= b.start && x.t < b.end;
    const v = metric === 'clicks' ? now.clicks.filter(inB).length : metric === 'referrals' ? now.refs.filter(inB).length
      : metric === 'sales' ? now.refs.filter(inB).reduce((t, c) => t + c.sale, 0) : now.comms.filter(c => affCredited(c) && inB(c)).reduce((t, c) => t + c.amount, 0);
    return { label: b.label, value: Math.round(v * 100) / 100 };
  });
  const breakdown = ['pending', 'review', 'approved', 'paid', 'reversed'].map(st => ({
    label: AFF_STATE_LABEL[st], value: Math.round(now.comms.filter(c => (affState(c) === st || (st === 'reversed' && affState(c) === 'rejected'))).reduce((t, c) => t + Math.abs(c.amount), 0))
  }));
  const byVia = groupCount(now.comms.filter(affCredited).filter(c => c.type !== 'clawback'), c => AFF_VIA_LABEL[c.type === 'tier2' ? 'tier2' : c.via] || c.via);
  const rows = affPartnerRows(R, affAnalytics.program).filter(a => !affAnalytics.partner || a.code === affAnalytics.partner).filter(a => a.clicks || a.sales || a.earned).sort((a, b) => b.revenue - a.revenue);
  const progRows = aff.programs.map(p => {
    const members = affPartnerRows(R).filter(a => a.program.id === p.id);
    return { p, partners: members.filter(a => a.status === 'approved').length, sales: members.reduce((t, a) => t + a.sales, 0), revenue: members.reduce((t, a) => t + a.revenue, 0), earned: members.reduce((t, a) => t + a.earned, 0) };
  });
  const visits = uniqueBy(allEvents.filter(e => e.page === 'partners' && within(eventTime(e), R)), e => e.visitorId).length;
  const applied = aff.affiliates.filter(a => within(a.createdAt, R) && a.application !== 'Added by admin').length;
  el.innerHTML = `
    <div class="adm-toolbar">
      ${affSelect('afaProgram', affProgramOptions('All programs'), affAnalytics.program, 'id="afaProgram" aria-label="Program"')}
      ${affSelect('afaPartner', affPartnerOptions(a => a.status !== 'deleted', 'All partners'), affAnalytics.partner, 'id="afaPartner" aria-label="Partner"')}
    </div>
    ${statGrid([
      { icon: '🧾', label: 'Referrals', value: fmt(now.referrals), sub: fmt(partners.length) + ' active partner' + (partners.length === 1 ? '' : 's'), tone: '#6366f1', delta: deltaChip(now.referrals, before && before.referrals, false, vs), hint: 'Sales credited to a partner in this range, refunds and denied ones excluded.' },
      { icon: '💰', label: 'Partner sales', value: money(now.sales), sub: 'what those buyers paid you', tone: '#10b981', delta: deltaChip(now.sales, before && before.sales, false, vs) },
      { icon: '💸', label: 'Commission', value: money(now.commission), sub: 'earned by partners', tone: '#ec4899', delta: deltaChip(now.commission, before && before.commission, true, vs) },
      { icon: '🔗', label: 'Clicks', value: fmt(now.clicks.length), sub: fmt(now.people) + ' people', tone: '#3b82f6', delta: deltaChip(now.clicks.length, before && before.clicks.length, false, vs), hint: 'Visits through partner links, once per visitor per partner per day.' }
    ])}
    <div class="adm-mini-stats">
      <div><span>Conversion</span><strong>${conv.toFixed(conv && conv < 1 ? 2 : 1)}%</strong></div>
      <div><span>Average order</span><strong>${money(aov)}</strong></div>
      <div><span>Commission per click</span><strong>${money(cpc)}</strong></div>
      <div><span>Return on spend</span><strong>${now.commission ? Math.round(roi) + '%' : '-'}</strong></div>
      <div><span>Cost per customer</span><strong>${money(cac)}</strong></div>
      <div><span>Partner page visitors</span><strong>${fmt(visits)}<small> · ${fmt(applied)} applied</small></strong></div>
    </div>
    <div class="adm-grid adm-grid--wide-side">
      <div class="panel chart-panel spend-line-panel" data-chart-scope data-unit="${metric === 'sales' || metric === 'commission' ? 'money' : metric === 'clicks' ? 'click' : 'referral'}"><div class="panel-inner-sm">
        <div class="adm-panel-head">${panelTitle('Performance')}<div class="adm-chips">${[['commission', 'Commission'], ['sales', 'Sales'], ['referrals', 'Referrals'], ['clicks', 'Clicks']].map(([k, l]) => `<button type="button" class="admin-range-chip${metric === k ? ' is-active' : ''}" data-afmetric="${k}">${l}</button>`).join('')}</div></div>
        ${series.some(p => p.value > 0) ? svgSpendLine(series, { w: 900, h: 220, curve: true }) : '<div class="chart-empty">Nothing in this range yet.</div>'}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Commission by status', 'Commission earned in this range, by where it is now.')}
        ${vBarChartHtml(breakdown, { categories: breakdown.map(b => b.label) })}
      </div></div>
    </div>
    <div class="adm-grid adm-grid--2">
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Referrals by tracking type', 'How each credited sale was matched to a partner. A coupon wins over a link.')}
        ${hBarListHtml(byVia, { empty: 'No referrals in this range.' })}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Programs')}
        <div class="admin-table-wrap"><table class="admin-table adm-compact"><thead><tr><th>Program</th><th class="num">Partners</th><th class="num">Referrals</th><th class="num">Sales</th><th class="num">Commission</th></tr></thead><tbody>
          ${progRows.map(r => `<tr><td class="admin-table-strong">${esc(r.p.name)}${r.p.isDefault ? ' <span class="admin-src-badge">default</span>' : ''}</td><td class="num">${fmt(r.partners)}</td><td class="num">${fmt(r.sales)}</td><td class="num">${money(r.revenue)}</td><td class="num">${money(r.earned)}</td></tr>`).join('')}
        </tbody></table></div>
      </div></div>
    </div>
    <div class="panel"><div class="panel-inner-sm">
      ${panelTitle('Partner performance')}
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Partner</th><th>Program</th><th class="num">Clicks</th><th class="num">Demos</th><th class="num">Referrals</th><th class="num">Conv.</th><th class="num">Sales</th><th class="num">Commission</th></tr></thead><tbody>
        ${rows.length ? rows.map(a => `<tr><td><span class="admin-table-strong">${esc(a.name)}</span> <span class="adm-tag">${esc(a.code)}</span></td><td>${esc(a.program.name)}</td><td class="num">${fmt(a.clicks)}</td><td class="num">${fmt(a.demos)}</td><td class="num">${fmt(a.sales)}</td><td class="num">${a.people ? a.conv.toFixed(1) + '%' : '-'}</td><td class="num">${money(a.revenue)}</td><td class="num">${money(a.earned)}</td></tr>`).join('')
          : '<tr class="admin-empty-row"><td colspan="8">No partner activity in this range.</td></tr>'}
      </tbody></table></div>
    </div></div>`;
  document.getElementById('afaProgram').addEventListener('change', e => { affAnalytics.program = e.target.value; renderAffiliates(); });
  document.getElementById('afaPartner').addEventListener('change', e => { affAnalytics.partner = e.target.value; renderAffiliates(); });
  el.querySelectorAll('[data-afmetric]').forEach(b => b.addEventListener('click', () => { affAnalytics.metric = b.dataset.afmetric; renderAffiliates(); }));
  wireCharts(el);
}

// ── Programs ───────────────────────────────────────────────────────────
function affRenderPrograms(el) {
  const counts = new Map(), refs = new Map(), mism = new Map();
  aff.affiliates.filter(a => a.status !== 'deleted').forEach(a => { const p = affProgramOf(a).id; counts.set(p, (counts.get(p) || 0) + 1); });
  aff.commissions.filter(c => c.type === 'sale' && affCredited(c)).forEach(c => refs.set(c.programId, (refs.get(c.programId) || 0) + 1));
  aff.coupons.filter(c => affCouponState(c) === 'live').forEach(c => { const a = affPartner(c.affiliate); if (!a) return; const p = affProgramOf(a); if (c.percent !== p.buyerDiscount) mism.set(p.id, (mism.get(p.id) || 0) + 1); });
  el.innerHTML = `
    <div class="adm-toolbar"><p class="adm-toolbar-note">Each partner earns under one program. Partners on a program that is switched off earn under the default program until it is back on.</p>
      <button class="btn btn-primary btn-sm" type="button" id="afAddProgram">＋ Add program</button></div>
    <div class="panel"><div class="panel-inner-sm"><div class="admin-table-wrap"><table class="admin-table adm-orders">
      <thead><tr><th>Program</th><th>Commission</th><th>Tiers</th><th class="num">Buyer discount</th><th class="num">Window · hold</th><th>Approval</th><th class="num">Min. payout</th><th class="num">Partners</th><th class="num">Referrals</th><th>On</th></tr></thead>
      <tbody>${aff.programs.map(p => `<tr class="${p.active ? '' : 'admin-row-muted'}">
        <td><span class="admin-table-strong">${esc(p.name)}</span>${p.isDefault ? ' <span class="admin-src-badge">default</span>' : ''}<br><span class="admin-table-muted">${esc(p.id)}${p.description ? ' · ' + esc(p.description) : ''}</span>
          <div class="adm-acts"><button class="adm-linkbtn" type="button" data-afedit="${esc(p.id)}">Edit</button>${p.isDefault ? '' : `<button class="adm-linkbtn" type="button" data-afdefault="${esc(p.id)}">Make default</button><button class="adm-linkbtn adm-linkbtn--danger" type="button" data-afdel="${esc(p.id)}">Delete</button>`}</div></td>
        <td class="admin-table-strong">${affRateText(p.type, p.amount)}<br><span class="admin-table-muted">${p.type === 'flat' ? 'per sale' : 'of sale'}</span></td>
        <td style="white-space:normal;max-width:200px">${esc(affTiersText(p))}<br><span class="admin-table-muted">Second tier: ${p.tier2Rate ? p.tier2Rate + '%' : 'off'}</span></td>
        <td class="num">${p.buyerDiscount}%${mism.get(p.id) ? `<br><button class="adm-linkbtn" type="button" data-afsync="${esc(p.id)}" title="${mism.get(p.id)} partner code(s) use a different discount">Update ${mism.get(p.id)} code${mism.get(p.id) === 1 ? '' : 's'}</button>` : ''}</td>
        <td class="num">${p.cookieDays} days<br><span class="admin-table-muted">hold ${p.holdDays} days</span></td>
        <td>${p.approval === 'manual' ? 'You approve each' : 'Automatic'}</td>
        <td class="num">${money(p.minPayout)}</td>
        <td class="num">${fmt(counts.get(p.id) || 0)}</td><td class="num">${fmt(refs.get(p.id) || 0)}</td>
        <td>${p.isDefault ? '<span class="adm-status adm-status--paid">Always</span>' : `<label class="adm-switch" title="Switch this program on or off"><input type="checkbox" data-aftoggle="${esc(p.id)}"${p.active ? ' checked' : ''}><i></i></label>`}</td>
        </tr>`).join('')}</tbody>
    </table></div></div></div>`;
  document.getElementById('afAddProgram').addEventListener('click', () => affProgramModal(null));
  el.querySelectorAll('[data-afedit]').forEach(b => b.addEventListener('click', () => affProgramModal(affProgramById(b.dataset.afedit))));
  el.querySelectorAll('[data-aftoggle]').forEach(i => i.addEventListener('change', async () => {
    i.disabled = true;
    const res = await affDo({ op: 'program_save', id: i.dataset.aftoggle, active: i.checked ? 'yes' : 'no' }, i.checked ? 'Program switched on' : 'Program switched off');
    if (!res) { i.checked = !i.checked; i.disabled = false; }
  }));
  el.querySelectorAll('[data-afdefault]').forEach(b => b.addEventListener('click', () => affDo({ op: 'program_default', id: b.dataset.afdefault }, 'Default program changed')));
  el.querySelectorAll('[data-afdel]').forEach(b => b.addEventListener('click', async () => {
    const p = affProgramById(b.dataset.afdel), n = counts.get(p.id) || 0;
    if (!await confirmDialog({ message: `Delete "${p.name}"?${n ? ` Its ${n} partner${n === 1 ? '' : 's'} move to the default program.` : ''} Commission already earned is not changed.`, confirmText: 'Delete program' })) return;
    affDo({ op: 'program_delete', id: p.id }, r => 'Program deleted' + (r.moved ? `, ${r.moved} partner${r.moved === 1 ? '' : 's'} moved` : ''));
  }));
  el.querySelectorAll('[data-afsync]').forEach(b => b.addEventListener('click', async () => {
    const p = affProgramById(b.dataset.afsync);
    if (!await confirmDialog({ message: `Change every live code of ${p.name}'s partners to ${p.buyerDiscount}% off in Dodo?`, confirmText: 'Update codes', danger: false })) return;
    affDo({ op: 'program_sync_codes', id: p.id }, r => `${r.updated} code${r.updated === 1 ? '' : 's'} updated${r.failed ? `, ${r.failed} failed` : ''}`);
  }));
}
function affTierRowHtml(t) {
  return `<div class="adm-tier"><input class="adm-input" type="number" min="0" step="any" data-tmin value="${t ? esc(t.min) : ''}" placeholder="From"><span data-tunit></span>
    <input class="adm-input" type="number" min="0" step="any" data-tamt value="${t ? esc(t.amount) : ''}" placeholder="Pays"><span data-tamtunit></span>
    <button type="button" class="adm-iconbtn" data-tdel aria-label="Remove tier">×</button></div>`;
}
function affProgramModal(p) {
  const v = p || Object.assign({}, AFF_PROGRAM_FALLBACK, { id: '', name: '', isDefault: false, tiers: [] });
  affModal({
    title: p ? 'Edit program: ' + p.name : 'New program', wide: true, submit: p ? 'Save program' : 'Create program',
    body: `<div class="adm-form-grid">
      ${affField('Name', affInput('name', v.name, 'maxlength="60" required'), 'Shown to partners on their dashboard.')}
      ${affField('Description', affInput('description', v.description, 'maxlength="400"'), 'Optional, also shown to partners.')}
      ${affField('Commission type', affSelect('type', [['percent', 'Percent of the sale'], ['flat', 'Flat amount per sale']], v.type))}
      ${affField('Commission', `<span class="adm-field-in"><input class="adm-input" type="number" name="amount" min="0" step="any" value="${esc(v.amount)}" required><em data-unit></em></span>`, 'Worked out on what reached you: after tax and the buyer\'s discount.')}
      ${affField('Buyer discount', `<span class="adm-field-in"><input class="adm-input" type="number" name="buyerDiscount" min="0" max="100" step="1" value="${esc(v.buyerDiscount)}"><em>%</em></span>`, 'Percent off with this program\'s partner codes. 0 means no code is made.')}
      ${affField('Link window', `<span class="adm-field-in"><input class="adm-input" type="number" name="cookieDays" min="1" max="365" value="${esc(v.cookieDays)}"><em>days</em></span>`, 'How long a click counts. The latest partner link before the purchase wins.')}
      ${affField('Hold', `<span class="adm-field-in"><input class="adm-input" type="number" name="holdDays" min="0" max="365" value="${esc(v.holdDays)}"><em>days</em></span>`, 'Refund window before a referral can be paid.')}
      ${affField('Approval', affSelect('approval', [['auto', 'Automatic once the hold ends'], ['manual', 'I approve each referral']], v.approval))}
      ${affField('Minimum payout', `<span class="adm-field-in"><em>$</em><input class="adm-input" type="number" name="minPayout" min="0" step="any" value="${esc(v.minPayout)}"></span>`, 'You can still pay below it when you choose.')}
      ${affField('Second tier', `<span class="adm-field-in"><input class="adm-input" type="number" name="tier2Rate" min="0" max="50" step="any" value="${esc(v.tier2Rate)}"><em>%</em></span>`, 'Share of each sale paid to the partner who recruited the seller. 0 is off.')}
      <div class="adm-field adm-field--wide"><span>Automatic tiers</span>
        <div class="adm-tier-head">${affSelect('tierMetric', [['sales', 'Based on lifetime sales'], ['revenue', 'Based on lifetime revenue ($)']], v.tierMetric)}<button type="button" class="btn btn-ghost btn-sm" data-tadd>＋ Add tier</button></div>
        <div data-tiers>${v.tiers.map(affTierRowHtml).join('')}</div>
        <small>A partner moves up as soon as they pass a threshold. A custom rate on a partner always wins over tiers.</small></div>
      ${p && p.isDefault ? '' : `<div class="adm-field adm-field--wide">${affCheck('active', 'Program is on', v.active !== false)}</div>`}
    </div>`,
    onOpen: form => {
      const sync = () => {
        const flat = form.type.value === 'flat';
        form.querySelector('[data-unit]').textContent = flat ? '$ per sale' : '%';
        form.querySelectorAll('[data-tunit]').forEach(s => { s.textContent = form.tierMetric.value === 'revenue' ? '$ revenue' : 'sales'; });
        form.querySelectorAll('[data-tamtunit]').forEach(s => { s.textContent = flat ? '$' : '%'; });
      };
      form.type.addEventListener('change', sync);
      form.tierMetric.addEventListener('change', sync);
      form.querySelector('[data-tadd]').addEventListener('click', () => { form.querySelector('[data-tiers]').insertAdjacentHTML('beforeend', affTierRowHtml(null)); sync(); });
      form.querySelector('[data-tiers]').addEventListener('click', e => { if (e.target.closest('[data-tdel]')) e.target.closest('.adm-tier').remove(); });
      sync();
    },
    onSubmit: async (form, setErr) => {
      const tiers = [...form.querySelectorAll('.adm-tier')].map(r => ({ min: r.querySelector('[data-tmin]').value, amount: r.querySelector('[data-tamt]').value })).filter(t => t.min !== '' || t.amount !== '');
      if (!form.name.value.trim()) { setErr('Please name the program.'); return false; }
      if (tiers.some(t => !(Number(t.min) > 0) || t.amount === '' || Number(t.amount) < 0)) { setErr('Each tier needs a threshold above 0 and an amount.'); return false; }
      if (form.type.value === 'percent' && Number(form.amount.value) > 100) { setErr('A percentage commission goes up to 100.'); return false; }
      const params = { op: 'program_save', id: p ? p.id : '', name: form.name.value.trim(), description: form.description.value, type: form.type.value, amount: form.amount.value,
        buyerDiscount: form.buyerDiscount.value, cookieDays: form.cookieDays.value, holdDays: form.holdDays.value, approval: form.approval.value, minPayout: form.minPayout.value,
        tier2Rate: form.tier2Rate.value, tierMetric: form.tierMetric.value, tiers: JSON.stringify(tiers.map(t => ({ min: Number(t.min), amount: Number(t.amount) }))) };
      if (form.active) params.active = form.active.checked ? 'yes' : 'no';
      const res = await affModalDo(params, p ? 'Program saved' : 'Program created', setErr);
      if (!res) return false;
      if (res.discountChanged && p) {
        const n = aff.coupons.filter(c => affCouponState(c) === 'live' && affPartner(c.affiliate) && affProgramOf(affPartner(c.affiliate)).id === p.id).length;
        if (n && await confirmDialog({ message: `The buyer discount changed. Update ${n} existing partner code${n === 1 ? '' : 's'} on this program to ${form.buyerDiscount.value}% in Dodo now?`, confirmText: 'Update codes', danger: false })) {
          affDo({ op: 'program_sync_codes', id: p.id }, r => `${r.updated} code${r.updated === 1 ? '' : 's'} updated${r.failed ? `, ${r.failed} failed` : ''}`);
        }
      }
      return true;
    }
  });
}

// ── Partners ───────────────────────────────────────────────────────────
function affRenderPartners(el) {
  const R = rangeMs();
  const rows = affPartnerRows(R);
  const uses = affCouponUses();
  const pending = rows.filter(a => a.status === 'pending');
  const q = affPartnerFilters.q.trim().toLowerCase();
  const list = rows.filter(a => affPartnerFilters.status === 'all' ? true : affPartnerFilters.status === 'live' ? ['approved', 'paused'].includes(a.status) : a.status === affPartnerFilters.status)
    .filter(a => !affPartnerFilters.program || a.program.id === affPartnerFilters.program)
    .filter(a => !q || [a.code, a.name, a.email, a.website, a.notes].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => b.revenue - a.revenue || b.createdAt - a.createdAt);
  el.innerHTML = `
    ${pending.length ? `<div class="panel"><div class="panel-inner-sm">
      ${panelTitle('Applications (' + pending.length + ')', 'Approving makes the partner\'s coupon in Dodo and emails them their link, code and dashboard.')}
      <div class="adm-apps">${pending.map(a => `<div class="adm-app">
        <div class="adm-app-head"><div><strong>${esc(a.name)}</strong><span>${esc(a.email)}</span></div><span class="adm-tag">${esc(a.code)}</span></div>
        <dl>
          <div><dt>Shares on</dt><dd>${a.website ? `<a href="${esc(/^https?:/i.test(a.website) ? a.website : 'https://' + a.website)}" target="_blank" rel="noopener noreferrer">${esc(a.website)}</a>` : '-'}</dd></div>
          <div><dt>Audience</dt><dd>${esc(a.audience || '-')}</dd></div>
          <div><dt>Applied</dt><dd>${esc(shortDate(a.createdAt))}</dd></div>
          ${a.recruitedBy ? `<div><dt>Invited by</dt><dd>${esc(affName(a.recruitedBy))}</dd></div>` : ''}
        </dl>
        ${a.application ? `<p class="adm-app-text">${esc(a.application)}</p>` : ''}
        <div class="adm-app-actions">${affSelect('prog', affProgramOptions(), a.programId || affDefaultProgram().id, `data-approg="${esc(a.code)}" aria-label="Program"`)}
          <button class="btn btn-primary btn-sm" type="button" data-afapprove="${esc(a.code)}">Approve</button>
          <button class="btn btn-ghost btn-sm" type="button" data-afdecline="${esc(a.code)}">Decline</button></div>
      </div>`).join('')}</div>
    </div></div>` : ''}
    <div class="adm-toolbar">
      <input class="adm-input adm-input--grow" type="search" id="afpQ" placeholder="Search name, code, email or notes…" value="${esc(affPartnerFilters.q)}" aria-label="Search partners">
      ${affSelect('afpStatus', [['live', 'Active and paused'], ['approved', 'Active'], ['paused', 'Paused'], ['pending', 'Applied'], ['rejected', 'Declined'], ['deleted', 'Deleted'], ['all', 'Everyone']], affPartnerFilters.status, 'id="afpStatus" aria-label="Status"')}
      ${affSelect('afpProgram', affProgramOptions('All programs'), affPartnerFilters.program, 'id="afpProgram" aria-label="Program"')}
      <button class="btn btn-ghost btn-sm" type="button" id="afpExport">⬇ Export</button>
      <button class="btn btn-primary btn-sm" type="button" id="afpAdd">＋ Add partner</button>
    </div>
    <div class="panel"><div class="panel-inner-sm"><div class="admin-table-wrap"><table class="admin-table adm-orders">
      <thead><tr><th>Partner</th><th>Program</th><th>Coupons</th><th class="num">Clicks</th><th class="num">Referrals</th><th class="num">Sales</th><th class="num">Commission</th><th class="num">Ready</th><th class="num">Paid</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(a => {
        const cps = aff.coupons.filter(c => c.affiliate === a.code);
        const risky = a.allSales >= 3 && a.refundRate >= 0.3;
        return `<tr class="${['deleted', 'rejected'].includes(a.status) ? 'admin-row-muted' : ''}">
        <td><span class="admin-table-strong">${esc(a.name)}</span> <span class="adm-tag">${esc(a.code)}</span>${risky ? ' <span class="adm-risk" title="' + Math.round(a.refundRate * 100) + '% of their sales were refunded">High refunds</span>' : ''}<br><span class="admin-table-muted">${esc(a.email)} · joined ${esc(shortDate(a.approvedAt || a.createdAt))}${a.recruits ? ' · invited ' + a.recruits : ''}</span></td>
        <td>${esc(a.program.name)}${a.programId && affProgramById(a.programId) && !affProgramById(a.programId).active ? ' <span class="admin-src-badge" title="Their program is off, so they earn under the default">fallback</span>' : ''}<br><span class="admin-table-muted">${esc(a.effectiveRate)}${a.rateInfo.source === 'custom' ? ' custom' : a.rateInfo.source === 'tier' ? ' tier' : ''}</span></td>
        <td>${cps.length ? cps.slice(0, 3).map(c => `<span class="adm-tag ${affCouponState(c) === 'live' ? '' : 'adm-tag--off'}" title="${c.percent}% · ${uses.get(c.code) || 0} use(s) · ${affCouponState(c)}">${esc(c.code)}</span>`).join(' ') + (cps.length > 3 ? ` +${cps.length - 3}` : '') : '<span class="admin-table-muted">none</span>'}<br><button class="adm-linkbtn" type="button" data-afcoupons="${esc(a.code)}">Manage</button></td>
        <td class="num">${fmt(a.clicks)}</td><td class="num">${fmt(a.sales)}</td><td class="num">${money(a.revenue)}</td><td class="num">${money(a.earned)}</td>
        <td class="num">${money(a.available)}${a.review ? `<br><span class="admin-table-muted" title="Waiting for your approval">+${money(a.review)} to approve</span>` : ''}</td><td class="num">${money(a.paid)}</td>
        <td>${affPartnerChip(a.status)}</td>
        <td class="admin-col-action"><div class="adm-acts">
          <button class="adm-linkbtn" type="button" data-afpedit="${esc(a.code)}">Edit</button>
          <div class="adm-menu"><button class="adm-iconbtn" type="button" data-menu aria-label="More actions">⋯</button><div class="adm-menu-list" hidden>
            ${a.status !== 'deleted' ? `<button type="button" data-afas="${esc(a.code)}">👁 View as partner</button><button type="button" data-aflogin="${esc(a.code)}">✉️ Send sign-in link</button>` : ''}
            <button type="button" data-afref="${esc(a.code)}">🧾 Their referrals</button>
            ${a.status === 'approved' ? `<button type="button" data-afop="pause" data-code="${esc(a.code)}">⏸ Pause</button>` : ''}
            ${['paused', 'rejected', 'deleted'].includes(a.status) ? `<button type="button" data-afop="resume" data-code="${esc(a.code)}">▶ ${a.status === 'paused' ? 'Resume' : 'Reinstate'}</button>` : ''}
            ${a.status === 'pending' ? `<button type="button" data-afop="approve" data-code="${esc(a.code)}">✓ Approve</button>` : ''}
            ${a.status !== 'deleted' ? `<button type="button" class="is-danger" data-afop="delete" data-code="${esc(a.code)}">🗑 Delete</button>` : ''}
          </div></div>
        </div></td></tr>`;
      }).join('') : `<tr class="admin-empty-row"><td colspan="11">${aff.affiliates.length ? 'No partners match these filters.' : 'No partners yet. Add one yourself, or share ezzohub.com/partners.'}</td></tr>`}</tbody>
    </table></div></div></div>`;
  wireSearch('afpQ', v => { affPartnerFilters.q = v; renderAffiliates(); });
  document.getElementById('afpStatus').addEventListener('change', e => { affPartnerFilters.status = e.target.value; renderAffiliates(); });
  document.getElementById('afpProgram').addEventListener('change', e => { affPartnerFilters.program = e.target.value; renderAffiliates(); });
  document.getElementById('afpAdd').addEventListener('click', () => affPartnerModal(null));
  document.getElementById('afpExport').addEventListener('click', () => downloadCsv(
    ['Code', 'Name', 'Email', 'Status', 'Program', 'Rate', 'Coupons', 'Payout method', 'Payout email', 'Payout details', 'Website', 'Joined', 'Clicks', 'Referrals', 'Sales', 'Commission', 'Ready', 'Paid', 'Notes'],
    list.map(a => [a.code, a.name, a.email, AFF_PARTNER_LABEL[a.status] || a.status, a.program.name, a.effectiveRate, aff.coupons.filter(c => c.affiliate === a.code).map(c => c.code + ' ' + c.percent + '%').join('; '),
      AFF_METHOD_LABEL[a.method], a.payoutEmail, a.payoutDetails, a.website, a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '', a.clicks, a.sales, a.revenue.toFixed(2), a.earned.toFixed(2), a.available.toFixed(2), a.paid.toFixed(2), a.notes]),
    'ezzo-partners-' + new Date().toISOString().slice(0, 10) + '.csv'));
  el.querySelectorAll('[data-afapprove]').forEach(b => b.addEventListener('click', () => {
    const prog = el.querySelector(`[data-approg="${b.dataset.afapprove}"]`).value;
    b.disabled = true;
    affDo({ op: 'approve', code: b.dataset.afapprove, programId: prog }, r => 'Approved and welcomed' + (r.coupon && !['created', 'none', 'ok'].includes(r.coupon) ? '. Coupon not made yet: ' + affError({ error: r.coupon }) : '')).then(r => { if (!r) b.disabled = false; });
  }));
  el.querySelectorAll('[data-afdecline]').forEach(b => b.addEventListener('click', async () => {
    const a = affPartner(b.dataset.afdecline);
    if (!await confirmDialog({ message: `Decline ${a.name}? They get a short, polite email.`, confirmText: 'Decline' })) return;
    affDo({ op: 'reject', code: a.code, notify: '1' }, 'Declined');
  }));
  el.querySelectorAll('[data-afpedit]').forEach(b => b.addEventListener('click', () => affPartnerModal(affPartner(b.dataset.afpedit))));
  el.querySelectorAll('[data-afcoupons]').forEach(b => b.addEventListener('click', () => affCouponsModal(affPartner(b.dataset.afcoupons))));
  affWireMenus(el);
  el.querySelectorAll('[data-afas]').forEach(b => b.addEventListener('click', async () => {
    if (_sampleDataActive) { showToast('Not available with sample data.'); return; }
    // Opened now, filled in once the link arrives, so it isn't blocked as a pop-up.
    const w = window.open('about:blank', '_blank');
    const res = await affCall({ op: 'impersonate', code: b.dataset.afas });
    if (!res.ok) { if (w) w.close(); showToast(affError(res)); return; }
    if (w) w.location.href = res.url; else window.open(res.url, '_blank');
  }));
  el.querySelectorAll('[data-aflogin]').forEach(b => b.addEventListener('click', () => affDo({ op: 'login', code: b.dataset.aflogin }, 'Sign-in link sent')));
  el.querySelectorAll('[data-afref]').forEach(b => b.addEventListener('click', () => { affRefFilters = Object.assign({}, affRefFilters, { partner: b.dataset.afref, status: '' }); affView = 'referrals'; renderAffiliates(); }));
  el.querySelectorAll('[data-afop]').forEach(b => b.addEventListener('click', async () => {
    const { afop: op, code } = b.dataset;
    const a = affPartner(code);
    const ask = {
      pause: `Pause ${a.name}? Their link and coupons stop crediting sales until you resume them. Earned commission is kept.`,
      delete: `Delete ${a.name}? They can no longer sign in or earn, and their coupons stop working. Their referrals and payouts stay in your records, and you can reinstate them later.`
    }[op];
    if (ask && !await confirmDialog({ message: ask, confirmText: op === 'pause' ? 'Pause' : 'Delete' })) return;
    affDo({ op, code }, { pause: 'Paused', resume: 'Reinstated', approve: 'Approved', delete: 'Deleted' }[op]);
  }));
}
function affWireMenus(el) {
  el.querySelectorAll('.adm-menu [data-menu]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const list = b.nextElementSibling, open = list.hidden;
    document.querySelectorAll('.adm-menu-list').forEach(l => { l.hidden = true; });
    list.hidden = !open;
  }));
  el.querySelectorAll('.adm-menu-list button').forEach(b => b.addEventListener('click', () => { b.closest('.adm-menu-list').hidden = true; }));
}
document.addEventListener('click', () => document.querySelectorAll('.adm-menu-list').forEach(l => { l.hidden = true; }));

function affPartnerModal(a) {
  const isNew = !a;
  const v = a || { name: '', email: '', code: '', programId: affDefaultProgram().id, rate: '', rateType: '', method: 'paypal', payoutEmail: '', payoutDetails: '', website: '', notes: '', recruitedBy: '' };
  affModal({
    title: isNew ? 'Add a partner' : 'Edit ' + a.name, wide: true, submit: isNew ? 'Add partner' : 'Save changes',
    body: `<div class="adm-form-grid">
      ${affField('Name', affInput('name', v.name, 'maxlength="80" required'))}
      ${affField('Email', affInput('email', v.email, 'type="email" maxlength="120" required'), isNew ? 'Their sign-in and the address we email.' : 'Changing it changes where sign-in links go.')}
      ${isNew ? affField('Code', affInput('code', '', 'maxlength="16" placeholder="Leave empty to make one from their name" style="text-transform:uppercase"'), 'Their link (?ref=CODE) and their first coupon.') : affField('Code', `<input class="adm-input" value="${esc(a.code)}" disabled>`, 'Codes are permanent, because links already shared use them. Add extra coupons under Manage.')}
      ${affField('Program', affSelect('programId', affProgramOptions(), v.programId || affDefaultProgram().id))}
      ${affField('Custom commission', `<span class="adm-field-in">${affSelect('rateType', [['', 'Program\'s type'], ['percent', '%'], ['flat', '$ flat']], v.rateType)}<input class="adm-input" type="number" name="rate" min="0" step="any" value="${esc(v.rate)}" placeholder="Leave empty to use the program"></span>`, 'Overrides the program and its tiers for this partner only.', true)}
      ${affField('Payout method', affSelect('method', [['paypal', 'PayPal'], ['wise', 'Wise'], ['bank', 'Bank transfer']], v.method))}
      ${affField('Payout email', affInput('payout', v.payoutEmail, 'type="email" maxlength="120" placeholder="Same as their email if empty"'))}
      ${affField('Bank or payout details', `<textarea class="adm-input" name="details" rows="2" maxlength="500" placeholder="Account name, IBAN or account number, SWIFT…">${esc(v.payoutDetails)}</textarea>`, 'Shown in Payments when you pay them.', true)}
      ${affField('Website or main profile', affInput('site', v.website, 'maxlength="200"'))}
      ${isNew ? affField('Status', affSelect('status', [['approved', 'Active now'], ['pending', 'Applied (review later)']], 'approved')) : affField('Recruited by', affInput('recruitedBy', v.recruitedBy, 'maxlength="16" placeholder="Another partner\'s code"'), 'For second-tier rewards.')}
      ${affField('Private notes', `<textarea class="adm-input" name="notes" rows="2" maxlength="500">${esc(v.notes)}</textarea>`, 'Only you see these.', true)}
      ${isNew ? `<div class="adm-field adm-field--wide adm-checks">${affCheck('coupon', 'Create their coupon in Dodo (program discount)', true)}${affCheck('welcome', 'Email them a welcome with their link, code and dashboard', true)}</div>` : ''}
    </div>`,
    onSubmit: async (form, setErr) => {
      const email = form.email.value.trim();
      if (!form.name.value.trim()) { setErr('Please add a name.'); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('That email does not look right.'); return false; }
      if (form.rate.value !== '' && form.rateType.value !== 'flat' && Number(form.rate.value) > 100 && (form.rateType.value === 'percent' || affProgramById(form.programId.value).type === 'percent')) { setErr('A percentage goes up to 100.'); return false; }
      const params = { name: form.name.value.trim(), email, programId: form.programId.value, rate: form.rate.value, rateType: form.rate.value === '' ? '' : form.rateType.value,
        method: form.method.value, payout: form.payout.value.trim(), details: form.details.value, site: form.site.value.trim(), notes: form.notes.value };
      if (isNew) {
        Object.assign(params, { op: 'affiliate_add', code: form.code.value.trim(), status: form.status.value, coupon: form.coupon.checked ? '1' : '0', welcome: form.welcome.checked ? '1' : '0' });
        return !!(await affModalDo(params, r => `${form.name.value.trim()} added as ${r.code}` + (r.coupon && !['created', 'none'].includes(r.coupon) ? '. Coupon not made yet: ' + affError({ error: r.coupon }) : ''), setErr));
      }
      Object.assign(params, { op: 'affiliate_save', code: a.code, recruitedBy: form.recruitedBy.value.trim() });
      return !!(await affModalDo(params, 'Partner saved', setErr));
    }
  });
}

function affCouponsModal(a) {
  const uses = affCouponUses();
  const p = affProgramOf(a);
  const stateLabel = { live: 'Live', off: 'Off', paused: 'Paused (partner paused)', waiting: 'Waiting for API key' };
  const list = aff.coupons.filter(c => c.affiliate === a.code);
  const { form } = affModal({
    title: 'Coupons: ' + a.name, wide: true, submit: 'Add coupon',
    body: `<div class="admin-table-wrap"><table class="admin-table adm-compact"><thead><tr><th>Code</th><th class="num">Off</th><th class="num">Uses</th><th class="num">Limit</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.length ? list.map(c => `<tr data-coupon="${esc(c.code)}">
        <td class="admin-key-cell">${esc(c.code)}${c.note ? `<br><span class="admin-table-muted">${esc(c.note)}</span>` : ''}</td>
        <td class="num"><input class="adm-input adm-input--xs" type="number" min="1" max="100" data-cpct value="${esc(c.percent)}">%</td>
        <td class="num">${fmt(uses.get(c.code) || 0)}</td>
        <td class="num"><input class="adm-input adm-input--xs" type="number" min="1" data-climit value="${c.usageLimit || ''}" placeholder="∞"></td>
        <td><input class="adm-input adm-input--sm" type="date" data-cexp value="${c.expiresAt ? _isoDay(new Date(c.expiresAt)) : ''}"></td>
        <td>${esc(stateLabel[affCouponState(c)])}</td>
        <td class="admin-col-action"><div class="adm-row-actions"><button class="btn btn-ghost btn-sm" type="button" data-csave>Save</button>
          ${affCouponState(c) === 'live' ? '<button class="btn btn-ghost btn-sm" type="button" data-coff>Turn off</button>' : '<button class="btn btn-ghost btn-sm" type="button" data-con>Turn on</button>'}
          <button class="btn btn-ghost btn-sm" type="button" data-cdel>Delete</button></div></td></tr>`).join('') : '<tr class="admin-empty-row"><td colspan="7">No coupons yet.</td></tr>'}
    </tbody></table></div>
    <h4 class="adm-modal-sub">New coupon</h4>
    <div class="adm-form-grid">
      ${affField('Code', affInput('coupon', list.length ? '' : a.code, 'maxlength="16" style="text-transform:uppercase" placeholder="e.g. ' + esc(a.code) + '20"'))}
      ${affField('Discount', `<span class="adm-field-in"><input class="adm-input" type="number" name="percent" min="1" max="100" value="${esc(p.buyerDiscount || 10)}"><em>%</em></span>`, 'Program default: ' + p.buyerDiscount + '%.')}
      ${affField('Usage limit', affInput('usageLimit', '', 'type="number" min="1" placeholder="Unlimited"'))}
      ${affField('Expires', affInput('expiresAt', '', 'type="date"'))}
      ${affField('Note', affInput('note', '', 'maxlength="200" placeholder="e.g. Black Friday video"'), '', true)}
    </div>`,
    onSubmit: async (f, setErr) => {
      const code = f.coupon.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 3) { setErr('Codes need at least 3 letters or numbers.'); return false; }
      const pct = Number(f.percent.value);
      if (!(pct >= 1 && pct <= 100)) { setErr('Discounts go from 1% to 100%.'); return false; }
      const res = await affModalDo({ op: 'coupon_add', code: a.code, coupon: code, percent: pct, usageLimit: f.usageLimit.value, expiresAt: f.expiresAt.value, note: f.note.value },
        r => r.warning ? `Saved, but not live yet: ${affError({ error: r.warning })}` : `Coupon ${code} is live`, setErr);
      if (res) setTimeout(() => affCouponsModal(affPartner(a.code)), 0);
      return !!res;
    }
  });
  form.querySelectorAll('tr[data-coupon]').forEach(tr => {
    const coupon = tr.dataset.coupon;
    const reopen = () => setTimeout(() => affCouponsModal(affPartner(a.code)), 0);
    const run = async (params, msg) => { const r = await affDo(Object.assign({ coupon }, params), msg); if (r) { document.getElementById('affModal')?.remove(); reopen(); } };
    tr.querySelector('[data-csave]')?.addEventListener('click', () => run({ op: 'coupon_save', percent: tr.querySelector('[data-cpct]').value, usageLimit: tr.querySelector('[data-climit]').value, expiresAt: tr.querySelector('[data-cexp]').value }, 'Coupon updated'));
    tr.querySelector('[data-coff]')?.addEventListener('click', () => run({ op: 'coupon_toggle', active: '0' }, 'Coupon turned off'));
    tr.querySelector('[data-con]')?.addEventListener('click', () => run({ op: 'coupon_toggle', active: '1' }, 'Coupon is live'));
    tr.querySelector('[data-cdel]')?.addEventListener('click', async () => {
      if (!await confirmDialog({ message: `Delete coupon ${coupon}? It stops working at checkout straight away. Past sales keep their credit.`, confirmText: 'Delete coupon' })) return;
      run({ op: 'coupon_delete' }, 'Coupon deleted');
    });
  });
}

// ── Referrals ──────────────────────────────────────────────────────────
function affRefRows() {
  const R = rangeMs();
  const orders = affOrderMap();
  const buyerCounts = new Map();
  aff.commissions.forEach(c => { const o = orders.get(c.orderId); if (o && o.email && c.type === 'sale') buyerCounts.set(c.code + '|' + o.email, (buyerCounts.get(c.code + '|' + o.email) || 0) + 1); });
  const partnerStats = new Map(affPartnerRows({ fromMs: -Infinity, toMs: Infinity }).map(a => [a.code, a]));
  return aff.commissions.filter(c => within(c.t, R)).map(c => {
    const a = partnerStats.get(c.code);
    const o = orders.get(c.orderId);
    const flags = affRiskFlags(c, orders, buyerCounts).filter(f => f !== 'High refund rate' || (a && a.allSales >= 3 && a.refundRate >= 0.3));
    return Object.assign({}, c, { state: affState(c), order: o, flags, programName: (affProgramById(c.programId) || {}).name || c.programId || '-' });
  }).sort((a, b) => b.t - a.t);
}
function affRenderReferrals(el) {
  const all = affRefRows();
  const f = affRefFilters, q = f.q.trim().toLowerCase();
  const list = all.filter(c => (!f.status || c.state === f.status) && (!f.program || c.programId === f.program) && (!f.partner || c.code === f.partner) &&
    (!f.via || (f.via === 'tier2' ? c.type === 'tier2' : f.via === 'clawback' ? c.type === 'clawback' : c.via === f.via && c.type === 'sale')) && (!f.flagged || c.flags.length) &&
    (!q || [c.orderId, c.code, affName(c.code), c.note, c.order && c.order.email, c.order && c.order.name].some(v => String(v || '').toLowerCase().includes(q))));
  affSelectedRefs = new Set([...affSelectedRefs].filter(r => list.some(c => c.row === r)));
  const counts = {};
  all.forEach(c => { counts[c.state] = (counts[c.state] || 0) + 1; });
  el.innerHTML = `
    <div class="adm-pills">${[['', 'All', all.length], ['review', 'Needs approval', counts.review], ['pending', 'On hold', counts.pending], ['approved', 'Ready to pay', counts.approved], ['paid', 'Paid', counts.paid], ['rejected', 'Denied', counts.rejected], ['reversed', 'Refunded', counts.reversed]]
      .map(([k, l, n]) => `<button type="button" class="${f.status === k ? 'is-on' : ''}" data-afrs="${k}">${l}<b>${fmt(n || 0)}</b></button>`).join('')}</div>
    <div class="adm-toolbar">
      <input class="adm-input adm-input--grow" type="search" id="afrQ" placeholder="Search order, partner, buyer or note…" value="${esc(f.q)}" aria-label="Search referrals">
      ${affSelect('afrProgram', affProgramOptions('All programs'), f.program, 'id="afrProgram" aria-label="Program"')}
      ${affSelect('afrPartner', affPartnerOptions(null, 'All partners'), f.partner, 'id="afrPartner" aria-label="Partner"')}
      ${affSelect('afrVia', [['', 'Any tracking'], ['link', 'Link'], ['code', 'Coupon'], ['manual', 'Added by you'], ['tier2', 'Second tier'], ['clawback', 'Clawbacks']], f.via, 'id="afrVia" aria-label="Tracking"')}
      <label class="admin-search-toggle${f.flagged ? ' is-active' : ''}"><input type="checkbox" id="afrFlagged"${f.flagged ? ' checked' : ''}> ⚠️ Flagged only</label>
      <button class="btn btn-ghost btn-sm" type="button" id="afrExport">⬇ Export</button>
      <button class="btn btn-primary btn-sm" type="button" id="afrAdd">＋ Add referral</button>
    </div>
    <div class="adm-bulk" ${affSelectedRefs.size ? '' : 'hidden'}><span><b id="afrSelCount">${affSelectedRefs.size}</b> selected</span>
      <button class="btn btn-primary btn-sm" type="button" data-afbulk="approved">Approve</button><button class="btn btn-ghost btn-sm" type="button" data-afbulk="rejected">Deny</button><button class="btn btn-ghost btn-sm" type="button" data-afbulk="pending">Back to on hold</button></div>
    <div class="panel"><div class="panel-inner-sm"><div class="admin-table-wrap"><table class="admin-table adm-orders">
      <thead><tr><th><input type="checkbox" id="afrAll" aria-label="Select all"></th><th>Date</th><th>Order</th><th>Partner</th><th>Buyer</th><th class="num">Sale</th><th class="num">Commission</th><th>Status</th><th>Tracking · risk</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(c => {
        const editable = !['paid', 'reversed'].includes(c.state) && c.type !== 'clawback';
        return `<tr class="${c.test || ['rejected', 'reversed'].includes(c.state) ? 'admin-row-muted' : ''}">
        <td>${editable ? `<input type="checkbox" data-afsel="${c.row}"${affSelectedRefs.has(c.row) ? ' checked' : ''} aria-label="Select">` : ''}</td>
        <td title="${esc(shortDateTime(c.t))}">${esc(shortDate(c.t))}</td>
        <td class="admin-key-cell">${esc(c.orderId)}${c.test ? ' <span class="admin-src-badge">TEST</span>' : ''}${c.manual ? ' <span class="admin-src-badge">manual</span>' : ''}</td>
        <td>${esc(affName(c.code))} <span class="adm-tag">${esc(c.code)}</span><br><span class="admin-table-muted">${esc(c.programName)}</span></td>
        <td class="adm-wrap">${c.order ? `<span class="admin-table-strong">${esc(c.order.name || c.order.email || '-')}</span>${c.order.name ? `<br><span class="admin-table-muted">${esc(c.order.email)}</span>` : ''}` : '<span class="admin-table-muted">-</span>'}</td>
        <td class="num">${c.sale ? money(c.sale) : '-'}</td>
        <td class="num admin-table-strong">${money(c.amount)}${c.rate ? `<br><span class="admin-table-muted">${affRateText(c.rateType, c.rate)}</span>` : ''}</td>
        <td>${affStatusChip(c.state)}${c.state === 'pending' ? `<br><span class="admin-table-muted">until ${esc(shortDate(c.availableAt))}</span>` : ''}${c.payoutId ? `<br><span class="admin-table-muted">${esc(c.payoutId)}</span>` : ''}</td>
        <td style="white-space:normal;min-width:120px">${esc(c.type === 'tier2' ? 'Second tier' : c.type === 'clawback' ? 'Clawback' : AFF_VIA_LABEL[c.via] || c.via)}${c.sub ? ` <span class="admin-table-muted">${esc(c.sub)}</span>` : ''}
          ${c.flags.length ? '<br>' + c.flags.map(fl => `<span class="adm-risk">${esc(fl)}</span>`).join(' ') : ''}${c.note && !/^Code /.test(c.note) ? `<br><span class="admin-table-muted">${esc(c.note)}</span>` : ''}</td>
        <td class="admin-col-action"><div class="adm-acts adm-acts--col">
          ${editable && ['pending', 'review'].includes(c.state) ? `<button class="adm-linkbtn adm-linkbtn--go" type="button" data-afst="approved" data-row="${c.row}">Approve</button>` : ''}
          ${editable && c.state !== 'rejected' ? `<button class="adm-linkbtn adm-linkbtn--danger" type="button" data-afst="rejected" data-row="${c.row}">Deny</button>` : ''}
          ${editable ? `<button class="adm-linkbtn" type="button" data-afredit="${c.row}">Edit</button>` : ''}
        </div></td></tr>`;
      }).join('') : '<tr class="admin-empty-row"><td colspan="10">No referrals match. Sales credited to partners appear here the moment they happen.</td></tr>'}</tbody>
    </table></div></div></div>`;
  el.querySelectorAll('[data-afrs]').forEach(b => b.addEventListener('click', () => { affRefFilters.status = b.dataset.afrs; renderAffiliates(); }));
  wireSearch('afrQ', v => { affRefFilters.q = v; renderAffiliates(); });
  ['Program', 'Partner', 'Via'].forEach(k => document.getElementById('afr' + k).addEventListener('change', e => { affRefFilters[k.toLowerCase()] = e.target.value; renderAffiliates(); }));
  document.getElementById('afrFlagged').addEventListener('change', e => { affRefFilters.flagged = e.target.checked; renderAffiliates(); });
  document.getElementById('afrAdd').addEventListener('click', () => affReferralAddModal());
  document.getElementById('afrExport').addEventListener('click', () => downloadCsv(
    ['Date', 'Order', 'Partner code', 'Partner', 'Program', 'Buyer name', 'Buyer email', 'Sale', 'Rate', 'Commission', 'Status', 'Tracking', 'Campaign', 'Payout', 'Risk', 'Note'],
    list.map(c => [new Date(c.t).toISOString(), c.orderId, c.code, affName(c.code), c.programName, c.order ? c.order.name : '', c.order ? c.order.email : '', c.sale.toFixed(2), affRateText(c.rateType, c.rate), c.amount.toFixed(2),
      AFF_STATE_LABEL[c.state], c.type === 'sale' ? c.via : c.type, c.sub, c.payoutId, c.flags.join('; '), c.note]),
    'ezzo-referrals-' + new Date().toISOString().slice(0, 10) + '.csv'));
  const bulkBar = el.querySelector('.adm-bulk');
  const syncBulk = () => { bulkBar.hidden = !affSelectedRefs.size; document.getElementById('afrSelCount').textContent = affSelectedRefs.size; };
  el.querySelectorAll('[data-afsel]').forEach(i => i.addEventListener('change', () => { const r = Number(i.dataset.afsel); i.checked ? affSelectedRefs.add(r) : affSelectedRefs.delete(r); syncBulk(); }));
  document.getElementById('afrAll').addEventListener('change', e => { el.querySelectorAll('[data-afsel]').forEach(i => { i.checked = e.target.checked; const r = Number(i.dataset.afsel); e.target.checked ? affSelectedRefs.add(r) : affSelectedRefs.delete(r); }); syncBulk(); });
  el.querySelectorAll('[data-afbulk]').forEach(b => b.addEventListener('click', async () => {
    const st = b.dataset.afbulk, n = affSelectedRefs.size;
    if (st === 'rejected' && !await confirmDialog({ message: `Deny ${n} referral${n === 1 ? '' : 's'}? Partners see them as not eligible. You can restore them later.`, confirmText: 'Deny' })) return;
    const rows = [...affSelectedRefs].join(',');
    const res = await affDo({ op: 'referral_status', rows, status: st }, r => `${r.changed} updated${r.skipped ? `, ${r.skipped} skipped (paid or refunded)` : ''}`);
    if (res) affSelectedRefs.clear();
  }));
  el.querySelectorAll('[data-afst]').forEach(b => b.addEventListener('click', async () => {
    const st = b.dataset.afst;
    if (st === 'rejected' && !await confirmDialog({ message: 'Deny this referral? The partner sees it as not eligible. You can restore it later.', confirmText: 'Deny' })) return;
    b.disabled = true;
    affDo({ op: 'referral_save', row: b.dataset.row, status: st }, st === 'approved' ? 'Approved' : 'Denied').then(r => { if (!r) b.disabled = false; });
  }));
  el.querySelectorAll('[data-afredit]').forEach(b => b.addEventListener('click', () => affReferralEditModal(all.find(c => c.row === Number(b.dataset.afredit)))));
}
function affReferralAddModal() {
  const credited = new Set(aff.commissions.filter(c => c.type === 'sale' && c.status !== 'rejected').map(c => c.orderId));
  const cutoff = Date.now() - 180 * 86400000;
  const open = salesLedger().filter(o => o.channel === 'dodo' && !o.test && o.status !== 'refunded' && !credited.has(o.orderId) && o.t >= cutoff);
  affModal({
    title: 'Add a referral', wide: true, submit: 'Add referral',
    body: `<p class="adm-modal-text">Credit a sale to a partner by hand, for example when a buyer forgot to use their code or link.</p>
    <div class="adm-form-grid">
      ${affField('Partner', affSelect('code', affPartnerOptions(a => ['approved', 'paused'].includes(a.status), 'Choose a partner'), ''), '', true)}
      ${affField('Order', affSelect('order', [['', open.length ? 'Choose a sale without a partner' : 'No uncredited sales in the last 180 days']].concat(open.map(o => [o.orderId, shortDate(o.t) + ' · ' + money(o.kept) + ' · ' + (o.email || o.name || o.orderId)])).concat([['__other', 'Another order (type it below)']]), ''), 'Sales from the last 180 days that no partner has yet.', true)}
      ${affField('Order id', affInput('orderId', '', 'maxlength="80" placeholder="Leave empty for a manual id"'))}
      ${affField('Sale amount', `<span class="adm-field-in"><em>$</em><input class="adm-input" type="number" name="sale" min="0" step="0.01" value="49.99"></span>`, 'What reached you for this order.')}
      ${affField('Commission', `<span class="adm-field-in"><em>$</em><input class="adm-input" type="number" name="commission" min="0" step="0.01" placeholder="Automatic"></span>`, 'Leave empty to use the partner\'s current rate.', false)}
      ${affField('Status', affSelect('status', [['pending', 'Follow the program (hold, then approval)'], ['approved', 'Ready to pay now']], 'pending'))}
      ${affField('Date', affInput('date', _isoDay(new Date()), 'type="date"'))}
      ${affField('Note', affInput('note', '', 'maxlength="200" placeholder="e.g. Forgot the code, confirmed by email"'), '', true)}
    </div>
    <p class="adm-modal-text" data-preview></p>`,
    onOpen: form => {
      const preview = () => {
        const a = affPartner(form.code.value);
        const sale = Number(form.sale.value) || 0;
        form.querySelector('[data-preview]').textContent = a ? `At ${affRateText(affRateFor(a).type, affRateFor(a).amount)} this pays ${money(affCommissionFor(a, sale))} unless you set a commission.` : '';
      };
      form.order.addEventListener('change', () => {
        const o = open.find(x => x.orderId === form.order.value);
        if (o) { form.orderId.value = o.orderId; form.sale.value = o.kept.toFixed(2); form.date.value = _isoDay(new Date(o.t)); }
        else if (form.order.value === '__other') { form.orderId.value = ''; form.orderId.focus(); }
        preview();
      });
      form.code.addEventListener('change', preview);
      form.sale.addEventListener('input', preview);
    },
    onSubmit: async (form, setErr) => {
      if (!form.code.value) { setErr('Choose a partner.'); return false; }
      if (!(Number(form.sale.value) >= 0) || form.sale.value === '') { setErr('Check the sale amount.'); return false; }
      return !!(await affModalDo({ op: 'referral_add', code: form.code.value, orderId: form.orderId.value.trim(), sale: form.sale.value, commission: form.commission.value,
        status: form.status.value, date: form.date.value, note: form.note.value || 'Added by admin' }, r => `Referral added: ${money(r.commission)} to ${affName(form.code.value)}`, setErr));
    }
  });
}
function affReferralEditModal(c) {
  affModal({
    title: 'Referral ' + c.orderId, submit: 'Save referral',
    body: `<div class="adm-form-grid">
      ${affField('Partner', affSelect('to', affPartnerOptions(a => a.status !== 'deleted'), c.code), 'Move the credit to another partner.', true)}
      ${affField('Commission', `<span class="adm-field-in"><em>$</em><input class="adm-input" type="number" name="commission" step="0.01" value="${c.amount.toFixed(2)}"></span>`, 'Sale ' + money(c.sale) + (c.rate ? ', earned at ' + affRateText(c.rateType, c.rate) : '') + '.')}
      ${affField('Status', affSelect('status', [['pending', c.approval === 'manual' ? 'On hold / needs approval' : 'On hold (ready after hold)'], ['approved', 'Ready to pay'], ['rejected', 'Denied']], c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'))}
      ${affField('Note', affInput('note', c.note, 'maxlength="200"'), 'Partners see notes on their earnings list.', true)}
    </div>`,
    onSubmit: async (form, setErr) => {
      const params = { op: 'referral_save', row: c.row, commission: form.commission.value, note: form.note.value };
      if (form.status.value !== (c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending')) params.status = form.status.value;
      if (form.to.value !== c.code) params.to = form.to.value;
      return !!(await affModalDo(params, 'Referral saved', setErr));
    }
  });
}

// ── Payments ───────────────────────────────────────────────────────────
function affReadyGroups() {
  const m = new Map();
  aff.commissions.filter(c => !c.test && affState(c) === 'approved').forEach(c => {
    if (!m.has(c.code)) m.set(c.code, []);
    m.get(c.code).push(c);
  });
  return [...m.entries()].map(([code, items]) => {
    const a = affPartner(code) || { code, name: code, email: '', method: 'paypal', payoutEmail: '', payoutDetails: '' };
    const p = affProgramOf(a);
    const amount = Math.round(items.reduce((t, c) => t + c.amount, 0) * 100) / 100;
    return { a, p, items: items.sort((x, y) => x.t - y.t), amount, min: p.minPayout, reached: amount >= p.minPayout };
  }).filter(g => g.amount > 0).sort((x, y) => y.amount - x.amount);
}
function affPayInfo(a) {
  if (a.method === 'bank') return a.payoutDetails ? esc(a.payoutDetails).replace(/\n/g, '<br>') : '<span class="adm-risk">No bank details yet</span>';
  return esc(a.payoutEmail || a.email) + (a.payoutDetails ? `<br><span class="admin-table-muted">${esc(a.payoutDetails)}</span>` : '');
}
function affRenderPayments(el) {
  const groups = affReadyGroups();
  const live = aff.payouts.filter(p => p.status === 'paid');
  const awaiting = live.filter(p => !p.confirmedAt);
  const paidTotal = live.reduce((t, p) => t + p.amount, 0);
  const readyTotal = groups.reduce((t, g) => t + g.amount, 0);
  const due = groups.filter(g => g.reached);
  affSelectedPay = new Set([...affSelectedPay].filter(c => groups.some(g => g.a.code === c)));
  el.innerHTML = `
    ${statGrid([
      { icon: '💸', label: 'Ready to pay', value: money(readyTotal), sub: fmt(groups.length) + ' partner' + (groups.length === 1 ? '' : 's') + ' · ' + fmt(due.length) + ' past their minimum', tone: '#f59e0b' },
      { icon: '✅', label: 'Paid', value: money(paidTotal), sub: fmt(live.length) + ' payout' + (live.length === 1 ? '' : 's') + ', all time', tone: '#10b981' },
      { icon: '🤝', label: 'Confirmed by partners', value: live.length ? Math.round((live.length - awaiting.length) / live.length * 100) + '%' : '-', sub: fmt(awaiting.length) + ' waiting for the partner to confirm', tone: '#6366f1',
        hint: 'Each payout email asks the partner to press "I received it" in their dashboard. That confirmation is your proof the money landed.' },
      { icon: '⏳', label: 'Coming up', value: money(aff.commissions.filter(c => !c.test && ['pending', 'review'].includes(affState(c))).reduce((t, c) => t + c.amount, 0)), sub: 'on hold or needing approval', tone: '#ec4899' }
    ])}
    <div class="adm-pills">
      <button type="button" class="${affPayView === 'ready' ? 'is-on' : ''}" data-afpay="ready">Ready to pay<b>${fmt(groups.length)}</b></button>
      <button type="button" class="${affPayView === 'paid' ? 'is-on' : ''}" data-afpay="paid">Paid<b>${fmt(aff.payouts.length)}</b></button>
    </div>
    <div id="afPayBody"></div>`;
  el.querySelectorAll('[data-afpay]').forEach(b => b.addEventListener('click', () => { affPayView = b.dataset.afpay; renderAffiliates(); }));
  const body = document.getElementById('afPayBody');
  if (affPayView === 'paid') return affRenderPaid(body);
  body.innerHTML = `
    <div class="adm-toolbar">
      <p class="adm-toolbar-note">Pay partners in PayPal, Wise or by bank, then record it here. Each partner gets a receipt and confirms it from their dashboard.</p>
      <button class="btn btn-ghost btn-sm" type="button" id="afpPaypal">⬇ PayPal payouts CSV</button>
      <button class="btn btn-ghost btn-sm" type="button" id="afpPayExport">⬇ Export</button>
    </div>
    <div class="adm-bulk" ${affSelectedPay.size ? '' : 'hidden'}><span><b id="afpSelCount">${affSelectedPay.size}</b> selected</span><button class="btn btn-primary btn-sm" type="button" id="afpBulkPay">Mark selected paid</button></div>
    <div class="panel"><div class="panel-inner-sm"><div class="admin-table-wrap"><table class="admin-table adm-orders">
      <thead><tr><th><input type="checkbox" id="afpAll" aria-label="Select all"></th><th>Partner</th><th>Method</th><th>Pay to</th><th class="num">Referrals</th><th class="num">Amount</th><th>Minimum</th><th></th></tr></thead>
      <tbody>${groups.length ? groups.map(g => `<tr>
        <td><input type="checkbox" data-afpsel="${esc(g.a.code)}"${affSelectedPay.has(g.a.code) ? ' checked' : ''} aria-label="Select"></td>
        <td class="adm-wrap"><span class="admin-table-strong">${esc(g.a.name)}</span> <span class="adm-tag">${esc(g.a.code)}</span><br><span class="admin-table-muted">${esc(g.a.email)} · ${esc(g.p.name)}</span></td>
        <td>${esc(AFF_METHOD_LABEL[g.a.method] || g.a.method)}</td>
        <td class="adm-wrap" style="max-width:260px">${affPayInfo(g.a)}</td>
        <td class="num">${fmt(g.items.length)}</td>
        <td class="num admin-table-strong">${money(g.amount)}</td>
        <td>${g.reached ? '<span class="adm-status adm-status--paid">Reached</span>' : `<span class="adm-status adm-status--test">${money(g.min - g.amount)} to go</span>`}</td>
        <td class="admin-col-action"><div class="adm-acts adm-acts--col"><button class="btn btn-primary btn-sm" type="button" data-afpaynow="${esc(g.a.code)}">Pay</button><button class="adm-linkbtn" type="button" data-afdet="${esc(g.a.code)}">${affOpenRows.has('r' + g.a.code) ? 'Hide' : 'Details'}</button></div></td>
      </tr>${affOpenRows.has('r' + g.a.code) ? `<tr class="admin-activity-detail"><td colspan="8">${affItemsTable(g.items)}</td></tr>` : ''}`).join('')
        : '<tr class="admin-empty-row"><td colspan="8">Nothing ready to pay. Referrals become ready when their hold ends (or when you approve them, on manual programs).</td></tr>'}</tbody>
    </table></div></div></div>`;
  const syncBulk = () => { body.querySelector('.adm-bulk').hidden = !affSelectedPay.size; document.getElementById('afpSelCount').textContent = affSelectedPay.size; };
  body.querySelectorAll('[data-afpsel]').forEach(i => i.addEventListener('change', () => { i.checked ? affSelectedPay.add(i.dataset.afpsel) : affSelectedPay.delete(i.dataset.afpsel); syncBulk(); }));
  document.getElementById('afpAll').addEventListener('change', e => { body.querySelectorAll('[data-afpsel]').forEach(i => { i.checked = e.target.checked; e.target.checked ? affSelectedPay.add(i.dataset.afpsel) : affSelectedPay.delete(i.dataset.afpsel); }); syncBulk(); });
  body.querySelectorAll('[data-afdet]').forEach(b => b.addEventListener('click', () => { const k = 'r' + b.dataset.afdet; affOpenRows.has(k) ? affOpenRows.delete(k) : affOpenRows.add(k); renderAffiliates(); }));
  body.querySelectorAll('[data-afpaynow]').forEach(b => b.addEventListener('click', () => affPayModal(groups.find(g => g.a.code === b.dataset.afpaynow))));
  document.getElementById('afpBulkPay')?.addEventListener('click', () => affBulkPayModal(groups.filter(g => affSelectedPay.has(g.a.code))));
  const pick = affSelectedPay.size ? groups.filter(g => affSelectedPay.has(g.a.code)) : due;
  document.getElementById('afpPaypal').addEventListener('click', () => downloadCsv(['Recipient', 'Amount', 'Currency', 'Recipient ID', 'Note'],
    pick.filter(g => g.a.method === 'paypal').map(g => [g.a.payoutEmail || g.a.email, g.amount.toFixed(2), 'USD', g.a.code, 'Ezzo Hub partner commission']),
    'ezzo-paypal-payouts-' + new Date().toISOString().slice(0, 10) + '.csv'));
  document.getElementById('afpPayExport').addEventListener('click', () => downloadCsv(['Partner code', 'Partner', 'Email', 'Method', 'Pay to', 'Details', 'Referrals', 'Amount', 'Minimum', 'Reached'],
    groups.map(g => [g.a.code, g.a.name, g.a.email, AFF_METHOD_LABEL[g.a.method], g.a.payoutEmail || g.a.email, g.a.payoutDetails, g.items.length, g.amount.toFixed(2), g.min.toFixed(2), g.reached ? 'yes' : 'no']),
    'ezzo-ready-to-pay-' + new Date().toISOString().slice(0, 10) + '.csv'));
}
function affItemsTable(items) {
  return `<div class="admin-table-wrap"><table class="admin-table adm-compact"><thead><tr><th>Date</th><th>Order</th><th>Type</th><th class="num">Sale</th><th class="num">Commission</th><th>Note</th></tr></thead><tbody>
    ${items.map(c => `<tr><td>${esc(shortDate(c.t))}</td><td class="admin-key-cell">${esc(c.orderId)}</td><td>${esc(c.type === 'sale' ? (AFF_VIA_LABEL[c.via] || c.via) : c.type === 'tier2' ? 'Second tier' : 'Clawback')}</td><td class="num">${c.sale ? money(c.sale) : '-'}</td><td class="num">${money(c.amount)}</td><td class="admin-table-muted">${esc(c.note || '')}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function affPayModal(g) {
  affModal({
    title: 'Pay ' + g.a.name, wide: true, submit: 'Record payment',
    body: `<div class="adm-pay-to"><div><span>Pay to</span><strong>${esc(AFF_METHOD_LABEL[g.a.method])}</strong><p>${affPayInfo(g.a)}</p></div><div><span>Program minimum</span><strong>${money(g.min)}</strong></div><div><span>Total selected</span><strong data-total>${money(g.amount)}</strong></div></div>
    <div class="admin-table-wrap"><table class="admin-table adm-compact"><thead><tr><th><input type="checkbox" data-payall checked aria-label="Select all"></th><th>Date</th><th>Order</th><th>Type</th><th class="num">Sale</th><th class="num">Commission</th></tr></thead><tbody>
      ${g.items.map(c => `<tr><td><input type="checkbox" data-payrow="${c.row}" data-amt="${c.amount}" checked></td><td>${esc(shortDate(c.t))}</td><td class="admin-key-cell">${esc(c.orderId)}</td><td>${esc(c.type === 'sale' ? (AFF_VIA_LABEL[c.via] || c.via) : c.type === 'tier2' ? 'Second tier' : 'Clawback')}</td><td class="num">${c.sale ? money(c.sale) : '-'}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="adm-form-grid">
      ${affField('Paid with', affSelect('method', [['paypal', 'PayPal'], ['wise', 'Wise'], ['bank', 'Bank transfer']], g.a.method))}
      ${affField('Date paid', affInput('paidDate', _isoDay(new Date()), 'type="date"'))}
      ${affField('Reference', affInput('reference', '', 'maxlength="120" placeholder="PayPal or bank transaction id"'), 'Kept on the payout and shown to the partner, so you can both trace it.', true)}
      ${affField('Note', affInput('note', '', 'maxlength="200"'), 'Private.', true)}
      <div class="adm-field adm-field--wide adm-checks">${affCheck('notify', 'Email the partner a receipt (asks them to confirm it arrived)', true)}<span data-minrow hidden>${affCheck('force', 'Pay below the minimum', false)}</span></div>
    </div>`,
    onOpen: form => {
      const update = () => {
        const boxes = [...form.querySelectorAll('[data-payrow]')];
        const total = boxes.filter(b => b.checked).reduce((t, b) => t + Number(b.dataset.amt), 0);
        form.querySelector('[data-total]').textContent = money(total);
        form.querySelector('[data-minrow]').hidden = total >= g.min;
        form.querySelector('[data-payall]').checked = boxes.every(b => b.checked);
      };
      form.querySelectorAll('[data-payrow]').forEach(b => b.addEventListener('change', update));
      form.querySelector('[data-payall]').addEventListener('change', e => { form.querySelectorAll('[data-payrow]').forEach(b => { b.checked = e.target.checked; }); update(); });
      update();
    },
    onSubmit: async (form, setErr) => {
      const picked = [...form.querySelectorAll('[data-payrow]')].filter(b => b.checked);
      const total = picked.reduce((t, b) => t + Number(b.dataset.amt), 0);
      if (!picked.length || total <= 0) { setErr('Select at least one referral, with a total above $0.'); return false; }
      if (total < g.min && !form.force.checked) { setErr(`That is below the ${money(g.min)} minimum. Tick "Pay below the minimum" to pay anyway.`); return false; }
      const all = picked.length === g.items.length;
      return !!(await affModalDo({ op: 'payout', code: g.a.code, rows: all ? '' : picked.map(b => b.dataset.payrow).join(','), method: form.method.value, paidDate: form.paidDate.value,
        reference: form.reference.value.trim(), note: form.note.value, notify: form.notify.checked ? '1' : '0', force: form.force.checked ? '1' : '0' },
        r => `Recorded ${r.id}: ${money(r.amount)} for ${r.count} referral${r.count === 1 ? '' : 's'}`, setErr));
    }
  });
}
function affBulkPayModal(groups) {
  const total = groups.reduce((t, g) => t + g.amount, 0);
  const below = groups.filter(g => !g.reached);
  affModal({
    title: `Mark ${groups.length} partner${groups.length === 1 ? '' : 's'} paid`, submit: 'Record payments',
    body: `<p class="adm-modal-text">Records every ready referral for ${groups.map(g => esc(g.a.name)).join(', ')}: <b>${money(total)}</b> in total. Each partner gets their own payout and receipt.</p>
      <div class="adm-form-grid">
        ${affField('Date paid', affInput('paidDate', _isoDay(new Date()), 'type="date"'))}
        ${affField('Reference', affInput('reference', '', 'maxlength="120" placeholder="e.g. PayPal batch id"'))}
        <div class="adm-field adm-field--wide adm-checks">${affCheck('notify', 'Email each partner a receipt', true)}${below.length ? affCheck('force', `Include ${below.length} below their minimum`, false) : ''}</div>
      </div>`,
    onSubmit: async (form, setErr) => {
      const list = groups.filter(g => g.reached || (form.force && form.force.checked));
      if (!list.length) { setErr('None of these are past their minimum. Tick the box to include them.'); return false; }
      let done = 0, failed = [];
      for (const g of list) {
        const res = await affCall({ op: 'payout', code: g.a.code, paidDate: form.paidDate.value, reference: form.reference.value.trim(), notify: form.notify.checked ? '1' : '0', force: g.reached ? '0' : '1' });
        if (res.ok) done++; else failed.push(g.a.name + ': ' + affError(res));
      }
      affSelectedPay.clear();
      await affReload(); renderAffiliates();
      if (failed.length) { setErr(`${done} recorded. Not recorded: ${failed.join(' · ')}`); return false; }
      showToast(`${done} payout${done === 1 ? '' : 's'} recorded`);
      return true;
    }
  });
}
function affRenderPaid(body) {
  const f = affPaidFilters, q = f.q.trim().toLowerCase();
  const list = aff.payouts.slice().sort((a, b) => b.paidDate - a.paidDate)
    .filter(p => !f.partner || p.code === f.partner)
    .filter(p => !f.state || (f.state === 'awaiting' ? p.status === 'paid' && !p.confirmedAt : f.state === 'confirmed' ? !!p.confirmedAt && p.status === 'paid' : p.status === 'void'))
    .filter(p => !q || [p.id, p.code, affName(p.code), p.reference, p.payoutEmail, p.note].some(v => String(v || '').toLowerCase().includes(q)));
  body.innerHTML = `
    <div class="adm-toolbar">
      <input class="adm-input adm-input--grow" type="search" id="afpdQ" placeholder="Search payout, partner or reference…" value="${esc(f.q)}" aria-label="Search payouts">
      ${affSelect('afpdPartner', affPartnerOptions(null, 'All partners'), f.partner, 'id="afpdPartner" aria-label="Partner"')}
      ${affSelect('afpdState', [['', 'Any status'], ['awaiting', 'Waiting for partner to confirm'], ['confirmed', 'Confirmed by partner'], ['void', 'Undone']], f.state, 'id="afpdState" aria-label="Status"')}
      <button class="btn btn-ghost btn-sm" type="button" id="afpdExport">⬇ Export</button>
    </div>
    <div class="panel"><div class="panel-inner-sm"><div class="admin-table-wrap"><table class="admin-table adm-orders">
      <thead><tr><th>Date paid</th><th>Payout</th><th>Partner</th><th>Paid with</th><th class="num">Referrals</th><th class="num">Amount</th><th>Reference</th><th>Verification</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(p => `<tr class="${p.status === 'void' ? 'admin-row-muted' : ''}">
        <td>${esc(shortDate(p.paidDate))}</td><td class="admin-key-cell">${esc(p.id)}</td>
        <td class="adm-wrap">${esc(affName(p.code))} <span class="adm-tag">${esc(p.code)}</span></td>
        <td class="adm-wrap">${esc(AFF_METHOD_LABEL[p.method] || p.method)}<br><span class="admin-table-muted">${esc(p.method === 'bank' ? (p.details || '').split('\n')[0] : p.payoutEmail)}</span></td>
        <td class="num">${fmt(p.referrals)}</td><td class="num admin-table-strong">${money(p.amount)}</td>
        <td>${esc(p.reference || '-')}${p.note ? `<br><span class="admin-table-muted">${esc(p.note)}</span>` : ''}</td>
        <td>${p.status === 'void' ? `<span class="adm-status adm-status--test">Undone ${esc(shortDate(p.voidedAt))}</span>` : p.confirmedAt ? `<span class="adm-status adm-status--paid" title="The partner pressed 'I received it'">✓ Confirmed ${esc(shortDate(p.confirmedAt))}</span>` : '<span class="adm-status adm-status--wait">Waiting for partner</span>'}</td>
        <td class="admin-col-action"><div class="adm-acts adm-acts--col"><button class="adm-linkbtn" type="button" data-afpo="${esc(p.id)}">${affOpenRows.has('p' + p.id) ? 'Hide' : 'Details'}</button>
          ${p.status === 'paid' ? `<button class="adm-linkbtn" type="button" data-afpoedit="${esc(p.id)}">Edit</button><button class="adm-linkbtn adm-linkbtn--danger" type="button" data-afundo="${esc(p.id)}">Undo</button>` : ''}</div></td>
      </tr>${affOpenRows.has('p' + p.id) ? `<tr class="admin-activity-detail"><td colspan="9">${affItemsTable(aff.commissions.filter(c => c.payoutId === p.id))}${p.status === 'void' ? '<p class="adm-note">Undone: these referrals went back to ready to pay.</p>' : ''}</td></tr>` : ''}`).join('')
        : '<tr class="admin-empty-row"><td colspan="9">No payouts match.</td></tr>'}</tbody>
    </table></div></div></div>`;
  wireSearch('afpdQ', v => { affPaidFilters.q = v; renderAffiliates(); });
  document.getElementById('afpdPartner').addEventListener('change', e => { affPaidFilters.partner = e.target.value; renderAffiliates(); });
  document.getElementById('afpdState').addEventListener('change', e => { affPaidFilters.state = e.target.value; renderAffiliates(); });
  document.getElementById('afpdExport').addEventListener('click', () => downloadCsv(['Date paid', 'Payout', 'Partner code', 'Partner', 'Method', 'Paid to', 'Details', 'Referrals', 'Amount', 'Reference', 'Status', 'Confirmed by partner', 'Note'],
    list.map(p => [p.paidDate ? new Date(p.paidDate).toISOString().slice(0, 10) : '', p.id, p.code, affName(p.code), AFF_METHOD_LABEL[p.method] || p.method, p.payoutEmail, p.details, p.referrals, p.amount.toFixed(2), p.reference,
      p.status === 'void' ? 'Undone' : 'Paid', p.confirmedAt ? new Date(p.confirmedAt).toISOString().slice(0, 10) : '', p.note]),
    'ezzo-payouts-' + new Date().toISOString().slice(0, 10) + '.csv'));
  body.querySelectorAll('[data-afpo]').forEach(b => b.addEventListener('click', () => { const k = 'p' + b.dataset.afpo; affOpenRows.has(k) ? affOpenRows.delete(k) : affOpenRows.add(k); renderAffiliates(); }));
  body.querySelectorAll('[data-afundo]').forEach(b => b.addEventListener('click', async () => {
    const p = aff.payouts.find(x => x.id === b.dataset.afundo);
    if (!await confirmDialog({ message: `Undo ${p.id} (${money(p.amount)} to ${affName(p.code)})? Only do this if the money was not actually sent. Its ${p.referrals} referral${p.referrals === 1 ? '' : 's'} go back to ready to pay.`, confirmText: 'Undo payout' })) return;
    affDo({ op: 'payout_undo', id: p.id }, r => `Payout undone, ${r.restored} referral${r.restored === 1 ? '' : 's'} back to ready`);
  }));
  body.querySelectorAll('[data-afpoedit]').forEach(b => b.addEventListener('click', () => {
    const p = aff.payouts.find(x => x.id === b.dataset.afpoedit);
    affModal({
      title: 'Payout ' + p.id, submit: 'Save',
      body: `<div class="adm-form-grid">${affField('Date paid', affInput('paidDate', p.paidDate ? _isoDay(new Date(p.paidDate)) : '', 'type="date"'))}${affField('Reference', affInput('reference', p.reference, 'maxlength="120"'))}${affField('Note', affInput('note', p.note, 'maxlength="200"'), '', true)}</div>`,
      onSubmit: async (form, setErr) => !!(await affModalDo({ op: 'payout_save', id: p.id, paidDate: form.paidDate.value, reference: form.reference.value, note: form.note.value }, 'Payout saved', setErr))
    });
  }));
}

// ── Settings ───────────────────────────────────────────────────────────
function affRenderSettings(el) {
  const s = aff.settings;
  const yesno = (name, value, yes, no) => affSelect(name, [['yes', yes], ['no', no]], value);
  const waiting = aff.coupons.filter(c => affCouponState(c) === 'waiting').length;
  const live = aff.coupons.filter(c => affCouponState(c) === 'live').length;
  el.innerHTML = `
    <div class="adm-grid adm-grid--2">
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">⚙️ Program-wide settings</div>
        <p class="admin-danger-sub">Commission, discounts, windows and minimums are set per program, under Programs.</p>
        <form class="adm-form-grid" id="afSettingsForm">
          ${affField('Applications', yesno('programOpen', s.programOpen, 'Open', 'Closed (hide the form)'))}
          ${affField('New applications', yesno('autoApprove', s.autoApprove, 'Approve automatically', 'I review each one'))}
          ${affField('New partners join', affSelect('applicationProgram', affProgramOptions('The default program'), s.applicationProgram), 'For applications from the partner page. You choose per partner when you add or approve one.', true)}
          ${affField('Payout schedule', affInput('payoutSchedule', s.payoutSchedule, 'maxlength="80"'), 'Shown to partners.', true)}
          ${affField('Sale emails to partners', yesno('notifySales', s.notifySales, 'Send', 'Don\'t send'))}
          ${affField('Application emails to you', yesno('notifyApplications', s.notifyApplications, 'Send', 'Don\'t send'))}
          ${affField('Self-referrals', yesno('blockSelf', s.blockSelf, 'Block (earn nothing)', 'Allow'), 'A partner buying through their own link or code.', true)}
          <div class="adm-field adm-field--wide"><button class="btn btn-primary btn-sm" type="submit">Save settings</button></div>
        </form>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🩺 Program health</div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Program sheets</div><div class="admin-setting-hint">${aff.missing ? 'Not set up yet: run setupAffiliates in Apps Script.' : 'Set up: ' + fmt(aff.programs.length) + ' program' + (aff.programs.length === 1 ? '' : 's') + ', ' + fmt(aff.affiliates.length) + ' partner records.'}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Coupons in Dodo</div><div class="admin-setting-hint">${fmt(live)} live${waiting ? ` · <b>${fmt(waiting)} waiting</b>: add DODO_API_KEY in Script Properties, then turn them on (or resume the partner).` : '.'}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Partner page</div><div class="admin-setting-hint"><a href="/partners" target="_blank" rel="noopener">ezzohub.com/partners</a> · ${s.programOpen === 'no' ? 'applications closed' : 'taking applications'}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">How a sale is credited</div><div class="admin-setting-hint">A partner's coupon wins. Otherwise the latest partner link inside that partner's program window. Commission follows the partner's program (or their custom rate), on what reached you after tax and discount.</div></div></div>
      </div></div>
    </div>`;
  document.getElementById('afSettingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, values = {};
    Object.keys(AFF_SETTING_DEFAULTS).forEach(k => { if (f[k]) values[k] = f[k].value; });
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
    const r = await affDo({ op: 'settings', values: JSON.stringify(values) }, 'Settings saved');
    if (!r) { btn.disabled = false; btn.textContent = 'Save settings'; }
  });
}

// ── Sample data, shaped like the real sheets ───────────────────────────
function generateSampleAffiliates() {
  const now = Date.now(), DAY = 86400000;
  const programs = [
    Object.assign({}, AFF_PROGRAM_FALLBACK, { id: 'P1', name: 'Standard', tiers: [{ min: 10, amount: 35 }], tier2Rate: 5 }),
    { id: 'P2', name: 'Creator', description: 'For creators over 50k followers', type: 'flat', amount: 15, buyerDiscount: 15, cookieDays: 60, holdDays: 14, approval: 'manual', minPayout: 25, tiers: [], tierMetric: 'sales', tier2Rate: 0, isDefault: false, active: true },
    { id: 'P3', name: 'VIP', description: 'Hand-picked partners', type: 'percent', amount: 45, buyerDiscount: 20, cookieDays: 90, holdDays: 30, approval: 'auto', minPayout: 0, tiers: [{ min: 1000, amount: 50 }], tierMetric: 'revenue', tier2Rate: 0, isDefault: false, active: true }
  ];
  const people = [
    ['MIASAVES', 'Mia Saves', 'mia@example.com', 'approved', 'P3', 'https://tiktok.com/@miasaves', '10,000 to 100,000', 'paypal'],
    ['BUDGETWITHBO', 'Bo Lindqvist', 'bo@example.com', 'approved', 'P2', 'https://youtube.com/@budgetwithbo', '1,000 to 10,000', 'bank'],
    ['FRUGALFAY', 'Fay Okafor', 'fay@example.com', 'approved', 'P1', 'https://frugalfay.example.com', 'Under 1,000', 'wise'],
    ['CALMCENTS', 'Priya Nair', 'priya@example.com', 'paused', 'P1', 'https://instagram.com/calmcents', '1,000 to 10,000', 'paypal'],
    ['NEWBIE', 'Sam Carter', 'sam@example.com', 'pending', 'P1', 'https://pinterest.com/samcarter', 'Under 1,000', 'paypal']
  ];
  const affiliates = people.map((p, i) => ({ row: i + 2, code: p[0], email: p[2], name: p[1], status: p[3], rate: '', rateType: '', method: p[7], payoutEmail: p[2],
    payoutDetails: p[7] === 'bank' ? 'Bo Lindqvist\nIBAN SE45 5000 0000 0583 9825 7466\nSWIFT ESSESESS' : '', website: p[5], audience: p[6],
    application: i === 4 ? 'I pin budget printables and want to recommend a planner my followers can actually use on their phone.' : 'Weekly money videos.',
    recruitedBy: i === 2 ? 'MIASAVES' : '', createdAt: now - (70 - i * 10) * DAY, approvedAt: now - (68 - i * 10) * DAY, lastLogin: now - i * DAY, notes: i === 0 ? 'Top performer' : '', programId: p[4], deletedAt: 0 }));
  const coupons = [
    { code: 'MIASAVES', affiliate: 'MIASAVES', percent: 20, discountId: 'dsc_1', active: 'yes', usageLimit: 0, expiresAt: 0, createdAt: now - 60 * DAY, note: '' },
    { code: 'MIA10', affiliate: 'MIASAVES', percent: 10, discountId: 'dsc_2', active: 'yes', usageLimit: 500, expiresAt: now + 60 * DAY, createdAt: now - 20 * DAY, note: 'Podcast code' },
    { code: 'BUDGETWITHBO', affiliate: 'BUDGETWITHBO', percent: 15, discountId: 'dsc_3', active: 'yes', usageLimit: 0, expiresAt: 0, createdAt: now - 50 * DAY, note: '' },
    { code: 'FRUGALFAY', affiliate: 'FRUGALFAY', percent: 10, discountId: '', active: 'no', usageLimit: 0, expiresAt: 0, createdAt: now - 40 * DAY, note: 'Not in Dodo yet: no_api_key' },
    { code: 'CALMCENTS', affiliate: 'CALMCENTS', percent: 10, discountId: '', active: 'paused', usageLimit: 0, expiresAt: 0, createdAt: now - 40 * DAY, note: '' }
  ];
  const clicks = [], events = [], commissions = [], payouts = [];
  [['MIASAVES', 420], ['BUDGETWITHBO', 180], ['FRUGALFAY', 60], ['CALMCENTS', 40]].forEach(([code, n]) => {
    for (let i = 0; i < n; i++) {
      const t = now - Math.random() * 45 * DAY, vid = code + '_v' + i;
      clicks.push({ t, code, vid, landing: '/budgetplanner', referrer: '', sub: i % 3 ? 'tiktok-oct' : '', tz: 'Europe/London' });
      if (Math.random() < 0.25) events.push({ t: t + 60000, code, vid, type: 'demo', sub: '' });
      if (Math.random() < 0.06) events.push({ t: t + 120000, code, vid, type: 'checkout', sub: '' });
    }
  });
  const progOf = { MIASAVES: programs[2], BUDGETWITHBO: programs[1], FRUGALFAY: programs[0] };
  let row = 2;
  allSales.filter(r => r.event === 'payment.succeeded' && r.affiliate).forEach((r, i) => {
    const code = r.affiliate === 'mia-saves' ? 'MIASAVES' : 'BUDGETWITHBO';
    r.affiliate = code;
    if (code === 'MIASAVES' && r.discount === 'MIA10') r.discount = 'MIA10';
    const t = Date.parse(r.ts), p = progOf[code];
    const refunded = allSales.some(x => x.event === 'refund.succeeded' && x.orderNumber === r.orderId);
    const amount = p.type === 'flat' ? p.amount : Math.round(r.total * p.amount) / 100;
    const old = !refunded && (t < now - 38 * DAY || i < 2);
    commissions.push({ row: row++, t, code, orderId: r.orderId, type: 'sale', sale: r.total, rate: p.amount, rateType: p.type, amount, currency: 'USD',
      status: refunded ? 'reversed' : old ? 'paid' : (p.approval === 'manual' && i % 2 ? 'approved' : 'pending'), availableAt: t + p.holdDays * DAY, paidAt: old ? t + 32 * DAY : 0, payoutId: old ? 'PO-SAMPLE-' + code : '',
      via: r.discount ? 'code' : 'link', sub: i % 2 ? 'tiktok-oct' : '', note: refunded ? 'Order refunded' : '', test: r.mode === 'test', programId: p.id, approval: p.approval, approvedAt: 0, manual: false });
  });
  commissions.push({ row: row++, t: now - 3 * DAY, code: 'FRUGALFAY', orderId: 'MANUAL-SAMPLE1', type: 'sale', sale: 49.99, rate: 30, rateType: 'percent', amount: 15, currency: 'USD', status: 'approved',
    availableAt: now - 3 * DAY, paidAt: 0, payoutId: '', via: 'manual', sub: '', note: 'Forgot the code', test: false, programId: 'P1', approval: 'auto', approvedAt: now - 3 * DAY, manual: true });
  ['MIASAVES', 'BUDGETWITHBO'].forEach((code, i) => {
    const paid = commissions.filter(c => c.code === code && c.status === 'paid');
    if (!paid.length) return;
    payouts.push({ t: now - 6 * DAY, id: 'PO-SAMPLE-' + code, code, amount: Math.round(paid.reduce((s, c) => s + c.amount, 0) * 100) / 100, currency: 'USD', method: i ? 'bank' : 'paypal',
      payoutEmail: code === 'MIASAVES' ? 'mia@example.com' : 'bo@example.com', reference: i ? 'BANK-7731' : '5TY12345', note: '', details: i ? 'IBAN SE45 5000 0000 0583 9825 7466' : '', referrals: paid.length,
      status: 'paid', paidDate: now - 6 * DAY, confirmedAt: i ? 0 : now - 5 * DAY, voidedAt: 0 });
  });
  payouts.push({ t: now - 20 * DAY, id: 'PO-SAMPLE-UNDONE', code: 'FRUGALFAY', amount: 15, currency: 'USD', method: 'wise', payoutEmail: 'fay@example.com', reference: 'typo', note: '[undone]', details: '', referrals: 1, status: 'void', paidDate: now - 20 * DAY, confirmedAt: 0, voidedAt: now - 19 * DAY });
  return { ready: true, missing: false, programs, affiliates, coupons, clicks, events, commissions, payouts, settings: Object.assign({}, AFF_SETTING_DEFAULTS) };
}

const ADMIN_RENDERERS = { overview: renderOverview, sales: renderSales, customers: renderCustomers, affiliates: renderAffiliates, keys: renderRedemptions, product: renderProduct, blogs: renderBlogs, settings: renderSettings };
function switchATab(tab) {
  currentATab = tab;
  document.querySelectorAll('#adminTabs .btab').forEach(b => b.classList.toggle('is-active', b.dataset.atab === tab));
  document.querySelectorAll('#adminRailSections .nav-rail-item').forEach(b => {
    const on = b.dataset.atab === tab;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.bview').forEach(v => v.classList.toggle('is-active', v.id === 'aview-' + tab));
  (ADMIN_RENDERERS[tab] || renderOverview)();
}

// ══════════════════════ Live polling ══════════════════════
// Every sheet, every tick. Keys, Sales and Notify are small, and Overview,
// Sales, Customers and Keys all read from more than one of them, so fetching
// only what the open tab needs left the others showing stale numbers.
async function adminFetchAll(token) {
  const [events, keys, notify, sales, affiliates] = await Promise.all([
    adminFetchEvents(token), adminFetchKeys(token), adminFetchNotify(token), adminFetchSales(token), adminFetchAffiliates(token)
  ]);
  allEvents = events; allKeys = keys; allNotify = notify; allSales = sales; aff = affiliates;
  _lastFetched = Date.now();
}
function rerenderCurrent() {
  // A re-render while someone is typing into the blog editor would wipe it.
  if (currentATab === 'blogs' && blogEditing) return;
  (ADMIN_RENDERERS[currentATab] || renderOverview)();
}
function startLivePolling() {
  stopLivePolling();
  liveTimer = setInterval(async () => {
    if (_sampleDataActive) return; // don't let a background poll silently swap sample data back to real
    try { await adminFetchAll(_adminAccessToken); rerenderCurrent(); }
    catch (e) { /* keep showing last-known data; next tick may recover */ }
  }, ADMIN_POLL_MS);
}
function stopLivePolling() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

// ══════════════════════ Side rail (desktop and tablet) ══════════════════════
// The same sidebar the planner uses: sections down the left on desktop, an
// icon rail on a tablet, and on a phone the top bar with its tabs instead
// (all layout in style.css under data-nav="left"). The sections are built
// from the tab bar, so there is one list of tabs. The tool buttons are moved
// rather than copied, so each keeps its one id and its listeners.
function adminBuildRail() {
  const box = document.getElementById('adminRailSections');
  if (!box) return;
  box.innerHTML = [...document.querySelectorAll('#adminTabs .btab')].map(b => {
    const text = b.textContent.trim();
    const m = text.match(/^(\S+)\s+(.+)$/);
    const icon = m ? m[1] : '•', label = m ? m[2] : text;
    const on = b.classList.contains('is-active');
    return `<button class="nav-rail-item${on ? ' is-active' : ''}"${on ? ' aria-current="page"' : ''} data-atab="${esc(b.dataset.atab)}" type="button" title="${esc(label)}">
      <span class="nav-rail-icon" aria-hidden="true">${icon}</span><span class="nav-rail-label">${esc(label)}</span></button>`;
  }).join('');
  box.querySelectorAll('.nav-rail-item').forEach(i => i.addEventListener('click', () => switchATab(i.dataset.atab)));
  document.getElementById('adminRailAccount')?.addEventListener('click', () => switchATab('settings'));
}
function adminUpdateRailAccount() {
  const email = _adminEmail || 'Owner';
  const e = document.getElementById('adminRailEmail'), a = document.getElementById('adminRailAvatar');
  if (e) e.textContent = email;
  if (a) a.textContent = (email.trim()[0] || 'A').toUpperCase();
}
const ADMIN_PHONE_MQ = window.matchMedia('(max-width: 760px)');
function adminPlaceChrome() {
  const tools = document.getElementById('adminRailTools');
  const left = document.querySelector('#viewAdmin .tool-topbar-left');
  const right = document.querySelector('#viewAdmin .tool-topbar-right');
  if (!tools || !left || !right) return;
  const btn = id => document.getElementById(id);
  const leftSet = ['adminHomeLink', 'adminRefreshBtn'].map(btn).filter(Boolean);
  const rightSet = ['pennyNavBtn', 'adminSignOutBtn'].map(btn).filter(Boolean);
  if (ADMIN_PHONE_MQ.matches) {
    leftSet.forEach(b => left.appendChild(b));
    rightSet.forEach(b => right.appendChild(b));
  } else {
    [...leftSet, ...rightSet].forEach(b => tools.appendChild(b));
  }
}
ADMIN_PHONE_MQ.addEventListener('change', adminPlaceChrome);
// After the whole file has run, so everything these read is defined.
document.addEventListener('DOMContentLoaded', () => { adminBuildRail(); adminPlaceChrome(); adminUpdateRailAccount(); });

// ══════════════════════ Auth gate / bootstrap ══════════════════════
let _adminEmail = '';
let _lastFetched = 0;

async function adminSignIn() {
  const errEl = document.getElementById('adminGateError');
  const btn = document.getElementById('adminSignInBtn');
  if (errEl) errEl.hidden = true;
  if (btn) btn.disabled = true;
  try {
    if (!ADMIN_SPREADSHEET_ID || !ADMIN_ALLOWED_EMAIL) throw new Error('not_configured');
    const token = await adminInteractiveToken();
    const email = await _adminFetchEmail(token);
    if (email.toLowerCase() !== ADMIN_ALLOWED_EMAIL.toLowerCase()) { _adminAccessToken = null; throw new Error('not_allowed'); }
    _adminEmail = email;
    adminUpdateRailAccount();
    adminMarkOwnerDevice();
    await adminFetchAll(token);
    Object.assign(overviewFilters, currentMonthBounds()); // reset to the current month on every sign-in, per explicit request
    document.getElementById('adminGate').hidden = true;
    // .view{display:none} in style.css only lifts for .view.is-active (see
    // budgetplanner.html's view-hub/view-budget) - the hidden attribute alone
    // isn't enough for an element carrying the .view/.tool-shell classes.
    const viewEl = document.getElementById('viewAdmin');
    viewEl.hidden = false;
    viewEl.classList.add('is-active');
    switchATab('overview');
    startLivePolling();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message === 'not_configured'
        ? 'Dashboard not configured yet - set ADMIN_SPREADSHEET_ID and ADMIN_ALLOWED_EMAIL in admin.js.'
        : adminFriendlyError(e);
      errEl.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function adminSignOut() {
  stopLivePolling();
  _adminAccessToken = null;
  _adminEmail = '';
  allEvents = [];
  allKeys = [];
  allSales = [];
  allNotify = [];
  aff = { ready: false, missing: false, programs: [], affiliates: [], coupons: [], clicks: [], events: [], commissions: [], payouts: [], settings: Object.assign({}, AFF_SETTING_DEFAULTS) };
  lsSales = { loaded: false, configured: false, revenue: 0, orders: 0, error: '', rangeKey: null };
  _sampleDataActive = false;
  updateSampleBanner();
  const viewEl = document.getElementById('viewAdmin');
  viewEl.hidden = true;
  viewEl.classList.remove('is-active');
  document.getElementById('adminGate').hidden = false;
}

document.getElementById('adminSignInBtn')?.addEventListener('click', adminSignIn);
document.getElementById('adminSignOutBtn')?.addEventListener('click', adminSignOut);
document.getElementById('adminRefreshBtn')?.addEventListener('click', async () => {
  if (_sampleDataActive) return; // don't let the manual refresh silently swap sample data back to real
  const btn = document.getElementById('adminRefreshBtn');
  btn?.classList.add('is-spinning');
  try { lsSales.rangeKey = null; await adminFetchAll(_adminAccessToken); rerenderCurrent(); showToast('Up to date'); }
  catch (e) { showToast("Couldn't refresh. Showing the last data loaded."); }
  finally { btn?.classList.remove('is-spinning'); }
});
document.getElementById('adminSampleBannerExit')?.addEventListener('click', () => { exitSampleData(); if (currentATab === 'settings') renderSettings(); });
pennyInit();
document.querySelectorAll('#adminTabs .btab').forEach(btn => btn.addEventListener('click', () => switchATab(btn.dataset.atab)));
document.addEventListener('visibilitychange', () => {
  if (document.getElementById('viewAdmin').hidden) return;
  if (document.visibilityState === 'visible') startLivePolling(); else stopLivePolling();
});

// ══════════════════════ Blogs ══════════════════════
// Posts live in a Blogs sheet and are read by the public blog page, so
// publishing here puts a post on the site without a deploy. The ten seeded
// posts ship inside blog-posts.js instead; editing one of those here writes
// a sheet row with the same slug, which the blog page prefers over the
// shipped copy. That is what makes them editable without touching the repo.
const ADMIN_BLOG_SHEET = 'Blogs';
const ADMIN_BLOG_RANGE = `${ADMIN_BLOG_SHEET}!A2:N2000`;
const BLOG_IMAGE_PX = 500;         // square, matching the seeded covers
const BLOG_IMAGE_MAX_CHARS = 45000; // a Sheets cell holds 50k; leave headroom

let allBlogPosts = [];
let _blogFetchError = '';
let blogEditing = null;            // the post open in the editor, or null

const BLOG_ADMIN_CATEGORIES = [
  { id: 'basics',   label: 'Budgeting Basics' },
  { id: 'debt',     label: 'Debt Payoff' },
  { id: 'saving',   label: 'Saving & Challenges' },
  { id: 'reallife', label: 'Real-Life Budgets' }
];
const BLOG_ADMIN_TOOLS = [
  { id: 'budget',  label: 'Ezzo Budget' },
  { id: 'tasks',   label: 'Task Planner' },
  { id: 'habits',  label: 'Habit Tracker' },
  { id: 'wedding', label: 'Wedding Planner' },
  { id: 'meals',   label: 'Meal Planner' },
  { id: 'fitness', label: 'Fitness Planner' }
];

// Columns A-N: slug, title, excerpt, category, tool, tags, date, readMinutes,
// image, imageAlt, body, related, status, updated.
async function adminFetchBlogPosts(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_BLOG_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (e) { /* not JSON */ }
    _blogFetchError = `${res.status}${detail ? ': ' + detail : ''}`;
    return [];
  }
  _blogFetchError = '';
  const j = await res.json();
  return (j.values || []).map((r, i) => ({
    row: i + 2,
    slug: r[0] || '', title: r[1] || '', excerpt: r[2] || '',
    category: r[3] || 'basics', tool: r[4] || 'budget',
    tags: String(r[5] || '').split(',').map(s => s.trim()).filter(Boolean),
    date: r[6] || '', readMinutes: Number(r[7] || 0) || 0,
    image: r[8] || '', imageAlt: r[9] || '', body: r[10] || '',
    related: String(r[11] || '').split(',').map(s => s.trim()).filter(Boolean),
    status: (r[12] || 'published').toLowerCase(), updated: r[13] || ''
  })).filter(p => p.slug);
}

function blogRowValues(p) {
  return [[p.slug, p.title, p.excerpt, p.category, p.tool, (p.tags || []).join(', '),
    p.date, p.readMinutes || '', p.image, p.imageAlt, p.body,
    (p.related || []).join(', '), p.status, new Date().toISOString().slice(0, 10)]];
}

// The Blogs tab is created on demand. Apps Script makes it the first time
// the public blog asks for posts, but the admin writes through the Sheets
// API instead, which fails outright on a range in a sheet that does not
// exist yet. Without this, the very first save on a fresh spreadsheet errors.
let _blogSheetChecked = false;
async function adminEnsureBlogSheet() {
  if (_blogSheetChecked) return;
  const auth = { Authorization: `Bearer ${_adminAccessToken}` };
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}?fields=sheets.properties.title`,
    { headers: auth });
  if (!res.ok) return;                    // let the write itself report the real problem
  const j = await res.json();
  const exists = (j.sheets || []).some(sh => sh.properties && sh.properties.title === ADMIN_BLOG_SHEET);
  if (!exists) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: ADMIN_BLOG_SHEET } } }] })
    });
    const header = [['Slug', 'Title', 'Excerpt', 'Category', 'Tool', 'Tags', 'Date', 'ReadMinutes',
                     'Image', 'ImageAlt', 'Body', 'Related', 'Status', 'Updated']];
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_BLOG_SHEET + '!A1:N1')}?valueInputOption=RAW`,
      { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
        body: JSON.stringify({ values: header }) });
  }
  _blogSheetChecked = true;
}

async function adminSaveBlogPost(p) {
  await adminEnsureBlogSheet();
  const existing = allBlogPosts.find(x => x.slug === p.slug && x.row);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values`;
  const body = JSON.stringify({ values: blogRowValues(p) });
  const headers = { Authorization: `Bearer ${_adminAccessToken}`, 'Content-Type': 'application/json' };
  let res;
  if (existing) {
    const range = `${ADMIN_BLOG_SHEET}!A${existing.row}:N${existing.row}`;
    res = await fetch(`${base}/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', headers, body });
  } else {
    const range = `${ADMIN_BLOG_RANGE}`;
    res = await fetch(`${base}/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers, body });
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (e) { /* not JSON */ }
    throw new Error(detail || 'sheets_write_failed');
  }
}

// Deleting clears the row rather than removing it, for the same reason the
// danger zone does: a cleared row is already gone on every future read, and
// it avoids having to re-index every row below it.
async function adminDeleteBlogPost(p) {
  if (!p.row) return;
  const range = `${ADMIN_BLOG_SHEET}!A${p.row}:N${p.row}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${_adminAccessToken}` } });
  if (!res.ok) throw new Error('sheets_delete_failed');
}

function blogSlugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

function blogWordCount(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

// The seeded posts, so the admin lists everything on the site rather than
// only what has been written here.
function blogSeededPosts() {
  return (typeof BLOG_POSTS !== 'undefined' ? BLOG_POSTS : []).map(p => Object.assign({}, p, { row: 0, seeded: true, status: 'published' }));
}
function blogAllForDisplay() {
  const bySlug = new Map();
  blogSeededPosts().forEach(p => bySlug.set(p.slug, p));
  allBlogPosts.forEach(p => bySlug.set(p.slug, Object.assign({}, p, { seeded: bySlug.has(p.slug) })));
  return Array.from(bySlug.values()).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// ── List view ──────────────────────────────────────────────────────────
function renderBlogs() {
  const el = document.getElementById('aview-blogs');
  if (blogEditing) return renderBlogEditor(el);

  const posts = blogAllForDisplay();
  const published = posts.filter(p => p.status !== 'draft').length;
  const drafts = posts.length - published;

  el.innerHTML = `
    <div class="section-header">
      <h2 class="admin-section-title">Blogs</h2>
      <button class="btn btn-primary btn-sm" id="blogNewBtn" type="button">+ New post</button>
    </div>
    <p class="admin-section-sub">Everything on <a href="/blog" target="_blank" rel="noopener">ezzohub.com/blog</a>. Saving a post publishes it straight away, no deploy needed. The ten posts that shipped with the site are editable here too: saving one writes your version over it.</p>
    ${kpiRow([
      { icon: '📝', label: 'Published', value: fmt(published), sub: 'live on the site', color: '#10b981', hint: 'Posts readers can currently see at /blog.' },
      { icon: '📄', label: 'Drafts', value: fmt(drafts), sub: '', color: '#64748b', hint: 'Saved but hidden from the site. Set a post to Published when it is ready.' },
      { icon: '🏷️', label: 'Topics', value: fmt(new Set(posts.map(p => p.category)).size), sub: 'in use', color: '#6366f1', hint: 'How many of the topic filters currently have at least one post.' },
      { icon: '📚', label: 'Words', value: fmt(posts.reduce((s, p) => s + blogWordCount(p.body), 0)), sub: 'across all posts', color: '#a855f7', hint: 'Total published word count. Useful only as a rough sense of how much is on the site.' }
    ])}
    <div class="panel"><div class="panel-inner-sm">
      ${blogTableHtml(posts)}
    </div></div>`;

  document.getElementById('blogNewBtn')?.addEventListener('click', () => {
    blogEditing = {
      slug: '', title: '', excerpt: '', category: 'basics', tool: 'budget', tags: [],
      date: new Date().toISOString().slice(0, 10), readMinutes: 0,
      image: '', imageAlt: '', body: '', related: [], status: 'draft', isNew: true
    };
    renderBlogs();
  });
  wireBlogTable(el);
  initFieldTips(el);
}

function blogTableHtml(posts) {
  const head = `<tr><th></th><th>Title</th><th>Topic</th><th>Date</th><th>Status</th><th></th></tr>`;
  if (!posts.length) {
    const msg = _blogFetchError
      ? `Couldn't read the Blogs sheet - Google said: ${esc(_blogFetchError)}. If that mentions a missing range, the sheet doesn't exist yet: it is created the first time you save a post.`
      : 'No posts yet.';
    return `<div class="admin-table-wrap"><table class="admin-table"><thead>${head}</thead><tbody>
      <tr class="admin-empty-row"><td colspan="6">${msg}</td></tr></tbody></table></div>`;
  }
  return `<div class="admin-table-wrap"><table class="admin-table"><thead>${head}</thead><tbody>
    ${posts.map(p => `<tr class="${p.status === 'draft' ? 'admin-row-muted' : ''}">
      <td style="width:1%"><img src="${esc(p.image || '')}" alt="" class="admin-blog-thumb" onerror="this.style.visibility='hidden'"></td>
      <td class="admin-table-strong" style="white-space:normal;max-width:340px">${esc(p.title)}
        <span class="admin-blog-slug">/blog?p=${esc(p.slug)}</span></td>
      <td>${esc((BLOG_ADMIN_CATEGORIES.find(c => c.id === p.category) || {}).label || p.category)}</td>
      <td>${esc(p.date || '')}</td>
      <td>${p.status === 'draft' ? '<span class="admin-blog-draft">draft</span>' : 'published'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm admin-blog-edit" data-slug="${esc(p.slug)}" type="button">Edit</button>
        ${p.row ? `<button class="btn btn-ghost btn-sm admin-blog-del" data-slug="${esc(p.slug)}" type="button">Delete</button>` : ''}
      </td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function wireBlogTable(scope) {
  scope.querySelectorAll('.admin-blog-edit').forEach(b => b.addEventListener('click', () => {
    const p = blogAllForDisplay().find(x => x.slug === b.dataset.slug);
    if (!p) return;
    blogEditing = Object.assign({}, p, { tags: [...(p.tags || [])], related: [...(p.related || [])] });
    renderBlogs();
  }));
  scope.querySelectorAll('.admin-blog-del').forEach(b => b.addEventListener('click', async () => {
    const p = allBlogPosts.find(x => x.slug === b.dataset.slug);
    if (!p) return;
    const seeded = blogSeededPosts().some(s => s.slug === p.slug);
    if (!await confirmDialog({
      message: seeded
        ? 'Delete your version of this post? The original that shipped with the site will come back in its place.'
        : 'Delete this post? It will disappear from the site. This cannot be undone.',
      confirmText: 'Delete'
    })) return;
    b.disabled = true;
    try {
      await adminDeleteBlogPost(p);
      allBlogPosts = await adminFetchBlogPosts(_adminAccessToken).catch(() => allBlogPosts.filter(x => x.slug !== p.slug));
      renderBlogs();
      showToast('Post deleted');
    } catch (e) {
      b.disabled = false;
      showToast("Couldn't delete the post. Check your connection and try again.");
    }
  }));
}

// ── Editor ─────────────────────────────────────────────────────────────
function renderBlogEditor(el) {
  const p = blogEditing;
  const others = blogAllForDisplay().filter(x => x.slug && x.slug !== p.slug);

  el.innerHTML = `
    <div class="section-header">
      <h2 class="admin-section-title">${p.isNew ? 'New post' : 'Edit post'}</h2>
      <button class="btn btn-ghost btn-sm" id="blogBackBtn" type="button">&larr; All posts</button>
    </div>

    <div class="admin-blog-editor">
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">✍️ The post</div>

        <div class="field"><label class="field-label">Title</label>
          <input class="input" id="blogTitle" type="text" maxlength="120" value="${esc(p.title)}" placeholder="What is this post called?"></div>

        <div class="field"><label class="field-label">URL slug</label>
          <input class="input" id="blogSlug" type="text" maxlength="70" value="${esc(p.slug)}" placeholder="auto-generated-from-the-title">
          <span class="admin-blog-hint">Readers will see <code>ezzohub.com/blog?p=<span id="blogSlugPreview">${esc(p.slug || 'your-post')}</span></code>. Changing this on a published post breaks any existing links to it.</span></div>

        <div class="field"><label class="field-label">Excerpt</label>
          <textarea class="input" id="blogExcerpt" rows="2" maxlength="175" placeholder="One or two sentences. Shown on the blog index and used as the Google search description.">${esc(p.excerpt)}</textarea>
          <span class="admin-blog-hint"><span id="blogExcerptCount">${p.excerpt.length}</span>/175 characters. Aim for 120 to 160 so Google shows all of it.</span></div>

        <div class="field"><label class="field-label">Body</label>
          <textarea class="input admin-blog-body" id="blogBody" rows="20" placeholder="&lt;p&gt;Write in HTML. Use &lt;h2&gt; for section headings, &lt;p&gt; for paragraphs, &lt;ul&gt;/&lt;ol&gt; for lists.&lt;/p&gt;">${esc(p.body)}</textarea>
          <span class="admin-blog-hint">HTML. <code>&lt;h2&gt;</code> headings, <code>&lt;p&gt;</code> paragraphs, <code>&lt;ul&gt;</code> lists, <code>&lt;div class="bp-callout"&gt;</code> for a highlighted note. Link another post with <code>&lt;a href="/blog?p=slug"&gt;</code>. <span id="blogWordCount">${blogWordCount(p.body)}</span> words.</span></div>
      </div></div>

      <div class="admin-blog-side">
        <div class="panel"><div class="panel-inner">
          <div class="settings-card-title">🖼️ Cover image</div>
          <div class="admin-blog-drop" id="blogDrop">
            <img id="blogImgPreview" src="${esc(p.image || '')}" alt="" ${p.image ? '' : 'hidden'}>
            <div id="blogDropHint" ${p.image ? 'hidden' : ''}>
              <strong>Drop an image here</strong>
              <span>or click to choose one</span>
            </div>
          </div>
          <input type="file" id="blogImgInput" accept="image/*" hidden>
          <p class="admin-blog-hint">Any image works. It is cropped to a ${BLOG_IMAGE_PX}px square and compressed in your browser before saving, so it matches the posts that shipped with the site.</p>
          <div class="field"><label class="field-label">Image description</label>
            <input class="input" id="blogImgAlt" type="text" maxlength="140" value="${esc(p.imageAlt)}" placeholder="What the image shows">
            <span class="admin-blog-hint">Read aloud by screen readers and shown if the image fails to load.</span></div>
          ${p.image ? `<button class="btn btn-ghost btn-sm" id="blogImgClear" type="button">Remove image</button>` : ''}
        </div></div>

        <div class="panel"><div class="panel-inner">
          <div class="settings-card-title">🗂️ Filing</div>
          <div class="field"><label class="field-label">Tool</label>
            <select class="select" id="blogTool">
              ${BLOG_ADMIN_TOOLS.map(t => `<option value="${t.id}"${p.tool === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
            </select></div>
          <div class="field"><label class="field-label">Topic</label>
            <select class="select" id="blogCategory">
              ${BLOG_ADMIN_CATEGORIES.map(c => `<option value="${c.id}"${p.category === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select></div>
          <div class="field"><label class="field-label">Publish date</label>
            ${styledDateField('blogDate', 'blogDateWrap', p.date)}</div>
          <div class="field"><label class="field-label">Tags</label>
            <input class="input" id="blogTags" type="text" value="${esc((p.tags || []).join(', '))}" placeholder="budgeting, saving money">
            <span class="admin-blog-hint">Comma separated. Used for search on the blog, and as keywords.</span></div>
          <div class="field"><label class="field-label">Status</label>
            <select class="select" id="blogStatus">
              <option value="published"${p.status !== 'draft' ? ' selected' : ''}>Published (live on the site)</option>
              <option value="draft"${p.status === 'draft' ? ' selected' : ''}>Draft (hidden)</option>
            </select></div>
        </div></div>

        <div class="panel"><div class="panel-inner">
          <div class="settings-card-title">🔗 Keep reading</div>
          <p class="admin-blog-hint" style="margin-top:0">Shown at the bottom of the post. Pick up to three.</p>
          <div class="admin-blog-related">
            ${others.map(o => `<label class="admin-blog-rel-item">
              <input type="checkbox" class="blog-rel-cb" value="${esc(o.slug)}"${(p.related || []).includes(o.slug) ? ' checked' : ''}>
              <span>${esc(o.title)}</span>
            </label>`).join('') || '<span class="admin-blog-hint">No other posts to link to yet.</span>'}
          </div>
        </div></div>
      </div>
    </div>

    <div class="tx-error" id="blogError" hidden></div>
    <div class="admin-blog-actions">
      <button class="btn btn-primary" id="blogSaveBtn" type="button">${p.status === 'draft' ? 'Save draft' : 'Save and publish'}</button>
      <button class="btn btn-ghost btn-sm" id="blogCancelBtn" type="button">Cancel</button>
      <a class="btn btn-ghost btn-sm" id="blogPreviewLink" href="/blog?p=${esc(p.slug)}" target="_blank" rel="noopener"${p.isNew ? ' hidden' : ''}>View on site &nearr;</a>
    </div>`;

  wireBlogEditor();
}

function wireBlogEditor() {
  const g = id => document.getElementById(id);

  // Slug follows the title until the slug has been typed in by hand, so the
  // common case needs no thought and the deliberate case still wins.
  let slugTouched = !blogEditing.isNew || !!blogEditing.slug;
  g('blogTitle')?.addEventListener('input', e => {
    if (slugTouched) return;
    const s = blogSlugify(e.target.value);
    g('blogSlug').value = s;
    g('blogSlugPreview').textContent = s || 'your-post';
  });
  g('blogSlug')?.addEventListener('input', e => {
    slugTouched = true;
    e.target.value = blogSlugify(e.target.value);
    g('blogSlugPreview').textContent = e.target.value || 'your-post';
  });
  g('blogExcerpt')?.addEventListener('input', e => { g('blogExcerptCount').textContent = e.target.value.length; });
  g('blogBody')?.addEventListener('input', e => { g('blogWordCount').textContent = blogWordCount(e.target.value); });
  bindDateField('blogDate', 'blogDateWrap');

  // Only three related posts fit the row at the bottom of an article, so the
  // limit is enforced here rather than silently truncated at render time.
  const cbs = () => Array.from(document.querySelectorAll('.blog-rel-cb'));
  cbs().forEach(cb => cb.addEventListener('change', () => {
    const checked = cbs().filter(c => c.checked);
    if (checked.length > 3) { cb.checked = false; showToast('Three related posts is the maximum.'); }
  }));

  // Image
  const drop = g('blogDrop'), input = g('blogImgInput');
  drop?.addEventListener('click', () => input.click());
  drop?.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-over'); });
  drop?.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop?.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('is-over');
    if (e.dataTransfer.files[0]) handleBlogImage(e.dataTransfer.files[0]);
  });
  input?.addEventListener('change', e => { if (e.target.files[0]) handleBlogImage(e.target.files[0]); });
  g('blogImgClear')?.addEventListener('click', () => {
    blogEditing = collectBlogForm();
    blogEditing.image = '';
    renderBlogs();
  });

  g('blogBackBtn')?.addEventListener('click', () => { blogEditing = null; renderBlogs(); });
  g('blogCancelBtn')?.addEventListener('click', () => { blogEditing = null; renderBlogs(); });
  g('blogSaveBtn')?.addEventListener('click', saveBlogFromForm);
}

function collectBlogForm() {
  const g = id => document.getElementById(id);
  return Object.assign({}, blogEditing, {
    title: g('blogTitle').value.trim(),
    slug: blogSlugify(g('blogSlug').value || g('blogTitle').value),
    excerpt: g('blogExcerpt').value.trim(),
    body: g('blogBody').value,
    imageAlt: g('blogImgAlt').value.trim(),
    tool: g('blogTool').value,
    category: g('blogCategory').value,
    date: g('blogDate').value,
    tags: g('blogTags').value.split(',').map(s => s.trim()).filter(Boolean),
    status: g('blogStatus').value,
    related: Array.from(document.querySelectorAll('.blog-rel-cb')).filter(c => c.checked).map(c => c.value)
  });
}

// Resized and re-encoded in the browser, for two reasons: a Sheets cell tops
// out at 50k characters, and a 4MB phone photo has no business being the
// cover of a blog card.
function handleBlogImage(file) {
  if (!/^image\//.test(file.type)) { showBlogError('That file is not an image.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = BLOG_IMAGE_PX;
      const ctx = canvas.getContext('2d');
      // Centre-crop to a square rather than squashing the picture.
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, BLOG_IMAGE_PX, BLOG_IMAGE_PX);

      let quality = 0.88, data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > BLOG_IMAGE_MAX_CHARS && quality > 0.35) {
        quality -= 0.08;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (data.length > BLOG_IMAGE_MAX_CHARS) {
        showBlogError("That image won't compress small enough to store. Try a simpler or smaller picture.");
        return;
      }
      blogEditing = collectBlogForm();
      blogEditing.image = data;
      renderBlogs();
    };
    img.onerror = () => showBlogError("That image couldn't be read.");
    img.src = reader.result;
  };
  reader.onerror = () => showBlogError("That file couldn't be read.");
  reader.readAsDataURL(file);
}

function showBlogError(msg) {
  const el = document.getElementById('blogError');
  if (el) { el.textContent = msg; el.hidden = false; }
}

async function saveBlogFromForm() {
  const p = collectBlogForm();
  const btn = document.getElementById('blogSaveBtn');

  if (!p.title) return showBlogError('Give the post a title.');
  if (!p.slug) return showBlogError('The post needs a URL slug.');
  if (!p.excerpt) return showBlogError('Write an excerpt. It is what people see on the blog index and in Google.');
  if (!p.body.trim()) return showBlogError('The post has no body yet.');
  if (!p.date) return showBlogError('Pick a publish date.');
  // A duplicate slug would silently overwrite a different post's URL.
  const clash = blogAllForDisplay().find(x => x.slug === p.slug && x.slug !== blogEditing.slug);
  if (clash && blogEditing.isNew) return showBlogError(`Another post already uses /blog?p=${p.slug}. Change the slug.`);

  document.getElementById('blogError').hidden = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Saving...';
  try {
    if (!p.readMinutes) p.readMinutes = Math.max(1, Math.round(blogWordCount(p.body) / 225));
    // A renamed slug leaves the old row behind, so clear it explicitly.
    if (!blogEditing.isNew && blogEditing.slug && blogEditing.slug !== p.slug) {
      const old = allBlogPosts.find(x => x.slug === blogEditing.slug);
      if (old) await adminDeleteBlogPost(old).catch(() => {});
    }
    await adminSaveBlogPost(p);
    allBlogPosts = await adminFetchBlogPosts(_adminAccessToken).catch(() => allBlogPosts);
    blogEditing = null;
    renderBlogs();
    showToast(p.status === 'draft' ? 'Draft saved' : 'Published to the site');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    showBlogError(e.message === 'sheets_write_failed'
      ? "Couldn't save to the sheet. Check your connection and try again."
      : `Couldn't save: ${e.message}`);
  }
}
