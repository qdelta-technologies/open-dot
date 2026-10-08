"use client";

import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

let currentTheme: Theme = "system";
const listeners = new Set<() => void>();

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = localStorage.getItem("qdot-theme");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  // The login page is always light
  const onLogin = window.location.pathname.startsWith("/login");
  const isDark =
    !onLogin &&
    (theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));

  if (isDark) {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.theme = "light";
  }
}

if (typeof window !== "undefined") {
  currentTheme = getStoredTheme();
  applyTheme(currentTheme);

  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme === "system") {
      applyTheme("system");
      listeners.forEach((l) => l());
    }
  });
}

export function setTheme(theme: Theme) {
  currentTheme = theme;
  try {
    localStorage.setItem("qdot-theme", theme);
  } catch {}
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  const isDark =
    currentTheme === "dark" ||
    (currentTheme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  setTheme(isDark ? "light" : "dark");
}

export function useTheme(): {
  theme: Theme;
  isDark: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
} {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => currentTheme,
    () => "system" as Theme,
  );

  const isDark =
    typeof window !== "undefined"
      ? theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      : false;

  return { theme, isDark, setTheme, toggleTheme };
}
