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
  return rows.map((r, i) => ({
    row: i + 2,
    serverTime: r[0] || '', type: r[1] || '', visitorId: r[2] || '', sessionId: r[3] || '',
    page: r[4] || '', tool: r[5] || '', timezone: r[6] || '', referrer: r[7] || '',
    ua: r[8] || '', lang: r[9] || '', detail: _safeParseJSON(r[10]), clientTs: r[11] || ''
  })).filter(e => e.type); // drop any accidental blank rows
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
const ADMIN_SALES_RANGE = `${ADMIN_SALES_SHEET}!A2:L10000`;
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
let salesFilters = { mode: '', q: '' };
let allKeys = [];

// Why the Keys fetch came back empty, if it did. A silently empty tab is
// indistinguishable from "nobody has bought yet", which makes a real
// misconfiguration (wrong sheet, wrong spreadsheet, missing permission)
// impossible to tell apart from normal quiet - so keep Google's own reason.
let _keysFetchError = '';

// A missing Notify sheet is the normal state until the first address is
// collected, so that reads as empty rather than as an error.
async function adminFetchNotify(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_NOTIFY_RANGE)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      _notifyFetchError = res.status === 400 ? '' : String(res.status);
      return [];
    }
    _notifyFetchError = '';
    const j = await res.json();
    return (j.values || []).map(r => ({
      ts: r[0] || '', email: r[1] || '', tool: r[2] || '', source: r[3] || 'notify', visitorId: r[4] || ''
    })).filter(r => r.email);
  } catch (e) { _notifyFetchError = 'network'; return []; }
}

// Absent until the first webhook lands, which is the normal state.
async function adminFetchSales(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_SALES_RANGE)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.values || []).map(r => ({
      ts: r[0] || '', event: r[1] || '', orderId: r[2] || '', email: r[3] || '', name: r[4] || '',
      product: r[5] || '', variant: r[6] || '', total: Number(r[7] || 0), currency: r[8] || 'USD',
      mode: r[9] || 'live', status: r[10] || '', orderNumber: r[11] || ''
    })).filter(r => r.event === 'order_created');
  } catch (e) { return []; }
}

