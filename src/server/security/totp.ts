import 'server-only';
/**
 * Time-based One-Time Passwords (RFC 6238) for multi-factor authentication.
 * Compatible with Google Authenticator, Microsoft Authenticator, Authy, etc.
 */
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const totpCounter = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Verify a code, allowing ±1 time step of clock drift. Returns the matched
 * counter (so callers can reject replay of the same code) or null.
 */
export function verifyTotp(
  token: string,
  secretB32: string,
  { window = 1, lastCounter = null as number | null, now = Date.now() } = {},
): number | null {
  const code = String(token ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpCounter(now);
  for (let i = -window; i <= window; i++) {
    const c = current + i;
    if (lastCounter !== null && c <= lastCounter) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(secretB32, c)), Buffer.from(code))) return c;
  }
  return null;
}

export function totpKeyUri({ secret, account, issuer }: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
