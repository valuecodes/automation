import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "./http.ts";
import { resolvable } from "./npm.ts";

const answer =
  (status: number, body: unknown) =>
  (url: string): Promise<Response> =>
    status === 200
      ? Promise.resolve(new Response(JSON.stringify(body), { status }))
      : Promise.reject(new HttpError(url, status, ""));

test("resolvable asks for the abbreviated packument and looks the version up", async () => {
  let asked = "";
  let accept = "";
  const get = (url: string, init?: RequestInit): Promise<Response> => {
    asked = url;
    accept = new Headers(init?.headers).get("accept") ?? "";
    return answer(200, { versions: { "26.6.5": {}, "26.6.6": {} } })(url);
  };
  assert.equal(await resolvable("@types/node", "26.6.5", get), true);
  assert.equal(asked, "https://registry.npmjs.org/@types%2Fnode");
  assert.equal(accept, "application/vnd.npm.install-v1+json");
  assert.equal(await resolvable("@types/node", "26.14.13", get), false);
  assert.equal(
    await resolvable("@types/node", "26.6.5", answer(200, {})),
    false,
  );
  await assert.rejects(
    resolvable("@types/node", "26.6.5", answer(503, null)),
    /HTTP 503/,
  );
});
