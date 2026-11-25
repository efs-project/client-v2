// The EFS Markdown subset (markdown.ts) rendered with Lit: every text value goes through Lit's
// escaping, no HTML string is ever built, so there is no new Trusted Types policy and no CSP
// change (docs/design/readme-markdown-options.md).
//
// - Headings start at `headingBase` (the pane's own heading is above them) and stop at h6.
// - Links are links only when `resolve` says so: https: (opened apart, rel="noopener
//   noreferrer") and EFS links (opened in the app). Anything else shows as its text.
// - A list item that is one paragraph renders inline (a tight list).

import { html, nothing } from '../../ui/element.ts';
import type { Block, Inline } from './markdown.ts';

export type MarkdownLink =
  | { readonly kind: 'external'; readonly href: string }
  /** An EFS link: `href` is its route in this realm; `open` follows it inside the app. */
  | { readonly kind: 'efs'; readonly href: string; open(): void };

export type LinkResolver = (href: string) => MarkdownLink | undefined;

function inline(nodes: readonly Inline[], resolve: LinkResolver): unknown[] {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text':
        return n.v;
      case 'em':
        return html`<em>${inline(n.c, resolve)}</em>`;
      case 'strong':
        return html`<strong>${inline(n.c, resolve)}</strong>`;
      case 'code':
        return html`<code>${n.v}</code>`;
      case 'br':
        return n.hard ? html`<br />` : ' ';
      case 'link': {
        const to = resolve(n.href);
        const label = inline(n.c, resolve);
        if (!to) return label;
        if (to.kind === 'external') {
          return html`<a href=${to.href} rel="noopener noreferrer" target="_blank">${label}</a>`;
        }
        return html`<a
          href=${to.href}
          @click=${(event: MouseEvent) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            to.open();
          }}
          >${label}</a
        >`;
      }
    }
    return nothing;
  });
}

function heading(level: number, content: unknown[]) {
  switch (Math.min(6, Math.max(3, level))) {
    case 3:
      return html`<h3>${content}</h3>`;
    case 4:
      return html`<h4>${content}</h4>`;
    case 5:
      return html`<h5>${content}</h5>`;
    default:
      return html`<h6>${content}</h6>`;
  }
}

export function renderMarkdown(
  blocks: readonly Block[],
  resolve: LinkResolver,
  headingBase = 3,
): unknown[] {
  const item = (b: readonly Block[]) => {
    const only = b.length === 1 ? b[0] : undefined;
    return html`<li>${only?.t === 'p' ? inline(only.c, resolve) : renderMarkdown(b, resolve, headingBase)}</li>`;
  };
  return blocks.map((b) => {
    switch (b.t) {
      case 'p':
        return html`<p>${inline(b.c, resolve)}</p>`;
      case 'h':
        return heading(b.level + headingBase - 1, inline(b.c, resolve));
      case 'code':
        return html`<pre class="efs-md-code"><code>${b.v}</code></pre>`;
      case 'quote':
        return html`<blockquote>${renderMarkdown(b.c, resolve, headingBase)}</blockquote>`;
      case 'ul':
        return html`<ul>${b.items.map(item)}</ul>`;
      case 'ol':
        return html`<ol start=${b.start === 1 ? nothing : b.start}>${b.items.map(item)}</ol>`;
      case 'hr':
        return html`<hr />`;
    }
    return nothing;
  });
}
