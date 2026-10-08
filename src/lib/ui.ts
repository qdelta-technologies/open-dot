"use client";

import { useSyncExternalStore } from "react";

// Tiny UI state shared across the layout:
// 1. Mobile drawer: whether the sidebar drawer is open on small screens (<768px)
let open = false;
const listeners = new Set<() => void>();

export function setSidebarOpen(value: boolean) {
  if (open === value) return;
  open = value;
  for (const l of listeners) l();
}

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
    () => false,
  );
}

// 2. Desktop sidebar: whether the sidebar is expanded on desktop (>=768px)
let desktopOpen = true;
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("qdot-sidebar-desktop");
    if (saved === "closed") desktopOpen = false;
  } catch {}
}
const desktopListeners = new Set<() => void>();

export function setDesktopSidebarOpen(value: boolean) {
  if (desktopOpen === value) return;
  desktopOpen = value;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("qdot-sidebar-desktop", value ? "open" : "closed");
    } catch {}
  }
  for (const l of desktopListeners) l();
}

export function toggleDesktopSidebar() {
  setDesktopSidebarOpen(!desktopOpen);
}

export function useDesktopSidebarOpen(): boolean {
  return useSyncExternalStore(
    (l) => (desktopListeners.add(l), () => desktopListeners.delete(l)),
    () => desktopOpen,
    () => true,
  );
}

/** True while the media query matches. Server render assumes a wide screen. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(query);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => matchMedia(query).matches,
    () => true,
  );
}
