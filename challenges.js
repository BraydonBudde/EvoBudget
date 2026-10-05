'use strict';
/* =====================================================================
   challenges.js - Challenges: small games for the moment just before a
   spend. Win, and the money that would have gone on it goes to one of the
   person's savings goals or debts instead.

   Every game ends the same way when the money wins: one transaction, the
   same kind the app logs everywhere else (a goal contribution, or a debt
   payment), its description naming the game. So the goal's balance moves,
   the debt counts it as paid, Undo takes it back, and the free trial's cap
   applies, exactly as for any other entry.

   With no goal and no debt there is still somewhere for a win to go: a
   Challenge Jar, a savings goal with no target that is only made when the
   first win lands in it.

   Each play is kept in state.challenges.history. What a play saved is read
   from its transaction, so editing or deleting that transaction is always
   reflected in the totals here and on the dashboard.

   Games are grouped by category. Only categories with games are shown.
   ===================================================================== */

const CH_CATS = [
  { id: 'decide', games: ['coinflip'] }
];
// What tempts people most. `cat` is the row of DEFAULT_BUDGET's spending
// list it would be logged under if the coin says go ahead.
const CH_PRESETS = [
  { id: 'takeout', emoji: '🍔', cat: 1 },
  { id: 'coffee', emoji: '☕', cat: 1 },
  { id: 'treat', emoji: '🍩', cat: 1 },
  { id: 'shopping', emoji: '🛍️', cat: 3 },
  { id: 'night', emoji: '🎟️', cat: 10 },
  { id: 'other', emoji: '✨', cat: -1 }
];
const CH_HISTORY_MAX = 500;
const CH_JAR_ICON = '🫙';
const chAttr = s => esc(s).replace(/"/g, '&quot;');
const chRound = n => Math.round((Number(n) || 0) * 100) / 100;

// Fair, and replaceable in tests.
function chRandom() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); }
}

function chData() {
  if (!state.challenges || typeof state.challenges !== 'object') state.challenges = {};
  const c = state.challenges;
  if (!Array.isArray(c.history)) c.history = [];
  if (!c.last || typeof c.last !== 'object') c.last = {};
  return c;
}
function chTxOf(e) { return e && e.txId ? (state.transactions || []).find(x => x.id === e.txId) || null : null; }
function chLabel(e) { return e.preset === 'other' ? (e.label || t('ch_p_other')) : t('ch_p_' + e.preset); }
function chStats(game) {
  const h = chData().history.filter(e => !game || e.game === game);
  const ps = state.settings.periodStart || '', pe = state.settings.periodEnd || '';
  let saved = 0, period = 0, wins = 0, skipped = 0;
  h.forEach(e => {
    if (e.side === 'heads') skipped++;
    const tx = chTxOf(e);
    if (!tx) return;
    const a = Number(tx.amount) || 0;
    saved += a; wins++;
    if (ps && pe && tx.date >= ps && tx.date <= pe) period += a;
  });
  return { plays: h.length, saved: chRound(saved), period: chRound(period), wins, skipped };
}

// ── Where a win can go ───────────────────────────────────────────────
// Every goal, and every debt still owed. A paid-off debt is left out.
function chTargets() {
  const out = [];
  (state.sinkingFunds || []).forEach(f => {
    const has = fundHasTarget(f), s = Number(f.currentSaved) || 0;
    out.push({ key: 'goal:' + f.id, kind: 'goal', id: f.id, name: f.name,
      ico: `<span class="cf-t-emoji">${esc(f.icon && f.icon.length <= 4 ? f.icon : '🏺')}</span>`,
      sub: has ? tf('ch_of', fmt(s), fmt(f.targetAmount)) : tf('ch_saved_sub', fmt(s)) });
  });
  (state.debts || []).filter(d => (Number(d.balance) || 0) > 0).forEach(d => out.push({ key: 'debt:' + d.id, kind: 'debt', id: d.id, name: d.name,
    ico: appIconSvg('debt'), sub: tf('ch_owed_sub', fmt(d.balance)) }));
  return out;
}
function chJarGoal() {
  const c = chData();
  return (state.sinkingFunds || []).find(f => f.id === c.jarId) || null;
}
// The jar is offered until it exists; from then on it is a goal like any other.
function chJarOffer() {
  if (chJarGoal() || (state.sinkingFunds || []).some(f => f.name === t('ch_jar'))) return null;
  return { key: 'jar', kind: 'jar', id: 'jar', name: t('ch_jar'), ico: `<span class="cf-t-emoji">${CH_JAR_ICON}</span>`, sub: t('ch_jar_sub') };
}
function chTargetList() { const l = chTargets(), j = chJarOffer(); return j ? l.concat(j) : l; }
function chFindTarget(key) { return chTargetList().find(x => x.key === key) || null; }

