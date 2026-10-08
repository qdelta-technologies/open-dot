"use client";

import { useEffect, useState } from "react";

const KEY = "qdot-splash-seen";
const DURATION_MS = 1900;

/** Short intro shown once per browser session: three dots join, then the name fades in. Tap to skip. */
export default function SplashIntro() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) {
        setGone(true);
        return;
      }
      sessionStorage.setItem(KEY, "1");
    } catch {
      // storage unavailable: just play it
    }
    const t = setTimeout(() => setGone(true), DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;

  return (
    <div id="qdot-splash" className="qdot-splash" onClick={() => setGone(true)} aria-hidden="true">
      <div className="qdot-splash-inner">
        <div className="qdot-splash-dots">
          <span className="qdot-dot qdot-dot-1" />
          <span className="qdot-dot qdot-dot-2" />
          <span className="qdot-dot qdot-dot-3" />
        </div>
        <div className="qdot-splash-name">QDot</div>
      </div>
    </div>
  );
}
