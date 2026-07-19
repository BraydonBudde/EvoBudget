// ══════════════════════════════════════════════════════════════════════
// Shared chart primitives for the alternate Dashboard Layouts (2-5).
// Loaded by both index.html (SBP) and ultimate-budget.html (UBP), same
// pattern as sync.js. Pure inline-SVG builders, no external libraries -
// mirrors the existing svgDonut()/initDonuts() pattern defined in each
// app's own script (esc/fmt/t are available by the time these run).
// ══════════════════════════════════════════════════════════════════════

function polar(cx, cy, r, angleDeg) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// Builds a closed SVG path string for a polygon with slightly rounded
// corners (each vertex replaced by a quadratic curve using the original
// vertex as control point), matching the app's rounded-corner aesthetic
// instead of a sharp-cornered <polygon>.
function roundedPolygonPath(pts, frac = 0.14) {
  const n = pts.length;
  if (n < 3) return '';
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
    const p1 = { x: curr.x + (prev.x - curr.x) * frac, y: curr.y + (prev.y - curr.y) * frac };
    const p2 = { x: curr.x + (next.x - curr.x) * frac, y: curr.y + (next.y - curr.y) * frac };
    d += (i === 0 ? `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ` : `L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} `);
    d += `Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} `;
  }
  return d + 'Z';
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

// ── Radar chart: two overlaid series (Expected vs Actual) across N axes ─
function svgRadar(axes, seriesA, seriesB, size = 340) {
  const n = axes.length;
  if (n < 3) return `<svg width="${size}" height="${size}"></svg>`;
  const gid = 'rg' + Math.random().toString(36).slice(2, 8);
  const labelPad = Math.max(26, size * 0.09);
  const cx = size / 2, cy = size / 2 - 4, r = size / 2 - labelPad;
  const fontSize = Math.max(11, Math.round(size * 0.038));
  const max = Math.max(1, ...seriesA, ...seriesB) * 1.15;
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map((f, i) => {
    const pts = axes.map((_, k) => polar(cx, cy, r * f, k * 360 / n));
    const path = roundedPolygonPath(pts, 0.1);
    return i === 4
      ? `<path d="${path}" fill="url(#${gid}bg)" stroke="var(--text-faint)" stroke-opacity="0.35" stroke-width="1" stroke-linejoin="round"/>`
      : `<path d="${path}" fill="none" stroke="var(--text-faint)" stroke-opacity="0.22" stroke-width="1" stroke-linejoin="round"/>`;
  }).join('');
  const spokes = axes.map((ax, i) => {
    const p = polar(cx, cy, r, i * 360 / n);
    const lp = polar(cx, cy, r + labelPad * 0.72, i * 360 / n);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--text-faint)" stroke-opacity="0.22" stroke-width="1"/>
      <text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" style="font-size:${fontSize}px;fill:var(--text-secondary);font-weight:700">${esc(ax.label)}</text>`;
  }).join('');
  const poly = (series, color, fillOpacity, dotR, useGradientFill) => {
    const pts = series.map((v, i) => polar(cx, cy, r * Math.min(1, v / max), i * 360 / n));
    const dots = pts.map((p, i) => `<circle class="radar-pt" data-idx="${i}" data-series="${color}" data-label="${esc(axes[i].label)}" data-val="${series[i]}"
      cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotR}" fill="${color}" stroke="var(--surface-solid)" stroke-width="2"
      style="cursor:pointer;transition:r .15s;filter:drop-shadow(0 1px 3px rgba(0,0,0,.25))"/>`).join('');
    const fill = useGradientFill ? `url(#${gid}fill)` : color;
    return `<path d="${roundedPolygonPath(pts, 0.14)}" fill="${fill}" fill-opacity="${fillOpacity}"
      stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
  };
  return `<svg class="radar-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">
    <defs>
      <radialGradient id="${gid}bg" cx="50%" cy="45%" r="65%">
        <stop offset="0%" stop-color="var(--text-faint)" stop-opacity="0.07"/>
        <stop offset="100%" stop-color="var(--text-faint)" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${gid}fill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#818cf8"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
    </defs>
    ${rings}${spokes}
    ${poly(seriesA, '#9ca3af', 0.08, 3.5, false)}
    ${poly(seriesB, '#6366f1', 0.28, 5, true)}
  </svg>`;
}

// ── Nightingale / polar-area chart: petal radius = value ───────────────
function svgNightingale(segments, size = 220) {
  const n = segments.length;
  if (!n) return `<svg width="${size}" height="${size}"></svg>`;
  const cx = size / 2, cy = size / 2, rMax = size / 2 - 12;
  const max = Math.max(1, ...segments.map(s => s.value));
  const sweep = 360 / n;
  let out = '';
  segments.forEach((seg, idx) => {
    const r = Math.max(rMax * 0.14, rMax * Math.sqrt((seg.value || 0) / max));
    const a0 = idx * sweep, a1 = (idx + 1) * sweep - Math.min(3, sweep * 0.08);
    const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    const large = (a1 - a0) > 180 ? 1 : 0;
    out += `<path class="nightingale-seg" data-idx="${idx}" data-label="${esc(seg.label || '')}" data-val="${seg.value || 0}"
      d="M ${cx} ${cy} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z"
      fill="${seg.color}" fill-opacity="0.88" stroke="var(--surface-solid)" stroke-width="1.5"
      tabindex="0" role="img" aria-label="${esc(seg.label || '')}: ${esc(fmt(seg.value || 0))}"
      style="cursor:pointer;transition:opacity .18s,fill-opacity .18s"/>`;
  });
  return `<svg class="nightingale-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${out}</svg>`;
}

