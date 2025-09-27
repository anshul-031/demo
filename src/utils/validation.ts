export const MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = new Set([
  'audio/mpeg','audio/wav','audio/x-wav','audio/wave','audio/x-pn-wav','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/flac','audio/webm'
]);

export interface ValidationResult { valid: boolean; error?: string }

export function validateAudioFile(name: string, size: number, type: string): ValidationResult {
  if (size > MAX_SIZE_BYTES) return { valid: false, error: 'File exceeds 5MB limit' };
  if (!ACCEPTED_TYPES.has(type)) return { valid: false, error: 'Unsupported file type' };
  return { valid: true };
}
