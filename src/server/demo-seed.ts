import 'server-only';
/**
 * Demo data for presentations and testing: users for every role and ~45
 * realistic incidents spread over the last 60 days, progressed through the
 * workflow with consistent timestamps. All data is fictitious.
 *
 * Additive and idempotent: it never deletes anything, and does nothing if the
 * demo administrator account already exists. Used by `npm run db:seed` and by
 * the protected POST /api/setup/demo-data endpoint (for serverless hosts).
 */
import { eq, inArray } from 'drizzle-orm';
import { getDb, type DB } from './db';
import { incidentEvents, incidents, incidentTasks, notifications, users, type User } from './db/schema';
import { hashPassword } from './security/crypto';
import { recordAudit } from './audit';
import { authenticate } from './services/auth';
import { createIncident, runSlaEscalations, type NewIncidentInput } from './services/incidents';
import { LIFECYCLE, type Status } from '@/lib/workflow';
import type { Role } from '@/lib/rbac';
import type { Category, DataType, Ongoing, Scope } from '@/lib/risk';

export const DEMO_PASSWORD = 'Demo@Passw0rd!';
export const DEMO_ADMIN_EMAIL = 'admin@cirp.local';

let db: DB;

// Deterministic pseudo-random numbers so every reset produces the same demo.
let seed = 20261113;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rand() * (b - a);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
let NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

// ───────────────────────────── Users ─────────────────────────────

const PEOPLE: { key: string; name: string; email: string; role: Role; dept: string }[] = [
  { key: 'admin', name: 'Adaeze Okonkwo', email: 'admin@cirp.local', role: 'admin', dept: 'Information Technology' },
  { key: 'manager', name: 'Tunde Bakare', email: 'manager@cirp.local', role: 'manager', dept: 'Information Technology' },
  { key: 'analyst', name: 'Chiamaka Eze', email: 'analyst@cirp.local', role: 'analyst', dept: 'Information Technology' },
  { key: 'analyst2', name: 'Ibrahim Musa', email: 'analyst2@cirp.local', role: 'analyst', dept: 'Information Technology' },
  { key: 'auditor', name: 'Funmilayo Adeyemi', email: 'auditor@cirp.local', role: 'auditor', dept: 'Legal & Compliance' },
  { key: 'staff', name: 'Emeka Nwosu', email: 'staff@cirp.local', role: 'reporter', dept: 'Finance' },
  { key: 'grace', name: 'Grace Okafor', email: 'grace.okafor@cirp.local', role: 'reporter', dept: 'Human Resources' },
  { key: 'yusuf', name: 'Yusuf Bello', email: 'yusuf.bello@cirp.local', role: 'reporter', dept: 'Operations' },
  { key: 'ngozi', name: 'Ngozi Uche', email: 'ngozi.uche@cirp.local', role: 'reporter', dept: 'Sales & Marketing' },
  { key: 'daniel', name: 'Daniel Adebayo', email: 'daniel.adebayo@cirp.local', role: 'reporter', dept: 'Customer Service' },
];

async function seedUsers() {
  const out: Record<string, User> = {};
  for (const p of PEOPLE) {
    const created = iso(NOW - 75 * DAY);
    const existing = await db.select().from(users).where(eq(users.email, p.email)).get();
    if (existing) {
      out[p.key] = existing;
      continue;
    }
    out[p.key] = await db
      .insert(users)
      .values({
        fullName: p.name,
        email: p.email,
        role: p.role,
        department: p.dept,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        passwordChangedAt: created,
        lastLoginAt: iso(NOW - between(1, 72) * HOUR),
        createdAt: created,
        updatedAt: created,
      })
      .returning()
      .get();
  }
  return out;
}

// ───────────────────────────── Incident templates ─────────────────────────────

type Template = {
  category: Category;
  title: string;
  description: string;
  c: number;
  i: number;
  a: number;
  data: DataType[];
  scope: Scope;
  ongoing: Ongoing;
  dept: string;
  assets?: string;
  rootCause: string;
  resolution: string;
  lessons: string;
};

