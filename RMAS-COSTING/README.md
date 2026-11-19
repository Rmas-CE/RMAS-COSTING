# RMAS-COSTING

RMAS merchandising expense tracker for the RMAS Head and the six regional RMAS users. GitHub Pages: https://rmas-ce.github.io/RMAS-COSTING/

- `index.html`: the app (Dashboard, Receipts, Receipt gallery, Approved budget, Approval email, Audit trail, Team). Each user opens it with a personal link, `?key=ACCESS_KEY`.
- `apps-script/Code.gs`: Google Apps Script API, bound to the RMAS Costing Google Sheet. It saves receipts (photos go to Google Drive), approved budgets, the team list and the audit trail. It also sends the budget approval email 7 days before month end.
- `apps-script/appsscript.json`: Apps Script manifest (Asia/Manila time zone; web app runs as the owner, open to anyone with the link + key).
- `SETUP-GUIDE.md`: step-by-step setup (Google Sheet, Apps Script, GitHub Pages).

Rules built into the app:
- Regions: NCR, North Luzon, Central Luzon, South Luzon, Visayas, Mindanao.
- BUs: AV, HA, AC. CE is split into AV 48.643%, HA 40.321%, AC 11.035% (the given 48.642 / 40.320 / 11.035 scaled to 100%).
- A receipt uploaded more than 7 days after its date is tagged **Late**. The same OR no. + vendor is flagged as a **Possible duplicate**.
- Next month's budget request = this month's projected spend + 10% per BU, rounded up to ₱1,000.
- Only the RMAS Head can save approved budgets and change the team.