// ── Putting the money there ──────────────────────────────────────────
// One transaction, the kind the rest of the app logs for this target.
// Returns it, or null when nothing was logged (and says why).
function chSave(entry, bonus) {
  if (!entry || chTxOf(entry)) return null;
  if (trialBlocks('transaction')) { showUpgradeModal({ reason: 'transaction' }); return null; }
  let tg = entry.target || {};
  if (tg.kind === 'jar') {
    const c = chData(), name = t('ch_jar');
    // A goal already called that is used rather than a second of the same name.
    let f = chJarGoal() || (state.sinkingFunds || []).find(x => x.name === name);
    if (!f) {
      if (trialBlocks('sinkingFunds')) { showUpgradeModal({ reason: 'sinkingFunds' }); return null; }
      f = { id: uid(), name, icon: CH_JAR_ICON, targetAmount: 0, currentSaved: 0, targetDate: '' };
      if (!Array.isArray(state.sinkingFunds)) state.sinkingFunds = [];
      state.sinkingFunds.push(f); trialUse('sinkingFunds');
    }
    c.jarId = f.id;
    tg = { kind: 'goal', id: f.id, name: f.name };
  }
  const goal = tg.kind === 'goal' ? (state.sinkingFunds || []).find(f => f.id === tg.id) : null;
  const debt = tg.kind === 'debt' ? (state.debts || []).find(d => d.id === tg.id) : null;
  if (!goal && !debt) { showToast(t('ch_target_gone')); return null; }
  const amount = chRound(entry.amount);
  if (!(amount > 0)) return null;
  let alloc = null;
  if (goal && state.allocation?.enabled) {
    const b = (state.allocation.buckets || []).find(x => x.id === 'save');
    if (b) alloc = b.id;
  }
  const tx = { id: uid(), date: today(), type: goal ? 'sinking_fund' : 'debt', category: goal ? goal.name : debt.name,
    amount, description: tf(bonus ? 'ch_cf_tx_bonus' : 'ch_cf_tx_heads', chLabel(entry)), allocation: alloc };
  state.transactions.push(tx); noteAdded(tx);
  trialUse('transaction');
  applySinkingFundDelta(tx, +1);
  entry.txId = tx.id;
  entry.bonus = !!bonus;
  entry.target = { kind: tg.kind, id: tg.id, name: tx.category };
  chData().last.target = tg.kind + ':' + tg.id;
  saveState();
  showUndoToast(tf('ch_toast_saved', fmt(amount), tx.category));
  return tx;
}

// ── The page ─────────────────────────────────────────────────────────
let _ch = { screen: 'lobby', all: false };
let _cf = null;

function renderChallenges() {
  try { queueNavBadges(); } catch (e) {}
  const el = document.getElementById('bview-challenges');
  if (!el) return;
  if (_ch.screen === 'coinflip') return cfRender(el);
  chRenderLobby(el);
}

function chRenderLobby(el) {
  const st = chStats();
  const hist = chData().history;
  const games = id => CH_CATS.find(c => c.id === id).games;
  const gameCard = g => {
    const s = chStats(g);
    const meta = s.plays ? `<span class="ch-gc-meta">${esc(tf(s.plays === 1 ? 'ch_plays_1' : 'ch_plays_n', s.plays))}${s.saved > 0 ? ` · <b>${esc(tf('ch_gc_saved', fmt(s.saved)))}</b>` : ''}</span>` : '';
    return `<button class="ch-gc" type="button" data-ch-play="${g}">
      <span class="ch-gc-art" aria-hidden="true"><span class="ch-mini-coin">${CF_SKULL}</span></span>
      <span class="ch-gc-body"><b class="ch-gc-title">${esc(t('ch_cf_title'))}</b><span class="ch-gc-desc">${esc(t('ch_cf_desc'))}</span>${meta}</span>
      <span class="btn btn-primary btn-sm ch-gc-go">${esc(t('ch_play'))}</span>
    </button>`;
  };
  const rows = _ch.all ? hist : hist.slice(0, 8);
  el.innerHTML = `<div class="section-header"><h2 class="section-title">${appIconSvg('challenges')} ${esc(t('tab_challenges'))}</h2></div>
    <p class="section-desc">${esc(t('ch_desc'))}</p>
    ${st.plays ? `<div class="ch-stats">
      <div class="ch-stat ch-stat--main"><span class="ch-stat-k">${esc(t('ch_stat_saved'))}</span><b class="ch-stat-v">${fmt(st.saved)}</b></div>
      <div class="ch-stat"><span class="ch-stat-k">${esc(t('ch_stat_period'))}</span><b class="ch-stat-v">${fmt(st.period)}</b></div>
      <div class="ch-stat"><span class="ch-stat-k">${esc(t('ch_stat_skipped'))}</span><b class="ch-stat-v">${st.skipped}</b></div>
    </div>` : ''}
    ${CH_CATS.filter(c => c.games.length).map(c => `<section class="ch-cat">
      <div class="ch-cat-head"><h3 class="ov-title">${esc(t('ch_cat_' + c.id))}</h3><p class="ch-cat-desc">${esc(t('ch_cat_' + c.id + '_desc'))}</p></div>
      <div class="ch-games">${games(c.id).map(gameCard).join('')}</div>
    </section>`).join('')}
    <section class="panel ch-hist"><div class="panel-inner-sm">
      <div class="psf-head"><h3 class="ov-title">${esc(t('ch_hist_title'))}</h3></div>
      ${hist.length ? `<div class="ch-h-list">${rows.map(chHistRow).join('')}</div>
        ${hist.length > 8 ? `<button class="link-btn ch-h-more" type="button" data-ch-all>${esc(_ch.all ? t('ch_show_less') : tf('ch_show_all', hist.length))}</button>` : ''}`
      : `<p class="ch-h-empty">${esc(t('ch_hist_empty'))}</p>`}
    </div></section>`;
  el.querySelectorAll('[data-ch-play]').forEach(b => b.addEventListener('click', () => chOpenGame(b.dataset.chPlay)));
  el.querySelector('[data-ch-all]')?.addEventListener('click', () => { _ch.all = !_ch.all; renderChallenges(); });
  el.querySelectorAll('[data-ch-save]').forEach(b => b.addEventListener('click', () => {
    const e = chData().history.find(x => x.id === b.dataset.chSave);
    if (e && chSave(e, e.side === 'tails')) renderChallenges();
  }));
}

