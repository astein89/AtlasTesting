import { randomUUID } from 'node:crypto'

/** Prepared statement handle (better-sqlite3 style) used by schema migrations. */
export interface PreparedStatement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): Record<string, string | number | null> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

/** DB wrapper used by schema (prepare/run/exec). */
export interface DbWrapper {
  prepare(sql: string): PreparedStatement
  run(sql: string, params?: unknown[] | unknown): void
  exec(sql: string): void
}

/** Async DB surface used by routes and PostgreSQL (pg is promise-based). */
export interface AsyncPreparedStatement {
  run(...params: unknown[]): Promise<{ changes: number }>
  get(...params: unknown[]): Promise<Record<string, string | number | null> | undefined>
  all(...params: unknown[]): Promise<Record<string, unknown>[]>
}

export interface AsyncDbWrapper {
  prepare(sql: string): AsyncPreparedStatement
  run(sql: string, params?: unknown[] | unknown): Promise<void>
  exec(sql: string): Promise<void>
}

/** PRAGMA table_info column names. `table` must be a trusted identifier (migration-only). */
function tableColumnNames(db: DbWrapper, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function migrateEmailToUsername(db: DbWrapper) {
  try {
    if (!tableColumnNames(db, 'users').includes('email')) return
    db.run(`ALTER TABLE users RENAME COLUMN email TO username`)
  } catch {
    // Ignore migration errors (e.g. column already renamed)
  }
}

/** Optional alternate login identifier; unique when set (SQLite allows multiple NULLs). */
function migrateUsersShortName(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'users')
    if (!cols.includes('short_name')) {
      db.run('ALTER TABLE users ADD COLUMN short_name TEXT')
    }
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_short_name ON users(short_name)')
  } catch {
    // Ignore
  }
}

/** Force password update when the stored password no longer meets policy (set on login). */
function migrateUserPasswordChangeRequired(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'users')
    if (!cols.includes('password_change_required')) {
      db.run('ALTER TABLE users ADD COLUMN password_change_required INTEGER NOT NULL DEFAULT 0')
    }
  } catch {
    // Ignore
  }
}

function migrateFieldsOwnerTestPlanId(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'fields').includes('owner_test_plan_id')) return
    db.run('ALTER TABLE fields ADD COLUMN owner_test_plan_id TEXT')
  } catch {
    // Ignore migration errors (older DBs may not support ALTER in some environments)
  }
}

export function initSchema(db: DbWrapper) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      short_name TEXT,
      password_hash TEXT NOT NULL,
      password_change_required INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fields (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS test_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      field_ids TEXT,
      field_layout TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      test_plan_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      entered_by TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT,
      FOREIGN KEY (test_plan_id) REFERENCES test_plans(id),
      FOREIGN KEY (entered_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Location schemas: user-configurable definition of location components/order.
    CREATE TABLE IF NOT EXISTS location_schemas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    -- Components (parts) of a schema, ordered.
    CREATE TABLE IF NOT EXISTS location_schema_components (
      id TEXT PRIMARY KEY,
      schema_id TEXT NOT NULL,
      key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'alpha' | 'numeric' | 'mixed' | 'fixed'
      width INTEGER NOT NULL,
      pattern_mask TEXT, -- mixed only: @ letter, # digit, other chars literal (stricter than field masks)
      min_value TEXT,
      max_value TEXT,
      order_index INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (schema_id) REFERENCES location_schemas(id)
    );

    -- Optional metadata fields per schema (number, text, select) — not part of location code.
    CREATE TABLE IF NOT EXISTS location_schema_fields (
      id TEXT PRIMARY KEY,
      schema_id TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL, -- 'number' | 'text' | 'select'
      config TEXT,
      order_index INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (schema_id) REFERENCES location_schemas(id),
      UNIQUE(schema_id, key)
    );

    -- Zones/groupings for locations (each tied to one schema).
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schema_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(name),
      FOREIGN KEY (schema_id) REFERENCES location_schemas(id)
    );

    -- Concrete locations: one row per location, components stored as JSON.
    -- Same location string may exist in different zones; uniqueness is per zone.
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      schema_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      location TEXT NOT NULL,
      components TEXT NOT NULL, -- JSON: { key: value }
      field_values TEXT, -- JSON: optional schema field values (number | text | select)
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (schema_id) REFERENCES location_schemas(id),
      FOREIGN KEY (zone_id) REFERENCES zones(id),
      UNIQUE(zone_id, location)
    );
  `)
  migrateEmailToUsername(db)
  migrateUsersShortName(db)
  migrateUserPasswordChangeRequired(db)
  migrateFieldsOwnerTestPlanId(db)
  migrateTestsToPlans(db)
  migratePlanFieldIds(db)
  migratePlanFieldLayout(db)
  migratePlanFormLayout(db)
  migratePlanDefaultSortOrder(db)
  migratePlanFieldDefaults(db)
  migratePlanKeyField(db)
  migratePlanHiddenFieldIds(db)
  migratePlanRequiredFieldIds(db)
  migratePlanDefaultVisibleColumns(db)
  migratePlanStartEndDate(db)
  migratePlanArchivedRuns(db)
  migratePlanConditionalStatusRules(db)
  migratePlanConditionalStatusRuleOrder(db)
  migratePlanMainStatusFieldId(db)
  migrateTestRunsRunId(db)
  migrateTestsTableAndBackfill(db)
  migrateTestingSlugColumns(db)
  migrateLocationSlugColumns(db)
  migrateFileFolderSlugColumns(db)
  migratePlanConstraints(db)
  migratePlanShortDescription(db)
  migrateRecordsToPlanDirect(db)
  migrateUserPreferences(db)
  migrateFieldsAudit(db)
  migrateRecordHistory(db)
  migrateLocationSchemaFieldsAndFieldValues(db)
  migrateLocationSchemaComponentPatternMask(db)
  migrateLocationSchemaComponentMixToMixed(db)
  migrateLocationsCodeToLocationColumn(db)
  migrateLocationsUniquePerZone(db)
  migrateDropLocationSchemaCodePattern(db)
  migrateTestPlansAndTestsUpdatedAt(db)
  migrateAppKv(db)
  migrateHomeLinksTable(db)
  migrateHomeLinksFromAppKv(db)
  migrateHomeLinkCategoriesTable(db)
  migrateHomeLinksCategoryId(db)
  migrateHomeLinksShowOnHome(db)
  migrateHomeLinksHomeSortOrder(db)
  migrateRoles(db)
  migrateRolesReplaceDataWrite(db)
  migrateUserRoles(db)
  migrateRolesAddLocationsSchemasManage(db)
  migrateRolesAddLinksEdit(db)
  migrateStoredFiles(db)
  migrateFileFolders(db)
  migrateStoredFilesExplorerColumns(db)
  migrateStoredFilesRoleOnlyAcl(db)
  migrateFileFoldersAllowedRoleSlugs(db)
  migrateStoredFilesInheritFolderAcl(db)
  migrateStoredFilesRecycle(db)
  migrateStoredFilesRecycleOriginalFolder(db)
  migrateStoredFilesRecycleFolderLabel(db)
  migrateRolesGrantModuleFiles(db)
  migrateAmrTables(db)
  migrateAmrMissionWorkerClosed(db)
  migrateAmrMultistopSessions(db)
  migrateAmrMissionTemplates(db)
  migrateAmrMissionRecordLockedRobot(db)
  migrateAmrStandsSpecialLocationFlags(db)
  migrateAmrStandsBypassPalletCheck(db)
  migrateAmrStandsActiveMissions(db)
  migrateAmrStandsLocationType(db)
  migrateAmrMissionQueueing(db)
  migrateAmrStandGroups(db)
  migrateAmrRobots(db)
  migrateRolesGrantModuleAmr(db)
  migrateRolesAddAmrStandsOverrideSpecial(db)
  migrateRolesSeedAmrOperator(db)
  // Create indexes after migrations (test_runs may have had test_id before migrateRecordsToPlanDirect)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_plan_id ON test_runs(test_plan_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_id ON test_runs(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_run_at ON test_runs(run_at);
    CREATE INDEX IF NOT EXISTS idx_tests_test_plan_id ON tests(test_plan_id);
    CREATE INDEX IF NOT EXISTS idx_record_history_record_id ON record_history(record_id);
  `)
}

