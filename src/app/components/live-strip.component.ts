import { Component, computed, input } from '@angular/core';
import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import type { LiveSession } from '../core/core';
import { basename, fmtTokens } from '../core/format';

@Component({
  selector: 'app-live-strip',
  imports: [CardModule, ProgressBarModule],
  templateUrl: './live-strip.component.html',
})
export class LiveStripComponent {
  live = input<LiveSession | null>(null);
  visible = input<boolean>(false);

  readonly fmtTokens = fmtTokens;
  readonly basename = basename;

  ctxPct = computed(() => Math.round(this.live()?.contextLeftPct ?? 0));
  sessPct = computed(() => {
    const p = this.live()?.sessionLeftPct;
    return p != null ? Math.round(p) : null;
  });
  modelLabel = computed(() => (this.live()?.model || '—').replace(/^claude-/, ''));
}
