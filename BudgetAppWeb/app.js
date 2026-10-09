const STORAGE_KEY = "budgetapp.web.v1";

const categories = {
  account: ["Cash", "Checking", "Savings", "Credit Card", "Loan", "Investment", "Other"],
  incomeFrequency: ["Weekly", "Bi-Weekly", "Monthly"],
  paymentStatus: ["Unpaid", "Pending", "Cleared"],
  transactionStatus: ["Cleared", "Pending"],
  bill: ["Housing", "Utilities", "Insurance", "Subscription", "Loan", "Credit Card", "Other"],
  debt: ["Credit Card", "Personal Loan", "Student Loan", "HELOC", "Mortgage", "Auto Loan", "Other"],
  transaction: ["Groceries", "Restaurants", "Gas", "Utilities", "Entertainment", "Shopping", "Healthcare", "Transportation", "Subscriptions", "Misc"]
};

const navItems = [
  ["dashboard", "Monthly", "$"],
  ["networth", "Net Worth", "N"],
  ["accounts", "Accounts", "A"],
  ["income", "Income", "+"],
  ["bills", "Bills", "D"],
  ["spending", "Spending", "-"],
  ["history", "History", "H"],
  ["goals", "Goals", "*"],
  ["debt", "Debt", "%"],
  ["settings", "Settings", "="]
];

const seedState = {
  hasCompletedSetup: false,
  hasSeenWalkthrough: false,
  activeView: "dashboard",
  billView: "list",
  theme: "light",
  debtStrategy: "Avalanche",
  debtExtraPayment: 0,
  lastTipsPromptDate: "",
  lastTcgplayerPromptDate: "",
  incomes: [],
  bills: [],
  debts: [],
  transactions: [],
  goals: [],
  weeklyTips: [],
  tcgplayerIncome: [],
  accounts: [],
  balanceSnapshots: [],
  monthlyHistory: [],
  lastAccountImport: null
};

const walkthroughSteps = [
  { view: "dashboard", title: "Welcome to BudgetApp", body: "This is your Monthly Dashboard, the home base for the month. It shows income, obligations, flex budget, savings rate, and runway at a glance, plus a 90-day cash flow forecast so you can see what's coming before it hits your account." },
  { view: "networth", title: "Net Worth", body: "See total assets minus liabilities and debt, track how fresh your account balances are, and view a balance trend plus a forward-looking net worth projection." },
  { view: "accounts", title: "Accounts", body: "Add or import checking, savings, credit card, and loan balances. Liability accounts can link to a debt record so both stay in sync automatically." },
  { view: "income", title: "Income", body: "Add paychecks on a weekly, bi-weekly, or monthly schedule, plus optional tips and TCGplayer income. BudgetApp will prompt you to enter those on the days you'd expect them." },
  { view: "bills", title: "Bills", body: "Track recurring bills by due date in List or Calendar view. Click a status pill to cycle it between Unpaid, Pending, and Cleared." },
  { view: "spending", title: "Spending", body: "Log discretionary spending here. Your Flex Budget is what's left after income minus bills and debt minimums, and this page tracks how much of it you've used this month." },
  { view: "history", title: "History", body: "Every time you use \"Start New Month\" on the Dashboard, a snapshot of that month's income, bills, spending, and savings rate is saved here." },
  { view: "goals", title: "Goals", body: "Set savings goals with a target amount and date, including one featured Storefront goal. BudgetApp tells you if you're on pace based on your available monthly savings." },
  { view: "debt", title: "Debt Tracker", body: "Compare Avalanche (highest interest first) vs. Snowball (smallest balance first) payoff order, and use the Payoff Planner to see how an extra monthly payment changes your debt-free date." },
  { view: "settings", title: "Settings", body: "Export or import your data as JSON, switch light/dark mode, or reset everything. Everything stays local to your device, nothing is sent anywhere." },
  { view: "dashboard", title: "That's the tour", body: "Click Help in the sidebar anytime to run through this again." }
];

let state = loadState();
let modal = null;
let hasCheckedLaunchPrompts = false;
let lastRenderedView = null;
let shouldFocusModal = false;
let tourStep = null;

function startTour() {
  tourStep = 0;
  setState({ activeView: walkthroughSteps[0].view });
}

function tourNext() {
  if (tourStep + 1 >= walkthroughSteps.length) {
    finishTour();
    return;
  }
  tourStep += 1;
  setState({ activeView: walkthroughSteps[tourStep].view });
}

function tourPrev() {
  if (tourStep <= 0) return;
  tourStep -= 1;
  setState({ activeView: walkthroughSteps[tourStep].view });
}

function finishTour() {
  // Reaching the end (as opposed to skipping) is what marks the walkthrough as seen,
  // so a skip leaves hasSeenWalkthrough false and the tour auto-launches again next run.
  tourStep = null;
  setState({ hasSeenWalkthrough: true });
}

function closeTour() {
  tourStep = null;
  render();
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toIsoDate(date) {
  // Local calendar date; toISOString() is UTC and rolls to the wrong day in the evening.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoToday() {
  return toIsoDate(new Date());
}

function addMonthsIso(months) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return toIsoDate(date);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(seedState);
    const loaded = { ...structuredClone(seedState), ...JSON.parse(raw) };
    loaded.accounts = (loaded.accounts || []).map(normalizeAccountRecord);
    loaded.balanceSnapshots = loaded.balanceSnapshots || [];
    loaded.monthlyHistory = loaded.monthlyHistory || [];
    loaded.debts = (loaded.debts || []).map((debt) => ({ ...debt, balance: Number(debt.balance || 0) }));
    if (!loaded.hasCompletedSetup && hasOnlyOriginalSampleData(loaded)) {
      return structuredClone(seedState);
    }
    return loaded;
  } catch {
    return structuredClone(seedState);
  }
}

function hasOnlyOriginalSampleData(loaded) {
  const incomeNames = loaded.incomes.map((item) => item.name).sort().join("|");
  const billNames = loaded.bills.map((item) => item.name).sort().join("|");
  const debtNames = loaded.debts.map((item) => item.name).sort().join("|");
  const goalNames = loaded.goals.map((item) => item.name).sort().join("|");
  return incomeNames === "Primary Paycheck"
    && billNames === "Phone|Rent"
    && debtNames === "Credit Card"
    && goalNames === "Emergency Fund|Storefront"
    && loaded.transactions.length === 1
    && loaded.transactions[0].note === "Groceries";
}

let backupTimer = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleBackup();
}

function scheduleBackup() {
  if (!window.budgetBridge) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    window.budgetBridge.saveBackup(JSON.stringify(state, null, 2)).catch(() => {});
  }, 1500);
}

function setState(patch) {
  state = { ...state, ...patch };
  saveState();
  render();
}

