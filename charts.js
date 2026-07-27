// ══════════════════════════════════════════════════════════════════════
// Shared chart primitives for the alternate Dashboard Layouts (2-5).
// Loaded by both index.html (SBP) and ultimate-budget.html (UBP), same
// pattern as sync.js. Pure inline-SVG builders, no external libraries -
// mirrors the existing svgDonut()/initDonuts() pattern defined in each
// app's own script (esc/fmt/t are available by the time these run).
// ══════════════════════════════════════════════════════════════════════

// ── Post-sort palette assignment ────────────────────────────────────────
// Re-assign palette colors AFTER segments are sorted by value, so the
// largest (adjacent in the legend and on the ring) segments always get
// strongly contrasting hues - assigning by original category index let two
// near-identical teals land next to each other.
function assignSegColors(segs, palette) {
  segs.forEach((s, i) => { s.color = palette[i % palette.length]; });
  return segs;
}

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
    <text x="${cx}" y="${(cy - sw * 0.25).toFixed(1)}" text-anchor="middle" style="font-family:var(--font-display);font-weight:800;font-size:${(size * .16).toFixed(0)}px;fill:var(--text-primary)">${esc(String(label))}</text>
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
      <circle class="rbar-seg${over ? ' rbar-seg--over' : ''}" data-idx="${idx}" data-label="${esc(ring.label || '')}" data-val="${ring.value || 0}" data-expected="${ring.expected || 0}" data-color="${segColor}" data-pct="${pct.toFixed(0)}"
        cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${segColor}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(2)} ${gapLen.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"
        tabindex="0" role="img" aria-label="${esc(ring.label || '')}: ${pct.toFixed(0)}%"
        style="cursor:pointer;transition:opacity .18s"/>`;
  });
  return `<svg class="radial-bars-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${out}</svg>`;
}

