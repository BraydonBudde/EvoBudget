// A believable month for the demo: a few weeks of everyday spending.
const pad = n => String(n).padStart(2, '0');
module.exports = function demoSeed() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const day = n => `${y}-${pad(m + 1)}-${pad(Math.max(1, Math.min(n, now.getDate())))}`;
  const last = new Date(y, m + 1, 0).getDate();
  const tx = (id, d, type, category, amount, description) => ({ id, date: day(d), type, category, amount, description });
  return {
    settings: { currency: 'USD', symbol: '$', periodStart: `${y}-${pad(m + 1)}-01`, periodEnd: `${y}-${pad(m + 1)}-${pad(last)}`, language: 'en', onboardingDone: true, setupDone: true, upcoming30: true, fwHidden: true,
      tools: { goals: true, debt: true, calendar: true, challenges: true, afford: true, insights: true } },
    rollover: 0,
    budgets: { income: [{ id: 'i1', category: 'Salary', expected: 4200 }],
      expenses: [{ id: 'e1', category: 'Groceries', expected: 520 }, { id: 'e2', category: 'Eating out', expected: 180 }, { id: 'e3', category: 'Transport', expected: 160 },
        { id: 'e4', category: 'Shopping', expected: 200 }, { id: 'e5', category: 'Entertainment', expected: 90 }, { id: 'e6', category: 'Health', expected: 80 }] },
    transactions: [
      tx('t1', 1, 'income', 'Salary', 2100, 'Payday'),
      tx('t2', 1, 'bill', 'Rent', 1200, 'Rent'),
      tx('t3', 2, 'expense', 'Groceries', 84.2, 'Weekly shop'),
      tx('t4', 3, 'expense', 'Transport', 32, 'Train pass'),
      tx('t5', 4, 'expense', 'Eating out', 18.5, 'Pizza night'),
      tx('t6', 5, 'expense', 'Entertainment', 15.99, 'Netflix'),
      tx('t7', 6, 'expense', 'Groceries', 46.75, 'Farmers market'),
      tx('t8', 7, 'expense', 'Shopping', 59, 'Running shoes'),
      tx('t9', 7, 'expense', 'Eating out', 6.4, 'Coffee'),
      tx('t10', 8, 'expense', 'Health', 22.3, 'Pharmacy')
    ],
    debts: [{ id: 'd1', name: 'Card', type: 'credit_card', balance: 2400, interestRate: 22, minimumPayment: 60, dueDay: 28 }], debtSettings: { method: 'avalanche', extraPayment: 0 },
    sinkingFunds: [{ id: 'g1', name: 'Vacation', icon: '🏖️', targetAmount: 1500, currentSaved: 450, targetDate: `${y + 1}-06-01` }],
    bills: [{ id: 'b1', name: 'Rent', category: 'Rent', amount: 1200, frequency: 'monthly', nextBillingDate: `${y}-${pad(m + 2 > 12 ? 1 : m + 2)}-01`, active: true, kind: 'bill', payTxIds: ['t2'] }],
    allocation: { enabled: false, buckets: [] }
  };
};
