/**
 * Deadline scheduling (spec §4.1; M4.A26).
 *
 * Rules stay tick-based; only this adapter reads a wall clock. The caller
 * injects `now`, and the result is the next local `HH:MM` occurrence strictly
 * after `now + minTickGapMinutes`.
 */

export interface NextDeadlineInput {
  /** IANA timezone name, for example `Europe/London`. */
  timezone: string;
  /** Local wall-clock deadline in `HH:MM` (24-hour). */
  deadlineTime: string;
  /** Minimum gap after the resolution instant; defaults to 60 minutes. */
  minTickGapMinutes?: number;
  now: Date;
}

const MINUTE_MS = 60_000;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseDeadlineTime(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid deadline time: ${value}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

function localParts(formatter: Intl.DateTimeFormat, instant: Date): LocalParts {
  const parts = formatter.formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
  };
}

/** Offset of a timezone at an instant, in milliseconds (local - UTC). */
function offsetAt(formatter: Intl.DateTimeFormat, instantMs: number): number {
  const local = localParts(formatter, new Date(instantMs));
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - instantMs;
}

/** Convert a local wall-clock time to a UTC instant, twice for DST offsets. */
function instantForWallClock(
  formatter: Intl.DateTimeFormat,
  date: LocalParts,
  hour: number,
  minute: number,
): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let instant = naive - offsetAt(formatter, naive);
  instant = naive - offsetAt(formatter, instant);
  return instant;
}

export function nextDeadlineFor(input: NextDeadlineInput): string {
  const { hour, minute } = parseDeadlineTime(input.deadlineTime);
  const formatter = formatterFor(input.timezone);
  const gapMinutes = input.minTickGapMinutes ?? 60;
  if (!Number.isInteger(gapMinutes) || gapMinutes < 0) {
    throw new Error(`Invalid minimum tick gap: ${input.minTickGapMinutes}`);
  }
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Invalid clock instant");
  }

  const threshold = input.now.getTime() + gapMinutes * MINUTE_MS;
  const local = localParts(formatter, new Date(threshold));
  let candidate = instantForWallClock(formatter, local, hour, minute);
  if (candidate <= threshold) {
    const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day));
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const date = {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: 0,
      minute: 0,
    };
    candidate = instantForWallClock(formatter, date, hour, minute);
  }
  return new Date(candidate).toISOString();
}
