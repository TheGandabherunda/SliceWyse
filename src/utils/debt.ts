export interface Expense {
  id: string;
  description: string;
  amount: number;
  paidBy: string; // user id
  splitMethod: 'EQUAL' | 'EXACT' | 'PERCENTAGE';
  splits: { userId: string; amountOrPercent: number }[];
  date: number;
}

export interface Balance {
  [userId: string]: number; // Positive means they are owed money, negative means they owe money
}

// Computes the net balance for each user from a list of expenses
export const computeBalances = (expenses: Expense[]): Balance => {
  const balances: Balance = {};

  const addBalance = (userId: string, amount: number) => {
    if (!balances[userId]) balances[userId] = 0;
    balances[userId] += amount;
  };

  expenses.forEach(expense => {
    // The person who paid gets a positive balance equivalent to the total amount
    addBalance(expense.paidBy, expense.amount);

    // Each person involved in the split gets a negative balance based on their share
    expense.splits.forEach(split => {
      let owed = 0;
      if (expense.splitMethod === 'EQUAL') {
        owed = expense.amount / expense.splits.length;
      } else if (expense.splitMethod === 'EXACT') {
        owed = split.amountOrPercent;
      } else if (expense.splitMethod === 'PERCENTAGE') {
        owed = (expense.amount * split.amountOrPercent) / 100;
      }
      
      // Subtract what they owe
      addBalance(split.userId, -owed);
    });
  });

  return balances;
};

export interface Debt {
  from: string;
  to: string;
  amount: number;
}

// Simplifies debts using a greedy algorithm
export const simplifyDebts = (balances: Balance): Debt[] => {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  for (const [userId, balance] of Object.entries(balances)) {
    if (balance > 0.01) { // tolerance for floating point
      creditors.push({ id: userId, amount: balance });
    } else if (balance < -0.01) {
      debtors.push({ id: userId, amount: -balance });
    }
  }

  // Sort by largest amount first
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const debts: Debt[] = [];
  let i = 0; // debtors index
  let j = 0; // creditors index

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    
    const amountToSettle = Math.min(debtor.amount, creditor.amount);
    
    debts.push({
      from: debtor.id,
      to: creditor.id,
      amount: Number(amountToSettle.toFixed(2)) // round to 2 decimals
    });

    debtor.amount -= amountToSettle;
    creditor.amount -= amountToSettle;

    if (debtor.amount < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }

  return debts;
};
