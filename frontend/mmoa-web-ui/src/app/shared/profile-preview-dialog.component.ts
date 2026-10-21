import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { PublicOrg } from '../core/models';
import { OrgCardComponent } from './org-card.component';
import { OrgViewComponent } from './org-view.component';

/**
 * Portal "Preview public profile" — a modal (native <dialog>: Esc closes,
 * focus moves in and returns to the opener) showing both ways the public
 * sees a nonprofit: its card in "Need Help?" search results and its full
 * profile page. Both are the real shared components, fed the server's
 * public view of the LAST SAVED profile (hidden fields already removed).
 * The parent refreshes `org` before opening (see PortalComponent.openPreview).
 */
@Component({
  selector: 'app-profile-preview-dialog',
  standalone: true,
  imports: [OrgCardComponent, OrgViewComponent],
  template: `
    <dialog #dlg class="flyer-dialog preview-dialog" aria-labelledby="pp-title" (click)="backdrop($event)" (close)="closed.emit()">
      <div class="bar">
        <strong id="pp-title">Preview public profile</strong>
        <button type="button" class="btn btn-primary btn-sm" (click)="close()" autofocus>Close</button>
      </div>
      <div class="pp-body stack" style="gap:26px">
        <p class="muted" style="margin:0">
          Based on your last <strong>saved</strong> changes — press "Save changes" first to see new edits here.
          @if (!isPublic) { <br>Not visible to the public yet: your profile shows in "Need Help?" once MMoA verifies it and it's listed. }
        </p>
        @if (loading) {
          <div class="loading" style="min-height:120px"><span class="spinner light big" role="status" aria-label="Loading preview"></span></div>
        } @else if (org) {
          <section class="stack" style="gap:12px" aria-labelledby="pp-search">
            <h2 id="pp-search" class="pp-h">In search results</h2>
            <app-org-card [org]="org" [preview]="true" />
          </section>
          <section class="stack" style="gap:12px" aria-labelledby="pp-page">
            <h2 id="pp-page" class="pp-h">Your full profile page</h2>
            <div class="preview-box"><app-org-view [org]="org" [preview]="true" /></div>
          </section>
        }
      </div>
    </dialog>
  `
})
export class ProfilePreviewDialogComponent {
  @Input() org: PublicOrg | null = null;
  @Input() isPublic = false;
  @Input() loading = false;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('dlg', { static: true }) dlg!: ElementRef<HTMLDialogElement>;

  open() { if (!this.dlg.nativeElement.open) this.dlg.nativeElement.showModal(); }
  close() { this.dlg.nativeElement.close(); }
  /** A click on the backdrop (the dialog element itself, outside the panel) closes it. */
  backdrop(e: MouseEvent) { if (e.target === this.dlg.nativeElement) this.close(); }
}
