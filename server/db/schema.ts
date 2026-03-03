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
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS test_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      field_ids TEXT,
      field_layout TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      test_plan_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      field_ids TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (test_plan_id) REFERENCES test_plans(id)
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      entered_by TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT,
      FOREIGN KEY (test_id) REFERENCES tests(id),
      FOREIGN KEY (entered_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_test_runs_test_id ON test_runs(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_run_at ON test_runs(run_at);
  `)
  migrateEmailToUsername(db)
  migrateTestsToPlans(db)
  migratePlanFieldIds(db)
  migratePlanFieldLayout(db)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tests_test_plan_id ON tests(test_plan_id)`)
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

function migratePlanFieldIds(db: SqlDb) {
  try {
    const info = db.exec('PRAGMA table_info(test_plans)')
    if (!info.length || !info[0].values) return
    const rows = info[0].values as unknown[][]
    const hasFieldIds = rows.some((r) => r[1] === 'field_ids')
    if (hasFieldIds) return
    db.run('ALTER TABLE test_plans ADD COLUMN field_ids TEXT')
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

