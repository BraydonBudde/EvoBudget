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

// ── Semi-circle gauge (single KPI, 0-100%) ─────────────────────────────
function svgSemiGauge(pct, size = 160, color = '#6366f1') {
  const w = size, h = size * 0.62, sw = size * 0.11, cx = w / 2, cy = h - sw / 2, r = w / 2 - sw / 2 - 2;
  const p = Math.max(0, Math.min(100, pct || 0));
  const a0 = polar(cx, cy, r, -90), a1 = polar(cx, cy, r, 90);
  const bg = `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${a1.x.toFixed(2)} ${a1.y.toFixed(2)}`;
  const angle = -90 + (p / 100) * 180;
  const ap = polar(cx, cy, r, angle);
  const large = p > 50 ? 1 : 0;
  const fg = `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ap.x.toFixed(2)} ${ap.y.toFixed(2)}`;
  return `<svg class="gauge-svg" width="${w}" height="${h + 4}" viewBox="0 0 ${w} ${h + 4}" style="overflow:visible">
    <path d="${bg}" fill="none" stroke="rgba(30,27,46,.08)" stroke-width="${sw}" stroke-linecap="round"/>
    <path class="gauge-arc" d="${fg}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
      style="transition:stroke-dashoffset .3s"/>
    <text x="${cx}" y="${cy - h * 0.10}" text-anchor="middle" style="font-family:Sora,sans-serif;font-weight:800;font-size:${(size * .16).toFixed(0)}px;fill:var(--text-primary)">${Math.round(p)}%</text>
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
    const dash = Math.min(100, pct) / 100 * c, gapLen = c - dash;
    const over = ring.expected > 0 && ring.value > ring.expected;
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(30,27,46,.07)" stroke-width="${sw}"/>
      <circle class="rbar-seg" data-idx="${idx}" data-label="${esc(ring.label || '')}" data-val="${ring.value || 0}" data-pct="${pct.toFixed(0)}"
        cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${over ? '#f43f5e' : ring.color}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(2)} ${gapLen.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"
        tabindex="0" role="img" aria-label="${esc(ring.label || '')}: ${pct.toFixed(0)}%"
        style="cursor:pointer;transition:opacity .18s"/>`;
  });
  return `<svg class="radial-bars-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${out}</svg>`;
}

