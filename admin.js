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
const ADMIN_SHEET_RANGE = `${ADMIN_SHEET_NAME}!A2:L100000`;
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

// ══════════════════════════════════════════════════════════════════════
//  Summary - plain-language, all-time digest (like App Insights' own
//  cross-tool callout, expanded into a whole tab). Every card states a
//  number pulled straight from an existing aggregation helper - nothing
//  here is invented. A few cards deliberately CROSS-REFERENCE two signals
//  that live on different tabs (device x bounce, referrer x redemption
//  conversion) to surface things no single tab shows by itself. All-time
//  like App Insights/Redemptions, not tied to Overview's date range - a
//  durable digest, not a point-in-time snapshot.
// ══════════════════════════════════════════════════════════════════════
function b(v) { return `<strong>${v}</strong>`; }
function summaryCardHtml(icon, tone, html) {
  return `<div class="admin-summary-card admin-summary-card--${tone}"><div class="admin-summary-icon">${icon}</div><div class="admin-summary-text">${html}</div></div>`;
}
function summarySectionHtml(title, cards) {
  const filled = cards.filter(Boolean);
  if (!filled.length) return '';
  return `<div class="admin-summary-section-title">${esc(title)}</div><div class="admin-summary-grid">${filled.join('')}</div>`;
}
function summaryCrossToolOverlap() {
  const sbpVisitors = new Set(allEvents.filter(e => e.page === 'sbp').map(e => e.visitorId));
  const ubpVisitors = new Set(allEvents.filter(e => e.page === 'ubp').map(e => e.visitorId));
  let bothCount = 0;
  sbpVisitors.forEach(v => { if (ubpVisitors.has(v)) bothCount++; });
  const totalToolVisitors = new Set([...sbpVisitors, ...ubpVisitors]).size;
  if (!totalToolVisitors) return null;
  const pct = Math.round(bothCount / totalToolVisitors * 100);
  return summaryCardHtml('🔀', pct >= 30 ? 'positive' : 'neutral',
    `${b(pct + '%')} of visitors who've used either tool have explored <strong>both</strong> Simple Budget and Ultimate Budget (${bothCount} of ${totalToolVisitors} tool visitors) - a read on how much cross-tool comparison / upsell interest exists.`);
}
function summaryMonthOverMonth() {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const thisCount = uniqueBy(allEvents.filter(e => eventTime(e) >= thisMonthStart), e => e.visitorId).length;
  const lastCount = uniqueBy(allEvents.filter(e => eventTime(e) >= lastMonthStart && eventTime(e) < thisMonthStart), e => e.visitorId).length;
  if (!lastCount) {
    if (!thisCount) return null;
    return summaryCardHtml('📈', 'neutral', `${b(thisCount)} visitor${thisCount === 1 ? '' : 's'} so far this month - not enough history yet for a month-over-month comparison.`);
  }
  const pct = Math.round((thisCount - lastCount) / lastCount * 100);
  const up = pct >= 0;
  return summaryCardHtml(up ? '📈' : '📉', up ? 'positive' : 'warning',
    `Visitors are ${b((up ? '+' : '') + pct + '%')} this month vs. last month (${thisCount} vs. ${lastCount}) - ${up ? 'a positive trend worth understanding and repeating.' : 'worth digging into what changed.'}`);
}
function summaryReturningRate() {
  const nr = newReturningSplit(allEvents);
  if (!nr.total) return null;
  const pct = Math.round(nr.returningCount / nr.total * 100);
  const tier = pct >= 40 ? 'strong' : pct >= 15 ? 'building' : 'early-stage';
  return summaryCardHtml('🔁', pct >= 25 ? 'positive' : 'neutral',
    `${b(pct + '%')} of all-time visitors (${nr.returningCount} of ${nr.total}) have come back for more than one session - a sign of ${tier} retention.`);
}
function summaryTopRegion() {
  const groups = groupCount(allEvents, e => e.timezone).filter(g => g.label && g.label !== 'Unknown');
  if (!groups.length) return null;
  const top = groups[0];
  const total = groups.reduce((s, g) => s + g.value, 0);
  const pct = Math.round(top.value / total * 100);
  return summaryCardHtml('🌍', 'neutral',
    `Most activity comes from <strong>${esc(top.label)}</strong> (${b(pct + '%')} of all events) - worth keeping in mind for timezone-aware announcements or support hours.`);
}
function summaryDeviceBounceCrossRef() {
  const firstUaBySession = new Map();
  allEvents.forEach(e => { if (!firstUaBySession.has(e.sessionId)) firstUaBySession.set(e.sessionId, e.ua); });
  const sessions = buildSessions(allEvents).map(s => ({ ...s, device: uaDevice(firstUaBySession.get(s.sessionId) || '') }));
  const mobile = sessions.filter(s => s.device === 'Mobile' || s.device === 'Tablet');
  const desktop = sessions.filter(s => s.device === 'Desktop');
  if (mobile.length < 3 || desktop.length < 3) return null; // avoid noisy small-sample claims
  const mobileBounce = Math.round((1 - mobile.filter(s => s.engaged).length / mobile.length) * 100);
  const desktopBounce = Math.round((1 - desktop.filter(s => s.engaged).length / desktop.length) * 100);
  if (Math.abs(mobileBounce - desktopBounce) < 5) {
    return summaryCardHtml('📱', 'neutral', `Mobile (${b(mobileBounce + '%')}) and desktop (${b(desktopBounce + '%')}) bounce rates are about the same - device type isn't a major factor in engagement here.`);
  }
  const worse = mobileBounce > desktopBounce ? 'Mobile' : 'Desktop';
  const better = worse === 'Mobile' ? 'desktop' : 'mobile';
  return summaryCardHtml('📱', 'warning', `${b(worse)} visitors bounce noticeably more than ${better} visitors (${b(mobileBounce + '%')} vs. ${b(desktopBounce + '%')}) - worth a closer look at the ${worse.toLowerCase()} experience.`);
}
function summaryToolHeadToHead() {
  const sbp = toolInsights('sbp'), ubp = toolInsights('ubp');
  if (!sbp.visitorCount && !ubp.visitorCount) return null;
  const leaderVisitors = sbp.visitorCount >= ubp.visitorCount ? 'Simple Budget' : 'Ultimate Budget';
  const leaderConversion = sbp.conversionPct >= ubp.conversionPct ? 'Simple Budget' : 'Ultimate Budget';
  const text = leaderVisitors === leaderConversion
    ? `<strong>${leaderVisitors}</strong> leads on both visitors (${sbp.visitorCount} vs. ${ubp.visitorCount}) and code-redemption conversion (${sbp.conversionPct}% vs. ${ubp.conversionPct}%) - it's the clear stronger performer right now.`
    : `<strong>${leaderVisitors}</strong> draws more visitors (${sbp.visitorCount} vs. ${ubp.visitorCount}), but <strong>${leaderConversion}</strong> converts visitors into redemptions better (${sbp.conversionPct}% vs. ${ubp.conversionPct}%) - worth understanding why the more-visited tool converts worse.`;
  return summaryCardHtml('⚖️', 'neutral', text);
}
function summaryTopFeature() {
  const sbp = toolInsights('sbp'), ubp = toolInsights('ubp');
  const merged = new Map();
  [...sbp.featureGroups, ...ubp.featureGroups].forEach(g => merged.set(g.label, (merged.get(g.label) || 0) + g.value));
  const sorted = Array.from(merged.entries()).sort((a, z) => z[1] - a[1]);
  if (!sorted.length) return null;
  const [label, count] = sorted[0];
  return summaryCardHtml('💡', 'neutral', `<strong>${esc(label)}</strong> is the most-used feature across both tools (${b(count)} use${count === 1 ? '' : 's'}) - a good indicator of what people value most once they're in.`);
}
function summaryLayoutPreference() {
  const sbp = toolInsights('sbp'), ubp = toolInsights('ubp');
  const merged = new Map();
  [...sbp.layoutGroups, ...ubp.layoutGroups].forEach(g => merged.set(g.label, (merged.get(g.label) || 0) + g.value));
  const total = Array.from(merged.values()).reduce((s, v) => s + v, 0);
  if (!total) return null;
  const [label, count] = Array.from(merged.entries()).sort((a, z) => z[1] - a[1])[0];
  const pct = Math.round(count / total * 100);
  return summaryCardHtml('🎛️', 'neutral', `Of visitors who've changed their dashboard layout, ${b(pct + '%')} prefer <strong>${esc(label)}</strong> (${count} of ${total}).`);
}
function summaryRedemptionConversion() {
  const visitors = uniqueBy(allEvents.filter(e => e.page === 'sbp' || e.page === 'ubp'), e => e.visitorId).length;
  const redeemers = uniqueBy(allEvents.filter(e => e.type === 'launch_code_redeemed'), e => e.visitorId).length;
  if (!visitors) return null;
  const pct = Math.round(redeemers / visitors * 100);
  return summaryCardHtml('🔓', pct >= 15 ? 'positive' : 'neutral', `${b(pct + '%')} of all tool visitors (${redeemers} of ${visitors}) have redeemed a license key - the site-wide activation rate.`);
}
function summaryReusedOrderIds() {
  const rows = redemptionRows();
  if (!rows.length) return null;
  const reused = uniqueBy(rows.filter(r => r.reused), r => r.orderId).length;
  if (!reused) return summaryCardHtml('✅', 'positive', `No reused order IDs flagged across ${b(rows.length)} redemption${rows.length === 1 ? '' : 's'} - nothing currently stands out to investigate in Redemptions.`);
  return summaryCardHtml('⚠️', 'warning', `${b(reused)} order ID${reused === 1 ? ' has' : 's have'} been entered by more than one different visitor - worth a look in the Redemptions tab before assuming they're all legitimate.`);
}
function summaryReferrerConversionCrossRef() {
  const toolEvents = allEvents.filter(e => e.page === 'sbp' || e.page === 'ubp');
  const referrerByVisitor = new Map();
  toolEvents.forEach(e => { if (!referrerByVisitor.has(e.visitorId)) referrerByVisitor.set(e.visitorId, e.referrer ? (() => { try { return new URL(e.referrer).hostname; } catch (err) { return 'Direct'; } })() : 'Direct'); });
  const redeemerIds = new Set(allEvents.filter(e => e.type === 'launch_code_redeemed').map(e => e.visitorId));
  const overallTotal = referrerByVisitor.size;
  if (!overallTotal) return null;
  let overallRedeemed = 0;
  referrerByVisitor.forEach((ref, vid) => { if (redeemerIds.has(vid)) overallRedeemed++; });
  const overallPct = Math.round(overallRedeemed / overallTotal * 100);
  const byReferrer = new Map();
  referrerByVisitor.forEach((ref, vid) => {
    if (!byReferrer.has(ref)) byReferrer.set(ref, { total: 0, redeemed: 0 });
    const rec = byReferrer.get(ref);
    rec.total++;
    if (redeemerIds.has(vid)) rec.redeemed++;
  });
  const candidates = Array.from(byReferrer.entries())
    .filter(([ref, rec]) => ref !== 'Direct' && rec.total >= 3)
    .map(([ref, rec]) => ({ ref, pct: Math.round(rec.redeemed / rec.total * 100), total: rec.total }))
    .sort((a, z) => z.pct - a.pct);
  if (!candidates.length || candidates[0].pct <= overallPct) return null;
  const top = candidates[0];
  return summaryCardHtml('🔗', 'positive', `Visitors from <strong>${esc(top.ref)}</strong> convert to a code redemption at ${b(top.pct + '%')}, higher than the ${overallPct}% site-wide average (based on ${top.total} visitors) - that channel looks worth leaning into.`);
}
function summaryThemePopularity() {
  const groups = groupCount(allEvents.filter(e => e.type === 'theme_changed'), e => (e.detail && e.detail.theme) || 'Unknown');
  if (!groups.length) return null;
  const total = groups.reduce((s, g) => s + g.value, 0);
  const top = groups[0];
  const pct = Math.round(top.value / total * 100);
  return summaryCardHtml('🎨', 'neutral', `<strong>${esc(top.label)}</strong> is the most popular theme (${b(pct + '%')} of theme changes) among visitors who customized it.`);
}
function summarySyncPreference() {
  const groups = groupCount(allEvents.filter(e => e.type === 'sync_mode_chosen'), e => (e.detail && e.detail.mode) === 'google' ? 'Google Drive' : 'Local device');
  if (!groups.length) return null;
  const total = groups.reduce((s, g) => s + g.value, 0);
  const google = groups.find(g => g.label === 'Google Drive');
  const pct = google ? Math.round(google.value / total * 100) : 0;
  return summaryCardHtml('☁️', 'neutral', `${b(pct + '%')} of visitors who chose a sync mode picked Google Drive over local-only storage (${google ? google.value : 0} of ${total}).`);
}
function renderSummary() {
  const el = document.getElementById('aview-summary');
  const sections = [
    ['👥 Audience', [summaryCrossToolOverlap(), summaryMonthOverMonth(), summaryReturningRate(), summaryTopRegion(), summaryDeviceBounceCrossRef()]],
    ['🧩 Product performance', [summaryToolHeadToHead(), summaryTopFeature(), summaryLayoutPreference()]],
    ['🔑 Redemptions & risk', [summaryRedemptionConversion(), summaryReusedOrderIds(), summaryReferrerConversionCrossRef()]],
    ['🎨 Preferences', [summaryThemePopularity(), summarySyncPreference()]],
  ];
  const sectionsHtml = sections.map(([title, cards]) => summarySectionHtml(title, cards)).filter(Boolean).join('');
  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Summary</h2></div>
    <p class="admin-section-sub">Plain-language highlights pulled from every tab, all-time - including a few call-outs that cross-reference two signals at once to surface things no single tab shows on its own.</p>
    ${sectionsHtml || `<div class="chart-empty">Not enough data yet to summarize - check back once there's some traffic.</div>`}`;
}

function overviewFilteredEvents() {
  return allEvents.filter(e => {
    const t = eventTime(e);
    if (overviewFilters.from && t < new Date(overviewFilters.from + 'T00:00:00').getTime()) return false;
    if (overviewFilters.to && t > new Date(overviewFilters.to + 'T23:59:59').getTime()) return false;
    return true;
  });
}
function overviewFilterBarHtml() {
  const cm = currentMonthBounds();
  const isCurrentMonth = overviewFilters.from === cm.from && overviewFilters.to === cm.to;
  return `<div class="admin-filter-bar">
    ${styledDateField('ovFilterFrom', 'ovFilterFromWrap', overviewFilters.from)}
    ${styledDateField('ovFilterTo', 'ovFilterToWrap', overviewFilters.to)}
    ${!isCurrentMonth ? `<button class="admin-filter-clear" id="ovFilterThisMonth" type="button">Reset to this month</button>` : ''}
  </div>`;
}
function wireOverviewFilterBar() {
  bindDateField('ovFilterFrom', 'ovFilterFromWrap', v => { overviewFilters.from = v; renderOverview(); });
  bindDateField('ovFilterTo', 'ovFilterToWrap', v => { overviewFilters.to = v; renderOverview(); });
  document.getElementById('ovFilterThisMonth')?.addEventListener('click', () => { Object.assign(overviewFilters, currentMonthBounds()); renderOverview(); });
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
  const rangeEvents = overviewFilteredEvents();
  const todayViews = allEvents.filter(e => e.type === 'page_view' && dayKey(eventTime(e)) === dayKey(now)).length;
  const rangeVisitors = uniqueBy(rangeEvents, e => e.visitorId).length;
  const allTimeVisitors = uniqueBy(allEvents, e => e.visitorId).length;
  const shareOfAllTime = allTimeVisitors ? Math.round(rangeVisitors / allTimeVisitors * 100) : 0;
  const onlineNow = uniqueBy(allEvents.filter(isOnlineNow), e => e.visitorId).length;

  const sessions = buildSessions(rangeEvents);
  const sessionCount = sessions.length;
  const withDuration = sessions.filter(s => s.duration > 0);
  const avgDuration = withDuration.length ? withDuration.reduce((s, x) => s + x.duration, 0) / withDuration.length : 0;
  const avgPagesPerSession = sessionCount ? (sessions.reduce((s, x) => s + x.pageViewCount, 0) / sessionCount).toFixed(1) : '0';
  const engagedCount = sessions.filter(s => s.engaged).length;
  const bounceRate = sessionCount ? Math.round((1 - engagedCount / sessionCount) * 100) : 0;
  const nr = newReturningSplit(rangeEvents);
  const newPct = nr.total ? Math.round(nr.newCount / nr.total * 100) : 0;

  const toMs = overviewFilters.to ? new Date(overviewFilters.to + 'T23:59:59').getTime() : now;
  const fromMs = overviewFilters.from ? new Date(overviewFilters.from + 'T00:00:00').getTime() : (toMs - 29 * 86400000);
  const rangeDays = Math.max(1, Math.min(366, Math.round((toMs - fromMs) / 86400000) + 1));
  const series = dailyUniqueVisitorSeries(rangeEvents, rangeDays, toMs);
  const seriesTotal = series.reduce((s, p) => s + p.value, 0);
  const tzGroups = groupCount(rangeEvents, e => e.timezone);
  const nrGroups = [{ label: 'New', value: nr.newCount }, { label: 'Returning', value: nr.returningCount }];
  const engagedGroups = [{ label: 'Engaged', value: engagedCount }, { label: 'Bounced', value: sessionCount - engagedCount }];

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Overview</h2></div>
    <p class="admin-section-sub">${esc(formatOverviewRangeLabel())}</p>
    ${overviewFilterBarHtml()}
    ${kpiRow([
      { icon: '👥', label: 'Visitors', value: fmt(rangeVisitors), sub: `${shareOfAllTime}% of all-time visitors`, color: '#6366f1', hint: 'Unique anonymous visitors (by device, not identity) with at least one page view in the selected range.' },
      { icon: '🟢', label: 'Online now', value: fmt(onlineNow), sub: 'active in the last ~1 min', color: '#10b981', hint: "Visitors with any recorded activity in the last ~1 minute - a rough 'who's here right now' signal, always live regardless of the range above." },
      { icon: '📦', label: 'Sessions', value: fmt(sessionCount), sub: `${avgPagesPerSession} pages / session`, color: '#3b82f6', hint: 'A session is one continuous visit. A new one starts whenever a visitor arrives after being away for a while.' },
      { icon: '✨', label: 'New visitors', value: newPct + '%', sub: `${100 - newPct}% returning`, color: '#a855f7', hint: 'Share of visitors in this range who have never had more than one session before, ever.' }
    ])}
    ${kpiRow([
      { icon: '⏱️', label: 'Avg. session duration', value: formatDuration(avgDuration), sub: 'time between first and last activity', color: '#fb923c', hint: 'Average time between the first and last recorded activity within a session.' },
      { icon: '↩️', label: 'Bounce rate', value: bounceRate + '%', sub: 'left without a 2nd page or ~25s+ stay', color: '#f43f5e', hint: 'Share of sessions that viewed only one page and didn’t stay long enough for a heartbeat (~25 seconds).' },
      { icon: '📄', label: 'Pages / session', value: avgPagesPerSession, sub: `${fmt(sessions.reduce((s, x) => s + x.pageViewCount, 0))} page views total`, color: '#14b8a6', hint: 'Average number of page views per session, across all sessions in this range.' },
      { icon: '👁️', label: 'Page views today', value: fmt(todayViews), sub: '', color: '#ec4899', hint: 'Page views recorded so far today, resetting at midnight in your browser’s local time - always literally today, regardless of the range above.' }
    ])}
    <div class="admin-grid-2">
      <div class="panel chart-panel spend-line-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Unique visitors per day', 'Distinct visitors per calendar day, across the selected range.')}
        ${seriesTotal > 0 ? svgSpendLine(series, { w: 900, h: 140 }) + `<div class="spend-line-caption"><span class="spend-line-num">${fmt(seriesTotal)}</span><span class="spend-line-label">total visits over this period</span></div>` : `<div class="chart-empty">No visits in this range.</div>`}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Top regions (by timezone)', 'Visitors grouped by their browser-reported timezone - the only geography signal collected here (no IP lookups, no third-party service).')}
        ${pieOrEmpty(tzGroups, 'No data yet.')}
      </div></div>
    </div>
    <div class="admin-grid-2">
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('New vs. returning visitors', 'New = never had more than one session before. Returning = has visited in a prior, separate session.')}
        ${sessionCount ? pieOrEmpty(nrGroups, 'No data yet.') : `<div class="chart-empty">No visits in this range.</div>`}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Engaged vs. bounced sessions', 'Engaged = viewed 2+ pages, or stayed long enough for a heartbeat (~25s+). Everything else counts as bounced.')}
        ${sessionCount ? pieOrEmpty(engagedGroups, 'No data yet.') : `<div class="chart-empty">No sessions in this range.</div>`}
      </div></div>
    </div>`;
  wireOverviewFilterBar();
  initFieldTips(el);
  requestAnimationFrame(() => {
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.spend-line-dot', { format: d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.val))} visitor${d.val == 1 ? '' : 's'}` });
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.val))} · ${parseFloat(d.pct || 0).toFixed(0)}%` });
    });
  });
}

function renderLive() {
  const el = document.getElementById('aview-live');
  const online = allEvents.filter(isOnlineNow);
  const onlineVisitors = uniqueBy(online, e => e.visitorId);
  const recent = allEvents.slice().sort((a, b) => eventTime(b) - eventTime(a)).slice(0, 30);

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Live</h2></div>
    <p class="admin-section-sub">Auto-refreshes every ${Math.round(ADMIN_POLL_MS / 1000)}s.</p>
    <div class="panel admin-live-hero">
      <div class="admin-live-dot${onlineVisitors.length ? '' : ' admin-live-dot--off'}"></div>
      <div><div class="admin-live-num">${fmt(onlineVisitors.length)}</div><div class="admin-live-label">online now</div></div>
    </div>
    <div class="panel"><div class="panel-inner-sm">
      ${panelTitle('Recent activity', 'The most recent events across the whole site, newest first - every event type shows up here as it happens.')}
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>When</th><th>Event</th><th>Tool</th><th>Region</th></tr></thead><tbody>
        ${recent.length ? recent.map(e => `<tr><td>${esc(relTime(eventTime(e)))}</td><td class="admin-table-strong">${esc(e.type)}</td><td>${esc(toolLabel(e.tool))}</td><td>${esc(e.timezone || '—')}</td></tr>`).join('') : `<tr class="admin-empty-row"><td colspan="4">No events yet.</td></tr>`}
      </tbody></table></div>
    </div></div>`;
  initFieldTips(el);
}

