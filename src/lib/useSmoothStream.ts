"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useSmoothStream
 * Takes incoming streaming text that arrives in choppy/bursty network chunks (SSE)
 * and outputs an ultra-smooth, 60fps character-by-character fluid typing stream.
 *
 * Features:
 * - Decouples network packet bursts from visual rendering.
 * - Dynamic catch-up easing: types smoothly at ~40-60 chars/sec when close,
 *   and dynamically accelerates when the model outputs fast bursts so it never lags behind.
 * - Instant snap when streaming completes.
 * - Prevents main-thread UI freezing and eliminating the "BOOM" chunk-jump effect.
 */
export function useSmoothStream(targetText: string, isStreaming: boolean): string {
  // For completed / non-streaming messages, return immediately with zero overhead
  const [displayedText, setDisplayedText] = useState(() => targetText);
  const targetRef = useRef(targetText);
  const displayedRef = useRef(displayedText);
  const animFrameRef = useRef<number | null>(null);
  const isStreamingRef = useRef(isStreaming);

  targetRef.current = targetText;
  displayedRef.current = displayedText;
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    // If not streaming, immediately sync to the target text
    if (!isStreaming) {
      if (displayedRef.current !== targetText) {
        setDisplayedText(targetText);
        displayedRef.current = targetText;
      }
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    // Streaming loop using requestAnimationFrame
    let lastTime = performance.now();

    const tick = (now: number) => {
      const target = targetRef.current;
      const current = displayedRef.current;

      if (!isStreamingRef.current) {
        setDisplayedText(target);
        displayedRef.current = target;
        animFrameRef.current = null;
        return;
      }

      if (current.length < target.length) {
        const deltaMs = Math.max(1, now - lastTime);
        lastTime = now;

        const remaining = target.length - current.length;

        // Dynamic speed calculation:
        // Base typing speed: ~45 chars per second (0.045 chars/ms)
        // If buffer has accumulated (>15 chars), accelerate dynamically
        let charsToAdd = 1;
        if (remaining > 60) {
          // Large backlog: catch up smoothly
          charsToAdd = Math.max(3, Math.ceil(remaining * 0.18));
        } else if (remaining > 20) {
          charsToAdd = Math.max(2, Math.ceil(remaining * 0.1));
        } else {
          // Natural pacing: 1-2 chars per frame based on time
          charsToAdd = Math.max(1, Math.round(deltaMs * 0.05));
        }

        const nextLength = Math.min(target.length, current.length + charsToAdd);
        const nextText = target.slice(0, nextLength);

        displayedRef.current = nextText;
        setDisplayedText(nextText);
      } else {
        lastTime = now;
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isStreaming, targetText]);

  // If not streaming, return target directly
  return isStreaming ? displayedText : targetText;
}
