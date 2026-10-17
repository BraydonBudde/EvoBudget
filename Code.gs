// ══════════════════════════════════════════════════════════════════════
// EzzoBudget Analytics: Google Apps Script Web App
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
  if (p.action === 'code')     return _jsonp(p.cb, _handleCode(p));
  if (p.action === 'notify')   return _jsonp(p.cb, _handleNotify(p));
  if (p.action === 'sales')    return _jsonp(p.cb, _handleSales(p));
  if (p.action === 'lsrevoke') return _jsonp(p.cb, _handleLsRevoke(p));
  if (p.action === 'posts')    return _jsonp(p.cb, _handleBlogPosts(p));
  if (String(p.action || '').indexOf('aff_') === 0) return _jsonp(p.cb, _handleAffiliate(p));
  return ContentService.createTextOutput('EzzoBudget analytics endpoint.');
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return _ok();
    // Lemon Squeezy's webhook is the only POST that carries ?wh=, and its
    // payloads are far larger than the analytics cap below allows.
    if (e.parameter && e.parameter.wh) return _handleLsWebhook(e);
    // Dodo Payments' webhook carries ?dwh= the same way.
    if (e.parameter && e.parameter.dwh) return _handleDodoWebhook(e);
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
    if (Math.random() < PRUNE_CHANCE) _pruneEvents();
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
const BLOGS_SHEET = 'Blogs';
const BLOG_CACHE_SECONDS = 300;
// How many distinct browsers one key may unlock. Counted by the visitor id
// analytics already stores per browser. Generous enough for one person's
// real devices, tight enough that a publicly posted key dies quickly.
const KEY_DEVICE_LIMIT = 3;
// Claims are far rarer than analytics beacons, so they get their own much
// tighter bucket - this is what slows anyone trying to guess order numbers.
const CLAIM_LIMIT_PER_MIN = 20;
// Launch codes used to be a hardcoded list inside script.js, which meant
// anyone could read all 20 out of the public bundle and unlock either
// planner for nothing. They live here now, so they can be rotated and
// switched off without a redeploy, and are never sent to the browser.
const CODES_SHEET = 'Codes';
// The "notify me" form used to write to localStorage and stop there, so
// nobody was ever actually told when a tool launched. These are the
// addresses it collects.
const NOTIFY_SHEET = 'Notify';
const NOTIFY_LIMIT_PER_MIN = 20;
// Lemon Squeezy posts here when something is bought or refunded. Orders are
// recorded and a push is sent, so a sale makes a noise on the owner's phone
// rather than waiting to be noticed.
const SALES_SHEET = 'Sales';
// Order payloads are a good deal bigger than an analytics beacon.
const WEBHOOK_MAX_BODY_BYTES = 120000;
// Redemptions must not be starved by analytics traffic, so validation gets
// its own bucket rather than sharing the global one. A buyer being told
// "busy" because the site is having a good day is the worst possible bug.
const VALIDATE_LIMIT_PER_MIN = 60;

// ── Events housekeeping ───────────────────────────────────────────────
// The Events sheet shares a spreadsheet with Keys, and a spreadsheet dies
// at 10M cells. Left alone, analytics would eventually take the licence
// system down with it. Trimmed by age first, then by row count, oldest
// first, in a single deleteRows call.
const EVENTS_MAX_ROWS = 40000;
const EVENTS_MAX_AGE_DAYS = 120;
// Checking every request would waste quota, so housekeeping runs on a
// small fraction of them and at most once an hour.
const PRUNE_CHANCE = 0.02;
const PRUNE_MIN_INTERVAL_MS = 3600000;

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
// Stricter than it looks like it needs to be, because this address is
// bound to the order permanently: a typo cannot be corrected afterwards,
// the second attempt is refused as already claimed. Rejects consecutive or
// edge dots, bare hostnames with no dot, and single-character or numeric
// top level domains, all of which the old pattern let through.
function _looksLikeEmail(v) {
  if (!v || v.length > 120 || /\s/.test(v)) return false;
  const parts = String(v).split('@');
  if (parts.length !== 2) return false;
  const local = parts[0], domain = parts[1];
  if (!local || local.length > 64 || /^\.|\.$|\.\./.test(local)) return false;
  if (!domain || domain.length > 253 || /^[.-]|[.-]$|\.\./.test(domain)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (var i = 0; i < labels.length; i++) {
    if (!/^[A-Za-z0-9-]+$/.test(labels[i])) return false;
  }
  return /^[A-Za-z]{2,}$/.test(labels[labels.length - 1]);
}
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
function _blogsSheet()  { return _sheet(BLOGS_SHEET, ['Slug', 'Title', 'Excerpt', 'Category', 'Tool', 'Tags', 'Date', 'ReadMinutes', 'Image', 'ImageAlt', 'Body', 'Related', 'Status', 'Updated']); }
function _notifySheet() { return _sheet(NOTIFY_SHEET, ['Timestamp', 'Email', 'Tool', 'Source', 'VisitorId']); }
function _salesSheet() {
  const headers = ['Timestamp', 'Event', 'OrderId', 'Email', 'Name', 'Product',
                   'Variant', 'Total', 'Currency', 'TestMode', 'Status', 'OrderNumber',
                   'Discount', 'Affiliate', 'Gross'];
  const sh = _sheet(SALES_SHEET, headers);
  // Earlier versions of this sheet stopped at column K, then L. Add any
  // missing headers rather than making anyone recreate the sheet by hand.
  const have = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var c = 11; c < headers.length; c++) {
    if (String(have[c]).trim() !== headers[c]) sh.getRange(1, c + 1).setValue(headers[c]);
  }
  return sh;
}

// Starts empty. The twenty codes that used to be hardcoded in script.js
// were readable by anyone who opened it, so they are retired rather than
// carried over: with no rows here, every one of them is refused.
//
// To issue a promotional code, add a row: Code, Tool ("sbp"/"ubp"), Theme,
// Layout (1 classic, 2 radial), Active ("yes"). Make it long - the old
// five-character ones were guessable even before they leaked. Setting
// Active to "no" retires a code without deleting the record of it.
//
// Retiring a code never affects anyone who already redeemed it.
function _codesSheet() {
  return _sheet(CODES_SHEET, ['Code', 'Tool', 'Theme', 'Layout', 'Active']);
}

// Keeps the Events sheet from growing until it takes the spreadsheet, and
// the licence system with it, down. Oldest rows go first.
function _pruneEvents() {
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('lastPrune') || '0');
    if (Date.now() - last < PRUNE_MIN_INTERVAL_MS) return;
    props.setProperty('lastPrune', String(Date.now()));

    const sh = _getSheet();
    const lastRow = sh.getLastRow();
    if (lastRow <= 2) return;

    let dropTo = 0;   // number of data rows to remove from the top

    // Age first: anything past the window is gone regardless of count.
    const cutoff = Date.now() - EVENTS_MAX_AGE_DAYS * 86400000;
    const stamps = sh.getRange(2, 1, Math.min(lastRow - 1, EVENTS_MAX_ROWS), 1).getValues();
    for (var i = 0; i < stamps.length; i++) {
      const t = stamps[i][0] instanceof Date ? stamps[i][0].getTime() : Date.parse(stamps[i][0]);
      if (!t || t >= cutoff) break;
      dropTo = i + 1;
    }
    // Then the row cap, whichever bites harder.
    const dataRows = lastRow - 1;
    if (dataRows - dropTo > EVENTS_MAX_ROWS) dropTo = dataRows - EVENTS_MAX_ROWS;

    if (dropTo > 0) sh.deleteRows(2, dropTo);
  } catch (err) { /* housekeeping must never break a request */ }
}

// ETSY-5FDE-43A8-8477-4228A671F027: a v4 UUID with its first block replaced,
// so keys are visually consistent with the Lemon Squeezy ones buyers of the
// same product might also hold, while still being obviously Etsy in origin.
function _generateKey() {
  const parts = Utilities.getUuid().toUpperCase().split('-');
  parts[0] = 'ETSY';
  return parts.join('-');
}

// One named bucket per purpose, so analytics can never spend a buyer's
// allowance. Returns true when the request is under its own cap.
function _bucketOk(name, limit) {
  const cache = CacheService.getScriptCache();
  const k = name + '_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(k) || '0');
  if (n >= limit) return false;
  cache.put(k, String(n + 1), 90);
  return true;
}

// A launch code now proves itself against the sheet rather than against a
// list the browser already has. Shares the validate bucket: both are
// "someone is redeeming something".
function _handleCode(p) {
  try {
    if (!_bucketOk('vl', VALIDATE_LIMIT_PER_MIN)) return { ok: false, error: 'busy' };
    const code = String(p.code || '').trim().toUpperCase().slice(0, 32);
    if (!code) return { ok: false, error: 'not_found' };
    const rows = _codesSheet().getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toUpperCase() !== code) continue;
      if (String(rows[i][4]).trim().toLowerCase() === 'no') return { ok: false, error: 'not_found' };
      return {
        ok: true,
        tool: String(rows[i][1]).trim().toLowerCase() === 'ubp' ? 'ubp' : 'sbp',
        theme: String(rows[i][2]).trim(),
        layout: String(rows[i][3]).trim()
      };
    }
    return { ok: false, error: 'not_found' };
  } catch (err) { return { ok: false, error: 'server' }; }
}

// "Tell me when this launches". One row per address per tool; asking twice
// updates the timestamp rather than duplicating.
function _handleNotify(p) {
  try {
    if (!_bucketOk('nt', NOTIFY_LIMIT_PER_MIN)) return { ok: false, error: 'busy' };
    const email = _normEmail(p.email);
    if (!_looksLikeEmail(email)) return { ok: false, error: 'bad_email' };
    const tool = String(p.tool || '').trim().slice(0, 40);
    const source = String(p.source || 'notify').trim().slice(0, 40);
    const vid = String(p.vid || '').trim().slice(0, 64);

    const sh = _notifySheet();
    const rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (_normEmail(rows[i][1]) === email && String(rows[i][2]).trim() === tool) {
        sh.getRange(i + 1, 1).setValue(new Date());
        return { ok: true, already: true };
      }
    }
    sh.appendRow([new Date(), email, tool, source, vid]);
    return { ok: true, already: false };
  } catch (err) { return { ok: false, error: 'server' }; }
}

// ══════════════════════════════════════════════════════════════════════
// LEMON SQUEEZY WEBHOOK  ->  phone notification
// ══════════════════════════════════════════════════════════════════════
// Apps Script's doPost cannot read request headers, so Lemon Squeezy's
// X-Signature HMAC is not available to verify against. The shared secret
// rides in the callback URL's query string instead (?wh=...), which is
// weaker: anyone who learned the full URL could fake a notification. They
// could not touch money or data, only make the phone chirp, so the trade is
// deliberate. Keep the URL private and rotate the secret if it ever leaks.
function _handleLsWebhook(e) {
  try {
    const want = PropertiesService.getScriptProperties().getProperty('LS_WEBHOOK_SECRET') || '';
    const got = String((e.parameter && e.parameter.wh) || '');
    if (!want || got !== want) return _ok();
    const body = e.postData.contents;
    if (!body || body.length > WEBHOOK_MAX_BODY_BYTES) return _ok();

    const p = JSON.parse(body);
    const event = String((p.meta && p.meta.event_name) || '').toLowerCase();
    const a = (p.data && p.data.attributes) || {};
    // order_id is what a licence validation returns, so it is the one a
    // redemption can be matched on. order_number is what the buyer and the
    // Lemon Squeezy UI see. Both are recorded.
    const orderId = String((p.data && p.data.id) || a.order_id || '');
    const orderNumber = String(a.order_number || '');

    // Lemon Squeezy retries on failure, so the same order can arrive more
    // than once. Recorded once, announced once.
    const sh = _salesSheet();
    const rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) !== event) continue;
      if (String(rows[i][2]) === orderId || (orderNumber && String(rows[i][11]) === orderNumber)) return _ok();
    }

    const total = Number(a.total || 0) / 100;
    const currency = String(a.currency || 'USD');
    const first = (a.first_order_item || {});
    const product = String(first.product_name || a.product_name || 'Ezzo Budget');
    const variant = String(first.variant_name || '');
    const testMode = a.test_mode === true;

    const buyerEmail = String(a.user_email || a.customer_email || a.email || '');
    const buyerName  = String(a.user_name || a.customer_name || a.name || '');

    // Lemon Squeezy reports how much was taken off, not which code did it.
    const lsDiscount = Number(a.discount_total || 0) > 0 ? 'discount ' + (Number(a.discount_total) / 100).toFixed(2) : '';
    sh.appendRow([new Date(), event, orderId, buyerEmail, buyerName,
                  product, variant, total, currency, testMode ? 'test' : 'live', String(a.status || ''), orderNumber,
                  lsDiscount, '', '']);

    if (event === 'order_created') {
      _push('💰 Cha-ching!', product + (testMode ? ' [TEST]' : ''), 'cashregister');
    } else if (event === 'order_refunded') {
      _push('↩️ Refund', product + (testMode ? ' [TEST]' : ''), 'falling');
    }
    return _ok();
  } catch (err) { return _ok(); }
}

