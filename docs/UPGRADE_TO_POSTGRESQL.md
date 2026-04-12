# Upgrading DC Automation to PostgreSQL

This guide is for **operators** who already run DC Automation on **SQLite** (`dc-automation.db`) and want to move to **PostgreSQL**, or who are **deploying fresh** against an empty PostgreSQL database.

**Related docs**

| Topic | Document |
| --- | --- |
| Install PostgreSQL on a Raspberry Pi | [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md) (section *Optional: PostgreSQL*) |
| Backups after cutover (`pg_dump`, rclone) | [BACKUP_SETUP.md](BACKUP_SETUP.md) |
| Full migration design / file map | [sqlite_to_postgresql_migration_9ee7d220.plan.md](sqlite_to_postgresql_migration_9ee7d220.plan.md) |

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

Do this in a **maintenance window** if the app is live.

1. **Stop** the application.
2. **Back up** the SQLite file (copy `dc-automation.db` or your `DB_PATH` file) and, if you move servers, the **`content/wiki/`** tree.
3. Prepare an **empty** PostgreSQL database (new DB, or drop/recreate schemas—avoid mixing old PG data unless you know what you are doing).
4. Set **`DATABASE_URL`** in the environment (or `config.json`) to that database, but **do not** start serving production traffic yet until migration succeeds.
5. From the project root, with the same Node dependencies installed (`npm ci`):

   **PowerShell** (recommended on Windows—`set` does **not** set env vars for `npm` here):

   ```powershell
   $env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DBNAME"
   $env:DB_PATH = "C:\path\to\dc-automation.db"   # optional if the DB is at project root
   npm run db:migrate
   ```

   **Command Prompt (cmd.exe):**

   ```bat
   set DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
   set DB_PATH=C:\path\to\dc-automation.db
   npm run db:migrate
   ```

   **bash / Linux / macOS:**

   ```bash
   export DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
   export DB_PATH=/path/to/dc-automation.db
   npm run db:migrate
   ```

   Alternatively, put **`databaseUrl`** in **`config.json`** (same merge rules as the app: env wins over `config.json` over `config.default.json`).  
   The script reads SQLite from **`DB_PATH`**, **`SQLITE_PATH`**, or defaults to `./dc-automation.db`.

6. Confirm the script exits with code **0** and review the per-table row counts in the log.
7. **Start** the app with **`DATABASE_URL`** set. The app will not re-run the data copy on boot.
8. **Smoke-test**: login, open Testing/Locations, perform one read and one write.

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
\c dc-automation
GRANT ALL ON SCHEMA public TO dcauto;
ALTER SCHEMA public OWNER TO dcauto;
```

(`\c` is a **psql** meta-command; in GUI tools, select the target DB first, then run the two SQL lines.)

Prefer creating the database as **`CREATE DATABASE ... OWNER appuser;`** so this is rarely needed—see [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md).

---

## Rollback

- Point the app back at SQLite: **remove** `DATABASE_URL` (and `databaseUrl` from config), set **`DB_PATH`** to your **backed-up** `.db` file if needed, restart.
- Do **not** rely on `npm run db:migrate` to undo a migration—it is import-only.

---

## Do not

- Run **`db:migrate`** from the HTTP server or schedule it on every boot—it is a **one-time** operator command.
- Manually replay old SQLite migration scripts inside PostgreSQL; the app uses a **single baseline schema** for PostgreSQL.