function money(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function number(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function normalizedName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function accountType(value) {
  const match = categories.account.find((item) => normalizedName(item) === normalizedName(value));
  return match || "Other";
}

function isLiquidAccount(account) {
  return ["Cash", "Checking", "Savings"].includes(account.type);
}

function isLiabilityAccount(account) {
  return ["Credit Card", "Loan"].includes(account.type);
}

function normalizeAccountRecord(account) {
  return {
    id: account.id || uid(),
    name: account.name || "Account",
    type: accountType(account.type),
    balance: Number(account.balance || 0),
    notes: account.notes || "",
    lastUpdated: account.lastUpdated || isoToday(),
    linkedDebtId: account.linkedDebtId || account.linkedDebtID || ""
  };
}

function accountSnapshotCount(account) {
  return (state.balanceSnapshots || []).filter((item) => item.accountId === account.id).length;
}

function isAccountStale(account) {
  const updated = new Date(`${account.lastUpdated || isoToday()}T00:00:00`);
  const today = new Date(`${isoToday()}T00:00:00`);
  return Math.floor((today - updated) / 86400000) >= 14;
}

function trackedDebtTotal() {
  return state.debts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
}

function accountAssetsTotal() {
  // Sum actual balances (don't floor negatives to 0) so an overdrawn account still drags the total down.
  return state.accounts.filter((item) => !isLiabilityAccount(item)).reduce((sum, item) => sum + Number(item.balance || 0), 0);
}

function unlinkedAccountLiabilitiesTotal() {
  return state.accounts
    .filter((item) => isLiabilityAccount(item) && !item.linkedDebtId)
    .reduce((sum, item) => sum + Math.abs(Number(item.balance || 0)), 0);
}

function accountLiabilitiesTotal() {
  return state.accounts.filter(isLiabilityAccount).reduce((sum, item) => sum + Math.abs(Number(item.balance || 0)), 0);
}

function cashOnHandTotal() {
  return state.accounts.filter(isLiquidAccount).reduce((sum, item) => sum + Number(item.balance || 0), 0);
}

function goalSavingsTotal() {
  return state.goals.reduce((sum, item) => sum + Number(item.currentAmount || 0), 0);
}

function availableCashTotal() {
  return Math.max(cashOnHandTotal() - goalSavingsTotal(), 0);
}

function netWorthTotal() {
  return accountAssetsTotal() - unlinkedAccountLiabilitiesTotal() - trackedDebtTotal();
}

function staleAccountCount() {
  return state.accounts.filter(isAccountStale).length;
}

function accountBalanceTimeline() {
  // Carries each account's last-known balance forward across snapshot dates so we get a running
  // total per date, not just the balance of whichever account happened to be updated that day.
  const snapshots = [...(state.balanceSnapshots || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!snapshots.length) return [];
  const dates = [...new Set(snapshots.map((item) => item.date))].sort();
  const latestByAccount = {};
  return dates.map((date) => {
    snapshots.filter((item) => item.date === date).forEach((item) => {
      latestByAccount[item.accountId] = item;
    });
    const net = Object.values(latestByAccount).reduce((sum, item) => {
      const isLiability = ["Credit Card", "Loan"].includes(item.accountType);
      return sum + (isLiability ? -Math.abs(Number(item.balance || 0)) : Number(item.balance || 0));
    }, 0);
    return { date, net };
  });
}

function findDebtForAccount(account) {
  if (account.linkedDebtId) {
    const linked = state.debts.find((debt) => debt.id === account.linkedDebtId);
    if (linked) return linked;
  }
  return state.debts.find((debt) => normalizedName(debt.name) === normalizedName(account.linkedDebtName || account.name));
}

function syncLinkedDebtBalance(account) {
  if (!isLiabilityAccount(account)) return;
  const debt = findDebtForAccount(account);
  if (!debt) return;
  account.linkedDebtId = debt.id;
  state.debts = state.debts.map((item) => item.id === debt.id ? { ...item, balance: Math.abs(Number(account.balance || 0)) } : item);
}

function createBalanceSnapshot(account, note = "") {
  state.balanceSnapshots.push({
    id: uid(),
    accountId: account.id,
    accountName: account.name,
    accountType: account.type,
    balance: Number(account.balance || 0),
    date: account.lastUpdated || isoToday(),
    note
  });
}

function importAccountsFromPayload(payload) {
  const incoming = Array.isArray(payload) ? payload : payload.accounts;
  if (!Array.isArray(incoming)) {
    throw new Error("Expected an accounts array.");
  }

  const summary = { created: 0, updated: 0, linkedDebts: 0, unlinkedLiabilities: 0, snapshots: 0 };

  incoming.forEach((rawAccount) => {
    const account = normalizeAccountRecord({
      ...rawAccount,
      linkedDebtId: rawAccount.linkedDebtId || rawAccount.linkedDebtID || ""
    });
    account.linkedDebtName = rawAccount.linkedDebtName || "";

    let existing = account.id ? state.accounts.find((item) => item.id === account.id) : null;
    if (!existing) {
      existing = state.accounts.find((item) => normalizedName(item.name) === normalizedName(account.name) && item.type === account.type);
    }

    if (isLiabilityAccount(account)) {
      const debt = findDebtForAccount(account);
      if (debt) {
        account.linkedDebtId = debt.id;
        summary.linkedDebts += 1;
      } else {
        summary.unlinkedLiabilities += 1;
      }
    }

    if (existing) {
      Object.assign(existing, account, { id: existing.id });
      summary.updated += 1;
      syncLinkedDebtBalance(existing);
      createBalanceSnapshot(existing, "Imported from account screenshot data");
    } else {
      state.accounts.push(account);
      summary.created += 1;
      syncLinkedDebtBalance(account);
      createBalanceSnapshot(account, "Imported from account screenshot data");
    }
    summary.snapshots += 1;
  });

  state.lastAccountImport = { date: isoToday(), ...summary };
  return summary;
}

function importAccountFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const summary = importAccountsFromPayload(JSON.parse(reader.result));
        saveState();
        alert(`Imported accounts.\nCreated: ${summary.created}\nUpdated: ${summary.updated}\nLinked debts: ${summary.linkedDebts}\nUnlinked liabilities: ${summary.unlinkedLiabilities}\nSnapshots: ${summary.snapshots}`);
        render();
      } catch (error) {
        alert(`That account file could not be imported. ${error.message || ""}`);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function frequencyMultiplier(frequency) {
  // Average months have 52/12 weeks, not 4 — using 4 understates monthly income by ~8%.
  if (frequency === "Weekly") return 52 / 12;
  if (frequency === "Bi-Weekly") return 26 / 12;
  return 1;
}

function monthlyIncome(income) {
  return Number(income.amount || 0) * frequencyMultiplier(income.frequency);
}

function totalMonthlyIncome() {
  return state.incomes.filter((item) => item.isActive).reduce((sum, item) => sum + monthlyIncome(item), 0)
    + weeklyTipsThisMonth()
    + tcgplayerIncomeThisMonth();
}

function weeklyTipsThisMonth() {
  return (state.weeklyTips || []).filter((item) => isThisMonth(item.weekStartDate)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function tcgplayerIncomeThisMonth() {
  return (state.tcgplayerIncome || []).filter((item) => isThisMonth(item.date)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function totalMonthlyBills() {
  return state.bills.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function totalDebtPayments() {
  return state.debts.reduce((sum, item) => sum + Number(item.minimumPayment || 0), 0);
}

function flexBudget() {
  return totalMonthlyIncome() - totalMonthlyBills() - totalDebtPayments();
}

function monthlyObligationItems() {
  return [
    ...state.bills.map((item) => ({
      id: item.id,
      name: item.name,
      amount: Number(item.amount || 0),
      kind: item.category,
      dueDay: item.dueDay,
      paymentStatus: paymentStatus(item),
      isPaid: isPaidOrPending(item),
      isPending: isPendingPayment(item),
      isCleared: isClearedPayment(item),
      isDebt: false
    })),
    ...state.debts.map((item) => ({
      id: item.id,
      name: item.name,
      amount: Number(item.minimumPayment || 0),
      kind: item.type,
      dueDay: item.dueDay,
      paymentStatus: paymentStatus(item),
      isPaid: isPaidOrPending(item),
      isPending: isPendingPayment(item),
      isCleared: isClearedPayment(item),
      isDebt: true
    }))
  ].sort((a, b) => Number(a.dueDay) - Number(b.dueDay));
}

function paymentStatus(item) {
  if (item.paymentStatus) return item.paymentStatus;
  return item.isPaid ? "Cleared" : "Unpaid";
}

function isPendingPayment(item) {
  return paymentStatus(item) === "Pending";
}

function isClearedPayment(item) {
  return paymentStatus(item) === "Cleared";
}

function isPaidOrPending(item) {
  return paymentStatus(item) !== "Unpaid";
}

function paidObligationsTotal() {
  return monthlyObligationItems().filter((item) => item.isPaid).reduce((sum, item) => sum + item.amount, 0);
}

function pendingObligationsTotal() {
  return monthlyObligationItems().filter((item) => item.isPending).reduce((sum, item) => sum + item.amount, 0);
}

function unpaidObligationsTotal() {
  return monthlyObligationItems().filter((item) => !item.isPaid).reduce((sum, item) => sum + item.amount, 0);
}

function isThisMonth(dateValue) {
  // Parse date-only strings as local time; "YYYY-MM-DD" alone parses as UTC
  // and shifts to the previous day in western timezones.
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function thisMonthTransactions() {
  return state.transactions.filter((item) => isThisMonth(item.date));
}

function spentThisMonth() {
  return thisMonthTransactions().reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function transactionStatus(item) {
  return item.transactionStatus || (item.isPending ? "Pending" : "Cleared");
}

function isPendingTransaction(item) {
  return transactionStatus(item) === "Pending";
}

function pendingTransactionsThisMonth() {
  return thisMonthTransactions().filter(isPendingTransaction);
}

function pendingTransactionTotal() {
  return pendingTransactionsThisMonth().reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function remainingFlex() {
  return flexBudget() - spentThisMonth();
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function buildMonthSnapshot() {
  const income = totalMonthlyIncome();
  const billsAndDebt = totalMonthlyBills() + totalDebtPayments();
  const spent = spentThisMonth();
  const remaining = income - billsAndDebt - spent;
  return {
    id: uid(),
    month: currentMonthKey(),
    recordedDate: isoToday(),
    income,
    billsAndDebt,
    spent,
    remainingFlex: remaining,
    savingsRate: income > 0 ? remaining / income : 0
  };
}

function remainingDailyBudget() {
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - today.getDate() + 1;
  return remainingDays > 0 ? remainingFlex() / remainingDays : 0;
}

function currentSavingsRate() {
  const income = totalMonthlyIncome();
  return income > 0 ? remainingFlex() / income : 0;
}

function averageFlexSpending() {
  const rows = (state.monthlyHistory || []).slice(-3);
  return rows.length ? rows.reduce((sum, item) => sum + item.spent, 0) / rows.length : spentThisMonth();
}

function runwayMonths() {
  const monthlyBurn = totalMonthlyBills() + totalDebtPayments() + averageFlexSpending();
  return monthlyBurn > 0 ? cashOnHandTotal() / monthlyBurn : Infinity;
}

function cashFlowForecast(horizonDays = 90) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMonthKey = currentMonthKey(start);
  const dailyVariableIncome = state.incomes
    .filter((item) => item.isActive && item.frequency !== "Monthly")
    .reduce((sum, item) => sum + monthlyIncome(item) / 30, 0);
  const monthlyIncomes = state.incomes.filter((item) => item.isActive && item.frequency === "Monthly");
  const allObligations = monthlyObligationItems();
  // The in-progress month only owes what's still unpaid; every later month is assumed to recur in
  // full, since "Start New Month" resets paid status back to Unpaid for the next cycle.
  const currentCycleObligations = allObligations.filter((item) => !item.isPaid);

  let runningBalance = cashOnHandTotal();
  const days = [];
  for (let offset = 0; offset < horizonDays; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const daysInThisMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const isStartingCycle = currentMonthKey(date) === startMonthKey;
    const obligationsForDay = isStartingCycle ? currentCycleObligations : allObligations;

    let inflow = dailyVariableIncome;
    monthlyIncomes.forEach((item) => {
      if (clampDueDay(item.payDay || 1, daysInThisMonth) === date.getDate()) inflow += Number(item.amount || 0);
    });
    let outflow = 0;
    obligationsForDay.forEach((item) => {
      if (clampDueDay(item.dueDay, daysInThisMonth) === date.getDate()) outflow += Number(item.amount || 0);
    });

    runningBalance += inflow - outflow;
    days.push({ date: toIsoDate(date), balance: runningBalance, inflow, outflow });
  }
  return days;
}

function nextDueDate(dueDay) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = Math.min(Math.max(Number(dueDay || 1), 1), 31);
  // Clamp to the last day of the month so due day 31 lands on Jun 30, not Jul 1.
  const dueInMonth = (m) => new Date(year, m, Math.min(day, new Date(year, m + 1, 0).getDate()));
  let due = dueInMonth(month);
  if (today.getDate() > due.getDate()) due = dueInMonth(month + 1);
  return due;
}

function daysUntilDue(dueDay) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const due = nextDueDate(dueDay);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - start) / 86400000);
}

function daysUntilDate(dateValue) {
  // Parse as local date, matching the isThisMonth/toIsoDate convention elsewhere in this file.
  const target = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  const today = new Date(`${isoToday()}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function expiringPromotions(daysThreshold) {
  return state.debts
    .filter((debt) => debt.hasPromotion && debt.promoExpirationDate && Number(debt.balance || 0) > 0)
    .map((debt) => ({ ...debt, daysUntilExpiration: daysUntilDate(debt.promoExpirationDate) }))
    .filter((debt) => debt.daysUntilExpiration <= daysThreshold)
    .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
}

function debtMonthlyInterest(debt) {
  return Number(debt.balance || 0) * (Number(debt.interestRate || 0) / 100 / 12);
}

function monthsToPayoff(debt, payment = debt.minimumPayment) {
  const monthlyRate = Number(debt.interestRate || 0) / 100 / 12;
  let balance = Number(debt.balance || 0);
  let months = 0;
  if (balance <= 0) return 0;
  if (Number(payment || 0) <= balance * monthlyRate) return -1;
  while (balance > 0 && months < 600) {
    const interest = balance * monthlyRate;
    balance -= Number(payment || 0) - interest;
    months += 1;
  }
  return months;
}

function totalInterest(debt, payment = debt.minimumPayment) {
  const monthlyRate = Number(debt.interestRate || 0) / 100 / 12;
  let balance = Number(debt.balance || 0);
  let interestPaid = 0;
  let months = 0;
  if (balance <= 0) return 0;
  if (Number(payment || 0) <= balance * monthlyRate) return -1;
  while (balance > 0 && months < 600) {
    const interest = balance * monthlyRate;
    interestPaid += interest;
    balance -= Number(payment || 0) - interest;
    months += 1;
  }
  return interestPaid;
}

function sortedDebtsByStrategy() {
  return [...state.debts].sort((a, b) => state.debtStrategy === "Avalanche" ? Number(b.interestRate) - Number(a.interestRate) : Number(a.balance) - Number(b.balance));
}

function simulateDebtPayoff(debts, extraPayment) {
  // Cascades one combined pool of "minimum payments + extra" across debts in the given order:
  // once a debt hits zero, its minimum payment joins the pool for the next debt in line.
  const working = debts.filter((debt) => Number(debt.balance || 0) > 0).map((debt) => ({
    id: debt.id,
    balance: Number(debt.balance || 0),
    monthlyRate: Number(debt.interestRate || 0) / 100 / 12,
    minPayment: Number(debt.minimumPayment || 0)
  }));
  if (!working.length) return { months: 0, totalInterest: 0, payoffMonth: {}, interestByMonth: [] };

  let snowball = Number(extraPayment || 0);
  let months = 0;
  let totalInterestPaid = 0;
  const payoffMonth = {};
  const interestByMonth = [];

  while (working.some((debt) => debt.balance > 0) && months < 600) {
    months += 1;
    let monthInterest = 0;
    const targetIndex = working.findIndex((debt) => debt.balance > 0);
    working.forEach((debt, index) => {
      if (debt.balance <= 0) return;
      const interest = debt.balance * debt.monthlyRate;
      monthInterest += interest;
      totalInterestPaid += interest;
      debt.balance += interest;
      const payment = Math.min(debt.balance, debt.minPayment + (index === targetIndex ? snowball : 0));
      debt.balance -= payment;
      if (debt.balance <= 0.005) {
        debt.balance = 0;
        payoffMonth[debt.id] = months;
        snowball += debt.minPayment;
      }
    });
    interestByMonth.push(monthInterest);
  }
  return { months, totalInterest: totalInterestPaid, payoffMonth, interestByMonth };
}

function availableMonthlySavings() {
  // What's left after bills, debt minimums, typical discretionary spending, and any planned extra
  // debt payment — the pool that would otherwise just sit as cash, available to project forward.
  return Math.max(flexBudget() - averageFlexSpending() - Number(state.debtExtraPayment || 0), 0);
}

function netWorthProjectionHorizonMonths() {
  const goalMonths = state.goals.map((goal) => goalStats(goal).monthsRemaining);
  return Math.min(60, Math.max(24, ...goalMonths, 1));
}

function netWorthProjection() {
  const horizonMonths = netWorthProjectionHorizonMonths();
  const debts = sortedDebtsByStrategy().filter((debt) => Number(debt.balance || 0) > 0);
  const simulation = simulateDebtPayoff(debts, Number(state.debtExtraPayment || 0));
  const income = totalMonthlyIncome();
  const bills = totalMonthlyBills();
  const spending = averageFlexSpending();
  const today = new Date();

  // Debt principal payments are net-worth-neutral (cash moves to reduce a liability 1:1) —
  // only interest actually costs anything, so it's the sole debt-related term below.
  let netWorth = netWorthTotal();
  const points = [];
  for (let month = 1; month <= horizonMonths; month++) {
    const interest = simulation.interestByMonth[month - 1] || 0;
    netWorth += income - bills - spending - interest;
    const date = new Date(today.getFullYear(), today.getMonth() + month, 1);
    points.push({ month, date: toIsoDate(date), netWorth });
  }
  return points;
}

function goalProjection(goal) {
  const stats = goalStats(goal);
  const pace = availableMonthlySavings();
  const monthsToReach = pace > 0 ? Math.ceil(stats.remaining / pace) : Infinity;
  return { monthsToReach, aheadMonths: stats.monthsRemaining - monthsToReach };
}

function goalStats(goal) {
  const target = Number(goal.targetAmount || 0);
  const current = Number(goal.currentAmount || 0);
  const progress = target > 0 ? Math.min(current / target, 1) : 0;
  const remaining = Math.max(target - current, 0);
  const today = new Date();
  // Parse as local dates — new Date("YYYY-MM-DD") parses as UTC and can roll to the wrong month
  // in timezones behind UTC, same pitfall noted for isThisMonth() elsewhere in this file.
  const targetDate = new Date(`${String(goal.targetDate).slice(0, 10)}T00:00:00`);
  const monthsRemaining = Math.max((targetDate.getFullYear() - today.getFullYear()) * 12 + targetDate.getMonth() - today.getMonth(), 1);
  const created = new Date(`${String(goal.createdDate || isoToday()).slice(0, 10)}T00:00:00`);
  const totalMonths = Math.max((targetDate.getFullYear() - created.getFullYear()) * 12 + targetDate.getMonth() - created.getMonth(), 1);
  const elapsedMonths = Math.max((today.getFullYear() - created.getFullYear()) * 12 + today.getMonth() - created.getMonth(), 0);
  const expected = elapsedMonths / totalMonths;
  const isOnTrack = progress >= expected * 0.9;
  return {
    progress,
    remaining,
    monthsRemaining,
    monthlyNeeded: remaining / monthsRemaining,
    weeklyNeeded: remaining / monthsRemaining / 4,
    status: progress >= 1 ? "Complete" : isOnTrack ? "On Track" : "Behind",
    isOnTrack
  };
}

function currentWeekStart() {
  const today = new Date();
  const weekday = today.getDay();
  const daysFromFriday = weekday >= 5 ? weekday - 5 : weekday + 2;
  const result = new Date(today);
  result.setDate(today.getDate() - daysFromFriday);
  result.setHours(0, 0, 0, 0);
  return toIsoDate(result);
}

function isThursday() {
  return new Date().getDay() === 4;
}

function isTcgplayerPromptDay() {
  const day = new Date().getDay();
  return day === 1 || day === 3;
}

function shouldPromptForWeeklyTips() {
  const hasTipsIncome = state.incomes.some((item) => item.isActive && item.includeTips);
  const currentTips = state.weeklyTips.find((item) => item.weekStartDate === currentWeekStart());
  return state.hasCompletedSetup
    && isThursday()
    && hasTipsIncome
    && !currentTips
    && state.lastTipsPromptDate !== isoToday();
}

function shouldPromptForTcgplayerIncome() {
  return state.hasCompletedSetup
    && isTcgplayerPromptDay()
    && state.lastTcgplayerPromptDate !== isoToday();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function render() {
  if (!hasCheckedLaunchPrompts) {
    hasCheckedLaunchPrompts = true;
    if (shouldPromptForWeeklyTips()) {
      modal = { type: "tips", id: null, item: {}, storefront: false };
      state.lastTipsPromptDate = isoToday();
      saveState();
    } else if (shouldPromptForTcgplayerIncome()) {
      modal = { type: "tcgplayer", id: null, item: {}, storefront: false };
      state.lastTcgplayerPromptDate = isoToday();
      saveState();
    }
    if (state.hasCompletedSetup && !state.hasSeenWalkthrough) {
      tourStep = 0;
    }
  }

  document.documentElement.dataset.theme = state.theme === "dark" ? "dark" : "light";
  const previousScrollY = window.scrollY;
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">$</span><span>BudgetApp</span></div>
        <nav class="nav">
          ${navItems.map(([id, label, icon]) => `<button class="${state.activeView === id ? "active" : ""}" data-view="${id}"><span>${icon}</span><span>${label}</span></button>`).join("")}
        </nav>
        ${state.hasCompletedSetup ? `<button class="help-btn" type="button" data-action="start-tour"><span>?</span><span>Help</span></button>` : ""}
      </aside>
      <main class="main">${renderView()}</main>
      ${modal ? renderModal() : ""}
      ${renderTour()}
    </div>
  `;
  bindEvents();
  window.scrollTo(0, lastRenderedView === state.activeView ? previousScrollY : 0);
  lastRenderedView = state.activeView;
  if (shouldFocusModal && modal) {
    shouldFocusModal = false;
    document.querySelector(".modal-body input, .modal-body select, .modal-body textarea")?.focus();
  }
}

function page(title, subtitle, actions, body) {
  return `
    <div class="topbar">
      <div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
      <div class="actions">${actions || ""}</div>
    </div>
    ${body}
  `;
}

function renderView() {
  if (!state.hasCompletedSetup) return renderSetup();
  if (state.activeView === "networth") return renderNetWorth();
  if (state.activeView === "accounts") return renderAccounts();
  if (state.activeView === "income") return renderIncome();
  if (state.activeView === "bills") return renderBills();
  if (state.activeView === "spending") return renderSpending();
  if (state.activeView === "history") return renderHistory();
  if (state.activeView === "goals") return renderGoals();
  if (state.activeView === "debt") return renderDebt();
  if (state.activeView === "settings") return renderSettings();
  return renderDashboard();
}

function metric(label, value, className = "") {
  return `<section class="card metric"><div class="label">${label}</div><div class="value ${className}">${value}</div></section>`;
}

function svgLineChart(points) {
  if (points.length < 2) return "";
  const width = 640;
  const height = 160;
  const padding = 14;
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const stepX = (width - padding * 2) / (points.length - 1);
  const coords = points.map((point, index) => ({
    x: padding + stepX * index,
    y: height - padding - ((point.value - min) / range) * (height - padding * 2),
    ...point
  }));
  const path = coords.map((c, index) => `${index === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);
  const dots = coords.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" class="chart-dot"><title>${escapeHtml(c.label)}: ${escapeHtml(money(c.value))}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <line x1="${padding}" y1="${zeroY.toFixed(1)}" x2="${width - padding}" y2="${zeroY.toFixed(1)}" class="chart-zero" />
    <path d="${path}" class="chart-line" />
    ${dots}
  </svg>`;
}

function renderDashboard() {
  const obligations = monthlyObligationItems();
  const upcoming = obligations.filter((item) => !item.isPaid).map((item) => ({ ...item, days: daysUntilDue(item.dueDay) })).sort((a, b) => a.days - b.days).slice(0, 6);
  const remainingObligations = obligations.filter((item) => !item.isPaid);
  const storefront = state.goals.find((goal) => goal.isStorefrontGoal);
  const tipsIncome = state.incomes.some((item) => item.isActive && item.includeTips);
  const currentTips = state.weeklyTips.find((item) => item.weekStartDate === currentWeekStart());
  const tcgplayerCard = isTcgplayerPromptDay() ? `
    <section class="card pad">
      <div class="section-head" style="padding:0 0 12px;border-bottom:0">
        <h2>TCGplayer income</h2>
        <button class="btn primary" data-modal="tcgplayer">Enter Income</button>
      </div>
      <p style="margin:0;color:var(--muted)">Record today's TCGplayer payout.</p>
    </section>` : "";
  const tipsCard = tipsIncome && !currentTips ? `
    <section class="card pad">
      <div class="section-head" style="padding:0 0 12px;border-bottom:0">
        <h2>Weekly tips</h2>
        <button class="btn primary" data-modal="tips">Enter Tips</button>
      </div>
      <p style="margin:0;color:var(--muted)">Add this week's tips so income projections stay current.</p>
    </section>` : "";

  const promoBanner = renderPromoWarnings(30);
  return page("Monthly Dashboard", new Date().toLocaleDateString(), `<button class="btn" data-action="new-month">Start New Month</button>`, `
    <div class="grid metrics wide-metrics">
      ${metric("Monthly Income", money(totalMonthlyIncome()), "positive")}
      ${metric("Monthly Obligations", money(totalMonthlyBills() + totalDebtPayments()), "negative")}
      ${metric("Flex Budget", money(flexBudget()), flexBudget() >= 0 ? "positive" : "negative")}
      ${metric("Savings Rate", `${Math.round(currentSavingsRate() * 100)}%`, currentSavingsRate() >= 0.2 ? "positive" : currentSavingsRate() >= 0 ? "warning" : "negative")}
      ${metric("Runway", Number.isFinite(runwayMonths()) ? `${runwayMonths().toFixed(1)} mo` : "—", !Number.isFinite(runwayMonths()) || runwayMonths() >= 3 ? "positive" : "warning")}
    </div>
    <div style="height:14px"></div>
    ${promoBanner}
    <div style="height:${promoBanner ? 14 : 0}px"></div>
    ${tipsCard}
    <div style="height:${tipsCard ? 14 : 0}px"></div>
    ${tcgplayerCard}
    <div style="height:${tcgplayerCard ? 14 : 0}px"></div>
    <div class="grid two">
      <section class="card pad">
        <div class="section-label">Available to spend</div>
        <div class="value ${remainingFlex() >= 0 ? "positive" : "negative"}" style="font-size:42px;font-weight:850;margin:8px 0">${money(remainingFlex())}</div>
        <div class="grid metrics">
          ${metric("Daily", money(remainingDailyBudget()), remainingDailyBudget() >= 0 ? "positive" : "negative")}
          ${metric("Weekly", money(flexBudget() / 4), flexBudget() >= 0 ? "positive" : "negative")}
          ${metric("Spent This Month", money(spentThisMonth()))}
          ${metric("Pending In Account", money(pendingTransactionTotal()), pendingTransactionTotal() > 0 ? "warning" : "positive")}
        </div>
      </section>
      <section class="card">
        <div class="section-head"><h2>Upcoming</h2><span class="pill">${upcoming.length}</span></div>
        <div class="list">${upcoming.length ? upcoming.map(renderUpcomingRow).join("") : `<div class="empty">Nothing due soon.</div>`}</div>
      </section>
    </div>
    <div style="height:14px"></div>
    ${renderCashFlowForecast()}
    <div style="height:14px"></div>
    <section class="card">
      <div class="section-head"><h2>Monthly Bills Progress</h2><button class="btn" data-view="bills">Open Bills</button></div>
      <div class="grid metrics" style="padding:14px">
        ${metric("Paid This Month", money(paidObligationsTotal()), "positive")}
        ${metric("Pending Withdrawals", money(pendingObligationsTotal()), pendingObligationsTotal() > 0 ? "warning" : "positive")}
        ${metric("Still Needs Paid", money(unpaidObligationsTotal()), unpaidObligationsTotal() > 0 ? "warning" : "positive")}
        ${metric("Total Obligations", money(paidObligationsTotal() + unpaidObligationsTotal()))}
      </div>
      <div class="list">${remainingObligations.length ? remainingObligations.slice(0, 8).map(renderRemainingObligationRow).join("") : `<div class="empty">All monthly bills are marked paid.</div>`}</div>
    </section>
    <div style="height:14px"></div>
    <div class="grid two">
      <section class="card">
        <div class="section-head"><h2>Spending by Category</h2><button class="btn" data-view="spending">Open</button></div>
        <div class="list">${renderCategoryRows()}</div>
      </section>
      <section class="card pad">
        <div class="section-head" style="padding:0 0 12px;border-bottom:0"><h2>Storefront Goal</h2><button class="btn" data-view="goals">Open</button></div>
        ${storefront ? renderGoalSummary(storefront) : `<div class="empty">No storefront goal yet.</div>`}
      </section>
    </div>
  `);
}

function renderCashFlowForecast() {
  const horizonDays = 90;
  const days = cashFlowForecast(horizonDays);
  if (!days.length) return "";
  const lowestPoint = days.reduce((min, item) => item.balance < min.balance ? item : min, days[0]);
  const firstNegative = days.find((item) => item.balance < 0);
  const eventDays = days.filter((item) => item.inflow > 0 || item.outflow > 0);
  const visibleEvents = eventDays.slice(0, 20);
  const points = days.map((item) => ({ label: formatDate(item.date), value: item.balance }));
  return `<section class="card pad">
    <div class="section-head" style="padding:0 0 12px;border-bottom:0">
      <h2>Cash Flow Forecast</h2>
      <span class="${firstNegative ? "negative" : "positive"}">${firstNegative ? `Dips negative on ${formatDate(firstNegative.date)}` : `Stays positive over the next ${horizonDays} days`}</span>
    </div>
    <div class="grid metrics">
      ${metric("Starting Cash", money(cashOnHandTotal()))}
      ${metric("Lowest Projected", money(lowestPoint.balance), lowestPoint.balance >= 0 ? "positive" : "negative")}
      ${metric("Lowest On", formatDate(lowestPoint.date))}
    </div>
    <div style="height:14px"></div>
    ${svgLineChart(points)}
    <div style="height:10px"></div>
    <div class="list">${visibleEvents.length ? visibleEvents.map((item) => `
      <div class="row">
        <div class="row-main"><div class="row-title">${formatDate(item.date)}</div><div class="row-sub">${[item.inflow > 0 ? `+${money(item.inflow)} income` : "", item.outflow > 0 ? `-${money(item.outflow)} due` : ""].filter(Boolean).join(" · ")}</div></div>
        <div class="row-value ${item.balance >= 0 ? "" : "negative"}">${money(item.balance)}</div>
      </div>`).join("") : `<div class="empty">No projected income or bills over the next ${horizonDays} days.</div>`}</div>
    ${eventDays.length > visibleEvents.length ? `<p style="margin:10px 0 0;color:var(--muted);font-size:13px">+${eventDays.length - visibleEvents.length} more projected events beyond this list.</p>` : ""}
    <p style="margin:10px 0 0;color:var(--muted);font-size:13px">Projects known bill/debt due dates and paychecks ${horizonDays} days out, assuming bills recur monthly and this cycle's paid/unpaid status only applies to the current month. Day-to-day discretionary spending isn't included.</p>
  </section>`;
}

function renderRemainingObligationRow(item) {
  const days = daysUntilDue(item.dueDay);
  const pillClass = days <= 2 ? "red" : days <= 7 ? "orange" : item.isDebt ? "purple" : "";
  return `<div class="row">
    <div class="row-main"><div class="row-title">${escapeHtml(item.name)}</div><div class="row-sub">${escapeHtml(item.kind)} · due day ${item.dueDay}</div></div>
    <div><div class="row-value">${money(item.amount)}</div><span class="pill ${pillClass}">${days === 0 ? "Today" : `${days} days`}</span></div>
  </div>`;
}

function renderUpcomingRow(item) {
  const pillClass = item.days <= 2 ? "red" : item.days <= 7 ? "orange" : item.isDebt ? "purple" : "";
  return `<div class="row">
    <div class="row-main"><div class="row-title">${escapeHtml(item.name)}</div><div class="row-sub">${escapeHtml(item.kind)} · due day ${item.dueDay}</div></div>
    <div><div class="row-value">${money(item.amount)}</div><span class="pill ${pillClass}">${item.days === 0 ? "Today" : `${item.days} days`}</span></div>
  </div>`;
}

function renderCategoryRows() {
  const grouped = {};
  thisMonthTransactions().forEach((item) => {
    grouped[item.category] = (grouped[item.category] || 0) + Number(item.amount || 0);
  });
  const rows = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  return rows.length ? rows.map(([name, value]) => `<div class="row"><div class="row-title">${escapeHtml(name)}</div><div class="row-value">${money(value)}</div></div>`).join("") : `<div class="empty">No spending logged this month.</div>`;
}

function renderNetWorth() {
  const recentAccounts = state.accounts.slice().sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated)).slice(0, 8);
  const linkedDebtAccounts = state.accounts.filter((account) => isLiabilityAccount(account) && account.linkedDebtId);
  const unlinkedLiabilities = state.accounts.filter((account) => isLiabilityAccount(account) && !account.linkedDebtId);
  return page("Net Worth", "Assets, liabilities, linked debt accounts, and balance freshness.", `
    <button class="btn" data-action="import-accounts">Import Accounts</button>
    <button class="btn primary" data-view="accounts">Open Accounts</button>`, `
    <div class="grid metrics wide-metrics">
      ${metric("Net Worth", money(netWorthTotal()), netWorthTotal() >= 0 ? "positive" : "negative")}
      ${metric("Cash On Hand", money(cashOnHandTotal()), "positive")}
      ${metric("Available Cash", money(availableCashTotal()), availableCashTotal() > 0 ? "positive" : "warning")}
      ${metric("Account Assets", money(accountAssetsTotal()), "positive")}
      ${metric("Unlinked Liabilities", money(unlinkedAccountLiabilitiesTotal()), unlinkedAccountLiabilitiesTotal() > 0 ? "negative" : "positive")}
      ${metric("Debt Tracked", money(trackedDebtTotal() + unlinkedAccountLiabilitiesTotal()), trackedDebtTotal() > 0 ? "negative" : "positive")}
    </div>
    <div style="height:14px"></div>
    <div class="grid two">
      <section class="card">
        <div class="section-head"><h2>Balance Breakdown</h2><button class="btn" data-view="accounts">Manage</button></div>
        <div class="list">
          <div class="row"><div>Account assets</div><div class="row-value positive">${money(accountAssetsTotal())}</div></div>
          <div class="row"><div>Linked debt accounts</div><div class="row-value">${linkedDebtAccounts.length}</div></div>
          <div class="row"><div>Unlinked liability accounts</div><div class="row-value ${unlinkedLiabilities.length ? "warning" : "positive"}">${money(unlinkedAccountLiabilitiesTotal())}</div></div>
          <div class="row"><div>Debt tracker records</div><div class="row-value negative">${money(trackedDebtTotal())}</div></div>
          <div class="row"><div>Net worth</div><div class="row-value ${netWorthTotal() >= 0 ? "positive" : "negative"}">${money(netWorthTotal())}</div></div>
        </div>
      </section>
      <section class="card">
        <div class="section-head"><h2>Account Freshness</h2><span class="pill ${staleAccountCount() ? "orange" : "green"}">${staleAccountCount()} stale</span></div>
        <div class="grid metrics" style="padding:14px">
          ${metric("Tracked Accounts", String(state.accounts.length))}
          ${metric("Stale Balances", String(staleAccountCount()), staleAccountCount() > 0 ? "warning" : "positive")}
          ${metric("Snapshots", String(state.balanceSnapshots.length))}
        </div>
        <div class="list">${recentAccounts.length ? recentAccounts.map(renderAccountRow).join("") : `<div class="empty">Import or add accounts to build your net worth dashboard.</div>`}</div>
      </section>
    </div>
    <div style="height:14px"></div>
    ${renderNetWorthTrendSection()}
    <div style="height:14px"></div>
    ${renderNetWorthProjectionSection()}
  `);
}

function renderNetWorthTrendSection() {
  const timeline = accountBalanceTimeline();
  if (timeline.length < 2) {
    return `<section class="card pad">
      <div class="section-head" style="padding:0 0 12px;border-bottom:0"><h2>Account Balance Trend</h2></div>
      <div class="empty">Add or update accounts on at least two different dates to see a trend.</div>
    </section>`;
  }
  const points = timeline.slice(-24).map((item) => ({ label: formatDate(item.date), value: item.net }));
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;
  return `<section class="card pad">
    <div class="section-head" style="padding:0 0 12px;border-bottom:0">
      <h2>Account Balance Trend</h2>
      <span class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${money(change)} since ${escapeHtml(first.label)}</span>
    </div>
    ${svgLineChart(points)}
    <div class="submetric" style="margin-top:8px"><span>${escapeHtml(first.label)}</span><span>${escapeHtml(last.label)}</span></div>
    ${trackedDebtTotal() > 0 ? `<p style="margin:10px 0 0;color:var(--muted);font-size:13px">Reflects tracked account balances only — excludes ${money(trackedDebtTotal())} of debt-tracker balances not linked to an account.</p>` : ""}
  </section>`;
}

function renderNetWorthProjectionSection() {
  const points = netWorthProjection();
  if (!points.length) return "";
  const startingNetWorth = netWorthTotal();
  const oneYear = points.find((item) => item.month === 12) || points[points.length - 1];
  const horizonPoint = points[points.length - 1];
  const monthlyGrowth = (horizonPoint.netWorth - startingNetWorth) / points.length;
  const chartPoints = points.map((item) => ({ label: formatMonthLabel(item.date.slice(0, 7)), value: item.netWorth }));
  return `<section class="card pad">
    <div class="section-head" style="padding:0 0 12px;border-bottom:0"><h2>Net Worth Projection</h2></div>
    <div class="grid metrics">
      ${metric("In 12 Months", money(oneYear.netWorth), oneYear.netWorth >= startingNetWorth ? "positive" : "negative")}
      ${metric(`In ${points.length} Months`, money(horizonPoint.netWorth), horizonPoint.netWorth >= startingNetWorth ? "positive" : "negative")}
      ${metric("Avg Monthly Growth", money(monthlyGrowth), monthlyGrowth >= 0 ? "positive" : "negative")}
    </div>
    <div style="height:14px"></div>
    ${svgLineChart(chartPoints)}
    <p style="margin:10px 0 0;color:var(--muted);font-size:13px">Projects income minus bills, average discretionary spending, and debt interest forward, assuming your current Payoff Planner extra payment and spending habits stay the same.</p>
  </section>`;
}

function renderAccounts() {
  const assets = state.accounts.filter((item) => !isLiabilityAccount(item)).sort((a, b) => normalizedName(a.name).localeCompare(normalizedName(b.name)));
  const liabilities = state.accounts.filter(isLiabilityAccount).sort((a, b) => normalizedName(a.name).localeCompare(normalizedName(b.name)));
  return page("Accounts", "Track balances imported from screenshots and keep debt accounts linked.", `
    <button class="btn" data-action="import-accounts">Import Accounts</button>
    <button class="btn primary" data-modal="account">+ Add Account</button>`, `
    <div class="grid metrics wide-metrics">
      ${metric("Assets", money(accountAssetsTotal()), "positive")}
      ${metric("Liabilities", money(accountLiabilitiesTotal()), accountLiabilitiesTotal() > 0 ? "negative" : "positive")}
      ${metric("Unlinked Liabilities", money(unlinkedAccountLiabilitiesTotal()), unlinkedAccountLiabilitiesTotal() > 0 ? "warning" : "positive")}
      ${metric("Cash On Hand", money(cashOnHandTotal()), "positive")}
      ${metric("Stale Balances", String(staleAccountCount()), staleAccountCount() > 0 ? "warning" : "positive")}
      ${metric("Snapshots", String(state.balanceSnapshots.length))}
    </div>
    <div style="height:14px"></div>
    <div class="grid two">
      ${renderAccountSection("Assets", assets)}
      ${renderAccountSection("Liabilities", liabilities)}
    </div>
  `);
}

function renderAccountSection(title, rows) {
  return `<section class="card"><div class="section-head"><h2>${title}</h2><span class="pill">${rows.length}</span></div><div class="list">${rows.length ? rows.map(renderAccountRow).join("") : `<div class="empty">No ${title.toLowerCase()} tracked.</div>`}</div></section>`;
}

function renderAccountRow(account) {
  const linkedDebt = account.linkedDebtId ? state.debts.find((debt) => debt.id === account.linkedDebtId) : null;
  const pillClass = isAccountStale(account) ? "orange" : isLiabilityAccount(account) ? "red" : "green";
  return `<div class="row">
    <div class="row-main">
      <div class="row-title">${escapeHtml(account.name)}<span class="pill ${pillClass}">${isAccountStale(account) ? "Stale" : account.type}</span></div>
      <div class="row-sub">${escapeHtml(account.type)} · updated ${formatDate(account.lastUpdated)} · ${accountSnapshotCount(account)} snapshots${linkedDebt ? ` · linked to ${escapeHtml(linkedDebt.name)}` : ""}</div>
      ${account.notes ? `<div class="row-note">${escapeHtml(account.notes)}</div>` : ""}
    </div>
    <div><div class="row-value ${isLiabilityAccount(account) ? "negative" : ""}">${money(account.balance)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="account" data-id="${account.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="accounts" data-id="${account.id}">×</button></div></div>
  </div>`;
}

function renderPendingTransactionRows() {
  const rows = pendingTransactionsThisMonth().sort((a, b) => new Date(b.date) - new Date(a.date));
  return rows.length ? rows.map((item) => `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(item.note || item.category)}</div><div class="row-sub">${formatDate(item.date)}${item.accountFlag ? ` · ${escapeHtml(item.accountFlag)}` : ""}</div></div><div><div class="row-value warning">${money(item.amount)}</div><button class="pill status-toggle orange" title="Mark cleared" data-action="cycle-transaction-status" data-id="${item.id}">Pending</button></div></div>`).join("") : `<div class="empty">No pending transactions.</div>`;
}

function goalPaceLabel(projection) {
  if (!Number.isFinite(projection.monthsToReach)) return { text: "No available savings", className: "warning" };
  if (projection.aheadMonths > 0) return { text: `${projection.aheadMonths} mo ahead of pace`, className: "positive" };
  if (projection.aheadMonths < 0) return { text: `${Math.abs(projection.aheadMonths)} mo behind pace`, className: "negative" };
  return { text: "On pace", className: "positive" };
}

function renderGoalSummary(goal) {
  const stats = goalStats(goal);
  const pace = goalPaceLabel(goalProjection(goal));
  return `
    <div class="submetric"><span>${escapeHtml(goal.name)}</span><strong class="${stats.isOnTrack ? "positive" : "warning"}">${stats.status}</strong></div>
    <div style="height:12px"></div>
    <div class="progress"><span style="width:${stats.progress * 100}%"></span></div>
    <div style="height:12px"></div>
    <div class="grid metrics">
      ${metric("Current", money(goal.currentAmount))}
      ${metric("Remaining", money(stats.remaining), "warning")}
      ${metric("Monthly Needed", money(stats.monthlyNeeded))}
    </div>
    <div style="height:10px"></div>
    <div class="submetric"><span>At your available savings pace</span><strong class="${pace.className}">${pace.text}</strong></div>
  `;
}

function renderIncome() {
  const active = state.incomes.filter((item) => item.isActive);
  const inactive = state.incomes.filter((item) => !item.isActive);
  const tcgRows = [...(state.tcgplayerIncome || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  return page("Income", "Track paychecks, side income, and tip-based income.", `<button class="btn primary" data-modal="income">+ Add Income</button>`, `
    <div class="grid metrics">
      ${metric("Monthly", money(totalMonthlyIncome()), "positive")}
      ${metric("Weekly", money(totalMonthlyIncome() / 4))}
      ${metric("Daily", money(totalMonthlyIncome() / 30))}
    </div>
    <div style="height:14px"></div>
    <section class="card">
      <div class="section-head"><h2>TCGplayer Income</h2><button class="btn" data-modal="tcgplayer">Add Entry</button></div>
      <div class="grid metrics" style="padding:14px">
        ${metric("This Month", money(tcgplayerIncomeThisMonth()), "positive")}
        ${metric("Entries", String(tcgRows.filter((item) => isThisMonth(item.date)).length))}
        ${metric("Prompt Days", "Mon / Wed")}
      </div>
      <div class="list">${tcgRows.length ? tcgRows.slice(0, 8).map(renderTcgplayerRow).join("") : `<div class="empty">No TCGplayer income entered yet.</div>`}</div>
    </section>
    <div style="height:14px"></div>
    ${renderIncomeSection("Active Income", active)}
    <div style="height:14px"></div>
    ${inactive.length ? renderIncomeSection("Inactive", inactive) : ""}
  `);
}

function renderTcgplayerRow(item) {
  return `<div class="row">
    <div class="row-main"><div class="row-title">TCGplayer payout</div><div class="row-sub">${formatDate(item.date)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</div></div>
    <div><div class="row-value positive">${money(item.amount)}</div><div class="row-actions"><button class="btn icon danger" title="Delete" data-delete="tcgplayerIncome" data-id="${item.id}">×</button></div></div>
  </div>`;
}

function renderIncomeSection(title, rows) {
  return `<section class="card"><div class="section-head"><h2>${title}</h2><span class="pill">${rows.length}</span></div><div class="list">${rows.length ? rows.map((item) => `
    <div class="row">
      <div class="row-main"><div class="row-title">${escapeHtml(item.name)}</div><div class="row-sub">${escapeHtml(item.frequency)}${item.includeTips ? " · includes tips" : ""}</div></div>
      <div><div class="row-value">${money(monthlyIncome(item))}/mo</div><div class="row-actions"><button class="btn icon" title="Toggle active" data-action="toggle-income" data-id="${item.id}">✓</button><button class="btn icon" title="Edit" data-modal="income" data-id="${item.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="incomes" data-id="${item.id}">×</button></div></div>
    </div>`).join("") : `<div class="empty">No income sources yet.</div>`}</div></section>`;
}

function renderBills() {
  const items = [
    ...state.bills.map((item) => ({ ...item, itemType: "bill", amount: item.amount, subtitle: item.category })),
    ...state.debts.map((item) => ({ ...item, itemType: "debt", amount: item.minimumPayment, subtitle: item.type }))
  ].map((item) => ({ ...item, paymentStatus: paymentStatus(item), isPaid: isPaidOrPending(item), isPending: isPendingPayment(item) }))
    .sort((a, b) => Number(a.dueDay) - Number(b.dueDay));
  const unpaidTotal = items.filter((item) => !item.isPaid).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingTotal = items.filter((item) => item.isPending).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return page("Bills", "Monthly bills and debt payments by due date.", `
    <div class="tabs"><button class="${state.billView === "list" ? "active" : ""}" data-bill-view="list">List</button><button class="${state.billView === "calendar" ? "active" : ""}" data-bill-view="calendar">Calendar</button></div>
    <button class="btn primary" data-modal="bill">+ Add Bill</button>`, `
    <div class="grid metrics">
      ${metric("Left To Pay", money(unpaidTotal), unpaidTotal > 0 ? "warning" : "positive")}
      ${metric("Pending", money(pendingTotal), pendingTotal > 0 ? "warning" : "positive")}
      ${metric("Paid", `${items.filter((item) => item.isPaid).length} of ${items.length}`, "positive")}
    </div>
    <div style="height:14px"></div>
    ${state.billView === "calendar" ? renderBillsCalendar(items) : renderBillsList(items)}
  `);
}

function renderBillsList(items) {
  return `<section class="card"><div class="list">${items.length ? items.map((item) => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">
          ${escapeHtml(item.name)}
          <button class="pill status-toggle ${paymentStatusPillClass(item.paymentStatus)}" title="Cycle payment status" data-action="${item.itemType === "bill" ? "cycle-bill-status" : "cycle-debt-status"}" data-id="${item.id}">${item.paymentStatus}</button>
        </div>
        <div class="row-sub">${escapeHtml(item.subtitle)} · due day ${item.dueDay}</div>
        ${item.notes ? `<div class="row-note">${escapeHtml(item.notes)}</div>` : ""}
      </div>
      <div><div class="row-value">${money(item.amount)}</div><div class="row-actions">${item.itemType === "bill" ? `<button class="btn icon" title="Toggle paid status" data-action="toggle-bill" data-id="${item.id}">✓</button><button class="btn icon" title="Edit" data-modal="bill" data-id="${item.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="bills" data-id="${item.id}">×</button>` : `<button class="btn icon" title="Toggle paid status" data-action="toggle-debt" data-id="${item.id}">✓</button><span class="pill purple">Debt</span>`}</div></div>
    </div>`).join("") : `<div class="empty">No bills yet.</div>`}</div></section>`;
}

function paymentStatusPillClass(status) {
  if (status === "Cleared") return "green";
  if (status === "Pending") return "orange";
  return "red";
}

function clampDueDay(dueDay, daysInMonth) {
  return Math.min(Math.max(Number(dueDay || 1), 1), daysInMonth);
}

function renderBillsCalendar(items) {
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return `<section class="card"><div class="calendar">${Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    // Clamp so a due day of 31 still shows up on the last day of a shorter month, instead of vanishing.
    const dayItems = items.filter((item) => clampDueDay(item.dueDay, daysInMonth) === day);
    return `<div class="day ${day === today.getDate() ? "today" : ""}"><strong>${day}</strong>${dayItems.map((item) => `<div class="item">${escapeHtml(item.name)} ${money(item.amount)}</div>`).join("")}</div>`;
  }).join("")}</div></section>`;
}

function renderSpending() {
  const todaySpend = state.transactions.filter((item) => item.date === isoToday()).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingSpend = pendingTransactionTotal();
  const grouped = {};
  thisMonthTransactions().sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((item) => {
    grouped[item.date] = grouped[item.date] || [];
    grouped[item.date].push(item);
  });
  return page("Spending", "Log flexible spending and watch the monthly budget.", `<button class="btn primary" data-modal="transaction">+ Add</button>`, `
    <div class="grid metrics">
      ${metric("Remaining", money(remainingFlex()), remainingFlex() >= 0 ? "positive" : "negative")}
      ${metric("Spent This Month", money(spentThisMonth()))}
      ${metric("Pending In Account", money(pendingSpend), pendingSpend > 0 ? "warning" : "positive")}
      ${metric("Today", money(todaySpend))}
    </div>
    <div style="height:14px"></div>
    <div class="grid two">
      <section class="card"><div class="section-head"><h2>Transactions</h2><span class="pill">${thisMonthTransactions().length}</span></div><div class="list">
        ${Object.keys(grouped).length ? Object.entries(grouped).map(([date, rows]) => `<div class="section-head"><h2>${formatDate(date)}</h2></div>${rows.map((item) => `
          <div class="row"><div class="row-main"><div class="row-title">${escapeHtml(item.note || item.category)}<button class="pill status-toggle ${paymentStatusPillClass(transactionStatus(item))}" title="Cycle transaction status" data-action="cycle-transaction-status" data-id="${item.id}">${transactionStatus(item)}</button></div><div class="row-sub">${escapeHtml(item.category)}${item.accountFlag ? ` · ${escapeHtml(item.accountFlag)}` : ""}</div></div><div><div class="row-value">${money(item.amount)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="transaction" data-id="${item.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="transactions" data-id="${item.id}">×</button></div></div></div>`).join("")}`).join("") : `<div class="empty">No transactions this month.</div>`}
      </div></section>
      <div class="stack">
        <section class="card"><div class="section-head"><h2>Pending Transactions</h2><span class="pill orange">${money(pendingSpend)}</span></div><div class="list">${renderPendingTransactionRows()}</div></section>
        <section class="card"><div class="section-head"><h2>Categories</h2></div><div class="list">${renderCategoryRows()}</div></section>
      </div>
    </div>
  `);
}

function renderHistory() {
  const rows = [...(state.monthlyHistory || [])].sort((a, b) => b.month.localeCompare(a.month));
  const avgRate = rows.length ? rows.reduce((sum, item) => sum + item.savingsRate, 0) / rows.length : 0;
  return page("History", "Monthly snapshots captured each time you start a new month.", "", `
    <div class="grid metrics">
      ${metric("Months Tracked", String(rows.length))}
      ${metric("Avg Savings Rate", rows.length ? `${Math.round(avgRate * 100)}%` : "—")}
      ${metric("Latest Month", rows.length ? formatMonthLabel(rows[0].month) : "—")}
    </div>
    <div style="height:14px"></div>
    <section class="card">
      <div class="section-head"><h2>Monthly Snapshots</h2><span class="pill">${rows.length}</span></div>
      <div class="list">${rows.length ? rows.map(renderHistoryRow).join("") : `<div class="empty">Use "Start New Month" on the dashboard to begin building history.</div>`}</div>
    </section>
  `);
}

function renderHistoryRow(item) {
  const pillClass = item.savingsRate >= 0.2 ? "green" : item.savingsRate >= 0 ? "orange" : "red";
  return `<div class="row">
    <div class="row-main">
      <div class="row-title">${escapeHtml(formatMonthLabel(item.month))}</div>
      <div class="row-sub">Income ${money(item.income)} · Bills+Debt ${money(item.billsAndDebt)} · Spent ${money(item.spent)}</div>
    </div>
    <div><div class="row-value ${item.remainingFlex >= 0 ? "positive" : "negative"}">${money(item.remainingFlex)}</div><span class="pill ${pillClass}">${Math.round(item.savingsRate * 100)}% saved</span></div>
  </div>`;
}

function formatDate(date) {
  const item = new Date(date + "T00:00:00");
  const today = new Date(isoToday() + "T00:00:00");
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (item.getTime() === today.getTime()) return "Today";
  if (item.getTime() === yesterday.getTime()) return "Yesterday";
  return item.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function renderPromoWarnings(daysThreshold) {
  const promos = expiringPromotions(daysThreshold);
  if (!promos.length) return "";
  return `<section class="card pad">
    <div class="section-head" style="padding:0 0 12px;border-bottom:0"><h2>Promo Balances Expiring</h2></div>
    <div class="list">${promos.map((debt) => `
      <div class="row">
        <div class="row-main"><div class="row-title">${escapeHtml(debt.name)}</div><div class="row-sub">${money(debt.balance)} balance${debt.accruedInterest ? ` · ${money(debt.accruedInterest)} deferred interest at risk` : ""}</div></div>
        <span class="pill ${debt.daysUntilExpiration <= 30 ? "red" : "orange"}">${debt.daysUntilExpiration <= 0 ? "Expired" : `${debt.daysUntilExpiration} days`}</span>
      </div>`).join("")}</div>
  </section>`;
}

function renderDebtPayoffPlanner() {
  const debts = sortedDebtsByStrategy().filter((debt) => Number(debt.balance || 0) > 0);
  if (!debts.length) return "";
  const extra = Number(state.debtExtraPayment || 0);
  const baseline = simulateDebtPayoff(debts, 0);
  const withExtra = simulateDebtPayoff(debts, extra);
  const monthsSaved = baseline.months - withExtra.months;
  const interestSaved = baseline.totalInterest - withExtra.totalInterest;
  return `<section class="card pad">
    <div class="section-head" style="padding:0 0 12px;border-bottom:0"><h2>Payoff Planner</h2></div>
    <div class="field" style="max-width:220px"><label for="extra-payment">Extra Monthly Payment</label><input id="extra-payment" type="number" min="0" step="10" value="${extra}"></div>
    <div style="height:14px"></div>
    <div class="grid metrics">
      ${metric("Debt-Free In", withExtra.months >= 600 ? "600+ months" : `${withExtra.months} months`, "positive")}
      ${metric("Total Interest", money(withExtra.totalInterest), "warning")}
      ${metric(extra > 0 ? "Extra Payment Saves" : "Add Extra To See Savings", extra > 0 ? `${monthsSaved} mo · ${money(interestSaved)}` : "—", extra > 0 ? "positive" : "")}
    </div>
  </section>`;
}

function renderDebt() {
  const totalDebt = state.debts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const totalInterestMonthly = state.debts.reduce((sum, item) => sum + debtMonthlyInterest(item), 0);
  const sorted = sortedDebtsByStrategy();
  return page("Debt Tracker", "Compare payoff order and track promotional balances.", `
    <div class="tabs">${["Avalanche", "Snowball"].map((item) => `<button class="${state.debtStrategy === item ? "active" : ""}" data-strategy="${item}">${item}</button>`).join("")}</div>
    <button class="btn primary" data-modal="debt">+ Add Debt</button>`, `
    <div class="grid metrics">
      ${metric("Total Debt", money(totalDebt), "negative")}
      ${metric("Minimum Payments", money(totalDebtPayments()))}
      ${metric("Monthly Interest", money(totalInterestMonthly), "warning")}
    </div>
    <div style="height:14px"></div>
    ${renderPromoWarnings(90)}
    <div style="height:${expiringPromotions(90).length ? 14 : 0}px"></div>
    ${renderDebtPayoffPlanner()}
    <div style="height:14px"></div>
    <div class="grid two">
      <section class="card"><div class="section-head"><h2>Accounts</h2><span class="pill">${state.debts.length}</span></div><div class="list">
        ${state.debts.length ? state.debts.map((item) => {
          const progress = Number(item.originalBalance || item.balance) > 0 ? Math.max(0, Math.min(1, 1 - Number(item.balance) / Number(item.originalBalance || item.balance))) : 1;
          return `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(item.name)}</div><div class="row-sub">${escapeHtml(item.type)} · ${number(item.interestRate)}% APR · due day ${item.dueDay}</div><div class="progress" style="margin-top:8px"><span style="width:${progress * 100}%"></span></div></div><div><div class="row-value">${money(item.balance)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="debt" data-id="${item.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="debts" data-id="${item.id}">×</button></div></div></div>`;
        }).join("") : `<div class="empty">No debt tracked.</div>`}
      </div></section>
      <section class="card"><div class="section-head"><h2>Payoff Order</h2><span class="pill purple">${state.debtStrategy}</span></div><div class="list">
        ${sorted.length ? sorted.map((item, index) => `<div class="row"><div class="row-main"><div class="row-title">${index + 1}. ${escapeHtml(item.name)}</div><div class="row-sub">${monthsToPayoff(item) < 0 ? "Minimum payment will not pay this off" : `${monthsToPayoff(item)} months · ${money(totalInterest(item))} interest`}</div></div><div class="row-value">${money(item.minimumPayment)}/mo</div></div>`).join("") : `<div class="empty">Add debts to compare payoff paths.</div>`}
      </div></section>
    </div>
  `);
}

function renderGoals() {
  const storefront = state.goals.find((goal) => goal.isStorefrontGoal);
  const others = state.goals.filter((goal) => !goal.isStorefrontGoal);
  return page("Savings Goals", "Track target dates, progress, and required contributions.", `<button class="btn primary" data-modal="goal">+ Add Goal</button>`, `
    <section class="card pad">
      <div class="section-head" style="padding:0 0 12px;border-bottom:0"><h2>Storefront Goal</h2>${storefront ? "" : `<button class="btn" data-modal="goal" data-storefront="true">Set Up</button>`}</div>
      ${storefront ? renderGoalCard(storefront) : `<div class="empty">No storefront goal set.</div>`}
    </section>
    <div style="height:14px"></div>
    <section class="card"><div class="section-head"><h2>Other Goals</h2><span class="pill">${others.length}</span></div><div class="list">${others.length ? others.map(renderGoalRow).join("") : `<div class="empty">No other goals yet.</div>`}</div></section>
  `);
}

function renderGoalCard(goal) {
  return `<div>${renderGoalSummary(goal)}<div class="row-actions"><button class="btn" data-modal="goal" data-id="${goal.id}">Edit</button><button class="btn danger" data-delete="goals" data-id="${goal.id}">Delete</button></div></div>`;
}

function renderGoalRow(goal) {
  const stats = goalStats(goal);
  const pace = goalPaceLabel(goalProjection(goal));
  return `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(goal.name)}</div><div class="row-sub">${Math.round(stats.progress * 100)}% · ${stats.status} · target ${escapeHtml(goal.targetDate)} · <span class="${pace.className}">${pace.text}</span></div><div class="progress" style="margin-top:8px"><span style="width:${stats.progress * 100}%"></span></div></div><div><div class="row-value">${money(goal.currentAmount)} / ${money(goal.targetAmount)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="goal" data-id="${goal.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="goals" data-id="${goal.id}">×</button></div></div></div>`;
}

function renderSettings() {
  return page("Settings", "Local data and app controls.", `
    <button class="btn" data-action="toggle-theme">${state.theme === "dark" ? "Light Mode" : "Dark Mode"}</button>
    <button class="btn" data-action="export">Export</button>
    <button class="btn" data-action="import">Import</button>
    <button class="btn" data-action="import-accounts">Import Accounts</button>
    ${window.budgetBridge ? `<button class="btn" data-action="open-backups">Backups</button>` : ""}
    <button class="btn danger" data-action="reset">Reset</button>`, `
    <div class="grid metrics wide-metrics">
      ${metric("Income Sources", String(state.incomes.length))}
      ${metric("Bills", String(state.bills.length))}
      ${metric("Transactions", String(state.transactions.length))}
      ${metric("Accounts", String(state.accounts.length))}
      ${metric("Balance Snapshots", String(state.balanceSnapshots.length))}
      ${metric("Last Account Import", state.lastAccountImport ? formatDate(state.lastAccountImport.date) : "Never")}
    </div>
    <div style="height:14px"></div>
    <section class="card">
      <div class="section-head"><h2>Budget Summary</h2></div>
      <div class="list">
        <div class="row"><div>Monthly Income</div><div class="row-value positive">${money(totalMonthlyIncome())}</div></div>
        <div class="row"><div>Monthly Bills</div><div class="row-value negative">${money(totalMonthlyBills() + totalDebtPayments())}</div></div>
        <div class="row"><div>Flex Budget</div><div class="row-value">${money(flexBudget())}</div></div>
        <div class="row"><div>Storage</div><div class="row-value">${window.budgetBridge ? "Local + automatic file backups" : "Browser local"}</div></div>
      </div>
    </section>
  `);
}

function renderSetup() {
  return page("Set Up BudgetApp", "Start with the essentials. You can edit everything later.", "", `
    <section class="card pad">
      <div class="grid metrics">
        ${metric("Income", String(state.incomes.length))}
        ${metric("Bills", String(state.bills.length))}
        ${metric("Goals", String(state.goals.length))}
      </div>
      <div style="height:16px"></div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn" data-modal="income">Add Income</button>
        <button class="btn" data-modal="account">Add Account</button>
        <button class="btn" data-modal="bill">Add Bill</button>
        <button class="btn" data-modal="debt">Add Debt</button>
        <button class="btn" data-modal="goal">Add Goal</button>
        <button class="btn primary" data-action="finish-setup">Finish Setup</button>
      </div>
    </section>
  `);
}

function renderTour() {
  if (tourStep === null || modal) return "";
  const step = walkthroughSteps[tourStep];
  const isLast = tourStep === walkthroughSteps.length - 1;
  return `<div class="tour-backdrop"></div>
  <div class="tour-overlay">
    <div class="tour-card">
      <h2>${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.body)}</p>
      <div class="tour-dots">${walkthroughSteps.map((_, index) => `<span class="${index === tourStep ? "active" : ""}"></span>`).join("")}</div>
      <div class="tour-footer">
        <button class="btn" type="button" data-action="tour-skip">${isLast ? "Close" : "Skip"}</button>
        <div class="actions">
          ${tourStep > 0 ? `<button class="btn" type="button" data-action="tour-prev">Back</button>` : ""}
          <button class="btn primary" type="button" data-action="tour-next">${isLast ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderModal() {
  const title = modal.id ? `Edit ${modal.type}` : `Add ${modal.type}`;
  return `<div class="modal-backdrop"><form class="modal" data-form="${modal.type}">
    <header><h2>${title}</h2><button class="btn icon" type="button" data-action="close-modal">×</button></header>
    <div class="modal-body">${renderForm(modal.type, modal.item || {})}</div>
    <footer><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save</button></footer>
  </form></div>`;
}

function field(name, label, value = "", type = "text", options = null) {
  if (options) {
    return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map((item) => `<option value="${escapeHtml(item)}" ${item === value ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></div>`;
  }
  // step="any" still accepts cents when typed, but the wheel, arrow keys and spinner move by
  // whole dollars (198.01 -> 199.01) instead of crawling a penny at a time.
  const numberAttrs = name === "dueDay" || name === "payDay" ? `min="1" max="31" step="1"` : `step="any"`;
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${type === "number" ? numberAttrs : ""}></div>`;
}

function checkbox(name, label, checked) {
  return `<div class="field"><label><input name="${name}" type="checkbox" ${checked ? "checked" : ""}> ${label}</label></div>`;
}

function debtPicker(value = "") {
  return `<div class="field"><label for="linkedDebtId">Linked Debt</label><select id="linkedDebtId" name="linkedDebtId"><option value="">None</option>${state.debts.map((debt) => `<option value="${escapeHtml(debt.id)}" ${debt.id === value ? "selected" : ""}>${escapeHtml(debt.name)}</option>`).join("")}</select></div>`;
}

function renderForm(type, item) {
  if (type === "account") return `<div class="form-grid">${field("name", "Name", item.name || "")}${field("type", "Type", item.type || "Checking", "text", categories.account)}${field("balance", "Current Balance", item.balance || "", "number")}${field("lastUpdated", "Last Updated", item.lastUpdated || isoToday(), "date")}${debtPicker(item.linkedDebtId || "")}<div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes">${escapeHtml(item.notes || "")}</textarea></div></div>`;
  if (type === "income") return `<div class="form-grid">${field("name", "Name", item.name || "")}${field("amount", "Amount", item.amount || "", "number")}${field("frequency", "Frequency", item.frequency || "Bi-Weekly", "text", categories.incomeFrequency)}${field("payDay", "Pay Day (if Monthly)", item.payDay || 1, "number")}${checkbox("isActive", "Active", item.isActive !== false)}${checkbox("includeTips", "Track weekly tips", !!item.includeTips)}</div>`;
  if (type === "bill") return `<div class="form-grid">${field("name", "Name", item.name || "")}${field("amount", "Amount", item.amount || "", "number")}${field("dueDay", "Due Day", item.dueDay || 1, "number")}${field("category", "Category", item.category || "Other", "text", categories.bill)}${field("paymentStatus", "Payment Status", paymentStatus(item), "text", categories.paymentStatus)}<div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes">${escapeHtml(item.notes || "")}</textarea></div></div>`;
  if (type === "transaction") return `<div class="form-grid">${field("date", "Date", item.date || isoToday(), "date")}${field("amount", "Amount", item.amount || "", "number")}${field("category", "Category", item.category || "Misc", "text", categories.transaction)}${field("transactionStatus", "Status", transactionStatus(item), "text", categories.transactionStatus)}${field("accountFlag", "Account", item.accountFlag || "")}<div class="field full"><label for="note">Note</label><textarea id="note" name="note">${escapeHtml(item.note || "")}</textarea></div></div>`;
  if (type === "debt") return `<div class="form-grid">${field("name", "Name", item.name || "")}${field("balance", "Balance", item.balance || "", "number")}${field("originalBalance", "Original Balance", item.originalBalance || item.balance || "", "number")}${field("interestRate", "APR %", item.interestRate || "", "number")}${field("minimumPayment", "Minimum Payment", item.minimumPayment || "", "number")}${field("dueDay", "Due Day", item.dueDay || 1, "number")}${field("type", "Type", item.type || "Credit Card", "text", categories.debt)}${field("promoExpirationDate", "Promo Expiration", item.promoExpirationDate || "", "date")}${field("accruedInterest", "Accrued Interest", item.accruedInterest || 0, "number")}${checkbox("hasPromotion", "Promotional balance", !!item.hasPromotion)}<div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes">${escapeHtml(item.notes || "")}</textarea></div></div>`;
  if (type === "goal") return `<div class="form-grid">${field("name", "Name", item.name || (modal.storefront ? "Storefront" : ""))}${field("targetAmount", "Target Amount", item.targetAmount || "", "number")}${field("currentAmount", "Current Amount", item.currentAmount || 0, "number")}${field("targetDate", "Target Date", item.targetDate || addMonthsIso(12), "date")}${checkbox("isStorefrontGoal", "Storefront goal", item.isStorefrontGoal || modal.storefront)}<div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes">${escapeHtml(item.notes || "")}</textarea></div></div>`;
  if (type === "tips") return `<div class="form-grid">${field("amount", "Tips Amount", "", "number")}</div>`;
  if (type === "tcgplayer") return `<div class="form-grid">${field("date", "Date", isoToday(), "date")}${field("amount", "TCGplayer Income", "", "number")}<div class="field full"><label for="note">Note</label><textarea id="note" name="note"></textarea></div></div>`;
  return "";
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setState({ activeView: button.dataset.view })));
  document.querySelectorAll("[data-bill-view]").forEach((button) => button.addEventListener("click", () => setState({ billView: button.dataset.billView })));
  document.querySelectorAll("[data-strategy]").forEach((button) => button.addEventListener("click", () => setState({ debtStrategy: button.dataset.strategy })));
  document.querySelectorAll("[data-modal]").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.modal, button.dataset.id, button.dataset.storefront === "true")));
  document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteItem(button.dataset.delete, button.dataset.id)));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id)));
  document.querySelectorAll("form[data-form]").forEach((form) => form.addEventListener("submit", submitForm));
  document.querySelector(".modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  document.getElementById("extra-payment")?.addEventListener("change", (event) => {
    setState({ debtExtraPayment: Math.max(0, Number(event.target.value || 0)) });
  });
}

