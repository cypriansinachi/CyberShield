import 'server-only';
/**
 * Demo data for presentations and testing: Nexora team accounts for every
 * role, customer accounts, and ~45 realistic incidents (mostly problems that
 * customers noticed) spread over the last 60 days, progressed through the
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
import { ORG_NAME, SERVICES } from '@/lib/constants';

export const DEMO_PASSWORD = 'Demo@Passw0rd!';
export const DEMO_ADMIN_EMAIL = 'admin@nexora.local';

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

// Nexora's security team (and an administrator and auditor), plus Nexora customers.
// Customer addresses use example.com, a domain reserved for documentation.
const PEOPLE: { key: string; name: string; email: string; role: Role; dept: string | null }[] = [
  { key: 'admin', name: 'Adaeze Okonkwo', email: 'admin@nexora.local', role: 'admin', dept: 'Information Technology' },
  { key: 'manager', name: 'Tunde Bakare', email: 'manager@nexora.local', role: 'manager', dept: 'Security Operations' },
  { key: 'analyst', name: 'Chiamaka Eze', email: 'analyst@nexora.local', role: 'analyst', dept: 'Security Operations' },
  { key: 'analyst2', name: 'Ibrahim Musa', email: 'ibrahim.musa@nexora.local', role: 'analyst', dept: 'Security Operations' },
  { key: 'auditor', name: 'Funmilayo Adeyemi', email: 'auditor@nexora.local', role: 'auditor', dept: 'Legal & Compliance' },
  { key: 'customer', name: 'Emeka Nwosu', email: 'customer@example.com', role: 'reporter', dept: null },
  { key: 'grace', name: 'Grace Okafor', email: 'grace.okafor@example.com', role: 'reporter', dept: null },
  { key: 'yusuf', name: 'Yusuf Bello', email: 'yusuf.bello@example.com', role: 'reporter', dept: null },
  { key: 'ngozi', name: 'Ngozi Uche', email: 'ngozi.uche@example.com', role: 'reporter', dept: null },
  { key: 'daniel', name: 'Daniel Adebayo', email: 'daniel.adebayo@example.com', role: 'reporter', dept: null },
];
const CUSTOMERS = ['customer', 'grace', 'yusuf', 'ngozi', 'daniel'];
const TEAM_REPORTERS = ['analyst', 'analyst2', 'manager', 'admin'];

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
  service: (typeof SERVICES)[number];
  /** Reported by Nexora's own team rather than by a customer. */
  team?: boolean;
  assets?: string;
  rootCause: string;
  resolution: string;
  lessons: string;
};

