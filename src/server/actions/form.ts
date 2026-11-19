import 'server-only';
/** Helpers shared by Server Actions for reading and validating FormData. */
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { fromDateTimeInput } from '@/lib/format';

// ASCII control characters except tab and newline.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** FormData → plain object of strings (and string arrays for multi-value keys). */
export function formValues(fd: FormData, arrayKeys: string[] = []) {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const vals = fd.getAll(key).filter((v): v is string => typeof v === 'string');
    out[key] = arrayKeys.includes(key) ? vals : (vals[vals.length - 1] ?? '');
  }
  for (const k of arrayKeys) out[k] ??= [];
  return out;
}

/** Trimmed text with control characters removed and length limits. */
export const text = (label: string, min: number, max: number, opts: { multiline?: boolean } = {}) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => {
      const v = s.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
      return opts.multiline ? v : v.replace(/\s+/g, ' ');
    })
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );

export const optionalText = (label: string, max: number, opts: { multiline?: boolean } = {}) =>
  z
    .string()
    .optional()
    .transform((s) => {
      const v = (s ?? '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
      return opts.multiline ? v : v.replace(/\s+/g, ' ');
    })
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`));

export const email = () =>
  z
    .string({ error: 'Email address is required.' })
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email('Enter a valid email address.'));

/** datetime-local value in the organisation's timezone → ISO UTC. */
export const dateTimeInput = (label: string, { notFuture = false } = {}) =>
  z.string({ error: `${label} is required.` }).transform((v, ctx) => {
    const iso = fromDateTimeInput(v.trim());
    if (!iso) {
      ctx.addIssue({ code: 'custom', message: `${label} is not a valid date and time.` });
      return z.NEVER;
    }
    if (notFuture && Date.parse(iso) > Date.now() + 5 * 60_000) {
      ctx.addIssue({ code: 'custom', message: `${label} cannot be in the future.` });
      return z.NEVER;
    }
    return iso;
  });

export const idParam = z.coerce.number().int().positive().max(2_147_483_647);

export function invalid(error: z.ZodError, values?: Record<string, string | string[]>): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  return { status: 'error', message: 'Please correct the highlighted fields.', fieldErrors, values };
}

export const fail = (message: string, extra: Partial<ActionState> = {}): ActionState => ({ status: 'error', message, ...extra });
export const done = (message?: string, extra: Partial<ActionState> = {}): ActionState => ({ status: 'success', message, ...extra });

/** Only allow same-site relative redirect targets (prevents open redirects). */
export const safeNext = (p: unknown, fallback = '/dashboard') =>
  typeof p === 'string' && /^\/(?![/\\])[\w\-/?=&.%]*$/.test(p) && !p.startsWith('/login') ? p : fallback;
