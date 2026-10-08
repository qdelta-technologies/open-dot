"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { verifyAccessPassword } from "@/app/actions";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || pending) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await verifyAccessPassword(password.trim());
        if (res.success) {
          window.location.href = from;
        } else {
          setError(res.error || "Incorrect access password.");
        }
      } catch (err) {
        setError("Failed to verify password. Please try again.");
      }
    });
  };

  return (
    <div className="relative w-full max-w-[420px] rounded-2xl border border-black/10 bg-card p-6 shadow-2xl backdrop-blur-md sm:p-8 dark:border-white/10">
      {/* Decorative gradient glow */}
      <div className="pointer-events-none absolute -top-14 left-1/2 -z-10 h-32 w-48 -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" />

      {/* Header with QDot Brand dots */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-3 flex -space-x-1.5 p-2">
          <span className="size-4 rounded-full bg-foreground ring-2 ring-card shadow-sm" />
          <span className="size-4 rounded-full bg-brand ring-2 ring-card shadow-sm" />
          <span className="size-4 rounded-full bg-highlight ring-2 ring-card shadow-sm" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          QDot
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          Enter your access password to unlock this workspace
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="access-password" className="text-xs font-medium text-foreground/75">
            Password
          </label>
          <div className="relative flex items-center">
            <div className="pointer-events-none absolute left-3 text-foreground/40">
              <Lock className="size-4" strokeWidth={1.75} />
            </div>
            <input
              id="access-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter team password"
              autoFocus
              required
              disabled={pending}
              className="field h-11 w-full pl-9 pr-10 text-sm tracking-wide transition-all focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 flex size-7 items-center justify-center rounded-md text-foreground/45 transition-colors hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-in fade-in slide-in-from-top-1">
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={pending || !password.trim()}
          className="btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium shadow-md transition-all active:scale-[0.99] disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Unlocking...</span>
            </>
          ) : (
            <>
              <span>Unlock Workspace</span>
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      {/* Security note */}
      <div className="mt-6 flex items-center justify-center gap-1.5 border-t border-black/[0.06] pt-4 text-center text-xs text-foreground/45 dark:border-white/[0.06]">
        <ShieldCheck className="size-3.5 text-success" strokeWidth={2} />
        <span>Team access only</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Suspense fallback={<div className="text-sm text-foreground/50">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
