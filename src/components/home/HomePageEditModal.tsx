import { useRef, useState } from 'react'
import { api } from '@/api/client'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { HomeWelcomeMarkdownModal } from '@/components/home/HomeWelcomeMarkdownModal'
import { HomeModuleCardsSortableList } from '@/components/home/HomeModuleCardsSortableList'
import { mergeHomeModuleOrder, normalizeModulesHiddenFromHomeIds } from '@/lib/homeModuleOrder'
import { normalizeModuleCardOverrides } from '@/lib/moduleCardPresentation'
import { publicAsset } from '@/lib/basePath'
import { uploadsUrl } from '@/lib/uploadsUrl'
import {
  WELCOME_LOGO_DEFAULT_REM,
  WELCOME_LOGO_MAX_REM,
  WELCOME_LOGO_MIN_REM,
  clampWelcomeLogoMaxRem,
} from '@/lib/welcomeLogoSize'
import type { HomePageConfig } from '@/types/homePage'

function homeBrandingPreviewUrl(
  path: string | null,
  revision: number | undefined,
  nonce: number
): string | null {
  if (!path?.trim()) return null
  let u = uploadsUrl(path.trim(), revision ?? 0)
  if (nonce > 0) u += (u.includes('?') ? '&' : '?') + `_=${nonce}`
  return u
}

interface HomePageEditModalProps {
  initial: HomePageConfig
  onClose: () => void
  onSaved: (config: HomePageConfig) => void
}

