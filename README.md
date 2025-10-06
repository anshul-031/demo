# AICallMetrics Demo Uploader

A minimal React (Vite + TypeScript) application demonstrating how to integrate with an existing **AICallMetrics** deployment for:

1. Email/password authentication (`/api/auth/login`) returning a bearer token
2. Multipart large file upload via `/api/upload-large` (start → get URLs → complete)
3. Automatic analysis trigger on completion (server) + client fallback /api/analyze
4. Optional Action Item Types: pass comma-separated action item types to influence extraction
5. Optional Parameter Analysis: enable and weight parameters to run parameter-based analysis

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
4. Optionally edit the "Action item types" field to pass labels like "Follow-up Call, Send Documentation, Schedule Demo".
5. Optionally enable/disable parameters and adjust weights under "Parameter Analysis".
6. Click "Upload & Analyze".
	- Server attempts auto-analysis inside `complete-upload`.
	- If `analysisStarted` is false, the demo POSTs `/api/analyze` with the new `upload.id`.
	- When no parameter analysis is requested (analysisType: "parameters" with empty customParameters), action item extraction is still triggered in the Analyze API; the demo forwards your selected action item types.
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
If auto-start fails, demo sends (parameter-based analysis):
```json
{
  "uploadIds": ["<upload-id>"],
  "analysisType": "parameters",
	"customParameters": [
		{ "id": "rapport", "name": "Rapport Building", "description": "...", "prompt": "...", "enabled": true, "weight": 10 },
		{ "id": "discovery", "name": "Needs Discovery", "description": "...", "prompt": "...", "enabled": true, "weight": 20 }
	],
	"selectedActionItemTypes": ["Follow-up Call", "Send Documentation", "Schedule Demo"]
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

## End-to-end upload with curl

Below is a copy-pastable sequence that mirrors the app’s 3-phase multipart upload plus a fallback analyze trigger.

Prereqs
- bash, curl, jq

Setup variables
```bash
# API base and credentials
BASE="https://www.aicallmetrics.com"   # or your own deployment
EMAIL="user@example.com"
PASSWORD="correct-horse-battery-staple"

# Local audio file (≤ 5 MB for this single-part example)
FILE="./sample.mp3"
FILENAME=$(basename "$FILE")
CONTENT_TYPE=$(file --mime-type -b "$FILE" 2>/dev/null || echo "audio/mpeg")
FILESIZE=$(stat -c%s "$FILE" 2>/dev/null || wc -c < "$FILE")

