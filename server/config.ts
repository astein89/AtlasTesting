import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const defaultConfigPath = path.join(projectRoot, 'config.default.json')
const localConfigPath = path.join(projectRoot, 'config.json')

export type AppConfig = {
  databaseUrl?: string
}

function readJsonIfExists(filePath: string): AppConfig {
  try {
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as AppConfig
  } catch {
    return {}
  }
}

/** Env > config.json > config.default.json */
export function loadAppConfig(): AppConfig {
  const defaults = readJsonIfExists(defaultConfigPath)
  const local = readJsonIfExists(localConfigPath)
  return { ...defaults, ...local }
}

/** True when DATABASE_URL is set or config provides a non-empty databaseUrl. */
export function usePostgresFromEnv(): boolean {
  const envUrl = process.env.DATABASE_URL?.trim()
  if (envUrl) return true
  const cfg = loadAppConfig()
  return Boolean(cfg.databaseUrl?.trim())
}

export function resolveDatabaseUrl(): string | undefined {
  const envUrl = process.env.DATABASE_URL?.trim()
  if (envUrl) return envUrl
  const cfg = loadAppConfig()
  const u = cfg.databaseUrl?.trim()
  return u || undefined
}
