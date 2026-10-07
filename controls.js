'use strict';
/* =====================================================================
   controls.js - every control drawn by the app, never by the device.

   - Dropdowns. Every <select> in the planner is shown as the app's own
     dropdown (ddBind in simple.js). The real select stays in the page,
     hidden, and keeps its value: picking an option writes it there and
     fires the same input and change events, so every line of code that
     reads a select or listens to one works exactly as before.
   - Dates. Any date field not already behind the app's date picker is
     wrapped in one, so a tap never opens the phone's own date wheel.
   - Numbers. On a touch screen, amount fields open the app's keypad
     instead of the phone's keyboard.

   Text you type yourself (a name, a note) still uses the phone's keyboard:
   that keeps autocorrect, dictation and accessibility working.
   ===================================================================== */

const FK_TOUCH = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };

// ── Dropdowns ────────────────────────────────────────────────────────────
const FK_SEL_SKIP = 'select[multiple], select[data-native], .dd select';
const _fkSelValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const _fkSelIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

function fkSelectOpts(sel) {
  return [...sel.options].filter(o => !o.hidden).map(o => ({ v: o.value, l: o.textContent.trim(), disabled: o.disabled }));
}
function fkSelectSync(sel) {
  const btn = sel._fkBtn;
  if (!btn) return;
  const o = sel.options[_fkSelIndex.get.call(sel)];
  const val = btn.querySelector('.dd-val');
  val.textContent = o ? o.textContent.trim() : '';
  val.classList.toggle('is-ph', !o || o.value === '');
  btn.disabled = sel.disabled;
  btn.closest('.dd').dataset.value = o ? o.value : '';
  btn.closest('.dd').classList.toggle('is-invalid', sel.classList.contains('select--error') || sel.classList.contains('fk-invalid'));
}
function fkSelectEnhance(sel) {
  if (sel._fkBtn || sel.matches(FK_SEL_SKIP)) return;
  const wrap = document.createElement('div');
  wrap.className = 'dd dd--native';
  // The button wears the select's own classes, so every appearance that
  // styles a select styles this the same way.
  wrap.innerHTML = `<button type="button" class="${esc(sel.className)} dd-btn--native" aria-haspopup="listbox" aria-expanded="false"><span class="dd-val"></span></button>`;
  const btn = wrap.querySelector('.dd-btn--native');
  if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
  const label = sel.getAttribute('aria-label') || (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`)?.textContent.trim());
  if (label) btn.setAttribute('aria-label', label);
  sel.insertAdjacentElement('afterend', wrap);
  sel.classList.add('fk-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  sel._fkBtn = btn;
  // A value set by code, not by a pick, still shows on the button.
  Object.defineProperty(sel, 'value', { configurable: true, get() { return _fkSelValue.get.call(this); }, set(v) { _fkSelValue.set.call(this, v); fkSelectSync(this); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return _fkSelIndex.get.call(this); }, set(v) { _fkSelIndex.set.call(this, v); fkSelectSync(this); } });
  new MutationObserver(() => fkSelectSync(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'selected'] });
  sel.addEventListener('change', () => fkSelectSync(sel));
  // The list is read from the select each time it opens, so options added
  // later are always there.
  btn.addEventListener('click', e => {
    e.stopImmediatePropagation();
    ddOpen(wrap, fkSelectOpts(sel), v => {
      if (_fkSelValue.get.call(sel) === v) return;
      _fkSelValue.set.call(sel, v);
      fkSelectSync(sel);
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, { grid: sel.dataset.ddGrid ? +sel.dataset.ddGrid : 0 });
  }, true);
  btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && !document.getElementById('ddMenu')) { e.preventDefault(); btn.click(); } });
  fkSelectSync(sel);
}

// ── Dates ────────────────────────────────────────────────────────────────
function fkDateEnhance(inp) {
  if (inp._fkDate || inp.closest('.date-field-styled, .date-cell-styled') || inp.classList.contains('qa-hidden-date')) return;
  inp._fkDate = true;
  const wrap = document.createElement('div');
  wrap.className = 'date-field-styled';
  wrap.tabIndex = -1;
  inp.insertAdjacentElement('beforebegin', wrap);
  wrap.innerHTML = `${typeof calIcon === 'function' ? calIcon() : ''}<span class="date-field-val"></span>`;
  wrap.appendChild(inp);
  const paint = () => { wrap.querySelector('.date-field-val').innerHTML = inp.value ? esc(formatDateDisplay(inp.value)) : `<span class="no-date">${esc(t('fk_set_date'))}</span>`; };
  paint();
  wrap.addEventListener('click', () => openDatePicker(inp, wrap));
  inp.addEventListener('change', paint);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openDatePicker(inp, wrap); } });
}

// ── The number keypad ────────────────────────────────────────────────────
// Amount fields on a touch screen. The field keeps the focus and the caret;
// the keypad only types into it, so everything listening to the field
// (totals, validation, steppers) sees the same input events as before.
const FK_NUM_FIELDS = 'input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]';
const FK_NUM_SKIP = '.qa input, [data-no-keypad], .kp-sheet input';
let _kpFor = null;
function fkKeypadArm(inp) {
  if (inp._fkKp || inp.matches(FK_NUM_SKIP)) return;
  inp._fkKp = true;
  inp.dataset.kpMode = inp.getAttribute('inputmode') || '';
  inp.setAttribute('inputmode', 'none');
  inp.addEventListener('focus', () => kpOpen(inp));
  inp.addEventListener('click', () => { if (_kpFor !== inp) kpOpen(inp); });
}
function kpSheet() {
  let k = document.getElementById('kpSheet');
  if (k) return k;
  k = document.createElement('div');
  k.id = 'kpSheet';
  k.className = 'kp-sheet';
  k.setAttribute('role', 'group');
  k.setAttribute('aria-label', t('fk_keypad'));
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  k.innerHTML = `<div class="kp-grid">${keys.map(x => x === 'back'
    ? `<button type="button" class="kp-key kp-key--fn" data-kp="back" aria-label="${esc(t('qa_backspace'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12z"/><path d="m14 10 4 4"/><path d="m18 10-4 4"/></svg></button>`
    : `<button type="button" class="kp-key" data-kp="${x}">${x}</button>`).join('')}</div>
    <button type="button" class="btn btn-primary kp-done" data-kp="done">${esc(t('tools_done'))}</button>`;
  document.body.appendChild(k);
  // Keys never take the focus, so the field keeps its caret and stays live.
  k.addEventListener('pointerdown', e => e.preventDefault());
  k.addEventListener('click', e => {
    const b = e.target.closest('[data-kp]');
    if (!b || !_kpFor) return;
    const inp = _kpFor, key = b.dataset.kp;
    if (key === 'done') { inp.blur(); return; }
    let v = inp._kpFresh && key !== 'back' ? '' : (inp.value || '');
    inp._kpFresh = false;
    if (key === 'back') v = v.slice(0, -1);
    else if (key === '.') { if (inp.dataset.kpMode === 'numeric' || v.includes('.')) return; v = (v || '0') + '.'; }
    else {
      const dec = v.split('.')[1];
      if (dec !== undefined && dec.length >= 2) return;
      v = v === '0' ? key : v + key;
    }
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return k;
}
function kpOpen(inp) {
  if (!FK_TOUCH()) return;
  const k = kpSheet();
  _kpFor = inp;
  inp._kpFresh = true;
  // A number field cannot show "12." while it is being typed, so it is
  // plain text while the keypad is up and a number again afterwards.
  if (inp.type === 'number') { inp.dataset.kpNum = '1'; inp.type = 'text'; }
  k.classList.add('is-open');
  document.body.classList.add('kp-open');
  requestAnimationFrame(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  inp.addEventListener('blur', kpOnBlur);
}
function kpOnBlur(e) {
  const inp = e.target;
  inp.removeEventListener('blur', kpOnBlur);
  setTimeout(() => {
    if (document.activeElement && document.activeElement.matches && document.activeElement.matches(FK_NUM_FIELDS) && document.activeElement._fkKp) return;
    kpClose();
    if (inp.dataset.kpNum) { inp.value = inp.value.replace(/\.$/, ''); inp.type = 'number'; delete inp.dataset.kpNum; }
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, 0);
}
function kpClose() {
  _kpFor = null;
  document.getElementById('kpSheet')?.classList.remove('is-open');
  document.body.classList.remove('kp-open');
}

// ── Colours ─────────────────────────────────────────────────────────────
function fkHslHex(h, s, l) {
  s /= 100; l /= 100;
  const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}

// ── Scanning ────────────────────────────────────────────────────────────
function fkScanControls(root) {
  if (!root || !root.querySelectorAll) return;
  if (root.matches && root.matches('select')) fkSelectEnhance(root);
  root.querySelectorAll('select').forEach(fkSelectEnhance);
  root.querySelectorAll('input[type="date"]').forEach(fkDateEnhance);
  if (FK_TOUCH()) root.querySelectorAll(FK_NUM_FIELDS).forEach(fkKeypadArm);
}
function fkControlsInit() {
  fkScanControls(document.body);
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) fkScanControls(n);
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fkControlsInit);
else fkControlsInit();

(function controlsAddWords() {
  try { Object.assign(TRANSLATIONS.en, { fk_set_date: 'Set date', fk_keypad: 'Number pad', fk_custom_colour: 'Your own colour' }); } catch (e) {}
})();
