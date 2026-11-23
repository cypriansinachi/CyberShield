/**
 * Role-based access control (least privilege).
 *
 * Permissions are granted to roles, never directly to users. Object-level
 * checks ("a customer may only see their own reports") are enforced in the
 * incident service, so changing an ID in the URL cannot expose another
 * person's report (IDOR protection).
 */

export const ROLES = {
  reporter: {
    // Stored as 'reporter' in the database; shown to people as "Customer".
    label: 'Customer',
    description: 'A Nexora customer. Can report security problems they notice and follow the progress of their own reports.',
  },
  analyst: {
    label: 'Security Analyst',
    description: 'Incident responder. Triages, investigates and works incidents through the response workflow.',
  },
  manager: {
    label: 'Security Manager',
    description: 'Leads the response team. Assigns work, overrides classifications, closes major incidents and views reports.',
  },
  admin: {
    label: 'System Administrator',
    description: 'Manages user accounts and roles, with full access to the platform and the audit trail.',
  },
  auditor: {
    label: 'Compliance Auditor',
    description: 'Read-only oversight of incidents, reports, compliance status and the audit trail.',
  },
} as const;
export type Role = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as Role[];

export const RESPONDER_ROLES: Role[] = ['analyst', 'manager', 'admin'];
export const PRIVILEGED_ROLES: Role[] = ['analyst', 'manager', 'admin', 'auditor'];

export const PERMISSIONS = {
  'incident.create': ['reporter', 'analyst', 'manager', 'admin'],
  'incident.view_all': ['analyst', 'manager', 'admin', 'auditor'],
  'incident.comment': ['reporter', 'analyst', 'manager', 'admin'],
  'incident.triage': RESPONDER_ROLES, // status changes, reassessment, tasks, internal notes
  'incident.assign_self': RESPONDER_ROLES,
  'incident.assign': ['manager', 'admin'],
  'incident.override': ['manager', 'admin'], // manual severity override
  'incident.close_major': ['manager', 'admin'],
  'incident.reopen': ['manager', 'admin'],
  'incident.compliance': RESPONDER_ROLES, // record regulator notifications
  'incident.audit_trail': ['manager', 'admin', 'auditor'],
  'dashboard.view': ['analyst', 'manager', 'admin', 'auditor'],
  'report.view': ['manager', 'admin', 'auditor'],
  'report.export': ['manager', 'admin', 'auditor'],
  'compliance.view': ['manager', 'admin', 'auditor'],
  'audit.view': ['admin', 'auditor'],
  'user.manage': ['admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(user: { role: Role } | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(user.role);
}

export const isResponder = (user: { role: Role } | null | undefined) => !!user && RESPONDER_ROLES.includes(user.role);
