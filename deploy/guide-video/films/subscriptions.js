// Bills: Jack adds Netflix as a subscription and sees the monthly total
// move, pays the electric bill, and pauses the gym he is not using.
module.exports = {
  title: 'Bills', sub: 'Every bill and subscription, and what they add up to.',
  endTitle: 'That is Bills', endSub: 'Know what your regular costs add up to, and keep them in check.',
  icon: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  prep: async page => { await page.evaluate(() => { switchTab('bills'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $) => {
    const now = new Date(), due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    await d.caption(1, 'Every bill, and what they cost a month');
    await d.wait(1700);

    await d.caption(2, 'Add one in seconds');
    await d.tap($('#addSubBtn'), { hold: 800 });
    await d.tap($('#subName'), { hold: 250 });
    await d.typeText($('#subName'), 'Netflix', 110);
    await d.tap($('#subAmount'), { hold: 400 });
    await d.keypad('15.49');
    await d.caption(3, 'Mark it as a subscription');
    await d.ddPick($('#tutorialOverlay .dd-btn--native').filter({ hasText: 'Bill' }), 'Subscription');
    await d.caption(4, 'And when it is next due');
    await d.tap($('#subDate').locator('xpath=ancestor::*[contains(@class,"date-field-styled")][1]'), { hold: 600 });
    await d.datePick(iso);
    await d.tap($('#saveSubBtn'), { hold: 1200 });
    await d.hideFinger();
    await d.scrollTo($('#addSubBtn'), 'start', 700);
    await d.caption(null, 'It joins the monthly total straight away');
    await d.wait(1800);

    await d.caption(5, 'Paid one? Tap Pay');
    await d.tap($('#bview-bills .sub-pay-btn').first(), { hold: 1100 });
    await d.tap($('#billPaidSaveBtn'), { hold: 1200 });
    await d.hideFinger();

    await d.caption(6, 'Not using one? Pause it');
    await d.tap($('#bview-bills label.recurring-toggle:has([data-sub-toggle="b5"])'), { hold: 1000 });
    await d.hideFinger();
    await d.scrollTo($('#addSubBtn'), 'start', 900);
    await d.caption(null, 'Paused, and out of the monthly total');
    await d.wait(2000);
  }
};
