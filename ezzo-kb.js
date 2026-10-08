'use strict';
/* =====================================================================
   ezzo-kb.js - what sleeping Ezzo knows.

   Each entry is a question as someone would ask it, extra words people
   use for the same thing, and an answer. Answers about the person's money
   are worked out live, with the same functions the dashboard uses, so
   Ezzo never says anything the screen would contradict.

   Entry: EZQ(id, topic, type, question, keywords, answer, [buttonLabel, where], when)
     type  'data' = your own numbers, 'how' = using the planner, 'tip' = money know-how
     where  a tab name, or quickadd / tools / afford / period / explain / settings:<card>
     when   optional: only offered while this is true
   ===================================================================== */

// ── Helpers: the dashboard's own figures ──────────────────────────────────
const EZH = {
  sum: () => computeSummary(computeActuals()),
  act: () => computeActuals(),
  com: () => nlCommitted(),
  free: () => EZH.sum().leftover - EZH.com().total,
  p: () => nlDaysInPeriod(),
  end: () => state.settings.periodEnd ? formatDateDisplay(state.settings.periodEnd) : 'the end of this period',
  start: () => state.settings.periodStart ? formatDateDisplay(state.settings.periodStart) : '',
  m: v => (v < -0.004 ? '−' : '') + fmt(Math.abs(v)),
  b: v => '**' + EZH.m(v) + '**',
  today: () => toLocalISO(new Date()),
  day: n => toLocalISO(new Date(Date.now() + n * 86400000)),
  tx: () => state.transactions || [],
  inP: x => x.date >= state.settings.periodStart && x.date <= state.settings.periodEnd,
  spends: () => EZH.tx().filter(x => x.type === 'expense' && EZH.inP(x)),
  freeToday: () => { const f = EZH.free(), p = EZH.p(), s = nlSpentToday(); return p.left >= 0 && f > 0 ? Math.max(0, (f + s) / (p.left + 1) - s) : 0; },
  cats: () => Object.entries(EZH.act().expenses || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
  plans: () => (state.budgets.expenses || []).filter(r => (r.expected || 0) > 0),
  share: () => (typeof periodShare === 'function' ? periodShare() : 1),
  bills: () => (state.bills || []).filter(b => b.active !== false),
  subs: () => EZH.bills().filter(b => b.kind === 'subscription'),
  due: () => comingUpItems(EZH.com()),
  overdue: () => { const d = EZH.today(); return EZH.com().items.filter(i => i.date < d); },
  goals: () => state.sinkingFunds || [],
  debts: () => (state.debts || []).filter(d => (d.balance || 0) > 0),
  list: arr => arr.map(x => '- ' + x).join('\n'),
  when: iso => (typeof cuRelative === 'function' ? cuRelative(iso) : formatDateDisplay(iso)),
  noIncome: () => !(EZH.sum().totalIncome > 0) && !((state.rollover || 0) > 0),
  pct: (a, b) => b > 0 ? Math.round(a / b * 100) : 0
};
const EZQ = (id, topic, type, q, k, a, go, when) => ({ id, topic, type, q, k, a, go: go || null, when: when || null });

const EZ_KB = [
  // ═══ Today and Free to spend ═════════════════════════════════════════
  EZQ('free_today', 'today', 'data', 'How much can I spend today?', 'safe daily allowance left spend now budget today', () => {
    if (EZH.noIncome()) return 'Nothing yet: log your pay first, then I can work out what is safe to spend each day.';
    const f = EZH.free(), t0 = EZH.freeToday(), s = nlSpentToday();
    if (f <= 0) return `Nothing, I'm afraid. You are ${EZH.b(-f)} over for this period once your bills are set aside, so today is a good day to spend nothing you don't need.`;
    return `You can spend ${EZH.b(t0)} today${s > 0 ? `, after the ${EZH.m(s)} you have already spent` : ''}. That keeps you on track to ${EZH.end()}.`;
  }, ['Log a spend', 'quickadd']),
  EZQ('free_period', 'today', 'data', 'How much is free to spend this period?', 'free to spend left available remaining leftover until payday', () => {
    if (EZH.noIncome()) return 'Log your pay first, and your Free to spend appears straight away.';
    const f = EZH.free(), p = EZH.p();
    return f >= 0 ? `${EZH.b(f)} is free to spend until ${EZH.end()}${p.left > 0 ? `, about ${EZH.m(f / p.left)} a day for ${p.left} days` : ''}. Every bill still due is already taken off.`
      : `You are ${EZH.b(-f)} short until ${EZH.end()} once the bills still due are paid.`;
  }, ['How it is worked out', 'explain']),
  EZQ('spent_today', 'today', 'data', 'How much have I spent today?', 'spent today so far', () => {
    const s = nlSpentToday(), bills = nlBillsPaidToday();
    return `You have spent ${EZH.b(s)} today${bills > 0 ? `, plus ${EZH.m(bills)} on bills, which were already set aside` : ''}.`;
  }),
  EZQ('spent_yesterday', 'today', 'data', 'How much did I spend yesterday?', 'yesterday spent', () => {
    const y = EZH.day(-1), s = EZH.tx().filter(x => x.type === 'expense' && x.date === y).reduce((a, x) => a + x.amount, 0);
    return s > 0 ? `You spent ${EZH.b(s)} yesterday.` : 'Nothing logged for yesterday. If you did spend something, add it with a past date and your number will catch up.';
  }),
  EZQ('per_day', 'today', 'data', 'How much can I spend per day until payday?', 'daily rate per day until payday', () => {
    const f = EZH.free(), p = EZH.p();
    if (EZH.noIncome()) return 'Log your pay first and I can split it into a daily amount.';
    if (f <= 0) return `There is no daily allowance left: you are ${EZH.b(-f)} short this period.`;
    return p.left > 0 ? `About ${EZH.b(f / p.left)} a day for the ${p.left} days until ${EZH.end()}.` : `Today is the last day of the period, and ${EZH.b(f)} is free.`;
  }),
  EZQ('days_left', 'period', 'data', 'How many days until my next payday?', 'days left until payday period end next pay how long', () => {
    const p = EZH.p();
    return p.left > 0 ? `${p.left} days. This period ends on ${EZH.end()}, and the next one starts the day after.` : `Today is the last day of this period, which ends ${EZH.end()}.`;
  }),
  EZQ('period_day', 'period', 'data', 'What day of my budget period is it?', 'which day period progress', () => { const p = EZH.p(); return `Day ${p.dayOf} of ${p.total}, running ${EZH.start()} to ${EZH.end()}.`; }),
  EZQ('free_explain', 'today', 'how', 'How is Free to spend worked out?', 'calculated worked out formula explain number', () => {
    const s = EZH.sum(), c = EZH.com();
    return `It is what came in, less what went out, less every bill still due before ${EZH.end()}:\n- Came in: ${EZH.m(s.totalIncome)}${state.rollover ? `\n- Carried over: ${EZH.m(state.rollover)}` : ''}\n- Spent and paid: ${EZH.m(s.totalOut)}${s.totalSavings ? `\n- Put into savings: ${EZH.m(s.totalSavings)}` : ''}\n- Still due: ${EZH.m(c.total)}\n\nThat leaves ${EZH.b(s.leftover - c.total)}.`;
  }, ['Show the breakdown', 'explain']),
  EZQ('free_negative', 'today', 'data', 'Why is my Free to spend negative?', 'minus red below zero short negative', () => {
    const f = EZH.free(), c = EZH.com();
    if (f >= 0) return `It isn't right now: you have ${EZH.b(f)} free. It goes below zero when the bills still due add up to more than you have left.`;
    return `Because the ${EZH.m(c.total)} still due before ${EZH.end()} is more than what is left of this period's money. Pay the essentials first, and hold off on anything that can wait until payday.`;
  }),
  EZQ('free_dropped', 'today', 'tip', 'Why did my Free to spend go down?', 'dropped decreased lower changed went down', 'Three things lower it: spending you log, a new bill or bill amount due before your period ends, and money moved into a savings goal. Paying a bill does not lower it, because that bill was already set aside.'),
  EZQ('on_track', 'today', 'data', 'Am I on track this period?', 'track doing okay good pace', () => {
    if (EZH.noIncome()) return 'Log your pay first and I can tell you how the period is going.';
    const f = EZH.free(), s = EZH.sum(), plan = EZH.plans().reduce((a, r) => a + r.expected, 0) * EZH.share(), p = EZH.p();
    if (f < 0) return `Not quite: you are ${EZH.b(-f)} short once your bills are paid. Ease off the flexible spending for the rest of the period.`;
    if (plan > 0) { const pace = s.totalExpenses / Math.max(p.dayOf / p.total, .05); if (pace > plan * 1.1) return `Your bills are covered, but everyday spending is heading for ${EZH.m(pace)} against ${EZH.m(plan)} planned. Slowing down a little now keeps it on track.`; }
    return `Yes. Your bills are covered and ${EZH.b(f)} is still free until ${EZH.end()}.`;
  }),
  EZQ('run_out', 'today', 'data', 'Will I run out of money before payday?', 'run out short last enough until payday', () => {
    const f = EZH.free(), s = EZH.sum(), p = EZH.p(), perDay = p.dayOf > 0 ? s.totalExpenses / p.dayOf : 0;
    if (f <= 0) return `You already are short by ${EZH.b(-f)} once your bills are paid.`;
    if (perDay * p.left > f) return `At your usual ${EZH.m(perDay)} a day you would need ${EZH.m(perDay * p.left)}, and ${EZH.m(f)} is free. Keeping to ${EZH.m(f / Math.max(1, p.left))} a day gets you there.`;
    return `No. At your usual ${EZH.m(perDay)} a day you have room to spare: ${EZH.b(f)} is free until ${EZH.end()}.`;
  }),
  EZQ('afford_q', 'today', 'how', 'Can I afford something?', 'afford purchase buy item worth it', () => `Right now ${EZH.b(EZH.free())} is free until ${EZH.end()}, about ${EZH.m(EZH.freeToday())} for today. "Can I afford it?" shows exactly what a purchase would do to your days before you buy.`, ['Check a purchase', 'afford']),
  EZQ('left_after_bills', 'today', 'data', 'What do I have left after bills?', 'after bills remaining once bills paid', () => `After the ${EZH.m(EZH.com().total)} still due, you have ${EZH.b(EZH.free())} left until ${EZH.end()}.`),

  // ═══ This period ═════════════════════════════════════════════════════
  EZQ('spent_period', 'period', 'data', 'How much have I spent this period?', 'total spent period so far outgoings', () => { const s = EZH.sum(); return `${EZH.b(s.totalOut)} has gone out since ${EZH.start()}: ${EZH.m(s.totalExpenses)} of everyday spending and ${EZH.m(s.totalBills + s.totalSubscriptions + (s.totalDebt || 0))} on bills and debts.`; }),
  EZQ('spent_week', 'period', 'data', 'How much did I spend this week?', 'last 7 days week spent', () => { const from = EZH.day(-6), s = EZH.tx().filter(x => x.type === 'expense' && x.date >= from && x.date <= EZH.today()).reduce((a, x) => a + x.amount, 0); return `${EZH.b(s)} of everyday spending in the last 7 days.`; }),
  EZQ('spent_month', 'period', 'data', 'How much have I spent this month?', 'calendar month spent', () => { const m = EZH.today().slice(0, 7), s = EZH.tx().filter(x => x.type === 'expense' && x.date.startsWith(m)).reduce((a, x) => a + x.amount, 0); return `${EZH.b(s)} of everyday spending so far this calendar month.`; }),
  EZQ('avg_day', 'period', 'data', 'What is my average daily spending?', 'average per day typical usual daily spend', () => { const s = EZH.sum(), p = EZH.p(); return `About ${EZH.b(p.dayOf ? s.totalExpenses / p.dayOf : 0)} a day so far this period, over ${p.dayOf} days.`; }),
  EZQ('vs_last', 'period', 'data', 'How does this period compare to last period?', 'compare previous last time better worse', () => {
    const prev = typeof computePrevSummary === 'function' ? computePrevSummary() : null, s = EZH.sum();
    if (!prev) return 'There is nothing logged for last period yet, so there is nothing to compare with.';
    const d = s.totalExpenses - prev.totalExpenses;
    return `This period's everyday spending is ${EZH.m(s.totalExpenses)} so far, against ${EZH.m(prev.totalExpenses)} for the whole of last period${d < 0 ? ', so you are well under it' : d > 0 ? `, already ${EZH.m(d)} more` : ''}.`;
  }),
  EZQ('income_period', 'period', 'data', 'How much money came in this period?', 'income received earned paid in', () => { const s = EZH.sum(); return `${EZH.b(s.totalIncome)} has come in since ${EZH.start()}${state.rollover ? `, plus ${EZH.m(state.rollover)} carried over` : ''}.`; }),
  EZQ('income_expected', 'period', 'data', 'How much income am I still expecting?', 'still to come expected income pay due', () => {
    const plan = (state.budgets.income || []).reduce((a, r) => a + (r.expected || 0), 0) * EZH.share(), got = EZH.sum().totalIncome, left = Math.max(0, plan - got);
    if (!plan) return 'You have not planned any income yet. Set it on the Budget page and I can track it for you.';
    return left > 0 ? `About ${EZH.b(left)} more, on top of the ${EZH.m(got)} already in.` : `All of it: ${EZH.m(got)} has come in against ${EZH.m(plan)} planned for this period.`;
  }, ['Open Budget', 'budget']),
  EZQ('kept', 'period', 'data', 'How much have I kept this period?', 'kept saved left over not spent', () => { const s = EZH.sum(), k = s.totalIncome - s.totalOut; return `You have kept ${EZH.b(k)}, ${EZH.pct(k, s.totalIncome)}% of what came in.`; }),
  EZQ('savings_rate', 'period', 'data', 'What is my savings rate?', 'rate percent saving percentage', () => { const s = EZH.sum(); return s.totalIncome > 0 ? `${s.savingsRate}% of this period's income has gone into savings goals, and ${EZH.pct(s.totalIncome - s.totalOut, s.totalIncome)}% hasn't been spent.` : 'Log your income first and I can work out your savings rate.'; }),
  EZQ('rollover_amt', 'period', 'data', 'How much was carried over from last period?', 'rollover carried over leftover previous', () => state.rollover ? `${EZH.b(state.rollover)} was carried into this period. It counts towards your Free to spend.` : 'Nothing was carried over this period. Turn on Rollover in Settings and anything left at the end of a period carries into the next.', ['Rollover settings', 'settings:rollover']),
  EZQ('top_cat', 'period', 'data', 'What did I spend the most on?', 'biggest category most top spending where money goes', () => { const c = EZH.cats(); if (!c.length) return 'Nothing logged yet this period.'; const tot = c.reduce((a, x) => a + x[1], 0); return `**${c[0][0]}**: ${EZH.m(c[0][1])}, ${EZH.pct(c[0][1], tot)}% of your everyday spending this period.`; }),
  EZQ('top3_cat', 'period', 'data', 'What are my top spending categories?', 'top three categories ranking breakdown', () => { const c = EZH.cats().slice(0, 5); return c.length ? 'This period so far:\n' + EZH.list(c.map(([n, v]) => `${n}: ${EZH.m(v)}`)) : 'Nothing logged yet this period.'; }),
  EZQ('last_tx', 'period', 'data', 'What was my last transaction?', 'latest recent last logged entry', () => { const x = EZH.tx().slice().sort((a, b) => b.date.localeCompare(a.date))[0]; return x ? `${x.description || x.category}: ${EZH.b(x.amount)} (${x.type === 'sinking_fund' ? 'goal' : x.type}, ${x.category}) on ${formatDateDisplay(x.date)}.` : 'Nothing is logged yet.'; }, ['Open Transactions', 'transactions']),
  EZQ('biggest_tx', 'period', 'data', 'What was my biggest purchase this period?', 'largest expensive single purchase', () => { const x = EZH.spends().sort((a, b) => b.amount - a.amount)[0]; return x ? `${x.description || x.category}: ${EZH.b(x.amount)} on ${formatDateDisplay(x.date)}.` : 'No purchases logged this period yet.'; }),
  EZQ('tx_count', 'period', 'data', 'How many transactions have I logged?', 'count number entries', () => `${EZH.tx().filter(EZH.inP).length} this period, ${EZH.tx().length} in total.`),
  EZQ('uncat_count', 'period', 'data', 'Do I have unsorted spending?', 'uncategorized unsorted sort later no category', () => { const u = EZH.tx().filter(x => x.type === 'expense' && (!x.category || x.category === t('qa_uncat'))); return u.length ? `${u.length} spends have no category yet, ${EZH.m(u.reduce((a, x) => a + x.amount, 0))} in all. Give each one a category so your budget counts them.` : 'No, everything has a category.'; }, ['Open Transactions', 'transactions']),

  // ═══ Bills ═══════════════════════════════════════════════════════════
  EZQ('bills_next', 'bills', 'data', 'What bills are coming up?', 'upcoming due soon next bills payments schedule', () => { const d = EZH.due(); return d.length ? 'Coming up:\n' + EZH.list(d.map(i => `${i.label}: ${EZH.m(i.amount)}, ${EZH.when(i.date)}${i.overdue ? ' (overdue)' : ''}`)) : 'Nothing is due in the coming days.'; }, ['Open Bills', 'bills']),
  EZQ('bill_next_one', 'bills', 'data', 'What is my next bill?', 'next bill due soonest', () => { const d = EZH.due().filter(i => !i.overdue)[0]; return d ? `${d.label}: ${EZH.b(d.amount)}, ${EZH.when(d.date)} (${formatDateDisplay(d.date)}).` : 'No bills are coming up.'; }),
  EZQ('bills_overdue', 'bills', 'data', 'Do I have any overdue bills?', 'overdue late missed unpaid bills', () => { const o = EZH.overdue(); return o.length ? 'Yes:\n' + EZH.list(o.map(i => `${i.label}: ${EZH.m(i.amount)}, was due ${formatDateDisplay(i.date)}`)) + '\n\nIf you have already paid one, tap Pay and log it so it stops showing.' : 'No, nothing is overdue.'; }, ['Open Bills', 'bills']),
  EZQ('bills_owed', 'bills', 'data', 'How much do I still owe in bills this period?', 'still to pay bills remaining owe', () => { const c = EZH.com(); return `${EZH.b(c.total)} across ${c.items.length} payment${c.items.length === 1 ? '' : 's'} before ${EZH.end()}. It is already set aside in your Free to spend.`; }),
  EZQ('bills_monthly', 'bills', 'data', 'How much are my bills each month?', 'monthly bills total cost', () => { const t0 = EZH.bills().reduce((a, b) => a + monthlySubAmt(b), 0); return EZH.bills().length ? `${EZH.b(t0)} a month across ${EZH.bills().length} bills and subscriptions (yearly and quarterly ones counted as their monthly share).` : 'You have not added any bills yet.'; }, ['Open Bills', 'bills']),
  EZQ('bill_biggest', 'bills', 'data', 'What is my most expensive bill?', 'biggest largest bill', () => { const b = EZH.bills().slice().sort((a, c) => monthlySubAmt(c) - monthlySubAmt(a))[0]; return b ? `${b.name}: ${EZH.b(b.amount)} ${b.frequency || 'monthly'}.` : 'No bills added yet.'; }),
  EZQ('bill_count', 'bills', 'data', 'How many bills do I have?', 'number of bills count', () => `${EZH.bills().length} active (${EZH.subs().length} of them subscriptions)${(state.bills || []).length > EZH.bills().length ? `, plus ${(state.bills || []).length - EZH.bills().length} paused` : ''}.`),
  EZQ('bills_paid', 'bills', 'data', 'Which bills have I paid this period?', 'paid bills done already', () => { const paid = EZH.tx().filter(x => (x.type === 'bill' || x.type === 'debt') && EZH.inP(x)); return paid.length ? 'Paid this period:\n' + EZH.list(paid.map(x => `${x.category}: ${EZH.m(x.amount)} on ${formatDateDisplay(x.date)}`)) : 'None logged as paid yet this period.'; }),
  EZQ('bills_nodate', 'bills', 'data', 'Which bills have no due date?', 'no due date missing date', () => { const n = EZH.bills().filter(b => !b.nextBillingDate); return n.length ? `${n.map(b => b.name).join(', ')}. Without a date they are not set aside or shown as due, so add one on the Bills page.` : 'Every bill has a due date.'; }, ['Open Bills', 'bills']),
  EZQ('bills_week', 'bills', 'data', 'What bills are due this week?', 'this week due bills seven days', () => { const to = EZH.day(7), d = EZH.com().items.filter(i => i.date <= to); return d.length ? EZH.list(d.map(i => `${i.label}: ${EZH.m(i.amount)}, ${EZH.when(i.date)}`)) : 'Nothing is due in the next 7 days.'; }),
  EZQ('bill_rise', 'bills', 'data', 'Did any of my bills go up in price?', 'price increase went up rise', () => { const r = EZH.bills().filter(b => (b.priceHistory || []).length).map(b => { const h = b.priceHistory[b.priceHistory.length - 1]; return `${b.name}: ${EZH.m(h.from)} to ${EZH.m(h.to)} on ${formatDateDisplay(h.date)}`; }); return r.length ? EZH.list(r) : 'No price changes recorded. When you change a bill\'s amount, I keep a note of it.'; }),
  EZQ('subs_month', 'bills', 'data', 'How much do my subscriptions cost per month?', 'subscriptions monthly cost total', () => EZH.subs().length ? `${EZH.b(totalSubMonthly())} a month across ${EZH.subs().length} subscriptions.` : 'You have no subscriptions marked yet. When you add a bill, set its Type to Subscription.'),
  EZQ('subs_year', 'bills', 'data', 'How much do my subscriptions cost per year?', 'yearly annual subscriptions', () => `${EZH.b(totalSubMonthly() * 12)} a year.`),
  EZQ('sub_biggest', 'bills', 'data', 'What is my most expensive subscription?', 'biggest subscription priciest', () => { const s = EZH.subs().slice().sort((a, b) => monthlySubAmt(b) - monthlySubAmt(a))[0]; return s ? `${s.name}: ${EZH.b(monthlySubAmt(s))} a month, ${EZH.m(annualSubAmt(s))} a year.` : 'No subscriptions added yet.'; }),
  EZQ('sub_count', 'bills', 'data', 'How many subscriptions do I have?', 'number of subscriptions', () => `${EZH.subs().length}: ${EZH.subs().map(s => s.name).join(', ') || 'none yet'}.`),

  // ═══ Budget ══════════════════════════════════════════════════════════
  EZQ('over_any', 'budget', 'data', 'Am I over budget anywhere?', 'over budget overspent categories exceeded', () => { const a = EZH.act().expenses || {}, k = EZH.share(), o = EZH.plans().filter(r => (a[r.category] || 0) > r.expected * k + .005); return o.length ? 'Yes:\n' + EZH.list(o.map(r => `${r.category}: ${EZH.m(a[r.category])} of ${EZH.m(r.expected * k)}`)) : EZH.plans().length ? 'No, every category is within its budget.' : 'You have not set any category budgets yet.'; }, ['Open Budget', 'budget']),
  EZQ('near_budget', 'budget', 'data', 'Which categories are close to their budget?', 'nearly almost close limit warning', () => { const a = EZH.act().expenses || {}, k = EZH.share(), n = EZH.plans().filter(r => { const x = (a[r.category] || 0) / (r.expected * k); return x >= .8 && x <= 1; }); return n.length ? EZH.list(n.map(r => `${r.category}: ${EZH.pct(a[r.category], r.expected * k)}% used`)) : 'None are close to their limit right now.'; }),
  EZQ('budget_left', 'budget', 'data', 'How much budget do I have left?', 'remaining budget overall left categories', () => { const a = EZH.act().expenses || {}, k = EZH.share(), plan = EZH.plans().reduce((s, r) => s + r.expected * k, 0), sp = EZH.plans().reduce((s, r) => s + (a[r.category] || 0), 0); return plan ? `${EZH.b(plan - sp)} left of ${EZH.m(plan)} budgeted across your categories this period.` : 'Set some category budgets first, on the Budget page.'; }, ['Open Budget', 'budget']),
  EZQ('budget_total', 'budget', 'data', 'What is my total monthly budget?', 'total budget all categories monthly', () => { const t0 = EZH.plans().reduce((s, r) => s + r.expected, 0); return t0 ? `${EZH.b(t0)} a month across ${EZH.plans().length} categories.` : 'No category budgets are set yet.'; }),
  EZQ('budget_list', 'budget', 'data', 'What are my budgets for each category?', 'list budgets categories amounts', () => EZH.plans().length ? 'Monthly budgets:\n' + EZH.list(EZH.plans().map(r => `${r.category}: ${EZH.m(r.expected)}`)) : 'No category budgets are set yet.'),
  EZQ('budget_none', 'budget', 'data', 'Which categories have spending but no budget?', 'no budget unplanned categories', () => { const a = EZH.act().expenses || {}, n = Object.keys(a).filter(c => a[c] > 0 && !EZH.plans().some(r => r.category === c)); return n.length ? `${n.join(', ')}. Give them a budget so your plan covers them.` : 'None: everything you spend on has a budget.'; }),
  EZQ('budget_realistic', 'budget', 'data', 'Is my budget realistic?', 'realistic plan too much enough income vs plan', () => { const inc = (state.budgets.income || []).reduce((s, r) => s + (r.expected || 0), 0), out = EZH.plans().reduce((s, r) => s + r.expected, 0) + EZH.bills().reduce((s, b) => s + monthlySubAmt(b), 0); if (!inc) return 'Add your expected income on the Budget page and I can check.'; return out <= inc ? `Yes. Your budgets and bills add up to ${EZH.m(out)} a month, inside the ${EZH.m(inc)} you expect to earn, leaving ${EZH.m(inc - out)}.` : `Not yet: budgets and bills come to ${EZH.m(out)} a month, ${EZH.m(out - inc)} more than the ${EZH.m(inc)} you expect to earn.`; }),
  EZQ('income_monthly', 'budget', 'data', 'How much income do I expect each month?', 'expected income monthly salary plan', () => { const inc = (state.budgets.income || []).filter(r => r.expected > 0); return inc.length ? EZH.list(inc.map(r => `${r.category}: ${EZH.m(r.expected)} a month`)) : 'No income is planned yet. Add it on the Budget page.'; }, ['Open Budget', 'budget']),
  EZQ('budget_share', 'budget', 'how', 'Why does my budget show less than I set?', 'share percent short period fortnight weekly smaller budget', () => EZH.share() === 1 ? 'It shows exactly what you set, because your budget period is a month.' : `Budgets are monthly, and your period is ${Math.round(EZH.share() * 30.4375)} days, so each category gets ${Math.round(EZH.share() * 100)}% of its monthly amount for this period.`),

  // ═══ Goals ═══════════════════════════════════════════════════════════
  EZQ('goals_status', 'goals', 'data', 'How are my savings goals going?', 'goals progress status', () => { const g = EZH.goals(); return g.length ? EZH.list(g.map(f => fundHasTarget(f) ? `${f.name}: ${EZH.m(f.currentSaved || 0)} of ${EZH.m(f.targetAmount)} (${Math.round(calcFund(f).pctComplete)}%)` : `${f.name}: ${EZH.m(f.currentSaved || 0)} saved`)) : 'You have no savings goals yet.'; }, ['Open Savings Goals', 'goals']),
  EZQ('saved_total', 'goals', 'data', 'How much have I saved in total?', 'total saved all goals', () => `${EZH.b(EZH.goals().reduce((a, f) => a + (f.currentSaved || 0), 0))} across ${EZH.goals().length} goal${EZH.goals().length === 1 ? '' : 's'}.`),
  EZQ('goal_closest', 'goals', 'data', 'Which goal is closest to done?', 'nearest finish almost complete', () => { const g = EZH.goals().filter(fundHasTarget).sort((a, b) => calcFund(b).pctComplete - calcFund(a).pctComplete)[0]; return g ? `${g.name}: ${Math.round(calcFund(g).pctComplete)}% there, ${EZH.m(calcFund(g).remaining)} to go.` : 'None of your goals has a target yet.'; }),
  EZQ('goal_monthly', 'goals', 'data', 'How much should I save each month for my goals?', 'monthly needed save each month required', () => { const g = EZH.goals().filter(fundHasTarget); return g.length ? `${EZH.b(g.reduce((a, f) => a + calcFund(f).requiredMonthly, 0))} a month to reach every goal by its date:\n` + EZH.list(g.map(f => `${f.name}: ${EZH.m(calcFund(f).requiredMonthly)}`)) : 'Give a goal a target and a date and I will work it out.'; }),
  EZQ('goals_track', 'goals', 'data', 'Am I on track for my goals?', 'goals on track behind', () => { const late = EZH.goals().filter(f => fundHasTarget(f) && f.targetDate && f.targetDate < EZH.today() && calcFund(f).remaining > 0); return late.length ? `${late.map(f => f.name).join(', ')} passed ${late.length === 1 ? 'its' : 'their'} date short of the target. Move the date, or lower the target.` : EZH.goals().length ? 'Yes, none of your goals is behind its date.' : 'You have no goals yet.'; }),
  EZQ('goal_emergency', 'goals', 'data', 'Do I have an emergency fund?', 'emergency fund rainy day buffer', () => { const e = EZH.goals().find(f => /emergenc|rainy|buffer/i.test(f.name)); return e ? `Yes: ${e.name} has ${EZH.b(e.currentSaved || 0)}${fundHasTarget(e) ? ` of ${EZH.m(e.targetAmount)}` : ''}.` : 'Not yet. A savings goal called Emergency fund, even with no target, is the best place to start.'; }, ['Open Savings Goals', 'goals']),

  // ═══ Debt ════════════════════════════════════════════════════════════
  EZQ('debt_total', 'debt', 'data', 'How much debt do I have?', 'total debt owe balance', () => { const d = EZH.debts(); return d.length ? `${EZH.b(d.reduce((a, x) => a + x.balance, 0))} across ${d.length} debt${d.length === 1 ? '' : 's'}:\n` + EZH.list(d.map(x => `${x.name}: ${EZH.m(x.balance)} at ${x.interestRate || 0}%`)) : 'You have no debts added. If you do have some, add them in Debt Payoff.'; }, ['Open Debt Payoff', 'debt']),
  EZQ('debt_free', 'debt', 'data', 'When will I be debt-free?', 'debt free date payoff finished clear', () => { const r = runDebtPayoff(); return r ? `${formatDateDisplay(r.debtFreeDate)}, ${r.months} months from now, if you keep to your plan${state.debtSettings.extraPayment ? ` with ${EZH.m(state.debtSettings.extraPayment)} extra a month` : ''}.` : 'Add your debts in Debt Payoff and I can tell you.'; }, ['Open Debt Payoff', 'debt']),
  EZQ('debt_interest', 'debt', 'data', 'How much interest will I pay?', 'interest cost total interest', () => { const r = runDebtPayoff(); return r ? `${EZH.b(r.totalInterest)} in interest before you are debt-free. Paying a little extra each month lowers it.` : 'Add your debts in Debt Payoff and I can work it out.'; }),
  EZQ('debt_first', 'debt', 'data', 'Which debt should I pay first?', 'first priority order focus target', () => { const r = runDebtPayoff(); if (!r) return 'Add your debts in Debt Payoff first.'; const d = (state.debts || []).find(x => x.id === r.attackOrder[0]); return `${d ? d.name : 'Your first debt'}, under your ${state.debtSettings.method} plan. Pay the minimum on everything else and put any extra there.`; }),
  EZQ('debt_highest', 'debt', 'data', 'What is my highest-interest debt?', 'highest rate apr most expensive debt', () => { const d = EZH.debts().sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0))[0]; return d ? `${d.name}, at ${d.interestRate}%. Extra money there saves you the most.` : 'No debts added yet.'; }),
  EZQ('debt_minimums', 'debt', 'data', 'How much are my minimum payments?', 'minimum payments monthly debt', () => { const d = EZH.debts(); return d.length ? `${EZH.b(d.reduce((a, x) => a + (x.minimumPayment || 0), 0))} a month in minimums.` : 'No debts added yet.'; }),
  EZQ('debt_method', 'debt', 'tip', 'Snowball or avalanche: which is better for me?', 'snowball avalanche which method better choose', 'Avalanche (highest interest first) costs the least overall. Snowball (smallest balance first) clears debts sooner, which keeps many people going. If you need the motivation, pick snowball; if you will stick with it either way, pick avalanche. Debt Payoff shows the difference for your own debts.', ['Open Debt Payoff', 'debt']),
  EZQ('debt_extra', 'debt', 'tip', 'What happens if I pay extra on my debt?', 'extra payment overpay faster', 'Every extra amount goes straight to the debt your plan targets, so it is paid off sooner and the interest drops. Set it as Extra Monthly Payment in Debt Payoff and the dates and total interest update as you type.', ['Open Debt Payoff', 'debt']),
  EZQ('debt_order', 'debt', 'data', 'What is my debt payoff order?', 'order sequence payoff list', () => { const r = runDebtPayoff(); return r ? EZH.list(r.payoffOrder.map((d, i) => `${i + 1}. ${d.name}: cleared ${d.paidOffDate}`)).replace(/- (\d+)\. /g, '$1. ') : 'Add your debts in Debt Payoff first.'; }),
  EZQ('debt_paid_mins', 'debt', 'data', 'Have I paid my debt minimums this period?', 'paid minimums debt this period', () => { const a = EZH.act().debt || {}, d = EZH.debts().filter(x => x.minimumPayment > 0); if (!d.length) return 'No debts with a minimum payment.'; const left = d.filter(x => (a[x.name] || 0) < x.minimumPayment); return left.length ? `Not all of them yet: ${left.map(x => x.name).join(', ')}.` : 'Yes, every minimum is paid this period.'; }),

  // ═══ Heads-ups ═══════════════════════════════════════════════════════
  EZQ('attention', 'alerts', 'data', 'What needs my attention?', 'notifications alerts warnings heads up problems', () => { const r = headsUpCardItems().filter(x => huBucket(x) === 'high'), all = headsUpCardItems(); return all.length ? `${all.length} thing${all.length === 1 ? '' : 's'}${r.length ? `, ${r.length} urgent` : ''}:\n` + EZH.list(all.slice(0, 5).map(x => x.title)) : 'Nothing. Everything looks fine.'; }, ['Open Notifications', 'notifications']),
  EZQ('headsup_why', 'alerts', 'how', 'Why am I seeing a heads-up?', 'heads up warning why alert', 'Each heads-up comes from a check on your period: spending pace, bills still due, overdue bills, categories over budget, goals behind and more. Tap the ? beside one to see what it means and how to fix it.', ['Open Notifications', 'notifications']),
  EZQ('headsup_pace', 'alerts', 'tip', 'What does "spending faster than planned" mean?', 'faster than planned pace warning', 'At the rate you are spending, everyday spending will pass your budgets before the period ends. Look at which categories are running hot on the Budget page, and ease off those.'),
  EZQ('badges', 'alerts', 'how', 'What do the red numbers in the menu mean?', 'badges red numbers counts menu', 'They count what needs a look in each section: bills overdue or due this week on Bills, categories over budget on Budget, unsorted spends on Transactions, goals past their date on Savings Goals. Notifications adds them all up.'),
  EZQ('headsup_ignore', 'alerts', 'how', 'How do I ignore a heads-up?', 'ignore dismiss hide alert', 'Tap Ignore on it in Notifications. It stops counting towards your badges for the rest of the period, and you can show ignored ones again any time.'),

  // ═══ Need, Want, Save ════════════════════════════════════════════════
  EZQ('alloc_split', 'alloc', 'data', 'How is my money split between needs, wants and savings?', 'split needs wants savings allocation percentages', () => { if (!toolOn('alloc')) return 'Need, Want and Save is not switched on. Turn it on in Add tools and tag your spending to see the split.'; const { totals } = computeAllocation(), inc = EZH.sum().totalIncome; return EZH.list((state.allocation.buckets || []).map(b => `${b.name}: ${EZH.m(totals[b.id] || 0)} (${EZH.pct(totals[b.id] || 0, inc)}% of income, target ${b.pct}%)`)); }),
  EZQ('rule_503020', 'alloc', 'tip', 'What is the 50/30/20 rule?', '50 30 20 rule split', 'A simple way to divide what comes in: about 50% on needs (rent, food, bills), 30% on wants (eating out, hobbies) and 20% on savings and paying off debt. Need, Want and Save in Add tools tracks it for you, and you can change the split.'),
  EZQ('alloc_tag', 'alloc', 'how', 'How do I tag spending as need, want or save?', 'tag need want save allocate', 'Turn on Need, Want and Save in Add tools. After that each spend asks for a tag, and you can tag several at once on the Transactions page.', ['Open tools', 'tools']),
  EZQ('alloc_change', 'alloc', 'how', 'How do I change my need, want, save percentages?', 'change split percentages buckets', 'In Settings, Budget Allocation: edit the names and percentages of each bucket. They need to add up to 100%.', ['Open Settings', 'settings']),

  // ═══ Using the planner: spending ═════════════════════════════════════
  EZQ('how_add_expense', 'howtx', 'how', 'How do I add an expense?', 'add log record spend expense purchase', 'Tap **+ Spend** on the dashboard (or the + button on a phone), type the amount on the keypad, tap a category, and save. That is it.', ['Log a spend', 'quickadd']),
  EZQ('how_add_income', 'howtx', 'how', 'How do I add income?', 'add income log pay received', 'Tap **+ Spend**, switch the type at the top to Income, enter the amount and pick where it came from.', ['Log it', 'quickadd']),
  EZQ('how_log_pay', 'howtx', 'how', 'How do I log my paycheck?', 'log paycheck salary payday received pay', 'When your pay lands, tap **+ Spend**, choose Income and enter the amount. Your Free to spend updates straight away.', ['Log it', 'quickadd']),
  EZQ('how_edit_tx', 'howtx', 'how', 'How do I edit a transaction?', 'edit change fix transaction amount wrong', 'Tap it in Recent activity on the dashboard and choose Edit, or tap the pencil beside it on the Transactions page.', ['Open Transactions', 'transactions']),
  EZQ('how_delete_tx', 'howtx', 'how', 'How do I delete a transaction?', 'delete remove transaction wrong mistake', 'Tap it in Recent activity and choose Delete, or tap the x beside it on the Transactions page. You get a few seconds to Undo.', ['Open Transactions', 'transactions']),
  EZQ('how_undo', 'howtx', 'how', 'How do I undo something?', 'undo undone mistake reverse oops', 'Right after you add, pay or delete something, a message appears at the bottom with Undo. Tap it before it fades.'),
  EZQ('how_bulk_delete', 'howtx', 'how', 'How do I delete several transactions at once?', 'bulk many multiple delete select all', 'On the Transactions page, tick the boxes beside them (or the box in the header for the whole page), then Delete Selected.', ['Open Transactions', 'transactions']),
  EZQ('how_search', 'howtx', 'how', 'How do I search my transactions?', 'search find look up filter', 'Use the search box at the top of the Transactions page. It matches descriptions and categories.', ['Open Transactions', 'transactions']),
  EZQ('how_filter', 'howtx', 'how', 'How do I see only one type of transaction?', 'filter type only bills only income', 'On the Transactions page, pick a type in the filter beside the search box.'),
  EZQ('how_sort_later', 'howtx', 'how', 'How do I log something and sort it later?', 'sort later uncategorized quick no category', 'When you add a spend, tap **Uncategorized · sort later** instead of a category. It waits in Notifications until you give it one.'),
  EZQ('how_categorize', 'howtx', 'how', 'How do I sort my uncategorized spending?', 'sort categorize uncategorized assign', 'Open Notifications and tap Sort them, or filter the Transactions page for Uncategorized, then edit each one and pick a category.', ['Open Transactions', 'transactions']),
  EZQ('how_note', 'howtx', 'how', 'How do I add a note to a transaction?', 'note description memo comment', 'When adding it, tap Add note. To add one later, edit the transaction and fill in Description.'),
  EZQ('how_tx_date', 'howtx', 'how', 'How do I log something from a past date?', 'past date yesterday backdate date change', 'When adding it, tap the date (it says Today) and pick the day. You can also edit a transaction and change its date.'),
  EZQ('how_refund', 'howtx', 'how', 'How do I log a refund?', 'refund return money back', 'Log it as Income with the category Refunds. It adds back to what has come in, so your Free to spend goes up.'),
  EZQ('how_cash', 'howtx', 'how', 'How do I log cash spending?', 'cash atm withdrawal', 'Log what you buy with the cash as normal expenses. If you would rather not track each one, log the cash withdrawal itself as an expense in the Cash category.'),
  EZQ('how_transfer', 'howtx', 'how', 'How do I log a transfer between my own accounts?', 'transfer move between accounts own', 'You don\'t need to: moving money between your own accounts is not spending. If it is into savings, add it to a savings goal instead.'),
  EZQ('how_again', 'howtx', 'how', 'How do I log the same thing again?', 'repeat again same duplicate copy', 'Tap it in Recent activity and choose Log again. The amount and category are filled in for you.'),
  EZQ('how_recurring', 'howtx', 'how', 'How do I set up a transaction that repeats?', 'recurring repeat automatic schedule automate', 'On the Transactions page, under Automatic Transactions, tap + Add Automatic Transaction and pick how often. Automation has to be on in Settings for it to post by itself.', ['Open Transactions', 'transactions']),
  EZQ('how_stop_recurring', 'howtx', 'how', 'How do I stop an automatic transaction?', 'stop pause automatic recurring', 'Switch its toggle off under Automatic Transactions on the Transactions page, or delete it there.'),
  EZQ('how_import', 'howtx', 'how', 'How do I import my bank statement?', 'import bank statement upload csv pdf', 'On the Transactions page tap **Import CSV or PDF** and choose the file your bank lets you download. Check the rows it finds, then add them.', ['Open Transactions', 'transactions']),
  EZQ('import_files', 'howtx', 'how', 'Which files can I import?', 'which banks files format supported', 'CSV files from any bank, and most PDF statements. CSV is the most reliable; a scanned PDF (a picture) can only be read once Ezzo is awake.'),
  EZQ('import_private', 'howtx', 'tip', 'Is importing my statement private?', 'import private safe statement data', 'Yes. The file is read on your device and is not kept, and account and card numbers are left out.'),
  EZQ('import_csv_format', 'howtx', 'how', 'What CSV format do I need?', 'csv format columns layout', 'Any bank export works: you choose which columns hold the date, description and amount. For the planner\'s own format, use Date,Type,Category,Amount,Description with a header row.'),
  EZQ('import_skipped', 'howtx', 'how', 'Why were some rows left out of my import?', 'skipped left out missing rows import', 'Pending payments, balance lines, transfers between your own accounts and anything already in your planner are left out, so nothing is counted twice.'),
  EZQ('import_dupes', 'howtx', 'how', 'What does "Already in your planner" mean?', 'already in planner duplicate import', 'That row matches a transaction you already have, so it is left out to avoid counting it twice. You can still tick it to add it.'),

  // ═══ Using the planner: budget ═══════════════════════════════════════
  EZQ('how_set_budget', 'howbud', 'how', 'How do I set a budget for a category?', 'set budget amount category limit', 'Open the Budget page, tap Edit on the category and enter its monthly budget.', ['Open Budget', 'budget']),
  EZQ('how_add_cat', 'howbud', 'how', 'How do I add a new budget category?', 'add new category create', 'On the Budget page tap **+ Add budget**, give it a name and a monthly amount.', ['Open Budget', 'budget']),
  EZQ('how_rename_cat', 'howbud', 'how', 'How do I rename a category?', 'rename category name change', 'Tap Edit on it on the Budget page and change the name. Past transactions move to the new name too.'),
  EZQ('how_delete_cat', 'howbud', 'how', 'How do I delete a category?', 'delete remove category', 'Tap Delete on it on the Budget page. Transactions that used it keep it as a label, but it is no longer tracked.'),
  EZQ('how_income_plan', 'howbud', 'how', 'How do I change my expected income?', 'expected income change salary plan', 'On the Budget page, edit the income category (like Salary) and enter what you expect each month.', ['Open Budget', 'budget']),
  EZQ('expected_vs_actual', 'howbud', 'tip', 'What is the difference between expected and actual?', 'expected actual difference planned', 'Expected is what you plan; actual is what has really been logged. The bars show how much of each budget is used.'),
  EZQ('budget_monthly_why', 'howbud', 'tip', 'Are my budgets weekly or monthly?', 'weekly monthly budgets per month', 'Monthly, always. If you are paid weekly or fortnightly, each period uses its share of every monthly budget.'),
  EZQ('budget_every_cat', 'howbud', 'tip', 'Should I budget for every category?', 'every category all need budget', 'No. Budget the ones you want to watch, usually groceries, eating out, transport and shopping. Anything without a budget is still counted in Free to spend.'),
  EZQ('how_budget_list', 'howbud', 'how', 'How do I see my budgets as a list?', 'list view cards view layout budget', 'Use the list and cards buttons at the top of the Budget page.'),
  EZQ('how_log_from_budget', 'howbud', 'how', 'Can I log spending from the Budget page?', 'log from budget category envelope', 'Yes: tap Log on a category and the spend is added straight to it.'),

  // ═══ Using the planner: bills ════════════════════════════════════════
  EZQ('how_add_bill', 'howbill', 'how', 'How do I add a bill?', 'add bill new recurring payment', 'Open Bills and tap **Add bill**: give it a name, amount, how often it comes out, and the next date it is due.', ['Open Bills', 'bills']),
  EZQ('how_pay_bill', 'howbill', 'how', 'How do I pay a bill?', 'pay bill mark paid', 'When it has left your account, tap **Pay** beside it in Coming up or on the Bills page and confirm the amount. It is logged as a transaction and stops showing as due.'),
  EZQ('how_part_pay', 'howbill', 'how', 'How do I pay part of a bill?', 'partial part pay half split', 'Tap Pay and change the amount to what you paid. The rest stays owed and shows how much is left.'),
  EZQ('how_bill_amount', 'howbill', 'how', 'What if my bill amount is different this time?', 'bill amount different changed varies', 'Tap Pay and enter what you actually paid. If the new amount is permanent, edit the bill on the Bills page.'),
  EZQ('how_edit_bill', 'howbill', 'how', 'How do I edit a bill?', 'edit bill change date amount', 'On the Bills page, tap the bill and change what you need.', ['Open Bills', 'bills']),
  EZQ('how_delete_bill', 'howbill', 'how', 'How do I delete a bill?', 'delete remove bill', 'Open it on the Bills page and tap Delete.'),
  EZQ('how_pause_bill', 'howbill', 'how', 'How do I pause a bill or subscription?', 'pause stop suspend subscription', 'Switch its Active toggle off on the Bills page. It stops counting until you switch it back on.'),
  EZQ('bill_vs_sub', 'howbill', 'tip', 'What is the difference between a bill and a subscription?', 'bill vs subscription difference', 'They work the same way; a subscription is just labelled so you can see what subscriptions add up to on their own.'),
  EZQ('how_yearly_bill', 'howbill', 'how', 'How do I add a yearly bill?', 'yearly annual quarterly bill', 'Add it as a bill and set how often to Annual (or Quarterly). It is set aside only in the period it falls due.'),
  EZQ('how_undo_pay', 'howbill', 'how', 'How do I undo a bill payment?', 'undo payment unpay paid by mistake', 'Tap Undo on the message right after paying, or delete the payment from Transactions. The bill shows as owed again.'),
  EZQ('missed_bill', 'howbill', 'tip', 'What happens if I miss a bill?', 'missed bill late fee forgot', 'It moves to the top of Coming up as overdue and stays set aside in your Free to spend. Pay it as soon as you can, then tap Pay to log it.'),
  EZQ('how_bill_calendar', 'howbill', 'how', 'Can I see my bills on a calendar?', 'calendar bills view month', 'Yes, switch on Calendar in Add tools. Every due date is marked, and you can pay from there.', ['Open Calendar', 'calendar']),

  // ═══ Using the planner: goals and debt ═══════════════════════════════
  EZQ('how_add_goal', 'howgoal', 'how', 'How do I create a savings goal?', 'create goal new saving target', 'Open Savings Goals and tap **+ Add goal**: a name, and if you like a target and a date. With both, it works out what to save each month.', ['Open Savings Goals', 'goals']),
  EZQ('how_contribute', 'howgoal', 'how', 'How do I add money to a goal?', 'add money contribute save into goal', 'Tap **Add Contribution** on the goal, or tap + Spend and choose Goal. It is taken out of your Free to spend and added to the goal.', ['Open Savings Goals', 'goals']),
  EZQ('how_withdraw', 'howgoal', 'how', 'How do I take money out of a goal?', 'withdraw take out remove money goal', 'Edit the goal and lower its saved amount, or delete a contribution from Transactions, which takes it back out of the goal.'),
  EZQ('goal_no_target', 'howgoal', 'tip', 'Can I have a goal without a target?', 'no target open ended pot', 'Yes. Leave the target empty and it is simply a pot you add to, which is ideal for an emergency fund.'),
  EZQ('how_goal_date', 'howgoal', 'how', 'How do I change a goal\'s date?', 'goal date deadline change', 'Edit the goal on the Savings Goals page and pick a new target date.'),
  EZQ('how_delete_goal', 'howgoal', 'how', 'How do I delete a goal?', 'delete goal remove', 'Open the goal on the Savings Goals page and tap Delete.'),
  EZQ('sinking_fund', 'howgoal', 'tip', 'What is a sinking fund?', 'sinking fund meaning', 'Money put aside a little at a time for a cost you know is coming, like car repairs or Christmas. A savings goal with a target and date is exactly that.'),
  EZQ('how_add_debt', 'howdebt', 'how', 'How do I add a debt?', 'add debt loan credit card', 'Open Debt Payoff and tap **+ Add debt**: the balance, the interest rate (APR) and the minimum payment.', ['Open Debt Payoff', 'debt']),
  EZQ('how_pay_debt', 'howdebt', 'how', 'How do I log a debt payment?', 'pay debt payment log', 'Tap Pay beside it in Coming up, or + Spend and choose Debt.'),
  EZQ('how_debt_extra', 'howdebt', 'how', 'How do I add an extra monthly debt payment?', 'extra monthly payment overpay', 'In Debt Payoff, enter it as the Extra Monthly Payment. It goes to whichever debt your plan targets first.', ['Open Debt Payoff', 'debt']),
  EZQ('how_mortgage', 'howdebt', 'how', 'How do I set up my mortgage?', 'mortgage home loan escrow term', 'Add it as a debt with type Mortgage, set the loan term and tap Auto-calculate for the payment. You can add escrow and an adjustable rate too.'),
  EZQ('apr_meaning', 'howdebt', 'tip', 'What is APR?', 'apr meaning annual percentage rate interest', 'The yearly interest rate on a debt. 22% APR on a credit card means roughly 22% of the balance a year in interest, charged monthly. It is on your statement.'),
  EZQ('how_schedule', 'howdebt', 'how', 'How do I see a debt\'s payment schedule?', 'schedule month by month payments', 'Tap the info button on the debt in Debt Payoff to see every month until it is paid off.'),
  EZQ('how_target_debt', 'howdebt', 'how', 'How do I put extra money on one debt?', 'target one debt specific extra', 'Use the Extra/mo column on that debt in Debt Payoff. It is paid on top of its minimum, whatever your plan\'s order.'),
  EZQ('cc_minimum', 'howdebt', 'tip', 'How is a credit card minimum payment worked out?', 'credit card minimum percent', 'Usually a percentage of the balance with a floor (like 2% or $25, whichever is higher). Set the debt\'s minimum to "% of balance" to match.'),

  // ═══ Period and pay ══════════════════════════════════════════════════
  EZQ('how_period', 'howperiod', 'how', 'How do I change my budget period?', 'change period dates range', 'Tap the dates at the top of the dashboard. Pick a month that runs from your payday, or any dates you like.', ['Change it', 'period']),
  EZQ('how_paycycle', 'howperiod', 'how', 'How do I set my pay cycle?', 'pay cycle payday rhythm fortnightly', 'Tap the dates on the dashboard and pick how your period runs: a calendar month, monthly from your payday, or set dates.', ['Change it', 'period']),
  EZQ('fortnightly', 'howperiod', 'tip', 'What if I\'m paid every two weeks?', 'every two weeks fortnightly biweekly', 'Your period can run payday to payday, two weeks at a time. Budgets stay monthly, and each period uses its share.'),
  EZQ('irregular', 'howperiod', 'tip', 'What if my income is irregular?', 'irregular freelance self employed varies', 'Run your budget by calendar month, log income as it lands, and keep a buffer in savings for slow months. Free to spend only counts money that has actually come in.'),
  EZQ('period_end', 'howperiod', 'how', 'What happens when my period ends?', 'period ends next period new', 'With "Move on to the next period by itself" on, the next period starts the day after, and with Rollover on anything left carries over.'),
  EZQ('rollover_how', 'howperiod', 'how', 'How does rollover work?', 'rollover carry over how', 'When it is on, what is left at the end of a period is added to the next one, and counts towards Free to spend. Turn it on in Settings.', ['Rollover settings', 'settings:rollover']),
  EZQ('prev_period', 'howperiod', 'how', 'How do I look at a previous period?', 'previous last period history past', 'Tap the dates on the dashboard and use the arrow to step back a period.', ['Change it', 'period']),
  EZQ('pay_late', 'howperiod', 'tip', 'What if my pay is late?', 'pay late delayed not arrived', 'Hold off on anything that can wait, and log the pay when it lands. Your bills stay set aside, so you can see what is safe in the meantime.'),
  EZQ('pay_early', 'howperiod', 'tip', 'What if I get paid early?', 'paid early before payday', 'Log it with the day it actually arrived. If that falls in the previous period, the period ending soon will count it.'),

  // ═══ Tools and the dashboard ═════════════════════════════════════════
  EZQ('tools_what', 'tools', 'how', 'What tools can I add?', 'tools extra features add more', 'Savings Goals, Debt Payoff, Calendar, Challenges, Can I afford it?, Need/Want/Save and the full dashboard. Switch any on or off in Add tools; nothing you have entered is lost.', ['Open tools', 'tools']),
  EZQ('tools_how', 'tools', 'how', 'How do I add or remove tools?', 'add remove tools switch on off', 'Tap **Add tools** in the menu, or go to Settings, Tools, and flip the switches.', ['Open tools', 'tools']),
  EZQ('calm_view', 'tools', 'tip', 'What is the calm view?', 'calm view simple dashboard', 'The dashboard with just what matters: your Free to spend, the next payments and anything urgent. "See the full picture" switches on the detailed dashboard.'),
  EZQ('full_dash', 'tools', 'how', 'How do I see the full dashboard?', 'full dashboard detailed charts more', 'Tap "See the full picture" at the bottom of the dashboard, or switch on Full dashboard in Add tools.', ['Open tools', 'tools']),
  EZQ('stats', 'tools', 'how', 'How do I see my statistics?', 'statistics stats trends charts graphs', 'With the full dashboard on, use the chart button at the top of the dashboard to switch to Statistics.'),
  EZQ('calendar_what', 'tools', 'tip', 'What is the calendar for?', 'calendar month view', 'Your month at a glance: every bill, debt payment and spend on its day, with Pay right there.', ['Open Calendar', 'calendar']),
  EZQ('challenges_what', 'tools', 'tip', 'What are Challenges?', 'challenges games', 'Small games for the moment you are about to spend. When the money wins, what you would have spent goes to a goal or a debt.', ['Open Challenges', 'challenges']),
  EZQ('coin_flip', 'tools', 'how', 'How does Coin Flip work?', 'coin flip game heads tails', 'Say what is tempting you and roughly what it costs, then flip. Heads, you skip it and the money goes to a goal or debt. Tails, enjoy it guilt free.', ['Open Challenges', 'challenges']),
  EZQ('scratch_card', 'tools', 'how', 'How does Scratch Card work?', 'scratch card weekend fun money', 'Set the most you would happily spend this weekend and scratch. It reveals how much of that is yours to spend; the rest goes to a goal or debt.', ['Open Challenges', 'challenges']),
  EZQ('spin_to_win', 'tools', 'how', 'How does Spin to Win work?', 'spin to win wheel spin save prize', 'Set the most you could put aside today and spin. The wheel splits it into six amounts, one of them 0, and whatever it lands on goes to a goal or debt.', ['Open Challenges', 'challenges']),
  EZQ('challenge_range', 'tools', 'how', 'How do I change the challenge amounts?', 'challenge range slider amounts', 'In Settings, Challenge range sets the lowest and highest amount the game sliders go to.'),
  EZQ('afford_what', 'tools', 'tip', 'What is "Can I afford it?"', 'can i afford it tool', 'Type a price before you buy and it shows straight away whether it fits today, costs you some of your days, or should wait until next period.', ['Check a purchase', 'afford']),
  EZQ('first_week', 'tools', 'tip', 'What is the first-week checklist?', 'first week checklist getting started', 'Five small steps that set the habit: set up your pay, log a spend, pay a bill, keep your budget safe, and check in again tomorrow. It ticks itself off.'),
  EZQ('first_week_hide', 'tools', 'how', 'How do I hide the first-week checklist?', 'hide checklist remove', 'Tap Hide in its top corner.'),
  EZQ('widgets', 'tools', 'how', 'What are sidebar widgets?', 'widgets sidebar notes forecast', 'Small panels under the menu on a computer: Today, Forecast, Calendar, Notes, Quick Spend and more. Tap Edit beside Widgets to choose them.'),
  EZQ('nav_position', 'tools', 'how', 'How do I move the menu?', 'menu navigation sidebar top position', 'In Settings, under Look and feel, choose where the navigation sits.', ['Open Settings', 'settings']),
  EZQ('phone_use', 'tools', 'tip', 'Can I use this on my phone?', 'phone mobile iphone android', 'Yes. Open it in your phone\'s browser and add it to your home screen. The + button at the bottom logs a spend in two taps.'),
  EZQ('guide', 'tools', 'how', 'Where is the Guide?', 'guide help manual instructions', 'Tap Guide in the menu. Each page also has a ? button with help for that page.'),
  EZQ('plus_button', 'tools', 'how', 'What does the + button do?', 'plus button add', 'It adds a transaction: a spend, a bill payment, money to a goal, a debt payment or income.', ['Log a spend', 'quickadd']),
  EZQ('keypad', 'tools', 'how', 'Why do I get a number pad instead of my keyboard?', 'number pad keypad keyboard', 'Amounts use the planner\'s own number pad on a phone, so typing money is quick and you can\'t enter letters. Tap Done when you have finished.'),

  // ═══ Settings and look ═══════════════════════════════════════════════
  EZQ('theme_change', 'settings', 'how', 'How do I change the theme?', 'theme colour appearance dark mode', 'Settings, Appearance: Light, Peachy, Dark, Vintage, Jolly or Frosty.', ['Change theme', 'settings:theme']),
  EZQ('themes_list', 'settings', 'tip', 'Which themes are there?', 'themes list options', 'Light, Peachy (soft and warm), Dark (night-time glass), Vintage (an old ledger), Jolly (clay) and Frosty (frosted glass).', ['Change theme', 'settings:theme']),
  EZQ('persona_what', 'settings', 'tip', 'What is a persona?', 'persona voice tone', 'The voice the planner talks to you in. Stiff is plain; others are Dramatic, Cheeky, Sarcastic, Rude, Concise, Zen and Optimist. Your figures never change.', ['Choose a persona', 'settings:persona']),
  EZQ('persona_change', 'settings', 'how', 'How do I change the persona?', 'change persona voice', 'Settings, Persona: tap the one you like.', ['Choose a persona', 'settings:persona']),
  EZQ('currency', 'settings', 'how', 'How do I change my currency?', 'currency dollars pounds euros symbol', 'Settings, Currency.', ['Change currency', 'settings:currency']),
  EZQ('rename_planner', 'settings', 'how', 'How do I rename my planner?', 'rename planner name title', 'Settings, Planner name (under Show all settings).', ['Open Settings', 'settings:all']),
  EZQ('full_width', 'settings', 'how', 'How do I make the planner full width?', 'full width wide layout', 'Settings, Layout width (under Show all settings).', ['Open Settings', 'settings:all']),
  EZQ('find_setting', 'settings', 'how', 'Why can\'t I find a setting?', 'missing setting hidden show all', 'Settings opens on the ones most people need. Tap **Show all settings** at the bottom for the rest.', ['Open Settings', 'settings:all']),
  EZQ('animations', 'settings', 'how', 'How do I turn off the animations?', 'animations motion turn off', 'In Settings under Show all settings, turn off the dashboard animations.'),
  EZQ('upcoming_days', 'settings', 'how', 'How do I change how far ahead Coming up looks?', 'coming up days ahead window', 'In Settings under Show all settings, Upcoming Window sets how many days ahead it looks.'),

  // ═══ Data, sync and privacy ══════════════════════════════════════════
  EZQ('data_safe', 'data', 'tip', 'Is my data safe?', 'safe secure private data privacy', 'Your budget is stored in your own browser, or in your own Google Drive if you turn on sync. There is no account and no bank login, and nothing goes to the planner\'s makers.'),
  EZQ('data_where', 'data', 'tip', 'Where is my data stored?', 'stored where location kept', () => { let g = false; try { g = syncGetMode('ubp') === 'google'; } catch (e) {} return g ? 'In your browser, and synced to your own Google Drive, so it follows you to other devices.' : 'In this browser on this device. Turn on Google Drive sync to keep it safe and use it on other devices.'; }, ['Data & Sync', 'settings:sync']),
  EZQ('sync_how', 'data', 'how', 'How do I sync my budget across devices?', 'sync devices phone laptop google drive', 'Settings, Data & Sync, choose Google Drive and sign in. Sign in with the same Google account on your other device.', ['Data & Sync', 'settings:sync']),
  EZQ('backup', 'data', 'how', 'How do I back up my budget?', 'backup backups copy safe keep', 'Turn on Google Drive sync in Settings, or use Export Data to save your transactions as a file.', ['Data & Sync', 'settings:sync']),
  EZQ('export', 'data', 'how', 'How do I export my transactions?', 'export download csv spreadsheet', 'Settings, Export Data: it downloads every transaction as a CSV you can open in a spreadsheet.', ['Export', 'settings:export']),
  EZQ('reset', 'data', 'how', 'How do I reset everything?', 'reset start over delete all wipe', 'Settings, Reset All Data (under Show all settings). It cannot be undone, so export first if you want a copy.', ['Open Settings', 'settings:all']),
  EZQ('clear_browser', 'data', 'tip', 'What happens if I clear my browser data?', 'clear browser cache cookies lost', () => { let g = false; try { g = syncGetMode('ubp') === 'google'; } catch (e) {} return g ? 'Your budget is safe in your Google Drive: sign in again and it comes back.' : 'Your budget would be wiped from this device, because it lives in the browser. Turn on Google Drive sync so a copy is always kept.'; }, ['Data & Sync', 'settings:sync']),
  EZQ('bank_connect', 'data', 'tip', 'Do you connect to my bank?', 'bank connect link open banking login', 'No, never. You log spending yourself or import a statement file, so no one gets access to your bank.'),
  EZQ('partner', 'data', 'tip', 'Can my partner use the same budget?', 'partner couple share shared together', 'Yes: turn on Google Drive sync and both sign in with the same Google account. Add their name in Settings too, so transfers between you are spotted on import.'),
  EZQ('offline', 'data', 'tip', 'Does the planner work offline?', 'offline internet no connection', 'Yes. Everything works without a connection; only sync and awake Ezzo need the internet.'),

  // ═══ Ezzo ════════════════════════════════════════════════════════════
  EZQ('ezzo_who', 'ezzo', 'tip', 'Who are you?', 'ezzo who what assistant', 'I\'m Ezzo, your budget assistant. Right now I\'m napping, so I answer the questions I already know, using your own numbers.'),
  EZQ('ezzo_asleep', 'ezzo', 'tip', 'Why are you asleep?', 'asleep sleeping why offline', 'I wake up when you add a free Gemini key in Settings. Until then I answer from what I already know, which is quite a lot.', ['Wake Ezzo', 'settings:penny']),
  EZQ('ezzo_wake', 'ezzo', 'how', 'How do I wake Ezzo up?', 'wake up key turn on online', 'Settings, Ezzo: turn him on and paste a Gemini key. "How to create my key" walks you through it, and it is free.', ['Wake Ezzo', 'settings:penny']),
  EZQ('ezzo_key_free', 'ezzo', 'tip', 'Is the Gemini key free?', 'gemini key free cost price', 'Yes. Google gives free keys with a daily limit that covers normal use. You get one in Google AI Studio.'),
  EZQ('ezzo_key_safe', 'ezzo', 'tip', 'Is my Gemini key safe?', 'key safe secure encrypted', 'It is encrypted on your device and only ever sent to Google when you ask awake Ezzo something.'),
  EZQ('ezzo_awake', 'ezzo', 'tip', 'What can you do when you are awake?', 'awake online can do features', 'Answer anything in your own words, draw charts of your spending, read bank statements and sort them into categories for you.'),
  EZQ('ezzo_typing', 'ezzo', 'tip', 'Why can\'t I send my own question?', 'type own question send button', 'While I\'m asleep I can only answer questions I already know, so pick the one closest to yours. Wake me up and you can ask anything.'),

  // ═══ Trial and purchase ══════════════════════════════════════════════
  EZQ('trial', 'account', 'tip', 'What is the free trial?', 'trial free limits', () => isTrial() ? `You are on the free trial: up to ${TRIAL_LIMITS.transactions} transactions, ${TRIAL_LIMITS.subscriptions} bill, ${TRIAL_LIMITS.sinkingFunds} goal and ${TRIAL_LIMITS.debts} debt. Unlock the full planner to remove every limit.` : 'You have the full planner, with no limits.'),
  EZQ('unlock', 'account', 'how', 'How do I unlock the full planner?', 'unlock buy purchase full version upgrade', () => isTrial() ? 'Tap Unlock when you reach a limit, or the upgrade button on the tools page. It is a one-time payment with no subscription.' : 'It is already unlocked on this device.'),
  EZQ('license', 'account', 'how', 'Where is my license key?', 'license key code activation', 'Settings, License key (under Show all settings).', ['Open Settings', 'settings:all']),
  EZQ('subscription_fee', 'account', 'tip', 'Do I have to pay every month?', 'subscription fee monthly cost price', 'No. The planner is a one-time purchase with free updates.'),
  EZQ('support', 'account', 'tip', 'How do I contact support?', 'support contact help email problem', 'Contact support with the email address you bought the planner with, and include your license key from Settings.'),

  // ═══ Money know-how ══════════════════════════════════════════════════
  EZQ('tip_start', 'tips', 'tip', 'How do I start budgeting?', 'start begin beginner new budgeting', 'Three steps: know when you are paid and how much, list the bills that come out, and log what you spend. The planner does the maths, so check your Free to spend each day.'),
  EZQ('tip_emergency', 'tips', 'tip', 'How much should I keep in an emergency fund?', 'emergency fund how much months', 'Start with one month of essentials, then build towards three to six months. Even a small pot stops a surprise bill turning into debt.'),
  EZQ('tip_impulse', 'tips', 'tip', 'How do I stop impulse buying?', 'impulse buying stop urges tempted', 'Wait 48 hours before anything you did not plan, check Can I afford it? first, and try Coin Flip: half the time the money goes to a goal instead.', ['Open Challenges', 'challenges']),
  EZQ('tip_save_more', 'tips', 'tip', 'How can I save more money?', 'save more saving money tips', 'Pay yourself first: move money to a goal on payday, not at the end. Then trim one category at a time and cancel subscriptions you rarely use.'),
  EZQ('tip_irregular_exp', 'tips', 'tip', 'How do I budget for irregular expenses?', 'irregular expenses occasional car repairs', 'Make a savings goal for each (car, gifts, vet) and add a little every period. When the bill comes, the money is waiting.'),
  EZQ('tip_low_income', 'tips', 'tip', 'How do I budget on a low income?', 'low income tight money struggling', 'Cover essentials first (housing, food, bills, minimum payments), then decide what is left day by day. Your Free to spend already sets the bills aside, so the daily figure is the one to follow.'),
  EZQ('tip_debt_faster', 'tips', 'tip', 'How do I pay off debt faster?', 'pay off debt faster quicker', 'Pay more than the minimum, even a little; put windfalls on the debt your plan targets; and ask lenders for a lower rate. Debt Payoff shows what each extra amount saves.', ['Open Debt Payoff', 'debt']),
  EZQ('tip_overspend', 'tips', 'tip', 'How do I stop overspending?', 'stop overspending control spending', 'Check your daily Free to spend before you buy, log spending as it happens, and set budgets only for the categories that get away from you.'),
  EZQ('tip_overspent', 'tips', 'tip', 'What should I do if I overspent this period?', 'overspent over budget what now recover', 'No guilt: pause flexible spending until payday, make sure the essentials are paid first, and lower next period\'s budget for that category a little.'),
  EZQ('tip_christmas', 'tips', 'tip', 'How do I plan for Christmas or birthdays?', 'christmas birthdays gifts holidays plan', 'Make a savings goal with the total and the date. It tells you how much to put away each month so December never hurts.'),
  EZQ('tip_holiday', 'tips', 'tip', 'How do I budget for a holiday?', 'holiday vacation trip travel', 'Set a savings goal with the cost and the date you leave, and add to it each payday. When you go, set a daily spending figure for the trip.'),
  EZQ('tip_cut_bills', 'tips', 'tip', 'How do I cut my bills?', 'cut bills lower reduce cheaper', 'Ring your providers once a year and ask for a better deal, switch when contracts end, and cancel anything on your Bills page you have not used in a month.'),
  EZQ('tip_subs_review', 'tips', 'tip', 'How do I review my subscriptions?', 'review subscriptions cancel audit', 'Go through your subscriptions on the Bills page: anything you have not used in a month, pause or cancel. It is usually the quickest saving there is.', ['Open Bills', 'bills']),
  EZQ('tip_zero_based', 'tips', 'tip', 'What is zero-based budgeting?', 'zero based budgeting', 'Giving every pound or dollar a job before the month starts, so income minus plans equals zero. Your monthly budgets plus "not budgeted yet" in setup work the same way.'),
  EZQ('tip_envelope', 'tips', 'tip', 'What is envelope budgeting?', 'envelope method cash envelopes', 'A fixed amount for each category, and when the envelope is empty you stop. Your category budgets are digital envelopes, showing what is left in each.'),
  EZQ('tip_check_often', 'tips', 'tip', 'How often should I check my budget?', 'how often check daily weekly', 'A quick look each day at your Free to spend, and ten minutes once a week to sort anything uncategorized.'),
  EZQ('tip_adhd', 'tips', 'tip', 'Any budgeting tips for ADHD?', 'adhd focus forget overwhelmed tips', 'Keep it to one number (your Free to spend), log spends the moment they happen, put bills on autopay where you can, and use a 48-hour wait for unplanned buys. Small daily check-ins beat big monthly reviews.'),
  EZQ('tip_payday', 'tips', 'tip', 'What should I do on payday?', 'payday routine what to do', 'Log your pay, move your savings amount into its goal straight away, check your bills are covered, and look at your new daily figure.'),
  EZQ('tip_habit', 'tips', 'tip', 'How do I build a budgeting habit?', 'habit routine consistent stick', 'Tie it to something you already do, like morning coffee: open the planner and check one number. The first-week checklist is built for exactly this.'),
  EZQ('tip_save_or_debt', 'tips', 'tip', 'Should I save or pay off debt first?', 'save or pay debt first', 'Build a small emergency fund first (about one month of essentials), then put extra towards high-interest debt, then save more.'),
  EZQ('tip_good_rate', 'tips', 'tip', 'What is a good savings rate?', 'good savings rate how much save percent', 'Around 20% of income is a common target, but any amount saved every month is a good start. Begin where you are and nudge it up.'),
  EZQ('tip_unexpected', 'tips', 'tip', 'How do I deal with an unexpected expense?', 'unexpected emergency surprise cost', 'Use your emergency fund if you have one, and log it straight away so your Free to spend shows the real picture. Then rebuild the fund a little each payday.'),
  EZQ('tip_couple', 'tips', 'tip', 'How do we budget as a couple?', 'couple partner together joint', 'Share one planner through Google Drive sync, agree on the bills and budgets together, and give each person a "no questions asked" amount for themselves.')
];

