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
  { id: 'decide', games: ['coinflip'] },
  { id: 'fun', games: ['scratch'] }
];
// How each game shows on its card in the lobby.
const CH_GAMES = {
  coinflip: { title: 'ch_cf_title', desc: 'ch_cf_desc', art: () => `<span class="ch-mini-coin"><span>${appIconSvg('sinking')}</span></span>` },
  scratch: { title: 'ch_sc_title', desc: 'ch_sc_desc', art: () => `<span class="ch-mini-ticket" aria-hidden="true"><i></i></span>` }
};
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
function chLabel(e) { return e.game === 'scratch' ? t('ch_sc_label') : e.preset === 'other' ? (e.label || t('ch_p_other')) : t('ch_p_' + e.preset); }
function chStats(game) {
  const h = chData().history.filter(e => !game || e.game === game);
  const ps = state.settings.periodStart || '', pe = state.settings.periodEnd || '';
  let saved = 0, period = 0, wins = 0, skipped = 0;
  h.forEach(e => {
    if (e.side === 'heads' || (e.game === 'scratch' && e.saved > 0)) skipped++;
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
    amount, description: entry.game === 'scratch' ? t('ch_sc_tx') : tf(bonus ? 'ch_cf_tx_bonus' : 'ch_cf_tx_heads', chLabel(entry)), allocation: alloc };
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
  if (_ch.screen === 'scratch') return scRender(el);
  chRenderLobby(el);
}

function chRenderLobby(el) {
  const st = chStats();
  const hist = chData().history;
  const games = id => CH_CATS.find(c => c.id === id).games;
  const gameCard = g => {
    const s = chStats(g);
    const meta = s.plays ? `<span class="ch-gc-meta">${esc(tf(s.plays === 1 ? 'ch_plays_1' : 'ch_plays_n', s.plays))}${s.saved > 0 ? ` · <b>${esc(tf('ch_gc_saved', fmt(s.saved)))}</b>` : ''}</span>` : '';
    const m = CH_GAMES[g];
    return `<button class="ch-gc" type="button" data-ch-play="${g}">
      <span class="ch-gc-art" aria-hidden="true">${m.art()}</span>
      <span class="ch-gc-body"><b class="ch-gc-title">${esc(t(m.title))}</b><span class="ch-gc-desc">${esc(t(m.desc))}</span>${meta}</span>
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
  if (e.game === 'scratch') return e.saved > 0 ? 'kept' : 'enjoyed';
  return e.side === 'heads' ? 'kept' : 'enjoyed';
}
function chHistRow(e) {
  const s = chStatus(e), tx = chTxOf(e), lbl = chLabel(e);
  const sc = e.game === 'scratch';
  const title = sc
    ? (s === 'saved' ? tf('ch_sc_h_saved', fmt(e.fun), fmt(tx.amount)) : s === 'kept' ? tf('ch_sc_h_kept', fmt(e.fun), fmt(e.saved))
      : s === 'undone' ? t('ch_sc_h_undone') : tf('ch_sc_h_all', fmt(e.fun)))
    : (s === 'saved' ? tf('ch_h_saved', lbl) : s === 'bonus' ? tf('ch_h_bonus', lbl) : s === 'kept' ? tf('ch_h_kept', lbl)
      : s === 'undone' ? tf('ch_h_undone', lbl) : tf('ch_h_enjoyed', lbl));
  const sub = [t(sc ? 'ch_sc_title' : 'ch_cf_title'), formatDateShort(e.date)];
  if (tx) sub.push(tf('ch_h_to', tx.category));
  const preset = CH_PRESETS.find(p => p.id === e.preset) || CH_PRESETS[CH_PRESETS.length - 1];
  return `<div class="ch-h-row ch-h--${s}" data-ch-entry="${chAttr(e.id)}">
    <span class="ch-h-ico" aria-hidden="true">${sc ? '\uD83C\uDF9F\uFE0F' : preset.emoji}</span>
    <span class="ch-h-main"><b>${esc(title)}</b><small>${esc(sub.join(' · '))}</small></span>
    ${s === 'kept' ? `<button class="btn btn-ghost btn-sm ch-h-save" type="button" data-ch-save="${chAttr(e.id)}">${esc(t('ch_save_now'))}</button>` : ''}
    <span class="ch-h-amt">${tx ? '+' + fmt(tx.amount) : fmt(e.amount)}</span>
  </div>`;
}

function chOpenGame(id) {
  if (id === 'scratch') {
    scOpen(); _ch.screen = 'scratch'; renderChallenges();
    document.querySelector('.app-scroll')?.scrollTo({ top: 0 });
    return;
  }
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
function chBackToLobby() {
  _ch.screen = 'lobby';
  if (_cf && _cf.phase !== 'flipping') _cf.phase = 'setup';
  if (_sc && _sc.phase === 'result') { _sc.phase = 'setup'; _sc.entry = null; }
  renderChallenges();
}

// ── The amount's range ───────────────────────────────────────────────
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
// One card holds the whole game: what tempts you, roughly what it costs
// (a slider over the range in Settings) and where the money goes, beside
// the coin itself. Heads, the money goes to that goal or debt; tails,
// enjoy it.
const cfAmount = () => chRound(_cf.amount);
function cfCurrentTarget() {
  const list = chTargetList();
  return list.find(x => x.key === _cf.target) || list[0] || null;
}
function cfLabelNow() { return _cf.preset === 'other' ? (_cf.label.trim() || t('ch_p_other')) : t('ch_p_' + _cf.preset); }
function cfRender(el) {
  const r = chRange();
  el.innerHTML = `<div class="ch-game">
    <button class="ch-back" type="button" data-ch-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>${esc(t('ch_back'))}</button>
    <div class="ch-game-head">
      <span class="ch-eyebrow">${esc(t('ch_cat_decide'))}</span>
      <h2 class="section-title">${esc(t('ch_cf_title'))}</h2>
      <p class="section-desc">${esc(t('ch_cf_desc'))}</p>
    </div>
    <section class="panel cf-card"><div class="cf-card-inner">
      <div class="cf-setup" id="cfSetup">
        <p class="cf-step"><b>1</b>${esc(t('ch_step_what'))}</p>
        <div class="cf-presets" role="radiogroup" aria-label="${chAttr(t('ch_step_what'))}">${CH_PRESETS.map(p =>
          `<button class="qa-chip cf-preset" type="button" role="radio" data-cf-preset="${p.id}"><span aria-hidden="true">${p.emoji}</span>${esc(t('ch_p_' + p.id))}</button>`).join('')}</div>
        <input class="input cf-other" id="cfOther" type="text" maxlength="40" autocomplete="off" placeholder="${chAttr(t('ch_other_ph'))}" hidden>
        <div class="cf-step cf-step--amount"><b>2</b><span>${esc(t('ch_step_cost'))}</span><strong class="cf-amount-v" id="cfDisplay"></strong></div>
        <div class="cf-amount" id="cfAmountBox">
          <input class="cf-slider" id="cfSlider" type="range" min="${r.min}" max="${r.max}" step="${chStep(r)}" value="${cfAmount()}" aria-label="${chAttr(t('ch_step_cost'))}">
          <div class="cf-slider-ends"><span>${esc(chBounty(r.min))}</span><button class="link-btn cf-range-link" type="button" data-cf-range>${esc(t('ch_range_link'))}</button><span>${esc(chBounty(r.max))}</span></div>
        </div>
        <p class="cf-step"><b>3</b>${esc(t('ch_step_where'))}</p>
        <div class="cf-targets" id="cfTargets" role="radiogroup" aria-label="${chAttr(t('ch_step_where'))}"></div>
      </div>
      <div class="cf-stage" id="cfStage">
        <div class="cf-toss" id="cfToss">
          <div class="cf-coin is-idle" id="cfCoin">
            <div class="cf-face cf-face--heads"><span class="cf-face-ico">${appIconSvg('sinking')}</span><span class="cf-face-word">${esc(t('ch_face_heads'))}</span></div>
            <div class="cf-face cf-face--tails"><span class="cf-face-ico cf-face-emoji" id="cfTailsEmoji"></span><span class="cf-face-word">${esc(t('ch_face_tails'))}</span></div>
          </div>
        </div>
        <div class="cf-shadow" id="cfShadow"></div>
      </div>
      <div class="cf-panel" id="cfPanel" aria-live="polite"></div>
    </div></section>
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
// The places a win can go, as a list to pick from. g is the game's own
// state (its chosen target and its phase); onPick runs after a choice.
function chPaintTargetBox(box, g, onPick) {
  if (!box || !g) return;
  const list = chTargetList();
  const cur = list.find(x => x.key === g.target) || list[0] || null;
  if (cur) g.target = cur.key;
  const locked = g.phase !== 'setup';
  const real = chTargets().length;
  box.innerHTML = list.map(x => `<button class="cf-target${cur && x.key === cur.key ? ' is-on' : ''}${x.kind === 'jar' ? ' cf-target--jar' : ''}" type="button" role="radio" aria-checked="${!!(cur && x.key === cur.key)}" data-cf-target="${chAttr(x.key)}"${locked ? ' disabled' : ''}>
      <span class="cf-t-ico" aria-hidden="true">${x.ico}</span>
      <span class="cf-t-txt"><b>${esc(x.name)}</b><small>${esc((x.kind === 'jar' ? '' : t(x.kind === 'goal' ? 'ch_kind_goal' : 'ch_kind_debt') + ' \u00b7 ') + x.sub)}</small></span>
      <span class="cf-t-tick" aria-hidden="true">${DD_TICK}</span>
    </button>`).join('')
    + (real ? '' : `<p class="cf-none">${esc(t('ch_none'))} <button class="link-btn" type="button" data-cf-new="goal"${locked ? ' disabled' : ''}>${esc(t('ch_new_goal'))}</button> \u00b7 <button class="link-btn" type="button" data-cf-new="debt"${locked ? ' disabled' : ''}>${esc(t('ch_new_debt'))}</button></p>`);
  box.querySelectorAll('[data-cf-target]').forEach(btn => btn.addEventListener('click', () => {
    if (g.phase !== 'setup') return;
    g.target = btn.dataset.cfTarget; btn.blur();
    chPaintTargetBox(box, g, onPick); if (onPick) onPick();
  }));
  box.querySelector('[data-cf-new="goal"]')?.addEventListener('click', () => { switchTab('goals'); openFundModal(); });
  box.querySelector('[data-cf-new="debt"]')?.addEventListener('click', () => { switchTab('debt'); if (typeof openDebtModal === 'function') openDebtModal(null); });
}
function cfPaintTargets() { chPaintTargetBox(document.getElementById('cfTargets'), _cf, () => cfPaintPanel()); }
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
    // Saved: say where it went, and show the goal move when it has a bar.
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
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge">${appIconSvg('sinking')}</span><span class="cf-verdict-txt"><b>${esc(t('ch_res_heads'))}</b><span>${esc(tf('ch_res_heads_line', fmt(e.amount), cfTargetName(e)))}</span></span></div>
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
// Coins thrown out from the coin, for a win.
function cfBurst(stageId) {
  const stage = document.getElementById(stageId || 'cfStage');
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
  if (typeof currentTab === 'undefined' || currentTab !== 'challenges') return;
  const game = _ch.screen === 'coinflip' ? _cf : _ch.screen === 'scratch' ? _sc : null;
  if (!game || game.phase !== 'setup') return;
  const slider = _ch.screen === 'coinflip' ? 'cfSlider' : 'scSlider';
  if (!document.getElementById(slider)) return;
  const ov = document.getElementById('tutorialOverlay');
  if ((ov && !ov.hidden) || document.getElementById('fkDialogOverlay')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && document.activeElement.id !== slider)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('button'))) { e.preventDefault(); if (_ch.screen === 'coinflip') cfFlip(); else scAuto(); }
});

