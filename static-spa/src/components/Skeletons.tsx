import { Skeleton } from "./ui/skeleton";
import { Card, CardContent } from "./ui/card";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

/**
 * Loading placeholders that mirror the shape of the real content.
 *
 * The point is to reserve the same box the data will occupy, so nothing jumps
 * when it arrives. Each of these is sized to match its loaded counterpart.
 */

/** Matches <StatTile> — label line, big number, hint line. */
export function StatTileSkeleton() {
  return (
    <div className="surface min-w-0 px-4 py-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2.5 h-6 w-14" />
      <Skeleton className="mt-2.5 h-3 w-28" />
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <StatTileSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Table body placeholder. `widths` drives per-column bar width so the skeleton
 * echoes the real column rhythm instead of a uniform grey grid.
 */
export function TableSkeleton({
  rows = 6,
  widths = ["60%", "40%", "50%", "35%", "45%", "30%"],
}: {
  rows?: number;
  widths?: string[];
}) {
  return (
    <Table>
      <TableBody>
        {Array.from({ length: rows }, (_, r) => (
          <TableRow key={r} className="h-11">
            {widths.map((w, c) => (
              <TableCell key={c} className="py-1.5">
                <Skeleton className="h-3.5" style={{ width: w }} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Card-wrapped table placeholder — the common page-level loading state. */
export function TableCardSkeleton(props: { rows?: number; widths?: string[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <TableSkeleton {...props} />
      </CardContent>
    </Card>
  );
}

/** Matches the small stat cards with a title row and 3-4 label/value rows. */
export function DetailCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <Skeleton className="h-3.5 w-32" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Grid of model-card placeholders — used by the supported-models panel.
 * Mirrors <ModelCard>: title, id line, modality row, stats row, chips row.
 */
export function ModelCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
        >
          <div>
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-1.5 h-2.5 w-full max-w-[180px]" />
          </div>
          <div className="flex gap-1">
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
          </div>
          <Skeleton className="h-3 w-40" />
          <div className="flex gap-1">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
