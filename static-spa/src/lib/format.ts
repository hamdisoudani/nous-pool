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

/** 3 significant figures with trailing zeros dropped: 262.144 -> "262",
 *  32.768 -> "32.8", 1.048576 -> "1.05", 1 -> "1". */
function threeSigFigs(v: number): string {
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  // Guard the `.`: stripping zeros off "100" would yield "1".
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Token counts: 262144 -> "262K", 32768 -> "32.8K", 1048576 -> "1.05M".
 *
 * Decimal K/M, matching how the upstream catalogue itself displays these, so a
 * number here can be compared against Nous' own docs without conversion. Never
 * rounds up to a cleaner-looking figure than the truth — a context window is a
 * hard limit and "32K" for 32768 would be a lie in the wrong direction. Pair
 * with a `title` holding the exact integer where precision matters.
 */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${threeSigFigs(n / 1_000_000)}M`;
  if (abs >= 1000) return `${threeSigFigs(n / 1000)}K`;
  return String(n);
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
