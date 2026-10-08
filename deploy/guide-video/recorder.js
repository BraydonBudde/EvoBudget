// Shared machinery for the guide's demo videos: a phone-sized browser on
// the real app, a touch indicator and captions drawn over it, every frame
// captured through the DevTools screencast, then encoded to H.264 MP4.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const W = 390, H = 844, DPR = 2;
// The page runs this many times slower while it is filmed (its animations
// through the DevTools clock, the film's own pauses by hand), and the
// frames are played back at full speed, so a heavy page still moves smoothly.
const SLOW = 3.5;
// Any ffmpeg built with libx264. Set FFMPEG to its path, or have it on PATH.
// (pip install imageio-ffmpeg bundles one; see README.md.)
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const OVERLAY_CSS = `
.dm-finger, .dm-ripple, .dm-cap, .dm-card { position: fixed; pointer-events: none; z-index: 2147483600; }
.dm-finger {
  left: 0; top: 0; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,.55), rgba(255,255,255,.22) 70%);
  border: 2px solid rgba(255,255,255,.9); box-shadow: 0 6px 18px rgba(10,5,30,.45);
  opacity: 0; transition: transform var(--dm-move, .5s) cubic-bezier(.45,.05,.25,1), opacity .25s ease, scale .12s ease;
}
.dm-finger.is-on { opacity: 1; }
.dm-finger.is-press { scale: .78; background: radial-gradient(circle, rgba(255,255,255,.8), rgba(255,255,255,.4) 70%); }
.dm-ripple { width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid rgba(255,255,255,.85); animation: dm-ripple .55s ease-out forwards; }
@keyframes dm-ripple { from { transform: var(--dm-at) scale(.6); opacity: 1; } to { transform: var(--dm-at) scale(2.1); opacity: 0; } }
.dm-cap {
  left: 16px; right: 16px; display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-radius: 20px;
  background: rgba(14, 9, 32, .9); border: 1px solid rgba(255,255,255,.14); box-shadow: 0 16px 40px -12px rgba(0,0,0,.6);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  color: #fff; font: 700 17px/1.3 Inter, system-ui, sans-serif; letter-spacing: -.01em;
  opacity: 0; transform: translateY(var(--dm-from, -10px)); transition: opacity .3s ease, transform .35s cubic-bezier(.2,.8,.2,1);
}
.dm-cap.is-on { opacity: 1; transform: none; }
.dm-cap b { flex: 0 0 auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; font-size: 14px; background: linear-gradient(135deg, #a78bfa, #7c3aed); }
.dm-card {
  inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 0 36px; text-align: center;
  background: radial-gradient(120% 70% at 50% 0%, #4c2a9a 0%, #23124f 45%, #0f0a22 100%); color: #fff; font-family: Inter, system-ui, sans-serif;
  opacity: 1; transition: opacity .5s ease;
}
.dm-card.is-off { opacity: 0; }
.dm-card .dm-ico { width: 84px; height: 84px; border-radius: 26px; display: grid; place-items: center; background: linear-gradient(135deg, #a78bfa, #7c3aed); box-shadow: 0 20px 40px -14px rgba(124,58,237,.9); }
.dm-card .dm-ico svg { width: 42px; height: 42px; }
.dm-card small { font-size: 13px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #c4b5fd; }
.dm-card h1 { margin: 0; font-size: 40px; font-weight: 800; letter-spacing: -.03em; line-height: 1.05; }
.dm-card p { margin: 0; font-size: 18px; line-height: 1.45; color: #ddd6fe; max-width: 300px; }
.dm-card > * { animation: dm-rise .6s cubic-bezier(.2,.8,.2,1) both; }
.dm-card > *:nth-child(2) { animation-delay: .08s; } .dm-card > *:nth-child(3) { animation-delay: .16s; } .dm-card > *:nth-child(4) { animation-delay: .24s; }
@keyframes dm-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }
`;