const T: Record<string, Template> = {
  payrollPhish: {
    category: 'phishing',
    title: 'Email asking me to verify my payroll login',
    description:
      'Received an email from "payroll-update@hr-portal-verify.com" saying my salary payment was on hold and asking me to log in through a link. The link goes to a page that looks like our HR portal. I did not click it.',
    c: 0, i: 0, a: 0, data: [], scope: 'single', ongoing: 'no', dept: 'Finance', assets: 'Outlook mailbox',
    rootCause: 'Look-alike sender domain was not on the email gateway block list.',
    resolution: 'Sender domain and URL blocked at the gateway; 37 copies purged from mailboxes. No credentials were entered.',
    lessons: 'Enable look-alike domain detection on the email gateway and repeat the payroll-phishing awareness message before month end.',
  },
  credsPhish: {
    category: 'phishing',
    title: 'Entered my password on a fake Microsoft 365 page',
    description:
      'I clicked a "shared document" link in an email and entered my email password before noticing the address bar was wrong. I then received an MFA prompt I did not expect.',
    c: 2, i: 0, a: 0, data: ['credentials'], scope: 'single', ongoing: 'unknown', dept: 'Human Resources', assets: 'Microsoft 365 account',
    rootCause: 'Credential-harvesting page hosted on a compromised legitimate site; the user approved an MFA push.',
    resolution: 'Password reset, all sessions revoked, malicious inbox rule removed. Sign-in logs show no further access.',
    lessons: 'Move from push notifications to number-matching MFA and add a "report phishing" button to Outlook.',
  },
  trojan: {
    category: 'malware',
    title: 'Antivirus alert: trojan detected on finance laptop',
    description:
      'Endpoint protection showed "Trojan:Win32/AgentTesla quarantined" after I opened a ZIP file attached to a supplier email. The laptop is running slowly.',
    c: 1, i: 1, a: 1, data: [], scope: 'single', ongoing: 'no', dept: 'Finance', assets: 'Laptop FIN-LT-023',
    rootCause: 'Malicious attachment in a supplier-themed email; macro execution allowed by legacy policy.',
    resolution: 'Device isolated and re-imaged; IOCs swept across all endpoints with no further hits.',
    lessons: 'Block macros from internet-sourced documents organisation-wide.',
  },
  ransomware: {
    category: 'ransomware',
    title: 'Files renamed with .lockbit extension on the shared drive',
    description:
      'Several folders on the Operations shared drive have files ending in ".lockbit" and a README file demanding payment. Colleagues cannot open spreadsheets. It seems to be spreading.',
    c: 1, i: 3, a: 3, data: ['confidential_business'], scope: 'dozens', ongoing: 'yes', dept: 'Operations', assets: 'File server OPS-FS-01, shared drive O:',
    rootCause: 'Exposed RDP service on a legacy jump host with a reused password; attacker moved laterally to the file server.',
    resolution: 'Hosts isolated, persistence removed, privileged credentials rotated; data restored from offline backups (8 hours of data lost).',
    lessons: 'Remove internet-exposed RDP, enforce MFA on all remote access, and test backup restoration quarterly.',
  },
  wrongRecipient: {
    category: 'data_breach',
    title: 'Customer spreadsheet emailed to the wrong external recipient',
    description:
      'A spreadsheet containing customer names, phone numbers and account balances (about 640 records) was emailed to an external address with a similar name. The recipient has not responded to our recall request.',
    c: 2, i: 0, a: 0, data: ['pii', 'financial'], scope: 'hundreds', ongoing: 'no', dept: 'Customer Service', assets: 'Email, CRM export',
    rootCause: 'Email auto-complete selected an external contact; no data-loss-prevention rule for customer exports.',
    resolution: 'Recipient confirmed deletion in writing; affected customers notified; NDPC notified within 72 hours.',
    lessons: 'Introduce a DLP rule for customer data leaving the organisation and disable auto-complete for external domains.',
  },
  hrPortal: {
    category: 'unauthorized_access',
    title: 'Unknown sign-in to the HR portal from a foreign IP address',
    description:
      'The HR system shows a successful sign-in to my account at 02:14 from an IP address in another country. I was asleep at the time. Staff records may have been viewed.',
    c: 2, i: 1, a: 0, data: ['pii'], scope: 'dozens', ongoing: 'unknown', dept: 'Human Resources', assets: 'HR portal',
    rootCause: 'Password reused from a third-party breach; HR portal did not enforce MFA.',
    resolution: 'Account locked and reset; MFA enforced on the HR portal; access logs reviewed.',
    lessons: 'Enforce MFA on every system holding personal data and subscribe to breached-password monitoring.',
  },
  lostPhone: {
    category: 'lost_device',
    title: 'Company phone left in a ride-hailing car',
    description: 'I left my company phone in a ride-hailing car on the way to a client meeting. It has my email and the CRM app. The phone has a PIN lock.',
    c: 1, i: 0, a: 0, data: ['pii'], scope: 'single', ongoing: 'no', dept: 'Sales & Marketing', assets: 'iPhone SM-PH-117',
    rootCause: 'Device loss; device was encrypted and PIN-protected.',
    resolution: 'Device remotely wiped via MDM; tokens revoked; replacement issued.',
    lessons: 'Remind staff to report lost devices immediately; MDM wipe worked as intended.',
  },
  ddos: {
    category: 'denial_of_service',
    title: 'Public website unreachable during traffic spike',
    description: 'The public website and customer portal are timing out. Monitoring shows a large traffic spike from many IP addresses. Customers are calling to complain.',
    c: 0, i: 0, a: 3, data: [], scope: 'thousands', ongoing: 'yes', dept: 'Information Technology', assets: 'www and customer portal',
    rootCause: 'Volumetric HTTP flood; origin server exposed without CDN protection.',
    resolution: 'Traffic moved behind the CDN with rate limiting; service restored after 3 hours.',
    lessons: 'Keep all public services behind DDoS protection and document the ISP escalation contact.',
  },
  spamMailbox: {
    category: 'account_compromise',
    title: 'My mailbox is sending spam to my contacts',
    description: 'Clients are telling me they received strange emails from me with a payment link. I did not send them. My Sent folder is full of these messages.',
    c: 1, i: 1, a: 0, data: ['credentials'], scope: 'few', ongoing: 'yes', dept: 'Sales & Marketing', assets: 'Outlook mailbox',
    rootCause: 'Session token stolen through an adversary-in-the-middle phishing kit.',
    resolution: 'Sessions revoked, password reset, forwarding rule removed, clients warned.',
    lessons: 'Enable token-protection / conditional access for sign-ins from unmanaged devices.',
  },
  bankCall: {
    category: 'social_engineering',
    title: 'Caller impersonating our bank asked for a transfer OTP',
    description: 'Someone claiming to be from our bank called the finance line and asked me to read out the one-time code they had "just sent" to approve a transfer. I refused and hung up.',
    c: 0, i: 0, a: 0, data: ['financial'], scope: 'single', ongoing: 'no', dept: 'Finance',
    rootCause: 'Targeted vishing attempt using publicly listed finance contact details.',
    resolution: 'Bank alerted; no transaction approved; staff warned about the script used.',
    lessons: 'Good catch by staff; reinforce the "never share OTPs" rule in finance onboarding.',
  },
  insider: {
    category: 'insider_threat',
    title: 'Departing employee downloaded the client database',
    description: 'DLP alert: a sales employee serving notice exported the full client list (about 900 contacts) to a personal cloud storage account the day before leaving.',
    c: 2, i: 0, a: 0, data: ['pii', 'confidential_business'], scope: 'hundreds', ongoing: 'no', dept: 'Sales & Marketing', assets: 'CRM, personal cloud storage',
    rootCause: 'Leaver retained broad CRM export rights during the notice period.',
    resolution: 'HR and Legal engaged; data returned and deletion certified; access removed.',
    lessons: 'Restrict bulk exports and review access as soon as resignation is received.',
  },
  wordpress: {
    category: 'vulnerability',
    title: 'Outdated plugin with a known exploit on the events microsite',
    description: 'A routine scan flagged that the events microsite runs a WordPress form plugin with a publicly known remote-code-execution vulnerability.',
    c: 0, i: 1, a: 0, data: [], scope: 'unknown', ongoing: 'no', dept: 'Information Technology', assets: 'events.example.org',
    rootCause: 'Microsite outside the patch management process.',
    resolution: 'Plugin updated; site added to the monthly patch cycle; no signs of exploitation.',
    lessons: 'Keep an inventory of all web properties, including campaign microsites.',
  },
  stickyNote: {
    category: 'policy_violation',
    title: 'Password written on a sticky note at reception',
    description: 'The reception PC has a sticky note with the visitor-system password on the monitor, visible to visitors.',
    c: 1, i: 0, a: 0, data: ['credentials'], scope: 'single', ongoing: 'no', dept: 'Administration', assets: 'Reception PC',
    rootCause: 'Shared account with a complex password and no password manager.',
    resolution: 'Password changed; shared account replaced with named accounts.',
    lessons: 'Provide a password manager for front-desk staff.',
  },
  invoice: {
    category: 'phishing',
    title: 'Fake invoice with a macro-enabled attachment',
    description: 'Got an "overdue invoice" email from a supplier we do not use, with an .xlsm attachment. Two colleagues received the same email.',
    c: 0, i: 0, a: 0, data: [], scope: 'few', ongoing: 'no', dept: 'Finance',
    rootCause: 'Commodity malspam campaign.',
    resolution: 'Attachment hash blocked; messages purged; no one opened it.',
    lessons: 'Awareness training is working: three independent reports within an hour.',
  },
  usb: {
    category: 'malware',
    title: 'Unknown USB drive found plugged into a warehouse PC',
    description: 'A USB drive labelled "Salaries 2026" was found plugged into the warehouse dispatch PC. Nobody knows who left it.',
    c: 1, i: 1, a: 0, data: [], scope: 'single', ongoing: 'unknown', dept: 'Operations', assets: 'Dispatch PC OPS-PC-07',
    rootCause: 'USB baiting; removable media not blocked on shop-floor PCs.',
    resolution: 'Drive analysed in a sandbox (contained a keylogger); PC re-imaged.',
    lessons: 'Block removable storage on shared PCs via device control policy.',
  },
  healthLink: {
    category: 'data_breach',
    title: 'Staff medical records visible through a public sharing link',
    description: 'A folder of staff sick-note scans was shared with "anyone with the link" and the link was posted in a group chat that includes contractors.',
    c: 2, i: 0, a: 0, data: ['health', 'pii'], scope: 'dozens', ongoing: 'no', dept: 'Human Resources', assets: 'Cloud storage folder',
    rootCause: 'Default sharing setting allowed anonymous links.',
    resolution: 'Link revoked; access logs show 3 external views; affected staff informed.',
    lessons: 'Disable anonymous sharing links tenant-wide for HR sites.',
  },
  kiosk: {
    category: 'other',
    title: 'Strange pop-ups on the reception visitor kiosk',
    description: 'The visitor sign-in kiosk keeps showing pop-ups for "system cleaner" software and the browser homepage has changed.',
    c: 0, i: 1, a: 1, data: [], scope: 'single', ongoing: 'unknown', dept: 'Administration', assets: 'Visitor kiosk',
    rootCause: 'Adware bundled with a browser extension installed by a visitor.',
    resolution: 'Kiosk locked down in kiosk mode; extension removed.',
    lessons: 'Kiosks must run in locked-down mode with no extension installs.',
  },
};

