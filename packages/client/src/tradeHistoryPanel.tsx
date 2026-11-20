/**
 * Public trade history panel (M6.14; spec §7).
 */

import type { ArchivedEvent } from "@bartervillage/rules";

import { Panel } from "./panel.js";
import { tradeHistoryFromEvents } from "./tradeHistory.js";

export interface TradeHistoryPanelProps {
  events?: readonly ArchivedEvent[];
}

export function TradeHistoryPanel({ events = [] }: TradeHistoryPanelProps) {
  const entries = tradeHistoryFromEvents(events);
  return (
    <Panel title="Trade history">
      {entries.length === 0 ? (
        <p class="empty-state">No trades yet. Settled offers appear here.</p>
      ) : (
        <ul class="trade-history">
          {entries.map((entry) => (
            <li key={entry.sequence} class={`trade-history-entry trade-history-${entry.type}`}>
              <span class="trade-history-tick">{`T${entry.tick}`}</span> {entry.summary}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
