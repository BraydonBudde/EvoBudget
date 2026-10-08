// Dashboard: payday, at a glance. What is free to spend and how it is worked
// out, what is due and paying it, then goals and anything flagged.
module.exports = {
  title: 'Dashboard', sub: 'Your money at a glance, every time you open the app.',
  endTitle: 'That is the Dashboard', endSub: 'Glance at it on payday, and before you spend.',
  icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  prep: async page => { await page.evaluate(() => { switchTab('dashboard'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $) => {
    await d.caption(1, 'Free to spend: what is really yours');
    await d.wait(1700);
    await d.caption(2, 'Tap ? to see how it is worked out');
    await d.tap($('.nl-explain'), { hold: 2600 });
    await d.tap($('#fxClose'), { move: 420, hold: 500 });
    await d.hideFinger();

    await d.caption(3, 'Coming up: every bill due soon');
    await d.scrollTo($('.cu-pay'), 'center', 900);
    await d.wait(1400);
    await d.caption(4, 'Paid one? Tap Pay');
    await d.tap($('.cu-pay'), { hold: 1100 });
    await d.tap($('#billPaidSaveBtn'), { hold: 1200 });
    await d.hideFinger();
    await d.caption(null, 'Marked paid, and Free to spend stays honest');
    await d.wait(1600);

    await d.caption(5, 'Your goals at a glance');
    await d.scrollTo($('.gp-row'), 'center', 1000);
    await d.wait(1500);
    await d.caption(6, 'Anything off is flagged for you');
    await d.scrollTo($('.hu-tog'), 'start', 1000);
    await d.wait(1900);
  }
};
