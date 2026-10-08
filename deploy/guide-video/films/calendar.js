// Calendar: Amir looks ahead through the week, spots the electric bill and
// pays it from its day, then sees the whole month.
module.exports = {
  title: 'Calendar', sub: 'What is due, on the day it is due.',
  endTitle: 'That is the Calendar', endSub: 'Look ahead before you spend, and pay right from the day.',
  icon: '<rect x="3.2" y="4.9" width="17.6" height="15.9" rx="2.4"/><path d="M16 3.2v3.5"/><path d="M8 3.2v3.5"/><path d="M3.2 10.2h17.6"/>',
  prep: async page => { await page.evaluate(() => { switchTab('calendar'); window.scrollTo(0, 0); }); await page.waitForTimeout(900); },
  play: async (d, $) => {
    const stage = $('.cal-deck-stage');
    await d.caption(1, 'Your month, one day at a time');
    await d.wait(1600);
    await d.caption(2, 'Swipe to look ahead');
    await d.swipe(stage, -170);
    await d.swipe(stage, -170);
    await d.hideFinger();
    await d.caption(null, 'The electric bill is due here');
    await d.wait(1500);

    await d.caption(3, 'Pay it right from the day');
    await d.tap($('.cal-card.is-focus .cal-card-pay'), { hold: 1100 });
    await d.tap($('#billPaidSaveBtn'), { hold: 1300 });
    await d.hideFinger();
    await d.caption(null, 'Paid, and ticked off');
    await d.wait(1500);

    await d.caption(4, 'Tap Today to come back');
    await d.tap($('[data-deck-today]'), { hold: 1100 });

    await d.caption(5, 'Or see the whole month');
    await d.tap($('[data-view-toggle="calendar"]'), { hold: 2200 });
  }
};
