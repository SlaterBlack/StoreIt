# StoreIt

StoreIt is the shared Node.js API for ClockIt, ManageIt, and SendIt. It uses
PostgreSQL and one shared user account store. ClockIt time-tracking data and
ManageIt project-planning data remain separate so each app can be used on its
own.

## Backend layout

```text
backend/   Express + TypeScript API, Sequelize/PostgreSQL models, and migration tools
```

The API runs on port `4002` by default. Authentication and user administration
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

The migration preserves UUIDs and existing password hashes. It never drops or
alters source databases. Keep ClockIt and ManageIt backend folders until their
frontends have been verified against StoreIt and the imported data has been
checked. Users will need to sign in again after the switch because StoreIt
issues sessions with its own `JWT_SECRET`.