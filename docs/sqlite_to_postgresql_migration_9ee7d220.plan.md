---
name: SQLite to PostgreSQL Migration
overview: Move DC Automation to PostgreSQL with PostgreSQL-native SQL throughout, a single baseline PG schema (no SQLite-style migrations on app startup), and a standalone one-time script to copy data from dc-automation.db. SQLite stack today uses better-sqlite3 (not sql.js). Backup docs/scripts must move from SQLite file backup to PostgreSQL (e.g. pg_dump). Pi setup docs must add PostgreSQL install and DC Automation wiring. Cursor copy lives in .cursor/plans/sqlite_to_postgresql_migration.plan.md.
todos:
  - id: backup-docs-scripts
    content: Update docs/BACKUP_SETUP.md and scripts (e.g. sqlite-dropbox-backup.sh) for PostgreSQL backups — pg_dump, restore, rclone layout, cron
  - id: pi-postgres-docs
    content: Update docs/RASPBERRY_PI_SETUP.md with PostgreSQL install (apt), create DB/user, auth/listen_addresses/pg_hba for localhost, DATABASE_URL for PM2/config.json, optional Pi tuning
isProject: false
---

# SQLite to PostgreSQL Migration Plan

## Current State (as of this repo)

- **Database**: SQLite via [better-sqlite3](server/db/index.ts) (native), default file **`dc-automation.db`**, `DB_PATH`, WAL, `busy_timeout`.
- **API surface (routes expect)**: `db.prepare(sql).run/get/all(...params)` with **`?` placeholders** today; `db.exec(sql)`; `run()` returns `{ changes }`.
- **Schema**: [server/db/schema.ts](server/db/schema.ts) runs **`initSchema`** — a large `CREATE TABLE IF NOT EXISTS` block plus **many incremental `migrate*()` functions** (`PRAGMA table_info`, `ALTER`, `sqlite_master`, etc.). This is **SQLite-specific** and encodes years of drift; it is **not** what PostgreSQL should run on every app boot.
- **Scope**: Many tables (users, roles, user_roles, fields, test_plans, tests, test_runs, refresh_tokens, locations stack, record_history, user_preferences, app_kv, home_links, …). **Wiki page content** lives under **`content/wiki/`** (files), not in SQLite — copy that separately for deployments.

## Target principles

1. **PostgreSQL application path**: All SQL in the server is **written for PostgreSQL** — `$1`, `$2`, … placeholders, `ON CONFLICT` where SQLite used `INSERT OR REPLACE` / `OR IGNORE`, no `datetime('now')` in queries, no `PRAGMA`, no SQLite-only DDL in the running app. A thin `pg` wrapper may still implement `prepare`/`run`/`get`/`all` for route compatibility, but **strings passed in must already be valid PostgreSQL SQL** (no wholesale `?` → `$n` shim as the long-term design).
2. **No embedded “migration history” in the app for PostgreSQL**: On Postgres, **do not** port the dozens of `migrate*` steps from [server/db/schema.ts](server/db/schema.ts). Replace them with **one baseline definition** of the current schema (e.g. `schema-pg.ts` or `schema-pg.sql`) that creates the database as it should exist **today**. Future PG schema changes can be handled with explicit versioned migrations later if needed — **out of scope** unless you add a tool (e.g. node-pg-migrate).
3. **SQLite → PostgreSQL data move is a standalone script only**: A **single** CLI entry point (e.g. `scripts/migrate-sqlite-to-pg.ts`), run **manually** via `npm run db:migrate` (or similar). It is **never** invoked from [server/index.ts](server/index.ts) or request handlers.

## Architecture

```mermaid
flowchart TB
    subgraph today [Current SQLite prod]
        App1[Express App]
        BSql[better-sqlite3]
        DbFile[(dc-automation.db)]
        SchemaSqlite[initSchema plus migrate functions]
        App1 --> BSql --> DbFile
        SchemaSqlite --> appBoot1[runs on startup]
        appBoot1 --> DbFile
    end

    subgraph target [Target PostgreSQL]
        App2[Express App]
        PgPool[pg Pool]
        PgDb[(PostgreSQL)]
        SchemaPg[baseline schema-pg only]
        App2 --> PgPool --> PgDb
        SchemaPg --> appBoot2[apply once OR assume DBA applied]
        appBoot2 --> PgDb
    end

    subgraph standalone [Standalone one-time]
        MigrateScript[scripts/migrate-sqlite-to-pg.ts]
        ReadSqlite[better-sqlite3 read file]
        MigrateScript --> ReadSqlite --> DbFile
        MigrateScript --> PgPool
    end
```

