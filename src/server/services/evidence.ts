import 'server-only';
/**
 * Secure evidence handling.
 *
 *  - Allow-list of file types; the extension AND the file's magic bytes must agree.
 *  - Files are validated in memory, then encrypted (AES-256-GCM) and stored as
 *    ciphertext in the database under a random name. Nothing is written to the
 *    server's filesystem, so this also works on serverless hosts.
 *  - A SHA-256 fingerprint of the original bytes is recorded for chain of
 *    custody, and re-checked on every download.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { evidenceBlobs } from '../db/schema';
import { decrypt, encrypt, sha256 } from '../security/crypto';
import { EVIDENCE_EXTENSIONS, MAX_EVIDENCE_FILES, MAX_EVIDENCE_MB, MAX_EVIDENCE_TOTAL_MB } from '@/lib/constants';

type TypeRule = { mime: string; magic?: Buffer[]; text?: boolean };
const TYPES: Record<string, TypeRule> = {
  '.png': { mime: 'image/png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47])] },
  '.jpg': { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  '.jpeg': { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  '.gif': { mime: 'image/gif', magic: [Buffer.from('GIF87a'), Buffer.from('GIF89a')] },
  '.pdf': { mime: 'application/pdf', magic: [Buffer.from('%PDF-')] },
  '.txt': { mime: 'text/plain', text: true },
  '.log': { mime: 'text/plain', text: true },
  '.csv': { mime: 'text/csv', text: true },
  '.json': { mime: 'application/json', text: true },
  '.eml': { mime: 'message/rfc822', text: true },
};

export class EvidenceError extends Error {}

export type PreparedEvidence = { originalName: string; buffer: Buffer; mimeType: string };
export type SealedEvidence = {
  meta: { originalName: string; storedName: string; mimeType: string; sizeBytes: number; sha256: string };
  ciphertext: Buffer;
};

const extOf = (name: string) => path.extname(name).toLowerCase();

export function sanitizeFilename(name: string) {
  let n = path.basename(String(name || 'file').replace(/\\/g, '/'));
  n = n.replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim();
  if (n.length > 120) n = n.slice(0, 100) + extOf(n);
  return n || 'file';
}

/** Validate uploaded files (count, size, type, content). Throws EvidenceError. */
export async function prepareEvidence(files: File[]): Promise<PreparedEvidence[]> {
  const real = files.filter((f) => f && typeof f === 'object' && f.size > 0);
  if (real.length > MAX_EVIDENCE_FILES) throw new EvidenceError(`Attach at most ${MAX_EVIDENCE_FILES} files.`);
  const total = real.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_EVIDENCE_TOTAL_MB * 1024 * 1024) {
    throw new EvidenceError(`Attachments can total at most ${MAX_EVIDENCE_TOTAL_MB} MB per submission.`);
  }
  const out: PreparedEvidence[] = [];
  for (const file of real) {
    const name = sanitizeFilename(file.name);
    const rule = TYPES[extOf(name)];
    if (!rule) throw new EvidenceError(`"${name}": file type not allowed. Allowed: ${EVIDENCE_EXTENSIONS.join(', ')}`);
    if (file.size > MAX_EVIDENCE_MB * 1024 * 1024) throw new EvidenceError(`"${name}" is larger than ${MAX_EVIDENCE_MB} MB.`);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (rule.magic && !rule.magic.some((sig) => buffer.subarray(0, sig.length).equals(sig))) {
      throw new EvidenceError(`"${name}" does not match its file extension.`);
    }
    if (rule.text && buffer.subarray(0, 8192).includes(0)) throw new EvidenceError(`"${name}" is not a valid text file.`);
    out.push({ originalName: name, buffer, mimeType: rule.mime });
  }
  return out;
}

/** Fingerprint and encrypt; the caller stores both in one transaction. */
export function sealEvidence(p: PreparedEvidence): SealedEvidence {
  return {
    meta: {
      originalName: p.originalName,
      storedName: `${crypto.randomUUID()}.enc`,
      mimeType: p.mimeType,
      sizeBytes: p.buffer.length,
      sha256: sha256(p.buffer),
    },
    ciphertext: encrypt(p.buffer),
  };
}

/** Load, decrypt and verify integrity; throws if the evidence was altered. */
export async function readEvidence(a: { storedName: string; sha256: string }): Promise<Buffer> {
  const row = await (await getDb()).select().from(evidenceBlobs).where(eq(evidenceBlobs.storedName, a.storedName)).get();
  if (!row) throw new Error('Evidence content is missing');
  const plain = decrypt(Buffer.from(row.data));
  if (sha256(plain) !== a.sha256) throw new Error('Evidence integrity check failed (hash mismatch)');
  return plain;
}
