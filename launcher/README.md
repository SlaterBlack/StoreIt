# StoreIt desktop launcher

StoreIt’s launcher is maintained in this repository. It packages and starts the StoreIt API with a bundled PostgreSQL server. The database and API are kept together; the ClockIt and ManageIt launchers remain isolated in their own repositories and connect to StoreIt at `127.0.0.1:4002` by default.

## Requirements

- Node.js `22.14.0`
- npm dependencies installed in `backend/` and `launcher/`

## Develop

From `launcher/`:

```bash
npm install
npm run build:backend
npm run dev
```

## Build packages

```bash
npm run release:windows
npm run release:linux
npm run release:all
```

The portable Windows `.exe` and Linux AppImage are written to `launcher/release/`. Windows builds are most reliable on Windows; Linux AppImages should be built on Linux.

## Configuration and data

The setup panel configures the API and PostgreSQL ports and the public URLs for ClockIt, ManageIt, and SplatIt. Defaults are StoreIt API `4002`, PostgreSQL `5432`, ClockIt `https://clockit.ai3d.com.au/`, ManageIt `https://manageit.ai3d.com.au/`, and SplatIt `https://splatit.ai3d.com.au/`. The public URLs are written to the generated `.env` and used by the API to discover running services. The API and database bind to loopback. The launcher generates and saves a random PostgreSQL password and JWT signing secret on first run. It does not collect administrator email/password or SMTP credentials.

PostgreSQL data and the generated `.env` are stored in the StoreIt Launcher's operating-system application data directory and persist across updates. Do not remove that data directory unless you intend to delete the local StoreIt database.

The launcher creates or updates the StoreIt schema when starting the API, starts/stops both services from the system tray, and can open the API health endpoint. Closing the configuration window keeps services running. The initial administrator account remains a separate StoreIt setup operation.
