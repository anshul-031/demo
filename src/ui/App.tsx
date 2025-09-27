import React, { useEffect, useState } from 'react';
import { AuthForm } from './AuthForm';
import { DomainConfig } from './DomainConfig';
import { UploadForm } from './UploadForm';

export const App: React.FC = () => {
  const [domain, setDomain] = useState<string>(() => localStorage.getItem('aicm-domain') || 'https://www.aicallmetrics.com');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    localStorage.setItem('aicm-domain', domain);
  }, [domain]);

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setStatusMessage('Logging in...');
    try {
      /**
       * Avoid sending an explicit Content-Type header so the request qualifies as a
       * "simple request" and does NOT trigger a CORS preflight (OPTIONS) that the
       * target server may be redirecting. The Fetch API will send the body as text; 
       * the Next.js route uses request.json() which still parses it correctly.
       */
      const target = `${domain.replace(/\/$/, '')}/api/auth/login`;
      console.log('[Demo] Login request →', { target, email });
      const res = await fetch(`/proxy?url=${encodeURIComponent(target)}`, {
        method: 'POST',
        // no headers: { 'Content-Type': 'application/json' }
        body: JSON.stringify({ email, password }),
        credentials: 'include',
        redirect: 'manual', // Surface unexpected redirects (helps identify CORS/middleware issues)
      });

      // If server incorrectly returns a redirect for login, surface a clearer hint
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        throw new Error('Received redirect during login (possible middleware or HTTPS redirect). This breaks CORS preflight.');
      }

      let data: any = {};
      try {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          console.warn('[Demo] Non-JSON login response:', text.slice(0, 500));
          throw new Error('Failed to parse JSON response from login endpoint');
        }
      } catch (parseErr) {
        throw new Error('Failed to read response from login endpoint');
      }

      if (!res.ok || !data.success) {
        throw new Error(data.message || `Login failed (status ${res.status})`);
      }

      if (data.token) setToken(data.token);
      setIsAuthenticated(true);
      setStatusMessage('Login successful. You can now upload a file.');
    } catch (err: any) {
      const msg = err?.message || 'Unknown error';
      console.error('[Demo] Login error:', err);
      const corsHint = msg.includes('redirect') || msg.includes('CORS') || msg.includes('Failed to fetch')
        ? ' Potential CORS / preflight issue: ensure server sends Access-Control-Allow-Origin & does not redirect OPTIONS/POST.'
        : '';
      setStatusMessage(`Login error: ${msg}${corsHint}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = (message: string) => {
    setStatusMessage(message);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', padding: '1.25rem' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>AICallMetrics Integration Demo</h1>
      <p style={{ color: '#555', marginBottom: '1rem' }}>Demonstrates authenticating and uploading a single audio file to trigger analysis using an existing AICallMetrics deployment.</p>

      <DomainConfig domain={domain} onChange={setDomain} disabled={loading} />

      {!isAuthenticated ? (
        <AuthForm onLogin={handleLogin} disabled={loading} />
      ) : (
        <UploadForm domain={domain} token={token} onComplete={handleUploadComplete} />
      )}

      {statusMessage && (
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f1f5f9', borderRadius: 8, fontSize: 14 }}>
          {statusMessage}
        </div>
      )}

      <footer style={{ marginTop: '3rem', fontSize: 12, color: '#777' }}>
        <p>Notes:</p>
        <ul style={{ paddingLeft: '1.2rem' }}>
          <li>Ensure the target domain returns proper CORS headers (Access-Control-Allow-Origin including http://localhost:5173 and Access-Control-Allow-Credentials: true).</li>
          <li>No custom Content-Type header is sent so the request avoids a CORS preflight.</li>
          <li>If you still see issues, inspect the network tab for 30x redirects or missing CORS headers.</li>
          <li>File size limited to 5MB. Supported types: MP3, WAV, M4A, AAC, OGG, FLAC, WebM.</li>
        </ul>
      </footer>
    </div>
  );
};
