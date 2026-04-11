"use client";

export function HealthGauge({ score, size = 120 }: { score: number | null; size?: number }) {
  const value = score ?? 0;
  const radius = (size / 2) - 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 70 ? "hsl(var(--kf-success))" : value >= 40 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="hsl(var(--muted))" strokeWidth="8" opacity="0.2"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score ?? "—"}</span>
        <span className="text-[10px] text-muted-foreground font-medium">/ 100</span>
      </div>
    </div>
  );
}
