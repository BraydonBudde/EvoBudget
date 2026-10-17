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
// affiliate service, no monthly fee.
//
//   Affiliates   one row per partner: code, contact, status, rate, discount
//   AffClicks    one row per referred visitor per code per day
//   AffEvents    funnel steps a referred visitor took (demo, checkout)
//   Commissions  one row per credited sale, refund clawback or adjustment
//   Payouts      one row per payment sent to a partner
//   AffSettings  the program's terms (rate, discount, cookie, hold, ...)
//
// A sale is credited from the Dodo webhook. The partner is whoever's
// discount code was used, otherwise whoever's link the buyer last arrived
// through (carried in the checkout metadata). Commission is a share of what
// actually reached you (after tax), held for the refund window, and reversed
// if the order is refunded inside it.
//
// Script Properties used here:
//   DODO_API_KEY   lets the program create each partner's discount code and
//                  build checkouts with that code already applied. Without
//                  it, links still track and pay; buyers just type the code.
//   ADMIN_EMAIL    optional; defaults to the account that owns this script.
//
// Run setupAffiliates() once from the editor after pasting this file: it
// creates the sheets and asks for the email permission the program needs.
const AFF_SHEETS = {
  affiliates: ['Code', 'Email', 'Name', 'Status', 'Rate', 'DiscountCode', 'DiscountId', 'PayoutMethod', 'PayoutEmail',
               'Website', 'Audience', 'Application', 'RecruitedBy', 'CreatedAt', 'ApprovedAt', 'LoginHash', 'LoginExpires',
               'SessionHash', 'SessionExpires', 'LastLogin', 'Notes'],
  clicks: ['Timestamp', 'Code', 'VisitorId', 'Landing', 'Referrer', 'SubId', 'Timezone'],
  events: ['Timestamp', 'Code', 'VisitorId', 'Type', 'SubId'],
  commissions: ['Timestamp', 'Code', 'OrderId', 'Type', 'SaleAmount', 'Rate', 'Commission', 'Currency', 'Status',
                'AvailableAt', 'PaidAt', 'PayoutId', 'Attribution', 'SubId', 'Note', 'Test'],
  payouts: ['Timestamp', 'PayoutId', 'Code', 'Amount', 'Currency', 'Method', 'PayoutEmail', 'Reference', 'Note'],
  settings: ['Key', 'Value', 'About']
};
const AFF_SHEET_NAMES = { affiliates: 'Affiliates', clicks: 'AffClicks', events: 'AffEvents', commissions: 'Commissions', payouts: 'Payouts', settings: 'AffSettings' };
const AFF_DEFAULTS = {
  commissionRate: [30, 'Percent of each sale (after tax) paid to the partner'],
  customerDiscount: [10, 'Percent off for buyers using a partner code (0 = no discount)'],
  cookieDays: [30, 'How long a referral link is remembered'],
  holdDays: [30, 'Days a commission waits before it can be paid (covers refunds)'],
  minPayout: [50, 'Smallest balance paid out'],
  bonusSales: [10, 'Lifetime sales that unlock the bonus rate (0 = no bonus tier)'],
  bonusRate: [35, 'Commission percent once the bonus tier is reached'],
  tier2Rate: [0, 'Percent of each sale paid to the partner who recruited the seller (0 = off)'],
  autoApprove: ['no', 'yes = applications are approved straight away'],
  programOpen: ['yes', 'no = the application form is closed'],
  payoutSchedule: ['Monthly, in the first week', 'Shown to partners']
};
const AFF_LOGIN_MINUTES = 30;
const AFF_SESSION_DAYS = 60;
const AFF_SITE = 'https://ezzohub.com';

function setupAffiliates() {
  Object.keys(AFF_SHEETS).forEach(function (k) { _affSheet(k); });
  _affSettings(true);
  // Touching MailApp here is what makes the editor ask for the permission
  // to send the program's emails, once, instead of failing on the first one.
  console.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
  console.log('Affiliate sheets are ready. Admin: ' + _affAdminEmail());
  return 'ok';
}

