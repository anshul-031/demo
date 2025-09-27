import { validateAudioFile, MAX_SIZE_BYTES } from '../utils/validation';

describe('validateAudioFile', () => {
  it('accepts valid file', () => {
    const result = validateAudioFile('test.mp3', 1024, 'audio/mpeg');
    expect(result.valid).toBe(true);
  });
  it('rejects oversize file', () => {
    const result = validateAudioFile('big.mp3', MAX_SIZE_BYTES + 1, 'audio/mpeg');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/5MB/);
  });
  it('rejects invalid type', () => {
    const result = validateAudioFile('test.txt', 1000, 'text/plain');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unsupported/);
  });
});