// ── Segmented pie chart: deconstructed rounded wedges ───────────────────
// Each segment is a true annular-sector <path> (not a dashed stroke), so
// even a wide 60%+ segment keeps square-cut ends instead of sausage caps.
// The pie is "deconstructed": neighbouring wedges are separated by an
// angular gap and every corner is rounded (stroking each path with its own
// fill colour + stroke-linejoin:round, geometry inset by half the stroke so
// the rounded shape stays on its true footprint). At rest the wedges form a
// clean circle; each wedge carries its own outward "explode" vector as CSS
// vars (--ex/--ey) that only the .is-exploded hover state applies, so a
// slice animates outward when it (or its legend row) is highlighted.
function svgSegmentedPie(segments, size = 200) {
  const cx = size / 2, cy = size / 2;
  const list = (segments || []).filter(s => (s.value || 0) > 0);
  // Headroom so a hovered wedge can pop outward without clipping; at rest
  // the pie is a full circle within the box.
  const pop = Math.max(7, size * 0.05);               // hover extrude distance
  const R = size / 2 - 3;                              // outer radius (fills the box)
  const r = R * 0.56;                                  // inner (hole) radius
  const bgRing = `<circle cx="${cx}" cy="${cy}" r="${((R + r) / 2).toFixed(1)}" fill="none" stroke="var(--text-faint)" stroke-opacity="0.24" stroke-width="${(R - r).toFixed(1)}"/>`;
  if (!list.length) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bgRing}</svg>`;
  const attrs = (seg, idx, p) => `class="pie-seg" data-idx="${idx}" data-label="${esc(seg.label || '')}" data-val="${seg.value || 0}" data-pct="${p.toFixed(1)}" tabindex="0" role="img" aria-label="${esc(seg.label || '')}: ${p.toFixed(0)}%"`;
  // dispPct (when set by pieChartHtml) is a redistributed share that gives
  // tiny segments a legible minimum sweep; data-pct keeps the truth.
  const shown = list.map(seg => seg.dispPct != null ? seg.dispPct : (seg.pct || 0));
  // A lone segment is just a full ring - no gaps or corners to round.
  if (list.length === 1) {
    return `<svg class="pie-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible"><circle ${attrs(list[0], 0, shown[0])} cx="${cx}" cy="${cy}" r="${((R + r) / 2).toFixed(1)}" fill="none" stroke="${list[0].color}" stroke-width="${(R - r).toFixed(1)}"/></svg>`;
  }
  const rad = a => a * Math.PI / 180;
  const px = (rr, a) => (cx + rr * Math.cos(rad(a))).toFixed(2);
  const py = (rr, a) => (cy + rr * Math.sin(rad(a))).toFixed(2);
  const cr = Math.max(7, size * 0.055);               // corner stroke (radius ≈ cr/2)
  const gapDeg = 3.4;                                 // daylight between wedges
  const Rp = R - cr / 2, rp = r + cr / 2;             // inset for the rounding stroke
  const insetO = (cr / 2) / Rp * 180 / Math.PI;       // angular inset, outer edge
  const insetI = (cr / 2) / rp * 180 / Math.PI;       // angular inset, inner edge
  let cum = -90, arcs = '';
  list.forEach((seg, idx) => {
    const p = shown[idx];
    if (p <= 0) return;
    const sweep = p / 100 * 360;
    const startA = cum + gapDeg / 2, endA = cum + sweep - gapDeg / 2;
    const mid = (startA + endA) / 2;
    // Clamp each edge pair so very small wedges degrade to a rounded nub
    // instead of inverting.
    let oa1 = startA + insetO, oa2 = endA - insetO;
    if (oa2 <= oa1) { oa1 = oa2 = mid; }
    let ia1 = startA + insetI, ia2 = endA - insetI;
    if (ia2 <= ia1) { ia1 = ia2 = mid; }
    const largeO = (oa2 - oa1) > 180 ? 1 : 0;
    const largeI = (ia2 - ia1) > 180 ? 1 : 0;
    const d = `M ${px(Rp, oa1)} ${py(Rp, oa1)} A ${Rp.toFixed(2)} ${Rp.toFixed(2)} 0 ${largeO} 1 ${px(Rp, oa2)} ${py(Rp, oa2)} L ${px(rp, ia2)} ${py(rp, ia2)} A ${rp.toFixed(2)} ${rp.toFixed(2)} 0 ${largeI} 0 ${px(rp, ia1)} ${py(rp, ia1)} Z`;
    // Outward explode vector for THIS wedge, exposed (in user units) as CSS
    // vars; only .is-exploded (hover/focus) actually applies the translate.
    const ex = (pop * Math.cos(rad(mid))).toFixed(2), ey = (pop * Math.sin(rad(mid))).toFixed(2);
    arcs += `<path ${attrs(seg, idx, p)} d="${d}" fill="${seg.color}" stroke="${seg.color}" stroke-width="${cr}" stroke-linejoin="round" style="--ex:${ex}px;--ey:${ey}px"/>`;
    cum += sweep;
  });
  return `<svg class="pie-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${arcs}</svg>`;
}
// Full pie+legend composition (chart on the left, a legend on the right),
// reusing the same .radial-bars-block/.donut-legend classes as the rings so
// both circular charts in Layout 2 share one visual language. Legend rows
// default to the segment's % share - the same convention as the Layout 1
// donut legends and the ring legend - and hover swaps in the $ value
// (wireChartHover). Pass opts.valueFormat for value-based legends (e.g. the
// Subscriptions "$X/month" breakdown).
function pieChartHtml(segments, opts) {
  opts = opts || {};
  const list = (segments || []).filter(s => (s.value || 0) > 0).slice(0, opts.limit || 6);
  if (!list.length) return '';
  // Give sub-4% segments a legible minimum sweep by shaving the excess off
  // the larger segments proportionally. Rounded caps otherwise collapse
  // tiny segments into overlapping dots at the ring joint. data-pct and the
  // legend keep the true share - only the drawn geometry is adjusted.
  const MIN_SHARE = 4;
  if (list.length > 1) {
    let deficit = 0, flexTotal = 0;
    list.forEach(s => { const p = s.pct || 0; if (p < MIN_SHARE) deficit += MIN_SHARE - p; else flexTotal += p - MIN_SHARE; });
    if (deficit > 0 && flexTotal > 0) {
      list.forEach(s => {
        const p = s.pct || 0;
        s.dispPct = p < MIN_SHARE ? MIN_SHARE : p - (p - MIN_SHARE) / flexTotal * deficit;
      });
    }
  }
  const valueFmt = opts.valueFormat;
  const legend = list.map((s, idx) => `
    <div class="dleg-row" data-idx="${idx}">
      <span class="dleg-swatch" style="background:${s.color}"></span>
      <span class="dleg-label">${esc(s.label || '')}</span>
      <span class="dleg-pct">${esc(valueFmt ? valueFmt(s.value || 0) : Math.round(s.pct || 0) + '%')}</span>
    </div>`).join('');
  // .pie-chart-block keeps the chart + legend side-by-side (legend to the
  // right) instead of the wrap-below behaviour of .radial-bars-block.
  return `<div class="pie-chart-block">${svgSegmentedPie(list, opts.size || 200)}<div class="donut-legend">${legend}</div></div>`;
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
  const vw = window.innerWidth;
  const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 48;
  // Centered above the cursor so the tip doesn't blanket the legend that
  // sits to the right of these charts; flip below only when out of room.
  const left = Math.max(8, Math.min(x - tw / 2, vw - tw - 8));
  let top = y - th - 14;
  if (top < 8) top = y + 18;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
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

// ── Dashboard entrance animation ────────────────────────────────────────
// Shared by both apps' renderDashboardLayout1/2(): a one-time "draw in"
// played whenever the dashboard is (re)rendered - navigating to the tab,
// switching layouts, dismissing the welcome card, etc. Purely additive to
// the final rendered DOM (every element ends at exactly the value/width/
// arc the template already computed) - this only ever touches transient
// inline style used to animate FROM, never anything that changes what's
// actually displayed once the animation settles, so it can't affect
// layout or functionality. Gated on both the user's "Dashboard animations"
// setting and prefers-reduced-motion; if either says no, every function
// below returns immediately and the dashboard renders exactly as it did
// before any of this existed.
function dashboardAnimsEnabled() {
  try {
    return (typeof state !== 'undefined') && state && state.settings &&
      state.settings.dashboardAnimations !== false &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}

// Guards every deferred (rAF-scheduled) step below against a second
// renderDashboardLayoutN() call landing before the first one's animation
// has finished settling - e.g. navigateTo() and an explicit switchBTab()
// both firing in the same tick re-render the SAME container twice in one
// frame. Without this, the second pass's "capture the target width/value"
// step would read back whatever the FIRST pass had just zeroed things out
// to, permanently freezing bars/arcs at 0. Tagging the container with a
// generation number lets a stale pass's deferred callback notice a newer
// one has since started and bail out instead of clobbering it.
let _dashAnimGenSeq = 0;
function markDashAnimGen(container) {
  const gen = ++_dashAnimGenSeq;
  container._dashAnimGen = gen;
  return () => container._dashAnimGen === gen;
}

// Staggered fade + rise for each card/row - the class itself is the
// "before" state (opacity:0, translateY), and adding .is-visible a frame
// later is what actually triggers the CSS transition defined on it.
function animateCardsIn(container, isCurrent) {
  if (!container) return;
  const sel = '.scard, .panel, .pro-stat, .icon-stat-tile, .alloc-card, .upcoming-item, .sf-snap-item, .chart-hero-panel, .flow-row, .dleg-row, .lf-chip';
  const els = Array.from(container.querySelectorAll(sel));
  if (!els.length) return;
  els.forEach((el, i) => { el.classList.add('dash-anim-in'); el.style.setProperty('--dash-anim-i', i); });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!isCurrent()) return;
    els.forEach(el => el.classList.add('is-visible'));
  }));
}