function chStatus(e) {
  const tx = chTxOf(e);
  if (tx) return e.bonus ? 'bonus' : 'saved';
  if (e.txId) return 'undone';
  return e.side === 'heads' ? 'kept' : 'enjoyed';
}
function chHistRow(e) {
  const s = chStatus(e), tx = chTxOf(e), lbl = chLabel(e);
  const title = s === 'saved' ? tf('ch_h_saved', lbl) : s === 'bonus' ? tf('ch_h_bonus', lbl) : s === 'kept' ? tf('ch_h_kept', lbl)
    : s === 'undone' ? tf('ch_h_undone', lbl) : tf('ch_h_enjoyed', lbl);
  const sub = [t('ch_cf_title'), formatDateShort(e.date)];
  if (tx) sub.push(tf('ch_h_to', tx.category));
  const preset = CH_PRESETS.find(p => p.id === e.preset) || CH_PRESETS[CH_PRESETS.length - 1];
  return `<div class="ch-h-row ch-h--${s}" data-ch-entry="${chAttr(e.id)}">
    <span class="ch-h-ico" aria-hidden="true">${preset.emoji}</span>
    <span class="ch-h-main"><b>${esc(title)}</b><small>${esc(sub.join(' · '))}</small></span>
    ${s === 'kept' ? `<button class="btn btn-ghost btn-sm ch-h-save" type="button" data-ch-save="${chAttr(e.id)}">${esc(t('ch_save_now'))}</button>` : ''}
    <span class="ch-h-amt">${tx ? '+' + fmt(tx.amount) : fmt(e.amount)}</span>
  </div>`;
}

function chOpenGame(id) {
  if (id !== 'coinflip') return;
  const last = chData().last;
  const keep = _cf && _cf.phase !== 'flipping' ? _cf : null;
  const r = chRange();
  _cf = {
    phase: 'setup',
    preset: keep ? keep.preset : (CH_PRESETS.some(p => p.id === last.preset) ? last.preset : 'takeout'),
    label: keep ? keep.label : (last.label || ''),
    amount: chClamp(keep ? keep.amount : (Number(last.amount) > 0 ? Number(last.amount) : 25), r),
    target: keep ? keep.target : (last.target || ''),
    entry: null, err: ''
  };
  _ch.screen = 'coinflip';
  renderChallenges();
  document.querySelector('.app-scroll')?.scrollTo({ top: 0 });
}
function chBackToLobby() { _ch.screen = 'lobby'; if (_cf && _cf.phase !== 'flipping') _cf.phase = 'setup'; renderChallenges(); }

// ── The bounty's range ───────────────────────────────────────────────
// The lowest and highest amount the slider goes to, set in Settings.
const CH_RANGE_DEFAULT = { min: 0, max: 100 };
const CH_RANGE_CAP = 1000000;
function chRange() {
  const r = (state.settings && state.settings.cfRange) || {};
  const min = Number(r.min), max = Number(r.max);
  if (!(min >= 0) || !(max > min) || max > CH_RANGE_CAP) return { ...CH_RANGE_DEFAULT };
  return { min, max };
}
// Whole steps for a short range, larger ones for a long one, so the
// slider never has more positions than a hand can land on.
function chStep(r) { const s = r.max - r.min; return s <= 200 ? 1 : s <= 2000 ? 5 : s <= 20000 ? 50 : 100; }
function chClamp(v, r) { r = r || chRange(); const n = Math.round(Number(v) || 0); return Math.min(r.max, Math.max(r.min, n)); }
// Whole amounts read best above the slider.
const chBounty = v => fmt(v).replace(/\.00(?!\d)/, '');

function chRangeCardHtml() {
  const r = chRange();
  return `<div class="panel"><div class="panel-inner">
    <div class="settings-card-title">🏆 ${esc(t('ch_set_title'))}</div>
    <p class="settings-desc">${esc(t('ch_set_desc'))}</p>
    <div class="ch-range-fields">
      <div class="field"><label class="field-label" for="cfMinInput">${esc(t('ch_set_min'))}</label><input class="input" id="cfMinInput" type="number" inputmode="numeric" min="0" step="1" value="${r.min}"></div>
      <div class="field"><label class="field-label" for="cfMaxInput">${esc(t('ch_set_max'))}</label><input class="input" id="cfMaxInput" type="number" inputmode="numeric" min="1" step="1" value="${r.max}"></div>
    </div>
    <p class="ch-range-err" id="cfRangeErr" hidden></p>
  </div></div>`;
}
function chWireRangeCard(el) {
  const minI = el.querySelector('#cfMinInput'), maxI = el.querySelector('#cfMaxInput'), err = el.querySelector('#cfRangeErr');
  if (!minI || !maxI) return;
  const commit = () => {
    const min = Math.round(Number(minI.value)), max = Math.round(Number(maxI.value));
    const bad = minI.value === '' || maxI.value === '' || !(min >= 0) ? t('ch_set_err_min')
      : !(max > min) ? t('ch_set_err_order') : max > CH_RANGE_CAP ? tf('ch_set_err_cap', fmt(CH_RANGE_CAP)) : '';
    err.hidden = !bad; err.textContent = bad;
    minI.classList.toggle('fk-invalid', !!bad && (bad === t('ch_set_err_min')));
    maxI.classList.toggle('fk-invalid', !!bad && bad !== t('ch_set_err_min'));
    if (bad) return;
    state.settings.cfRange = { min, max };
    if (_cf) _cf.amount = chClamp(_cf.amount, { min, max });
    saveState();
  };
  minI.addEventListener('change', commit);
  maxI.addEventListener('change', commit);
}