function _affSheet(kind) {
  const sh = _sheet(AFF_SHEET_NAMES[kind], AFF_SHEETS[kind]);
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
    head.forEach(function (h, c) { o[h] = vals[i][c]; });
    out.push(o);
  }
  return out;
}
function _affSet(kind, row, field, value) {
  const c = AFF_SHEETS[kind].indexOf(field);
  if (c < 0) throw new Error('no field ' + field);
  _affSheet(kind).getRange(row, c + 1).setValue(value);
}
function _affSettings(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) { const hit = cache.get('aff_settings'); if (hit) return JSON.parse(hit); }
  const s = {};
  Object.keys(AFF_DEFAULTS).forEach(function (k) { s[k] = AFF_DEFAULTS[k][0]; });
  _affRows('settings').forEach(function (r) {
    const k = String(r.Key || '').trim();
    if (!k || !Object.prototype.hasOwnProperty.call(s, k)) return;
    if (typeof AFF_DEFAULTS[k][0] === 'number') s[k] = Number(r.Value) || 0;
    else if (k === 'payoutSchedule') s[k] = String(r.Value || AFF_DEFAULTS[k][0]).trim();
    else s[k] = String(r.Value).trim().toLowerCase();
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
function _affFind(code) {
  const c = _affNormCode(code);
  if (!c) return null;
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) if (_affNormCode(rows[i].Code) === c) return rows[i];
  return null;
}
function _affByDiscount(code) {
  const c = _affNormCode(code);
  if (!c) return null;
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) if (_affNormCode(rows[i].DiscountCode || rows[i].Code) === c) return rows[i];
  return null;
}
function _affBySession(token) {
  const t = String(token || '');
  if (t.length < 32) return null;
  const h = _affHash(t);
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].SessionHash === h && _affTime(rows[i].SessionExpires) > Date.now()) return rows[i];
  }
  return null;
}

// ── Email ──────────────────────────────────────────────────────────────
// Plain, branded, short. Every one also works as plain text.
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
function _affEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// ── Dodo API ───────────────────────────────────────────────────────────
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
// Creates (or re-creates) the partner's discount code in Dodo.
function _affEnsureDiscount(a) {
  const s = _affSettings();
  if (!s.customerDiscount) return { ok: true, skipped: true };
  if (a.DiscountId) return { ok: true, id: a.DiscountId };
  const code = _affNormCode(a.DiscountCode || a.Code);
  const r = _dodoApi('post', '/discounts', {
    type: 'percentage', amount: Math.round(s.customerDiscount * 100), code: code,
    name: 'Partner ' + code, restricted_to: [_dodoProductId()], metadata: { affiliate: code }
  });
  if (!r.ok) return r;
  _affSet('affiliates', a._row, 'DiscountCode', r.data.code || code);
  _affSet('affiliates', a._row, 'DiscountId', r.data.discount_id || '');
  return { ok: true, id: r.data.discount_id };
}

// ── Public endpoints (JSONP) ───────────────────────────────────────────
function _handleAffiliate(p) {
  try {
    switch (p.action) {
      case 'aff_program':  return _affProgram();
      case 'aff_check':    return _affCheck(p);
      case 'aff_click':    return _affClick(p);
      case 'aff_event':    return _affEvent(p);
      case 'aff_checkout': return _affCheckout(p);
      case 'aff_apply':    return _affApply(p);
      case 'aff_login':    return _affLogin(p);
      case 'aff_verify':   return _affVerify(p);
      case 'aff_me':       return _affMe(p);
      case 'aff_update':   return _affUpdate(p);
      case 'aff_logout':   return _affLogout(p);
      case 'aff_admin':    return _affAdmin(p);
    }
    return { ok: false, error: 'unknown' };
  } catch (err) { return { ok: false, error: 'server' }; }
}

