import { useUserPreference } from '../hooks/useUserPreference'
import { useDateTimeConfigContext } from '../contexts/DateTimeConfigContext'
import {
  DATE_TIME_PRESETS,
  formatDateWithConfig,
  formatTimeWithConfig,
  formatDateTimeWithConfig,
} from '../lib/dateTimeConfig'
import { PopupSelect } from '../components/ui/PopupSelect'
import { useConditionalFormatPresets } from '../contexts/ConditionalFormatPresetsContext'
import type { CfColorPreset } from '../lib/conditionalFormatPresets'

const EXAMPLE_DATE = new Date('2025-03-15T14:30:00')

function CfPresetRowEditor({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: CfColorPreset
  index: number
  onChange: (i: number, patch: Partial<CfColorPreset>) => void
  onRemove: (i: number) => void
}) {
  const t = row.hex.trim().toLowerCase()
  const m3 = /^#([0-9a-f]{3})$/.exec(t)
  const expanded =
    m3 != null ? `#${m3[1][0]}${m3[1][0]}${m3[1][1]}${m3[1][1]}${m3[1][2]}${m3[1][2]}` : t
  const hexOk = /^#[0-9a-f]{6}$/.test(expanded)
  const pickerVal = hexOk ? expanded : '#808080'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2">
      <input
        type="color"
        aria-label={`Color ${index + 1}`}
        value={pickerVal}
        onChange={(e) => onChange(index, { hex: e.target.value })}
        className="h-9 w-11 shrink-0 cursor-pointer rounded border border-border"
      />
      <input
        type="text"
        value={row.hex}
        onChange={(e) => onChange(index, { hex: e.target.value })}
        placeholder="#hex"
        className="w-24 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
      />
      <input
        type="text"
        value={row.label}
        onChange={(e) => onChange(index, { label: e.target.value })}
        placeholder="Label (tooltip)"
        className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="shrink-0 rounded border border-red-500/40 px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
      >
        Remove
      </button>
    </div>
  )
}

export function Settings() {
  const [config, setConfig] = useDateTimeConfigContext()
  const [openRecordsViewOnly, setOpenRecordsViewOnly] = useUserPreference('atlas-open-records-view-only', false)
  const [persistTableFilters, setPersistTableFilters] = useUserPreference('atlas-persist-table-filters', false)
  const { presets: cfPresets, setPresets: setCfPresets, resetPresetsToDefaults } = useConditionalFormatPresets()

  const currentPresetIndex = DATE_TIME_PRESETS.findIndex(
    (p) =>
      p.value.dateFormat === config.dateFormat &&
      p.value.timeFormat === config.timeFormat &&
      p.value.dateTimeFormat === config.dateTimeFormat
  )

  const presetValue = currentPresetIndex >= 0 ? String(currentPresetIndex) : 'custom'
  const presetOptions = [
    ...DATE_TIME_PRESETS.map((p, i) => ({ value: String(i), label: p.label })),
    { value: 'custom', label: 'Custom' },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Settings</h1>
      <section className="mb-8 rounded-lg border border-border bg-card/50 p-5">
        <h2 className="mb-3 text-lg font-medium text-foreground">Date & time</h2>
        <p className="mb-4 text-sm text-foreground/80">
          Choose how dates and times are shown across the app (plan runs, recorded at, exports).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <label htmlFor="date-time-preset" className="text-sm font-medium text-foreground/90">
            Preset
          </label>
          <PopupSelect
            id="date-time-preset"
            label=""
            value={presetValue}
            onChange={(v) => {
              if (v !== 'custom' && v !== '') {
                const idx = Number(v)
                if (idx >= 0 && idx < DATE_TIME_PRESETS.length) {
                  setConfig(DATE_TIME_PRESETS[idx].value)
                }
              }
            }}
            options={presetOptions}
            className="min-w-[220px] max-w-full"
          />
        </div>
        <p className="mt-3 text-sm text-foreground/70">
          Date: {formatDateWithConfig(EXAMPLE_DATE, config)} · Time: {formatTimeWithConfig(EXAMPLE_DATE, config)} · Date and time: {formatDateTimeWithConfig(EXAMPLE_DATE, config)}
        </p>
      </section>
      <section className="mb-8 rounded-lg border border-border bg-card/50 p-5">
        <h2 className="mb-3 text-lg font-medium text-foreground">Data</h2>
        <p className="mb-4 text-sm text-foreground/80">
          When enabled, clicking a data row opens it in view-only; use the Edit button in the modal to edit.
        </p>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={openRecordsViewOnly}
            onChange={(e) => setOpenRecordsViewOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-foreground">Open data rows in view-only</span>
        </label>
        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={persistTableFilters}
            onChange={(e) => setPersistTableFilters(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-foreground">Persist table filters between devices</span>
        </label>
        <p className="mt-1 text-sm text-foreground/70">
          When enabled, search and column filters are saved to your account and sync across devices.
        </p>
      </section>
      <section className="mb-8 rounded-lg border border-border bg-card/50 p-5">
        <h2 className="mb-3 text-lg font-medium text-foreground">Conditional formatting</h2>
        <p className="mb-4 text-sm text-foreground/80">
          Quick-pick colors when editing data fields (conditional format rules). &quot;No fill&quot; and
          &quot;Aa&quot; (default text) are always available; these lists are the extra swatches. Saved to your
          account.
        </p>
        <div className="mb-6 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Fill (background) swatches</h3>
          <div className="space-y-2">
            {cfPresets.fill.map((row, i) => (
              <CfPresetRowEditor
                key={`fill-${i}-${row.hex}`}
                row={row}
                index={i}
                onChange={(idx, patch) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    fill: prev.fill.map((r, j) => (j === idx ? { ...r, ...patch } : r)),
                  }))
                }
                onRemove={(idx) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    fill: prev.fill.filter((_, j) => j !== idx),
                  }))
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setCfPresets((prev) => ({
                ...prev,
                fill: [...prev.fill, { hex: '#fef08a', label: '' }],
              }))
            }
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            + Add fill color
          </button>
        </div>
        <div className="mb-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Text color swatches</h3>
          <div className="space-y-2">
            {cfPresets.text.map((row, i) => (
              <CfPresetRowEditor
                key={`text-${i}-${row.hex}`}
                row={row}
                index={i}
                onChange={(idx, patch) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    text: prev.text.map((r, j) => (j === idx ? { ...r, ...patch } : r)),
                  }))
                }
                onRemove={(idx) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    text: prev.text.filter((_, j) => j !== idx),
                  }))
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setCfPresets((prev) => ({
                ...prev,
                text: [...prev.text, { hex: '#b91c1c', label: '' }],
              }))
            }
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            + Add text color
          </button>
        </div>
        <button
          type="button"
          onClick={() => resetPresetsToDefaults()}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
        >
          Reset fill &amp; text lists to app defaults
        </button>
      </section>
    </div>
  )
}
