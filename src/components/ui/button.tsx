import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  secondary: 'border border-border bg-card text-foreground shadow-xs hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  subtle: 'bg-primary-soft text-primary hover:bg-primary-soft/70',
  danger: 'bg-critical text-white shadow-sm hover:bg-critical/90',
  'danger-outline': 'border border-critical/40 bg-card text-critical-ink hover:bg-critical-soft',
} as const;

const sizes = {
  xs: 'h-7 px-2.5 text-xs rounded-md',
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
  icon: 'h-9 w-9',
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export function buttonClass({ variant = 'primary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.97]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
