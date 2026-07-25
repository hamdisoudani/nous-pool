/** Tiny chart helpers — pure SVG, no dep needed. */
import React from 'react';

export function BarChart({
  data,
  height = 160,
  fields = ['prompt_tokens', 'completion_tokens'] as Array<'prompt_tokens' | 'completion_tokens' | 'requests'>,
  colors = ['#7c3aed', '#06b6d4'],
}: {
  data: Array<Record<string, any>>;
  height?: number;
  fields?: Array<'prompt_tokens' | 'completion_tokens' | 'requests'>;
  colors?: string[];
}) {
  const W = 800;
  const H = height;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 28;

  if (!data.length) {
    return <div className="text-muted text-sm text-center py-8">no data</div>;
  }
  const max = Math.max(
    1,
    ...data.flatMap(d => fields.map(f => Number(d[f] ?? 0))),
  );

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const groupW = innerW / data.length;
  const barW = (groupW - 4) / fields.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {[0.25, 0.5, 0.75, 1].map(t => {
          const y = PAD_T + innerH * (1 - t);
          return (
            <g key={t}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1f2937" strokeDasharray="2,4" />
              <text x={PAD_L - 6} y={y + 4} fontSize="10" fill="#8b95a1" textAnchor="end">
                {Math.round(max * t).toLocaleString()}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = PAD_L + i * groupW + 2;
          return (
            <g key={i}>
              {fields.map((f, j) => {
                const v = Number(d[f] ?? 0);
                const h = (v / max) * innerH;
                const y = PAD_T + innerH - h;
                return (
                  <rect
                    key={f}
                    x={x + j * barW}
                    y={y}
                    width={barW - 1}
                    height={h}
                    fill={colors[j]}
                    opacity={0.9}
                  />
                );
              })}
              {data.length <= 30 && (
                <text
                  x={x + groupW / 2 - 2}
                  y={H - 10}
                  fontSize="9"
                  fill="#8b95a1"
                  textAnchor="middle"
                >
                  {d.date?.slice(5) ?? ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function HealthDot({ status }: { status: string }) {
  const color =
    status === 'active' ? '#22c55e' :
    status === 'refreshing' ? '#06b6d4' :
    status === 'degraded' ? '#f59e0b' :
    status === 'dead' ? '#ef4444' :
    status === 'disabled' ? '#8b95a1' :
    '#8b95a1';
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="capitalize text-sm">{status}</span>
    </span>
  );
}

export function formatNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function formatCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const now = Date.now();
  const dt = (now - t) / 1000;
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}