// Every entrance animation in this file shares one duration, so the whole
// dashboard feels like a single coordinated reveal rather than a mix of
// speeds.
const DASH_ANIM_DUR = 500;

// Bar fills (.flow-bar/.prog-bar/.alloc-strip) already transition `width`
// via existing CSS (now .5s, matching DASH_ANIM_DUR) - just replay that
// transition from 0 on mount instead of adding new CSS. Staggered per bar
// so a multi-row panel (Cash Flow, Sinking Funds) visibly cascades rather
// than every row snapping into place in one indistinguishable instant.
function animateBarsIn(container, isCurrent) {
  if (!container) return;
  const bars = Array.from(container.querySelectorAll('.flow-bar, .prog-bar, .alloc-strip'));
  if (!bars.length) return;
  // Cache each bar's true template-rendered width the first time ANY pass
  // touches it. If two renders of the same container overlap within one
  // frame (e.g. navigateTo() and an explicit switchBTab() both firing),
  // the second pass would otherwise read back the width the first pass
  // had just zeroed a moment ago and "restore" to 0% forever - reading
  // from this cache instead means only the true original value is ever
  // used, no matter how many passes touch the element.
  const targets = bars.map(b => {
    if (b.dataset.dashTarget === undefined) b.dataset.dashTarget = b.style.width;
    return b.dataset.dashTarget;
  });
  bars.forEach(b => { b.style.transition = 'none'; b.style.width = '0%'; });
  void container.offsetWidth; // force reflow so the 0% state actually paints
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!isCurrent()) return;
    bars.forEach((b, i) => {
      b.style.transitionDelay = Math.min(i * 45, 250) + 'ms';
      b.style.transition = '';
      b.style.width = targets[i];
    });
    setTimeout(() => { if (isCurrent()) bars.forEach(b => { b.style.transitionDelay = ''; }); }, bars.length * 45 + DASH_ANIM_DUR + 200);
  }));
}

