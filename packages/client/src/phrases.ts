/**
 * Phrase book (spec §8; M6.13).
 *
 * Players communicate only through a fixed list of phrases defined in content
 * JSON. There is no free text: the UI can select a known phrase id but can
 * never compose new text, which keeps the feature moderation-free and easy to
 * localise.
 */

import { content } from "@bartervillage/content";
import type { PhraseDefinition } from "@bartervillage/rules";

export type { PhraseDefinition };

export const PHRASES: readonly PhraseDefinition[] = content.phrases;

const PHRASE_IDS: ReadonlySet<string> = new Set(PHRASES.map((phrase) => phrase.id));

/** True when `id` names a phrase defined by content; no arbitrary text passes. */
export function isKnownPhrase(id: string): boolean {
  return PHRASE_IDS.has(id);
}

/** Look up a phrase by id, returning undefined for anything not in content. */
export function phraseById(id: string): PhraseDefinition | undefined {
  return PHRASES.find((phrase) => phrase.id === id);
}