function closeModal() {
  modal = null;
  render();
}

function openModal(type, id = null, storefront = false) {
  const collection = collectionForType(type);
  const item = id && collection ? state[collection].find((entry) => entry.id === id) : null;
  modal = { type, id, item, storefront };
  shouldFocusModal = true;
  render();
}

function collectionForType(type) {
  return { account: "accounts", income: "incomes", bill: "bills", transaction: "transactions", debt: "debts", goal: "goals" }[type];
}

function readForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("input[type=checkbox]").forEach((input) => {
    data[input.name] = input.checked;
  });
  return data;
}

function submitForm(event) {
  event.preventDefault();
  const type = event.currentTarget.dataset.form;
  const data = normalize(type, readForm(event.currentTarget));
  if (type === "tips") {
    const weekStartDate = currentWeekStart();
    const existingTip = state.weeklyTips.find((item) => item.weekStartDate === weekStartDate);
    if (existingTip) {
      existingTip.amount = data.amount;
      existingTip.isEntered = true;
      existingTip.enteredDate = isoToday();
    } else {
      state.weeklyTips.push({ id: uid(), weekStartDate, amount: data.amount, isEntered: true, enteredDate: isoToday() });
    }
  } else if (type === "tcgplayer") {
    state.tcgplayerIncome = state.tcgplayerIncome || [];
    state.tcgplayerIncome.push({ id: uid(), date: data.date || isoToday(), amount: data.amount, note: data.note || "" });
  } else if (type === "account") {
    let targetAccount;
    if (modal.id) {
      state.accounts = state.accounts.map((item) => {
        if (item.id !== modal.id) return item;
        targetAccount = { ...item, ...data };
        return targetAccount;
      });
    } else {
      targetAccount = { id: uid(), ...data };
      state.accounts.push(targetAccount);
    }
    if (targetAccount) {
      syncLinkedDebtBalance(targetAccount);
      createBalanceSnapshot(targetAccount, "Manual account update");
    }
  } else {
    const collection = collectionForType(type);
    if (modal.id) {
      state[collection] = state[collection].map((item) => item.id === modal.id ? { ...item, ...data } : item);
    } else {
      state[collection].push({ id: uid(), ...data });
    }
  }
  modal = null;
  saveState();
  render();
}

