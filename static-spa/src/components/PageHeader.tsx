import { ReactNode } from "react";

/**
 * Consistent page title block. Every page uses this so the type scale and
 * spacing above the fold never drift between routes.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** Small uppercase label that introduces a grid of cards. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="section-label mb-2.5">{children}</h2>;
}

/**
 * Compact stat tile — label, big tabular number, optional sub-line.
 * Deliberately short: these are scanned, not read.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];

  return (
    <div className="surface min-w-0 px-4 py-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1.5 truncate text-2xl font-semibold tabular-nums leading-none ${toneClass}`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}
