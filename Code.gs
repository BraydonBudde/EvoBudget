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
  return ContentService.createTextOutput('EzzoBudget analytics endpoint.');
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return _ok();
    // Lemon Squeezy's webhook is the only POST that carries ?wh=, and its
    // payloads are far larger than the analytics cap below allows.
    if (e.parameter && e.parameter.wh) return _handleLsWebhook(e);
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
function _blogsSheet()  { return _sheet(BLOGS_SHEET, ['Slug', 'Title', 'Excerpt', 'Category', 'Tool', 'Tags', 'Date', 'ReadMinutes', 'Image', 'ImageAlt', 'Body', 'Related', 'Status', 'Updated']); }
function _notifySheet() { return _sheet(NOTIFY_SHEET, ['Timestamp', 'Email', 'Tool', 'Source', 'VisitorId']); }
function _salesSheet()  { return _sheet(SALES_SHEET, ['Timestamp', 'Event', 'OrderId', 'Email', 'Name', 'Product', 'Variant', 'Total', 'Currency', 'TestMode', 'Status']); }

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
    const orderId = String(a.order_number || (p.data && p.data.id) || '');

    // Lemon Squeezy retries on failure, so the same order can arrive more
    // than once. Recorded once, announced once.
    const sh = _salesSheet();
    const rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][2]) === orderId && String(rows[i][1]) === event) return _ok();
    }

    const total = Number(a.total || 0) / 100;
    const currency = String(a.currency || 'USD');
    const first = (a.first_order_item || {});
    const product = String(first.product_name || a.product_name || 'Ezzo Budget');
    const variant = String(first.variant_name || '');
    const testMode = a.test_mode === true;

    sh.appendRow([new Date(), event, orderId, String(a.user_email || ''), String(a.user_name || ''),
                  product, variant, total, currency, testMode ? 'test' : 'live', String(a.status || '')]);

    if (event === 'order_created') {
      _push('💰 Cha-ching!',
        _money(total, currency) + ' — ' + product + (variant ? ' (' + variant + ')' : '') +
        (testMode ? '\n[TEST MODE]' : '') + (a.user_email ? '\n' + a.user_email : ''),
        'cashregister');
    } else if (event === 'order_refunded') {
      _push('↩️ Refund',
        _money(total, currency) + ' — ' + product + (testMode ? '\n[TEST MODE]' : ''),
        'falling');
    }
    return _ok();
  } catch (err) { return _ok(); }
}

function _money(n, currency) {
  const sym = { USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', ZAR: 'R' }[currency] || (currency + ' ');
  return sym + n.toFixed(2);
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

// Run this from the editor to make the phone chirp without waiting for a
// sale. Set up the properties first, then press Run.
function testChaChing() {
  _push('💰 Cha-ching!', '$49.99 — Ultimate Budget Planner\n[TEST NOTIFICATION]', 'cashregister');
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
