// Ezzo Hub's own affiliate program, on the site side. No third-party pixel.
//
// 1. Someone arrives through a partner link (?ref=CODE, also ?via= or ?aff=,
//    optional ?sub= for the partner's own campaign tag). The referral is
//    remembered for the program's cookie window, the latest link winning.
// 2. The click is recorded once per visitor per day, and so are the demo and
//    checkout steps the visitor takes, so partners see their whole funnel.
// 3. The Buy button opens a checkout with the partner's discount already
//    applied and the partner named in the payment, so the sale is credited
//    automatically. If that checkout can't be prepared, the normal checkout
//    link is used with the partner added as metadata, which still credits
//    the sale; the buyer just types the code themselves.
// Partners never get a buyer's details: the payment only names the partner.
(function () {
  'use strict';
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec';
  var STORE = 'ezzo_aff_ref';            // { code, sub, ts, days, name, discount }
  var CHECKOUT_STORE = 'ezzo_aff_checkout';
  var SESSION_STORE = 'ezzo_partner_session';
  var DEFAULT_DAYS = 30;
  var CHECKOUT_TTL = 6 * 3600000;        // Dodo sessions last 24h; refresh well before

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cookie(name, value, days) {
    try { document.cookie = name + '=' + encodeURIComponent(value) + ';path=/;max-age=' + Math.round(days * 86400) + ';SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : ''); } catch (e) {}
  }
  function cookieGet(name) {
    try { var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; }
  }
  function visitorId() {
    try { if (typeof _analyticsVisitorId === 'function') return _analyticsVisitorId(); } catch (e) {}
    var v = read('ezzo_aff_vid');
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); write('ezzo_aff_vid', v); }
    return v;
  }
  function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }
  // JSONP, the same way the rest of the site talks to the Apps Script.
  function call(params, done) {
    var cb = 'ezzoAff' + Math.random().toString(36).slice(2);
    var s = document.createElement('script');
    var finished = false;
    var finish = function (res) {
      if (finished) return; finished = true;
      window[cb] = function () {};
      if (s.parentNode) s.parentNode.removeChild(s);
      if (done) done(res || { ok: false });
    };
    window[cb] = finish;
    params.cb = cb; params._ = Date.now();
    s.src = ENDPOINT + '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); }).join('&');
    s.onerror = function () { finish({ ok: false, error: 'network' }); };
    setTimeout(function () { finish({ ok: false, error: 'timeout' }); }, 15000);
    document.head.appendChild(s);
  }

  // The current referral, if it is still inside its window.
  function current() {
    var r = read(STORE);
    if (r && r.code && Date.now() - r.ts < (r.days || DEFAULT_DAYS) * 86400000) return r;
    var c = cleanCode(cookieGet(STORE));
    return c ? { code: c, sub: '', ts: Date.now(), days: DEFAULT_DAYS } : null;
  }
  // A partner signed in to their own dashboard on this browser is not
  // referred by their own link.
  function isOwnLink(code) {
    var me = read('ezzo_partner_code');
    return me && cleanCode(me) === code && !!read(SESSION_STORE);
  }

  var params = new URLSearchParams(location.search);
  var incoming = cleanCode(params.get('ref') || params.get('via') || params.get('aff'));
  if (incoming && !isOwnLink(incoming)) {
    var sub = String(params.get('sub') || '').slice(0, 40);
    var prev = current();
    var rec = { code: incoming, sub: sub, ts: Date.now(), days: (prev && prev.code === incoming && prev.days) || DEFAULT_DAYS };
    write(STORE, rec);
    write(CHECKOUT_STORE, null);
    cookie(STORE, incoming, rec.days);
    call({ action: 'aff_check', ref: incoming }, function (res) {
      if (!res || !res.ok) {
        // Not a live partner code: forget it, so it can't take a sale.
        // An earlier, genuine referral stays in place.
        var now = read(STORE);
        if (now && now.code === incoming) {
          if (prev && prev.code !== incoming) { write(STORE, prev); cookie(STORE, prev.code, prev.days || DEFAULT_DAYS); }
          else { write(STORE, null); cookie(STORE, '', 0); }
        }
        return;
      }
      var r = read(STORE) || rec;
      r.days = res.cookieDays || DEFAULT_DAYS; r.name = res.name || ''; r.discount = res.discount || 0; r.discountCode = res.discountCode || '';
      write(STORE, r);
      cookie(STORE, incoming, r.days);
      showNote(r);
      prepareCheckout();
    });
    call({ action: 'aff_click', ref: incoming, vid: visitorId(), sub: sub, lp: location.pathname.slice(0, 80),
           rf: (document.referrer || '').slice(0, 200), tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') });
    // Keep the address bar clean once the referral is stored.
    try {
      ['ref', 'via', 'aff', 'sub'].forEach(function (k) { params.delete(k); });
      var q = params.toString();
      history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) {}
  }

  // "Mia sent you: 10% off is already applied." Shown once per referral.
  function showNote(r) {
    if (!r || !r.discount || read('ezzo_aff_note') === r.code + r.ts) return;
    write('ezzo_aff_note', r.code + r.ts);
    var go = function () {
      var el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;max-width:calc(100% - 32px);display:flex;align-items:center;gap:12px;padding:12px 14px 12px 18px;border-radius:999px;background:#1e2240;color:#fff;font:600 14px/1.35 Inter,system-ui,sans-serif;box-shadow:0 18px 40px -16px rgba(30,34,64,.6)';
      var who = r.name ? r.name + ' sent you here. ' : '';
      el.innerHTML = '<span>🎁 ' + who.replace(/[<>&]/g, '') + '<b>' + r.discount + '% off</b> is applied at checkout' + (r.discountCode ? ' (code ' + String(r.discountCode).replace(/[<>&]/g, '') + ')' : '') + '.</span>' +
        '<button type="button" aria-label="Dismiss" style="flex:0 0 auto;width:28px;height:28px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:16px;cursor:pointer">×</button>';
      el.querySelector('button').addEventListener('click', function () { el.remove(); });
      document.body.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.remove(); }, 12000);
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  // A checkout prepared in advance, so the Buy click can open it instantly
  // (opening it after a network round trip would be blocked as a pop-up).
  function prepareCheckout() {
    var r = current();
    if (!r) return;
    var c = read(CHECKOUT_STORE);
    if (c && c.code === r.code && Date.now() - c.ts < CHECKOUT_TTL) return;
    call({ action: 'aff_checkout', ref: r.code, sub: r.sub || '', vid: visitorId() }, function (res) {
      if (res && res.ok && res.url) write(CHECKOUT_STORE, { code: r.code, url: res.url, ts: Date.now() });
    });
  }
  // Only the pages with a Buy button need one ready.
  if (current() && /budgetplanner|ultimate-budget/.test(location.pathname)) prepareCheckout();

  // Funnel steps for the partner: the free demo and the Buy button.
  function wrapTracking() {
    if (typeof window.trackEvent !== 'function' || window.trackEvent._aff) return;
    var original = window.trackEvent;
    var wrapped = function (type, detail) {
      try {
        var r = current();
        if (r && (type === 'trial_started' || type === 'purchase_initiated')) {
          call({ action: 'aff_event', ref: r.code, type: type === 'trial_started' ? 'demo' : 'checkout', vid: visitorId(), sub: r.sub || '' });
        }
      } catch (e) {}
      return original.apply(this, arguments);
    };
    wrapped._aff = true;
    window.trackEvent = wrapped;
  }
  wrapTracking();
  document.addEventListener('DOMContentLoaded', wrapTracking);

  // The referral, for anything else on the page that wants it.
  window.ezzoAffiliateRef = function () { var r = current(); return r ? r.code : ''; };
  // The checkout to open for a Dodo Buy link. The prepared one is used once,
  // then a fresh one is made for next time.
  window.ezzoWithAffiliate = function (url) {
    var r = current();
    if (!r || !/dodopayments\.com/.test(url)) return url;
    var c = read(CHECKOUT_STORE);
    if (c && c.code === r.code && c.url && Date.now() - c.ts < CHECKOUT_TTL) {
      write(CHECKOUT_STORE, null);
      setTimeout(prepareCheckout, 4000);
      return c.url;
    }
    return url + (url.indexOf('?') < 0 ? '?' : '&') + 'metadata_affiliate=' + encodeURIComponent(r.code) + (r.sub ? '&metadata_affiliate_sub=' + encodeURIComponent(r.sub) : '');
  };
})();
