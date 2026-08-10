import type { CSSProperties, ReactElement } from 'react';
import { ACTIVITIES } from '../utils/status';
import type { Activity, ActivityState } from '../utils/status';

interface ActivityIndicatorProps {
  state: ActivityState | null;
  stale: boolean;
}

const ACTIVITY_COLORS: Record<Activity, string> = {
  listening: '#38bdf8',
  thinking: '#fb923c',
  speaking: '#34d399',
};

const IDLE_COLOR = 'rgba(255,255,255,0.28)';

const ICON_SIZE = 20;

interface IconProps {
  active: boolean;
  color: string;
}

function glyphProps(color: string) {
  return {
    width: ICON_SIZE,
    height: ICON_SIZE,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: { transition: 'stroke 0.25s ease' } as CSSProperties,
  };
}

function ListeningIcon({ active, color }: IconProps) {
  return (
    <svg {...glyphProps(color)}>
      <rect x="9" y="2.6" width="6" height="10" rx="3" />
      <path d="M5.6 11a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.4V21" />
      {active && (
        <>
          <path className="activity-ripple" d="M3.1 8.4a9 9 0 0 0 0 4" />
          <path
            className="activity-ripple"
            d="M20.9 8.4a9 9 0 0 1 0 4"
            style={{ animationDelay: '0.2s' }}
          />
        </>
      )}
    </svg>
  );
}

function ThinkingIcon({ active, color }: IconProps) {
  return (
    <svg {...glyphProps(color)}>
      <g
        className={active ? 'activity-spin' : undefined}
        style={{ transformOrigin: '50% 50%' }}
      >
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9" />
      </g>
    </svg>
  );
}

function SpeakingIcon({ active, color }: IconProps) {
  const bars = [
    { x: 2.6, height: 6 },
    { x: 6.6, height: 11 },
    { x: 10.6, height: 16 },
    { x: 14.6, height: 11 },
    { x: 18.6, height: 6 },
  ];

  return (
    <svg {...glyphProps(color)} stroke="none" fill={color}>
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          className={active ? 'activity-wave' : undefined}
          x={bar.x}
          y={(24 - bar.height) / 2}
          width="2.8"
          height={bar.height}
          rx="1.4"
          style={{
            transformOrigin: '50% 50%',
            transition: 'fill 0.25s ease',
            ...(active
              ? { animationDelay: `${index * 0.11}s` }
              : { transform: 'scaleY(0.45)' }),
          }}
        />
      ))}
    </svg>
  );
}

const LAMP_ICONS: Record<Activity, (props: IconProps) => ReactElement> = {
  listening: ListeningIcon,
  thinking: ThinkingIcon,
  speaking: SpeakingIcon,
};

function ActivityRow({ activity, active }: { activity: Activity; active: boolean }) {
  const color = active ? ACTIVITY_COLORS[activity] : IDLE_COLOR;
  const Icon = LAMP_ICONS[activity];

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg py-1.5 pr-2.5 pl-2"
      style={{
        background: active ? `${ACTIVITY_COLORS[activity]}22` : 'transparent',
        boxShadow: active ? `inset 0 0 0 1px ${ACTIVITY_COLORS[activity]}55` : 'none',
        transition: 'background 0.25s ease, box-shadow 0.25s ease',
      }}
    >
      <div
        className="flex h-5 w-5 items-center justify-center"
        style={{
          filter: active ? `drop-shadow(0 0 5px ${ACTIVITY_COLORS[activity]}88)` : 'none',
        }}
      >
        <Icon active={active} color={color} />
      </div>
      <span
        className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em]"
        style={{ color, transition: 'color 0.25s ease' }}
      >
        {activity}
      </span>
    </div>
  );
}

export function ActivityIndicator({ state, stale }: ActivityIndicatorProps) {
  const live = stale ? null : state;

  return (
    <div className="fixed top-1/2 right-4 z-50 -translate-y-1/2 pointer-events-none">
      <div
        className="pointer-events-auto flex w-[142px] flex-col gap-1 rounded-xl px-2 py-2"
        style={{
          background: 'linear-gradient(180deg, rgba(28,28,32,0.88), rgba(8,8,12,0.95))',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
          opacity: stale ? 0.65 : 1,
          transition: 'opacity 0.3s ease',
        }}
      >
        {ACTIVITIES.map((activity) => (
          <ActivityRow key={activity} activity={activity} active={live === activity} />
        ))}
      </div>
    </div>
  );
}
