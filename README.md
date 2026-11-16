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
- **Financial planning:** Record one-time and recurring monthly income, set weekly or monthly category spending limits, track savings goals and contributions, and manage dated reminders. Planning data is isolated per account and stored by the configured JSON or Supabase backend.
- **Reminder alerts:** The dashboard surfaces incomplete reminders due today or tomorrow when the account is opened. Background notifications and email/push reminders are not configured.
- **Calendar integration:** Google Calendar synchronization is not implemented yet; reminders remain available inside SpendWise without granting calendar access.

## 🚧 Challenges Encountered
One challenge was ensuring the page did not refresh when the "Add Expense" button was clicked inside the form. This was resolved by using `event.preventDefault()` inside the event listener to stop the default form submission behavior, allowing the JavaScript logic to execute smoothly.

## 🛠️ Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (DOM Manipulation, Events, ES6)
- **Design:** Custom modern UI with CSS Grid and Flexbox
- **Brand system:** Urbanist typography; a black, white, and lime palette (`#D7FE03`, `#83AF3B`, `#F5F5F8`); and locally served Hugeicons SVGs.
- **UI motion:** GSAP provides subtle authentication, page-transition, and mobile-menu animations. Animations are skipped when reduced motion is enabled.
- **Version Control:** Git & GitHub

The interface uses shared CSS tokens for brand colors, text, surfaces, borders, spacing, radii, and elevation. The dashboard adapts the references' spacious canvas, dark navigation rail, and quiet data cards to SpendWise's lime identity. Hugeicons are bundled into a same-origin SVG sprite so dashboard icons do not require a separate icon CDN. After changing the icon map, regenerate the sprite with `npm run build:icons`; the source icon package is a development dependency only.

## 🚀 Getting Started
1. Clone or download this repository.
2. Install the dependencies with `npm install`.
3. Start the app with `npm start`.
4. Open `http://localhost:3000` in your browser. The local server provides API access; opening `index.html` directly does not.
5. For local development, create an account and continue directly to the dashboard. Email verification is disabled only when the development bypass below is enabled. Otherwise, configure SMTP before account creation. Authenticator MFA is optional.

### Deploying to Vercel

The app runs as an Express Vercel Function and builds its browser files into the ignored `public/` directory. Deploy from the `main` branch after pushing these files to GitHub.

1. In Vercel, choose **Add New → Project**, import `degraphengineer-ux/expense-tracker-by-michaelmyeko`, and keep the Express framework preset and default build settings from `vercel.json`.
2. Before deploying, add these environment variables in the Vercel project settings for **Production**, **Preview**, and **Development**:
   - `SUPABASE_URL` — the project URL (not a `/rest/v1` URL).
   - `SUPABASE_PUBLISHABLE_KEY` — the publishable key; never use a service-role key here.
   - `SPENDWISE_STORAGE=supabase`.
   Do not set `SPENDWISE_DEV_AUTH` or `SPENDWISE_DEV_SKIP_EMAIL_MFA` to `true` on Vercel. No `data/` filesystem storage is used in production.
3. Click **Deploy**. Vercel builds the static files and deploys the Express API. Open the assigned `*.vercel.app` URL and copy its origin.
4. In Vercel environment variables, set `SPENDWISE_APP_URL` to that production origin (for example `https://your-project.vercel.app`) for Production, then redeploy.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to the production origin and add it to **Redirect URLs**. Keep `http://localhost:3000/` for local development. For Preview deployments, add an appropriate narrowly scoped `https://*.vercel.app/**` redirect pattern if you need OAuth or email callbacks to work there.
6. If using Google or Microsoft sign-in, keep the identity providers' callback URI pointed at Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`); only the post-login redirect points back to Vercel. Test registration, verification email, login, password reset, and data isolation on the deployed URL.

