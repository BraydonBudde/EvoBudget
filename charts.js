// ══════════════════════════════════════════════════════════════════════
// Shared chart primitives for the alternate Dashboard Layouts (2-5).
// Loaded by both index.html (SBP) and ultimate-budget.html (UBP), same
// pattern as sync.js. Pure inline-SVG builders, no external libraries -
// mirrors the existing svgDonut()/initDonuts() pattern defined in each
// app's own script (esc/fmt/t are available by the time these run).
// ══════════════════════════════════════════════════════════════════════

// ── Semi-circle gauge (single KPI, 0-100%) ──────────────────────────────
// Same circle+stroke-dasharray+rotate technique as svgDonut (proven), just
// scaled to a half circumference and relying on the SVG's own viewBox to
// crop the bottom half - avoids hand-rolled path arc-flag geometry.
function svgSemiGauge(pct, size = 160, color = '#6366f1', centerText) {
  const sw = Math.max(10, size * 0.11);
  const r = size / 2 - sw / 2 - 2;
  const cx = size / 2, cy = r + sw / 2 + 2;
  const boxH = cy + 4;
  const cFull = 2 * Math.PI * r, cHalf = cFull / 2;
  const p = Math.max(0, Math.min(100, pct || 0));
  // Floor the dash at ~3% of the half-circumference so a rounded-cap "nub"
  // is always visible at the start of the arc, even at a literal 0% - an
  // empty gauge should still read as "a gauge", not as blank space.
  const dash = Math.max(cHalf * 0.03, (p / 100) * cHalf), gap = cFull - dash;
  // centerText lets a caller decouple the displayed number from the fill -
  // e.g. a goal-progress ring where the fill is capped at "100% of target"
  // but the real (possibly >100%) figure still needs to be shown.
  const label = centerText != null ? centerText : `${Math.round(p)}%`;
  return `<svg class="gauge-svg" width="${size}" height="${boxH.toFixed(1)}" viewBox="0 0 ${size} ${boxH.toFixed(1)}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--text-faint)" stroke-opacity="0.32" stroke-width="${sw}"/>
    <circle class="gauge-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" transform="rotate(180 ${cx} ${cy})"
      style="transition:stroke-dasharray .3s"/>
    <text x="${cx}" y="${(cy - sw * 0.25).toFixed(1)}" text-anchor="middle" style="font-family:Sora,sans-serif;font-weight:800;font-size:${(size * .16).toFixed(0)}px;fill:var(--text-primary)">${esc(String(label))}</text>
  </svg>`;
}

