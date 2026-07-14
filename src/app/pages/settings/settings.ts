import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { Header } from '../../components/header';
import { DEFAULT_NOTIFY_SETTINGS, Notify, type NotifySettings } from '../../services/notify';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink, SliderModule, ToggleSwitchModule, Header],
  templateUrl: './settings.html',
})
export class Settings implements OnInit {
  private notify = inject(Notify);

  settings = signal<NotifySettings>(DEFAULT_NOTIFY_SETTINGS);
  permissionDenied = signal(false);

  async ngOnInit(): Promise<void> {
    this.settings.set(await this.notify.load());
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

  private update(patch: Partial<NotifySettings>): void {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    this.notify.save(next);
  }
}
