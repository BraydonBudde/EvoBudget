// The Ultimate Budget Planner product page: everything that moves.
// Buttons carry data-try / data-buy / data-open, which script.js wires to
// the free demo, checkout and the license key prompt, so this file never
// touches buying or unlocking. It only brings the page to life.
(function () {
  'use strict';
  const root = document.getElementById('lx');
  if (!root) return;
  const $ = (s, el) => (el || root).querySelector(s);
  const $$ = (s, el) => [...(el || root).querySelectorAll(s)];
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const money = (v, dec) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const ease = t => 1 - Math.pow(1 - t, 4);

  // A number that glides to its new value instead of jumping.
  function tween(el, from, to, ms, fmt) {
    if (still) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    cancelAnimationFrame(el._lxRaf);
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(from + (to - from) * ease(k));
      if (k < 1) el._lxRaf = requestAnimationFrame(step);
    };
    el._lxRaf = requestAnimationFrame(step);
  }

  // ── Arrival: the headline rises in, then everything else reveals on scroll ──
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));
  const seen = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      seen.unobserve(e.target);
      e.target.dispatchEvent(new CustomEvent('lx:in'));
    });
  }, { threshold: .18, rootMargin: '0px 0px -40px 0px' });
  $$('[data-reveal]').forEach(el => seen.observe(el));
  const steps = $('#lxSteps');
  if (steps) seen.observe(steps);

  // ── Navigation: glass once scrolled; a sheet on small screens ──
  const nav = $('#lxNav'), burger = $('#lxBurger'), sheet = $('#lxSheet'), dockbar = $('#lxDockbar');
  const hero = $('.lx-hero');
  const onScroll = () => {
    nav && nav.classList.toggle('is-scrolled', window.scrollY > 12);
    if (dockbar && hero) dockbar.classList.toggle('is-in', hero.getBoundingClientRect().bottom < 0);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const closeSheet = () => { sheet && sheet.classList.remove('is-open'); burger && burger.setAttribute('aria-expanded', 'false'); };
  burger && burger.addEventListener('click', () => {
    const open = !sheet.classList.contains('is-open');
    sheet.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
  });
  $$('a, button', sheet || root).forEach(a => sheet && sheet.contains(a) && a.addEventListener('click', closeSheet));
  // In-page links glide, and land below the sticky bar.
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 80, behavior: still ? 'auto' : 'smooth' });
  }));

  // ── Count-ups in the proof strip ──
  $$('[data-count]').forEach(el => {
    const to = Number(el.dataset.count), dec = Number(el.dataset.dec || 0);
    const box = el.closest('[data-reveal]') || el;
    box.addEventListener('lx:in', () => tween(el, 0, to, 1400, v => v.toFixed(dec)));
    if (still) el.textContent = to.toFixed(dec);
  });

  // ── The hero phone: a coffee is logged, a bill is paid, then it starts over ──
  const freeEl = $('#lxHeroFree'), rateEl = $('#lxHeroRate'), todayEl = $('#lxHeroToday'), spentEl = $('#lxHeroSpent');
  const toast = $('#lxToast'), toastTxt = $('#lxToastTxt'), bill1 = $('#lxBill1');
  const START = 1240.50, DAYS = 20;
  const heroFmt = v => { const s = money(v, 2); const i = s.lastIndexOf('.'); return s.slice(0, i) + '<small>' + s.slice(i) + '</small>'; };
  function setHero(free, spent) {
    if (!freeEl) return;
    const from = freeEl._lxV == null ? START : freeEl._lxV;
    freeEl._lxV = free;
    if (still) freeEl.innerHTML = heroFmt(free);
    else {
      const t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 900); freeEl.innerHTML = heroFmt(from + (free - from) * ease(k)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    const today = Math.max(0, START / DAYS - spent);
    rateEl.textContent = money((free) / DAYS, 2) + ' a day for ' + DAYS + ' days';
    todayEl.textContent = money(today, 2);
    spentEl.textContent = money(spent, 2);
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function heroLoop() {
    if (still || !freeEl) return;
    for (;;) {
      await wait(2600);
      toastTxt.textContent = 'Coffee logged · $4.50';
      toast.classList.add('is-in'); setHero(START - 4.5, 4.5);
      await wait(2400); toast.classList.remove('is-in');
      await wait(1600);
      bill1.classList.add('is-paid'); bill1.querySelector('.lx-bill-pay').textContent = 'Paid';
      toastTxt.textContent = 'Electric paid · already set aside';
      toast.classList.add('is-in');
      await wait(1800); bill1.classList.add('is-gone');
      await wait(1400); toast.classList.remove('is-in');
      await wait(2600);
      bill1.classList.remove('is-paid', 'is-gone'); bill1.querySelector('.lx-bill-pay').textContent = 'Pay';
      setHero(START, 0);
    }
  }
  heroLoop();

  // A gentle tilt toward the pointer, and the floating cards drift with depth.
  const stage = $('#lxStage'), phone = $('#lxPhone');
  if (stage && phone && !still && window.matchMedia('(hover: hover)').matches) {
    let raf = 0;
    stage.parentElement.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        phone.style.transform = `rotateY(${-10 + x * 14}deg) rotateX(${4 - y * 10}deg)`;
        $$('[data-depth]', stage).forEach(f => { const d = Number(f.dataset.depth); f.style.translate = `${x * d}px ${y * d}px`; });
      });
    });
    stage.parentElement.addEventListener('pointerleave', () => {
      phone.style.transform = '';
      $$('[data-depth]', stage).forEach(f => { f.style.translate = ''; });
    });
  }

  // ── See it in action: the real app, one feature after another ──
  const film = $('#lxFilm'), filmTabs = $$('.lx-film-tab'), pauseBtn = $('#lxFilmPause');
  if (film && filmTabs.length) {
    let at = 0, inView = false, userPaused = still;
    const bar = i => filmTabs[i].querySelector('.lx-film-bar i');
    const show = (i, autoplay) => {
      at = i;
      filmTabs.forEach((t, k) => { t.classList.toggle('is-on', k === i); t.setAttribute('aria-selected', String(k === i)); bar(k).style.width = '0%'; });
      const id = filmTabs[i].dataset.film;
      film.poster = 'media/guide/' + id + '.jpg';
      film.src = 'media/guide/' + id + '.mp4';
      if (autoplay) film.play().catch(() => {});
    };
    const setPaused = p => { userPaused = p; pauseBtn.classList.toggle('is-paused', p); pauseBtn.setAttribute('aria-label', p ? 'Play' : 'Pause'); };
    film.addEventListener('timeupdate', () => { if (film.duration) bar(at).style.width = (film.currentTime / film.duration * 100) + '%'; });
    film.addEventListener('ended', () => show((at + 1) % filmTabs.length, inView && !userPaused));
    filmTabs.forEach((t, i) => t.addEventListener('click', () => { setPaused(false); show(i, true); }));
    pauseBtn.addEventListener('click', () => {
      if (!film.currentSrc) { setPaused(false); show(at, true); return; }
      if (film.paused) { setPaused(false); film.play().catch(() => {}); } else { setPaused(true); film.pause(); }
    });
    // Nothing loads until the section is close, and it rests when scrolled away.
    new IntersectionObserver(es => es.forEach(e => {
      inView = e.isIntersecting;
      if (inView && !userPaused) { if (!film.currentSrc) show(at, true); else film.play().catch(() => {}); }
      else if (!inView) film.pause();
    }), { threshold: .35 }).observe(film);
    setPaused(userPaused);
  }

  // ── Sliders paint their own fill ──
  const paint = r => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%');

  // ── Find your number ──
  const pay = $('#lxPay'), bills = $('#lxBills'), days = $('#lxDays');
  if (pay && bills && days) {
    const freeOut = $('#lxFree'), perDay = $('#lxPerDay');
    let lastFree = 1950, lastDay = 97.5;
    const calc = () => {
      [pay, bills, days].forEach(paint);
      const p = Number(pay.value), b = Number(bills.value), d = Number(days.value);
      $('#lxPayOut').textContent = money(p, 0);
      $('#lxBillsOut').textContent = money(b, 0);
      $('#lxDaysOut').textContent = d;
      const free = Math.max(0, p - b), day = free / d;
      tween(freeOut, lastFree, free, 600, v => money(Math.round(v), 0));
      tween(perDay, lastDay, day, 600, v => money(v, 2));
      lastFree = free; lastDay = day;
      const billShare = p ? Math.min(100, b / p * 100) : 0;
      $('#lxSplitBills').style.width = billShare + '%';
      $('#lxSplitFree').style.width = (100 - billShare) + '%';
    };
    [pay, bills, days].forEach(r => r.addEventListener('input', calc));
    calc();
  }

  // ── Can I afford it? (the sample: $1,240.50 free, $62.03 of it today, 20 days left) ──
  const verdict = $('#lxVerdict');
  const VERDICTS = {
    35: ['yes', '✓', 'Yes, go for it', "It fits inside today's $62.03."],
    350: ['cau', '!', 'Yes, but it costs your days', 'Your daily amount drops to $44.53.'],
    1500: ['wait', '⏳', 'Wait for your next period', "You'd be $259.50 short. Save $65 a week and it's yours in a month."]
  };
  $$('[data-afford]').forEach(chip => chip.addEventListener('click', () => {
    $$('[data-afford]').forEach(c => c.classList.toggle('is-on', c === chip));
    const [tone, icon, title, line] = VERDICTS[chip.dataset.afford];
    verdict.dataset.tone = tone;
    verdict.innerHTML = `<i>${icon}</i><div><b>${title}</b><span>${line}</span></div>`;
    if (!still) verdict.animate([{ transform: 'scale(.97)', opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
  }));

  // ── Debt payoff: a $6,800 card at 19.9% with a $180 minimum ──
  const extra = $('#lxExtra');
  if (extra) {
    const BAL = 6800, APR = .199, MIN = 180;
    const payoff = add => {
      let b = BAL, months = 0, interest = 0;
      const r = APR / 12;
      while (b > 0.005 && months < 600) { const i = b * r; interest += i; b = b + i - (MIN + add); months++; }
      return { months, interest };
    };
    const base = payoff(0);
    const dateOut = $('#lxDebtDate'), saveOut = $('#lxDebtSave');
    const run = () => {
      paint(extra);
      const add = Number(extra.value);
      $('#lxExtraOut').textContent = money(add, 0);
      const p = payoff(add);
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + p.months);
      dateOut.textContent = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const saved = Math.max(0, base.interest - p.interest);
      saveOut.textContent = add ? money(Math.round(saved), 0) + ' less interest' : 'Add a little extra';
      if (!still) dateOut.animate([{ transform: 'translateY(6px)', opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'ease-out' });
    };
    extra.addEventListener('input', run);
    run();
  }

  // ── Savings goals fill as they come into view ──
  const goals = $('#lxGoalsTile');
  goals && goals.addEventListener('lx:in', () => $$('.lx-goal-bar i', goals).forEach(i => { i.style.width = i.dataset.w + '%'; }));
  if (still && goals) $$('.lx-goal-bar i', goals).forEach(i => { i.style.width = i.dataset.w + '%'; });

  // ── Spin to Win ──
  const wheel = $('#lxWheel'), disc = $('#lxWheelDisc'), wheelMsg = $('#lxWheelMsg');
  if (wheel) {
    let turned = 0, spinning = false;
    const SAVES = [20, 15, 10, 5, 0, 12];   // one per slice, clockwise from the top
    wheel.addEventListener('click', () => {
      if (spinning) return;
      spinning = true;
      const slice = Math.floor(Math.random() * 6);
      // Land the chosen slice's middle under the pointer at the top.
      const target = 360 - (slice * 60 + 30);
      turned += 360 * 4 + ((target - (turned % 360)) + 360) % 360;
      disc.style.transform = `rotate(${turned}deg)`;
      wheelMsg.innerHTML = '<b>Spinning…</b>Fingers crossed.';
      setTimeout(() => {
        const s = SAVES[slice];
        wheelMsg.innerHTML = s ? `<b>You saved $${s}!</b>Straight to your goal.` : '<b>Enjoy the full $20.</b>Guilt free.';
        spinning = false;
      }, still ? 0 : 2650);
    });
  }

  // ── Ezzo types an answer when the card comes into view ──
  const chat = $('#lxChatTile'), ezzo = $('#lxEzzo');
  if (chat && ezzo) {
    const answer = 'You have <b>$124.06</b> for the weekend. Whatever you save on Saturday rolls into Sunday.';
    const type = async () => {
      if (still) { ezzo.innerHTML = answer; return; }
      await wait(500);
      const plain = answer.replace(/<[^>]+>/g, '');
      for (let i = 1; i <= plain.length; i++) {
        // Re-insert the bold amount as it is typed.
        const shown = plain.slice(0, i).replace('$124.06', '<b>$124.06</b>');
        ezzo.innerHTML = shown + '<span class="lx-caret"></span>';
        await wait(plain[i - 1] === ' ' ? 26 : 18);
      }
      ezzo.innerHTML = answer;
    };
    chat.addEventListener('lx:in', type);
  }

  // ── The calendar tile: a strip of days that drifts past ──
  const track = $('#lxDaysTrack');
  if (track) {
    const DAYS_DATA = [['12', 'Mon', 'due', 'Electric due'], ['13', 'Tue', 'ok', '$18 spent'], ['14', 'Wed', 'ok', 'Quiet day'], ['15', 'Thu', 'due', 'Netflix due'], ['16', 'Fri', 'ok', '$42 spent'], ['17', 'Sat', 'ok', 'Payday'], ['18', 'Sun', 'ok', '$9 spent']];
    const one = DAYS_DATA.map(([n, w, k, t], i) => `<div class="lx-day${i === 2 ? ' is-today' : ''}"><span>${w}</span><b>${n}</b><em class="${k}">${t}</em></div>`).join('');
    track.innerHTML = one + one;
  }

  // ── Themes: the same card, in each look ──
  const THEMES = {
    dark: ['linear-gradient(150deg,#6d4ae0,#a8327f)', '#fff'],
    light: ['linear-gradient(150deg,#ffffff,#ecebf5)', '#1c1a2b'],
    peachy: ['linear-gradient(150deg,#f6c08a,#e4887a)', '#3d2a26'],
    vintage: ['linear-gradient(150deg,#f6eedb,#e3d3ad)', '#3b2a1a'],
    frosty: ['linear-gradient(150deg,#eef0ff,#c4b5fd)', '#2a1f66']
  };
  const themeCard = $('#lxThemeCard');
  $$('[data-theme-try]').forEach(dot => dot.addEventListener('click', () => {
    $$('[data-theme-try]').forEach(d => d.classList.toggle('is-on', d === dot));
    const [bg, ink] = THEMES[dot.dataset.themeTry];
    themeCard.style.background = bg; themeCard.style.color = ink;
  }));

  // ── A soft light follows the pointer across the feature tiles ──
  if (!still) $$('.lx-tile').forEach(tile => tile.addEventListener('pointermove', e => {
    const r = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    tile.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }));

  // ── Only one answer open at a time ──
  $$('.lx-faq details').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) $$('.lx-faq details').forEach(o => { if (o !== d) o.open = false; });
  }));

  const year = $('#lxYear');
  if (year) year.textContent = new Date().getFullYear();
})();