// ── Scratch Card ─────────────────────────────────────────────────────
// Fun money for the weekend, without guilt and without overspending.
// Set the most you would happily spend; the card reveals how much of it
// is yours to enjoy. Whatever is left goes to the goal or debt you chose,
// the same way a Coin Flip win does, so it is saved, undone and counted
// exactly like one.
const SC_TIERS = [
  { share: 1, weight: 12 },
  { share: .75, weight: 20 },
  { share: .5, weight: 33 },
  { share: .25, weight: 23 },
  { share: 0, weight: 12 }
];
const SC_REVEAL_AT = .48;   // the share of foil scratched off before the rest falls away
let _sc = null;

function scPickShare() {
  const total = SC_TIERS.reduce((s, x) => s + x.weight, 0);
  let r = chRandom() * total;
  for (const x of SC_TIERS) { if ((r -= x.weight) < 0) return x.share; }
  return SC_TIERS[SC_TIERS.length - 1].share;
}
function scOpen() {
  const last = chData().last, r = chRange();
  const keep = _sc && _sc.phase === 'setup' ? _sc : null;
  _sc = { phase: 'setup', max: chClamp(keep ? keep.max : (Number(last.scMax) > 0 ? Number(last.scMax) : 50), r),
    target: keep ? keep.target : (last.target || ''), entry: null, err: '' };
}
const scAmount = () => chRound(_sc.max);
function scCurrentTarget() { const list = chTargetList(); return list.find(x => x.key === _sc.target) || list[0] || null; }

