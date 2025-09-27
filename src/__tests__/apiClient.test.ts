import { ApiClient } from '../api/client';

// Simple mock for fetch
const originalFetch = global.fetch;

describe('ApiClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch as any;
  });

  it('adds Authorization header when token present (without forcing Content-Type)', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, value: 42 })
    });

    const client = new ApiClient({ baseUrl: 'https://demo.test', token: 'abc123' });
    const result = await client.postJson('/api/test', { hello: 'world' });
    expect(result.value).toBe(42);
    const call = (global.fetch as any).mock.calls[0];
    const options = call[1];
    expect(options.headers.Authorization).toBe('Bearer abc123');
    expect(options.headers['Content-Type']).toBeUndefined();
  });

  it('throws error on non-success', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'Boom' })
    });

    const client = new ApiClient({ baseUrl: 'https://demo.test' });
    await expect(client.postJson('/api/test', {})).rejects.toHaveProperty('message', 'Boom');
  });
});
