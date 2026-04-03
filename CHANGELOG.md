# Changelog

## Unreleased

### Breaking changes

- **Product name:** Automation Testing → **DC Automation** (UI, docs, HTML titles).
- **npm package name:** `automation-testing` → **`dc-automation`**.
- **PM2 app name:** `automation-testing` → **`dc-automation`** (update `pm2` commands and `ecosystem.config.cjs`).
- **Default SQLite file:** `atlas.db` → **`dc_automation.db`** (set `DB_PATH` or run `mv atlas.db dc_automation.db`; see `docs/MIGRATION_DC_AUTOMATION.md`).
- **SPA routes:** Testing workflows moved under **`/testing/*`**; hub at **`/`**; Locations remain **`/locations/*`**. Old paths (e.g. `/test-plans`) receive **302 redirects** to `/testing/...` in production.
- **Docs/examples:** Example base path **`/dc-automation`** (replace with your own `VITE_BASE_PATH` / proxy path as needed).

### Added

- Module registry (`src/config/modules.ts`) and authenticated **home** page with links into Testing and Locations.
- **`src/lib/appPaths.ts`** helpers (`testingPath`, `locationsPath`) for router URLs.
- Express middleware: legacy SPA path redirects to `/testing/...` (with `BASE_PATH` when set).

### Unchanged

- **REST API** remains at **`/api/...`** (no route renames).
