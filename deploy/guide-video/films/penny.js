// Ezzo: asking real questions about this month and getting answers from the
// planner itself. Shown as everyone gets him out of the box; the film ends
// on where to wake him for any question, and never types a key.
module.exports = {
  title: 'Ezzo', sub: 'Ask about your money in plain words.',
  endTitle: 'That is Ezzo', endSub: 'Ask in your own words, get a straight answer from your own numbers.',
  icon: '<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  prep: async page => { await page.evaluate(() => { switchTab('dashboard'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $) => {
    await d.caption(1, 'Ezzo is in the menu');
    await d.tap($('#navDockMenu'), { move: 700, hold: 700, reveal: false });
    await d.tap($('.nav-menu-item').filter({ hasText: 'Budget Assistant' }), { hold: 900 });
    await d.caption(2, 'Ask in your own words');
    await d.tap($('#ezOffInput'), { hold: 300, reveal: false });
    await d.typeText($('#ezOffInput'), 'can i spend today', 95);
    await d.wait(500);
    await d.caption(3, 'Tap the question you mean');
    await d.tap($('#ezOffDrawer .ez-pill').first(), { hold: 2800, reveal: false });
    await d.hideFinger();
    await d.caption(null, 'The answer comes from your own numbers');
    await d.wait(1500);

    await d.caption(4, 'Ask another');
    await d.tap($('#ezOffInput'), { hold: 300, reveal: false });
    await d.typeText($('#ezOffInput'), 'bills coming up', 95);
    await d.wait(400);
    await d.tap($('#ezOffDrawer .ez-pill').first(), { hold: 2600, reveal: false });
    await d.hideFinger();

    await d.caption(5, 'Want him to answer anything? Wake him in Settings');
    await d.tap($('#ezOffDrawer .penny-icon-btn[aria-label="Close Ezzo"], #ezOffDrawer [aria-label="Close Ezzo"]'), { hold: 600, reveal: false });
    await d.tap($('#settingsNavBtn'), { move: 600, hold: 800, reveal: false });
    await d.tap($('.stg-all-btn'), { hold: 700 });
    await d.hideFinger();
    await d.scrollTo($('.penny-settings-panel'), 'center', 1100);
    await d.wait(600);
    await d.caption(null, 'Turn Ezzo on here with a free Gemini key');
    await d.wait(2000);
  }
};