// ── Dodo Payments sales ───────────────────────────────────────────────
// Sold alongside Lemon Squeezy. Dodo signs its webhooks with headers
// (webhook-signature), which Apps Script cannot read either, so the shared
// secret rides in the callback URL (?dwh=...) exactly like Lemon Squeezy's.
// Recorded in the same Sales sheet, so orders and buyers show up together.
// Script Properties: DODO_WEBHOOK_SECRET (required), DODO_MODE ('test' or
// 'live', defaults to 'test').
// Dodo's payment payload names products by id only, so ids are mapped here.
var DODO_PRODUCT_NAMES = {
  'pdt_0NpfcVEjfoHA9e1xPYwYe': 'Ultimate Budget Planner',   // live
  'pdt_0NpX69EmC20ESFfJv1rBw': 'Ultimate Budget Planner',   // test mode
  'pdt_0NpX69MrqOl0s171bu7rM': 'Simple Budget Planner'      // test mode
};
function _handleDodoWebhook(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const want = props.getProperty('DODO_WEBHOOK_SECRET') || '';
    const got = String((e.parameter && e.parameter.dwh) || '');
    if (!want || got !== want) return _ok();
    const body = e.postData.contents;
    if (!body || body.length > WEBHOOK_MAX_BODY_BYTES) return _ok();

    const p = JSON.parse(body);
    const event = String(p.type || '').toLowerCase();
    if (event !== 'payment.succeeded' && event !== 'refund.succeeded') return _ok();
    const d = p.data || {};
    // A payment is matched on its payment id; a refund on its own refund id.
    const orderId = String(event === 'refund.succeeded' ? (d.refund_id || d.payment_id || '') : (d.payment_id || ''));
    if (!orderId) return _ok();

    // Dodo retries on failure, so the same event can arrive more than once.
    const sh = _salesSheet();
    const rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) === event && String(rows[i][2]) === orderId) return _ok();
    }

    const cart = Array.isArray(d.product_cart) ? d.product_cart : [];
    const product = cart.map(function (c) { return DODO_PRODUCT_NAMES[c.product_id] || String(c.product_id || ''); }).join(', ') || 'Ezzo Budget';
    // A buyer abroad pays in their own currency, tax included (250.48 PLN for
    // a $49.99 planner in Poland). What lands with you is the settlement:
    // recorded in your currency without the tax, so every sale reads the
    // same and the totals add up.
    var cents, currency;
    if (event === 'payment.succeeded' && d.settlement_amount != null) {
      cents = Number(d.settlement_amount) - Number(d.settlement_tax || 0);
      currency = String(d.settlement_currency || 'USD');
    } else {
      cents = event === 'refund.succeeded' ? (d.amount != null ? d.amount : d.total_amount) : d.total_amount;
      currency = String(d.currency || 'USD');
    }
    const total = Number(cents || 0) / 100;
    const cust = d.customer || {};
    const testMode = (props.getProperty('DODO_MODE') || 'test') !== 'live';
    // The partner behind a sale, if any (their code, else their link).
    const affHit = event === 'payment.succeeded' ? _affResolve(d) : null;

    // What the buyer actually paid, in their own currency with tax, so the
    // dashboard can work out what share of a sale a later refund returned.
    const gross = d.total_amount != null ? (Number(d.total_amount) / 100).toFixed(2) + ' ' + String(d.currency || currency) : '';
    sh.appendRow([new Date(), event, orderId, String(cust.email || ''), String(cust.name || ''),
                  product, 'Dodo Payments', total, currency, testMode ? 'test' : 'live', String(d.status || ''), String(d.payment_id || ''),
                  event === 'payment.succeeded' ? _dodoDiscountCodes(d) : '',
                  affHit ? _affNormCode(affHit.a.Code) : '',
                  event === 'payment.succeeded' ? gross : (d.amount != null ? (Number(d.amount) / 100).toFixed(2) + ' ' + String(d.currency || '') : '')]);

    if (affHit) _affCredit(affHit, d, orderId, total, currency, testMode);
    if (event === 'refund.succeeded' && d.payment_id) {
      // The share of the sale that came back, from what the buyer paid.
      var fraction = 1;
      for (var j = 1; j < rows.length; j++) {
        if (String(rows[j][1]) !== 'payment.succeeded' || String(rows[j][2]) !== String(d.payment_id)) continue;
        const m = /^([\d.]+)\s*([A-Za-z]{3})$/.exec(String(rows[j][14] || '').trim());
        if (m && String(d.currency || '').toUpperCase() === m[2].toUpperCase() && Number(m[1]) > 0 && d.amount != null) fraction = (Number(d.amount) / 100) / Number(m[1]);
        break;
      }
      _affRefund(String(d.payment_id), fraction);
    }

    const amount = (currency === 'USD' ? '$' : currency + ' ') + total.toFixed(2);
    if (event === 'payment.succeeded') {
      _push('💰 Cha-ching!', product + ', ' + amount + ' (Dodo)' + (affHit ? ' via ' + _affNormCode(affHit.a.Code) : '') + (testMode ? ' [TEST]' : ''), 'cashregister');
    } else {
      _push('↩️ Refund', product + ', ' + amount + ' (Dodo)' + (testMode ? ' [TEST]' : ''), 'falling');
    }
    return _ok();
  } catch (err) { return _ok(); }
}

// The codes a buyer used at checkout. Dodo has described these a few ways
// over time (a discounts list, a single discount_id, a discount_code), so
// every shape is read. A code is preferred; an id is the fallback, which
// still tells two discounts apart on the dashboard.
function _dodoDiscountCodes(d) {
  const out = [];
  const add = function (v) { v = String(v || '').trim(); if (v && out.indexOf(v) < 0) out.push(v); };
  if (Array.isArray(d.discounts)) {
    d.discounts.forEach(function (x) {
      if (!x) return;
      if (typeof x === 'string') { add(x); return; }
      add(x.code || x.discount_code || x.original_code || x.discount_id);
    });
  }
  if (!out.length) add(d.discount_code || d.discount_id);
  return out.join(', ');
}
// Affonso passes the referral through checkout metadata (affiliate.js adds
// metadata_affonso_referral to the Buy link). Empty for a direct sale.
function _dodoAffiliate(d) {
  const m = d.metadata || {};
  return String(m.affonso_referral || m.affiliate || m.ref || '').slice(0, 80);
}

// Sends to whichever services are configured. Both may be set at once.
// Nothing here throws: a notification failing must never make Lemon Squeezy
// think the webhook failed, because it would then retry the whole thing.
function _push(title, message, sound) {
  const props = PropertiesService.getScriptProperties();

  // Pushover: has a built-in "cashregister" tone, which is the whole point.
  try {
    const token = props.getProperty('PUSHOVER_TOKEN');
    const user = props.getProperty('PUSHOVER_USER');
    if (token && user) {
      UrlFetchApp.fetch('https://api.pushover.net/1/messages.json', {
        method: 'post',
        payload: { token: token, user: user, title: title, message: message,
                   sound: sound || 'cashregister', priority: '0' },
        muteHttpExceptions: true
      });
    }
  } catch (err) {}

  // Telegram: free. Give the bot's chat its own notification tone on the
  // phone and it rings however you like.
  try {
    const bot = props.getProperty('TELEGRAM_BOT_TOKEN');
    const chat = props.getProperty('TELEGRAM_CHAT_ID');
    if (bot && chat) {
      UrlFetchApp.fetch('https://api.telegram.org/bot' + bot + '/sendMessage', {
        method: 'post',
        payload: { chat_id: chat, text: title + '\n' + message },
        muteHttpExceptions: true
      });
    }
  } catch (err) {}
}

// Pretends Lemon Squeezy has just posted a sale, so the whole path can be
// proven before the store is even activated: the secret check, recording the
// order, and the notification. Run it from the editor and check your phone,
// then look at the Sales sheet.
//
// It writes a real row, using an order number that makes clear where it came
// from. Delete that row afterwards if you would rather it were not there.
function simulateSale() {
  const secret = PropertiesService.getScriptProperties().getProperty('LS_WEBHOOK_SECRET');
  if (!secret) {
    console.log('LS_WEBHOOK_SECRET is not set, so a real webhook would be rejected too.');
    return 'no secret';
  }
  const payload = {
    meta: { event_name: 'order_created' },
    data: {
      id: 'sim',
      attributes: {
        order_number: 'SIM-' + Date.now().toString().slice(-6),
        user_email: 'simulated.buyer@example.com',
        user_name: 'Simulated Buyer',
        total: 4999, currency: 'USD', status: 'paid', test_mode: true,
        first_order_item: { product_name: 'Ultimate Budget Planner', variant_name: 'Dark / Classic' }
      }
    }
  };
  doPost({ parameter: { wh: secret }, postData: { contents: JSON.stringify(payload) } });
  console.log('Simulated a sale. Your phone should ring, and a row should appear on the Sales sheet.');
  console.log('It is marked [TEST] because test_mode is set, exactly as a Lemon Squeezy test purchase would be.');
  return 'sent';
}

// The same for Dodo Payments: pretends Dodo has just posted a sale, so the
// secret check, the Sales sheet row and the phone alert can all be proven
// before anyone buys. Run it from the editor and check your phone. It writes
// a real row with a SIM- payment id; delete it afterwards if you like.
function simulateDodoSale() {
  const secret = PropertiesService.getScriptProperties().getProperty('DODO_WEBHOOK_SECRET');
  if (!secret) {
    console.log('DODO_WEBHOOK_SECRET is not set, so a real Dodo webhook would be rejected too.');
    return 'no secret';
  }
  const payload = {
    business_id: 'sim', type: 'payment.succeeded', timestamp: new Date().toISOString(),
    data: {
      payload_type: 'Payment', payment_id: 'SIM-' + Date.now().toString().slice(-6), status: 'succeeded',
      total_amount: 4999, currency: 'USD',
      customer: { customer_id: 'sim', email: 'simulated.buyer@example.com', name: 'Simulated Buyer' },
      product_cart: [{ product_id: Object.keys(DODO_PRODUCT_NAMES)[0], quantity: 1 }]
    }
  };
  doPost({ parameter: { dwh: secret }, postData: { contents: JSON.stringify(payload) } });
  console.log('Simulated a Dodo sale. Your phone should ring, and a row should appear on the Sales sheet.');
  return 'sent';
}

// Says exactly why a notification did or did not go out. Unlike _push, which
// swallows everything so a dead notification service can never make Lemon
// Squeezy think the webhook failed, this reports the real answer. Run it from
// the editor and read the Execution log.
function diagnoseChaChing() {
  const props = PropertiesService.getScriptProperties();
  const names = Object.keys(props.getProperties()).sort();
  console.log('Properties found: ' + (names.length ? names.join(', ') : 'NONE'));

  const bot = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chat = props.getProperty('TELEGRAM_CHAT_ID');
  // Only ever the shape of the token, never the token itself.
  console.log('TELEGRAM_BOT_TOKEN: ' + (bot ? 'set, ' + bot.length + ' chars, begins "' + bot.slice(0, 4) + '", has colon: ' + (bot.indexOf(':') > 0) : '*** MISSING ***'));
  console.log('TELEGRAM_CHAT_ID:   ' + (chat ? 'set to "' + chat + '"' : '*** MISSING ***'));

  if (!bot || !chat) {
    console.log('>> Stopping. Check the spelling of the property names in Project Settings, and that you pressed "Save script properties".');
    return 'missing properties';
  }
  if (bot.indexOf(':') < 1) {
    console.log('>> The token has no colon in it, so it is only half of one. It should look like 8914815160:AAG...');
    return 'token looks wrong';
  }

  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + bot + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chat, text: 'Diagnostic message from Apps Script' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  console.log('Telegram replied HTTP ' + code);
  console.log(res.getContentText());
  if (code === 200) console.log('>> Sent. If the phone stayed quiet, the message is in Telegram but its notification is muted.');
  else console.log('>> Telegram refused it. The description above says why.');
  return 'HTTP ' + code;
}