// ── Area / spline chart over a period (cumulative cash flow) ───────────
function svgAreaSpline(points, w = 480, h = 160, color = '#6366f1') {
  if (points.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const pad = 8;
  const vals = points.map(p => p.value);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals, 1);
  const xAt = i => pad + (i / (points.length - 1)) * (w - pad * 2);
  const yAt = v => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value), ...p }));
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const p0 = coords[i - 1], p1 = coords[i];
    const mx = (p0.x + p1.x) / 2;
    d += ` C ${mx.toFixed(1)} ${p0.y.toFixed(1)}, ${mx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  const zeroY = yAt(0).toFixed(1);
  const area = `${d} L ${coords[coords.length - 1].x.toFixed(1)} ${zeroY} L ${coords[0].x.toFixed(1)} ${zeroY} Z`;
  const dots = coords.map((p, i) => `<circle class="spline-dot" data-idx="${i}" data-label="${esc(p.label || '')}" data-val="${p.value}"
    cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}" opacity="0" style="transition:opacity .12s"/>`).join('');
  const gid = 'ag' + Math.random().toString(36).slice(2, 8);
  return `<svg class="spline-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-min="${min}" data-max="${max}" data-pad="${pad}" style="overflow:visible">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(30,27,46,.12)" stroke-width="1" stroke-dasharray="3 3"/>
    <path d="${area}" fill="url(#${gid})" stroke="none"/>
    <path class="spline-path" d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    ${dots}
    <circle class="spline-cursor" cx="0" cy="0" r="4.5" fill="${color}" stroke="var(--surface-solid)" stroke-width="2" opacity="0" pointer-events="none"/>
  </svg>`;
}

// ── Stacked columns: composition comparison (e.g. Expected vs Actual) ──
function svgStackedColumns(columns, w = 220, h = 200) {
  if (!columns.length) return `<svg width="${w}" height="${h}"></svg>`;
  const pad = 26, colGap = 34, colW = Math.min(56, (w - pad * 2 - colGap * (columns.length - 1)) / columns.length);
  const totals = columns.map(c => c.segments.reduce((t, s) => t + (s.value || 0), 0));
  const max = Math.max(1, ...totals);
  const usableH = h - 30;
  let out = '';
  const groupW = columns.length * colW + (columns.length - 1) * colGap;
  const startX = (w - groupW) / 2;
  columns.forEach((col, ci) => {
    const x = startX + ci * (colW + colGap);
    let y = h - 20;
    col.segments.forEach((seg, si) => {
      const segH = (seg.value || 0) / max * usableH;
      if (segH <= 0) return;
      y -= segH;
      out += `<rect class="stackcol-seg" data-idx="${ci}-${si}" data-label="${esc(seg.label || '')}" data-val="${seg.value || 0}" data-col="${esc(col.label)}"
        x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${colW}" height="${segH.toFixed(1)}" fill="${seg.color}"
        tabindex="0" role="img" aria-label="${esc(col.label)} ${esc(seg.label || '')}: ${esc(fmt(seg.value || 0))}"
        style="cursor:pointer;transition:opacity .18s" rx="2"/>`;
    });
    out += `<text x="${(x + colW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" style="font-size:11px;font-weight:700;fill:var(--text-secondary)">${esc(col.label)}</text>
      <text x="${(x + colW / 2).toFixed(1)}" y="${(h - 20 - usableH * (totals[ci] / max) - 6).toFixed(1)}" text-anchor="middle" style="font-size:10.5px;font-weight:700;fill:var(--text-primary)">${esc(fmt(totals[ci]))}</text>`;
  });
  return `<svg class="stackcol-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">${out}</svg>`;
}

