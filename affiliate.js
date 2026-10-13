// Affiliate tracking (Affonso). Off until AFFONSO_PROGRAM_ID is filled in.
// Affonso's pixel spots an affiliate's link, remembers the referral in a
// cookie, and the checkout links carry it to Dodo as metadata so the sale
// is credited to the right affiliate.
(function () {
  'use strict';
  // ▼▼ EDIT: your public program ID from Affonso (Program details > Tracking). ▼▼
  var AFFONSO_PROGRAM_ID = '';
  var COOKIE_DAYS = 30;
  // ▲▲ ──────────────────────────────────────────────────────────────────── ▲▲
  if (AFFONSO_PROGRAM_ID) {
    var s = document.createElement('script');
    s.async = true; s.defer = true;
    s.src = 'https://cdn.affonso.io/js/pixel.min.js';
    s.setAttribute('data-affonso', AFFONSO_PROGRAM_ID);
    s.setAttribute('data-cookie_duration', String(COOKIE_DAYS));
    document.head.appendChild(s);
  }
  // The referral the pixel stored, if any.
  window.ezzoAffiliateRef = function () {
    try {
      if (window.affonso_referral) return String(window.affonso_referral);
      var m = document.cookie.match(/(?:^|;\s*)affonso_referral=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  };
  // Adds the referral to a Dodo checkout link (Dodo keeps metadata_* fields on the payment).
  window.ezzoWithAffiliate = function (url) {
    var ref = window.ezzoAffiliateRef();
    if (!ref || !/dodopayments\.com/.test(url)) return url;
    return url + (url.indexOf('?') < 0 ? '?' : '&') + 'metadata_affonso_referral=' + encodeURIComponent(ref);
  };
})();
