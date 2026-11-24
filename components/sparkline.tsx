"use client";

/**
 * Tiny dependency-free sparkline: renders an SVG polyline with a soft fill
 * from a numeric series. Negative/empty series render as a flat line.
 */
export function Sparkline({
  values,
  width = 120,
  height = 30,
  className,
  stroke = "currentColor",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line
          x1={0}
          y1={height - 2}
          x2={width}
          y2={height - 2}
          stroke={stroke}
          strokeOpacity={0.25}
          strokeWidth={1.5}
        />
      </svg>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    // Invert: higher values are higher on screen; pad 2px top/bottom.
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const gradientId = `spark-${Math.round(width)}-${values.length}-${Math.round(max)}`;

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
