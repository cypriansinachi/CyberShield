/**
 * Display formatting. Everything is stored in UTC and converted to the
 * organisation's timezone only for display and form inputs.
 */
import { APP_TIMEZONE } from './constants';

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, day: '2-digit', month: 'short' });
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatDay = (d: Date) => dayFmt.format(d);

function zonedParts(date: Date) {
  const out: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "YYYY-MM-DD" calendar day in the organisation's timezone. */
export function zonedDay(iso: string | Date) {
  const p = zonedParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}`;
}

/** ISO UTC → "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export function toDateTimeInput(iso: string | null | undefined) {
  if (!iso) return '';
  const p = zonedParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "YYYY-MM-DDTHH:mm" in the organisation's timezone → ISO UTC (null if invalid). */
export function fromDateTimeInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = zonedParts(new Date(guess));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (asUtc - guess)).toISOString();
}

export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '—';
  const diff = now - Date.parse(iso);
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  let text: string;
  if (s < 60) text = 'just now';
  else if (s < 3600) text = `${Math.floor(s / 60)} min`;
  else if (s < 86400) text = `${Math.floor(s / 3600)} h`;
  else if (s < 86400 * 30) text = `${Math.floor(s / 86400)} d`;
  else return formatDate(iso);
  if (text === 'just now') return text;
  return future ? `in ${text}` : `${text} ago`;
}

export function formatDuration(ms: number) {
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

export function formatHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** True if the timestamp is in the past (request-time check in Server Components). */
export const isPast = (iso: string | null | undefined) => !!iso && Date.parse(iso) < Date.now();
export const isFuture = (iso: string | null | undefined) => !!iso && Date.parse(iso) > Date.now();

export const formatPercent =(v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
