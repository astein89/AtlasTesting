/**
 * When stored as a string in `TestPlan.fieldDefaults` for a `datetime` field, new rows use
 * `new Date().toISOString()` at creation time instead of this literal value.
 */
export const DATETIME_PLAN_DEFAULT_ROW_CREATED = '__plan_default_row_created_at__'
