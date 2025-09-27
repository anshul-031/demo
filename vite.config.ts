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
        console.log(`[Proxy] ${method} -> ${target}`);
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

        const upstream = await fetch(target, {
          method,
          headers: fwdHeaders,
          body: body as any,
        });

        // Copy status and headers back
        res.statusCode = upstream.status;
        // Avoid passing through content-encoding/length that may not match decoded body
        upstream.headers.forEach((value, key) => {
          const lower = key.toLowerCase();
          if (['transfer-encoding','content-encoding','content-length'].includes(lower)) return;
          res.setHeader(key, value);
        });

        const ab = await upstream.arrayBuffer();
        const buf = Buffer.from(ab);
        res.setHeader('Content-Length', String(buf.length));
        console.log(`[Proxy] <- ${upstream.status} ${upstream.statusText} (${buf.length} bytes)`);
        res.end(buf);
      } catch (err: any) {
        console.error('[Proxy] Error:', err);
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
