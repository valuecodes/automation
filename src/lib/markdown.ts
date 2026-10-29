// Text helpers for the issue body. Anything from a registry, a lockfile or a
// repo file goes through `esc` before it lands in a table cell.

/** Escapes the pipe, the one character that breaks a table cell. */
const esc = (value: unknown): string => String(value).replaceAll("|", "\\|");

const plural = (count: number, noun: string): string =>
  count === 1 ? `${count} ${noun}` : `${count} ${noun}s`;

/** Compares strings by code point, like jq's `sort` and `sort -u`. */
const byCodePoint = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

export { esc, plural, byCodePoint };
