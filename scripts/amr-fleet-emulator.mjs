/**
 * Local KUKA-style AMR fleet emulator for development.
 * Usage: npm run amr:emulator
 * Point DC-Automation AMR settings at server_ip=127.0.0.1, server_port=<PORT> (default 8099).
 *
 * Dashboard: http://127.0.0.1:<PORT>/ (also /__emulator/ui/)
 *
 * The emulator also runs a deterministic mission simulator:
 *   10 Created -> 20 Executing -> (25 Waiting -> 20)? -> 30 Complete
 * Robot status (4 Executing) and `nodeCode` walk through the mission's missionData positions.
 * Battery drains while Executing, charges while Charging; configurable from the UI modal.
 * All state (robots, jobs, containers, sim state) and tunable settings persist to disk
 * so a process restart resumes seamlessly (periodic flush + debounced saves after mutations).
 * State is stored per listening port: amr-emulator-ui/emulator-state.port-<PORT>.json (legacy
 * emulator-state.json is copied once on upgrade). Do not run two emulators on the same port, and
 * avoid keeping the state JSON open in an editor while the process writes — both cause "swapping".
 */
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.AMR_EMULATOR_PORT) || 8099
const UI_DIR = path.join(__dirname, 'amr-emulator-ui')
/** Resolved once — avoids path issues with express.static + trailing-slash redirects. */
const EMULATOR_UI_INDEX = path.join(UI_DIR, 'index.html')
const SIM_SETTINGS_FILE = path.join(UI_DIR, 'sim-settings.json')
/** Pre-port migration filenames (single shared file — unsafe if multiple emulator ports run). */
const LEGACY_STATE_FILE = path.join(UI_DIR, 'emulator-state.json')
const LEGACY_STATE_BACKUP_FILE = path.join(UI_DIR, 'emulator-state.bak.json')
/** One state file per listening port so two instances never overwrite each other. */
const STATE_FILE = path.join(UI_DIR, `emulator-state.port-${PORT}.json`)
const STATE_BACKUP_FILE = path.join(UI_DIR, `emulator-state.port-${PORT}.bak.json`)

/** @type {Map<string, object>} */
const jobs = new Map()
/** @type {Map<string, object>} */
const robots = new Map()
/** @type {Map<string, object>} */
const containers = new Map()
/** @type {Map<string, { running: boolean, phase: 'created'|'executing'|'waiting', since: number, stepIdx: number, hitWaiting: boolean, robotId: string }>} */
const simState = new Map()

const TERMINAL_JOB_STATUS = new Set([30, 31, 35, 50, 60])

const DEFAULT_SIM_SETTINGS = {
  // Mission lifecycle (each delay is a random integer ms in [min, max] when used)
  autoStartOnCreate: false,
  delayCreatedMsMin: 1500,
  delayCreatedMsMax: 1500,
  nodeStepMsMin: 1500,
  nodeStepMsMax: 1500,
  waitingProbability: 0,
  delayWaitingMsMin: 2000,
  delayWaitingMsMax: 2000,
  delayCompleteMsMin: 500,
  delayCompleteMsMax: 500,
  /** Dashboard poll interval (fixed, not random) */
  autoRefreshIntervalMs: 1000,
  // Battery
  drainExecutingPctPerSec: 0.5,
  drainIdlePctPerSec: 0.0,
  chargePctPerSec: 1.0,
  autoChargeEnabled: false,
  lowBatteryPct: 20,
  fullBatteryPct: 95,
}

let simSettings = { ...DEFAULT_SIM_SETTINGS }
let lastBatteryTickMs = Date.now()

function ok(data) {
  return { data, code: '0', message: null, success: true }
}

/** Normalize IDs/codes so Map keys stay consistent (fleet JSON may send numbers). */
function normKey(v) {
  if (v == null || v === '') return ''
  return String(v).trim()
}

/**
 * Find the actual Map key for a URL segment (string vs legacy number key, whitespace).
 * Express already decodes path params.
 */