function migrateRecordHistory(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS record_history (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        action TEXT NOT NULL,
        old_data TEXT,
        old_status TEXT,
        new_data TEXT,
        new_status TEXT
      )
    `)
  } catch {
    // Ignore
  }
}

function migrateLocationSchemaComponentPatternMask(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'location_schema_components').includes('pattern_mask')) return
    db.run('ALTER TABLE location_schema_components ADD COLUMN pattern_mask TEXT')
  } catch {
    // Ignore
  }
}

function migrateLocationSchemaComponentMixToMixed(db: DbWrapper) {
  try {
    db.run(`UPDATE location_schema_components SET type = 'mixed' WHERE type = 'mix'`)
  } catch {
    // Ignore
  }
}

function migrateLocationsCodeToLocationColumn(db: DbWrapper) {
  try {
    const colNames = tableColumnNames(db, 'locations')
    if (colNames.includes('location')) return
    if (!colNames.includes('code')) return
    db.run('ALTER TABLE locations RENAME COLUMN code TO location')
  } catch {
    // Ignore
  }
}

/** Replace global UNIQUE(location) with UNIQUE(zone_id, location) so the same code can exist in different zones. */
function migrateLocationsUniquePerZone(db: DbWrapper) {
  try {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='locations'`)
      .get() as { sql?: string } | undefined
    const sql = row?.sql
    if (!sql || typeof sql !== 'string') return
    if (sql.includes('UNIQUE (zone_id, location)') || sql.includes('UNIQUE(zone_id, location)')) return
    db.exec(`
      CREATE TABLE locations_new (
        id TEXT PRIMARY KEY,
        schema_id TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        location TEXT NOT NULL,
        components TEXT NOT NULL,
        field_values TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY (schema_id) REFERENCES location_schemas(id),
        FOREIGN KEY (zone_id) REFERENCES zones(id),
        UNIQUE(zone_id, location)
      );
      INSERT INTO locations_new SELECT * FROM locations;
      DROP TABLE locations;
      ALTER TABLE locations_new RENAME TO locations;
    `)
  } catch {
    // Ignore
  }
}

function migrateDropLocationSchemaCodePattern(db: DbWrapper) {
  try {
    if (!tableColumnNames(db, 'location_schemas').includes('code_pattern')) return
    db.run('ALTER TABLE location_schemas DROP COLUMN code_pattern')
  } catch {
    // Ignore (e.g. SQLite < 3.35 without DROP COLUMN — column remains unused)
  }
}

