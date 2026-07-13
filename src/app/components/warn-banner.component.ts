import { Component, input } from '@angular/core';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-warn-banner',
  imports: [MessageModule],
  template: `
    @if (show()) {
      <p-message severity="warn" class="w-full mb-6">
        <span class="text-[.85rem]">
          Claude Code was not found on this computer (missing
          <code class="num">~/.claude</code> folder). Install Claude Code and sign in to see usage stats.
        </span>
      </p-message>
    }
  `,
})
export class WarnBannerComponent {
  show = input<boolean>(false);
}
