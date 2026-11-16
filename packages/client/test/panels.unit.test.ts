/**
 * Unit tests for the inventory panel detail (M5.B05).
 */

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { InventoryPanel } from "../src/panels.js";

describe("inventory panel (M5.B05)", () => {
  it("shows held, locked, free and capacity", () => {
    const html = render(
      InventoryPanel({
        items: [
          { item: "wheat", quantity: 10, locked: 3, free: 7 },
          { item: "wood", quantity: 4, locked: 0, free: 4 },
        ],
        storage: { capacity: 100, used: 14, free: 86 },
      }),
    );

    expect(html).toContain("14 / 100 capacity");
    expect(html).toContain("86 free");
    expect(html).toContain("Wheat");
    expect(html).toContain("Wood");
    expect(html).toContain("Total");
    expect(html).toContain("<td>14</td>");
    expect(html).toContain("<td>3</td>");
    expect(html).toContain("<td>11</td>");
  });

  it("shows capacity even before any goods are stored", () => {
    const html = render(
      InventoryPanel({ items: [], storage: { capacity: 100, used: 0, free: 100 } }),
    );

    expect(html).toContain("0 / 100 capacity");
    expect(html).toContain("No stored goods.");
  });

  it("omits the capacity bar without a storage summary", () => {
    const html = render(InventoryPanel({ items: [] }));

    expect(html).not.toContain("capacity");
  });
});
