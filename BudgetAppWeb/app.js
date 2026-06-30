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
  ["goals", "Goals", "*"],
  ["debt", "Debt", "%"],
  ["settings", "Settings", "="]
];

const seedState = {
  hasCompletedSetup: false,
  activeView: "dashboard",
  billView: "list",
  debtStrategy: "Avalanche",
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
  lastAccountImport: null
};

let state = loadState();
let modal = null;
let hasCheckedLaunchPrompts = false;

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function addMonthsIso(months) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(seedState);
    const loaded = { ...structuredClone(seedState), ...JSON.parse(raw) };
    loaded.accounts = (loaded.accounts || []).map(normalizeAccountRecord);
    loaded.balanceSnapshots = loaded.balanceSnapshots || [];
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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  return state.accounts.filter((item) => !isLiabilityAccount(item)).reduce((sum, item) => sum + Math.max(Number(item.balance || 0), 0), 0);
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
  return state.accounts.filter(isLiquidAccount).reduce((sum, item) => sum + Math.max(Number(item.balance || 0), 0), 0);
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
  if (frequency === "Weekly") return 4;
  if (frequency === "Bi-Weekly") return 2;
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

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isThisMonth(dateValue) {
  return new Date(dateValue) >= monthStart();
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

function remainingDailyBudget() {
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - today.getDate() + 1;
  return remainingDays > 0 ? remainingFlex() / remainingDays : 0;
}

function nextDueDate(dueDay) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = Math.min(Math.max(Number(dueDay || 1), 1), 31);
  let due = new Date(year, month, day);
  if (today.getDate() > day) due = new Date(year, month + 1, day);
  return due;
}

function daysUntilDue(dueDay) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const due = nextDueDate(dueDay);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - start) / 86400000);
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

