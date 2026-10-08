"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { verifyAccessPassword } from "@/app/actions";

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || pending || done) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await verifyAccessPassword(password.trim());
        if (res.success) {
          setDone(true);
          setTimeout(() => {
            window.location.href = from;
          }, 350);
        } else {
          setError(res.error || "That password isn't right. Please try again.");
          setShakeKey((k) => k + 1);
        }
      } catch {
        setError("Couldn't check the password. Check your connection and try again.");
        setShakeKey((k) => k + 1);
      }
    });
  };

  const busy = pending || done;

  // Put the cursor back in the box after a wrong password
  useEffect(() => {
    if (error && !pending && !done) document.getElementById("team-password")?.focus();
  }, [error, pending, done, shakeKey]);

  return (
    <div className={`login-card-in relative z-10 w-full max-w-[400px] transition-all duration-300 ${done ? "scale-[0.98] opacity-0" : ""}`}>
      {/* Brand */}
      <div className="mb-8 flex flex-col items-center text-center">
        <div className={`login-dots mb-5 flex -space-x-2 ${busy ? "is-busy" : ""}`} aria-hidden="true">
          <span className="login-dot login-dot-1 size-7 rounded-full bg-foreground ring-[3px] ring-background shadow-sm" />
          <span className="login-dot login-dot-2 size-7 rounded-full bg-brand ring-[3px] ring-background shadow-sm" />
          <span className="login-dot login-dot-3 size-7 rounded-full bg-highlight ring-[3px] ring-background shadow-sm" />
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Welcome to QDot</h1>
        <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-foreground/55">
          Your team&apos;s AI workspace. Enter the team password to continue.
        </p>
      </div>

      {/* Card */}
      <form
        key={shakeKey}
        onSubmit={handleSubmit}
        className={`rounded-3xl border border-black/[0.08] bg-card/95 p-5 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors focus-within:border-brand/40 sm:p-6 dark:border-white/[0.08] ${shakeKey > 0 && error ? "login-shake" : ""}`}
      >
        <label htmlFor="team-password" className="mb-2 block text-[13px] font-medium text-foreground/70">
          Team password
        </label>
        <div className="relative flex items-center">
          <Lock className="pointer-events-none absolute left-3.5 size-[18px] text-foreground/35" strokeWidth={1.75} />
          <input
            id="team-password"
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
            onBlur={() => setCapsLock(false)}
            placeholder="Enter password"
            autoComplete="current-password"
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
            className="field h-12 w-full pr-12 pl-11 text-base transition-shadow focus:border-brand focus:ring-4 focus:ring-brand/15 sm:text-[15px]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-1.5 flex size-10 items-center justify-center rounded-xl text-foreground/45 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>

        <div aria-live="polite" className="min-h-0">
          {capsLock && !error && (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3.5 shrink-0" /> Caps Lock is on
            </p>
          )}
          {error && (
            <p id="login-error" role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={busy || !password.trim()}
          className="btn-primary mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-medium shadow-sm transition-all active:scale-[0.985] enabled:hover:shadow-md disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>{done ? "Welcome back" : "Checking…"}</span>
            </>
          ) : (
            <>
              <span>Continue</span>
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-foreground/40">
        <ShieldCheck className="size-3.5" strokeWidth={2} />
        Private workspace · team access only
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="login-bg relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-background px-5 py-10">
      <div className="login-blob login-blob-a" aria-hidden="true" />
      <div className="login-blob login-blob-b" aria-hidden="true" />
      <Suspense fallback={<div className="text-sm text-foreground/50">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
