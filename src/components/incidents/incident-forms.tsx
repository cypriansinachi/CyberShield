'use client';

import { useState } from 'react';
import { ArrowRight, Paperclip, Send, UserCheck } from 'lucide-react';
import { ActionForm, Choice, Field, Input, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import {
  addTaskAction,
  assignAction,
  breachAssessmentAction,
  commentAction,
  overrideAction,
  reassessAction,
  regulatorNotificationAction,
  transitionAction,
  uploadEvidenceAction,
} from '@/server/actions/incidents';
import {
  CATEGORIES,
  CATEGORY_KEYS,
  DATA_TYPE_KEYS,
  DATA_TYPES,
  IMPACT_DIMENSIONS,
  ONGOING,
  ONGOING_KEYS,
  SCOPE_KEYS,
  SCOPES,
  SEVERITIES,
  SEVERITY_ORDER,
  type ImpactDimension,
  type RiskInput,
  type Severity,
} from '@/lib/risk';
import type { Status } from '@/lib/workflow';
import { PHASE_LABELS } from '@/lib/playbooks';
import { EVIDENCE_EXTENSIONS, MAX_EVIDENCE_FILES, MAX_EVIDENCE_MB, ORG_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';

const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;

// ───────────────────────────── Workflow ─────────────────────────────

export type TransitionOption = { to: Status; label: string; note: boolean; closure: boolean; lessons: boolean; danger: boolean };

export function WorkflowPanel({ incidentId, options }: { incidentId: number; options: TransitionOption[] }) {
  const [selected, setSelected] = useState<Status | null>(null);
  const opt = options.find((o) => o.to === selected);
  if (!options.length) return <p className="text-sm text-muted-foreground">No further workflow actions are available to you.</p>;

  return (
    <div>
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <Button
            key={o.to}
            variant={selected === o.to ? 'primary' : o.danger ? 'danger-outline' : 'secondary'}
            className="justify-between"
            onClick={() => setSelected(selected === o.to ? null : o.to)}
            aria-expanded={selected === o.to}
          >
            {o.label}
            <ArrowRight aria-hidden />
          </Button>
        ))}
      </div>
      {opt && (
        <ActionForm key={opt.to} action={transitionAction} onSuccess={() => setSelected(null)} className="mt-4 space-y-3 rounded-lg border border-border bg-muted/40 p-4">
          <Hidden name="incidentId" value={incidentId} />
          <Hidden name="to" value={opt.to} />
          {opt.closure && (
            <>
              <Field label="Resolution summary" name="resolutionSummary" hint="What was done to resolve the incident?">
                <Textarea name="resolutionSummary" rows={3} />
              </Field>
              <Field label="Root cause" name="rootCause">
                <Textarea name="rootCause" rows={2} />
              </Field>
              <Field label="Lessons learned" name="lessonsLearned" optional={!opt.lessons} hint={opt.lessons ? 'Required for High and Critical incidents.' : undefined}>
                <Textarea name="lessonsLearned" rows={2} />
              </Field>
            </>
          )}
          <Field
            label={opt.note ? 'Justification' : 'Note'}
            name="note"
            optional={!opt.note}
            hint="Visible to the reporter on their status timeline."
          >
            <Textarea name="note" rows={2} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" variant={opt.danger ? 'danger' : 'primary'} pendingText="Saving…">
              Confirm: {opt.label}
            </SubmitButton>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

// ───────────────────────────── Assignment ─────────────────────────────

export function AssignForm({
  incidentId,
  assigneeId,
  currentUserId,
  responders,
  canAssign,
  canSelf,
}: {
  incidentId: number;
  assigneeId: number | null;
  currentUserId: number;
  responders: { id: number; fullName: string; role: string }[];
  canAssign: boolean;
  canSelf: boolean;
}) {
  return (
    <div className="space-y-3">
      {canAssign && (
        <ActionForm action={assignAction} className="flex gap-2" resetOnSuccess={false}>
          <Hidden name="incidentId" value={incidentId} />
          <Select name="assigneeId" defaultValue={assigneeId ? String(assigneeId) : ''} aria-label="Assignee" className="flex-1">
            <option value="">Unassigned</option>
            {responders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </Select>
          <SubmitButton size="md" variant="secondary">
            Assign
          </SubmitButton>
        </ActionForm>
      )}
      {canSelf && assigneeId !== currentUserId && (
        <ActionForm action={assignAction}>
          <Hidden name="incidentId" value={incidentId} />
          <Hidden name="assigneeId" value="me" />
          <SubmitButton size="sm" variant="subtle" className="w-full">
            <UserCheck aria-hidden /> Assign to me
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

// ───────────────────────────── Classification ─────────────────────────────

export function ReassessForm({ incidentId, current }: { incidentId: number; current: RiskInput }) {
  return (
    <ActionForm action={reassessAction} className="space-y-4" resetOnSuccess={false}>
      <Hidden name="incidentId" value={incidentId} />
      <Field label="Category" name="category">
        <Select name="category" defaultValue={current.category}>
          {CATEGORY_KEYS.map((c) => (
            <option key={c} value={c}>
              {CATEGORIES[c].label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(IMPACT_DIMENSIONS) as ImpactDimension[]).map((dim) => (
          <Field key={dim} label={IMPACT_DIMENSIONS[dim].label} name={dim}>
            <Select name={dim} defaultValue={String(current[dim])}>
              {IMPACT_DIMENSIONS[dim].levels.map((l, i) => (
                <option key={l} value={i}>
                  {i} · {l}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Data involved</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {DATA_TYPE_KEYS.map((t) => (
            <Choice key={t} type="checkbox" name="dataTypes" value={t} label={DATA_TYPES[t].short} defaultChecked={current.dataTypes.includes(t)} className="py-1.5" />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Scope" name="scope">
          <Select name="scope" defaultValue={current.scope}>
            {SCOPE_KEYS.map((s) => (
              <option key={s} value={s}>
                {SCOPES[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Still active?" name="ongoing">
          <Select name="ongoing" defaultValue={current.ongoing}>
            {ONGOING_KEYS.map((o) => (
              <option key={o} value={o}>
                {ONGOING[o].label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton size="sm" pendingText="Recalculating…">
        Re-assess risk
      </SubmitButton>
    </ActionForm>
  );
}

export function OverrideForm({ incidentId, severity, overridden }: { incidentId: number; severity: Severity; overridden: boolean }) {
  return (
    <ActionForm action={overrideAction} className="space-y-3">
      <Hidden name="incidentId" value={incidentId} />
      <Field label="Set severity to" name="severity">
        <Select name="severity" defaultValue={severity}>
          {[...SEVERITY_ORDER].reverse().map((s) => (
            <option key={s} value={s}>
              {SEVERITIES[s].label} ({SEVERITIES[s].priority})
            </option>
          ))}
          {overridden && <option value="revert">Remove override (use calculated)</option>}
        </Select>
      </Field>
      <Field label="Justification" name="reason" hint="Recorded in the timeline and the audit trail.">
        <Textarea name="reason" rows={2} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Apply override
      </SubmitButton>
    </ActionForm>
  );
}

// ───────────────────────────── Collaboration ─────────────────────────────

export function CommentForm({ incidentId, staff }: { incidentId: number; staff: boolean }) {
  return (
    <ActionForm action={commentAction} className="space-y-3" successMessage={false}>
      <Hidden name="incidentId" value={incidentId} />
      <Field name="body" label={staff ? 'Add to the timeline' : 'Send a message to the security team'}>
        <Textarea name="body" rows={3} placeholder={staff ? 'Investigation notes, actions taken, findings…' : 'Add any new information or ask a question…'} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {staff ? (
          <div className="flex gap-2" role="radiogroup" aria-label="Visibility">
            <Choice name="visibility" value="internal" label="Internal note" defaultChecked className="py-1.5 text-xs" />
            <Choice name="visibility" value="public" label="Reply to reporter" className="py-1.5 text-xs" />
          </div>
        ) : (
          <span />
        )}
        <SubmitButton size="sm">
          <Send aria-hidden /> Post
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AddTaskForm({ incidentId }: { incidentId: number }) {
  return (
    <ActionForm action={addTaskAction} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]" successMessage={false}>
      <Hidden name="incidentId" value={incidentId} />
      <Input name="title" placeholder="Add a custom task…" aria-label="Task" />
      <Select name="phase" defaultValue={PHASE_LABELS[1]} aria-label="Phase">
        {PHASE_LABELS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary">Add</SubmitButton>
    </ActionForm>
  );
}

export function EvidenceUploadForm({ incidentId }: { incidentId: number }) {
  const [names, setNames] = useState<string[]>([]);
  return (
    <ActionForm action={uploadEvidenceAction} className="space-y-2" onSuccess={() => setNames([])}>
      <Hidden name="incidentId" value={incidentId} />
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40">
        <Paperclip className="size-4" aria-hidden />
        <span className="truncate">{names.length ? names.join(', ') : `Attach files (max ${MAX_EVIDENCE_FILES} × ${MAX_EVIDENCE_MB} MB)`}</span>
        <input
          type="file"
          name="evidence"
          multiple
          accept={EVIDENCE_EXTENSIONS.join(',')}
          className="sr-only"
          onChange={(e) => setNames(Array.from(e.currentTarget.files ?? []).map((f) => f.name))}
        />
      </label>
      <SubmitButton size="sm" variant="secondary" className={cn(!names.length && 'hidden')} pendingText="Encrypting & uploading…">
        Upload evidence
      </SubmitButton>
    </ActionForm>
  );
}

// ───────────────────────────── Compliance ─────────────────────────────

export function BreachAssessmentForm({ incidentId, notifiable }: { incidentId: number; notifiable: boolean }) {
  return (
    <ActionForm action={breachAssessmentAction} className="space-y-3">
      <Hidden name="incidentId" value={incidentId} />
      <Hidden name="notifiable" value={notifiable ? 'no' : 'yes'} />
      <Field
        name="reason"
        label={notifiable ? 'Why is this NOT a notifiable breach?' : 'Why is this a notifiable breach?'}
        hint={`e.g. data was encrypted, no personal data left ${ORG_NAME}'s systems, risk to individuals assessed as unlikely.`}
      >
        <Textarea name="reason" rows={2} />
      </Field>
      <SubmitButton size="sm" variant={notifiable ? 'secondary' : 'danger-outline'}>
        {notifiable ? 'Mark as not notifiable' : 'Flag as notifiable breach'}
      </SubmitButton>
    </ActionForm>
  );
}

export function RegulatorNotificationForm({ incidentId, defaultAuthority, defaultTime }: { incidentId: number; defaultAuthority: string; defaultTime: string }) {
  return (
    <ActionForm action={regulatorNotificationAction} className="space-y-3">
      <Hidden name="incidentId" value={incidentId} />
      <Field label="Notified at" name="notifiedAt">
        <Input name="notifiedAt" type="datetime-local" defaultValue={defaultTime} max={defaultTime} />
      </Field>
      <Field label="Authority" name="authority">
        <Input name="authority" defaultValue={defaultAuthority} />
      </Field>
      <Field label="Regulator reference number" name="reference">
        <Input name="reference" placeholder="e.g. NDPC/BR/2026/0142" />
      </Field>
      <SubmitButton size="sm">Record notification</SubmitButton>
    </ActionForm>
  );
}