function migrateLocationSchemaFieldsAndFieldValues(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS location_schema_fields (
        id TEXT PRIMARY KEY,
        schema_id TEXT NOT NULL,
        key TEXT NOT NULL,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT,
        order_index INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY (schema_id) REFERENCES location_schemas(id),
        UNIQUE(schema_id, key)
      )
    `)
  } catch {
    // Ignore
  }
  try {
    if (tableColumnNames(db, 'locations').includes('field_values')) return
    db.run('ALTER TABLE locations ADD COLUMN field_values TEXT')
  } catch {
    // Ignore
  }
}

function migrateRecordsToPlanDirect(db: DbWrapper) {
  try {
    const trRows = db.prepare('PRAGMA table_info(test_runs)').all() as Array<{ name: string }>
    const hasTestId = trRows.some((r) => r.name === 'test_id')
    if (!hasTestId) {
      db.run('DROP TABLE IF EXISTS tests')
      return
    }
    const testsRows = db.prepare('PRAGMA table_info(tests)').all() as Array<{ name: string }>
    const testCols = testsRows.map((r) => r.name)
    if (testCols.includes('archived')) return
    db.exec(`
      CREATE TABLE test_runs_new (
        id TEXT PRIMARY KEY,
        test_plan_id TEXT NOT NULL,
        run_at TEXT NOT NULL,
        entered_by TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT,
        FOREIGN KEY (test_plan_id) REFERENCES test_plans(id),
        FOREIGN KEY (entered_by) REFERENCES users(id)
      );
      INSERT INTO test_runs_new (id, test_plan_id, run_at, entered_by, status, data)
      SELECT tr.id, t.test_plan_id, tr.run_at, tr.entered_by, tr.status, tr.data
      FROM test_runs tr JOIN tests t ON tr.test_id = t.id;
      DROP TABLE test_runs;
      ALTER TABLE test_runs_new RENAME TO test_runs;
      CREATE INDEX IF NOT EXISTS idx_test_runs_test_plan_id ON test_runs(test_plan_id);
      CREATE INDEX IF NOT EXISTS idx_test_runs_run_at ON test_runs(run_at);
      DROP TABLE IF EXISTS tests;
    `)
  } catch {
    // Ignore
  }
}

function migratePlanConstraints(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('constraints')) return
    db.run('ALTER TABLE test_plans ADD COLUMN constraints TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanShortDescription(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('short_description')) return
    db.run('ALTER TABLE test_plans ADD COLUMN short_description TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanFieldLayout(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('field_layout')) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_layout TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanFormLayout(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('form_layout')) return
    db.run('ALTER TABLE test_plans ADD COLUMN form_layout TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanDefaultSortOrder(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('default_sort_order')) return
    db.run('ALTER TABLE test_plans ADD COLUMN default_sort_order TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanDefaultVisibleColumns(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('default_visible_columns')) return
    db.run('ALTER TABLE test_plans ADD COLUMN default_visible_columns TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanFieldDefaults(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('field_defaults')) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_defaults TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanKeyField(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('key_field')) return
    db.run('ALTER TABLE test_plans ADD COLUMN key_field TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanHiddenFieldIds(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('hidden_field_ids')) return
    db.run('ALTER TABLE test_plans ADD COLUMN hidden_field_ids TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanRequiredFieldIds(db: DbWrapper) {
  try {
    if (tableColumnNames(db, 'test_plans').includes('required_field_ids')) return
    db.run('ALTER TABLE test_plans ADD COLUMN required_field_ids TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanStartEndDate(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'test_plans')
    if (!cols.includes('start_date')) {
      db.run('ALTER TABLE test_plans ADD COLUMN start_date TEXT')
    }
    if (!cols.includes('end_date')) {
      db.run('ALTER TABLE test_plans ADD COLUMN end_date TEXT')
    }
  } catch {
    // Ignore
  }
}

function migratePlanArchivedRuns(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'test_plans')
    if (!cols.includes('archived_runs')) {
      db.run('ALTER TABLE test_plans ADD COLUMN archived_runs TEXT')
    }
  } catch {
    // Ignore
  }
}

function migratePlanConditionalStatusRules(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'test_plans')
    if (!cols.includes('conditional_status_rules')) {
      db.run('ALTER TABLE test_plans ADD COLUMN conditional_status_rules TEXT')
    }
  } catch {
    // Ignore
  }
}

function migratePlanConditionalStatusRuleOrder(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'test_plans')
    if (!cols.includes('conditional_status_rule_order')) {
      db.run('ALTER TABLE test_plans ADD COLUMN conditional_status_rule_order TEXT')
    }
  } catch {
    // Ignore
  }
}

function migratePlanMainStatusFieldId(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'test_plans')
    if (!cols.includes('main_status_field_id')) {
      db.run('ALTER TABLE test_plans ADD COLUMN main_status_field_id TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateTestRunsRunId(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'test_runs')
    if (!cols.includes('run_id')) {
      db.run('ALTER TABLE test_runs ADD COLUMN run_id TEXT')
    }
  } catch {
    // Ignore
  }
}

/** Create tests table (first-class tests under a plan), add test_id to test_runs, backfill one Legacy test per plan. */
function migrateTestingSlugColumns(db: DbWrapper) {
  try {
    const planCols = tableColumnNames(db, 'test_plans')
    if (!planCols.includes('slug')) {
      db.run('ALTER TABLE test_plans ADD COLUMN slug TEXT')
    }
    const testCols = tableColumnNames(db, 'tests')
    if (!testCols.includes('slug')) {
      db.run('ALTER TABLE tests ADD COLUMN slug TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateLocationSlugColumns(db: DbWrapper) {
  try {
    const schemaCols = tableColumnNames(db, 'location_schemas')
    if (!schemaCols.includes('slug')) {
      db.run('ALTER TABLE location_schemas ADD COLUMN slug TEXT')
    }
    const zoneCols = tableColumnNames(db, 'zones')
    if (!zoneCols.includes('slug')) {
      db.run('ALTER TABLE zones ADD COLUMN slug TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateFileFolderSlugColumns(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'file_folders')
    if (!cols.includes('slug')) {
      db.run('ALTER TABLE file_folders ADD COLUMN slug TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateTestsTableAndBackfill(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tests (
        id TEXT PRIMARY KEY,
        test_plan_id TEXT NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (test_plan_id) REFERENCES test_plans(id)
      )
    `)
    const trRows = db.prepare('PRAGMA table_info(test_runs)').all() as Array<{ name: string }>
    const trCols = trRows.map((r) => r.name)
    if (!trCols.includes('test_id')) {
      db.run('ALTER TABLE test_runs ADD COLUMN test_id TEXT REFERENCES tests(id)')
    }
    // Ensure every legacy plan that already has records gets a Legacy test and backfill records to it.
    // New plans created after this migration should manage their own tests explicitly.
    const planIdsWithRecords = db
      .prepare('SELECT DISTINCT test_plan_id FROM test_runs')
      .all() as Array<{ test_plan_id: string }>
    for (const { test_plan_id: planId } of planIdsWithRecords) {
      const legacyId = `legacy-${planId}`
      const existing = db
        .prepare('SELECT id FROM tests WHERE id = ?')
        .get(legacyId) as { id: string } | undefined
      if (!existing) {
        db.prepare(
          'INSERT INTO tests (id, test_plan_id, name, start_date, end_date, archived) VALUES (?, ?, ?, NULL, NULL, 0)'
        ).run(legacyId, planId, 'Legacy')
      }
      db.prepare(
        'UPDATE test_runs SET test_id = ? WHERE test_plan_id = ? AND (test_id IS NULL OR test_id = \'\')'
      ).run(legacyId, planId)
    }
  } catch {
    // Ignore
  }
}

