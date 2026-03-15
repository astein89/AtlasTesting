import { useUserPreference } from '../hooks/useUserPreference'
import { useDateTimeConfigContext } from '../contexts/DateTimeConfigContext'
import {
  DATE_TIME_PRESETS,
  formatDateWithConfig,
  formatTimeWithConfig,
  formatDateTimeWithConfig,
} from '../lib/dateTimeConfig'
import { PopupSelect } from '../components/ui/PopupSelect'

const EXAMPLE_DATE = new Date('2025-03-15T14:30:00')

export function Settings() {
  const [config, setConfig] = useDateTimeConfigContext()
  const [openRecordsViewOnly, setOpenRecordsViewOnly] = useUserPreference('atlas-open-records-view-only', false)
  const [persistTableFilters, setPersistTableFilters] = useUserPreference('atlas-persist-table-filters', false)

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
    </div>
  )
}