async function launch(seed, theme) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
  await ctx.addInitScript(([sd, th]) => {
    if (sessionStorage.getItem('dm')) return; sessionStorage.setItem('dm', '1');
    localStorage.setItem('evobudget_ubp_mode', 'full'); localStorage.setItem('evobudget_ubp_unlocked', '1'); localStorage.setItem('evobudget_ubp_key', 'DEMOKEY01');
    localStorage.setItem('evobudget_ubp_checked', String(Date.now())); localStorage.setItem('evobudget_theme', th); localStorage.setItem('evobudget_ubp_v1', JSON.stringify(sd));
  }, [seed, theme]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route(/google|gstatic|googleapis/, r => r.abort());
  await page.goto('http://127.0.0.1:5500/ultimate-budget');
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(SLOW => {
    window.__dmSlow = SLOW;
    // Scrolls like a hand would, at the film's pace.
    window.__dmScroll = (el, block, ms) => new Promise(done => {
      let box = el.parentElement;
      while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 2)) box = box.parentElement;
      box = box || document.scrollingElement;
      const r = el.getBoundingClientRect(), view = box === document.scrollingElement ? { top: 0, height: innerHeight } : box.getBoundingClientRect();
      const want = block === 'start' ? Math.max(view.top, 0) + 78 : view.top + view.height / 2 - r.height / 2;
      const from = box.scrollTop, to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, from + r.top - want));
      // Timed by the wall clock: a frame's own timestamp runs on the slowed animation clock.
      const t0 = performance.now(), len = ms * SLOW;
      let over = false;
      const finish = () => { if (over) return; over = true; box.scrollTop = to; done(); };
      const step = () => { if (over) return; const k = Math.min(1, (performance.now() - t0) / len), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; box.scrollTop = from + (to - from) * e; k < 1 ? setTimeout(step, 16) : finish(); };
      if (Math.abs(to - from) < 2) return finish();
      step(); setTimeout(finish, len + 400);
    });
    for (const c of ['dm-finger', 'dm-cap']) { const d = document.createElement('div'); d.className = c; document.body.appendChild(d); }
  }, SLOW);
  return { browser, ctx, page, errs };
}

