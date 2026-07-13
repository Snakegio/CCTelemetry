import { Component, computed, inject } from '@angular/core';
import { Theme } from '../services/theme';

@Component({
  selector: 'app-header',
  templateUrl: './header.html',
})
export class Header {
  readonly theme = inject(Theme);
  themeIcon = computed(() => (this.theme.current() === 'dark' ? '☀' : '☾'));
}
