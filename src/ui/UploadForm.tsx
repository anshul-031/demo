import React, { useCallback, useMemo, useState } from 'react';

interface UploadFormProps {
  domain: string;
  token: string | null;
  onComplete: (message: string) => void;
}

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED = ['audio/mpeg','audio/wav','audio/x-wav','audio/wave','audio/x-pn-wav','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/flac','audio/webm'];

export const UploadForm: React.FC<UploadFormProps> = ({ domain, token, onComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // util: add a log line (console + on-screen), keep last ~300 lines to avoid memory bloat
  const pushLog = useCallback((...parts: Array<unknown>) => {
    const ts = new Date().toISOString();
    const line = ["[UI][Upload]", ts, ...parts]
      .map((p) => {
        try {
          if (typeof p === 'string') return p;
          if (p instanceof Error) return `${p.name}: ${p.message}`;
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .join(' ');
    // eslint-disable-next-line no-console
    console.log(line);
    setLogs((prev) => {
      const next = [...prev, line];
      if (next.length > 300) next.splice(0, next.length - 300);
      return next;
    });
  }, []);

  const maskHeaders = useCallback((h?: Record<string, string>) => {
    if (!h) return {} as Record<string, string>;
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      if (/^authorization$/i.test(k)) masked[k] = 'Bearer ****';
      else masked[k] = v;
    }
    return masked;
  }, []);

  const truncate = useCallback((s: string, n = 1000) => (s.length > n ? `${s.slice(0, n)}…(+${s.length - n})` : s), []);
  const maskUrl = useCallback((u: string) => {
    try {
      const url = new URL(u);
      // avoid leaking presigned query; keep host + path only
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return u;
    }
  }, []);

  const validateFile = (f: File): string | null => {
    if (f.size > MAX_SIZE) return 'File exceeds 5MB limit';
    if (!ACCEPTED.includes(f.type)) return 'Unsupported file type';
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      const err = validateFile(f);
      if (err) { setError(err); setFile(null); return; }
      setError(null);
      setFile(f);
    }
  };

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token]);

  const startSimpleMultipart = async (f: File) => {
    // We replicate only the 3-phase sequence required by /api/upload-large with minimal metadata
    const base = domain.replace(/\/$/, '');
    pushLog('Begin upload', { name: f.name, size: f.size, type: f.type }, { base });
    // 1. start-upload
    const startUrl = `/proxy?url=${encodeURIComponent(`${base}/api/upload-large`)}.`.replace(/\.$/, '');
    pushLog('→ POST start-upload', { url: startUrl, headers: maskHeaders(authHeaders) });
    const startRes = await fetch(startUrl, {
      method: 'POST',
      // Avoid explicit JSON Content-Type to minimize preflight scenarios
      credentials: 'include',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'start-upload',
        fileName: f.name,
        contentType: f.type || 'application/octet-stream',
        fileSize: f.size,
      })
    });
    const startText = await startRes.clone().text();
    pushLog('← start-upload response', {
      status: startRes.status,
      ok: startRes.ok,
      'content-type': startRes.headers.get('content-type'),
      'content-encoding': startRes.headers.get('content-encoding'),
      body: truncate(startText)
    });
    let startData: any;
    try { startData = JSON.parse(startText); } catch { startData = { raw: startText }; }
    if (!startRes.ok || !startData.success) throw new Error(startData.error || 'Failed to start upload');
    const { uploadId, key } = startData;
    pushLog('start-upload ok', { uploadId, key: typeof key === 'string' ? key : 'unknown' });

    // 2. get-upload-urls (will likely return one or more URLs). We'll chunk in same size used server default (5MB) or smaller for safety.
    const CHUNK_SIZE = 5 * 1024 * 1024; // Use full file if <= 5MB
    const parts = Math.ceil(f.size / CHUNK_SIZE);

    const urlsUrl = `/proxy?url=${encodeURIComponent(`${base}/api/upload-large`)}.`.replace(/\.$/, '');
    pushLog('→ POST get-upload-urls', { url: urlsUrl, parts, headers: maskHeaders(authHeaders) });
    const urlsRes = await fetch(urlsUrl, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders,
      body: JSON.stringify({ action: 'get-upload-urls', key, uploadId, parts })
    });
    const urlsText = await urlsRes.clone().text();
    pushLog('← get-upload-urls response', {
      status: urlsRes.status,
      ok: urlsRes.ok,
      'content-type': urlsRes.headers.get('content-type'),
      'content-encoding': urlsRes.headers.get('content-encoding'),
      body: truncate(urlsText)
    });
    let urlsData: any;
    try { urlsData = JSON.parse(urlsText); } catch { urlsData = { raw: urlsText }; }
    if (!urlsRes.ok || !urlsData.success) throw new Error('Failed to get upload URLs');

    const fileBuffer = new Uint8Array(await f.arrayBuffer());
    const uploadedParts: { ETag: string; PartNumber: number }[] = [];

    for (let i = 0; i < parts; i++) {
      const chunk = fileBuffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const partUrl = String(urlsData.urls[i]);
      pushLog(`→ PUT part ${i + 1}/${parts}`, { to: maskUrl(partUrl), bytes: chunk.byteLength });
      const putRes = await fetch(partUrl, { method: 'PUT', body: chunk });
      pushLog(`← PUT part ${i + 1} response`, { status: putRes.status, ok: putRes.ok, etag: putRes.headers.get('ETag') });
      if (!putRes.ok) throw new Error(`Chunk ${i + 1} failed`);
      const etag = putRes.headers.get('ETag') || `"etag-${i+1}-${Date.now()}"`;
      uploadedParts.push({ ETag: etag, PartNumber: i + 1 });
      setProgress(Math.round(((i + 1) / parts) * 80)); // 80% after upload parts
    }

    // 3. complete-upload (minimal metadata, skip custom params)
    const completeUrl = `/proxy?url=${encodeURIComponent(`${base}/api/upload-large`)}.`.replace(/\.$/, '');
    pushLog('→ POST complete-upload', { url: completeUrl, parts: uploadedParts.length, headers: maskHeaders(authHeaders) });
    const completeRes = await fetch(completeUrl, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'complete-upload',
        key,
        uploadId,
        parts: uploadedParts,
        fileName: f.name,
        contentType: f.type,
        fileSize: f.size,
        customParameters: [],
        selectedActionItemTypes: [],
        originalContentType: f.type,
        audioCompressionUsed: false
      })
    });
    const completeText = await completeRes.clone().text();
    pushLog('← complete-upload response', {
      status: completeRes.status,
      ok: completeRes.ok,
      'content-type': completeRes.headers.get('content-type'),
      'content-encoding': completeRes.headers.get('content-encoding'),
      body: truncate(completeText)
    });
    let completeData: any;
    try { completeData = JSON.parse(completeText); } catch { completeData = { raw: completeText }; }
    if (!completeRes.ok || !completeData.success) throw new Error(completeData.error || 'Failed to complete upload');
    setProgress(100);
    // If backend failed to auto-start analysis (analysisStarted false), explicitly trigger it here as a fallback
    if (!completeData.analysisStarted && completeData?.upload?.id) {
      try {
        const analyzeUrl = `/proxy?url=${encodeURIComponent(`${base}/api/analyze`)}.`.replace(/\.$/, '');
        pushLog('→ POST analyze (fallback)', { url: analyzeUrl, uploadId: completeData.upload.id, headers: maskHeaders({ ...(authHeaders || {}), 'Content-Type': 'application/json' }) });
        const analyzeRes = await fetch(analyzeUrl, {
          method: 'POST',
          headers: {
            ...(authHeaders || {}),
            // Provide content-type because this call is rarer and we need JSON parsing reliability; preflight acceptable here
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            uploadIds: [completeData.upload.id],
            analysisType: 'parameters',
            customParameters: [],
            selectedActionItemTypes: []
          })
        });
        const analyzeText = await analyzeRes.clone().text();
        pushLog('← analyze response', { status: analyzeRes.status, ok: analyzeRes.ok, body: truncate(analyzeText) });
        if (analyzeRes.ok) {
          let analyzeJson: any;
          try { analyzeJson = JSON.parse(analyzeText); } catch { analyzeJson = { raw: analyzeText }; }
          if (analyzeJson?.success) {
            completeData.analysisStarted = true;
            completeData.analyses = analyzeJson.analyses || [];
            completeData.message = 'File uploaded and analysis started (fallback trigger).';
          }
        }
      } catch (fallbackErr) {
        pushLog('Fallback analyze trigger failed', fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      }
    }

    return completeData;
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setProgress(5);
    setError(null);
    setLogs([]);
    try {
      const result = await startSimpleMultipart(file);
      onComplete(result.success ? 'Upload & analysis triggered successfully.' : 'Upload completed but analysis may not have started.');
    } catch (err: any) {
      pushLog('Upload failed', err?.message || String(err));
      setError(err.message || 'Upload failed');
      onComplete(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleUpload} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Upload & Trigger Analysis</h2>
      <div style={{ marginBottom: '0.75rem' }}>
        <input type="file" accept={ACCEPTED.join(',')} onChange={handleFileChange} disabled={uploading} />
      </div>
      {file && (
        <div style={{ fontSize: 12, marginBottom: '0.75rem', color: '#555' }}>
          Selected: {file.name} ({(file.size/1024/1024).toFixed(2)} MB)
        </div>
      )}
      {progress > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, background: '#2563eb', height: '100%', transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{progress}%</div>
        </div>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: '0.75rem' }}>{error}</div>}
      <button type="submit" disabled={!file || uploading} style={{ background: '#10b981', color: '#fff', padding: '0.55rem 1rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', border: 'none' }}>
        {uploading ? 'Uploading...' : 'Upload & Analyze'}
      </button>
      {logs.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Logs</div>
          <pre style={{ maxHeight: 200, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6, fontSize: 11 }}>
            {logs.join('\n')}
          </pre>
        </div>
      )}
    </form>
  );
};
