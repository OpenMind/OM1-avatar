import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { NormalizedStatus, Subsystem, SubsystemState } from '../utils/status';
import {
  barsFromDownlink,
  barsFromRssi,
  clamp01,
  staleStatus,
  useDownlink,
  useMicLevel,
} from '../utils/status';

interface SystemStatusHUDProps {
  status: NormalizedStatus | null;
  stale: boolean;
}

const STATE_COLORS: Record<SubsystemState, string> = {
  ok: '#22c55e',
  warn: '#eab308',
  down: '#ef4444',
  unknown: '#9ca3af',
};

const ICON_SIZE = 18;

const isReporting = (state: SubsystemState) => state === 'ok' || state === 'warn';

function formatRate(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return '--';
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

interface IconProps {
  subsystem?: Subsystem;
}

function Heart({ state, stale }: { state: SubsystemState; stale: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={STATE_COLORS[state]}
      style={{
        animation: stale ? undefined : 'heartbeat 1.4s ease-in-out infinite',
        transformOrigin: '50% 50%',
        transition: 'fill 0.3s ease',
        filter: `drop-shadow(0 0 4px ${STATE_COLORS[state]}66)`,
      }}
    >
      <path d="M12 20.7 3.9 12.6a5.2 5.2 0 0 1 0-7.4 5.2 5.2 0 0 1 7.4 0l.7.7.7-.7a5.2 5.2 0 0 1 7.4 0 5.2 5.2 0 0 1 0 7.4Z" />
    </svg>
  );
}

function MicLevelBar({ subsystem }: IconProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  const handleLevel = useCallback((level: number, peak: number) => {
    if (fillRef.current) fillRef.current.style.height = `${level * 100}%`;
    if (peakRef.current) {
      peakRef.current.style.bottom = `${peak * 100}%`;
      peakRef.current.style.opacity = peak > 0.02 ? '0.75' : '0';
    }
  }, []);

  const micStatus = useMicLevel(handleLevel);
  const live = micStatus === 'active';

  const frameState = subsystem?.state ?? 'unknown';
  const state: SubsystemState = frameState !== 'unknown' ? frameState : live ? 'ok' : 'unknown';

  const frameReporting = isReporting(frameState);
  const frameLevel = frameReporting ? clamp01(subsystem?.level ?? 0) : 0;
  const framePeak = frameReporting ? clamp01(subsystem?.peak ?? 0) : 0;

  const previousLevel = useRef(frameLevel);
  const durationMs = frameLevel >= previousLevel.current ? 50 : 300;

  useEffect(() => {
    previousLevel.current = frameLevel;
  }, [frameLevel]);

  const source = live
    ? 'browser audio'
    : frameReporting
      ? 'publisher frame'
      : micStatus === 'denied'
        ? 'no source (mic permission denied)'
        : 'no source';

  return (
    <div
      title={`mic: ${state} — level from ${source}`}
      className="relative h-9 w-[5px] overflow-hidden rounded-full"
      style={{ background: 'rgba(255,255,255,0.18)' }}
    >
      <div
        ref={fillRef}
        className="absolute bottom-0 left-0 w-full rounded-full"
        style={{
          background: STATE_COLORS[state],
          ...(live
            ? { transition: 'background 0.3s ease' }
            : {
                height: `${frameLevel * 100}%`,
                transition: `height ${durationMs}ms ease-out, background 0.3s ease`,
              }),
        }}
      />
      <div
        ref={peakRef}
        className="absolute left-0 h-px w-full"
        style={{
          background: STATE_COLORS[state],
          ...(live
            ? { transition: 'background 0.3s ease' }
            : {
                bottom: `${framePeak * 100}%`,
                opacity: framePeak > 0 ? 0.75 : 0,
                transition: 'bottom 300ms ease-out',
              }),
        }}
      />
    </div>
  );
}

const WIFI_BARS = [
  { x: 2.6, height: 5.2 },
  { x: 8, height: 9.6 },
  { x: 13.4, height: 14 },
  { x: 18.8, height: 18.4 },
];

const WIFI_BAR_WIDTH = 3.2;
const WIFI_BAR_BASE = 21;

function WifiIcon({ subsystem, downlink }: IconProps & { downlink?: number }) {
  const state = subsystem?.state ?? 'unknown';
  const rssi = subsystem?.rssi_dbm;
  const quality = subsystem?.quality;

  const hasRadio = rssi !== undefined || quality !== undefined;
  const estimated = !hasRadio && downlink !== undefined;

  const radioBars =
    rssi !== undefined
      ? barsFromRssi(rssi)
      : quality !== undefined
        ? Math.min(4, Math.ceil(clamp01(quality) * 4))
        : 0;

  const bars =
    state === 'down' ? 0 : hasRadio ? radioBars : estimated ? barsFromDownlink(downlink) : 0;

  const detail = hasRadio
    ? [
        rssi !== undefined ? `${rssi} dBm` : null,
        quality !== undefined ? `quality ${quality.toFixed(2)}` : null,
      ]
        .filter(Boolean)
        .join(', ')
    : estimated
      ? `no radio data — ${downlink} Mbit/s browser estimate, not a signal reading`
      : 'no radio data';

  return (
    <IconCell state={state} title={`wi-fi: ${state} — ${detail}`} label={null}>
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
        {WIFI_BARS.map((bar, index) => {
          const filled = index < bars;
          return (
            <rect
              key={bar.x}
              x={bar.x}
              y={WIFI_BAR_BASE - bar.height}
              width={WIFI_BAR_WIDTH}
              height={bar.height}
              rx="1.2"
              fill={filled && !estimated ? STATE_COLORS[state] : 'none'}
              stroke={filled ? STATE_COLORS[state] : 'rgba(255,255,255,0.18)'}
              strokeWidth={estimated ? 1.4 : 1}
              strokeDasharray={filled && estimated ? '2 1.6' : undefined}
              opacity={filled && estimated ? 0.75 : 1}
              style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
            />
          );
        })}
      </svg>
    </IconCell>
  );
}

const CAMERA_BODY =
  'M2.4 9a1.8 1.8 0 0 1 1.8-1.8h2.6l1.4-2.4h7.6l1.4 2.4h2.6A1.8 1.8 0 0 1 21.6 9v8.4a1.8 1.8 0 0 1-1.8 1.8H4.2a1.8 1.8 0 0 1-1.8-1.8Z';

function CameraFpsIcon({
  subsystem,
  name,
  variant,
}: IconProps & { name: string; variant: 'depth' | 'rgb' }) {
  const state = subsystem?.state ?? 'unknown';
  const fps = isReporting(state) ? subsystem?.fps : undefined;
  const device = subsystem?.detail;

  return (
    <IconCell
      state={state}
      title={`${name}: ${state}${device ? ` (${device})` : ''}${
        fps !== undefined ? ` — ${fps.toFixed(1)} fps` : ''
      }`}
      label={formatRate(fps, '')}
    >
      <svg
        width={ICON_SIZE}
        height={ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke={STATE_COLORS[state]}
        strokeWidth="2"
        strokeLinecap="round"
        style={{ transition: 'stroke 0.3s ease' }}
      >
        <path d={CAMERA_BODY} strokeLinejoin="round" />
        {variant === 'depth' ? (
          // Stereo pair — the D435i's two imagers, legible at 18px.
          <>
            <circle cx="8.6" cy="13.4" r="2.3" />
            <circle cx="15.4" cy="13.4" r="2.3" />
          </>
        ) : (
          <circle cx="12" cy="13.2" r="3.4" />
        )}
      </svg>
    </IconCell>
  );
}

function LidarIcon({ subsystem }: IconProps) {
  const state = subsystem?.state ?? 'unknown';
  const hz = isReporting(state) ? subsystem?.hz : undefined;

  return (
    <IconCell
      state={state}
      title={`lidar: ${state}${hz !== undefined ? ` — ${hz.toFixed(1)} Hz` : ''}`}
      label={null}
    >
      <svg
        width={ICON_SIZE}
        height={ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke={STATE_COLORS[state]}
        strokeWidth="2"
        strokeLinecap="round"
        style={{ transition: 'stroke 0.3s ease' }}
      >
        <ellipse cx="12" cy="6.4" rx="5" ry="2.1" />
        <path d="M7 6.4v9.2a5 2.1 0 0 0 10 0V6.4" />
        <path d="M7 11.2h10" />
        <path
          d="M4.8 11.2H2.2M21.8 11.2h-2.6"
          opacity={state === 'down' ? 0.35 : 1}
        />
      </svg>
    </IconCell>
  );
}

function SpeakerIcon({ subsystem }: IconProps) {
  const state = subsystem?.state ?? 'unknown';
  const age = subsystem?.last_playback_age_s;

  return (
    <IconCell
      state={state}
      title={`speaker: ${state}${
        age !== undefined ? ` — last playback ${age.toFixed(1)}s ago` : ''
      } (device present + last playback ok, not audibility)`}
      label={null}
    >
      <svg
        width={ICON_SIZE}
        height={ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke={STATE_COLORS[state]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'stroke 0.3s ease' }}
      >
        <path d="M11 4.8 6.2 9H2.8v6h3.4L11 19.2Z" />
        <path d="M15.5 9.2a4 4 0 0 1 0 5.6" opacity={state === 'down' ? 0.35 : 1} />
        <path d="M18.4 6.6a8 8 0 0 1 0 10.8" opacity={state === 'down' ? 0.35 : 1} />
      </svg>
    </IconCell>
  );
}

function IconCell({
  state,
  title,
  label,
  children,
}: {
  state: SubsystemState;
  title: string;
  label: string | null;
  children: ReactNode;
}) {
  return (
    <div title={title} className="flex w-7 flex-col items-center gap-1">
      {children}
      {label !== null && (
        <span
          className="font-mono text-[9px] leading-none tabular-nums"
          style={{ color: STATE_COLORS[state], transition: 'color 0.3s ease' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export function SystemStatusHUD({ status, stale }: SystemStatusHUDProps) {
  const downlink = useDownlink();
  const effective = status ?? staleStatus(0);
  const { overall, subsystems } = effective;

  return (
    <div className="fixed top-4 left-4 z-50 pointer-events-none">
      <div
        className="pointer-events-auto flex items-start gap-3 rounded-xl px-3 py-2.5"
        style={{
          background: 'linear-gradient(180deg, rgba(28,28,32,0.88), rgba(8,8,12,0.95))',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div
            title={`system: ${overall}${stale ? ' (no data — publisher silent)' : ''}`}
            className="flex h-[22px] items-center"
          >
            <Heart state={overall} stale={stale} />
          </div>
          <MicLevelBar subsystem={subsystems.mic} />
        </div>

        <div className="flex items-start gap-2.5">
          <WifiIcon subsystem={subsystems.wifi} downlink={downlink} />
          <CameraFpsIcon subsystem={subsystems.camera} name="depth camera" variant="depth" />
          <CameraFpsIcon subsystem={subsystems.arducam} name="arducam" variant="rgb" />
          <LidarIcon subsystem={subsystems.lidar} />
          <SpeakerIcon subsystem={subsystems.speaker} />
        </div>
      </div>
    </div>
  );
}