// ── Scroll motion: the horizon, the ticker, the paycheck story, and the light ──
// Everything here reads the scroll position once per frame and eases toward
// it, so it glides rather than jumps. With reduced motion, it all shows its
// finished state and nothing follows the scroll or the pointer.
(function () {
  'use strict';
  const root = document.getElementById('lx');
  if (!root) return;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = v => Math.max(0, Math.min(1, v));
  const money = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let vh = window.innerHeight;

  // ── The horizon: the planner rises and flattens as you scroll to it ──
  const scene = root.querySelector('.lx-rise-scene');
  const fit = root.querySelector('.lx-dash-fit');
  const dash = root.querySelector('.lx-dash');
  const sizeDash = () => { if (dash && fit) dash.style.setProperty('--s', String(fit.clientWidth / 1280)); };
  sizeDash();
  let riseNow = still ? 1 : 0, riseTo = riseNow, live = false;
  function goLive() {
    if (live || !dash) return;
    live = true;
    dash.classList.add('is-live');
    dash.querySelectorAll('[data-dash-count]').forEach(el => {
      const to = Number(el.dataset.dashCount), dec = Number(el.dataset.dec || 0);
      const fmt = v => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (still) { el.textContent = fmt(to); return; }
      const t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 1600); el.textContent = fmt(to * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ── The paycheck story ──
  const track = root.querySelector('.lx-story-track');
  const card = track && track.querySelector('.lx-story-card');
  const PAY = 2400, LABELS = ['Paycheck', 'After bills', 'After goals and debt', 'Free to spend'];
  // When each line comes off, as a share of the way through the story.
  const WIN = [[.1, .2], [.18, .28], [.26, .36], [.34, .44], [.5, .6], [.58, .68]];
  const items = track ? [...track.querySelectorAll('[data-amt]')] : [];
  const steps = track ? [...track.querySelectorAll('.lx-story-steps li')] : [];
  const segs = {};
  if (track) track.querySelectorAll('[data-seg]').forEach(el => { segs[el.dataset.seg] = el; });
  const num = track && track.querySelector('[data-story-num]');
  const label = track && track.querySelector('[data-story-label]');
  const daily = track && track.querySelector('.lx-story-daily');
  const dailyNum = track && track.querySelector('[data-story-daily]');
  const days = track ? [...track.querySelectorAll('.lx-story-days i')] : [];
  let qNow = still ? 1 : 0, qTo = qNow, lastStep = -1;
  function paintStory(q) {
    if (!track) return;
    let left = PAY;
    const sums = { b: 0, g: 0, d: 0 };
    items.forEach((li, i) => {
      const [a, b] = WIN[i] || [0, 0];
      const f = clamp((q - a) / (b - a)), amt = Number(li.dataset.amt) * f;
      li.style.setProperty('--f', f.toFixed(3));
      sums[li.dataset.kind] += amt; left -= amt;
    });
    num.textContent = money(Math.round(left * 100) / 100);
    ['b', 'g', 'd'].forEach(k => { if (segs[k]) segs[k].style.width = (sums[k] / PAY * 100).toFixed(2) + '%'; });
    if (segs.f) segs.f.style.width = (left / PAY * 100).toFixed(2) + '%';
    const step = q < .1 ? 0 : q < .47 ? 1 : q < .72 ? 2 : 3;
    if (step !== lastStep) {
      lastStep = step;
      steps.forEach((li, i) => { li.classList.toggle('is-on', i === step); li.classList.toggle('is-done', i < step); });
      label.textContent = LABELS[step];
      card.classList.toggle('is-free', step === 3);
    }
    daily.style.setProperty('--f4', clamp((q - .72) / .08).toFixed(3));
    dailyNum.textContent = money(Math.round(left / 20 * 100) / 100);
    const lit = Math.round(clamp((q - .78) / .16) * days.length);
    days.forEach((d, i) => d.classList.toggle('is-on', i < lit));
  }

  // ── One frame loop for the scroll-driven parts ──
  let raf = 0;
  function measure() {
    if (scene) { const r = scene.getBoundingClientRect(); riseTo = still ? 1 : clamp((vh - r.top) / (vh * .82)); }
    if (track) { const r = track.getBoundingClientRect(); qTo = still ? 1 : clamp(-r.top / Math.max(1, r.height - vh)); }
  }
  let tPrev = 0;
  function frame(now) {
    raf = 0;
    measure();
    // Ease by elapsed time, not frame count, so a slow device settles just as soon.
    const dt = tPrev ? Math.min(250, now - tPrev) : 16.7; tPrev = now;
    const k1 = 1 - Math.pow(.88, dt / 16.7), k2 = 1 - Math.pow(.84, dt / 16.7);
    riseNow += (riseTo - riseNow) * k1; if (Math.abs(riseTo - riseNow) < .0008) riseNow = riseTo;
    qNow += (qTo - qNow) * k2; if (Math.abs(qTo - qNow) < .0005) qNow = qTo;
    if (scene) scene.style.setProperty('--p', riseNow.toFixed(4));
    if (riseNow > .72) goLive();
    paintStory(qNow);
    if (riseNow !== riseTo || qNow !== qTo) kick(); else tPrev = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  window.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('resize', () => { vh = window.innerHeight; sizeDash(); kick(); });
  if (still) { if (scene) scene.style.setProperty('--p', '1'); goLive(); paintStory(1); }
  else kick();

  // ── The ticker: drifts on its own, rushes when you scroll, turns when you turn ──
  const rows = [...root.querySelectorAll('.lx-ticker-row')].map(row => {
    const t = row.querySelector('.lx-ticker-track');
    t.innerHTML += t.innerHTML;   // Twice over, so the loop has no seam.
    return { t, dir: Number(row.dataset.dir) || 1, x: 0, w: 0 };
  });
  if (rows.length && !still) {
    let drive = 1, aim = 1, lastY = window.scrollY, on = false, tr = 0;
    const measureRows = () => rows.forEach(r => { r.w = r.t.scrollWidth / 2; });
    measureRows();
    window.addEventListener('resize', measureRows);
    window.addEventListener('scroll', () => {
      const dy = window.scrollY - lastY; lastY = window.scrollY;
      if (dy) aim = Math.sign(dy) * Math.min(9, 1 + Math.abs(dy) * .22);
    }, { passive: true });
    let tLast = 0;
    const tick = now => {
      tr = 0;
      if (!on) { tLast = 0; return; }
      const f = tLast ? Math.min(250, now - tLast) / 16.7 : 1; tLast = now;
      drive += (aim - drive) * (1 - Math.pow(.92, f));
      aim += (Math.sign(aim) - aim) * (1 - Math.pow(.95, f));   // settle back to a gentle drift
      rows.forEach(r => {
        r.x -= r.dir * drive * .55 * f;
        if (r.w) { if (r.x <= -r.w) r.x += r.w; if (r.x > 0) r.x -= r.w; }
        r.t.style.transform = `translate3d(${r.x.toFixed(2)}px, 0, 0)`;
      });
      tr = requestAnimationFrame(tick);
    };
    new IntersectionObserver(es => {
      on = es[0].isIntersecting;
      if (on && !tr) { measureRows(); tr = requestAnimationFrame(tick); }
    }).observe(root.querySelector('.lx-ticker'));
  }

  // ── Light: a soft glow follows the pointer, and card edges catch it ──
  const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine && !still) {
    const CARDS = '.lx-pain, .lx-tile, .lx-tool, .lx-value, .lx-price-card, .lx-demo-card, .lx-feature, .lx-privacy, .lx-story-card, .lx-dc, .lx-proof-in';
    root.querySelectorAll(CARDS).forEach(el => {
      el.classList.add('lx-glow');
      const spot = document.createElement('i');
      spot.className = 'lx-spot'; spot.setAttribute('aria-hidden', 'true');
      spot.appendChild(document.createElement('i'));
      el.appendChild(spot);
    });
    const glow = document.createElement('i');
    glow.className = 'lx-cursor'; glow.setAttribute('aria-hidden', 'true');
    root.appendChild(glow);
    let cx = 0, cy = 0, tx = 0, ty = 0, seen = false, gr = 0;
    const follow = () => {
      gr = 0;
      cx += (tx - cx) * .14; cy += (ty - cy) * .14;
      glow.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      if (Math.abs(tx - cx) + Math.abs(ty - cy) > .4) gr = requestAnimationFrame(follow);
    };
    root.addEventListener('pointermove', e => {
      tx = e.clientX; ty = e.clientY;
      if (!seen) { seen = true; cx = tx; cy = ty; glow.classList.add('is-on'); }
      if (!gr) gr = requestAnimationFrame(follow);
      const c = e.target.closest && e.target.closest('.lx-glow');
      if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); }
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { seen = false; glow.classList.remove('is-on'); });
  }
})();
