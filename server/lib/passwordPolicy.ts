import { db } from '../db/index.js'

export const PASSWORD_POLICY_KV_KEY = 'password_policy'

export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireDigit: boolean
  requireSpecial: boolean
}

/** Hard bounds for password length (policy minLength is clamped within this range). */
export const PASSWORD_LENGTH_ABS_MIN = 4
export const PASSWORD_LENGTH_ABS_MAX = 24

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 6,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecial: false,
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (v === true) return true
  if (v === false || v == null) return false
  if (typeof v === 'number') return v === 1
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no') return false
  }
  return fallback
}

function clampMinLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PASSWORD_POLICY.minLength
  const r = Math.round(n)
  return Math.min(PASSWORD_LENGTH_ABS_MAX, Math.max(PASSWORD_LENGTH_ABS_MIN, r))
}

export function parsePasswordPolicyJson(raw: string | undefined): PasswordPolicy {
  if (!raw?.trim()) return { ...DEFAULT_PASSWORD_POLICY }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    return {
      minLength: clampMinLength(
        typeof j.minLength === 'number'
          ? j.minLength
          : typeof j.minLength === 'string'
            ? parseInt(j.minLength, 10)
            : DEFAULT_PASSWORD_POLICY.minLength
      ),
      requireUppercase: coerceBool(j.requireUppercase, DEFAULT_PASSWORD_POLICY.requireUppercase),
      requireLowercase: coerceBool(j.requireLowercase, DEFAULT_PASSWORD_POLICY.requireLowercase),
      requireDigit: coerceBool(j.requireDigit, DEFAULT_PASSWORD_POLICY.requireDigit),
      requireSpecial: coerceBool(j.requireSpecial, DEFAULT_PASSWORD_POLICY.requireSpecial),
    }
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY }
  }
}

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(PASSWORD_POLICY_KV_KEY)) as
    | { value: string }
    | undefined
  return parsePasswordPolicyJson(row?.value)
}

/** Human-readable rejection reason, or `null` if the password satisfies the policy. */
export function passwordPolicyError(password: string, policy: PasswordPolicy): string | null {
  if (typeof password !== 'string') {
    return 'Password is required'
  }
  if (password.length < policy.minLength) {
    return `Password must be at least ${policy.minLength} characters`
  }
  if (password.length > PASSWORD_LENGTH_ABS_MAX) {
    return `Password must be at most ${PASSWORD_LENGTH_ABS_MAX} characters`
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter'
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    return 'Password must include a lowercase letter'
  }
  if (policy.requireDigit && !/\d/.test(password)) {
    return 'Password must include a digit'
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include a special character'
  }
  return null
}

export function normalizePasswordPolicyBody(body: unknown): { ok: true; data: PasswordPolicy } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>
  let minLength = DEFAULT_PASSWORD_POLICY.minLength
  if (typeof b.minLength === 'number' && Number.isFinite(b.minLength)) {
    minLength = b.minLength
  } else if (typeof b.minLength === 'string' && b.minLength.trim() !== '') {
    const n = parseInt(b.minLength, 10)
    if (Number.isFinite(n)) minLength = n
  }
  minLength = clampMinLength(minLength)
  const data: PasswordPolicy = {
    minLength,
    requireUppercase: coerceBool(b.requireUppercase, DEFAULT_PASSWORD_POLICY.requireUppercase),
    requireLowercase: coerceBool(b.requireLowercase, DEFAULT_PASSWORD_POLICY.requireLowercase),
    requireDigit: coerceBool(b.requireDigit, DEFAULT_PASSWORD_POLICY.requireDigit),
    requireSpecial: coerceBool(b.requireSpecial, DEFAULT_PASSWORD_POLICY.requireSpecial),
  }
  return { ok: true, data }
}