// ───────────────────────────── Workflow simulation ─────────────────────────────

type Plan = { tpl: string; reporter: string; ageHours: number; target: Status; assignee?: string; notify?: 'on_time' | 'late' | 'none' };

const STEP_DELAY: Record<string, [number, number]> = {
  triaged: [0.1, 5],
  investigating: [0.2, 2],
  contained: [1, 14],
  eradicated: [2, 24],
  recovered: [2, 24],
  closed: [1, 30],
  rejected: [0.5, 6],
};

const NOTES: Partial<Record<Status, string[]>> = {
  triaged: ['Thanks for reporting. We have reviewed your report and are looking into it.', 'Report confirmed and prioritised.'],
  investigating: ['An analyst is now investigating.', 'Investigation started; we may contact you for more detail.'],
  contained: ['The threat has been contained and is no longer spreading.', 'Affected accounts and devices have been isolated.'],
  eradicated: ['The root cause has been removed.'],
  recovered: ['Affected systems have been restored and are being monitored.'],
  closed: ['This incident is now resolved. Thank you for reporting it promptly.'],
  rejected: ['Reviewed: this was a legitimate message from an approved supplier, not a security incident.', 'Duplicate of an existing report; tracking there.'],
};

async function progress(id: number, createdAt: number, plan: Plan, people: Record<string, User>, tpl: Template) {
  const steps: Status[] = plan.target === 'rejected' ? ['rejected'] : LIFECYCLE.slice(1, LIFECYCLE.indexOf(plan.target) + 1);
  const assignee = plan.assignee ? people[plan.assignee] : undefined;
  const actor = assignee ?? people.analyst;
  let t = createdAt;
  const patch: Partial<typeof incidents.$inferInsert> = {};
  let reached: Status = 'new';

  for (const step of steps) {
    const [lo, hi] = STEP_DELAY[step];
    const next = t + between(lo, hi) * HOUR;
    if (next > NOW - 5 * MIN) break;
    t = next;
    reached = step;
    if (step === 'triaged' || step === 'rejected') patch.acknowledgedAt = iso(t);
    if (step === 'triaged' && assignee) {
      patch.assigneeId = assignee.id;
      await db.insert(incidentEvents).values({ incidentId: id, actorId: people.manager.id, type: 'assignment', body: `Assigned to ${assignee.fullName}.`, createdAt: iso(t + MIN) }).run();
    }
    if (step === 'contained') patch.containedAt = iso(t);
    if (step === 'recovered') patch.recoveredAt = iso(t);
    if (step === 'closed' || step === 'rejected') patch.closedAt = iso(t);
    await db.insert(incidentEvents)
      .values({ incidentId: id, actorId: step === 'closed' && plan.assignee ? people.manager.id : actor.id, type: 'status_change', visibility: 'public', body: pick(NOTES[step] ?? ['']), meta: { from: steps[steps.indexOf(step) - 1] ?? 'new', to: step }, createdAt: iso(t) })
      .run();
    if (step === 'investigating' && rand() < 0.6) {
      await db.insert(incidentEvents)
        .values({ incidentId: id, actorId: actor.id, type: 'comment', visibility: 'internal', body: 'Initial analysis: reviewed logs and preserved evidence. Scope appears limited to the systems in the report.', createdAt: iso(t + 40 * MIN) })
        .run();
    }
  }

  if (reached === 'closed') {
    patch.resolutionSummary = tpl.resolution;
    patch.rootCause = tpl.rootCause;
    patch.lessonsLearned = tpl.lessons;
  }

  // Playbook progress proportional to the stage reached.
  const tasks = await db.select().from(incidentTasks).where(eq(incidentTasks.incidentId, id)).all();
  const ratio = reached === 'closed' ? 1 : reached === 'rejected' ? 0 : Math.max(0, LIFECYCLE.indexOf(reached) - 1) / 6;
  for (const [k, task] of tasks.slice(0, Math.round(tasks.length * ratio)).entries()) {
    await db
      .update(incidentTasks)
      .set({ status: reached === 'closed' && k % 7 === 6 ? 'not_applicable' : 'done', completedBy: actor.id, completedAt: iso(Math.min(t, createdAt + (k + 1) * HOUR)) })
      .where(eq(incidentTasks.id, task.id))
      .run();
  }

  // Regulator notification for personal-data breaches.
  const inc = (await db.select().from(incidents).where(eq(incidents.id, id)).get())!;
  if (inc.breachNotifiable && plan.notify && plan.notify !== 'none') {
    const at = createdAt + (plan.notify === 'on_time' ? between(20, 60) : between(80, 110)) * HOUR;
    if (at < NOW) {
      patch.notifiedAt = iso(at);
      patch.notificationRef = `NDPC/BR/${new Date(at).getFullYear()}/${String(100 + id).padStart(4, '0')}`;
      await db.insert(incidentEvents).values({ incidentId: id, actorId: people.manager.id, type: 'compliance', body: `Regulator notified: ${inc.notificationAuthority} (ref. ${patch.notificationRef})`, createdAt: iso(at) }).run();
    }
  }

  await db.update(incidents).set({ status: reached, ...patch, updatedAt: iso(t) }).where(eq(incidents.id, id)).run();
}

