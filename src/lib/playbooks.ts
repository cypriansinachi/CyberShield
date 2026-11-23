/**
 * Response playbooks. When an incident is reported, a checklist of response
 * tasks is generated from its category so responders follow a consistent,
 * repeatable procedure (ISO/IEC 27001:2022 A.5.26).
 */
import type { Category } from './risk';

export const PHASES = {
  analysis: 'Detection & Analysis',
  containment: 'Containment',
  eradication: 'Eradication',
  recovery: 'Recovery',
  post: 'Post-Incident',
} as const;
type PhaseKey = keyof typeof PHASES;
export const PHASE_LABELS = Object.values(PHASES);
const PHASE_ORDER: PhaseKey[] = ['analysis', 'containment', 'eradication', 'recovery', 'post'];

type Step = [PhaseKey, string];

const COMMON_START: Step[] = [
  ['analysis', 'Validate the report and confirm whether a security incident occurred'],
  ['analysis', 'Preserve evidence (logs, emails, screenshots) and record SHA-256 hashes'],
];
const COMMON_END: Step[] = [
  ['post', 'Communicate the outcome to the reporter and affected customers'],
  ['post', 'Record root cause and lessons learned; update controls if needed'],
];

const SPECIFIC: Record<Category, Step[]> = {
  phishing: [
    ['analysis', 'Identify all recipients and anyone who clicked a link or opened an attachment'],
    ['containment', 'Block the sender address/domain and malicious URLs at the email gateway'],
    ['containment', 'Purge remaining copies of the message from all mailboxes'],
    ['eradication', 'Reset passwords and revoke sessions for any user who entered credentials'],
    ['recovery', 'Warn affected customers and publish a scam alert if Nexora is being impersonated'],
  ],
  malware: [
    ['containment', 'Isolate infected device(s) from the network'],
    ['analysis', 'Identify the malware family and indicators of compromise (IOCs)'],
    ['eradication', 'Remove the malware or re-image affected device(s)'],
    ['eradication', 'Sweep the environment for the same IOCs'],
    ['recovery', 'Restore device(s) and confirm endpoint protection is up to date'],
  ],
  ransomware: [
    ['containment', 'Immediately isolate affected systems and disable shared drives'],
    ['containment', 'Escalate to management and activate the crisis communication plan'],
    ['analysis', 'Identify the ransomware strain and determine the scope of encryption'],
    ['analysis', 'Assess whether data was exfiltrated (double extortion)'],
    ['eradication', 'Remove persistence mechanisms and reset privileged credentials'],
    ['recovery', 'Restore from verified clean, offline backups'],
    ['recovery', 'Monitor restored systems closely for re-infection'],
  ],
  unauthorized_access: [
    ['analysis', 'Review access logs to establish what was accessed and when'],
    ['containment', 'Disable or lock the affected account(s) and revoke access'],
    ['eradication', 'Close the access path (patch, reconfigure, remove backdoor)'],
    ['recovery', 'Restore access with least privilege and enforce MFA'],
  ],
  data_breach: [
    ['analysis', 'Determine what data, how many records and which data subjects are affected'],
    ['containment', 'Stop further disclosure (revoke links, secure storage, take down data)'],
    ['analysis', 'Assess risk to data subjects and decide on regulator notification (72 hours)'],
    ['recovery', 'Notify affected data subjects where there is a high risk to them'],
    ['post', 'Review the data-handling controls that allowed the breach'],
  ],
  denial_of_service: [
    ['analysis', 'Identify the attack type, source ranges and targeted services'],
    ['containment', 'Engage the ISP / DDoS protection and apply rate limiting or filtering'],
    ['recovery', 'Restore services and verify normal performance'],
  ],
  insider_threat: [
    ['analysis', 'Involve HR and Legal before contacting the individual'],
    ['containment', "Restrict or suspend the individual's access as appropriate"],
    ['analysis', 'Review activity logs for data access, transfer or deletion'],
  ],
  account_compromise: [
    ['containment', 'Reset the password and revoke all active sessions and tokens'],
    ['analysis', 'Review sign-in history and mailbox rules for attacker activity'],
    ['eradication', 'Remove malicious forwarding rules, apps or devices'],
    ['recovery', 'Enforce multi-factor authentication on the account'],
  ],
  lost_device: [
    ['containment', 'Remote-lock or remote-wipe the device'],
    ['analysis', 'Confirm whether the device was encrypted and what data it held'],
    ['containment', 'Revoke credentials and certificates stored on the device'],
    ['recovery', 'Issue a replacement device and update the asset register'],
  ],
  social_engineering: [
    ['analysis', 'Establish what information or payment was requested or provided'],
    ['containment', 'Alert finance / banking partners if payment fraud is involved'],
    ['recovery', 'Warn customers and the support team about the specific technique used'],
  ],
  vulnerability: [
    ['analysis', 'Confirm the vulnerability and assess exploitability'],
    ['containment', 'Apply a temporary mitigation or compensating control'],
    ['eradication', 'Apply the vendor patch or permanent fix'],
    ['recovery', 'Verify the fix with a re-test'],
  ],
  policy_violation: [
    ['analysis', 'Establish the facts and which policy was breached'],
    ['recovery', 'Refer to the line manager / HR and provide awareness training'],
  ],
  other: [
    ['analysis', 'Classify the incident and select an appropriate response approach'],
    ['containment', 'Limit any ongoing impact'],
  ],
};

export type PlaybookTask = { phase: string; title: string; sortOrder: number };

export function tasksForCategory(category: Category): PlaybookTask[] {
  const all = [...COMMON_START, ...(SPECIFIC[category] ?? SPECIFIC.other), ...COMMON_END];
  return all
    .map(([phase, title], i) => ({ phase, title, order: PHASE_ORDER.indexOf(phase) * 100 + i }))
    .sort((a, b) => a.order - b.order)
    .map((t, i) => ({ phase: PHASES[t.phase], title: t.title, sortOrder: i }));
}
