// Savings Goals: Elena's $1,200 vacation by next July. The app works out
// the monthly amount; each payday she adds what she set aside.
module.exports = {
  title: 'Savings Goals', sub: 'Save for something, a little at a time.',
  endTitle: 'That is Savings Goals', endSub: 'Know what to save each month, and watch it grow.',
  icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  prep: async page => { await page.evaluate(() => { switchTab('goals'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $, page) => {
    const now = new Date(), july = `${now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()}-07-01`;
    await d.caption(1, 'Saving for something? Make it a goal');
    await d.wait(900);
    await d.tap($('#addFundBtn'), { hold: 800 });
    await d.caption(2, 'Name it');
    await d.tap($('#fundName'), { hold: 250 });
    await d.typeText($('#fundName'), 'Vacation', 110);
    await d.tap($('.icon-pick-btn').filter({ hasText: '✈️' }), { hold: 400 });
    await d.caption(3, 'Set the amount you need');
    await d.tap($('#fundTarget'), { hold: 400 });
    await d.keypad('1200');
    await d.caption(4, 'And when you need it by');
    await d.tap($('#fundDate').locator('xpath=ancestor::*[contains(@class,"date-field-styled")][1]'), { hold: 600 });
    await d.datePick(july);
    await d.caption(5, 'Create it');
    await d.tap($('#saveFundBtn'), { hold: 1200 });
    await d.hideFinger();
    const card = $('#bview-goals .sf-add-btn').last();
    await d.scrollTo(card, 'center', 900);
    await d.caption(null, 'It works out what to save each month');
    await d.wait(2000);

    await d.caption(6, 'Set money aside? Add it to the goal');
    await d.tap(card, { hold: 800 });
    await d.tap($('#sfContribAmt'), { hold: 400 });
    await d.keypad('150');
    await d.tap($('#sfContribSave'), { hold: 1200 });
    await d.hideFinger();
    await d.scrollTo($('#bview-goals .sf-add-btn').last(), 'center', 700);
    await d.caption(null, 'And watch it fill up');
    await d.wait(2000);
  }
};