function renderTraffic() {
  const el = document.getElementById('aview-traffic');
  const events = filteredEvents();
  const views = events.filter(e => e.type === 'page_view');
  const days = filters.from || filters.to ? 90 : 30;
  const series = dailyUniqueVisitorSeries(events, days);
  const seriesTotal = series.reduce((s, p) => s + p.value, 0);
  const referrers = groupCount(views.map(e => ({ ...e, _ref: e.referrer ? (() => { try { return new URL(e.referrer).hostname; } catch (err) { return 'Other'; } })() : 'Direct' })), e => e._ref);
  const tzGroups = groupCount(events, e => e.timezone);
  const deviceGroups = groupCount(events, e => uaDevice(e.ua));
  const pages = groupCount(views, e => toolLabel(e.tool)).sort((a, b) => b.value - a.value);
  const sessions = buildSessions(events);
  const landingPages = groupCount(sessions.filter(s => s.landingPage), s => pageLabel(s.landingPage)).sort((a, b) => b.value - a.value);
  const exitPages = groupCount(sessions.filter(s => s.exitPage), s => pageLabel(s.exitPage)).sort((a, b) => b.value - a.value);

  const pageTableRows = (groups, emptyText) => groups.length
    ? groups.map(p => `<tr><td class="admin-table-strong">${esc(p.label)}</td><td>${fmt(p.value)}</td></tr>`).join('')
    : `<tr class="admin-empty-row"><td colspan="2">${esc(emptyText)}</td></tr>`;

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Traffic</h2></div>
    ${filterBarHtml()}
    <div class="admin-grid-2">
      <div class="panel chart-panel spend-line-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Unique visitors per day', 'Distinct visitors per calendar day. Shows the last 90 days once a date filter is set, otherwise the last 30.')}
        ${seriesTotal > 0 ? svgSpendLine(series, { w: 900, h: 140 }) + `<div class="spend-line-caption"><span class="spend-line-num">${fmt(seriesTotal)}</span><span class="spend-line-label">total visits over this period</span></div>` : `<div class="chart-empty">No visits in this range.</div>`}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Referrers', 'Which site sent each visitor here, grouped by domain. "Direct" means no referrer was recorded (typed URL, bookmark, or a privacy-blocked referrer).')}
        ${pieOrEmpty(referrers, 'No data yet.')}
      </div></div>
    </div>
    <div class="admin-grid-2">
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Regions (by timezone)', 'Visitors grouped by their browser-reported timezone - the only geography signal collected here.')}
        ${pieOrEmpty(tzGroups, 'No data yet.')}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Device type')}
        ${pieOrEmpty(deviceGroups, 'No data yet.')}
      </div></div>
    </div>
    <div class="admin-grid-2">
      <div class="panel"><div class="panel-inner-sm">
        ${panelTitle('Landing pages (where sessions start)', 'The first page viewed in each session - shows what visitors see first.')}
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Page</th><th>Sessions</th></tr></thead><tbody>
          ${pageTableRows(landingPages, 'No sessions in this range.')}
        </tbody></table></div>
      </div></div>
      <div class="panel"><div class="panel-inner-sm">
        ${panelTitle('Exit pages (where sessions end)', 'The last page viewed before a session went idle - shows where visitors tend to drop off.')}
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Page</th><th>Sessions</th></tr></thead><tbody>
          ${pageTableRows(exitPages, 'No sessions in this range.')}
        </tbody></table></div>
      </div></div>
    </div>
    <div class="panel"><div class="panel-inner-sm">
      ${panelTitle('Views by page', 'Total page-view events per page/tool in this range (not unique visitors - a repeat visit counts again).')}
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Page</th><th>Views</th></tr></thead><tbody>
        ${pageTableRows(pages, 'No data yet.')}
      </tbody></table></div>
    </div></div>`;
  wireFilterBar(renderTraffic);
  initFieldTips(el);
  requestAnimationFrame(() => {
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.spend-line-dot', { format: d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.val))} visitor${d.val == 1 ? '' : 's'}` });
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.val))} · ${parseFloat(d.pct || 0).toFixed(0)}%` });
    });
  });
}

function renderProduct() {
  const el = document.getElementById('aview-product');
  const events = filteredEvents();
  const codes = groupCount(events.filter(e => e.type === 'launch_code_redeemed'), e => (e.detail && e.detail.code) || 'Unknown');
  const themes = groupCount(events.filter(e => e.type === 'theme_changed'), e => (e.detail && e.detail.theme) || 'Unknown');
  const langs = groupCount(events.filter(e => e.type === 'language_changed'), e => (e.detail && e.detail.lang) || 'Unknown');
  const syncModes = groupCount(events.filter(e => e.type === 'sync_mode_chosen'), e => (e.detail && e.detail.mode) === 'google' ? 'Google Drive' : 'Local device');

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Product</h2></div>
    ${filterBarHtml()}
    <div class="admin-grid-2">
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Launch codes redeemed', 'Which specific license keys were redeemed in this range - see the Redemptions tab for the full list with order IDs.')}
        ${pieOrEmpty(codes, 'No codes redeemed in this range.')}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Theme popularity')}
        ${pieOrEmpty(themes, 'No theme changes in this range.')}
      </div></div>
    </div>
    <div class="admin-grid-2">
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Language')}
        ${pieOrEmpty(langs, 'No language changes in this range.')}
      </div></div>
      <div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">
        ${panelTitle('Sync mode chosen', 'Whether visitors chose to sync via Google Drive or keep their data local to the device, when prompted.')}
        ${pieOrEmpty(syncModes, 'No sync-mode choices in this range.')}
      </div></div>
    </div>`;
  wireFilterBar(renderProduct);
  initFieldTips(el);
  requestAnimationFrame(() => {
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.val))} · ${parseFloat(d.pct || 0).toFixed(0)}%` });
    });
  });
}

// ══════════════════════ App Insights (per-tool product signals) ══════════
// Deliberately all-time (not affected by the date filters used elsewhere) -
// this tab is about durable product-improvement signals, not a
// point-in-time traffic snapshot. Everything here is derived from usage/
// preference events already collected - no financial data is or ever will
// be part of this.
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayOfWeekCounts(events) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  events.forEach(e => { const t = eventTime(e); if (t) counts[new Date(t).getDay()]++; });
  const max = Math.max(1, ...counts);
  return DOW_LABELS.map((label, i) => ({ label, value: counts[i], pct: Math.round(counts[i] / max * 100) }));
}
function barRowsHtml(rows, opts) {
  if (!rows.some(r => r.value > 0)) return `<div class="chart-empty">No data yet.</div>`;
  const labelClass = opts && opts.wide ? 'admin-bar-row-label admin-bar-row-label--wide' : 'admin-bar-row-label';
  return rows.map(r => `<div class="admin-bar-row"><span class="${labelClass}">${esc(r.label)}</span><div class="admin-bar-row-track"><div class="admin-bar-row-fill" style="width:${r.pct}%"></div></div><span class="admin-bar-row-value">${fmt(r.value)}</span></div>`).join('');
}
// Converts {label,value} groups (no built-in ordering assumption) into bar
// rows scaled against the largest group, for use with barRowsHtml.
function toBarRows(groups) {
  const max = Math.max(1, ...groups.map(g => g.value));
  return groups.map(g => ({ label: g.label, value: g.value, pct: Math.round(g.value / max * 100) }));
}

// Human labels for the app-specific event `detail` fields captured by
// tab_viewed / feature_used / dashboard_layout_changed (script.js and
// ultimate-budget.js). Deliberately just display labels, not a validation
// allow-list - an unrecognized key still renders (falls back to itself)
// rather than silently disappearing if a future feature name is added.
const TAB_LABELS = {
  dashboard: 'Dashboard', transactions: 'Transactions', income: 'Income', expenses: 'Expenses',
  bills: 'Bills', debt: 'Debt Payoff', savings: 'Savings', budget: 'Budget',
  subscriptions: 'Subscriptions', sinking: 'Sinking Funds', calendar: 'Calendar'
};
const FEATURE_LABELS = {
  sample_data_loaded: 'Loaded sample data', csv_exported: 'Exported CSV',
  debt_added: 'Added a debt', sinking_fund_created: 'Created a sinking fund',
  subscription_added: 'Added a subscription', automation_enabled: 'Enabled automation',
  allocation_enabled: 'Enabled allocation'
};
const LAYOUT_LABELS = { '1': 'Classic', '2': 'Radial Pulse' };
function tabUsageGroups(events) {
  return groupCount(events.filter(e => e.type === 'tab_viewed'), e => TAB_LABELS[e.detail && e.detail.tab] || (e.detail && e.detail.tab) || 'Unknown');
}
function featureAdoptionGroups(events) {
  return groupCount(events.filter(e => e.type === 'feature_used'), e => FEATURE_LABELS[e.detail && e.detail.feature] || (e.detail && e.detail.feature) || 'Unknown');
}
function layoutGroups(events) {
  return groupCount(events.filter(e => e.type === 'dashboard_layout_changed'), e => LAYOUT_LABELS[String(e.detail && e.detail.layout)] || 'Unknown');
}

// Everything scoped to events that happened ON that tool's own page - this
// naturally captures theme/sync-mode preferences AS EXPRESSED WITHIN that
// tool, since those settings live on each tool's own page. The one
// exception is launch_code_redeemed, which always fires from the shared
// hub page (budgetplanner.html) regardless of which tool the code was FOR - so
// that one is matched by detail.tool instead of by page.
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
function getInsightsView() {
  const v = localStorage.getItem(INSIGHTS_VIEW_KEY);
  return v === 'sbp' || v === 'ubp' ? v : 'both';
}
function setInsightsView(v) { localStorage.setItem(INSIGHTS_VIEW_KEY, v); }

function insightsViewSelectorHtml() {
  const current = getInsightsView();
  const opts = [['both', 'Both'], ['sbp', 'Simple Budget'], ['ubp', 'Ultimate Budget']];
  return `
    ${panelTitle("Which budget planner's insights?")}
    <div class="admin-setting-hint" style="margin:-8px 0 12px">Choose which tool's App Insights section is on screen.</div>
    <div class="theme-setting-row"><div class="theme-pill" role="group">
      ${opts.map(([val, label]) => `<button class="theme-opt${val === current ? ' is-active' : ''}" data-insights-view="${val}" type="button">${esc(label)}</button>`).join('')}
    </div></div>`;
}
function wireInsightsViewSelector() {
  document.querySelectorAll('[data-insights-view]').forEach(btn => {
    btn.addEventListener('click', () => { setInsightsView(btn.dataset.insightsView); renderInsights(); });
  });
}

function insightCardHtml(id, d, color) {
  switch (id) {
    case 'funnel':
      return `<div class="panel" style="grid-column:1/-1"><div class="panel-inner-sm">
        ${panelTitle('Activation funnel', 'Of everyone who visited this tool, what share went on to redeem a license key for it.')}
        <div class="admin-funnel">
          <div class="admin-funnel-step"><div class="admin-funnel-step-value">${fmt(d.visitorCount)}</div><div class="admin-funnel-step-label">Visited</div></div>
          <div class="admin-funnel-arrow"><span class="admin-funnel-arrow-glyph">→</span><span class="admin-funnel-arrow-pct">${d.conversionPct}%</span></div>
          <div class="admin-funnel-step"><div class="admin-funnel-step-value">${fmt(d.redeemedFromVisitors)}</div><div class="admin-funnel-step-label">Redeemed a code</div></div>
        </div>
      </div></div>`;
    case 'tabUsage':
      return `<div class="panel"><div class="panel-inner-sm">${panelTitle('Section usage', 'Which tabs/sections within this tool get opened, and how often - shows what people actually use once inside.')}${barRowsHtml(toBarRows(d.tabGroups), { wide: true })}</div></div>`;
    case 'featureAdoption':
      return `<div class="panel"><div class="panel-inner-sm">${panelTitle('Feature adoption', 'How many times each specific feature (sample data, CSV export, adding a debt/fund/subscription, enabling automation, etc.) has been used.')}${barRowsHtml(toBarRows(d.featureGroups), { wide: true })}</div></div>`;
    case 'layoutPref':
      return `<div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">${panelTitle('Dashboard layout', 'Which dashboard layout (Classic vs. Radial Pulse) visitors have switched to.')}${pieOrEmpty(d.layoutGroups, 'No layout changes yet.')}</div></div>`;
    case 'syncMode':
      return `<div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">${panelTitle('Sync mode chosen')}${pieOrEmpty(d.syncGroups, 'No sync choices yet.')}</div></div>`;
    case 'theme':
      return `<div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">${panelTitle('Theme preference')}${pieOrEmpty(d.themeGroups, 'No theme changes yet.')}</div></div>`;
    case 'dow':
      return `<div class="panel"><div class="panel-inner-sm">${panelTitle('Busiest day of the week', 'Total events on this tool’s page, grouped by day of week (your local time).')}${barRowsHtml(d.dow)}</div></div>`;
    case 'device':
      return `<div class="panel chart-panel" data-chart-scope><div class="panel-inner-sm">${panelTitle('Device type')}${pieOrEmpty(d.deviceGroups, 'No data yet.')}</div></div>`;
    default: return '';
  }
}

