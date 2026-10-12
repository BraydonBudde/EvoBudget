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

  // ── Pain cards turn over on tap (hover does it on a computer) ──
  $$('.lx-pain').forEach(card => card.addEventListener('click', () => card.classList.toggle('is-on')));

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
    35: ['yes', '✓', 'Yes, go for it', "It fits inside today's $62.03, so nothing else moves."],
    350: ['cau', '!', 'Yes, but it costs your days', 'Your daily amount drops from $62.03 to $44.53 until payday.'],
    1500: ['wait', '⏳', 'Wait for your next period', 'You would be $259.50 short. Saving $65 a week gets you there in a month.']
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
        wheelMsg.innerHTML = s ? `<b>You saved $${s}!</b>It goes straight to your goal.` : '<b>Enjoy the full $20.</b>Treat yourself, guilt free.';
        spinning = false;
      }, still ? 0 : 2650);
    });
  }

  // ── Ezzo types an answer when the card comes into view ──
  const chat = $('#lxChatTile'), ezzo = $('#lxEzzo');
  if (chat && ezzo) {
    const answer = 'You have <b>$124.06</b> free for Saturday and Sunday together. Spend a little less on Saturday and Sunday gets the rest.';
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