# Optional analysis inputs
ACTION_ITEM_TYPES='["Follow-up Call","Send Documentation","Schedule Demo"]'
CUSTOM_PARAMETERS='[
	{"id":"rapport","name":"Rapport Building","description":"Warmth, empathy, trust-building","prompt":"Evaluate rapport building and trust in the conversation. Note moments that increased or decreased rapport.","enabled":true,"weight":10},
	{"id":"discovery","name":"Needs Discovery","description":"Clarifying needs and pains","prompt":"Assess how well the rep discovered needs, pain points, and desired outcomes. Cite specific questions and responses.","enabled":true,"weight":20},
	{"id":"objections","name":"Objection Handling","description":"Handling concerns and blockers","prompt":"Evaluate how objections were identified and addressed. Include techniques used and customer reactions.","enabled":true,"weight":20},
	{"id":"value","name":"Value Articulation","description":"Explaining value and differentiation","prompt":"Assess clarity of value proposition and differentiation. Provide concrete statements that landed well or poorly.","enabled":true,"weight":20},
	{"id":"closing","name":"Closing Technique","description":"Advancing to next steps","prompt":"Evaluate closing attempts and next steps alignment. Identify any missed opportunities for commitment.","enabled":true,"weight":30}
]'
```

1) Login (get bearer token)
```bash
TOKEN=$(\
	curl -sS -X POST "$BASE/api/auth/login" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
	| jq -r '.token' \
)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "Login failed or token missing"; exit 1; fi
echo "Logged in. TOKEN length: ${#TOKEN}"
```

2) Start upload
```bash
START=$(curl -sS -X POST "$BASE/api/upload-large" \
	-H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' \
	-d "{\"action\":\"start-upload\",\"fileName\":\"$FILENAME\",\"contentType\":\"$CONTENT_TYPE\",\"fileSize\":$FILESIZE}")

echo "$START" | jq .
UPLOAD_ID=$(echo "$START" | jq -r '.uploadId')
KEY=$(echo "$START" | jq -r '.key')
[ -z "$UPLOAD_ID" -o -z "$KEY" -o "$UPLOAD_ID" = null -o "$KEY" = null ] && { echo "start-upload failed"; exit 1; }
```

3) Get presigned URLs (single 5MB part example)
```bash
PARTS=1  # for files ≤ 5MB. Increase appropriately for larger files.
URLS=$(curl -sS -X POST "$BASE/api/upload-large" \
	-H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' \
	-d "{\"action\":\"get-upload-urls\",\"key\":\"$KEY\",\"uploadId\":\"$UPLOAD_ID\",\"parts\":$PARTS}")

echo "$URLS" | jq .
PART1_URL=$(echo "$URLS" | jq -r '.urls[0]')
[ -z "$PART1_URL" -o "$PART1_URL" = null ] && { echo "No presigned URL"; exit 1; }
```

4) PUT the file to the presigned URL (capture ETag)
```bash
# Send file bytes directly to storage. Auth header is NOT needed (URL is already signed).
# We capture the ETag from the response headers for the complete step.
PART1_ETAG=$(\
	curl -sS -X PUT -T "$FILE" -D - "$PART1_URL" -o /dev/null \
	| tr -d '\r' | awk 'BEGIN{IGNORECASE=1}/^ETag:/{print $2}' \
)
echo "ETag: $PART1_ETAG"
[ -z "$PART1_ETAG" ] && echo "Warning: storage did not return ETag; server may accept a dummy value"
```

5) Complete upload
```bash
COMPLETE=$(curl -sS -X POST "$BASE/api/upload-large" \
	-H "Authorization: Bearer $TOKEN" \
	-H 'Content-Type: application/json' \
	-d "$(jq -nc \
		--arg key "$KEY" \
		--arg uploadId "$UPLOAD_ID" \
		--arg fileName "$FILENAME" \
		--arg contentType "$CONTENT_TYPE" \
		--argjson fileSize "$FILESIZE" \
		--arg part1Etag "${PART1_ETAG:-\"etag-fallback-1\"}" \
		--argjson customParameters "$CUSTOM_PARAMETERS" \
		--argjson selectedActionItemTypes "$ACTION_ITEM_TYPES" \
		'{action:"complete-upload", key:$key, uploadId:$uploadId, parts:[{ETag:$part1Etag, PartNumber:1}], fileName:$fileName, contentType:$contentType, fileSize:$fileSize, customParameters:$customParameters, selectedActionItemTypes:$selectedActionItemTypes, originalContentType:$contentType, audioCompressionUsed:false}'
	)")

echo "$COMPLETE" | jq .
SUCCESS=$(echo "$COMPLETE" | jq -r '.success')
ANALYSIS_STARTED=$(echo "$COMPLETE" | jq -r '.analysisStarted')
UPLOAD_RECORD_ID=$(echo "$COMPLETE" | jq -r '.upload.id // empty')

if [ "$SUCCESS" != "true" ]; then echo "complete-upload failed"; exit 1; fi
```

6) Optional: Fallback analyze trigger (only if server didn’t start automatically)
```bash
if [ "$ANALYSIS_STARTED" != "true" ] && [ -n "$UPLOAD_RECORD_ID" ]; then
	ANALYZE=$(curl -sS -X POST "$BASE/api/analyze" \
		-H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' \
		-d "{\"uploadIds\":[\"$UPLOAD_RECORD_ID\"],\"analysisType\":\"parameters\",\"customParameters\":$CUSTOM_PARAMETERS,\"selectedActionItemTypes\":$ACTION_ITEM_TYPES}")
	echo "$ANALYZE" | jq .
fi
```

Multi-part hint (files > 5MB)
- Split the file by 5MB chunks: `split -b 5m "$FILE" part_`
- Request presigned URLs with `parts=<number of chunks>` and PUT each part to its corresponding URL.
- Collect each response ETag as `ETag` with `PartNumber` starting at 1, then include all of them in the `parts` array for `complete-upload`.

Troubleshooting
- 403/AccessDenied on PUT: the presigned URL may have expired or the chunk size doesn’t match S3’s expected part size.
- 401 on API calls: refresh TOKEN via login; ensure Authorization header is present.
- CORS errors do not apply to curl; they only affect browsers.

## Postman collection (import + run)

This repo ships a ready-to-use collection and environment in `postman/`:

- `postman/AICallMetrics-Upload-Flow.postman_collection.json`
- `postman/AICallMetrics-Env.postman_environment.json`

Environment variables
- baseUrl: API base, e.g. https://www.aicallmetrics.com
- email, password: credentials for /api/auth/login
- token: set automatically by the Login request
- fileName, contentType, fileSize: metadata for start/complete steps
- parts: defaults to 1
- localFilePath: absolute path to a local audio file for the PUT request (used by newman; in the UI you can browse to a file)
- uploadId, key: set by Start Upload
- part1Url, part1Etag: set by Get URLs and PUT Part 1
- customParameters, selectedActionItemTypes: JSON strings used by complete/analyze

How to use in Postman UI
1) Import the environment and collection files from `postman/`.
2) Select the imported environment and fill in: baseUrl, email, password, fileName, contentType, fileSize.
3) Run requests in order:
	 - Auth/Login → sets {{token}}
	 - Upload/start-upload → sets {{uploadId}} and {{key}}
	 - Upload/get-upload-urls → sets {{part1Url}}
		- Upload/put-part-1 → Body type: File. Choose your local audio file. Tests capture ETag to {{part1Etag}}. If storage doesn’t return an ETag, keep the default fallback value.
	 - Upload/complete-upload → completes and may auto-start analysis
	 - Analyze/fallback-analyze → optional; run only if needed

Running with newman (CLI)
```bash
# Install once
npm i -g newman

# Set environment values dynamically (Linux/macOS example)
newman run postman/AICallMetrics-Upload-Flow.postman_collection.json \
	-e postman/AICallMetrics-Env.postman_environment.json \
	--env-var baseUrl="$BASE" \
	--env-var email="$EMAIL" \
	--env-var password="$PASSWORD" \
	--env-var fileName="$FILENAME" \
	--env-var contentType="$CONTENT_TYPE" \
	--env-var fileSize="$FILESIZE" \
	--env-var localFilePath="$FILE" \
	--reporters cli
```

Notes
- The collection defines Bearer auth at the collection level, using {{token}} from the Login response.
- The presigned PUT request intentionally uses “No Auth”.
- For multi-part, duplicate the PUT request as needed and wire up additional URL/ETag variables (part2Url/part2Etag, etc.) or script over the `urls` array in a custom runner.

Security notes
- Do not commit real credentials into the environment file. The provided env uses placeholders.
- Presigned URLs expire quickly; request fresh URLs if a PUT fails with 403.
