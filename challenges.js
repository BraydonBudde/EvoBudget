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
const CH_PLUS = [5, 10, 25];
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
      <span class="ch-gc-art" aria-hidden="true"><span class="ch-mini-coin"><span>${appIconSvg('sinking')}</span></span></span>
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
  _cf = {
    phase: 'setup',
    preset: keep ? keep.preset : (CH_PRESETS.some(p => p.id === last.preset) ? last.preset : 'takeout'),
    label: keep ? keep.label : (last.label || ''),
    buf: keep ? keep.buf : '',
    target: keep ? keep.target : (last.target || ''),
    entry: null, err: ''
  };
  _ch.screen = 'coinflip';
  renderChallenges();
  document.querySelector('.app-scroll')?.scrollTo({ top: 0 });
}
function chBackToLobby() { _ch.screen = 'lobby'; if (_cf && _cf.phase !== 'flipping') _cf.phase = 'setup'; renderChallenges(); }

// ── Coin Flip ────────────────────────────────────────────────────────
const cfAmount = () => { const v = parseFloat(_cf.buf); return isNaN(v) ? 0 : chRound(v); };
function cfCurrentTarget() {
  const list = chTargetList();
  return list.find(x => x.key === _cf.target) || list[0] || null;
}
function cfLabelNow() { return _cf.preset === 'other' ? (_cf.label.trim() || t('ch_p_other')) : t('ch_p_' + _cf.preset); }

