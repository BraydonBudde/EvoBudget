// Rollover: Noor had $180 left at the end of last month. With Auto-carry on
// it comes forward, and Free to spend counts it.
module.exports = {
  title: 'Rollover', sub: 'Money you did not spend carries forward.',
  endTitle: 'That is Rollover', endSub: 'Unspent money moves forward with you, never lost.',
  icon: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  prep: async page => {
    await page.evaluate(() => { state.settings.rolloverAutoCarry = false; saveState(); switchTab('settings'); window.scrollTo(0, 0); });
    await page.waitForTimeout(900);
  },
  play: async (d, $) => {
    await d.caption(1, 'Rollover lives in Settings');
    await d.wait(900);
    await d.tap($('.stg-all-btn'), { hold: 700 });
    await d.scrollTo($('#settRollover'), 'center', 1000);
    await d.wait(600);
    await d.caption(2, 'Turn on carry-forward');
    await d.tap($('#settRolloverAuto'), { hold: 900 });
    await d.caption(3, 'Last month you had $180 left over');
    await d.tap($('#settRollover'), { hold: 400 });
    await d.keypad('180');
    await d.hideFinger();
    await d.wait(500);

    await d.caption(4, 'It is added to what you can spend');
    await d.tap($('#backToHub'), { hold: 900 });
    await d.tap($('.nl-explain'), { hold: 2800 });
    await d.tap($('#fxClose'), { move: 420, hold: 400 });
    await d.hideFinger();
    await d.caption(null, 'From now on, each new period brings the leftover with it');
    await d.wait(2000);
  }
};