const T: Record<string, Template> = {
  // ── Reported by customers ──
  fakeEmail: {
    category: 'phishing',
    title: 'Email saying my Nexora account will be suspended',
    description:
      'I received an email from "support@nex0ra-verify.com" saying my Nexora account will be suspended in 24 hours unless I confirm my details through a link. The link opens a page that looks like the Nexora sign-in page. I did not enter anything.',
    c: 0, i: 0, a: 0, data: [], scope: 'single', ongoing: 'no', service: `Emails, texts & calls from ${ORG_NAME}`, assets: 'Sender: support@nex0ra-verify.com',
    rootCause: 'Look-alike domain registered to impersonate Nexora in a bulk phishing campaign.',
    resolution: 'Look-alike domain taken down through the registrar, the phishing URL added to browser safe-browsing lists, and a scam alert published for customers.',
    lessons: 'Register common look-alike domains defensively and keep DMARC at "reject" so our real domain cannot be spoofed.',
  },
  smsScam: {
    category: 'phishing',
    title: 'Text message from "Nexora" asking me to pay a delivery fee',
    description: 'I got an SMS signed "Nexora" saying a parcel could not be delivered and asking me to pay a small fee through a link. I have never ordered anything that needs delivery.',
    c: 0, i: 0, a: 0, data: [], scope: 'single', ongoing: 'unknown', service: `Emails, texts & calls from ${ORG_NAME}`, assets: 'SMS from +234 901 000 0000',
    rootCause: 'Smishing campaign using the Nexora name; not sent through our messaging provider.',
    resolution: 'Sender ID and link reported to the mobile networks and blocked; customers reminded that Nexora never charges fees by SMS.',
    lessons: 'Register the "Nexora" sender ID with the networks so look-alike sender IDs are rejected.',
  },
  fakeLogin: {
    category: 'phishing',
    title: 'I entered my password on a fake Nexora sign-in page',
    description:
      'I clicked a link in an email about a "security update" and typed my Nexora email and password before I noticed the web address was wrong. I have now changed my password but I am worried someone used it.',
    c: 2, i: 0, a: 0, data: ['credentials'], scope: 'single', ongoing: 'unknown', service: 'Customer account & sign-in', assets: 'My Nexora account',
    rootCause: 'Credential-harvesting page; the customer did not have two-step verification turned on.',
    resolution: 'All sessions revoked and password reset confirmed. Sign-in history shows no access by the attacker; phishing site taken down.',
    lessons: 'Prompt customers to turn on two-step verification after any password change.',
  },
  takeover: {
    category: 'account_compromise',
    title: 'Someone changed the email and phone number on my account',
    description:
      'I got a message saying the email address on my Nexora account had been changed, and now I cannot sign in. The phone number has also been changed. My card is saved on the account.',
    c: 2, i: 2, a: 1, data: ['pii', 'financial'], scope: 'single', ongoing: 'yes', service: 'Customer account & sign-in', assets: 'My Nexora account',
    rootCause: 'Credential stuffing: the customer reused a password exposed in an unrelated breach; no alert was required before changing contact details.',
    resolution: 'Account restored to the customer, attacker sessions revoked, contact details reverted. No payments were made with the saved card.',
    lessons: 'Check new passwords against breached-password lists and require re-verification before email or phone changes.',
  },
  cardFraud: {
    category: 'account_compromise',
    title: 'Purchases on my account that I did not make',
    description: 'Three purchases appeared on my Nexora account this morning using my saved card. I was not using the app at the time and I still have my phone.',
    c: 1, i: 1, a: 0, data: ['financial'], scope: 'single', ongoing: 'unknown', service: 'Payments & billing', assets: 'Orders #88412, #88413, #88415',
    rootCause: 'Session cookie stolen by a malicious browser extension installed on the customer’s laptop.',
    resolution: 'Orders cancelled and refunded, sessions revoked, card token replaced. Customer advised to remove the extension.',
    lessons: 'Bind sessions to the device and require re-authentication for purchases from a new location.',
  },
  otherData: {
    category: 'data_breach',
    title: "I can see another customer's orders and address in my account",
    description:
      'After signing in today, my order history shows orders I never placed, with someone else’s name and home address. Refreshing the page sometimes shows a different person’s details.',
    c: 2, i: 0, a: 0, data: ['pii'], scope: 'hundreds', ongoing: 'yes', service: 'Website', assets: 'Order history page',
    rootCause: 'A release changed a CDN rule so personalised account pages were cached and served to other signed-in customers.',
    resolution: 'Cache rule rolled back and the cache purged. 412 customers’ pages were exposed; the NDPC and affected customers were notified.',
    lessons: 'Never cache authenticated responses; add an automated check for cache headers to the release pipeline.',
  },
  chatLeak: {
    category: 'data_breach',
    title: "Support chat sent me another customer's conversation",
    description: 'While chatting with support, a transcript appeared that belonged to someone else. It had their name, phone number and the last four digits of their card.',
    c: 2, i: 0, a: 0, data: ['pii', 'financial'], scope: 'few', ongoing: 'no', service: 'Customer support', assets: 'Live chat widget',
    rootCause: 'Race condition in the chat vendor’s session handling when two chats started within the same second.',
    resolution: 'Vendor patched the widget; three customers’ transcripts were exposed, and they were informed. NDPC notified.',
    lessons: 'Include customer-data isolation tests in vendor security reviews.',
  },
  resetBug: {
    category: 'vulnerability',
    title: 'Password-reset links never expire',
    description:
      'I am a software developer. A password-reset link Nexora sent me three weeks ago still works, and it can be used more than once. Anyone who gets hold of an old reset email could take over the account.',
    c: 1, i: 1, a: 0, data: [], scope: 'thousands', ongoing: 'no', service: 'Customer account & sign-in', assets: 'Password-reset flow',
    rootCause: 'Reset tokens were stored without an expiry time or a used flag.',
    resolution: 'Reset tokens now expire after 30 minutes and work once. Logs show no misuse. The reporter was thanked in our security acknowledgements.',
    lessons: 'Add token lifecycle tests and publish a vulnerability disclosure policy so researchers know how to report.',
  },
  apiIdor: {
    category: 'vulnerability',
    title: "Partner API returns other customers' orders if I change the ID",
    description: 'While building an integration I noticed that GET /v1/orders/{id} returns any order when I change the number, not only orders that belong to my account.',
    c: 1, i: 0, a: 0, data: ['pii'], scope: 'thousands', ongoing: 'yes', service: 'Partner & developer APIs', assets: 'GET /v1/orders/{id}',
    rootCause: 'Missing object-level authorisation check on the orders endpoint (IDOR).',
    resolution: 'Ownership check added and deployed. API logs show no access beyond the reporter’s own test requests.',
    lessons: 'Write an object-level authorisation test for every API endpoint that takes an ID.',
  },
  fakeApp: {
    category: 'malware',
    title: 'Fake "Nexora Wallet" app asked for my card details',
    description: 'I downloaded an app called "Nexora Wallet" from a third-party app store. It asked for my full card number and PIN, which the real app has never done. I uninstalled it.',
    c: 1, i: 0, a: 0, data: ['financial'], scope: 'dozens', ongoing: 'yes', service: 'Mobile app', assets: 'App "Nexora Wallet"',
    rootCause: 'Brand-impersonating app published to a third-party store to harvest card details.',
    resolution: 'Takedown request accepted and the app removed within 48 hours; customers warned to install only from official stores.',
    lessons: 'Monitor app stores for brand impersonation and link to the official app from the website.',
  },
  supportCall: {
    category: 'social_engineering',
    title: 'Caller pretending to be Nexora support asked for my one-time code',
    description: 'Someone called saying they were from Nexora support and that my account had been hacked. They asked me to read out the code sent to my phone. I refused and hung up.',
    c: 0, i: 0, a: 0, data: ['credentials'], scope: 'single', ongoing: 'no', service: `Emails, texts & calls from ${ORG_NAME}`,
    rootCause: 'Vishing campaign using customer phone numbers leaked in an unrelated breach.',
    resolution: 'No code was shared. Scam alert sent to customers and the support team briefed on the script being used.',
    lessons: 'Keep reminding customers that Nexora never asks for one-time codes; add the warning to the OTP text itself.',
  },
  outage: {
    category: 'denial_of_service',
    title: 'Website and app not loading for over an hour',
    description: 'The Nexora website and mobile app have been timing out for over an hour. Friends say the same. I cannot get to my account.',
    c: 0, i: 0, a: 3, data: [], scope: 'thousands', ongoing: 'yes', service: 'Website', assets: 'Website and mobile app',
    rootCause: 'Volumetric HTTP flood against an origin server that was reachable without the CDN.',
    resolution: 'Traffic moved behind the CDN with rate limiting; service restored after 3 hours.',
    lessons: 'Keep every public service behind DDoS protection and publish status updates on a separate status page.',
  },
  legitAlert: {
    category: 'phishing',
    title: 'Email about a new sign-in that I think is fake',
    description: 'I got an email saying there was a new sign-in to my account from Lagos. I did sign in on a new laptop yesterday, but I am not sure the email is real.',
    c: 0, i: 0, a: 0, data: [], scope: 'single', ongoing: 'no', service: `Emails, texts & calls from ${ORG_NAME}`,
    rootCause: 'Genuine Nexora security alert; not an incident.',
    resolution: 'Confirmed as a legitimate Nexora notification.',
    lessons: 'Explain on the help centre how customers can check that a security email is genuine.',
  },
  certWarning: {
    category: 'other',
    title: 'Browser shows a security warning on the Nexora website',
    description: 'When I open the Nexora website at a café my browser says the connection is not private. At home it works fine.',
    c: 0, i: 0, a: 0, data: [], scope: 'single', ongoing: 'unknown', service: 'Website',
    rootCause: 'The café’s Wi-Fi intercepts HTTPS traffic; Nexora’s certificate was valid.',
    resolution: 'Not a Nexora incident; customer advised not to continue past the warning on that network.',
    lessons: 'Add guidance on certificate warnings and public Wi-Fi to the help centre.',
  },

  // ── Reported by the Nexora team ──
  ransomware: {
    category: 'ransomware',
    title: 'Files renamed with .lockbit extension on the support team file server',
    description:
      'Endpoint alerts: files on the customer-support shared drive are being renamed with ".lockbit" and a README demands payment. Support agents cannot open their macros and templates. Encryption still appears to be spreading.',
    c: 1, i: 3, a: 3, data: ['confidential_business'], scope: 'dozens', ongoing: 'yes', service: 'Internal systems', team: true, assets: 'File server SUP-FS-01, shared drive S:',
    rootCause: 'Exposed RDP service on a legacy jump host with a reused password; the attacker moved laterally to the file server.',
    resolution: 'Hosts isolated, persistence removed, privileged credentials rotated; data restored from offline backups (8 hours of data lost).',
    lessons: 'Remove internet-exposed RDP, enforce MFA on all remote access, and test backup restoration quarterly.',
  },
  credStuffing: {
    category: 'unauthorized_access',
    title: 'Credential-stuffing attack against customer sign-in',
    description: 'Sign-in failures rose from about 200 to 45,000 an hour, from thousands of IP addresses, using email and password pairs from public breach lists. 23 customer accounts were signed into successfully.',
    c: 2, i: 1, a: 1, data: ['credentials', 'pii'], scope: 'thousands', ongoing: 'yes', service: 'Customer account & sign-in', team: true, assets: 'Customer sign-in service',
    rootCause: 'Botnet replaying leaked passwords; the sign-in page had no bot protection or breached-password checks.',
    resolution: 'Bot protection and per-account rate limits enabled; the 23 affected accounts locked, reset and their owners contacted.',
    lessons: 'Offer two-step verification to every customer and block known-breached passwords at sign-up.',
  },
  insider: {
    category: 'insider_threat',
    title: 'Departing support agent exported the customer contact list',
    description: 'DLP alert: a support agent serving notice exported about 900 customer contacts from the CRM to a personal cloud storage account the day before leaving.',
    c: 2, i: 0, a: 0, data: ['pii', 'confidential_business'], scope: 'hundreds', ongoing: 'no', service: 'Internal systems', team: true, assets: 'CRM, personal cloud storage',
    rootCause: 'Leaver retained broad CRM export rights during the notice period.',
    resolution: 'HR and Legal engaged; data returned and deletion certified; access removed.',
    lessons: 'Restrict bulk exports and review access as soon as a resignation is received.',
  },
  stolenLaptop: {
    category: 'lost_device',
    title: "Engineer's laptop stolen from a parked car",
    description: 'An engineer’s work laptop was stolen from a parked car. It is encrypted and PIN-protected, and has access to the source code repositories.',
    c: 1, i: 0, a: 0, data: ['intellectual_property'], scope: 'single', ongoing: 'no', service: 'Offices & devices', team: true, assets: 'Laptop ENG-LT-041',
    rootCause: 'Device theft; the disk was encrypted and the device managed by MDM.',
    resolution: 'Device remotely wiped via MDM; repository tokens and SSH keys revoked; replacement issued.',
    lessons: 'Remind staff never to leave devices in vehicles; MDM wipe worked as intended.',
  },
  pluginVuln: {
    category: 'vulnerability',
    title: 'Outdated plugin with a known exploit on the Nexora blog',
    description: 'A routine scan flagged that the Nexora blog runs a WordPress form plugin with a publicly known remote-code-execution vulnerability.',
    c: 0, i: 1, a: 0, data: [], scope: 'unknown', ongoing: 'no', service: 'Website', team: true, assets: 'blog.nexora.example',
    rootCause: 'The blog sat outside the patch management process.',
    resolution: 'Plugin updated; the blog added to the monthly patch cycle; no signs of exploitation.',
    lessons: 'Keep an inventory of every web property, including the blog and campaign sites.',
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
  rejected: ['Reviewed: this was a genuine Nexora message, not a scam. Thank you for checking with us.', 'Duplicate of an existing report; we are tracking it there.'],
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
    { tpl: 'fakeEmail', reporter: 'customer', ageHours: 0.3, target: 'new' },
    { tpl: 'outage', reporter: 'daniel', ageHours: 2.5, target: 'investigating', assignee: 'analyst2' },
    { tpl: 'ransomware', reporter: 'analyst2', ageHours: 7, target: 'contained', assignee: 'analyst' },
    { tpl: 'otherData', reporter: 'yusuf', ageHours: 30, target: 'investigating', assignee: 'analyst', notify: 'none' },
    { tpl: 'takeover', reporter: 'grace', ageHours: 4 * 24, target: 'contained', assignee: 'analyst2', notify: 'none' },
    { tpl: 'fakeApp', reporter: 'customer', ageHours: 9 * 24, target: 'investigating', assignee: 'analyst2' },
    { tpl: 'cardFraud', reporter: 'ngozi', ageHours: 5, target: 'triaged', assignee: 'analyst' },
    { tpl: 'fakeLogin', reporter: 'grace', ageHours: 1.2, target: 'new' },
    { tpl: 'supportCall', reporter: 'daniel', ageHours: 20, target: 'new' },
    { tpl: 'legitAlert', reporter: 'customer', ageHours: 3 * 24, target: 'rejected', assignee: 'analyst' },
    { tpl: 'certWarning', reporter: 'daniel', ageHours: 12 * 24, target: 'rejected', assignee: 'analyst2' },
    { tpl: 'chatLeak', reporter: 'grace', ageHours: 18 * 24, target: 'closed', assignee: 'analyst', notify: 'on_time' },
    { tpl: 'insider', reporter: 'manager', ageHours: 26 * 24, target: 'closed', assignee: 'analyst', notify: 'late' },
    { tpl: 'credStuffing', reporter: 'analyst', ageHours: 41 * 24, target: 'closed', assignee: 'manager', notify: 'on_time' },
  ];

  // Background volume over the last 60 days.
  const routine: (keyof typeof T)[] = ['fakeEmail', 'smsScam', 'fakeLogin', 'supportCall', 'resetBug', 'apiIdor', 'fakeApp', 'cardFraud', 'smsScam', 'fakeEmail', 'stolenLaptop', 'pluginVuln', 'legitAlert'];
  for (let k = 0; k < 33; k++) {
    const ageHours = between(1.5, 60) * 24;
    const tpl = pick(routine);
    const target: Status = rand() < 0.12 ? 'rejected' : ageHours > 10 * 24 ? (rand() < 0.88 ? 'closed' : pick(['recovered', 'eradicated'] as const)) : pick(['investigating', 'contained', 'eradicated', 'recovered', 'closed'] as const);
    const reporter = pick(T[tpl].team ? TEAM_REPORTERS : CUSTOMERS);
    plans.push({ tpl, reporter, ageHours, target, assignee: pick(['analyst', 'analyst', 'analyst2', 'analyst2', 'manager']), notify: 'on_time' });
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
      affectedService: tpl.service,
      affectedAssets: tpl.assets ?? '',
      confidentiality: tpl.c,
      integrity: tpl.i,
      availability: tpl.a,
      dataTypes: tpl.data,
      scope: tpl.scope,
      ongoing: tpl.ongoing,
    };
    // Customers report from the internet; the team from Nexora's own network.
    const ip = tpl.team ? '10.20.0.15' : `198.51.100.${10 + (reporter.id % 200)}`;
    const { id } = await createIncident(reporter, input, [], { actor: reporter, ip, userAgent: 'seed-script' }, { createdAt: iso(createdAt) });
    await progress(id, createdAt, plan, people, tpl);
  }
  log(`[seed] Created ${plans.length} incidents across the last 60 days`);

  // A customer conversation on the account-takeover case, and internal notes on the ransomware case.
  const byTitle = async (title: string) => db.select().from(incidents).where(eq(incidents.title, title)).get();
  const takeover = await byTitle(T.takeover.title);
  if (takeover) {
    await db.insert(incidentEvents)
      .values([
        { incidentId: takeover.id, actorId: people.grace.id, type: 'comment', visibility: 'public', body: 'I still cannot sign in, and my card is saved on the account. Should I cancel it?', createdAt: iso(NOW - 3.5 * DAY) },
        { incidentId: takeover.id, actorId: people.analyst2.id, type: 'comment', visibility: 'public', body: 'Your account is secured and the attacker has been signed out. We have sent a reset link to your original email address. No payments were made with your card, but you can ask your bank for a new one if you prefer.', createdAt: iso(NOW - 3.4 * DAY) },
      ])
      .run();
  }
  const ransomware = await byTitle(T.ransomware.title);
  if (ransomware) {
    await db.insert(incidentEvents)
      .values([
        { incidentId: ransomware.id, actorId: people.manager.id, type: 'comment', visibility: 'internal', body: 'Support can keep answering customers from the CRM while the file server is restored. Is last night\'s backup usable?', createdAt: iso(NOW - 3 * HOUR) },
        { incidentId: ransomware.id, actorId: people.analyst.id, type: 'comment', visibility: 'internal', body: 'Yes, the offline backup is clean. We expect the support shared drive to be restored within 2 hours.', createdAt: iso(NOW - 2.5 * HOUR) },
      ])
      .run();
  }

  // Escalate overdue SLAs exactly as the live scheduler would.
  const escalated = await runSlaEscalations();
  log(`[seed] Escalated ${escalated} SLA breach(es)`);

  // Brute-force simulation against one account → lockout (shows in admin + audit).
  const meta = { ip: '203.0.113.45', userAgent: 'python-requests/2.32', requestId: null };
  for (let k = 0; k < 5; k++) await authenticate(people.ngozi.email, `guess-${k}-password`, meta);
  log(`[seed] Simulated a password-guessing attack → ${people.ngozi.email} is locked`);

  // Keep only the most recent notifications unread.
  const recent = (await db.select({ id: notifications.id }).from(notifications).all()).map((n) => n.id).sort((a, b) => b - a);
  const old = recent.slice(25);
  if (old.length) await db.update(notifications).set({ isRead: true }).where(inArray(notifications.id, old)).run();

  await recordAudit({ actor: null }, { action: 'system.seed_completed', details: { users: PEOPLE.length, incidents: plans.length } });
  log('[seed] Done. Start the app with "npm run dev" and sign in with any demo account.');
  return { skipped: false, users: PEOPLE.length, incidents: plans.length, escalated };
}
