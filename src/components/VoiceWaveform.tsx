"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, X } from "lucide-react";

interface VoiceWaveformProps {
  isListening: boolean;
  onStop: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  transcript?: string;
}

/**
 * ChatGPT-grade Voice Waveform Component
 * Displays dynamic, fluid audio wave bars that react to microphone volume
 * with sleek frosted glass aesthetics and intuitive controls.
 */
export function VoiceWaveform({
  isListening,
  onStop,
  onSubmit,
  onCancel,
  transcript,
}: VoiceWaveformProps) {
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isListening) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      setAudioLevel(0);
      return;
    }

    let isMounted = true;

    async function initAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateMeter = () => {
          if (!isMounted) return;
          analyser.getByteFrequencyData(dataArray);

          // Calculate average volume
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Normalize to 0 - 1 with pleasant scaling
          const level = Math.min(1, Math.max(0, (avg - 10) / 70));
          setAudioLevel(level);

          animFrameRef.current = requestAnimationFrame(updateMeter);
        };

        updateMeter();
      } catch (err) {
        console.warn("[VoiceWaveform] AudioContext metering fallback:", err);
      }
    }

    void initAudio();

    return () => {
      isMounted = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close().catch(() => {});
      }
    };
  }, [isListening]);

  if (!isListening) return null;

  // 5 Waveform bars with randomized & volume-driven scale factors
  const barHeights = [
    Math.max(0.25, audioLevel * 1.2),
    Math.max(0.4, audioLevel * 1.6),
    Math.max(0.55, audioLevel * 2.0),
    Math.max(0.35, audioLevel * 1.5),
    Math.max(0.2, audioLevel * 1.1),
  ];

  return (
    <div className="relative mb-2.5 overflow-hidden rounded-2xl border border-emerald-500/20 dark:border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.07] via-teal-500/[0.05] to-cyan-500/[0.07] dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-cyan-950/40 p-2.5 sm:px-3.5 shadow-sm backdrop-blur-md transition-all animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between gap-3">
        {/* Left: Waveform animation & Status */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Animated Waveform Bars */}
          <div className="flex h-6 items-center gap-1 px-1">
            {barHeights.map((h, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-gradient-to-t from-emerald-500 to-teal-400 dark:from-emerald-400 dark:to-cyan-300 transition-all duration-75"
                style={{
                  height: `${Math.min(24, Math.max(6, h * 24))}px`,
                }}
              />
            ))}
          </div>

          {/* Status badge & live transcript preview */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 tracking-wide uppercase font-mono">
                Listening...
              </span>
            </div>
            {transcript ? (
              <p className="truncate text-[13px] text-foreground/80 font-medium italic mt-0.5">
                “{transcript}”
              </p>
            ) : (
              <p className="text-[11px] text-foreground/45 mt-0.5">
                Speak now · Transcribing in real time
              </p>
            )}
          </div>
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Discard / Cancel */}
          <button
            type="button"
            onClick={onCancel}
            title="Cancel voice input"
            className="flex size-7.5 items-center justify-center rounded-full text-foreground/40 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] hover:text-foreground transition-colors"
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>

          {/* Stop and Keep Text */}
          <button
            type="button"
            onClick={onStop}
            title="Done speaking (keep text in box)"
            className="flex items-center gap-1 rounded-full bg-black/[0.06] dark:bg-white/[0.1] px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
          >
            <Check className="size-3 text-emerald-500" strokeWidth={2.5} />
            <span className="hidden sm:inline">Done</span>
          </button>

          {/* Send Immediately */}
          <button
            type="button"
            onClick={onSubmit}
            title="Send message now"
            className="flex size-7.5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xs hover:bg-emerald-600 active:scale-95 transition-all"
          >
            <ArrowUp className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pulsating Animated Waveform Icon for the input mic button
 */
export function ListeningMicButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Stop speaking"
      className="relative flex size-8.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md transition-all hover:bg-emerald-600 active:scale-95"
    >
      {/* Animated ripple rings */}
      <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-40 animate-ping" />
      <span className="absolute inset-[-3px] rounded-full border border-emerald-400/50 animate-pulse" />

      {/* Mini dancing waveform bars inside the button */}
      <div className="relative z-10 flex items-center gap-0.5 h-3.5">
        <span className="w-0.5 h-2 bg-white rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-0.5 h-3.5 bg-white rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-0.5 h-2.5 bg-white rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </button>
  );
}
