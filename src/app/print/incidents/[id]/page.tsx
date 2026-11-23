import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintButton } from './print-button';
import { auditContextFor, requireUser } from '@/server/auth/dal';
import { getIncidentDetail } from '@/server/services/incidents';
import { recordAudit } from '@/server/audit';
import { CATEGORIES, DATA_TYPES, ONGOING, SCOPES, SEVERITIES } from '@/lib/risk';
import { STATUSES, slaStatus } from '@/lib/workflow';
import { APP_FULL_NAME } from '@/lib/constants';
import { ROLES } from '@/lib/rbac';
import { formatBytes, formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Incident report' };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr className="border-b border-neutral-200 align-top">
      <th className="w-48 py-1.5 pr-4 text-left font-medium text-neutral-500">{k}</th>
      <td className="whitespace-pre-wrap py-1.5">{v ?? '—'}</td>
    </tr>
  );
}

/** Printable / "Save as PDF" incident report for management, auditors and regulators. */
export default async function PrintIncidentPage({ params }: PageProps<'/print/incidents/[id]'>) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const ctx = await auditContextFor(user);
  const d = await getIncidentDetail(Number(id), user, ctx);
  if (!d) notFound();
  const i = d.incident;
  await recordAudit(ctx, { action: 'incident.report_generated', entityType: 'incident', entityId: i.id, details: { reference: i.reference } });
  const sla = slaStatus(i);

  return (
    <div className="mx-auto max-w-3xl bg-white px-8 py-10 text-[13px] leading-relaxed text-neutral-900 print:px-0 print:py-0">
      <div className="no-print mb-6 flex justify-end">
        <PrintButton />
      </div>
      <header className="border-b-2 border-neutral-900 pb-4">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          {APP_FULL_NAME}
        </p>
        <h1 className="mt-1 text-xl font-bold">Incident report: {i.reference}</h1>
        <p className="mt-1 text-sm">{i.title}</p>
        <p className="mt-2 text-xs text-neutral-500">
          Generated {formatDateTime(new Date().toISOString())} by {user.fullName} · CONFIDENTIAL · contains security-sensitive information
        </p>
      </header>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Summary</h2>
      <table className="mt-2 w-full">
        <tbody>
          <Row k="Status" v={`${STATUSES[i.status].label} (${STATUSES[i.status].phase})`} />
          <Row k="Severity / priority" v={`${SEVERITIES[i.severity].label} / ${i.priority}${i.severityOverridden ? ` (manually set; calculated ${SEVERITIES[i.computedSeverity].label})` : ''}`} />
          <Row k="Risk score" v={`${i.riskScore} / 100`} />
          <Row k="Category" v={CATEGORIES[i.category].label} />
          <Row k="Reported by" v={d.reporter ? `${d.reporter.fullName} (${ROLES[d.reporter.role].label})` : '—'} />
          <Row k="Assigned to" v={d.assignee?.fullName ?? 'Unassigned'} />
          <Row k="Discovered" v={formatDateTime(i.detectedAt)} />
          <Row k="Reported" v={formatDateTime(i.createdAt)} />
          <Row k="Acknowledged" v={`${formatDateTime(i.acknowledgedAt)} (SLA ${sla.ack})`} />
          <Row k="Contained" v={formatDateTime(i.containedAt)} />
          <Row k="Closed" v={`${formatDateTime(i.closedAt)} (resolution SLA ${sla.resolve})`} />
        </tbody>
      </table>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Description</h2>
      <p className="mt-2 whitespace-pre-wrap">{i.description}</p>
      <table className="mt-3 w-full">
        <tbody>
          <Row k="Affected service" v={i.affectedService} />
          <Row k="Affected accounts / devices" v={i.affectedAssets} />
          <Row k="Data involved" v={i.dataTypes.length ? i.dataTypes.map((t) => DATA_TYPES[t].label).join('; ') : 'None reported'} />
          <Row k="Scope" v={SCOPES[i.affectedScope].label} />
          <Row k="Still active (at report)" v={ONGOING[i.ongoing].label} />
        </tbody>
      </table>

      {d.staffView && (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Risk assessment</h2>
          <table className="mt-2 w-full">
            <tbody>
              {i.riskFactors.factors.map((f) => (
                <Row key={f.key} k={f.label} v={`${f.points}/${f.max}: ${f.detail}`} />
              ))}
              {i.riskFactors.rules.map((r) => (
                <Row key={r.id} k={`Rule ${r.id}`} v={r.description} />
              ))}
              {i.overrideReason && <Row k="Override justification" v={i.overrideReason} />}
            </tbody>
          </table>

          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Regulatory notification</h2>
          <table className="mt-2 w-full">
            <tbody>
              <Row k="Notifiable breach" v={i.breachNotifiable ? 'Yes' : 'No'} />
              {i.breachNotifiable && <Row k="Deadline" v={formatDateTime(i.notificationDueAt)} />}
              {i.notifiedAt && <Row k="Notified" v={`${formatDateTime(i.notifiedAt)}, ${i.notificationAuthority}, ref. ${i.notificationRef}`} />}
            </tbody>
          </table>

          {d.tasks.length > 0 && (
            <>
              <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Response actions</h2>
              <ul className="mt-2 space-y-0.5">
                {d.tasks.map((t) => (
                  <li key={t.id}>
                    [{t.status === 'done' ? 'x' : t.status === 'not_applicable' ? 'n/a' : ' '}] {t.phase}: {t.title}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {i.status === 'closed' && (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Post-incident review</h2>
          <table className="mt-2 w-full">
            <tbody>
              <Row k="Resolution" v={i.resolutionSummary} />
              {d.staffView && <Row k="Root cause" v={i.rootCause} />}
              {d.staffView && <Row k="Lessons learned" v={i.lessonsLearned} />}
            </tbody>
          </table>
        </>
      )}

      {d.attachments.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Evidence (chain of custody)</h2>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {d.attachments.map((a) => (
                <Row key={a.id} k={a.originalName} v={`${formatBytes(a.sizeBytes)} · uploaded ${formatDateTime(a.createdAt)} by ${a.uploaderName}\nSHA-256 ${a.sha256}`} />
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Timeline</h2>
      <ol className="mt-2 space-y-1.5 text-xs">
        {d.events.map((e) => (
          <li key={e.id}>
            <span className="text-neutral-500">{formatDateTime(e.createdAt)}</span> · {e.actorName ?? 'System'} · {e.type.replace('_', ' ')}
            {e.visibility === 'internal' ? ' (internal)' : ''}
            {e.body ? `: ${e.body}` : ''}
          </li>
        ))}
      </ol>

      <footer className="mt-10 border-t border-neutral-300 pt-3 text-[11px] text-neutral-500">
        This report was generated from the tamper-evident incident record. Its generation has been recorded in the audit trail.
      </footer>
    </div>
  );
}
