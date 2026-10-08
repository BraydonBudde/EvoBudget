// Settings: Ben is paid on the 15th, so his budget period starts then. Then
// the things that make it his: currency, persona, and the look.
module.exports = {
  title: 'Settings', sub: 'Make the app work the way you do.',
  endTitle: 'That is Settings', endSub: 'Your pay cycle, your currency, your look.',
  icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  prep: async page => { await page.evaluate(() => { switchTab('dashboard'); window.scrollTo(0, 0); }); await page.waitForTimeout(800); },
  play: async (d, $) => {
    await d.caption(1, 'Paid on the 15th? Start your period then');
    await d.tap($('#periodBtn'), { hold: 900 });
    await d.tap($('.bp-day').filter({ hasText: /^15$/ }), { hold: 1000 });
    await d.tap($('#bpSaveBtn'), { hold: 1100 });
    await d.hideFinger();
    await d.caption(null, 'Every figure now follows your pay cycle');
    await d.wait(1400);

    await d.caption(2, 'Everything else is in Settings');
    await d.tap($('#settingsNavBtn'), { move: 700, hold: 900, reveal: false });
    await d.caption(3, 'Your currency');
    await d.ddPick($('#bview-settings .dd-btn--native').filter({ hasText: 'USD' }), 'GBP');
    await d.wait(500);
    await d.caption(4, 'How the app talks to you');
    await d.tap($('.persona-opt').filter({ hasText: 'Cheeky' }), { hold: 1100 });

    await d.caption(5, 'And how it looks');
    await d.scrollTo($('.theme-opt'), 'center', 900);
    await d.tap($('.theme-opt').filter({ hasText: 'Peachy' }), { hold: 1200 });
    await d.tap($('.theme-opt').filter({ hasText: 'Frosty' }), { hold: 1200 });
    await d.tap($('.theme-opt').filter({ hasText: 'Jolly' }), { hold: 1200 });
    await d.tap($('.theme-opt').filter({ hasText: 'Dark' }), { hold: 900 });
    await d.hideFinger();

    await d.caption(6, 'And your data stays yours');
    await d.scrollTo($('.sync-mode-opt'), 'center', 900);
    await d.wait(2000);
  }
};