function migratePlanFieldIds(db: DbWrapper) {
  try {
    const planInfo = db.prepare('PRAGMA table_info(test_plans)').all() as Array<{ name: string }>
    const hasFieldIds = planInfo.some((r) => r.name === 'field_ids')
    if (hasFieldIds) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_ids TEXT')
    const tablesList = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tests'").all() as Array<{ name: string }>
    if (!tablesList.length) return
    const rowsList = db.prepare('SELECT test_plan_id, field_ids FROM tests').all() as Array<{ test_plan_id: string; field_ids: string }>
    const planFields = new Map<string, string>()
    for (const row of rowsList) {
      if (!planFields.has(row.test_plan_id)) {
        planFields.set(row.test_plan_id, row.field_ids)
      }
    }
    for (const [planId, fieldIds] of planFields) {
      db.run('UPDATE test_plans SET field_ids = ? WHERE id = ?', [fieldIds, planId])
    }
  } catch {
    // Ignore
  }
}

function migrateUserPreferences(db: DbWrapper) {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)
  } catch {
    // Ignore
  }
}

/** Key-value store for app-wide config (e.g. home page intro / logo JSON). */
function migrateAppKv(db: DbWrapper) {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS app_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  } catch {
    // Ignore
  }
}

/** Home hub custom links (see `server/routes/home.ts`). Named `home_links` to avoid clashing with unrelated legacy `links` tables. */
function migrateHomeLinksTable(db: DbWrapper) {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS home_links (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        href TEXT NOT NULL,
        allowed_role_slugs TEXT,
        required_permission TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        category_id TEXT,
        show_on_home INTEGER NOT NULL DEFAULT 1,
        home_sort_order INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_home_links_sort_order ON home_links(sort_order)')
  } catch {
    // Ignore
  }
}

const HOME_PAGE_KV_KEY = 'home_page'

/** One-time: copy legacy `customLinks` from app_kv JSON into `home_links`, then strip them from KV. */
function migrateHomeLinksFromAppKv(db: DbWrapper) {
  try {
    const cnt = db.prepare('SELECT COUNT(*) as c FROM home_links').get() as { c: number } | undefined
    if (!cnt || cnt.c > 0) return
    const row = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(HOME_PAGE_KV_KEY) as
      | { value: string }
      | undefined
    if (!row?.value?.trim()) return
    let j: Record<string, unknown>
    try {
      j = JSON.parse(row.value) as Record<string, unknown>
    } catch {
      return
    }
    const raw = j.customLinks
    if (!Array.isArray(raw) || raw.length === 0) return
    const ins = db.prepare(`
      INSERT INTO home_links (id, title, description, href, allowed_role_slugs, required_permission, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    let order = 0
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id =
        typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 80) : randomUUID()
      const title = typeof o.title === 'string' ? o.title : ''
      const description = typeof o.description === 'string' ? o.description : ''
      const href = typeof o.href === 'string' ? o.href : ''
      if (!title.trim() || !href.trim()) continue
      let allowedJson: string | null = null
      if (Array.isArray(o.allowedRoleSlugs) && o.allowedRoleSlugs.length > 0) {
        const slugs = o.allowedRoleSlugs
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
        if (slugs.length > 0) allowedJson = JSON.stringify([...new Set(slugs)])
      }
      let reqPerm: string | null = null
      if (!allowedJson && typeof o.requiredPermission === 'string' && o.requiredPermission.trim()) {
        reqPerm = o.requiredPermission.trim()
      }
      ins.run(id, title, description, href, allowedJson, reqPerm, order)
      order += 1
    }
    if (order === 0) return
    delete j.customLinks
    db.prepare('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)').run(
      HOME_PAGE_KV_KEY,
      JSON.stringify(j)
    )
  } catch {
    // Ignore
  }
}

/** Group headings for home hub custom links. */
function migrateHomeLinkCategoriesTable(db: DbWrapper) {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS home_link_categories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_home_link_categories_sort ON home_link_categories(sort_order)')
  } catch {
    // Ignore
  }
}

function migrateHomeLinksCategoryId(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'home_links')
    if (!cols.includes('category_id')) {
      db.run('ALTER TABLE home_links ADD COLUMN category_id TEXT')
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_home_links_category_id ON home_links(category_id)')
  } catch {
    // Ignore
  }
}

function migrateHomeLinksShowOnHome(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'home_links')
    if (!cols.includes('show_on_home')) {
      db.run('ALTER TABLE home_links ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 1')
    }
  } catch {
    // Ignore
  }
}

/** Order of cards on the home hub (independent of category / full-list order). */
function migrateHomeLinksHomeSortOrder(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'home_links')
    if (!cols.includes('home_sort_order')) {
      db.run('ALTER TABLE home_links ADD COLUMN home_sort_order INTEGER NOT NULL DEFAULT 0')
      db.run('UPDATE home_links SET home_sort_order = sort_order')
    }
  } catch {
    // Ignore
  }
}

/** Grant `links.edit` wherever `home.edit` was already granted (split permission). */
function migrateRolesAddLinksEdit(db: DbWrapper) {
  try {
    const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{
      slug: string
      permissions: string
    }>
    for (const { slug, permissions } of rows) {
      let arr: unknown
      try {
        arr = JSON.parse(permissions)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const list = arr.filter((x): x is string => typeof x === 'string')
      if (!list.includes('home.edit')) continue
      if (list.includes('links.edit')) continue
      const next = [...list, 'links.edit']
      db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(JSON.stringify(next.sort()), slug)
    }
  } catch {
    // Ignore
  }
}

/** Role definitions: slug matches users.role; permissions is JSON array of strings. */
function migrateRoles(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        slug TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        permissions TEXT NOT NULL
      )
    `)
    const count = db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }
    if (count.c > 0) return
    const seed: Array<[string, string, string]> = [
      ['admin', 'Administrator', JSON.stringify(['*'])],
      [
        'user',
        'User',
        JSON.stringify([
          'module.home',
          'module.testing',
          'module.wiki',
          'module.files',
          'module.amr',
          'wiki.edit',
          'testing.data.write',
          'files.manage',
          'links.edit',
          'amr.missions.manage',
          'amr.stands.manage',
          'amr.stands.override-special',
          'amr.settings',
          'amr.tools.dev',
        ]),
      ],
      [
        'viewer',
        'Viewer',
        JSON.stringify([
          'module.home',
          'module.testing',
          'module.wiki',
          'module.files',
          'module.amr',
        ]),
      ],
    ]
    const ins = db.prepare('INSERT INTO roles (slug, label, permissions) VALUES (?, ?, ?)')
    for (const row of seed) {
      ins.run(...row)
    }
  } catch {
    // Ignore
  }
}

