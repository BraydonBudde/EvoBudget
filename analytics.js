// ══════════════════════════════════════════════════════════════════════
// EzzoBudget Analytics — anonymous, aggregate site-usage tracking only.
// Loaded by budgetplanner.html, ultimate-budget.html, and home.html. Never sees
// or sends any financial data (transactions, budgets, balances, category
// amounts) - those stay exactly as private as they've always been,
// client-side / the user's own Drive only. This file only ever reports:
// which page/tool was opened, a few non-identifying UI preference
// changes, and a lightweight "is someone here" heartbeat.
//
// Fill these in after deploying Code.gs as an Apps Script Web App (see
// the setup checklist) - until ANALYTICS_ENDPOINT is set, every call is a
// silent no-op, so the app works identically with or without it.
// ══════════════════════════════════════════════════════════════════════
const ANALYTICS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec';
const ANALYTICS_APP_KEY = 'EVOBUDGETANALYTICS';  // must match APP_KEY in Code.gs

const ANALYTICS_VID_KEY = 'evobudget_analytics_vid';
const ANALYTICS_SID_KEY = 'evobudget_analytics_sid';
// How often a "still here" heartbeat fires while the tab is visible - the
// admin dashboard's "online now" count is just "any event within the
// last ~60s" (ADMIN_ONLINE_WINDOW_MS in admin.js), so this interval has
// to comfortably beat that window.
const HEARTBEAT_MS = 25000;

function _analyticsUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
// Anonymous, random, never tied to any personal identity, sync email, or
// budget data - purely lets the dashboard distinguish "3 events from 1
// visitor" from "3 events from 3 visitors".
function _analyticsVisitorId() {
  try {
    let id = localStorage.getItem(ANALYTICS_VID_KEY);
    if (!id) { id = _analyticsUid(); localStorage.setItem(ANALYTICS_VID_KEY, id); }
    return id;
  } catch (e) { return 'unknown'; }
}
function _analyticsSessionId() {
  try {
    let id = sessionStorage.getItem(ANALYTICS_SID_KEY);
    if (!id) { id = _analyticsUid(); sessionStorage.setItem(ANALYTICS_SID_KEY, id); }
    return id;
  } catch (e) { return 'unknown'; }
}
// Set once the visitor actually opens a planner, so in-app activity can be
// told apart from browsing the site. Without it everything on
// budgetplanner.html looks identical, since the hub and the planner are two
// views of one page - and the dashboard's store metrics would count someone
// budgeting for an hour as an hour of website browsing.
let _analyticsPageOverride = null;
function analyticsSetPage(page) { _analyticsPageOverride = page || null; }

function _analyticsPage() {
  if (_analyticsPageOverride) return _analyticsPageOverride;
  const p = location.pathname.toLowerCase();
  if (p.includes('ultimate-budget')) return 'ubp';
  if (p.includes('claim')) return 'claim';
  if (p.includes('privacy') || p.includes('terms') || p.includes('disclaimer')) return 'legal';
  if (p.includes('budgetplanner')) return 'budgetplanner';
  // "/" serves home.html, so anything left unmatched is the marketing site.
  // This used to fall through to 'sbp', which quietly filed every homepage
  // visit as planner usage.
  return 'home';
}
function _analyticsTool() {
  const p = _analyticsPage();
  return (p === 'sbp' || p === 'ubp') ? p : '';
}

// Fires an event. Silent no-op if the endpoint isn't configured yet, and
// never throws or blocks the caller - a failed/slow analytics call must
// never be able to affect the app itself.
function trackEvent(type, detail) {
  if (!ANALYTICS_ENDPOINT) return;
  try {
    const payload = {
      appKey: ANALYTICS_APP_KEY,
      type,
      visitorId: _analyticsVisitorId(),
      sessionId: _analyticsSessionId(),
      page: _analyticsPage(),
      tool: _analyticsTool(),
      // Free, always-available, zero network calls, zero third-party
      // dependency - the only geography signal this app collects.
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      referrer: (document.referrer || '').slice(0, 256),
      ua: (navigator.userAgent || '').slice(0, 256),
      lang: (navigator.language || '').slice(0, 16),
      detail: detail || {},
      clientTs: new Date().toISOString()
    };
    const body = JSON.stringify(payload);
    // text/plain (not application/json) is a deliberate choice - see the
    // CORS explanation in Code.gs. sendBeacon is preferred: purpose-built
    // for fire-and-forget delivery that survives page unload, and never
    // blocks navigation. Nothing ever reads the response either way.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    } else if (typeof fetch === 'function') {
      fetch(ANALYTICS_ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body }).catch(() => {});
    }
  } catch (e) { /* analytics must never break the app */ }
}

(function initAnalytics() {
  trackEvent('session_start');
  trackEvent('page_view');
  let heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => trackEvent('heartbeat'), HEARTBEAT_MS);
  }
  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  // Only counts as "online" while the tab is actually visible - a
  // backgrounded/minimized tab shouldn't inflate the live "online now"
  // count on the dashboard.
  if (document.visibilityState === 'visible') startHeartbeat();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { trackEvent('heartbeat'); startHeartbeat(); }
    else stopHeartbeat();
  });
  window.addEventListener('pagehide', () => trackEvent('session_end'));
})();
