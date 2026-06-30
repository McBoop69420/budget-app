# BudgetApp

This is the active Electron version of BudgetApp.

## Run

Double-click `BudgetApp.cmd`, or run:

```bat
npm.cmd start
```

Data is saved in Electron/browser `localStorage`.

## Account Screenshot Import

Send account screenshots in this Codex chat, then import the generated JSON from Settings or the Accounts page with the "Import Accounts" button.

Expected JSON:

```json
{
  "accounts": [
    {
      "name": "Apple Card",
      "type": "Credit Card",
      "balance": 1680,
      "lastUpdated": "2026-05-08",
      "notes": "Imported from screenshot",
      "linkedDebtName": "Apple Card"
    }
  ]
}
```

## Included Features

- Setup flow
- Monthly dashboard for income, obligations, spending, upcoming bills, and monthly bill progress
- Net Worth dashboard for assets, cash on hand, available cash, liabilities, linked debt, snapshots, and stale balances
- Income sources with weekly, biweekly, monthly, and tip income support
- Bills list and monthly calendar
- Pending bill/debt and transaction statuses for payments that have been made but have not cleared the account
- Spending log with category breakdown
- Debt tracker with avalanche and snowball payoff ordering
- Account tracking with balance snapshots, stale balance flags, and debt-account linking
- Savings goals, including a storefront goal
- Local import/export/reset controls
