// The day boundary is UTC, not the user's local time. This is a deliberate
// choice for Day 4 simplicity — Day 12 billing may revisit it.
export function startOfCurrentUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}
