import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, CheckCircle2, Clock, Fingerprint, KeyRound, Landmark, ScrollText, ShieldAlert, XCircle } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge, PageHeader, StatTile, Table } from '@/components/ui/misc';
import { requirePermission } from '@/server/auth/dal';
import { getComplianceOverview } from '@/server/services/analytics';
import { formatDateTime, formatPercent, isPast, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Compliance' };

/** How the platform supports each framework's requirements (control mapping). */
const FRAMEWORKS = [
  {
    name: 'NIST SP 800-61 (Computer Security Incident Handling)',
    controls: [
      ['Detection & Analysis', 'Structured reporting, automatic risk scoring, triage and investigation stages.'],
      ['Containment, Eradication & Recovery', 'Workflow states with category playbooks and task tracking.'],
      ['Post-Incident Activity', 'Mandatory root cause and lessons learned before closure.'],
    ],
  },
  {
    name: 'ISO/IEC 27001:2022 Annex A',
    controls: [
      ['A.5.24 Incident management planning', 'Defined roles (RBAC), severity model, SLAs and playbooks.'],
      ['A.5.25 Assessment of events', 'Explainable risk classification with documented overrides.'],
      ['A.5.26 Response to incidents', 'Enforced workflow, assignment and response checklists.'],
      ['A.5.27 Learning from incidents', 'Lessons learned mandatory for High and Critical incidents.'],
      ['A.5.28 Collection of evidence', 'Encrypted evidence with SHA-256 chain-of-custody and access logging.'],
      ['A.6.8 Event reporting', 'Self-service reporting for every customer, plus internal reporting by the security team.'],
      ['A.8.5 Secure authentication', 'scrypt hashing, lockout, TOTP MFA, session timeouts.'],
      ['A.8.15 Logging', 'Append-only, HMAC hash-chained audit trail with integrity verification.'],
    ],
  },
  {
    name: 'Nigeria Data Protection Act 2023 / GDPR',
    controls: [
      ['NDPA s.40 / GDPR Art. 33', 'Personal-data breaches flagged automatically with a 72-hour regulator deadline.'],
      ['GDPR Art. 33(5) breach register', 'Every breach decision, notification time and reference is recorded.'],
      ['Data minimisation & security', 'Least-privilege access, encryption at rest, no sensitive data in audit details.'],
    ],
  },
  {
    name: 'NIST Cybersecurity Framework 2.0',
    controls: [
      ['RS.MA Incident Management', 'Central queue, prioritisation, assignment and escalation.'],
      ['RS.AN Incident Analysis', 'Risk factors, evidence and investigation notes.'],
      ['RS.CO Reporting & Communication', 'Reporter updates, notifications and regulator tracking.'],
      ['RC.RP Recovery Plan Execution', 'Recovery stage and verification before closure.'],
    ],
  },
];

export default async function CompliancePage() {
  await requirePermission('compliance.view');
  const c = await getComplianceOverview();

  return (
    <>
      <PageHeader
        title="Compliance overview"
        description="Live evidence that incident handling meets policy and regulatory obligations. Suitable for internal audit and regulator enquiries."
      />

      {c.breach.overdue > 0 && (
        <Alert tone="error" title={`${c.breach.overdue} breach notification(s) overdue`} className="mb-6">
          The {c.notificationHours}-hour deadline to notify the {c.regulator} has passed. Record the notification on each incident below.
        </Alert>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Notified on time"
          value={formatPercent(c.breach.onTimeRate)}
          tone={c.breach.late ? 'serious' : 'good'}
          icon={<Landmark />}
          sub={`${c.breach.on_time} on time · ${c.breach.late} late`}
        />
        <StatTile label="Pending notices" value={c.breach.pending + c.breach.overdue} tone={c.breach.overdue ? 'critical' : undefined} icon={<Clock />} sub={`${c.breach.overdue} overdue`} />
        <StatTile label="Lessons learned" value={formatPercent(c.lessons.rate)} icon={<BadgeCheck />} sub={`${c.lessons.documented} of ${c.lessons.total} closed High/Critical`} />
        <StatTile label="Acknowledge SLA" value={formatPercent(c.sla.ackRate)} icon={<Clock />} sub={`${c.sla.ackTotal} acknowledged · 90 d`} />
        <StatTile label="Resolution SLA" value={formatPercent(c.sla.resolveRate)} icon={<CheckCircle2 />} sub={`${c.sla.resolveTotal} closed · 90 d`} />
        <StatTile
          label="Privileged MFA"
          value={formatPercent(c.mfa.rate)}
          tone={c.mfa.rate !== null && c.mfa.rate < 100 ? 'serious' : 'good'}
          icon={<KeyRound />}
          sub={`${c.mfa.enrolled} of ${c.mfa.total} · ${c.mfa.enforced ? 'enforced' : 'not enforced'}`}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Personal-data breach register" description={`Incidents requiring notification to the ${c.regulator}`} icon={<Landmark />} />
          {c.pendingBreaches.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Deadline</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {c.pendingBreaches.map((b) => {
                  const overdue = isPast(b.notification_due_at);
                  return (
                    <tr key={b.id}>
                      <td>
                        <Link href={`/incidents/${b.id}`} className="font-medium hover:text-primary">
                          {b.title}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">{b.reference}</span>
                      </td>
                      <td className="text-sm">
                        {formatDateTime(b.notification_due_at)}
                        <span className="block text-xs text-muted-foreground">{timeAgo(b.notification_due_at)}</span>
                      </td>
                      <td>{overdue ? <Badge tone="critical">Overdue</Badge> : <Badge tone="warning">Pending</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <CardBody className="flex items-center gap-2 text-sm text-good-ink">
              <CheckCircle2 className="size-4" aria-hidden /> All notifiable breaches have been reported to the regulator.
            </CardBody>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Audit trail integrity" icon={<Fingerprint />} />
            <CardBody className="text-sm">
              {c.auditChain.ok ? (
                <p className="flex items-start gap-2 text-good-ink">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Verified: {c.auditChain.checked.toLocaleString('en')} entries intact.
                    <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">head {c.auditChain.headHash}</span>
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2 text-critical-ink">
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Chain broken at entry #{c.auditChain.brokenAt}: {c.auditChain.reason}
                </p>
              )}
              <Link href="/audit" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <ScrollText className="size-3.5" aria-hidden /> Open audit log
              </Link>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Access control hygiene" icon={<ShieldAlert />} />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {[
                  ['Accounts currently locked', c.accounts.locked],
                  ['Deactivated accounts', c.accounts.inactive],
                  ['Dormant accounts (90 d no sign-in)', c.accounts.dormant],
                  ['Pending password change', c.accounts.must_change],
                  ['Failed sign-ins (24 h)', c.auth.failed24],
                  ['Failed sign-ins (7 d)', c.auth.failed7],
                  ['Denied access attempts (7 d)', c.auth.denied7],
                ].map(([label, v]) => (
                  <li key={label as string} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums">{v}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Control mapping</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        {FRAMEWORKS.map((f) => (
          <Card key={f.name}>
            <CardHeader title={f.name} />
            <ul className="divide-y divide-border">
              {f.controls.map(([control, how]) => (
                <li key={control} className={cn('grid gap-1 px-5 py-3 text-sm sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4')}>
                  <span className="font-medium">{control}</span>
                  <span className="text-muted-foreground">{how}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
