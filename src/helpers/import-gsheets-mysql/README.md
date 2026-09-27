# import-gsheets-mysql


## Purpose
- Import transactions from a google sheets expense tracker into a MySQL DB
- Each configured sheet range is synced into its own table:
  - `SPREADSHEET_RANGE` -> `TARGET_TABLE` (defaults to `transactions`) for the shared household expenses
  - `PERSONAL_SPREADSHEET_RANGE` -> `PERSONAL_TARGET_TABLE` (defaults to `personal_expenses`) for the personal expenses
- A range that is left unset is skipped, so you can import just one of them

### Prerequisites

- Node.js
- npm

## Usage
- Install dependencies with `npm install`
- Create a `.env` file and add your environment variables
- Add a `credentials.json` with your credentials from Google Sheets API (exported from Google Console)
- Run `node index.js`

> Each run truncates the target tables before inserting, so the DB always mirrors the sheets.

## Sheet layout
- Columns are matched by **header name**, not position, so the ranges must include the header row (`!A1:Z`)
- The two sheets genuinely differ: the personal one has a blank column between `debit` and `credit`, so matching by position silently shifts `category` and `subcategory`
- Dates are accepted as either `YYYY/MM/DD` or `DD/MM/YYYY`; `DD/MM/YYYY` is parsed explicitly because `new Date()` would read it as US `MM/DD/YYYY`
- Amounts accept a comma or a dot as the decimal separator
- A required column missing from the header, or an unparseable date, fails the import loudly rather than importing shifted data