// ── Radial bar chart: one concentric ring per category ─────────────────
function svgRadialBars(rings, size = 220) {
  const cx = size / 2, cy = size / 2, n = rings.length;
  if (!n) return `<svg width="${size}" height="${size}"></svg>`;
  const sw = Math.max(7, Math.min(14, (size / 2 - 10) / n / 1.8));
  const gap = sw * 0.55;
  let out = '';
  rings.forEach((ring, idx) => {
    const r = size / 2 - sw / 2 - idx * (sw + gap);
    if (r <= sw) return;
    const c = 2 * Math.PI * r;
    const pct = ring.expected > 0 ? Math.min(150, (ring.value / ring.expected) * 100) : (ring.value > 0 ? 100 : 0);
    // Same rounded-cap "nub" floor as svgSemiGauge - a ring at 0% should
    // still read as an active ring in the chart, not as an empty gap.
    const dash = Math.max(c * 0.02, Math.min(100, pct) / 100 * c), gapLen = c - dash;
    const over = ring.expected > 0 && ring.value > ring.expected;
    const segColor = over ? '#f43f5e' : ring.color;
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--text-faint)" stroke-opacity="0.28" stroke-width="${sw}"/>
      <circle class="rbar-seg" data-idx="${idx}" data-label="${esc(ring.label || '')}" data-val="${ring.value || 0}" data-expected="${ring.expected || 0}" data-color="${segColor}" data-pct="${pct.toFixed(0)}"
        cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${segColor}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(2)} ${gapLen.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"
        tabindex="0" role="img" aria-label="${esc(ring.label || '')}: ${pct.toFixed(0)}%"
        style="cursor:pointer;transition:opacity .18s"/>`;
  });
  return `<svg class="radial-bars-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${out}</svg>`;
}

// ── Segmented pie chart: rounded-cap wedges with a gap between each ─────
// Same circle+stroke-dasharray technique as svgDonut/svgRadialBars, but as
// a single chunky ring (thick stroke relative to its radius, reading as a
// pie rather than a thin donut) with a small angular gap subtracted from
// each segment's dash and stroke-linecap:round on every arc, so segments
// read as separate rounded wedges instead of one continuous ring.
function svgSegmentedPie(segments, size = 200) {
  const sw = size * 0.2;
  const r = size / 2 - sw / 2 - 2, c = 2 * Math.PI * r, cx = size / 2, cy = size / 2;
  const list = (segments || []).filter(s => (s.value || 0) > 0);
  const bg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--text-faint)" stroke-opacity="0.24" stroke-width="${sw}"/>`;
  if (!list.length) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}</svg>`;
  // A stroke-linecap:round cap bulges the visible arc past its mathematical
  // dash endpoint by sw/2 in each direction, so two neighboring segments'
  // caps alone eat ~sw of arc length at a shared boundary - reserve that
  // plus a few px of true daylight, or the "gap" just gets swallowed by
  // the caps and segments look like one continuous ring (the bug this
  // replaced: a fixed degree-based gap was fine at thin stroke widths but
  // vanished once the stroke got pie-thick).
  const visualGapPx = 6;
  const gapLen = list.length > 1 ? sw + visualGapPx : 0;
  let cum = 0, arcs = '';
  list.forEach((seg, idx) => {
    const p = seg.pct || 0;
    if (p <= 0) return;
    const segLen = (p / 100) * c;
    const dash = Math.max(sw * 0.5, segLen - gapLen);
    const rot = -90 + (cum / 100) * 360;
    arcs += `<circle class="pie-seg" data-idx="${idx}" data-label="${esc(seg.label || '')}" data-val="${seg.value || 0}" data-pct="${p.toFixed(1)}"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
      transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"
      tabindex="0" role="img" aria-label="${esc(seg.label || '')}: ${p.toFixed(0)}%"
      style="cursor:pointer;transition:opacity .18s"/>`;
    cum += p;
  });
  return `<svg class="pie-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${bg}${arcs}</svg>`;
}
// Full pie+legend composition (chart on the left, a value-per-row legend on
// the right), reusing the same .radial-bars-block/.donut-legend classes as
// the Cash Flow rings so both circular charts in Layout 2 share one visual
// language. Legend rows show the raw value (not %) since that's what these
// two callers (Income Sources/Spending Breakdown) actually care about.
function pieChartHtml(segments, opts) {
  opts = opts || {};
  const valueFmt = opts.valueFormat || (v => fmt(v));
  const list = (segments || []).filter(s => (s.value || 0) > 0).slice(0, opts.limit || 6);
  if (!list.length) return '';
  const legend = list.map((s, idx) => `
    <div class="dleg-row" data-idx="${idx}">
      <span class="dleg-swatch" style="background:${s.color}"></span>
      <span class="dleg-label">${esc(s.label || '')}</span>
      <span class="dleg-pct">${esc(valueFmt(s.value || 0))}</span>
    </div>`).join('');
  return `<div class="radial-bars-block">${svgSegmentedPie(list, opts.size || 200)}<div class="donut-legend">${legend}</div></div>`;
}

