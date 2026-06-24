"use client";

import { useEffect, useState } from "react";
import { Bookmark, Plus, Minus, GripVertical, LayoutGrid, LayoutList, AlignJustify, ExternalLink } from "lucide-react";
import { colorMap, type Widget, type ColorClasses } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "./ui/FlipCard";
import { SettingsInput } from "./ui/Field";
import { PencilButton, EmptyState, SaveCancelRow, ScrollFades } from "./ui/WidgetChrome";

// A bookmarks board. Each link shows its site favicon (with a tidy colored
// letter tile when the favicon is missing, or a custom emoji/image override),
// and the whole list renders in one of three picks: icon-only tiles, icon plus
// name rows, or a compact name-only list. Favicons load straight from the
// bookmarked site (no third party), matching the project's self-hosted bent.

type View = "icon" | "row" | "name";
type Bookmark = { id: string; url: string; name: string; icon?: string };
type Config = { bookmarks: Bookmark[]; view: View; iconSize?: number };

// Icon-view tile size, adjustable from the header (clamped, stepped).
const ICON_MIN = 28, ICON_MAX = 80, ICON_STEP = 8, ICON_DEFAULT = 44;
const clampIcon = (n: number) => Math.max(ICON_MIN, Math.min(ICON_MAX, n));

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Accept "github.com", "github.com/foo", or a full URL; always store an
// absolute https URL so links and favicons resolve.
function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function displayName(bm: Bookmark): string {
  return (bm.name || "").trim() || domainOf(bm.url) || bm.url;
}

// Black or white text, whichever reads on a given tile color — the palette
// holds both light tints (amber, lime) and dark ones, so a fixed white fails.
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}

// One square icon: custom emoji/text, custom image, the site favicon, or — when
// none load — a colored letter tile keyed to the domain (stable, palette-based).
function Favicon({ bm, size }: { bm: Bookmark; size: number }) {
  const domain = domainOf(bm.url);
  const custom = bm.icon?.trim();
  const isEmoji = !!custom && !/^https?:\/\//i.test(custom);
  const src = isEmoji ? "" : (custom || (domain ? `https://${domain}/favicon.ico` : ""));
  const radius = Math.round(size * 0.28);

  const [failed, setFailed] = useState(false);
  // Re-attempt the image whenever the source changes (e.g. a URL is corrected
  // in settings), instead of clinging to a stale fallback for the new site.
  useEffect(() => { setFailed(false); }, [src]);

  if (isEmoji) {
    return (
      <span
        style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.56) }}
        className="inline-flex items-center justify-center bg-black/[0.05] dark:bg-white/[0.08] shrink-0 leading-none"
      >
        {custom}
      </span>
    );
  }

  if (src && !failed) {
    const inner = Math.round(size * 0.6);
    return (
      <span
        style={{ width: size, height: size, borderRadius: radius }}
        className="inline-flex items-center justify-center bg-black/[0.04] dark:bg-white/[0.06] overflow-hidden shrink-0"
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          width={inner}
          height={inner}
          style={{ width: inner, height: inner }}
          onError={() => setFailed(true)}
          className="object-contain"
        />
      </span>
    );
  }

  const tint = tagColor(domain || bm.name || bm.url).dot;
  const letter = (displayName(bm).charAt(0) || "?").toUpperCase();
  return (
    <span
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: tint, color: readableOn(tint), fontSize: Math.round(size * 0.48) }}
      className="inline-flex items-center justify-center font-semibold shrink-0 leading-none"
    >
      {letter}
    </span>
  );
}

