/**
 * Deterministic seeded PRNG shared by map generation and tick resolution
 * (spec §14.3). Implemented with xoshiro128** seeded through splitmix32 so the
 * stream is stable across platforms and Node versions.
 *
 * The rules package must never touch `Math.random`; every random decision comes
 * from an instance of this generator.
 */

export type SeedPart = string | number;
export type SeedInput = string | number | readonly SeedPart[];

function rotl32(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** FNV-1a over UTF-16 code units, folded to 32 bits. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Turn a seed tuple into an unambiguous string, then hash it. */
export function seedFromParts(parts: readonly SeedPart[]): number {
  const encoded = parts
    .map((part) => (typeof part === "number" ? `n:${part}` : `s:${part.length}:${part}`))
    .join("|");
  return hashSeed(encoded);
}

function normalizeSeed(input: SeedInput): number {
  if (typeof input === "number") {
    return input >>> 0;
  }
  if (typeof input === "string") {
    return hashSeed(input);
  }
  return seedFromParts(input);
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

const UINT32_RANGE = 0x1_0000_0000;

export class Rng {
  readonly #seedInput: SeedInput;
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;

  constructor(seedInput: SeedInput) {
    this.#seedInput = seedInput;
    const mix = splitmix32(normalizeSeed(seedInput));
    this.#s0 = mix();
    this.#s1 = mix();
    this.#s2 = mix();
    this.#s3 = mix();
    if ((this.#s0 | this.#s1 | this.#s2 | this.#s3) === 0) {
      this.#s0 = 0x9e3779b9;
    }
  }

  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number {
    const result = Math.imul(rotl32(Math.imul(this.#s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.#s1 << 9) >>> 0;
    this.#s2 = (this.#s2 ^ this.#s0) >>> 0;
    this.#s3 = (this.#s3 ^ this.#s1) >>> 0;
    this.#s1 = (this.#s1 ^ this.#s2) >>> 0;
    this.#s0 = (this.#s0 ^ this.#s3) >>> 0;
    this.#s2 = (this.#s2 ^ t) >>> 0;
    this.#s3 = rotl32(this.#s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /** Uniform integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new Error("Rng.int requires integer bounds");
    }
    if (maxExclusive <= minInclusive) {
      throw new Error("Rng.int requires maxExclusive > minInclusive");
    }
    const span = maxExclusive - minInclusive;
    // Rejection sampling keeps the distribution uniform for non-power-of-two spans.
    const limit = UINT32_RANGE - (UINT32_RANGE % span);
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return minInclusive + (value % span);
  }

  chance(probability: number): boolean {
    return this.nextFloat() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Rng.pick requires a non-empty array");
    }
    return items[this.int(0, items.length)] as T;
  }

  /** Fisher-Yates shuffle, returning a new array and leaving the input alone. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i + 1);
      const a = copy[i] as T;
      const b = copy[j] as T;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  }

  /** Derive an independent stream while consuming this one deterministically. */
  fork(label: string): Rng {
    return new Rng([this.#seedInput as SeedPart, "fork", label, this.nextUint32()]);
  }

  /** Expose the canonical seed parts so a fork can be recorded in a tick header. */
  get seedInput(): SeedInput {
    return this.#seedInput;
  }
}

export function createRng(seed: SeedInput): Rng {
  return new Rng(seed);
}
