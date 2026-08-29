// ══════════════════════════════════════════════════════════════════════
// Live visitor globe (admin dashboard)
// ══════════════════════════════════════════════════════════════════════
// A rotatable sphere with a point per visitor currently online. Drawn on a
// plain canvas with an orthographic projection rather than a 3D library:
// the whole site is dependency-free static files, and a globe this simple
// (sphere + graticule + dots) doesn't justify pulling in WebGL.
//
// Location comes from the visitor's IANA timezone, which analytics already
// collects - no IP lookup, no third-party geo service, nothing new sent
// anywhere. That means points are city-accurate at best and deliberately
// approximate, which is the right resolution for "someone in Poland is
// online" anyway.

// Approximate lat/lon per timezone. Covers the timezones real traffic
// actually lands in; anything unknown is skipped rather than guessed, so a
// missing zone shows no dot instead of a wrong one.
const GLOBE_TZ_COORDS = {
  'Europe/London': [51.5, -0.1], 'Europe/Dublin': [53.3, -6.3], 'Europe/Lisbon': [38.7, -9.1],
  'Europe/Madrid': [40.4, -3.7], 'Europe/Paris': [48.9, 2.4], 'Europe/Brussels': [50.8, 4.4],
  'Europe/Amsterdam': [52.4, 4.9], 'Europe/Berlin': [52.5, 13.4], 'Europe/Zurich': [47.4, 8.5],
  'Europe/Rome': [41.9, 12.5], 'Europe/Vienna': [48.2, 16.4], 'Europe/Prague': [50.1, 14.4],
  'Europe/Warsaw': [52.2, 21.0], 'Europe/Budapest': [47.5, 19.0], 'Europe/Stockholm': [59.3, 18.1],
  'Europe/Oslo': [59.9, 10.8], 'Europe/Copenhagen': [55.7, 12.6], 'Europe/Helsinki': [60.2, 24.9],
  'Europe/Athens': [38.0, 23.7], 'Europe/Bucharest': [44.4, 26.1], 'Europe/Sofia': [42.7, 23.3],
  'Europe/Kyiv': [50.5, 30.5], 'Europe/Kiev': [50.5, 30.5], 'Europe/Moscow': [55.8, 37.6],
  'Europe/Istanbul': [41.0, 29.0], 'Europe/Belgrade': [44.8, 20.5], 'Europe/Zagreb': [45.8, 16.0],
  'Europe/Bratislava': [48.1, 17.1], 'Europe/Ljubljana': [46.1, 14.5], 'Europe/Vilnius': [54.7, 25.3],
  'Europe/Riga': [56.9, 24.1], 'Europe/Tallinn': [59.4, 24.8], 'Atlantic/Reykjavik': [64.1, -21.9],
  'America/New_York': [40.7, -74.0], 'America/Toronto': [43.7, -79.4], 'America/Detroit': [42.3, -83.0],
  'America/Chicago': [41.9, -87.6], 'America/Winnipeg': [49.9, -97.1], 'America/Denver': [39.7, -105.0],
  'America/Edmonton': [53.5, -113.5], 'America/Phoenix': [33.4, -112.1], 'America/Los_Angeles': [34.1, -118.2],
  'America/Vancouver': [49.3, -123.1], 'America/Anchorage': [61.2, -149.9], 'Pacific/Honolulu': [21.3, -157.9],
  'America/Mexico_City': [19.4, -99.1], 'America/Bogota': [4.7, -74.1], 'America/Lima': [-12.0, -77.0],
  'America/Santiago': [-33.4, -70.7], 'America/Buenos_Aires': [-34.6, -58.4],
  'America/Argentina/Buenos_Aires': [-34.6, -58.4], 'America/Sao_Paulo': [-23.5, -46.6],
  'America/Halifax': [44.6, -63.6], 'America/St_Johns': [47.6, -52.7], 'America/Panama': [9.0, -79.5],
  'America/Costa_Rica': [9.9, -84.1], 'America/Guatemala': [14.6, -90.5], 'America/Havana': [23.1, -82.4],
  'Asia/Jerusalem': [31.8, 35.2], 'Asia/Dubai': [25.2, 55.3], 'Asia/Riyadh': [24.7, 46.7],
  'Asia/Tehran': [35.7, 51.4], 'Asia/Karachi': [24.9, 67.0], 'Asia/Kolkata': [22.6, 88.4],
  'Asia/Calcutta': [22.6, 88.4], 'Asia/Colombo': [6.9, 79.9], 'Asia/Dhaka': [23.8, 90.4],
  'Asia/Bangkok': [13.8, 100.5], 'Asia/Jakarta': [-6.2, 106.8], 'Asia/Singapore': [1.35, 103.8],
  'Asia/Kuala_Lumpur': [3.1, 101.7], 'Asia/Manila': [14.6, 121.0], 'Asia/Hong_Kong': [22.3, 114.2],
  'Asia/Shanghai': [31.2, 121.5], 'Asia/Taipei': [25.0, 121.6], 'Asia/Seoul': [37.6, 127.0],
  'Asia/Tokyo': [35.7, 139.7], 'Asia/Kathmandu': [27.7, 85.3], 'Asia/Yangon': [16.9, 96.2],
  'Asia/Ho_Chi_Minh': [10.8, 106.7], 'Asia/Saigon': [10.8, 106.7], 'Asia/Baku': [40.4, 49.9],
  'Asia/Tbilisi': [41.7, 44.8], 'Asia/Yerevan': [40.2, 44.5], 'Asia/Almaty': [43.2, 76.9],
  'Asia/Tashkent': [41.3, 69.2],
  'Africa/Cairo': [30.0, 31.2], 'Africa/Lagos': [6.5, 3.4], 'Africa/Nairobi': [-1.3, 36.8],
  'Africa/Johannesburg': [-26.2, 28.0], 'Africa/Cape_Town': [-33.9, 18.4], 'Africa/Casablanca': [33.6, -7.6],
  'Africa/Accra': [5.6, -0.2], 'Africa/Tunis': [36.8, 10.2], 'Africa/Algiers': [36.8, 3.1],
  'Africa/Addis_Ababa': [9.0, 38.7],
  'Australia/Sydney': [-33.9, 151.2], 'Australia/Melbourne': [-37.8, 145.0], 'Australia/Brisbane': [-27.5, 153.0],
  'Australia/Perth': [-31.95, 115.9], 'Australia/Adelaide': [-34.9, 138.6], 'Australia/Darwin': [-12.5, 130.8],
  'Pacific/Auckland': [-36.9, 174.8], 'Pacific/Fiji': [-18.1, 178.4], 'Pacific/Guam': [13.4, 144.8],
};

