'use client';

import { useActionState, useState, type FormEvent } from 'react';
import { AlertTriangle, FileUp, Gauge, Info, Lock, ShieldCheck } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Choice, Field, FormMessage, FormStateProvider, Input, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { SeverityBadge, severityDotClass } from './badges';
import { createIncidentAction } from '@/server/actions/incidents';
import { idleState } from '@/lib/action-state';
import {
  CATEGORIES,
  CATEGORY_KEYS,
  classify,
  DATA_TYPE_KEYS,
  DATA_TYPES,
  IMPACT_DIMENSIONS,
  ONGOING,
  ONGOING_KEYS,
  SCOPE_KEYS,
  SCOPES,
  SEVERITIES,
  type Classification,
  type ImpactDimension,
} from '@/lib/risk';
import { DEPARTMENTS, EVIDENCE_EXTENSIONS, MAX_EVIDENCE_FILES, MAX_EVIDENCE_MB } from '@/lib/constants';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

function readRisk(form: HTMLFormElement): Classification {
  const fd = new FormData(form);
  return classify({
    category: fd.get('category'),
    confidentiality: fd.get('confidentiality'),
    integrity: fd.get('integrity'),
    availability: fd.get('availability'),
    dataTypes: fd.getAll('dataTypes'),
    scope: fd.get('scope'),
    ongoing: fd.get('ongoing'),
  });
}

function hours(h: number) {
  return h >= 48 ? `${h / 24} days` : `${h} hours`;
}
function minutes(m: number) {
  return m >= 60 ? hours(m / 60) : `${m} minutes`;
}

