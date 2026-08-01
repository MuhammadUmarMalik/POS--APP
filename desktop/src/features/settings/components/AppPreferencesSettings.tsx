import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button, Field, Select } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { type AppPreferences, usePreferences } from '../../../stores/preferences'
import { SettingsSection } from './SettingsLayout'

export function AppPreferencesSettings() {
  const startPage = usePreferences((state) => state.startPage)
  const navigationDensity = usePreferences((state) => state.navigationDensity)
  const confirmCartChanges = usePreferences((state) => state.confirmCartChanges)
  const reduceMotion = usePreferences((state) => state.reduceMotion)
  const updatePreferences = usePreferences((state) => state.updatePreferences)
  const [preferences, setPreferences] = useState<AppPreferences>(() => ({
    startPage,
    navigationDensity,
    confirmCartChanges,
    reduceMotion,
  }))

  const update = <Key extends keyof AppPreferences>(key: Key, value: AppPreferences[Key]) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }

  const save = () => {
    updatePreferences(preferences)
    toast.success('App preferences saved')
  }

  return (
    <SettingsSection
      title="App Preferences"
      description="Startup, navigation and interaction options for this device"
      icon={<SlidersHorizontal size={18} />}
      actions={<Button size="sm" onClick={save}>Save preferences</Button>}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Page after login">
          <Select
            value={preferences.startPage}
            onChange={(event) => update('startPage', event.target.value as AppPreferences['startPage'])}
          >
            <option value="dashboard">Dashboard</option>
            <option value="pos">New Sale / POS</option>
          </Select>
        </Field>
        <Field label="Navigation spacing">
          <Select
            value={preferences.navigationDensity}
            onChange={(event) => update(
              'navigationDensity',
              event.target.value as AppPreferences['navigationDensity']
            )}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </Select>
        </Field>
      </div>

      <div className="mt-5 divide-y divide-line rounded-lg border border-line">
        <PreferenceToggle
          checked={preferences.confirmCartChanges}
          onChange={(checked) => update('confirmCartChanges', checked)}
          title="Confirm cart replacement or clearing"
          description="Ask before discarding items from an active cart or replacing it with a held sale."
        />
        <PreferenceToggle
          checked={preferences.reduceMotion}
          onChange={(checked) => update('reduceMotion', checked)}
          title="Reduce motion"
          description="Minimize animations and transitions throughout the application."
        />
      </div>
      <p className="mt-3 text-xs text-muted">Preferences are saved locally for this device.</p>
    </SettingsSection>
  )
}

function PreferenceToggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-5 px-4 py-3.5">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
      <span className="relative shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}