// ── Coin Flip ────────────────────────────────────────────────────────
// A pirate's call: the coin is a gold doubloon tossed over the sea, with
// the amount and its slider in the same card. Heads, the treasure is
// stashed in a goal or debt; tails, feast.
const cfAmount = () => chRound(_cf.amount);
function cfCurrentTarget() {
  const list = chTargetList();
  return list.find(x => x.key === _cf.target) || list[0] || null;
}
function cfLabelNow() { return _cf.preset === 'other' ? (_cf.label.trim() || t('ch_p_other')) : t('ch_p_' + _cf.preset); }
// A plain skull and crossbones, drawn here: the doubloon's face.
const CF_SKULL = `<svg class="cf-skull" viewBox="0 0 64 64" aria-hidden="true">
  <g class="cf-skull-bone"><rect x="5" y="40" width="54" height="7" rx="3.5" transform="rotate(30 32 43.5)"/><rect x="5" y="40" width="54" height="7" rx="3.5" transform="rotate(-30 32 43.5)"/></g>
  <path class="cf-skull-head" d="M32 6C20.4 6 12 13.9 12 24.3c0 6.4 3.2 11.2 8 14V44a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3v-5.7c4.8-2.8 8-7.6 8-14C52 13.9 43.6 6 32 6z"/>
  <g class="cf-skull-hole"><ellipse cx="24.5" cy="26" rx="5" ry="5.6"/><ellipse cx="39.5" cy="26" rx="5" ry="5.6"/><path d="M32 32.5l-3 5.5h6z"/>
    <rect x="25.6" y="41" width="2.4" height="6" rx="1"/><rect x="30.8" y="41" width="2.4" height="6" rx="1"/><rect x="36" y="41" width="2.4" height="6" rx="1"/></g>
</svg>`;
const CF_WAVE = '<svg viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 Q 75 0 150 30 T 300 30 T 450 30 T 600 30 T 750 30 T 900 30 T 1050 30 T 1200 30 V 60 H 0 Z"/></svg>';

function cfRender(el) {
  const r = chRange();
  el.innerHTML = `<div class="ch-game">
    <button class="ch-back" type="button" data-ch-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>${esc(t('ch_back'))}</button>
    <div class="ch-game-head">
      <span class="ch-eyebrow">${esc(t('ch_cat_decide'))}</span>
      <h2 class="section-title">${esc(t('ch_cf_title'))}</h2>
      <p class="section-desc">${esc(t('ch_cf_desc'))}</p>
    </div>
    <div class="cf">
      <section class="panel cf-setup" id="cfSetup"><div class="panel-inner-sm">
        <p class="cf-step"><b>1</b>${esc(t('ch_step_what'))}</p>
        <div class="cf-presets" role="radiogroup" aria-label="${chAttr(t('ch_step_what'))}">${CH_PRESETS.map(p =>
          `<button class="qa-chip cf-preset" type="button" role="radio" data-cf-preset="${p.id}"><span aria-hidden="true">${p.emoji}</span>${esc(t('ch_p_' + p.id))}</button>`).join('')}</div>
        <input class="input cf-other" id="cfOther" type="text" maxlength="40" autocomplete="off" placeholder="${chAttr(t('ch_other_ph'))}" hidden>
        <p class="cf-step"><b>2</b>${esc(t('ch_step_where'))}</p>
        <div class="cf-targets" id="cfTargets" role="radiogroup" aria-label="${chAttr(t('ch_step_where'))}"></div>
      </div></section>
      <section class="panel cf-play"><div class="panel-inner-sm">
        <div class="cf-stage" id="cfStage">
          <i class="cf-sun" aria-hidden="true"></i>
          <i class="cf-gull cf-gull--a" aria-hidden="true"></i><i class="cf-gull cf-gull--b" aria-hidden="true"></i>
          <div class="cf-waves" aria-hidden="true"><div class="cf-wave cf-wave--back">${CF_WAVE}${CF_WAVE}</div><div class="cf-wave cf-wave--front">${CF_WAVE}${CF_WAVE}</div></div>
          <div class="cf-toss" id="cfToss">
            <div class="cf-coin is-idle" id="cfCoin">
              <div class="cf-face cf-face--heads"><span class="cf-face-ico">${CF_SKULL}</span><span class="cf-face-word">${esc(t('ch_face_heads'))}</span></div>
              <div class="cf-face cf-face--tails"><span class="cf-face-ico cf-face-emoji" id="cfTailsEmoji"></span><span class="cf-face-word">${esc(t('ch_face_tails'))}</span></div>
            </div>
          </div>
          <div class="cf-shadow" id="cfShadow"></div>
        </div>
        <div class="cf-amount" id="cfAmountBox">
          <div class="cf-amount-top"><span class="cf-amount-k">${esc(t('ch_step_cost'))}</span><b class="cf-amount-v" id="cfDisplay"></b></div>
          <input class="cf-slider" id="cfSlider" type="range" min="${r.min}" max="${r.max}" step="${chStep(r)}" value="${cfAmount()}" aria-label="${chAttr(t('ch_step_cost'))}">
          <div class="cf-slider-ends"><span>${esc(chBounty(r.min))}</span><button class="link-btn cf-range-link" type="button" data-cf-range>${esc(t('ch_range_link'))}</button><span>${esc(chBounty(r.max))}</span></div>
        </div>
        <div class="cf-panel" id="cfPanel" aria-live="polite"></div>
      </div></section>
    </div>
  </div>`;
  const $ = id => document.getElementById(id);
  el.querySelector('[data-ch-back]').addEventListener('click', chBackToLobby);
  el.querySelectorAll('[data-cf-preset]').forEach(b => b.addEventListener('click', () => {
    if (_cf.phase !== 'setup') return;
    _cf.preset = b.dataset.cfPreset; b.blur();
    cfPaintSetup(); cfPaintAmount();
    if (_cf.preset === 'other') $('cfOther').focus();
  }));
  $('cfOther').value = _cf.label;
  $('cfOther').addEventListener('input', e => { _cf.label = e.target.value.slice(0, 40); cfPaintAmount(); cfPaintPanel(); });
  $('cfSlider').addEventListener('input', e => {
    if (_cf.phase !== 'setup') return;
    _cf.amount = chClamp(e.target.value);
    cfPaintAmount(); cfPaintPanel();
  });
  el.querySelector('[data-cf-range]').addEventListener('click', () => {
    switchTab('settings');
    const f = document.getElementById('cfMaxInput');
    if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
  });
  $('cfCoin').addEventListener('click', () => { if (_cf.phase === 'setup') cfFlip(); });
  cfPaintSetup();
  cfPaintAmount();
  cfPaintCoin();
  cfPaintPanel();
}