export function ReportForm({ defaultDetectedAt, defaultDepartment, regulator }: { defaultDetectedAt: string; defaultDepartment: string; regulator: string }) {
  const [state, formAction, pending] = useActionState(createIncidentAction, idleState);
  const [risk, setRisk] = useState<Classification | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const onChange = (e: FormEvent<HTMLFormElement>) => setRisk(readRisk(e.currentTarget));
  // React resets the form after each submission (restoring the kept values);
  // recompute the preview once the reset has been applied.
  const onReset = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    setTimeout(() => setRisk(readRisk(form)), 0);
  };

  return (
    <FormStateProvider state={state} pending={pending}>
      <form action={formAction} onChange={onChange} onReset={onReset} noValidate className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. What happened?" description="Describe the incident in your own words. Technical detail is welcome but not required." />
            <CardBody className="space-y-5">
              <Field label="Short title" name="title" hint="For example: “Email asking me to verify my payroll login”">
                <Input name="title" maxLength={150} required />
              </Field>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Type of incident</legend>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {CATEGORY_KEYS.map((key) => (
                    <Choice key={key} name="category" value={key} label={CATEGORIES[key].label} description={CATEGORIES[key].hint} />
                  ))}
                </div>
                <FieldErrorText name="category" state={state} />
              </fieldset>

              <Field label="Description" name="description" hint="What did you see? What did you click or open? Who else may be affected? (at least 20 characters)">
                <Textarea name="description" rows={6} maxLength={5000} required />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="When was it discovered?" name="detectedAt">
                  <Input name="detectedAt" type="datetime-local" defaultValue={defaultDetectedAt} max={defaultDetectedAt} required />
                </Field>
                <Field label="Affected department" name="department">
                  <Select name="department" defaultValue={defaultDepartment || ''} required>
                    <option value="" disabled>
                      Select a department
                    </option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Affected systems, devices or accounts" name="affectedAssets" optional hint="e.g. laptop FIN-LT-023, payroll portal, my Outlook mailbox">
                <Input name="affectedAssets" maxLength={500} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="2. Impact" description="Your answers drive the automatic risk classification. Answer “Possibly” if you are unsure." />
            <CardBody className="space-y-6">
              {(Object.keys(IMPACT_DIMENSIONS) as ImpactDimension[]).map((dim) => (
                <fieldset key={dim}>
                  <legend className="text-sm font-medium">{IMPACT_DIMENSIONS[dim].question}</legend>
                  <p className="mb-2 text-xs text-muted-foreground">{IMPACT_DIMENSIONS[dim].label}</p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {IMPACT_DIMENSIONS[dim].levels.map((label, i) => (
                      <Choice key={label} name={dim} value={String(i)} label={label} defaultChecked={i === 0} className="py-2" />
                    ))}
                  </div>
                </fieldset>
              ))}

              <fieldset>
                <legend className="mb-2 text-sm font-medium">What kind of information is involved?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DATA_TYPE_KEYS.map((t) => (
                    <Choice key={t} type="checkbox" name="dataTypes" value={t} label={DATA_TYPES[t].label} className="py-2" />
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">Leave all unticked if no sensitive information is involved.</p>
              </fieldset>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="How many people or devices are affected?" name="scope">
                  <Select name="scope" defaultValue="unknown">
                    {SCOPE_KEYS.map((s) => (
                      <option key={s} value={s}>
                        {SCOPES[s].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">Is it still happening?</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {ONGOING_KEYS.map((o) => (
                      <Choice key={o} name="ongoing" value={o} label={o === 'yes' ? 'Yes' : o === 'no' ? 'No' : 'Not sure'} defaultChecked={o === 'unknown'} className="py-2" />
                    ))}
                  </div>
                  <span className="sr-only">{ONGOING.yes.label}</span>
                </fieldset>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="3. Evidence" description="Screenshots, the suspicious email (.eml), log files or documents. Optional but very helpful." />
            <CardBody>
              <label
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/40',
                  state.fieldErrors?.evidence && 'border-critical/50',
                )}
              >
                <FileUp className="size-6 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">Choose files to attach</span>
                <span className="text-xs text-muted-foreground">
                  Up to {MAX_EVIDENCE_FILES} files, {MAX_EVIDENCE_MB} MB each · {EVIDENCE_EXTENSIONS.join(' ')}
                </span>
                <input
                  type="file"
                  name="evidence"
                  multiple
                  accept={EVIDENCE_EXTENSIONS.join(',')}
                  className="sr-only"
                  onChange={(e) => setFiles(Array.from(e.currentTarget.files ?? []))}
                />
              </label>
              {files.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {files.map((f) => (
                    <li key={f.name + f.size} className="flex justify-between gap-3 rounded-md bg-muted px-3 py-1.5">
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <FieldErrorText name="evidence" state={state} />
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> Files are checked, fingerprinted (SHA-256) and encrypted before storage.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="declaration" className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span>
                  I confirm this report is accurate to the best of my knowledge. I understand it will be shared with the security team and handled under the
                  organisation&apos;s data protection policy.
                </span>
              </label>
              <FieldErrorText name="declaration" state={state} />
              <FormMessage />
              <div className="flex justify-end">
                <SubmitButton size="lg" pendingText="Submitting securely…">
                  <ShieldCheck aria-hidden /> Submit report
                </SubmitButton>
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <RiskPreview risk={risk} regulator={regulator} />
          <Card>
            <CardBody className="flex gap-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <p>
                If you think a device is infected, <strong className="text-foreground">disconnect it from the network</strong> but do not switch it off. Keep the suspicious
                email; do not forward it to colleagues.
              </p>
            </CardBody>
          </Card>
        </aside>
      </form>
    </FormStateProvider>
  );
}

function FieldErrorText({ name, state }: { name: string; state: { fieldErrors?: Record<string, string> } }) {
  const msg = state.fieldErrors?.[name];
  return msg ? <p className="mt-1.5 text-xs font-medium text-critical-ink">{msg}</p> : null;
}

function RiskPreview({ risk, regulator }: { risk: Classification | null; regulator: string }) {
  return (
    <Card>
      <CardHeader title="Risk preview" icon={<Gauge />} description="Calculated live from your answers. The security team will review it." />
      <CardBody>
        {!risk ? (
          <p className="text-sm text-muted-foreground">Select the type of incident to see how it will be classified.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <SeverityBadge severity={risk.severity} showPriority />
              <span className="text-sm tabular-nums text-muted-foreground">
                <span className="text-xl font-semibold text-foreground">{risk.score}</span> / 100
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn('h-full rounded-full transition-all', severityDotClass(risk.severity))} style={{ width: `${Math.max(3, risk.score)}%` }} />
            </div>
            <ul className="space-y-1.5 text-xs">
              {risk.factors.map((f) => (
                <li key={f.key} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="tabular-nums">
                    {f.points}
                    <span className="text-muted-foreground">/{f.max}</span>
                  </span>
                </li>
              ))}
            </ul>
            {risk.rules.length > 0 && (
              <div className="rounded-lg bg-muted p-3 text-xs">
                <p className="font-medium">Escalation rules applied</p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {risk.rules.map((r) => (
                    <li key={r.id}>
                      {r.id}: {r.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
              Target response: acknowledged within <strong className="text-foreground">{minutes(SEVERITIES[risk.severity].ackMinutes)}</strong>, resolved within{' '}
              <strong className="text-foreground">{hours(SEVERITIES[risk.severity].resolveHours)}</strong>.
            </div>
            {risk.personalDataBreach && (
              <div className="flex gap-2 rounded-lg bg-warning-soft p-3 text-xs">
                <AlertTriangle className="size-4 shrink-0 text-warning-ink" aria-hidden />
                <p>
                  <strong>Possible personal-data breach.</strong> The organisation may have to notify the {regulator} within 72 hours. Please submit as soon as possible.
                </p>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