Deployments from `main` become production deployments; other branches create previews. See [Vercel's Express deployment guide](https://vercel.com/docs/frameworks/backend/express) for current platform behavior.

### Supabase backend configuration

New installations use Supabase Auth and relational Postgres tables protected by RLS. The Express server and existing vanilla-JavaScript interface are retained. The app uses user JWTs with the publishable/anon key for database operations; the service-role key is used only by the explicit one-time JSON migration command. Local development without Supabase configured continues to use JSON files. Production startup requires Supabase configuration.

1. Apply every SQL file in [`supabase/migrations/`](./supabase/migrations/) in timestamp order using the Supabase SQL Editor. This creates the tables, indexes, triggers, RLS policies, system categories, and private `avatars` bucket, and applies later fixes. If you already ran the original schema migration, run any newer migration files that have not yet been applied.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) in the server environment. Do not put a service-role key in browser code or commit any real credentials.
3. Configure Supabase Auth email templates/SMTP and add the app root (for local development, `http://localhost:3000/`) to the allowed redirect URLs. Email verification is controlled by your Supabase Auth settings. Authenticator MFA is optional; users can set it up at sign-in or continue without it.
4. To enable **Continue with Google** and **Continue with Microsoft**, open **Authentication → Sign In / Providers** in Supabase and enable Google and Azure (Microsoft). Create OAuth applications with Google Cloud and Microsoft Entra ID, and register Supabase's callback URL shown on the provider settings page (usually `https://<project-ref>.supabase.co/auth/v1/callback`) as each provider's redirect/callback URI. Enter each provider's client ID and client secret only in Supabase's provider settings. Add the app root URL to Supabase's redirect allow list as well. Microsoft sign-in requests the `email` scope. Users who enable TOTP MFA will be prompted to verify it on subsequent sign-ins.
5. To retain local JSON data, stop the app and run `npm run migrate:supabase` to preview the import. Review the counts, then run `npm run migrate:supabase -- --apply`. The import is additive and idempotent per legacy account; it does not delete local files or existing database rows. It creates any missing Supabase Auth accounts with unknown random passwords, so those users must use **Forgot your password?** to set a new password. Existing scrypt hashes cannot be reused by Supabase Auth.
6. Set `SPENDWISE_STORAGE=supabase` and start the app with `npm start`.

The regular app process does not need `SUPABASE_SERVICE_ROLE_KEY`. The migration command does require it temporarily to map existing accounts by email and insert the legacy records; keep it only in a private environment and remove it after migration.

For local development using Supabase, configure these values in the ignored `.env` file:

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY = "your-publishable-or-anon-key"
$env:SPENDWISE_STORAGE = "supabase"
npm start
```

`SUPABASE_SERVICE_ROLE_KEY` is only needed when running the migration script above. Supabase email-confirmation and password-recovery links return to the app root; add that exact origin to the Supabase Auth redirect allowlist.

### Local development authentication bypass

To develop without configuring SMTP or MFA, enable the explicit bypass below. Accounts are created as verified and signed in immediately after registration. Sign-in still requires the account password. This bypass only activates outside production when `SPENDWISE_DEV_AUTH=true` and `SPENDWISE_APP_URL` uses `http://localhost`, `http://127.0.0.1`, or `http://[::1]`. Never enable it for a public or production deployment.

```powershell
$env:SPENDWISE_APP_URL = "http://localhost:3000"
$env:SPENDWISE_DEV_AUTH = "true"
$env:SPENDWISE_DEV_SKIP_EMAIL_MFA = "true"
npm start
```

Alternatively, configure these in a `.env` file in the project root (see `.env.example`). The server loads `.env` automatically on startup:

```env
PORT=3000
SPENDWISE_APP_URL=http://localhost:3000
SPENDWISE_DEV_AUTH=true
SPENDWISE_DEV_SKIP_EMAIL_MFA=true
SPENDWISE_MFA_ENCRYPTION_KEY=replace-with-a-random-secret
```

Generate a unique key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it private.

### Production email verification and MFA configuration

When the development bypass is off, email verification follows your configured email-auth flow. Authenticator MFA is optional; users who enable it must complete the challenge on subsequent sign-ins:

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