// Header view-mode picker: three quiet toggles.
function ViewToggle({ c, view, onChange }: { c: ColorClasses; view: View; onChange: (v: View) => void }) {
  const opts: { value: View; icon: typeof LayoutGrid; title: string }[] = [
    { value: "icon", icon: LayoutGrid, title: "Icons only" },
    { value: "row", icon: LayoutList, title: "Icons and names" },
    { value: "name", icon: AlignJustify, title: "Names only" },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {opts.map(o => {
        const Icon = o.icon;
        const active = view === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.title}
            className={`p-1 rounded-md transition-colors ${active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.icon} opacity-40 hover:opacity-80`}`}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}

export default function BookmarksWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const configKey = `bookmarks-config-${widget.id}`;

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [view, setView] = useState<View>("row");
  const [iconSize, setIconSize] = useState(ICON_DEFAULT);
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Bookmark[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([bookmarks, view]);

  useEffect(() => {
    storage.getItem(configKey).then(raw => {
      if (raw) {
        try {
          const cfg = JSON.parse(raw) as Partial<Config>;
          const list = (cfg.bookmarks ?? []).map(b => ({ ...b, id: b.id || newId() }));
          setBookmarks(list);
          setDraft(list);
          if (cfg.view === "icon" || cfg.view === "row" || cfg.view === "name") setView(cfg.view);
          if (typeof cfg.iconSize === "number") setIconSize(clampIcon(cfg.iconSize));
        } catch {}
      }
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  function persist(list: Bookmark[], v: View, size: number) {
    storage.setItem(configKey, JSON.stringify({ bookmarks: list, view: v, iconSize: size }));
  }

  function changeView(v: View) {
    setView(v);
    persist(bookmarks, v, iconSize);
  }

  function changeIconSize(delta: number) {
    const next = clampIcon(iconSize + delta);
    if (next === iconSize) return;
    setIconSize(next);
    persist(bookmarks, view, next);
  }

  // Reorder happens on the draft and commits with the rest of the edits on save.
  function reorder(from: number, to: number) {
    if (from === to) return;
    setDraft(d => {
      const a = [...d];
      const [moved] = a.splice(from, 1);
      a.splice(to, 0, moved);
      return a;
    });
  }

  function addDraft() {
    const url = normalizeUrl(urlInput);
    if (!url) return;
    setDraft(d => [...d, { id: newId(), url, name: domainOf(url) }]);
    setUrlInput("");
  }

  function handleSave() {
    const clean = draft
      .map(b => ({ ...b, url: normalizeUrl(b.url), name: b.name.trim(), icon: b.icon?.trim() || undefined }))
      .filter(b => b.url);
    setBookmarks(clean);
    persist(clean, view, iconSize);
    setSettingsOpen(false);
  }

  // ── Front ──────────────────────────────────────────────────────────────────
  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0 gap-2">
        <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          <span className="opacity-50"><Bookmark size={14} /></span>
          <span className="text-xs font-medium opacity-60 truncate">{widget.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {view === "icon" && bookmarks.length > 0 && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => changeIconSize(-ICON_STEP)}
                disabled={iconSize <= ICON_MIN}
                title="Smaller icons"
                className={`p-1 rounded-md ${c.icon} opacity-40 hover:opacity-80 disabled:opacity-15 transition-opacity`}
              >
                <Minus size={12} />
              </button>
              <button
                onClick={() => changeIconSize(ICON_STEP)}
                disabled={iconSize >= ICON_MAX}
                title="Larger icons"
                className={`p-1 rounded-md ${c.icon} opacity-40 hover:opacity-80 disabled:opacity-15 transition-opacity`}
              >
                <Plus size={12} />
              </button>
            </div>
          )}
          {bookmarks.length > 0 && <ViewToggle c={c} view={view} onChange={changeView} />}
          <PencilButton c={c} onClick={() => { setDraft(bookmarks); setSettingsOpen(true); }} title="Edit bookmarks" />
        </div>
      </div>

      {!loaded ? null : bookmarks.length === 0 ? (
        <EmptyState c={c} action="add bookmarks" />
      ) : (
        <div className="flex-1 min-h-0 relative">
          <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
            {view === "icon" && (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconSize + 12}px, 1fr))` }}>
                {bookmarks.map(bm => (
                  <a
                    key={bm.id}
                    href={bm.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={displayName(bm)}
                    className="flex items-center justify-center p-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  >
                    <Favicon bm={bm} size={iconSize} />
                  </a>
                ))}
              </div>
            )}

            {view === "row" && (
              <div className="flex flex-col gap-0.5">
                {bookmarks.map(bm => (
                  <a
                    key={bm.id}
                    href={bm.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${displayName(bm)} · ${bm.url}`}
                    className="group/bm flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  >
                    <Favicon bm={bm} size={22} />
                    <span className={`flex-1 min-w-0 truncate text-sm ${c.text}`}>{displayName(bm)}</span>
                    <ExternalLink size={12} className={`shrink-0 opacity-0 group-hover/bm:opacity-40 ${c.label}`} />
                  </a>
                ))}
              </div>
            )}

            {view === "name" && (
              <div className="flex flex-col">
                {bookmarks.map(bm => (
                  <a
                    key={bm.id}
                    href={bm.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${displayName(bm)} · ${bm.url}`}
                    className={`flex items-center gap-2 px-2 py-1 rounded-md text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${c.text}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tagColor(domainOf(bm.url) || bm.url).dot }} />
                    <span className="truncate">{displayName(bm)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <ScrollFades c={c} top={topFade} bottom={bottomFade} />
        </div>
      )}
    </>
  );

  // ── Settings (back) ──────────────────────────────────────────────────────
  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addDraft()}
            placeholder="Paste a link, e.g. github.com"
            className="flex-1"
          />
          <button
            onClick={addDraft}
            className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Add bookmark"
          >
            <Plus size={14} />
          </button>
        </div>

        {draft.length > 1 && (
          <p className={`text-[10px] opacity-40 -mt-1 ${c.text}`}>Drag the handle to reorder.</p>
        )}

        {draft.length > 0 && (
          <div className="flex flex-col gap-2">
            {draft.map((bm, i) => (
              <div
                key={bm.id}
                onDragOver={e => { if (dragIdx !== null) e.preventDefault(); }}
                onDrop={() => { if (dragIdx !== null) reorder(dragIdx, i); setDragIdx(null); }}
                className={`flex flex-col gap-1.5 px-2 py-2 rounded-lg bg-black/5 dark:bg-white/10 transition-opacity ${dragIdx === i ? "opacity-40" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragEnd={() => setDragIdx(null)}
                    title="Drag to reorder"
                    className={`shrink-0 cursor-grab active:cursor-grabbing ${c.label} opacity-30 hover:opacity-70`}
                  >
                    <GripVertical size={13} />
                  </span>
                  <Favicon bm={bm} size={22} />
                  <input
                    value={bm.name}
                    onChange={e => setDraft(d => d.map(x => x.id === bm.id ? { ...x, name: e.target.value } : x))}
                    placeholder={domainOf(bm.url) || "Name"}
                    className={`flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm outline-none ${c.text}`}
                  />
                  <button
                    onClick={() => setDraft(d => d.filter(x => x.id !== bm.id))}
                    className={`opacity-50 hover:opacity-100 leading-none ${c.label}`}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
                <input
                  value={bm.url}
                  onChange={e => setDraft(d => d.map(x => x.id === bm.id ? { ...x, url: e.target.value } : x))}
                  placeholder="https://..."
                  className={`w-full bg-transparent dark:!bg-transparent text-[11px] opacity-60 outline-none ${c.label}`}
                />
              </div>
            ))}
          </div>
        )}

        {draft.length === 0 && (
          <p className={`text-[11px] leading-relaxed opacity-55 ${c.text}`}>
            Add the sites you visit most. Each shows its favicon, with a tidy colored tile when one is not available. Set an emoji or image URL as a custom icon by editing the link after adding it.
          </p>
        )}
      </div>
      <SaveCancelRow c={c} onSave={handleSave} onCancel={() => { setDraft(bookmarks); setUrlInput(""); setSettingsOpen(false); }} />
    </>
  );

  return <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />;
}
