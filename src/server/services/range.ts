import 'server-only';
import { fromDateTimeInput, zonedDay } from '@/lib/format';

export const RANGE_PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '365d', label: 'Last 12 months', days: 365 },
] as const;

/**
 * Resolve ?range=30d or ?from=YYYY-MM-DD&to=YYYY-MM-DD (organisation timezone,
 * `to` inclusive) into an ISO [from, to) interval.
 */
export function resolveRange(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const now = Date.now();

  if (isDay(get('from')) && isDay(get('to'))) {
    const fromIso = fromDateTimeInput(`${get('from')}T00:00`);
    const toStart = fromDateTimeInput(`${get('to')}T00:00`);
    if (fromIso && toStart && fromIso <= toStart) {
      const toIso = new Date(Date.parse(toStart) + 86_400_000).toISOString();
      return { key: 'custom', label: `${get('from')} to ${get('to')}`, fromIso, toIso, fromDay: get('from')!, toDay: get('to')! };
    }
  }
  const preset = RANGE_PRESETS.find((p) => p.key === get('range')) ?? RANGE_PRESETS[1];
  const fromIso = new Date(now - preset.days * 86_400_000).toISOString();
  const toIso = new Date(now + 60_000).toISOString();
  return { key: preset.key, label: preset.label, fromIso, toIso, fromDay: zonedDay(fromIso), toDay: zonedDay(new Date(now)) };
}
