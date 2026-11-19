import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Download,
  FileText,
  Gauge,
  GitBranch,
  Landmark,
  ListChecks,
  MinusCircle,
  Paperclip,
  Printer,
  RotateCcw,
  ScrollText,
  Timer,
  User,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge, DescriptionList } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { SeverityBadge, SlaIndicator, StatusBadge, severityDotClass } from '@/components/incidents/badges';
import { WorkflowStepper } from '@/components/incidents/stepper';
import { Timeline } from '@/components/incidents/timeline';
import {
  AddTaskForm,
  AssignForm,
  BreachAssessmentForm,
  CommentForm,
  EvidenceUploadForm,
  OverrideForm,
  ReassessForm,
  RegulatorNotificationForm,
  WorkflowPanel,
  type TransitionOption,
} from '@/components/incidents/incident-forms';
import { auditContextFor, requireUser } from '@/server/auth/dal';
import { getIncidentDetail } from '@/server/services/incidents';
import { listResponders } from '@/server/services/users';
import { taskStatusAction } from '@/server/actions/incidents';
import { config } from '@/server/config';
import { can } from '@/lib/rbac';
import { CATEGORIES, DATA_TYPES, ONGOING, SCOPES, SEVERITIES } from '@/lib/risk';
import { STATUSES, TRANSITIONS, isReopen, slaStatus, transitionLabel, transitionRequirements } from '@/lib/workflow';
import { formatBytes, formatDateTime, isPast, timeAgo, toDateTimeInput } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Incident' };

