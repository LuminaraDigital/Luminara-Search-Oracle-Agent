import React, { useCallback, useEffect, useRef, useState } from 'react';
import { INTRO_ASSETS, markIntroSeen, prefersReducedMotion } from '../../services/intro/appIntro';
import { haptic } from '../../services/telegram/tma';
import { BrandLoader } from './BrandLoader';

type AppIntroOverlayProps = {
  onComplete: () => void;
};

type Phase = 'buffering' | 'play' | 'exit';

/**
 * Full-bleed cinematic intro. Buffers on-brand, plays edge-to-edge, then fades into the app.
 */
export const AppIntroOverlay: React.FC<AppIntroOverlayProps> = ({ onComplete }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const finishingRef = useRef(false);
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('buffering');
  const [progress, setProgress] = useState(0);
  const [showChrome, setShowChrome] = useState(false);
  const [muted, setMuted] = useState(true);
  const [canContinue, setCanContinue] = useState(false);
  const [reduced] = useState(() => prefersReducedMotion());

  const finish = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('exit');
    setProgress(1);
    haptic('success');
    markIntroSeen();
    window.setTimeout(() => onComplete(), 780);
  }, [onComplete]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const chromeTimer = window.setTimeout(() => setShowChrome(true), 700);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(chromeTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [finish]);

  useEffect(() => {
    if (reduced) {
      setPhase('play');
      setShowChrome(true);
      const t = window.setTimeout(finish, 1600);
      return () => window.clearTimeout(t);
    }

    const video = videoRef.current;
    if (!video) return;

    let raf = 0;
    const tick = () => {
      if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
        const p = Math.min(1, video.currentTime / video.duration);
        setProgress(p);
        if (p >= 0.78) setCanContinue(true);
      }
      raf = requestAnimationFrame(tick);
    };

    const beginPlayback = async () => {
      if (startedRef.current || finishingRef.current) return;
      startedRef.current = true;
      setPhase('play');
      try {
        video.muted = true;
        setMuted(true);
        await video.play();
        raf = requestAnimationFrame(tick);
      } catch {
        setShowChrome(true);
        setCanContinue(true);
      }
    };

    const onCanPlay = () => { void beginPlayback(); };
    const onEnded = () => finish();
    const onError = () => finish();

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    try {
      video.load();
    } catch { /* noop */ }

    if (video.readyState >= 3) void beginPlayback();

    const failsafe = window.setTimeout(finish, 14000);
    const bufferFailsafe = window.setTimeout(() => {
      if (!finishingRef.current) void beginPlayback();
    }, 3500);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      window.clearTimeout(failsafe);
      window.clearTimeout(bufferFailsafe);
      try { video.pause(); } catch { /* noop */ }
    };
  }, [finish, reduced]);

  const toggleMute = async () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !muted;
    video.muted = next;
    setMuted(next);
    try {
      if (video.paused) await video.play();
    } catch { /* ignore */ }
    haptic('light');
  };

  const exiting = phase === 'exit';

  return (
    <div
      className={`fixed inset-0 z-[12000] overflow-hidden bg-black transition-[opacity,transform] duration-700 ease-out ${
        exiting ? 'opacity-0 scale-[1.015] pointer-events-none' : 'opacity-100 scale-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Luminara Suite introduction"
    >
      {/* Full-bleed stage */}
      <div className="absolute inset-0">
        {reduced ? (
          <img
            src={INTRO_ASSETS.poster}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <video
            ref={videoRef}
            className={`h-full w-full object-cover transition-opacity duration-700 ${
              phase === 'play' ? 'opacity-100' : 'opacity-0'
            }`}
            playsInline
            preload="auto"
            poster={INTRO_ASSETS.poster}
            muted={muted}
            controls={false}
            aria-hidden="true"
          >
            <source src={INTRO_ASSETS.mp4} type="video/mp4" />
            <source src={INTRO_ASSETS.webm} type="video/webm" />
          </video>
        )}

        {/* Cinematic mats */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.55)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black via-black/50 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/65 to-transparent" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.1] mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      </div>

      {/* Buffering / reduced-motion hold */}
      <div
        className={`absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-500 ${
          phase === 'buffering' || reduced ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {!reduced && phase === 'buffering' && (
          <BrandLoader caption="Loading experience" />
        )}
        {reduced && (
          <BrandLoader caption="Welcome" />
        )}
      </div>

      {/* Top brand */}
      <div
        className={`absolute top-8 left-0 right-0 z-20 flex flex-col items-center gap-2 transition-all duration-700 ${
          showChrome && !exiting && phase !== 'buffering' ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
      >
        <p className="text-[10px] font-black uppercase tracking-[0.55em] text-gold-light/95">Luminara Suite</p>
        <div className="h-px w-20 bg-gradient-to-r from-transparent via-gold/55 to-transparent" />
      </div>

      {/* Bottom chrome */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 px-5 sm:px-10 pb-8 pt-16 transition-all duration-500 ${
          showChrome && !exiting ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5">
          {(canContinue || reduced) && (
            <button
              type="button"
              onClick={finish}
              className="rounded-full bg-gradient-to-br from-gold to-gold-dark px-8 py-3 text-[10px] font-black uppercase tracking-[0.35em] text-black shadow-[0_0_40px_rgba(191,149,63,0.35)] transition hover:scale-[1.03] active:scale-95"
            >
              Enter the suite
            </button>
          )}

          <div className="flex w-full items-center justify-between gap-4">
            {!reduced ? (
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.28em] text-gray-300 backdrop-blur-md transition hover:border-gold/40 hover:text-gold-light"
                aria-pressed={!muted}
              >
                {muted ? 'Sound on' : 'Sound off'}
              </button>
            ) : (
              <span className="text-[10px] uppercase tracking-[0.28em] text-gray-500">Ready</span>
            )}

            <button
              type="button"
              onClick={finish}
              className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400 backdrop-blur-md transition hover:border-gold/35 hover:text-gold-light"
            >
              Skip
            </button>
          </div>

          <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-gold transition-[width] duration-150 ease-linear"
              style={{ width: `${Math.max(reduced ? 100 : progress * 100, exiting ? 100 : 0)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
