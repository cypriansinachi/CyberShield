'use client';
/**
 * Form primitives wired to React's useActionState.
 *
 * <ActionForm> runs a Server Action and shares its result through context, so
 * any field inside it can show its own validation error and keep the value the
 * user typed when the server rejects a submission.
 */
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useFormStatus } from 'react-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { idleState, type ActionState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button';
import { Alert } from './misc';

type Ctx = { state: ActionState; pending: boolean };
const FormStateContext = createContext<Ctx>({ state: idleState, pending: false });
export const useFormResult = () => useContext(FormStateContext);

export type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  showMessage = true,
  successMessage = true,
  resetOnSuccess = true,
  encType,
  onSuccess,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  showMessage?: boolean;
  successMessage?: boolean;
  resetOnSuccess?: boolean;
  encType?: 'multipart/form-data';
  onSuccess?: (state: ActionState) => void;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  const lastHandled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (state.status === 'success' && lastHandled.current !== state) {
      lastHandled.current = state;
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, onSuccess]);

  return (
    <FormStateContext value={{ state, pending }}>
      <form ref={formRef} action={formAction} className={className} encType={encType} noValidate>
        {children}
        {showMessage && <FormMessage hideSuccess={!successMessage} />}
      </form>
    </FormStateContext>
  );
}

/** Wraps a form you build yourself with useActionState (for complex forms). */
export function FormStateProvider({ state, pending, children }: { state: ActionState; pending: boolean; children: ReactNode }) {
  return <FormStateContext value={{ state, pending }}>{children}</FormStateContext>;
}

export function FormMessage({ hideSuccess, className }: { hideSuccess?: boolean; className?: string }) {
  const { state } = useFormResult();
  if (state.status === 'idle' || !state.message) return null;
  if (state.status === 'success' && hideSuccess) return null;
  return (
    <Alert tone={state.status === 'success' ? 'success' : 'error'} className={cn('mt-3', className)}>
      {state.message}
    </Alert>
  );
}

function useField(name?: string) {
  const { state } = useFormResult();
  const error = name ? state.fieldErrors?.[name] : undefined;
  const kept = name && state.status === 'error' ? state.values?.[name] : undefined;
  return { error, kept };
}

const controlCls =
  'block w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/70 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-critical aria-[invalid=true]:ring-critical/20';

/**
 * Text input. Password inputs get an eye button that shows or hides what was
 * typed; it is hidden again by default, and the browser's password manager
 * still sees a password field (autoComplete is passed through unchanged).
 */
export function Input({ className, name, defaultValue, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const { error, kept } = useField(name);
  const isSecret = type === 'password';
  const [visible, setVisible] = useState(false);
  const id = props.id ?? name;
  const input = (
    <input
      name={name}
      id={id}
      type={isSecret && visible ? 'text' : type}
      defaultValue={!isSecret && typeof kept === 'string' ? kept : defaultValue}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && name ? `${name}-error` : undefined}
      className={cn(controlCls, 'h-9', isSecret && 'pr-10', className)}
      {...props}
    />
  );
  if (!isSecret) return input;
  return (
    <div className="relative">
      {input}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={id}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export function Textarea({ className, name, defaultValue, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { error, kept } = useField(name);
  return (
    <textarea
      name={name}
      id={props.id ?? name}
      defaultValue={typeof kept === 'string' ? kept : defaultValue}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && name ? `${name}-error` : undefined}
      className={cn(controlCls, 'min-h-24 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

export function Select({ className, name, defaultValue, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const { error, kept } = useField(name);
  // React applies a <select>'s defaultValue only on mount, and resets forms after
  // every action. Remounting when the effective default changes keeps the
  // user's choice after a validation error and shows fresh server values.
  const effective = typeof kept === 'string' ? kept : defaultValue;
  return (
    <select
      key={`sel:${String(effective ?? '')}`}
      name={name}
      id={props.id ?? name}
      defaultValue={effective}
      aria-invalid={error ? true : undefined}
      className={cn(controlCls, 'h-9 pr-8', className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Choice({
  type = 'radio',
  name,
  value,
  defaultChecked,
  label,
  description,
  className,
}: {
  type?: 'radio' | 'checkbox';
  name: string;
  value: string;
  defaultChecked?: boolean;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const { kept } = useField(name);
  const checked = kept === undefined ? defaultChecked : Array.isArray(kept) ? kept.includes(value) : kept === value;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/60',
        'has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        className,
      )}
    >
      <input type={type} name={name} value={value} defaultChecked={checked} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

export function Label({ htmlFor, children, optional }: { htmlFor?: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
      {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
    </label>
  );
}

export function FieldError({ name }: { name: string }) {
  const { error } = useField(name);
  if (!error) return null;
  return (
    <p id={`${name}-error`} className="mt-1.5 text-xs font-medium text-critical-ink">
      {error}
    </p>
  );
}

export function Field({
  label,
  name,
  hint,
  optional,
  children,
  className,
}: {
  label?: ReactNode;
  name: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={name} optional={optional}>
          {label}
        </Label>
      )}
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export function SubmitButton({
  children,
  variant,
  size,
  className,
  pendingText,
  name,
  value,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-disabled={pending} className={buttonClass({ variant, size, className })}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
