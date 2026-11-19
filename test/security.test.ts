import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashPassword, verifyPassword } from '@/server/security/crypto';
import { base32Encode, hotp, totpCounter, verifyTotp } from '@/server/security/totp';
import { rateLimit } from '@/server/security/rate-limit';
import { checkPassword } from '@/lib/password-policy';
import { csvCell, toCsv } from '@/lib/csv';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', h)).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashPassword('same-password-123')).not.toBe(await hashPassword('same-password-123'));
  });
  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
  });
});

describe('AES-256-GCM encryption at rest', () => {
  it('round-trips data', () => {
    const blob = encrypt(Buffer.from('evidence bytes'));
    expect(decrypt(blob).toString()).toBe('evidence bytes');
  });
  it('detects tampering with the ciphertext', () => {
    const blob = encrypt(Buffer.from('evidence bytes'));
    blob[blob.length - 1] ^= 0xff;
    expect(() => decrypt(blob)).toThrow();
  });
});

describe('TOTP multi-factor authentication (RFC 6238)', () => {
  // RFC 6238 Appendix B test secret, SHA-1, T = 59 s → 94287082 (8 digits) → 287082 (6 digits)
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC test vector', () => {
    expect(hotp(secret, totpCounter(59_000))).toBe('287082');
  });
  it('accepts the current code and rejects replay of an already-used code', () => {
    const now = Date.now();
    const code = hotp(secret, totpCounter(now));
    const used = verifyTotp(code, secret, { now });
    expect(used).not.toBeNull();
    expect(verifyTotp(code, secret, { now, lastCounter: used })).toBeNull();
  });
  it('rejects malformed codes', () => {
    expect(verifyTotp('12ab56', secret)).toBeNull();
  });
});

describe('rate limiting (shared across instances via the database)', () => {
  it('blocks after the limit within the window', async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000)).allowed).toBe(true);
    expect((await rateLimit(key, 3, 60_000)).allowed).toBe(false);
  });
  it('counts concurrent attempts correctly', async () => {
    const key = `test:${Math.random()}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => rateLimit(key, 5, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe('password policy (NIST SP 800-63B)', () => {
  it('enforces length and blocks common or personal passwords', () => {
    expect(checkPassword('short')).not.toHaveLength(0);
    expect(checkPassword('password1234')).not.toHaveLength(0);
    expect(checkPassword('emeka-is-great-2026', { email: 'emeka@x.org' }).join()).toMatch(/email/);
    expect(checkPassword('blue-river-lantern-42')).toEqual([]);
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formula injection', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv([{ header: 'v', value: (r: { v: string }) => r.v }], [{ v: 'a,b' }, { v: 'line\nbreak' }]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"line\nbreak"');
  });
});
