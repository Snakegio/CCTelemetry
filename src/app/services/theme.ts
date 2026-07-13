import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function systemTheme(): ThemeMode {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Manual light/dark override on top of the OS preference, persisted across
// launches. Writes [data-theme] on <html>, which src/styles.css keys off of.
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly mode = signal<ThemeMode>(this.load());

  readonly current = this.mode.asReadonly();

  constructor() {
    effect(() => {
      document.documentElement.dataset['theme'] = this.mode();
    });
  }

  toggle(): void {
    const next: ThemeMode = this.mode() === 'dark' ? 'light' : 'dark';
    this.mode.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable — keep the in-memory preference only
    }
  }

  private load(): ThemeMode {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // ignore, fall through to system preference
    }
    return systemTheme();
  }
}
