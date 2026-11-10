# 💸 SpendWise Dashboard - Interactive Edition

**By Michael Myeko**

A sleek, modern web application designed to help users take control of their finances. This project has been upgraded to feature full interactivity using JavaScript.

## ✨ Week 6 Improvements

This week, SpendWise evolved from a static HTML/CSS layout into a fully interactive web application using JavaScript. Here is how core concepts were implemented:

- **Arrays for Data Storage:** All expense records are now stored centrally in an array of objects (`let expenses = []`), replacing the need for individual disconnected variables.
- **Processing Data with Loops:** A `for` loop iterates through the `expenses` array to dynamically calculate the total amount spent and generate table rows for the UI.
- **Updating the DOM Dynamically:** Using `document.createElement()` and `innerHTML`, the app dynamically updates the expense table and the header greeting text directly on the webpage, replacing static placeholder HTML.
- **User Interactions via Events:** An `addEventListener('click', ...)` is attached to the "Add Expense" button, capturing form data and triggering the DOM updates without reloading the page.
- **Decision Making (Conditionals):** `if/else` statements validate form inputs (preventing empty or negative amounts) and evaluate budget scenarios. If the total expenses exceed the monthly budget, the dashboard dynamically turns the header text red to warn the user.
- **Expense Lifecycle Actions:** You can create, edit, and delete entries from the dashboard or API endpoints while the app keeps data synced with its configured backend.
- **Accounts:** Passwords are stored as scrypt hashes and seven-day sessions use HTTP-only cookies. Email verification and authenticator MFA can be enabled after local development.
- **Currency:** Choose a default currency in Settings to format budgets and expenses across the dashboard. This preference changes display formatting only; it does not convert saved amounts.
- **Custom categories and recurring expenses:** Manage per-account categories and schedule expenses to be added automatically every month on a chosen day from 1 to 28.
- **CSV export:** Download your account's expenses from the transaction history page.

## 🚧 Challenges Encountered
One challenge was ensuring the page did not refresh when the "Add Expense" button was clicked inside the form. This was resolved by using `event.preventDefault()` inside the event listener to stop the default form submission behavior, allowing the JavaScript logic to execute smoothly.

## 🛠️ Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (DOM Manipulation, Events, ES6)
- **Design:** Custom modern UI with CSS Grid and Flexbox
- **Version Control:** Git & GitHub

## 🚀 Getting Started
1. Clone or download this repository.
2. Install the dependencies with `npm install`.
3. Start the app with `npm start`.
4. Open `http://localhost:3000` in your browser. The local server provides API access; opening `index.html` directly does not.
5. For local development, create an account and continue directly to the dashboard. Email verification and MFA are disabled only when the development bypass below is enabled. Otherwise, configure SMTP and MFA before account creation.

### Supabase backend configuration

The backend uses Supabase Postgres for all persisted data when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured. Account, session, MFA challenge, expense, settings, category, and recurring data are stored as private JSONB documents in `public.app_documents`; the browser never receives the service-role key. Local development without Supabase configured continues to use JSON files. Production startup requires Supabase configuration.

1. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
2. Set `SUPABASE_URL` to your project URL and `SUPABASE_SERVICE_ROLE_KEY` to a server-side service-role key. Never use the service-role key in browser code or commit it to the repository.
3. If migrating an existing JSON installation, stop the app, set `SPENDWISE_DATA_DIR` to the existing data directory if it is not `./data`, then run `npm run migrate:supabase`. The import is repeatable and overwrites matching document keys; do not run it while users are making changes.
4. Set `SPENDWISE_STORAGE=supabase` to explicitly require Supabase storage, then start the app with `npm start`.

The backend keeps the existing SpendWise email/password flow. Supabase is used as the backend database, not as the authentication provider.
When importing existing accounts, keep the same `SPENDWISE_MFA_ENCRYPTION_KEY` used by the old server; otherwise saved authenticator secrets cannot be decrypted.

For local development using Supabase, set these values in PowerShell before starting the server:

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-server-side-service-role-key"
$env:SPENDWISE_STORAGE = "supabase"
npm start
```

### Local development authentication bypass

To develop without configuring SMTP or MFA, enable the explicit bypass below. Accounts are created as verified and signed in immediately after registration. Sign-in still requires the account password. This bypass only activates outside production when `SPENDWISE_DEV_AUTH=true` and `SPENDWISE_APP_URL` uses `http://localhost`, `http://127.0.0.1`, or `http://[::1]`. Never enable it for a public or production deployment.

```powershell
$env:SPENDWISE_APP_URL = "http://localhost:3000"
$env:SPENDWISE_DEV_AUTH = "true"
$env:SPENDWISE_DEV_SKIP_EMAIL_MFA = "true"
npm start
```

### Production email verification and MFA configuration

When the development bypass is off, email verification and authenticator MFA are required for every account:

Passwords must be 8–128 characters; a longer passphrase is recommended.

- `SPENDWISE_APP_URL`: the app's public base URL (use HTTPS in production; for local use, `http://localhost:3000`).
- `SPENDWISE_DEV_AUTH`: set to `true` only for local development. With a localhost URL and outside production, it enables development-only authentication helpers.
- `SPENDWISE_DEV_SKIP_EMAIL_MFA`: set to `true` together with `SPENDWISE_DEV_AUTH` to skip email verification and MFA locally.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: SMTP server connection and credentials.
- `SMTP_FROM`: verified sender address (optional; defaults to `SMTP_USER`).
- `SMTP_SECURE`: set to `true` to use TLS explicitly; port 465 enables it automatically.
- `SPENDWISE_MFA_ENCRYPTION_KEY`: a stable, randomly generated secret with at least 32 characters. Back it up securely; changing or losing it makes existing authenticator secrets unreadable.

For local development with terminal-based email verification instead of SMTP, set the local URL and start the server (leave `SPENDWISE_DEV_SKIP_EMAIL_MFA` unset):

```powershell
$env:SPENDWISE_DEV_AUTH = "true"
$env:SPENDWISE_APP_URL = "http://localhost:3000"
npm start
```

Development authentication helpers are disabled in production. For production, leave both development variables unset, configure SMTP and `SPENDWISE_MFA_ENCRYPTION_KEY`, and use HTTPS. The local MFA key must be retained across restarts. Do not commit SMTP credentials or encryption keys. Recovery codes are shown once after enrollment; store them somewhere private.

The app is intended for local use. Before exposing it to the internet, deploy behind HTTPS and add production-grade operational controls and backups. Recurring entries are generated when an account loads its expenses or recurring schedule.

Run the API test suite with `npm test`.