// Run this from the editor to make the phone chirp without waiting for a
// sale. Set up the properties first, then press Run.
function testChaChing() {
  _push('💰 Cha-ching!', 'Ultimate Budget Planner', 'cashregister');
  return 'Sent. If nothing arrived, check the Script Properties.';
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
    if (!_bucketOk('vl', VALIDATE_LIMIT_PER_MIN)) return { ok: false, error: 'busy' };
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

    let revenue = 0, orders = 0, refunded = 0, testOrders = 0, testRevenue = 0;
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
        // Test orders look identical to real ones and used to be added
        // straight into revenue. The only guard was a flag that tripped when
        // EVERY order in range was a test, so the first real sale silently
        // turned the warning off and left the play money in the total. They
        // are counted separately now and never reach revenue.
        if (a.test_mode === true) { testOrders++; testRevenue += Number(a.total || 0); continue; }
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

    // testOrders/testRevenue are reported alongside rather than folded in,
    // so the headline figure is always money that actually arrived.
    const out = { ok: true, configured: true, revenue: revenue / 100, orders: orders, refunded: refunded,
                  testOrders: testOrders, testRevenue: testRevenue / 100, testMode: testOrders > 0 && orders === 0 };
    cache.put(cacheKey, JSON.stringify(out), LS_CACHE_SECONDS);
    return out;
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

// ══════════════════════════════════════════════════════════════════════
// REVOKING A LEMON SQUEEZY KEY
// ══════════════════════════════════════════════════════════════════════
// Etsy keys are revoked by flipping Status in the Keys sheet, because that
// sheet is what validates them. Lemon Squeezy keys are validated by Lemon
// Squeezy, so a local flag wouldn't stop anything - the key has to be
// disabled at source, which is what this does. Their own validate endpoint
// then rejects it, and the app refuses it without any extra check.
//
// Needs LEMONSQUEEZY_API_KEY (same one the sales card uses). Without it,
// this reports back plainly instead of pretending to have worked.
function _handleLsRevoke(p) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('LEMONSQUEEZY_API_KEY');
    if (!apiKey) return { ok: false, error: 'not_configured' };

    const key = String(p.key || '').trim();
    const disable = String(p.disable) !== 'false';
    if (!key) return { ok: false, error: 'bad_key' };

    const headers = {
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization': 'Bearer ' + apiKey
    };

    // The PATCH needs the numeric id, not the key string, so find it first.
    // Bounded paging for the same reason as the sales call: a long history
    // must not be able to run the script past its execution limit.
    let id = '';
    let url = 'https://api.lemonsqueezy.com/v1/license-keys?page[size]=100';
    for (var page = 0; page < 10 && url && !id; page++) {
      const res = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return { ok: false, error: 'lookup_' + res.getResponseCode() };
      const body = JSON.parse(res.getContentText());
      (body.data || []).forEach(function (row) {
        if (!id && String((row.attributes || {}).key || '').trim() === key) id = String(row.id);
      });
      url = (body.links && body.links.next) || '';
    }
    if (!id) return { ok: false, error: 'not_found' };

    const patch = UrlFetchApp.fetch('https://api.lemonsqueezy.com/v1/license-keys/' + id, {
      method: 'patch',
      headers: headers,
      payload: JSON.stringify({ data: { type: 'license-keys', id: id, attributes: { disabled: disable } } }),
      muteHttpExceptions: true
    });
    if (patch.getResponseCode() !== 200) return { ok: false, error: 'patch_' + patch.getResponseCode() };

    // Mirror the new state into the Keys sheet so the dashboard can show it
    // without querying Lemon Squeezy on every render.
    _upsertKeyStatus(key, disable ? 'revoked' : 'active', p.tool, p.orderId);
    return { ok: true, disabled: disable };
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

// Updates the row for a key, creating one if this is the first time we've
// needed to record anything about it (true for Lemon Squeezy keys, which
// are never claimed through /claim).
function _upsertKeyStatus(key, status, tool, orderId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const sh = _keysSheet();
    const rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toUpperCase() === key.toUpperCase()) {
        sh.getRange(i + 1, 8).setValue(status);
        return;
      }
    }
    sh.appendRow([key, tool || '', '', '', orderId || '', '', new Date(), status, '[]', 0, '']);
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════ Blog posts (public read) ══════════════════════
// The blog page fetches this to pick up anything published from the admin.
// Read-only and unauthenticated on purpose: these are public articles, and
// the admin writes them through the Sheets API with its own OAuth token, so
// nothing here needs write access.
//
// Cached, because every visitor to /blog hits this. Five minutes is short
// enough that publishing feels immediate and long enough that a burst of
// traffic doesn't turn into a burst of Sheets reads.
function _handleBlogPosts(p) {
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get('blogposts');
    if (hit) return JSON.parse(hit);

    const sh = _blogsSheet();
    const rows = sh.getDataRange().getValues();
    const posts = [];
    for (var i = 1; i < rows.length; i++) {
      const r = rows[i];
      const slug = String(r[0] || '').trim();
      if (!slug) continue;                                   // cleared row
      const status = String(r[12] || 'published').toLowerCase();
      // Drafts are still returned, flagged, so the blog page can drop a
      // seeded post that has been unpublished rather than silently keeping
      // the version that shipped in the repo.
      posts.push({
        slug: slug,
        title: String(r[1] || ''),
        excerpt: String(r[2] || ''),
        category: String(r[3] || 'basics'),
        tool: String(r[4] || 'budget'),
        tags: String(r[5] || '').split(',').map(function (x) { return x.trim(); }).filter(String),
        date: _blogDate(r[6]),
        readMinutes: Number(r[7] || 0) || 0,
        image: String(r[8] || ''),
        imageAlt: String(r[9] || ''),
        body: String(r[10] || ''),
        related: String(r[11] || '').split(',').map(function (x) { return x.trim(); }).filter(String),
        status: status,
        updated: _blogDate(r[13])
      });
    }
    const out = { ok: true, posts: posts };
    // A big cache write can fail on the 100KB per-entry limit; the endpoint
    // still works uncached, so that must not take the response down with it.
    try { cache.put('blogposts', JSON.stringify(out), BLOG_CACHE_SECONDS); } catch (e) { /* too large to cache */ }
    return out;
  } catch (err) {
    return { ok: false, error: 'server', posts: [] };
  }
}

// Sheets hands back a Date object if the cell was ever formatted as one, and
// a plain string otherwise. The blog expects YYYY-MM-DD either way.
function _blogDate(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  }
  return String(v).trim().slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════
//  STARTING THE FIGURES OVER
//  ────────────────────────────────────────────────────────────────────
//  Run these by hand from the Apps Script editor: pick one from the
//  function dropdown and press Run. None of them is reachable over HTTP,
//  by design, so nothing outside this editor can ever trigger one.
//
//  What each one touches, and what it deliberately does not:
//
//    resetAnalytics()    empties Events. Visits, sessions, funnels.
//    resetSales()        empties Sales. Lemon Squeezy order records.
//    resetRedemptions()  clears the redemption counters on Keys.
//    resetEverything()   all three, in one go.
//
//  Styles, Blogs and Codes are never touched by any of them. Those are
//  settings rather than history, and losing them would take the shop
//  down rather than clear a number.
//
//  ⚠ On redemptions, read this before running it. The keys themselves
//  are NOT deleted, and that is not a detail. Every customer who has ever
//  bought holds a key that is checked against the Keys sheet, and a row
//  removed from it is a person locked out of something they paid for.
//  resetRedemptions only blanks the three columns that are statistics:
//  RedeemCount, LastRedeemedAt and Devices. Key, Tool, Theme, Layout,
//  OrderId, Email, IssuedAt and Status are all left exactly as they are,
//  so every key keeps working and anything revoked stays revoked.
//
//  Clearing Devices does have one real effect worth knowing: it frees
//  every device slot, so a customer already using their three can add
//  three more. For a reset before launch that is what you want. Later on
//  it quietly widens the limit for existing buyers.
// ══════════════════════════════════════════════════════════════════════

// Removes every row under the header, leaving the sheet and its columns
// in place so the next write lands in the right shape.
function _clearRows(sh, label) {
  const last = sh.getLastRow();
  if (last < 2) { Logger.log(label + ": already empty"); return 0; }
  const n = last - 1;
  sh.deleteRows(2, n);
  Logger.log(label + ": cleared " + n + " row" + (n === 1 ? "" : "s"));
  return n;
}

function resetAnalytics() {
  return _clearRows(_getSheet(), 'Events');
}

function resetSales() {
  return _clearRows(_salesSheet(), 'Sales');
}

// Blanks the statistics on every key and leaves the keys themselves
// untouched. See the warning above before running this on a live shop.
function resetRedemptions() {
  const sh = _keysSheet();
  const last = sh.getLastRow();
  if (last < 2) { Logger.log('Keys: nothing to reset'); return 0; }
  const n = last - 1;
  // Columns 9, 10 and 11: Devices, RedeemCount, LastRedeemedAt. Written
  // as one range so a long sheet is one call rather than one per row.
  const blanks = [];
  for (var i = 0; i < n; i++) blanks.push(['', 0, '']);
  sh.getRange(2, 9, n, 3).setValues(blanks);
  Logger.log('Keys: reset the counters on ' + n + ' key' + (n === 1 ? '' : 's') +
    '. The keys themselves are untouched and still work.');
  return n;
}

function resetEverything() {
  const e = resetAnalytics();
  const s = resetSales();
  const k = resetRedemptions();
  Logger.log('Done. Events ' + e + ', Sales ' + s + ', Keys reset ' + k + '.');
}

// ══════════════════════════════════════════════════════════════════════
// AFFILIATE PROGRAM
// ══════════════════════════════════════════════════════════════════════
// The whole program runs here and in this spreadsheet: no third-party
// affiliate service, no monthly fee. Everything is controlled from the admin
// dashboard (Affiliates tab).
//
//   Affiliates    one row per partner: code, contact, status, program, payout
//   AffPrograms   commission programs: rate (percent or flat), buyer discount,
//                 link window, hold, approval mode, minimum payout, tiers
//   AffCoupons    discount codes, any number per partner, each mirrored in Dodo
//   AffClicks     one row per referred visitor per partner per day
//   AffEvents     funnel steps a referred visitor took (demo, checkout)
//   Commissions   one row per referral (credited sale), clawback or tier-2 reward
//   Payouts       one row per payment sent, with the referrals it covered
//   AffSettings   program-wide switches (applications, notifications, ...)
//
// A sale is credited from the Dodo webhook: to whoever's coupon was used,
// otherwise to whoever's link the buyer last arrived through. The partner's
// program decides the commission, the hold and whether you approve each
// referral yourself. Rows are never deleted (only marked), so row numbers
// the dashboard holds stay valid.
//
// Script Properties:
//   DODO_API_KEY   creates and updates partner coupons in Dodo and builds
//                  checkouts with a partner's code already applied. Without
//                  it links still track and pay; coupons can't be made.
//   ADMIN_EMAIL    optional; defaults to the account that owns this script.
//
// Run setupAffiliates() once from the editor after pasting this file.
const AFF_SHEETS = {
  affiliates: ['Code', 'Email', 'Name', 'Status', 'Rate', 'DiscountCode', 'DiscountId', 'PayoutMethod', 'PayoutEmail',
               'Website', 'Audience', 'Application', 'RecruitedBy', 'CreatedAt', 'ApprovedAt', 'LoginHash', 'LoginExpires',
               'SessionHash', 'SessionExpires', 'LastLogin', 'Notes', 'ProgramId', 'RateType', 'PayoutDetails',
               'AdminSessionHash', 'AdminSessionExpires', 'DeletedAt'],
  programs: ['ProgramId', 'Name', 'Description', 'Type', 'Amount', 'BuyerDiscount', 'CookieDays', 'HoldDays', 'Approval',
             'MinPayout', 'Tiers', 'TierMetric', 'Tier2Rate', 'Default', 'Active', 'Status', 'CreatedAt', 'UpdatedAt'],
  coupons: ['Code', 'Affiliate', 'Percent', 'DiscountId', 'Active', 'UsageLimit', 'ExpiresAt', 'CreatedAt', 'Note', 'Status'],
  clicks: ['Timestamp', 'Code', 'VisitorId', 'Landing', 'Referrer', 'SubId', 'Timezone'],
  events: ['Timestamp', 'Code', 'VisitorId', 'Type', 'SubId'],
  commissions: ['Timestamp', 'Code', 'OrderId', 'Type', 'SaleAmount', 'Rate', 'Commission', 'Currency', 'Status',
                'AvailableAt', 'PaidAt', 'PayoutId', 'Attribution', 'SubId', 'Note', 'Test', 'ProgramId', 'Approval',
                'ApprovedAt', 'Manual', 'RateType'],
  payouts: ['Timestamp', 'PayoutId', 'Code', 'Amount', 'Currency', 'Method', 'PayoutEmail', 'Reference', 'Note',
            'Details', 'Referrals', 'Status', 'PaidDate', 'ConfirmedAt', 'VoidedAt'],
  settings: ['Key', 'Value', 'About']
};
const AFF_SHEET_NAMES = { affiliates: 'Affiliates', programs: 'AffPrograms', coupons: 'AffCoupons', clicks: 'AffClicks', events: 'AffEvents',
                          commissions: 'Commissions', payouts: 'Payouts', settings: 'AffSettings' };
// Program-wide switches. Commission terms live on each program.
const AFF_DEFAULTS = {
  programOpen: ['yes', 'no = the application form is closed'],
  autoApprove: ['yes', 'yes = applications are approved straight away'],
  applicationProgram: ['', 'Program id new applicants join (empty = the default program)'],
  payoutSchedule: ['Monthly, in the first week', 'Shown to partners'],
  notifySales: ['yes', 'yes = email partners when they make a sale'],
  notifyApplications: ['yes', 'yes = email you when someone applies'],
  blockSelf: ['yes', 'yes = a partner buying through their own link or code earns nothing']
};
const AFF_PROGRAM_DEFAULTS = {
  Name: 'Standard', Description: '', Type: 'percent', Amount: 30, BuyerDiscount: 10, CookieDays: 30, HoldDays: 30,
  Approval: 'auto', MinPayout: 50, Tiers: '[{"min":10,"amount":35}]', TierMetric: 'sales', Tier2Rate: 0
};
const AFF_LOGIN_MINUTES = 30;
const AFF_SESSION_DAYS = 60;
const AFF_ADMIN_VIEW_MINUTES = 60;
const AFF_SITE = 'https://ezzohub.com';

function setupAffiliates() {
  Object.keys(AFF_SHEETS).forEach(function (k) { _affSheet(k); });
  _affDefaultsV2();
  _affSettings(true);
  _affPrograms();
  _affMigrateCoupons();
  // Touching MailApp here is what makes the editor ask for the permission
  // to send the program's emails, once, instead of failing on the first one.
  console.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
  console.log('Affiliate program ready. Admin: ' + _affAdminEmail());
  return 'ok';
}

