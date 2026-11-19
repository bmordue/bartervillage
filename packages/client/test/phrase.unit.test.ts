/**
 * Phrase book panel tests (spec §8; M6.13).
 *
 * The phrase book is fixed in content JSON; the panel renders every phrase
 * with its id and text and never offers free text, so the UI cannot invent
 * new phrases.
 */

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { PhrasePanel } from "../src/panels.js";
import { content } from "@bartervillage/content";

describe("phrase book panel (M6.13)", () => {
  it("renders every phrase from content with id and text", () => {
    const html = render(PhrasePanel({}));

    for (const phrase of content.phrases) {
      expect(html).toContain(phrase.id);
      expect(html).toContain(phrase.text);
    }
  });

  it("shows an empty state when no phrases are configured", () => {
    const original = content.phrases;
    (content as { phrases: typeof original }).phrases = [];
    try {
      const html = render(PhrasePanel({}));
      expect(html).toContain("No phrases configured.");
    } finally {
      (content as { phrases: typeof original }).phrases = original;
    }
  });

  it("never renders a text input or textarea for composing phrases", () => {
    const html = render(PhrasePanel({}));
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain("<textarea");
  });
});
