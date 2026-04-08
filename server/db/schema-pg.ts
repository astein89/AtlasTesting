import type { AsyncDbWrapper } from './schema.js'

const tsTextDefault = `DEFAULT (to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'))`

/** One statement each — PostgreSQL baseline matching migrated SQLite end state. */
export const BASELINE_PG_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    short_name TEXT,
    password_hash TEXT NOT NULL,
    password_change_required INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT ${tsTextDefault}
  )`,

  `CREATE TABLE IF NOT EXISTS roles (
    slug TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    permissions TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    created_by TEXT,
    updated_by TEXT,
    owner_test_plan_id TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS test_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    field_ids TEXT,
    field_layout TEXT,
    form_layout TEXT,
    default_sort_order TEXT,
    default_visible_columns TEXT,
    field_defaults TEXT,
    key_field TEXT,
    hidden_field_ids TEXT,
    required_field_ids TEXT,
    start_date TEXT,
    end_date TEXT,
    archived_runs TEXT,
    conditional_status_rules TEXT,
    conditional_status_rule_order TEXT,
    constraints TEXT,
    short_description TEXT,
    updated_at TEXT,
    created_at TEXT ${tsTextDefault}
  )`,

  `CREATE TABLE IF NOT EXISTS tests (
    id TEXT PRIMARY KEY,
    test_plan_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (test_plan_id) REFERENCES test_plans(id)
  )`,

  `CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    test_plan_id TEXT NOT NULL,
    test_id TEXT,
    run_id TEXT,
    run_at TEXT NOT NULL,
    entered_by TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT,
    FOREIGN KEY (test_plan_id) REFERENCES test_plans(id),
    FOREIGN KEY (entered_by) REFERENCES users(id),
    FOREIGN KEY (test_id) REFERENCES tests(id)
  )`,

  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS location_schemas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS location_schema_components (
    id TEXT PRIMARY KEY,
    schema_id TEXT NOT NULL,
    key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    type TEXT NOT NULL,
    width INTEGER NOT NULL,
    pattern_mask TEXT,
    min_value TEXT,
    max_value TEXT,
    order_index INTEGER NOT NULL,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (schema_id) REFERENCES location_schemas(id)
  )`,

  `CREATE TABLE IF NOT EXISTS location_schema_fields (
    id TEXT PRIMARY KEY,
    schema_id TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT,
    order_index INTEGER NOT NULL,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (schema_id) REFERENCES location_schemas(id),
    UNIQUE(schema_id, key)
  )`,

  `CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    schema_id TEXT NOT NULL,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    UNIQUE(name),
    FOREIGN KEY (schema_id) REFERENCES location_schemas(id)
  )`,

  `CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    schema_id TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    location TEXT NOT NULL,
    components TEXT NOT NULL,
    field_values TEXT,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (schema_id) REFERENCES location_schemas(id),
    FOREIGN KEY (zone_id) REFERENCES zones(id),
    UNIQUE(zone_id, location)
  )`,

  `CREATE TABLE IF NOT EXISTS record_history (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    action TEXT NOT NULL,
    old_data TEXT,
    old_status TEXT,
    new_data TEXT,
    new_status TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS app_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS home_links (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    href TEXT NOT NULL,
    allowed_role_slugs TEXT,
    required_permission TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL,
    role_slug TEXT NOT NULL,
    PRIMARY KEY (user_id, role_slug),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS file_folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    created_at TEXT ${tsTextDefault},
    created_by TEXT,
    allowed_role_slugs TEXT,
    FOREIGN KEY (parent_id) REFERENCES file_folders(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS stored_files (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    storage_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT,
    size_bytes INTEGER,
    uploaded_by TEXT NOT NULL,
    created_at TEXT ${tsTextDefault},
    folder_id TEXT,
    allowed_role_slugs TEXT,
    required_permission TEXT,
    inherit_folder_acl INTEGER DEFAULT 1,
    FOREIGN KEY (uploaded_by) REFERENCES users(id),
    FOREIGN KEY (folder_id) REFERENCES file_folders(id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_test_runs_test_plan_id ON test_runs(test_plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_runs_test_id ON test_runs(test_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_runs_run_at ON test_runs(run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tests_test_plan_id ON tests(test_plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_record_history_record_id ON record_history(record_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stored_files_uploaded_by ON stored_files(uploaded_by)`,
  `CREATE INDEX IF NOT EXISTS idx_stored_files_created_at ON stored_files(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_stored_files_folder_id ON stored_files(folder_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_folders_parent ON file_folders(parent_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_file_folders_sibling_name ON file_folders (COALESCE(parent_id, ''), LOWER(name))`,
  `CREATE INDEX IF NOT EXISTS idx_home_links_sort_order ON home_links(sort_order)`,
]

export async function initSchemaPg(db: AsyncDbWrapper): Promise<void> {
  for (const sql of BASELINE_PG_STATEMENTS) {
    await db.exec(sql)
  }
}
