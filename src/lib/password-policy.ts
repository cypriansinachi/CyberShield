/**
 * Password policy aligned with NIST SP 800-63B: favour length over arbitrary
 * composition rules, and reject passwords that are known to be weak or that
 * contain the user's own details.
 */
export const PASSWORD_MIN_LENGTH = 12;

// Common passwords that would otherwise satisfy the length rule.
const COMMON = new Set([
  'password1234', 'password12345', 'password123456', 'passwordpassword', 'qwertyuiop12',
  'qwerty123456', '123456789012', '1234567890123', '12345678901234', '1q2w3e4r5t6y',
  'iloveyou1234', 'welcome12345', 'welcome@1234', 'admin1234567', 'administrator',
  'letmein12345', 'changeme1234', 'p@ssw0rd1234', 'p@ssword1234', 'passw0rd1234',
  'football1234', 'baseball1234', 'superman1234', 'trustno11234', 'abc123456789',
  'qwertyuiopasdf', 'aaaaaaaaaaaa', 'abcdefghijkl', 'password!234', 'password@123',
  'monkey123456', 'sunshine1234', 'princess1234', 'dragon123456', 'master123456',
  'nigeria12345', 'lagos1234567', 'security1234', 'cybersecurity', 'incident1234',
]);

export function checkPassword(password: string, ctx: { email?: string; fullName?: string } = {}): string[] {
  const errors: string[] = [];
  const pw = String(password ?? '');
  if (pw.length < PASSWORD_MIN_LENGTH) errors.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (pw.length > 128) errors.push('Use at most 128 characters.');

  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) errors.push('This password is too common. Choose something less predictable.');
  if (/^(.)\1+$/.test(pw)) errors.push('Password cannot be a single repeated character.');
  if (/^(0123456789|1234567890|abcdefghij)/i.test(pw)) errors.push('Password cannot start with a simple sequence.');

  const localPart = String(ctx.email ?? '').split('@')[0].toLowerCase();
  if (localPart.length >= 4 && lower.includes(localPart)) errors.push('Password must not contain your email address.');
  for (const part of String(ctx.fullName ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) {
      errors.push('Password must not contain your name.');
      break;
    }
  }
  return errors;
}
