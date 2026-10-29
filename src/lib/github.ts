// The GitHub REST API with the job's `GH_TOKEN`, replacing `gh api`. Every
// call is a plain request with a JSON answer, or none for a 204.

import { env } from "./env.ts";
import { HttpError, request } from "./http.ts";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type Api = <T>(method: Method, path: string, body?: unknown) => Promise<T>;

/** Calls `path` under the API root; a 404 throws an `HttpError` to inspect. */
const api: Api = async <T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> => {
  const root = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const init: RequestInit = {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env("GH_TOKEN")}`,
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  // Like `gh api`, a 4xx is final. Only reads are retried: a create whose
  // answer was lost would otherwise be sent again and make a second issue.
  const response = await request(
    `${root}/${path}`,
    init,
    method === "GET" ? 3 : 0,
  );
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const isNotFound = (cause: unknown): boolean =>
  cause instanceof HttpError && cause.status === 404;

type Contents = {
  content?: string;
  encoding?: string;
};

/** The bytes of `path` at `ref` in `repo`, or null when it is not there. */
const repoFile = async (
  repo: string,
  path: string,
  ref: string,
): Promise<Buffer | null> => {
  let contents: Contents;
  try {
    contents = await api<Contents>(
      "GET",
      `repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    );
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
  if (contents.encoding !== "base64" || contents.content === undefined) {
    throw new Error(`${path} came back without base64 content.`);
  }
  return Buffer.from(contents.content, "base64");
};

const encodePath = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

export { api, repoFile };
export type { Api };
