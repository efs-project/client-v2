// Registration module for the File Browser's elements. Imported by its entry only.
import { EfsFilesView } from './views.ts';

export function registerFilesElements(): void {
  if (!customElements.get('efs-files-view')) customElements.define('efs-files-view', EfsFilesView);
}
