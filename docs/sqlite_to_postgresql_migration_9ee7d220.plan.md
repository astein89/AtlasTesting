---
name: SQLite to PostgreSQL Migration
overview: Migrate Automation Testing from SQLite (sql.js) to PostgreSQL, add a one-time migration script, introduce a config file for connection info, and document PostgreSQL installation and setup for Raspberry Pi.
todos: []
isProject: false
---

# SQLite to PostgreSQL Migration Plan

## Current State

- **Database**: SQLite via [sql.js](server/db/index.ts) (WASM), persisted to `atlas.db`
- **API surface**: `db.prepare(sql).run/get/all(...params)` with `?` placeholders; `db.exec(sql)`
- **Schema**: 6 tables in [server/db/schema.ts](server/db/schema.ts) — users, fields, test_plans, test_runs, refresh_tokens, user_preferences
- **Config**: Only `DB_PATH` env var; no `.env.example` or config file

## Architecture

```mermaid
flowchart TB
    subgraph before [Current]
        App1[Express App]
        SqlJs[sql.js]
        AtlasDb[(atlas.db)]
        App1 --> SqlJs --> AtlasDb
    end

    subgraph after [Target]
        App2[Express App]
        PgWrapper[pg wrapper]
        Pg[(PostgreSQL)]
        Config[config / .env]
        App2 --> PgWrapper --> Pg
        Config --> PgWrapper
    end

    subgraph migration [One-time]
        MigrateScript[migrate-sqlite-to-pg.ts]
        SqlJsRead[sql.js read]
        PgWrite[pg write]
        MigrateScript --> SqlJsRead
        MigrateScript --> PgWrite --> Pg
    end
```



---

## 1. Add PostgreSQL Driver and Config

**Dependencies** ([package.json](package.json)):

- Add `pg` (node-postgres)
- Add `@types/pg` (dev)

**Config file** — create `config.default.json` (committed) and support `config.json` (gitignored override):

```json
{
  "database": {
    "url": "postgresql://atlas:atlas@localhost:5432/atlas"
  }
}
```

Or use env vars (override): `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

**Config loader** — new `server/config.ts`:

- Load `config.json` if present, else `config.default.json`
- Env vars override: `DATABASE_URL` or individual `DB_`* vars

---

## 2. PostgreSQL DB Module

**New** `server/db/pg.ts`:

- Connect via `pg.Pool` using config
- Implement same API as current wrapper:
  - `prepare(sql)` returns `{ run, get, all }`
  - Convert `?` placeholders to `$1`, `$2`, … before executing
  - `exec(sql)` for DDL (run raw SQL, no params)
- No `save()` — PostgreSQL persists automatically

**Update** `server/db/index.ts`:

- If `DATABASE_URL` or config has `database.url` → use PostgreSQL (`pg.ts`)
- Else → keep SQLite (sql.js) for backward compatibility during transition
- Or: remove SQLite path entirely and require PostgreSQL (simpler long-term)

**Recommendation**: Require PostgreSQL when migrating; remove SQLite from production path. Keep SQLite only for local dev without PostgreSQL if desired, or drop it.

---

## 3. PostgreSQL Schema

**New** `server/db/schema-pg.ts`:

- PostgreSQL DDL (no SQLite-specific syntax):
  - `TEXT` → `TEXT`
  - `datetime('now')` → `DEFAULT CURRENT_TIMESTAMP`
  - `PRAGMA` / `information_schema` for migrations
- Create tables in dependency order: users → fields → test_plans → test_runs → refresh_tokens → user_preferences
- Indexes: `idx_test_runs_test_plan_id`, `idx_test_runs_run_at`
- Run `initSchemaPg()` on first connect

**Schema differences**:

- PostgreSQL uses `SERIAL`/`BIGSERIAL` for auto-increment (we use UUIDs, so no change)
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING` (only in migrations; app uses normal INSERT)

---

## 4. Migration Script (SQLite → PostgreSQL)

**New** `scripts/migrate-sqlite-to-pg.ts` (or `server/scripts/migrate-sqlite-to-pg.ts`):

