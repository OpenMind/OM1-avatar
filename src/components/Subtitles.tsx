interface SubtitlesProps {
  text: string;
}

export function Subtitles({ text }: SubtitlesProps) {
  if (!text) return null;

  return (
    <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pointer-events-none px-4">
      <div
        className="max-w-4xl rounded-[20px] px-7 py-5"
        style={{
          background: 'linear-gradient(180deg, rgba(28,28,32,0.88), rgba(8,8,12,0.95))',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 50px rgba(255,255,255,0.1)',
        }}
      >
        <p className="text-white/95 text-center text-2xl md:text-3xl font-medium leading-relaxed tracking-wide">
          {text}
        </p>
      </div>
    </div>
  );
}
