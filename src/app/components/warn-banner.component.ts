import { Component, input } from '@angular/core';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-warn-banner',
  imports: [MessageModule],
  template: `
    @if (show()) {
      <p-message severity="warn" class="w-full mb-6">
        <span class="text-[.85rem]">
          Claude Code non è stato trovato su questo computer (cartella
          <code class="num">~/.claude</code> mancante). Installa Claude Code e autenticati per vedere le statistiche.
        </span>
      </p-message>
    }
  `,
})
export class WarnBannerComponent {
  show = input<boolean>(false);
}
