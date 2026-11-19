'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Generic error boundary: never shows stack traces or internal messages to users. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning-ink">
        <AlertTriangle className="size-7" aria-hidden />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The error has been logged. Try again, and if it keeps happening contact your administrator
        {error.digest ? (
          <>
            {' '}
            quoting reference <code className="font-mono">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
