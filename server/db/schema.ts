/// <reference path="../sqljs.d.ts" />
type SqlDb = import('sql.js').Database

function migrateEmailToUsername(db: SqlDb) {
  try {
    const info = db.exec("PRAGMA table_info(users)")
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasEmail = rows.some((r) => r[1] === 'email')
    if (!hasEmail) return
    db.run(`ALTER TABLE users RENAME COLUMN email TO username`)
  } catch {
    // Ignore migration errors (e.g. column already renamed)
  }
}

export function initSchema(db: SqlDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
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
  `)
  migrateEmailToUsername(db)
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
  migrateTestRunsRunId(db)
  migrateTestsTableAndBackfill(db)
  migratePlanConstraints(db)
  migratePlanShortDescription(db)
  migrateRecordsToPlanDirect(db)
  migrateUserPreferences(db)
  migrateFieldsAudit(db)
  migrateRecordHistory(db)
  migrateTestPlansAndTestsUpdatedAt(db)
  // Create indexes after migrations (test_runs may have had test_id before migrateRecordsToPlanDirect)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_plan_id ON test_runs(test_plan_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_id ON test_runs(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_run_at ON test_runs(run_at);
    CREATE INDEX IF NOT EXISTS idx_tests_test_plan_id ON tests(test_plan_id);
    CREATE INDEX IF NOT EXISTS idx_record_history_record_id ON record_history(record_id);
  `)
}

function migrateRecordHistory(db: SqlDb) {
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

function migrateRecordsToPlanDirect(db: SqlDb) {
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

function migratePlanConstraints(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasConstraints = rows.some((r) => r[1] === 'constraints')
    if (hasConstraints) return
    db.run('ALTER TABLE test_plans ADD COLUMN constraints TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanShortDescription(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasShortDesc = rows.some((r) => r[1] === 'short_description')
    if (hasShortDesc) return
    db.run('ALTER TABLE test_plans ADD COLUMN short_description TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanFieldLayout(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasFieldLayout = rows.some((r) => r[1] === 'field_layout')
    if (hasFieldLayout) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_layout TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanFormLayout(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasFormLayout = rows.some((r) => r[1] === 'form_layout')
    if (hasFormLayout) return
    db.run('ALTER TABLE test_plans ADD COLUMN form_layout TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanDefaultSortOrder(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const has = rows.some((r) => r[1] === 'default_sort_order')
    if (has) return
    db.run('ALTER TABLE test_plans ADD COLUMN default_sort_order TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanDefaultVisibleColumns(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const has = rows.some((r) => r[1] === 'default_visible_columns')
    if (has) return
    db.run('ALTER TABLE test_plans ADD COLUMN default_visible_columns TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanFieldDefaults(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const has = rows.some((r) => r[1] === 'field_defaults')
    if (has) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_defaults TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanKeyField(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const has = rows.some((r) => r[1] === 'key_field')
    if (has) return
    db.run('ALTER TABLE test_plans ADD COLUMN key_field TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanHiddenFieldIds(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const has = rows.some((r) => r[1] === 'hidden_field_ids')
    if (has) return
    db.run('ALTER TABLE test_plans ADD COLUMN hidden_field_ids TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanRequiredFieldIds(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const has = rows.some((r) => r[1] === 'required_field_ids')
    if (has) return
    db.run('ALTER TABLE test_plans ADD COLUMN required_field_ids TEXT')
  } catch {
    // Ignore
  }
}

function migratePlanStartEndDate(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const cols = rows.map((r) => r[1] as string)
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

function migratePlanArchivedRuns(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const cols = rows.map((r) => r[1] as string)
    if (!cols.includes('archived_runs')) {
      db.run('ALTER TABLE test_plans ADD COLUMN archived_runs TEXT')
    }
  } catch {
    // Ignore
  }
}

function migrateTestRunsRunId(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_runs)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const cols = rows.map((r) => r[1] as string)
    if (!cols.includes('run_id')) {
      db.run('ALTER TABLE test_runs ADD COLUMN run_id TEXT')
    }
  } catch {
    // Ignore
  }
}

/** Create tests table (first-class tests under a plan), add test_id to test_runs, backfill one Legacy test per plan. */
function migrateTestsTableAndBackfill(db: SqlDb) {
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
    // Ensure every plan that has records has a Legacy test and backfill records to it
    const planIdsWithRecords = db.prepare('SELECT DISTINCT test_plan_id FROM test_runs').all() as Array<{ test_plan_id: string }>
    for (const { test_plan_id: planId } of planIdsWithRecords) {
      const legacyId = `legacy-${planId}`
      const existing = db.prepare('SELECT id FROM tests WHERE id = ?').get(legacyId) as { id: string } | undefined
      if (!existing) {
        db.prepare(
          'INSERT INTO tests (id, test_plan_id, name, start_date, end_date, archived) VALUES (?, ?, ?, NULL, NULL, 0)'
        ).run(legacyId, planId, 'Legacy')
      }
      db.prepare('UPDATE test_runs SET test_id = ? WHERE test_plan_id = ? AND (test_id IS NULL OR test_id = \'\')').run(legacyId, planId)
    }
    // Ensure every plan has at least one test (so overview always shows something)
    const allPlanIds = db.prepare('SELECT id FROM test_plans').all() as Array<{ id: string }>
    for (const { id: planId } of allPlanIds) {
      const legacyId = `legacy-${planId}`
      const hasTest = db.prepare('SELECT 1 FROM tests WHERE test_plan_id = ? LIMIT 1').get(planId)
      if (!hasTest) {
        db.prepare(
          'INSERT INTO tests (id, test_plan_id, name, start_date, end_date, archived) VALUES (?, ?, ?, NULL, NULL, 0)'
        ).run(legacyId, planId, 'Legacy')
      }
    }
  } catch {
    // Ignore
  }
}

function migratePlanFieldIds(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasFieldIds = rows.some((r) => r[1] === 'field_ids')
    if (hasFieldIds) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_ids TEXT')
    const tablesInfo = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tests'")
    if (!tablesInfo.length || !(tablesInfo[0].values as unknown[][])?.length) return
    const stmt = db.prepare('SELECT test_plan_id, field_ids FROM tests')
    const planFields = new Map<string, string>()
    while (stmt.step()) {
      const row = stmt.getAsObject() as { test_plan_id: string; field_ids: string }
      if (!planFields.has(row.test_plan_id)) {
        planFields.set(row.test_plan_id, row.field_ids)
      }
    }
    stmt.free()
    for (const [planId, fieldIds] of planFields) {
      db.run('UPDATE test_plans SET field_ids = ? WHERE id = ?', [fieldIds, planId])
    }
  } catch {
    // Ignore
  }
}

function migrateUserPreferences(db: SqlDb) {
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

function migrateFieldsAudit(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(fields)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const cols = rows.map((r) => r[1] as string)
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

function migrateTestPlansAndTestsUpdatedAt(db: SqlDb) {
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

function migrateTestsToPlans(db: SqlDb) {
  try {
    db.run('CREATE TABLE IF NOT EXISTS test_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT DEFAULT (datetime(\'now\')))')
    const info = db.exec('PRAGMA table_info(tests)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasPlanId = rows.some((r) => r[1] === 'test_plan_id')
    if (hasPlanId) return
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

