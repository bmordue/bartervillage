/**
 * Injectable clock (spec §14, M1.12).
 *
 * The rules engine uses time only to schedule the next deadline. All gameplay
 * decisions are tick-based. `SystemClock` is the single ambient-time adapter
 * and is meant to be injected at the process edge; `FixedClock` makes golden
 * tests reproducible.
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  #millis: number;

  constructor(instant: string | number | Date) {
    this.#millis =
      instant instanceof Date
        ? instant.getTime()
        : typeof instant === "number"
          ? instant
          : Date.parse(instant);
    if (!Number.isFinite(this.#millis)) {
      throw new Error(`Invalid fixed clock instant: ${String(instant)}`);
    }
  }

  now(): Date {
    return new Date(this.#millis);
  }

  set(instant: string | number | Date): void {
    this.#millis =
      instant instanceof Date
        ? instant.getTime()
        : typeof instant === "number"
          ? instant
          : Date.parse(instant);
  }

  advance(milliseconds: number): void {
    this.#millis += milliseconds;
  }
}
