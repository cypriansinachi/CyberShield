import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/dal';
import { openNotification } from '@/server/services/notifications';

/** Mark a notification as read and follow its link (internal paths only). */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/notifications/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const { id } = await ctx.params;
  const link = /^\d{1,9}$/.test(id) ? await openNotification(Number(id), user.id) : null;
  const target = link && /^\/(?![/\\])/.test(link) ? link : '/notifications';
  return NextResponse.redirect(new URL(target, req.url));
}
