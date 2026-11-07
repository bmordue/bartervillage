import { validateContent, type ContentPack } from "@bartervillage/rules";

import raw from "./content.json" with { type: "json" };

const result = validateContent(raw);

if (!result.ok) {
  throw new Error(`Invalid content pack:\n${result.errors.join("\n")}`);
}

export const content: ContentPack = result.content;
export const contentJson = raw;
