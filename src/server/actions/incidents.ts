'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actionUser } from '../auth/dal';
import * as incidents from '../services/incidents';
import { EvidenceError, prepareEvidence } from '../services/evidence';
import { dateTimeInput, done, fail, formValues, idParam, invalid, optionalText, text } from './form';
import type { ActionState } from '@/lib/action-state';
import { CATEGORY_KEYS, DATA_TYPE_KEYS, ONGOING_KEYS, SCOPE_KEYS, SEVERITY_ORDER } from '@/lib/risk';
import { STATUS_KEYS } from '@/lib/workflow';
import { PHASE_LABELS } from '@/lib/playbooks';
import { DEPARTMENTS } from '@/lib/constants';

const impact = z.coerce.number().int().min(0).max(3);

const riskFields = {
  category: z.enum(CATEGORY_KEYS, { error: 'Select the type of incident.' }),
  confidentiality: impact,
  integrity: impact,
  availability: impact,
  dataTypes: z.array(z.enum(DATA_TYPE_KEYS)).default([]),
  scope: z.enum(SCOPE_KEYS, { error: 'Select how many people or devices are affected.' }),
  ongoing: z.enum(ONGOING_KEYS, { error: 'Tell us whether it is still happening.' }),
};

const files = (fd: FormData, key: string) => fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);

function result(r: incidents.Result, path: string): ActionState {
  if (!r.ok) return fail(r.error);
  revalidatePath(path);
  return done(r.message);
}

// ───────────────────────────── Report ─────────────────────────────

export async function createIncidentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd, ['dataTypes']);
  const schema = z.object({
    title: text('Title', 5, 150),
    description: text('Description', 20, 5000, { multiline: true }),
    detectedAt: dateTimeInput('Date and time discovered', { notFuture: true }),
    department: z.enum(DEPARTMENTS, { error: 'Select the affected department.' }),
    affectedAssets: optionalText('Affected systems', 500),
    declaration: z.literal('on', { error: 'Please confirm the information is accurate.' }),
    ...riskFields,
  });
  const parsed = schema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);

  let evidence;
  try {
    evidence = await prepareEvidence(files(fd, 'evidence'));
  } catch (err) {
    if (err instanceof EvidenceError) return fail(err.message, { values, fieldErrors: { evidence: err.message } });
    throw err;
  }

  const created = await incidents.createIncident(user, parsed.data, evidence, ctx);
  revalidatePath('/incidents');
  revalidatePath('/dashboard');
  redirect(`/incidents/${created.id}?created=1`);
}

// ───────────────────────────── Workflow ─────────────────────────────

export async function transitionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd);
  const parsed = z
    .object({
      incidentId: idParam,
      to: z.enum(STATUS_KEYS),
      note: optionalText('Note', 2000, { multiline: true }),
      resolutionSummary: optionalText('Resolution summary', 4000, { multiline: true }),
      rootCause: optionalText('Root cause', 2000, { multiline: true }),
      lessonsLearned: optionalText('Lessons learned', 4000, { multiline: true }),
    })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, to, ...input } = parsed.data;
  const r = await incidents.transitionIncident(incidentId, to, input, user, ctx);
  return r.ok ? result(r, `/incidents/${incidentId}`) : fail(r.error, { values });
}

export async function assignAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const parsed = z
    .object({ incidentId: idParam, assigneeId: z.union([z.literal(''), z.literal('me'), idParam]) })
    .safeParse(formValues(fd));
  if (!parsed.success) return fail('Invalid assignment.');
  const { incidentId, assigneeId } = parsed.data;
  const target = assigneeId === 'me' ? user.id : assigneeId === '' ? null : assigneeId;
  return result(await incidents.assignIncident(incidentId, target, user, ctx), `/incidents/${incidentId}`);
}

// ───────────────────────────── Classification ─────────────────────────────

export async function reassessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd, ['dataTypes']);
  const parsed = z.object({ incidentId: idParam, ...riskFields }).safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, ...input } = parsed.data;
  return result(await incidents.reassessIncident(incidentId, input, user, ctx), `/incidents/${incidentId}`);
}

export async function overrideAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd);
  const parsed = z
    .object({
      incidentId: idParam,
      severity: z.enum([...SEVERITY_ORDER, 'revert'] as const),
      reason: text('Justification', 10, 1000, { multiline: true }),
    })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, severity, reason } = parsed.data;
  return result(await incidents.overrideSeverity(incidentId, severity, reason, user, ctx), `/incidents/${incidentId}`);
}

// ───────────────────────────── Collaboration ─────────────────────────────

export async function commentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd);
  const parsed = z
    .object({ incidentId: idParam, body: text('Message', 2, 5000, { multiline: true }), visibility: z.enum(['internal', 'public']).catch('internal') })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, body, visibility } = parsed.data;
  return result(await incidents.addComment(incidentId, body, visibility, user, ctx), `/incidents/${incidentId}`);
}

export async function taskStatusAction(fd: FormData): Promise<void> {
  const { user, ctx } = await actionUser();
  const parsed = z
    .object({ incidentId: idParam, taskId: idParam, status: z.enum(['open', 'done', 'not_applicable']) })
    .safeParse(formValues(fd));
  if (!parsed.success) return;
  const { incidentId, taskId, status } = parsed.data;
  await incidents.updateTaskStatus(incidentId, taskId, status, user, ctx);
  revalidatePath(`/incidents/${incidentId}`);
}

export async function addTaskAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd);
  const parsed = z
    .object({ incidentId: idParam, title: text('Task', 3, 200), phase: z.enum(PHASE_LABELS as [string, ...string[]]) })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, title, phase } = parsed.data;
  return result(await incidents.addTask(incidentId, title, phase, user, ctx), `/incidents/${incidentId}`);
}

export async function uploadEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const id = idParam.safeParse(fd.get('incidentId'));
  if (!id.success) return fail('Invalid incident.');
  try {
    const evidence = await prepareEvidence(files(fd, 'evidence'));
    return result(await incidents.attachEvidence(id.data, evidence, user, ctx), `/incidents/${id.data}`);
  } catch (err) {
    if (err instanceof EvidenceError) return fail(err.message);
    throw err;
  }
}

// ───────────────────────────── Compliance ─────────────────────────────

export async function breachAssessmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd);
  const parsed = z
    .object({ incidentId: idParam, notifiable: z.enum(['yes', 'no']), reason: text('Reasoning', 10, 1000, { multiline: true }) })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, notifiable, reason } = parsed.data;
  return result(await incidents.setBreachNotifiable(incidentId, notifiable === 'yes', reason, user, ctx), `/incidents/${incidentId}`);
}

export async function regulatorNotificationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  const values = formValues(fd);
  const parsed = z
    .object({
      incidentId: idParam,
      notifiedAt: dateTimeInput('Notification time', { notFuture: true }),
      authority: text('Authority', 3, 150),
      reference: text('Reference number', 2, 100),
    })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { incidentId, ...input } = parsed.data;
  return result(await incidents.recordRegulatorNotification(incidentId, input, user, ctx), `/incidents/${incidentId}`);
}