function toolInsightsBlockHtml(tool, label, color) {
  const d = toolInsights(tool);
  return `
    <div class="admin-tool-section">
      <div class="admin-tool-section-title">
        <span class="admin-tool-badge" style="background:${color}22;color:${color}">${esc(label)}</span>
        <span style="font-size:13px;font-weight:600;color:var(--text-faint)">${fmt(d.visitorCount)} visitors · ${fmt(d.sessionCount)} sessions</span>
      </div>
      ${kpiRow([
        { icon: '⏱️', label: 'Avg. session duration', value: formatDuration(d.avgDuration), sub: 'first to last activity', color, hint: 'Average time between first and last activity, across sessions on this tool’s page.' },
        { icon: '↩️', label: 'Bounce rate', value: d.bounceRate + '%', sub: 'no 2nd page, no ~25s+ stay', color, hint: 'Share of sessions that viewed only one page and didn’t stay long enough for a heartbeat (~25s+).' },
        { icon: '🔁', label: 'Returning visitors', value: d.returningPct + '%', sub: `of ${fmt(d.visitorCount)} total visitors`, color, hint: 'Share of this tool’s visitors who have visited in more than one session, ever.' },
        { icon: '🔓', label: 'License key redemption rate', value: d.conversionPct + '%', sub: `${fmt(d.redeemedFromVisitors)} of ${fmt(d.visitorCount)} visitors`, color, hint: 'Share of this tool’s visitors who went on to redeem a license key for it.' }
      ])}
      <div class="admin-card-grid">${INSIGHT_CARD_DEFS.map(c => insightCardHtml(c.id, d, color)).join('')}</div>
    </div>`;
}