1. **Input**: Path to `atlas.db` (default: `./atlas.db`), PostgreSQL connection from config/env
2. **Process**:
  - Load SQLite DB with sql.js from file
  - Connect to PostgreSQL
  - Ensure PostgreSQL schema exists (`initSchemaPg`)
  - Export data in FK order: users → fields → test_plans → test_runs → refresh_tokens → user_preferences
  - For each table: `SELECT` *, then `INSERT` into PostgreSQL (handle JSON columns as-is; both store as TEXT)
3. **Output**: Log row counts per table, success/failure
4. **Safety**: Dry-run mode optional; transaction for all inserts (rollback on error)

**NPM script**: `"db:migrate": "tsx scripts/migrate-sqlite-to-pg.ts"`

---

## 5. Update Route Imports and Schema Init

- [server/db/schema.ts](server/db/schema.ts): Keep for SQLite migration script; add `schema-pg.ts` for PostgreSQL
- [server/index.ts](server/index.ts): Call `initSchemaPg` (or equivalent) when using PostgreSQL; `runSeed()` unchanged (uses `db` abstraction)
- All route files: No changes — they use `db` from `../db/index.js`

---

## 6. Config File and Env

**Files**:

- `config.default.json` — default connection (localhost, atlas/atlas/atlas)
- `config.json` — gitignored, user overrides
- `.env.example` — document `DATABASE_URL`, `DB_PATH` (legacy), `PORT`, `JWT_SECRET`

**Precedence**: Env vars > `config.json` > `config.default.json`

---

## 7. Raspberry Pi Guide

**New section** in [docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md) (or new `docs/POSTGRES_SETUP.md`):

### Install PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### Create Database and User

```bash
sudo -u postgres psql -c "CREATE USER atlas WITH PASSWORD 'your-secure-password';"
sudo -u postgres psql -c "CREATE DATABASE atlas OWNER atlas;"
```

### Config

Create `~/automation-testing/config.json`:

```json
{
  "database": {
    "url": "postgresql://atlas:your-secure-password@localhost:5432/atlas"
  }
}
```

Or set `DATABASE_URL` in `ecosystem.config.cjs` env.

### Migrate Existing Data (if upgrading)

```bash
cd ~/automation-testing
npm run db:migrate
```

### Update ecosystem.config.cjs

Add `DATABASE_URL` to env (or rely on config.json in cwd).

---

## 8. Documentation Updates

- [docs/UPGRADE.md](docs/UPGRADE.md): Add "Migrating from SQLite to PostgreSQL" section — backup atlas.db, run migration script, set config, restart
- [docs/RASPBERRY_PI_SETUP.md](docs/RASPBERRY_PI_SETUP.md): Add PostgreSQL install step; update "Database Location" to reference PostgreSQL
- README: Note PostgreSQL requirement, link to config and setup docs

---

## File Summary


| Action        | File                                                      |
| ------------- | --------------------------------------------------------- |
| Create        | `server/config.ts` — config loader                        |
| Create        | `config.default.json` — default DB URL                    |
| Create        | `server/db/pg.ts` — PostgreSQL wrapper (prepare/exec API) |
| Create        | `server/db/schema-pg.ts` — PostgreSQL DDL                 |
| Create        | `scripts/migrate-sqlite-to-pg.ts` — one-time migration    |
| Create        | `.env.example` — env var template                         |
| Modify        | `server/db/index.ts` — switch to pg when configured       |
| Modify        | `server/index.ts` — init pg schema, pass config           |
| Modify        | `package.json` — add pg, db:migrate script                |
| Modify        | `.gitignore` — add config.json                            |
| Create/Update | `docs/POSTGRES_SETUP.md` or extend RASPBERRY_PI_SETUP.md  |
| Update        | `docs/UPGRADE.md` — migration section                     |


---

## Placeholder Conversion

SQLite: `WHERE id = ?`  
PostgreSQL: `WHERE id = $1`

Wrapper logic in `prepare()`:

```ts
let paramIndex = 0
const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`)
```

---

## Rollback / Fallback

- Keep SQLite code path behind `DB_PATH` or absence of `DATABASE_URL` for dev without PostgreSQL
- Or remove SQLite entirely once migration is validated

