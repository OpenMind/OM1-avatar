import { useEffect, useRef, useState } from 'react';

export const SUBSYSTEM_STATES = ['ok', 'warn', 'down', 'unknown'] as const;

export type SubsystemState = (typeof SUBSYSTEM_STATES)[number];

export const SUBSYSTEM_KEYS = ['camera', 'lidar', 'mic', 'speaker', 'wifi'] as const;

export type SubsystemKey = (typeof SUBSYSTEM_KEYS)[number];

const SEVERITY: Record<SubsystemState, number> = {
  ok: 0,
  warn: 1,
  unknown: 2,
  down: 3,
};

const NUMERIC_FIELDS = [
  'fps',
  'hz',
  'level',
  'peak',
  'last_playback_age_s',
  'rssi_dbm',
  'quality',
] as const;

export interface Subsystem {
  state: SubsystemState;
  detail?: string;
  fps?: number;
  hz?: number;
  level?: number;
  peak?: number;
  last_playback_age_s?: number;
  rssi_dbm?: number;
  quality?: number;
}

export interface SystemStatus {
  type: 'system_status';
  ts: number;
  overall: SubsystemState;
  subsystems: Partial<Record<SubsystemKey, Subsystem>>;
}

export type NormalizedStatus = Omit<SystemStatus, 'subsystems'> & {
  subsystems: Record<SubsystemKey, Subsystem>;
};

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const isState = (value: unknown): value is SubsystemState =>
  SUBSYSTEM_STATES.includes(value as SubsystemState);

export function isSystemStatus(value: unknown): value is SystemStatus {
  if (typeof value !== 'object' || value === null) return false;

  const frame = value as Record<string, unknown>;
  if (frame.type !== 'system_status') return false;
  if (frame.subsystems !== undefined && (typeof frame.subsystems !== 'object' || frame.subsystems === null)) {
    return false;
  }
  if (frame.overall !== undefined && !isState(frame.overall)) return false;

  return true;
}

function normalizeSubsystem(value: unknown): Subsystem {
  if (typeof value !== 'object' || value === null) return { state: 'unknown' };

  const raw = value as Record<string, unknown>;
  const subsystem: Subsystem = {
    state: isState(raw.state) ? raw.state : 'unknown',
  };

  if (typeof raw.detail === 'string') subsystem.detail = raw.detail;

  for (const field of NUMERIC_FIELDS) {
    const candidate = raw[field];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      subsystem[field] = candidate;
    }
  }

  return subsystem;
}

export function normalizeSystemStatus(frame: SystemStatus): NormalizedStatus {
  const raw = (frame.subsystems ?? {}) as Record<string, unknown>;
  const subsystems = {} as Record<SubsystemKey, Subsystem>;

  for (const key of SUBSYSTEM_KEYS) {
    subsystems[key] = key in raw ? normalizeSubsystem(raw[key]) : { state: 'unknown' };
  }

  const reported = SUBSYSTEM_KEYS.filter((key) => key in raw).map((key) => subsystems[key].state);
  const derived = reported.reduce<SubsystemState>(
    (worst, state) => (SEVERITY[state] > SEVERITY[worst] ? state : worst),
    reported.length > 0 ? 'ok' : 'unknown',
  );

  return {
    type: 'system_status',
    ts: typeof frame.ts === 'number' && Number.isFinite(frame.ts) ? frame.ts : 0,
    overall: isState(frame.overall) ? frame.overall : derived,
    subsystems,
  };
}

export function staleStatus(ts: number): NormalizedStatus {
  return normalizeSystemStatus({
    type: 'system_status',
    ts,
    overall: 'unknown',
    subsystems: {},
  });
}

export const ACTIVITIES = ['listening', 'thinking', 'speaking'] as const;

export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_STATES = [...ACTIVITIES, 'idle'] as const;

export type ActivityState = (typeof ACTIVITY_STATES)[number];

export interface ActivityStatus {
  type: 'activity_state';
  ts: number;
  state: ActivityState | null;
  detail?: string;
}

const isActivityState = (value: unknown): value is ActivityState =>
  ACTIVITY_STATES.includes(value as ActivityState);

export function isActivityStatus(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;

  return (value as Record<string, unknown>).type === 'activity_state';
}

export function normalizeActivityStatus(frame: Record<string, unknown>): ActivityStatus {
  return {
    type: 'activity_state',
    ts: typeof frame.ts === 'number' && Number.isFinite(frame.ts) ? frame.ts : 0,
    state: isActivityState(frame.state) ? frame.state : null,
    ...(typeof frame.detail === 'string' ? { detail: frame.detail } : {}),
  };
}

export type MicSourceStatus = 'pending' | 'active' | 'denied' | 'unavailable';

const FFT_SIZE = 1024;
const FLOOR_DB = -62;
const CEILING_DB = -14;
const ATTACK = 0.55;
const DECAY = 0.055;
const PEAK_FALL_PER_FRAME = 0.0045;

function toNormalized(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-8));
  return clamp01((db - FLOOR_DB) / (CEILING_DB - FLOOR_DB));
}

export function useMicLevel(onLevel: (level: number, peak: number) => void): MicSourceStatus {
  const [status, setStatus] = useState<MicSourceStatus>('pending');
  const callbackRef = useRef(onLevel);

  useEffect(() => {
    callbackRef.current = onLevel;
  }, [onLevel]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let cancelled = false;

    const stop = () => {
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => undefined);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
        setStatus('unavailable');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        setStatus(name === 'NotFoundError' || name === 'NotReadableError' ? 'unavailable' : 'denied');
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      context = new AudioContext();
      await context.resume().catch(() => undefined);

      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;

      const mute = context.createGain();
      mute.gain.value = 0;

      context.createMediaStreamSource(stream).connect(analyser);
      analyser.connect(mute).connect(context.destination);

      const samples = new Float32Array(analyser.fftSize);
      let level = 0;
      let peak = 0;

      setStatus('active');

      const tick = () => {
        analyser.getFloatTimeDomainData(samples);

        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];

        const target = toNormalized(Math.sqrt(sum / samples.length));
        level += (target - level) * (target > level ? ATTACK : DECAY);
        peak = Math.max(level, peak - PEAK_FALL_PER_FRAME);

        callbackRef.current(level, peak);
        frame = requestAnimationFrame(tick);
      };

      frame = requestAnimationFrame(tick);
    };

    start();

    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return status;
}

interface NetworkInformation extends EventTarget {
  downlink?: number;
  effectiveType?: string;
}

function connection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

export function useDownlink(): number | undefined {
  const [downlink, setDownlink] = useState<number | undefined>(() => connection()?.downlink);

  useEffect(() => {
    const link = connection();
    if (!link) return;

    const update = () => setDownlink(link.downlink);
    update();
    link.addEventListener('change', update);

    return () => link.removeEventListener('change', update);
  }, []);

  return typeof downlink === 'number' && Number.isFinite(downlink) ? downlink : undefined;
}

export function barsFromDownlink(downlink: number): number {
  if (downlink >= 10) return 4;
  if (downlink >= 5) return 3;
  if (downlink >= 1.5) return 2;
  if (downlink > 0) return 1;
  return 0;
}

export function barsFromRssi(rssi: number): number {
  if (rssi >= -57) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -77) return 2;
  return 1;
}
