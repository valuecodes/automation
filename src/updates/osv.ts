// "Check the new versions on osv.dev": the OpenSSF malicious-packages feed,
// for every npm version an update adds (the pnpm target, or each new locked
// version). A hit blocks the update and closes its open PR.

import { error } from "../lib/actions.ts";
import { byCodePoint } from "../lib/markdown.ts";
import { queryMalicious } from "../lib/osv.ts";
import { updateContext } from "./context.ts";
import { readQueries, readState, writeState } from "./outcome.ts";
import type { Query } from "./outcome.ts";

type Hit = Query & { id: string };

/** Up to five hits as `name@version (id)`, in a stable order. */
const hitSummary = (hits: Hit[]): string =>
  [...new Set(hits.map((h) => JSON.stringify(h)))]
    .sort(byCodePoint)
    .map((h) => JSON.parse(h) as Hit)
    .slice(0, 5)
    .map((h) => `${h.name}@${h.version} (${h.id})`)
    .join(", ");

const osv = async (): Promise<void> => {
  const ctx = updateContext();
  const queries = readQueries(ctx.out);
  if (queries.length === 0 || readState(ctx.out)?.state !== "update") {
    return;
  }
  const unique = [
    ...new Map(queries.map((q) => [JSON.stringify(q), q])).values(),
  ];
  const malicious = await queryMalicious(unique);
  const hits: Hit[] = [];
  for (const [index, ids] of malicious) {
    const q = unique[index];
    if (q === undefined) {
      continue;
    }
    for (const id of ids) {
      hits.push({ name: q.name, version: q.version, id });
    }
  }
  if (hits.length > 0) {
    const reason = `osv.dev lists malicious versions in this update: ${hitSummary(hits)}`;
    error(`${reason}.`);
    writeState(ctx.out, "blocked", reason);
  }
};

export { hitSummary, osv };