function cfPaintAmount() {
  const d = document.getElementById('cfDisplay');
  if (!d) return;
  const r = chRange(), a = cfAmount();
  d.textContent = chBounty(a);
  const s = document.getElementById('cfSlider');
  if (s) {
    if (Number(s.value) !== a) s.value = a;
    s.style.setProperty('--fill', ((a - r.min) / (r.max - r.min) * 100).toFixed(2) + '%');
  }
}
function cfPaintSetup() {
  const setup = document.getElementById('cfSetup');
  if (!setup) return;
  const locked = _cf.phase !== 'setup';
  setup.classList.toggle('is-locked', locked);
  setup.querySelectorAll('button, input').forEach(x => { x.disabled = locked; });
  document.querySelectorAll('#cfAmountBox input, #cfAmountBox button').forEach(x => { x.disabled = locked; });
  document.getElementById('cfAmountBox')?.classList.toggle('is-locked', locked);
  setup.querySelectorAll('[data-cf-preset]').forEach(b => {
    const on = b.dataset.cfPreset === _cf.preset;
    b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on);
  });
  const other = document.getElementById('cfOther');
  other.hidden = _cf.preset !== 'other';
  const emoji = document.getElementById('cfTailsEmoji');
  if (emoji) emoji.textContent = (CH_PRESETS.find(p => p.id === _cf.preset) || CH_PRESETS[0]).emoji;
  cfPaintTargets();
}
function cfPaintTargets() {
  const box = document.getElementById('cfTargets');
  if (!box) return;
  const list = chTargetList();
  const cur = cfCurrentTarget();
  if (cur) _cf.target = cur.key;
  const locked = _cf.phase !== 'setup';
  const real = chTargets().length;
  box.innerHTML = list.map(x => `<button class="cf-target${cur && x.key === cur.key ? ' is-on' : ''}${x.kind === 'jar' ? ' cf-target--jar' : ''}" type="button" role="radio" aria-checked="${!!(cur && x.key === cur.key)}" data-cf-target="${chAttr(x.key)}"${locked ? ' disabled' : ''}>
      <span class="cf-t-ico" aria-hidden="true">${x.ico}</span>
      <span class="cf-t-txt"><b>${esc(x.name)}</b><small>${esc((x.kind === 'jar' ? '' : t(x.kind === 'goal' ? 'ch_kind_goal' : 'ch_kind_debt') + ' · ') + x.sub)}</small></span>
      <span class="cf-t-tick" aria-hidden="true">${DD_TICK}</span>
    </button>`).join('')
    + (real ? '' : `<p class="cf-none">${esc(t('ch_none'))} <button class="link-btn" type="button" data-cf-new="goal"${locked ? ' disabled' : ''}>${esc(t('ch_new_goal'))}</button> · <button class="link-btn" type="button" data-cf-new="debt"${locked ? ' disabled' : ''}>${esc(t('ch_new_debt'))}</button></p>`);
  box.querySelectorAll('[data-cf-target]').forEach(b => b.addEventListener('click', () => {
    if (_cf.phase !== 'setup') return;
    _cf.target = b.dataset.cfTarget; b.blur();
    cfPaintTargets(); cfPaintPanel();
  }));
  box.querySelector('[data-cf-new="goal"]')?.addEventListener('click', () => { switchTab('goals'); openFundModal(); });
  box.querySelector('[data-cf-new="debt"]')?.addEventListener('click', () => { switchTab('debt'); if (typeof openDebtModal === 'function') openDebtModal(null); });
}
function cfPaintCoin() {
  const coin = document.getElementById('cfCoin');
  if (!coin) return;
  const side = _cf.phase === 'result' && _cf.entry ? _cf.entry.side : 'heads';
  coin.classList.toggle('is-tails', side === 'tails');
  coin.classList.toggle('is-idle', _cf.phase === 'setup');
  coin.setAttribute('aria-label', _cf.phase === 'result' && _cf.entry ? t(side === 'tails' ? 'ch_tails' : 'ch_heads') : t('ch_flip'));
  coin.setAttribute('role', 'img');
}