---

## Operator cutover instructions

Step-by-step guidance for operators. For PostgreSQL install, networking, and Pi-specific commands, see [docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md). For backups and `pg_dump` after cutover, see [docs/BACKUP_SETUP.md](docs/BACKUP_SETUP.md).

### Prerequisites

- **PostgreSQL** is installed and reachable (use **14+** unless your org standard differs).
- **Application**: Dependencies installed (`npm ci` or `npm install`). Set **`DATABASE_URL`** or discrete **`DB_HOST`**, **`DB_PORT`**, **`DB_USER`**, **`DB_PASSWORD`**, **`DB_NAME`** as documented in [`.env.example`](../.env.example) once PostgreSQL support ships.
- **Migrating from SQLite**: Know the path to **`dc-automation.db`** (or use **`DB_PATH`**). Take a **filesystem backup copy** of the SQLite file before running any import.

### Greenfield (empty PostgreSQL, no SQLite data)

1. Create the database and application role (see [docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md) for example SQL on Debian/Raspberry Pi OS).
2. Set **`DATABASE_URL`** / **`config.json`** so the app points at the new database.
3. Apply the **baseline PostgreSQL schema** using whichever mechanism the implementation provides: **`initSchemaPg()` on app startup**, a one-time operator step with **`psql`** or a SQL file, or invocation from the migrate script — document the chosen policy in release notes and align this runbook when the feature is implemented.
4. Optionally run seed if your deployment uses it.
5. Deploy **`content/wiki/`** with the app; wiki pages are files on disk, not stored in the database.

### Cutover from existing SQLite

Execute in order:

1. **Stop** the application (or use a maintenance window).
2. **Back up** the SQLite database file and, if you are changing hosts, the **`content/wiki/`** tree.
3. Ensure the **PostgreSQL target database is empty** (preferred). If the data migration script supports truncate/re-run, document that explicitly; otherwise assume a fresh database.
4. **Apply the baseline PostgreSQL schema** using the same mechanism as greenfield (see above).
5. Run **`npm run db:migrate`** (or the final script name from `package.json`) with environment variables set for both the **SQLite source path** and **PostgreSQL connection** (same as production config).
6. Review the script **stdout**; **non-zero exit code** means failure — do not point production at PostgreSQL until the import succeeds.
7. Update production configuration to **PostgreSQL** (`DATABASE_URL` / config), **restart** the app.
8. **Smoke-test**: sign-in, exercise critical flows (see verification below).

### Verification checklist

- Script printed plausible **row counts** per table (if implemented); spot-check against SQLite if possible.
- Application **starts cleanly** against PostgreSQL with no schema errors in logs.
- At least **one read and one write** path (e.g. login, create or update a record).

### Rollback

- Revert **`DATABASE_URL` / config** to the previous SQLite-backed settings.
- Restore the **backed-up `dc-automation.db`** if the file was replaced or damaged.
- Do **not** use the one-time SQLite→PostgreSQL script as a rollback mechanism.

### Do not

- Do **not** invoke the SQLite→PostgreSQL **data migration script** from [server/index.ts](server/index.ts) or request handlers.
- Do **not** replay SQLite **`migrate*`** history on PostgreSQL; use only the **baseline** PG schema for PostgreSQL.

---

## 1. Add PostgreSQL driver and config

**Dependencies** ([package.json](package.json)):

- Add `pg`, `@types/pg` (dev)

