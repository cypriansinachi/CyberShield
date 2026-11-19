/**
 * Runs once when a long-lived server starts (local, Docker). Schedules
 * automatic SLA escalation so overdue incidents are flagged to managers even
 * when nobody has the dashboard open.
 *
 * Serverless hosts (Vercel) freeze instances between requests, so timers are
 * unreliable there; Vercel Cron calls /api/cron/sla instead (vercel.json), and
 * the app also escalates opportunistically while people use it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL) return;
  const { runSlaEscalations } = await import('./server/services/incidents');
  const tick = async () => {
    try {
      const n = await runSlaEscalations();
      if (n) console.info(`[sla] escalated ${n} incident(s)`);
    } catch (err) {
      console.error('[sla] escalation check failed', err);
    }
  };
  setTimeout(tick, 10_000).unref?.();
  setInterval(tick, 60_000).unref?.();
}
