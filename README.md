# StoreIt

StoreIt is the shared Node.js API for ClockIt, ManageIt, and SendIt. It uses
PostgreSQL and one shared user account store. ClockIt time-tracking data and
ManageIt project-planning data remain separate so each app can be used on its
own.

## Backend layout

```text
backend/   Express + TypeScript API, Sequelize/PostgreSQL models, and migration tools
```

The API runs on port `4002` by default. For a single-machine deployment where
frontends proxy to StoreIt locally, set `API_HOST=127.0.0.1` so the API is not
available directly over the network. Authentication and user administration
are shared under `/api/auth` and `/api/users`. App data is namespaced:

- ClockIt: `/api/clockit/...`
- ManageIt: `/api/manageit/...`

SendIt will use the shared authentication API and add its own API namespace as
its data contract is defined.

## Setup

1. Create a PostgreSQL database for StoreIt and copy
   `backend/.env.example` to `backend/.env`.
2. Set `DB_*` and `JWT_SECRET` for StoreIt. For data migration, also set the
   `CLOCKIT_SOURCE_DB_*` and `MANAGEIT_SOURCE_DB_*` source credentials.
3. From `backend`, run `npm install`, `npm run db:migrate`, then `npm run dev`.
4. Before importing existing data, run `npm run data:check`. It only reads the
   source databases. Import is an explicit `npm run data:migrate` operation.

## Initial administrator account

StoreIt checks for an admin at startup. When started from an interactive
terminal and no admin exists, it prompts for the initial admin's name, email,
and password; password input is hidden. A systemd service has no interactive
terminal, so it starts without enabling public registration and logs a reminder
to run `npm run admin:create` from `backend` in a terminal. That command opens
the same local setup prompt.

The public `/api/users` endpoint always requires an authenticated admin. StoreIt
does not promote an existing regular user automatically. The terminal setup
creates a new admin account and refuses to create another if an admin already
exists.

## ClockIt scheduled email reports

ClockIt admins can configure scheduled workbook emails from **Account >
Notifications**. Admins choose a start date and recurrence (every N days or
every N weeks), the report period length in days, send day/time/time zone,
which users' entries are included, and which accounts receive the email. The
period length is independent of the recurrence, so reports can intentionally
overlap or leave gaps. Delivery occurs on the first configured send day after
each report period closes. The default is every two weeks with a 14-day report
period, Tuesday at 1:00 PM Australia/Brisbane, and all users included. The
schedule remains disabled until an admin selects a start date and at least one
recipient.

StoreIt must have an authenticated SMTP account configured in
`backend/.env`; these credentials are never stored in ClockIt or exposed to
browser clients:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=clockit-reports@example.com
SMTP_PASSWORD=your-mail-provider-app-password
SMTP_FROM=ClockIt Reports <clockit-reports@example.com>
```

Use the host, port, TLS mode, username, password/app password, and sender
address provided by your email provider. Use `SMTP_SECURE=true` for providers
requiring implicit TLS (commonly port 465); for STARTTLS on port 587 use
`SMTP_SECURE=false`. Restart StoreIt after changing these values. The Reports
Notifications page displays whether SMTP is configured and offers a test
workbook email. After deploying model changes, run `npm run db:migrate` to
create or extend the schedule, delivery-history, and dashboard-reminder tables
before restarting the API.

## ClockIt dashboard reminders

Admins can create recurring reminders from **Account > Notifications**. Each
reminder has plain-text content, a start date, and a configurable interval in
days or weeks. Weekly schedules can select one or more weekdays; day-based
schedules recur from the start date. Each also has a start/end time, IANA time
zone, and enabled switch. The authenticated ClockIt Time Tracker shows enabled
reminders only while their time window is active and refreshes them once per
minute. Windows may cross midnight; a weekly weekday identifies the day on
which the window starts.

Each frontend has its own `frontend/.env` with `STOREIT_API_URL` for its local
Angular development proxy. Copy that frontend's `.env.example` to `.env`; the
URL is used by the Node-based proxy and is not included in browser bundles.

The migration preserves UUIDs and existing password hashes. It never drops or
alters source databases. The imported row counts and StoreIt database health
were verified before the legacy ClockIt and ManageIt backend folders were
removed. Users need to sign in again after the switch because StoreIt issues
sessions with its own `JWT_SECRET`.
