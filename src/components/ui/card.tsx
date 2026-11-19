import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-card shadow-xs', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-6">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 border-t border-border px-5 py-3', className)} {...props} />;
}