// Rough continent outlines as lat/lon polylines. Enough to make the sphere
// read as Earth and let someone place a dot; not a real basemap, which
// would mean shipping a large GeoJSON for no analytical gain.
const GLOBE_LAND = [
  // North America
  [[70,-165],[70,-140],[60,-140],[55,-130],[48,-125],[38,-123],[32,-117],[23,-110],[20,-105],[16,-95],[18,-88],[21,-87],[25,-97],[29,-94],[30,-89],[29,-82],[25,-80],[32,-81],[36,-76],[41,-74],[45,-67],[47,-60],[52,-56],[60,-64],[63,-78],[68,-83],[70,-95],[71,-125],[70,-165]],
  // South America
  [[12,-72],[10,-64],[5,-52],[-1,-50],[-8,-35],[-13,-38],[-23,-43],[-33,-53],[-38,-58],[-50,-68],[-55,-68],[-50,-75],[-40,-74],[-30,-71],[-18,-70],[-5,-81],[2,-79],[8,-77],[12,-72]],
  // Europe + Africa + western Asia
  [[71,26],[70,18],[63,5],[58,8],[54,8],[53,4],[51,2],[48,-2],[43,-2],[43,-9],[38,-9],[36,-6],[37,0],[41,3],[43,7],[44,12],[40,18],[38,16],[41,16],[42,19],[40,24],[41,29],[43,35],[45,38],[47,38],[46,31],[46,30],[48,31],[52,32],[56,29],[59,28],[60,25],[63,21],[66,24],[69,21],[71,26]],
  [[36,-6],[32,-9],[27,-13],[21,-17],[15,-17],[10,-15],[5,-9],[5,-3],[6,3],[4,9],[0,9],[-5,12],[-12,13],[-18,12],[-23,15],[-29,17],[-34,18],[-34,25],[-30,31],[-24,35],[-18,37],[-12,40],[-5,39],[0,42],[6,49],[11,51],[12,44],[15,40],[20,37],[24,35],[27,34],[31,32],[33,35],[36,36],[36,30],[37,27],[36,-6]],
  // Asia
  [[70,60],[68,75],[73,80],[75,100],[72,110],[70,130],[70,160],[66,170],[62,163],[60,155],[54,140],[46,141],[43,132],[39,127],[37,126],[31,122],[23,117],[22,110],[18,109],[10,105],[8,100],[13,98],[16,94],[21,89],[22,91],[20,86],[16,81],[8,77],[15,74],[21,70],[25,66],[25,57],[27,57],[30,48],[29,48],[26,51],[24,54],[22,59],[25,62],[29,66],[33,71],[36,72],[38,68],[40,63],[45,52],[47,52],[50,50],[52,52],[55,50],[58,55],[62,60],[66,62],[70,60]],
  // Australia
  [[-11,131],[-12,137],[-16,141],[-21,149],[-27,153],[-33,152],[-38,145],[-38,141],[-35,137],[-32,134],[-33,125],[-34,118],[-31,116],[-26,113],[-22,114],[-18,122],[-15,127],[-11,131]],
];