// ── Questions about the person's own things ───────────────────────────────
// One set per category, bill, goal and debt they actually have, so "how
// much on groceries" or "when is rent due" finds an answer by name.
function ezDynamicEntries() {
  if (typeof state === 'undefined' || !state) return [];
  const out = [], a = EZH.act().expenses || {}, k = EZH.share();
  const names = new Set();
  (state.budgets.expenses || []).forEach(r => { if ((r.expected || 0) > 0 || (a[r.category] || 0) > 0) names.add(r.category); });
  Object.keys(a).forEach(c => { if (a[c] > 0) names.add(c); });
  names.forEach(c => {
    const row = (state.budgets.expenses || []).find(r => r.category === c), plan = (row?.expected || 0) * k, sp = a[c] || 0;
    out.push(EZQ('cat_spent:' + c, 'budget', 'data', `How much have I spent on ${c}?`, `${c} spent spending`, () => `${EZH.b(sp)} on ${c} this period${plan ? `, of ${EZH.m(plan)} budgeted` : ''}.`));
    if (plan) out.push(EZQ('cat_left:' + c, 'budget', 'data', `How much is left in my ${c} budget?`, `${c} left remaining budget`, () => plan - sp >= 0 ? `${EZH.b(plan - sp)} left of ${EZH.m(plan)} for ${c}.` : `${c} is ${EZH.b(sp - plan)} over its ${EZH.m(plan)} budget.`));
    out[out.length - 1].name = c;
  });
  out.forEach(e => { if (!e.name) e.name = e.id.split(':')[1]; });
  EZH.bills().forEach(b => {
    out.push(Object.assign(EZQ('bill_due:' + b.id, 'bills', 'data', `When is ${b.name} due?`, `${b.name} due date next bill`, () => {
      const it = EZH.com().items.find(i => i.id === b.id);
      return b.nextBillingDate ? `${b.name} (${EZH.m(b.amount)}, ${b.frequency || 'monthly'}) is next due ${formatDateDisplay(it ? it.date : b.nextBillingDate)}${it && it.date < EZH.today() ? ', and it is overdue' : ''}.` : `${b.name} has no due date yet. Add one on the Bills page.`;
    }, ['Open Bills', 'bills']), { name: b.name }));
  });
  EZH.goals().forEach(f => {
    out.push(Object.assign(EZQ('goal:' + f.id, 'goals', 'data', `How is my ${f.name} goal going?`, `${f.name} goal progress saved`, () => {
      const c = calcFund(f);
      return fundHasTarget(f) ? `${EZH.b(f.currentSaved || 0)} of ${EZH.m(f.targetAmount)} (${Math.round(c.pctComplete)}%). ${c.remaining > 0 ? `About ${EZH.m(c.requiredMonthly)} a month gets you there${f.targetDate ? ` by ${formatDateDisplay(f.targetDate)}` : ''}.` : 'Target reached!'}` : `${EZH.b(f.currentSaved || 0)} saved so far.`;
    }, ['Open Savings Goals', 'goals']), { name: f.name }));
  });
  EZH.debts().forEach(d => {
    out.push(Object.assign(EZQ('debt:' + d.id, 'debt', 'data', `When will ${d.name} be paid off?`, `${d.name} paid off balance debt`, () => {
      const r = runDebtPayoff(), p = r && r.payoffOrder.find(x => x.id === d.id);
      return `${d.name} has ${EZH.b(d.balance)} left at ${d.interestRate || 0}%${p && p.paidOffDate !== '-' ? `, and on your plan it is cleared by ${p.paidOffDate}` : ''}.`;
    }, ['Open Debt Payoff', 'debt']), { name: d.name }));
  });
  return out;
}
