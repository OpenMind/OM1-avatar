import type { CotKind, CotStatus } from '../utils/status';

interface CotWindowProps {
  cot: CotStatus | null;
  stale: boolean;
}

const KIND_STYLES: Record<CotKind, { label: string; color: string }> = {
  heard: { label: 'HEARD', color: '#38bdf8' },
  think: { label: 'THINK', color: '#fb923c' },
  reply: { label: 'REPLY', color: '#34d399' },
  action: { label: 'ACT', color: '#a78bfa' },
  speak: { label: 'SPEAK', color: '#34d399' },
  mode: { label: 'MODE', color: '#a78bfa' },
  flow: { label: 'FLOW', color: '#f472b6' },
};

const MAX_ROWS = 5;

export function CotWindow({ cot, stale }: CotWindowProps) {
  if (!cot) return null;

  const events = cot.events.slice(-MAX_ROWS);

  return (
    <div className="fixed top-1/2 left-4 z-50 -translate-y-1/2 pointer-events-none">
      <div
        className="pointer-events-auto flex w-[144px] flex-col gap-1.5 rounded-xl px-2 py-2"
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
        <span
          className="text-[9px] font-semibold uppercase leading-none tracking-[0.18em]"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          processing
        </span>

        {cot.vision && (
          <div className="flex flex-col gap-0.5 border-b border-white/10 pb-1.5">
            <span
              className="text-[8px] font-semibold leading-none tracking-wider"
              style={{ color: '#facc15' }}
            >
              SEES
            </span>
            <span
              className="text-[10px] leading-[13px] text-white/70"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {cot.vision}
            </span>
          </div>
        )}

        {events.length === 0 && (
          <span className="text-[11px] leading-4 text-white/40">waiting for activity…</span>
        )}

        {events.map((event, index) => {
          const style = KIND_STYLES[event.kind];
          const newest = index === events.length - 1;
          return (
            // Key on the event itself (not the list index) so rows keep their
            // identity as the ring buffer scrolls: only genuinely new rows
            // mount and play the enter animation; older ones just fade back.
            <div key={`${event.t}-${event.kind}`} className="cot-enter flex flex-col gap-0.5">
              <span
                className="text-[8px] font-semibold leading-none tracking-wider"
                style={{
                  color: style.color,
                  opacity: newest ? 1 : 0.55,
                  transition: 'opacity 0.4s ease',
                }}
              >
                {style.label}
              </span>
              <span
                className="text-[10px] leading-[13px]"
                style={{
                  color: newest ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
                  transition: 'color 0.4s ease',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {event.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
