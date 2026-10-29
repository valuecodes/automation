// Excerpts for the run summary. Defence in depth: the resolve step holds no
// secrets and pnpm prints its auth settings as `(protected)`, but URL
// credentials, `key=value` and JSON `"key": value` lines naming auth,
// password or token settings, and npm or GitHub token shapes are masked
// anyway. Every excerpt is capped and indented, so content cannot close
// the block it lands in.

const redactLine = (line: string): string =>
  line
    .replaceAll(/(:\/\/[^/@\s]*)@/g, "://***@")
    .replace(/^([^=]*(?:_auth|_password|[Tt]oken)[^=]*=).*/, "$1***")
    .replace(/^(\s*"[^"]*(?:_auth|_password|[Tt]oken)[^"]*":\s*).*/, '$1"***"')
    .replaceAll(
      /\b(?:npm_[A-Za-z0-9]{36}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
      "***",
    );

const redact = (text: string): string =>
  text.split("\n").map(redactLine).join("\n");

const CAP = 20_000;

/** A titled, capped, redacted and indented block of the summary. */
const excerpt = (title: string, text: string): string => {
  const capped = Buffer.from(text, "utf8").subarray(0, CAP).toString("utf8");
  const lines =
    capped === "" ? [] : redact(capped).replace(/\n$/, "").split("\n");
  return `\n**${title}**\n\n${lines.map((l) => `    ${l}\n`).join("")}\n`;
};

export { redact, excerpt };
