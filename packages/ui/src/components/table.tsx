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
        "overflow-hidden rounded-2xl border border-[var(--kf-border)] bg-[rgba(0,0,0,0.3)] backdrop-blur-md shadow-glass",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left text-[var(--kf-text)]">
          <thead className="bg-[rgba(78,168,255,0.06)] text-xs uppercase tracking-wide text-[var(--kf-text-muted)]">
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
                className="border-t border-[var(--kf-border)]/60 hover:bg-[rgba(78,168,255,0.04)] transition-colors"
              >
                {row.map((cell, cidx) => (
                  <td key={cidx} className="px-4 py-3 align-middle text-[var(--kf-text)]">
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
