"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader } from "lucide-react";

type AuthState = { needsSetup: boolean; registrationEnabled: boolean; hasInvite: boolean };
type Mode = "signin" | "setup" | "register";

const inputClass =
  "text-sm border border-[var(--surface-border)] rounded-xl px-3 py-2 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-[var(--surface)]";

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

  const title = mode === "setup" ? "Create admin account" : mode === "register" ? "Create account" : "Sign in";
  const action = mode === "setup" ? "Create account" : mode === "register" ? "Sign up" : "Sign in";

  const disabled =
    loading ||
    !username ||
    !password ||
    (showConfirm && !confirm) ||
    (mode === "register" && !invite);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--page-bg)]">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 w-72 bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl p-6 shadow-sm"
      >
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>

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
          className="flex items-center justify-center gap-2 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-40 transition-colors"
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