// ── Sheet helpers ──────────────────────────────────────────────────────
function _affSheet(kind) {
  const head = AFF_SHEETS[kind];
  const sh = _sheet(AFF_SHEET_NAMES[kind], head);
  // Sheets made by an earlier version get the newer columns added.
  const have = sh.getRange(1, 1, 1, head.length).getValues()[0];
  for (var c = 0; c < head.length; c++) if (String(have[c] || '').trim() !== head[c]) sh.getRange(1, c + 1).setValue(head[c]);
  if (kind === 'settings' && sh.getLastRow() < 2) {
    Object.keys(AFF_DEFAULTS).forEach(function (k) { sh.appendRow([k, AFF_DEFAULTS[k][0], AFF_DEFAULTS[k][1]]); });
  }
  return sh;
}
function _affRows(kind) {
  const sh = _affSheet(kind);
  const vals = sh.getDataRange().getValues();
  const head = AFF_SHEETS[kind];
  const out = [];
  for (var i = 1; i < vals.length; i++) {
    const o = { _row: i + 1 };
    head.forEach(function (h, c) { o[h] = vals[i][c] === undefined ? '' : vals[i][c]; });
    out.push(o);
  }
  return out;
}
function _affSet(kind, row, field, value) {
  const c = AFF_SHEETS[kind].indexOf(field);
  if (c < 0) throw new Error('no field ' + field);
  _affSheet(kind).getRange(row, c + 1).setValue(value);
}
function _affSetMany(kind, row, fields) { Object.keys(fields).forEach(function (f) { _affSet(kind, row, f, fields[f]); }); }
function _affAppend(kind, obj) {
  _affSheet(kind).appendRow(AFF_SHEETS[kind].map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}
function _affSettings(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) { const hit = cache.get('aff_settings'); if (hit) return JSON.parse(hit); }
  const s = {};
  Object.keys(AFF_DEFAULTS).forEach(function (k) { s[k] = AFF_DEFAULTS[k][0]; });
  _affRows('settings').forEach(function (r) {
    const k = String(r.Key || '').trim();
    if (!k) return;
    s[k] = k === 'payoutSchedule' || k === 'applicationProgram' ? String(r.Value == null ? '' : r.Value).trim() : String(r.Value).trim().toLowerCase();
  });
  cache.put('aff_settings', JSON.stringify(s), 120);
  return s;
}
function _affAdminEmail() {
  return _normEmail(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || Session.getEffectiveUser().getEmail());
}
function _affHash(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function _affToken() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function _affNormCode(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }
function _affTime(v) { return v instanceof Date ? v.getTime() : (Date.parse(v) || 0); }
function _affMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function _affNum(v, lo, hi) { const n = Number(v); return v === '' || v == null || !isFinite(n) || n < lo || n > hi ? null : n; }
function _affEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function _affFirst(name) { return _affEsc(String(name || '').split(' ')[0] || 'there'); }
function _affLock() {
  const lock = LockService.getScriptLock();
  return lock.tryLock(20000) ? lock : null;
}

// ── Programs ───────────────────────────────────────────────────────────
function _affParseProgram(r) {
  let tiers = [];
  try { tiers = JSON.parse(r.Tiers || '[]'); } catch (e) { tiers = []; }
  if (!Array.isArray(tiers)) tiers = [];
  tiers = tiers.map(function (t) { return { min: Number(t.min) || 0, amount: Number(t.amount) || 0 }; }).filter(function (t) { return t.min > 0; })
               .sort(function (a, b) { return a.min - b.min; });
  return {
    _row: r._row, id: String(r.ProgramId), name: String(r.Name || 'Program'), description: String(r.Description || ''),
    type: String(r.Type) === 'flat' ? 'flat' : 'percent', amount: Number(r.Amount) || 0, buyerDiscount: Number(r.BuyerDiscount) || 0,
    cookieDays: Number(r.CookieDays) || 30, holdDays: Number(r.HoldDays) || 0, approval: String(r.Approval) === 'manual' ? 'manual' : 'auto',
    minPayout: Number(r.MinPayout) || 0, tiers: tiers, tierMetric: String(r.TierMetric) === 'revenue' ? 'revenue' : 'sales',
    tier2Rate: Number(r.Tier2Rate) || 0, isDefault: String(r.Default) === 'yes', active: String(r.Active) !== 'no'
  };
}
// Live programs, with exactly one default. The first ever is made from the
// old single-program settings (or the standard terms).
function _affPrograms() {
  let rows = _affRows('programs').filter(function (r) { return String(r.Status) !== 'deleted' && r.ProgramId; });
  if (!rows.length) {
    const legacy = {};
    _affRows('settings').forEach(function (r) { legacy[String(r.Key)] = r.Value; });
    const p = Object.assign({}, AFF_PROGRAM_DEFAULTS);
    if (legacy.commissionRate !== undefined && legacy.commissionRate !== '') p.Amount = Number(legacy.commissionRate) || p.Amount;
    if (legacy.customerDiscount !== undefined && legacy.customerDiscount !== '') p.BuyerDiscount = Number(legacy.customerDiscount) || 0;
    if (legacy.cookieDays) p.CookieDays = Number(legacy.cookieDays) || p.CookieDays;
    if (legacy.holdDays !== undefined && legacy.holdDays !== '') p.HoldDays = Number(legacy.holdDays) || 0;
    if (legacy.minPayout !== undefined && legacy.minPayout !== '') p.MinPayout = Number(legacy.minPayout) || 0;
    if (legacy.bonusSales) p.Tiers = Number(legacy.bonusSales) > 0 ? JSON.stringify([{ min: Number(legacy.bonusSales), amount: Number(legacy.bonusRate) || 35 }]) : '[]';
    if (legacy.tier2Rate) p.Tier2Rate = Number(legacy.tier2Rate) || 0;
    _affAppend('programs', Object.assign(p, { ProgramId: 'P1', Default: 'yes', Active: 'yes', Status: 'live', CreatedAt: new Date(), UpdatedAt: new Date() }));
    rows = _affRows('programs').filter(function (r) { return String(r.Status) !== 'deleted' && r.ProgramId; });
  }
  const list = rows.map(_affParseProgram);
  if (!list.some(function (p) { return p.isDefault; })) {
    const first = list.filter(function (p) { return p.active; })[0] || list[0];
    first.isDefault = true; first.active = true;
    _affSetMany('programs', first._row, { Default: 'yes', Active: 'yes' });
  }
  return list;
}
function _affDefaultProgram(programs) { return (programs || _affPrograms()).filter(function (p) { return p.isDefault; })[0]; }
// The program a partner earns under: theirs while it is switched on, the
// default otherwise.
function _affProgramOf(a, programs) {
  programs = programs || _affPrograms();
  const own = programs.filter(function (p) { return p.id === String(a.ProgramId || '') && p.active; })[0];
  return own || _affDefaultProgram(programs);
}
// Prior credited sales, for tiers: count and revenue.
function _affHistory(code, comms) {
  let sales = 0, revenue = 0;
  (comms || _affRows('commissions')).forEach(function (c) {
    if (_affNormCode(c.Code) !== code || c.Type !== 'sale' || String(c.Test) === 'test') return;
    if (c.Status === 'reversed' || c.Status === 'rejected') return;
    sales++; revenue += Number(c.SaleAmount) || 0;
  });
  return { sales: sales, revenue: revenue };
}
// The rate a partner earns on their next sale, and why.
function _affRateFor(a, p, hist) {
  if (a.Rate !== '' && a.Rate != null && isFinite(Number(a.Rate))) {
    return { type: String(a.RateType) === 'flat' ? 'flat' : String(a.RateType) === 'percent' ? 'percent' : p.type, amount: Number(a.Rate), source: 'custom' };
  }
  const value = p.tierMetric === 'revenue' ? hist.revenue : hist.sales;
  let rate = { type: p.type, amount: p.amount, source: 'program' };
  p.tiers.forEach(function (t) { if (value >= t.min) rate = { type: p.type, amount: t.amount, source: 'tier', tier: t }; });
  return rate;
}
function _affCommission(rate, sale) {
  return rate.type === 'flat' ? _affMoney(Math.min(rate.amount, sale)) : _affMoney(sale * rate.amount / 100);
}

// ── Partners ───────────────────────────────────────────────────────────
function _affFind(code) {
  const c = _affNormCode(code);
  if (!c) return null;
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) if (_affNormCode(rows[i].Code) === c) return rows[i];
  return null;
}
function _affLive(a) { return !!a && String(a.Status) === 'approved'; }
function _affBySession(token) {
  const t = String(token || '');
  if (t.length < 32) return null;
  const h = _affHash(t), now = Date.now();
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Status) === 'deleted') continue;
    if (rows[i].SessionHash === h && _affTime(rows[i].SessionExpires) > now) return rows[i];
    if (rows[i].AdminSessionHash === h && _affTime(rows[i].AdminSessionExpires) > now) { rows[i]._admin = true; return rows[i]; }
  }
  return null;
}
function _affUniqueCode(wanted, name) {
  const taken = {};
  _affRows('affiliates').forEach(function (r) { taken[_affNormCode(r.Code)] = 1; });
  _affRows('coupons').forEach(function (r) { if (String(r.Status) !== 'deleted') taken[_affNormCode(r.Code)] = 1; });
  let code = _affNormCode(wanted);
  if (code.length >= 3 && !taken[code] && !/^(EZZO|ADMIN|TEST)/.test(code)) return code;
  // First name, or the whole name when the first is very short ("Bo Lind").
  let base = _affNormCode(String(name || '').split(' ')[0]);
  if (base.length < 3) base = _affNormCode(name);
  if (base.length < 3) base = 'PARTNER';
  base = base.slice(0, 10);
  code = base;
  var n = 2;
  while (taken[code] || /^(EZZO|ADMIN|TEST)/.test(code)) { code = base + n; n++; }
  return code;
}

// ── Email ──────────────────────────────────────────────────────────────
function _affMail(to, subject, lines, button) {
  try {
    if (!to || MailApp.getRemainingDailyQuota() < 1) return false;
    const html = '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#1e2240">' +
      '<div style="font-weight:800;font-size:18px;margin-bottom:18px"><span style="color:#7651f0">Ezzo</span> Hub Partners</div>' +
      lines.map(function (l) { return '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">' + l + '</p>'; }).join('') +
      (button ? '<p style="margin:22px 0"><a href="' + button[1] + '" style="display:inline-block;background:#7651f0;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">' + button[0] + '</a></p>' : '') +
      '<p style="font-size:12.5px;color:#868aab;margin-top:26px">Ezzo Hub, ezzohub.com/partners</p></div>';
    const text = lines.join('\n\n').replace(/<[^>]+>/g, '') + (button ? '\n\n' + button[0] + ': ' + button[1] : '');
    MailApp.sendEmail({ to: to, subject: subject, body: text, htmlBody: html, name: 'Ezzo Hub Partners' });
    return true;
  } catch (err) { return false; }
}
function _affRateText(rate) { return rate.type === 'flat' ? '$' + Number(rate.amount).toFixed(2) + ' per sale' : rate.amount + '% of every sale'; }
function _affWelcome(a) {
  const p = _affProgramOf(a);
  const rate = _affRateFor(a, p, { sales: 0, revenue: 0 });
  const code = _affNormCode(a.Code);
  const coupon = _affPrimaryCoupon(code);
  _affMail(a.Email, 'Welcome to the Ezzo Hub partner program', [
    'Hi ' + _affFirst(a.Name) + ', you are in!',
    'Your link: <b>' + AFF_SITE + '/?ref=' + code + '</b>',
    coupon && coupon.DiscountId ? 'Your code: <b>' + _affEsc(coupon.Code) + '</b> gives your audience ' + coupon.Percent + '% off, and every sale with it is yours, even without the link.' : '',
    'You earn ' + _affRateText(rate) + ' for ' + p.cookieDays + ' days after someone clicks your link. Sign in to your dashboard any time for links, banners, videos and your earnings.'
  ].filter(Boolean), ['Open your dashboard', AFF_SITE + '/partners']);
}

