// Registration module: may only define efs-* elements. Imported by entries only.
import { EfsViewerFrame } from './viewer-frame.ts';

export function registerViewerFrame(): void {
  customElements.define('efs-viewer-frame', EfsViewerFrame);
}
