import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm', className)}>
      <ShieldAlert className="size-5" aria-hidden />
    </span>
  );
}