export type SeedResult = { skipped: boolean; users: number; incidents: number; escalated: number };

export async function seedDemoData(log: (msg: string) => void = () => {}): Promise<SeedResult> {
  db = await getDb();
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_ADMIN_EMAIL)).get()) {
    log('[seed] Demo accounts already exist; nothing to do.');
    return { skipped: true, users: 0, incidents: 0, escalated: 0 };
  }
  // Fresh, deterministic timeline relative to "now" on every run.
  NOW = Date.now();
  seed = 20261113;

  await recordAudit({ actor: null }, { action: 'system.seed_started', details: { note: 'Demo data generated by src/server/demo-seed.ts' } });
  const people = await seedUsers();
  log(`[seed] Created ${PEOPLE.length} users (password for all: ${DEMO_PASSWORD})`);

  // Hand-placed scenarios that make every screen interesting.
  const plans: Plan[] = [
    { tpl: 'payrollPhish', reporter: 'staff', ageHours: 0.3, target: 'new' },
    { tpl: 'ddos', reporter: 'daniel', ageHours: 2.5, target: 'investigating', assignee: 'analyst2' },
    { tpl: 'ransomware', reporter: 'yusuf', ageHours: 7, target: 'contained', assignee: 'analyst' },
    { tpl: 'wrongRecipient', reporter: 'daniel', ageHours: 30, target: 'investigating', assignee: 'analyst', notify: 'none' },
    { tpl: 'hrPortal', reporter: 'grace', ageHours: 4 * 24, target: 'contained', assignee: 'analyst2', notify: 'none' },
    { tpl: 'trojan', reporter: 'staff', ageHours: 9 * 24, target: 'investigating', assignee: 'analyst2' },
    { tpl: 'spamMailbox', reporter: 'ngozi', ageHours: 5, target: 'triaged', assignee: 'analyst' },
    { tpl: 'credsPhish', reporter: 'grace', ageHours: 1.2, target: 'new' },
    { tpl: 'stickyNote', reporter: 'daniel', ageHours: 20, target: 'new' },
    { tpl: 'invoice', reporter: 'staff', ageHours: 3 * 24, target: 'rejected', assignee: 'analyst' },
    { tpl: 'kiosk', reporter: 'daniel', ageHours: 12 * 24, target: 'rejected', assignee: 'analyst2' },
    { tpl: 'healthLink', reporter: 'grace', ageHours: 18 * 24, target: 'closed', assignee: 'analyst', notify: 'on_time' },
    { tpl: 'insider', reporter: 'ngozi', ageHours: 26 * 24, target: 'closed', assignee: 'manager', notify: 'late' },
    { tpl: 'wrongRecipient', reporter: 'daniel', ageHours: 41 * 24, target: 'closed', assignee: 'analyst', notify: 'on_time' },
  ];

  // Background volume over the last 60 days.
  const routine: (keyof typeof T)[] = ['payrollPhish', 'invoice', 'credsPhish', 'trojan', 'lostPhone', 'usb', 'bankCall', 'wordpress', 'kiosk', 'stickyNote', 'spamMailbox', 'invoice', 'payrollPhish'];
  const reporters = ['staff', 'grace', 'yusuf', 'ngozi', 'daniel'];
  for (let k = 0; k < 33; k++) {
    const ageHours = between(1.5, 60) * 24;
    const tpl = pick(routine);
    const target: Status = rand() < 0.12 ? 'rejected' : ageHours > 10 * 24 ? (rand() < 0.88 ? 'closed' : pick(['recovered', 'eradicated'] as const)) : pick(['investigating', 'contained', 'eradicated', 'recovered', 'closed'] as const);
    plans.push({ tpl, reporter: pick(reporters), ageHours, target, assignee: pick(['analyst', 'analyst', 'analyst2', 'analyst2', 'manager']), notify: 'on_time' });
  }
  plans.sort((a, b) => b.ageHours - a.ageHours); // oldest first → references in date order

  for (const plan of plans) {
    const tpl = T[plan.tpl];
    const createdAt = NOW - plan.ageHours * HOUR;
    const reporter = people[plan.reporter];
    const input: NewIncidentInput = {
      title: tpl.title,
      category: tpl.category,
      description: tpl.description,
      detectedAt: iso(createdAt - between(5, 90) * MIN),
      department: tpl.dept,
      affectedAssets: tpl.assets ?? '',
      confidentiality: tpl.c,
      integrity: tpl.i,
      availability: tpl.a,
      dataTypes: tpl.data,
      scope: tpl.scope,
      ongoing: tpl.ongoing,
    };
    const { id } = await createIncident(reporter, input, [], { actor: reporter, ip: '10.20.0.15', userAgent: 'seed-script' }, { createdAt: iso(createdAt) });
    await progress(id, createdAt, plan, people, tpl);
  }
  log(`[seed] Created ${plans.length} incidents across the last 60 days`);

  // A reporter message and a reply on the live ransomware case.
  const ransomware = await db.select().from(incidents).where(eq(incidents.category, 'ransomware')).get();
  if (ransomware) {
    await db.insert(incidentEvents)
      .values([
        { incidentId: ransomware.id, actorId: people.yusuf.id, type: 'comment', visibility: 'public', body: 'The dispatch spreadsheet we need for today is also affected. Is there a backup?', createdAt: iso(NOW - 3 * HOUR) },
        { incidentId: ransomware.id, actorId: people.analyst.id, type: 'comment', visibility: 'public', body: 'Yes, last night\'s offline backup is clean. We expect to restore the dispatch folder within 2 hours.', createdAt: iso(NOW - 2.5 * HOUR) },
      ])
      .run();
  }

  // Escalate overdue SLAs exactly as the live scheduler would.
  const escalated = await runSlaEscalations();
  log(`[seed] Escalated ${escalated} SLA breach(es)`);

  // Brute-force simulation against one account → lockout (shows in admin + audit).
  const meta = { ip: '203.0.113.45', userAgent: 'python-requests/2.32', requestId: null };
  for (let k = 0; k < 5; k++) await authenticate(people.ngozi.email, `guess-${k}-password`, meta);
  log('[seed] Simulated a password-guessing attack → ngozi.uche@cirp.local is locked');

  // Keep only the most recent notifications unread.
  const recent = (await db.select({ id: notifications.id }).from(notifications).all()).map((n) => n.id).sort((a, b) => b - a);
  const old = recent.slice(25);
  if (old.length) await db.update(notifications).set({ isRead: true }).where(inArray(notifications.id, old)).run();

  await recordAudit({ actor: null }, { action: 'system.seed_completed', details: { users: PEOPLE.length, incidents: plans.length } });
  log('[seed] Done. Start the app with "npm run dev" and sign in with any demo account.');
  return { skipped: false, users: PEOPLE.length, incidents: plans.length, escalated };
}
