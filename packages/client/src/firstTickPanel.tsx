/**
 * Guided first-tick panel (M8.11; spec §11).
 */

import { useState } from "preact/hooks";

import { firstTickGuide, type FirstTickStepId } from "./firstTickGuide.js";
import { Panel } from "./panel.js";

export interface FirstTickPanelProps {
  currentTick: number | undefined;
  hasPlot: boolean;
  orderCount: number;
  ready: boolean;
  replayTick: number | undefined;
}

const HINTS: Record<FirstTickStepId, string> = {
  plot: "Open your plot to see crops, storage and energy.",
  orders: "Add at least one order so the tick has something to resolve.",
  ready: "Ready locks your queue for the coming tick.",
  replay: "When the tick resolves, press Play in the Replay panel.",
};

export function FirstTickPanel(props: FirstTickPanelProps) {
  const [dismissed, setDismissed] = useState(false);
  const guide = firstTickGuide(props);
  if (dismissed || !guide.visible) {
    return null;
  }
  return (
    <Panel title="Your first tick">
      <p class="first-tick-intro">Three quick steps, then watch the replay.</p>
      <ol class="first-tick-steps">
        {guide.steps.map((step) => (
          <li class={step.done ? "first-tick-step first-tick-step-done" : "first-tick-step"}>
            <span class="first-tick-check" aria-hidden="true">
              {step.done ? "✓" : "○"}
            </span>{" "}
            {step.label}
          </li>
        ))}
      </ol>
      {guide.next ? (
        <p class="first-tick-hint">{HINTS[guide.next.id]}</p>
      ) : (
        <p class="first-tick-hint">First tick complete. The next replay is yours to explore.</p>
      )}
      <button type="button" class="first-tick-dismiss" onClick={() => setDismissed(true)}>
        Dismiss guide
      </button>
    </Panel>
  );
}
