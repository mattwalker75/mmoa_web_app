import { CanDeactivateFn } from '@angular/router';

/** A page with edits that are lost on leaving. */
export interface HasUnsavedChanges { hasUnsavedChanges(): boolean; }

/** Asks before leaving a page with unsaved edits (the portal form). A plain
 *  reload / tab close is covered by the page's own beforeunload listener. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (cmp) =>
  !cmp.hasUnsavedChanges() || window.confirm('You have unsaved changes to your profile. Leave this page and lose them?');