function cfPaintPanel() {
  const p = document.getElementById('cfPanel');
  if (!p) return;
  const amt = cfAmount(), tg = cfCurrentTarget();
  if (_cf.phase === 'setup' || _cf.phase === 'flipping') {
    if (_cf.err && amt > 0 && tg) _cf.err = '';
    const busy = _cf.phase === 'flipping';
    p.className = 'cf-panel';
    p.innerHTML = `<div class="cf-rules">
        <div class="cf-rule cf-rule--heads"><span class="cf-rule-side">${esc(t('ch_heads'))}</span><span>${esc(tf('ch_rule_heads', amt > 0 ? fmt(amt) : t('ch_the_money'), tg ? tg.name : '…'))}</span></div>
        <div class="cf-rule cf-rule--tails"><span class="cf-rule-side">${esc(t('ch_tails'))}</span><span>${esc(t('ch_rule_tails'))}</span></div>
      </div>
      <button class="btn btn-primary cf-flip" id="cfFlipBtn" type="button"${busy ? ' disabled' : ''}>${esc(t(busy ? 'ch_flipping' : 'ch_flip'))}</button>
      <p class="cf-err" id="cfErr"${_cf.err ? '' : ' hidden'}>${esc(_cf.err)}</p>`;
    p.querySelector('#cfFlipBtn').addEventListener('click', cfFlip);
    return;
  }
  const e = _cf.entry;
  const tx = chTxOf(e);
  if (tx) {
    // Stashed: say where it went, and show the goal move when it has a bar.
    const goal = e.target.kind === 'goal' ? (state.sinkingFunds || []).find(f => f.id === e.target.id) : null;
    const has = goal && fundHasTarget(goal);
    const now = has ? Math.min(100, Math.round((goal.currentSaved || 0) / goal.targetAmount * 100)) : 0;
    const was = has ? Math.min(100, Math.max(0, Math.round(((goal.currentSaved || 0) - tx.amount) / goal.targetAmount * 100))) : 0;
    p.className = 'cf-panel cf-panel--win is-in';
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge">${DD_TICK}</span><span class="cf-verdict-txt"><b>${esc(t('ch_saved_title'))}</b><span>${esc(tf('ch_saved_line', fmt(tx.amount), tx.category))}</span></span></div>
      ${has ? `<div class="cf-prog"><div class="cf-prog-top"><span>${esc(goal.name)}</span><span>${esc(tf('ch_of', fmt(goal.currentSaved || 0), fmt(goal.targetAmount)))}</span></div><div class="cf-prog-bar"><i id="cfProg" style="width:${was}%" data-to="${now}"></i></div></div>` : ''}
      <div class="cf-acts">
        <button class="btn btn-primary" type="button" data-cf-again>${esc(t('ch_again'))}</button>
        <button class="btn btn-ghost" type="button" data-cf-open>${esc(tf('ch_open_target', tx.category))}</button>
      </div>`;
    const bar = p.querySelector('#cfProg');
    if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = bar.dataset.to + '%'; }));
    p.querySelector('[data-cf-open]').addEventListener('click', () => {
      if (e.target.kind === 'goal') { switchTab('goals'); } else { switchTab('debt'); }
    });
  } else if (e.side === 'heads') {
    p.className = 'cf-panel cf-panel--heads is-in';
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge cf-badge--skull">${CF_SKULL}</span><span class="cf-verdict-txt"><b>${esc(t('ch_res_heads'))}</b><span>${esc(tf('ch_res_heads_line', fmt(e.amount), cfTargetName(e)))}</span></span></div>
      <div class="cf-acts">
        <button class="btn btn-primary" type="button" data-cf-save>${esc(tf('ch_save_btn', fmt(e.amount)))}</button>
        <button class="btn btn-ghost" type="button" data-cf-again>${esc(t('ch_not_now'))}</button>
      </div>`;
  } else {
    const emoji = (CH_PRESETS.find(x => x.id === e.preset) || CH_PRESETS[0]).emoji;
    p.className = 'cf-panel cf-panel--tails is-in';
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge cf-badge--emoji">${emoji}</span><span class="cf-verdict-txt"><b>${esc(t('ch_res_tails'))}</b><span>${esc(t('ch_res_tails_line'))}</span></span></div>
      <div class="cf-acts">
        <button class="btn btn-primary" type="button" data-cf-log>${esc(t('ch_log_spend'))}</button>
        <button class="btn btn-ghost" type="button" data-cf-bonus>${esc(tf('ch_save_anyway', fmt(e.amount)))}</button>
      </div>
      <button class="link-btn cf-again-link" type="button" data-cf-again>${esc(t('ch_again'))}</button>`;
  }
  p.querySelector('[data-cf-again]')?.addEventListener('click', cfAgain);
  p.querySelector('[data-cf-save]')?.addEventListener('click', ev => cfSaveNow(ev.currentTarget, false));
  p.querySelector('[data-cf-bonus]')?.addEventListener('click', ev => cfSaveNow(ev.currentTarget, true));
  p.querySelector('[data-cf-log]')?.addEventListener('click', () => cfLogSpend(e));
}
function cfTargetName(e) {
  if (e.target.kind === 'jar') return t('ch_jar');
  const live = e.target.kind === 'goal' ? (state.sinkingFunds || []).find(f => f.id === e.target.id) : (state.debts || []).find(d => d.id === e.target.id);
  return live ? live.name : e.target.name;
}

function cfFlip() {
  if (!_cf || _cf.phase !== 'setup') return;
  const amt = cfAmount(), tg = cfCurrentTarget();
  _cf.err = !(amt > 0) ? t('ch_need_amount') : !tg ? t('ch_need_target') : '';
  if (_cf.err) {
    cfPaintPanel();
    const box = document.getElementById('cfAmountBox');
    if (box) { box.classList.remove('cf-shake'); void box.offsetWidth; box.classList.add('cf-shake'); }
    return;
  }
  const side = chRandom() < 0.5 ? 'heads' : 'tails';
  _cf.phase = 'flipping';
  const entry = { id: uid(), game: 'coinflip', at: Date.now(), date: today(), side, amount: amt, preset: _cf.preset,
    label: _cf.preset === 'other' ? _cf.label.trim() : '', target: { kind: tg.kind, id: tg.id, name: tg.name }, txId: null };
  cfPaintSetup(); cfPaintPanel();
  const coin = document.getElementById('cfCoin'), toss = document.getElementById('cfToss'), shadow = document.getElementById('cfShadow');
  coin.classList.remove('is-idle', 'is-tails');
  document.getElementById('cfStage')?.scrollIntoView?.({ block: 'center', behavior: ddReduced() ? 'auto' : 'smooth' });
  // Lands once, whichever comes first: the animation ending, or a timer in
  // case the browser holds the animation back (a hidden tab, a busy device).
  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    const c = chData();
    c.history.unshift(entry);
    if (c.history.length > CH_HISTORY_MAX) c.history.length = CH_HISTORY_MAX;
    c.last = { preset: entry.preset, label: _cf.label, amount: amt, target: tg.key === 'jar' ? 'jar' : tg.key };
    saveState();
    if (!_cf || _cf.phase !== 'flipping') return;
    _cf.entry = entry; _cf.phase = 'result';
    if (!document.getElementById('cfPanel')) return;
    cfPaintCoin(); cfPaintPanel();
    const stage = document.getElementById('cfStage');
    if (stage) { stage.classList.remove('is-landed'); void stage.offsetWidth; stage.classList.add('is-landed'); }
  };
  const quick = ddReduced() || !coin.animate;
  if (quick) { coin.style.transform = ''; land(); return; }
  const DUR = 1500, end = 360 * 6 + (side === 'tails' ? 180 : 0);
  const spin = coin.animate([{ transform: 'rotateX(0deg)' }, { transform: `rotateX(${end}deg)` }], { duration: DUR, easing: 'cubic-bezier(.25,.7,.35,1)', fill: 'forwards' });
  setTimeout(() => { if (landed) return; try { spin.cancel(); } catch (e) {} land(); }, DUR + 1500);
  toss.animate([
    { transform: 'translateY(0) scale(1)', easing: 'cubic-bezier(.2,.65,.4,1)' },
    { transform: 'translateY(-100px) scale(1.12)', offset: .46, easing: 'cubic-bezier(.6,0,.8,.4)' },
    { transform: 'translateY(0) scale(1)' }
  ], { duration: DUR });
  shadow.animate([{ transform: 'scale(1)', opacity: .55 }, { transform: 'scale(.45)', opacity: .18, offset: .46 }, { transform: 'scale(1)', opacity: .55 }], { duration: DUR });
  spin.finished.then(() => {
    toss.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-14px)' }, { transform: 'translateY(0)' }], { duration: 260, easing: 'ease-out' });
    setTimeout(() => { try { spin.cancel(); } catch (e) {} land(); }, 270);
  }).catch(() => land());
}

function cfSaveNow(btn, bonus) {
  if (!_cf || !_cf.entry || _cf.phase !== 'result') return;
  if (btn) btn.disabled = true;
  const tx = chSave(_cf.entry, bonus);
  if (!tx) { if (btn) btn.disabled = false; return; }
  cfPaintTargets();
  cfPaintPanel();
  cfBurst();
}
// Gold coins thrown out from the doubloon, for a win.
function cfBurst() {
  const stage = document.getElementById('cfStage');
  if (!stage || ddReduced() || !stage.animate) return;
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('i');
    s.className = 'cf-spark';
    stage.appendChild(s);
    const a = (Math.PI * 2 * i) / 14 + (i % 2 ? .2 : -.1), r = 90 + (i % 3) * 26;
    const x = Math.cos(a) * r, y = Math.sin(a) * r - 30;
    s.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1)`, opacity: 1, offset: .6 },
      { transform: `translate(calc(-50% + ${x * 1.1}px), calc(-50% + ${y + 40}px)) scale(.8)`, opacity: 0 }], { duration: 900 + (i % 4) * 90, easing: 'cubic-bezier(.2,.7,.3,1)' })
      .finished.then(() => s.remove()).catch(() => s.remove());
  }
}
function cfAgain() {
  if (!_cf) return;
  _cf.phase = 'setup'; _cf.entry = null; _cf.err = '';
  cfPaintSetup(); cfPaintCoin(); cfPaintAmount(); cfPaintPanel();
}
// Tails: the spend goes in the log like any other, through the keypad,
// already filled in. Its category is guessed only when the planner has it.
function cfLogSpend(e) {
  const p = CH_PRESETS.find(x => x.id === e.preset);
  const name = p && p.cat >= 0 ? DEFAULT_BUDGET.en.expenses[p.cat] : '';
  const cat = (state.budgets.expenses || []).map(r => r.category).find(c => c === name) || '';
  openQuickAddTx({ type: 'expense', amount: e.amount, category: cat, description: tf('ch_cf_tx_tails', chLabel(e)) });
}

