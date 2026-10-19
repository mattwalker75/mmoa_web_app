import { Component, ElementRef, Input, ViewChild } from '@angular/core';

/**
 * Full-size image viewer (event / raffle flyers) built on the native
 * <dialog>: modal, focus moves into it, Esc closes, and focus returns to the
 * button that opened it. Has a Close button and a Download link.
 */
@Component({
  selector: 'app-flyer-dialog',
  standalone: true,
  template: `
    <dialog #dlg class="flyer-dialog" [attr.aria-label]="label" (click)="backdrop($event)">
      <div class="bar">
        <strong>{{ label }}</strong>
        <div class="btn-row">
          <a class="btn btn-outline btn-sm" [href]="url" [attr.download]="fileName()">Download</a>
          <button type="button" class="btn btn-primary btn-sm" (click)="close()" autofocus>Close</button>
        </div>
      </div>
      @if (url) { <img [src]="url" [alt]="alt"> }
    </dialog>
  `
})
export class FlyerDialogComponent {
  @Input() url: string | null = null;
  @Input() alt = '';
  @Input() label = 'Flyer';
  @ViewChild('dlg', { static: true }) dlg!: ElementRef<HTMLDialogElement>;

  open() { if (this.url && !this.dlg.nativeElement.open) this.dlg.nativeElement.showModal(); }
  close() { this.dlg.nativeElement.close(); }
  /** A click on the backdrop (the dialog element itself, outside the panel) closes it. */
  backdrop(e: MouseEvent) { if (e.target === this.dlg.nativeElement) this.close(); }
  fileName(): string { return (this.url || '').split('/').pop() || 'flyer.jpg'; }
}
