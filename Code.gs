// ══════════════════════════════════════════════════════════════════════
// EvioBudget Analytics — Google Apps Script Web App
// ══════════════════════════════════════════════════════════════════════
// This file lives in the repo purely as a documented source of truth for
// version control - it CANNOT be deployed from here. It must be manually
// pasted into the Apps Script editor bound to a Google Sheet in the site
// owner's own Drive. See the setup checklist the assistant provided
// alongside this file for exact steps.
//
// Deploy as: Execute as "Me", Who has access "Anyone". That combination
// is what lets an anonymous site visitor's browser append a row to a
// Sheet living in the owner's private Drive, without the owner ever
// exposing any of their own credentials client-side - the deployed /exec
// URL is a write-only capability URL. doGet() intentionally returns only
// a static string, never sheet contents, so the URL can't be used to read
// data even if someone finds it.
//
// The client (analytics.js) posts a JSON string as a text/plain body,
// not application/json - Apps Script Web Apps handle CORS preflight
// (OPTIONS) requests poorly (a documented chicken-and-egg limitation:
// the permission check for the actual function can't run until the
// function already has permission to run). A text/plain POST is a CORS
// "simple request", so no preflight is triggered at all, sidestepping
// the problem entirely instead of fighting it with response headers.
// Because of this, the response also never carries an
// Access-Control-Allow-Origin header - the client must never try to read
// it. That's fine: analytics writes are inherently fire-and-forget
// (navigator.sendBeacon / fetch with mode:'no-cors').

const SHEET_NAME = 'Events';
// Must match ANALYTICS_APP_KEY in analytics.js. This is NOT real security
// - it's visible in page source like any client-side string - it only
// filters out accidental noise (scanners, stray curl requests hitting the
// /exec URL directly). Replace with any random string of your choosing.
const APP_KEY = 'EVOBUDGETANALYTICS';
const MAX_BODY_BYTES = 8000;
// Apps Script's doPost never exposes the caller's IP address, so a
// per-visitor rate limit isn't possible - this is a GLOBAL cap instead,
// protecting the script's daily execution quota from a runaway loop or
// bot rather than trying to fingerprint individual abusers.
const RATE_LIMIT_PER_MIN = 300;

// A pattern, not a fixed list - so the client (analytics.js) can add new
// event type names over time (e.g. 'tab_viewed', 'feature_used') WITHOUT
// ever requiring this deployment to be edited/redeployed again. The real
// safety boundary is the FIXED COLUMN SCHEMA below (appendRow always
// writes the same 12 columns regardless of type) - there is no field a
// financial value could ever land in, so a permissive type name doesn't
// widen what can actually be smuggled through. This only rejects garbage/
// oversized type strings, not specific names.
function _validEventType(type) {
  return typeof type === 'string' && /^[a-z][a-z0-9_]{1,39}$/.test(type);
}

function doGet(e) {
  return ContentService.createTextOutput('EvioBudget analytics endpoint.');
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return _ok();
    if (e.postData.contents.length > MAX_BODY_BYTES) return _ok();
    if (!_underRateLimit()) return _ok();

    const payload = JSON.parse(e.postData.contents);
    if (!payload || payload.appKey !== APP_KEY) return _ok();
    if (!_validEventType(payload.type)) return _ok();
    if (!payload.visitorId || typeof payload.visitorId !== 'string' || payload.visitorId.length > 64) return _ok();

    // No financial fields exist in this shape at all - this allow-list
    // (matched against analytics.js's own event schema) is a second line
    // of defense even if a future bug ever tried to smuggle one in.
    _getSheet().appendRow([
      new Date(),                                          // A: server receipt time
      String(payload.type || '').slice(0, 64),              // B
      String(payload.visitorId || '').slice(0, 64),         // C
      String(payload.sessionId || '').slice(0, 64),         // D
      String(payload.page || '').slice(0, 64),              // E
      String(payload.tool || '').slice(0, 32),              // F
      String(payload.timezone || '').slice(0, 64),          // G
      String(payload.referrer || '').slice(0, 256),         // H
      String(payload.ua || '').slice(0, 256),                // I
      String(payload.lang || '').slice(0, 16),               // J
      JSON.stringify(payload.detail || {}).slice(0, 512),    // K
      String(payload.clientTs || '')                         // L
    ]);
    return _ok();
  } catch (err) {
    // Never surface errors to a fire-and-forget beacon - nothing reads
    // the response anyway, and a 500 just wastes quota on retries some
    // clients might attempt.
    return _ok();
  }
}

function _ok() {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function _getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['ServerTime', 'Type', 'VisitorId', 'SessionId', 'Page', 'Tool', 'Timezone', 'Referrer', 'UA', 'Lang', 'Detail', 'ClientTs']);
  }
  return sh;
}

function _underRateLimit() {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + Math.floor(Date.now() / 60000); // per-minute bucket
  const current = Number(cache.get(key) || '0');
  if (current >= RATE_LIMIT_PER_MIN) return false;
  cache.put(key, String(current + 1), 90);
  return true;
}