// ── Icon-forward stat tile (markup helper, not SVG) ─────────────────────
function iconStatTile(icon, label, value, sub, color) {
  // label/sub are pre-formatted translated strings (same convention as the
  // stat cards in Layout 1) - not re-escaped here to avoid double-escaping
  // entities like "&amp;" that already live in the translation tables.
  return `<div class="icon-stat-tile">
    <div class="ist-icon" style="background:${color}22;color:${color}">${icon}</div>
    <div class="ist-body">
      <div class="ist-label">${label}</div>
      <div class="ist-value" style="color:${color}">${value}</div>
      ${sub ? `<div class="ist-sub">${sub}</div>` : ''}
    </div>
  </div>`;
}

// ── Generic hover/interaction wiring for the new categorical charts ────
// Mirrors initDonuts(): dims non-hovered marks, highlights the active one,
// shows a floating tooltip, and (when a matching data-idx legend row
// exists) links to it exactly like the donut's %→$ swap.
function ensureChartTooltip() {
  let tip = document.getElementById('chartTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chartTooltip';
    tip.className = 'chart-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}
function positionChartTooltip(tip, evt) {
  if (!evt) return;
  const x = (evt.clientX || 0), y = (evt.clientY || 0);
  const vw = window.innerWidth, vh = window.innerHeight;
  tip.style.left = Math.min(x + 16, vw - 180) + 'px';
  tip.style.top = Math.max(8, y - 12 > vh - 80 ? y - 80 : y + 16) + 'px';
}
function wireChartHover(scope, markSelector, opts) {
  opts = opts || {};
  if (!scope) return;
  const marks = Array.from(scope.querySelectorAll(markSelector));
  if (!marks.length) return;
  const tip = ensureChartTooltip();
  const legend = opts.legendScope ? Array.from(opts.legendScope.querySelectorAll('.dleg-row')) : [];
  const fmtTip = opts.format || (d => `<strong>${esc(d.label)}</strong><br>${esc(fmt(parseFloat(d.value) || 0))}`);
  const show = (mark, evt) => {
    marks.forEach(m => { m.style.opacity = m === mark ? '1' : '0.4'; });
    if (opts.highlightClass) mark.classList.add(opts.highlightClass);
    const row = legend.find(r => r.dataset.idx === mark.dataset.idx);
    if (row) {
      row.classList.add('is-active');
      if (opts.swapText !== false) {
        const amtEl = row.querySelector('.dleg-pct');
        if (amtEl) { if (amtEl.dataset.origText === undefined) amtEl.dataset.origText = amtEl.textContent; amtEl.textContent = fmt(parseFloat(mark.dataset.val) || 0); }
      }
    }
    tip.innerHTML = fmtTip(mark.dataset);
    tip.style.opacity = '1';
    positionChartTooltip(tip, evt);
  };
  const hide = () => {
    marks.forEach(m => { m.style.opacity = '1'; if (opts.highlightClass) m.classList.remove(opts.highlightClass); });
    legend.forEach(row => {
      row.classList.remove('is-active');
      if (opts.swapText !== false) {
        const amtEl = row.querySelector('.dleg-pct');
        if (amtEl && amtEl.dataset.origText !== undefined) amtEl.textContent = amtEl.dataset.origText;
      }
    });
    tip.style.opacity = '0';
  };
  marks.forEach(mark => {
    mark.addEventListener('mouseenter', e => show(mark, e));
    mark.addEventListener('mousemove', e => positionChartTooltip(tip, e));
    mark.addEventListener('mouseleave', hide);
    mark.addEventListener('touchstart', e => { e.preventDefault(); show(mark, e.touches[0]); }, { passive: false });
    mark.addEventListener('touchend', () => setTimeout(hide, 1600));
    mark.addEventListener('focus', e => show(mark, e));
    mark.addEventListener('blur', hide);
  });
  legend.forEach(row => {
    const mark = marks.find(m => m.dataset.idx === row.dataset.idx);
    if (!mark) return;
    row.addEventListener('mouseenter', e => show(mark, e));
    row.addEventListener('mouseleave', hide);
  });
}

