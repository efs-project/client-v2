// Registration module for the File Browser's elements. Imported by its entry only.
import { EfsFilesPreview } from './preview.ts';
import { EfsFilesView } from './views.ts';

export function registerFilesElements(): void {
  if (!customElements.get('efs-files-view')) customElements.define('efs-files-view', EfsFilesView);
  if (!customElements.get('efs-files-preview')) {
    customElements.define('efs-files-preview', EfsFilesPreview);
  }
}