function scRender(el) {
  const r = chRange();
  el.innerHTML = `<div class="ch-game">
    <button class="ch-back" type="button" data-ch-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>${esc(t('ch_back'))}</button>
    <div class="ch-game-head">
      <span class="ch-eyebrow">${esc(t('ch_cat_fun'))}</span>
      <h2 class="section-title">${esc(t('ch_sc_title'))}</h2>
      <p class="section-desc">${esc(t('ch_sc_desc'))}</p>
    </div>
    <section class="panel cf-card sc-card"><div class="cf-card-inner">
      <div class="cf-setup" id="scSetup">
        <div class="cf-step cf-step--amount"><b>1</b><span>${esc(t('ch_sc_step_max'))}</span><strong class="cf-amount-v" id="scDisplay"></strong></div>
        <div class="cf-amount" id="scAmountBox">
          <input class="cf-slider" id="scSlider" type="range" min="${r.min}" max="${r.max}" step="${chStep(r)}" value="${scAmount()}" aria-label="${chAttr(t('ch_sc_step_max'))}">
          <div class="cf-slider-ends"><span>${esc(chBounty(r.min))}</span><button class="link-btn cf-range-link" type="button" data-sc-range>${esc(t('ch_range_link'))}</button><span>${esc(chBounty(r.max))}</span></div>
        </div>
        <p class="cf-step"><b>2</b>${esc(t('ch_sc_step_where'))}</p>
        <div class="cf-targets" id="scTargets" role="radiogroup" aria-label="${chAttr(t('ch_sc_step_where'))}"></div>
      </div>
      <div class="cf-stage sc-stage" id="scStage">
        <div class="sc-ticket">
          <div class="sc-ticket-head"><span class="sc-brand">${esc(t('ch_sc_brand'))}</span><span class="sc-upto" id="scUpto"></span></div>
          <div class="sc-field" id="scField">
            <div class="sc-prize" id="scPrize" aria-live="polite"></div>
            <canvas class="sc-foil" id="scFoil" aria-label="${chAttr(t('ch_sc_hint'))}" role="img"></canvas>
          </div>
          <div class="sc-ticket-foot">${esc(t('ch_sc_hint'))}</div>
        </div>
      </div>
      <div class="cf-panel" id="scPanel" aria-live="polite"></div>
    </div></section>
  </div>`;
  el.querySelector('[data-ch-back]').addEventListener('click', chBackToLobby);
  document.getElementById('scSlider').addEventListener('input', e => {
    if (_sc.phase !== 'setup') return;
    _sc.max = chClamp(e.target.value); scPaintAmount(); scPaintPanel();
  });
  el.querySelector('[data-sc-range]').addEventListener('click', () => {
    switchTab('settings');
    const f = document.getElementById('cfMaxInput');
    if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
  });
  scPaintSetup(); scPaintAmount(); scPaintPanel();
  // The foil is drawn once the card has its size.
  scPaintPrize();
  requestAnimationFrame(() => { scDrawFoil(_sc.phase !== 'setup'); if (_sc.phase === 'scratching') scReveal(); });
}
function scPaintAmount() {
  const d = document.getElementById('scDisplay'); if (!d) return;
  const r = chRange(), a = scAmount();
  d.textContent = chBounty(a);
  const up = document.getElementById('scUpto'); if (up) up.textContent = tf('ch_sc_upto', chBounty(a));
  const s = document.getElementById('scSlider');
  if (s) { if (Number(s.value) !== a) s.value = a; s.style.setProperty('--fill', ((a - r.min) / (r.max - r.min) * 100).toFixed(2) + '%'); }
}
function scPaintSetup() {
  const setup = document.getElementById('scSetup'); if (!setup) return;
  const locked = _sc.phase !== 'setup';
  setup.classList.toggle('is-locked', locked);
  setup.querySelectorAll('button, input').forEach(x => { x.disabled = locked; });
  chPaintTargetBox(document.getElementById('scTargets'), _sc, () => scPaintPanel());
}
function scPaintPrize() {
  const box = document.getElementById('scPrize'); if (!box) return;
  const e = _sc.entry;
  if (!e) { box.innerHTML = ''; return; }
  box.innerHTML = e.fun > 0
    ? `<span class="sc-prize-k">${esc(t('ch_sc_prize_k'))}</span><b class="sc-prize-v">${esc(chBounty(e.fun))}</b><span class="sc-prize-s">${esc(t('ch_sc_prize_s'))}</span>${e.saved > 0 ? `<span class="sc-prize-save">${esc(tf('ch_sc_prize_save', chBounty(e.saved)))}</span>` : ''}`
    : `<span class="sc-prize-k">${esc(t('ch_sc_res_none'))}</span><b class="sc-prize-v">${esc(chBounty(0))}</b><span class="sc-prize-save">${esc(tf('ch_sc_prize_save', chBounty(e.saved)))}</span>`;
}