**Config** — `config.default.json` (committed) + optional gitignored `config.json`; env overrides: `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

**Config loader** — e.g. `server/config.ts`: precedence Env > `config.json` > `config.default.json`.

---

## 2. PostgreSQL DB module

**New** `server/db/pg.ts` (or equivalent):

- `pg.Pool`, implement `DbWrapper`-compatible surface if routes keep the same TS types.
- **`run`/`get`/`all`**: execute PostgreSQL SQL **as authored** (parameters as array matching `$1`…).

**Update** [server/db/index.ts](server/db/index.ts):

- If `DATABASE_URL` / config selects PostgreSQL → export PG pool wrapper.
- Else → keep current better-sqlite3 path **for dev/transition** (still runs existing [server/db/schema.ts](server/db/schema.ts) SQLite migrations) until you drop SQLite entirely.

---

## 3. Baseline PostgreSQL schema (no SQLite migration replay)

**New** `server/db/schema-pg.ts` (or `schema-pg.sql`):

- **Single** artifact: `CREATE TABLE` / indexes / FKs for the **current** logical model only — equivalent end state to a fully migrated SQLite file, not a replay of `migrateEmailToUsername`, `migrateUserRoles`, etc.
- On app startup for PG: either run this idempotently (`CREATE IF NOT EXISTS` where appropriate) **or** document that operators apply it once; pick one policy and stick to it.

**Explicitly remove for PG path**:

- Any call to the SQLite `migrate*` functions or `PRAGMA`-based logic.

**Syntax conversions** (in DDL and in rewritten app SQL):

- Defaults: `datetime('now')` → `CURRENT_TIMESTAMP` (or `now()`).
- Upserts: `INSERT OR REPLACE` / `INSERT OR IGNORE` → `INSERT ... ON CONFLICT ... DO UPDATE/NOTHING` with real `PRIMARY KEY` / `UNIQUE` constraints named for conflict targets.
- Booleans: prefer `BOOLEAN` in PG where columns are 0/1 integers today, or keep `SMALLINT` — decide once and align types in the baseline DDL.

---

## 4. Rewrite all SQL in the application

**Scope**: Every `db.prepare(…)`, `db.run(…)`, `db.exec(…)` across `server/` (routes, middleware, lib, seed) that runs when `DATABASE_URL` is set.

**Work items**:

- Replace `?` with `$1`, `$2`, … (order must match param arrays).
- Replace SQLite-only constructs (`INSERT OR REPLACE`, `strftime`, etc.) with PostgreSQL equivalents.
- Re-test dynamic SQL builders (e.g. `UPDATE users SET ${updates.join(...)}`) — still valid if fragments use `$n` consistently.
- **Seed** ([server/db/seed.ts](server/db/seed.ts)): PG-compatible inserts/upserts.
- Keep **two bodies** of SQL only if you maintain a temporary dual-database period; long-term goal is **one** PostgreSQL SQL set.

A grep-oriented checklist: search for `prepare(`, `\.run(`, `INSERT OR`, `datetime`, `PRAGMA`, `?` inside SQL strings.

---

## 5. Standalone SQLite → PostgreSQL data migration script

**New** `scripts/migrate-sqlite-to-pg.ts`:

- **Not imported** by the HTTP server.
- **Input**: SQLite path (default `./dc-automation.db` or `DB_PATH` env), PostgreSQL connection from same config/env as the app.
- **Steps**:
  1. Open SQLite with **better-sqlite3** (read-only recommended).
  2. Ensure PG target has **baseline schema** applied (call shared `initSchemaPg()` from the script, or require empty DB + run DDL — document which).
  3. **Truncate or load into empty tables** in safe FK order (e.g. disable triggers/FK checks only if you use a pattern; preferable: empty DB + `COPY`/inserts in order).
  4. Copy rows table-by-table; log counts; use a **single transaction** on PG with rollback on failure.
- **Output**: stdout summary; non-zero exit on error.
- **NPM**: `"db:migrate": "tsx scripts/migrate-sqlite-to-pg.ts"` (or node entry).

**Wiki / files**: Document copying `content/wiki/` separately; not part of DB dump.

---

## 6. Application startup (PostgreSQL)

[server/index.ts](server/index.ts):

- **Do not** run the SQLite `initSchema(dbWrapper)` chain when using PostgreSQL.
- **Do** connect PG, optionally run **only** `initSchemaPg()` (baseline), then `runSeed()` / listen.
- **Never** auto-run `migrate-sqlite-to-pg` from here.

---

## 7. Config, Pi, and docs

- [docs/UPGRADE.md](docs/UPGRADE.md), [docs/MIGRATION_DC_AUTOMATION.md](docs/MIGRATION_DC_AUTOMATION.md): align names **`dc-automation.db`**, DC Automation paths, `DATABASE_URL`, **manual** `npm run db:migrate` before production cutover.
- `.env.example`: `DATABASE_URL`, `DB_PATH` (SQLite dev), `JWT_SECRET`, etc.

### Raspberry Pi — install PostgreSQL and hook up DC Automation

**Update** [docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md) (dedicated section or subsection) with operator-run steps, for example:

1. **Packages**: `sudo apt update` and `sudo apt install -y postgresql postgresql-contrib`; enable and start `postgresql` (`systemctl`).
2. **Database and role**: As `postgres`, create a login role and database for the app (e.g. `CREATE USER … WITH PASSWORD …`; `CREATE DATABASE … OWNER …`; `GRANT ALL ON DATABASE …` as needed). Use a strong password; align names with your `DATABASE_URL`.
3. **Connectivity**: For Node on the same Pi, prefer **`localhost`** TCP or Unix socket — document the chosen URL form (`postgresql://user:pass@localhost:5432/dbname`). If using TCP, ensure **`listen_addresses`** in `postgresql.conf` includes `localhost` and **`pg_hba.conf`** allows the app user from `127.0.0.1/::1` (e.g. `scram-sha-256` / `md5`). Only expose `5432` on the LAN if required; if so, firewall and pg_hba rules must be documented.
4. **DC Automation**: Set `DATABASE_URL` (or `config.json` `database.url`) for the **same user** PM2/systemd runs as; note path to config and restart after changes.
5. **First run / migrate**: After code supports PostgreSQL, either let the app apply baseline schema (if implemented) or document one-time `psql`/DDL; then run the **standalone** SQLite→PG data script when migrating an existing `dc-automation.db`.
6. **Optional Pi tuning**: Short note on memory-conscious settings (e.g. `shared_buffers`) for light hardware — link to PostgreSQL docs rather than duplicating.

**Cursor**: Keep [.cursor/plans/sqlite_to_postgresql_migration.plan.md](../.cursor/plans/sqlite_to_postgresql_migration.plan.md) updated in lockstep with this document.

---

## 8. Backup plan and ops (must update)

Today, [docs/BACKUP_SETUP.md](docs/BACKUP_SETUP.md) and [scripts/sqlite-dropbox-backup.sh](scripts/sqlite-dropbox-backup.sh) assume **SQLite** (`sqlite3 .backup`, `dc-automation.db`, file upload to Dropbox via rclone).

**PostgreSQL cutover requires updating the backup plan:**

- **Documentation**: Revise `BACKUP_SETUP.md` and cross-links ([docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md), [docs/SYSTEM_COMMANDS.md](docs/SYSTEM_COMMANDS.md) where backups are mentioned) for **`pg_dump`** (or equivalent), restore steps, retention, and rclone remote paths (compressed dumps vs a single `.db` file).
- **Scripts**: Provide a Postgres-oriented backup path (new script or documented `pg_dump` one-liner + cron) so production does not depend on `sqlite3 .backup`.
- **Transition**: While both DB backends exist, document two procedures or mark SQLite backup as legacy-only.

---

## File summary

| Action | File |
|--------|------|
| Create | `server/config.ts` — config loader |
| Create | `config.default.json` — default DB URL |
| Create | `server/db/pg.ts` — PostgreSQL pool + DbWrapper |
| Create | `server/db/schema-pg.ts` — **baseline** PG DDL only |
| Create | `scripts/migrate-sqlite-to-pg.ts` — **standalone** data copy; uses better-sqlite3 + `pg` |
| Modify | `server/db/index.ts` — branch SQLite vs PG |
| Modify | `server/index.ts` — PG: no SQLite migrations; no auto data migrate |
| Modify | **All** `server/**/*.ts` with SQL — PostgreSQL-native statements |
| Modify | `package.json` — `pg`, `db:migrate` |
| Modify | `.gitignore` — `config.json` if applicable |
| Create / update | PostgreSQL backup script + [docs/BACKUP_SETUP.md](docs/BACKUP_SETUP.md) (and cross-links) |
| Update | [docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md) — **PostgreSQL install, DB/user, networking, `DATABASE_URL` / PM2** |
| Update | User-facing docs — cutover, wiki tree; **backup strategy for PG** |

---

## Rollback / fallback

- Short term: keep SQLite path + [server/db/schema.ts](server/db/schema.ts) for local dev without Postgres.
- Long term: delete SQLite branch and `schema.ts` migrate graph once PG is validated (optional separate cleanup).
