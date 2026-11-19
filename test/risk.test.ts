import { describe, expect, it } from 'vitest';
import { classify, isPersonalDataBreach, normalizeRiskInput, severityFromScore } from '@/lib/risk';

const base = { confidentiality: 0, integrity: 0, availability: 0, dataTypes: [], scope: 'single', ongoing: 'no' } as const;

describe('risk classification engine', () => {
  it('rates an unclicked phishing email as Low / P4', () => {
    const r = classify({ ...base, category: 'phishing' });
    expect(r.score).toBe(17);
    expect(r.severity).toBe('low');
    expect(r.priority).toBe('P4');
    expect(r.rules).toHaveLength(0);
  });

  it('rates entered credentials as Medium', () => {
    const r = classify({ ...base, category: 'phishing', confidentiality: 2, dataTypes: ['credentials'], ongoing: 'unknown' });
    expect(r.severity).toBe('medium');
    expect(r.personalDataBreach).toBe(true);
  });

  it('always rates active ransomware as Critical (rule R1)', () => {
    const r = classify({ ...base, category: 'ransomware', ongoing: 'yes' });
    expect(r.scoreSeverity).not.toBe('critical'); // the score alone would be lower…
    expect(r.severity).toBe('critical'); // …but the escalation floor applies
    expect(r.rules.map((x) => x.id)).toContain('R1');
    expect(r.priority).toBe('P1');
  });

  it('escalates large-scale personal data exposure to Critical (rule R2)', () => {
    const r = classify({ ...base, category: 'data_breach', confidentiality: 2, dataTypes: ['pii'], scope: 'hundreds' });
    expect(r.severity).toBe('critical');
    expect(r.rules.map((x) => x.id)).toContain('R2');
  });

  it('raises confirmed health-data exposure to at least High (rule R3)', () => {
    const r = classify({ ...base, category: 'other', confidentiality: 2, dataTypes: ['health'] });
    expect(['high', 'critical']).toContain(r.severity);
    expect(r.rules.map((x) => x.id)).toContain('R3');
  });

  it('explains the score: factors add up and respect their maxima', () => {
    const r = classify({ category: 'ransomware', confidentiality: 3, integrity: 3, availability: 3, dataTypes: ['health', 'financial', 'pii'], scope: 'thousands', ongoing: 'yes' });
    expect(r.factors.reduce((s, f) => s + f.points, 0)).toBe(r.score);
    for (const f of r.factors) expect(f.points).toBeLessThanOrEqual(f.max);
    expect(r.score).toBe(100);
  });

  it('maps score bands to severities', () => {
    expect(severityFromScore(0)).toBe('low');
    expect(severityFromScore(25)).toBe('medium');
    expect(severityFromScore(45)).toBe('high');
    expect(severityFromScore(70)).toBe('critical');
  });

  it('sanitises hostile or malformed input', () => {
    const n = normalizeRiskInput({ category: 'drop table', confidentiality: 99, integrity: -5, dataTypes: ['pii', 'bogus', 'pii'], scope: '??', ongoing: 1 });
    expect(n).toEqual({ category: 'other', confidentiality: 3, integrity: 0, availability: 0, dataTypes: ['pii'], scope: 'unknown', ongoing: 'unknown' });
  });

  it('only flags personal-data breaches when personal data is involved', () => {
    expect(isPersonalDataBreach({ ...base, category: 'data_breach', dataTypes: ['intellectual_property'], confidentiality: 3 })).toBe(false);
    expect(isPersonalDataBreach({ ...base, category: 'data_breach', dataTypes: ['pii'] })).toBe(true);
  });
});