export function HomePageEditModal({ initial, onClose, onSaved }: HomePageEditModalProps) {
  const { showAlert } = useAlertConfirm()
  const [introMarkdown, setIntroMarkdown] = useState(initial.introMarkdown)
  const [showWelcomeLogo, setShowWelcomeLogo] = useState(initial.showWelcomeLogo === true)
  const [welcomeLogoMaxRem, setWelcomeLogoMaxRem] = useState(() =>
    clampWelcomeLogoMaxRem(initial.welcomeLogoMaxRem ?? WELCOME_LOGO_DEFAULT_REM)
  )
  const [moduleOrder, setModuleOrder] = useState(() => mergeHomeModuleOrder(initial.moduleOrder))
  const [modulesHiddenFromHome, setModulesHiddenFromHome] = useState<string[]>(() =>
    normalizeModulesHiddenFromHomeIds(initial.modulesHiddenFromHome)
  )
  const [moduleCardOverrides, setModuleCardOverrides] = useState(() =>
    normalizeModuleCardOverrides(initial.moduleCardOverrides)
  )
  const [welcomeEditorOpen, setWelcomeEditorOpen] = useState(false)
  const [welcomeEditorSession, setWelcomeEditorSession] = useState(0)
  const [welcomeLogoPath, setWelcomeLogoPath] = useState<string | null>(() =>
    initial.welcomeLogoPath?.trim() ? initial.welcomeLogoPath.trim() : null
  )
  const [siteFaviconPath, setSiteFaviconPath] = useState<string | null>(() =>
    initial.siteFaviconPath?.trim() ? initial.siteFaviconPath.trim() : null
  )
  const [brandingPreviewNonce, setBrandingPreviewNonce] = useState(0)
  const welcomeLogoFileRef = useRef<HTMLInputElement>(null)
  const faviconFileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)

  const welcomeLogoPreviewSrc = homeBrandingPreviewUrl(
    welcomeLogoPath,
    initial.homeBrandingRevision,
    brandingPreviewNonce
  )
  const faviconPreviewSrc = homeBrandingPreviewUrl(
    siteFaviconPath,
    initial.homeBrandingRevision,
    brandingPreviewNonce
  )

  const uploadBrandingFile = async (which: 'welcome' | 'favicon', file: File) => {
    const form = new FormData()
    form.append('file', file)
    const url = which === 'welcome' ? '/home/welcome-logo' : '/home/site-favicon'
    const { data } = await api.post<{ path: string }>(url, form)
    setBrandingPreviewNonce((n) => n + 1)
    if (which === 'welcome') setWelcomeLogoPath(data.path)
    else setSiteFaviconPath(data.path)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data } = await api.put<HomePageConfig>('/home', {
        introMarkdown,
        moduleOrder,
        modulesHiddenFromHome,
        moduleCardOverrides,
        showWelcomeLogo: Boolean(showWelcomeLogo),
        welcomeLogoMaxRem: clampWelcomeLogoMaxRem(welcomeLogoMaxRem),
        welcomeLogoPath: welcomeLogoPath ?? null,
        siteFaviconPath: siteFaviconPath ?? null,
      })
      onSaved(data)
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-edit-title"
      >
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 id="home-edit-title" className="text-lg font-semibold text-foreground">
            Edit home page
          </h2>
          <p className="mt-1 text-sm text-foreground/70">
            Edit the welcome content (Markdown), branding, and module cards. Manage links from{' '}
            <strong className="font-medium text-foreground">Manage links</strong> in the nav. Close with Cancel or
            Save (backdrop clicks do not dismiss).
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <input
              type="checkbox"
              checked={showWelcomeLogo}
              onChange={(e) => setShowWelcomeLogo(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Logo beside welcome</span>
              <span className="mt-0.5 block text-xs text-foreground/65">
                Shows your welcome image to the left of the welcome text on medium+ screens (stacked on small
                screens). Use a custom file below or the built-in <code className="rounded bg-background px-1">public/logo.png</code>.
              </span>
            </span>
          </label>

          {showWelcomeLogo ? (
            <div className="space-y-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
              <div>
                <span className="block text-sm font-medium text-foreground">Welcome image</span>
                <p className="text-xs text-foreground/65">
                  PNG, JPEG, WebP, GIF, or SVG. Max 2&nbsp;MB. Replaces the default logo for the home hub only.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {welcomeLogoPreviewSrc ? (
                    <img
                      src={welcomeLogoPreviewSrc}
                      alt=""
                      className="h-16 w-auto max-w-[10rem] rounded-lg border border-border object-contain"
                    />
                  ) : (
                    <img
                      src={publicAsset('logo.png')}
                      alt=""
                      className="h-16 w-auto max-w-[10rem] rounded-lg border border-border object-contain opacity-90"
                    />
                  )}
                  <input
                    ref={welcomeLogoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void uploadBrandingFile('welcome', f).catch(() => showAlert('Upload failed'))
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => welcomeLogoFileRef.current?.click()}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-background/80"
                  >
                    Upload…
                  </button>
                  {welcomeLogoPath ? (
                    <button
                      type="button"
                      onClick={() => {
                        setWelcomeLogoPath(null)
                        setBrandingPreviewNonce((n) => n + 1)
                      }}
                      className="text-sm text-foreground/80 hover:text-foreground hover:underline"
                    >
                      Use built-in logo
                    </button>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="logo-size">
                  Logo size (max width)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="logo-size"
                    type="range"
                    min={WELCOME_LOGO_MIN_REM}
                    max={WELCOME_LOGO_MAX_REM}
                    step="0.5"
                    value={welcomeLogoMaxRem}
                    onChange={(e) => setWelcomeLogoMaxRem(clampWelcomeLogoMaxRem(parseFloat(e.target.value)))}
                    className="h-2 min-w-[8rem] flex-1 cursor-pointer accent-primary"
                  />
                  <span className="tabular-nums text-sm text-foreground/80">{welcomeLogoMaxRem}rem</span>
                </div>
                <p className="mt-1 text-xs text-foreground/60">
                  Between {WELCOME_LOGO_MIN_REM} and {WELCOME_LOGO_MAX_REM} rem.
                </p>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <span className="block text-sm font-medium text-foreground">Site icon (favicon)</span>
            <p className="mt-0.5 text-xs text-foreground/65">
              Browser tab and “Add to Home Screen” icon for this app. PNG recommended (square); SVG supported.
              Max 512&nbsp;KB. Default is <code className="rounded bg-background px-1">public/icon.png</code>. Saves
              after you click Save below.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {faviconPreviewSrc ? (
                <img
                  src={faviconPreviewSrc}
                  alt=""
                  className="h-10 w-10 rounded border border-border object-contain"
                />
              ) : (
                <img
                  src={publicAsset('icon.png')}
                  alt=""
                  className="h-10 w-10 rounded border border-border object-contain opacity-90"
                />
              )}
              <input
                ref={faviconFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void uploadBrandingFile('favicon', f).catch(() => showAlert('Upload failed'))
                }}
              />
              <button
                type="button"
                onClick={() => faviconFileRef.current?.click()}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-background/80"
              >
                Upload favicon…
              </button>
              {siteFaviconPath ? (
                <button
                  type="button"
                  onClick={() => {
                    setSiteFaviconPath(null)
                    setBrandingPreviewNonce((n) => n + 1)
                  }}
                  className="text-sm text-foreground/80 hover:text-foreground hover:underline"
                >
                  Use built-in icon
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/40 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="block text-sm font-medium text-foreground">Welcome content (Markdown)</span>
                <p className="mt-0.5 text-xs text-foreground/65">
                  Open the full editor for the same toolbar, preview, and shortcuts as wiki pages.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setWelcomeEditorSession((n) => n + 1)
                  setWelcomeEditorOpen(true)
                }}
                className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background/80"
              >
                Edit welcome…
              </button>
            </div>
            <p className="mt-2 text-xs text-foreground/60">
              Links starting with <code className="rounded bg-background px-1">/</code> stay in the app; http(s)
              URLs open in a new tab.
            </p>
            {introMarkdown.trim() ? (
              <pre
                className="mt-2 max-h-28 overflow-auto rounded-md border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] leading-snug text-foreground/80 whitespace-pre-wrap"
                aria-label="Welcome markdown preview (trimmed)"
              >
                {introMarkdown.length > 1200 ? `${introMarkdown.slice(0, 1200)}…` : introMarkdown}
              </pre>
            ) : (
              <p className="mt-2 text-sm text-foreground/50">No welcome text yet. Click Edit welcome…</p>
            )}
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-foreground">Module cards</span>
            <p className="mb-2 text-xs text-foreground/65">
              Reorder, use <strong className="font-medium text-foreground">Edit</strong> for title, description, and
              icon, or hide a module from home only (sidebar and routes unchanged).
            </p>
            <HomeModuleCardsSortableList
              moduleOrder={moduleOrder}
              onModuleOrderChange={setModuleOrder}
              modulesHiddenFromHome={modulesHiddenFromHome}
              onToggleHideFromHome={(id) =>
                setModulesHiddenFromHome((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                )
              }
              moduleCardOverrides={moduleCardOverrides}
              onModuleCardOverridesChange={setModuleCardOverrides}
            />
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <HomeWelcomeMarkdownModal
        open={welcomeEditorOpen}
        editorSessionKey={`home-welcome-${welcomeEditorSession}`}
        initialMarkdown={introMarkdown}
        onClose={() => setWelcomeEditorOpen(false)}
        onApply={setIntroMarkdown}
      />

    </div>
  )
}