async function adminFetchKeys(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ADMIN_SPREADSHEET_ID}/values/${encodeURIComponent(ADMIN_KEYS_RANGE)}`;
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
      key: r[0] || '', tool: r[1] || '', theme: r[2] || '', layout: r[3] || '',
      orderId: r[4] || '', email: r[5] || '', issuedAt: r[6] || '',
      status: (r[7] || 'active').toLowerCase(), devices,
      redeemCount: Number(r[9] || 0), lastRedeemedAt: r[10] || ''
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
  return allEvents.filter(e => {
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
function pageLabel(page) { return page === 'sbp' ? 'Simple Budget' : page === 'ubp' ? 'Ultimate Budget' : 'Home'; }
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
function kpiRow(tiles) { return `<div class="ist-row">${tiles.map(t => iconStatTile(t.icon, t.label, t.value, t.sub, t.color, t.hint ? esc(t.hint) : '')).join('')}</div>`; }
function panelTitle(text, hint) {
  return `<div class="panel-title-sm" style="margin-bottom:14px"><span class="cc-label-text">${esc(text)}</span>${hint ? `<button class="cc-info" type="button" style="margin-left:6px;vertical-align:middle" data-tip="${esc(hint)}" aria-label="What is this?">i</button>` : ''}</div>`;
}
function pieOrEmpty(groups, empty) {
  if (!groups.length) return `<div class="chart-empty">${esc(empty)}</div>`;
  return pieChartHtml(segmentize(groups), { limit: 6 });
}

// ── Website vs. in-app ────────────────────────────────────────────────
// Overview is a store dashboard: it should answer "how is the site doing at
// turning visitors into buyers", not "how much do existing customers use the
// planners". Someone budgeting for an hour would otherwise show up as an
// hour-long website session with a great bounce rate, flattering every
// number without meaning anything commercially.
const WEBSITE_PAGES = new Set(['home', 'budgetplanner', 'claim', 'legal', '']);
const IN_APP_EVENTS = new Set(['tab_viewed', 'feature_used', 'theme_changed', 'language_changed', 'dashboard_layout_changed', 'sync_mode_chosen']);
// Buying signals count wherever they happen - the upgrade prompt lives
// inside the planners, and those are exactly the conversions worth seeing.
const ALWAYS_COUNT_EVENTS = new Set(['purchase_initiated', 'launch_code_redeemed']);

function isWebsiteEvent(e) {
  if (ALWAYS_COUNT_EVENTS.has(e.type)) return true;
  if (IN_APP_EVENTS.has(e.type)) return false;
  return WEBSITE_PAGES.has(e.page || '');
}

function overviewFilteredEvents() {
  return allEvents.filter(e => {
    if (!isWebsiteEvent(e)) return false;
    const t = eventTime(e);
    if (overviewFilters.from && t < new Date(overviewFilters.from + 'T00:00:00').getTime()) return false;
    if (overviewFilters.to && t > new Date(overviewFilters.to + 'T23:59:59').getTime()) return false;
    return true;
  });
}
const _isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function todayBounds() { const d = new Date(); return { from: _isoDay(d), to: _isoDay(d) }; }
function lastMonthBounds() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const end = new Date(d.getFullYear(), d.getMonth(), 0);
  return { from: _isoDay(start), to: _isoDay(end) };
}
function activeQuickRange() {
  const t = todayBounds(), cm = currentMonthBounds(), lm = lastMonthBounds();
  const f = overviewFilters.from, to = overviewFilters.to;
  if (f === t.from && to === t.to) return 'today';
  if (f === cm.from && to === cm.to) return 'month';
  if (f === lm.from && to === lm.to) return 'lastmonth';
  return '';
}
function overviewFilterBarHtml() {
  const active = activeQuickRange();
  const chip = (id, key, label) => `<button class="admin-range-chip${active === key ? ' is-active' : ''}" id="${id}" type="button">${label}</button>`;
  return `<div class="admin-filter-bar admin-range-bar">
    ${styledDateField('ovFilterFrom', 'ovFilterFromWrap', overviewFilters.from)}
    ${styledDateField('ovFilterTo', 'ovFilterToWrap', overviewFilters.to)}
    <div class="admin-range-chips">
      ${chip('ovRangeToday', 'today', 'Today')}
      ${chip('ovRangeMonth', 'month', 'This month')}
      ${chip('ovRangeLastMonth', 'lastmonth', 'Last month')}
    </div>
  </div>`;
}
function wireOverviewFilterBar() {
  bindDateField('ovFilterFrom', 'ovFilterFromWrap', v => { overviewFilters.from = v; renderOverview(); });
  bindDateField('ovFilterTo', 'ovFilterToWrap', v => { overviewFilters.to = v; renderOverview(); });
  const setRange = bounds => { Object.assign(overviewFilters, bounds); renderOverview(); };
  document.getElementById('ovRangeToday')?.addEventListener('click', () => setRange(todayBounds()));
  document.getElementById('ovRangeMonth')?.addEventListener('click', () => setRange(currentMonthBounds()));
  document.getElementById('ovRangeLastMonth')?.addEventListener('click', () => setRange(lastMonthBounds()));
}
// ── Sales ─────────────────────────────────────────────────────────────
// Two channels, two sources. Lemon Squeezy knows its own revenue exactly,
// so it's asked directly (via the Apps Script, which holds the API key
// server-side). Etsy has no such feed, so those sales are inferred from
// redeemed Etsy keys at list price - an undercount if a buyer never
// redeems, and it lags the actual sale. Kept clearly separated rather than
// merged into one number, so a soft figure never masquerades as a hard one.
const ADMIN_PRICES = { sbp: 19.99, ubp: 49.99 };
let lsSales = { loaded: false, configured: false, revenue: 0, orders: 0, error: '', rangeKey: null };
let _lsFetchInFlight = false;

// Lemon Squeezy figures are per date range, so they have to be refetched when
// the range changes - but only once per range, and never while a fetch for it
// is already in flight, or the re-render this triggers would loop.
function ensureSalesForRange() {
  const key = (overviewFilters.from || '') + '|' + (overviewFilters.to || '');
  if (lsSales.rangeKey === key || _lsFetchInFlight) return;
  _lsFetchInFlight = true;
  fetchLemonSqueezySales().then(() => {
    lsSales.rangeKey = key;
    _lsFetchInFlight = false;
    if (currentATab === 'overview') renderOverview();
  });
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
        ? { loaded: true, configured: !!res.configured, revenue: Number(res.revenue || 0), orders: Number(res.orders || 0),
            testOrders: Number(res.testOrders || 0), testRevenue: Number(res.testRevenue || 0), testMode: !!res.testMode, error: '' }
        : { loaded: true, configured: false, revenue: 0, orders: 0, testOrders: 0, testRevenue: 0, testMode: false, error: (res && res.error) || 'failed' };
      finish();
    };
    const qs = new URLSearchParams({ action: 'sales', from: overviewFilters.from || '', to: overviewFilters.to || '', cb, _: String(Date.now()) });
    script.src = `${endpoint}?${qs}`;
    script.onerror = () => { lsSales = { loaded: true, configured: false, revenue: 0, orders: 0, error: 'network' }; finish(); };
    document.head.appendChild(script);
  });
}

// Etsy revenue for a range, from redemptions of keys issued by /claim.
function etsySalesInRange(events) {
  const etsyKeys = new Set(allKeys.map(k => String(k.key).trim().toUpperCase()));
  let revenue = 0, orders = 0;
  const perTool = { sbp: 0, ubp: 0 };
  events.filter(e => e.type === 'launch_code_redeemed').forEach(e => {
    const code = String((e.detail && e.detail.code) || '').trim().toUpperCase();
    if (!etsyKeys.has(code)) return;   // legacy or Lemon Squeezy code, not an Etsy sale
    const tool = (e.detail && e.detail.tool) === 'ubp' ? 'ubp' : 'sbp';
    revenue += ADMIN_PRICES[tool];
    perTool[tool] += ADMIN_PRICES[tool];
    orders++;
  });
  return { revenue, orders, perTool };
}

// ── Horizontal bar list ───────────────────────────────────────────────
function hBarListHtml(groups, opts) {
  const o = opts || {};
  const rows = (groups || []).slice().sort((a, b) => b.value - a.value).slice(0, o.limit || 8);
  if (!rows.length) return `<div class="chart-empty">${esc(o.empty || 'No data yet.')}</div>`;
  const max = Math.max(...rows.map(r => r.value)) || 1;
  const total = rows.reduce((s, r) => s + r.value, 0);
  // Share is meaningless for money split across two products - "$120 (60%)"
  // invites reading the percentage as a margin or a discount. Opt in only
  // where a proportion of a whole is actually the point, like locations.
  const showShare = o.showShare !== false;
  const prefix = o.prefix || '';
  return `<div class="admin-hbars">${rows.map(r => {
    const pct = Math.round(r.value / max * 100);
    const share = total ? Math.round(r.value / total * 100) : 0;
    return `<div class="admin-hbar-row">
      <span class="admin-hbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="admin-hbar-track"><i style="width:${pct}%"></i></span>
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
  const max = Math.max(...rows.map(r => r.value)) || 1;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return `<div class="admin-vbars">${rows.map(r => {
    const h = r.value > 0 ? Math.max(12, Math.round(r.value / max * 100)) : 0;
    const share = total ? Math.round(r.value / total * 100) : 0;
    return `<div class="admin-vbar-col">
      <span class="admin-vbar-track">
        <i style="height:${h}%"><b>${fmt(r.value)}</b></i>
        ${r.value === 0 ? `<em class="admin-vbar-zero">0</em>` : ''}
      </span>
      <span class="admin-vbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="admin-vbar-share">${share}%</span>
    </div>`;
  }).join('')}</div>`;
}

// ── Conversion funnel ─────────────────────────────────────────────────
function funnelHtml(steps) {
  const top = steps[0].value || 0;
  const last = steps[steps.length - 1].value || 0;
  // The headline number: what share of visits end in a sale. Shown to one
  // decimal because a store at this size will sit under 1% for a while, and
  // rounding that to "0%" would hide real movement.
  const overall = top ? (last / top * 100) : 0;
  const overallTxt = overall > 0 && overall < 1 ? overall.toFixed(2) : overall.toFixed(1);
  const header = `<div class="admin-funnel-rate">
    <div class="admin-funnel-rate-num">${overallTxt}%</div>
    <div class="admin-funnel-rate-label">overall conversion<small>${fmt(last)} of ${fmt(top)} sessions ended in a purchase</small></div>
  </div>`;
  return header + `<div class="admin-funnel">${steps.map((s, i) => {
    const pctOfTop = top ? (s.value / top * 100) : 0;
    const prev = i > 0 ? steps[i - 1].value : null;
    const stepPct = (prev && prev > 0) ? Math.round(s.value / prev * 100) : null;
    // A later step can legitimately exceed an earlier one: Lemon Squeezy
    // knows about orders this site never saw a buy-click for (a direct
    // checkout link, or a purchase from another device). Say so rather than
    // printing a nonsensical "250% of previous step".
    const overflows = stepPct !== null && stepPct > 100;
    return `<div class="admin-funnel-step">
      <div class="admin-funnel-head">
        <span class="admin-funnel-label">${esc(s.label)}</span>
        <span class="admin-funnel-value">${fmt(s.value)}</span>
      </div>
      <div class="admin-funnel-track"><i style="width:${Math.max(pctOfTop, s.value > 0 ? 2 : 0)}%;background:${s.color}"></i></div>
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

function formatOverviewRangeLabel() {
  const cm = currentMonthBounds();
  if (overviewFilters.from === cm.from && overviewFilters.to === cm.to) return 'This month, all tools.';
  if (!overviewFilters.from && !overviewFilters.to) return 'All time, all tools.';
  const fromTxt = overviewFilters.from ? formatDateDisplay(overviewFilters.from) : 'the beginning';
  const toTxt = overviewFilters.to ? formatDateDisplay(overviewFilters.to) : 'today';
  return `${fromTxt} – ${toTxt}, all tools.`;
}
function renderOverview() {
  const el = document.getElementById('aview-overview');
  const now = Date.now();
  ensureSalesForRange();
  const rangeEvents = overviewFilteredEvents();

  // "Online now" is deliberately live rather than range-filtered - it answers
  // "who is here right now", which a historical range can't.
  const liveEvents = allEvents.filter(e => isOnlineNow(e) && isWebsiteEvent(e));
  const onlineNow = uniqueBy(liveEvents, e => e.visitorId).length;

  const sessions = buildSessions(rangeEvents);
  const sessionCount = sessions.length;
  const withDuration = sessions.filter(s => s.duration > 0);
  const avgDuration = withDuration.length ? withDuration.reduce((s, x) => s + x.duration, 0) / withDuration.length : 0;
  const engagedCount = sessions.filter(s => s.engaged).length;
  const bounceRate = sessionCount ? Math.round((1 - engagedCount / sessionCount) * 100) : 0;
  const uniqueVisitors = uniqueBy(rangeEvents, e => e.visitorId).length;

  const etsy = etsySalesInRange(rangeEvents);
  const lsRevenue = lsSales.configured ? (lsSales.revenue + (showTestData ? lsSales.testRevenue : 0)) : 0;
  const lsOrders = lsSales.configured ? (lsSales.orders + (showTestData ? lsSales.testOrders : 0)) : 0;
  const totalRevenue = lsRevenue + etsy.revenue;
  const totalOrders = lsOrders + etsy.orders;
  const testNote = lsSales.testOrders
    ? ' · ' + lsSales.testOrders + ' test order' + (lsSales.testOrders === 1 ? '' : 's') +
      ' ($' + lsSales.testRevenue.toFixed(2) + ')' + (showTestData ? ' INCLUDED' : ' excluded')
    : '';
  const salesSub = lsSales.configured
    ? (lsSales.testMode && !showTestData
        ? '⚠ Test orders only - no real sales yet'
        : '$' + lsRevenue.toFixed(2) + ' Lemon Squeezy + $' + etsy.revenue.toFixed(2) + ' Etsy' + testNote)
    : (lsSales.loaded ? 'Etsy only - connect Lemon Squeezy for live revenue' : 'loading Lemon Squeezy...');

  // Funnel. The final step can only be observed through redemptions, since
  // checkout itself completes on Lemon Squeezy's own site.
  const initiated = uniqueBy(rangeEvents.filter(e => e.type === 'purchase_initiated'), e => e.sessionId).length;
  const funnelSteps = [
    { label: 'Sessions', value: sessionCount, color: '#6366f1' },
    { label: 'Clicked buy', value: initiated, color: '#a855f7', note: 'sessions reaching checkout' },
    { label: 'Completed purchase', value: totalOrders, color: '#10b981', note: lsSales.configured ? 'Lemon Squeezy orders + redeemed Etsy keys' : 'redeemed Etsy keys only' }
  ];

  // Today reads by hour; any longer range reads by day.
  const isToday = activeQuickRange() === 'today';
  const toMs = overviewFilters.to ? new Date(overviewFilters.to + 'T23:59:59').getTime() : now;
  const fromMs = overviewFilters.from ? new Date(overviewFilters.from + 'T00:00:00').getTime() : (toMs - 29 * 86400000);
  const rangeDays = Math.max(1, Math.min(366, Math.round((toMs - fromMs) / 86400000) + 1));
  const series = isToday ? hourlyUniqueVisitorSeries(rangeEvents) : dailyUniqueVisitorSeries(rangeEvents, rangeDays, toMs);
  const seriesTotal = series.reduce((s, p) => s + p.value, 0);

  const locationGroups = groupCount(rangeEvents, e => e.timezone).filter(g => g.label);
  const deviceGroups = groupCount(rangeEvents, e => uaDevice(e.ua));
  const referrerGroups = groupCount(
    rangeEvents.filter(e => e.type === 'page_view').map(e => ({ ...e, _ref: e.referrer ? (() => { try { return new URL(e.referrer).hostname; } catch (err) { return 'Other'; } })() : 'Direct' })),
    e => e._ref
  );

  const perToolSales = [
    { label: toolLabel('sbp'), value: Math.round(etsy.perTool.sbp) },
    { label: toolLabel('ubp'), value: Math.round(etsy.perTool.ubp) }
  ].filter(x => x.value > 0);

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Overview</h2></div>
    <p class="admin-section-sub">${esc(formatOverviewRangeLabel())} Website traffic only - activity inside the planners is excluded.</p>
    ${overviewFilterBarHtml()}

    <div class="admin-live-row">
      <div class="panel admin-globe-panel"><div class="panel-inner-sm">
        ${panelTitle('Online now', 'Visitors active in the last couple of minutes, placed by their browser-reported timezone. No IP lookup and no third-party geo service, so points are approximate by design. Drag to spin.')}
        <div class="admin-globe-wrap">
          <canvas id="adminGlobe" class="admin-globe" aria-label="Globe showing where visitors are online now"></canvas>
          <div class="admin-globe-count"><span id="adminGlobeNum">${fmt(onlineNow)}</span><small>online now</small></div>
        </div>
        <div class="admin-globe-legend" id="adminGlobeLegend"></div>
      </div></div>
      <div class="admin-kpi-stack">
        ${kpiRow([
          { icon: '💰', label: 'Total sales', value: '$' + totalRevenue.toFixed(2), sub: salesSub, color: '#10b981', hint: 'Real money only: Lemon Squeezy test orders are counted separately and never included here. Lemon Squeezy revenue is read live from their API. Etsy has no such feed, so Etsy sales are inferred from redeemed Etsy keys at list price, which undercounts anyone who bought but never redeemed.' },
          { icon: '🧾', label: 'Orders', value: fmt(totalOrders), sub: lsSales.configured ? fmt(lsOrders) + ' Lemon Squeezy + ' + fmt(etsy.orders) + ' Etsy' : fmt(etsy.orders) + ' redeemed Etsy keys', color: '#6366f1', hint: 'Paid orders in this range. Etsy orders are counted from redeemed keys, so they can lag the actual sale by days.' }
        ])}
        ${kpiRow([
          { icon: '📦', label: 'Sessions', value: fmt(sessionCount), sub: fmt(uniqueVisitors) + ' unique visitors', color: '#3b82f6', hint: 'A session is one continuous visit. A new one starts whenever a visitor returns after being away for a while.' },
          { icon: '⏱️', label: 'Avg. session duration', value: formatDuration(avgDuration), sub: 'first to last activity', color: '#fb923c', hint: 'Average time between the first and last recorded activity within a session.' }
        ])}
        ${kpiRow([
          { icon: '↩️', label: 'Bounce rate', value: bounceRate + '%', sub: 'left without a 2nd page or ~25s stay', color: '#f43f5e', hint: 'Share of sessions that viewed one page and did not stay long enough for a heartbeat (~25 seconds).' },
          { icon: '🛒', label: 'Reached checkout', value: fmt(initiated), sub: sessionCount ? Math.round(initiated / sessionCount * 100) + '% of sessions' : '', color: '#a855f7', hint: 'Sessions where someone clicked a buy button. Recorded on this site, so it is exact, unlike what happens afterwards on Lemon Squeezy.' }
        ])}
      </div>
    </div>

    <div class="admin-grid-2">
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Conversion funnel', 'How many sessions reach each stage. The final step is only visible through redemptions, since checkout completes on Lemon Squeezy.')}
        ${funnelHtml(funnelSteps)}
      </div></div>
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Sales by product', 'Etsy sales split by planner, from redeemed keys. Lemon Squeezy revenue is not split per product here.')}
        ${perToolSales.length ? hBarListHtml(perToolSales, { empty: 'No sales in this range.', showShare: false, prefix: '$' }) : '<div class="chart-empty">No product sales in this range.</div>'}
      </div></div>
    </div>

    <div class="panel chart-panel spend-line-panel" data-chart-scope><div class="panel-inner-sm">
      ${panelTitle(isToday ? 'Unique visitors per hour' : 'Unique visitors per day', isToday ? 'Distinct visitors per hour so far today.' : 'Distinct visitors per calendar day across the selected range.')}
      ${seriesTotal > 0 ? svgSpendLine(series, { w: 900, h: 140 }) + '<div class="spend-line-caption"><span class="spend-line-num">' + fmt(seriesTotal) + '</span><span class="spend-line-label">total visits over this period</span></div>' : '<div class="chart-empty">No visits in this range.</div>'}
    </div></div>

    <div class="admin-grid-2">
      <div class="panel chart-panel"><div class="panel-inner-sm">
        ${panelTitle('Device type')}
        ${vBarChartHtml(deviceGroups, { categories: ['Desktop', 'Tablet', 'Mobile'] })}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Referrers', 'Which site sent each visitor here, grouped by domain. "Direct" means no referrer was recorded: a typed URL, a bookmark, or a privacy-blocked referrer.')}
        ${pieOrEmpty(referrerGroups, 'No data yet.')}
      </div></div>
    </div>

    <div class="panel chart-panel"><div class="panel-inner-sm">
      ${panelTitle('Sessions by location', 'Grouped by the browser-reported timezone, the only geography signal collected.')}
      ${hBarListHtml(locationGroups, { empty: 'No data yet.', limit: 10 })}
    </div></div>`;

  wireOverviewFilterBar();
  initFieldTips(el);
  mountLiveGlobe(liveEvents);
  requestAnimationFrame(() => {
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.spend-line-dot', { format: d => '<strong>' + esc(d.label) + '</strong><br>' + esc(fmt(d.val)) + ' visitor' + (d.val == 1 ? '' : 's') });
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d => '<strong>' + esc(d.label) + '</strong><br>' + esc(fmt(d.val)) + ' · ' + parseFloat(d.pct || 0).toFixed(0) + '%' });
    });
  });
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
const ETSY_DEVICE_LIMIT = 5;

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
const SOURCE_LABEL = { etsy: 'Etsy', lemonsqueezy: 'Lemon Squeezy', launch: 'Launch code' };

function keySource(key) {
  const k = String(key || '').trim().toUpperCase();
  if (k.startsWith('ETSY-')) return 'etsy';
  // Lemon Squeezy issues UUIDs; a launch code is a short unbroken run of
  // letters and digits.
  if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(k)) return 'lemonsqueezy';
  if (/^[0-9A-Z]{4,12}$/.test(k)) return 'launch';
  return 'lemonsqueezy';
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
        source: keySource(raw), lastSeen: 0, visitors: new Set(), fromEventsOnly: true
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
    allSales.forEach(o => {
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
      const canRevoke = r.source !== 'launch';
      return `<tr class="admin-activity-row${revoked ? ' admin-row-muted' : ''}">
        <td class="admin-col-expand"><button class="admin-expand-btn" type="button" data-expand="${id}" aria-expanded="false" aria-label="Show details for ${esc(r.key)}">▸</button></td>
        <td class="admin-table-strong">${r.orderId ? esc(r.orderId) : '<span class="admin-table-muted">—</span>'}${r.testOrder ? ' <span class="admin-src-badge">TEST</span>' : ''}${r.reused ? ` <span class="admin-reuse-badge" title="This order ID was used by ${r.reuseCount} different visitors">⚠ ×${r.reuseCount}</span>` : ''}</td>
        <td>${esc(toolLabel(r.tool))}</td>
        <td class="admin-key-cell">${esc(r.key)} <span class="admin-src-badge">${esc(SOURCE_LABEL[r.source])}</span></td>
        <td class="admin-col-action">${canRevoke
          ? `<button class="btn btn-ghost btn-sm admin-key-toggle" type="button" data-key="${esc(r.key)}" data-source="${r.source}" data-tool="${esc(r.tool)}" data-order="${esc(r.orderId)}" data-row="${r.sheetRow || ''}" data-next="${revoked ? 'active' : 'revoked'}">${revoked ? 'Restore' : 'Revoke'}</button>`
          : `<span class="admin-table-muted" title="Launch codes are shared by every buyer who received one, so revoking would lock all of them out">shared code</span>`}</td>
      </tr>
      <tr class="admin-activity-detail" data-detail="${id}" hidden><td colspan="5">
        <div class="admin-detail-grid">
          <div><span>Email</span><strong>${r.email ? esc(r.email) : '—'}</strong></div>
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
  const el = document.getElementById('aview-redemptions');
  const all = redemptionActivityRows();
  const rows = filteredActivityRows();
  const uniqueOrderIds = uniqueBy(all.filter(r => r.orderId), r => r.orderId).length;
  const reusedOrderIds = uniqueBy(all.filter(r => r.reused), r => r.orderId).length;
  const revokedCount = all.filter(r => r.status === 'revoked').length;

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Redemption Activity</h2></div>
    <p class="admin-section-sub">Every license key from both Etsy and Lemon Squeezy, all-time, one row per key. Expand a row for the buyer's email, device use and history. Revoking blocks future redemptions; anyone who already unlocked keeps access, since that unlock lives on their own device.</p>
    ${kpiRow([
      { icon: '🔑', label: 'License keys', value: fmt(all.length), sub: 'issued or redeemed', color: '#6366f1', hint: 'Every key that has been claimed or redeemed, across Etsy, Lemon Squeezy and the original launch codes.' },
      { icon: '🧾', label: 'Unique order IDs', value: fmt(uniqueOrderIds), sub: '', color: '#14b8a6', hint: 'Distinct order IDs across all keys. Etsy orders come from the claim at /claim; Lemon Squeezy orders from the checkout itself.' },
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
    "You are Ezzo, the site owner's analytics assistant, built into the private EzzoBudget admin dashboard. You have full access to every metric in this dashboard - Overview, Live, Traffic, Product, App Insights, and Redemptions - with no exceptions; if a number appears anywhere in the dashboard, one of your tools can fetch it. " +
    "You ONLY answer questions about the anonymous, aggregate usage analytics collected for this site (visitors, sessions, traffic, tool usage, feature adoption, theme/language/sync preferences, license key redemptions) using the tools provided. " +
    "You must call one of the provided functions to fetch real data before stating any number, percentage, or count - never invent or estimate numbers yourself. If a specific tool doesn't obviously cover what was asked, use search_events (or search_redemptions for anything about codes/order IDs/redeemers) as a general-purpose fallback before saying data isn't available. " +
    "This data is entirely anonymous and aggregate: visitors are identified only by a random on-device ID, and there is no name, email, IP address, or any financial/budget data available to you, ever - if asked for something like that, say plainly it was never collected rather than guessing. " +
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
function pennyExecuteTool(name, args, ctx) {
  try {
    switch (name) {
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
    { key: 'overview', label: "How's traffic looking this month?" },
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
  const TABS_UBP = ['dashboard', 'transactions', 'budget', 'debt', 'subscriptions', 'sinking', 'calendar'];
  const FEATURES_BOTH = ['sample_data_loaded', 'csv_exported'];
  const FEATURES_UBP = ['debt_added', 'sinking_fund_created', 'subscription_added', 'automation_enabled', 'allocation_enabled'];
  const THEMES = ['dark', 'synthwave', 'light', 'vintage-ledger', 'terminal'];
  const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pl'];
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
    const preferredTool = Math.random() < 0.55 ? 'sbp' : 'ubp';
    const usesBoth = Math.random() < 0.25;
    for (let s = 0; s < sessionCount; s++) {
      const daysAgo = Math.random() * 29;
      const sessionId = 'sample_s' + v + '_' + s;
      const tool = usesBoth && s > 0 ? (preferredTool === 'sbp' ? 'ubp' : 'sbp') : preferredTool;
      const tabs = tool === 'ubp' ? TABS_UBP : TABS_SBP;
      let t = now - daysAgo * DAY - Math.random() * 3600000;
      push('page_view', t, 'home', '', visitorId, sessionId);
      t += 2000 + Math.random() * 5000;
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
        if (Math.random() < 0.1) push('language_changed', t + 24000, tool, tool, visitorId, sessionId, { lang: rand(LANGUAGES) });
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
function updateSampleBanner() {
  const banner = document.getElementById('adminSampleBanner');
  if (banner) banner.hidden = !_sampleDataActive;
}
function loadSampleData() {
  allEvents = generateSampleAdminEvents();
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
    try { allEvents = await adminFetchEvents(_adminAccessToken); _lastFetched = Date.now(); } catch (e) { /* keep last-known data */ }
  } else {
    allEvents = [];
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

function renderSettings() {
  const el = document.getElementById('aview-settings');
  const themes = [['light', 'Light'], ['dark', 'Dark'], ['synthwave', 'Synthwave'], ['vintage-ledger', 'Vintage Ledger'], ['terminal', 'Terminal']];
  const current = document.documentElement.dataset.theme || 'dark';
  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Settings</h2></div>
    <div class="settings-grid">
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🎨 Appearance</div>
        <div class="theme-setting-row"><div class="theme-pill" role="group">
          ${themes.map(([val, label]) => `<button class="theme-opt${val === current ? ' is-active' : ''}" data-theme-val="${val}" type="button">${esc(label)}</button>`).join('')}
        </div></div>
      </div></div>
      ${pennySettingsCardHtml()}
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">ℹ️ About this dashboard</div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Signed in as</div><div class="admin-setting-hint">${esc(_adminEmail || 'unknown')}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Events loaded</div><div class="admin-setting-hint">${fmt(allEvents.length)} rows${_sampleDataActive ? ' (sample data)' : ''}, last refreshed ${_lastFetched ? esc(relTime(_lastFetched)) : 'never'}</div></div></div>
        <div class="admin-setting-row"><div><div class="admin-setting-label">Auto-refresh</div><div class="admin-setting-hint">Every ${Math.round(ADMIN_POLL_MS / 1000)}s while the dashboard is open</div></div></div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        ${dangerZoneHtml()}
      </div></div>
      <div class="panel"><div class="panel-inner">
        <button class="btn btn-ghost" id="adminSignOutBtn2" type="button">Sign out</button>
      </div></div>
    </div>`;
  el.querySelectorAll('.theme-opt').forEach(btn => btn.addEventListener('click', () => { document.documentElement.dataset.theme = btn.dataset.themeVal; el.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('is-active', b === btn)); }));
  el.querySelector('#adminSignOutBtn2')?.addEventListener('click', adminSignOut);
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

// ══════════════════════ Emails ══════════════════════
// Every address the site has collected, in one list that can leave as a CSV.
// Two sources today: buyers who claimed an Etsy key, and people who asked to
// be told when a tool launches. Lemon Squeezy buyers are not here - that
// sales proxy returns totals only, never customer records.
let emailFilters = { source: '', tool: '', q: '' };

function emailRows() {
  const rows = [];
  allKeys.forEach(k => {
    if (!k.email) return;
    rows.push({
      email: String(k.email).trim().toLowerCase(), source: 'purchase', tool: k.tool || '',
      detail: k.orderId ? 'Order ' + k.orderId : '', date: k.issuedAt || '', status: k.status || 'active'
    });
  });
  allSales.forEach(o => {
    if (!o.email) return;
    rows.push({
      email: String(o.email).trim().toLowerCase(), source: 'purchase',
      tool: /ultimate/i.test(o.product) ? 'ubp' : /simple/i.test(o.product) ? 'sbp' : '',
      detail: 'Lemon Squeezy ' + (o.orderId ? '#' + o.orderId : '') + (o.mode === 'test' ? ' (test)' : ''),
      date: o.ts || '', status: o.mode === 'test' ? 'test' : 'active'
    });
  });
  allNotify.forEach(n => {
    rows.push({
      email: String(n.email).trim().toLowerCase(), source: 'notify', tool: n.tool || '',
      detail: n.source || 'notify', date: n.ts || '', status: ''
    });
  });
  // One row per address per source, keeping the most recent date.
  const seen = new Map();
  rows.forEach(r => {
    const id = r.email + '|' + r.source + '|' + r.tool;
    const prev = seen.get(id);
    if (!prev || String(r.date) > String(prev.date)) seen.set(id, r);
  });
  return [...seen.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function emailFilteredRows() {
  const q = emailFilters.q.trim().toLowerCase();
  return emailRows().filter(r =>
    (!emailFilters.source || r.source === emailFilters.source) &&
    (!emailFilters.tool || r.tool === emailFilters.tool) &&
    (!q || r.email.includes(q) || String(r.detail).toLowerCase().includes(q)));
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula,
  // so it is prefixed rather than left to execute on open.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function downloadEmailsCsv(rows, name) {
  const header = ['Email', 'Source', 'Tool', 'Detail', 'Date', 'Status'];
  const body = rows.map(r => [r.email, r.source, r.tool, r.detail, r.date, r.status].map(csvCell).join(','));
  const blob = new Blob(['\uFEFF' + [header.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || ('ezzo-emails-' + new Date().toISOString().slice(0, 10) + '.csv');
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function renderEmails() {
  const el = document.getElementById('aview-emails');
  if (!el) return;
  const all = emailRows();
  const rows = emailFilteredRows();
  const unique = new Set(all.map(r => r.email)).size;
  const purchases = all.filter(r => r.source === 'purchase').length;
  const notifies = all.filter(r => r.source === 'notify').length;
  const tools = [...new Set(all.map(r => r.tool).filter(Boolean))];

  el.innerHTML = `
    <div class="section-header"><h2 class="section-title">✉️ Email list</h2></div>
    <p class="section-desc">Everyone who has given you an address: Etsy key claims, Lemon Squeezy orders, and launch notifications.
      Lemon Squeezy buyers appear from the moment the sale webhook is set up, so anything bought before that stays in their dashboard only.</p>
    ${kpiRow([
      { icon: '📇', label: 'Unique addresses', value: String(unique), sub: 'across both sources', color: '#6366f1' },
      { icon: '🛒', label: 'From purchases', value: String(purchases), sub: 'Etsy key claims', color: '#10b981' },
      { icon: '🔔', label: 'Launch notifications', value: String(notifies), sub: 'asked to be told', color: '#f59e0b' }
    ])}
    <div class="tx-filter-bar">
      <input class="input input-sm" type="text" id="emQ" placeholder="Search address or order…" value="${esc(emailFilters.q)}">
      <select class="select select-sm" id="emSource">
        <option value="">All sources</option>
        <option value="purchase" ${emailFilters.source==='purchase'?'selected':''}>Purchases</option>
        <option value="notify" ${emailFilters.source==='notify'?'selected':''}>Launch notifications</option>
      </select>
      <select class="select select-sm" id="emTool">
        <option value="">All tools</option>
        ${tools.map(t => `<option value="${esc(t)}" ${emailFilters.tool===t?'selected':''}>${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="adm-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px">
      <button class="btn btn-primary btn-sm" id="emExport">⬇ Export ${rows.length} shown</button>
      <button class="btn btn-ghost btn-sm" id="emExportAll">Export all ${all.length}</button>
      <button class="btn btn-ghost btn-sm" id="emCopy">Copy addresses</button>
    </div>
    ${rows.length === 0
      ? `<div class="empty-state"><div class="empty-icon">✉️</div><p class="empty-title">No addresses yet</p>
           <p class="empty-sub">They appear here as buyers claim keys and visitors ask to be told about a launch.</p></div>`
      : `<div class="panel"><div class="tx-table-wrap"><table class="tx-table"><thead><tr>
          <th>Email</th><th>Source</th><th>Tool</th><th>Detail</th><th>Date</th>
        </tr></thead><tbody>
        ${rows.map(r => `<tr class="tx-row">
          <td>${esc(r.email)}</td>
          <td><span class="tx-pill">${r.source === 'purchase' ? 'Purchase' : 'Notify'}</span></td>
          <td>${esc((r.tool || '').toUpperCase())}</td>
          <td class="tx-desc">${esc(r.detail || '-')}</td>
          <td class="tx-date">${esc(String(r.date).slice(0, 10))}</td>
        </tr>`).join('')}
        </tbody></table></div></div>`}`;

  const rerender = () => renderEmails();
  const q = document.getElementById('emQ');
  q?.addEventListener('input', () => { emailFilters.q = q.value; clearTimeout(q._t); q._t = setTimeout(rerender, 250); });
  document.getElementById('emSource')?.addEventListener('change', e => { emailFilters.source = e.target.value; rerender(); });
  document.getElementById('emTool')?.addEventListener('change', e => { emailFilters.tool = e.target.value; rerender(); });
  document.getElementById('emExport')?.addEventListener('click', () => downloadEmailsCsv(emailFilteredRows()));
  document.getElementById('emExportAll')?.addEventListener('click', () => downloadEmailsCsv(emailRows(), 'ezzo-emails-all.csv'));
  document.getElementById('emCopy')?.addEventListener('click', async () => {
    const list = [...new Set(emailFilteredRows().map(r => r.email))].join(', ');
    try { await navigator.clipboard.writeText(list); showToast('Addresses copied'); }
    catch (e) { showToast('Could not copy'); }
  });
}

// ══════════════════════ Sales ══════════════════════
// Every Lemon Squeezy order the webhook has recorded. Redemptions only ever
// showed keys, so an order that was paid for but whose key was never typed
// in appeared nowhere at all. This is the order side of the same story.
function salesRows() {
  const redeemedOrders = new Set();
  redemptionEvents().forEach(e => {
    const o = e.detail && e.detail.orderId;
    if (o) redeemedOrders.add(String(o));
  });
  return allSales
    .filter(o => !salesFilters.mode || o.mode === salesFilters.mode)
    .filter(o => {
      const q = salesFilters.q.trim().toLowerCase();
      if (!q) return true;
      return [o.email, o.name, o.product, o.orderId, o.orderNumber]
        .some(v => String(v || '').toLowerCase().includes(q));
    })
    .map(o => Object.assign({}, o, {
      // Either identifier can mark it redeemed: which one a redemption
      // reported changed when the webhook started recording both.
      redeemed: redeemedOrders.has(String(o.orderId)) || (!!o.orderNumber && redeemedOrders.has(String(o.orderNumber)))
    }))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

function renderSales() {
  const el = document.getElementById('aview-sales');
  if (!el) return;
  const rows = salesRows();
  const live = allSales.filter(o => o.mode !== 'test');
  const tests = allSales.filter(o => o.mode === 'test');
  const liveRevenue = live.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const unredeemed = rows.filter(o => !o.redeemed).length;

  el.innerHTML = `
    <div class="section-header"><h2 class="section-title">🧾 Sales</h2></div>
    <p class="section-desc">Every Lemon Squeezy order, as it was paid, not as it was redeemed.
      Etsy sales are not here: Etsy provides no feed, so those only become visible when a key is claimed.</p>
    ${kpiRow([
      { icon: '💰', label: 'Real revenue', value: '$' + liveRevenue.toFixed(2), sub: live.length + ' paid order' + (live.length === 1 ? '' : 's'), color: '#10b981' },
      { icon: '🧪', label: 'Test orders', value: String(tests.length), sub: showTestData ? 'counted in Overview' : 'not counted anywhere', color: '#f59e0b' },
      { icon: '🔑', label: 'Awaiting redemption', value: String(unredeemed), sub: 'paid but key not yet used', color: '#6366f1' }
    ])}
    <div class="tx-filter-bar">
      <input class="input input-sm" type="text" id="slQ" placeholder="Search buyer, product or order…" value="${esc(salesFilters.q)}">
      <select class="select select-sm" id="slMode">
        <option value="">Live and test</option>
        <option value="live" ${salesFilters.mode === 'live' ? 'selected' : ''}>Real sales only</option>
        <option value="test" ${salesFilters.mode === 'test' ? 'selected' : ''}>Test only</option>
      </select>
      <label class="check-label" style="gap:8px;font-size:12px"
             title="Test orders are always listed here. This only decides whether they are added to the revenue figure on the Overview tab.">
        <input type="checkbox" id="slShowTest" ${showTestData ? 'checked' : ''}><span class="checkmark checkmark--sm"></span>
        <span>Count test orders as revenue</span>
      </label>
    </div>
    ${rows.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🧾</div><p class="empty-title">No orders yet</p>
           <p class="empty-sub">${salesFilters.mode
              ? 'Nothing matches that filter. Set it back to "Live and test".'
              : 'Orders appear the moment Lemon Squeezy reports one. If a sale rang your phone but is not listed here, the Apps Script needs redeploying.'}</p></div>`
      : `<div class="panel"><div class="tx-table-wrap"><table class="tx-table"><thead><tr>
          <th>Date</th><th>Order</th><th>Product</th><th>Buyer</th><th>Amount</th><th>Key used</th>
        </tr></thead><tbody>
        ${rows.map(o => `<tr class="tx-row">
          <td class="tx-date">${esc(String(o.ts).slice(0, 10))}</td>
          <td>${esc(o.orderNumber || o.orderId || '-')}${o.mode === 'test' ? ' <span class="admin-src-badge">TEST</span>' : ''}</td>
          <td class="tx-cat">${esc(o.product)}${o.variant ? ' <span class="admin-table-muted">' + esc(o.variant) + '</span>' : ''}</td>
          <td class="tx-desc">${esc(o.email || '-')}</td>
          <td class="tx-amt">$${(Number(o.total) || 0).toFixed(2)}</td>
          <td>${o.redeemed ? '✓' : '<span class="admin-table-muted">not yet</span>'}</td>
        </tr>`).join('')}
        </tbody></table></div></div>`}`;

  const q = document.getElementById('slQ');
  q?.addEventListener('input', () => { salesFilters.q = q.value; clearTimeout(q._t); q._t = setTimeout(renderSales, 250); });
  document.getElementById('slMode')?.addEventListener('change', e => { salesFilters.mode = e.target.value; renderSales(); });
  document.getElementById('slShowTest')?.addEventListener('change', e => {
    setShowTestData(e.target.checked);
    renderSales();
  });
}

const ADMIN_RENDERERS = { overview: renderOverview, redemptions: renderRedemptions, sales: renderSales, emails: renderEmails, blogs: renderBlogs, settings: renderSettings };
function switchATab(tab) {
  currentATab = tab;
  document.querySelectorAll('#adminTabs .btab').forEach(b => b.classList.toggle('is-active', b.dataset.atab === tab));
  document.querySelectorAll('.bview').forEach(v => v.classList.toggle('is-active', v.id === 'aview-' + tab));
  (ADMIN_RENDERERS[tab] || renderOverview)();
}

// ══════════════════════ Live polling ══════════════════════
function startLivePolling() {
  stopLivePolling();
  liveTimer = setInterval(async () => {
    if (_sampleDataActive) return; // don't let a background poll silently swap sample data back to real
    try {
      allEvents = await adminFetchEvents(_adminAccessToken);
      // Keys change far more rarely than events, so only refetch them on the
      // two tabs that read them - Keys itself, and Redemptions, which resolves
      // each key's order ID from them.
      if (currentATab === 'keys' || currentATab === 'redemptions' || currentATab === 'emails') allKeys = await adminFetchKeys(_adminAccessToken);
      if (currentATab === 'emails' || currentATab === 'sales' || currentATab === 'redemptions') {
        allSales = await adminFetchSales(_adminAccessToken);
      }
      if (currentATab === 'emails') allNotify = await adminFetchNotify(_adminAccessToken);
      _lastFetched = Date.now();
      (ADMIN_RENDERERS[currentATab] || renderOverview)();
    }
    catch (e) { /* keep showing last-known data; next tick may recover */ }
  }, ADMIN_POLL_MS);
}
function stopLivePolling() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

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
    allEvents = await adminFetchEvents(token);
    allKeys = await adminFetchKeys(token);
    allNotify = await adminFetchNotify(token);
    allSales = await adminFetchSales(token);
    _lastFetched = Date.now();
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
  try { allEvents = await adminFetchEvents(_adminAccessToken); _lastFetched = Date.now(); (ADMIN_RENDERERS[currentATab] || renderOverview)(); } catch (e) { /* silent - keep last-known data on screen */ }
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
