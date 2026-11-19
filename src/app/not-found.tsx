import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="size-7" aria-hidden />
      </span>
      <p className="mt-6 text-sm font-medium text-muted-foreground">404 · Not found</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">It may have been moved, or you may not have access to it.</p>
      <Link href="/dashboard" className={buttonClass({ className: 'mt-6' })}>
        Back to dashboard
      </Link>
    </main>
  );
}
