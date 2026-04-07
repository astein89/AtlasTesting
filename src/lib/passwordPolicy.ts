/** Mirrors `server/lib/passwordPolicy.ts` for UI hints and optional client checks. */

export const PASSWORD_MAX_LENGTH = 24

export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireDigit: boolean
  requireSpecial: boolean
}

export function describePasswordRequirements(p: PasswordPolicy): string[] {
  const lines: string[] = [`Between ${p.minLength} and ${PASSWORD_MAX_LENGTH} characters`]
  if (p.requireUppercase) lines.push('One uppercase letter (A–Z)')
  if (p.requireLowercase) lines.push('One lowercase letter (a–z)')
  if (p.requireDigit) lines.push('One digit (0–9)')
  if (p.requireSpecial) lines.push('One special character (not letter or digit)')
  return lines
}

/** Same rules as the server; returns an error message or `null` if valid. */
export function passwordMeetsPolicy(password: string, p: PasswordPolicy): string | null {
  if (typeof password !== 'string') return 'Password is required'
  if (password.length < p.minLength) {
    return `Password must be at least ${p.minLength} characters`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  }
  if (p.requireUppercase && !/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter'
  }
  if (p.requireLowercase && !/[a-z]/.test(password)) {
    return 'Password must include a lowercase letter'
  }
  if (p.requireDigit && !/\d/.test(password)) {
    return 'Password must include a digit'
  }
  if (p.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include a special character'
  }
  return null
}
