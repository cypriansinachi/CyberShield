'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';

type Point = { day: string; label: string; reported: number; resolved: number };

const SERIES = [
  { key: 'reported', name: 'Reported', color: 'var(--chart-1)' },
  { key: 'resolved', name: 'Resolved', color: 'var(--chart-2)' },
] as const;

function ChartTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {SERIES.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <p key={s.key} className="flex items-center gap-2 text-muted-foreground">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.name}
            <span className="ml-auto pl-4 font-medium tabular-nums text-foreground">{v}</span>
          </p>
        );
      })}
    </div>
  );
}

export function TrendChart({ data }: { data: Point[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="h-60" role="img" aria-label="Line chart of incidents reported and resolved per day over the last 30 days">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grid)' }}
              tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} width={44} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)', fill: s.color }}
                animationDuration={900}
                animationEasing="ease-out"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View as table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-left tabular-nums">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">Reported</th>
                <th className="px-3 py-1.5 text-right font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="px-3 py-1">{d.label}</td>
                  <td className="px-3 py-1 text-right">{d.reported}</td>
                  <td className="px-3 py-1 text-right">{d.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
