import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "./http.ts";
import { versionExists } from "./npm.ts";

const answer =
  (status: number, body: unknown) =>
  (url: string): Promise<Response> =>
    status === 200
      ? Promise.resolve(new Response(JSON.stringify(body), { status }))
      : Promise.reject(new HttpError(url, status, ""));

test("versionExists asks the version endpoint and trusts only a matching answer", async () => {
  let asked = "";
  const get = (url: string): Promise<Response> => {
    asked = url;
    return answer(200, { name: "@types/node", version: "26.6.5" })(url);
  };
  assert.equal(await versionExists("@types/node", "26.6.5", get), true);
  assert.equal(asked, "https://registry.npmjs.org/@types%2Fnode/26.6.5");
  assert.equal(
    await versionExists(
      "@types/node",
      "26.14.13",
      answer(200, { version: "26.6.6" }),
    ),
    false,
  );
  assert.equal(
    await versionExists("@types/node", "26.14.13", answer(404, null)),
    false,
  );
  await assert.rejects(
    versionExists("@types/node", "26.6.5", answer(503, null)),
    /HTTP 503/,
  );
});