function goalStats(goal) {
  const target = Number(goal.targetAmount || 0);
  const current = Number(goal.currentAmount || 0);
  const progress = target > 0 ? Math.min(current / target, 1) : 0;
  const remaining = Math.max(target - current, 0);
  const today = new Date();
  const targetDate = new Date(goal.targetDate);
  const monthsRemaining = Math.max((targetDate.getFullYear() - today.getFullYear()) * 12 + targetDate.getMonth() - today.getMonth(), 1);
  const created = new Date(goal.createdDate || isoToday());
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
  return result.toISOString().slice(0, 10);
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
  }

  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">$</span><span>BudgetApp</span></div>
        <nav class="nav">
          ${navItems.map(([id, label, icon]) => `<button class="${state.activeView === id ? "active" : ""}" data-view="${id}"><span>${icon}</span><span>${label}</span></button>`).join("")}
        </nav>
      </aside>
      <main class="main">${renderView()}</main>
      ${modal ? renderModal() : ""}
    </div>
  `;
  bindEvents();
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
  if (state.activeView === "goals") return renderGoals();
  if (state.activeView === "debt") return renderDebt();
  if (state.activeView === "settings") return renderSettings();
  return renderDashboard();
}

function metric(label, value, className = "") {
  return `<section class="card metric"><div class="label">${label}</div><div class="value ${className}">${value}</div></section>`;
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

  return page("Monthly Dashboard", new Date().toLocaleDateString(), `<button class="btn" data-action="new-month">Start New Month</button>`, `
    <div class="grid metrics">
      ${metric("Monthly Income", money(totalMonthlyIncome()), "positive")}
      ${metric("Monthly Obligations", money(totalMonthlyBills() + totalDebtPayments()), "negative")}
      ${metric("Flex Budget", money(flexBudget()), flexBudget() >= 0 ? "positive" : "negative")}
    </div>
    <div style="height:14px"></div>
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
  return rows.length ? rows.map(([name, value]) => `<div class="row"><div class="row-title">${name}</div><div class="row-value">${money(value)}</div></div>`).join("") : `<div class="empty">No spending logged this month.</div>`;
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
  `);
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

function renderGoalSummary(goal) {
  const stats = goalStats(goal);
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
      <div class="row-main"><div class="row-title">${escapeHtml(item.name)}</div><div class="row-sub">${item.frequency}${item.includeTips ? " · includes tips" : ""}</div></div>
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

function renderBillsCalendar(items) {
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  return `<section class="card"><div class="calendar">${Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dayItems = items.filter((item) => Number(item.dueDay) === day);
    return `<div class="day"><strong>${day}</strong>${dayItems.map((item) => `<div class="item">${escapeHtml(item.name)} ${money(item.amount)}</div>`).join("")}</div>`;
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
          <div class="row"><div class="row-main"><div class="row-title">${escapeHtml(item.note || item.category)}<button class="pill status-toggle ${paymentStatusPillClass(transactionStatus(item))}" title="Cycle transaction status" data-action="cycle-transaction-status" data-id="${item.id}">${transactionStatus(item)}</button></div><div class="row-sub">${item.category}${item.accountFlag ? ` · ${escapeHtml(item.accountFlag)}` : ""}</div></div><div><div class="row-value">${money(item.amount)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="transaction" data-id="${item.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="transactions" data-id="${item.id}">×</button></div></div></div>`).join("")}`).join("") : `<div class="empty">No transactions this month.</div>`}
      </div></section>
      <div class="stack">
        <section class="card"><div class="section-head"><h2>Pending Transactions</h2><span class="pill orange">${money(pendingSpend)}</span></div><div class="list">${renderPendingTransactionRows()}</div></section>
        <section class="card"><div class="section-head"><h2>Categories</h2></div><div class="list">${renderCategoryRows()}</div></section>
      </div>
    </div>
  `);
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

function renderDebt() {
  const totalDebt = state.debts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const totalInterestMonthly = state.debts.reduce((sum, item) => sum + debtMonthlyInterest(item), 0);
  const sorted = [...state.debts].sort((a, b) => state.debtStrategy === "Avalanche" ? Number(b.interestRate) - Number(a.interestRate) : Number(a.balance) - Number(b.balance));
  return page("Debt Tracker", "Compare payoff order and track promotional balances.", `
    <div class="tabs">${["Avalanche", "Snowball"].map((item) => `<button class="${state.debtStrategy === item ? "active" : ""}" data-strategy="${item}">${item}</button>`).join("")}</div>
    <button class="btn primary" data-modal="debt">+ Add Debt</button>`, `
    <div class="grid metrics">
      ${metric("Total Debt", money(totalDebt), "negative")}
      ${metric("Minimum Payments", money(totalDebtPayments()))}
      ${metric("Monthly Interest", money(totalInterestMonthly), "warning")}
    </div>
    <div style="height:14px"></div>
    <div class="grid two">
      <section class="card"><div class="section-head"><h2>Accounts</h2><span class="pill">${state.debts.length}</span></div><div class="list">
        ${state.debts.length ? state.debts.map((item) => {
          const progress = Number(item.originalBalance || item.balance) > 0 ? Math.max(0, Math.min(1, 1 - Number(item.balance) / Number(item.originalBalance || item.balance))) : 1;
          return `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(item.name)}</div><div class="row-sub">${item.type} · ${number(item.interestRate)}% APR · due day ${item.dueDay}</div><div class="progress" style="margin-top:8px"><span style="width:${progress * 100}%"></span></div></div><div><div class="row-value">${money(item.balance)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="debt" data-id="${item.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="debts" data-id="${item.id}">×</button></div></div></div>`;
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
  return `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(goal.name)}</div><div class="row-sub">${Math.round(stats.progress * 100)}% · ${stats.status} · target ${goal.targetDate}</div><div class="progress" style="margin-top:8px"><span style="width:${stats.progress * 100}%"></span></div></div><div><div class="row-value">${money(goal.currentAmount)} / ${money(goal.targetAmount)}</div><div class="row-actions"><button class="btn icon" title="Edit" data-modal="goal" data-id="${goal.id}">✎</button><button class="btn icon danger" title="Delete" data-delete="goals" data-id="${goal.id}">×</button></div></div></div>`;
}

function renderSettings() {
  return page("Settings", "Local data and app controls.", `
    <button class="btn" data-action="export">Export</button>
    <button class="btn" data-action="import">Import</button>
    <button class="btn" data-action="import-accounts">Import Accounts</button>
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
        <div class="row"><div>Storage</div><div class="row-value">Browser local</div></div>
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
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${type === "number" ? "step=\"0.01\"" : ""}></div>`;
}

function checkbox(name, label, checked) {
  return `<div class="field"><label><input name="${name}" type="checkbox" ${checked ? "checked" : ""}> ${label}</label></div>`;
}

function debtPicker(value = "") {
  return `<div class="field"><label for="linkedDebtId">Linked Debt</label><select id="linkedDebtId" name="linkedDebtId"><option value="">None</option>${state.debts.map((debt) => `<option value="${escapeHtml(debt.id)}" ${debt.id === value ? "selected" : ""}>${escapeHtml(debt.name)}</option>`).join("")}</select></div>`;
}

function renderForm(type, item) {
  if (type === "account") return `<div class="form-grid">${field("name", "Name", item.name || "")}${field("type", "Type", item.type || "Checking", "text", categories.account)}${field("balance", "Current Balance", item.balance || "", "number")}${field("lastUpdated", "Last Updated", item.lastUpdated || isoToday(), "date")}${debtPicker(item.linkedDebtId || "")}<div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes">${escapeHtml(item.notes || "")}</textarea></div></div>`;
  if (type === "income") return `<div class="form-grid">${field("name", "Name", item.name || "")}${field("amount", "Amount", item.amount || "", "number")}${field("frequency", "Frequency", item.frequency || "Bi-Weekly", "text", categories.incomeFrequency)}${checkbox("isActive", "Active", item.isActive !== false)}${checkbox("includeTips", "Track weekly tips", !!item.includeTips)}</div>`;
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
}

function openModal(type, id = null, storefront = false) {
  const collection = collectionForType(type);
  const item = id && collection ? state[collection].find((entry) => entry.id === id) : null;
  modal = { type, id, item, storefront };
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
  const numeric = ["amount", "dueDay", "balance", "originalBalance", "interestRate", "minimumPayment", "accruedInterest", "targetAmount", "currentAmount"];
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
  if (action === "finish-setup") state.hasCompletedSetup = true;
  if (action === "toggle-income") state.incomes = state.incomes.map((item) => item.id === id ? { ...item, isActive: !item.isActive } : item);
  if (action === "toggle-bill" || action === "cycle-bill-status") state.bills = state.bills.map((item) => item.id === id ? nextPaymentStatusItem(item) : item);
  if (action === "toggle-debt" || action === "cycle-debt-status") state.debts = state.debts.map((item) => item.id === id ? nextPaymentStatusItem(item) : item);
  if (action === "cycle-transaction-status") state.transactions = state.transactions.map((item) => item.id === id ? nextTransactionStatusItem(item) : item);
  if (action === "new-month" && confirm("Clear paid bill flags and this month's transactions?")) {
    state.bills = state.bills.map((item) => ({ ...item, paymentStatus: "Unpaid", isPaid: false }));
    state.debts = state.debts.map((item) => ({ ...item, paymentStatus: "Unpaid", isPaid: false }));
    state.transactions = state.transactions.filter((item) => !isThisMonth(item.date));
    state.weeklyTips = [];
  }
  if (action === "reset" && confirm("Reset all local BudgetApp data?")) state = structuredClone(seedState);
  if (action === "import-accounts") {
    importAccountFile();
    return;
  }
  if (action === "export") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "budgetapp-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  if (action === "import") {
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

render();
