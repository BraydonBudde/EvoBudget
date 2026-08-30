// ══════════════════════════════════════════════════════════════════════
// EzzoBudget Analytics — Google Apps Script Web App
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

// GET is used for the Etsy key system (claim + validate). Those need to READ
// a response cross-origin, which a POST here can't do: Apps Script can't set
// Access-Control-Allow-Origin, so a normal fetch could never read the reply.
// JSONP sidesteps that entirely - the browser loads this as a <script>, and
// script tags aren't subject to CORS. Analytics keeps using doPost and is
// completely untouched by any of this.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'claim')    return _jsonp(p.cb, _handleClaim(p));
  if (p.action === 'validate') return _jsonp(p.cb, _handleValidate(p));
  if (p.action === 'sales')    return _jsonp(p.cb, _handleSales(p));
  return ContentService.createTextOutput('EzzoBudget analytics endpoint.');
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

// ══════════════════════════════════════════════════════════════════════
// ETSY KEY SYSTEM
// ══════════════════════════════════════════════════════════════════════
// Etsy has no way to hand a buyer a unique key, so buyers are sent to
// /claim on the site with a per-listing link. They enter their Etsy order
// number + the email on the order, and get one unique key back. The same
// order always returns the SAME key, so a buyer can recover theirs and
// can't farm extras.
//
// The style (tool/theme/layout) comes from an opaque token in the claim
// link rather than plain URL text, so someone holding an SBP link can't
// simply edit it into a UBP one - they'd need the UBP listing's own link,
// which only UBP buyers are given.
//
// These sheets are created automatically on first use. Styles must then
// be filled in (see the setup notes provided alongside this file).
const STYLES_SHEET = 'Styles';
const KEYS_SHEET = 'Keys';
// How many distinct browsers one key may unlock. Counted by the visitor id
// analytics already stores per browser. Generous enough for one person's
// real devices, tight enough that a publicly posted key dies quickly.
const KEY_DEVICE_LIMIT = 5;
// Claims are far rarer than analytics beacons, so they get their own much
// tighter bucket - this is what slows anyone trying to guess order numbers.
const CLAIM_LIMIT_PER_MIN = 20;

function _jsonp(cb, obj) {
  // Only ever emit a callback name we control the shape of - an unfiltered
  // one would let a crafted URL execute arbitrary script on whoever opened
  // it. Anything unexpected falls back to a fixed name.
  const safe = (typeof cb === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(cb)) ? cb : 'ezzoCb';
  return ContentService
    .createTextOutput(safe + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function _normEmail(v) { return String(v || '').trim().toLowerCase().slice(0, 120); }
function _normOrder(v) { return String(v || '').trim().replace(/\s+/g, '').slice(0, 32); }
function _looksLikeEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
// Etsy receipt numbers are numeric. Kept loose on length so a format change
// on their side doesn't lock out real buyers.
function _looksLikeOrder(v) { return /^[0-9]{6,20}$/.test(v); }

function _sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); }
  return sh;
}
function _stylesSheet() { return _sheet(STYLES_SHEET, ['Token', 'Tool', 'Theme', 'Layout', 'Label', 'Active']); }
function _keysSheet()   { return _sheet(KEYS_SHEET, ['Key', 'Tool', 'Theme', 'Layout', 'OrderId', 'Email', 'IssuedAt', 'Status', 'Devices', 'RedeemCount', 'LastRedeemedAt']); }

// ETSY-5FDE-43A8-8477-4228A671F027: a v4 UUID with its first block replaced,
// so keys are visually consistent with the Lemon Squeezy ones buyers of the
// same product might also hold, while still being obviously Etsy in origin.
function _generateKey() {
  const parts = Utilities.getUuid().toUpperCase().split('-');
  parts[0] = 'ETSY';
  return parts.join('-');
}

