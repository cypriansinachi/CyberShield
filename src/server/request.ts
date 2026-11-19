import 'server-only';
import { headers } from 'next/headers';

export type RequestMeta = { ip: string | null; userAgent: string | null; requestId: string | null };

/**
 * Client metadata for audit records and rate limiting. x-forwarded-for is
 * trusted only as far as the deployment's reverse proxy sets it; behind a
 * proxy, configure it to overwrite (not append to) client-supplied values.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return {
    ip,
    userAgent: h.get('user-agent')?.slice(0, 255) ?? null,
    requestId: h.get('x-request-id'),
  };
}
