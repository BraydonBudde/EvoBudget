// Budget: Priya sets Groceries to $500, then logs a shop from the card and
// watches what is left go down by itself.
module.exports = {
  title: 'Budget', sub: 'Plan what you expect, then see what you really spend.',
  endTitle: 'That is Budget', endSub: 'Plan it once, then let your spending fill it in.',
  icon: '<path d="M12 3v18"/><path d="M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3"/>',
  prep: async page => { await page.evaluate(() => { switchTab('budget'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $) => {
    const groceries = $('#bview-budget .mod-edit').nth(1);
    await d.caption(1, 'Every category: planned, and spent so far');
    await d.wait(1500);
    await d.scrollTo(groceries, 'center', 1000);
    await d.wait(900);

    await d.caption(2, 'Set what you expect to spend');
    await d.tap(groceries, { hold: 800 });
    await d.tap($('#ebExp'), { hold: 500 });
    await d.keypad('500');
    await d.tap($('#ebSave'), { hold: 1000 });
    await d.hideFinger();
    await d.caption(null, 'Groceries now has $500 to spend this month');
    await d.scrollTo($('#bview-budget .mod-edit').nth(1), 'center', 700);
    await d.wait(1400);

    await d.caption(3, 'Spend? Tap Log on the category');
    await d.tap($('#bview-budget .env-btn--go').nth(1), { hold: 800 });
    for (const k of ['1', '2', '0']) await d.tap($(`[data-qa-key="${k}"]`), { move: 300, hold: 170 });
    await d.wait(300);
    await d.tap($('#qaSaveBtn'), { hold: 1100 });
    await d.hideFinger();
    await d.scrollTo($('#bview-budget .mod-edit').nth(1), 'center', 800);
    await d.caption(4, 'What is left goes down by itself');
    await d.wait(2200);
  }
};
