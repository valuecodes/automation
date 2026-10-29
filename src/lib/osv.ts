// The OpenSSF malicious-packages feed through osv.dev's batch query. Only
// `MAL-*` ids count here; GHSA ids are `pnpm audit`'s job.

import { Fail } from "./env.ts";
import { fetchJson } from "./http.ts";

type Query = {
  name: string;
  version: string;
};

type Pending = {
  index: number;
  pageToken?: string;
} & Query;

type BatchResult = {
  vulns?: { id: string }[];
  next_page_token?: string;
};

const MAL = /^MAL-[0-9]+-[0-9]+$/;

/**
 * The malicious-package ids of each query, by index. Batches of 1000, the
 * API's limit. A result that carries `next_page_token` is incomplete (also
 * after a 20 s server timeout), so those queries are re-sent with the token
 * until every result is final. Every batch must answer one result per query,
 * in order.
 */
const queryMalicious = async (
  queries: Query[],
): Promise<Map<number, Set<string>>> => {
  const hits = new Map<number, Set<string>>();
  let pending: Pending[] = queries.map((q, index) => ({ ...q, index }));
  for (let rounds = 0; pending.length > 0; rounds += 1) {
    if (rounds === 10) {
      throw new Fail("osv.dev kept paginating after 10 rounds; giving up.");
    }
    const next: Pending[] = [];
    for (let start = 0; start < pending.length; start += 1000) {
      const chunk = pending.slice(start, start + 1000);
      const body = {
        queries: chunk.map((q) => ({
          package: { name: q.name, ecosystem: "npm" },
          version: q.version,
          ...(q.pageToken === undefined ? {} : { page_token: q.pageToken }),
        })),
      };
      const response = await fetchJson<{ results?: BatchResult[] }>(
        "https://api.osv.dev/v1/querybatch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const results = response.results ?? [];
      if (results.length !== chunk.length) {
        throw new Fail(
          "osv.dev answered a batch with the wrong number of results.",
        );
      }
      chunk.forEach((q, i) => {
        const result = results[i] ?? {};
        for (const vuln of result.vulns ?? []) {
          if (MAL.test(vuln.id)) {
            const ids = hits.get(q.index) ?? new Set<string>();
            ids.add(vuln.id);
            hits.set(q.index, ids);
          }
        }
        if (
          result.next_page_token !== undefined &&
          result.next_page_token !== ""
        ) {
          next.push({ ...q, pageToken: result.next_page_token });
        }
      });
    }
    pending = next;
  }
  return hits;
};

export { queryMalicious };
