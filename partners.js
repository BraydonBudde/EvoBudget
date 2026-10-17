// The partner program page: the public pitch and application, email-link
// sign-in, and each partner's own dashboard. Everything is read from and
// written to the site's Apps Script (see the AFFILIATE PROGRAM section of
// Code.gs); nothing about a partner is kept here except their session.
(function () {
  'use strict';
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbzill8JQ1BwGzjBMmVm8ucbco-lF1ouvZr6KmDe_CyfloJCzy69Xi-ZSheARQtR0InO/exec';
  var SESSION_STORE = 'ezzo_partner_session';
  var VIEW_STORE = 'ezzo_partner_view';   // admin "view as partner", this tab only
  var CODE_STORE = 'ezzo_partner_code';
  var SITE = 'https://ezzohub.com';
  var THEMES = [['frosty', 'Frosty'], ['light', 'Light'], ['peachy', 'Peachy'], ['dark', 'Dark'], ['vintage-ledger', 'Vintage Ledger'], ['jolly', 'Jolly']];
  var BANNERS = [
    ['1080x1080_square-post', 'Square post', '1080 × 1080'], ['1080x1080_square-post-receipt', 'Square post, receipt', '1080 × 1080'],
    ['1080x1350_portrait-post', 'Portrait post', '1080 × 1350'], ['1080x1920_story', 'Story', '1080 × 1920'],
    ['1000x1500_pinterest-pin', 'Pinterest pin', '1000 × 1500'], ['1200x628_link-share', 'Link share', '1200 × 628'],
    ['300x250_medium-rectangle', 'Medium rectangle', '300 × 250'], ['336x280_large-rectangle', 'Large rectangle', '336 × 280'],
    ['728x90_leaderboard', 'Leaderboard', '728 × 90'], ['970x250_billboard', 'Billboard', '970 × 250'],
    ['300x600_half-page', 'Half page', '300 × 600'], ['160x600_skyscraper', 'Skyscraper', '160 × 600'], ['320x50_mobile-banner', 'Mobile banner', '320 × 50']
  ];
  var VIDEOS = [['safe-to-spend', 'Safe to spend'], ['same-paycheck', 'Same paycheck'], ['stop-renting', 'Stop renting your budget']];
  var KIT = 'marketing/affiliate-kit/';

  // The terms on show: the program new partners join (public page) or the
  // partner's own program (dashboard). Same shape as the Apps Script sends.
  var program = { name: 'Standard', type: 'percent', amount: 30, buyerDiscount: 10, cookieDays: 30, holdDays: 30, approval: 'auto', minPayout: 50,
                  tiers: [{ min: 10, amount: 35 }], tierMetric: 'sales', tier2Rate: 0, open: true, autoApprove: true, payoutSchedule: 'Monthly, in the first week', price: 49.99 };
  var readOnly = false;
  var me = null;
  var tab = 'overview';
  var creativeTheme = 'frosty';

  // ── Helpers ──────────────────────────────────────────────────────────
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return [].slice.call((el || document).querySelectorAll(s)); }
  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }
  function money(n) { return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function whole(n) { return (Number(n) || 0).toLocaleString('en-US'); }
  function date(t) { return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function call(params) {
    return new Promise(function (resolve) {
      var cb = 'ezzoPt' + Math.random().toString(36).slice(2);
      var s = document.createElement('script');
      var done = false;
      var finish = function (res) {
        if (done) return; done = true;
        window[cb] = function () {};
        if (s.parentNode) s.parentNode.removeChild(s);
        resolve(res || { ok: false, error: 'failed' });
      };
      window[cb] = finish;
      params.cb = cb; params._ = Date.now();
      s.src = ENDPOINT + '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); }).join('&');
      s.onerror = function () { finish({ ok: false, error: 'network' }); };
      setTimeout(function () { finish({ ok: false, error: 'timeout' }); }, 25000);
      document.head.appendChild(s);
    });
  }
  function toast(msg) {
    var t = $('#ptToast');
    if (!t) { t = document.createElement('div'); t.id = 'ptToast'; t.className = 'pt-flash'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('is-on');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('is-on'); }, 2400);
  }
  function copy(text, label) {
    var ok = function () { toast((label || 'Copied') + ' ✓'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('Could not copy'); }
      ta.remove();
    }
  }

  // ── Public page ──────────────────────────────────────────────────────
  function rateText(type, amount) { return type === 'flat' ? '$' + Number(amount).toFixed(Number(amount) % 1 ? 2 : 0) : Number(amount) + '%'; }
  function netPrice() { return program.price * (1 - (Number(program.buyerDiscount) || 0) / 100); }
  function perSale(amount, type) {
    type = type || program.type; amount = amount == null ? program.amount : amount;
    return type === 'flat' ? Math.min(Number(amount), netPrice()) : netPrice() * Number(amount) / 100;
  }
  // The rate for the n-th sale (1-based) under the program's tiers.
  function rateForSale(n) {
    var amt = program.amount;
    (program.tiers || []).forEach(function (t) {
      var reached = program.tierMetric === 'revenue' ? (n - 1) * netPrice() >= t.min : n - 1 >= t.min;
      if (reached) amt = t.amount;
    });
    return amt;
  }
  function tierText(t) { return program.tierMetric === 'revenue' ? '$' + whole(t.min) + ' in sales' : t.min + ' sale' + (t.min === 1 ? '' : 's'); }
  function fillProgram() {
    var top = (program.tiers || []).slice(-1)[0];
    var vals = Object.assign({}, program, {
      customerDiscount: program.buyerDiscount,
      rateText: rateText(program.type, program.amount),
      rateLong: program.type === 'flat' ? rateText('flat', program.amount) + ' for every sale' : program.amount + '% of what they pay',
      rateTermsText: program.type === 'flat' ? 'for every sale your link or code brings in' : 'of each sale, worked out on the price paid after the discount and before tax',
      rateShort: program.type === 'flat' ? 'for every sale' : 'commission on every sale',
      applyNote: program.autoApprove === false ? 'Tell us where you share. We read every application and usually reply within two working days.' : 'Fill in a short form and get your link and code straight away.',
      bonusRate: top ? rateText(program.type, top.amount) : '', bonusSales: top ? tierText(top) : '',
      perSale: perSale().toFixed(2),
      payoutScheduleLower: String(program.payoutSchedule || 'monthly').replace(/^./, function (c) { return c.toLowerCase(); }).replace(/,.*$/, '')
    });
    $$('[data-p]').forEach(function (el) { var k = el.getAttribute('data-p'); if (vals[k] != null) el.textContent = vals[k]; });
    $$('[data-show="tiers"]').forEach(function (el) { el.hidden = !top; });
    if (!program.open) {
      var f = $('#ptApplyForm');
      if (f) f.innerHTML = '<p class="pt-closed">Applications are closed for now. Please check back soon.</p>';
    }
    calc();
  }
  function calc() {
    var r = $('#ptCalcRange'); if (!r) return;
    var n = Number(r.value) || 0;
    var month = 0;
    for (var i = 1; i <= n; i++) month += perSale(rateForSale(i));
    $('#ptCalcSales').textContent = n;
    $('#ptCalcMonth').textContent = '$' + Math.round(month).toLocaleString('en-US');
    $('#ptCalcYear').textContent = '$' + Math.round(month * 12).toLocaleString('en-US');
    r.style.setProperty('--fill', ((n - r.min) / (r.max - r.min) * 100) + '%');
  }
  function wirePublic() {
    $('#ptCalcRange') && $('#ptCalcRange').addEventListener('input', calc);
    $$('[data-signin]').forEach(function (b) { b.addEventListener('click', openSignin); });
    // "Program terms" in the agree box opens the full terms just below it.
    $$('a[href="#terms"]').forEach(function (l) { l.addEventListener('click', function () { var d = $('#terms'); if (d) d.open = true; }); });
    var modal = $('#ptSignin');
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.closest('[data-close]')) closeSignin(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeSignin(); });
    $('#ptSigninForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = this.email.value.trim(), msg = $('#ptSigninMsg'), btn = this.querySelector('button');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Please enter the email you joined with.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      call({ action: 'aff_login', email: email }).then(function (res) {
        btn.disabled = false; btn.textContent = 'Email me a sign-in link';
        msg.textContent = res.ok ? 'If that email belongs to a partner, a sign-in link is on its way. It works for 30 minutes.' : 'Something went wrong. Please try again in a minute.';
      });
    });
    var form = $('#ptApplyForm');
    form && form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form, msg = $('#ptApplyMsg'), btn = f.querySelector('button[type=submit]');
      var data = { name: f.name.value.trim(), email: f.email.value.trim(), site: f.site.value.trim(), audience: f.audience.value, code: f.code.value.trim(),
                   promo: f.promo.value.trim(), method: f.method.value, payout: f.payout.value.trim() };
      msg.className = 'pt-form-msg';
      if (!data.name) return fail('Please add your name.', f.name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return fail('That email does not look right.', f.email);
      if (data.payout && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.payout)) return fail('The payout email does not look right.', f.payout);
      if (!f.agree.checked) return fail('Please agree to the program terms.', f.agree);
      btn.disabled = true; btn.textContent = 'Sending…';
      var ref = typeof window.ezzoAffiliateRef === 'function' ? window.ezzoAffiliateRef() : '';
      call(Object.assign({ action: 'aff_apply', recruiter: ref }, data)).then(function (res) {
        btn.disabled = false; btn.textContent = 'Join the program';
        if (res.ok) {
          f.innerHTML = '<div class="pt-done"><i>🎉</i><h3>' + (res.approved ? 'You\'re in!' : 'Application sent') + '</h3><p>' +
            (res.approved ? 'Check your inbox for your link and code, then sign in to your dashboard.' : 'Thanks, ' + esc(data.name.split(' ')[0]) + '. We\'ll email you at ' + esc(data.email) + ' within two working days. Your requested code is <b>' + esc(res.code) + '</b>.') +
            '</p></div>';
          return;
        }
        fail({ exists: 'That email is already a partner. Use "Sign in" to get to your dashboard.', bad_email: 'That email does not look right.', closed: 'Applications are closed right now.', busy: 'Lots of applications right now. Please try again in a minute.' }[res.error] || 'Could not send that just now. Please try again.');
      });
      function fail(text, el) { msg.textContent = text; msg.classList.add('is-err'); if (el && el.focus) el.focus(); return false; }
    });
  }
  function openSignin() { var m = $('#ptSignin'); m.hidden = false; setTimeout(function () { m.querySelector('input').focus(); }, 30); }
  function closeSignin() { $('#ptSignin').hidden = true; }

  // A little life in the hero: the mock dashboard ticks up now and then.
  function animateMock() {
    var el = $('#ptMockNum'); if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var v = 374.92;
    setInterval(function () { v += perSale(); el.textContent = v.toFixed(2); el.parentNode.classList.remove('is-bump'); void el.offsetWidth; el.parentNode.classList.add('is-bump'); }, 5200);
  }

  // ── Signed in ────────────────────────────────────────────────────────
  function session() {
    try { var v = sessionStorage.getItem(VIEW_STORE); if (v) return v; } catch (e) {}
    return read(SESSION_STORE);
  }
  function isAdminView() { try { return !!sessionStorage.getItem(VIEW_STORE); } catch (e) { return false; } }
  function showApp(on) {
    $('#ptPublic').hidden = on; $('#ptApp').hidden = !on;
    $$('[data-public]').forEach(function (el) { el.hidden = on; });
    $$('[data-app]').forEach(function (el) { el.hidden = !on; });
    document.title = on ? 'Partner dashboard | Ezzo Hub' : document.title;
  }
  function signOut() {
    if (isAdminView()) { try { sessionStorage.removeItem(VIEW_STORE); } catch (e) {} me = null; showApp(false); window.close(); return; }
    call({ action: 'aff_logout', s: session() });
    write(SESSION_STORE, null); write(CODE_STORE, null);
    me = null; showApp(false); window.scrollTo(0, 0);
  }
  function load(quiet) {
    var app = $('#ptApp');
    if (!quiet) app.innerHTML = '<div class="pt-loading"><span></span>Loading your dashboard…</div>';
    return call({ action: 'aff_me', s: session() }).then(function (res) {
      if (!res.ok) {
        if (res.error === 'signed_out') {
          if (isAdminView()) { try { sessionStorage.removeItem(VIEW_STORE); } catch (e) {} app.innerHTML = '<div class="pt-loading">This admin view has expired. Open it again from the dashboard.</div>'; return; }
          write(SESSION_STORE, null); showApp(false); openSignin(); $('#ptSigninMsg').textContent = 'Your session ended. Sign in again with your email.'; return;
        }
        app.innerHTML = '<div class="pt-loading">Could not load your dashboard. <button class="lx-btn lx-btn--small" type="button" id="ptRetry">Try again</button></div>';
        $('#ptRetry').addEventListener('click', function () { load(); });
        return;
      }
      me = res;
      readOnly = !!res.readOnly;
      Object.assign(program, res.program || {});
      if (!readOnly) write(CODE_STORE, JSON.stringify(res.profile.code));
      render();
    });
  }
  function link(path, sub) {
    var u = SITE + path;
    return u + (u.indexOf('?') < 0 ? '?' : '&') + 'ref=' + me.profile.code + (sub ? '&sub=' + encodeURIComponent(sub) : '');
  }
  function render() {
    var app = $('#ptApp'), p = me.profile;
    if (p.status === 'pending' || p.status === 'rejected') {
      app.innerHTML = '<div class="pt-wait"><i>' + (p.status === 'pending' ? '⏳' : '📭') + '</i><h1>' + (p.status === 'pending' ? 'Your application is being reviewed' : 'Your application was not accepted') + '</h1><p>' +
        (p.status === 'pending' ? 'Thanks, ' + esc(String(p.name).split(' ')[0]) + '. We usually reply within two working days, by email to ' + esc(p.email) + '. Your requested code is <b>' + esc(p.code) + '</b>.' : 'Thank you for your interest. You can reply to our email if you think we got it wrong.') +
        '</p></div>';
      return;
    }
    var tabs = [['overview', '📊', 'Overview'], ['links', '🔗', 'Links & codes'], ['creatives', '🖼️', 'Creatives'], ['earnings', '💸', 'Earnings'], ['settings', '⚙️', 'Settings']];
    var code = p.discountCode || p.code, mainLink = link('/budgetplanner');
    var r = me.stats ? me.stats.rate : { type: program.type, amount: program.amount };
    app.innerHTML =
      '<div class="pt-app-head"><div><p class="pt-app-hi">Hi ' + esc(String(p.name).split(' ')[0]) + ' 👋</p><h1>Your partner dashboard</h1>' +
        '<div class="pt-app-meta"><span>' + esc(program.name || 'Standard') + ' program</span><span>' + rateText(r.type, r.amount) + (r.type === 'flat' ? ' per sale' : ' commission') + '</span><span>Partner since ' + date(p.since) + '</span></div></div>' +
      '<div class="pt-app-code"><div class="pt-app-code-row"><span>Your code</span><b>' + esc(code) + '</b></div>' +
        '<div class="pt-app-code-btns"><button type="button" class="lx-btn lx-btn--small" data-copy="' + esc(code) + '" data-copy-label="Code copied">Copy code</button>' +
        '<button type="button" class="lx-btn lx-btn--primary lx-btn--small" data-copy="' + esc(mainLink) + '" data-copy-label="Link copied">Copy link</button></div></div></div>' +
      (readOnly ? '<div class="pt-banner pt-banner--admin">👁 Admin view of ' + esc(p.name) + '\'s dashboard. Read-only: nothing can be changed from here.</div>' : '') +
      (p.status === 'paused' ? '<div class="pt-banner">Your partnership is paused, so new clicks and sales are not being credited right now. Reply to any of our emails if you have questions.</div>' : '') +
      '<nav class="pt-tabs" role="tablist" aria-label="Dashboard sections">' + tabs.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (tab === t[0]) + '" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'is-on' : '') + '"><span aria-hidden="true">' + t[1] + '</span>' + t[2] + '</button>'; }).join('') + '</nav>' +
      '<div id="ptTab"></div>';
    $$('.pt-tabs [data-tab]', app).forEach(function (b) { b.addEventListener('click', function () { tab = b.dataset.tab; render(); }); });
    wireCopy(app);
    var body = $('#ptTab');
    ({ overview: renderOverview, links: renderLinks, creatives: renderCreatives, earnings: renderEarnings, settings: renderSettings }[tab] || renderOverview)(body);
    wireCopy(body);
    stackTables(app);
  }
  // A table while it fits, label/value cards when it doesn't: never a
  // sideways scroll. Re-checked whenever the window changes size.
  function stackTables(scope) {
    $$('.pt-table', scope).forEach(function (t) {
      var heads = $$('thead th', t).map(function (th) { return th.textContent.trim(); });
      $$('tbody tr', t).forEach(function (tr) { [].slice.call(tr.children).forEach(function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); }); });
      t.classList.remove('is-stacked');
      if (t.scrollWidth > t.parentElement.clientWidth + 1) t.classList.add('is-stacked');
    });
  }
  var resizeT;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (me) stackTables($('#ptApp')); }, 120); });
  function wireCopy(scope) {
    $$('[data-copy]', scope).forEach(function (b) { if (b._w) return; b._w = 1; b.addEventListener('click', function () { copy(b.dataset.copy, b.dataset.copyLabel); }); });
  }
  function stat(label, value, sub, tone, icon) {
    return '<div class="pt-stat" style="--tone:' + (tone || '#7651f0') + '"><i aria-hidden="true">' + (icon || '📈') + '</i><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }
  function chart(days) {
    var w = 720, h = 170, pad = 22;
    var maxC = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.clicks; })));
    var bw = (w - pad * 2) / days.length;
    var bars = days.map(function (d, i) {
      var bh = Math.round((h - pad * 2) * d.clicks / maxC);
      var x = pad + i * bw + bw * 0.18;
      var sale = d.sales ? '<circle cx="' + (x + bw * 0.32).toFixed(1) + '" cy="' + (h - pad - bh - 10).toFixed(1) + '" r="5.5" class="pt-chart-sale"><title>' + d.sales + ' sale' + (d.sales === 1 ? '' : 's') + '</title></circle>' : '';
      return '<rect x="' + x.toFixed(1) + '" y="' + (h - pad - bh) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(bh, d.clicks ? 2 : 0) + '" rx="3" class="pt-chart-bar"><title>' + d.day + ': ' + d.clicks + ' click' + (d.clicks === 1 ? '' : 's') + '</title></rect>' + sale;
    }).join('');
    var first = days[0] ? days[0].day.slice(5) : '', last = days.length ? days[days.length - 1].day.slice(5) : '';
    return '<svg class="pt-chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Clicks and sales over the last 30 days">' + bars +
      '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + (h - pad) + '" y2="' + (h - pad) + '" class="pt-chart-axis"/>' +
      '<text x="' + pad + '" y="' + (h - 5) + '" class="pt-chart-label">' + first + '</text><text x="' + (w - pad) + '" y="' + (h - 5) + '" text-anchor="end" class="pt-chart-label">' + last + '</text></svg>';
  }
  function nextTier(s) {
    var val = program.tierMetric === 'revenue' ? s.lifetimeRevenue : s.lifetimeSales;
    var next = (program.tiers || []).filter(function (t) { return t.min > val; })[0];
    return next ? { tier: next, val: val } : null;
  }
  function renderOverview(el) {
    var s = me.stats, pr = program;
    var conv = s.visitors ? (s.sales / s.visitors * 100) : 0;
    var due = s.earnings.available;
    var steps = [['Clicks', s.visitors, '#7651f0'], ['Tried the demo', s.demos, '#06b6d4'], ['Pressed buy', s.checkouts, '#d46fb0'], ['Bought', s.sales, '#23a873']];
    var top = Math.max(1, s.visitors);
    var nt = s.rate.source === 'custom' ? null : nextTier(s);
    var held = s.earnings.pending + (s.earnings.review || 0);
    el.innerHTML =
      '<div class="pt-stats">' +
        stat('Clicks', whole(s.clicks), whole(s.visitors) + ' people', '#7651f0', '🔗') +
        stat('Sales', whole(s.sales), conv.toFixed(conv && conv < 1 ? 2 : 1) + '% of people who clicked', '#23a873', '🛒') +
        stat('Ready to pay', money(due), due >= pr.minPayout ? 'In the next payout' : money(Math.max(0, pr.minPayout - due)) + ' to the ' + money(pr.minPayout) + ' minimum', '#c2730f', '💰') +
        stat('On hold', money(held), (s.earnings.review ? money(s.earnings.review) + ' being reviewed · ' : '') + pr.holdDays + '-day refund window', '#d46fb0', '⏳') +
      '</div>' +
      '<div class="pt-grid">' +
        '<div class="pt-card pt-card--wide"><div class="pt-card-head"><h2>Last 30 days</h2><span class="pt-legend"><i class="b"></i>Clicks <i class="s"></i>Sales</span></div>' + chart(s.days) + '</div>' +
        '<div class="pt-card"><h2>Your funnel</h2><div class="pt-funnel">' + steps.map(function (st) {
          return '<div><div class="pt-funnel-row"><span>' + st[0] + '</span><b>' + whole(st[1]) + '</b></div><div class="pt-funnel-track"><i style="width:' + Math.max(st[1] ? 3 : 0, Math.round(st[1] / top * 100)) + '%;background:' + st[2] + '"></i></div></div>';
        }).join('') + '</div><p class="pt-note">All time. People are counted once a day per link.</p></div>' +
        '<div class="pt-card"><h2>Your rate</h2><div class="pt-rate"><b>' + rateText(s.rate.type, s.rate.amount) + '</b><span>' + (s.rate.type === 'flat' ? 'per sale' : 'of every sale') + '</span></div>' +
          (s.rate.source === 'custom' ? '<p class="pt-note">A personal rate, just for you.</p>' : '') +
          (nt ? '<div class="pt-progress"><div class="pt-progress-head"><span>' + (pr.tierMetric === 'revenue' ? money(nt.val) + ' of ' + money(nt.tier.min) : nt.val + ' of ' + nt.tier.min + ' sales') + '</span><span>' + rateText(pr.type, nt.tier.amount) + ' next</span></div>' +
            '<div class="pt-progress-track"><i style="width:' + Math.min(100, Math.round(nt.val / nt.tier.min * 100)) + '%"></i></div><p class="pt-note">Reach ' + tierText(nt.tier) + ' and every sale after pays ' + rateText(pr.type, nt.tier.amount) + '.</p></div>'
              : (s.rate.source === 'tier' ? '<p class="pt-note">You have reached a bonus tier. Thank you!</p>' : '')) +
          '<div class="pt-mini-link"><input readonly aria-label="Your link" value="' + esc(link('/budgetplanner')) + '"><button class="lx-btn lx-btn--primary" type="button" data-copy="' + esc(link('/budgetplanner')) + '" data-copy-label="Link copied">Copy link</button></div>' +
        '</div>' +
        '<div class="pt-card"><h2>Earned so far</h2><div class="pt-earned"><div><span>Paid to you</span><b>' + money(s.earnings.paid) + '</b></div><div><span>Ready</span><b>' + money(s.earnings.available) + '</b></div><div><span>On hold</span><b>' + money(held) + '</b></div></div>' +
          '<div class="pt-next"><div class="pt-progress-head"><span>Next payout</span><b>' + (due >= pr.minPayout ? money(due) + ' ready' : money(due) + ' of ' + money(pr.minPayout)) + '</b></div>' +
            '<div class="pt-progress-track"><i style="width:' + (pr.minPayout ? Math.min(100, Math.round(due / pr.minPayout * 100)) : 100) + '%"></i></div></div>' +
          '<p class="pt-note">Paid ' + esc(String(pr.payoutSchedule || 'monthly').toLowerCase()) + ' by ' + esc({ wise: 'Wise', bank: 'bank transfer' }[me.profile.method] || 'PayPal') + (me.profile.method === 'bank' ? '' : ' to ' + esc(me.profile.payoutEmail || me.profile.email)) + '.</p></div>' +
        '<div class="pt-card"><h2>Your program</h2><dl class="pt-terms-list">' +
          '<div><dt>Program</dt><dd>' + esc(pr.name || 'Standard') + '</dd></div>' +
          '<div><dt>Commission</dt><dd>' + rateText(pr.type, pr.amount) + (pr.type === 'flat' ? ' per sale' : ' of each sale') + '</dd></div>' +
          ((pr.tiers || []).length ? '<div><dt>Bonus tiers</dt><dd>' + pr.tiers.map(function (t) { return rateText(pr.type, t.amount) + ' from ' + tierText(t); }).join('<br>') + '</dd></div>' : '') +
          '<div><dt>Your audience</dt><dd>' + (pr.buyerDiscount ? pr.buyerDiscount + '% off with your code' : 'Full price') + '</dd></div>' +
          '<div><dt>Link window</dt><dd>' + pr.cookieDays + ' days</dd></div>' +
          '<div><dt>Refund window</dt><dd>' + pr.holdDays + ' days' + (pr.approval === 'manual' ? ', then each sale is reviewed' : '') + '</dd></div>' +
          '<div><dt>Minimum payout</dt><dd>' + money(pr.minPayout) + '</dd></div>' +
        '</dl>' + (pr.description ? '<p class="pt-note">' + esc(pr.description) + '</p>' : '') + '</div>' +
        (pr.tier2Rate > 0 ? '<div class="pt-card pt-card--full"><h2>Invite other creators</h2><p>Earn <b>' + pr.tier2Rate + '%</b> of every sale made by partners you bring in, on top of your own. ' + (s.recruits ? 'You have brought in <b>' + s.recruits + '</b> so far.' : '') + '</p>' +
          '<div class="pt-linkbox"><input readonly value="' + esc(SITE + '/partners?ref=' + me.profile.code) + '"><button class="lx-btn lx-btn--small" type="button" data-copy="' + esc(SITE + '/partners?ref=' + me.profile.code) + '" data-copy-label="Invite link copied">Copy</button></div></div>' : '') +
      '</div>';
  }
  function renderLinks(el) {
    var p = me.profile, pr = program;
    var pages = [['/', 'Home page'], ['/budgetplanner', 'Product page'], ['/budgetplanner?trial=ubp', 'Free demo (straight into the planner)'], ['/blog', 'Blog']];
    el.innerHTML =
      '<div class="pt-grid">' +
        '<div class="pt-card pt-card--wide"><h2>Link builder</h2><p>Every link credits you for ' + pr.cookieDays + ' days. Add a campaign tag to see which post or video performs best.</p>' +
          '<div class="pt-builder"><label>Send people to<select id="ptLinkPage">' + pages.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></label>' +
          '<label><span>Campaign tag <span class="pt-opt">optional</span></span><input id="ptLinkSub" placeholder="e.g. tiktok-oct" maxlength="40"></label></div>' +
          '<div class="pt-linkbox"><input id="ptLinkOut" readonly><button class="lx-btn lx-btn--primary lx-btn--small" type="button" id="ptLinkCopy">Copy link</button></div>' +
          '<div class="pt-share" id="ptShare"></div></div>' +
        '<div class="pt-card"><h2>Your discount code' + ((me.coupons || []).length > 1 ? 's' : '') + '</h2>' + ((me.coupons || []).length
          ? me.coupons.map(function (c) { return '<div class="pt-code"><div><b>' + esc(c.code) + '</b><small>' + c.percent + '% off' + (c.usageLimit ? ' · up to ' + whole(c.usageLimit) + ' uses' : '') + (c.expiresAt ? ' · until ' + date(c.expiresAt) : '') + '</small></div><button class="lx-btn lx-btn--small" type="button" data-copy="' + esc(c.code) + '" data-copy-label="Code copied">Copy</button></div>'; }).join('') +
            '<p>Any sale with your code is yours, even without your link, so codes are perfect for videos, podcasts and stories. Your links apply ' + esc(p.discountCode || me.coupons[0].code) + ' automatically.</p>'
          : '<p>Your code is being set up. Your links already track every sale in the meantime.</p>') + '</div>' +
        '<div class="pt-card"><h2>Ready-to-post caption</h2><p class="pt-caption" id="ptCaption">I finally found a budget app I actually keep using. The Ultimate Budget Planner tells me exactly what I can spend each day, no bank login and no subscription. ' + (p.discountCode ? 'Use my code ' + esc(p.discountCode) + ' for ' + (((me.coupons || []).filter(function (c) { return c.code === p.discountCode; })[0] || {}).percent || pr.buyerDiscount) + '% off: ' : 'Try it free: ') + esc(link('/budgetplanner')) + ' #ad</p>' +
          '<button class="lx-btn lx-btn--small" type="button" id="ptCaptionCopy">Copy caption</button><p class="pt-note">More captions are in the swipe file on the Creatives tab.</p></div>' +
        '<div class="pt-card pt-card--wide"><h2>Campaign tags</h2>' + subsTable(me.stats.subs) + '</div>' +
      '</div>';
    var update = function () {
      var url = link($('#ptLinkPage').value, $('#ptLinkSub').value.trim().replace(/[^\w-]/g, ''));
      $('#ptLinkOut').value = url;
      var t = encodeURIComponent('A budget planner I actually keep using, no subscription:');
      var u = encodeURIComponent(url);
      $('#ptShare').innerHTML = [
        ['X', 'https://twitter.com/intent/tweet?text=' + t + '&url=' + u], ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + u],
        ['WhatsApp', 'https://wa.me/?text=' + t + '%20' + u], ['Pinterest', 'https://pinterest.com/pin/create/button/?url=' + u + '&description=' + t],
        ['Reddit', 'https://www.reddit.com/submit?url=' + u + '&title=' + t], ['Email', 'mailto:?subject=' + encodeURIComponent('A budget planner worth a look') + '&body=' + t + '%20' + u]
      ].map(function (x) { return '<a href="' + x[1] + '" target="_blank" rel="noopener">' + x[0] + '</a>'; }).join('');
    };
    $('#ptLinkPage').addEventListener('change', update);
    $('#ptLinkSub').addEventListener('input', update);
    $('#ptLinkCopy').addEventListener('click', function () { copy($('#ptLinkOut').value, 'Link copied'); });
    $('#ptCaptionCopy').addEventListener('click', function () { copy($('#ptCaption').textContent, 'Caption copied'); });
    update();
  }
  function subsTable(subs) {
    if (!subs || !subs.length) return '<p class="pt-note">No clicks yet. Tagged links show up here, one row per tag.</p>';
    return '<div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>Tag</th><th class="num">Clicks</th><th class="num">Sales</th><th class="num">Earned</th></tr></thead><tbody>' +
      subs.sort(function (a, b) { return b.clicks - a.clicks; }).map(function (r) { return '<tr><td>' + esc(r.sub) + '</td><td class="num">' + whole(r.clicks) + '</td><td class="num">' + whole(r.sales) + '</td><td class="num">' + money(r.earned) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function renderCreatives(el) {
    var th = creativeTheme;
    el.innerHTML =
      '<div class="pt-card pt-card--flat"><div class="pt-card-head"><h2>Creatives</h2><a class="lx-btn lx-btn--small" href="' + KIT + 'Ezzo-Hub-Affiliate-Guide.pdf" target="_blank" rel="noopener">Partner guide (PDF)</a></div>' +
      '<p class="pt-note">Every design comes in the planner\'s six looks, so you can match your feed. Right-click or long-press to save, or use Download.</p>' +
      '<div class="pt-chips">' + THEMES.map(function (t) { return '<button type="button" data-theme="' + t[0] + '" class="' + (t[0] === th ? 'is-on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div></div>' +
      '<h3 class="pt-sub">Images</h3><div class="pt-gallery">' + BANNERS.map(function (b) {
        var src = KIT + 'banners/' + th + '/' + b[0] + '.png';
        return '<figure class="pt-asset"><a href="' + src + '" target="_blank" rel="noopener" class="pt-asset-img"><img src="' + src + '" alt="' + esc(b[1]) + '" loading="lazy"></a><figcaption><span><b>' + b[1] + '</b><small>' + b[2] + '</small></span><a href="' + src + '" download>Download</a></figcaption></figure>';
      }).join('') + '</div>' +
      '<h3 class="pt-sub">Videos</h3><p class="pt-note">No sound, so you can add your voice or a trending track. Portrait for TikTok, Reels and Shorts; landscape for YouTube and X.</p><div class="pt-videos">' + VIDEOS.map(function (v) {
        var base = KIT + 'videos/' + th + '/' + v[0];
        return '<figure class="pt-asset"><video src="' + base + '-port.mp4" preload="none" muted playsinline controls poster=""></video><figcaption><span><b>' + v[1] + '</b><small>15 seconds</small></span><span class="pt-dl"><a href="' + base + '-port.mp4" download>Portrait</a><a href="' + base + '-land.mp4" download>Landscape</a></span></figcaption></figure>';
      }).join('') + '</div>' +
      '<h3 class="pt-sub">Brand</h3><div class="pt-files">' +
        ['ezzo-logo-512.png|App logo', 'ezzo-mark-violet-1024.png|Mark, violet', 'ezzo-mark-ink-1024.png|Mark, ink', 'ezzo-mark-white-1024.png|Mark, white'].map(function (x) { var p = x.split('|'); return '<a href="' + KIT + 'logos/' + p[0] + '" download>' + p[1] + '</a>'; }).join('') +
        '<a href="' + KIT + 'videos/logo/ezzo-hub-logo-' + (th === 'dark' ? 'dark' : 'frosty') + '-1080x1920.mp4" download>Logo animation, portrait</a>' +
        '<a href="' + KIT + 'videos/logo/ezzo-hub-logo-' + (th === 'dark' ? 'dark' : 'frosty') + '-1920x1080.mp4" download>Logo animation, landscape</a>' +
        '<a href="' + KIT + 'swipe-copy.txt" target="_blank" rel="noopener">Swipe file: captions and facts</a>' +
      '</div>' +
      '<h3 class="pt-sub">Screenshots</h3><div class="pt-files">' +
        ['dashboard', 'bills', 'goals', 'debt', 'calendar', 'transactions', 'budget'].map(function (n, i) { return '<a href="' + KIT + 'screenshots/' + th + '/phone-' + (i + 1) + '-' + n + '.jpg" target="_blank" rel="noopener">Phone: ' + n + '</a><a href="' + KIT + 'screenshots/' + th + '/desktop-' + (i + 1) + '-' + n + '.jpg" target="_blank" rel="noopener">Desktop: ' + n + '</a>'; }).join('') +
      '</div>' +
      '<div class="pt-card pt-card--flat pt-rules"><h2>Quick rules</h2><ul><li>Always mark posts as an ad or affiliate link (#ad).</li><li>Talk about what the planner really does: daily safe-to-spend, bills, goals, debt payoff, no bank login, one payment.</li><li>No search ads on "Ezzo" or "Ezzo Hub", no coupon sites, no made-up results.</li></ul></div>';
    $$('[data-theme]', el).forEach(function (b) { b.addEventListener('click', function () { creativeTheme = b.dataset.theme; renderCreatives(el); }); });
  }
  function renderEarnings(el) {
    var s = me.stats, pr = program;
    var label = { pending: 'On hold', review: 'Being reviewed', available: 'Ready', approved: 'Ready', paid: 'Paid', reversed: 'Refunded', rejected: 'Not eligible' };
    el.innerHTML =
      '<div class="pt-stats">' + stat('Paid to you', money(s.earnings.paid), s.payouts.length + ' payout' + (s.payouts.length === 1 ? '' : 's'), '#23a873', '✅') +
        stat('Ready to pay', money(s.earnings.available), 'Minimum ' + money(pr.minPayout), '#c2730f', '💰') + stat('On hold', money(s.earnings.pending + (s.earnings.review || 0)), pr.holdDays + '-day refund window', '#d46fb0', '⏳') +
        stat('Sales revenue', money(s.revenue), 'what your buyers paid', '#7651f0', '📈') + '</div>' +
      '<div class="pt-card pt-card--flat"><div class="pt-card-head"><h2>Commissions</h2>' + (s.commissions.length ? '<button class="lx-btn lx-btn--small" type="button" id="ptCsv">Download CSV</button>' : '') + '</div>' +
        (s.commissions.length ? '<div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>Date</th><th>Order</th><th>From</th><th class="num">Sale</th><th class="num">Rate</th><th class="num">You earn</th><th>Status</th></tr></thead><tbody>' +
          s.commissions.map(function (c) {
            var st = c.status;
            return '<tr><td>' + date(c.date) + '</td><td class="mono">' + esc(c.order) + '</td><td>' + (c.type === 'tier2' ? 'Invited partner' : c.type === 'clawback' ? 'Refund after payout' : c.via === 'code' ? 'Your code' : c.via === 'manual' ? 'Added for you' : 'Your link') + (c.sub ? ' <small>' + esc(c.sub) + '</small>' : '') + '</td>' +
              '<td class="num">' + (c.sale ? money(c.sale) : '-') + '</td><td class="num">' + (c.rate ? rateText(c.rateType, c.rate) : '-') + '</td><td class="num"><b>' + money(c.amount) + '</b></td>' +
              '<td><span class="pt-pill pt-pill--' + st + '" title="' + esc(st === 'pending' ? 'Ready on ' + date(c.availableAt) : c.note || '') + '">' + (label[st] || st) + '</span>' + (st === 'pending' ? '<small> until ' + date(c.availableAt) + '</small>' : '') + (c.note && st !== 'pending' && !/^Code /.test(c.note) ? '<br><small>' + esc(c.note) + '</small>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="pt-note">Your first sale will appear here the moment it happens.</p>') +
      '</div>' +
      '<div class="pt-card pt-card--flat"><h2>Payouts</h2>' + (s.payouts.length ? '<div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>Date</th><th>Payout</th><th>Method</th><th class="num">Referrals</th><th class="num">Amount</th><th>Reference</th><th>Received?</th></tr></thead><tbody>' +
        s.payouts.map(function (p) {
          var conf = p.status === 'void' ? '<span class="pt-pill pt-pill--reversed">Cancelled</span>' : p.confirmedAt ? '<span class="pt-pill pt-pill--paid">✓ ' + date(p.confirmedAt) + '</span>'
            : (readOnly ? '<span class="pt-pill pt-pill--pending">Not yet confirmed</span>' : '<button class="lx-btn lx-btn--small" type="button" data-confirm="' + esc(p.id) + '">I received it</button>');
          return '<tr><td>' + date(p.date) + '</td><td class="mono">' + esc(p.id) + '</td><td>' + esc({ wise: 'Wise', bank: 'Bank transfer' }[p.method] || 'PayPal') + '</td><td class="num">' + whole(p.referrals) + '</td><td class="num"><b>' + money(p.amount) + '</b></td><td>' + esc(p.reference || '-') + '</td><td>' + conf + '</td></tr>';
        }).join('') +
        '</tbody></table></div><p class="pt-note">Please press "I received it" once a payment arrives, so we both know it landed.</p>' : '<p class="pt-note">No payouts yet. Once your ready balance passes ' + money(pr.minPayout) + ', it is paid ' + esc(String(pr.payoutSchedule || 'monthly').toLowerCase()) + '.</p>') + '</div>';
    $$('[data-confirm]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true; b.textContent = 'Saving…';
        call({ action: 'aff_confirm', s: session(), id: b.dataset.confirm }).then(function (res) {
          if (res.ok) { toast('Thanks, payment confirmed'); load(true); }
          else { b.disabled = false; b.textContent = 'I received it'; toast('Could not confirm just now. Please try again.'); }
        });
      });
    });
    var csv = $('#ptCsv');
    csv && csv.addEventListener('click', function () {
      var rows = [['Date', 'Order', 'Type', 'Via', 'Tag', 'Sale', 'Rate', 'Commission', 'Status']].concat(s.commissions.map(function (c) {
        return [new Date(c.date).toISOString().slice(0, 10), c.order, c.type, c.via || '', c.sub || '', c.sale, c.rate, c.amount, c.status];
      }));
      var blob = new Blob([rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n')], { type: 'text/csv' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ezzo-commissions.csv'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });
  }
  function renderSettings(el) {
    var p = me.profile;
    el.innerHTML =
      '<div class="pt-grid"><form class="pt-card pt-card--wide pt-form" id="ptSettings" novalidate><h2>Payout and profile</h2>' +
        '<label>Name<input name="name" value="' + esc(p.name) + '" maxlength="80"></label>' +
        '<label>Website or main profile<input name="site" value="' + esc(p.website || '') + '" maxlength="200"></label>' +
        '<div class="pt-form-row"><label>Payout method<select name="method"><option value="paypal"' + (p.method === 'paypal' ? ' selected' : '') + '>PayPal</option><option value="wise"' + (p.method === 'wise' ? ' selected' : '') + '>Wise</option><option value="bank"' + (p.method === 'bank' ? ' selected' : '') + '>Bank transfer</option></select></label>' +
        '<label>Payout email<input name="payout" type="email" value="' + esc(p.payoutEmail || p.email) + '" maxlength="120"></label></div>' +
        '<label><span>Bank details <span class="pt-opt">for bank transfers</span></span><textarea name="details" rows="3" maxlength="500" placeholder="Account name, IBAN or account number, SWIFT/BIC, bank name">' + esc(p.payoutDetails || '') + '</textarea></label>' +
        '<button class="lx-btn lx-btn--primary" type="submit">Save changes</button><p class="pt-form-msg" id="ptSettingsMsg" role="status"></p></form>' +
      '<div class="pt-card"><h2>Account</h2><p>Signed in as <b>' + esc(p.email) + '</b>. Partner since ' + date(p.since) + '.</p><p class="pt-note">Questions or changes to your sign-in email? Reply to any email from us.</p>' +
        '<button class="lx-btn" type="button" id="ptSignOut">Sign out</button></div></div>';
    $('#ptSignOut').addEventListener('click', signOut);
    if (readOnly) { $$('#ptSettings input, #ptSettings select, #ptSettings textarea, #ptSettings button').forEach(function (x) { x.disabled = true; }); $('#ptSettingsMsg').textContent = 'Read-only admin view.'; }
    $('#ptSettings').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = this, msg = $('#ptSettingsMsg'), btn = f.querySelector('button');
      btn.disabled = true;
      if (f.method.value === 'bank' && !f.details.value.trim()) { msg.textContent = 'Please add your bank details for bank transfers.'; btn.disabled = false; return; }
      call({ action: 'aff_update', s: session(), name: f.name.value.trim(), site: f.site.value.trim(), method: f.method.value, payout: f.payout.value.trim(), details: f.details.value }).then(function (res) {
        btn.disabled = false;
        if (res.ok) { msg.textContent = 'Saved.'; load(true); }
        else msg.textContent = res.error === 'bad_email' ? 'That payout email does not look right.' : 'Could not save just now. Please try again.';
      });
    });
  }

  // ── Start ────────────────────────────────────────────────────────────
  var yr = $('#lxYear'); if (yr) yr.textContent = new Date().getFullYear();
  var nav = $('#lxNav');
  window.addEventListener('scroll', function () { nav.classList.toggle('is-scrolled', window.scrollY > 10); }, { passive: true });
  $('#ptSignOutTop').addEventListener('click', signOut);
  wirePublic();
  fillProgram();
  animateMock();
  call({ action: 'aff_program' }).then(function (res) { if (res && res.ok && res.type) { Object.assign(program, res); fillProgram(); } });

  var params = new URLSearchParams(location.search);
  var loginToken = params.get('login');
  var viewToken = params.get('as');
  if (viewToken) {
    try { sessionStorage.setItem(VIEW_STORE, viewToken); } catch (e) {}
    try { params.delete('as'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '')); } catch (e) {}
    showApp(true); load();
  } else if (loginToken) {
    try { params.delete('login'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '')); } catch (e) {}
    showApp(true);
    $('#ptApp').innerHTML = '<div class="pt-loading"><span></span>Signing you in…</div>';
    call({ action: 'aff_verify', token: loginToken }).then(function (res) {
      if (res.ok && res.session) { write(SESSION_STORE, res.session); load(); return; }
      showApp(false); openSignin();
      $('#ptSigninMsg').textContent = res.error === 'expired' ? 'That link has expired. Enter your email for a fresh one.' : 'That link has already been used or is not valid. Enter your email for a fresh one.';
    });
  } else if (session()) {
    showApp(true); load();
  }
  // Exposed for tests and for the admin preview.
  window.ezzoPartners = { render: function (data) { me = data; readOnly = !!data.readOnly; Object.assign(program, data.program || {}); showApp(true); render(); }, setTab: function (t) { tab = t; render(); } };
})();
