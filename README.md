# AICallMetrics Demo Uploader

A minimal React (Vite + TypeScript) application demonstrating how to integrate with an existing **AICallMetrics** deployment for:

1. Email/password authentication (`/api/auth/login`) returning a bearer token
2. Multipart large file upload via `/api/upload-large` (start → get URLs → complete)
3. Automatic analysis trigger on completion (server) + client fallback /api/analyze

## Features
- Domain input (change target environment at runtime)
- Credential-based login (stores HTTP-only auth cookie via `credentials: 'include'` AND captures bearer token from JSON response)
- Authorization header (`Authorization: Bearer <token>`) added to all authenticated API POSTs
- Single audio file selection & size/type validation (≤ 5 MB)
- Minimal 3-phase multipart workflow mirroring production app
- Automatic or fallback analysis trigger
- Progress indicator & status messaging
- No compression or extra metadata (kept intentionally lean)

## Running Locally
```bash
cd demo
npm install
npm run dev
```
Open: http://localhost:5173

## Usage
1. Enter the API base domain (default: https://www.aicallmetrics.com)
2. Log in using valid user credentials. The JSON response must include `token`.
3. Select an audio file (MP3, WAV, M4A, AAC, OGG, FLAC, WebM) ≤ 5MB.
4. Click "Upload & Analyze".
	- Server attempts auto-analysis inside `complete-upload`.
	- If `analysisStarted` is false, the demo POSTs `/api/analyze` with the new `upload.id`.
5. Status box reports whether fallback was used.

## CORS & Preflight Notes
To avoid: `Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header...` or redirect issues:

1. Ensure the backend exposes consistent CORS for all needed routes: `/api/auth/login`, `/api/upload-large`, `/api/analyze`.
2. Each route should:
	- Export `OPTIONS` handler returning `preflight(request)`
	- Wrap responses with `withCors(res, resolveOrigin(request))`
3. Set environment variable:
	```
	CORS_ALLOWED_ORIGINS=https://www.aicallmetrics.com,http://localhost:3000,http://localhost:5173
	```
4. Demo avoids explicit `Content-Type` for JSON bodies except fallback `/api/analyze` (where preflight is acceptable).
5. If you still see issues, check for unexpected 30x redirects from middleware or missing `Access-Control-Allow-Credentials`.

### Why Bearer Token?
Browsers may block third‑party cookies; adding `Authorization: Bearer <token>` ensures internal server-to-server calls (e.g. auto-analysis) receive auth context.

### Fallback Logic
If auto-start fails, demo sends:
```json
{
  "uploadIds": ["<upload-id>"],
  "analysisType": "parameters",
  "customParameters": [],
  "selectedActionItemTypes": []
}
```
Ensure your `/api/analyze` route supports CORS and bearer tokens.

## Adjusting for Non-Multipart Simplicity
If the backend exposes a simple `/api/upload` accepting `multipart/form-data`, you could instead:
```ts
const form = new FormData();
form.append('file', file);
fetch(`${domain}/api/upload`, { method: 'POST', body: form, credentials: 'include' });
```
But this demo mirrors the production multipart flow for realism.

## Extending
- Add action item parameter selection
- Poll for analysis status (slow interval ≥ 2 min)
- Display returned `analyses` ids for deep linking
- Add error banner for CORS diagnostics

## License
MIT
