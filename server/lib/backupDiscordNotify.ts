/** Discord Incoming Webhook: embed-based backup alerts (https://discord.com/developers/docs/resources/webhook) */

const EMBED_GREEN = 0x57f287
const EMBED_RED = 0xed4245
const MAX_DESC = 4096
const MAX_TITLE = 256
const MAX_FIELD_VALUE = 1024
/** Webhook `username` override max length (Discord API). */
const MAX_WEBHOOK_USERNAME = 80

const DEFAULT_BOT_NAME = 'DC Automation'

export type DiscordEmbedField = { name: string; value: string; inline?: boolean }

function isDiscordWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (u.hostname !== 'discord.com' && u.hostname !== 'discordapp.com') return false
    return /^\/api\/webhooks\/\d+\/.+/.test(u.pathname)
  } catch {
    return false
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 3)}...`
}

/** Visible bot name in Discord; include a short label when several apps share one webhook. */
export function formatDiscordWebhookUsername(notifyLabel?: string | null): string {
  const label = typeof notifyLabel === 'string' ? notifyLabel.trim() : ''
  if (!label) return DEFAULT_BOT_NAME
  const combined = `${DEFAULT_BOT_NAME} · ${label}`
  return truncate(combined, MAX_WEBHOOK_USERNAME)
}

function titleWithNotifyLabel(baseTitle: string, notifyLabel?: string | null): string {
  const label = typeof notifyLabel === 'string' ? notifyLabel.trim() : ''
  if (!label) return baseTitle
  return truncate(`[${label}] ${baseTitle}`, MAX_TITLE)
}

/**
 * POST a single embed to a Discord webhook. Logs non-2xx responses (does not throw).
 */
export async function sendDiscordBackupEmbed(
  webhookUrl: string,
  options: {
    ok: boolean
    title: string
    description: string
    fields?: DiscordEmbedField[]
    /** Short name for this deployment (shown in webhook username and embed title). */
    notifyLabel?: string | null
  }
): Promise<void> {
  const trimmed = webhookUrl.trim()
  if (!trimmed) return
  if (!isDiscordWebhookUrl(trimmed)) {
    console.warn('[backup] Discord webhook URL must be https://discord.com/api/webhooks/... or discordapp.com equivalent')
    return
  }

  const displayTitle = titleWithNotifyLabel(options.title, options.notifyLabel)

  const fields = (options.fields ?? [])
    .map((f) => ({
      name: truncate(f.name, 256),
      value: truncate(f.value, MAX_FIELD_VALUE),
      ...(f.inline !== undefined ? { inline: f.inline } : {}),
    }))
    .slice(0, 25)

  const body = JSON.stringify({
    username: formatDiscordWebhookUsername(options.notifyLabel),
    embeds: [
      {
        title: truncate(displayTitle, MAX_TITLE),
        description: truncate(options.description, MAX_DESC),
        color: options.ok ? EMBED_GREEN : EMBED_RED,
        timestamp: new Date().toISOString(),
        ...(fields.length > 0 ? { fields } : {}),
      },
    ],
  })

  try {
    const res = await fetch(trimmed, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[backup] Discord webhook HTTP', res.status, text.slice(0, 300))
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[backup] Discord webhook request failed:', msg)
  }
}

/**
 * Send a one-off test message; returns whether Discord accepted it (for API / UI).
 */
export async function sendDiscordBackupTest(
  webhookUrl: string,
  opts?: { notifyLabel?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = webhookUrl.trim()
  if (!trimmed) {
    return { ok: false, error: 'Discord webhook URL is empty' }
  }
  if (!isDiscordWebhookUrl(trimmed)) {
    return {
      ok: false,
      error: 'URL must be https://discord.com/api/webhooks/… or discordapp.com equivalent',
    }
  }

  const label = typeof opts?.notifyLabel === 'string' ? opts.notifyLabel.trim() : ''
  const title = titleWithNotifyLabel('Backup notification test', label || null)
  const desc =
    'This is a test message from **DC Automation** backup settings. If you see this, the webhook URL works.'

  const body = JSON.stringify({
    username: formatDiscordWebhookUsername(label || null),
    embeds: [
      {
        title: truncate(title, MAX_TITLE),
        description: truncate(desc, MAX_DESC),
        color: EMBED_GREEN,
        timestamp: new Date().toISOString(),
        fields: [{ name: 'Purpose', value: 'Verify Discord alerts before relying on backup runs.', inline: false }],
      },
    ],
  })

  try {
    const res = await fetch(trimmed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Discord returned ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
