"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader, Sun, Moon } from "lucide-react";
import { isDark, THEME_EVENT } from "@/lib/theme";

// Auth-screen theme toggle: flips the <html> class + the localStorage mirror
// (which the pre-paint FOUC script reads) only. We deliberately do NOT use the
// shared toggleTheme(), which also persists to /api/settings — that 401s when
// logged out and the storage 401-handler would bounce us back to /login.
function flipTheme() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
}

type AuthState = { needsSetup: boolean; registrationEnabled: boolean; hasInvite: boolean };
type Mode = "signin" | "setup" | "register";

const inputClass =
  "text-sm border border-[var(--surface-border)] rounded-xl px-3 py-2 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-[var(--surface)] transition-colors";

// The brand mark (kept in sync with /public/logo.svg). Inlined so it recolors
// cleanly and never flashes a broken image on the auth screen.
function Logo() {
  return (
    <svg viewBox="0 0 100 100" className="w-12 h-12" aria-hidden>
      <rect width="100" height="100" rx="22" fill="#141414" />
      <rect x="16" y="16" width="68" height="68" rx="12" fill="none" stroke="#e5e5e5" strokeWidth="4" strokeDasharray="14 10" strokeLinecap="round" />
      <rect x="34" y="34" width="32" height="32" rx="8" fill="#5eead4" />
      <rect x="30" y="30" width="40" height="40" rx="10" fill="none" stroke="#5eead4" strokeOpacity="0.35" strokeWidth="6" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = useState<AuthState | null>(null);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    fetch("/api/auth/state")
      .then(res => (res.ok ? res.json() : null))
      .then((data: AuthState | null) => {
        if (!data) return;
        setState(data);
        if (data.needsSetup) setMode("setup");
      })
      .catch(() => {});
  }, []);

  // Keep the toggle icon in sync with the live theme.
  useEffect(() => {
    setDark(isDark());
    const sync = () => setDark(isDark());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "setup" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "setup" ? "/api/setup" : mode === "register" ? "/api/register" : "/api/auth";
      const body =
        mode === "register"
          ? { username, password, invite }
          : { username, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Something went wrong.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const canRegister = !!state && state.registrationEnabled && state.hasInvite;
  const showConfirm = mode === "setup";

  const subtitle = mode === "setup" ? "Create admin account" : mode === "register" ? "Create account" : "Sign in";
  const action = mode === "setup" ? "Create account" : mode === "register" ? "Sign up" : "Sign in";

  const disabled =
    loading ||
    !username ||
    !password ||
    (showConfirm && !confirm) ||
    (mode === "register" && !invite);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--page-bg)] px-4">
      {/* theme toggle */}
      <button
        type="button"
        onClick={flipTheme}
        title={dark ? "Light mode" : "Dark mode"}
        className="fixed top-4 right-4 p-2 rounded-xl border border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--surface-border)] transition-colors"
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* the auth box, styled like a dashboard widget (neon teal glow in dark) */}
      <form
        onSubmit={handleSubmit}
        className="w-80 max-w-full flex flex-col gap-3 rounded-2xl border p-7 transition-colors
          bg-[var(--surface)] border-[var(--surface-border)] shadow-sm
          dark:bg-[var(--w-teal-bg)] dark:border-[var(--w-teal-border)] w-teal-glow"
      >
        <div className="flex flex-col items-center gap-2 mb-2 text-center">
          <Logo />
          <span className="text-2xl leading-none text-[var(--text-primary)] font-[family-name:var(--font-playfair)]">
            oldenbyte
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] font-[family-name:var(--font-dm-mono)]">
            {subtitle}
          </span>
        </div>

        <input
          autoFocus
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="username"
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          className={inputClass}
        />
        {showConfirm && (
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="confirm password"
            className={inputClass}
          />
        )}
        {mode === "register" && (
          <input
            type="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={invite}
            onChange={e => setInvite(e.target.value)}
            placeholder="invite code"
            className={inputClass}
          />
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          type="submit"
          disabled={disabled}
          className="flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium transition-all
            bg-neutral-900 text-white hover:bg-neutral-700
            dark:bg-[var(--w-teal-label)] dark:text-[#04221d] dark:hover:shadow-[0_0_18px_rgba(94,234,212,0.55)]
            disabled:opacity-40 disabled:dark:shadow-none"
        >
          {loading ? <Loader size={14} className="animate-spin" /> : action}
        </button>

        {!state?.needsSetup && canRegister && (
          <button
            type="button"
            onClick={() => {
              setMode(m => (m === "register" ? "signin" : "register"));
              setError("");
            }}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {mode === "register" ? "Already have an account? Sign in" : "Create account"}
          </button>
        )}
      </form>
    </div>
  );
}
