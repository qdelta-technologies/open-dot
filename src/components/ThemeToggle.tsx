"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { isDark, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className={`relative flex size-10 items-center justify-center rounded-full border border-black/10 text-foreground/50 transition-colors dark:border-white/10 ${className}`}
        title="Toggle color theme"
        aria-label="Toggle color theme"
      >
        <Sun className="size-4 opacity-40" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative flex size-10 items-center justify-center rounded-full border border-black/10 transition-colors hover:border-black/25 text-foreground/70 hover:text-foreground dark:border-white/10 dark:hover:border-white/25 ${className}`}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="size-4 transition-transform duration-200 rotate-0 hover:rotate-45 text-amber-400" strokeWidth={1.75} />
      ) : (
        <Moon className="size-4 transition-transform duration-200 rotate-0 hover:-rotate-12 text-slate-700 dark:text-foreground" strokeWidth={1.75} />
      )}
    </button>
  );
}
