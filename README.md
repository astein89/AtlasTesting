# Automation Testing

Web app for test automation. Define tests with flexible data fields, collect data manually (mobile-friendly), export to CSV, and manage users with admin capabilities.

## Quick Start

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001
- Default login: **admin** / **admin**

## Scripts

- `npm run dev` - Run frontend + backend (concurrently)
- `npm run build` - Build for production
- `npm start` - Run production server (after build)
- `npm run db:seed` - Run DB seed manually (optional)
- App control (start/stop/status/update): see **[System commands](docs/SYSTEM_COMMANDS.md)**.

## Deployment (Raspberry Pi)

See **[Raspberry Pi Install & Setup Guide](docs/RASPBERRY_PI_SETUP.md)** for detailed instructions.

**Upgrading?** See **[Upgrade Instructions](docs/UPGRADE.md)**.

Quick steps:

1. Install Node.js 18+ and PM2
2. Copy project to Pi; run `npm install --omit=dev`
3. `npm run build`
4. `pm2 start ecosystem.config.cjs`
5. `pm2 startup` + `pm2 save`

To serve on port 80 at a path (e.g. http://\<pi-ip\>/automation-testing) alongside other apps, set `VITE_BASE_PATH` when building and `BASE_PATH` in PM2, then configure a reverse proxy (nginx or Caddy). See the [Raspberry Pi Setup Guide](docs/RASPBERRY_PI_SETUP.md).

## Tech Stack

- React 18 + Vite + Tailwind CSS
- Express + SQLite (sql.js)
- JWT auth, Zustand, react-hook-form, zod
