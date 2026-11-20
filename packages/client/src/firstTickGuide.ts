/**
 * Guided first tick (M8.11; spec §11).
 *
 * A short, dismissible checklist for players who have not yet completed a tick.
 * It points at the three actions that make the first replay meaningful.
 */

export type FirstTickStepId = "plot" | "orders" | "ready" | "replay";

export interface FirstTickStep {
  id: FirstTickStepId;
  label: string;
  done: boolean;
}

export interface FirstTickGuideState {
  visible: boolean;
  steps: FirstTickStep[];
  next: FirstTickStep | null;
  complete: boolean;
}

export interface FirstTickGuideInput {
  currentTick: number | undefined;
  hasPlot: boolean;
  orderCount: number;
  ready: boolean;
  replayTick: number | undefined;
}

export function firstTickGuide(input: FirstTickGuideInput): FirstTickGuideState {
  const steps: FirstTickStep[] = [
    { id: "plot", label: "Review your plot", done: input.hasPlot },
    { id: "orders", label: "Queue your first orders", done: input.orderCount > 0 },
    { id: "ready", label: "Mark yourself ready", done: input.ready },
    { id: "replay", label: "Watch the first replay", done: input.replayTick !== undefined },
  ];
  const complete = steps.every((step) => step.done);
  const visible =
    input.currentTick !== undefined &&
    input.currentTick <= 1 &&
    (input.currentTick === 1 || !complete);
  return {
    visible,
    steps,
    next: steps.find((step) => !step.done) ?? null,
    complete,
  };
}