function _claimRateOk() {
  const cache = CacheService.getScriptCache();
  const k = 'cl_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(k) || '0');
  if (n >= CLAIM_LIMIT_PER_MIN) return false;
  cache.put(k, String(n + 1), 90);
  return true;
}

function _handleClaim(p) {
  try {
    if (!_claimRateOk()) return { ok: false, error: 'busy' };

    const token = String(p.k || '').trim().slice(0, 64);
    const order = _normOrder(p.order);
    const email = _normEmail(p.email);
    if (!token) return { ok: false, error: 'bad_link' };
    if (!_looksLikeOrder(order)) return { ok: false, error: 'bad_order' };
    if (!_looksLikeEmail(email)) return { ok: false, error: 'bad_email' };

    // Serialised: two buyers claiming at the same moment must not be able to
    // both pass the "already claimed?" check and append duplicate rows.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
    try {
      const styles = _stylesSheet().getDataRange().getValues();
      let style = null;
      for (let i = 1; i < styles.length; i++) {
        if (String(styles[i][0]).trim() === token) {
          if (String(styles[i][5]).trim().toLowerCase() === 'no') return { ok: false, error: 'bad_link' };
          style = { tool: String(styles[i][1]).trim(), theme: String(styles[i][2]).trim(), layout: String(styles[i][3]).trim(), label: String(styles[i][4]).trim() };
          break;
        }
      }
      if (!style) return { ok: false, error: 'bad_link' };

      const sh = _keysSheet();
      const rows = sh.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (_normOrder(rows[i][4]) === order) {
          // Same buyer coming back for a key they lost: hand back the very
          // same one. A different email on a known order is someone who
          // shouldn't have it, so it gets nothing.
          if (_normEmail(rows[i][5]) !== email) return { ok: false, error: 'order_taken' };
          return { ok: true, key: String(rows[i][0]), tool: String(rows[i][1]), theme: String(rows[i][2]), layout: String(rows[i][3]), label: style.label, reissued: true };
        }
      }

      const key = _generateKey();
      sh.appendRow([key, style.tool, style.theme, style.layout, order, email, new Date(), 'active', '[]', 0, '']);
      return { ok: true, key: key, tool: style.tool, theme: style.theme, layout: style.layout, label: style.label, reissued: false };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

function _handleValidate(p) {
  try {
    if (!_underRateLimit()) return { ok: false, error: 'busy' };
    const key = String(p.key || '').trim().toUpperCase().slice(0, 64);
    const vid = String(p.vid || '').trim().slice(0, 64);
    if (!key) return { ok: false, error: 'not_found' };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
    try {
      const sh = _keysSheet();
      const rows = sh.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim().toUpperCase() !== key) continue;
        if (String(rows[i][7]).trim().toLowerCase() === 'revoked') return { ok: false, error: 'revoked' };

        let devices = [];
        try { devices = JSON.parse(rows[i][8] || '[]'); } catch (e) { devices = []; }
        if (!Array.isArray(devices)) devices = [];

        const known = vid && devices.indexOf(vid) !== -1;
        // An unlock the buyer already has must never start failing, so a
        // device that's used this key before is always let through, even
        // once the limit is reached.
        if (!known) {
          if (devices.length >= KEY_DEVICE_LIMIT) return { ok: false, error: 'device_limit' };
          if (vid) devices.push(vid);
        }

        const rowNum = i + 1;
        sh.getRange(rowNum, 9).setValue(JSON.stringify(devices));
        sh.getRange(rowNum, 10).setValue(Number(rows[i][9] || 0) + 1);
        sh.getRange(rowNum, 11).setValue(new Date());

        // The order id goes back with the result so the app can attach it to
        // its redemption event. That's what lets the dashboard keep showing
        // an order per redemption now that buyers no longer type one in.
        return { ok: true, tool: String(rows[i][1]), theme: String(rows[i][2]), layout: String(rows[i][3]), orderId: String(rows[i][4] || '') };
      }
      return { ok: false, error: 'not_found' };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

// ══════════════════════════════════════════════════════════════════════
// LEMON SQUEEZY SALES (read-only proxy)
// ══════════════════════════════════════════════════════════════════════
// The dashboard is a static page on a public repo, so it can never hold a
// Lemon Squeezy API key itself - anyone could read it and pull the store's
// order history. The key lives in this script's Properties instead, where
// only the deployment can reach it, and the dashboard just asks for the
// aggregate it needs. Nothing here can create, refund or modify anything:
// it only ever reads orders.
//
// SETUP (one time):
//   Apps Script editor -> Project Settings (gear) -> Script Properties
//   -> Add script property:  LEMONSQUEEZY_API_KEY = <your key>
//   Create the key at Lemon Squeezy -> Settings -> API.
// Without it this returns configured:false and the dashboard falls back to
// counting redemptions, rather than showing a broken card.
//
// A short cache is deliberate: the dashboard polls, and Lemon Squeezy's
// rate limits are far tighter than the poll interval.
const LS_CACHE_SECONDS = 300;

function _handleSales(p) {
  try {
    const key = PropertiesService.getScriptProperties().getProperty('LEMONSQUEEZY_API_KEY');
    if (!key) return { ok: true, configured: false, revenue: 0, orders: 0 };

    // from/to are ISO dates (YYYY-MM-DD) from the dashboard's date range.
    const from = String(p.from || '').slice(0, 10);
    const to   = String(p.to || '').slice(0, 10);
    const cacheKey = 'ls_' + from + '_' + to;
    const cache = CacheService.getScriptCache();
    const hit = cache.get(cacheKey);
    if (hit) { const c = JSON.parse(hit); c.cached = true; return c; }

    const fromMs = from ? new Date(from + 'T00:00:00Z').getTime() : 0;
    // Inclusive of the whole end day, matching how the dashboard's own date
    // range reads to a human ("1st to 5th" includes all of the 5th).
    const toMs = to ? new Date(to + 'T23:59:59Z').getTime() : Date.now();

    let revenue = 0, orders = 0, refunded = 0, testOrders = 0;
    let url = 'https://api.lemonsqueezy.com/v1/orders?page[size]=100&sort=-createdAt';
    // Bounded rather than "while there are pages": a store with a long
    // history would otherwise blow the script's execution time limit.
    for (var page = 0; page < 10 && url; page++) {
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Accept': 'application/vnd.api+json', 'Authorization': 'Bearer ' + key },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) {
        return { ok: false, error: 'lemonsqueezy_' + res.getResponseCode() };
      }
      const body = JSON.parse(res.getContentText());
      const rows = body.data || [];
      let oldestOnPage = Infinity;

      for (var i = 0; i < rows.length; i++) {
        const a = rows[i].attributes || {};
        const created = new Date(a.created_at).getTime();
        if (created < oldestOnPage) oldestOnPage = created;
        if (created < fromMs || created > toMs) continue;
        if (a.status === 'refunded') { refunded++; continue; }
        // A test-mode API key returns test orders that look identical to
        // real ones. Counting them is fine while trying the setup out, but
        // the dashboard has to be able to say so - otherwise a key left on
        // test would quietly present play money as revenue.
        if (a.test_mode === true) testOrders++;
        // total is in cents, and already excludes tax handled by Lemon
        // Squeezy as merchant of record.
        revenue += Number(a.total || 0);
        orders++;
      }

      // Sorted newest first, so once a page ends older than the window
      // there's nothing left worth paging for.
      if (oldestOnPage < fromMs) break;
      url = (body.links && body.links.next) || '';
    }

    const out = { ok: true, configured: true, revenue: revenue / 100, orders: orders, refunded: refunded, testMode: testOrders > 0 && testOrders === orders };
    cache.put(cacheKey, JSON.stringify(out), LS_CACHE_SECONDS);
    return out;
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}
