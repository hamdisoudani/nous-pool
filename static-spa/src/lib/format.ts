/** Shared display formatters. Keep table cells single-line and non-wrapping. */

const numberFmt = new Intl.NumberFormat();

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

/** 1_234 -> "1.2k". Used where column width matters more than precision. */
export function compactNumber(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** "26 Jul 2026, 10:53" — stable width, never wraps mid-cell. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * "just now" / "14m" / "3h" / "6d" / "26 Jul". Pair with a `title` holding the
 * absolute timestamp so precision is one hover away.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** Percentage with one decimal, guarding divide-by-zero. */
export function percent(part: number, total: number): string {
  if (!total) return "0.0";
  return ((part / total) * 100).toFixed(1);
}
