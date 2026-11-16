/**
 * Shared titled panel used by the right-hand sidebar (M5.A01, M5.A03).
 */

import type { ComponentChildren } from "preact";

export interface PanelProps {
  title: string;
  children?: ComponentChildren;
}

/** A titled panel in the right-hand sidebar. */
export function Panel({ title, children }: PanelProps) {
  return (
    <section class="panel" aria-label={title}>
      <h2 class="panel-title">{title}</h2>
      <div class="panel-body">{children}</div>
    </section>
  );
}
