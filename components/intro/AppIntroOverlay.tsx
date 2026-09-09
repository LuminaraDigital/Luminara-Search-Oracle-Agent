import React, { useCallback, useEffect, useRef, useState } from 'react';
import { INTRO_ASSETS, markIntroSeen, prefersReducedMotion } from '../../services/intro/appIntro';
import { haptic } from '../../services/telegram/tma';

type AppIntroOverlayProps = {
  onComplete: () => void;
};

/**
 * Full-viewport cinematic intro. Plays once per session when the product opens.
 * Skip, Escape, reduced-motion, and load failures all exit cleanly into the app.
 */
export const AppIntroOverlay: React.FC<AppIntroOverlayProps> = ({ onComplete }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const finishingRef = useRef(false);
  const [phase, setPhase] = useState<'enter' | 'play' | 'exit'>('enter');
  const [progress, setProgress] = useState(0);
  const [showChrome, setShowChrome] = useState(false);
  const [muted, setMuted] = useState(true);
  const [reduced] = useState(() => prefersReducedMotion());

  const finish = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('exit');
    haptic('light');
    markIntroSeen();
    window.setTimeout(() => {
      onComplete();
    }, 720);
  }, [onComplete]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const chromeTimer = window.setTimeout(() => setShowChrome(true), 900);
    const enterTimer = window.setTimeout(() => setPhase('play'), 40);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(chromeTimer);
      window.clearTimeout(enterTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [finish]);

  useEffect(() => {
    if (reduced) {
      const t = window.setTimeout(finish, 1400);
      return () => window.clearTimeout(t);
    }

    const video = videoRef.current;
    if (!video) return;

    let raf = 0;
    const tick = () => {
      if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
        setProgress(Math.min(1, video.currentTime / video.duration));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const tryPlay = async () => {
      try {
        video.muted = true;
        setMuted(true);
        await video.play();
      } catch {
        // Autoplay blocked: still show poster; allow tap-to-play via unmute control.
      }
    };
    void tryPlay();

    const onEnded = () => finish();
    const onError = () => finish();
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    // Hard ceiling so a stalled stream never traps the user.
    const failsafe = window.setTimeout(finish, 14000);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      window.clearTimeout(failsafe);
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

  return (
    <div
      className={`fixed inset-0 z-[12000] flex flex-col items-center justify-center bg-black transition-opacity duration-700 ease-out ${
        phase === 'exit' ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Luminara Suite introduction"
    >
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(191,149,63,0.12)_0%,transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.72)_100%)]" />
        <div className="absolute inset-0 opacity-[0.12] mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      </div>

      {/* Brand eyebrow */}
      <div
        className={`absolute top-8 left-0 right-0 flex flex-col items-center gap-2 transition-all duration-700 ${
          showChrome && phase !== 'exit' ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
      >
        <p className="text-[10px] font-black uppercase tracking-[0.55em] text-gold/90">Luminara Suite</p>
        <div className="h-px w-16 bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      </div>

      {/* Stage */}
      <div
        className={`relative z-10 w-full max-w-5xl px-4 sm:px-8 transition-all duration-700 ease-out ${
          phase === 'enter' ? 'opacity-0 scale-[1.04]' : ''
        } ${phase === 'play' ? 'opacity-100 scale-100' : ''} ${
          phase === 'exit' ? 'opacity-0 scale-[0.985]' : ''
        }`}
      >
        <div className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-black shadow-[0_0_80px_rgba(191,149,63,0.12)] aspect-video">
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
              className="h-full w-full object-cover"
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

          {/* Soft edge mask so the cut never feels raw */}
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.04] rounded-[1.25rem]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
        </div>
      </div>

      {/* Controls */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 px-5 sm:px-8 pb-7 pt-10 transition-all duration-500 ${
          showChrome && phase !== 'exit' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          {!reduced && (
            <button
              type="button"
              onClick={toggleMute}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.28em] text-gray-300 backdrop-blur-md transition hover:border-gold/40 hover:text-gold-light"
              aria-pressed={!muted}
            >
              {muted ? 'Sound on' : 'Sound off'}
            </button>
          )}
          {reduced && <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Welcome</span>}

          <button
            type="button"
            onClick={finish}
            className="rounded-full border border-gold/30 bg-gold/10 px-5 py-2 text-[10px] font-black uppercase tracking-[0.32em] text-gold-light backdrop-blur-md transition hover:bg-gold/20 hover:border-gold/50"
          >
            Skip intro
          </button>
        </div>

        <div className="mx-auto mt-5 h-[2px] max-w-5xl overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-gold transition-[width] duration-150 ease-linear"
            style={{ width: `${Math.max(reduced ? 100 : progress * 100, phase === 'exit' ? 100 : 0)}%` }}
          />
        </div>
      </div>
    </div>
  );
};
