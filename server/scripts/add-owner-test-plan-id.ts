import { db } from '../db/index.js'

async function main() {
  try {
    db.run('ALTER TABLE fields ADD COLUMN owner_test_plan_id TEXT')
    // eslint-disable-next-line no-console
    console.log('owner_test_plan_id column added to fields table.')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to add owner_test_plan_id column:', err)
  }
}

void main()