// The program's public terms, for the partners page.
function _affProgram() {
  const s = _affSettings();
  return { ok: true, commissionRate: s.commissionRate, customerDiscount: s.customerDiscount, cookieDays: s.cookieDays, holdDays: s.holdDays,
           minPayout: s.minPayout, bonusSales: s.bonusSales, bonusRate: s.bonusRate, tier2Rate: s.tier2Rate, open: s.programOpen !== 'no',
           payoutSchedule: s.payoutSchedule, price: 49.99 };
}
// Is this a live partner code? Used for the "10% off from Mia" note.
function _affCheck(p) {
  if (!_bucketOk('ac', 240)) return { ok: false, error: 'busy' };
  const a = _affFind(p.ref);
  const s = _affSettings();
  if (!a || String(a.Status) !== 'approved') return { ok: false, error: 'not_found' };
  return { ok: true, code: _affNormCode(a.Code), name: String(a.Name || '').split(' ')[0], discount: a.DiscountId ? s.customerDiscount : 0,
           discountCode: a.DiscountId ? String(a.DiscountCode || a.Code) : '', cookieDays: s.cookieDays };
}
// One click per visitor per code per day, so a refresh-happy visitor or a
// bot hammering a link counts once.
function _affClick(p) {
  if (!_bucketOk('ak', 300)) return { ok: false, error: 'busy' };
  const a = _affFind(p.ref);
  if (!a || String(a.Status) !== 'approved') return { ok: false, error: 'not_found' };
  const code = _affNormCode(a.Code);
  const vid = String(p.vid || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const k = 'affc_' + code + '_' + vid;
  if (vid && cache.get(k)) return { ok: true, dup: true };
  if (vid) cache.put(k, '1', 21600);
  _affSheet('clicks').appendRow([new Date(), code, vid, String(p.lp || '').slice(0, 80), String(p.rf || '').slice(0, 200),
                                 String(p.sub || '').slice(0, 40), String(p.tz || '').slice(0, 64)]);
  return { ok: true };
}
function _affEvent(p) {
  if (!_bucketOk('ae', 300)) return { ok: false, error: 'busy' };
  const type = p.type === 'demo' || p.type === 'checkout' ? p.type : '';
  const a = _affFind(p.ref);
  if (!type || !a || String(a.Status) !== 'approved') return { ok: false };
  const vid = String(p.vid || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const k = 'affe_' + type + '_' + _affNormCode(a.Code) + '_' + vid;
  if (vid && cache.get(k)) return { ok: true, dup: true };
  if (vid) cache.put(k, '1', 21600);
  _affSheet('events').appendRow([new Date(), _affNormCode(a.Code), vid, type, String(p.sub || '').slice(0, 40)]);
  return { ok: true };
}
// A checkout with the partner's code already applied and the partner named
// in the payment's metadata. Each one is single-use and lasts 24 hours, so
// the site asks for a fresh one as needed.
function _affCheckout(p) {
  if (!_bucketOk('ao', 120)) return { ok: false, error: 'busy' };
  const a = _affFind(p.ref);
  if (!a || String(a.Status) !== 'approved') return { ok: false, error: 'not_found' };
  const code = _affNormCode(a.Code);
  const body = {
    product_cart: [{ product_id: _dodoProductId(), quantity: 1 }],
    metadata: { affiliate: code, affiliate_sub: String(p.sub || '').slice(0, 40) },
    return_url: AFF_SITE + '/budgetplanner?redeem=ubp'
  };
  if (a.DiscountId && a.DiscountCode) body.discount_codes = [String(a.DiscountCode)];
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
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) if (_normEmail(rows[i].Email) === email) return { ok: false, error: 'exists' };
  // The code doubles as the discount code, so it should read well: the one
  // they asked for if it is free, otherwise one made from their name.
  const taken = {};
  rows.forEach(function (r) { taken[_affNormCode(r.Code)] = 1; });
  let code = _affNormCode(p.code);
  if (code.length < 3 || taken[code] || /^(EZZO|ADMIN|TEST)/.test(code)) {
    const base = (_affNormCode(name.split(' ')[0]) || 'PARTNER').slice(0, 10);
    code = base; var n = 2;
    while (taken[code] || code.length < 3) { code = base + n; n++; }
  }
  const recruiter = _affFind(p.recruiter);
  const auto = s.autoApprove === 'yes';
  _affSheet('affiliates').appendRow([code, email, name, auto ? 'approved' : 'pending', '', code, '',
    String(p.method || 'paypal').slice(0, 20), _normEmail(p.payout) || email, String(p.site || '').slice(0, 200),
    String(p.audience || '').slice(0, 40), String(p.promo || '').slice(0, 600),
    recruiter && String(recruiter.Status) !== 'rejected' ? _affNormCode(recruiter.Code) : '', new Date(), auto ? new Date() : '',
    '', '', '', '', '', '']);
  if (auto) {
    const a = _affFind(code);
    _affEnsureDiscount(a);
    _affWelcome(_affFind(code));
  } else {
    _affMail(email, 'We got your Ezzo Hub partner application', [
      'Hi ' + _affEsc(name.split(' ')[0]) + ',',
      'Thanks for applying to the Ezzo Hub partner program. We read every application and usually reply within two working days.',
      'Your requested code is <b>' + code + '</b>. We will confirm it when you are approved.'
    ]);
  }
  _affMail(_affAdminEmail(), 'New partner application: ' + name, [
    _affEsc(name) + ' (' + _affEsc(email) + ') applied as <b>' + code + '</b>.',
    'Website: ' + _affEsc(p.site || '-') + '<br>Audience: ' + _affEsc(p.audience || '-'),
    _affEsc(p.promo || '')
  ], ['Review in the dashboard', AFF_SITE + '/admin']);
  _push('🤝 New partner application', name + ' (' + code + ')', 'magic');
  return { ok: true, code: code, approved: auto };
}
function _affWelcome(a) {
  const s = _affSettings();
  const code = _affNormCode(a.Code);
  const lines = [
    'Hi ' + _affEsc(String(a.Name || '').split(' ')[0]) + ', you are in!',
    'Your link: <b>' + AFF_SITE + '/?ref=' + code + '</b>',
    a.DiscountId && s.customerDiscount ? 'Your code: <b>' + _affEsc(a.DiscountCode || code) + '</b> gives your audience ' + s.customerDiscount + '% off, and every sale with it is yours, even without the link.' : '',
    'You earn ' + (Number(a.Rate) || s.commissionRate) + '% of every sale for ' + s.cookieDays + ' days after someone clicks your link. Sign in to your dashboard any time for links, banners, videos and your earnings.'
  ].filter(Boolean);
  _affMail(a.Email, 'Welcome to the Ezzo Hub partner program', lines, ['Open your dashboard', AFF_SITE + '/partners']);
}

// ── Sign-in: a one-time link by email, then a long-lived session ───────
function _affLogin(p) {
  if (!_bucketOk('al', 30)) return { ok: false, error: 'busy' };
  const email = _normEmail(p.email);
  // Always answers the same way, so the form cannot be used to find out
  // who is a partner.
  const reply = { ok: true };
  if (!_looksLikeEmail(email)) return reply;
  const cache = CacheService.getScriptCache();
  if (cache.get('afl_' + email)) return reply;
  cache.put('afl_' + email, '1', 60);
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) {
    if (_normEmail(rows[i].Email) !== email) continue;
    const a = rows[i];
    if (String(a.Status) === 'rejected') return reply;
    const token = _affToken();
    _affSet('affiliates', a._row, 'LoginHash', _affHash(token));
    _affSet('affiliates', a._row, 'LoginExpires', new Date(Date.now() + AFF_LOGIN_MINUTES * 60000));
    _affMail(email, 'Your Ezzo Hub partner sign-in link', [
      'Here is your sign-in link. It works once and expires in ' + AFF_LOGIN_MINUTES + ' minutes.',
      'If you did not ask for this, you can ignore this email.'
    ], ['Sign in', AFF_SITE + '/partners?login=' + token]);
    return reply;
  }
  return reply;
}
function _affVerify(p) {
  if (!_bucketOk('av', 60)) return { ok: false, error: 'busy' };
  const t = String(p.token || '');
  if (t.length < 32) return { ok: false, error: 'bad_link' };
  const h = _affHash(t);
  const rows = _affRows('affiliates');
  for (var i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (a.LoginHash !== h) continue;
    if (_affTime(a.LoginExpires) < Date.now()) return { ok: false, error: 'expired' };
    const session = _affToken();
    _affSet('affiliates', a._row, 'LoginHash', '');
    _affSet('affiliates', a._row, 'SessionHash', _affHash(session));
    _affSet('affiliates', a._row, 'SessionExpires', new Date(Date.now() + AFF_SESSION_DAYS * 86400000));
    _affSet('affiliates', a._row, 'LastLogin', new Date());
    return { ok: true, session: session };
  }
  return { ok: false, error: 'bad_link' };
}
function _affLogout(p) {
  const a = _affBySession(p.s);
  if (a) _affSet('affiliates', a._row, 'SessionHash', '');
  return { ok: true };
}
function _affUpdate(p) {
  if (!_bucketOk('au', 30)) return { ok: false, error: 'busy' };
  const a = _affBySession(p.s);
  if (!a) return { ok: false, error: 'signed_out' };
  if (p.name) _affSet('affiliates', a._row, 'Name', String(p.name).trim().slice(0, 80));
  if (p.method) _affSet('affiliates', a._row, 'PayoutMethod', String(p.method).slice(0, 20));
  if (p.payout) {
    const pe = _normEmail(p.payout);
    if (!_looksLikeEmail(pe)) return { ok: false, error: 'bad_email' };
    _affSet('affiliates', a._row, 'PayoutEmail', pe);
  }
  if (p.site != null) _affSet('affiliates', a._row, 'Website', String(p.site).slice(0, 200));
  return { ok: true };
}

