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
    <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pointer-events-none px-4 transition-all duration-300">
      <div className="bg-gray-700/85 backdrop-blur-md rounded-2xl px-8 py-4 shadow-2xl border border-gray-500/30 max-w-4xl transition-all duration-300">
        <p className="text-white text-center text-2xl md:text-3xl font-medium leading-relaxed tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          {displayedText}
        </p>
      </div>
    </div>
  );
}
