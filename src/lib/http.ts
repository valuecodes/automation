// `fetch` with the retries curl had (`--retry 3`): a network error or a 5xx
// or 429 answer is tried again with a short backoff, anything else is final.

class HttpError extends Error {
  status: number;
  body: string;
  constructor(url: string, status: number, body: string) {
    super(`${url} answered HTTP ${status}.`);
    this.status = status;
    this.body = body;
  }
}

const delays = [1000, 2000, 4000];

const request = async (
  url: string,
  init: RequestInit = {},
  retries = 3,
): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      await sleep(delays[attempt] ?? 4000);
      continue;
    }
    if (response.ok) {
      return response;
    }
    const body = await response.text();
    if (attempt >= retries || !retriable(response.status)) {
      throw new HttpError(url, response.status, body);
    }
    await sleep(delays[attempt] ?? 4000);
  }
};

const retriable = (status: number): boolean => status === 429 || status >= 500;

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await request(url, init);
  return (await response.json()) as T;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export { HttpError, request, fetchJson };
