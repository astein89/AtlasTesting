import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { db } from './index.js'

const SALT_ROUNDS = 10

export function runSeed() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  if (userCount.count > 0) {
    console.log('Database already seeded, skipping.')
    return
  }

  const adminId = uuidv4()
  const passwordHash = bcrypt.hashSync('admin', SALT_ROUNDS)

  db.prepare(`
    INSERT INTO users (id, username, password_hash, name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(adminId, 'admin', passwordHash, 'Admin', 'admin')

  const fieldIds = [uuidv4(), uuidv4(), uuidv4()]
  db.prepare(`
    INSERT INTO fields (id, key, label, type, config)
    VALUES 
      (?, 'cycle_time_sec', 'Cycle Time (sec)', 'number', ?),
      (?, 'result', 'Result', 'select', ?),
      (?, 'notes', 'Notes', 'text', ?)
  `).run(
    fieldIds[0],
    JSON.stringify({ unit: 'sec', min: 0, max: 300, required: true }),
    fieldIds[1],
    JSON.stringify({ options: ['Pass', 'Fail', 'N/A'], required: true }),
    fieldIds[2],
    JSON.stringify({ required: false })
  )

  const planId = uuidv4()
  db.prepare(`
    INSERT INTO test_plans (id, name, description, field_ids)
    VALUES (?, ?, ?, ?)
  `).run(
    planId,
    'Pallet Cycle Plan',
    'Standard pallet cycle validation tests',
    JSON.stringify(fieldIds)
  )

  const testId = uuidv4()
  db.prepare(`
    INSERT INTO tests (id, test_plan_id, name, description, field_ids)
    VALUES (?, ?, ?, ?, ?)
  `).run(testId, planId, 'Pallet Cycle Test', 'Standard cycle time verification', JSON.stringify(fieldIds))

  db.prepare(`
    INSERT INTO test_runs (id, test_id, run_at, entered_by, status, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    testId,
    new Date().toISOString(),
    adminId,
    'pass',
    JSON.stringify({ cycle_time_sec: 45, result: 'Pass', notes: 'Sample run' })
  )

  console.log('Seed complete. Admin: admin / admin')
}