export default async function IncidentPage({ params, searchParams }: PageProps<'/incidents/[id]'>) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const d = await getIncidentDetail(Number(id), user, await auditContextFor(user));
  if (!d) notFound(); // also for incidents the user may not see: never reveal that they exist
  const sp = await searchParams;

  const i = d.incident;
  const staff = d.staffView;
  const closed = i.status === 'closed' || i.status === 'rejected';
  const canTriage = can(user, 'incident.triage');
  const canComment = can(user, 'incident.comment');
  const sla = slaStatus(i);
  const factors = i.riskFactors;

  const options: TransitionOption[] = canTriage
    ? TRANSITIONS[i.status]
        .filter(() => !isReopen(i.status) || can(user, 'incident.reopen'))
        .map((to) => ({ to, label: transitionLabel(i.status, to), ...transitionRequirements(i.status, to, i.severity), danger: to === 'rejected' }))
    : [];
  const openTasks = d.tasks.filter((t) => t.status === 'open').length;
  const doneTasks = d.tasks.filter((t) => t.status !== 'open').length;
  const tasksByPhase = d.tasks.reduce<Record<string, typeof d.tasks>>((acc, t) => {
    (acc[t.phase] ??= []).push(t);
    return acc;
  }, {});

  return (
    <>
      <Link href="/incidents" className="no-print mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {staff ? 'All incidents' : 'My reports'}
      </Link>

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{i.reference}</span> · {CATEGORIES[i.category].label} · reported {timeAgo(i.createdAt)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{i.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={i.severity} showPriority />
            <StatusBadge status={i.status} />
            {staff && i.severityOverridden && <Badge tone="primary">Severity set manually</Badge>}
            {staff && i.breachNotifiable && (
              <Badge tone={i.notifiedAt ? 'good' : 'warning'}>
                <Landmark className="size-3" aria-hidden /> Notifiable breach{i.notifiedAt ? ' · notified' : ''}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{STATUSES[i.status].phase}</span>
          </div>
        </div>
        <Link href={`/print/incidents/${i.id}`} className={buttonClass({ variant: 'secondary', size: 'sm', className: 'no-print' })} target="_blank">
          <Printer aria-hidden /> Incident report
        </Link>
      </div>

      {sp.created && (
        <Alert tone="success" title={`Report ${i.reference} submitted`} className="mb-5">
          Thank you. The security team has been notified and you will receive updates here. Keep your reference number for any follow-up.
        </Alert>
      )}

      <WorkflowStepper status={i.status} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ─────────── Main column ─────────── */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Report details" icon={<FileText />} />
            <CardBody>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{i.description}</p>
              <DescriptionList
                className="mt-4 border-t border-border"
                items={[
                  ...(staff && d.reporter
                    ? [{ label: 'Reported by', value: <>{d.reporter.fullName} <span className="text-muted-foreground">· {d.reporter.email}</span></> }]
                    : []),
                  { label: 'Discovered', value: formatDateTime(i.detectedAt) },
                  { label: 'Reported', value: formatDateTime(i.createdAt) },
                  { label: 'Department', value: i.department ?? '—' },
                  { label: 'Affected systems', value: i.affectedAssets ?? '—' },
                  { label: 'Data involved', value: i.dataTypes.length ? i.dataTypes.map((t) => DATA_TYPES[t].short).join(', ') : 'None reported' },
                  { label: 'People / devices affected', value: SCOPES[i.affectedScope].label },
                  { label: 'Still active', value: ONGOING[i.ongoing].label },
                ]}
              />
            </CardBody>
          </Card>

          {staff && (
            <Card>
              <CardHeader
                title="Risk assessment"
                icon={<Gauge />}
                description={
                  i.severityOverridden
                    ? `Calculated severity ${SEVERITIES[i.computedSeverity].label}; set manually to ${SEVERITIES[i.severity].label}.`
                    : 'Calculated automatically from the reported impact.'
                }
                action={
                  <span className="text-sm tabular-nums text-muted-foreground">
                    <span className="text-2xl font-semibold text-foreground">{i.riskScore}</span>/100
                  </span>
                }
              />
              <CardBody className="space-y-4">
                <ul className="space-y-3">
                  {factors.factors.map((f) => (
                    <li key={f.key} className="grid grid-cols-[9rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="min-w-0">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className={cn('bar-grow block h-full rounded-full', severityDotClass(i.computedSeverity))} style={{ width: `${(f.points / f.max) * 100}%` }} />
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground" title={f.detail}>
                          {f.detail}
                        </span>
                      </span>
                      <span className="text-right text-xs tabular-nums">
                        {f.points}/{f.max}
                      </span>
                    </li>
                  ))}
                </ul>
                {factors.rules.length > 0 && (
                  <div className="rounded-lg bg-muted p-3 text-xs">
                    <p className="font-medium">Escalation rules applied (score alone gave {SEVERITIES[factors.scoreSeverity].label})</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {factors.rules.map((r) => (
                        <li key={r.id}>
                          {r.id}: {r.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {i.severityOverridden && i.overrideReason && (
                  <p className="rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-xs">
                    <span className="font-medium">Override justification:</span> {i.overrideReason}
                  </p>
                )}
                {!closed && canTriage && (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    <Collapsible title="Re-assess impact">
                      <ReassessForm
                        incidentId={i.id}
                        current={{
                          category: i.category,
                          confidentiality: i.impactConfidentiality,
                          integrity: i.impactIntegrity,
                          availability: i.impactAvailability,
                          dataTypes: i.dataTypes,
                          scope: i.affectedScope,
                          ongoing: i.ongoing,
                        }}
                      />
                    </Collapsible>
                    {can(user, 'incident.override') && (
                      <Collapsible title="Override severity (manager)">
                        <OverrideForm incidentId={i.id} severity={i.severity} overridden={i.severityOverridden} />
                      </Collapsible>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {staff && d.tasks.length > 0 && (
            <Card>
              <CardHeader
                title="Response playbook"
                icon={<ListChecks />}
                description={`${doneTasks} of ${d.tasks.length} tasks complete`}
                action={
                  <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="bar-grow block h-full rounded-full bg-good" style={{ width: `${(doneTasks / d.tasks.length) * 100}%` }} />
                  </span>
                }
              />
              <CardBody className="space-y-5">
                {Object.entries(tasksByPhase).map(([phase, tasks]) => (
                  <div key={phase}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{phase}</p>
                    <ul className="space-y-1">
                      {tasks.map((t) => (
                        <li key={t.id} className="group flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                          {t.status === 'done' ? (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-ink" aria-label="Done" />
                          ) : t.status === 'not_applicable' ? (
                            <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not applicable" />
                          ) : (
                            <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Open" />
                          )}
                          <span className={cn('flex-1 text-sm', t.status !== 'open' && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{t.title}</span>
                          {canTriage && !closed && (
                            <form action={taskStatusAction} className="flex shrink-0 gap-1">
                              <input type="hidden" name="incidentId" value={i.id} />
                              <input type="hidden" name="taskId" value={t.id} />
                              {t.status === 'open' ? (
                                <>
                                  <button name="status" value="done" className="rounded-md px-2 py-0.5 text-xs font-medium text-good-ink hover:bg-good-soft">
                                    Done
                                  </button>
                                  <button name="status" value="not_applicable" className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                                    N/A
                                  </button>
                                </>
                              ) : (
                                <button name="status" value="open" className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                                  <RotateCcw className="size-3" aria-hidden /> Reopen
                                </button>
                              )}
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {canTriage && !closed && <AddTaskForm incidentId={i.id} />}
              </CardBody>
            </Card>
          )}

          {i.status === 'closed' && (staff || i.resolutionSummary) && (
            <Card>
              <CardHeader title="Post-incident review" icon={<CheckCircle2 />} description={`Closed ${formatDateTime(i.closedAt)}`} />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Resolution', value: <span className="whitespace-pre-wrap">{i.resolutionSummary}</span> },
                    ...(staff
                      ? [
                          { label: 'Root cause', value: <span className="whitespace-pre-wrap">{i.rootCause}</span> },
                          { label: 'Lessons learned', value: <span className="whitespace-pre-wrap">{i.lessonsLearned ?? '—'}</span> },
                        ]
                      : []),
                  ]}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={staff ? 'Timeline' : 'Updates'} icon={<GitBranch />} description={staff ? 'Every action, note and status change' : 'Progress updates and messages'} />
            <CardBody className="space-y-6">
              <Timeline events={d.events} staff={staff} />
              {canComment && <div className="border-t border-border pt-5"><CommentForm incidentId={i.id} staff={canTriage} /></div>}
            </CardBody>
          </Card>

          {d.auditTrail.length > 0 && (
            <Card>
              <CardHeader title="Audit trail" icon={<ScrollText />} description="Tamper-evident log entries for this incident (latest first)" />
              <ul className="max-h-80 divide-y divide-border overflow-y-auto text-xs">
                {d.auditTrail.map((a) => (
                  <li key={a.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] gap-3 px-5 py-2">
                    <span className="text-muted-foreground">{formatDateTime(a.ts)}</span>
                    <span className="truncate">
                      <code className="font-mono">{a.action}</code> <span className="text-muted-foreground">by {a.actorEmail ?? 'system'}</span>
                    </span>
                    <span className={a.outcome === 'success' ? 'text-good-ink' : 'text-critical-ink'}>{a.outcome}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ─────────── Side column ─────────── */}
        <aside className="space-y-6">
          {canTriage && (
            <Card>
              <CardHeader title="Workflow" description={`Current stage: ${STATUSES[i.status].label}`} />
              <CardBody className="space-y-3">
                <WorkflowPanel incidentId={i.id} options={options} />
                {TRANSITIONS[i.status].includes('closed') && (
                  <div className="rounded-lg bg-muted p-3 text-xs">
                    <p className="mb-1.5 font-medium">Before closing</p>
                    <ul className="space-y-1">
                    <Check ok={openTasks === 0}>All playbook tasks resolved ({openTasks} open)</Check>
                    <Check ok={!i.breachNotifiable || !!i.notifiedAt}>Regulator notification recorded (if required)</Check>
                    <Check ok={i.severity !== 'high' && i.severity !== 'critical' ? true : can(user, 'incident.close_major')}>
                      {i.severity === 'high' || i.severity === 'critical' ? 'Manager sign-off (major incident)' : 'Responder sign-off'}
                    </Check>
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Assignment" icon={<User />} />
            <CardBody className="space-y-3">
              <p className="text-sm">
                {d.assignee ? (
                  <>
                    <span className="font-medium">{d.assignee.fullName}</span>
                    {staff && <span className="block text-xs text-muted-foreground">{d.assignee.email}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">{staff ? 'Not yet assigned' : 'Waiting for a responder'}</span>
                )}
              </p>
              {canTriage && !closed && (
                <AssignForm
                  incidentId={i.id}
                  assigneeId={i.assigneeId}
                  currentUserId={user.id}
                  responders={can(user, 'incident.assign') ? await listResponders() : []}
                  canAssign={can(user, 'incident.assign')}
                  canSelf={can(user, 'incident.assign_self')}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Service levels" icon={<Timer />} description={`Priority ${i.priority} targets`} />
            <CardBody>
              <DescriptionList
                items={[
                  {
                    label: 'Acknowledge',
                    value: (
                      <>
                        <SlaIndicator state={sla.ack} />
                        <span className="block text-xs text-muted-foreground">
                          {i.acknowledgedAt ? `at ${formatDateTime(i.acknowledgedAt)}` : `due ${formatDateTime(i.slaAckDueAt)}`}
                        </span>
                      </>
                    ),
                  },
                  {
                    label: 'Resolve',
                    value: (
                      <>
                        <SlaIndicator state={sla.resolve} remainingMs={closed ? undefined : Math.abs(sla.remainingMs)} />
                        <span className="block text-xs text-muted-foreground">
                          {i.closedAt ? `closed ${formatDateTime(i.closedAt)}` : `due ${formatDateTime(i.slaResolveDueAt)}`}
                        </span>
                      </>
                    ),
                  },
                  ...(i.containedAt ? [{ label: 'Contained', value: formatDateTime(i.containedAt) }] : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Evidence" icon={<Paperclip />} description="Encrypted at rest · SHA-256 verified on download" />
            <CardBody className="space-y-3">
              {d.attachments.length ? (
                <ul className="space-y-2">
                  {d.attachments.map((a) => (
                    <li key={a.id} className="rounded-lg border border-border p-2.5">
                      <a href={`/api/incidents/${i.id}/evidence/${a.id}`} className="flex items-center gap-2 text-sm font-medium hover:text-primary">
                        <Download className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{a.originalName}</span>
                      </a>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatBytes(a.sizeBytes)} · {a.uploaderName} · {timeAgo(a.createdAt)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={a.sha256}>
                        sha256:{a.sha256}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No evidence attached.</p>
              )}
              {canComment && !closed && <EvidenceUploadForm incidentId={i.id} />}
            </CardBody>
          </Card>

          {staff && (
            <Card>
              <CardHeader title="Regulatory notification" icon={<Landmark />} description="NDPA 2023 s.40 · GDPR Art. 33" />
              <CardBody className="space-y-3 text-sm">
                {i.breachNotifiable ? (
                  i.notifiedAt ? (
                    <Alert tone={i.notificationDueAt && i.notifiedAt > i.notificationDueAt ? 'warning' : 'success'} title="Regulator notified">
                      {i.notificationAuthority} on {formatDateTime(i.notifiedAt)} · ref. {i.notificationRef}
                      {i.notificationDueAt && i.notifiedAt > i.notificationDueAt ? ' (after the deadline)' : ' (within the deadline)'}
                    </Alert>
                  ) : (
                    <Alert tone={isPast(i.notificationDueAt) ? 'error' : 'warning'} title="Notification required">
                      Notify the {i.notificationAuthority ?? config.compliance.regulatorName} by <strong className="text-foreground">{formatDateTime(i.notificationDueAt)}</strong> (
                      {timeAgo(i.notificationDueAt)}).
                    </Alert>
                  )
                ) : (
                  <p className="text-muted-foreground">Not assessed as a notifiable personal-data breach.</p>
                )}
                {can(user, 'incident.compliance') && (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {i.breachNotifiable && !i.notifiedAt && (
                      <Collapsible title="Record regulator notification" open>
                        <RegulatorNotificationForm
                          incidentId={i.id}
                          defaultAuthority={i.notificationAuthority ?? config.compliance.regulatorName}
                          defaultTime={toDateTimeInput(new Date().toISOString())}
                        />
                      </Collapsible>
                    )}
                    {!i.notifiedAt && (
                      <Collapsible title={i.breachNotifiable ? 'Change breach assessment' : 'Flag as notifiable breach'}>
                        <BreachAssessmentForm incidentId={i.id} notifiable={i.breachNotifiable} />
                      </Collapsible>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {!staff && (
            <Card>
              <CardHeader title="What happens next?" icon={<AlertTriangle />} />
              <CardBody className="space-y-2 text-xs text-muted-foreground">
                <p>
                  <strong className="text-foreground">Triage:</strong> a security analyst reviews your report and confirms its severity.
                </p>
                <p>
                  <strong className="text-foreground">Investigation & containment:</strong> the team works to stop the threat and limit the damage.
                </p>
                <p>
                  <strong className="text-foreground">Recovery & closure:</strong> affected systems are restored and you are told the outcome.
                </p>
                <p>You will be notified of every status change. Use the message box to add information at any time.</p>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function Collapsible({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-center gap-1.5', ok ? 'text-good-ink' : 'text-muted-foreground')}>
      {ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleDashed className="size-3.5" aria-hidden />}
      {children}
    </li>
  );
}