/** Replace legacy `data.write` in stored role JSON with `testing.data.write`. */
function migrateRolesReplaceDataWrite(db: DbWrapper) {
  try {
    const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{
      slug: string
      permissions: string
    }>
    for (const { slug, permissions } of rows) {
      let arr: unknown
      try {
        arr = JSON.parse(permissions)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const list = arr.filter((x): x is string => typeof x === 'string')
      if (!list.includes('data.write')) continue
      const next = list.filter((x) => x !== 'data.write')
      if (!next.includes('testing.data.write')) next.push('testing.data.write')
      db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(JSON.stringify(next), slug)
    }
  } catch {
    // Ignore
  }
}

/** Many-to-many: users can have multiple role slugs; permissions are merged. */
function migrateUserRoles(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role_slug TEXT NOT NULL,
        PRIMARY KEY (user_id, role_slug),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)
    const users = db.prepare('SELECT id, role FROM users').all() as Array<{ id: string; role: string }>
    const ins = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_slug) VALUES (?, ?)')
    for (const u of users) {
      if (u.role?.trim()) ins.run(u.id, u.role.trim())
    }
  } catch {
    // Ignore
  }
}

/** Grant `locations.schemas.manage` wherever `locations.data.write` was already granted (split permission). */
function migrateRolesAddLocationsSchemasManage(db: DbWrapper) {
  try {
    const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{
      slug: string
      permissions: string
    }>
    for (const { slug, permissions } of rows) {
      let arr: unknown
      try {
        arr = JSON.parse(permissions)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const list = arr.filter((x): x is string => typeof x === 'string')
      if (!list.includes('locations.data.write')) continue
      if (list.includes('locations.schemas.manage')) continue
      const next = [...list, 'locations.schemas.manage']
      db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(JSON.stringify(next.sort()), slug)
    }
  } catch {
    // Ignore
  }
}

/** Files library metadata + disk path under `uploads/files/` (see `server/routes/files.ts`). */
function migrateStoredFiles(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stored_files (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        storage_filename TEXT NOT NULL UNIQUE,
        mime_type TEXT,
        size_bytes INTEGER,
        uploaded_by TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_stored_files_uploaded_by ON stored_files(uploaded_by)')
    db.run('CREATE INDEX IF NOT EXISTS idx_stored_files_created_at ON stored_files(created_at)')
  } catch {
    // Ignore
  }
}

/** Folder hierarchy for Files explorer (disk paths stay flat UUID filenames). */
function migrateFileFolders(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_folders (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        created_by TEXT,
        FOREIGN KEY (parent_id) REFERENCES file_folders(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_file_folders_sibling_name ON file_folders (COALESCE(parent_id, ''), lower(name))`
    )
    db.run('CREATE INDEX IF NOT EXISTS idx_file_folders_parent ON file_folders(parent_id)')
  } catch {
    // Ignore
  }
}

/** `stored_files.folder_id`, per-file ACL columns (see docs/files_module.plan.md). */
function migrateStoredFilesExplorerColumns(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'stored_files')
    if (!cols.includes('folder_id')) {
      db.run('ALTER TABLE stored_files ADD COLUMN folder_id TEXT REFERENCES file_folders(id)')
    }
    if (!cols.includes('allowed_role_slugs')) {
      db.run('ALTER TABLE stored_files ADD COLUMN allowed_role_slugs TEXT')
    }
    if (!cols.includes('required_permission')) {
      db.run('ALTER TABLE stored_files ADD COLUMN required_permission TEXT')
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_stored_files_folder_id ON stored_files(folder_id)')
  } catch {
    // Ignore
  }
}

/** Per-file ACL is role-slug only; drop legacy permission-key restrictions. */
function migrateStoredFilesRoleOnlyAcl(db: DbWrapper) {
  try {
    db.run('UPDATE stored_files SET required_permission = NULL WHERE required_permission IS NOT NULL')
  } catch {
    // Ignore
  }
}

/** Folder-level role visibility (same JSON array as `stored_files.allowed_role_slugs`). */
function migrateFileFoldersAllowedRoleSlugs(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'file_folders')
    if (!cols.includes('allowed_role_slugs')) {
      db.run('ALTER TABLE file_folders ADD COLUMN allowed_role_slugs TEXT')
    }
  } catch {
    // Ignore
  }
}

/** When 1 (default), file visibility follows folder chain ACLs; when 0, only `allowed_role_slugs` on the file applies. */
function migrateStoredFilesInheritFolderAcl(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'stored_files')
    if (!cols.includes('inherit_folder_acl')) {
      db.run('ALTER TABLE stored_files ADD COLUMN inherit_folder_acl INTEGER DEFAULT 1')
      db.run('UPDATE stored_files SET inherit_folder_acl = 1 WHERE inherit_folder_acl IS NULL')
    }
  } catch {
    // Ignore
  }
}

/** Soft-delete: ISO timestamp when moved to recycle bin; NULL = active. */
function migrateStoredFilesRecycle(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'stored_files')
    if (!cols.includes('deleted_at')) {
      db.run('ALTER TABLE stored_files ADD COLUMN deleted_at TEXT')
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_stored_files_deleted_at ON stored_files(deleted_at)')
  } catch {
    // Ignore
  }
}

/** When folder rows are removed, `folder_id` is cleared; this keeps the last folder for restore UX. */
function migrateStoredFilesRecycleOriginalFolder(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'stored_files')
    if (!cols.includes('recycle_original_folder_id')) {
      db.run('ALTER TABLE stored_files ADD COLUMN recycle_original_folder_id TEXT')
    }
  } catch {
    // Ignore
  }
}

/** Display path when `recycle_original_folder_id` points at a deleted folder (e.g. `Photos / 2024`). */
function migrateStoredFilesRecycleFolderLabel(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'stored_files')
    if (!cols.includes('recycle_original_folder_label')) {
      db.run('ALTER TABLE stored_files ADD COLUMN recycle_original_folder_label TEXT')
    }
  } catch {
    // Ignore
  }
}

/**
 * Grant `module.files` / `files.manage` on existing installs (seed only runs on empty `roles`).
 * Mirrors default viewer vs editor split: wiki readers get list/download; wiki editors get upload/delete.
 */
/** AMR stands, missions, and status audit log (SQLite baseline). */
function migrateAmrTables(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_stands (
        id TEXT PRIMARY KEY,
        zone TEXT NOT NULL DEFAULT '',
        location_label TEXT NOT NULL DEFAULT '',
        external_ref TEXT NOT NULL,
        dwg_ref TEXT,
        orientation TEXT NOT NULL DEFAULT '0',
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        block_pickup INTEGER NOT NULL DEFAULT 0,
        block_dropoff INTEGER NOT NULL DEFAULT 0,
        bypass_pallet_check INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_mission_records (
        id TEXT PRIMARY KEY,
        job_code TEXT NOT NULL UNIQUE,
        mission_code TEXT NOT NULL,
        container_code TEXT,
        created_by TEXT,
        mission_type TEXT NOT NULL DEFAULT 'RACK_MOVE',
        mission_payload_json TEXT NOT NULL,
        last_status INTEGER,
        persistent_container INTEGER NOT NULL DEFAULT 0,
        worker_closed INTEGER NOT NULL DEFAULT 0,
        finalized INTEGER NOT NULL DEFAULT 0,
        container_out_done INTEGER NOT NULL DEFAULT 0,
        final_position TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_mission_status_log (
        id TEXT PRIMARY KEY,
        mission_record_id TEXT NOT NULL,
        job_status INTEGER,
        raw_json TEXT,
        recorded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (mission_record_id) REFERENCES amr_mission_records(id) ON DELETE CASCADE
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_fleet_api_log (
        id TEXT PRIMARY KEY,
        recorded_at TEXT DEFAULT (datetime('now')),
        source TEXT NOT NULL,
        operation TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        mission_record_id TEXT,
        user_id TEXT,
        request_json TEXT,
        response_json TEXT
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_mission_records_finalized ON amr_mission_records(finalized)')
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_status_log_mission ON amr_mission_status_log(mission_record_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_fleet_api_log_recorded ON amr_fleet_api_log(recorded_at)')
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_amr_stands_external ON amr_stands(external_ref)')
  } catch {
    // Ignore
  }
}

/** Split worker polling stop (`worker_closed`) from business completion (`finalized` = fleet OK only: 30 / 35). */
function migrateAmrMissionWorkerClosed(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_mission_records')
    if (cols.length === 0) return
    if (!cols.includes('worker_closed')) {
      db.run('ALTER TABLE amr_mission_records ADD COLUMN worker_closed INTEGER NOT NULL DEFAULT 0')
    }
    db.run('UPDATE amr_mission_records SET worker_closed = 1 WHERE finalized = 1')
    db.run(
      `UPDATE amr_mission_records SET finalized = CASE WHEN last_status IN (30, 35) THEN 1 ELSE 0 END WHERE worker_closed = 1`
    )
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_mission_records_worker_closed ON amr_mission_records(worker_closed)')
  } catch {
    // Ignore
  }
}

/** Multi-stop rack missions: session row + optional link on mission records. */
function migrateAmrMultistopSessions(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_multistop_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        pickup_position TEXT NOT NULL DEFAULT '',
        plan_json TEXT NOT NULL,
        total_segments INTEGER NOT NULL,
        next_segment_index INTEGER NOT NULL DEFAULT 1,
        locked_robot_id TEXT,
        container_code TEXT,
        persistent_container INTEGER NOT NULL DEFAULT 0,
        enter_orientation TEXT NOT NULL DEFAULT '0',
        robot_ids_json TEXT,
        base_mission_code TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_multistop_sessions_status ON amr_multistop_sessions(status)')
    const msCols = tableColumnNames(db, 'amr_multistop_sessions')
    if (msCols.length > 0 && !msCols.includes('base_mission_code')) {
      db.run('ALTER TABLE amr_multistop_sessions ADD COLUMN base_mission_code TEXT')
    }
    if (msCols.length > 0 && !msCols.includes('continue_not_before')) {
      db.run('ALTER TABLE amr_multistop_sessions ADD COLUMN continue_not_before TEXT')
    }
    const cols = tableColumnNames(db, 'amr_mission_records')
    if (cols.length === 0) return
    if (!cols.includes('multistop_session_id')) {
      db.run('ALTER TABLE amr_mission_records ADD COLUMN multistop_session_id TEXT REFERENCES amr_multistop_sessions(id)')
    }
    if (!cols.includes('multistop_step_index')) {
      db.run('ALTER TABLE amr_mission_records ADD COLUMN multistop_step_index INTEGER')
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_mission_records_multistop ON amr_mission_records(multistop_session_id)')
  } catch {
    // Ignore
  }
}

/** Saved mission blueprints (org-wide, reusable on New Mission). */
function migrateAmrMissionTemplates(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_mission_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `)
  } catch {
    // Ignore
  }
}

/** Fleet-assigned robot for this job (from jobQuery), for UI / unlockRobotId resolution. */
function migrateAmrMissionRecordLockedRobot(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_mission_records')
    if (cols.length === 0) return
    if (!cols.includes('locked_robot_id')) {
      db.run('ALTER TABLE amr_mission_records ADD COLUMN locked_robot_id TEXT')
    }
  } catch {
    // Ignore
  }
}