// ── Dodo API and coupons ───────────────────────────────────────────────
function _dodoApi(method, path, body) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DODO_API_KEY');
  if (!key) return { ok: false, error: 'no_api_key' };
  const host = (props.getProperty('DODO_MODE') || 'test') === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
  const res = UrlFetchApp.fetch(host + path, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key }, payload: body ? JSON.stringify(body) : undefined
  });
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  return code >= 200 && code < 300 ? { ok: true, data: data } : { ok: false, error: 'dodo_' + code, data: data };
}
function _dodoProductId() {
  const live = (PropertiesService.getScriptProperties().getProperty('DODO_MODE') || 'test') === 'live';
  return live ? 'pdt_0NpfcVEjfoHA9e1xPYwYe' : 'pdt_0NpX69EmC20ESFfJv1rBw';   // Ultimate Budget Planner
}
function _affCoupons() { return _affRows('coupons').filter(function (c) { return String(c.Status) !== 'deleted' && c.Code; }); }
function _affCouponByCode(code) {
  const c = _affNormCode(code);
  return _affCoupons().filter(function (x) { return _affNormCode(x.Code) === c; })[0] || null;
}
// The code shown to a partner and applied to their checkouts: their own
// name-code if it is live, otherwise their first live code.
function _affPrimaryCoupon(code, coupons) {
  const mine = (coupons || _affCoupons()).filter(function (c) { return _affNormCode(c.Affiliate) === code && String(c.Active) === 'yes' && c.DiscountId; });
  return mine.filter(function (c) { return _affNormCode(c.Code) === code; })[0] || mine[0] || null;
}
function _dodoDiscountBody(code, percent, usageLimit, expiresAt, affCode) {
  const body = { type: 'percentage', amount: Math.round(Number(percent) * 100), code: code, name: 'Partner ' + affCode + ' ' + code,
                 restricted_to: [_dodoProductId()], metadata: { affiliate: affCode } };
  if (Number(usageLimit) > 0) body.usage_limit = Math.round(Number(usageLimit));
  if (expiresAt) body.expires_at = new Date(expiresAt).toISOString();
  return body;
}
// Creates a coupon row and its Dodo discount. Without the API key the row
// is kept, switched off, so it can be activated once the key is added.
function _affCouponCreate(affCode, couponCode, percent, usageLimit, expiresAt, note) {
  const code = _affNormCode(couponCode);
  if (code.length < 3) return { ok: false, error: 'bad_code' };
  if (_affCouponByCode(code)) return { ok: false, error: 'code_taken' };
  const other = _affFind(code);
  if (other && _affNormCode(other.Code) !== affCode) return { ok: false, error: 'code_taken' };
  const pct = _affNum(percent, 1, 100);
  if (pct === null) return { ok: false, error: 'bad_percent' };
  const r = _dodoApi('post', '/discounts', _dodoDiscountBody(code, pct, usageLimit, expiresAt, affCode));
  _affAppend('coupons', { Code: code, Affiliate: affCode, Percent: pct, DiscountId: r.ok ? (r.data.discount_id || '') : '', Active: r.ok ? 'yes' : 'no',
    UsageLimit: Number(usageLimit) > 0 ? Math.round(Number(usageLimit)) : '', ExpiresAt: expiresAt ? new Date(expiresAt) : '', CreatedAt: new Date(),
    Note: String(note || '').slice(0, 200) || (r.ok ? '' : 'Not in Dodo yet: ' + r.error), Status: 'live' });
  return r.ok ? { ok: true, code: code } : { ok: true, code: code, warning: r.error };
}
function _affCouponActivate(c, on) {
  if (on) {
    if (c.DiscountId) { _affSetMany('coupons', c._row, { Active: 'yes' }); return { ok: true }; }
    const r = _dodoApi('post', '/discounts', _dodoDiscountBody(_affNormCode(c.Code), c.Percent, c.UsageLimit, c.ExpiresAt, _affNormCode(c.Affiliate)));
    if (!r.ok) return r;
    _affSetMany('coupons', c._row, { DiscountId: r.data.discount_id || '', Active: 'yes', Note: '' });
    return { ok: true };
  }
  if (c.DiscountId) _dodoApi('delete', '/discounts/' + c.DiscountId);
  _affSetMany('coupons', c._row, { DiscountId: '', Active: 'no' });
  return { ok: true };
}
// A partner's first code: their own partner code at their program's discount.
function _affEnsureCoupon(a) {
  const code = _affNormCode(a.Code);
  const p = _affProgramOf(a);
  const mine = _affCoupons().filter(function (c) { return _affNormCode(c.Affiliate) === code; });
  if (!mine.length) return p.buyerDiscount > 0 ? _affCouponCreate(code, code, p.buyerDiscount, '', '', '') : { ok: true, skipped: true };
  const results = mine.filter(function (c) { return String(c.Active) === 'paused' || (String(c.Active) === 'no' && !c.DiscountId && /^Not in Dodo/.test(String(c.Note))); })
                      .map(function (c) { return _affCouponActivate(c, true); });
  const failed = results.filter(function (r) { return !r.ok; })[0];
  return failed || { ok: true };
}
// Pausing or removing a partner stops their codes working (kept as "paused",
// so resuming brings back exactly the ones that were live).
function _affPauseCoupons(code) {
  _affCoupons().forEach(function (c) {
    if (_affNormCode(c.Affiliate) !== code || String(c.Active) !== 'yes') return;
    if (c.DiscountId) _dodoApi('delete', '/discounts/' + c.DiscountId);
    _affSetMany('coupons', c._row, { DiscountId: '', Active: 'paused' });
  });
}
// Earlier versions kept one code on the partner row; carry those over.
function _affMigrateCoupons() {
  const have = {};
  _affCoupons().forEach(function (c) { have[_affNormCode(c.Code)] = 1; });
  _affRows('affiliates').forEach(function (a) {
    const code = _affNormCode(a.DiscountCode);
    if (!code || have[code] || !a.DiscountId) return;
    _affAppend('coupons', { Code: code, Affiliate: _affNormCode(a.Code), Percent: AFF_PROGRAM_DEFAULTS.BuyerDiscount, DiscountId: a.DiscountId,
      Active: 'yes', CreatedAt: new Date(), Note: 'Carried over', Status: 'live' });
    have[code] = 1;
  });
}