// Enter flips; the slider takes the arrow keys itself.
document.addEventListener('keydown', e => {
  if (typeof currentTab === 'undefined' || currentTab !== 'challenges' || _ch.screen !== 'coinflip' || !_cf || _cf.phase !== 'setup') return;
  if (!document.getElementById('cfSlider')) return;
  const ov = document.getElementById('tutorialOverlay');
  if ((ov && !ov.hidden) || document.getElementById('fkDialogOverlay')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && document.activeElement.id !== 'cfSlider')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('button'))) { e.preventDefault(); cfFlip(); }
});

// ── On the dashboard ─────────────────────────────────────────────────
// Only once something has been played: what challenges have saved in all,
// how many spends were skipped, this period's share, and the last flips.
function chDashHtml() {
  // Read without setting anything up: a planner that has never played is left as it was.
  const c = state.challenges;
  const hist = c && Array.isArray(c.history) ? c.history : [];
  if (!hist.length) return '';
  const st = chStats();
  const dots = hist.slice(0, 12).reverse().map(e => {
    const s = chStatus(e), k = s === 'saved' || s === 'bonus' ? 'saved' : s === 'kept' ? 'kept' : 'enjoyed';
    return `<i class="ch-dot ch-dot--${k}" title="${chAttr(t('ch_dot_' + k) + ' · ' + chLabel(e))}"></i>`;
  }).join('');
  return `<div class="panel ch-dash"><div class="panel-inner-sm">
    <div class="psf-head"><h3 class="ov-title">${esc(t('tab_challenges'))}</h3><button class="link-btn cu-all" type="button" data-btab="challenges">${esc(t('ch_play'))}</button></div>
    <div class="ch-dash-row">
      <div class="ch-dash-fig"><strong>${fmt(st.saved)}</strong><span>${esc(t('ch_dash_fig'))}</span></div>
      <div class="ch-dash-dots" aria-hidden="true">${dots}</div>
    </div>
    <p class="ch-dash-line">${esc(tf(st.skipped === 1 ? 'ch_dash_skipped_1' : 'ch_dash_skipped_n', st.skipped))} · ${esc(tf('ch_dash_period', fmt(st.period)))}</p>
  </div></div>`;
}

