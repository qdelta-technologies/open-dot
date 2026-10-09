"use client";

import { useEffect } from "react";
import { syncTimezone } from "@/app/actions";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silently catch registration in environments where SW is restricted
      });
    }
    // Tell the server which time zone this browser is in, once, so daily routines run at the user's local time
    try {
      if (!sessionStorage.getItem("qdot-tz-synced")) {
        sessionStorage.setItem("qdot-tz-synced", "1");
        void syncTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => {});
      }
    } catch {
      // storage unavailable
    }
  }, []);

  return null;
}
