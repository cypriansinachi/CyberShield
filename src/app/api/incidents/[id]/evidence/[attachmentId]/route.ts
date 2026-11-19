import type { NextRequest } from 'next/server';
import { auditContextFor, getCurrentUser } from '@/server/auth/dal';
import { getEvidenceForDownload } from '@/server/services/incidents';

/**
 * Evidence download. Re-checks the session and object-level access, decrypts
 * the file, verifies its SHA-256 fingerprint and logs the access.
 * Always served as a download, never rendered inline (prevents stored XSS).
 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/incidents/[id]/evidence/[attachmentId]'>) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id, attachmentId } = await ctx.params;
  if (!/^\d{1,9}$/.test(id) || !/^\d{1,9}$/.test(attachmentId)) return new Response('Not found', { status: 404 });

  let result;
  try {
    result = await getEvidenceForDownload(Number(id), Number(attachmentId), user, await auditContextFor(user));
  } catch {
    return new Response('Evidence failed its integrity check and has been withheld. The event has been logged.', { status: 409 });
  }
  if (!result) return new Response('Not found', { status: 404 });

  const { attachment, data } = result;
  const asciiName = attachment.originalName.replace(/[^\w.\- ]/g, '_');
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(data.length),
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Evidence-SHA256': attachment.sha256,
    },
  });
}