// ── Range bar: horizontal min→max track with an optional marker ────────
function svgRangeBar(ranges, w = 320) {
  const rowH = 30, h = ranges.length * rowH + 6;
  const max = Math.max(1, ...ranges.map(r => Math.max(r.max, r.marker || 0)));
  const trackX = 4, trackW = w - 8;
  let out = '';
  ranges.forEach((r, idx) => {
    const y = idx * rowH + 12;
    const x0 = trackX + (r.min / max) * trackW, x1 = trackX + (r.max / max) * trackW;
    const mx = r.marker != null ? trackX + Math.min(r.marker, max) / max * trackW : null;
    const over = r.marker != null && r.marker > r.max;
    out += `<rect x="${trackX}" y="${(y - 4).toFixed(1)}" width="${trackW}" height="8" rx="4" fill="rgba(30,27,46,.07)"/>
      <rect class="rangebar-fill" data-idx="${idx}" data-label="${esc(r.label || '')}" data-val="${r.marker != null ? r.marker : r.max}"
        x="${x0.toFixed(1)}" y="${(y - 4).toFixed(1)}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="8" rx="4" fill="${over ? '#f43f5e' : r.color}"
        tabindex="0" role="img" aria-label="${esc(r.label || '')}" style="cursor:pointer;transition:opacity .18s"/>
      ${mx != null ? `<circle cx="${mx.toFixed(1)}" cy="${y - 0.5}" r="5" fill="${over ? '#f43f5e' : r.color}" stroke="var(--surface-solid)" stroke-width="1.5"/>` : ''}
      <text x="${trackX}" y="${(y - 10).toFixed(1)}" style="font-size:10.5px;font-weight:600;fill:var(--text-secondary)">${esc(r.label || '')}</text>`;
  });
  return `<svg class="rangebar-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">${out}</svg>`;
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

// ── Nearest-point hover for continuous charts (area/spline) ────────────
function wireSplineHover(svg, points) {
  if (!svg || !points || points.length < 2) return;
  const path = svg.querySelector('.spline-path');
  const cursor = svg.querySelector('.spline-cursor');
  const dots = Array.from(svg.querySelectorAll('.spline-dot'));
  if (!path || !cursor) return;
  const tip = ensureChartTooltip();
  const pad = parseFloat(svg.dataset.pad || 8);
  const vb = svg.viewBox.baseVal;
  const nearest = (svgX) => {
    const frac = (svgX - pad) / (vb.width - pad * 2);
    return Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1))));
  };
  const svgPoint = (evt) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = vb.width / rect.width;
    return (evt.clientX - rect.left) * scaleX;
  };
  const move = (evt) => {
    const idx = nearest(svgPoint(evt));
    const dot = dots[idx];
    if (!dot) return;
    cursor.setAttribute('cx', dot.getAttribute('cx'));
    cursor.setAttribute('cy', dot.getAttribute('cy'));
    cursor.style.opacity = '1';
    tip.innerHTML = `<strong>${esc(points[idx].label || '')}</strong><br>${esc(fmt(points[idx].value))}`;
    tip.style.opacity = '1';
    positionChartTooltip(tip, evt);
  };
  const leave = () => { cursor.style.opacity = '0'; tip.style.opacity = '0'; };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', leave);
  svg.addEventListener('touchstart', e => { e.preventDefault(); move(e.touches[0]); }, { passive: false });
  svg.addEventListener('touchend', () => setTimeout(leave, 1600));
}
