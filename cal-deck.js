'use strict';
/* =====================================================================
   cal-deck.js - the calendar, one day at a time.

   The calendar's second view. Every day of the month is a card, and one is
   in focus. On a computer they stand in a row like pictures in a gallery:
   the day in focus faces you and the days either side turn away from it.
   On a phone they are a stack: the day in focus on top, the next days
   peeking out underneath. Swipe, drag, click a neighbour or use the arrow
   keys to move; past the last day of the month the next month carries on.

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
    <p class="cal-deck-count" aria-live="polite"></p>
  </section>`;
}

// Lays the cards out around a position, which can sit between two days
// while a finger is dragging.
function calDeckLayout(deck, pos, instant) {
  const vertical = window.matchMedia(CAL_DECK_MQ).matches;
  deck.classList.toggle('is-vertical', vertical);
  deck.classList.toggle('is-dragging', !!instant);
  const cards = [...deck.querySelectorAll('.cal-card')];
  cards.forEach((c, i) => {
    const o = i + 1 - pos, a = Math.abs(o);
    const shown = vertical ? (o > -1.2 && o < 3.2) : a < 3.2;
    // Which card is in focus is settled first, for every card, so a card
    // that has moved far off never keeps the flag.
    const focus = Math.round(pos) === i + 1;
    c.classList.toggle('is-focus', focus);
    if (focus) c.removeAttribute('inert'); else c.setAttribute('inert', '');
    c.style.visibility = shown ? '' : 'hidden';
    c.style.pointerEvents = shown ? '' : 'none';
    if (!shown) return;
    let tr, op;
    if (vertical) {
      // The stack: the next days sit underneath, a step lower and smaller;
      // the day before slides up and away.
      if (o >= 0) { tr = `translate3d(0, ${o * 14}px, 0) scale(${1 - o * .06})`; op = o < 2.6 ? 1 : 3.2 - o; }
      else { tr = `translate3d(0, ${o * 110}%, 0) scale(1)`; op = 1 + o; }
    } else {
      // The gallery: the day in focus faces you, the others turn away.
      const rot = Math.max(-42, Math.min(42, -o * 34));
      tr = `translate3d(${o * 64}%, 0, ${-a * 140}px) rotateY(${rot}deg) scale(${1 - Math.min(a, 2) * .06})`;
      // Solid, so the card behind never shows through; dimmed instead.
      op = a < 2.4 ? 1 : 3.2 - a;
    }
    c.style.transform = tr;
    c.style.opacity = String(Math.max(0, op));
    c.style.filter = vertical ? '' : `brightness(${1 - Math.min(a, 2) * .05})`;
    c.style.zIndex = String(100 - Math.round(a * 10) - (o < 0 && vertical ? 50 : 0));
  });
  const cnt = deck.querySelector('.cal-deck-count');
  if (cnt) cnt.textContent = tf('cal_card_count', Math.round(pos), cards.length);
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

function calDeckWire(root) {
  const deck = root.querySelector('#calDeck');
  if (!deck) return;
  const stage = deck.querySelector('.cal-deck-stage');
  calDeckLayout(deck, calDeckFocus, true);
  requestAnimationFrame(() => deck.classList.remove('is-dragging'));
  deck.querySelectorAll('[data-deck-step]').forEach(b => b.addEventListener('click', () => calDeckGo(deck, calDeckFocus + (+b.dataset.deckStep))));
  // Dragging: the cards follow the finger, then settle on the nearest day.
  // A press that barely moves stays a tap, so buttons and side cards work.
  let start = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const vertical = deck.classList.contains('is-vertical');
    start = { x: e.clientX, y: e.clientY, t: Date.now(), vertical, size: (vertical ? stage.clientHeight * .55 : stage.querySelector('.cal-card').offsetWidth * .64) || 300, moved: false, id: e.pointerId };
  });
  stage.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    const d = start.vertical ? e.clientY - start.y : e.clientX - start.x, cross = start.vertical ? e.clientX - start.x : e.clientY - start.y;
    if (!start.moved) {
      if (Math.abs(d) < 8 || Math.abs(d) < Math.abs(cross)) return;
      start.moved = true;
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    }
    e.preventDefault();
    const n = deck.querySelectorAll('.cal-card').length;
    calDeckLayout(deck, Math.max(.6, Math.min(n + .4, calDeckFocus - d / start.size)), true);
  });
  const end = e => {
    if (!start || e.pointerId !== start.id) return;
    const s = start; start = null;
    if (!s.moved) return;
    const d = s.vertical ? e.clientY - s.y : e.clientX - s.x, v = d / Math.max(1, Date.now() - s.t);
    let steps = -Math.round(d / s.size);
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
  // A trackpad's sideways swipe moves a day at a time.
  let wheelAt = 0;
  stage.addEventListener('wheel', e => {
    const d = deck.classList.contains('is-vertical') ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 18 || Math.abs(deck.classList.contains('is-vertical') ? e.deltaX : e.deltaY) > Math.abs(d)) return;
    e.preventDefault();
    if (Date.now() - wheelAt < 380) return;
    wheelAt = Date.now();
    calDeckGo(deck, calDeckFocus + (d > 0 ? 1 : -1));
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
    cal_card_count: 'Day {0} of {1}'
  }); } catch (e) {}
})();

// With the day cards on screen, the arrow keys move a day at a time, ahead
// of the calendar's own month keys. Up and down do the same as left and
// right, so the phone's stack and the gallery behave alike.
document.addEventListener('keydown', e => {
  const deck = document.getElementById('calDeck');
  if (!deck || !document.getElementById('bview-calendar')?.classList.contains('is-active')) return;
  if (e.target.closest && e.target.closest('input, textarea, select, .modal-overlay, .dd-menu, .fk-datepop')) return;
  if (!document.getElementById('tutorialOverlay')?.hidden) return;
  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp', fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
  if (!back && !fwd) return;
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !deck.contains(e.target)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  calDeckGo(deck, calDeckFocus + (fwd ? 1 : -1));
}, true);
