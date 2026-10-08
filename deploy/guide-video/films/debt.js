// Debt Payoff: Sam's three debts, Avalanche or Snowball, an extra $150 a
// month bringing the debt-free date in, and one debt's month by month plan.
module.exports = {
  title: 'Debt Payoff', sub: 'A real plan to be debt-free, and the date it happens.',
  endTitle: 'That is Debt Payoff', endSub: 'Pick a plan, add what you can, and see the finish line.',
  icon: '<rect x="2.8" y="5.5" width="18.4" height="13" rx="2.4"/><path d="M2.8 10h18.4"/><path d="M6.5 15h3"/>',
  prep: async page => { await page.evaluate(() => { switchTab('debt'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $) => {
    const freeDate = $('text=/debt-free date/i');
    await d.caption(1, 'Every debt you owe, in one plan');
    await d.scrollTo($('#bview-debt table'), 'center', 1000);
    await d.wait(1300);
    await d.scrollTo(freeDate, 'center', 800);
    await d.caption(null, 'With the date you will be debt-free');
    await d.wait(1600);

    await d.caption(2, 'Add any extra you can each month');
    await d.scrollTo($('#extraPayment'), 'center', 900);
    await d.tap($('#extraPayment'), { hold: 500 });
    await d.keypad('150');
    await d.hideFinger();
    await d.scrollTo(freeDate, 'center', 900);
    await d.caption(null, 'Debt-free sooner, with less interest');
    await d.wait(2000);

    // With extra to aim, the two ways of paying differ, so the choice means something.
    await d.caption(3, 'Then choose which debt it goes to first');
    await d.scrollTo($('#bview-debt .method-btn'), 'start', 1000);
    await d.wait(500);
    await d.tap($('#bview-debt .method-btn').nth(1), { hold: 900 });
    await d.caption(null, 'Snowball: smallest balance first, for quick wins');
    await d.wait(1600);
    await d.tap($('#bview-debt .method-btn').nth(0), { hold: 700 });
    await d.caption(null, 'Avalanche: highest rate first, saves the most');
    await d.wait(1600);

    await d.caption(4, 'Tap ℹ️ for a month by month plan');
    await d.tap($('#bview-debt .edit-btn').first(), { hold: 2400 });
    await d.tap($('#debtSchedClose'), { move: 420, hold: 500 });
  }
};
