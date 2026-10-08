// Transactions: log a spend, find it, change it.
module.exports = {
  title: 'Transactions', sub: 'Log a spend, find it, fix it. In seconds.',
  endTitle: 'That is Transactions', endSub: 'Every dollar you log powers your budget, dashboard and charts.',
  icon: '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
  prep: async page => {
    await page.evaluate(() => { switchTab('transactions'); window.scrollTo(0, 0); });
    await page.waitForTimeout(800);
    // Opens on the Add card, the heading already scrolled away.
    await page.evaluate(() => window.__dmScroll(document.getElementById('txOpenAddBtn').closest('.panel, section, div'), 'start', 1));
  },
  play: async (d, $) => {
    const list = $('.tx-table, #bview-transactions table');
    await d.caption(1, 'Every dollar you log lives here');
    await d.wait(300);
    await d.scrollTo(list, 'start', 1000);
    await d.wait(1200);

    await d.caption(2, 'Tap + to log a spend');
    await d.tap($('#navDockAdd'), { move: 700, hold: 700, reveal: false });
    await d.caption(3, 'Type what it cost');
    for (const k of ['1', '2', '.', '5', '0']) await d.tap($(`[data-qa-key="${k}"]`), { move: 300, hold: 170 });
    await d.wait(400);
    await d.caption(4, 'Choose a category');
    await d.tap($('#qaCatBtn'), { hold: 600 });
    await d.tap($('#ddMenu .dd-opt').filter({ hasText: 'Eating out' }), { move: 420, hold: 600, reveal: false });
    await d.caption(5, 'Add it. Done.');
    await d.tap($('#qaSaveBtn'), { hold: 1100 });
    await d.hideFinger();
    await d.scrollTo(list, 'start', 1000);
    await d.caption(null, 'It is in your list, and your budget, straight away');
    await d.wait(1700);

    await d.caption(6, 'Search to find one fast');
    await d.tap($('#txSearch'), { hold: 250 });
    await d.typeText($('#txSearch'), 'coffee', 130);
    await d.wait(900);

    await d.caption(7, 'Tap the pencil to change anything');
    await d.tap($('#bview-transactions .edit-btn[data-tx]'), { hold: 150 });
    await d.hideFinger();   // lifted, so it never seems to rest on Delete as the sheet opens
    await d.wait(650);
    await d.tap($('#tutorialOverlay .num-step[data-d="1"]'), { hold: 600 });
    await d.tap($('#saveEditBtn'), { hold: 900 });
    await d.hideFinger();
    await d.caption(null, 'Saved. Every total updates with it');
    await d.wait(1800);
  }
};
