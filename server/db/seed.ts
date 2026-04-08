import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { db } from './index.js'

const SALT_ROUNDS = 10

export async function runSeed(): Promise<void> {
  const userCount = (await db.prepare('SELECT COUNT(*) as count FROM users').get()) as {
    count: number | string
  }
  if (Number(userCount.count) > 0) {
    console.log('Database already seeded, skipping.')
    return
  }

  const adminId = uuidv4()
  const passwordHash = bcrypt.hashSync('admin', SALT_ROUNDS)

  await db
    .prepare(
      `
    INSERT INTO users (id, username, password_hash, name, role)
    VALUES (?, ?, ?, ?, ?)
  `
    )
    .run(adminId, 'admin', passwordHash, 'Admin', 'admin')

  const fieldIds = [uuidv4(), uuidv4(), uuidv4()]
  await db
    .prepare(
      `
    INSERT INTO fields (id, key, label, type, config, created_by)
    VALUES 
      (?, 'cycle_time_sec', 'Cycle Time (sec)', 'number', ?, ?),
      (?, 'result', 'Result', 'select', ?, ?),
      (?, 'notes', 'Notes', 'text', ?, ?)
  `
    )
    .run(
      fieldIds[0],
      JSON.stringify({ unit: 'sec', min: 0, max: 300, required: true }),
      adminId,
      fieldIds[1],
      JSON.stringify({ options: ['Pass', 'Fail', 'N/A'], required: true }),
      adminId,
      fieldIds[2],
      JSON.stringify({ required: false }),
      adminId
    )

  const planId = uuidv4()
  await db
    .prepare(
      `
    INSERT INTO test_plans (id, name, description, field_ids)
    VALUES (?, ?, ?, ?)
  `
    )
    .run(planId, 'Pallet Cycle Plan', 'Standard pallet cycle validation tests', JSON.stringify(fieldIds))

  await db
    .prepare(
      `
    INSERT INTO test_runs (id, test_plan_id, run_at, entered_by, status, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uuidv4(),
      planId,
      new Date().toISOString(),
      adminId,
      'partial',
      JSON.stringify({ cycle_time_sec: 45, result: 'Pass', notes: 'Sample run' })
    )

  console.log('Seed complete. Admin: admin / admin')
}
