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
    main_status_field_id TEXT,
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

/**
 * Applied after {@link BASELINE_PG_STATEMENTS} on PostgreSQL startup and in `migrate-sqlite-to-pg`
 * so the migration script matches `initSchemaPg` (SQLite may include columns not in the CREATE TABLE baseline).
 */
export const PG_POST_BASELINE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS home_link_categories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_home_link_categories_sort ON home_link_categories(sort_order)`,
  `ALTER TABLE home_links ADD COLUMN IF NOT EXISTS category_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_home_links_category_id ON home_links(category_id)`,
  `ALTER TABLE home_links ADD COLUMN IF NOT EXISTS show_on_home INTEGER DEFAULT 1`,
  `ALTER TABLE home_links ADD COLUMN IF NOT EXISTS home_sort_order INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE test_plans ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE tests ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE location_schemas ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE zones ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE file_folders ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE test_plans ADD COLUMN IF NOT EXISTS main_status_field_id TEXT`,
  `ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_stored_files_deleted_at ON stored_files(deleted_at)`,
  `ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS recycle_original_folder_id TEXT`,
  `ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS recycle_original_folder_label TEXT`,

  `CREATE TABLE IF NOT EXISTS amr_stands (
    id TEXT PRIMARY KEY,
    zone TEXT NOT NULL DEFAULT '',
    location_label TEXT NOT NULL DEFAULT '',
    external_ref TEXT NOT NULL,
    dwg_ref TEXT,
    orientation TEXT NOT NULL DEFAULT '0',
    x DOUBLE PRECISION NOT NULL DEFAULT 0,
    y DOUBLE PRECISION NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    block_pickup INTEGER NOT NULL DEFAULT 0,
    block_dropoff INTEGER NOT NULL DEFAULT 0,
    bypass_pallet_check INTEGER NOT NULL DEFAULT 0,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT
  )`,
  `ALTER TABLE amr_stands ADD COLUMN IF NOT EXISTS block_pickup INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE amr_stands ADD COLUMN IF NOT EXISTS block_dropoff INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE amr_stands ADD COLUMN IF NOT EXISTS bypass_pallet_check INTEGER NOT NULL DEFAULT 0`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_amr_stands_external ON amr_stands(external_ref)`,
  `CREATE TABLE IF NOT EXISTS amr_mission_records (
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
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,
  `ALTER TABLE amr_mission_records ADD COLUMN IF NOT EXISTS worker_closed INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_amr_mission_records_worker_closed ON amr_mission_records(worker_closed)`,
  `CREATE INDEX IF NOT EXISTS idx_amr_mission_records_finalized ON amr_mission_records(finalized)`,
  `UPDATE amr_mission_records SET worker_closed = 1 WHERE finalized = 1`,
  `UPDATE amr_mission_records SET finalized = CASE WHEN last_status IN (30, 35) THEN 1 ELSE 0 END WHERE worker_closed = 1`,
  `CREATE TABLE IF NOT EXISTS amr_mission_status_log (
    id TEXT PRIMARY KEY,
    mission_record_id TEXT NOT NULL,
    job_status INTEGER,
    raw_json TEXT,
    recorded_at TEXT ${tsTextDefault},
    FOREIGN KEY (mission_record_id) REFERENCES amr_mission_records(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amr_status_log_mission ON amr_mission_status_log(mission_record_id)`,
  `CREATE TABLE IF NOT EXISTS amr_fleet_api_log (
    id TEXT PRIMARY KEY,
    recorded_at TEXT ${tsTextDefault},
    source TEXT NOT NULL,
    operation TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    mission_record_id TEXT,
    user_id TEXT,
    request_json TEXT,
    response_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amr_fleet_api_log_recorded ON amr_fleet_api_log(recorded_at)`,

  `CREATE TABLE IF NOT EXISTS amr_multistop_sessions (
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
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amr_multistop_sessions_status ON amr_multistop_sessions(status)`,
  `ALTER TABLE amr_multistop_sessions ADD COLUMN IF NOT EXISTS base_mission_code TEXT`,
  `ALTER TABLE amr_mission_records ADD COLUMN IF NOT EXISTS multistop_session_id TEXT REFERENCES amr_multistop_sessions(id)`,
  `ALTER TABLE amr_mission_records ADD COLUMN IF NOT EXISTS multistop_step_index INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_amr_mission_records_multistop ON amr_mission_records(multistop_session_id)`,
  `ALTER TABLE amr_mission_records ADD COLUMN IF NOT EXISTS locked_robot_id TEXT`,
  `ALTER TABLE amr_multistop_sessions ADD COLUMN IF NOT EXISTS continue_not_before TEXT`,
  `CREATE TABLE IF NOT EXISTS amr_mission_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT ${tsTextDefault},
    updated_at TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,
]

export async function initSchemaPg(db: AsyncDbWrapper): Promise<void> {
  for (const sql of BASELINE_PG_STATEMENTS) {
    await db.exec(sql)
  }
  for (const sql of PG_POST_BASELINE_STATEMENTS) {
    await db.exec(sql)
  }
}
