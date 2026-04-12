# Upgrading DC Automation to PostgreSQL

This guide is for **operators** who already run DC Automation on **SQLite** (`dc-automation.db`) and want to move to **PostgreSQL**, or who are **deploying fresh** against an empty PostgreSQL database.

**Related docs**

| Topic | Document |
| --- | --- |
| Install PostgreSQL on a Raspberry Pi | [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md) (section *Optional: PostgreSQL*) |
| Backups after cutover (`pg_dump`, rclone) | [BACKUP_SETUP.md](BACKUP_SETUP.md) |
| Full migration design / file map | [sqlite_to_postgresql_migration_9ee7d220.plan.md](sqlite_to_postgresql_migration_9ee7d220.plan.md) |

---

## SQLite → PostgreSQL at a glance

To **copy an existing SQLite database into PostgreSQL**, you run the **one-time import** command:

```bash
npm run db:migrate
```

That runs [`scripts/migrate-sqlite-to-pg.ts`](../scripts/migrate-sqlite-to-pg.ts). It:

1. Requires a **PostgreSQL URL** via **`DATABASE_URL`** (or **`databaseUrl`** in **`config.json`**).
2. Locates your **SQLite file** (see [Where the migration reads SQLite from](#where-the-migration-reads-sqlite-from)).
3. Creates the **baseline PostgreSQL schema** if needed, then **copies rows** from SQLite into PostgreSQL.

It does **not** copy wiki markdown (**`content/wiki/`** is always on disk) or uploaded files (**`uploads/`**). Back those up separately if you change hosts—see [BACKUP_SETUP.md](BACKUP_SETUP.md).

**Jump to:** [B. Cutover from existing SQLite](#b-cutover-from-existing-sqlite-keep-your-data) · [New deployment (no import)](#a-new-deployment-no-sqlite-data-to-import)

---

### Where the migration reads SQLite from

The migration resolves the SQLite file in this order:

| Source | Example |
| --- | --- |
| **`SQLITE_PATH`** or **`DB_PATH`** environment variable | Path is resolved **relative to the project root** (the folder that contains `package.json`), not your shell’s current directory. Example: `export DB_PATH=./dc-automation.db` or `export DB_PATH=/var/lib/dc-automation/dc-automation.db` |
| *(if unset)* | **`dc-automation.db`** in the **project root** (next to `package.json`) |

So for a typical Pi checkout at **`~/dc-automation`**, either place **`dc-automation.db`** there or set **`DB_PATH`** / **`SQLITE_PATH`** to point at your backup copy before running **`npm run db:migrate`**.

---

## How the app chooses the database

- If **`DATABASE_URL`** is set (or `config.json` contains a non-empty **`databaseUrl`**), the server uses **PostgreSQL** and applies the **baseline schema** on startup.
- If not, the server uses **SQLite** (`DB_PATH` or `dc-automation.db` in the project root).

See [`.env.example`](../.env.example) and [config.default.json](../config.default.json). Local overrides can live in **`config.json`** (gitignored).

---

## A. New deployment (no SQLite data to import)

1. Install and create a PostgreSQL database and user (see [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md) for Debian/Raspberry Pi OS examples).
2. Set **`DATABASE_URL`**, for example:

   ```text
   postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE_NAME
   ```

3. Deploy the app and start it (`npm run dev`, PM2, systemd, etc.). The first run creates tables in PostgreSQL.
4. If the database is empty, **`npm run db:seed`** seeds a default admin user (same as SQLite workflow).
5. **Wiki content** lives under **`content/wiki/`** on disk, not in the database—deploy that directory with the app if you use the wiki.

---

## B. Cutover from existing SQLite (keep your data)

Use this when you already have a **`dc-automation.db`** (or custom **`DB_PATH`**) and want **the same data** in PostgreSQL. Do it in a **maintenance window** if the app is live.

### Before you run `npm run db:migrate`

| Requirement | Notes |
| --- | --- |
| **SQLite file** | Readable path—default **`dc-automation.db`** in the project root, or set **`DB_PATH`** / **`SQLITE_PATH`** (see [above](#where-the-migration-reads-sqlite-from)). |
| **PostgreSQL** | Empty database (or one you are allowed to overwrite). [Create user + DB](RASPBERRY_PI_SETUP.md#optional-postgresql-instead-of-sqlite) first. |
| **URL** | **`DATABASE_URL`** (or **`databaseUrl`** in **`config.json`**) must point at that PostgreSQL database **before** you run the migration. |
| **Node deps** | From the **project root**, run **`npm ci`** or **`npm install`** so **`npm run db:migrate`** can run. |

### Steps

1. **Stop** the DC Automation process (PM2, systemd, etc.).
2. **Back up** the SQLite file and **`content/wiki/`** (and **`uploads/`** if you care about file uploads). Keep the SQLite path unchanged until the migration succeeds, or copy the file to **`dc-automation.db`** in the project root (next to **`package.json`**) and use that.
3. **Create** an empty PostgreSQL database and user with correct **`public`** privileges (see [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md)).
4. **Set** **`DATABASE_URL`** to the new database. Do **not** point production traffic at the app until the migration finishes successfully.
5. **Run the import** from the **project root** (folder with **`package.json`**):

   **PowerShell** (recommended on Windows—`set` does **not** set env vars for `npm` here):

   ```powershell
   $env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
   # Only if SQLite is not at .\dc-automation.db (paths relative to project root):
   # $env:DB_PATH = ".\backups\dc-automation.db"
   npm run db:migrate
   ```

   **Command Prompt (cmd.exe):**

   ```bat
   set DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
   rem Optional: set DB_PATH=backups\dc-automation.db
   npm run db:migrate
   ```

   **bash / Linux / macOS (e.g. Raspberry Pi):**

   ```bash
   cd ~/dc-automation   # your checkout
   export DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/dc-automation"
   # Optional if the DB file is not ./dc-automation.db:
   # export DB_PATH=/path/to/dc-automation.db
   npm run db:migrate
   ```

   You can put **`databaseUrl`** in **`config.json`** instead of **`DATABASE_URL`** (same merge order as the app: env overrides file).

6. **Confirm** exit code **0** and read the per-table row counts printed in the log.
7. **Start** the app **with only** **`DATABASE_URL`** set (no SQLite **`DB_PATH`** needed for normal operation). The server uses PostgreSQL; it does **not** re-import on every boot.
8. **Smoke-test**: log in, open Testing/Locations/Files/Wiki, do one read and one write.

If **`npm run db:migrate`** says the SQLite file was not found, fix **`DB_PATH`** / **`SQLITE_PATH`** or copy **`dc-automation.db`** into the project root under the expected name.

---

## Verification

- Logs show a clean PostgreSQL connection (no SQLite path when `DATABASE_URL` is set).
- User counts and a few critical records match expectations versus the old SQLite backup (spot-check).

---

## Troubleshooting

### `permission denied for schema public` (SQLSTATE `42501`)

PostgreSQL **15+** tightened defaults: your app user may **CONNECT** to the database but not **CREATE** objects in `public`. Common when the DB was created as **`postgres`** and only **`GRANT ALL ON DATABASE`** was given to the app user.

Connect as a superuser (often OS user `postgres` on Linux, or an admin role on Windows) and fix **your database name** and **your app role** (URL user):

```sql
\c "dc-automation"
GRANT ALL ON SCHEMA public TO dcauto;
ALTER SCHEMA public OWNER TO dcauto;
```

(`\c` is a **psql** meta-command; use quotes if the database name contains hyphens. In GUI tools, select the target DB first, then run the two SQL lines.)

Prefer creating the database as **`CREATE DATABASE ... OWNER appuser;`** so this is rarely needed—see [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md).

---

## Rollback

- Point the app back at SQLite: **remove** `DATABASE_URL` (and `databaseUrl` from config), set **`DB_PATH`** to your **backed-up** `.db` file if needed, restart.
- Do **not** rely on `npm run db:migrate` to undo a migration—it is import-only.

---

## Do not

- Run **`db:migrate`** from the HTTP server or schedule it on every boot—it is a **one-time** operator command.
- Manually replay old SQLite migration scripts inside PostgreSQL; the app uses a **single baseline schema** for PostgreSQL.