function normalize(type, data) {
  const numeric = ["amount", "dueDay", "payDay", "balance", "originalBalance", "interestRate", "minimumPayment", "accruedInterest", "targetAmount", "currentAmount"];
  numeric.forEach((key) => {
    if (key in data) data[key] = Number(data[key] || 0);
  });
  if (type === "bill") {
    data.isRecurring = true;
    data.isPaid = data.paymentStatus && data.paymentStatus !== "Unpaid";
  }
  if (type === "transaction") {
    data.isPending = data.transactionStatus === "Pending";
  }
  if (type === "account") {
    data.type = accountType(data.type);
    data.balance = Number(data.balance || 0);
    data.lastUpdated = data.lastUpdated || isoToday();
    data.linkedDebtId = data.linkedDebtId || "";
  }
  if (type === "debt" && !modal.id) {
    data.paymentStatus = "Unpaid";
    data.isPaid = false;
  }
  if (type === "goal") data.createdDate = modal.item?.createdDate || isoToday();
  return data;
}

function deleteItem(collection, id) {
  if (!confirm("Delete this item?")) return;
  state[collection] = state[collection].filter((item) => item.id !== id);
  if (collection === "accounts") {
    state.balanceSnapshots = state.balanceSnapshots.filter((item) => item.accountId !== id);
  }
  if (collection === "debts") {
    state.accounts = state.accounts.map((item) => item.linkedDebtId === id ? { ...item, linkedDebtId: "" } : item);
  }
  saveState();
  render();
}

