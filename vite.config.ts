import react from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import { defineConfig } from 'vite';

// Simple dev-time proxy middleware to bypass CORS by forwarding requests
// from the Vite dev server to the target Next.js API. This keeps the browser
// request same-origin (http://localhost:5173), avoiding cross-origin CORS.
const proxyPlugin = (): PluginOption => ({
  name: 'dev-proxy-middleware',
  configureServer(server) {
    server.middlewares.use('/proxy', async (req, res) => {
      try {
        const url = new URL(req.url || '', 'http://localhost');
        const target = url.searchParams.get('url');
        const base = (req.headers['x-target-base'] as string | undefined)?.trim();

        // Correlation id for log lines of the same request
        const reqId = Math.random().toString(36).slice(2, 8);
        const started = Date.now();

        if (!target) {
          res.statusCode = 400;
          res.end('Missing url param');
          return;
        }
        if (!/^https?:\/\//i.test(target)) {
          res.statusCode = 400;
          res.end('Invalid target url');
          return;
        }
        if (base) {
          try {
            const targetUrl = new URL(target);
            const baseUrl = new URL(base);
            // Require same origin and path prefix safety
            const sameOrigin = targetUrl.origin === baseUrl.origin;
            if (!sameOrigin) {
              res.statusCode = 403;
              res.end('Target not allowed for provided X-Target-Base');
              return;
            }
          } catch {
            res.statusCode = 400;
            res.end('Invalid X-Target-Base');
            return;
          }
        }

        const method = (req.method || 'GET').toUpperCase();
        // Basic request log (avoid sensitive values)
        console.log(`[Proxy ${reqId}] ${method} -> ${target}`);
        if (base) console.log(`[Proxy ${reqId}] X-Target-Base: ${base}`);
        const clientIp = (req.socket as any)?.remoteAddress;
        console.log(`[Proxy ${reqId}] from ${clientIp || 'unknown'} (node ${process.version})`);

        const hopByHop = new Set([
          'host','connection','keep-alive','proxy-authenticate','proxy-authorization',
          'te','trailer','transfer-encoding','upgrade','accept-encoding','origin','referer'
        ]);

        const fwdHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (!v) continue;
          const key = k.toLowerCase();
          if (hopByHop.has(key)) continue;
          // Node may provide header values as string|string[]
          fwdHeaders[key] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        // Request identity encoding from upstream to avoid compressed response handling
        fwdHeaders['accept-encoding'] = 'identity';

        // read body if present
        let body: Buffer | undefined;
        if (!['GET','HEAD'].includes(method)) {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            req.on('end', () => resolve());
            req.on('error', reject);
          });
          body = chunks.length ? Buffer.concat(chunks) : undefined;
          if (body) {
            fwdHeaders['content-length'] = String(body.length);
          }
        }

        // For logs, redact sensitive headers and avoid printing body content
        const redactedHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(fwdHeaders)) {
          const lower = k.toLowerCase();
          if (['authorization','cookie','set-cookie'].includes(lower)) {
            redactedHeaders[k] = '<redacted>';
          } else {
            redactedHeaders[k] = v;
          }
        }
        const targetPath = (() => { try { return new URL(target).pathname; } catch { return ''; } })();
        const isLoginPath = /\/api\/auth\/login\b/.test(targetPath);
        console.log(`[Proxy ${reqId}] outbound headers:`, redactedHeaders);
        if (body) console.log(`[Proxy ${reqId}] outbound body bytes: ${body.length}${isLoginPath ? ' (login body not logged)' : ''}`);

        // Follow redirects manually to avoid undici body reuse issues and to log the chain
        let currentUrl = target;
        let currentMethod = method;
        let currentHeaders: Record<string, string> = { ...fwdHeaders };
        let currentBody: Buffer | undefined = body;
        let response: Response | null = null;
        const maxRedirects = 5;
        for (let i = 0; i <= maxRedirects; i++) {
          response = await fetch(currentUrl, {
            method: currentMethod,
            headers: currentHeaders,
            body: currentBody as any,
            redirect: 'manual',
          });

          const status = response.status;
          const location = response.headers.get('location');
          if (status >= 300 && status < 400 && location) {
            console.warn(`[Proxy ${reqId}] <- ${status} redirect to: ${location}`);
            // Resolve relative redirects
            const nextUrl = new URL(location, currentUrl).toString();
            // Per RFC: 301/302/303 switch to GET (drop body); 307/308 preserve
            if (status === 301 || status === 302 || status === 303) {
              currentMethod = 'GET';
              currentBody = undefined;
              delete currentHeaders['content-length'];
              // Often content-type can be removed when body is dropped
              if (currentHeaders['content-type']) delete currentHeaders['content-type'];
            }
            currentUrl = nextUrl;
            if (i === maxRedirects) {
              console.error(`[Proxy ${reqId}] Too many redirects`);
              break;
            }
            // Continue to follow
            continue;
          }
          // Not a redirect, break to process response
          break;
        }

        if (!response) throw new Error('No response from upstream');

        // Copy status and headers back
        res.statusCode = response.status;
        // Avoid passing through content-encoding/length that may not match decoded body
        response.headers.forEach((value, key) => {
          const lower = key.toLowerCase();
          if (['transfer-encoding','content-encoding','content-length'].includes(lower)) return;
          res.setHeader(key, value);
        });

        // Response logging (avoid large dumps)
        const respContentType = response.headers.get('content-type') || 'unknown';
        const hasSetCookie = response.headers.has('set-cookie');
        if (response.status === 204 || response.status === 304) {
          console.log(`[Proxy ${reqId}] <- ${response.status} ${response.statusText} (no body)`);
          res.end();
        } else {
          const ab = await response.arrayBuffer();
          const buf = Buffer.from(ab);
          res.setHeader('Content-Length', String(buf.length));
          console.log(`[Proxy ${reqId}] <- ${response.status} ${response.statusText} (${buf.length} bytes, ${respContentType}, set-cookie=${hasSetCookie})`);
          res.end(buf);
        }

        const dur = Date.now() - started;
        console.log(`[Proxy ${reqId}] completed in ${dur}ms`);
      } catch (err: any) {
        // Log error details with cause chain (undici often nests cause)
        const cause = err?.cause;
        console.error('[Proxy] Error:', err?.message || err);
        if (cause) {
          console.error('[Proxy] Cause:', cause?.message || cause);
        }
        if (err?.stack) console.error(err.stack);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(`Proxy error: ${err?.message || 'unknown'}`);
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), proxyPlugin()],
});
