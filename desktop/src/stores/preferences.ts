import { create } from 'zustand'

const PREFERENCES_KEY = 'pos.app-preferences.v1'

export interface AppPreferences {
  startPage: 'dashboard' | 'pos'
  navigationDensity: 'comfortable' | 'compact'
  confirmCartChanges: boolean
  reduceMotion: boolean
}

interface PreferencesStore extends AppPreferences {
  updatePreferences: (preferences: AppPreferences) => void
}

const defaults: AppPreferences = {
  startPage: 'dashboard',
  navigationDensity: 'comfortable',
  confirmCartChanges: true,
  reduceMotion: false,
}

function readPreferences(): AppPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Partial<AppPreferences> & {
      version?: number
    }
    if (stored.version !== 1) return defaults
    return {
      startPage: stored.startPage === 'pos' ? 'pos' : 'dashboard',
      navigationDensity: stored.navigationDensity === 'compact' ? 'compact' : 'comfortable',
      confirmCartChanges: stored.confirmCartChanges !== false,
      reduceMotion: stored.reduceMotion === true,
    }
  } catch {
    return defaults
  }
}

function writePreferences(preferences: AppPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, ...preferences }))
  } catch {
    // Preferences are optional; storage failures must not block the POS.
  }
}

export const usePreferences = create<PreferencesStore>((set) => ({
  ...readPreferences(),
  updatePreferences: (preferences) => {
    writePreferences(preferences)
    set(preferences)
  },
}))