// Grows one arc's visible stroke length from 0 up to its real dash value
// (dash+gap always kept equal to the ring's circumference, so the arc's
// rotation/position never moves - only how much of it is drawn does) via
// a manual rAF tween that rewrites the stroke-dasharray attribute every
// frame. This has to be driven in JS rather than a CSS transition:
// stroke-dasharray is a paired list, not a single length, and isn't
// reliably interpolated by a CSS `transition` the way stroke-dashoffset
// is. (An earlier version of this animated stroke-dashoffset instead,
// which seemed like the standard technique - but that only works when
// dasharray's period is DOUBLE the circumference; here dash+gap already
// equals the full circumference for every segment, so shifting the
// offset just relocates the same fixed-length visible arc around the
// ring instead of changing how much of it is drawn, which is why donuts
// weren't visibly animating at all.)
function tweenArcDash(arc, dashFinal, gapFinal, delayMs, durMs, isCurrent) {
  if (!dashFinal) return;
  const total = dashFinal + gapFinal;
  arc.setAttribute('stroke-dasharray', '0 ' + total.toFixed(2));
  let start = null;
  function tick(now) {
    if (isCurrent && !isCurrent()) return;
    if (start === null) start = now + delayMs;
    if (now < start) { requestAnimationFrame(tick); return; }
    const p = Math.min(1, (now - start) / durMs);
    const eased = 1 - Math.pow(1 - p, 3);
    const d = dashFinal * eased;
    arc.setAttribute('stroke-dasharray', d.toFixed(2) + ' ' + (total - d).toFixed(2));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function animateArcsIn(container, isCurrent) {
  if (!container) return;

  // Donut segments (.dseg): several segments share ONE ring and together
  // sum to it - sequencing each segment's own slice of the shared
  // duration, back to back in drawing order, makes the whole ring look
  // like it's being traced in one continuous sweep instead of every
  // wedge popping in from its own 0 all at once.
  const rings = new Map();
  Array.from(container.querySelectorAll('.dseg')).forEach(arc => {
    const svg = arc.closest('svg');
    if (!rings.has(svg)) rings.set(svg, []);
    rings.get(svg).push(arc);
  });
  rings.forEach(segs => {
    const parsed = segs.map(arc => {
      const p = (arc.getAttribute('stroke-dasharray') || '0 0').split(/[ ,]/).map(parseFloat);
      return { arc, dash: p[0] || 0, gap: p[1] || 0 };
    });
    const totalDash = parsed.reduce((s, x) => s + x.dash, 0) || 1;
    let cum = 0;
    parsed.forEach(({ arc, dash, gap }) => {
      const delay = (cum / totalDash) * DASH_ANIM_DUR;
      tweenArcDash(arc, dash, gap, delay, Math.max(30, (dash / totalDash) * DASH_ANIM_DUR), isCurrent);
      cum += dash;
    });
  });

  // Semi-gauge (.gauge-arc): always a single arc - just grows in place.
  Array.from(container.querySelectorAll('.gauge-arc')).forEach(arc => {
    const p = (arc.getAttribute('stroke-dasharray') || '0 0').split(/[ ,]/).map(parseFloat);
    tweenArcDash(arc, p[0] || 0, p[1] || 0, 0, DASH_ANIM_DUR, isCurrent);
  });

  // Radial-bar rings (.rbar-seg): each is its OWN independent concentric
  // ring (a different category), not slices of one ring - grow together
  // with only a light stagger for a cascading-but-still-prompt reveal.
  Array.from(container.querySelectorAll('.rbar-seg')).forEach((arc, i) => {
    const p = (arc.getAttribute('stroke-dasharray') || '0 0').split(/[ ,]/).map(parseFloat);
    tweenArcDash(arc, p[0] || 0, p[1] || 0, i * 70, DASH_ANIM_DUR, isCurrent);
  });
}

// Pie wedges (.pie-seg) are filled paths, not simple stroked circles, so
// the arc-growth trick above doesn't read as a meaningful reveal on them -
// a staggered fade reads cleanly instead. The class's own opacity
// transition (.18s, tuned for the snappy hover dim/highlight) is too
// quick to read as a deliberate entrance, so this gives it a temporary
// inline override at the shared DASH_ANIM_DUR instead, restoring the
// original fast transition once the entrance has finished so hover still
// feels instant afterward.
function animatePieIn(container, isCurrent) {
  if (!container) return;
  const segs = Array.from(container.querySelectorAll('.pie-seg'));
  if (!segs.length) return;
  segs.forEach((seg, i) => {
    seg.style.transition = `opacity ${DASH_ANIM_DUR}ms var(--ease)`;
    seg.style.transitionDelay = (i * 50) + 'ms';
    seg.style.opacity = '0';
  });
  void container.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!isCurrent()) return;
    segs.forEach(seg => { seg.style.opacity = '1'; });
    // Hand opacity's transition back to the CSS class (its fast .18s hover
    // dim/highlight) once the entrance fade itself has finished.
    setTimeout(() => { if (isCurrent()) segs.forEach(seg => { seg.style.transition = ''; seg.style.transitionDelay = ''; }); }, segs.length * 50 + DASH_ANIM_DUR + 100);
  }));
}

