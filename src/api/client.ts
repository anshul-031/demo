export interface ApiClientOptions {
  baseUrl: string;
  token?: string | null;
  includeCredentials?: boolean;
}

export interface ApiError extends Error {
  status?: number;
  details?: any;
}

export class ApiClient {
  private baseUrl: string;
  private token?: string | null;
  private includeCredentials: boolean;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.includeCredentials = options.includeCredentials ?? true;
  }

  public setToken(token?: string | null) {
    this.token = token;
  }

  private buildHeaders(extra?: HeadersInit): HeadersInit | undefined {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    // We purposely avoid setting Content-Type for JSON bodies unless caller wants forced preflight
    return { ...headers, ...(extra || {}) };
  }

  public async postJson<TResponse = any>(path: string, body: any, opts?: { forceJsonContentType?: boolean }): Promise<TResponse> {
    const headers = this.buildHeaders(opts?.forceJsonContentType ? { 'Content-Type': 'application/json' } : undefined);

    // Route through vite dev proxy to bypass CORS in dev: /proxy?url=<encoded target>
    // In production builds, you can point baseUrl to a same-origin path or keep using proxy if served together.
    const targetUrl = `${this.baseUrl}${path}`;
    const proxyUrl = `/proxy?url=${encodeURIComponent(targetUrl)}`;

    const reqId = Math.random().toString(36).slice(2, 8);
    const started = Date.now();
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) {
      const lower = k.toLowerCase();
      safeHeaders[k] = ['authorization','cookie'].includes(lower) ? '<redacted>' : (v as any);
    }
    try {
      console.log(`[Api ${reqId}] POST ${targetUrl}`);
      console.log(`[Api ${reqId}] headers:`, safeHeaders);
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        // Keep credentials same-origin from Vite server POV
        credentials: 'include',
        redirect: 'manual',
      });

      let data: any = null;
      try { data = await res.json(); } catch (e) {
        console.warn(`[Api ${reqId}] Non-JSON response or parse error`);
      }

      const dur = Date.now() - started;
      console.log(`[Api ${reqId}] <- ${res.status} in ${dur}ms`);

      if (!res.ok || (data && data.success === false)) {
        const err: ApiError = new Error(data?.error || data?.message || `Request failed (${res.status})`);
        err.status = res.status;
        err.details = data;
        console.error(`[Api ${reqId}] ERROR:`, err.message, 'status=', res.status);
        throw err;
      }
      return data as TResponse;
    } catch (err: any) {
      console.error('[Api] Request error:', err?.message || err);
      if (err?.stack) console.debug(err.stack);
      throw err;
    }
  }
}

export const createApiClient = (baseUrl: string, token?: string | null) => new ApiClient({ baseUrl, token });