/** Special-location flags: `block_pickup` (no lift) and `block_dropoff` (no lower) per stand. */
function migrateAmrStandsSpecialLocationFlags(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_stands')
    if (cols.length === 0) return
    if (!cols.includes('block_pickup')) {
      db.run('ALTER TABLE amr_stands ADD COLUMN block_pickup INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.includes('block_dropoff')) {
      db.run('ALTER TABLE amr_stands ADD COLUMN block_dropoff INTEGER NOT NULL DEFAULT 0')
    }
  } catch {
    // Ignore
  }
}

/** Per-robot lock state: locked robots are excluded from new fleet `submitMission` `robotIds`. */
function migrateAmrRobots(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_robots (
        robot_id TEXT PRIMARY KEY,
        locked INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        locked_by TEXT,
        notes TEXT,
        updated_at TEXT,
        FOREIGN KEY (locked_by) REFERENCES users(id)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_amr_robots_locked ON amr_robots(locked)')
  } catch {
    // Ignore
  }
}

/** When set, Hyperion empty-stand checks are skipped for this location (mission create / multistop continue). */
function migrateAmrStandsBypassPalletCheck(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_stands')
    if (cols.length === 0) return
    if (!cols.includes('bypass_pallet_check')) {
      db.run('ALTER TABLE amr_stands ADD COLUMN bypass_pallet_check INTEGER NOT NULL DEFAULT 0')
    }
  } catch {
    // Ignore
  }
}