function renderInsights() {
  const el = document.getElementById('aview-insights');
  const sbpVisitors = new Set(allEvents.filter(e => e.page === 'sbp').map(e => e.visitorId));
  const ubpVisitors = new Set(allEvents.filter(e => e.page === 'ubp').map(e => e.visitorId));
  let bothCount = 0;
  sbpVisitors.forEach(v => { if (ubpVisitors.has(v)) bothCount++; });
  const totalToolVisitors = new Set([...sbpVisitors, ...ubpVisitors]).size;
  const bothPct = totalToolVisitors ? Math.round(bothCount / totalToolVisitors * 100) : 0;
  const view = getInsightsView();

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">App Insights</h2></div>
    <p class="admin-section-sub">Product-usage signals, split by tool - all-time data, not affected by the date filters on other tabs.</p>
    <div class="panel admin-insights-callout">
      <div class="admin-insights-callout-num">${bothPct}%</div>
      <div class="admin-insights-callout-text">of visitors who've used either tool have explored <strong>both</strong> Simple Budget and Ultimate Budget (${fmt(bothCount)} of ${fmt(totalToolVisitors)} tool visitors) - a read on how much cross-tool comparison / upsell interest exists.</div>
    </div>
    <div class="panel" style="margin-bottom:18px"><div class="panel-inner-sm">${insightsViewSelectorHtml()}</div></div>
    ${view !== 'ubp' ? toolInsightsBlockHtml('sbp', 'Simple Budget', '#6366f1') : ''}
    ${view !== 'sbp' ? toolInsightsBlockHtml('ubp', 'Ultimate Budget', '#a855f7') : ''}`;
  wireInsightsViewSelector();
  initFieldTips(el);
  requestAnimationFrame(() => {
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(d.val))} · ${parseFloat(d.pct || 0).toFixed(0)}%` });
    });
  });
}

