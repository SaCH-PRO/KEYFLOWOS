import { cn } from "../lib/utils";

export interface TableProps {
  headers: string[];
  rows: Array<Array<string | React.ReactNode>>;
  className?: string;
}

export function Table({ headers, rows, className }: TableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] shadow-[var(--kf-shadow)]",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left text-[hsl(var(--kf-foreground))]">
          <thead className="bg-[hsl(var(--kf-muted))] text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--kf-muted-foreground))]">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className="border-t border-[hsl(var(--kf-border))] hover:bg-[hsl(var(--kf-muted))] transition-colors"
              >
                {row.map((cell, cidx) => (
                  <td key={cidx} className="px-4 py-3 align-middle text-[hsl(var(--kf-foreground))]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
