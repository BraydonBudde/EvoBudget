'use strict';
/* =====================================================================
   cal-deck.js - the calendar, one day at a time.

   The calendar's main view. Every day of the month is a card, and one is
   in focus. They stand in a row like pictures in a gallery: the day in
   focus faces you and the days either side turn away from it. A phone has
   the same gallery, narrower, with the neighbours peeking in at the edges.
   Swipe, drag, tap a neighbour or use the arrow keys to move; past the last
   day of the month the next month carries on.

   Each card holds the same things in both: the date, what is due and what
   was spent, and that day's bills, debts, spending and goal dates, with a
   Pay pill on anything still owed.
   ===================================================================== */

if (typeof APP_ICONS !== 'undefined') {
  APP_ICONS.daycards = '<rect x="7" y="4" width="10" height="16" rx="2.2"/><path d="M4 7v10"/><path d="M20 7v10"/>';
}
const CAL_DECK_MQ = '(max-width: 640px)';
let calDeckFocus = null;      // the day in focus, in the month on screen
let calDeckMonth = null;      // which month that day belongs to

const calIso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function calRel(iso) {
  const s = typeof cuRelative === 'function' ? cuRelative(iso) : '';
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function calDeckCardHtml(y, m, day, dayEvs, loc) {
  const iso = calIso(y, m, day), date = new Date(y, m, day), today = toLocalISO(new Date());
  const spent = (state.transactions || []).filter(x => x.type === 'expense' && x.date === iso).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const due = dayEvs.filter(e => (e.type === 'bill' && !e.paid) || (e.type === 'debt' && !e.settled)).reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const typeLabel = { bill: t('cal_leg_bill'), debt: t('cal_leg_debt'), transaction: t('cal_leg_tx'), goal: t('cal_leg_goal') };
  const act = e => {
    if (e.type === 'bill') return e.paid ? `<span class="cal-card-done">${t('cal_card_paid')}</span>` : `<button class="cal-card-pay" type="button" data-deck-pay="bill" data-deck-id="${esc(e.id)}" data-deck-date="${iso}">${t('pay_btn')}</button>`;
    if (e.type === 'debt') return e.settled ? `<span class="cal-card-done">${t('cal_card_paid')}</span>` : `<button class="cal-card-pay" type="button" data-deck-pay="debt" data-deck-id="${esc(e.id)}" data-deck-date="${iso}">${t('pay_btn')}</button>`;
    return '';
  };
  const rel = calRel(iso);
  return `<article class="panel cal-card${iso === today ? ' is-today' : ''}${iso < today ? ' is-past' : ''}" data-day="${day}" aria-roledescription="${esc(t('cal_card_role'))}" aria-label="${esc(date.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }))}">
    <header class="cal-card-head">
      <div class="cal-card-date">
        <span class="cal-card-num">${day}</span>
        <span class="cal-card-txt"><b>${esc(date.toLocaleDateString(loc, { weekday: 'long' }))}</b><em>${esc(date.toLocaleDateString(loc, { month: 'long', year: 'numeric' }))}</em></span>
      </div>
      ${rel ? `<span class="cal-card-rel">${esc(rel)}</span>` : ''}
    </header>
    <div class="cal-card-sum">
      <div><em>${t('cal_card_due')}</em><b class="${due > 0 ? 'is-due' : ''}">${fmt(due)}</b></div>
      <div><em>${t('cal_card_spent')}</em><b>${fmt(spent)}</b></div>
    </div>
    ${dayEvs.length ? `<ul class="cal-card-list">${dayEvs.map(e => `<li class="cal-card-ev${(e.type === 'bill' && e.paid) || (e.type === 'debt' && e.settled) ? ' is-settled' : ''}">
        <span class="cal-dot" style="background:${e.color}"></span>
        <span class="cal-card-ev-txt"><b>${esc(e.label)}</b><em>${esc(typeLabel[e.type] || e.type)}${e.part > 0 ? ` · ${esc(tf('nl_partial_of', fmt(e.part), fmt(e.type === 'debt' ? e.expected : e.part + e.amount)))}` : ''}</em></span>
        <span class="cal-card-amt">${fmt(e.amount)}</span>
        ${act(e)}
      </li>`).join('')}</ul>`
      : `<div class="cal-card-empty"><span aria-hidden="true">${appIconSvg('calendar')}</span><p>${t('cal_card_none')}</p></div>`}
    <footer class="cal-card-foot">
      <button class="cal-card-add" type="button" data-deck-add="${iso}" aria-label="${esc(t('cal_card_add'))}" title="${esc(t('cal_card_add'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
    </footer>
  </article>`;
}

function calDeckHtml(evs, y, m, daysInMo, loc) {
  const key = y * 12 + m, now = new Date();
  if (calDeckMonth !== key || !calDeckFocus || calDeckFocus > daysInMo) {
    calDeckFocus = (typeof calSelectedDay !== 'undefined' && calSelectedDay) || (y === now.getFullYear() && m === now.getMonth() ? now.getDate() : 1);
    calDeckMonth = key;
  }
  const chev = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  return `<section class="cal-deck" id="calDeck" tabindex="0" aria-roledescription="carousel" aria-label="${esc(t('cal_card_aria'))}">
    <button class="cal-deck-nav cal-deck-prev" type="button" data-deck-step="-1" aria-label="${esc(t('cal_card_prev'))}">${chev('m15 18-6-6 6-6')}</button>
    <div class="cal-deck-stage">${Array.from({ length: daysInMo }, (_, i) => calDeckCardHtml(y, m, i + 1, evs[i + 1] || [], loc)).join('')}</div>
    <button class="cal-deck-nav cal-deck-next" type="button" data-deck-step="1" aria-label="${esc(t('cal_card_next'))}">${chev('m9 18 6-6-6-6')}</button>
    <div class="cal-deck-foot">
      <p class="cal-deck-count" aria-live="polite"></p>
      <button class="cal-today-btn" type="button" data-deck-today hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>${t('cal_today_btn')}</button>
    </div>
  </section>`;
}

// Lays the cards out around a position, which can sit between two days
// while a finger is dragging.
function calDeckLayout(deck, pos, instant) {
  deck.classList.toggle('is-phone', window.matchMedia(CAL_DECK_MQ).matches);
  deck.classList.toggle('is-dragging', !!instant);
  const cards = [...deck.querySelectorAll('.cal-card')];
  cards.forEach((c, i) => {
    const o = i + 1 - pos, a = Math.abs(o);
    const shown = a < 3.2;
    // Which card is in focus is settled first, for every card, so a card
    // that has moved far off never keeps the flag.
    const focus = Math.round(pos) === i + 1;
    c.classList.toggle('is-focus', focus);
    if (focus) c.removeAttribute('inert'); else c.setAttribute('inert', '');
    c.style.visibility = shown ? '' : 'hidden';
    c.style.pointerEvents = shown ? '' : 'none';
    if (!shown) return;
    // The day in focus faces you, the others turn away from it. They are
    // solid, so the card behind never shows through; dimmed instead.
    const rot = Math.max(-42, Math.min(42, -o * 34));
    c.style.transform = `translate3d(${o * 64}%, 0, ${-a * 140}px) rotateY(${rot}deg) scale(${1 - Math.min(a, 2) * .06})`;
    c.style.opacity = String(Math.max(0, a < 2.4 ? 1 : 3.2 - a));
    c.style.filter = `brightness(${1 - Math.min(a, 2) * .05})`;
    c.style.zIndex = String(100 - Math.round(a * 10));
  });
  const cnt = deck.querySelector('.cal-deck-count');
  if (cnt) cnt.textContent = tf(deck.classList.contains('is-phone') ? 'cal_card_count_short' : 'cal_card_count', Math.round(pos), cards.length);
  // Today appears once the day in focus is any other day.
  const now = new Date(), tb = deck.querySelector('[data-deck-today]');
  if (tb) tb.hidden = calDeckMonth === now.getFullYear() * 12 + now.getMonth() && Math.round(pos) === now.getDate();
  deck.querySelector('.cal-deck-prev').disabled = false;
  deck.querySelector('.cal-deck-next').disabled = false;
}

function calDeckGo(deck, day) {
  const n = deck.querySelectorAll('.cal-card').length;
  // Past either end, the next or previous month carries on.
  if (day > n) { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } calDeckFocus = 1; calDeckMonth = calYear * 12 + calMonth; calSelectedDay = null; renderCalendar(); return; }
  if (day < 1) { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } calDeckFocus = new Date(calYear, calMonth + 1, 0).getDate(); calDeckMonth = calYear * 12 + calMonth; calSelectedDay = null; renderCalendar(); return; }
  calDeckFocus = day;
  calDeckLayout(deck, day, false);
}

