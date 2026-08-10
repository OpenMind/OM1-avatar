import { useEffect, useState } from 'react';

interface SubtitlesProps {
  text: string;
}

// Fallback speaking rate; the backend sends a measured rate when it has one.
const DEFAULT_CHARS_PER_SECOND = 13;
// Longest chunk that comfortably fits one subtitle line at text-2xl.
const MAX_LINE_CHARS = 52;

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (current && current.length + 1 + word.length > MAX_LINE_CHARS) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Steps through `text` one line-sized chunk at a time, paced to the
 * estimated speech rate, so the subtitle follows along as the robot talks.
 * Runs to the end of the sentence even if playback state ends first, so a
 * long response is never cut short. Bump `run` to restart for a new
 * utterance (even one with identical text).
 */
export function usePacedSubtitle(
  text: string,
  run: number,
  charsPerSecond?: number,
): { chunk: string; done: boolean } {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(true);

  useEffect(() => {
    setIndex(0);
    if (!text) {
      setDone(true);
      return;
    }
    setDone(false);

    const cps = charsPerSecond && charsPerSecond > 0 ? charsPerSecond : DEFAULT_CHARS_PER_SECOND;
    const chunks = chunkText(text);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;

    const scheduleNext = () => {
      timer = setTimeout(() => {
        i += 1;
        if (i < chunks.length) {
          setIndex(i);
          scheduleNext();
        } else {
          setDone(true);
        }
      }, (chunks[i].length / cps) * 1000);
    };
    scheduleNext();

    return () => clearTimeout(timer);
    // charsPerSecond is intentionally omitted: the rate is locked in when an
    // utterance starts so a mid-sentence rate update can't reset the pacing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, run]);

  if (!text) return { chunk: '', done: true };
  const chunks = chunkText(text);
  return { chunk: chunks[Math.min(index, chunks.length - 1)] ?? '', done };
}

export function Subtitles({ text }: SubtitlesProps) {
  if (!text) return null;

  return (
    <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pointer-events-none px-4">
      <div
        className="max-w-4xl min-w-0 rounded-[20px] px-7 py-5"
        style={{
          background: 'linear-gradient(180deg, rgba(28,28,32,0.88), rgba(8,8,12,0.95))',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 50px rgba(255,255,255,0.1)',
        }}
      >
        <p className="text-white/95 text-center text-xl md:text-2xl font-medium leading-relaxed tracking-wide whitespace-nowrap overflow-hidden text-ellipsis">
          {text}
        </p>
      </div>
    </div>
  );
}