function _globeProject(lat, lon, rot, R, cx, cy) {
  const la = lat * Math.PI / 180, lo = (lon + rot) * Math.PI / 180;
  const x = Math.cos(la) * Math.sin(lo);
  const y = Math.sin(la);
  const z = Math.cos(la) * Math.cos(lo);   // >0 = facing the viewer
  return { x: cx + x * R, y: cy - y * R, visible: z > 0, z };
}

// points: [{ lat, lon, label }]
function createLiveGlobe(canvas, getPoints) {
  const ctx = canvas.getContext('2d');
  let rot = 20;            // current longitude rotation
  let dragging = false, lastX = 0, spin = 0.12;   // idle drift speed
  let raf = null;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || 260;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    const size = canvas.clientWidth || 260;
    const cx = size / 2, cy = size / 2, R = size / 2 - 8;
    ctx.clearRect(0, 0, size, size);

    // Sphere body
    const grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    grad.addColorStop(0, 'rgba(129,140,248,0.30)');
    grad.addColorStop(0.65, 'rgba(79,70,229,0.14)');
    grad.addColorStop(1, 'rgba(30,27,75,0.30)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();

    // Graticule
    ctx.strokeStyle = 'rgba(148,163,255,0.16)'; ctx.lineWidth = 0.7;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let started = false;
      for (let lon = -180; lon <= 180; lon += 4) {
        const p = _globeProject(lat, lon, rot, R, cx, cy);
        if (!p.visible) { started = false; continue; }
        started ? ctx.lineTo(p.x, p.y) : (ctx.moveTo(p.x, p.y), started = true);
      }
      ctx.stroke();
    }
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath();
      let started = false;
      for (let lat = -90; lat <= 90; lat += 4) {
        const p = _globeProject(lat, lon, rot, R, cx, cy);
        if (!p.visible) { started = false; continue; }
        started ? ctx.lineTo(p.x, p.y) : (ctx.moveTo(p.x, p.y), started = true);
      }
      ctx.stroke();
    }

    // Landmasses
    ctx.strokeStyle = 'rgba(165,180,252,0.55)'; ctx.lineWidth = 1.1;
    GLOBE_LAND.forEach(poly => {
      ctx.beginPath();
      let started = false;
      poly.forEach(([lat, lon]) => {
        const p = _globeProject(lat, lon, rot, R, cx, cy);
        if (!p.visible) { started = false; return; }
        started ? ctx.lineTo(p.x, p.y) : (ctx.moveTo(p.x, p.y), started = true);
      });
      ctx.stroke();
    });

    // Visitor points, farthest first so nearer ones sit on top
    const pts = (getPoints() || []).slice().sort((a, b) => {
      const pa = _globeProject(a.lat, a.lon, rot, R, cx, cy);
      const pb = _globeProject(b.lat, b.lon, rot, R, cx, cy);
      return pa.z - pb.z;
    });
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
    pts.forEach(pt => {
      const p = _globeProject(pt.lat, pt.lon, rot, R, cx, cy);
      if (!p.visible) return;
      const r = 3 + (pt.count > 1 ? Math.min(3, pt.count - 1) : 0);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16,185,129,' + (0.16 * (1 - pulse) + 0.05) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1; ctx.stroke();
    });
  };

  const tick = () => {
    if (!dragging) rot += spin;
    draw();
    raf = requestAnimationFrame(tick);
  };

  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (dragging) { rot += (e.clientX - lastX) * 0.4; lastX = e.clientX; } });
  const stop = e => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (err) {} };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  window.addEventListener('resize', () => { resize(); draw(); });
  resize();
  tick();

  return { destroy() { if (raf) cancelAnimationFrame(raf); } };
}

// Groups live visitors into one point per timezone, so five people in Warsaw
// are a single bigger dot rather than five stacked invisibly on each other.
function globePointsFromTimezones(timezones) {
  const counts = new Map();
  timezones.forEach(tz => {
    if (!GLOBE_TZ_COORDS[tz]) return;
    counts.set(tz, (counts.get(tz) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([tz, count]) => ({
    lat: GLOBE_TZ_COORDS[tz][0], lon: GLOBE_TZ_COORDS[tz][1], label: tz, count
  }));
}