// ── Radar chart: two overlaid series (Expected vs Actual) across N axes ─
function svgRadar(axes, seriesA, seriesB, size = 260) {
  const n = axes.length;
  if (n < 3) return `<svg width="${size}" height="${size}"></svg>`;
  const cx = size / 2, cy = size / 2 - 6, r = size / 2 - 40;
  const max = Math.max(1, ...seriesA, ...seriesB) * 1.15;
  const rings = [0.25, 0.5, 0.75, 1].map(f => {
    const pts = axes.map((_, i) => polar(cx, cy, r * f, i * 360 / n));
    return `<polygon points="${pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}" fill="none" stroke="rgba(30,27,46,.10)" stroke-width="1"/>`;
  }).join('');
  const spokes = axes.map((ax, i) => {
    const p = polar(cx, cy, r, i * 360 / n);
    const lp = polar(cx, cy, r + 18, i * 360 / n);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="rgba(30,27,46,.10)" stroke-width="1"/>
      <text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" style="font-size:11px;fill:var(--text-secondary);font-weight:600">${esc(ax.label)}</text>`;
  }).join('');
  const poly = (series, color, fillOpacity) => {
    const pts = series.map((v, i) => polar(cx, cy, r * Math.min(1, v / max), i * 360 / n));
    const dots = pts.map((p, i) => `<circle class="radar-pt" data-idx="${i}" data-series="${color}" data-label="${esc(axes[i].label)}" data-val="${series[i]}"
      cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}" stroke="var(--surface-solid)" stroke-width="1.5"
      style="cursor:pointer;transition:r .15s"/>`).join('');
    return `<polygon points="${pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="2"/>${dots}`;
  };
  return `<svg class="radar-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">
    ${rings}${spokes}
    ${poly(seriesA, '#9ca3af', 0.10)}
    ${poly(seriesB, '#6366f1', 0.22)}
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

// ── Bubble chart: caller supplies pre-scaled cx/cy/r ────────────────────
function svgBubbles(points, w = 320, h = 200) {
  if (!points.length) return `<svg width="${w}" height="${h}"></svg>`;
  const marks = points.map((p, idx) => `<circle class="bubble-mark" data-idx="${idx}" data-label="${esc(p.label || '')}" data-val="${p.value || 0}"
    cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${p.color}" fill-opacity="0.75" stroke="${p.color}" stroke-width="1.5"
    tabindex="0" role="img" aria-label="${esc(p.label || '')}: ${esc(fmt(p.value || 0))}"
    style="cursor:pointer;transition:opacity .18s,r .18s"/>`).join('');
  const labels = points.map(p => p.r > 20 ? `<text x="${p.cx.toFixed(1)}" y="${p.cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
    pointer-events="none" style="font-size:10px;font-weight:700;fill:#fff">${esc((p.label || '').slice(0, 10))}</text>` : '').join('');
  return `<svg class="bubble-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">${marks}${labels}</svg>`;
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

// ── Hexagonal grid: honeycomb heatmap, fill intensity = value ──────────
function svgHexGrid(cells, size = 260) {
  const n = cells.length;
  if (!n) return `<svg width="${size}" height="${size}"></svg>`;
  const cols = Math.min(4, Math.ceil(Math.sqrt(n * 1.4)));
  const hexR = Math.min(38, (size / cols) / 1.9);
  const hexW = hexR * Math.sqrt(3), hexH = hexR * 2;
  const rows = Math.ceil(n / cols);
  const w = cols * hexW + hexW / 2 + 8, h = rows * hexH * 0.75 + hexH * 0.5 + 8;
  const max = Math.max(1, ...cells.map(c => c.value));
  const hexPoints = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (60 * i - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  let out = '';
  cells.forEach((cell, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols);
    const cx = hexW / 2 + col * hexW + (row % 2 ? hexW / 2 : 0) + 4;
    const cy = hexH * 0.5 + row * hexH * 0.75 + 4;
    const intensity = 0.22 + 0.72 * ((cell.value || 0) / max);
    out += `<polygon class="hex-cell" data-idx="${idx}" data-label="${esc(cell.label || '')}" data-val="${cell.value || 0}"
      points="${hexPoints(cx, cy, hexR - 2)}" fill="${cell.color}" fill-opacity="${intensity.toFixed(2)}" stroke="${cell.color}" stroke-width="1.5"
      tabindex="0" role="img" aria-label="${esc(cell.label || '')}: ${esc(fmt(cell.value || 0))}"
      style="cursor:pointer;transition:fill-opacity .18s,opacity .18s"/>
      <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none"
        style="font-size:9.5px;font-weight:700;fill:var(--text-primary)">${esc((cell.label || '').slice(0, 8))}</text>`;
  });
  return `<svg class="hexgrid-svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" style="overflow:visible">${out}</svg>`;
}

// ── Density plot: smoothed distribution of transaction amounts ─────────
function svgDensityPlot(values, w = 420, h = 140, color = '#6366f1') {
  const nums = (values || []).filter(v => v > 0);
  if (nums.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const max = Math.max(...nums), bins = 14;
  const counts = Array.from({ length: bins }, () => 0);
  nums.forEach(v => { const b = Math.min(bins - 1, Math.floor((v / max) * bins)); counts[b]++; });
  const maxCount = Math.max(1, ...counts);
  const pad = 6;
  const xAt = i => pad + (i / (bins - 1)) * (w - pad * 2);
  const yAt = c => h - pad - (c / maxCount) * (h - pad * 2 - 18);
  const pts = counts.map((c, i) => ({ x: xAt(i), y: yAt(c) }));
  let d = `M ${pts[0].x.toFixed(1)} ${(h - pad).toFixed(1)} L ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], mx = (p0.x + p1.x) / 2;
    d += ` C ${mx.toFixed(1)} ${p0.y.toFixed(1)}, ${mx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  d += ` L ${pts[pts.length - 1].x.toFixed(1)} ${(h - pad).toFixed(1)} Z`;
  const gid = 'dp' + Math.random().toString(36).slice(2, 8);
  const marks = counts.map((c, i) => `<rect class="density-bin" data-idx="${i}" data-label="${esc(fmt(i / bins * max))} - ${esc(fmt((i + 1) / bins * max))}" data-val="${c}"
    x="${(xAt(i) - (w - pad * 2) / bins / 2).toFixed(1)}" y="${pad}" width="${((w - pad * 2) / bins).toFixed(1)}" height="${(h - pad * 2)}" fill="transparent"
    tabindex="0" role="img" aria-label="${c} transactions" style="cursor:pointer"/>`).join('');
  return `<svg class="density-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.4"/><stop offset="100%" stop-color="${color}" stop-opacity="0.03"/>
    </linearGradient></defs>
    <path d="${d}" fill="url(#${gid})" stroke="${color}" stroke-width="2"/>
    ${marks}
  </svg>`;
}

// ── Plain pie chart (true wedges, no donut hole) ────────────────────────
function svgPie(segments, size = 150) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  if (!segments || !segments.length) return `<svg width="${size}" height="${size}"></svg>`;
  let out = '', cum = 0;
  segments.forEach((seg, idx) => {
    const p = seg.pct || 0; if (p <= 0) { return; }
    const a0 = cum / 100 * 360, a1 = (cum + p) / 100 * 360;
    const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    const large = (a1 - a0) > 180 ? 1 : 0;
    out += `<path class="pie-seg" data-idx="${idx}" data-label="${esc(seg.label || '')}" data-val="${seg.value || 0}" data-pct="${p.toFixed(1)}"
      d="M ${cx} ${cy} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z"
      fill="${seg.color}" stroke="var(--surface-solid)" stroke-width="1.5"
      tabindex="0" role="img" aria-label="${esc(seg.label || '')}: ${p.toFixed(0)}%"
      style="cursor:pointer;transition:opacity .18s,transform .18s;transform-origin:${cx}px ${cy}px"/>`;
    cum += p;
  });
  return `<svg class="pie-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">${out}</svg>`;
}

// ── Icon-forward stat tile (markup helper, not SVG) ─────────────────────
function iconStatTile(icon, label, value, sub, color) {
  return `<div class="icon-stat-tile">
    <div class="ist-icon" style="background:${color}22;color:${color}">${icon}</div>
    <div class="ist-body">
      <div class="ist-label">${esc(label)}</div>
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
      const amtEl = row.querySelector('.dleg-pct');
      if (amtEl) { if (amtEl.dataset.origText === undefined) amtEl.dataset.origText = amtEl.textContent; amtEl.textContent = fmt(parseFloat(mark.dataset.val) || 0); }
    }
    tip.innerHTML = fmtTip(mark.dataset);
    tip.style.opacity = '1';
    positionChartTooltip(tip, evt);
  };
  const hide = () => {
    marks.forEach(m => { m.style.opacity = '1'; if (opts.highlightClass) m.classList.remove(opts.highlightClass); });
    legend.forEach(row => {
      row.classList.remove('is-active');
      const amtEl = row.querySelector('.dleg-pct');
      if (amtEl && amtEl.dataset.origText !== undefined) amtEl.textContent = amtEl.dataset.origText;
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
