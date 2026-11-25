// Registration module for the File Browser's elements. Imported by its entry only.
import { EfsFileEditor } from './editor.ts';
import { EfsFilesListing } from './listing.ts';
import { EfsFilesPreview } from './preview.ts';
import { EfsFilesView } from './views.ts';

export function registerFilesElements(): void {
  if (!customElements.get('efs-files-view')) customElements.define('efs-files-view', EfsFilesView);
  if (!customElements.get('efs-file-editor'))
    customElements.define('efs-file-editor', EfsFileEditor);
  if (!customElements.get('efs-files-listing')) {
    customElements.define('efs-files-listing', EfsFilesListing);
  }
  if (!customElements.get('efs-files-preview')) {
    customElements.define('efs-files-preview', EfsFilesPreview);
  }
}
