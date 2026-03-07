import { useDateTimeConfig } from '../hooks/useDateTimeConfig'
import { DATE_TIME_PRESETS, formatDateTime } from '../lib/dateTimeConfig'

export function Settings() {
  const [config, setConfig] = useDateTimeConfig()
  const exampleDate = new Date('2025-03-15T14:30:00')

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value)
    if (idx >= 0 && idx < DATE_TIME_PRESETS.length) {
      setConfig(DATE_TIME_PRESETS[idx].value)
    }
  }

  const currentPresetIndex = DATE_TIME_PRESETS.findIndex(
    (p) =>
      p.value.dateFormat === config.dateFormat &&
      p.value.timeFormat === config.timeFormat &&
      p.value.dateTimeFormat === config.dateTimeFormat
  )

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
          <select
            id="date-time-preset"
            value={currentPresetIndex >= 0 ? currentPresetIndex : ''}
            onChange={handlePresetChange}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {DATE_TIME_PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
            {currentPresetIndex < 0 && (
              <option value="">Custom</option>
            )}
          </select>
        </div>
        <p className="mt-3 text-sm text-foreground/70">
          Example: {formatDateTime(exampleDate)}
        </p>
      </section>
    </div>
  )
}
