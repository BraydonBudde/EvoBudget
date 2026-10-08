// Records one guide film:  node deploy/guide-video/film.js <section> [outDir]
// Each film in films/ says what it shows; this opens it with a title card,
// closes it with an end card, and writes <section>.mp4 and <section>.jpg.
const path = require('path');
const fs = require('fs');
const { launch, director, record, poster } = require('./recorder');
const demoSeed = require('./demo_seed');

const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ico = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

(async () => {
  const id = process.argv[2];
  if (!id || !fs.existsSync(path.join(__dirname, 'films', id + '.js'))) {
    console.log('Usage: node deploy/guide-video/film.js <' + fs.readdirSync(path.join(__dirname, 'films')).map(f => f.replace(/\.js$/, '')).join('|') + '> [outDir]');
    process.exit(1);
  }
  const f = require('./films/' + id);
  const out = path.resolve(process.argv[3] || path.join(__dirname, '..', '..', 'media', 'guide'));
  fs.mkdirSync(out, { recursive: true });
  const { browser, page, errs } = await launch(demoSeed(f.seed), f.theme || 'dark');
  if (f.prep) await f.prep(page);
  await page.waitForTimeout(600);
  const d = director(page);
  const $ = s => page.locator(s);
  const res = await record(page, out, id, async () => {
    await d.card(`<div class="dm-ico">${ico(f.icon)}</div><small>Guide</small><h1>${f.title}</h1><p>${f.sub}</p>`, 1700);
    await d.cardOut();
    await f.play(d, $, page);
    await d.hideFinger();
    await d.hideCaption();
    await d.card(`<div class="dm-ico">${TICK}</div><h1>${f.endTitle}</h1><p>${f.endSub}</p>`, 2100);
  });
  if (res.mp4) poster(res.mp4, 0.9, path.join(out, id + '.jpg'));
  else await page.screenshot({ path: path.join(out, id + '_end.png') });
  console.log(JSON.stringify({ ...res, errs }));
  await browser.close();
  if (errs.length) process.exitCode = 2;
})();
