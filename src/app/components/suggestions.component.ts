import { Component, computed, input, signal } from '@angular/core';
import { MessageModule } from 'primeng/message';
import type { Suggestion } from '../core/core';

@Component({
  selector: 'app-suggestions',
  imports: [MessageModule],
  template: `
    @if (visible().length) {
      <div class="flex flex-col gap-[.6rem] mb-9">
        @for (s of visible(); track s.id) {
          <p-message severity="info" [closable]="true" (onClose)="dismiss(s.id)" class="w-full">
            <span class="flex items-start gap-[.6rem] text-[.85rem]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="stroke-[var(--color-accent)] flex-none mt-[1px]" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.5.5 1 1.2 1 2.5h6c0-1.3.5-2 1-2.5A6 6 0 0 0 12 3z"></path>
              </svg>
              <span class="flex-1">{{ s.text }}</span>
            </span>
          </p-message>
        }
      </div>
    }
  `,
})
export class SuggestionsComponent {
  suggestions = input<Suggestion[]>([]);
  private dismissed = signal<Set<string>>(this.load());

  visible = computed(() => {
    const d = this.dismissed();
    return this.suggestions().filter((s) => !d.has(s.id));
  });

  dismiss(id: string): void {
    const next = new Set(this.dismissed());
    next.add(id);
    this.dismissed.set(next);
    try {
      localStorage.setItem('dismissedSuggestions', JSON.stringify([...next]));
    } catch {
      // storage unavailable — keep the in-memory dismissal only
    }
  }

  private load(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem('dismissedSuggestions') || '[]'));
    } catch {
      return new Set();
    }
  }
}
