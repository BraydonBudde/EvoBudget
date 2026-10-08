// The Transactions film: log a spend, find it, change it. About 25 seconds.
const path = require('path');
const { launch, director, record, poster } = require('./recorder');
const demoSeed = require('./demo_seed');

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

(async () => {
  const out = process.argv[2] || path.join(__dirname, '..', '..', 'media', 'guide');
  require('fs').mkdirSync(out, { recursive: true });
  const { browser, page, errs } = await launch(demoSeed(), process.argv[3] || 'dark');
  await page.evaluate(() => { switchTab('transactions'); document.querySelector('.app-scroll')?.scrollTo({ top: 0 }); window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  // Opens on the Add card, the heading already scrolled away.
  await page.evaluate(() => window.__dmScroll(document.getElementById('txOpenAddBtn').closest('.panel, section, div'), 'start', 1));
  await page.waitForTimeout(400);
  const d = director(page);
  const $ = s => page.locator(s);

  const res = await record(page, out, 'transactions', async () => {
    // Title.
    await d.card(`<div class="dm-ico">${ICON}</div><small>Guide</small><h1>Transactions</h1><p>Log a spend, find it, fix it. In seconds.</p>`, 1700);
    await d.cardOut();

    // 1. The list.
    await d.caption(1, 'Every dollar you log lives here');
    await d.wait(300);
    await d.scrollTo($('.tx-table, #bview-transactions table'), 'start', 1000);
    await d.wait(1200);

    // 2. Log a spend.
    await d.caption(2, 'Tap + to log a spend');
    await d.tap($('#navDockAdd'), { move: 700, hold: 700, reveal: false });
    await d.caption(3, 'Type what it cost');
    for (const k of ['1', '2', '.', '5', '0']) await d.tap($(`[data-qa-key="${k}"]`), { move: 300, hold: 170 });
    await d.wait(400);
    await d.caption(4, 'Choose a category');
    await d.tap($('#qaCatBtn'), { hold: 600 });
    await d.tap($('#ddMenu .dd-opt').nth(1), { move: 420, hold: 600, reveal: false });
    await d.caption(5, 'Add it. Done.');
    await d.tap($('#qaSaveBtn'), { hold: 1100 });
    await d.hideFinger();
    await d.scrollTo($('.tx-table, #bview-transactions table'), 'start', 1000);
    await d.caption(null, 'It is in your list, and your budget, straight away');
    await d.wait(1700);

    // 3. Find one.
    await d.caption(6, 'Search to find one fast');
    await d.tap($('#txSearch'), { hold: 250 });
    await d.typeText($('#txSearch'), 'coffee', 130);
    await d.wait(900);

    // 4. Change it.
    await d.caption(7, 'Tap the pencil to change anything');
    await d.tap($('#bview-transactions .edit-btn[data-tx]'), { hold: 150 });
    await d.hideFinger();   // lifted, so it never seems to rest on Delete as the sheet opens
    await d.wait(650);
    const plus = $('#tutorialOverlay .num-step[data-d="1"]');
    await d.tap(plus, { hold: 600 });
    await d.tap($('#saveEditBtn'), { hold: 900 });
    await d.hideFinger();
    await d.caption(null, 'Saved. Every total updates with it');
    await d.wait(1800);
    await d.hideCaption();

    // End.
    await d.card(`<div class="dm-ico">${TICK}</div><h1>That is Transactions</h1><p>Every dollar you log powers your budget, dashboard and charts.</p>`, 2100);
  });

  poster(res.mp4, 0.9, path.join(out, 'transactions.jpg'));
  console.log(JSON.stringify({ ...res, errs }));
  await browser.close();
})();
