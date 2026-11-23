/**
 * Risk classification engine.
 *
 * Produces a transparent 0–100 risk score from five weighted factors, then maps
 * it to a severity band. A small set of escalation rules ("severity floors")
 * guarantees certain combinations are never under-rated, whatever the
 * arithmetic says. Every factor and rule applied is returned, so analysts can
 * see exactly *why* an incident received its rating (explainable scoring).
 *
 *   Factor                           Max points
 *   -------------------------------  ----------
 *   Threat category                       30
 *   CIA impact (C + I + A)                30
 *   Data sensitivity                      15
 *   Scope (people / systems affected)     15
 *   Still ongoing / active                10
 *
 * This module is pure (no I/O), so it runs on the server for the authoritative
 * classification and in the browser for the live preview on the report form.
 */

export const CATEGORIES = {
  ransomware: { label: 'Ransomware', weight: 30, hint: 'Files encrypted or a ransom demand displayed.' },
  data_breach: { label: 'Data breach / leak', weight: 28, hint: 'Confidential or personal data accessed, disclosed or stolen.' },
  unauthorized_access: { label: 'Unauthorized access', weight: 24, hint: 'Someone accessed a system, account or room without permission.' },
  insider_threat: { label: 'Insider threat', weight: 22, hint: 'Misuse of access by an employee, contractor or partner.' },
  malware: { label: 'Malware infection', weight: 20, hint: 'Virus, trojan, spyware or other malicious software.' },
  account_compromise: { label: 'Compromised account', weight: 20, hint: 'A user account or password has been taken over or leaked.' },
  denial_of_service: { label: 'Denial of service', weight: 18, hint: 'A website, network or service is overwhelmed or unavailable.' },
  phishing: { label: 'Phishing', weight: 14, hint: 'Suspicious email, SMS or website trying to steal information.' },
  lost_device: { label: 'Lost or stolen device', weight: 14, hint: 'Laptop, phone, USB drive or media is missing.' },
  social_engineering: { label: 'Social engineering / fraud', weight: 12, hint: 'Impersonation, pretexting or payment-fraud attempts.' },
  vulnerability: { label: 'Vulnerability / weakness', weight: 10, hint: 'A security weakness that could be exploited.' },
  policy_violation: { label: 'Security policy violation', weight: 6, hint: 'Breach of acceptable-use or security policy.' },
  other: { label: 'Other', weight: 8, hint: 'Anything else that looks like a security problem.' },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

/** Plain-language CIA questions so non-technical customers can answer them. */
export const IMPACT_DIMENSIONS = {
  confidentiality: {
    label: 'Confidentiality',
    question: 'Has sensitive information been seen, copied or stolen by someone who should not have it?',
    levels: ['No', 'Possibly', 'Yes, a limited amount', 'Yes, a significant amount'],
  },
  integrity: {
    label: 'Integrity',
    question: 'Has any data, file or system been changed, corrupted or deleted?',
    levels: ['No', 'Possibly', 'Yes, some data or settings', 'Yes, critical data or systems'],
  },
  availability: {
    label: 'Availability',
    question: 'Are systems or services slow, unavailable or disrupted?',
    levels: ['No', 'Minor slowdown', 'Some services down', 'Critical services down'],
  },
} as const;
export type ImpactDimension = keyof typeof IMPACT_DIMENSIONS;

export const DATA_TYPES = {
  pii: { label: 'Personal data (names, contacts, ID numbers)', short: 'Personal data', weight: 10, personal: true },
  credentials: { label: 'Passwords or login credentials', short: 'Credentials', weight: 12, personal: true },
  financial: { label: 'Financial or payment data', short: 'Financial', weight: 13, personal: true },
  health: { label: 'Health or medical data', short: 'Health', weight: 15, personal: true },
  intellectual_property: { label: 'Intellectual property / trade secrets', short: 'Intellectual property', weight: 10, personal: false },
  confidential_business: { label: 'Confidential business information', short: 'Confidential business', weight: 8, personal: false },
} as const;
export type DataType = keyof typeof DATA_TYPES;
export const DATA_TYPE_KEYS = Object.keys(DATA_TYPES) as DataType[];

export const SCOPES = {
  unknown: { label: 'Not sure', points: 5 },
  single: { label: 'One person or device', points: 3 },
  few: { label: '2–10 people or devices', points: 6 },
  dozens: { label: '11–100 people or devices', points: 9 },
  hundreds: { label: '101–1,000 people or devices', points: 12 },
  thousands: { label: 'More than 1,000', points: 15 },
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_KEYS = Object.keys(SCOPES) as Scope[];

export const ONGOING = {
  yes: { label: 'Yes, still happening', points: 10 },
  unknown: { label: 'Not sure', points: 5 },
  no: { label: 'No, it has stopped', points: 0 },
} as const;
export type Ongoing = keyof typeof ONGOING;
export const ONGOING_KEYS = Object.keys(ONGOING) as Ongoing[];

export const SEVERITIES = {
  critical: { label: 'Critical', rank: 4, priority: 'P1', min: 70, ackMinutes: 15, resolveHours: 24 },
  high: { label: 'High', rank: 3, priority: 'P2', min: 45, ackMinutes: 60, resolveHours: 72 },
  medium: { label: 'Medium', rank: 2, priority: 'P3', min: 25, ackMinutes: 8 * 60, resolveHours: 7 * 24 },
  low: { label: 'Low', rank: 1, priority: 'P4', min: 0, ackMinutes: 24 * 60, resolveHours: 14 * 24 },
} as const;
export type Severity = keyof typeof SEVERITIES;
export const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

export type RiskInput = {
  category: Category;
  confidentiality: number;
  integrity: number;
  availability: number;
  dataTypes: DataType[];
  scope: Scope;
  ongoing: Ongoing;
};

export type RiskFactor = { key: string; label: string; detail: string; points: number; max: number };
export type RiskRule = { id: string; description: string; floor: Severity };
export type Classification = {
  input: RiskInput;
  score: number;
  scoreSeverity: Severity;
  severity: Severity;
  priority: string;
  factors: RiskFactor[];
  rules: RiskRule[];
  personalDataBreach: boolean;
};

export function severityFromScore(score: number): Severity {
  if (score >= SEVERITIES.critical.min) return 'critical';
  if (score >= SEVERITIES.high.min) return 'high';
  if (score >= SEVERITIES.medium.min) return 'medium';
  return 'low';
}

const maxSeverity = (a: Severity, b: Severity): Severity => (SEVERITIES[a].rank >= SEVERITIES[b].rank ? a : b);

export const hasPersonalData = (dataTypes: readonly DataType[]) => dataTypes.some((t) => DATA_TYPES[t]?.personal);

/** Severity floors: combinations that must never be rated below a given level. */
export const ESCALATION_RULES: (RiskRule & { test: (i: RiskInput) => boolean })[] = [
  {
    id: 'R1',
    description: 'Ransomware that is still active is always Critical.',
    floor: 'critical',
    test: (i) => i.category === 'ransomware' && i.ongoing === 'yes',
  },
  {
    id: 'R2',
    description: 'Exposure of personal data affecting more than 100 people is always Critical.',
    floor: 'critical',
    test: (i) => hasPersonalData(i.dataTypes) && i.confidentiality >= 2 && (i.scope === 'hundreds' || i.scope === 'thousands'),
  },
  {
    id: 'R3',
    description: 'Confirmed exposure of health or financial data is at least High.',
    floor: 'high',
    test: (i) => i.confidentiality >= 2 && (i.dataTypes.includes('health') || i.dataTypes.includes('financial')),
  },
  {
    id: 'R4',
    description: 'An ongoing outage of critical services is at least High.',
    floor: 'high',
    test: (i) => i.availability === 3 && i.ongoing === 'yes',
  },
];

export function normalizeRiskInput(raw: Partial<Record<keyof RiskInput, unknown>>): RiskInput {
  const clamp = (v: unknown) => Math.min(3, Math.max(0, Number.parseInt(String(v ?? 0), 10) || 0));
  const types = Array.isArray(raw.dataTypes) ? raw.dataTypes : [];
  return {
    category: (CATEGORY_KEYS as string[]).includes(String(raw.category)) ? (raw.category as Category) : 'other',
    confidentiality: clamp(raw.confidentiality),
    integrity: clamp(raw.integrity),
    availability: clamp(raw.availability),
    dataTypes: [...new Set(types.filter((t): t is DataType => (DATA_TYPE_KEYS as string[]).includes(String(t))))],
    scope: (SCOPE_KEYS as string[]).includes(String(raw.scope)) ? (raw.scope as Scope) : 'unknown',
    ongoing: (ONGOING_KEYS as string[]).includes(String(raw.ongoing)) ? (raw.ongoing as Ongoing) : 'unknown',
  };
}

/**
 * Whether an incident is a personal-data breach that is likely notifiable to
 * the data protection regulator (NDPA 2023 s.40 / GDPR Art. 33).
 */
export function isPersonalDataBreach(i: RiskInput): boolean {
  if (!hasPersonalData(i.dataTypes)) return false;
  return i.confidentiality >= 2 || i.integrity >= 2 || i.category === 'data_breach';
}

export function classify(raw: Partial<Record<keyof RiskInput, unknown>>): Classification {
  const i = normalizeRiskInput(raw);
  const factors: RiskFactor[] = [];

  const cat = CATEGORIES[i.category];
  factors.push({ key: 'category', label: 'Threat category', detail: cat.label, points: cat.weight, max: 30 });

  const ciaSum = i.confidentiality + i.integrity + i.availability;
  factors.push({
    key: 'impact',
    label: 'CIA impact',
    detail: `Confidentiality ${i.confidentiality}/3 · Integrity ${i.integrity}/3 · Availability ${i.availability}/3`,
    points: Math.round((ciaSum / 9) * 30),
    max: 30,
  });

  const weights = i.dataTypes.map((t) => DATA_TYPES[t].weight).sort((a, b) => b - a);
  factors.push({
    key: 'data',
    label: 'Data sensitivity',
    detail: i.dataTypes.length ? i.dataTypes.map((t) => DATA_TYPES[t].short).join(', ') : 'No sensitive data reported',
    points: weights.length ? Math.min(15, weights[0] + 2 * (weights.length - 1)) : 0,
    max: 15,
  });

  factors.push({ key: 'scope', label: 'Scope', detail: SCOPES[i.scope].label, points: SCOPES[i.scope].points, max: 15 });
  factors.push({ key: 'ongoing', label: 'Still active', detail: ONGOING[i.ongoing].label, points: ONGOING[i.ongoing].points, max: 10 });

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  const scoreSeverity = severityFromScore(score);
  let severity = scoreSeverity;
  const rules: RiskRule[] = [];
  for (const rule of ESCALATION_RULES) {
    if (rule.test(i)) {
      rules.push({ id: rule.id, description: rule.description, floor: rule.floor });
      severity = maxSeverity(severity, rule.floor);
    }
  }

  return {
    input: i,
    score,
    scoreSeverity,
    severity,
    priority: SEVERITIES[severity].priority,
    factors,
    rules,
    personalDataBreach: isPersonalDataBreach(i),
  };
}
