// Storage is UTC everywhere in this app. This file is the only place
// that speaks Eastern, and it exists for one reason: "13:00Z" is not an
// answer to "what time is this going out?"
//
// No date library. Everything is built on Intl, which already knows when
// the US switches to daylight time — a fixed -5 or -4 would be wrong for
// several weeks a year, and wrong in the direction of posting an hour
// off.
export const EASTERN_ZONE = "America/New_York";

// How far ahead of UTC the zone is at a given instant, in milliseconds.
// Formats the instant in the zone, reads the wall clock back as if it
// were UTC, and diffs — the standard way to get an offset out of Intl
// without carrying a table of DST rules.
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // Some runtimes render midnight as hour 24 under hour12: false.
    read("hour") % 24,
    read("minute"),
    read("second"),
  );

  return asUtc - instant.getTime();
}

// "2026-09-06T08:00" typed into a datetime-local input, read as Eastern,
// returned as the UTC instant to store.
//
// The offset is applied twice on purpose. The first pass uses the offset
// at the guessed instant, which is the wrong one for the couple of hours
// around a DST change; the second pass re-reads it at the corrected
// instant and lands on the right one.
export function easternInputToUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);

  let instant = new Date(wallClock - zoneOffsetMs(new Date(wallClock)));
  instant = new Date(wallClock - zoneOffsetMs(instant));

  return Number.isNaN(instant.getTime()) ? null : instant;
}

// The inverse, for pre-filling the input from a stored timestamp.
export function utcToEasternInput(iso: string): string {
  const instant = new Date(iso);
  const local = new Date(instant.getTime() + zoneOffsetMs(instant));

  return local.toISOString().slice(0, 16);
}

// "Sat, Sep 6, 8:00 AM EDT" — the label on the card. EDT vs EST comes
// from Intl, so it is right on both sides of the switch.
export function formatEastern(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

// The same instant in UTC, shown next to it. Small, and the reason the
// Eastern line above can be trusted: the number the database actually
// holds is on screen rather than taken on faith.
export function formatUtc(iso: string): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

  return `${time} UTC`;
}
