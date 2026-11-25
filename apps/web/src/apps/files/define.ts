// Registration module for the File Browser's elements. Imported by its entry only.
import { EfsFileEditor } from './editor.ts';
import { EfsFolderPicker } from './folder-picker.ts';
import { EfsFolderSave } from './folder-save.ts';
import { EfsFilesListing } from './listing.ts';
import { EfsFilesOverview } from './overview.ts';
import { EfsFilesPreview } from './preview.ts';
import { EfsFilesRemoved } from './removed-list.ts';
import { EfsTagPicker } from './tag-picker.ts';
import { EfsFilesTopic } from './topic.ts';
import { EfsFilesTree } from './tree.ts';
import { EfsFilesView } from './views.ts';
import { EfsFilesWord } from './word.ts';

export function registerFilesElements(): void {
  if (!customElements.get('efs-files-view')) customElements.define('efs-files-view', EfsFilesView);
  if (!customElements.get('efs-file-editor'))
    customElements.define('efs-file-editor', EfsFileEditor);
  if (!customElements.get('efs-files-folder-picker')) {
    customElements.define('efs-files-folder-picker', EfsFolderPicker);
  }
  if (!customElements.get('efs-files-folder-save')) {
    customElements.define('efs-files-folder-save', EfsFolderSave);
  }
  if (!customElements.get('efs-files-listing')) {
    customElements.define('efs-files-listing', EfsFilesListing);
  }
  if (!customElements.get('efs-files-preview')) {
    customElements.define('efs-files-preview', EfsFilesPreview);
  }
  if (!customElements.get('efs-files-overview')) {
    customElements.define('efs-files-overview', EfsFilesOverview);
  }
  if (!customElements.get('efs-files-tree')) {
    customElements.define('efs-files-tree', EfsFilesTree);
  }
  if (!customElements.get('efs-files-removed')) {
    customElements.define('efs-files-removed', EfsFilesRemoved);
  }
  if (!customElements.get('efs-files-tag-picker')) {
    customElements.define('efs-files-tag-picker', EfsTagPicker);
  }
  if (!customElements.get('efs-files-topic')) {
    customElements.define('efs-files-topic', EfsFilesTopic);
  }
  if (!customElements.get('efs-files-word')) {
    customElements.define('efs-files-word', EfsFilesWord);
  }
}