// ── The foil ──
function scDrawFoil(cleared) {
  const cv = document.getElementById('scFoil'); if (!cv) return;
  const field = document.getElementById('scField');
  const w = field.clientWidth, h = field.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cv.classList.toggle('is-gone', !!cleared);
  if (cleared) { ctx.clearRect(0, 0, w, h); return; }
  // Brushed silver with a little sparkle, and the words on top.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9dde4'); g.addColorStop(.45, '#f4f6f9'); g.addColorStop(.55, '#c7ccd5'); g.addColorStop(1, '#e8ebf0');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.55)' : 'rgba(120,128,145,.18)';
    ctx.fillRect((i * 73) % w, (i * 37) % h, 1.5, 1.5);
  }
  ctx.fillStyle = 'rgba(92,98,114,.85)';
  ctx.font = `800 ${Math.round(Math.min(22, w / 11))}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t('ch_sc_foil').toUpperCase(), w / 2, h / 2);
  scWireFoil(cv);
}
function scWireFoil(cv) {
  if (cv._wired) return; cv._wired = true;
  let down = false, last = null, moves = 0;
  const ctx = cv.getContext('2d');
  const pt = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const scratch = (a, b) => {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 38;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(b[0], b[1], 19, 0, Math.PI * 2); ctx.fill();
    if (++moves % 5 === 0 && scCleared(cv) >= SC_REVEAL_AT) scReveal();
  };
  cv.addEventListener('pointerdown', ev => {
    if (!_sc || _sc.phase === 'result' || cv.classList.contains('is-gone')) return;
    if (_sc.phase === 'setup' && !scStart()) return;
    down = true; last = pt(ev); cv.setPointerCapture?.(ev.pointerId); scratch(last, last);
  });
  cv.addEventListener('pointermove', ev => { if (!down) return; const p = pt(ev); scratch(last, p); last = p; });
  const up = () => { down = false; if (_sc && _sc.phase === 'scratching' && scCleared(cv) >= SC_REVEAL_AT) scReveal(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', () => { down = false; });
}
// How much of the foil has been scratched away, sampled on a coarse grid.
function scCleared(cv) {
  try {
    const ctx = cv.getContext('2d'), d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0, n = 0;
    for (let i = 3; i < d.length; i += 4 * 24) { n++; if (d[i] < 40) clear++; }
    return n ? clear / n : 0;
  } catch (e) { return 1; }
}
// The card is bought: the outcome is fixed now, before any foil comes off.
function scStart() {
  if (_sc.phase !== 'setup') return _sc.phase === 'scratching';
  const max = scAmount(), tg = scCurrentTarget();
  _sc.err = !(max > 0) ? t('ch_sc_need') : !tg ? t('ch_need_target') : '';
  if (_sc.err) {
    scPaintPanel();
    const box = document.getElementById('scAmountBox');
    if (box) { box.classList.remove('cf-shake'); void box.offsetWidth; box.classList.add('cf-shake'); }
    return false;
  }
  const share = scPickShare();
  const fun = Math.round(max * share), saved = chRound(max - fun);
  _sc.entry = { id: uid(), game: 'scratch', at: Date.now(), date: today(), max, fun, saved, amount: saved, share,
    target: { kind: tg.kind, id: tg.id, name: tg.name }, txId: null };
  _sc.phase = 'scratching';
  scPaintPrize(); scPaintSetup(); scPaintPanel();
  return true;
}
// Scratch it for me: a few quick sweeps across the foil, then the rest falls away.
function scAuto() {
  if (!_sc || _sc.phase === 'result') return;
  if (_sc.phase === 'setup' && !scStart()) return;
  const cv = document.getElementById('scFoil');
  if (!cv || ddReduced()) { scReveal(); return; }
  const ctx = cv.getContext('2d'), w = cv.clientWidth, h = cv.clientHeight, rows = 4;
  let k = 0;
  const step = () => {
    if (!_sc || _sc.phase !== 'scratching') return;
    const y = h * ((k % rows) + .5) / rows, x0 = k % 2 ? w : 0, x1 = k % 2 ? 0 : w;
    ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineWidth = 44;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    if (++k < rows) setTimeout(step, 120); else setTimeout(scReveal, 120);
  };
  step();
}
function scReveal() {
  if (!_sc || _sc.phase !== 'scratching') return;
  const e = _sc.entry, c = chData();
  c.history.unshift(e);
  if (c.history.length > CH_HISTORY_MAX) c.history.length = CH_HISTORY_MAX;
  c.last = { ...c.last, scMax: e.max, target: e.target.kind === 'jar' ? 'jar' : e.target.kind + ':' + e.target.id };
  saveState();
  _sc.phase = 'result';
  const cv = document.getElementById('scFoil');
  if (cv) cv.classList.add('is-gone');
  scPaintPanel();
  const stage = document.getElementById('scStage');
  if (stage) { stage.classList.remove('is-landed'); void stage.offsetWidth; stage.classList.add('is-landed'); }
  if (e.fun > 0) cfBurst('scStage');
}

function scPaintPanel() {
  const p = document.getElementById('scPanel'); if (!p) return;
  const max = scAmount(), tg = scCurrentTarget();
  if (_sc.phase !== 'result') {
    if (_sc.err && max > 0 && tg) _sc.err = '';
    const busy = _sc.phase === 'scratching';
    p.className = 'cf-panel';
    p.innerHTML = `<div class="cf-rules"><div class="cf-rule sc-rule"><span>${esc(tf('ch_sc_rule', max > 0 ? fmt(max) : t('ch_the_money'), tg ? tg.name : '…'))}</span></div></div>
      <button class="btn btn-primary cf-flip" id="scGoBtn" type="button">${esc(t(busy ? 'ch_sc_reveal' : 'ch_sc_auto'))}</button>
      <p class="cf-err"${_sc.err ? '' : ' hidden'}>${esc(_sc.err)}</p>`;
    p.querySelector('#scGoBtn').addEventListener('click', () => busy ? scReveal() : scAuto());
    return;
  }
  const e = _sc.entry, tx = chTxOf(e), where = cfTargetName(e);
  if (tx) {
    const goal = e.target.kind === 'goal' ? (state.sinkingFunds || []).find(f => f.id === e.target.id) : null;
    const has = goal && fundHasTarget(goal);
    const now = has ? Math.min(100, Math.round((goal.currentSaved || 0) / goal.targetAmount * 100)) : 0;
    const was = has ? Math.min(100, Math.max(0, Math.round(((goal.currentSaved || 0) - tx.amount) / goal.targetAmount * 100))) : 0;
    p.className = 'cf-panel cf-panel--win is-in';
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge">${DD_TICK}</span><span class="cf-verdict-txt"><b>${esc(t('ch_saved_title'))}</b><span>${esc(tf('ch_saved_line', fmt(tx.amount), tx.category))}</span></span></div>
      ${has ? `<div class="cf-prog"><div class="cf-prog-top"><span>${esc(goal.name)}</span><span>${esc(tf('ch_of', fmt(goal.currentSaved || 0), fmt(goal.targetAmount)))}</span></div><div class="cf-prog-bar"><i id="scProg" style="width:${was}%" data-to="${now}"></i></div></div>` : ''}
      <div class="cf-acts"><button class="btn btn-primary" type="button" data-sc-again>${esc(t('ch_sc_again'))}</button><button class="btn btn-ghost" type="button" data-sc-open>${esc(tf('ch_open_target', tx.category))}</button></div>`;
    const bar = p.querySelector('#scProg');
    if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = bar.dataset.to + '%'; }));
    p.querySelector('[data-sc-open]').addEventListener('click', () => switchTab(e.target.kind === 'goal' ? 'goals' : 'debt'));
  } else if (e.saved <= 0) {
    p.className = 'cf-panel cf-panel--tails is-in';
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge cf-badge--emoji">🎉</span><span class="cf-verdict-txt"><b>${esc(tf('ch_sc_res_all', fmt(e.fun)))}</b><span>${esc(t('ch_sc_res_all_line'))}</span></span></div>
      <div class="cf-acts"><button class="btn btn-primary" type="button" data-sc-again>${esc(t('ch_sc_again'))}</button></div>`;
  } else {
    const none = e.fun <= 0;
    p.className = 'cf-panel cf-panel--heads is-in';
    p.innerHTML = `<div class="cf-verdict"><span class="cf-badge cf-badge--emoji">${none ? '🛋️' : '🎟️'}</span><span class="cf-verdict-txt"><b>${esc(none ? t('ch_sc_res_none') : tf('ch_sc_res_mix', fmt(e.fun)))}</b><span>${esc(none ? tf('ch_sc_res_none_line', fmt(e.saved), where) : tf('ch_sc_res_mix_line', fmt(e.fun), fmt(e.saved), where))}</span></span></div>
      <div class="cf-acts"><button class="btn btn-primary" type="button" data-sc-save>${esc(tf('ch_save_btn', fmt(e.saved)))}</button><button class="btn btn-ghost" type="button" data-sc-again>${esc(t('ch_not_now'))}</button></div>`;
  }
  p.querySelector('[data-sc-again]')?.addEventListener('click', scAgain);
  p.querySelector('[data-sc-save]')?.addEventListener('click', ev => {
    const btn = ev.currentTarget; btn.disabled = true;
    const tx = chSave(_sc.entry, false);
    if (!tx) { btn.disabled = false; return; }
    chPaintTargetBox(document.getElementById('scTargets'), _sc, () => scPaintPanel());
    scPaintPanel(); cfBurst('scStage');
  });
}
function scAgain() {
  if (!_sc) return;
  _sc.phase = 'setup'; _sc.entry = null; _sc.err = '';
  scPaintPrize(); scPaintSetup(); scPaintAmount(); scPaintPanel();
  scDrawFoil(false);
}

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
    ch_set_title: 'Challenge range', ch_set_desc: 'The lowest and highest amount the challenge sliders go to, in Coin Flip and Scratch Card.', ch_set_min: 'Lowest', ch_set_max: 'Highest',
    ch_set_err_min: 'The lowest amount must be 0 or more.', ch_set_err_order: 'The highest amount must be more than the lowest.', ch_set_err_cap: 'The highest amount can be at most {0}.',
    ch_desc: 'Small games for the moment you are about to spend. When the money wins, what you would have spent goes to a goal or a debt instead.',
    ch_cat_decide: 'Quick decisions', ch_cat_decide_desc: 'Torn between two choices? Let a game decide, and let your savings win.',
    ch_play: 'Play', ch_plays_1: 'Played once', ch_plays_n: 'Played {0} times', ch_gc_saved: '{0} saved',
    ch_stat_saved: 'Saved through challenges', ch_stat_period: 'Saved this period', ch_stat_skipped: 'Spends skipped',
    ch_hist_title: 'Your results', ch_hist_empty: 'Nothing played yet. Every result will show here.', ch_show_all: 'Show all ({0})', ch_show_less: 'Show less',
    ch_back: 'All challenges',
    ch_cf_title: 'Coin Flip',
    ch_cf_desc: 'Torn between spending and saving? Let a coin decide. Heads, you skip it and the money goes to a goal or debt. Tails, enjoy it, guilt free.',
    ch_step_what: 'What is tempting you?', ch_step_cost: 'Roughly what would it cost?', ch_step_where: 'If it lands heads, the money goes to',
    ch_range_link: 'Change the range',
    ch_cat_fun: 'Fun money', ch_cat_fun_desc: 'Set aside guilt-free spending, and let the rest work for you.',
    ch_sc_title: 'Scratch Card',
    ch_sc_desc: 'Planning a fun weekend? Set the most you would happily spend, then scratch the card. It reveals how much of that is yours to enjoy, guilt free. The rest goes to a goal or debt.',
    ch_sc_step_max: 'The most you would happily spend this weekend', ch_sc_step_where: 'What you do not get to spend goes to',
    ch_sc_brand: 'Weekend Fun', ch_sc_upto: 'Up to {0}', ch_sc_foil: 'Scratch here', ch_sc_hint: 'Scratch the silver to reveal your fun money',
    ch_sc_rule: 'Scratch to find out how much of your {0} is yours to spend this weekend. What is left goes to {1}.',
    ch_sc_auto: 'Scratch it for me', ch_sc_reveal: 'Reveal it all', ch_sc_need: 'Slide to the most you would happily spend first.',
    ch_sc_prize_k: 'Your fun money', ch_sc_prize_s: 'to spend this weekend', ch_sc_prize_save: '{0} goes to savings',
    ch_sc_res_mix: 'Your fun money: {0}', ch_sc_res_mix_line: 'Spend up to {0} this weekend, guilt free. The other {1} goes to {2}.',
    ch_sc_res_all: 'Jackpot! The full {0} is yours', ch_sc_res_all_line: 'Enjoy every bit of it this weekend, guilt free.',
    ch_sc_res_none: 'A cosy weekend', ch_sc_res_none_line: 'No splurge this time: all {0} goes to {1}.',
    ch_sc_again: 'New card', ch_sc_tx: 'Scratch Card: weekend savings', ch_sc_label: 'Weekend fun',
    ch_sc_h_saved: 'Weekend fun: {0} to spend, {1} saved', ch_sc_h_kept: 'Weekend fun: {0} to spend, {1} not saved yet',
    ch_sc_h_all: 'Weekend fun: the full {0} to spend', ch_sc_h_undone: 'Weekend fun, taken back',
    ch_p_takeout: 'Takeout', ch_p_coffee: 'Coffee', ch_p_treat: 'A treat', ch_p_shopping: 'Shopping', ch_p_night: 'Night out', ch_p_other: 'Something else',
    ch_other_ph: 'What is it?',
    ch_kind_goal: 'Goal', ch_kind_debt: 'Debt', ch_of: '{0} of {1}', ch_saved_sub: '{0} saved', ch_owed_sub: '{0} owed',
    ch_jar: 'Challenge Jar', ch_jar_sub: 'A new savings goal, made when you first win',
    ch_none: 'No goals or debts yet, so wins can go to a Challenge Jar. Or set up your own:', ch_new_goal: 'New goal', ch_new_debt: 'Add a debt',
    ch_heads: 'Heads', ch_tails: 'Tails', ch_face_heads: 'Save', ch_face_tails: 'Enjoy',
    ch_rule_heads: 'Skip it, and {0} goes to {1}.', ch_rule_tails: 'Enjoy it, guilt free.', ch_the_money: 'the money',
    ch_flip: 'Flip the coin', ch_flipping: 'Flipping…',
    ch_need_amount: 'Slide to roughly what it would cost first.', ch_need_target: 'Choose where the money goes.',
    ch_res_heads: 'Heads. Skip it.', ch_res_heads_line: 'Put the {0} you would have spent into {1}.',
    ch_save_btn: 'Save {0}', ch_not_now: 'Not now',
    ch_res_tails: 'Tails. Enjoy it.', ch_res_tails_line: 'The coin says yes, so enjoy it, guilt free.',
    ch_log_spend: 'Log the spend', ch_save_anyway: 'Save {0} anyway', ch_again: 'Flip again',
    ch_saved_title: 'Saved!', ch_saved_line: '{0} went to {1}.', ch_open_target: 'Open {0}',
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