// Everything the film does goes through here, so taps look like taps.
function director(page) {
  const T0 = Date.now(), log = (...x) => { if (process.env.DM_LOG) console.log(((Date.now() - T0) / 1000).toFixed(1), ...x); };
  const wait = ms => page.waitForTimeout(ms * SLOW);
  let at = { x: W / 2, y: H + 40 };
  const finger = async (x, y, ms = 520) => {
    await page.evaluate(([x, y, ms]) => {
      const f = document.querySelector('.dm-finger');
      f.style.setProperty('--dm-move', ms + 'ms');
      f.classList.add('is-on');
      f.style.transform = `translate(${x}px, ${y}px)`;
    }, [x, y, ms]);
    at = { x, y };
    await wait(ms + 40);
  };
  const hideFinger = () => page.evaluate(() => document.querySelector('.dm-finger').classList.remove('is-on'));
  const center = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // Brings a target into view the way a hand would scroll to it.
  const reveal = async (loc, block = 'center') => {
    const b = await loc.boundingBox();
    if (b && b.y > 70 && b.y + b.height < H - 100) return;
    await loc.evaluate((el, block) => window.__dmScroll(el, block, 600), block);
    await wait(80);
  };
  const tap = async (loc, { move = 520, hold = 350, reveal: rv = true } = {}) => {
    loc = loc.first();
    log('tap', String(loc));
    if (rv) await reveal(loc);
    const c = await center(loc);
    await finger(c.x, c.y, Math.abs(c.x - at.x) + Math.abs(c.y - at.y) < 30 ? 160 : move);
    await page.evaluate(([x, y]) => {
      document.querySelector('.dm-finger').classList.add('is-press');
      const r = document.createElement('div'); r.className = 'dm-ripple';
      r.style.setProperty('--dm-at', `translate(${x}px, ${y}px)`); r.style.left = '0'; r.style.top = '0';
      document.body.appendChild(r); setTimeout(() => r.remove(), 700 * window.__dmSlow);
    }, [c.x, c.y]);
    await wait(110);
    await loc.tap({ force: true });
    await page.evaluate(() => document.querySelector('.dm-finger').classList.remove('is-press'));
    await wait(hold);
  };
  const caption = async (n, text, where = 'top') => {
    log('caption', text);
    await page.evaluate(([n, text, where]) => {
      const c = document.querySelector('.dm-cap');
      c.classList.remove('is-on');
      setTimeout(() => {
        c.innerHTML = (n ? `<b>${n}</b>` : '') + `<span>${text}</span>`;
        c.style.top = where === 'top' ? '14px' : 'auto';
        c.style.bottom = where === 'top' ? 'auto' : '24px';
        c.style.setProperty('--dm-from', where === 'top' ? '-10px' : '10px');
        c.classList.add('is-on');
      }, c.textContent ? 220 * window.__dmSlow : 0);
    }, [n, text, where]);
    await wait(380);
  };
  const hideCaption = () => page.evaluate(() => document.querySelector('.dm-cap').classList.remove('is-on'));
  const card = async (html, ms) => {
    await page.evaluate(html => {
      const c = document.createElement('div'); c.className = 'dm-card'; c.innerHTML = html; document.body.appendChild(c);
    }, html);
    await wait(ms);
  };
  const cardOut = async () => {
    await page.evaluate(() => { const c = document.querySelector('.dm-card'); c.classList.add('is-off'); setTimeout(() => c.remove(), 600 * window.__dmSlow); });
    await wait(560);
  };
  const typeText = async (loc, text, delay = 110) => { for (const ch of text) { await loc.press(ch === ' ' ? 'Space' : ch); await wait(delay); } };
  const scrollTo = async (loc, block = 'start', ms = 900) => { log('scroll', String(loc)); await loc.first().evaluate((el, [block, ms]) => window.__dmScroll(el, block, ms), [block, ms]); await wait(60); };
  return { wait, finger, hideFinger, tap, reveal, caption, hideCaption, card, cardOut, typeText, center, scrollTo };
}

// Records whatever `film` does, from the moment it starts to the moment it ends.
async function record(page, outDir, name, film) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, buf: Buffer.from(data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
  await film();
  await page.waitForTimeout(150);
  await cdp.send('Page.stopScreencast');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  const tmp = path.join(require('os').tmpdir(), 'guide-video-' + name);   // the frames, kept out of the site
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const list = [];
  frames.forEach((f, i) => {
    const file = path.join(tmp, String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, f.buf);
    const next = frames[i + 1] ? frames[i + 1].t : f.t + .5;
    list.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${Math.max(.001, (next - f.t) / SLOW).toFixed(4)}`);
  });
  list.push(`file '${path.join(tmp, String(frames.length - 1).padStart(5, '0') + '.jpg').replace(/\\/g, '/')}'`);
  const listFile = path.join(tmp, 'list.txt');
  fs.writeFileSync(listFile, list.join('\n'));
  const mp4 = path.resolve(outDir, name + '.mp4');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=30,scale=${W * DPR}:${H * DPR}:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`, '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-profile:v', 'high', '-tune', 'animation', '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(tmp, { recursive: true, force: true });
  const span = frames.length ? (frames[frames.length - 1].t - frames[0].t) / SLOW : 0;
  return { mp4, frames: frames.length, seconds: span, fps: frames.length / Math.max(.001, span) };
}

// A still from the film, for the poster the guide shows before it plays.
function poster(mp4, at, out, width = 360) {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', mp4, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, '-q:v', '4', out]);
}

module.exports = { launch, director, record, poster, W, H, FFMPEG };