function resolveMapKey(map, segment) {
  const s = normKey(segment)
  if (!s && s !== '0') return undefined
  if (map.has(s)) return s
  const n = Number(s)
  if (Number.isFinite(n) && map.has(n)) return n
  for (const k of map.keys()) {
    if (normKey(k) === s) return k
  }
  return undefined
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

/** Uniform random integer ms in [min, max] (inclusive). */
function randomMsInRange(minMs, maxMs) {
  const lo = Math.round(Math.min(minMs, maxMs))
  const hi = Math.round(Math.max(minMs, maxMs))
  if (hi <= 0) return 0
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

/** Cumulative step times for the executing phase; one random duration per node hop. */
function buildExecutingTiming(positions) {
  const n = Array.isArray(positions) ? positions.length : 0
  const cum = []
  let acc = 0
  if (n === 0) {
    acc += randomMsInRange(simSettings.nodeStepMsMin, simSettings.nodeStepMsMax)
    cum.push(acc)
  } else {
    for (let i = 0; i < n; i++) {
      acc += randomMsInRange(simSettings.nodeStepMsMin, simSettings.nodeStepMsMax)
      cum.push(acc)
    }
  }
  return {
    execCum: cum,
    completeSettleMs: randomMsInRange(simSettings.delayCompleteMsMin, simSettings.delayCompleteMsMax),
    awaitingFinalSettle: false,
    afterWaitSettleMs: undefined,
  }
}

/** Fleet-shaped defaults for POST /__emulator/robots when the UI sends partial bodies. */
function defaultRobotRow(robotId) {
  const id = normKey(robotId) || '1'
  return {
    robotId: id,
    robotType: 'KMP 1500P-EU-D diffDrive',
    mapCode: 'Main',
    floorNumber: 'Main',
    buildingCode: 'Dev',
    containerCode: '',
    status: 3,
    occupyStatus: 0,
    batteryLevel: 100,
    nodeCode: 'Main-Main-1',
    nodeLabel: '',
    nodeNumber: 0,
    x: '0',
    y: '0',
    robotOrientation: '0',
    liftStatus: 0,
    reliability: 1,
    runTime: '0',
    karOsVersion: '',
    mileage: '0',
    nodeForeignCode: '',
  }
}

/** Fleet-shaped defaults for POST /__emulator/containers. */
function defaultContainerRow(containerCode) {
  const code = normKey(containerCode) || 'CONTAINER'
  return {
    containerCode: code,
    nodeCode: 'Main-Main-1',
    orientation: '0',
    containerModelCode: 'Pallet',
    emptyFullStatus: 0,
    inMapStatus: 1,
    isCarry: 0,
    mapCode: 'Main',
    districtCode: 'Main',
    persistentContainer: false,
  }
}

function seed() {
  robots.set('1', {
    ...defaultRobotRow('1'),
    batteryLevel: 92,
    nodeCode: 'Main-Main-995',
    nodeLabel: '995',
    nodeNumber: 995,
    x: '1',
    y: '2',
    nodeForeignCode: 'S1-AMR-01',
  })
  containers.set('DEMO-CONTAINER', {
    ...defaultContainerRow('DEMO-CONTAINER'),
    nodeCode: 'Main-Main-6',
  })
}

// ---------- Persistence ----------------------------------------------------

function atomicWrite(file, jsonText) {
  const tmp = `${file}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, jsonText, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmp, file)
    return
  } catch {
    /* Dropbox on Windows often returns EPERM on rename onto the synced file; copy overwrites in place. */
  }
  try {
    fs.copyFileSync(tmp, file)
  } catch {
    fs.writeFileSync(file, jsonText, 'utf8')
  }
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  } catch {
    /* ignore */
  }
}

function loadSimSettings() {
  if (!fs.existsSync(SIM_SETTINGS_FILE)) return
  try {
    const raw = JSON.parse(fs.readFileSync(SIM_SETTINGS_FILE, 'utf8'))
    simSettings = sanitizeSimSettings({ ...DEFAULT_SIM_SETTINGS, ...raw })
    console.log('[amr-emulator] loaded sim settings')
  } catch (e) {
    console.warn('[amr-emulator] failed to load sim settings, using defaults:', e?.message)
  }
}

function saveSimSettingsNow() {
  try {
    atomicWrite(SIM_SETTINGS_FILE, JSON.stringify(simSettings, null, 2))
  } catch (e) {
    console.warn('[amr-emulator] failed to save sim settings:', e?.message)
  }
}

/** Coerce + clamp settings to safe ranges. Tolerates missing fields and string numbers. */
function sanitizeSimSettings(input) {
  const num = (v, fallback) => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const out = { ...DEFAULT_SIM_SETTINGS, ...input }
  out.autoStartOnCreate = Boolean(out.autoStartOnCreate)
  const pair = (minK, maxK, legacyK, defMin, defMax) => {
    const leg = out[legacyK]
    const legN = leg != null && leg !== '' ? num(leg, null) : null
    let lo = num(out[minK], legN != null ? legN : defMin)
    let hi = num(out[maxK], legN != null ? legN : defMax)
    lo = Math.max(0, lo)
    hi = Math.max(0, hi)
    if (lo > hi) [lo, hi] = [hi, lo]
    out[minK] = lo
    out[maxK] = hi
  }
  pair('delayCreatedMsMin', 'delayCreatedMsMax', 'delayCreatedMs', DEFAULT_SIM_SETTINGS.delayCreatedMsMin, DEFAULT_SIM_SETTINGS.delayCreatedMsMax)
  pair('nodeStepMsMin', 'nodeStepMsMax', 'nodeStepMs', DEFAULT_SIM_SETTINGS.nodeStepMsMin, DEFAULT_SIM_SETTINGS.nodeStepMsMax)
  pair('delayWaitingMsMin', 'delayWaitingMsMax', 'delayWaitingMs', DEFAULT_SIM_SETTINGS.delayWaitingMsMin, DEFAULT_SIM_SETTINGS.delayWaitingMsMax)
  pair('delayCompleteMsMin', 'delayCompleteMsMax', 'delayCompleteMs', DEFAULT_SIM_SETTINGS.delayCompleteMsMin, DEFAULT_SIM_SETTINGS.delayCompleteMsMax)
  delete out.delayCreatedMs
  delete out.nodeStepMs
  delete out.delayWaitingMs
  delete out.delayCompleteMs
  out.waitingProbability = clamp(num(out.waitingProbability, 0), 0, 1)
  out.autoRefreshIntervalMs = clamp(
    num(out.autoRefreshIntervalMs, DEFAULT_SIM_SETTINGS.autoRefreshIntervalMs),
    250,
    120000
  )
  out.drainExecutingPctPerSec = Math.max(0, num(out.drainExecutingPctPerSec, DEFAULT_SIM_SETTINGS.drainExecutingPctPerSec))
  out.drainIdlePctPerSec = Math.max(0, num(out.drainIdlePctPerSec, DEFAULT_SIM_SETTINGS.drainIdlePctPerSec))
  out.chargePctPerSec = Math.max(0, num(out.chargePctPerSec, DEFAULT_SIM_SETTINGS.chargePctPerSec))
  out.autoChargeEnabled = Boolean(out.autoChargeEnabled)
  let lo = clamp(num(out.lowBatteryPct, DEFAULT_SIM_SETTINGS.lowBatteryPct), 0, 100)
  let hi = clamp(num(out.fullBatteryPct, DEFAULT_SIM_SETTINGS.fullBatteryPct), 0, 100)
  if (lo > hi) [lo, hi] = [hi, lo]
  out.lowBatteryPct = lo
  out.fullBatteryPct = hi
  return out
}

let saveTimer = null
function scheduleSaveState() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveStateNow()
  }, 500)
}

function buildStateSnapshot() {
  return {
    version: 1,
    robots: [...robots.entries()],
    jobs: [...jobs.entries()],
    containers: [...containers.entries()],
    simState: [...simState.entries()],
  }
}

function saveStateNow() {
  try {
    const json = JSON.stringify(buildStateSnapshot(), null, 2)
    if (fs.existsSync(STATE_FILE)) {
      try {
        fs.copyFileSync(STATE_FILE, STATE_BACKUP_FILE)
      } catch {
        /* Dropbox / OneDrive may briefly lock the file */
      }
    }
    atomicWrite(STATE_FILE, json)
    const verify = tryReadJsonFile(STATE_FILE)
    if (!verify) {
      console.error(
        '[amr-emulator] state file failed read-back check after write. Cloud sync or another process may be fighting this file:',
        path.basename(STATE_FILE)
      )
    }
  } catch (e) {
    console.warn('[amr-emulator] failed to save state:', e?.message)
  }
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* empty — retry delay for cloud-synced files returning transient empty/partial reads */
  }
}

/**
 * Reject partial/empty objects (e.g. `{}` or truncated sync) that JSON.parse accepts but are not our snapshot.
 */
function normalizeStateSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (
    !Object.prototype.hasOwnProperty.call(raw, 'robots') ||
    !Object.prototype.hasOwnProperty.call(raw, 'jobs') ||
    !Object.prototype.hasOwnProperty.call(raw, 'containers') ||
    !Object.prototype.hasOwnProperty.call(raw, 'simState')
  ) {
    return null
  }
  if (
    !Array.isArray(raw.robots) ||
    !Array.isArray(raw.jobs) ||
    !Array.isArray(raw.containers) ||
    !Array.isArray(raw.simState)
  ) {
    return null
  }
  return {
    version: Number(raw.version) || 1,
    robots: raw.robots,
    jobs: raw.jobs,
    containers: raw.containers,
    simState: raw.simState,
  }
}

function tryReadJsonFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    if (!text.trim()) return null
    const parsed = JSON.parse(text)
    return normalizeStateSnapshot(parsed)
  } catch {
    return null
  }
}

/** Read JSON with retries — Dropbox on Windows often serves empty or partial files briefly. */
function readStateJsonWithRetries(filePath, attempts = 8, gapMs = 60) {
  for (let i = 0; i < attempts; i++) {
    const raw = tryReadJsonFile(filePath)
    if (raw != null) return raw
    if (i < attempts - 1) sleepSync(gapMs)
  }
  return null
}

function quarantineUnreadableStateFile() {
  if (!fs.existsSync(STATE_FILE)) return
  const dir = path.dirname(STATE_FILE)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(dir, `emulator-state.corrupt.${stamp}.json`)
  try {
    fs.renameSync(STATE_FILE, dest)
    console.warn(`[amr-emulator] moved unreadable state file to ${dest}`)
  } catch (e) {
    console.warn('[amr-emulator] could not quarantine corrupt state file:', e?.message)
  }
}

function applyRawToMaps(raw) {
  robots.clear()
  jobs.clear()
  containers.clear()
  simState.clear()
  warnedMissingRobots.clear()
  for (const [k, v] of raw.robots) robots.set(String(k), v)
  for (const [k, v] of raw.jobs) jobs.set(String(k), v)
  for (const [k, v] of raw.containers) containers.set(String(k), v)
  for (const [k, v] of raw.simState) {
    simState.set(String(k), { ...v, since: Date.now() })
  }
  lastBatteryTickMs = Date.now()
}

/** One-time copy from legacy shared filenames to port-scoped files (see STATE_FILE). */
function migrateLegacyStateIfNeeded() {
  if (fs.existsSync(STATE_FILE)) return
  if (!fs.existsSync(LEGACY_STATE_FILE)) return
  try {
    fs.copyFileSync(LEGACY_STATE_FILE, STATE_FILE)
    console.log(
      `[amr-emulator] migrated ${path.basename(LEGACY_STATE_FILE)} -> ${path.basename(STATE_FILE)} (port-scoped; avoids clashes with a second emulator instance)`
    )
  } catch (e) {
    console.warn('[amr-emulator] legacy state migration failed:', e?.message)
  }
  if (!fs.existsSync(STATE_BACKUP_FILE) && fs.existsSync(LEGACY_STATE_BACKUP_FILE)) {
    try {
      fs.copyFileSync(LEGACY_STATE_BACKUP_FILE, STATE_BACKUP_FILE)
    } catch {
      /* ignore */
    }
  }
}

function loadPersistedState() {
  if (!fs.existsSync(STATE_FILE)) {
    seed()
    return
  }

  let raw = readStateJsonWithRetries(STATE_FILE)
  let source = 'primary'

  if (!raw && fs.existsSync(STATE_BACKUP_FILE)) {
    raw = readStateJsonWithRetries(STATE_BACKUP_FILE)
    if (raw) {
      source = 'backup'
      console.warn('[amr-emulator] restored state from emulator-state.bak.json (primary was unreadable)')
    }
  }

  if (!raw) {
    quarantineUnreadableStateFile()
    console.warn(
      '[amr-emulator] could not parse emulator-state.json — starting from seed (check emulator-state.corrupt.* for the bad file)'
    )
    seed()
    return
  }

  applyRawToMaps(raw)
  console.log(
    `[amr-emulator] loaded persisted state (${source}) ${path.basename(STATE_FILE)}: robots=${robots.size}, jobs=${jobs.size}, containers=${containers.size}, sims=${simState.size}`
  )
}

// ---------- Sim helpers ----------------------------------------------------

function phaseFromStatus(status) {
  switch (Number(status)) {
    case 10:
      return 'created'
    case 25:
      return 'waiting'
    case 20:
    default:
      return 'executing'
  }
}

function isJobStatusTerminal(status) {
  return TERMINAL_JOB_STATUS.has(Number(status))
}

/** Pick a default robot for a new job (first robot, or '1' fallback). */
function pickDefaultRobotId() {
  for (const k of robots.keys()) return String(k)
  return '1'
}

/**
 * Match production `submitMission`: the app sends `robotIds` (array); the fleet job exposes `robotId`.
 * Use the first non-empty id, then singular `robotId` / `robot_id`, else the dashboard default.
 */
function robotIdFromSubmitMissionBody(body) {
  const ids = body?.robotIds
  if (Array.isArray(ids)) {
    for (const x of ids) {
      const id = normKey(x)
      if (id) return id
    }
  }
  const single = normKey(body?.robotId ?? body?.robot_id)
  if (single) return single
  return pickDefaultRobotId()
}

function startSimForJob(code, opts = {}) {
  const job = jobs.get(code)
  if (!job) return null
  const status = Number(job.status ?? 10)
  if (isJobStatusTerminal(status)) return null
  const existing = simState.get(code)
  const positions = Array.isArray(job.positions) ? job.positions : []
  const phase = phaseFromStatus(status)
  const next = {
    running: true,
    phase,
    since: Date.now(),
    stepIdx: existing?.stepIdx ?? 0,
    hitWaiting: existing?.hitWaiting ?? false,
    robotId: opts.robotId ?? existing?.robotId ?? String(job.robotId ?? pickDefaultRobotId()),
  }
  if (phase === 'created') {
    next.createdDurationMs = randomMsInRange(simSettings.delayCreatedMsMin, simSettings.delayCreatedMsMax)
  } else if (phase === 'executing') {
    Object.assign(next, buildExecutingTiming(positions))
  } else if (phase === 'waiting') {
    next.waitingDurationMs = randomMsInRange(simSettings.delayWaitingMsMin, simSettings.delayWaitingMsMax)
  }
  simState.set(code, next)
  return next
}

function stopSimForJob(code) {
  const cur = simState.get(code)
  if (!cur) return null
  const next = { ...cur, running: false }
  simState.set(code, next)
  return next
}

function maybeAutoStartSim(code) {
  if (!simSettings.autoStartOnCreate) return
  const job = jobs.get(code)
  if (!job) return
  if (isJobStatusTerminal(Number(job.status))) return
  startSimForJob(code)
  console.log(`[amr-emulator] auto-started sim for job ${code}`)
}

// ---------- Tick loop ------------------------------------------------------

const SIM_TICK_MS = 250
const STATE_PERIODIC_FLUSH_MS = 5000
let lastPeriodicFlushMs = Date.now()

function simTick() {
  const now = Date.now()

  // Mission pass
  for (const [code, st] of simState) {
    if (!st.running) continue
    const job = jobs.get(code)
    if (!job) {
      simState.delete(code)
      continue
    }
    if (isJobStatusTerminal(Number(job.status))) {
      simState.set(code, { ...st, running: false })
      continue
    }
    advanceMission(code, st, job, now)
  }

  // Battery pass (always runs)
  const dt = Math.max(0, (now - lastBatteryTickMs) / 1000)
  lastBatteryTickMs = now
  if (dt > 0) {
    for (const [, robot] of robots) {
      let level = Number(robot.batteryLevel)
      if (!Number.isFinite(level)) level = 100
      const status = Number(robot.status)
      if (status === 4) level -= simSettings.drainExecutingPctPerSec * dt
      else if (status === 3) level -= simSettings.drainIdlePctPerSec * dt
      else if (status === 5) level += simSettings.chargePctPerSec * dt
      level = clamp(level, 0, 100)
      robot.batteryLevel = Math.round(level * 100) / 100

      if (simSettings.autoChargeEnabled) {
        if (status === 3 && robot.batteryLevel <= simSettings.lowBatteryPct) robot.status = 5
        else if (status === 5 && robot.batteryLevel >= simSettings.fullBatteryPct) robot.status = 3
      }
    }
  }

  // Periodic flush so battery drift / phase progression survives a hard kill
  if (now - lastPeriodicFlushMs >= STATE_PERIODIC_FLUSH_MS) {
    lastPeriodicFlushMs = now
    saveStateNow()
  }
}

function advanceMission(code, st, job, now) {
  const robot = robots.get(String(st.robotId)) || robots.get(st.robotId)
  const positions = Array.isArray(job.positions) ? job.positions : []
  const elapsed = now - st.since

  if (st.phase === 'created') {
    const needMs = st.createdDurationMs ?? randomMsInRange(simSettings.delayCreatedMsMin, simSettings.delayCreatedMsMax)
    if (elapsed < needMs) return
    job.status = 20
    if (robot) robot.status = 4
    else warnMissingRobot(st.robotId, code)
    const execTiming = buildExecutingTiming(positions)
    simState.set(code, {
      ...st,
      phase: 'executing',
      since: now,
      stepIdx: 0,
      ...execTiming,
      createdDurationMs: undefined,
      hitWaiting: false,
    })
    return
  }

  if (st.phase === 'executing') {
    if (!st.execCum?.length) {
      simState.set(code, { ...st, ...buildExecutingTiming(positions) })
      st = simState.get(code)
    }

    if (st.awaitingFinalSettle) {
      const need = st.afterWaitSettleMs ?? 0
      if (elapsed >= need) finishMission(code, st, job, robot, now)
      return
    }

    if (positions.length === 0) {
      const cum0 = st.execCum[0]
      if (st.stepIdx === 0) {
        if (elapsed < cum0) return
        simState.set(code, { ...st, stepIdx: 1 })
        return
      }
      if (elapsed < cum0 + st.completeSettleMs) return
      finishMission(code, st, job, robot, now)
      return
    }

    let stepIdx = st.stepIdx
    while (stepIdx < positions.length && elapsed >= st.execCum[stepIdx]) {
      const pos = positions[stepIdx]
      if (robot && pos) robot.nodeCode = pos
      stepIdx++
    }
    if (stepIdx !== st.stepIdx) {
      simState.set(code, { ...st, stepIdx })
      st = simState.get(code)
    }

    if (stepIdx >= positions.length) {
      const totalRouteMs = st.execCum[positions.length - 1]
      if (elapsed < totalRouteMs) return
      if (!st.hitWaiting && Math.random() < simSettings.waitingProbability) {
        job.status = 25
        simState.set(code, {
          ...st,
          phase: 'waiting',
          since: now,
          stepIdx,
          hitWaiting: true,
          waitingDurationMs: randomMsInRange(simSettings.delayWaitingMsMin, simSettings.delayWaitingMsMax),
        })
        return
      }
      if (elapsed >= totalRouteMs + st.completeSettleMs) {
        finishMission(code, st, job, robot, now)
      }
    }
    return
  }

  if (st.phase === 'waiting') {
    const needMs = st.waitingDurationMs ?? randomMsInRange(simSettings.delayWaitingMsMin, simSettings.delayWaitingMsMax)
    if (elapsed < needMs) return
    job.status = 20
    simState.set(code, {
      ...st,
      phase: 'executing',
      since: now,
      awaitingFinalSettle: true,
      afterWaitSettleMs: randomMsInRange(simSettings.delayCompleteMsMin, simSettings.delayCompleteMsMax),
      waitingDurationMs: undefined,
    })
  }
}

function finishMission(code, st, job, robot, now) {
  job.status = 30
  job.completeTime = new Date(now).toISOString()
  if (robot) robot.status = 3
  simState.set(code, { ...st, running: false })
}

const warnedMissingRobots = new Set()
function warnMissingRobot(robotId, jobCode) {
  const key = `${robotId}::${jobCode}`
  if (warnedMissingRobots.has(key)) return
  warnedMissingRobots.add(key)
  console.warn(`[amr-emulator] sim job ${jobCode} references missing robot ${robotId}`)
}

// ---------- Boot -----------------------------------------------------------

loadSimSettings()
migrateLegacyStateIfNeeded()
loadPersistedState()
setInterval(simTick, SIM_TICK_MS)

const app = express()
app.use(express.json())

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', '*')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function sendEmulatorDashboard(_req, res) {
  if (!fs.existsSync(EMULATOR_UI_INDEX)) {
    res.status(500).type('text').send(`Missing UI file: ${EMULATOR_UI_INDEX}`)
    return
  }
  res.type('html').send(fs.readFileSync(EMULATOR_UI_INDEX, 'utf8'))
}

/**
 * Express matches `/__emulator/ui` and `/__emulator/ui/` to the same GET route — a naive redirect caused an infinite 302.
 * Only redirect when the path truly has no trailing slash (compare `originalUrl`, not overlapping route patterns).
 */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  const pathOnly = req.originalUrl.split('?')[0]
  if (pathOnly === '/__emulator/ui') {
    res.redirect(302, '/__emulator/ui/')
    return
  }
  next()
})

/** Dashboard at root so http://127.0.0.1:<PORT>/ always opens the control panel. */
app.get('/', sendEmulatorDashboard)

app.get('/__emulator/ui/', sendEmulatorDashboard)

app.get('/__emulator/', (_req, res) => {
  res.redirect(302, '/__emulator/ui/')
})

function simSummary() {
  return {
    settings: simSettings,
    jobs: [...simState.entries()].map(([code, st]) => ({
      code,
      running: !!st.running,
      phase: st.phase,
      stepIdx: st.stepIdx,
      hitWaiting: !!st.hitWaiting,
      robotId: st.robotId,
    })),
  }
}

app.get('/__emulator/state', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    robots: [...robots.entries()],
    jobs: [...jobs.entries()],
    containers: [...containers.entries()],
    sim: simSummary(),
  })
})

app.get('/__emulator/jobs', (_req, res) => {
  res.json([...jobs.entries()])
})
app.get('/__emulator/robots', (_req, res) => {
  res.json([...robots.entries()])
})
app.get('/__emulator/containers', (_req, res) => {
  res.json([...containers.entries()])
})

// ---------- Sim settings + control endpoints -------------------------------

app.get('/__emulator/sim/settings', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(simSettings)
})

app.patch('/__emulator/sim/settings', (req, res) => {
  simSettings = sanitizeSimSettings({ ...simSettings, ...(req.body ?? {}) })
  saveSimSettingsNow()
  res.json(simSettings)
})

/** Remove all jobs whose status is terminal (complete, cancelled, warning, etc.). */
app.post('/__emulator/jobs/clear-terminal', (_req, res) => {
  const codes = []
  for (const [code, job] of jobs) {
    if (isJobStatusTerminal(Number(job.status))) codes.push(String(code))
  }
  for (const code of codes) {
    jobs.delete(code)
    simState.delete(code)
  }
  scheduleSaveState()
  res.json({ removed: codes.length, codes })
})

app.post('/__emulator/jobs/:code/sim/start', (req, res) => {
  const key = resolveMapKey(jobs, req.params.code)
  if (key === undefined) return res.status(404).json({ error: 'job not found' })
  const result = startSimForJob(String(key), { robotId: req.body?.robotId })
  if (!result) return res.status(409).json({ error: 'cannot start sim (job in terminal status)' })
  scheduleSaveState()
  res.json(result)
})

app.post('/__emulator/jobs/:code/sim/stop', (req, res) => {
  const key = resolveMapKey(jobs, req.params.code)
  if (key === undefined) return res.status(404).json({ error: 'job not found' })
  const result = stopSimForJob(String(key))
  scheduleSaveState()
  res.json(result || { running: false })
})

app.post('/__emulator/sim/start-all', (_req, res) => {
  let started = 0
  for (const [code, job] of jobs) {
    if (isJobStatusTerminal(Number(job.status))) continue
    if (startSimForJob(String(code))) started++
  }
  scheduleSaveState()
  res.json({ started })
})

app.post('/__emulator/sim/stop-all', (_req, res) => {
  let stopped = 0
  for (const code of simState.keys()) {
    const cur = simState.get(code)
    if (cur?.running) {
      stopSimForJob(code)
      stopped++
    }
  }
  scheduleSaveState()
  res.json({ stopped })
})

// ---------- Mutation endpoints ---------------------------------------------

app.post('/__emulator/reset', (_req, res) => {
  jobs.clear()
  robots.clear()
  containers.clear()
  simState.clear()
  warnedMissingRobots.clear()
  lastBatteryTickMs = Date.now()
  seed()
  saveStateNow()
  res.json({ ok: true })
})

app.post('/__emulator/jobs/:code/status', (req, res) => {
  const key = resolveMapKey(jobs, req.params.code)
  const status = Number(req.body?.status ?? 30)
  const j = key !== undefined ? jobs.get(key) : undefined
  if (!j) return res.status(404).json({ error: 'job not found' })
  j.status = status
  if (isJobStatusTerminal(status)) {
    const cur = simState.get(String(key))
    if (cur) simState.set(String(key), { ...cur, running: false })
  }
  scheduleSaveState()
  res.json(j)
})

app.post('/__emulator/robots', (req, res) => {
  const id = normKey(req.body?.robotId) || `r-${robots.size + 1}`
  const row = { ...defaultRobotRow(id), ...req.body, robotId: id }
  robots.set(id, row)
  scheduleSaveState()
  res.json(row)
})

app.post('/__emulator/containers', (req, res) => {
  const code = normKey(req.body?.containerCode) || `c-${containers.size + 1}`
  const row = { ...defaultContainerRow(code), ...req.body, containerCode: code }
  if (typeof row.persistentContainer === 'string') {
    row.persistentContainer = row.persistentContainer === 'true' || row.persistentContainer === '1'
  }
  containers.set(code, row)
  scheduleSaveState()
  res.json(row)
})

/** Dev dashboard: create a job row without going through submitMission. */
app.post('/__emulator/jobs', (req, res) => {
  const code =
    normKey(req.body?.jobCode) || normKey(req.body?.missionCode) || `job-${jobs.size + 1}`
  const positions = Array.isArray(req.body?.positions)
    ? req.body.positions.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
    : []
  const row = {
    jobCode: code,
    workflowId: jobs.size + 1,
    containerCode: req.body?.containerCode ?? '',
    robotId: String(req.body?.robotId ?? pickDefaultRobotId()),
    status: Number(req.body?.status ?? 10),
    mapCode: req.body?.mapCode ?? 'Main',
    targetCellCodeForeign: req.body?.targetCellCodeForeign ?? (positions.at(-1) ?? ''),
    beginCellCodeForeign: req.body?.beginCellCodeForeign ?? (positions[0] ?? ''),
    positions,
    createTime: new Date().toISOString(),
    completeTime: null,
    ...req.body,
  }
  row.jobCode = code
  if (Array.isArray(req.body?.positions)) row.positions = positions
  jobs.set(code, row)
  maybeAutoStartSim(code)
  scheduleSaveState()
  res.status(201).json(row)
})

app.delete('/__emulator/robots/:id', (req, res) => {
  const key = resolveMapKey(robots, req.params.id)
  if (key === undefined) return res.status(404).json({ error: 'robot not found' })
  robots.delete(key)
  scheduleSaveState()
  res.json({ ok: true, deleted: String(key) })
})

app.delete('/__emulator/jobs/:code', (req, res) => {
  const key = resolveMapKey(jobs, req.params.code)
  if (key === undefined) return res.status(404).json({ error: 'job not found' })
  jobs.delete(key)
  simState.delete(String(key))
  scheduleSaveState()
  res.json({ ok: true, deleted: String(key) })
})

app.delete('/__emulator/containers/:code', (req, res) => {
  const key = resolveMapKey(containers, req.params.code)
  if (key === undefined) return res.status(404).json({ error: 'container not found' })
  containers.delete(key)
  scheduleSaveState()
  res.json({ ok: true, deleted: String(key) })
})

function mergePatch(map, key, patch, idField) {
  const cur = map.get(key)
  if (!cur) return null
  const next = { ...cur }
  const body = patch && typeof patch === 'object' ? { ...patch } : {}
  delete body[idField]
  Object.assign(next, body)
  next[idField] = cur[idField]
  map.set(key, next)
  return next
}

app.patch('/__emulator/robots/:id', (req, res) => {
  const key = resolveMapKey(robots, req.params.id)
  if (key === undefined) return res.status(404).json({ error: 'robot not found' })
  const row = mergePatch(robots, key, req.body, 'robotId')
  if (!row) return res.status(404).json({ error: 'robot not found' })
  scheduleSaveState()
  res.json(row)
})

app.patch('/__emulator/jobs/:code', (req, res) => {
  const key = resolveMapKey(jobs, req.params.code)
  if (key === undefined) return res.status(404).json({ error: 'job not found' })
  const row = mergePatch(jobs, key, req.body, 'jobCode')
  if (!row) return res.status(404).json({ error: 'job not found' })
  if (isJobStatusTerminal(Number(row.status))) {
    const cur = simState.get(String(key))
    if (cur) simState.set(String(key), { ...cur, running: false })
  }
  scheduleSaveState()
  res.json(row)
})

app.patch('/__emulator/containers/:code', (req, res) => {
  const key = resolveMapKey(containers, req.params.code)
  if (key === undefined) return res.status(404).json({ error: 'container not found' })
  const row = mergePatch(containers, key, req.body, 'containerCode')
  if (!row) return res.status(404).json({ error: 'container not found' })
  scheduleSaveState()
  res.json(row)
})

// ---------- Fleet API ------------------------------------------------------

function handleFleet(op, body) {
  switch (op) {
    case 'robotQuery': {
      const list = [...robots.values()]
      return ok(list)
    }
    case 'jobQuery': {
      const raw = body?.jobCode
      if (raw == null || raw === '') return ok([...jobs.values()])
      const code = normKey(raw)
      let j = jobs.get(code)
      if (!j && Number.isFinite(Number(code))) j = jobs.get(Number(code))
      return ok(j ? [j] : [])
    }
    case 'submitMission': {
      const mc =
        normKey(body?.missionCode) || normKey(body?.requestId) || `job-${jobs.size}`
      const md = Array.isArray(body?.missionData) ? body.missionData : []
      const positions = [...md]
        .sort((a, b) => (Number(a?.sequence) || 0) - (Number(b?.sequence) || 0))
        .map((m) => (typeof m?.position === 'string' ? m.position.trim() : ''))
        .filter(Boolean)
      const ccFromBody = normKey(body?.containerCode)
      const row = {
        jobCode: mc,
        workflowId: jobs.size + 1,
        containerCode: ccFromBody || body?.missionData?.[0]?.container || '',
        robotId: robotIdFromSubmitMissionBody(body),
        status: 10,
        mapCode: 'Main',
        targetCellCodeForeign: positions.at(-1) ?? '',
        beginCellCodeForeign: positions[0] ?? '',
        positions,
        createTime: new Date().toISOString(),
        completeTime: null,
      }
      jobs.set(mc, row)
      /** Multistop / rack-move: one container from containerIn; never register a new container per segment here. */
      if (ccFromBody && containers.has(ccFromBody)) {
        const prev = containers.get(ccFromBody)
        const start = positions[0] ?? ''
        if (start && prev) {
          containers.set(ccFromBody, { ...prev, containerCode: ccFromBody, nodeCode: start })
        }
      }
      maybeAutoStartSim(mc)
      scheduleSaveState()
      return ok(null)
    }
    case 'containerIn': {
      const cc = normKey(body?.containerCode) || 'GEN'
      const pos = typeof body?.position === 'string' ? body.position.trim() : ''
      const isNew = body?.isNew !== false && body?.isNew !== 'false'
      const prev = containers.get(cc)
      if (!isNew && prev) {
        containers.set(cc, {
          ...prev,
          containerCode: cc,
          nodeCode: pos || prev.nodeCode || '',
          containerModelCode: body?.containerModelCode ?? prev.containerModelCode ?? 'Pallet',
          inMapStatus: 1,
        })
      } else {
        containers.set(cc, {
          containerCode: cc,
          nodeCode: pos,
          inMapStatus: 1,
          containerModelCode: body?.containerModelCode ?? 'Pallet',
          persistentContainer: Boolean(body?.persistentContainer),
        })
      }
      scheduleSaveState()
      return ok(`containerCode:${cc}`)
    }
    case 'containerOut': {
      /** Match fleet + app payloads: remove by containerCode and/or position (node), never by requestId. */
      const byCode =
        typeof body?.containerCode === 'string' && body.containerCode.trim() ? body.containerCode.trim() : ''
      const position = typeof body?.position === 'string' && body.position.trim() ? body.position.trim() : ''
      let removed = false
      if (byCode && containers.has(byCode)) {
        containers.delete(byCode)
        removed = true
      } else if (byCode) {
        for (const [k, row] of containers) {
          if (String(row?.containerCode ?? k) === byCode) {
            containers.delete(k)
            removed = true
            break
          }
        }
      }
      if (!removed && position) {
        for (const [k, row] of containers) {
          if (String(row?.nodeCode ?? '') === position) {
            containers.delete(k)
            removed = true
            break
          }
        }
      }
      if (!removed) {
        return {
          success: false,
          code: '404',
          message:
            byCode || position
              ? 'No container matched containerCode / position (emulator)'
              : 'containerOut requires containerCode or position',
          data: null,
        }
      }
      scheduleSaveState()
      return ok(null)
    }
    case 'containerQuery':
    case 'containerQueryAll': {
      const list = [...containers.values()]
      let out = list
      if (body?.inMapStatus === '1') out = list.filter((c) => String(c.inMapStatus) === '1')
      if (body?.inMapStatus === '0') out = list.filter((c) => String(c.inMapStatus) === '0')
      return ok(out)
    }
    case 'missionCancel': {
      const mc = normKey(body?.missionCode)
      let j = mc ? jobs.get(mc) : null
      let key = mc
      if (!j && mc && Number.isFinite(Number(mc))) {
        j = jobs.get(Number(mc))
        key = String(Number(mc))
      }
      if (j) {
        j.status = 31
        const cur = simState.get(String(key))
        if (cur) simState.set(String(key), { ...cur, running: false })
        scheduleSaveState()
      }
      return ok(null)
    }
    case 'operationFeedback':
      return ok(null)
    default:
      return { success: false, code: 'unknown', message: `unsupported operation: ${op}`, data: null }
  }
}

app.post('/api/amr/:operation', (req, res) => {
  const op = req.params.operation
  const out = handleFleet(op, req.body ?? {})
  res.json(out)
})

// ---------- Shutdown -------------------------------------------------------

let shuttingDown = false
function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[amr-emulator] received ${signal}, flushing state...`)
  try {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saveStateNow()
    saveSimSettingsNow()
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[amr-emulator] listening on http://127.0.0.1:${PORT}`)
  console.log(`[amr-emulator] dashboard   http://127.0.0.1:${PORT}/`)
  console.log(`[amr-emulator] state file    ${path.basename(STATE_FILE)}`)
})
