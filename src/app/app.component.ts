import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private unlistenNavigate?: UnlistenFn;

  ngOnInit(): void {
    listen<string>('navigate', (e) => {
      if (e.payload === 'dashboard' || e.payload === 'analysis' || e.payload === 'about' || e.payload === 'settings') {
        this.router.navigateByUrl(e.payload === 'dashboard' ? '/' : `/${e.payload}`);
      }
    }).then((unlisten) => (this.unlistenNavigate = unlisten));
  }

  ngOnDestroy(): void {
    this.unlistenNavigate?.();
  }
}
