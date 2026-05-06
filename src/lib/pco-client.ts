import "server-only";

// PCO rate limit (per docs): 100 requests per 20 seconds per app.
// We track the response headers to know when to back off proactively, and
// we honor 429 + Retry-After defensively.
//
//   X-PCO-API-Request-Rate-Limit   max requests in the window (e.g. 100)
//   X-PCO-API-Request-Rate-Period  window in seconds (e.g. 20)
//   X-PCO-API-Request-Rate-Count   our count so far in the window

const PCO_BASE = "https://api.planningcenteronline.com";

export interface PCOResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] | null }>;
}

export interface PCOResponse<T = PCOResource> {
  data: T | T[];
  included?: PCOResource[];
  meta?: {
    total_count?: number;
    count?: number;
    next?: { offset?: number };
    prev?: { offset?: number };
  };
  links?: {
    next?: string;
    prev?: string;
    self?: string;
  };
}

export interface PCOClientOptions {
  appId: string;
  secret: string;
  /** Per-call hard timeout (ms). */
  timeoutMs?: number;
  /** Max retries on 429/5xx. */
  maxRetries?: number;
  /** When count >= limit - safetyBuffer, sleep until next window. */
  safetyBuffer?: number;
}

export class PCOClient {
  private auth: string;
  private timeoutMs: number;
  private maxRetries: number;
  private safetyBuffer: number;
  private windowStart: number = Date.now();
  private windowSeen = 0;
  private windowLimit = 100;
  private windowPeriodMs = 20_000;

  constructor(opts: PCOClientOptions) {
    this.auth = "Basic " + Buffer.from(`${opts.appId}:${opts.secret}`).toString("base64");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.safetyBuffer = opts.safetyBuffer ?? 5;
  }

  /** GET a JSON:API endpoint with pagination + rate limiting. */
  async get<T = PCOResource>(path: string): Promise<PCOResponse<T>> {
    const url = path.startsWith("http") ? path : `${PCO_BASE}${path}`;
    return this.fetchJson<PCOResponse<T>>(url);
  }

  /** Fetch every page of a paginated endpoint. Iterates `links.next`. */
  async *paginate<T = PCOResource>(
    path: string,
  ): AsyncGenerator<{ page: PCOResponse<T>; pageNum: number }> {
    let next: string | null = path;
    let pageNum = 0;
    while (next) {
      pageNum++;
      const page: PCOResponse<T> = await this.get<T>(next);
      yield { page, pageNum };
      next = page.links?.next ?? null;
    }
  }

  /** Convenience: collect every record from a paginated endpoint into one array. */
  async getAll<T = PCOResource>(path: string): Promise<{
    data: T[];
    included: PCOResource[];
  }> {
    const data: T[] = [];
    const included: PCOResource[] = [];
    for await (const { page } of this.paginate<T>(path)) {
      const pageData = Array.isArray(page.data) ? page.data : [page.data];
      data.push(...pageData);
      if (page.included) included.push(...page.included);
    }
    return { data, included };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async fetchJson<T>(url: string, attempt = 0): Promise<T> {
    await this.waitIfNearLimit();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: this.auth,
          Accept: "application/json",
          "User-Agent": "Shepherding/0.1 (church-management)",
        },
        cache: "no-store",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    this.recordRateHeaders(res.headers);

    if (res.status === 429) {
      if (attempt >= this.maxRetries) {
        throw new PCOError(`PCO rate-limited after ${attempt} retries.`, 429, url);
      }
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After")) ?? 20;
      await sleep(retryAfter * 1000);
      return this.fetchJson<T>(url, attempt + 1);
    }

    if (res.status >= 500 && attempt < this.maxRetries) {
      await sleep(1000 * Math.pow(2, attempt));
      return this.fetchJson<T>(url, attempt + 1);
    }

    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      throw new PCOError(
        `PCO ${res.status} ${res.statusText}: ${body.slice(0, 240)}`,
        res.status,
        url,
      );
    }

    return (await res.json()) as T;
  }

  private recordRateHeaders(h: Headers) {
    const limit = parseInt(h.get("X-PCO-API-Request-Rate-Limit") ?? "", 10);
    const period = parseInt(h.get("X-PCO-API-Request-Rate-Period") ?? "", 10);
    const count = parseInt(h.get("X-PCO-API-Request-Rate-Count") ?? "", 10);

    const now = Date.now();
    if (Number.isFinite(limit) && limit > 0) this.windowLimit = limit;
    if (Number.isFinite(period) && period > 0) this.windowPeriodMs = period * 1000;

    if (Number.isFinite(count)) {
      // PCO tells us where we are in the current window — trust it.
      this.windowSeen = count;
      // Reset window-start if PCO's count went backwards (window rolled).
      if (count <= 1) this.windowStart = now;
    } else {
      this.windowSeen += 1;
    }
  }

  private async waitIfNearLimit() {
    const now = Date.now();
    const elapsed = now - this.windowStart;
    if (elapsed > this.windowPeriodMs) {
      // Window has rolled; assume we're fresh.
      this.windowStart = now;
      this.windowSeen = 0;
      return;
    }
    if (this.windowSeen >= this.windowLimit - this.safetyBuffer) {
      const waitMs = this.windowPeriodMs - elapsed + 250;
      await sleep(waitMs);
      this.windowStart = Date.now();
      this.windowSeen = 0;
    }
  }
}

export class PCOError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
  ) {
    super(message);
    this.name = "PCOError";
  }
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  if (Number.isFinite(n)) return n;
  // Could be HTTP-date; just default
  return null;
}
