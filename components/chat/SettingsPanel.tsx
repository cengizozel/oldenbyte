"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Loader, ChevronRight } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { DEFAULT_CONFIG, EFFORT_OPTIONS, LENGTH_PRESETS, PRESETS, type ChatConfig, type Length } from "@/lib/chat/types";
import { SettingsInput, SettingsSelect, SettingsTextarea, FOCUS_RING, Stepper } from "../ui/Field";
import { listKiwixServers, listAnytypeConnections, listAllDashboardWidgets, dashboardOf, getCalendarAccount, kindLabel, type KnownKiwixServer, type KnownAnytype, type WidgetRosterItem } from "@/lib/dashboardContext";
import { useModelServers } from "@/lib/useModelServers";
import { Chip, SmallButton, SettingsFace, SettingsListControl } from "../ui/WidgetChrome";
import Toggle from "../ui/Toggle";

// Settings panel: Model, Behavior, Data sources. Edits a draft of the config
// and hands it to onSave; mounting it loads the model list, the Kiwix books
// and the Anytype spaces for the current connection.
export default function SettingsPanel({ c, config, widgetId, onCancel, onSave }: {
  c: ColorClasses;
  config: ChatConfig;
  widgetId?: string;
  onCancel: () => void;
  onSave: (draft: ChatConfig) => void;
}) {
  const [draft, setDraft] = useState<ChatConfig>(config);

  // Data access: the widgets the model may read. On this dashboard a widget
  // is readable unless turned off; on another it is off until turned on (only
  // listed under All dashboards). A calendar row also grants its tools, for
  // the calendar of this dashboard only.
  const [roster, setRoster] = useState<WidgetRosterItem[] | null>(null);
  const [here, setHere] = useState("");
  const [calWidget, setCalWidget] = useState<string | null>(null);
  useEffect(() => {
    listAllDashboardWidgets().then(setRoster).catch(() => setRoster([]));
    if (widgetId) dashboardOf(widgetId).then(setHere).catch(() => {});
    getCalendarAccount().then(cal => setCalWidget(cal?.widgetId ?? null)).catch(() => {});
  }, [widgetId]);
  const isHere = (dashboardId?: string) => !dashboardId || !here || dashboardId === here;
  const readable = (w: WidgetRosterItem) => isHere(w.dashboardId) ? draft.dashboardWidgets[w.id] !== false : draft.dashboardWidgets[w.id] === true;
  const shownRoster = (roster ?? []).filter(w => draft.allDashboards || isHere(w.dashboardId))
    .sort((a, b) => Number(!isHere(a.dashboardId)) - Number(!isHere(b.dashboardId)));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [kiwixSources, setKiwixSources] = useState<{ title: string; id: string }[]>([]);
  const [loadingKiwix, setLoadingKiwix] = useState(false);
  const [kiwixError, setKiwixError] = useState("");
  const [knownKiwix, setKnownKiwix] = useState<KnownKiwixServer[]>([]);
  const [knownAnytype, setKnownAnytype] = useState<KnownAnytype[]>([]);
  // Model servers: ones another Assistant already uses, and ones found on the
  // usual ports (lib/useModelServers, shared with the digest).
  const servers = useModelServers(widgetId);
  function pickServer(url: string, model: string) {
    const next = { ...draft, baseUrl: url, model };
    setDraft(next);
    fetchModels(next);
  }
  useEffect(() => {
    listKiwixServers().then(setKnownKiwix).catch(() => {});
    listAnytypeConnections().then(setKnownAnytype).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // An Anytype widget's connection not already in use here.
  const anytypeOffers = knownAnytype.filter(k => !(k.url.toLowerCase() === draft.anytypeUrl.trim().replace(/\/+$/, "").toLowerCase() && k.spaceId === draft.anytypeSpaceId && !!draft.anytypeApiKey));

  // Anytype pairing: its own connection, like the Kiwix one.
  const [anytypeSpaces, setAnytypeSpaces] = useState<{ id: string; name: string }[]>([]);
  const [anytypePairing, setAnytypePairing] = useState<"idle" | "awaiting-code">("idle");
  const [anytypeChallengeId, setAnytypeChallengeId] = useState("");
  const [anytypeCode, setAnytypeCode] = useState("");
  const [anytypeBusy, setAnytypeBusy] = useState(false);
  const [anytypeError, setAnytypeError] = useState("");
  const [anytypeKeyInput, setAnytypeKeyInput] = useState("");
  function connectAnytypeWithKey() {
    const key = anytypeKeyInput.trim();
    if (!key || !draft.anytypeUrl.startsWith("http")) return;
    setAnytypeError("");
    setDraft(d => ({ ...d, anytypeApiKey: key }));
    setAnytypeKeyInput("");
    loadAnytypeSpaces(draft.anytypeUrl, key, draft.anytypeSpaceId);
  }
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
      setAnytypeError(`Could not reach Anytype: ${String((e as Error).message ?? e)}. Is the Anytype client at that address running?`);
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
    <div className="flex flex-col flex-1 min-h-0 p-4">
      <SettingsFace c={c} onReset={() => setDraft(DEFAULT_CONFIG)} onSave={() => onSave(draft)} onCancel={onCancel} saveDisabled={!draft.baseUrl.trim() || !draft.model.trim()}>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className={`text-sm opacity-70 ${c.label}`}>Model server</p>
            <SmallButton c={c} onClick={servers.find} disabled={servers.finding} title="Look for Ollama, LM Studio or llama.cpp on this server and on hosts your other widgets use">
              {servers.finding ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Find servers
            </SmallButton>
          </div>
          <SettingsInput
            autoFocus
            type="url"
            value={draft.baseUrl}
            onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
            placeholder="http://server:8080/v1"
          />
          {/* One click: a connection another Assistant already uses, or a
              server just found. Hidden for the one already entered. */}
          {(() => {
            const offers = servers.offers(draft.baseUrl, draft.model);
            if (offers.length === 0) return servers.nothingFound ? <p className="text-sm text-[var(--text-muted)] mt-1.5">No model server answered on the usual ports. Enter its address above.</p> : null;
            return (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {offers.map(o => (
                  <Chip key={o.key} c={c} onClick={() => pickServer(o.url, o.model)} title={`${o.url} (${o.note})`}>
                    Use {o.label}
                  </Chip>
                ))}
              </div>
            );
          })()}
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
            <p className={`text-sm opacity-70 ${c.label}`}>Model</p>
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
          {modelsError && <p className="text-red-400 text-sm mt-1">{modelsError}</p>}
        </div>

        <p className={`text-sm opacity-70 mt-1 ${c.label}`}>Behavior</p>

        <div>
          <p className={`text-sm mb-1 opacity-70 ${c.label}`}>System prompt <span className="opacity-70">(optional)</span></p>
          <SettingsTextarea
            value={draft.system}
            onChange={e => setDraft(d => ({ ...d, system: e.target.value }))}
            placeholder="You are a helpful assistant."
            rows={2}
          />
        </div>

        <div>
          <p className={`text-sm mb-1 opacity-70 ${c.label}`}>Text size</p>
          <div className="flex flex-wrap gap-1">
            {([["sm", "Small"], ["md", "Medium"], ["lg", "Large"]] as const).map(([key, label]) => (
              <Chip key={key} c={c} active={(draft.textSize ?? "sm") === key} onClick={() => setDraft(d => ({ ...d, textSize: key }))}>
                {label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className={`text-sm mb-1 opacity-70 ${c.label}`}>Response style</p>
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
          <p className={`text-sm mb-1 opacity-70 ${c.label}`}>Thinking <span className="opacity-70">(reasoning models)</span></p>
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
            className={`flex items-center gap-1 text-sm opacity-70 hover:opacity-100 ${FOCUS_RING} ${c.label}`}
          >
            <ChevronRight size={12} className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
            Advanced
            <span className="opacity-70">
              (cap: {draft.maxTokens ? `${draft.maxTokens} tokens` : "none"}{draft.maxTokens !== LENGTH_PRESETS[draft.length].cap ? ", custom" : ""})
            </span>
          </button>
          {advancedOpen && (<div className="mt-1.5">
          <div className="flex items-center justify-between gap-3 min-h-7">
            <p className={`text-sm opacity-70 ${c.label}`}>Max response length <span className="opacity-70">(tokens, 0 is no limit)</span></p>
            <Stepper label="max response length in tokens" value={draft.maxTokens || 0} min={0} max={8192} step={64} onChange={v => setDraft(d => ({ ...d, maxTokens: v }))} />
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {[128, 256, 512, 1024].map(n => (
              <Chip key={n} c={c} active={draft.maxTokens === n} onClick={() => setDraft(d => ({ ...d, maxTokens: n }))} className="tabular-nums">
                {n}
              </Chip>
            ))}
          </div>
          </div>)}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className={`text-sm opacity-70 min-w-0 ${c.label}`}>Data access</p>
            <Chip c={c} active={!!draft.allDashboards} onClick={() => setDraft(d => ({ ...d, allDashboards: !d.allDashboards }))} title="List widgets from every dashboard">All dashboards</Chip>
          </div>
          <p className="text-sm text-[var(--text-muted)] mb-1.5">What the model may read when you ask it something. Widgets on this dashboard are on unless you turn them off; widgets on other dashboards are off until you turn them on.</p>
          {roster === null ? (
            <p className="text-sm text-[var(--text-muted)] flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> Loading widgets</p>
          ) : shownRoster.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No widgets with data on this dashboard.</p>
          ) : (
            <div className="flex flex-col">
              {shownRoster.map((w, i) => {
                const local = isHere(w.dashboardId);
                const isCal = w.type === "calendar";
                const ready = !isCal || !local || calWidget === w.id;
                const kind = isCal ? (local ? "agenda and new events" : "agenda") : kindLabel(w.type);
                const heading = draft.allDashboards && w.dashboardId !== shownRoster[i - 1]?.dashboardId;
                return (
                  <div key={w.id}>
                    {heading && <p className={`text-sm font-medium pt-2 pb-1 ${c.label}`}>{local ? "This dashboard" : w.dashboardName}</p>}
                    <div className="flex items-center justify-between gap-3 py-1">
                      <span className="min-w-0 truncate text-sm text-[var(--text-primary)]">
                        {w.title}
                        {kind.toLowerCase() !== w.title.toLowerCase() && <span className="ml-1.5 text-[var(--text-secondary)]">{kind}</span>}
                        {!ready && <span className="ml-1.5 text-[var(--text-muted)]">set up the Calendar widget first</span>}
                      </span>
                      <Toggle
                        checked={ready && readable(w)}
                        onChange={() => { if (ready) setDraft(d => ({ ...d, sourcesVersion: 3, dashboardWidgets: { ...d.dashboardWidgets, [w.id]: !readable(w) } })); }}
                        label={`Let the model read ${w.title}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className={`text-sm font-medium pt-2 pb-1 ${c.label}`}>Connections</p>
          {([
            { key: "useKiwix", label: "Kiwix library", ready: !!draft.kiwixUrl.trim(), note: "set up below" },
            { key: "useAnytype", label: "Anytype", ready: !!(draft.anytypeApiKey && draft.anytypeSpaceId), note: "pair below" },
          ] as const).map(row => (
            <div key={row.key} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 truncate text-sm text-[var(--text-primary)]">
                {row.label}
                {!row.ready && <span className="ml-1.5 text-[var(--text-muted)]">{row.note}</span>}
              </span>
              <Toggle
                checked={row.ready && !!draft[row.key]}
                onChange={() => { if (row.ready) setDraft(d => ({ ...d, [row.key]: !d[row.key] })); }}
                label={`Let the model use ${row.label}`}
              />
            </div>
          ))}
        </div>

        <p className={`text-sm opacity-70 mt-1 ${c.label}`}>Connections</p>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className={`text-sm opacity-70 min-w-0 ${c.label}`}>Kiwix library</p>
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
          {/* Servers your Kiwix widgets already use: one click fills the field.
              Hidden for the one already entered. */}
          {knownKiwix.filter(k => k.url.toLowerCase() !== draft.kiwixUrl.trim().replace(/\/+$/, "").toLowerCase()).length > 0 && (
            <div className="flex flex-col gap-1 mt-1.5">
              <p className={`text-sm opacity-70 ${c.label}`}>{knownKiwix.length > 1 ? "From your Kiwix widgets:" : "From your Kiwix widget:"}</p>
              <div className="flex flex-wrap gap-1.5">
                {knownKiwix.filter(k => k.url.toLowerCase() !== draft.kiwixUrl.trim().replace(/\/+$/, "").toLowerCase()).map(k => (
                  <Chip
                    key={k.url}
                    c={c}
                    onClick={() => { setDraft(d => ({ ...d, kiwixUrl: k.url })); loadKiwixSources(k.url); }}
                    title={`${k.widgets} widget${k.widgets === 1 ? "" : "s"}${k.sources.length ? `: ${k.sources.join(", ")}` : ""}`}
                  >
                    Use {k.url.replace(/^https?:\/\//, "")}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {/* The server's books, each with a switch: unchecked ones are left
              out of lookups. A book added later starts checked. */}
          {kiwixSources.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-black/5 dark:bg-white/10 px-3 divide-y divide-black/10 dark:divide-white/10">
              {kiwixSources.map(b => {
                const on = !(draft.kiwixSkip ?? []).includes(b.id);
                return (
                  <SettingsListControl key={b.id} c={c} label={b.title}>
                    <Toggle
                      checked={on}
                      onChange={() => setDraft(d => ({ ...d, kiwixSkip: on ? [...(d.kiwixSkip ?? []), b.id] : (d.kiwixSkip ?? []).filter(x => x !== b.id) }))}
                      label={`Search ${b.title}`}
                    />
                  </SettingsListControl>
                );
              })}
            </div>
          )}
          {kiwixError && <p className="text-red-400 text-sm mt-1">{kiwixError}</p>}
        </div>

        <div>
          <p className={`text-sm mb-1 opacity-70 ${c.label}`}>Anytype</p>
          <SettingsInput
            type="url"
            value={draft.anytypeUrl}
            onChange={e => setDraft(d => ({ ...d, anytypeUrl: e.target.value, anytypeApiKey: "" }))}
            placeholder="http://server:31012"
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
              <p className="text-sm text-[var(--text-muted)] mt-1.5 flex items-center gap-1">
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
            <>
              <div className="flex items-center gap-1.5 mt-1.5">
                <SettingsInput
                  type="password"
                  autoComplete="off"
                  value={anytypeKeyInput}
                  onChange={e => setAnytypeKeyInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && connectAnytypeWithKey()}
                  placeholder="API key"
                  aria-label="Anytype API key"
                  className="flex-1 min-w-0"
                />
                <SmallButton c={c} onClick={connectAnytypeWithKey} disabled={!anytypeKeyInput.trim() || !draft.anytypeUrl.startsWith("http")} className="shrink-0">
                  Connect
                </SmallButton>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-sm opacity-70 ${c.label}`}>or</span>
                <SmallButton c={c} onClick={startAnytypePairing} disabled={anytypeBusy || !draft.anytypeUrl.startsWith("http")}>
                  {anytypeBusy ? <><Loader size={12} className="animate-spin" /> contacting…</> : "Pair with the desktop app"}
                </SmallButton>
              </div>
            </>
          )}
          {anytypeOffers.length > 0 && (
            <div className="flex flex-col gap-1 mt-1.5">
              <p className={`text-sm opacity-70 ${c.label}`}>{knownAnytype.length > 1 ? "From your Anytype widgets:" : "From your Anytype widget:"}</p>
              <div className="flex flex-wrap gap-1.5">
                {anytypeOffers.map(k => (
                  <Chip
                    key={`${k.url}|${k.spaceId}`}
                    c={c}
                    onClick={() => {
                      setAnytypeError("");
                      setDraft(d => ({ ...d, anytypeUrl: k.url, anytypeApiKey: k.apiKey, anytypeSpaceId: k.spaceId, anytypeSpaceName: k.spaceName }));
                      loadAnytypeSpaces(k.url, k.apiKey, k.spaceId);
                    }}
                    title={`Reuse this connection (${k.widgets} widget${k.widgets === 1 ? "" : "s"})`}
                  >
                    Use {k.url.replace(/^https?:\/\//, "")}{k.spaceName ? ` · ${k.spaceName}` : ""}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {anytypeError && <p className="text-red-400 text-sm mt-1">{anytypeError}</p>}
          <p className="text-sm text-[var(--text-muted)] mt-1">Connect with an API key from a headless client on a server (works from every device), or pair with the desktop app (only while it is open). Then pick a space and turn lookup on with the box icon by the send button.</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className={`text-sm opacity-70 ${c.label}`}>Anytype write bridge <span className="opacity-70">(optional, enables creating notes)</span></p>
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
          {bridgeStatus === "ok" && <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">bridge reachable ✓</p>}
          {bridgeStatus === "fail" && <p className="text-red-400 text-sm mt-1">bridge not reachable</p>}
          <p className="text-sm text-[var(--text-muted)] mt-1">Runs next to the Anytype app (tools/anytype-bridge in the repo). Without it, Anytype stays read-only.</p>
        </div>

        <div>
          <p className={`text-sm mb-1 opacity-70 ${c.label}`}>Assistant writes</p>
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
          <p className="text-sm text-[var(--text-muted)] mt-1">ask first = the model proposes and you approve a card. auto = it writes immediately and reports what it did.</p>
        </div>

      </SettingsFace>
    </div>
  );
}
