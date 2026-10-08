// A believable month for the guide films: a few weeks of everyday spending,
// three debts, the usual bills and subscriptions, and two savings goals.
// Dates are worked out from today, so the films always look current.
const pad = n => String(n).padStart(2, '0');
module.exports = function demoSeed(extra) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), td = now.getDate();
  const last = new Date(y, m + 1, 0).getDate();
  const iso = (yy, mm, dd) => { const d = new Date(yy, mm, dd); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  // A day this month, never past today (for what has already happened).
  const day = n => iso(y, m, Math.max(1, Math.min(n, td)));
  // A day from today, for what is still to come.
  const ahead = n => iso(y, m, td + n);
  const tx = (id, d, type, category, amount, description) => ({ id, date: day(d), type, category, amount, description });
  return Object.assign({
    settings: { currency: 'USD', symbol: '$', periodStart: `${y}-${pad(m + 1)}-01`, periodEnd: `${y}-${pad(m + 1)}-${pad(last)}`, language: 'en', onboardingDone: true, setupDone: true, upcoming30: true, fwHidden: true,
      tools: { goals: true, debt: true, calendar: true, challenges: true, afford: true, insights: true } },
    rollover: 0,
    budgets: { income: [{ id: 'i1', category: 'Salary', expected: 4200 }],
      expenses: [{ id: 'e1', category: 'Groceries', expected: 520 }, { id: 'e2', category: 'Eating out', expected: 180 }, { id: 'e3', category: 'Transport', expected: 160 },
        { id: 'e4', category: 'Shopping', expected: 200 }, { id: 'e5', category: 'Entertainment', expected: 90 }, { id: 'e6', category: 'Health', expected: 80 }] },
    transactions: [
      tx('t1', 1, 'income', 'Salary', 4200, 'Payday'),
      tx('t2', 1, 'bill', 'Rent', 1200, 'Rent'),
      tx('t3', 2, 'expense', 'Groceries', 84.2, 'Weekly shop'),
      tx('t4', 3, 'expense', 'Transport', 32, 'Train pass'),
      tx('t5', 4, 'expense', 'Eating out', 18.5, 'Pizza night'),
      tx('t6', 5, 'expense', 'Entertainment', 15.99, 'Cinema'),
      tx('t7', 6, 'expense', 'Groceries', 46.75, 'Farmers market'),
      tx('t8', 7, 'expense', 'Shopping', 59, 'Running shoes'),
      tx('t9', 7, 'expense', 'Eating out', 6.4, 'Coffee'),
      tx('t10', 7, 'expense', 'Health', 22.3, 'Pharmacy'),
      tx('t11', 6, 'expense', 'Groceries', 92.6, 'Big shop')
    ],
    debts: [
      { id: 'd1', name: 'Credit card', type: 'credit_card', balance: 2400, interestRate: 22.9, minimumPayment: 60, dueDay: Math.min(28, td + 5) },
      { id: 'd2', name: 'Car loan', type: 'car_loan', balance: 8600, interestRate: 6.9, minimumPayment: 245, dueDay: Math.min(28, td + 12) },
      { id: 'd3', name: 'Personal loan', type: 'personal_loan', balance: 1500, interestRate: 11.5, minimumPayment: 90, dueDay: Math.min(28, td + 16) }
    ],
    debtSettings: { method: 'avalanche', extraPayment: 0 },
    sinkingFunds: [
      { id: 'g1', name: 'Emergency fund', icon: '🛟', targetAmount: 0, currentSaved: 1250, targetDate: '' },
      { id: 'g2', name: 'New laptop', icon: '💻', targetAmount: 1400, currentSaved: 560, targetDate: iso(y, m + 6, 1) }
    ],
    bills: [
      { id: 'b1', name: 'Rent', category: 'Rent', amount: 1200, frequency: 'monthly', nextBillingDate: iso(y, m + 1, 1), active: true, kind: 'bill', payTxIds: ['t2'] },
      { id: 'b2', name: 'Electric', category: 'Utilities', amount: 87.4, frequency: 'monthly', nextBillingDate: ahead(2), active: true, kind: 'bill', payTxIds: [] },
      { id: 'b3', name: 'Phone', category: 'Utilities', amount: 45, frequency: 'monthly', nextBillingDate: ahead(9), active: true, kind: 'bill', payTxIds: [] },
      { id: 'b4', name: 'Spotify', category: 'Subscriptions', amount: 11.99, frequency: 'monthly', nextBillingDate: ahead(4), active: true, kind: 'subscription', payTxIds: [] },
      { id: 'b5', name: 'Gym', category: 'Subscriptions', amount: 39, frequency: 'monthly', nextBillingDate: ahead(13), active: true, kind: 'subscription', payTxIds: [] }
    ],
    allocation: { enabled: false, buckets: [] }
  }, extra || {});
};