function calDeckToday(deck) {
  const now = new Date(), key = now.getFullYear() * 12 + now.getMonth();
  if (calDeckMonth !== key) {
    calYear = now.getFullYear(); calMonth = now.getMonth();
    calDeckFocus = now.getDate(); calDeckMonth = key; calSelectedDay = null;
    renderCalendar();
    return;
  }
  calDeckGo(deck, now.getDate());
}

// Where a trackpad scroll has got to, until it settles on a day.
const calDeckWheel = { pos: null, from: 0, idle: 0 };

function calDeckWire(root) {
  const deck = root.querySelector('#calDeck');
  if (!deck) return;
  const stage = deck.querySelector('.cal-deck-stage');
  calDeckLayout(deck, calDeckFocus, true);
  requestAnimationFrame(() => deck.classList.remove('is-dragging'));
  deck.querySelectorAll('[data-deck-step]').forEach(b => b.addEventListener('click', () => calDeckGo(deck, calDeckFocus + (+b.dataset.deckStep))));
  deck.querySelector('[data-deck-today]')?.addEventListener('click', () => calDeckToday(deck));
  // Dragging: the cards follow the finger, then settle on the nearest day.
  // A press that barely moves stays a tap, so buttons and side cards work.
  let start = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const list = e.target.closest && e.target.closest('.cal-card-list');
    if (list && e.target === list && e.offsetX > list.clientWidth) return;
    start = { x: e.clientX, y: e.clientY, t: Date.now(), size: (stage.querySelector('.cal-card').offsetWidth * .64) || 300, moved: false, id: e.pointerId, trail: [] };
  });
  stage.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    const d = e.clientX - start.x, cross = e.clientY - start.y;
    if (!start.moved) {
      if (Math.abs(d) < 8 || Math.abs(d) < Math.abs(cross)) return;
      start.moved = true;
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    }
    e.preventDefault();
    const n = deck.querySelectorAll('.cal-card').length;
    start.trail.push({ x: e.clientX, t: performance.now() });
    if (start.trail.length > 12) start.trail.shift();
    calDeckLayout(deck, Math.max(.6, Math.min(n + .4, calDeckFocus - d / start.size)), true);
  });
  const end = e => {
    if (!start || e.pointerId !== start.id) return;
    const s = start; start = null;
    if (!s.moved) return;
    const d = e.clientX - s.x, v = d / Math.max(1, Date.now() - s.t);
    // How fast the finger was going as it let go (over its last 100ms).
    const now = performance.now(), recent = s.trail.filter(p => now - p.t < 100);
    const fling = recent.length ? (e.clientX - recent[0].x) / Math.max(16, now - recent[0].t) : 0;
    let steps = -Math.round((d + fling * 160) / s.size);
    if (!steps && (Math.abs(d) > 40 || Math.abs(v) > .45)) steps = d < 0 ? 1 : -1;
    deck.classList.remove('is-dragging');
    calDeckGo(deck, calDeckFocus + steps);
    // The release of a drag is not a tap on whatever it ended over.
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    stage.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => stage.removeEventListener('click', stop, true), 0);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', e => {
    const w = calDeckWheel, sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (w.pos === null && !sideways) return;   // up and down is the card's own list
    e.preventDefault();
    const n = deck.querySelectorAll('.cal-card').length;
    if (w.pos === null) { w.pos = calDeckFocus; w.from = calDeckFocus; }
    if (e.deltaX) {   // once it is moving, all of the sideways part counts
      const size = (stage.querySelector('.cal-card').offsetWidth * .64) || 300;
      w.pos = Math.max(.4, Math.min(n + .6, w.pos + e.deltaX * (e.deltaMode === 1 ? 16 : 1) / size));
      // Past either end the days give a little, then the next month waits.
      const shown = w.pos < 1 ? 1 - (1 - w.pos) * .5 : w.pos > n ? n + (w.pos - n) * .5 : w.pos;
      calDeckLayout(deck, shown, true);
    }
    clearTimeout(w.idle);
    w.idle = setTimeout(() => {
      const at = w.pos, from = w.from;
      w.pos = null;
      if (!deck.isConnected) return;
      let day = Math.round(at);
      if (day === from && Math.abs(at - from) > .2) day += at > from ? 1 : -1;
      calDeckGo(deck, day);
    }, 160);
  }, { passive: false });
  // Tapping a card beside the one in focus brings it forward.
  stage.addEventListener('click', e => {
    const c = e.target.closest('.cal-card');
    if (c && !c.classList.contains('is-focus')) { e.preventDefault(); calDeckGo(deck, +c.dataset.day); }
  });
  deck.querySelectorAll('[data-deck-pay]').forEach(b => b.addEventListener('click', () =>
    promptPay(b.dataset.deckPay, b.dataset.deckId, () => renderCalendar(), b.dataset.deckDate)));
  deck.querySelectorAll('[data-deck-add]').forEach(b => b.addEventListener('click', () => {
    const iso = b.dataset.deckAdd;
    openQuickAddTx();
    const d = document.getElementById('qaDate');
    if (d && iso) { d.value = iso; d.dispatchEvent(new Event('change', { bubbles: true })); }
  }));
  const relayout = () => { if (document.body.contains(deck)) calDeckLayout(deck, calDeckFocus, true); else window.removeEventListener('resize', relayout); requestAnimationFrame(() => deck.classList.remove('is-dragging')); };
  window.addEventListener('resize', relayout);
}

