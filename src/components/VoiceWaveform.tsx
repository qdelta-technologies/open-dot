"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";

interface VoiceInputPillProps {
  transcript?: string;
  micStream?: MediaStream;
  onCancel: () => void;
  onStop: () => void;
  onSubmit: () => void;
}

/**
 * ChatGPT-Identical Voice Input Pill Component
 * Directly replicates the sleek, unified horizontal voice pill from ChatGPT (Photo 2):
 * - Dark charcoal pill capsule (#212121)
 * - Circular Cancel button (X) on the left
 * - Streaming audio waveform tape across the center:
 *     - Small dots (3px) during silence
 *     - Vertical rounded bars (up to 22px) that enter from the right as speech occurs
 *       and scroll smoothly across the ribbon, forming wave packets matching voice
 * - Circular Stop button (white rounded square) and Send button (amber gold ArrowUp) on the right
 */
export function VoiceInputPill({
  transcript,
  micStream,
  onCancel,
  onStop,
  onSubmit,
}: VoiceInputPillProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<number[]>(() => new Array(55).fill(0));
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const historyRef = useRef<number[]>(new Array(55).fill(0));
  const lastSampleTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  // Dynamic responsive dot count calculation based on container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateCount = () => {
      const width = el.clientWidth;
      // Reserve space for left and right buttons (~120px) + padding
      const available = Math.max(160, width - 130);
      // Each dot + gap is ~8px
      const count = Math.max(26, Math.min(68, Math.floor(available / 8.5)));
      historyRef.current = new Array(count).fill(0);
      setHistory(new Array(count).fill(0));
    };

    updateCount();
    const observer = new ResizeObserver(updateCount);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Web Audio API setup and streaming waveform history.
  // Uses the shared micStream prop if provided (avoids a second competing getUserMedia call on mobile).
  useEffect(() => {
    let isMounted = true;

    function startAnalyser(stream: MediaStream) {
      if (!isMounted) return;
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      // resume() must be called synchronously here — we're inside a user-gesture chain
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = (now: number) => {
        if (!isMounted) return;

        if (now - lastSampleTimeRef.current >= 38) {
          lastSampleTimeRef.current = now;
          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          const binCount = Math.min(dataArray.length, 36);
          for (let i = 2; i < binCount; i++) sum += dataArray[i];
          const avg = sum / (binCount - 2);

          let amplitude = 0;
          if (avg > 10) amplitude = Math.min(1, Math.max(0.12, (avg - 10) / 48));

          const arr = historyRef.current;
          arr.shift();
          arr.push(amplitude);
          setHistory([...arr]);
        }

        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    }

    function startFallback() {
      const interval = setInterval(() => {
        if (!isMounted) { clearInterval(interval); return; }
        const arr = historyRef.current;
        arr.shift();
        arr.push(0);
        setHistory([...arr]);
      }, 40);
      return interval;
    }

    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    if (micStream) {
      // Use the shared stream passed from Chat — no second getUserMedia call
      startAnalyser(micStream);
    } else {
      // Fallback: open our own stream (desktop / no prop passed)
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((stream) => {
          if (!isMounted) { stream.getTracks().forEach((t) => t.stop()); return; }
          startAnalyser(stream);
        })
        .catch((err) => {
          console.warn("[VoiceInputPill] Web Audio metering fallback:", err);
          fallbackInterval = startFallback();
        });
    }

    return () => {
      isMounted = false;
      if (fallbackInterval !== null) clearInterval(fallbackInterval);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      // Only stop tracks if we opened our own stream (not the shared one)
      if (!micStream && streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close().catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex h-[52px] sm:h-14 w-full items-center justify-between rounded-full bg-[#212121] px-2.5 sm:px-3 shadow-xl border border-white/[0.06] select-none transition-all"
    >
      {/* 1. Left: Cancel Button (X) */}
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel voice recording"
        title="Cancel voice input"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
      >
        <X className="size-4" strokeWidth={2} />
      </button>

      {/* 2. Center: Continuous Dotted Audio Waveform Ribbon */}
      <div className="relative flex flex-1 items-center justify-center h-8 overflow-hidden px-2 sm:px-4">
        <div className="flex w-full items-center justify-between max-w-[680px]">
          {history.map((val, idx) => {
            // When amplitude > 0 (speaking), scale from 5px up to 22px vertical rounded pill
            // When amplitude === 0 (silence), render a crisp 3px circular dot
            const isSpeaking = val > 0.05;
            const barHeight = isSpeaking ? Math.min(22, Math.max(5, Math.round(val * 24))) : 3;
            const opacity = isSpeaking ? Math.min(1, Math.max(0.65, val * 1.3)) : 0.28;

            return (
              <span
                key={idx}
                className="w-[3px] rounded-full bg-white transition-all duration-75"
                style={{
                  height: `${barHeight}px`,
                  opacity,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* 3. Right: Stop and Send Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Stop Button (White rounded square inside dark circle) */}
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop recording and keep text"
          title="Done speaking (keep text in box)"
          className="flex size-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/15 text-white transition-all active:scale-95 cursor-pointer"
        >
          <span className="size-3.5 rounded-[3px] bg-white block" />
        </button>

        {/* Send Button (Amber / Gold circle with white ArrowUp) */}
        <button
          type="button"
          onClick={onSubmit}
          aria-label="Send message"
          title="Send message now"
          className="flex size-9 items-center justify-center rounded-full bg-[#d99b26] hover:bg-[#c98c1f] text-white shadow-md transition-all active:scale-95 cursor-pointer"
        >
          <ArrowUp className="size-4.5 stroke-[2.75] text-white" />
        </button>
      </div>
    </div>
  );
}
