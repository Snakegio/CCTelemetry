import {Component, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {invoke} from '@tauri-apps/api/core';
import {disable, enable, isEnabled} from '@tauri-apps/plugin-autostart';
import {ColorPickerModule} from 'primeng/colorpicker';
import {SliderModule} from 'primeng/slider';
import {ToggleSwitchModule} from 'primeng/toggleswitch';
import {Header} from '../../components/header';
import {DEFAULT_NOTIFY_SETTINGS, Notify, type NotifySettings} from '../../services/notify';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, SliderModule, ToggleSwitchModule, ColorPickerModule, Header],
  templateUrl: './settings.html',
})
export class Settings implements OnInit {
  private notify = inject(Notify);

  settings = signal<NotifySettings>(DEFAULT_NOTIFY_SETTINGS);
  permissionDenied = signal(false);
  // Reflects the actual OS launch-at-startup registration (source of truth is
  // the autostart plugin, not settings.json).
  autostart = signal(true);

  async ngOnInit(): Promise<void> {
    this.settings.set(await this.notify.load());
    this.autostart.set(await isEnabled());
  }

  async setAutostart(on: boolean): Promise<void> {
    if (on) {
      await enable();
    } else {
      await disable();
    }
    this.autostart.set(await isEnabled());
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.permissionDenied.set(false);
    if (enabled) {
      const granted = await this.notify.ensurePermission();
      if (!granted) {
        this.permissionDenied.set(true);
        return; // leave the toggle off; nothing persisted
      }
    }
    this.update({ enabled });
  }

  setFiveHourThreshold(value: number): void {
    this.update({ fiveHourThreshold: value });
  }

  setWeeklyThreshold(value: number): void {
    this.update({ weeklyThreshold: value });
  }

  async sendTestNotification(): Promise<void> {
    await this.notify.sendTest();
  }

  async setIconColor(value: string): Promise<void> {
    // Await the save so refresh_tray reads the new settings.json, not the stale one.
    await this.update({ iconColor: value.replace(/^#/, '') });
    await invoke('refresh_tray'); // reflect the change on the tray now, not on the next poll
  }

  async setIconMode(ring: boolean): Promise<void> {
    await this.update({ iconMode: ring ? 'ring' : 'text' });
    await invoke('refresh_tray');
  }

  async setIconTextScale(value: number): Promise<void> {
    await this.update({ iconTextScale: value });
    await invoke('refresh_tray');
  }

  private async update(patch: Partial<NotifySettings>): Promise<void> {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    await this.notify.save(next);
  }
}
