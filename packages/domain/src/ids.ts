/**
 * Isomorphic id helpers: this package is imported by the browser bundle as well as the API, so
 * only Web Crypto is used (available in Node 22 and every modern browser).
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Pseudonymous case key (docs/04). Random, not derived from the student id, so possession of a
 * case key gives no path back to a student without the audited link table.
 */
export function newCaseKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let s = 'ck_';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
