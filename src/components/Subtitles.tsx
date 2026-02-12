import { useState, useEffect } from 'react';

interface SubtitlesProps {
  text: string;
}

export function Subtitles({ text }: SubtitlesProps) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      return;
    }

    setDisplayedText('');
    let currentIndex = 0;
    let timeoutId: NodeJS.Timeout;

    const typeNextChar = () => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
        
        const currentChar = text[currentIndex - 1];
        const isPunctuation = /[.,!?;:]/.test(currentChar);

        let delay = 50;
        if (isPunctuation) delay = 150;

        timeoutId = setTimeout(typeNextChar, delay);
      }
    };
    
    typeNextChar();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [text]);

  if (!text && !displayedText) return null;

  return (
    <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pointer-events-none px-4">
      <div
        className="max-w-4xl rounded-[20px] px-7 py-5"
        style={{
          background: 'linear-gradient(180deg, rgba(40,40,40,0.55), rgba(10,10,10,0.85))',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 25px rgba(0,140,255,0.15)',
        }}
      >
        <p className="text-white/95 text-center text-2xl md:text-3xl font-medium leading-relaxed tracking-wide">
          {displayedText}
        </p>
      </div>
    </div>
  );
}
