import 'server-only';
/**
 * Cryptographic primitives. Only Node's built-in `crypto` module is used, so
 * no third-party code handles secrets.
 *
 *  - Passwords:    scrypt (memory-hard KDF), per-user 16-byte salt, parameters
 *                  stored with the hash so they can be raised later.
 *  - Data at rest: AES-256-GCM authenticated encryption (evidence, MFA secrets).
 *  - Integrity:    SHA-256 fingerprints for evidence; HMAC-SHA256 for the audit
 *                  chain and session-token hashing.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(expected, actual);
}

/** Hash used to keep login timing constant for unknown emails (prevents user enumeration). */
let dummy: Promise<string> | undefined;
export const dummyPasswordHash = () => (dummy ??= hashPassword(crypto.randomBytes(16).toString('hex')));

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

/** AES-256-GCM: returns [version | iv | authTag | ciphertext]. */
export function encrypt(plain: Buffer, key: Buffer = config.dataKey): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(blob: Buffer, key: Buffer = config.dataKey): Buffer {
  if (blob.length < 1 + IV_LEN + TAG_LEN || blob[0] !== VERSION) throw new Error('Unsupported or corrupt encrypted payload');
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(1 + IV_LEN + TAG_LEN)), decipher.final()]);
}

export const encryptString = (text: string) => encrypt(Buffer.from(text, 'utf8')).toString('base64');
export const decryptString = (b64: string) => decrypt(Buffer.from(b64, 'base64')).toString('utf8');

export const sha256 = (data: crypto.BinaryLike) => crypto.createHash('sha256').update(data).digest('hex');
export const hmacSha256 = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Readable temporary password for admin resets (shown once, must be changed). */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12)}`;
}