function cfRender(el) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  const BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m16 9-5 5"/><path d="m11 9 5 5"/></svg>';
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
        <p class="cf-step"><b>2</b>${esc(t('ch_step_cost'))}</p>
        <div class="cf-pad">
          <div class="qa-amount" aria-live="polite"><span class="qa-sym">${esc(SYM)}</span><span class="qa-num" id="cfDisplay">0</span></div>
          <div class="qa-quick">${CH_PLUS.map(v => `<button class="qa-chip qa-plus" type="button" data-cf-plus="${v}">+${esc(SYM)}${v}</button>`).join('')}</div>
          <div class="qa-keys cf-keys">${keys.map(k => `<button class="qa-key" type="button" data-cf-key="${k}" aria-label="${k === 'back' ? chAttr(t('qa_backspace')) : k}">${k === 'back' ? BACK : k}</button>`).join('')}</div>
          <button class="link-btn qa-clear" type="button" data-cf-clear>${esc(t('qa_clear'))}</button>
        </div>
        <p class="cf-step"><b>3</b>${esc(t('ch_step_where'))}</p>
        <div class="cf-targets" id="cfTargets" role="radiogroup" aria-label="${chAttr(t('ch_step_where'))}"></div>
      </div></section>
      <section class="panel cf-play"><div class="panel-inner-sm">
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
    </div>
  </div>`;
  const $ = id => document.getElementById(id);
  el.querySelector('[data-ch-back]').addEventListener('click', chBackToLobby);
  el.querySelectorAll('[data-cf-preset]').forEach(b => b.addEventListener('click', () => {
    if (_cf.phase !== 'setup') return;
    _cf.preset = b.dataset.cfPreset; b.blur();
    cfPaintSetup();
    if (_cf.preset === 'other') $('cfOther').focus();
  }));
  $('cfOther').value = _cf.label;
  $('cfOther').addEventListener('input', e => { _cf.label = e.target.value.slice(0, 40); cfPaintPanel(); });
  el.querySelectorAll('[data-cf-key]').forEach(b => b.addEventListener('click', () => { cfPress(b.dataset.cfKey); b.blur(); }));
  el.querySelectorAll('[data-cf-plus]').forEach(b => b.addEventListener('click', () => {
    if (_cf.phase !== 'setup') return;
    const v = chRound(cfAmount() + Number(b.dataset.cfPlus));
    if (v >= 1e7) return;
    _cf.buf = Number.isInteger(v) ? String(v) : v.toFixed(2);
    b.blur(); cfPaintAmount(); cfPaintPanel();
  }));
  el.querySelector('[data-cf-clear]').addEventListener('click', () => { if (_cf.phase !== 'setup') return; _cf.buf = ''; cfPaintAmount(); cfPaintPanel(); });
  $('cfCoin').addEventListener('click', () => { if (_cf.phase === 'setup') cfFlip(); });
  cfPaintSetup();
  cfPaintAmount();
  cfPaintCoin();
  cfPaintPanel();
}

function cfPress(k) {
  if (!_cf || _cf.phase !== 'setup') return;
  let buf = _cf.buf;
  if (k === 'back') buf = buf.slice(0, -1);
  else if (k === '.') { if (!buf.includes('.')) buf = (buf || '0') + '.'; }
  else {
    if (buf.includes('.') && buf.split('.')[1].length >= 2) return;
    if (!buf.includes('.') && buf.replace(/^0+/, '').length >= 7) return;
    buf = buf === '0' ? k : buf + k;
  }
  _cf.buf = buf;
  cfPaintAmount(); cfPaintPanel();
}
function cfPaintAmount() {
  const d = document.getElementById('cfDisplay');
  if (!d) return;
  const [i, f] = _cf.buf.split('.');
  const whole = (parseInt(i || '0', 10) || 0).toLocaleString('en-US');
  d.textContent = _cf.buf.includes('.') ? `${whole}.${f || ''}` : whole;
}
function cfPaintSetup() {
  const setup = document.getElementById('cfSetup');
  if (!setup) return;
  const locked = _cf.phase !== 'setup';
  setup.classList.toggle('is-locked', locked);
  setup.querySelectorAll('button, input').forEach(x => { x.disabled = locked; });
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
    const pad = document.querySelector('.cf-pad .qa-amount');
    if (pad) { pad.classList.remove('cf-shake'); void pad.offsetWidth; pad.classList.add('cf-shake'); }
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
    c.last = { preset: entry.preset, label: _cf.label, target: tg.key === 'jar' ? 'jar' : tg.key };
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
  cfPaintSetup(); cfPaintCoin(); cfPaintPanel();
}
// Tails: the spend goes in the log like any other, through the keypad,
// already filled in. Its category is guessed only when the planner has it.
function cfLogSpend(e) {
  const p = CH_PRESETS.find(x => x.id === e.preset);
  const lang = state.settings.language || 'en';
  const names = p && p.cat >= 0 ? [DEFAULT_BUDGET[lang]?.expenses[p.cat], DEFAULT_BUDGET.en.expenses[p.cat]] : [];
  const cat = (state.budgets.expenses || []).map(r => r.category).find(c => names.includes(c)) || '';
  openQuickAddTx({ type: 'expense', amount: e.amount, category: cat, description: tf('ch_cf_tx_tails', chLabel(e)) });
}

// A physical keyboard types the amount and Enter flips.
document.addEventListener('keydown', e => {
  if (typeof currentTab === 'undefined' || currentTab !== 'challenges' || _ch.screen !== 'coinflip' || !_cf || _cf.phase !== 'setup') return;
  if (!document.getElementById('cfDisplay')) return;
  const ov = document.getElementById('tutorialOverlay');
  if ((ov && !ov.hidden) || document.getElementById('fkDialogOverlay')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); cfPress(e.key); }
  else if (e.key === '.' || e.key === ',') { e.preventDefault(); cfPress('.'); }
  else if (e.key === 'Backspace') { e.preventDefault(); cfPress('back'); }
  else if (e.key === 'Enter' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('button'))) { e.preventDefault(); cfFlip(); }
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
    tab_challenges: 'Challenges',
    ch_desc: 'Small games for the moment you are about to spend. When the money wins, what you would have spent goes to a goal or a debt instead.',
    ch_cat_decide: 'Quick decisions', ch_cat_decide_desc: 'Torn between two choices? Let a game decide, and let your savings win.',
    ch_play: 'Play', ch_plays_1: 'Played once', ch_plays_n: 'Played {0} times', ch_gc_saved: '{0} saved',
    ch_stat_saved: 'Saved through challenges', ch_stat_period: 'Saved this period', ch_stat_skipped: 'Spends skipped',
    ch_hist_title: 'Your results', ch_hist_empty: 'Nothing played yet. Every result will show here.', ch_show_all: 'Show all ({0})', ch_show_less: 'Show less',
    ch_back: 'All challenges',
    ch_cf_title: 'Coin Flip',
    ch_cf_desc: 'Torn between spending and saving? Let a coin decide. Heads, you skip it and the money goes to a goal or debt. Tails, enjoy it, guilt free.',
    ch_step_what: 'What are you tempted by?', ch_step_cost: 'Roughly what would it cost?', ch_step_where: 'If it lands heads, the money goes to',
    ch_p_takeout: 'Takeout', ch_p_coffee: 'Coffee', ch_p_treat: 'A treat', ch_p_shopping: 'Shopping', ch_p_night: 'Night out', ch_p_other: 'Something else',
    ch_other_ph: 'What is it?',
    ch_kind_goal: 'Goal', ch_kind_debt: 'Debt', ch_of: '{0} of {1}', ch_saved_sub: '{0} saved', ch_owed_sub: '{0} owed',
    ch_jar: 'Challenge Jar', ch_jar_sub: 'A new savings goal, made when you first win',
    ch_none: 'No goals or debts yet, so wins can go to a Challenge Jar. Or set up your own:', ch_new_goal: 'New goal', ch_new_debt: 'Add a debt',
    ch_heads: 'Heads', ch_tails: 'Tails', ch_face_heads: 'Save', ch_face_tails: 'Enjoy',
    ch_rule_heads: 'Skip it, and {0} goes to {1}.', ch_rule_tails: 'Enjoy it, guilt free.', ch_the_money: 'the money',
    ch_flip: 'Flip the coin', ch_flipping: 'Flipping…',
    ch_need_amount: 'Enter roughly what it would cost first.', ch_need_target: 'Choose where the money goes.',
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
  de: {
    tab_challenges: 'Challenges',
    ch_desc: 'Kleine Spiele für den Moment, bevor du Geld ausgibst. Gewinnt das Geld, geht das, was du ausgegeben hättest, stattdessen an ein Sparziel oder eine Schuld.',
    ch_cat_decide: 'Schnelle Entscheidungen', ch_cat_decide_desc: 'Hin- und hergerissen? Lass ein Spiel entscheiden, und lass dein Erspartes gewinnen.',
    ch_play: 'Spielen', ch_plays_1: 'Einmal gespielt', ch_plays_n: '{0}-mal gespielt', ch_gc_saved: '{0} gespart',
    ch_stat_saved: 'Mit Challenges gespart', ch_stat_period: 'In diesem Zeitraum gespart', ch_stat_skipped: 'Ausgaben ausgelassen',
    ch_hist_title: 'Deine Ergebnisse', ch_hist_empty: 'Noch nichts gespielt. Jedes Ergebnis erscheint hier.', ch_show_all: 'Alle anzeigen ({0})', ch_show_less: 'Weniger anzeigen',
    ch_back: 'Alle Challenges',
    ch_cf_title: 'Münzwurf',
    ch_cf_desc: 'Ausgeben oder sparen? Lass eine Münze entscheiden. Kopf: Du verzichtest, und das Geld geht an ein Ziel oder eine Schuld. Zahl: Gönn es dir, ohne schlechtes Gewissen.',
    ch_step_what: 'Was reizt dich gerade?', ch_step_cost: 'Was würde es ungefähr kosten?', ch_step_where: 'Bei Kopf geht das Geld an',
    ch_p_takeout: 'Essen bestellen', ch_p_coffee: 'Kaffee', ch_p_treat: 'Etwas Süßes', ch_p_shopping: 'Shopping', ch_p_night: 'Ausgehen', ch_p_other: 'Etwas anderes',
    ch_other_ph: 'Was ist es?',
    ch_kind_goal: 'Ziel', ch_kind_debt: 'Schuld', ch_of: '{0} von {1}', ch_saved_sub: '{0} gespart', ch_owed_sub: '{0} offen',
    ch_jar: 'Challenge-Glas', ch_jar_sub: 'Ein neues Sparziel, angelegt bei deinem ersten Gewinn',
    ch_none: 'Noch keine Ziele oder Schulden, also können Gewinne in ein Challenge-Glas gehen. Oder lege selbst etwas an:', ch_new_goal: 'Neues Ziel', ch_new_debt: 'Schuld hinzufügen',
    ch_heads: 'Kopf', ch_tails: 'Zahl', ch_face_heads: 'Sparen', ch_face_tails: 'Gönnen',
    ch_rule_heads: 'Verzichte, und {0} geht an {1}.', ch_rule_tails: 'Gönn es dir, ohne schlechtes Gewissen.', ch_the_money: 'das Geld',
    ch_flip: 'Münze werfen', ch_flipping: 'Die Münze fliegt…',
    ch_need_amount: 'Gib zuerst ungefähr ein, was es kosten würde.', ch_need_target: 'Wähle, wohin das Geld geht.',
    ch_res_heads: 'Kopf. Verzichte.', ch_res_heads_line: 'Leg die {0}, die du ausgegeben hättest, in {1}.',
    ch_save_btn: '{0} sparen', ch_not_now: 'Nicht jetzt',
    ch_res_tails: 'Zahl. Gönn es dir.', ch_res_tails_line: 'Die Münze sagt ja, also genieße es ohne schlechtes Gewissen.',
    ch_log_spend: 'Ausgabe erfassen', ch_save_anyway: '{0} trotzdem sparen', ch_again: 'Noch einmal werfen',
    ch_saved_title: 'Gespart!', ch_saved_line: '{0} gingen an {1}.', ch_open_target: '{0} öffnen',
    ch_cf_tx_heads: 'Münzwurf: verzichtet auf {0}', ch_cf_tx_bonus: 'Münzwurf: trotzdem gespart ({0})', ch_cf_tx_tails: 'Münzwurf: {0}',
    ch_toast_saved: '{0} in {1} gespart.',
    ch_h_saved: 'Verzichtet auf {0}', ch_h_bonus: 'Trotzdem gespart: {0}', ch_h_kept: 'Verzichtet auf {0}, noch nicht gespart', ch_h_undone: '{0}, zurückgenommen', ch_h_enjoyed: '{0} gegönnt',
    ch_h_to: 'an {0}', ch_save_now: 'Jetzt sparen', ch_target_gone: 'Dieses Ziel oder diese Schuld gibt es nicht mehr. Wähle etwas anderes.',
    ch_dash_fig: 'mit Challenges gespart', ch_dash_skipped_1: '1 Ausgabe ausgelassen', ch_dash_skipped_n: '{0} Ausgaben ausgelassen', ch_dash_period: '{0} in diesem Zeitraum',
    ch_dot_saved: 'Gespart', ch_dot_kept: 'Verzichtet, noch nicht gespart', ch_dot_enjoyed: 'Gegönnt'
  },
  fr: {
    tab_challenges: 'Défis',
    ch_desc: 'De petits jeux pour le moment où vous allez dépenser. Quand l’argent gagne, ce que vous auriez dépensé va à un objectif ou à une dette.',
    ch_cat_decide: 'Décisions rapides', ch_cat_decide_desc: 'Hésitant entre deux choix ? Laissez un jeu décider, et faites gagner votre épargne.',
    ch_play: 'Jouer', ch_plays_1: 'Joué une fois', ch_plays_n: 'Joué {0} fois', ch_gc_saved: '{0} épargnés',
    ch_stat_saved: 'Épargné grâce aux défis', ch_stat_period: 'Épargné sur la période', ch_stat_skipped: 'Dépenses évitées',
    ch_hist_title: 'Vos résultats', ch_hist_empty: 'Aucune partie pour l’instant. Chaque résultat apparaîtra ici.', ch_show_all: 'Tout afficher ({0})', ch_show_less: 'Afficher moins',
    ch_back: 'Tous les défis',
    ch_cf_title: 'Pile ou face',
    ch_cf_desc: 'Dépenser ou épargner ? Laissez une pièce décider. Face : vous y renoncez et l’argent va à un objectif ou à une dette. Pile : faites-vous plaisir, sans culpabilité.',
    ch_step_what: 'Qu’est-ce qui vous tente ?', ch_step_cost: 'Combien cela coûterait-il, à peu près ?', ch_step_where: 'Si c’est face, l’argent va à',
    ch_p_takeout: 'Plat à emporter', ch_p_coffee: 'Café', ch_p_treat: 'Une gourmandise', ch_p_shopping: 'Shopping', ch_p_night: 'Sortie', ch_p_other: 'Autre chose',
    ch_other_ph: 'De quoi s’agit-il ?',
    ch_kind_goal: 'Objectif', ch_kind_debt: 'Dette', ch_of: '{0} sur {1}', ch_saved_sub: '{0} épargnés', ch_owed_sub: '{0} dus',
    ch_jar: 'Tirelire des défis', ch_jar_sub: 'Un nouvel objectif d’épargne, créé à votre première victoire',
    ch_none: 'Pas encore d’objectif ni de dette : les gains peuvent aller dans une Tirelire des défis. Ou créez les vôtres :', ch_new_goal: 'Nouvel objectif', ch_new_debt: 'Ajouter une dette',
    ch_heads: 'Face', ch_tails: 'Pile', ch_face_heads: 'Épargner', ch_face_tails: 'Profiter',
    ch_rule_heads: 'Renoncez-y, et {0} va à {1}.', ch_rule_tails: 'Faites-vous plaisir, sans culpabilité.', ch_the_money: 'l’argent',
    ch_flip: 'Lancer la pièce', ch_flipping: 'La pièce tourne…',
    ch_need_amount: 'Indiquez d’abord ce que cela coûterait, à peu près.', ch_need_target: 'Choisissez où va l’argent.',
    ch_res_heads: 'Face. On renonce.', ch_res_heads_line: 'Mettez les {0} que vous auriez dépensés dans {1}.',
    ch_save_btn: 'Épargner {0}', ch_not_now: 'Pas maintenant',
    ch_res_tails: 'Pile. Profitez-en.', ch_res_tails_line: 'La pièce dit oui : profitez-en, sans culpabilité.',
    ch_log_spend: 'Noter la dépense', ch_save_anyway: 'Épargner {0} quand même', ch_again: 'Relancer',
    ch_saved_title: 'Épargné !', ch_saved_line: '{0} sont allés à {1}.', ch_open_target: 'Ouvrir {0}',
    ch_cf_tx_heads: 'Pile ou face : renoncé à {0}', ch_cf_tx_bonus: 'Pile ou face : épargné quand même ({0})', ch_cf_tx_tails: 'Pile ou face : {0}',
    ch_toast_saved: '{0} épargnés dans {1}.',
    ch_h_saved: 'Renoncé à {0}', ch_h_bonus: 'Épargné quand même : {0}', ch_h_kept: 'Renoncé à {0}, pas encore épargné', ch_h_undone: '{0}, annulé', ch_h_enjoyed: 'Profité : {0}',
    ch_h_to: 'vers {0}', ch_save_now: 'Épargner', ch_target_gone: 'Cet objectif ou cette dette n’existe plus. Choisissez-en un autre.',
    ch_dash_fig: 'épargnés grâce aux défis', ch_dash_skipped_1: '1 dépense évitée', ch_dash_skipped_n: '{0} dépenses évitées', ch_dash_period: '{0} sur la période',
    ch_dot_saved: 'Épargné', ch_dot_kept: 'Renoncé, pas encore épargné', ch_dot_enjoyed: 'Profité'
  },
  es: {
    tab_challenges: 'Retos',
    ch_desc: 'Pequeños juegos para el momento justo antes de gastar. Cuando gana el dinero, lo que habrías gastado va a una meta o a una deuda.',
    ch_cat_decide: 'Decisiones rápidas', ch_cat_decide_desc: '¿Dudas entre dos opciones? Deja que un juego decida y que ganen tus ahorros.',
    ch_play: 'Jugar', ch_plays_1: 'Jugado una vez', ch_plays_n: 'Jugado {0} veces', ch_gc_saved: '{0} ahorrados',
    ch_stat_saved: 'Ahorrado con retos', ch_stat_period: 'Ahorrado este periodo', ch_stat_skipped: 'Gastos evitados',
    ch_hist_title: 'Tus resultados', ch_hist_empty: 'Aún no has jugado. Cada resultado aparecerá aquí.', ch_show_all: 'Ver todo ({0})', ch_show_less: 'Ver menos',
    ch_back: 'Todos los retos',
    ch_cf_title: 'Cara o cruz',
    ch_cf_desc: '¿Gastar o ahorrar? Deja que decida una moneda. Cara: renuncias y el dinero va a una meta o deuda. Cruz: disfrútalo, sin culpa.',
    ch_step_what: '¿Qué te tienta?', ch_step_cost: '¿Cuánto costaría, más o menos?', ch_step_where: 'Si sale cara, el dinero va a',
    ch_p_takeout: 'Comida a domicilio', ch_p_coffee: 'Café', ch_p_treat: 'Un capricho', ch_p_shopping: 'Compras', ch_p_night: 'Salir', ch_p_other: 'Otra cosa',
    ch_other_ph: '¿Qué es?',
    ch_kind_goal: 'Meta', ch_kind_debt: 'Deuda', ch_of: '{0} de {1}', ch_saved_sub: '{0} ahorrados', ch_owed_sub: '{0} pendientes',
    ch_jar: 'Hucha de retos', ch_jar_sub: 'Una nueva meta de ahorro, creada cuando ganes por primera vez',
    ch_none: 'Aún no hay metas ni deudas, así que lo ganado puede ir a una Hucha de retos. O crea las tuyas:', ch_new_goal: 'Nueva meta', ch_new_debt: 'Añadir deuda',
    ch_heads: 'Cara', ch_tails: 'Cruz', ch_face_heads: 'Ahorra', ch_face_tails: 'Disfruta',
    ch_rule_heads: 'Renuncia, y {0} va a {1}.', ch_rule_tails: 'Disfrútalo, sin culpa.', ch_the_money: 'el dinero',
    ch_flip: 'Lanzar la moneda', ch_flipping: 'La moneda gira…',
    ch_need_amount: 'Primero indica cuánto costaría, más o menos.', ch_need_target: 'Elige adónde va el dinero.',
    ch_res_heads: 'Cara. Renuncia.', ch_res_heads_line: 'Pon los {0} que habrías gastado en {1}.',
    ch_save_btn: 'Ahorrar {0}', ch_not_now: 'Ahora no',
    ch_res_tails: 'Cruz. Disfrútalo.', ch_res_tails_line: 'La moneda dice que sí: disfrútalo, sin culpa.',
    ch_log_spend: 'Anotar el gasto', ch_save_anyway: 'Ahorrar {0} igualmente', ch_again: 'Lanzar otra vez',
    ch_saved_title: '¡Ahorrado!', ch_saved_line: '{0} fueron a {1}.', ch_open_target: 'Abrir {0}',
    ch_cf_tx_heads: 'Cara o cruz: renuncié a {0}', ch_cf_tx_bonus: 'Cara o cruz: ahorrado igualmente ({0})', ch_cf_tx_tails: 'Cara o cruz: {0}',
    ch_toast_saved: '{0} ahorrados en {1}.',
    ch_h_saved: 'Renunciaste a {0}', ch_h_bonus: 'Ahorrado igualmente: {0}', ch_h_kept: 'Renunciaste a {0}, aún sin ahorrar', ch_h_undone: '{0}, deshecho', ch_h_enjoyed: 'Disfrutaste: {0}',
    ch_h_to: 'a {0}', ch_save_now: 'Ahorrar', ch_target_gone: 'Esa meta o deuda ya no existe. Elige otra.',
    ch_dash_fig: 'ahorrados con retos', ch_dash_skipped_1: '1 gasto evitado', ch_dash_skipped_n: '{0} gastos evitados', ch_dash_period: '{0} este periodo',
    ch_dot_saved: 'Ahorrado', ch_dot_kept: 'Renunciado, aún sin ahorrar', ch_dot_enjoyed: 'Disfrutado'
  },
  it: {
    tab_challenges: 'Sfide',
    ch_desc: 'Piccoli giochi per il momento prima di spendere. Quando vince il denaro, quello che avresti speso va a un obiettivo o a un debito.',
    ch_cat_decide: 'Decisioni rapide', ch_cat_decide_desc: 'Indeciso tra due scelte? Lascia decidere a un gioco, e fai vincere i tuoi risparmi.',
    ch_play: 'Gioca', ch_plays_1: 'Giocato una volta', ch_plays_n: 'Giocato {0} volte', ch_gc_saved: '{0} risparmiati',
    ch_stat_saved: 'Risparmiato con le sfide', ch_stat_period: 'Risparmiato in questo periodo', ch_stat_skipped: 'Spese evitate',
    ch_hist_title: 'I tuoi risultati', ch_hist_empty: 'Nessuna partita finora. Ogni risultato comparirà qui.', ch_show_all: 'Mostra tutto ({0})', ch_show_less: 'Mostra meno',
    ch_back: 'Tutte le sfide',
    ch_cf_title: 'Testa o croce',
    ch_cf_desc: 'Spendere o risparmiare? Lascia decidere a una moneta. Testa: rinunci e il denaro va a un obiettivo o debito. Croce: goditela, senza sensi di colpa.',
    ch_step_what: 'Cosa ti tenta?', ch_step_cost: 'Quanto costerebbe, più o meno?', ch_step_where: 'Se esce testa, il denaro va a',
    ch_p_takeout: 'Cibo a domicilio', ch_p_coffee: 'Caffè', ch_p_treat: 'Uno sfizio', ch_p_shopping: 'Shopping', ch_p_night: 'Serata fuori', ch_p_other: 'Altro',
    ch_other_ph: 'Che cos’è?',
    ch_kind_goal: 'Obiettivo', ch_kind_debt: 'Debito', ch_of: '{0} di {1}', ch_saved_sub: '{0} risparmiati', ch_owed_sub: '{0} da pagare',
    ch_jar: 'Salvadanaio delle sfide', ch_jar_sub: 'Un nuovo obiettivo di risparmio, creato alla tua prima vittoria',
    ch_none: 'Ancora nessun obiettivo o debito, quindi le vincite possono andare in un Salvadanaio delle sfide. Oppure creane uno tuo:', ch_new_goal: 'Nuovo obiettivo', ch_new_debt: 'Aggiungi debito',
    ch_heads: 'Testa', ch_tails: 'Croce', ch_face_heads: 'Risparmia', ch_face_tails: 'Goditela',
    ch_rule_heads: 'Rinuncia, e {0} va a {1}.', ch_rule_tails: 'Goditela, senza sensi di colpa.', ch_the_money: 'il denaro',
    ch_flip: 'Lancia la moneta', ch_flipping: 'La moneta gira…',
    ch_need_amount: 'Prima indica quanto costerebbe, più o meno.', ch_need_target: 'Scegli dove va il denaro.',
    ch_res_heads: 'Testa. Rinuncia.', ch_res_heads_line: 'Metti i {0} che avresti speso in {1}.',
    ch_save_btn: 'Risparmia {0}', ch_not_now: 'Non ora',
    ch_res_tails: 'Croce. Goditela.', ch_res_tails_line: 'La moneta dice sì: goditela, senza sensi di colpa.',
    ch_log_spend: 'Registra la spesa', ch_save_anyway: 'Risparmia {0} lo stesso', ch_again: 'Lancia di nuovo',
    ch_saved_title: 'Risparmiato!', ch_saved_line: '{0} sono andati a {1}.', ch_open_target: 'Apri {0}',
    ch_cf_tx_heads: 'Testa o croce: rinunciato a {0}', ch_cf_tx_bonus: 'Testa o croce: risparmiato lo stesso ({0})', ch_cf_tx_tails: 'Testa o croce: {0}',
    ch_toast_saved: '{0} risparmiati in {1}.',
    ch_h_saved: 'Rinunciato a {0}', ch_h_bonus: 'Risparmiato lo stesso: {0}', ch_h_kept: 'Rinunciato a {0}, non ancora risparmiato', ch_h_undone: '{0}, annullato', ch_h_enjoyed: 'Goduto: {0}',
    ch_h_to: 'a {0}', ch_save_now: 'Risparmia', ch_target_gone: 'Quell’obiettivo o debito non c’è più. Scegline un altro.',
    ch_dash_fig: 'risparmiati con le sfide', ch_dash_skipped_1: '1 spesa evitata', ch_dash_skipped_n: '{0} spese evitate', ch_dash_period: '{0} in questo periodo',
    ch_dot_saved: 'Risparmiato', ch_dot_kept: 'Rinunciato, non ancora risparmiato', ch_dot_enjoyed: 'Goduto'
  },
  pl: {
    tab_challenges: 'Wyzwania',
    ch_desc: 'Małe gry na chwilę przed wydaniem pieniędzy. Gdy wygrywają pieniądze, to, co byś wydał, trafia na cel lub spłatę długu.',
    ch_cat_decide: 'Szybkie decyzje', ch_cat_decide_desc: 'Nie możesz się zdecydować? Niech zdecyduje gra, a wygrają twoje oszczędności.',
    ch_play: 'Graj', ch_plays_1: 'Zagrano raz', ch_plays_n: 'Rozgrywki: {0}', ch_gc_saved: 'Odłożono {0}',
    ch_stat_saved: 'Odłożone dzięki wyzwaniom', ch_stat_period: 'Odłożone w tym okresie', ch_stat_skipped: 'Pominięte wydatki',
    ch_hist_title: 'Twoje wyniki', ch_hist_empty: 'Jeszcze nic nie rozegrano. Każdy wynik pojawi się tutaj.', ch_show_all: 'Pokaż wszystko ({0})', ch_show_less: 'Pokaż mniej',
    ch_back: 'Wszystkie wyzwania',
    ch_cf_title: 'Rzut monetą',
    ch_cf_desc: 'Wydać czy odłożyć? Niech zdecyduje moneta. Orzeł: rezygnujesz, a pieniądze trafiają na cel lub dług. Reszka: ciesz się bez wyrzutów sumienia.',
    ch_step_what: 'Na co masz ochotę?', ch_step_cost: 'Ile by to mniej więcej kosztowało?', ch_step_where: 'Jeśli wypadnie orzeł, pieniądze trafią na',
    ch_p_takeout: 'Jedzenie na wynos', ch_p_coffee: 'Kawa', ch_p_treat: 'Coś słodkiego', ch_p_shopping: 'Zakupy', ch_p_night: 'Wyjście', ch_p_other: 'Coś innego',
    ch_other_ph: 'Co to jest?',
    ch_kind_goal: 'Cel', ch_kind_debt: 'Dług', ch_of: '{0} z {1}', ch_saved_sub: 'Odłożono {0}', ch_owed_sub: 'Do spłaty {0}',
    ch_jar: 'Słoik wyzwań', ch_jar_sub: 'Nowy cel oszczędnościowy, tworzony przy pierwszej wygranej',
    ch_none: 'Nie masz jeszcze celów ani długów, więc wygrane mogą trafić do Słoika wyzwań. Albo dodaj własne:', ch_new_goal: 'Nowy cel', ch_new_debt: 'Dodaj dług',
    ch_heads: 'Orzeł', ch_tails: 'Reszka', ch_face_heads: 'Odłóż', ch_face_tails: 'Ciesz się',
    ch_rule_heads: 'Zrezygnuj, a {0} trafi na {1}.', ch_rule_tails: 'Ciesz się bez wyrzutów sumienia.', ch_the_money: 'kwota',
    ch_flip: 'Rzuć monetą', ch_flipping: 'Moneta w powietrzu…',
    ch_need_amount: 'Najpierw wpisz, ile by to mniej więcej kosztowało.', ch_need_target: 'Wybierz, dokąd trafią pieniądze.',
    ch_res_heads: 'Orzeł. Zrezygnuj.', ch_res_heads_line: 'Odłóż {0}, które byś wydał, na {1}.',
    ch_save_btn: 'Odłóż {0}', ch_not_now: 'Nie teraz',
    ch_res_tails: 'Reszka. Ciesz się.', ch_res_tails_line: 'Moneta mówi tak, więc ciesz się bez wyrzutów sumienia.',
    ch_log_spend: 'Zapisz wydatek', ch_save_anyway: 'Mimo to odłóż {0}', ch_again: 'Rzuć jeszcze raz',
    ch_saved_title: 'Odłożone!', ch_saved_line: '{0} trafiło na {1}.', ch_open_target: 'Otwórz {0}',
    ch_cf_tx_heads: 'Rzut monetą: rezygnacja z {0}', ch_cf_tx_bonus: 'Rzut monetą: odłożone mimo to ({0})', ch_cf_tx_tails: 'Rzut monetą: {0}',
    ch_toast_saved: 'Odłożono {0} na {1}.',
    ch_h_saved: 'Rezygnacja: {0}', ch_h_bonus: 'Odłożone mimo to: {0}', ch_h_kept: 'Rezygnacja: {0}, jeszcze nie odłożone', ch_h_undone: '{0}, cofnięte', ch_h_enjoyed: 'Przyjemność: {0}',
    ch_h_to: 'na {0}', ch_save_now: 'Odłóż', ch_target_gone: 'Tego celu lub długu już nie ma. Wybierz inny.',
    ch_dash_fig: 'odłożone dzięki wyzwaniom', ch_dash_skipped_1: 'Pominięte wydatki: 1', ch_dash_skipped_n: 'Pominięte wydatki: {0}', ch_dash_period: '{0} w tym okresie',
    ch_dot_saved: 'Odłożone', ch_dot_kept: 'Rezygnacja, jeszcze nie odłożone', ch_dot_enjoyed: 'Przyjemność'
  }
};
(function chAddWords() {
  try { Object.keys(CH_WORDS).forEach(l => { if (TRANSLATIONS[l]) Object.assign(TRANSLATIONS[l], CH_WORDS[l]); }); } catch (e) {}
})();
