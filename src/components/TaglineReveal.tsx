import { useEffect, useRef, useState } from 'react';

interface TaglineRevealProps {
  text: string;
}

export function TaglineReveal({ text }: TaglineRevealProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const words = text.trim().split(/\s+/);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setActiveCount(words.length);
      return;
    }

    let rafId = 0;
    const updateProgress = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const start = viewportHeight * 0.85;
      const end = viewportHeight * 0.28;
      const progress = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
      setActiveCount(Math.round(progress * words.length));
    };

    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateProgress);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          updateProgress();
          window.addEventListener('scroll', onScroll, { passive: true });
        } else {
          window.removeEventListener('scroll', onScroll);
        }
      },
      { threshold: 0.05 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
      updateProgress();
    }

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [words.length, reducedMotion]);

  return (
    <section
      ref={containerRef}
      aria-label="Core automation statement"
      className="py-24 px-6 border-t border-[#1F1F1F]"
    >
      <div className="max-w-[680px] mx-auto">
        <p className="heading-3 sm:heading-2 leading-tight">
          {words.map((word, index) => {
            const isRevealed = index < activeCount;
            return (
              <span
                key={`${word}-${index}`}
                className="inline-block mr-[0.28em] transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  opacity: isRevealed ? 1 : 0.25,
                  color: '#F5F5F5',
                }}
              >
                {word}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}