// ── Words ────────────────────────────────────────────────────────────
const CH_WORDS = {
  en: {
    tab_challenges: 'Challenges', stg_challenges: 'Challenges',
    ch_set_title: 'Coin Flip range', ch_set_desc: 'The lowest and highest bounty the Coin Flip slider goes to.', ch_set_min: 'Lowest', ch_set_max: 'Highest',
    ch_set_err_min: 'The lowest bounty must be 0 or more.', ch_set_err_order: 'The highest bounty must be more than the lowest.', ch_set_err_cap: 'The highest bounty can be at most {0}.',
    ch_desc: 'Small games for the moment you are about to spend. When the money wins, what you would have spent goes to a goal or a debt instead.',
    ch_cat_decide: 'Quick decisions', ch_cat_decide_desc: 'Torn between two choices? Let a game decide, and let your savings win.',
    ch_play: 'Play', ch_plays_1: 'Played once', ch_plays_n: 'Played {0} times', ch_gc_saved: '{0} saved',
    ch_stat_saved: 'Saved through challenges', ch_stat_period: 'Saved this period', ch_stat_skipped: 'Spends skipped',
    ch_hist_title: 'Your results', ch_hist_empty: 'Nothing played yet. Every result will show here.', ch_show_all: 'Show all ({0})', ch_show_less: 'Show less',
    ch_back: 'All challenges',
    ch_cf_title: 'Coin Flip',
    ch_cf_desc: 'Torn between spending and saving? Let the doubloon decide. Heads, you skip it and the treasure goes to a goal or debt. Tails, you feast, guilt free.',
    ch_step_what: 'What is tempting you?', ch_step_cost: 'Roughly what would it cost?', ch_step_where: 'If it lands heads, the money goes to',
    ch_range_link: 'Change the range',
    ch_p_takeout: 'Takeout', ch_p_coffee: 'Coffee', ch_p_treat: 'A treat', ch_p_shopping: 'Shopping', ch_p_night: 'Night out', ch_p_other: 'Something else',
    ch_other_ph: 'What is it?',
    ch_kind_goal: 'Goal', ch_kind_debt: 'Debt', ch_of: '{0} of {1}', ch_saved_sub: '{0} saved', ch_owed_sub: '{0} owed',
    ch_jar: 'Challenge Jar', ch_jar_sub: 'A new savings goal, made when you first win',
    ch_none: 'No goals or debts yet, so wins can go to a Challenge Jar. Or set up your own:', ch_new_goal: 'New goal', ch_new_debt: 'Add a debt',
    ch_heads: 'Heads', ch_tails: 'Tails', ch_face_heads: 'Save', ch_face_tails: 'Enjoy',
    ch_rule_heads: 'Skip it, and {0} goes to {1}.', ch_rule_tails: 'Enjoy it, guilt free.', ch_the_money: 'the money',
    ch_flip: 'Flip the doubloon', ch_flipping: 'The doubloon is in the air…',
    ch_need_amount: 'Slide the bounty above zero first.', ch_need_target: 'Choose where the money goes.',
    ch_res_heads: 'Heads! Treasure secured.', ch_res_heads_line: 'Skip it and stash the {0} you would have spent in {1}.',
    ch_save_btn: 'Stash {0}', ch_not_now: 'Not now',
    ch_res_tails: 'Tails! Feast away.', ch_res_tails_line: 'The doubloon says yes, so enjoy it, guilt free.',
    ch_log_spend: 'Log the spend', ch_save_anyway: 'Stash {0} anyway', ch_again: 'Flip again',
    ch_saved_title: 'Treasure stashed!', ch_saved_line: '{0} went to {1}.', ch_open_target: 'Open {0}',
    ch_cf_tx_heads: 'Coin Flip: skipped {0}', ch_cf_tx_bonus: 'Coin Flip: saved anyway ({0})', ch_cf_tx_tails: 'Coin Flip: {0}',
    ch_toast_saved: '{0} saved to {1}.',
    ch_h_saved: 'Skipped {0}', ch_h_bonus: 'Saved anyway: {0}', ch_h_kept: 'Skipped {0}, not saved yet', ch_h_undone: '{0}, taken back', ch_h_enjoyed: 'Enjoyed {0}',
    ch_h_to: 'to {0}', ch_save_now: 'Save it', ch_target_gone: 'That goal or debt is no longer there. Choose another one.',
    ch_dash_fig: 'saved through challenges', ch_dash_skipped_1: '1 spend skipped', ch_dash_skipped_n: '{0} spends skipped', ch_dash_period: '{0} this period',
    ch_dot_saved: 'Saved', ch_dot_kept: 'Skipped, not saved yet', ch_dot_enjoyed: 'Enjoyed'
  },

};
(function chAddWords() {
  try { Object.keys(CH_WORDS).forEach(l => { if (TRANSLATIONS[l]) Object.assign(TRANSLATIONS[l], CH_WORDS[l]); }); } catch (e) {}
})();
