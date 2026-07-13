import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';

export interface NotifySettings {
  enabled: boolean;
  fiveHourThreshold: number;
  weeklyThreshold: number;
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { enabled: false, fiveHourThreshold: 80, weeklyThreshold: 80 };

// Persists the usage-threshold notification preferences (Settings page)
// through the same read/write-JSON-file Tauri commands UsageService uses
// for history, and requests the OS notification permission on opt-in.
@Injectable({ providedIn: 'root' })
export class Notify {
  async load(): Promise<NotifySettings> {
    try {
      const raw = JSON.parse(await invoke<string>('read_notify_settings'));
      return { ...DEFAULT_NOTIFY_SETTINGS, ...raw };
    } catch {
      return DEFAULT_NOTIFY_SETTINGS;
    }
  }

  async save(settings: NotifySettings): Promise<void> {
    try {
      await invoke('write_notify_settings', { json: JSON.stringify(settings) });
    } catch {
      // best-effort persistence; the next load() falls back to defaults
    }
  }

  // Returns false if the OS permission prompt is denied — the caller
  // decides how to surface that (Settings shows an inline warning).
  async ensurePermission(): Promise<boolean> {
    if (await isPermissionGranted()) return true;
    const result = await requestPermission();
    return result === 'granted';
  }
}
