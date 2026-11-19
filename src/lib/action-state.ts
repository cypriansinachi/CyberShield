/** Shape returned by every Server Action used with React's useActionState. */
export type ActionState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string | string[]>;
  data?: Record<string, string | number | boolean | null>;
};

export const idleState: ActionState = { status: 'idle' };