/** Max active reservations allowed for bypass-pallet-check stands (defaults to 1). */
function migrateAmrStandsActiveMissions(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_stands')
    if (cols.length === 0) return
    if (!cols.includes('active_missions')) {
      db.run('ALTER TABLE amr_stands ADD COLUMN active_missions INTEGER NOT NULL DEFAULT 1')
    }
  } catch {
    // Ignore
  }
}

/** `stand` (default) vs `non_stand` waypoint — typically no Hyperion pallet presence; lift/lower use block flags like stands. */
function migrateAmrStandsLocationType(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_stands')
    if (cols.length === 0) return
    if (!cols.includes('location_type')) {
      db.run(`ALTER TABLE amr_stands ADD COLUMN location_type TEXT NOT NULL DEFAULT 'stand'`)
    }
  } catch {
    // Ignore
  }
}

/** Queue/reservation support for AMR mission dispatch gating. */
function migrateAmrMissionQueueing(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'amr_mission_records')
    if (cols.length > 0) {
      if (!cols.includes('queued')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN queued INTEGER NOT NULL DEFAULT 0')
      }
      if (!cols.includes('queued_destination_ref')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN queued_destination_ref TEXT')
      }
      if (!cols.includes('queued_at')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN queued_at TEXT')
      }
      if (!cols.includes('submit_payload_json')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN submit_payload_json TEXT')
      }
      if (!cols.includes('container_in_payload_json')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN container_in_payload_json TEXT')
      }
      if (!cols.includes('presence_check_until')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN presence_check_until TEXT')
      }
      if (!cols.includes('presence_seen_at')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN presence_seen_at TEXT')
      }
      if (!cols.includes('presence_warning_at')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN presence_warning_at TEXT')
      }
      if (!cols.includes('presence_dest_ref')) {
        db.run('ALTER TABLE amr_mission_records ADD COLUMN presence_dest_ref TEXT')
      }
      db.run('CREATE INDEX IF NOT EXISTS idx_amr_mission_records_queued ON amr_mission_records(queued, queued_at)')
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_amr_mission_records_presence_check ON amr_mission_records(presence_check_until)'
      )
    }
  } catch {
    // Ignore
  }
  try {
    const msCols = tableColumnNames(db, 'amr_multistop_sessions')
    if (msCols.length > 0) {
      if (!msCols.includes('queue_blocked_until')) {
        db.run('ALTER TABLE amr_multistop_sessions ADD COLUMN queue_blocked_until TEXT')
      }
      if (!msCols.includes('container_in_payload_json')) {
        db.run('ALTER TABLE amr_multistop_sessions ADD COLUMN container_in_payload_json TEXT')
      }
    }
  } catch {
    // Ignore
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_stand_reservations (
        id TEXT PRIMARY KEY,
        stand_external_ref TEXT NOT NULL,
        mission_record_id TEXT NOT NULL,
        multistop_session_id TEXT,
        multistop_step_index INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        released_at TEXT
      )
    `)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_amr_stand_reservations_active_ref
       ON amr_stand_reservations(stand_external_ref, released_at)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_amr_stand_reservations_record
       ON amr_stand_reservations(mission_record_id, released_at)`
    )
  } catch {
    // Ignore
  }
}

/** Stand groups (lazy-resolve destinations for stop 2+) + queued mission grouping key. */
function migrateAmrStandGroups(db: DbWrapper) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_stand_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        zone TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS amr_stand_group_members (
        group_id TEXT NOT NULL REFERENCES amr_stand_groups(id) ON DELETE CASCADE,
        stand_id TEXT NOT NULL REFERENCES amr_stands(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, stand_id)
      )
    `)
    db.run(`CREATE INDEX IF NOT EXISTS idx_amr_stand_group_members_stand ON amr_stand_group_members(stand_id)`)
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_amr_stand_groups_name ON amr_stand_groups(name)`)

    const mrCols = tableColumnNames(db, 'amr_mission_records')
    if (mrCols.length > 0 && !mrCols.includes('queued_group_id')) {
      db.run('ALTER TABLE amr_mission_records ADD COLUMN queued_group_id TEXT')
    }
    const msCols = tableColumnNames(db, 'amr_multistop_sessions')
    if (msCols.length > 0 && !msCols.includes('queue_blocked_group_id')) {
      db.run('ALTER TABLE amr_multistop_sessions ADD COLUMN queue_blocked_group_id TEXT')
    }
    const sgCols = tableColumnNames(db, 'amr_stand_groups')
    if (sgCols.length > 0 && !sgCols.includes('sort_order')) {
      db.run('ALTER TABLE amr_stand_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
    }
  } catch {
    // Ignore
  }
}

