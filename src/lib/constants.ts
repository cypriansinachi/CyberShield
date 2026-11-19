export const APP_NAME = 'CIRP';
export const APP_FULL_NAME = 'Cybersecurity Incident Reporting & Response Platform';
export const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME || 'Demo Organization';
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'Africa/Lagos';

export const DEPARTMENTS = [
  'Administration',
  'Finance',
  'Human Resources',
  'Information Technology',
  'Operations',
  'Sales & Marketing',
  'Legal & Compliance',
  'Customer Service',
  'Executive Office',
  'Other',
] as const;

export const EVIDENCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.txt', '.log', '.csv', '.json', '.eml'];
// Vercel limits a request body to 4.5 MB, so evidence is capped per submission.
export const MAX_EVIDENCE_MB = 4;
export const MAX_EVIDENCE_TOTAL_MB = 4;
export const MAX_EVIDENCE_FILES = 5;