// ══════════════════════ Redemptions (license key + order ID) ══════════════
// All-time, like App Insights - this is a standing record for the site
// owner to manually cross-reference against real orders and revoke access,
// not a point-in-time traffic snapshot. The order ID itself is never
// validated client-side (script.js only requires it be non-empty) - the
// whole point of this tab is to let a human eyeball it.
function redemptionEvents() { return allEvents.filter(e => e.type === 'launch_code_redeemed'); }
function redemptionRows() {
  const events = redemptionEvents();
  // Flags order IDs reused across more than one visitor - a strong signal
  // someone is sharing/reusing a single real order ID with an invalid code,
  // even though no format validation could ever catch that on its own.
  const byOrderId = new Map();
  events.forEach(e => {
    const oid = (e.detail && e.detail.orderId) || '';
    if (!oid) return;
    if (!byOrderId.has(oid)) byOrderId.set(oid, new Set());
    byOrderId.get(oid).add(e.visitorId);
  });
  return events.map(e => {
    const orderId = (e.detail && e.detail.orderId) || '';
    const reuseCount = orderId ? byOrderId.get(orderId).size : 0;
    return {
      when: eventTime(e), code: (e.detail && e.detail.code) || '', tool: (e.detail && e.detail.tool) || '',
      orderId, visitorId: e.visitorId, timezone: e.timezone, reused: reuseCount > 1, reuseCount
    };
  }).sort((a, b) => b.when - a.when);
}
function filteredRedemptionRows() {
  const q = redemptionFilters.q.trim().toLowerCase();
  return redemptionRows().filter(r => {
    if (redemptionFilters.tool && r.tool !== redemptionFilters.tool) return false;
    if (redemptionFilters.onlyReused && !r.reused) return false;
    if (q && !(r.orderId.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.visitorId.toLowerCase().includes(q))) return false;
    return true;
  });
}
function redemptionSearchBarHtml() {
  const hasFilters = redemptionFilters.q || redemptionFilters.tool || redemptionFilters.onlyReused;
  return `<div class="admin-filter-bar">
    <input type="text" id="admRedemptionSearch" placeholder="Search order ID, code, or visitor..." value="${esc(redemptionFilters.q)}" aria-label="Search redemptions">
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
function redemptionsTableHtml(rows) {
  const head = `<tr><th>When</th><th>Order ID</th><th>License Key</th><th>Tool</th><th>Visitor</th><th>Region</th></tr>`;
  if (!rows.length) return `<div class="admin-table-wrap"><table class="admin-table"><thead>${head}</thead><tbody><tr class="admin-empty-row"><td colspan="6">No redemptions match.</td></tr></tbody></table></div>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead>${head}</thead><tbody>
    ${rows.map(r => `<tr>
      <td>${esc(relTime(r.when))}</td>
      <td class="admin-table-strong">${r.orderId ? esc(r.orderId) : '<span class="admin-table-muted">—</span>'}${r.reused ? ` <span class="admin-reuse-badge" title="This order ID was entered by ${r.reuseCount} different visitors">⚠ ×${r.reuseCount}</span>` : ''}</td>
      <td>${esc(r.code)}</td>
      <td>${esc(toolLabel(r.tool))}</td>
      <td>${esc(r.visitorId.slice(0, 8))}</td>
      <td>${esc(r.timezone || '—')}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}
function renderRedemptions() {
  const el = document.getElementById('aview-redemptions');
  const allRows = redemptionRows();
  const rows = filteredRedemptionRows();
  const withOrderId = allRows.filter(r => r.orderId);
  const uniqueOrderIds = uniqueBy(withOrderId, r => r.orderId).length;
  const uniqueRedeemers = uniqueBy(allRows, r => r.visitorId).length;
  const reusedOrderIds = uniqueBy(allRows.filter(r => r.reused), r => r.orderId).length;

  el.innerHTML = `
    <div class="section-header"><h2 class="admin-section-title">Redemptions</h2></div>
    <p class="admin-section-sub">Every license key redemption with the order ID the visitor entered - all-time, not affected by date filters on other tabs. Use this to spot entries that don't match a real order and revoke access.</p>
    ${kpiRow([
      { icon: '🔑', label: 'Total redemptions', value: fmt(allRows.length), sub: '', color: '#6366f1', hint: 'Every successful code + order ID submission. A visitor testing multiple codes counts more than once.' },
      { icon: '🧾', label: 'Unique order IDs', value: fmt(uniqueOrderIds), sub: '', color: '#14b8a6', hint: 'Distinct order IDs seen across all redemptions. Order IDs are never format-checked - this is a raw count of whatever was typed.' },
      { icon: '👤', label: 'Unique redeemers', value: fmt(uniqueRedeemers), sub: 'distinct visitors who redeemed', color: '#3b82f6', hint: 'Distinct visitors (by anonymous device ID) who successfully redeemed at least one code.' },
      { icon: '⚠️', label: 'Reused order IDs', value: fmt(reusedOrderIds), sub: 'same order ID, different visitors', color: '#f43f5e', hint: 'Order IDs entered by more than one different visitor - the strongest signal here that something is worth investigating, since a real order ID should only ever be used once.' }
    ])}
    ${redemptionSearchBarHtml()}
    <div class="panel"><div class="panel-inner-sm">
      ${redemptionsTableHtml(rows)}
    </div></div>`;
  wireRedemptionFilters();
  initFieldTips(el);
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
  const CODES_SBP = ['0SCL1', '0SCD2', '0SCS3', '0SRD7'];
  const CODES_UBP = ['1UCL1', '1UCD2', '1URS8'];
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
        <div class="admin-setting-row"><div><div class="admin-setting-label">Auto-refresh</div><div class="admin-setting-hint">Every ${Math.round(ADMIN_POLL_MS / 1000)}s while the Live tab is open</div></div></div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        ${sampleDataSectionHtml()}
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
  wireSampleDataSection();
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

const ADMIN_RENDERERS = { overview: renderOverview, live: renderLive, traffic: renderTraffic, product: renderProduct, insights: renderInsights, redemptions: renderRedemptions, settings: renderSettings, summary: renderSummary };
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
    try { allEvents = await adminFetchEvents(_adminAccessToken); _lastFetched = Date.now(); (ADMIN_RENDERERS[currentATab] || renderOverview)(); }
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