(function calDeckWords() {
  try { Object.assign(TRANSLATIONS.en, {
    cal_view_cards: 'Show as day cards', cal_view_grid: 'Show as calendar',
    cal_card_due: 'Due', cal_card_spent: 'Spent', cal_card_paid: 'Paid',
    cal_card_none: 'Nothing due or spent on this day.', cal_card_add: 'Log a spend on this day',
    cal_card_prev: 'Previous day', cal_card_next: 'Next day', cal_card_aria: 'Days of the month', cal_card_role: 'day',
    cal_card_count: 'Day {0} of {1}', cal_card_count_short: '{0} / {1}', cal_today_btn: 'Today'
  }); } catch (e) {}
})();

// With the day cards on screen, the arrow keys move a day at a time, ahead
// of the calendar's own month keys.
document.addEventListener('keydown', e => {
  const deck = document.getElementById('calDeck');
  if (!deck || !document.getElementById('bview-calendar')?.classList.contains('is-active')) return;
  if (e.target.closest && e.target.closest('input, textarea, select, .modal-overlay, .dd-menu, .fk-datepop')) return;
  if (!document.getElementById('tutorialOverlay')?.hidden) return;
  const back = e.key === 'ArrowLeft', fwd = e.key === 'ArrowRight';
  if (!back && !fwd) return;
  e.preventDefault(); e.stopImmediatePropagation();
  calDeckGo(deck, calDeckFocus + (fwd ? 1 : -1));
}, true);
