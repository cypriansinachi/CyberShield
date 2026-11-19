'use client';

import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ThemeChoice = 'light' | 'dark' | 'system';

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  document.cookie = `cirp_theme=${choice}; path=/; max-age=31536000; samesite=lax`;
  window.setTimeout(() => root.classList.remove('theme-switching'), 350);
}

const resolved = (): 'light' | 'dark' =>
  (document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null) ??
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** One-click light/dark switch. The icon is driven by CSS, so it is correct before hydration. */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => apply(resolved() === 'dark' ? 'light' : 'dark')}
      aria-label="Switch between light and dark mode"
      title="Switch theme"
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Moon className="theme-moon size-4" aria-hidden />
      <Sun className="theme-sun size-4" aria-hidden />
    </button>
  );
}

/** Light / Dark / System selector for the account menu. */
export function ThemeSelect({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const options = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: Moon },
    { value: 'system', label: 'System', Icon: Monitor },
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Theme">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          onClick={() => {
            setChoice(value);
            apply(value);
          }}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
            choice === value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}
