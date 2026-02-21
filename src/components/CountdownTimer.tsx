interface CountdownTimerProps {
  remainingSeconds: number | null;
}

const TOTAL_SECONDS = 20;
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function getColor(seconds: number): string {
  if (seconds >= 10) return '#22c55e';
  if (seconds >= 5) return '#eab308';
  return '#ef4444';
}

export function CountdownTimer({ remainingSeconds }: CountdownTimerProps) {
  if (remainingSeconds === null) return null;

  const clamped = Math.max(0, Math.min(TOTAL_SECONDS, remainingSeconds));
  const progress = clamped / TOTAL_SECONDS;
  const offset = CIRCUMFERENCE * (1 - progress);
  const color = getColor(clamped);

  return (
    <div className="fixed top-4 right-48 z-50">
      <svg width="128" height="128" viewBox="0 0 128 128">
        {/* Background ring */}
        <circle
          cx="64"
          cy="64"
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="6"
        />
        {/* Progress ring */}
        <circle
          cx="64"
          cy="64"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease',
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
          }}
        />
        {/* Center text */}
        <text
          x="64"
          y="64"
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize="40"
          fontWeight="bold"
          fontFamily="monospace"
          style={{ transition: 'fill 0.3s ease' }}
        >
          {Math.ceil(clamped)}
        </text>
      </svg>
    </div>
  );
}