// ── Public endpoints (JSONP) ───────────────────────────────────────────
// Auto-approval became the default after some programs were already set up
// with it off. This switches it on once for those; after that, whatever you
// choose in Settings stays.
function _affDefaultsV2() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('AFF_AUTO_APPROVE_DEFAULT')) return;
  props.setProperty('AFF_AUTO_APPROVE_DEFAULT', '1');
  const rows = _affRows('settings');
  const hit = rows.filter(function (r) { return r.Key === 'autoApprove'; })[0];
  if (hit) _affSheet('settings').getRange(hit._row, 2).setValue('yes');
  else _affSheet('settings').appendRow(['autoApprove', 'yes', AFF_DEFAULTS.autoApprove[1]]);
  _affSettings(true);
}
function _handleAffiliate(p) {
  try {
    _affDefaultsV2();
    switch (p.action) {
      case 'aff_program':  return _affProgramPublic();
      case 'aff_check':    return _affCheck(p);
      case 'aff_click':    return _affClick(p);
      case 'aff_event':    return _affEvent(p);
      case 'aff_checkout': return _affCheckout(p);
      case 'aff_apply':    return _affApply(p);
      case 'aff_login':    return _affLogin(p);
      case 'aff_verify':   return _affVerify(p);
      case 'aff_me':       return _affMe(p);
      case 'aff_update':   return _affUpdate(p);
      case 'aff_confirm':  return _affConfirm(p);
      case 'aff_logout':   return _affLogout(p);
      case 'aff_admin':    return _affAdmin(p);
    }
    return { ok: false, error: 'unknown' };
  } catch (err) { return { ok: false, error: 'server', detail: String(err && err.message || err).slice(0, 120) }; }
}
function _affProgramShape(p) {
  return { id: p.id, name: p.name, description: p.description, type: p.type, amount: p.amount, buyerDiscount: p.buyerDiscount,
           cookieDays: p.cookieDays, holdDays: p.holdDays, approval: p.approval, minPayout: p.minPayout, tiers: p.tiers,
           tierMetric: p.tierMetric, tier2Rate: p.tier2Rate };
}
// The terms new applicants get, for the public partner page.
function _affProgramPublic() {
  const s = _affSettings(), programs = _affPrograms();
  const p = programs.filter(function (x) { return x.id === s.applicationProgram && x.active; })[0] || _affDefaultProgram(programs);
  return Object.assign({ ok: true, open: s.programOpen !== 'no', autoApprove: s.autoApprove !== 'no', payoutSchedule: s.payoutSchedule, price: 49.99 }, _affProgramShape(p));
}
function _affCheck(p) {
  if (!_bucketOk('ac', 240)) return { ok: false, error: 'busy' };
  const a = _affFind(p.ref);
  if (!_affLive(a)) return { ok: false, error: 'not_found' };
  const pr = _affProgramOf(a);
  const c = _affPrimaryCoupon(_affNormCode(a.Code));
  return { ok: true, code: _affNormCode(a.Code), name: String(a.Name || '').split(' ')[0], discount: c ? Number(c.Percent) : 0,
           discountCode: c ? String(c.Code) : '', cookieDays: pr.cookieDays };
}
// One click per visitor per partner per day.
function _affClick(p) {
  if (!_bucketOk('ak', 300)) return { ok: false, error: 'busy' };
  const a = _affFind(p.ref);
  if (!_affLive(a)) return { ok: false, error: 'not_found' };
  const code = _affNormCode(a.Code);
  const vid = String(p.vid || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const k = 'affc_' + code + '_' + vid;
  if (vid && cache.get(k)) return { ok: true, dup: true };
  if (vid) cache.put(k, '1', 21600);
  _affAppend('clicks', { Timestamp: new Date(), Code: code, VisitorId: vid, Landing: String(p.lp || '').slice(0, 80), Referrer: String(p.rf || '').slice(0, 200),
                         SubId: String(p.sub || '').slice(0, 40), Timezone: String(p.tz || '').slice(0, 64) });
  return { ok: true };
}
function _affEvent(p) {
  if (!_bucketOk('ae', 300)) return { ok: false, error: 'busy' };
  const type = p.type === 'demo' || p.type === 'checkout' ? p.type : '';
  const a = _affFind(p.ref);
  if (!type || !_affLive(a)) return { ok: false };
  const vid = String(p.vid || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const k = 'affe_' + type + '_' + _affNormCode(a.Code) + '_' + vid;
  if (vid && cache.get(k)) return { ok: true, dup: true };
  if (vid) cache.put(k, '1', 21600);
  _affAppend('events', { Timestamp: new Date(), Code: _affNormCode(a.Code), VisitorId: vid, Type: type, SubId: String(p.sub || '').slice(0, 40) });
  return { ok: true };
}
// A single-use checkout (24 hours) with the partner's code applied and the
// partner named in the payment.
function _affCheckout(p) {
  if (!_bucketOk('ao', 120)) return { ok: false, error: 'busy' };
  const a = _affFind(p.ref);
  if (!_affLive(a)) return { ok: false, error: 'not_found' };
  const code = _affNormCode(a.Code);
  const c = _affPrimaryCoupon(code);
  const body = {
    product_cart: [{ product_id: _dodoProductId(), quantity: 1 }],
    metadata: { affiliate: code, affiliate_sub: String(p.sub || '').slice(0, 40) },
    return_url: AFF_SITE + '/budgetplanner?redeem=ubp'
  };
  if (c) body.discount_codes = [String(c.Code)];
  let r = _dodoApi('post', '/checkouts', body);
  if (!r.ok && body.discount_codes) { delete body.discount_codes; r = _dodoApi('post', '/checkouts', body); }
  if (!r.ok || !r.data.checkout_url) return { ok: false, error: r.error || 'no_url' };
  return { ok: true, url: r.data.checkout_url, discounted: !!body.discount_codes };
}

function _affApply(p) {
  if (!_bucketOk('ap', 20)) return { ok: false, error: 'busy' };
  const s = _affSettings();
  if (s.programOpen === 'no') return { ok: false, error: 'closed' };
  const email = _normEmail(p.email);
  if (!_looksLikeEmail(email)) return { ok: false, error: 'bad_email' };
  const name = String(p.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'bad_name' };
  const lock = _affLock();
  if (!lock) return { ok: false, error: 'busy' };
  try {
    if (_affRows('affiliates').some(function (r) { return _normEmail(r.Email) === email && String(r.Status) !== 'deleted'; })) return { ok: false, error: 'exists' };
    const code = _affUniqueCode(p.code, name);
    const recruiter = _affFind(p.recruiter);
    const programs = _affPrograms();
    const prog = programs.filter(function (x) { return x.id === s.applicationProgram && x.active; })[0] || _affDefaultProgram(programs);
    const auto = s.autoApprove === 'yes';
    _affAppend('affiliates', {
      Code: code, Email: email, Name: name, Status: auto ? 'approved' : 'pending', PayoutMethod: _affMethod(p.method), PayoutEmail: _normEmail(p.payout) || email,
      PayoutDetails: String(p.details || '').slice(0, 500), Website: String(p.site || '').slice(0, 200), Audience: String(p.audience || '').slice(0, 40),
      Application: String(p.promo || '').slice(0, 600), RecruitedBy: recruiter && String(recruiter.Status) !== 'rejected' && String(recruiter.Status) !== 'deleted' ? _affNormCode(recruiter.Code) : '',
      CreatedAt: new Date(), ApprovedAt: auto ? new Date() : '', ProgramId: prog.id
    });
    if (auto) { _affEnsureCoupon(_affFind(code)); _affWelcome(_affFind(code)); }
    else {
      _affMail(email, 'We got your Ezzo Hub partner application', [
        'Hi ' + _affFirst(name) + ',',
        'Thanks for applying to the Ezzo Hub partner program. We read every application and usually reply within two working days.',
        'Your requested code is <b>' + code + '</b>. We will confirm it when you are approved.'
      ]);
    }
    if (s.notifyApplications !== 'no') {
      _affMail(_affAdminEmail(), 'New partner application: ' + name, [
        _affEsc(name) + ' (' + _affEsc(email) + ') applied as <b>' + code + '</b>.',
        'Website: ' + _affEsc(p.site || '-') + '<br>Audience: ' + _affEsc(p.audience || '-'),
        _affEsc(p.promo || '')
      ], ['Review in the dashboard', AFF_SITE + '/admin']);
      _push('🤝 New partner application', name + ' (' + code + ')', 'magic');
    }
    return { ok: true, code: code, approved: auto };
  } finally { lock.releaseLock(); }
}
function _affMethod(v) { v = String(v || '').toLowerCase(); return v === 'wise' || v === 'bank' ? v : 'paypal'; }

// ── Partner sign-in ────────────────────────────────────────────────────
function _affLogin(p) {
  if (!_bucketOk('al', 30)) return { ok: false, error: 'busy' };
  const email = _normEmail(p.email);
  const reply = { ok: true };   // the same answer for anyone, so the form can't reveal who is a partner
  if (!_looksLikeEmail(email)) return reply;
  const cache = CacheService.getScriptCache();
  if (cache.get('afl_' + email) && !p._admin) return reply;
  cache.put('afl_' + email, '1', 60);
  const a = _affRows('affiliates').filter(function (r) { return _normEmail(r.Email) === email && ['rejected', 'deleted'].indexOf(String(r.Status)) < 0; })[0];
  if (!a) return reply;
  const token = _affToken();
  _affSetMany('affiliates', a._row, { LoginHash: _affHash(token), LoginExpires: new Date(Date.now() + AFF_LOGIN_MINUTES * 60000) });
  _affMail(email, 'Your Ezzo Hub partner sign-in link', [
    'Here is your sign-in link. It works once and expires in ' + AFF_LOGIN_MINUTES + ' minutes.',
    'If you did not ask for this, you can ignore this email.'
  ], ['Sign in', AFF_SITE + '/partners?login=' + token]);
  return reply;
}
function _affVerify(p) {
  if (!_bucketOk('av', 60)) return { ok: false, error: 'busy' };
  const t = String(p.token || '');
  if (t.length < 32) return { ok: false, error: 'bad_link' };
  const h = _affHash(t);
  const a = _affRows('affiliates').filter(function (r) { return r.LoginHash === h; })[0];
  if (!a) return { ok: false, error: 'bad_link' };
  if (_affTime(a.LoginExpires) < Date.now()) return { ok: false, error: 'expired' };
  const session = _affToken();
  _affSetMany('affiliates', a._row, { LoginHash: '', SessionHash: _affHash(session), SessionExpires: new Date(Date.now() + AFF_SESSION_DAYS * 86400000), LastLogin: new Date() });
  return { ok: true, session: session };
}
function _affLogout(p) {
  const a = _affBySession(p.s);
  if (a) _affSet('affiliates', a._row, a._admin ? 'AdminSessionHash' : 'SessionHash', '');
  return { ok: true };
}
function _affUpdate(p) {
  if (!_bucketOk('au', 30)) return { ok: false, error: 'busy' };
  const a = _affBySession(p.s);
  if (!a) return { ok: false, error: 'signed_out' };
  if (a._admin) return { ok: false, error: 'read_only' };
  const f = {};
  if (p.name) f.Name = String(p.name).trim().slice(0, 80);
  if (p.method) f.PayoutMethod = _affMethod(p.method);
  if (p.payout) {
    const pe = _normEmail(p.payout);
    if (!_looksLikeEmail(pe)) return { ok: false, error: 'bad_email' };
    f.PayoutEmail = pe;
  }
  if (p.details != null) f.PayoutDetails = String(p.details).slice(0, 500);
  if (p.site != null) f.Website = String(p.site).slice(0, 200);
  _affSetMany('affiliates', a._row, f);
  return { ok: true };
}
// "I received this payment": the partner's side of verifying a payout.
function _affConfirm(p) {
  const a = _affBySession(p.s);
  if (!a) return { ok: false, error: 'signed_out' };
  if (a._admin) return { ok: false, error: 'read_only' };
  const po = _affRows('payouts').filter(function (x) { return String(x.PayoutId) === String(p.id) && _affNormCode(x.Code) === _affNormCode(a.Code); })[0];
  if (!po || String(po.Status) === 'void') return { ok: false, error: 'not_found' };
  if (!po.ConfirmedAt) _affSet('payouts', po._row, 'ConfirmedAt', new Date());
  return { ok: true };
}

// ── Commission states ──────────────────────────────────────────────────
// Stored: pending, approved, paid, rejected, reversed. Shown:
//   pending   inside the hold
//   review    hold over, waiting for your approval (manual programs)
//   approved  ready to pay (manual approval, or an auto program's hold ended)
function _affState(c, now) {
  const st = String(c.Status);
  if (st !== 'pending') return st;
  if (String(c.Approval) === 'manual') return _affTime(c.AvailableAt) <= now ? 'review' : 'pending';
  return _affTime(c.AvailableAt) <= now ? 'approved' : 'pending';
}
function _affPayable(c, now) { return _affState(c, now) === 'approved' && String(c.Test) !== 'test'; }

function _affStats(a, programs) {
  const code = _affNormCode(a.Code);
  const now = Date.now(), DAY = 86400000;
  const comms = _affRows('commissions').filter(function (r) { return _affNormCode(r.Code) === code && String(r.Test) !== 'test'; });
  const clicks = _affRows('clicks').filter(function (r) { return _affNormCode(r.Code) === code; });
  const events = _affRows('events').filter(function (r) { return _affNormCode(r.Code) === code; });
  const payouts = _affRows('payouts').filter(function (r) { return _affNormCode(r.Code) === code; });
  const sales = comms.filter(function (c) { return c.Type === 'sale' && c.Status !== 'reversed' && c.Status !== 'rejected'; });
  const money = { pending: 0, review: 0, available: 0, paid: 0, reversed: 0 };
  comms.forEach(function (c) {
    const st = _affState(c, now), v = Number(c.Commission) || 0;
    if (st === 'pending') money.pending += v;
    else if (st === 'review') money.review += v;
    else if (st === 'approved') money.available += v;
    else if (st === 'paid') money.paid += v;
    else if (st === 'reversed') money.reversed += v;
  });
  const days = [];
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  for (var i = 29; i >= 0; i--) {
    const start = d0.getTime() - i * DAY;
    days.push({
      day: Utilities.formatDate(new Date(start), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      clicks: clicks.filter(function (c) { const t = _affTime(c.Timestamp); return t >= start && t < start + DAY; }).length,
      sales: sales.filter(function (c) { const t = _affTime(c.Timestamp); return t >= start && t < start + DAY; }).length
    });
  }
  const subs = {};
  const sub = function (k) { k = String(k || '') || '(none)'; return subs[k] = subs[k] || { sub: k, clicks: 0, sales: 0, earned: 0 }; };
  clicks.forEach(function (c) { sub(c.SubId).clicks++; });
  sales.forEach(function (c) { const s = sub(c.SubId); s.sales++; s.earned += Number(c.Commission) || 0; });
  const uniq = {};
  clicks.forEach(function (c) { uniq[c.VisitorId || c._row] = 1; });
  const p = _affProgramOf(a, programs);
  const hist = _affHistory(code, comms);
  const rate = _affRateFor(a, p, hist);
  return {
    code: code, rate: rate, lifetimeSales: hist.sales, lifetimeRevenue: _affMoney(hist.revenue),
    clicks: clicks.length, visitors: Object.keys(uniq).length,
    demos: events.filter(function (e) { return e.Type === 'demo'; }).length,
    checkouts: events.filter(function (e) { return e.Type === 'checkout'; }).length,
    sales: sales.length, revenue: _affMoney(sales.reduce(function (t, c) { return t + (Number(c.SaleAmount) || 0); }, 0)),
    earnings: { pending: _affMoney(money.pending), review: _affMoney(money.review), available: _affMoney(money.available), paid: _affMoney(money.paid), reversed: _affMoney(money.reversed) },
    days: days, subs: Object.keys(subs).map(function (k) { subs[k].earned = _affMoney(subs[k].earned); return subs[k]; }),
    recruits: _affRows('affiliates').filter(function (r) { return _affNormCode(r.RecruitedBy) === code && String(r.Status) === 'approved'; }).length,
    commissions: comms.slice(-200).reverse().map(function (c) {
      return { date: _affTime(c.Timestamp), order: '…' + String(c.OrderId || '').slice(-6), type: c.Type, sale: _affMoney(c.SaleAmount), rate: Number(c.Rate) || 0,
               rateType: String(c.RateType) === 'flat' ? 'flat' : 'percent', amount: _affMoney(c.Commission), currency: c.Currency || 'USD',
               status: _affState(c, now), availableAt: _affTime(c.AvailableAt), via: c.Attribution, sub: c.SubId || '', note: c.Note || '' };
    }),
    payouts: payouts.slice().reverse().map(function (x) {
      return { date: _affTime(x.PaidDate || x.Timestamp), id: x.PayoutId, amount: _affMoney(x.Amount), currency: x.Currency || 'USD', method: x.Method,
               reference: x.Reference || '', referrals: Number(x.Referrals) || 0, status: String(x.Status) === 'void' ? 'void' : 'paid', confirmedAt: _affTime(x.ConfirmedAt) };
    })
  };
}
function _affMe(p) {
  if (!_bucketOk('am', 120)) return { ok: false, error: 'busy' };
  const a = _affBySession(p.s);
  if (!a) return { ok: false, error: 'signed_out' };
  const s = _affSettings(), programs = _affPrograms();
  const code = _affNormCode(a.Code);
  const pr = _affProgramOf(a, programs);
  const coupons = _affCoupons().filter(function (c) { return _affNormCode(c.Affiliate) === code && String(c.Active) === 'yes' && c.DiscountId; })
    .map(function (c) { return { code: String(c.Code), percent: Number(c.Percent), expiresAt: _affTime(c.ExpiresAt), usageLimit: Number(c.UsageLimit) || 0 }; });
  const primary = _affPrimaryCoupon(code);
  const out = {
    ok: true, readOnly: !!a._admin,
    profile: { code: code, name: a.Name, email: a.Email, status: a.Status, method: _affMethod(a.PayoutMethod), payoutEmail: a.PayoutEmail, payoutDetails: a.PayoutDetails || '',
               website: a.Website, discountCode: primary ? String(primary.Code) : '', since: _affTime(a.ApprovedAt || a.CreatedAt) },
    program: Object.assign(_affProgramShape(pr), { payoutSchedule: s.payoutSchedule, price: 49.99, customRate: a.Rate !== '' && a.Rate != null }),
    coupons: coupons
  };
  if (String(a.Status) === 'approved' || String(a.Status) === 'paused') out.stats = _affStats(a, programs);
  return out;
}

// ── Crediting sales (called from the Dodo webhook) ─────────────────────
function _affResolve(d) {
  const codes = String(_dodoDiscountCodes(d) || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  for (var i = 0; i < codes.length; i++) {
    const c = _affCouponByCode(codes[i]);
    const a = c ? _affFind(c.Affiliate) : _affFind(codes[i]);
    if (_affLive(a)) return { a: a, via: 'code', coupon: _affNormCode(codes[i]) };
  }
  const ref = _dodoAffiliate(d);
  if (ref) {
    const a = _affFind(ref);
    if (_affLive(a)) return { a: a, via: 'link' };
  }
  return null;
}
function _affCredit(hit, d, orderId, amount, currency, testMode) {
  const lock = _affLock();
  try {
    const a = hit.a, s = _affSettings(true), programs = _affPrograms();
    const code = _affNormCode(a.Code);
    const comms = _affRows('commissions');
    if (comms.some(function (c) { return String(c.OrderId) === orderId && (c.Type === 'sale'); })) return;
    const cust = d.customer || {};
    const self = s.blockSelf !== 'no' && _normEmail(cust.email) && _normEmail(cust.email) === _normEmail(a.Email);
    const p = _affProgramOf(a, programs);
    const rate = _affRateFor(a, p, _affHistory(code, comms));
    const commission = _affCommission(rate, amount);
    const available = new Date(Date.now() + p.holdDays * 86400000);
    const sub = String((d.metadata && d.metadata.affiliate_sub) || '').slice(0, 40);
    _affAppend('commissions', {
      Timestamp: new Date(), Code: code, OrderId: orderId, Type: 'sale', SaleAmount: _affMoney(amount), Rate: rate.amount, RateType: rate.type,
      Commission: self ? 0 : commission, Currency: currency, Status: self ? 'rejected' : 'pending', AvailableAt: available,
      Attribution: hit.via, SubId: sub, Note: self ? 'Self-referral: the buyer is the partner' : (hit.coupon ? 'Code ' + hit.coupon : ''),
      Test: testMode ? 'test' : '', ProgramId: p.id, Approval: p.approval
    });
    if (!self && !testMode && s.notifySales !== 'no') {
      _affMail(a.Email, 'You made a sale! +$' + commission.toFixed(2), [
        'Nice work, ' + _affFirst(a.Name) + '. Someone just bought the Ultimate Budget Planner through your ' + (hit.via === 'code' ? 'code' : 'link') + '.',
        'Commission: <b>$' + commission.toFixed(2) + '</b>. ' + (p.approval === 'manual'
          ? 'It is reviewed after the ' + p.holdDays + '-day refund window, then added to your next payout.'
          : 'It becomes available to pay out on ' + Utilities.formatDate(available, Session.getScriptTimeZone(), 'd MMM yyyy') + ', after the refund window.')
      ], ['See your dashboard', AFF_SITE + '/partners']);
    }
    // The partner who recruited the seller, on their own program's tier-2 rate.
    if (!self && a.RecruitedBy) {
      const up = _affFind(a.RecruitedBy);
      if (_affLive(up)) {
        const up_p = _affProgramOf(up, programs);
        if (up_p.tier2Rate > 0) {
          _affAppend('commissions', {
            Timestamp: new Date(), Code: _affNormCode(up.Code), OrderId: orderId, Type: 'tier2', SaleAmount: _affMoney(amount), Rate: up_p.tier2Rate, RateType: 'percent',
            Commission: _affMoney(amount * up_p.tier2Rate / 100), Currency: currency, Status: 'pending',
            AvailableAt: new Date(Date.now() + up_p.holdDays * 86400000), Attribution: 'tier2', Note: 'From ' + code + '\'s sale',
            Test: testMode ? 'test' : '', ProgramId: up_p.id, Approval: up_p.approval
          });
        }
      }
    }
  } catch (err) {
  } finally { if (lock) lock.releaseLock(); }
}
// A refund takes the same share back: unpaid commission is reduced or
// reversed, one already paid is clawed back from the next payout.
function _affRefund(paymentId, fraction) {
  const lock = _affLock();
  try {
    const f = Math.max(0, Math.min(1, Number(fraction) || 1));
    _affRows('commissions').forEach(function (c) {
      if (String(c.OrderId) !== String(paymentId) || (c.Type !== 'sale' && c.Type !== 'tier2')) return;
      const st = String(c.Status);
      if (st === 'reversed' || st === 'rejected') return;
      const take = _affMoney((Number(c.Commission) || 0) * f);
      if (st === 'paid') {
        _affAppend('commissions', { Timestamp: new Date(), Code: c.Code, OrderId: paymentId, Type: 'clawback', SaleAmount: 0, Rate: c.Rate, RateType: c.RateType,
          Commission: -take, Currency: c.Currency, Status: 'approved', AvailableAt: new Date(), ApprovedAt: new Date(), Note: 'Refund after payout', Test: c.Test,
          ProgramId: c.ProgramId, Approval: 'auto' });
      } else if (f >= 0.999) {
        _affSetMany('commissions', c._row, { Status: 'reversed', Note: 'Order refunded' });
      } else {
        _affSetMany('commissions', c._row, { Commission: _affMoney((Number(c.Commission) || 0) - take), Note: 'Part refunded (' + Math.round(f * 100) + '%)' });
      }
    });
  } catch (err) {
  } finally { if (lock) lock.releaseLock(); }
}

// ── Admin ──────────────────────────────────────────────────────────────
// The dashboard sends the owner's Google sign-in token, which Google
// confirms here, so nobody else can change the program or move money.
function _affAdminOk(token) {
  if (!token) return false;
  const cache = CacheService.getScriptCache();
  const ck = 'affadm_' + _affHash(token).slice(0, 40);
  if (cache.get(ck)) return true;
  const res = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false;
  const info = JSON.parse(res.getContentText() || '{}');
  const ok = _normEmail(info.email) === _affAdminEmail() && String(info.email_verified) !== 'false';
  if (ok) cache.put(ck, '1', 600);
  return ok;
}
function _affAdmin(p) {
  if (!_bucketOk('ad', 120)) return { ok: false, error: 'busy' };
  if (!_affAdminOk(p.token)) return { ok: false, error: 'not_admin' };
  const lock = _affLock();
  if (!lock) return { ok: false, error: 'busy' };
  try {
    const op = String(p.op || '');
    const fn = _AFF_OPS[op];
    if (!fn) return { ok: false, error: 'unknown_op' };
    return fn(p);
  } finally { lock.releaseLock(); }
}
function _affNeed(code) { const a = _affFind(code); if (!a) throw { aff: 'not_found' }; return a; }
function _affRun(fn) { return function (p) { try { return fn(p); } catch (e) { if (e && e.aff) return { ok: false, error: e.aff }; throw e; } }; }

// Program fields from the dashboard, validated. Returns { fields } or { error }.
function _affProgramFields(p, existing) {
  const f = {};
  const name = String(p.name == null ? (existing ? existing.name : '') : p.name).trim().slice(0, 60);
  if (!name) return { error: 'bad_name' };
  f.Name = name;
  if (p.description != null) f.Description = String(p.description).slice(0, 400);
  const type = String(p.type || (existing ? existing.type : 'percent'));
  if (type !== 'percent' && type !== 'flat') return { error: 'bad_type' };
  f.Type = type;
  const amount = _affNum(p.amount != null ? p.amount : (existing ? existing.amount : ''), 0, type === 'percent' ? 100 : 100000);
  if (amount === null) return { error: 'bad_amount' };
  f.Amount = amount;
  const disc = _affNum(p.buyerDiscount != null ? p.buyerDiscount : (existing ? existing.buyerDiscount : 0), 0, 100);
  if (disc === null) return { error: 'bad_discount' };
  f.BuyerDiscount = disc;
  const cookie = _affNum(p.cookieDays != null ? p.cookieDays : (existing ? existing.cookieDays : 30), 1, 365);
  if (cookie === null) return { error: 'bad_cookie' };
  f.CookieDays = Math.round(cookie);
  const hold = _affNum(p.holdDays != null ? p.holdDays : (existing ? existing.holdDays : 30), 0, 365);
  if (hold === null) return { error: 'bad_hold' };
  f.HoldDays = Math.round(hold);
  const approval = String(p.approval || (existing ? existing.approval : 'auto'));
  if (approval !== 'auto' && approval !== 'manual') return { error: 'bad_approval' };
  f.Approval = approval;
  const minp = _affNum(p.minPayout != null ? p.minPayout : (existing ? existing.minPayout : 0), 0, 100000);
  if (minp === null) return { error: 'bad_min' };
  f.MinPayout = minp;
  let tiers = existing ? existing.tiers : [];
  if (p.tiers != null) {
    try { tiers = JSON.parse(p.tiers || '[]'); } catch (e) { return { error: 'bad_tiers' }; }
    if (!Array.isArray(tiers) || tiers.length > 10) return { error: 'bad_tiers' };
    for (var i = 0; i < tiers.length; i++) {
      const min = _affNum(tiers[i].min, 0.01, 1e9), amt = _affNum(tiers[i].amount, 0, type === 'percent' ? 100 : 100000);
      if (min === null || amt === null) return { error: 'bad_tiers' };
      tiers[i] = { min: min, amount: amt };
    }
    tiers.sort(function (a, b) { return a.min - b.min; });
  }
  f.Tiers = JSON.stringify(tiers);
  const metric = String(p.tierMetric || (existing ? existing.tierMetric : 'sales'));
  if (metric !== 'sales' && metric !== 'revenue') return { error: 'bad_metric' };
  f.TierMetric = metric;
  const t2 = _affNum(p.tier2Rate != null ? p.tier2Rate : (existing ? existing.tier2Rate : 0), 0, 50);
  if (t2 === null) return { error: 'bad_tier2' };
  f.Tier2Rate = t2;
  if (p.active != null) f.Active = String(p.active) === 'no' || String(p.active) === '0' ? 'no' : 'yes';
  return { fields: f };
}
function _affProgramById(id) { return _affPrograms().filter(function (x) { return x.id === String(id); })[0] || null; }
function _affReferralSale(orderId) {
  // The Sales sheet row for a Dodo payment, to keep its Affiliate column in step.
  const sh = _salesSheet();
  const rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (String(rows[i][1]) === 'payment.succeeded' && String(rows[i][2]) === String(orderId)) return { sh: sh, row: i + 1, values: rows[i] };
  return null;
}
function _affPayoutId(code) {
  const base = 'PO-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + code;
  const ids = {};
  _affRows('payouts').forEach(function (x) { ids[String(x.PayoutId)] = 1; });
  let id = base, n = 2;
  while (ids[id]) { id = base + '-' + n; n++; }
  return id;
}

var _AFF_OPS = {
  // ── Global switches
  settings: _affRun(function (p) {
    let changes = {};
    try { changes = JSON.parse(p.values || '{}'); } catch (e) { return { ok: false, error: 'bad_values' }; }
    const sh = _affSheet('settings'), rows = _affRows('settings');
    Object.keys(changes).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(AFF_DEFAULTS, k)) return;
      let v = String(changes[k] == null ? '' : changes[k]).slice(0, 120);
      if (k !== 'payoutSchedule' && k !== 'applicationProgram') v = v === 'yes' || v === 'no' ? v : AFF_DEFAULTS[k][0];
      if (k === 'applicationProgram' && v && !_affProgramById(v)) return;
      const hit = rows.filter(function (r) { return r.Key === k; })[0];
      if (hit) sh.getRange(hit._row, 2).setValue(v); else sh.appendRow([k, v, AFF_DEFAULTS[k][1]]);
    });
    _affSettings(true);
    return { ok: true };
  }),

  // ── Programs
  program_save: _affRun(function (p) {
    const existing = p.id ? _affProgramById(p.id) : null;
    if (p.id && !existing) return { ok: false, error: 'not_found' };
    const r = _affProgramFields(p, existing);
    if (r.error) return { ok: false, error: r.error };
    if (existing) {
      if (existing.isDefault && r.fields.Active === 'no') return { ok: false, error: 'default_active' };
      _affSetMany('programs', existing._row, Object.assign(r.fields, { UpdatedAt: new Date() }));
      return { ok: true, id: existing.id, discountChanged: Number(r.fields.BuyerDiscount) !== existing.buyerDiscount };
    }
    let n = 1;
    const ids = {};
    _affRows('programs').forEach(function (x) { ids[String(x.ProgramId)] = 1; });
    while (ids['P' + n]) n++;
    _affAppend('programs', Object.assign({ ProgramId: 'P' + n, Default: 'no', Active: 'yes', Status: 'live', CreatedAt: new Date(), UpdatedAt: new Date() }, r.fields));
    return { ok: true, id: 'P' + n };
  }),
  program_default: _affRun(function (p) {
    const target = _affProgramById(p.id);
    if (!target) return { ok: false, error: 'not_found' };
    _affPrograms().forEach(function (x) { _affSetMany('programs', x._row, { Default: x.id === target.id ? 'yes' : 'no' }); });
    _affSetMany('programs', target._row, { Active: 'yes' });
    return { ok: true };
  }),
  // Partners on a deleted program move to the default one.
  program_delete: _affRun(function (p) {
    const target = _affProgramById(p.id);
    if (!target) return { ok: false, error: 'not_found' };
    if (target.isDefault) return { ok: false, error: 'is_default' };
    const def = _affDefaultProgram();
    let moved = 0;
    _affRows('affiliates').forEach(function (a) { if (String(a.ProgramId) === target.id) { _affSet('affiliates', a._row, 'ProgramId', def.id); moved++; } });
    _affSetMany('programs', target._row, { Status: 'deleted', Active: 'no', UpdatedAt: new Date() });
    return { ok: true, moved: moved };
  }),
  // Brings every live code of the program's partners to its buyer discount.
  program_sync_codes: _affRun(function (p) {
    const programs = _affPrograms();
    const target = programs.filter(function (x) { return x.id === String(p.id); })[0];
    if (!target) return { ok: false, error: 'not_found' };
    if (target.buyerDiscount <= 0) return { ok: false, error: 'no_discount' };
    const members = {};
    _affRows('affiliates').forEach(function (a) { if (_affProgramOf(a, programs).id === target.id) members[_affNormCode(a.Code)] = 1; });
    let updated = 0, failed = 0;
    _affCoupons().forEach(function (c) {
      if (!members[_affNormCode(c.Affiliate)] || String(c.Active) !== 'yes' || !c.DiscountId) return;
      if (Number(c.Percent) === target.buyerDiscount) return;
      const r = _dodoApi('patch', '/discounts/' + c.DiscountId, { amount: Math.round(target.buyerDiscount * 100) });
      if (r.ok) { _affSet('coupons', c._row, 'Percent', target.buyerDiscount); updated++; } else failed++;
    });
    return { ok: true, updated: updated, failed: failed };
  }),

  // ── Partners
  affiliate_add: _affRun(function (p) {
    const email = _normEmail(p.email);
    if (!_looksLikeEmail(email)) return { ok: false, error: 'bad_email' };
    const name = String(p.name || '').trim().slice(0, 80);
    if (!name) return { ok: false, error: 'bad_name' };
    if (_affRows('affiliates').some(function (r) { return _normEmail(r.Email) === email && String(r.Status) !== 'deleted'; })) return { ok: false, error: 'exists' };
    const wanted = _affNormCode(p.code);
    if (wanted && (wanted.length < 3 || _affFind(wanted) || _affCouponByCode(wanted))) return { ok: false, error: 'code_taken' };
    const prog = p.programId ? _affProgramById(p.programId) : _affDefaultProgram();
    if (!prog) return { ok: false, error: 'bad_program' };
    const code = wanted || _affUniqueCode('', name);
    const status = p.status === 'pending' ? 'pending' : 'approved';
    const rate = String(p.rate == null ? '' : p.rate).trim();
    if (rate && _affNum(rate, 0, String(p.rateType) === 'flat' ? 100000 : 100) === null) return { ok: false, error: 'bad_rate' };
    _affAppend('affiliates', {
      Code: code, Email: email, Name: name, Status: status, ProgramId: prog.id, Rate: rate ? Number(rate) : '', RateType: rate ? (String(p.rateType) === 'flat' ? 'flat' : String(p.rateType) === 'percent' ? 'percent' : '') : '',
      PayoutMethod: _affMethod(p.method), PayoutEmail: _normEmail(p.payout) || email, PayoutDetails: String(p.details || '').slice(0, 500),
      Website: String(p.site || '').slice(0, 200), Notes: String(p.notes || '').slice(0, 500), CreatedAt: new Date(), ApprovedAt: status === 'approved' ? new Date() : '',
      Application: 'Added by admin'
    });
    let coupon = { ok: true, skipped: true };
    if (status === 'approved' && p.coupon !== '0') coupon = _affEnsureCoupon(_affFind(code));
    if (status === 'approved' && p.welcome === '1') _affWelcome(_affFind(code));
    return { ok: true, code: code, coupon: coupon.ok ? (coupon.warning || (coupon.skipped ? 'none' : 'created')) : coupon.error };
  }),
  affiliate_save: _affRun(function (p) {
    const a = _affNeed(p.code);
    const f = {};
    if (p.name != null) { const n = String(p.name).trim().slice(0, 80); if (!n) return { ok: false, error: 'bad_name' }; f.Name = n; }
    if (p.email != null) {
      const e = _normEmail(p.email);
      if (!_looksLikeEmail(e)) return { ok: false, error: 'bad_email' };
      if (e !== _normEmail(a.Email) && _affRows('affiliates').some(function (r) { return _normEmail(r.Email) === e && String(r.Status) !== 'deleted'; })) return { ok: false, error: 'exists' };
      f.Email = e;
    }
    if (p.programId != null) { if (!_affProgramById(p.programId)) return { ok: false, error: 'bad_program' }; f.ProgramId = String(p.programId); }
    if (p.rate != null) {
      const rate = String(p.rate).trim();
      const type = String(p.rateType || '');
      if (rate && _affNum(rate, 0, type === 'flat' ? 100000 : 100) === null) return { ok: false, error: 'bad_rate' };
      f.Rate = rate ? Number(rate) : '';
      f.RateType = rate ? (type === 'flat' || type === 'percent' ? type : '') : '';
    }
    if (p.method != null) f.PayoutMethod = _affMethod(p.method);
    if (p.payout != null) { const pe = _normEmail(p.payout); if (pe && !_looksLikeEmail(pe)) return { ok: false, error: 'bad_payout_email' }; f.PayoutEmail = pe; }
    if (p.details != null) f.PayoutDetails = String(p.details).slice(0, 500);
    if (p.site != null) f.Website = String(p.site).slice(0, 200);
    if (p.notes != null) f.Notes = String(p.notes).slice(0, 500);
    if (p.recruitedBy != null) {
      const r = _affNormCode(p.recruitedBy);
      if (r && (r === _affNormCode(a.Code) || !_affFind(r))) return { ok: false, error: 'bad_recruiter' };
      f.RecruitedBy = r;
    }
    _affSetMany('affiliates', a._row, f);
    return { ok: true };
  }),
  approve: _affRun(function (p) {
    const a = _affNeed(p.code);
    const f = { Status: 'approved' };
    if (!a.ApprovedAt) f.ApprovedAt = new Date();
    if (p.programId) { if (!_affProgramById(p.programId)) return { ok: false, error: 'bad_program' }; f.ProgramId = String(p.programId); }
    _affSetMany('affiliates', a._row, f);
    const c = _affEnsureCoupon(_affFind(a.Code));
    if (p.silent !== '1') _affWelcome(_affFind(a.Code));
    return { ok: true, coupon: c.ok ? (c.warning || (c.skipped ? 'none' : 'created')) : c.error };
  }),
  reject: _affRun(function (p) {
    const a = _affNeed(p.code);
    _affSet('affiliates', a._row, 'Status', 'rejected');
    _affPauseCoupons(_affNormCode(a.Code));
    if (p.notify === '1') _affMail(a.Email, 'Your Ezzo Hub partner application', ['Hi ' + _affFirst(a.Name) + ',', 'Thank you for applying. We are not able to accept your application right now. ' + _affEsc(p.reason || '')]);
    return { ok: true };
  }),
  pause: _affRun(function (p) { const a = _affNeed(p.code); _affSet('affiliates', a._row, 'Status', 'paused'); _affPauseCoupons(_affNormCode(a.Code)); return { ok: true }; }),
  resume: _affRun(function (p) {
    const a = _affNeed(p.code);
    _affSetMany('affiliates', a._row, { Status: 'approved', DeletedAt: '' });
    if (!a.ApprovedAt) _affSet('affiliates', a._row, 'ApprovedAt', new Date());
    const c = _affEnsureCoupon(_affFind(a.Code));
    return { ok: true, coupon: c.ok ? 'ok' : c.error };
  }),
  // Removes a partner: they can no longer sign in or earn, and their codes
  // stop working. Their history and payouts stay for your records.
  delete: _affRun(function (p) {
    const a = _affNeed(p.code);
    _affSetMany('affiliates', a._row, { Status: 'deleted', DeletedAt: new Date(), SessionHash: '', AdminSessionHash: '', LoginHash: '' });
    _affPauseCoupons(_affNormCode(a.Code));
    return { ok: true };
  }),
  login: _affRun(function (p) { const a = _affNeed(p.code); _affLogin({ email: a.Email, _admin: true }); return { ok: true }; }),
  // A short-lived, read-only session to see a partner's dashboard as they do.
  impersonate: _affRun(function (p) {
    const a = _affNeed(p.code);
    const t = _affToken();
    _affSetMany('affiliates', a._row, { AdminSessionHash: _affHash(t), AdminSessionExpires: new Date(Date.now() + AFF_ADMIN_VIEW_MINUTES * 60000) });
    return { ok: true, url: AFF_SITE + '/partners?as=' + t };
  }),

  // ── Coupons
  coupon_add: _affRun(function (p) {
    const a = _affNeed(p.code);
    if (String(a.Status) === 'deleted') return { ok: false, error: 'deleted' };
    const pct = p.percent != null && p.percent !== '' ? p.percent : _affProgramOf(a).buyerDiscount;
    return _affCouponCreate(_affNormCode(a.Code), p.coupon, pct, p.usageLimit, p.expiresAt, p.note);
  }),
  coupon_save: _affRun(function (p) {
    const c = _affCouponByCode(p.coupon);
    if (!c) return { ok: false, error: 'not_found' };
    const f = {}, patch = {};
    if (p.percent != null && p.percent !== '') { const v = _affNum(p.percent, 1, 100); if (v === null) return { ok: false, error: 'bad_percent' }; f.Percent = v; patch.amount = Math.round(v * 100); }
    if (p.usageLimit != null) { const v = String(p.usageLimit).trim(); if (v && _affNum(v, 1, 1e7) === null) return { ok: false, error: 'bad_limit' }; f.UsageLimit = v ? Math.round(Number(v)) : ''; patch.usage_limit = v ? Math.round(Number(v)) : null; }
    if (p.expiresAt != null) { const v = String(p.expiresAt).trim(); if (v && !_affTime(v)) return { ok: false, error: 'bad_date' }; f.ExpiresAt = v ? new Date(v) : ''; patch.expires_at = v ? new Date(v).toISOString() : null; }
    if (p.note != null) f.Note = String(p.note).slice(0, 200);
    if (c.DiscountId && Object.keys(patch).length) {
      const r = _dodoApi('patch', '/discounts/' + c.DiscountId, patch);
      if (!r.ok) return { ok: false, error: r.error };
    }
    _affSetMany('coupons', c._row, f);
    return { ok: true };
  }),
  coupon_toggle: _affRun(function (p) {
    const c = _affCouponByCode(p.coupon);
    if (!c) return { ok: false, error: 'not_found' };
    const r = _affCouponActivate(c, p.active === '1');
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }),
  coupon_delete: _affRun(function (p) {
    const c = _affCouponByCode(p.coupon);
    if (!c) return { ok: false, error: 'not_found' };
    if (c.DiscountId) _dodoApi('delete', '/discounts/' + c.DiscountId);
    _affSetMany('coupons', c._row, { DiscountId: '', Active: 'no', Status: 'deleted' });
    return { ok: true };
  }),

  // ── Referrals
  // A sale you credit by hand, for example when a buyer forgot the code.
  referral_add: _affRun(function (p) {
    const a = _affNeed(p.code);
    if (['approved', 'paused'].indexOf(String(a.Status)) < 0) return { ok: false, error: 'not_active' };
    const sale = _affNum(p.sale, 0, 100000);
    if (sale === null) return { ok: false, error: 'bad_sale' };
    const orderId = String(p.orderId || '').trim().slice(0, 80) || ('MANUAL-' + Date.now().toString(36).toUpperCase());
    const comms = _affRows('commissions');
    if (comms.some(function (c) { return String(c.OrderId) === orderId && c.Type === 'sale' && c.Status !== 'rejected'; }) && p.force !== '1') return { ok: false, error: 'already_credited' };
    const programs = _affPrograms();
    const prog = _affProgramOf(a, programs);
    const rate = _affRateFor(a, prog, _affHistory(_affNormCode(a.Code), comms));
    let commission = _affCommission(rate, sale);
    if (p.commission != null && String(p.commission).trim() !== '') {
      const v = _affNum(p.commission, 0, 100000);
      if (v === null) return { ok: false, error: 'bad_commission' };
      commission = _affMoney(v);
    }
    const status = p.status === 'approved' ? 'approved' : 'pending';
    const when = p.date && _affTime(p.date) ? new Date(p.date) : new Date();
    _affAppend('commissions', {
      Timestamp: when, Code: _affNormCode(a.Code), OrderId: orderId, Type: 'sale', SaleAmount: _affMoney(sale), Rate: rate.amount, RateType: rate.type,
      Commission: commission, Currency: 'USD', Status: status, AvailableAt: status === 'approved' ? new Date() : new Date(when.getTime() + prog.holdDays * 86400000),
      ApprovedAt: status === 'approved' ? new Date() : '', Attribution: 'manual', Note: String(p.note || 'Added by admin').slice(0, 200),
      ProgramId: prog.id, Approval: prog.approval, Manual: 'yes'
    });
    const s = _affReferralSale(orderId);
    if (s) s.sh.getRange(s.row, 14).setValue(_affNormCode(a.Code));
    return { ok: true, commission: commission, orderId: orderId };
  }),
  // Edit one referral: status, commission, note, or the partner it belongs to.
  referral_save: _affRun(function (p) {
    const row = Number(p.row) || 0;
    const c = _affRows('commissions').filter(function (x) { return x._row === row; })[0];
    if (!c) return { ok: false, error: 'not_found' };
    if (String(c.Status) === 'paid') return { ok: false, error: 'already_paid' };
    const f = {};
    if (p.status) {
      if (['pending', 'approved', 'rejected'].indexOf(p.status) < 0) return { ok: false, error: 'bad_status' };
      f.Status = p.status;
      f.ApprovedAt = p.status === 'approved' ? new Date() : '';
      if (p.status === 'pending' && String(c.Status) === 'reversed') return { ok: false, error: 'refunded' };
    }
    if (p.commission != null && String(p.commission).trim() !== '') {
      const v = _affNum(p.commission, c.Type === 'clawback' ? -100000 : 0, 100000);
      if (v === null) return { ok: false, error: 'bad_commission' };
      f.Commission = _affMoney(v);
    }
    if (p.note != null) f.Note = String(p.note).slice(0, 200);
    if (p.to) {
      const to = _affFind(p.to);
      if (!to || String(to.Status) === 'deleted') return { ok: false, error: 'bad_partner' };
      f.Code = _affNormCode(to.Code);
      const s = _affReferralSale(c.OrderId);
      if (s && c.Type === 'sale') s.sh.getRange(s.row, 14).setValue(f.Code);
    }
    _affSetMany('commissions', row, f);
    return { ok: true };
  }),
  // Approve or deny several at once.
  referral_status: _affRun(function (p) {
    if (['approved', 'rejected', 'pending'].indexOf(p.status) < 0) return { ok: false, error: 'bad_status' };
    const want = {};
    String(p.rows || '').split(',').forEach(function (r) { if (Number(r)) want[Number(r)] = 1; });
    let changed = 0, skipped = 0;
    _affRows('commissions').forEach(function (c) {
      if (!want[c._row]) return;
      if (String(c.Status) === 'paid' || String(c.Status) === 'reversed') { skipped++; return; }
      _affSetMany('commissions', c._row, { Status: p.status, ApprovedAt: p.status === 'approved' ? new Date() : '' });
      changed++;
    });
    return { ok: true, changed: changed, skipped: skipped };
  }),

  // ── Payouts
  // Records a payment you made: marks the chosen ready referrals paid, keeps
  // a snapshot of where the money went, and emails the partner a receipt
  // they can confirm from their dashboard.
  payout: _affRun(function (p) {
    const a = _affNeed(p.code);
    const code = _affNormCode(a.Code), now = Date.now();
    const pick = {};
    String(p.rows || '').split(',').forEach(function (r) { if (Number(r)) pick[Number(r)] = 1; });
    const any = Object.keys(pick).length > 0;
    const due = _affRows('commissions').filter(function (c) { return _affNormCode(c.Code) === code && _affPayable(c, now) && (!any || pick[c._row]); });
    if (any && due.length !== Object.keys(pick).length) return { ok: false, error: 'not_payable' };
    const amount = _affMoney(due.reduce(function (t, c) { return t + (Number(c.Commission) || 0); }, 0));
    if (!due.length || amount <= 0) return { ok: false, error: 'nothing_due' };
    const minimum = _affProgramOf(a).minPayout;
    if (amount < minimum && p.force !== '1') return { ok: false, error: 'below_minimum', amount: amount, minimum: minimum };
    const id = _affPayoutId(code);
    const method = p.method ? _affMethod(p.method) : _affMethod(a.PayoutMethod);
    const paidDate = p.paidDate && _affTime(p.paidDate) ? new Date(p.paidDate) : new Date();
    _affAppend('payouts', { Timestamp: new Date(), PayoutId: id, Code: code, Amount: amount, Currency: 'USD', Method: method, PayoutEmail: a.PayoutEmail || a.Email,
      Reference: String(p.reference || '').slice(0, 120), Note: String(p.note || '').slice(0, 200), Details: String(a.PayoutDetails || '').slice(0, 500),
      Referrals: due.length, Status: 'paid', PaidDate: paidDate });
    due.forEach(function (c) { _affSetMany('commissions', c._row, { Status: 'paid', PaidAt: paidDate, PayoutId: id }); });
    if (p.notify !== '0') {
      _affMail(a.Email, 'You have been paid: $' + amount.toFixed(2), [
        'Hi ' + _affFirst(a.Name) + ', we just sent <b>$' + amount.toFixed(2) + '</b> for ' + due.length + ' referral' + (due.length === 1 ? '' : 's') + ' by ' +
          ({ paypal: 'PayPal', wise: 'Wise', bank: 'bank transfer' }[method]) + (method !== 'bank' ? ' (' + _affEsc(a.PayoutEmail || a.Email) + ')' : '') + '.',
        p.reference ? 'Reference: ' + _affEsc(p.reference) : '',
        'Please press "I received it" next to this payout in your dashboard once it arrives, so we both know it landed.'
      ].filter(Boolean), ['Confirm in your dashboard', AFF_SITE + '/partners']);
    }
    return { ok: true, id: id, amount: amount, count: due.length };
  }),
  // Undo a payout recorded by mistake: its referrals go back to ready.
  payout_undo: _affRun(function (p) {
    const po = _affRows('payouts').filter(function (x) { return String(x.PayoutId) === String(p.id); })[0];
    if (!po) return { ok: false, error: 'not_found' };
    if (String(po.Status) === 'void') return { ok: false, error: 'already_void' };
    let n = 0;
    _affRows('commissions').forEach(function (c) {
      if (String(c.PayoutId) !== String(po.PayoutId)) return;
      _affSetMany('commissions', c._row, { Status: 'approved', ApprovedAt: c.ApprovedAt || new Date(), PaidAt: '', PayoutId: '' });
      n++;
    });
    _affSetMany('payouts', po._row, { Status: 'void', VoidedAt: new Date(), Note: (String(po.Note || '') + ' [undone]').trim() });
    return { ok: true, restored: n };
  }),
  payout_save: _affRun(function (p) {
    const po = _affRows('payouts').filter(function (x) { return String(x.PayoutId) === String(p.id); })[0];
    if (!po) return { ok: false, error: 'not_found' };
    const f = {};
    if (p.reference != null) f.Reference = String(p.reference).slice(0, 120);
    if (p.note != null) f.Note = String(p.note).slice(0, 200);
    if (p.paidDate && _affTime(p.paidDate)) f.PaidDate = new Date(p.paidDate);
    _affSetMany('payouts', po._row, f);
    return { ok: true };
  })
};
