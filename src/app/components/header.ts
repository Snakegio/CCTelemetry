import { Component, computed, inject } from '@angular/core';
import { Theme } from '../services/theme';
import {NgOptimizedImage} from "@angular/common";
import {RouterLink, RouterLinkActive} from "@angular/router";

@Component({
    selector: 'app-header',
    templateUrl: './header.html',
    imports: [
        NgOptimizedImage,
        RouterLink,
        RouterLinkActive
    ]
})
export class Header {
  readonly theme = inject(Theme);
  themeIcon = computed(() => (this.theme.current() === 'dark' ? '☀' : '☾'));
}
