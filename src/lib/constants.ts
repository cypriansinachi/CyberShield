/**
 * Branding. CyberShield is the incident reporting and response platform of
 * Nexora, a (fictional) consumer platform with accounts, payments, a mobile app
 * and a partner API. Nexora's customers report the security problems they
 * notice; Nexora's security team triages and responds to them in CyberShield.
 * Change ORG_NAME here to rebrand the parent organisation.
 */
export const APP_NAME = 'CyberShield';
export const ORG_NAME = 'Nexora';
export const APP_TAGLINE = `by ${ORG_NAME}`;
export const APP_FULL_NAME = `${APP_NAME}: ${ORG_NAME} Incident Reporting & Response`;
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'Africa/Lagos';

/** What a report is about: the Nexora service the person noticed the problem in. */
export const SERVICES = [
  'Website',
  'Mobile app',
  'Customer account & sign-in',
  'Payments & billing',
  `Emails, texts & calls from ${ORG_NAME}`,
  'Customer support',
  'Partner & developer APIs',
  'Internal systems',
  'Offices & devices',
  'Not sure',
] as const;

/** Departments of Nexora team members (customers have none). */
export const DEPARTMENTS = [
  'Security Operations',
  'Information Technology',
  'Engineering',
  'Customer Support',
  'Finance',
  'Human Resources',
  'Legal & Compliance',
  'Operations',
  'Executive Office',
  'Other',
] as const;

export const EVIDENCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.txt', '.log', '.csv', '.json', '.eml'];
// Vercel limits a request body to 4.5 MB, so evidence is capped per submission.
export const MAX_EVIDENCE_MB = 4;
export const MAX_EVIDENCE_TOTAL_MB = 4;
export const MAX_EVIDENCE_FILES = 5;
