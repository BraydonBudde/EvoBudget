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


// ── Dusk: the tour, the month switch, Ask Ezzo, the rent calculator, and light ──
// Nothing here follows the scroll bar. Each piece starts when it comes into
// view and then plays on its own. With reduced motion, each shows its result.
(function () {
  'use strict';
  const root = document.getElementById('lx');
  if (!root) return;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const money = (v, dec = 2) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const ease = t => 1 - Math.pow(1 - t, 4);
  const onView = (el, fn, threshold = .35) => {
    if (!el) return;
    new IntersectionObserver((es, ob) => es.forEach(e => fn(e.isIntersecting, ob)), { threshold }).observe(el);
  };
  function countTo(el, from, to, ms, fmt) {
    if (still) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    cancelAnimationFrame(el._ezRaf);
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(from + (to - from) * ease(k));
      if (k < 1) el._ezRaf = requestAnimationFrame(step);
    };
    el._ezRaf = requestAnimationFrame(step);
  }

  // ── The dusk scene leans away from the pointer, nearest ranges most ──
  if (fine && !still) root.querySelectorAll('.lx-hero--dusk, .lx-home-hero, .lx-final--night').forEach(hero => {
    const layers = [...hero.querySelectorAll('.dk-layer')];
    if (!layers.length) return;
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      layers.forEach(l => { const d = Number(l.dataset.depth); l.style.transform = `translate(${(-x * d).toFixed(1)}px, ${(-y * d * .4).toFixed(1)}px)`; });
    });
    hero.addEventListener('pointerleave', () => layers.forEach(l => { l.style.transform = ''; }));
  });

  // ── The tour: a simple phone acting out each feature, one after another ──
  root.querySelectorAll('.lx-tour').forEach(tour => {
    const tabs = [...tour.querySelectorAll('.lx-tour-tab')];
    const screen = tour.querySelector('.lx-tour-screen');
    const scenes = {};
    screen.querySelectorAll('.lx-sc').forEach(s => { scenes[s.dataset.sc] = s; });
    const V = (sc, k) => scenes[sc].querySelector(`[data-v="${k}"]`);
    const tap = screen.querySelector('[data-v="tap"]');
    const DUR = 7200;
    let run = 0, at = 0, inView = false, waiting = false, started = false;
    const sleep = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej(new Error('stop'))), still ? 0 : ms));
    function tapOn(el) {
      if (!el || still) return;
      const r = el.getBoundingClientRect(), s = screen.getBoundingClientRect();
      tap.style.left = (r.left - s.left + r.width / 2) + 'px';
      tap.style.top = (r.top - s.top + r.height / 2) + 'px';
      tap.classList.remove('is-tap'); void tap.offsetWidth; tap.classList.add('is-tap');
      el.classList.add('is-press'); setTimeout(() => el.classList.remove('is-press'), 220);
    }
    // Debt: a $6,800 card at 19.9% with a $180 minimum, as in the feature tile.
    const payoff = add => {
      let b = 6800, months = 0, interest = 0;
      while (b > .005 && months < 600) { const i = b * .199 / 12; interest += i; b = b + i - (180 + add); months++; }
      return { months, interest };
    };
    const monthOut = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
    const RUN = {
      async log(id) {
        const today = V('log', 'today'), amt = V('log', 'amt'), cat = V('log', 'cat'), go = V('log', 'go'), toast = V('log', 'toast');
        today.textContent = '$62.03'; amt.textContent = '$0'; cat.classList.remove('is-sel'); toast.classList.remove('is-in');
        await sleep(800, id);
        let typed = '';
        for (const k of ['4', '.', '5', '0']) {
          tapOn(scenes.log.querySelector(`[data-k="${k}"]`));
          typed += k; amt.textContent = '$' + typed;
          await sleep(430, id);
        }
        await sleep(200, id); tapOn(cat); cat.classList.add('is-sel');
        await sleep(700, id); tapOn(go);
        await sleep(260, id); toast.classList.add('is-in');
        countTo(today, 62.03, 57.53, 900, v => money(v));
        await sleep(2000, id); toast.classList.remove('is-in');
      },
      async bill(id) {
        const b1 = V('bill', 'b1'), pay = V('bill', 'pay'), note = V('bill', 'note');
        b1.classList.remove('is-paid', 'is-gone'); pay.textContent = 'Pay'; note.classList.remove('is-in');
        await sleep(1200, id); tapOn(pay);
        await sleep(220, id); b1.classList.add('is-paid'); pay.textContent = 'Paid ✓';
        await sleep(700, id); note.classList.add('is-in');
        await sleep(2000, id); b1.classList.add('is-gone');
      },
      async goal(id) {
        const ring = V('goal', 'ring'), pct = V('goal', 'pct'), gv = V('goal', 'gv'), add = V('goal', 'add'), coin = V('goal', 'coin'), note = V('goal', 'note');
        ring.style.strokeDashoffset = '51'; pct.textContent = '49%'; gv.textContent = '$1,466 of $3,000';
        add.classList.remove('is-sel'); note.classList.remove('is-in'); coin.classList.remove('is-drop');
        await sleep(1000, id); tapOn(add); add.classList.add('is-sel');
        void coin.offsetWidth; coin.classList.add('is-drop');
        await sleep(820, id);
        ring.style.strokeDashoffset = '44';
        countTo(pct, 49, 56, 1300, v => Math.round(v) + '%');
        countTo(gv, 1466, 1666, 1300, v => money(Math.round(v), 0) + ' of $3,000');
        await sleep(1400, id); note.classList.add('is-in');
      },
      async debt(id) {
        const date = V('debt', 'date'), extra = V('debt', 'extra'), knob = V('debt', 'knob'), fill = V('debt', 'rfill'), note = V('debt', 'note');
        const base = payoff(0), plus = payoff(150);
        [knob, fill].forEach(el => { el.style.transition = 'none'; });
        knob.style.left = '0%'; fill.style.width = '0%'; extra.textContent = '$0'; date.textContent = monthOut(base.months);
        note.classList.remove('is-in');
        const bars = [...scenes.debt.querySelectorAll('.sc-timeline i')];
        bars.forEach(b => b.classList.remove('is-cut'));
        void knob.offsetWidth;
        [knob, fill].forEach(el => { el.style.transition = 'left 1.3s cubic-bezier(.22,1,.36,1), width 1.3s cubic-bezier(.22,1,.36,1)'; });
        await sleep(1000, id); tapOn(knob);
        await sleep(200, id);
        knob.style.left = '60%'; fill.style.width = '60%';
        countTo(extra, 0, 150, 1300, v => money(Math.round(v / 10) * 10, 0));
        await sleep(1350, id);
        date.textContent = monthOut(plus.months);
        if (!still) date.animate([{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
        const cut = Math.round((base.months - plus.months) / base.months * bars.length);
        bars.slice(bars.length - cut).forEach((b, i) => setTimeout(() => b.classList.add('is-cut'), still ? 0 : i * 90));
        V('debt', 'sooner').textContent = (base.months - plus.months) + ' months sooner.';
        V('debt', 'saved').textContent = money(Math.round(base.interest - plus.interest), 0) + ' less interest.';
        await sleep(500, id); note.classList.add('is-in');
      },
      async ask(id) {
        const chat = V('ask', 'chat'), typing = V('ask', 'typing'), face = scenes.ask.querySelector('.lx-orb');
        const send = scenes.ask.querySelector('.sc-input i');
        chat.innerHTML = ''; typing.textContent = 'Ask anything…'; typing.classList.remove('is-typing');
        face.classList.remove('is-think', 'is-talk');
        const q = 'Can I afford a $35 dinner tonight?';
        await sleep(700, id);
        typing.classList.add('is-typing');
        for (let i = 1; i <= q.length; i++) { typing.textContent = q.slice(0, i); await sleep(34, id); }
        await sleep(260, id); tapOn(send);
        const me = document.createElement('p'); me.className = 'me'; me.textContent = q; chat.appendChild(me);
        typing.textContent = 'Ask anything…'; typing.classList.remove('is-typing');
        await sleep(380, id);
        const ez = document.createElement('p'); ez.className = 'ez'; ez.innerHTML = '<span class="sc-dots"><i></i><i></i><i></i></span>'; chat.appendChild(ez);
        face.classList.add('is-think');
        await sleep(1100, id);
        face.classList.remove('is-think'); face.classList.add('is-talk');
        const words = "Yes, go for it. It fits inside today's $62.03, and you'd still have $27.03 left for today.".split(' ');
        for (let i = 1; i <= words.length; i++) {
          ez.innerHTML = words.slice(0, i).join(' ').replace('$62.03', '<b>$62.03</b>').replace('$27.03', '<b>$27.03</b>');
          await sleep(70, id);
        }
        face.classList.remove('is-talk');
      }
    };
    function show(i) {
      at = i; waiting = false;
      const id = ++run;
      tabs.forEach((t, k) => {
        t.classList.toggle('is-on', k === i); t.setAttribute('aria-pressed', String(k === i));
        const bar = t.querySelector('.lx-tour-bar i'); bar.style.transition = 'none'; bar.style.width = '0%';
      });
      const key = tabs[i].dataset.tour;
      Object.values(scenes).forEach(s => s.classList.toggle('is-on', s.dataset.sc === key));
      if (!still) {
        const bar = tabs[i].querySelector('.lx-tour-bar i');
        void bar.offsetWidth;
        bar.style.transition = `width ${DUR}ms linear`; bar.style.width = '100%';
      }
      const t0 = Date.now();
      RUN[key](id).catch(() => {}).then(() => {
        if (id !== run || still) return;
        setTimeout(() => {
          if (id !== run) return;
          if (inView) show((at + 1) % tabs.length); else waiting = true;
        }, Math.max(400, DUR - (Date.now() - t0)));
      });
    }
    tabs.forEach((t, i) => t.addEventListener('click', () => { started = true; show(i); }));
    onView(tour, vis => {
      inView = vis;
      if (vis && !started) { started = true; show(0); }
      else if (vis && waiting) show((at + 1) % tabs.length);
    }, .3);
  });

  // ── The month, two ways: it starts as winging it, then flips to Ezzo ──
  root.querySelectorAll('.lx-month').forEach(mo => {
    let touched = false;
    const set = m => {
      mo.dataset.mode = m;
      mo.querySelectorAll('.lx-flip button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    };
    mo.querySelectorAll('.lx-flip button').forEach(b => b.addEventListener('click', () => { touched = true; set(b.dataset.mode); }));
    mo.addEventListener('lx:in', () => {
      if (still) { set('ezzo'); return; }
      setTimeout(() => { if (!touched) set('ezzo'); }, 3200);
    });
  });

  // ── Ask Ezzo: answers from the page's own questions, no connection needed ──
  root.querySelectorAll('.lx-ask-chat').forEach(chat => {
    const sec = chat.closest('section') || root;
    const items = [...sec.querySelectorAll('.lx-ask-all details')].map(d => ({
      q: d.querySelector('summary').textContent.trim(),
      a: d.querySelector('.lx-faq-a').textContent.trim(),
      chip: d.dataset.chip || d.querySelector('summary').textContent.trim(),
      keys: (d.dataset.keys || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
    }));
    const log = chat.querySelector('.lx-ask-log'), chips = chat.querySelector('.lx-ask-chips');
    const form = chat.querySelector('form'), input = form.querySelector('input');
    const orbs = [...sec.querySelectorAll('.lx-orb')];
    const asked = new Set();
    let busy = false;
    const wait = ms => new Promise(r => setTimeout(r, still ? 0 : ms));
    const mood = c => orbs.forEach(o => { o.classList.remove('is-think', 'is-talk'); if (c) o.classList.add(c); });
    const add = (cls, text) => {
      const m = document.createElement('div'); m.className = 'lx-msg ' + cls;
      if (text != null) m.textContent = text;
      log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
    };
    async function say(text) {
      mood('is-think');
      const m = add('lx-msg--ez');
      m.innerHTML = '<span class="sc-dots"><i></i><i></i><i></i></span>';
      log.scrollTop = log.scrollHeight;
      await wait(650 + Math.random() * 450);
      mood('is-talk');
      const words = text.split(' ');
      for (let i = 1; i <= words.length; i++) {
        m.textContent = words.slice(0, i).join(' ');
        if (i % 3 === 0) log.scrollTop = log.scrollHeight;
        await wait(38);
      }
      log.scrollTop = log.scrollHeight;
      mood(null);
    }
    function offer() {
      let left = items.filter(it => !asked.has(it));
      if (!left.length) { asked.clear(); left = items; }
      chips.innerHTML = '';
      left.slice(0, 4).forEach((it, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = it.chip;
        b.style.animationDelay = (i * 70) + 'ms';
        b.addEventListener('click', () => ask(it.q, it));
        chips.appendChild(b);
      });
      log.scrollTop = log.scrollHeight;
    }
    const STOP = new Set('a an the i im my me is it its to do does can how what where when which of for in on and or you your with be are am if get there this that will would should could much many any'.split(' '));
    const words = s => s.toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
    function match(text) {
      const t = text.toLowerCase(), ws = words(text);
      let best = null, score = 0;
      items.forEach(it => {
        let s = 0;
        it.keys.forEach(k => { if (t.includes(k)) s += 3; });
        const qw = words(it.q);
        ws.forEach(w => { if (qw.includes(w)) s += 1; });
        if (s > score) { score = s; best = it; }
      });
      return score >= 2 ? best : null;
    }
    async function ask(q, it) {
      if (busy) return;
      busy = true; chips.innerHTML = '';
      add('lx-msg--me', q);
      const hit = it || match(q);
      if (hit) asked.add(hit);
      await say(hit ? hit.a : "I'm not sure about that one yet. Try one of these, or open the free demo and see for yourself.");
      offer(); busy = false;
    }
    form.addEventListener('submit', e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q || busy) return;
      input.value = ''; ask(q);
    });
    let greeted = false;
    onView(chat, async (vis, ob) => {
      if (!vis || greeted) return;
      greeted = true; ob.disconnect();
      busy = true; await say(chat.dataset.greeting); busy = false; offer();
    }, .4);
  });

  // ── Stop renting your apps: what monthly apps cost over three years ──
  root.querySelectorAll('.lx-rent').forEach(rent => {
    const btns = [...rent.querySelectorAll('[data-price]')];
    const total = rent.querySelector('[data-rent="total"]'), month = rent.querySelector('[data-rent="month"]');
    const subsBar = rent.querySelector('.lx-rent-bar--subs > i > i'), ezBar = rent.querySelector('.lx-rent-bar--ezzo > i > i');
    const subsV = rent.querySelector('[data-rent="subs"]'), foot = rent.querySelector('[data-rent="foot"]');
    let last = 0, live = false;
    const update = () => {
      const m = btns.filter(b => b.getAttribute('aria-pressed') === 'true').reduce((s, b) => s + Number(b.dataset.price), 0);
      const t = Math.round(m * 36 * 100) / 100;
      countTo(total, last, t, 800, v => money(v, 2)); last = t;
      month.textContent = m ? money(m, 2) + ' a month, every month' : 'Tap an app to add it';
      subsV.textContent = money(t, 2);
      subsBar.style.width = live && t ? '100%' : '0%';
      ezBar.style.width = live ? Math.min(100, Math.max(3, t ? 49.99 / t * 100 : 100)) + '%' : '0%';
      const budget = btns.find(b => b.dataset.app === 'budget');
      foot.innerHTML = budget && budget.getAttribute('aria-pressed') === 'true'
        ? 'Swap just the budget app and keep <b>$309.65</b> over three years.'
        : 'Every Ezzo tool is free to try, and paid for once.';
    };
    btns.forEach(b => b.addEventListener('click', () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); update(); }));
    onView(rent, vis => { if (vis && !live) { live = true; update(); } }, .3);
    update();
  });

  // ── Light: a soft glow follows the pointer, and card edges catch it ──
  if (fine && !still) {
    const CARDS = '.lx-tile, .lx-tool, .lx-price-card, .lx-demo-card, .lx-privacy, .lx-month-chart, .lx-rent-card, .lx-spot-card, .lx-ask-chat, .lx-proof-in';
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

// ══ World: start ══
// The home page as a journey: the scene rail, the carousel of coming tools,
// and the lanterns that float away when an app is let go.
(function () {
  'use strict';
  const root = document.querySelector('.lx-world');
  if (!root) return;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── The rail: which scene you are in ──
  const links = [...root.querySelectorAll('.wd-rail a')];
  if (links.length) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) links.forEach(a => a.classList.toggle('is-on', a.dataset.scene === e.target.id));
    }), { rootMargin: '-45% 0px -45% 0px' });
    root.querySelectorAll('.wd-scene').forEach(s => io.observe(s));
  }

  // ── The carousel: swipe, arrows, dots, keys; the middle card is the one in focus ──
  root.querySelectorAll('.wd-carousel').forEach(car => {
    const track = car.querySelector('.wd-cards');
    const cards = [...track.children];
    const dots = [...car.querySelectorAll('[data-go]')];
    let at = 0, raf = 0;
    const left = c => c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2;
    const go = i => {
      i = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: left(cards[i]), behavior: still ? 'auto' : 'smooth' });
    };
    const mark = () => {
      raf = 0;
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0, bd = Infinity;
      cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
      at = best;
      cards.forEach((c, i) => c.classList.toggle('is-center', i === best));
      dots.forEach((d, i) => { d.classList.toggle('is-on', i === best); d.setAttribute('aria-current', String(i === best)); });
    };
    track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(mark); }, { passive: true });
    car.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => go(at + Number(b.dataset.step))));
    dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
    cards.forEach((c, i) => c.addEventListener('click', e => { if (i !== at && !e.target.closest('button, input, form, a')) go(i); }));
    track.addEventListener('keydown', e => {
      if (e.target !== track) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
    });
    // Open on the middle card, with neighbours either side.
    const start = Math.floor(cards.length / 2);
    requestAnimationFrame(() => { track.scrollLeft = left(cards[start]); mark(); });
    window.addEventListener('resize', () => { track.scrollLeft = left(cards[at]); });
  });

  // ── Lanterns: one per monthly app; let the app go and its lantern floats off ──
  root.querySelectorAll('.lx-rent').forEach(rent => {
    const sync = () => rent.querySelectorAll('button[data-app]').forEach(b => {
      const l = rent.querySelector(`.wd-lantern[data-app="${b.dataset.app}"]`);
      if (l) l.classList.toggle('is-off', b.getAttribute('aria-pressed') !== 'true');
    });
    rent.addEventListener('click', e => { if (e.target.closest('button[data-app]')) setTimeout(sync, 0); });
    sync();
  });
})();

// ══ World: end ══