// Counts a single numeric text value up from 0 (or from its own negative
// magnitude) to the real target, re-formatting through the SAME formatter
// the caller already used for the final string - so the animation can
// never drift from, or briefly show different rounding/formatting than,
// what the template already rendered.
function animateCountUp(el, target, render, dur, isCurrent) {
  if (!el || typeof target !== 'number' || !isFinite(target)) return;
  dur = dur || DASH_ANIM_DUR;
  const startTime = performance.now();
  function tick(now) {
    if (isCurrent && !isCurrent()) return; // a newer render has since taken over this element
    const p = Math.min(1, (now - startTime) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = render(target * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = render(target); // exact final value, no float drift
  }
  requestAnimationFrame(tick);
}

// Single entry point each renderDashboardLayoutN() calls once, right
// alongside its existing initDonuts()/wireChartHover() wiring. `countUps`
// is an optional array of {el, target, render} for the handful of
// headline numbers worth counting up (stat cards, Net Leftover) - every
// other value on the dashboard just rides its parent card's fade-in.
function animateDashboardEntrance(container, countUps) {
  if (!dashboardAnimsEnabled()) return;
  const isCurrent = markDashAnimGen(container);
  animateCardsIn(container, isCurrent);
  animateBarsIn(container, isCurrent);
  animateArcsIn(container, isCurrent);
  animatePieIn(container, isCurrent);
  (countUps || []).forEach(c => { if (c && c.el) animateCountUp(c.el, c.target, c.render || fmt, undefined, isCurrent); });
}