function nextPaymentStatusItem(item) {
  const nextStatus = { Unpaid: "Pending", Pending: "Cleared", Cleared: "Unpaid" }[paymentStatus(item)] || "Unpaid";
  return { ...item, paymentStatus: nextStatus, isPaid: nextStatus !== "Unpaid" };
}

function nextTransactionStatusItem(item) {
  const nextStatus = transactionStatus(item) === "Pending" ? "Cleared" : "Pending";
  return { ...item, transactionStatus: nextStatus, isPending: nextStatus === "Pending" };
}

function handleAction(action, id) {
  if (action === "close-modal") modal = null;
  if (action === "finish-setup") {
    state.hasCompletedSetup = true;
    if (!state.hasSeenWalkthrough) {
      state.activeView = "dashboard";
      tourStep = 0;
    }
  }
  if (action === "start-tour") {
    startTour();
    return;
  }
  if (action === "tour-next") {
    tourNext();
    return;
  }
  if (action === "tour-prev") {
    tourPrev();
    return;
  }
  if (action === "tour-skip") {
    closeTour();
    return;
  }
  if (action === "toggle-theme") state.theme = state.theme === "dark" ? "light" : "dark";
  if (action === "open-backups") {
    window.budgetBridge?.openBackupFolder();
    return;
  }
  if (action === "toggle-income") state.incomes = state.incomes.map((item) => item.id === id ? { ...item, isActive: !item.isActive } : item);
  if (action === "toggle-bill" || action === "cycle-bill-status") state.bills = state.bills.map((item) => item.id === id ? nextPaymentStatusItem(item) : item);
  if (action === "toggle-debt" || action === "cycle-debt-status") state.debts = state.debts.map((item) => item.id === id ? nextPaymentStatusItem(item) : item);
  if (action === "cycle-transaction-status") state.transactions = state.transactions.map((item) => item.id === id ? nextTransactionStatusItem(item) : item);
  if (action === "new-month" && confirm("Start a new month? This resets bill and debt paid status and saves a snapshot to History. Transactions and tips are kept.")) {
    state.monthlyHistory = (state.monthlyHistory || []).filter((item) => item.month !== currentMonthKey());
    state.monthlyHistory.push(buildMonthSnapshot());
    state.bills = state.bills.map((item) => ({ ...item, paymentStatus: "Unpaid", isPaid: false }));
    state.debts = state.debts.map((item) => ({ ...item, paymentStatus: "Unpaid", isPaid: false }));
  }
  if (action === "reset" && confirm("Reset all local BudgetApp data?")) state = { ...structuredClone(seedState), theme: state.theme };
  if (action === "import-accounts") {
    importAccountFile();
    return;
  }
  if (action === "export") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `budgetapp-export-${isoToday()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (action === "import") {
    if (!confirm("Importing a file replaces all current BudgetApp data. Continue?")) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const loaded = { ...structuredClone(seedState), ...JSON.parse(reader.result) };
          loaded.accounts = (loaded.accounts || []).map(normalizeAccountRecord);
          loaded.balanceSnapshots = loaded.balanceSnapshots || [];
          loaded.monthlyHistory = loaded.monthlyHistory || [];
          state = loaded;
          saveState();
          render();
        } catch {
          alert("That file could not be imported.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  saveState();
  render();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal) closeModal();
});

window.addEventListener("beforeunload", () => {
  // The debounced backup can still be pending when the window closes; flush it so the last
  // edit before quitting isn't only in localStorage.
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
    window.budgetBridge?.saveBackup(JSON.stringify(state, null, 2)).catch(() => {});
  }
});

render();