/** Grant `amr.stands.override-special` wherever `amr.missions.manage` was already granted. */
function migrateRolesAddAmrStandsOverrideSpecial(db: DbWrapper) {
  try {
    const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{
      slug: string
      permissions: string
    }>
    for (const { slug, permissions } of rows) {
      let arr: unknown
      try {
        arr = JSON.parse(permissions)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const list = arr.filter((x): x is string => typeof x === 'string')
      if (list.includes('*')) continue
      if (!list.includes('amr.missions.manage')) continue
      if (list.includes('amr.stands.override-special')) continue
      const next = [...list, 'amr.stands.override-special']
      db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(JSON.stringify(next.sort()), slug)
    }
  } catch {
    // Ignore
  }
}

/** Preset role: AMR floor supervisor — resolve attention without mission create / stands / settings. */
function migrateRolesSeedAmrOperator(db: DbWrapper) {
  try {
    const row = db.prepare('SELECT slug FROM roles WHERE slug = ?').get('amr_operator') as
      | { slug?: string }
      | undefined
    if (row?.slug) return
    db.prepare('INSERT INTO roles (slug, label, permissions) VALUES (?, ?, ?)').run(
      'amr_operator',
      'AMR operator',
      JSON.stringify(['module.amr', 'amr.attention.manage'])
    )
  } catch {
    // Ignore
  }
}

/** Grant AMR module permissions on existing installs (seed only runs on empty roles). */
function migrateRolesGrantModuleAmr(db: DbWrapper) {
  try {
    const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{
      slug: string
      permissions: string
    }>
    const nested = [
      'amr.missions.manage',
      'amr.stands.manage',
      'amr.settings',
      'amr.tools.dev',
    ] as const
    for (const { slug, permissions } of rows) {
      let arr: unknown
      try {
        arr = JSON.parse(permissions)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const list = arr.filter((x): x is string => typeof x === 'string')
      if (list.includes('*')) continue
      const next = new Set(list)
      let changed = false
      const addModule = () => {
        if (!next.has('module.amr')) {
          next.add('module.amr')
          changed = true
        }
      }
      const addNestedForEditor = () => {
        addModule()
        for (const k of nested) {
          if (!next.has(k)) {
            next.add(k)
            changed = true
          }
        }
      }
      if (slug === 'viewer') {
        addModule()
      } else if (slug === 'user') {
        addNestedForEditor()
      } else {
        if (
          list.includes('module.wiki') ||
          list.includes('module.testing') ||
          list.includes('module.locations') ||
          list.includes('module.files')
        ) {
          addModule()
        }
      }
      if (!changed) continue
      db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(JSON.stringify([...next].sort()), slug)
    }
  } catch {
    // Ignore
  }
}

function migrateRolesGrantModuleFiles(db: DbWrapper) {
  try {
    const rows = db.prepare('SELECT slug, permissions FROM roles').all() as Array<{
      slug: string
      permissions: string
    }>
    for (const { slug, permissions } of rows) {
      let arr: unknown
      try {
        arr = JSON.parse(permissions)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const list = arr.filter((x): x is string => typeof x === 'string')
      if (list.includes('*')) continue
      const next = new Set(list)
      let changed = false
      const addFiles = () => {
        if (!next.has('module.files')) {
          next.add('module.files')
          changed = true
        }
      }
      const addManage = () => {
        if (!next.has('files.manage')) {
          next.add('files.manage')
          changed = true
        }
      }
      if (slug === 'viewer') {
        addFiles()
      } else if (slug === 'user') {
        addFiles()
        addManage()
      } else {
        if (list.includes('wiki.edit')) {
          addFiles()
          addManage()
        } else if (
          list.includes('module.wiki') ||
          list.includes('module.testing') ||
          list.includes('module.locations')
        ) {
          addFiles()
        }
      }
      if (!changed) continue
      db.prepare('UPDATE roles SET permissions = ? WHERE slug = ?').run(JSON.stringify([...next].sort()), slug)
    }
  } catch {
    // Ignore
  }
}

function migrateFieldsAudit(db: DbWrapper) {
  try {
    const cols = tableColumnNames(db, 'fields')
    if (!cols.includes('updated_at')) {
      db.run('ALTER TABLE fields ADD COLUMN updated_at TEXT')
    }
    if (!cols.includes('created_by')) {
      db.run('ALTER TABLE fields ADD COLUMN created_by TEXT')
    }
    if (!cols.includes('updated_by')) {
      db.run('ALTER TABLE fields ADD COLUMN updated_by TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateTestPlansAndTestsUpdatedAt(db: DbWrapper) {
  try {
    const planRows = db.prepare('PRAGMA table_info(test_plans)').all() as Array<{ name: string }>
    if (!planRows.some((r) => r.name === 'updated_at')) {
      db.run('ALTER TABLE test_plans ADD COLUMN updated_at TEXT')
    }
    const testRows = db.prepare('PRAGMA table_info(tests)').all() as Array<{ name: string }>
    if (!testRows.some((r) => r.name === 'updated_at')) {
      db.run('ALTER TABLE tests ADD COLUMN updated_at TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateTestsToPlans(db: DbWrapper) {
  try {
    db.run('CREATE TABLE IF NOT EXISTS test_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT DEFAULT (datetime(\'now\')))')
    if (tableColumnNames(db, 'tests').includes('test_plan_id')) return
    const planId = 'default-plan'
    db.run('INSERT OR IGNORE INTO test_plans (id, name, description) VALUES (?, ?, ?)', [
      planId,
      'Default Plan',
      'Migrated from legacy tests',
    ])
    db.run('ALTER TABLE tests ADD COLUMN test_plan_id TEXT')
    db.run('UPDATE tests SET test_plan_id = ?', [planId])
  } catch {
    // Ignore
  }
}