// Status as the partner sees it: a pending commission becomes available
// once its hold is over.
function _affCommissionState(c, now) {
  const st = String(c.Status);
  if (st === 'pending' && _affTime(c.AvailableAt) <= now) return 'available';
  return st;
}
// Everything one partner's dashboard shows. Buyer details are never sent:
// an order is shown by the end of its id only.
function _affStats(a, s) {
  const code = _affNormCode(a.Code);
  const now = Date.now(), DAY = 86400000;
  const clicks = _affRows('clicks').filter(function (r) { return _affNormCode(r.Code) === code; });
  const events = _affRows('events').filter(function (r) { return _affNormCode(r.Code) === code; });
  const comms = _affRows('commissions').filter(function (r) { return _affNormCode(r.Code) === code && String(r.Test) !== 'test'; });
  const payouts = _affRows('payouts').filter(function (r) { return _affNormCode(r.Code) === code; });
  const sales = comms.filter(function (c) { return c.Type === 'sale' && c.Status !== 'reversed' && c.Status !== 'rejected'; });
  const money = { pending: 0, available: 0, paid: 0, reversed: 0 };
  comms.forEach(function (c) {
    const st = _affCommissionState(c, now);
    const v = Number(c.Commission) || 0;
    if (st === 'pending') money.pending += v;
    else if (st === 'available' || st === 'approved') money.available += v;
    else if (st === 'paid') money.paid += v;
    else if (st === 'reversed') money.reversed += v;
  });
  // 30 days of clicks and sales, oldest first, for the chart.
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
  clicks.forEach(function (c) { const k = String(c.SubId || '') || '(none)'; subs[k] = subs[k] || { sub: k, clicks: 0, sales: 0, earned: 0 }; subs[k].clicks++; });
  sales.forEach(function (c) { const k = String(c.SubId || '') || '(none)'; subs[k] = subs[k] || { sub: k, clicks: 0, sales: 0, earned: 0 }; subs[k].sales++; subs[k].earned += Number(c.Commission) || 0; });
  const lifetimeSales = sales.length;
  const rate = Number(a.Rate) || (s.bonusSales && lifetimeSales >= s.bonusSales && s.bonusRate > s.commissionRate ? s.bonusRate : s.commissionRate);
  const uniq = {};
  clicks.forEach(function (c) { uniq[c.VisitorId || c._row] = 1; });
  const recruits = _affRows('affiliates').filter(function (r) { return _affNormCode(r.RecruitedBy) === code && String(r.Status) === 'approved'; }).length;
  return {
    code: code, rate: rate, lifetimeSales: lifetimeSales,
    clicks: clicks.length, visitors: Object.keys(uniq).length,
    demos: events.filter(function (e) { return e.Type === 'demo'; }).length,
    checkouts: events.filter(function (e) { return e.Type === 'checkout'; }).length,
    sales: lifetimeSales, revenue: _affMoney(sales.reduce(function (t, c) { return t + (Number(c.SaleAmount) || 0); }, 0)),
    earnings: { pending: _affMoney(money.pending), available: _affMoney(money.available), paid: _affMoney(money.paid), reversed: _affMoney(money.reversed) },
    days: days, subs: Object.keys(subs).map(function (k) { subs[k].earned = _affMoney(subs[k].earned); return subs[k]; }),
    recruits: recruits,
    commissions: comms.slice(-150).reverse().map(function (c) {
      return { date: _affTime(c.Timestamp), order: '…' + String(c.OrderId || '').slice(-6), type: c.Type, sale: _affMoney(c.SaleAmount), rate: Number(c.Rate) || 0,
               amount: _affMoney(c.Commission), currency: c.Currency || 'USD', status: _affCommissionState(c, now), availableAt: _affTime(c.AvailableAt),
               via: c.Attribution, sub: c.SubId || '', note: c.Note || '' };
    }),
    payouts: payouts.slice().reverse().map(function (p) { return { date: _affTime(p.Timestamp), id: p.PayoutId, amount: _affMoney(p.Amount), currency: p.Currency || 'USD', method: p.Method, reference: p.Reference || '' }; })
  };
}
function _affMe(p) {
  if (!_bucketOk('am', 120)) return { ok: false, error: 'busy' };
  const a = _affBySession(p.s);
  if (!a) return { ok: false, error: 'signed_out' };
  const s = _affSettings();
  const out = {
    ok: true,
    profile: { code: _affNormCode(a.Code), name: a.Name, email: a.Email, status: a.Status, method: a.PayoutMethod, payoutEmail: a.PayoutEmail,
               website: a.Website, discountCode: a.DiscountId ? String(a.DiscountCode || a.Code) : '', since: _affTime(a.ApprovedAt || a.CreatedAt) },
    program: { commissionRate: s.commissionRate, customerDiscount: s.customerDiscount, cookieDays: s.cookieDays, holdDays: s.holdDays, minPayout: s.minPayout,
               bonusSales: s.bonusSales, bonusRate: s.bonusRate, tier2Rate: s.tier2Rate, payoutSchedule: s.payoutSchedule, price: 49.99 }
  };
  if (String(a.Status) === 'approved' || String(a.Status) === 'paused') out.stats = _affStats(a, s);
  return out;
}

