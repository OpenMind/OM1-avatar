import { Fragment, useEffect, useRef, useState } from 'react';
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

const ICON_SIZE = 28;

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

function ActivityBox({ activity, active }: { activity: Activity; active: boolean }) {
  const color = active ? ACTIVITY_COLORS[activity] : IDLE_COLOR;
  const Icon = LAMP_ICONS[activity];

  return (
    <div
      className="flex items-center gap-3 rounded-xl py-2.5 pr-4 pl-3"
      style={{
        background: active
          ? `linear-gradient(180deg, ${ACTIVITY_COLORS[activity]}33, rgba(8,8,12,0.95))`
          : 'linear-gradient(180deg, rgba(28,28,32,0.88), rgba(8,8,12,0.95))',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: active
          ? `1px solid ${ACTIVITY_COLORS[activity]}88`
          : '1px solid rgba(255,255,255,0.2)',
        boxShadow: active
          ? `0 8px 30px rgba(0,0,0,0.55), 0 0 18px ${ACTIVITY_COLORS[activity]}44`
          : '0 8px 30px rgba(0,0,0,0.55)',
        transition: 'background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
      }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center"
        style={{
          filter: active ? `drop-shadow(0 0 5px ${ACTIVITY_COLORS[activity]}88)` : 'none',
        }}
      >
        <Icon active={active} color={color} />
      </div>
      <span
        className="text-[14px] font-semibold uppercase leading-none tracking-[0.14em]"
        style={{ color, transition: 'color 0.25s ease' }}
      >
        {activity}
      </span>
    </div>
  );
}

interface FlowArrowProps {
  /** Bumps whenever this arrow should replay its flow animation; null while static. */
  flowKey: number | null;
}

function FlowArrow({ flowKey }: FlowArrowProps) {
  const flowing = flowKey !== null;

  return (
    <div aria-hidden="true" className="flex items-center px-1">
      <svg
        key={flowKey ?? 'static'}
        width={24}
        height={16}
        viewBox="0 0 24 16"
        fill="none"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          className={flowing ? 'activity-arrow' : undefined}
          style={flowing ? undefined : { opacity: 0.3 }}
          d="M4 3l5 5-5 5"
        />
        <path
          className={flowing ? 'activity-arrow' : undefined}
          style={flowing ? { animationDelay: '0.3s' } : { opacity: 0.3 }}
          d="M13 3l5 5-5 5"
        />
      </svg>
    </div>
  );
}

export function ActivityIndicator({ state, stale }: ActivityIndicatorProps) {
  const live = stale ? null : state;

  // Replay the flow animation on the arrow leading into the newly active box.
  const [flow, setFlow] = useState<{ arrow: number; key: number } | null>(null);
  const prevLive = useRef<ActivityState | null>(null);

  useEffect(() => {
    const prev = prevLive.current;
    prevLive.current = live;
    if (!live || live === 'idle' || live === prev) return;
    const index = ACTIVITIES.indexOf(live);
    if (index <= 0) return;
    setFlow((current) => ({ arrow: index - 1, key: (current?.key ?? 0) + 1 }));
    const timer = setTimeout(() => setFlow(null), 2000);
    return () => clearTimeout(timer);
  }, [live]);

  return (
    <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 pointer-events-none">
      <div
        className="pointer-events-auto flex flex-row items-center"
        style={{
          opacity: stale ? 0.65 : 1,
          transition: 'opacity 0.3s ease',
        }}
      >
        {ACTIVITIES.map((activity, index) => (
          <Fragment key={activity}>
            {index > 0 && (
              <FlowArrow flowKey={flow?.arrow === index - 1 ? flow.key : null} />
            )}
            <ActivityBox activity={activity} active={live === activity} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
