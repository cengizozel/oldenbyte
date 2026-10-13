"use client";

import { useEffect, useState } from "react";
import { X, Check, RefreshCw, Loader, ChevronRight } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { EFFORT_OPTIONS, LENGTH_PRESETS, PRESETS, type ChatConfig, type Length } from "@/lib/chat/types";
import { SettingsInput, SettingsSelect, SettingsTextarea, HIT_AREA, FOCUS_RING } from "../ui/Field";
import { Chip, SmallButton } from "../ui/WidgetChrome";

// Settings panel: Model, Behavior, Data sources. Edits a draft of the config
// and hands it to onSave; mounting it loads the model list, the Kiwix books
// and the Anytype spaces for the current connection.
export default function SettingsPanel({ c, config, onCancel, onSave }: {
  c: ColorClasses;
  config: ChatConfig;
  onCancel: () => void;
  onSave: (draft: ChatConfig) => void;
}) {
  const [draft, setDraft] = useState<ChatConfig>(config);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [kiwixSources, setKiwixSources] = useState<{ title: string; id: string }[]>([]);
  const [loadingKiwix, setLoadingKiwix] = useState(false);
  const [kiwixError, setKiwixError] = useState("");

  // Anytype pairing: its own connection, like the Kiwix one.
  const [anytypeSpaces, setAnytypeSpaces] = useState<{ id: string; name: string }[]>([]);
  const [anytypePairing, setAnytypePairing] = useState<"idle" | "awaiting-code">("idle");
  const [anytypeChallengeId, setAnytypeChallengeId] = useState("");
  const [anytypeCode, setAnytypeCode] = useState("");
  const [anytypeBusy, setAnytypeBusy] = useState(false);
  const [anytypeError, setAnytypeError] = useState("");
  // Write-bridge test result.
  const [bridgeStatus, setBridgeStatus] = useState<"" | "checking" | "ok" | "fail">("");

  async function fetchModels(cfg: ChatConfig) {
    if (!cfg.baseUrl) {
      setModelsError("Enter an API URL first.");
      return;
    }
    setLoadingModels(true);
    setModelsError("");
    try {
      const params = new URLSearchParams({ baseUrl: cfg.baseUrl });
      const res = await fetch(`/api/chat?${params.toString()}`, { headers: cfg.apiKey ? { "X-Api-Key": cfg.apiKey } : {} });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to list models");
      const list: string[] = data.models ?? [];
      setModels(list);
      if (list.length === 0) setModelsError("No models reported by this server.");
      // Keep the configured model if it's still offered; otherwise fall back to the first.
      else setDraft(d => ({ ...d, model: list.includes(d.model) ? d.model : list[0] }));
    } catch (err) {
      setModels([]);
      setModelsError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoadingModels(false);
    }
  }

  // List the server's books for the settings status line. Lookups always search
  // every book, so there is nothing to pick here anymore.
  async function loadKiwixSources(kiwixUrl: string) {
    if (!kiwixUrl.startsWith("http")) return;
    setLoadingKiwix(true);
    setKiwixError("");
    setKiwixSources([]);
    try {
      const res = await fetch(`/api/kiwix?baseUrl=${encodeURIComponent(kiwixUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKiwixSources(data.sources ?? []);
    } catch (e) {
      setKiwixError(String((e as Error).message ?? e));
    } finally {
      setLoadingKiwix(false);
    }
  }

  // ── Anytype pairing (mirrors the AnytypeWidget flow) ───────────────────────
  async function startAnytypePairing() {
    setAnytypeError("");
    if (!draft.anytypeUrl.startsWith("http")) { setAnytypeError("Enter the Anytype API URL (http://…)."); return; }
    setAnytypeBusy(true);
    try {
      const res = await fetch("/api/anytype", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "challenge", baseUrl: draft.anytypeUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnytypeChallengeId(data.challengeId);
      setAnytypePairing("awaiting-code");
      setAnytypeCode("");
    } catch (e) {
      setAnytypeError(`Could not reach Anytype: ${String((e as Error).message ?? e)}. Is the desktop app running?`);
    } finally {
      setAnytypeBusy(false);
    }
  }

  async function confirmAnytypeCode() {
    setAnytypeError("");
    if (!anytypeCode.trim()) { setAnytypeError("Enter the 4-digit code from Anytype."); return; }
    setAnytypeBusy(true);
    try {
      const res = await fetch("/api/anytype", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "key", baseUrl: draft.anytypeUrl, challengeId: anytypeChallengeId, code: anytypeCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft((d) => ({ ...d, anytypeApiKey: data.apiKey }));
      setAnytypePairing("idle");
      await loadAnytypeSpaces(draft.anytypeUrl, data.apiKey, draft.anytypeSpaceId);
    } catch (e) {
      setAnytypeError(`Pairing failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setAnytypeBusy(false);
    }
  }

  async function loadAnytypeSpaces(baseUrl: string, apiKey: string, preferred: string) {
    if (!baseUrl.startsWith("http") || !apiKey) return;
    setAnytypeBusy(true);
    setAnytypeSpaces([]);
    try {
      const res = await fetch(`/api/anytype?op=spaces&baseUrl=${encodeURIComponent(baseUrl)}`, { headers: { "X-Api-Key": apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const list: { id: string; name: string }[] = data.spaces ?? [];
      setAnytypeSpaces(list);
      const pick = list.find((s) => s.id === preferred) ?? list[0];
      if (pick) setDraft((d) => ({ ...d, anytypeSpaceId: pick.id, anytypeSpaceName: pick.name }));
    } catch (e) {
      setAnytypeError(`Could not load spaces: ${String((e as Error).message ?? e)}`);
    } finally {
      setAnytypeBusy(false);
    }
  }

  // Auto-load the model list so the dropdown is ready (keeps the chosen
  // model), plus the Kiwix books and Anytype spaces for the saved connection.
  useEffect(() => {
    if (config.baseUrl) fetchModels(config);
    if (config.kiwixUrl) loadKiwixSources(config.kiwixUrl);
    if (config.anytypeUrl && config.anytypeApiKey) loadAnytypeSpaces(config.anytypeUrl, config.anytypeApiKey, config.anytypeSpaceId);
  }, []);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0 p-4">
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">

        <p className={`text-[13px] font-ui opacity-60 ${c.label}`}>Model</p>

        <div>
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>API URL</p>
          <SettingsInput
            autoFocus
            type="url"
            value={draft.baseUrl}
            onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
            placeholder="http://localhost:11434/v1"
          />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {PRESETS.map(p => (
              <Chip key={p.label} c={c} active={draft.baseUrl === p.url} onClick={() => setDraft(d => ({ ...d, baseUrl: p.url }))}>
                {p.label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className={`text-xs opacity-60 ${c.label}`}>Model</p>
            <SmallButton c={c} onClick={() => fetchModels(draft)} disabled={loadingModels} title="Load models from server">
              {loadingModels ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Load models
            </SmallButton>
          </div>
          {models.length > 0 ? (
            <SettingsSelect
              value={draft.model}
              onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
            >
              <option value="" disabled>Select a model…</option>
              {draft.model && !models.includes(draft.model) && (
                <option value={draft.model}>{draft.model} (custom)</option>
              )}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </SettingsSelect>
          ) : (
            <SettingsInput
              type="text"
              value={draft.model}
              onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
              placeholder="e.g. llama3.2, or click Load models"
            />
          )}
          {modelsError && <p className="text-red-400 text-xs mt-1">{modelsError}</p>}
        </div>

        <p className={`text-[13px] font-ui opacity-60 mt-1 ${c.label}`}>Behavior</p>

        <div>
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>System prompt <span className="opacity-60">(optional)</span></p>
          <SettingsTextarea
            value={draft.system}
            onChange={e => setDraft(d => ({ ...d, system: e.target.value }))}
            placeholder="You are a helpful assistant."
            rows={2}
          />
        </div>

        <div>
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>Response style</p>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(LENGTH_PRESETS) as Length[]).map(key => (
              <Chip
                key={key}
                c={c}
                active={draft.length === key}
                onClick={() => setDraft(d => ({ ...d, length: key, maxTokens: LENGTH_PRESETS[key].cap }))}
                title={LENGTH_PRESETS[key].instruction || "No length instruction; uses the server default."}
              >
                {LENGTH_PRESETS[key].label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>Thinking <span className="opacity-60">(reasoning models)</span></p>
          <div className="flex flex-wrap gap-1">
            {EFFORT_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                c={c}
                active={draft.effort === opt.value}
                onClick={() => setDraft(d => ({ ...d, effort: opt.value }))}
                title={opt.value === "none" ? "Disable the model's chain-of-thought (fastest)" : opt.value === "default" ? "Use the model's default" : `reasoning_effort: ${opt.value}`}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <button
            onClick={() => setAdvancedOpen(o => !o)}
            className={`flex items-center gap-1 text-xs opacity-60 hover:opacity-100 ${FOCUS_RING} ${c.label}`}
          >
            <ChevronRight size={12} className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
            Advanced
            <span className="opacity-60">
              (cap: {draft.maxTokens ? `${draft.maxTokens} tokens` : "none"}{draft.maxTokens !== LENGTH_PRESETS[draft.length].cap ? ", custom" : ""})
            </span>
          </button>
          {advancedOpen && (<div className="mt-1.5">
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>Max response length <span className="opacity-60">(tokens, 0 = no limit; style presets set this)</span></p>
          <SettingsInput
            type="number"
            min={0}
            step={50}
            value={draft.maxTokens || ""}
            onChange={e => setDraft(d => ({ ...d, maxTokens: Number(e.target.value) }))}
            placeholder="0"
          />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {[128, 256, 512, 1024].map(n => (
              <Chip key={n} c={c} active={draft.maxTokens === n} onClick={() => setDraft(d => ({ ...d, maxTokens: n }))} className="tabular-nums">
                {n}
              </Chip>
            ))}
          </div>
          </div>)}
        </div>

        <p className={`text-[13px] font-ui opacity-60 mt-1 ${c.label}`}>Data sources</p>

        <p className={`text-xs -mt-1 opacity-60 ${c.label}`}>Connections are set up here; what the model may access is chosen per chat from the ⋮ menu.</p>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className={`text-xs opacity-60 ${c.label}`}>Kiwix library <span className="opacity-60">(all books are searched)</span></p>
            <SmallButton c={c} onClick={() => loadKiwixSources(draft.kiwixUrl)} disabled={loadingKiwix || !draft.kiwixUrl.startsWith("http")} title="List the books on the server">
              {loadingKiwix ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Check server
            </SmallButton>
          </div>
          <SettingsInput
            type="url"
            value={draft.kiwixUrl}
            onChange={e => setDraft(d => ({ ...d, kiwixUrl: e.target.value }))}
            placeholder="Kiwix URL, e.g. http://192.168.1.10:8080"
          />
          {kiwixSources.length > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {kiwixSources.length} book{kiwixSources.length === 1 ? "" : "s"}: {kiwixSources.map(s => s.title).join(", ")}
            </p>
          )}
          {kiwixError && <p className="text-red-400 text-xs mt-1">{kiwixError}</p>}
          <p className="text-xs text-[var(--text-muted)] mt-1">Adding books to the server widens the search automatically. Turn lookup on with the library icon by the send button.</p>
        </div>

        <div>
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>Anytype</p>
          <SettingsInput
            type="url"
            value={draft.anytypeUrl}
            onChange={e => setDraft(d => ({ ...d, anytypeUrl: e.target.value, anytypeApiKey: "" }))}
            placeholder="http://127.0.0.1:31009"
          />
          {draft.anytypeApiKey ? (
            anytypeSpaces.length > 0 ? (
              <SettingsSelect
                value={draft.anytypeSpaceId}
                onChange={e => {
                  const s = anytypeSpaces.find(x => x.id === e.target.value);
                  setDraft(d => ({ ...d, anytypeSpaceId: e.target.value, anytypeSpaceName: s?.name ?? "" }));
                }}
                className="mt-1.5"
              >
                {anytypeSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SettingsSelect>
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-1.5 flex items-center gap-1">
                {anytypeBusy && <Loader size={12} className="animate-spin" />} paired ✓ {draft.anytypeSpaceName && `· ${draft.anytypeSpaceName}`}
              </p>
            )
          ) : anytypePairing === "awaiting-code" ? (
            <div className="flex items-center gap-2 mt-1.5">
              <SettingsInput
                inputMode="numeric"
                value={anytypeCode}
                onChange={e => setAnytypeCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && confirmAnytypeCode()}
                placeholder="4-digit code from Anytype"
                className="flex-1 tracking-widest"
              />
              <SmallButton c={c} onClick={confirmAnytypeCode} disabled={anytypeBusy || !anytypeCode.trim()} className="shrink-0">
                {anytypeBusy ? <Loader size={12} className="animate-spin" /> : "Confirm"}
              </SmallButton>
            </div>
          ) : (
            <SmallButton c={c} onClick={startAnytypePairing} disabled={anytypeBusy || !draft.anytypeUrl.startsWith("http")} className="mt-1.5">
              {anytypeBusy ? <><Loader size={12} className="animate-spin" /> contacting…</> : "Pair with Anytype"}
            </SmallButton>
          )}
          {anytypeError && <p className="text-red-400 text-xs mt-1">{anytypeError}</p>}
          <p className="text-xs text-[var(--text-muted)] mt-1">Pair, pick a space, then turn lookup on with the box icon by the send button.</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className={`text-xs opacity-60 ${c.label}`}>Anytype write bridge <span className="opacity-60">(optional, enables creating notes)</span></p>
            <SmallButton
              c={c}
              onClick={async () => {
                setBridgeStatus("checking");
                try {
                  const res = await fetch("/api/anytype", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ op: "bridge-health", bridgeUrl: draft.anytypeBridgeUrl }),
                  });
                  const d = await res.json();
                  setBridgeStatus(d.ok ? "ok" : "fail");
                } catch { setBridgeStatus("fail"); }
              }}
              disabled={bridgeStatus === "checking" || !draft.anytypeBridgeUrl.startsWith("http")}
              title="Check the bridge"
            >
              {bridgeStatus === "checking" ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Test
            </SmallButton>
          </div>
          <SettingsInput
            type="url"
            value={draft.anytypeBridgeUrl}
            onChange={e => { setDraft(d => ({ ...d, anytypeBridgeUrl: e.target.value })); setBridgeStatus(""); }}
            placeholder="Bridge URL, e.g. http://127.0.0.1:31010"
          />
          <SettingsInput
            type="password"
            value={draft.anytypeBridgeToken}
            onChange={e => { setDraft(d => ({ ...d, anytypeBridgeToken: e.target.value })); setBridgeStatus(""); }}
            placeholder="Bridge token"
            className="mt-1.5"
          />
          {bridgeStatus === "ok" && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">bridge reachable ✓</p>}
          {bridgeStatus === "fail" && <p className="text-red-400 text-xs mt-1">bridge not reachable</p>}
          <p className="text-xs text-[var(--text-muted)] mt-1">Runs next to the Anytype app (tools/anytype-bridge in the repo). Without it, Anytype stays read-only.</p>
        </div>

        <div>
          <p className={`text-xs mb-1 opacity-60 ${c.label}`}>Assistant writes</p>
          {([
            ["calendarWriteMode", "Calendar"],
            ["anytypeWriteMode", "Anytype"],
          ] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between py-0.5">
              <span className="text-sm text-[var(--text-secondary)]">{label}</span>
              <span className="flex items-center gap-1">
                {(["confirm", "auto"] as const).map(mode => (
                  <Chip key={mode} c={c} active={draft[key] === mode} onClick={() => setDraft(d => ({ ...d, [key]: mode }))}>
                    {mode === "confirm" ? "ask first" : "auto"}
                  </Chip>
                ))}
              </span>
            </div>
          ))}
          <p className="text-xs text-[var(--text-muted)] mt-1">ask first = the model proposes and you approve a card. auto = it writes immediately and reports what it did.</p>
        </div>

      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 shrink-0">
        <button
          onClick={onCancel}
          className={`text-[var(--text-muted)] hover:text-[var(--text-primary)] ${HIT_AREA} ${FOCUS_RING}`}
          title="Cancel"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
        <button
          onClick={() => onSave(draft)}
          disabled={!draft.baseUrl.trim() || !draft.model.trim()}
          className={`text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 ${HIT_AREA} ${FOCUS_RING}`}
          title="Save"
          aria-label="Save"
        >
          <Check size={14} />
        </button>
      </div>
    </div>
  );
}
