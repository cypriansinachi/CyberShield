import Link from 'next/link';
import { ShieldX } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';

export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-critical-soft text-critical-ink">
        <ShieldX className="size-7" aria-hidden />
      </span>
      <p className="mt-6 text-sm font-medium text-critical-ink">403 · Access denied</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">You don&apos;t have permission to view this page</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Access is granted by role on a least-privilege basis. This attempt has been recorded in the audit log. If you need access, ask your administrator.
      </p>
      <Link href="/dashboard" className={buttonClass({ className: 'mt-6' })}>
        Back to dashboard
      </Link>
    </main>
  );
}