// ── Crediting sales (called from the Dodo webhook) ─────────────────────
// Returns the partner for a payment, and how they were found.
function _affResolve(d) {
  const codes = String(_dodoDiscountCodes(d) || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  for (var i = 0; i < codes.length; i++) {
    const a = _affByDiscount(codes[i]);
    if (a && String(a.Status) === 'approved') return { a: a, via: 'code' };
  }
  const ref = _dodoAffiliate(d);
  if (ref) {
    const a = _affFind(ref);
    if (a && String(a.Status) === 'approved') return { a: a, via: 'link' };
  }
  return null;
}
function _affCredit(hit, d, orderId, amount, currency, testMode) {
  try {
    const a = hit.a, s = _affSettings(true);
    const code = _affNormCode(a.Code);
    const existing = _affRows('commissions').some(function (c) { return String(c.OrderId) === orderId && c.Type === 'sale'; });
    if (existing) return;
    const cust = d.customer || {};
    // A partner buying through their own link or code earns nothing on it.
    const self = _normEmail(cust.email) && _normEmail(cust.email) === _normEmail(a.Email);
    const lifetime = _affRows('commissions').filter(function (c) { return _affNormCode(c.Code) === code && c.Type === 'sale' && c.Status !== 'reversed' && c.Status !== 'rejected' && String(c.Test) !== 'test'; }).length;
    const rate = Number(a.Rate) || (s.bonusSales && lifetime >= s.bonusSales && s.bonusRate > s.commissionRate ? s.bonusRate : s.commissionRate);
    const commission = _affMoney(amount * rate / 100);
    const available = new Date(Date.now() + s.holdDays * 86400000);
    const sub = String((d.metadata && d.metadata.affiliate_sub) || '').slice(0, 40);
    _affSheet('commissions').appendRow([new Date(), code, orderId, 'sale', _affMoney(amount), rate, self ? 0 : commission, currency,
      self ? 'rejected' : 'pending', available, '', '', hit.via, sub, self ? 'Self-referral: the buyer is the partner' : '', testMode ? 'test' : '']);
    if (!self && !testMode) {
      _affMail(a.Email, 'You made a sale! +$' + commission.toFixed(2), [
        'Nice work, ' + _affEsc(String(a.Name || '').split(' ')[0]) + '. Someone just bought the Ultimate Budget Planner through your ' + (hit.via === 'code' ? 'code' : 'link') + '.',
        'Commission: <b>$' + commission.toFixed(2) + '</b> (' + rate + '%). It becomes available to pay out on ' + Utilities.formatDate(available, Session.getScriptTimeZone(), 'd MMM yyyy') + ', after the refund window.'
      ], ['See your dashboard', AFF_SITE + '/partners']);
    }
    // The partner who brought this one in, if second-tier rewards are on.
    if (!self && s.tier2Rate > 0 && a.RecruitedBy) {
      const up = _affFind(a.RecruitedBy);
      if (up && String(up.Status) === 'approved') {
        _affSheet('commissions').appendRow([new Date(), _affNormCode(up.Code), orderId, 'tier2', _affMoney(amount), s.tier2Rate,
          _affMoney(amount * s.tier2Rate / 100), currency, 'pending', available, '', '', 'tier2', '', 'From ' + code + '\'s sale', testMode ? 'test' : '']);
      }
    }
  } catch (err) {}
}
// A refund takes the same share back. Unpaid commission is reduced or
// reversed; one already paid out is clawed back from the next payout.
function _affRefund(paymentId, fraction) {
  try {
    const f = Math.max(0, Math.min(1, Number(fraction) || 1));
    _affRows('commissions').forEach(function (c) {
      if (String(c.OrderId) !== String(paymentId) || (c.Type !== 'sale' && c.Type !== 'tier2')) return;
      const st = String(c.Status);
      if (st === 'reversed' || st === 'rejected') return;
      const take = _affMoney((Number(c.Commission) || 0) * f);
      if (st === 'paid') {
        _affSheet('commissions').appendRow([new Date(), c.Code, paymentId, 'clawback', 0, c.Rate, -take, c.Currency, 'approved', new Date(), '', '', '', '', 'Refund after payout', c.Test]);
      } else if (f >= 0.999) {
        _affSet('commissions', c._row, 'Status', 'reversed');
        _affSet('commissions', c._row, 'Note', 'Order refunded');
      } else {
        _affSet('commissions', c._row, 'Commission', _affMoney((Number(c.Commission) || 0) - take));
        _affSet('commissions', c._row, 'Note', 'Part refunded (' + Math.round(f * 100) + '%)');
      }
    });
  } catch (err) {}
}

// ── Admin actions ──────────────────────────────────────────────────────
// The dashboard sends the owner's own Google sign-in token, which Google
// confirms here, so nobody else can approve partners or move money.
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
  if (!_bucketOk('ad', 60)) return { ok: false, error: 'busy' };
  if (!_affAdminOk(p.token)) return { ok: false, error: 'not_admin' };
  const op = String(p.op || '');
  if (op === 'settings') {
    const sh = _affSheet('settings');
    const rows = _affRows('settings');
    let changes = {};
    try { changes = JSON.parse(p.values || '{}'); } catch (e) { return { ok: false, error: 'bad_values' }; }
    Object.keys(changes).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(AFF_DEFAULTS, k)) return;
      const hit = rows.filter(function (r) { return r.Key === k; })[0];
      if (hit) sh.getRange(hit._row, 2).setValue(changes[k]);
      else sh.appendRow([k, changes[k], AFF_DEFAULTS[k][1]]);
    });
    _affSettings(true);
    return { ok: true };
  }
  if (op === 'payout') {
    const a = _affFind(p.code);
    if (!a) return { ok: false, error: 'not_found' };
    const code = _affNormCode(a.Code), now = Date.now();
    const due = _affRows('commissions').filter(function (c) {
      const st = _affCommissionState(c, now);
      return _affNormCode(c.Code) === code && (st === 'available' || st === 'approved') && String(c.Test) !== 'test';
    });
    const amount = _affMoney(due.reduce(function (t, c) { return t + (Number(c.Commission) || 0); }, 0));
    if (amount <= 0) return { ok: false, error: 'nothing_due' };
    const id = 'PO-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + code;
    _affSheet('payouts').appendRow([new Date(), id, code, amount, 'USD', a.PayoutMethod, a.PayoutEmail, String(p.reference || '').slice(0, 120), String(p.note || '').slice(0, 200)]);
    due.forEach(function (c) {
      _affSet('commissions', c._row, 'Status', 'paid');
      _affSet('commissions', c._row, 'PaidAt', new Date());
      _affSet('commissions', c._row, 'PayoutId', id);
    });
    _affMail(a.Email, 'You have been paid: $' + amount.toFixed(2), [
      'Hi ' + _affEsc(String(a.Name || '').split(' ')[0]) + ', we just sent <b>$' + amount.toFixed(2) + '</b> to your ' + _affEsc(a.PayoutMethod || 'PayPal') + ' account (' + _affEsc(a.PayoutEmail) + ').',
      p.reference ? 'Reference: ' + _affEsc(p.reference) : '',
      'Thank you for sharing Ezzo Hub.'
    ].filter(Boolean), ['See your dashboard', AFF_SITE + '/partners']);
    return { ok: true, id: id, amount: amount };
  }
  const a = _affFind(p.code);
  if (!a) return { ok: false, error: 'not_found' };
  if (op === 'approve') {
    _affSet('affiliates', a._row, 'Status', 'approved');
    if (!a.ApprovedAt) _affSet('affiliates', a._row, 'ApprovedAt', new Date());
    const d = _affEnsureDiscount(_affFind(a.Code));
    if (p.silent !== '1') _affWelcome(_affFind(a.Code));
    return { ok: true, discount: d.ok ? (d.skipped ? 'off' : 'created') : d.error };
  }
  if (op === 'reject' || op === 'pause' || op === 'resume') {
    _affSet('affiliates', a._row, 'Status', op === 'reject' ? 'rejected' : op === 'pause' ? 'paused' : 'approved');
    if (op === 'reject' && p.notify === '1') _affMail(a.Email, 'Your Ezzo Hub partner application', ['Hi ' + _affEsc(String(a.Name || '').split(' ')[0]) + ',', 'Thank you for applying. We are not able to accept your application right now. ' + _affEsc(p.reason || '')]);
    // A paused or removed partner's discount code stops working too.
    if (op !== 'resume' && a.DiscountId) { _dodoApi('delete', '/discounts/' + a.DiscountId); _affSet('affiliates', a._row, 'DiscountId', ''); }
    if (op === 'resume') _affEnsureDiscount(_affFind(a.Code));
    return { ok: true };
  }
  if (op === 'rate') {
    const r = String(p.rate || '').trim();
    if (r && !(Number(r) >= 0 && Number(r) <= 90)) return { ok: false, error: 'bad_rate' };
    _affSet('affiliates', a._row, 'Rate', r ? Number(r) : '');
    return { ok: true };
  }
  if (op === 'note') { _affSet('affiliates', a._row, 'Notes', String(p.note || '').slice(0, 500)); return { ok: true }; }
  if (op === 'commission') {
    // Reject or restore one commission row (by sheet row number).
    const row = Number(p.row) || 0;
    const c = _affRows('commissions').filter(function (x) { return x._row === row; })[0];
    if (!c || _affNormCode(c.Code) !== _affNormCode(a.Code)) return { ok: false, error: 'not_found' };
    if (String(c.Status) === 'paid') return { ok: false, error: 'already_paid' };
    _affSet('commissions', row, 'Status', p.status === 'rejected' ? 'rejected' : 'pending');
    _affSet('commissions', row, 'Note', String(p.note || (p.status === 'rejected' ? 'Rejected by admin' : '')).slice(0, 200));
    return { ok: true };
  }
  if (op === 'login') {
    // Sends the partner a fresh sign-in link, for when they ask.
    _affLogin({ email: a.Email });
    return { ok: true };
  }
  return { ok: false, error: 'unknown_op' };
}
