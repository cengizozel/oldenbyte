"use client";

import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { FaceShownContext } from "./FlipCard";
import { createPortal } from "react-dom";
import { useTabGroup } from "@/lib/tabGroup";
import { useT } from "@/lib/useT";
import { useWidgetFrame } from "@/lib/widgetFrame";
import { Plus, Check, X, RotateCcw, Loader, RefreshCw, ChevronLeft, Maximize2, Minimize2, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { FOCUS_RING, HIT_AREA, SettingsInput } from "./Field";

// Small shared pieces of widget chrome: the hover pencil, scroll fades, the
// loading spinner, empty-state copy, and the settings save/cancel row.

// Settings entry point. Hidden until the card is hovered or the button gets
// keyboard focus (always visible on touch devices), matching the pattern every
// widget previously inlined.
// The one settings control, drawn by WidgetHeader for every widget that has a
// settings face (its `onSettings`), at the far right after full screen: same icon, same
// spot, found by the keyboard layer through data-widget-settings.
export function SettingsButton({ c, onClick }: { c: ColorClasses; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("common.settings")}
      aria-label={t("common.settings")}
      data-widget-settings
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      <SlidersHorizontal size={14} />
    </button>
  );
}

// Force-refresh for feed widgets: the server caches feeds (admin-set TTL) and
// serves pages from that cache; this button asks for a real upstream fetch now.
export function RefreshButton({ c, onClick, busy }: { c: ColorClasses; onClick: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={t("common.refreshNow")}
      aria-label={t("common.refreshNow")}
      data-widget-refresh
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 disabled:opacity-40 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
    </button>
  );
}

// Gradient overlays for scrollable lists; pair with useScrollFade().
// The back control of a detail view. It sits on the left of the first block
// (the thumbnail, or the title when there is none) and stretches to its
// height, so on a phone it is a large target rather than a 14px chevron.
export function BackButton({ c, onClick, label = "Back to list" }: { c: ColorClasses; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`shrink-0 self-stretch min-h-9 w-9 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors ${c.label} ${FOCUS_RING}`}
    >
      <ChevronLeft size={16} />
    </button>
  );
}

export function ScrollFades({ c, top, bottom }: { c: ColorClasses; top: boolean; bottom: boolean }) {
  return (
    <>
      {top && <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
      {bottom && <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
    </>
  );
}

export function LoadingState({ c }: { c: ColorClasses }) {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
    </div>
  );
}

// Standard empty-state copy, one style everywhere: centered in the widget
// body, lowercase, no trailing punctuation. Pass `action` for the canonical
// "hover and click the pencil to {action}" phrasing, or children for custom
// copy (which should follow the same casing rules).
export function EmptyState({ c, action, children }: { c: ColorClasses; action?: string; children?: ReactNode }) {
  return (
    <div className="flex-1 h-full min-h-0 flex items-center justify-center text-center px-4">
      <p className={`text-sm opacity-70 ${c.text}`}>
        {children ?? action}
      </p>
    </div>
  );
}

// Bottom row of a settings face: reset on the left (back to defaults, asked
// first), cancel and save on the right. Real 28px buttons on a fill, 16px
// glyphs, so they read as the face's actions and not as stray marks.
const FACE_BUTTON = `w-7 h-7 flex items-center justify-center rounded-lg transition-colors bg-black/5 dark:bg-white/10 ${FOCUS_RING}`;
export function SaveCancelRow({
  c,
  onSave,
  onCancel,
  onReset,
  saving = false,
  saveDisabled = false,
}: {
  c: ColorClasses;
  onSave: () => void;
  onCancel: () => void;
  onReset?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
}) {
  // Reset is destructive, so it asks first: the icon turns into a short
  // question with a confirming button, and disarms by itself.
  const t = useT();
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 5000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  return (
    <div className="flex items-center justify-between gap-3 mt-auto min-h-6">
      {onReset ? (
        confirmReset ? (
          <span className={`flex items-center gap-2 text-sm min-w-0 ${c.label}`}>
            <span className="opacity-70 truncate">{t("common.resetQuestion")}</span>
            <button type="button" onClick={() => { setConfirmReset(false); onReset(); }} className={`shrink-0 h-7 px-2.5 rounded-lg text-sm font-medium bg-black/10 dark:bg-white/15 text-red-600 dark:text-red-400 hover:bg-black/15 dark:hover:bg-white/20 ${FOCUS_RING}`}>{t("common.reset")}</button>
            <button type="button" onClick={() => setConfirmReset(false)} className={`shrink-0 h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`}>{t("common.keep")}</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className={`${FACE_BUTTON} ${c.label} opacity-70 hover:opacity-100`} title={t("common.backToDefaults")} aria-label={t("common.backToDefaults")}>
            <RotateCcw size={16} />
          </button>
        )
      ) : <span />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} title={t("common.cancel")} aria-label={t("common.cancel")} data-face-cancel className={`${FACE_BUTTON} ${c.label} opacity-70 hover:opacity-100`}>
          <X size={16} />
        </button>
        <button type="button" onClick={onSave} disabled={saving || saveDisabled} title={t("common.save")} aria-label={t("common.save")} data-face-save className={`${FACE_BUTTON} bg-black/10 dark:bg-white/15 hover:bg-black/15 dark:hover:bg-white/20 ${c.text} disabled:opacity-40`}>
          {saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
        </button>
      </div>
    </div>
  );
}

// The one widget header: icon, title, and a right-hand slot for counts and
// small actions (docs/design.md). In a tab group it renders into the tab row
// instead, see lib/tabGroup.ts. `after` renders inline after the title, for
// a badge such as the arXiv category.
// ── The header ───────────────────────────────────────────────────────────────
// Every widget header, single or in a tab group, reads the same way: the
// widget's identity (icon and name, or the tabs) on the left and one toggle
// at the right end, the same glyph everywhere. The toggle swaps the identity
// for the widget's options in the same row (its `after` and `right` content,
// then a full-screen button every widget gets from the grid), and back. So
// nothing else sits in a header by default: no always-on buttons, nothing
// hover-only, no status text. Once the options are asked for, hover-only
// buttons (the `opacity-0 group-hover:` chrome) show in full. In layout edit
// mode the same toggle swaps in the tile's controls (move, group, remove)
// instead, so every operation on a tile is in the one place.

// The two faces of a header row and how they trade places.
export const HEADER_SWAP = {
  main: "transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
  mainHidden: "opacity-0 -translate-x-2 pointer-events-none",
  pane: "absolute inset-0 flex items-center gap-2 min-w-0 transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none [&_.opacity-0:not(:hover)]:!opacity-90 dark:[&_.opacity-0:not(:hover)]:!opacity-70",
  paneHidden: "opacity-0 translate-x-2 pointer-events-none",
};

// The oldenbyte mark (public/logo.svg) reduced to one color and 16px: the
// dashed rounded square with the solid square inside, in the header's label
// color. The toggle wears it on every widget, so the brand is the one piece
// of chrome every header shares.
export function LogoGlyph({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2.2" />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// The toggle: the mark, which turns into a close cross with a turn and a
// fade. 24px tall in a 20px header line, so it takes no extra height.
export function HeaderToggle({ c, open, onToggle, className = "" }: { c: ColorClasses; open: boolean; onToggle: () => void; className?: string }) {
  const face = "absolute inset-0 transition-[opacity,rotate,scale] duration-200 ease-out motion-reduce:transition-none";
  const t = useT();
  return (
    <button
      type="button"
      aria-expanded={open}
      data-header-toggle
      aria-label={open ? t("common.closeOptions") : t("common.options")}
      title={open ? t("common.closeOptions") : t("common.options")}
      onMouseDown={e => e.stopPropagation()}
      onClick={onToggle}
      className={`shrink-0 w-6 h-6 -my-0.5 flex items-center justify-center rounded-md transition-opacity ${c.label} ${FOCUS_RING} ${open ? "opacity-100" : "opacity-70 hover:opacity-100"} ${className}`}
    >
      <span className="relative block w-4 h-4" aria-hidden>
        <LogoGlyph className={`${face} ${open ? "opacity-0 rotate-45 scale-75" : "opacity-100 rotate-0 scale-100"}`} />
        <X size={16} className={`${face} ${open ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-45 scale-75"}`} />
      </span>
    </button>
  );
}

// Between a widget's own actions and the pair every widget has (settings,
// full screen): a hairline with a little air, so the eye splits the two.
export function HeaderDivider({ c }: { c: ColorClasses }) {
  return <span aria-hidden className={`w-px h-4 mx-1 shrink-0 bg-current opacity-25 ${c.label}`} />;
}

// Full screen for the tile this widget sits in (lib/widgetFrame.ts). Nothing
// outside a grid tile (the digest page, previews).
export function ExpandButton({ c }: { c: ColorClasses }) {
  const frame = useWidgetFrame();
  const t = useT();
  if (!frame) return null;
  const label = frame.expanded ? t("common.exitFullScreen") : t("common.fullScreen");
  return (
    <button
      type="button"
      onClick={() => frame.setExpanded(!frame.expanded)}
      title={label}
      aria-label={label}
      data-widget-fullscreen
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      {frame.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
}

export function WidgetHeader({
  c, icon: Icon, title, after, right, onSettings, panel = false, className = "",
}: {
  c: ColorClasses;
  icon: LucideIcon;
  title: string;
  after?: ReactNode;
  right?: ReactNode;
  // Opens the widget's settings face: the header draws the settings control
  // for it, last in the row, after full screen.
  onSettings?: () => void;
  // The header of an overlay panel (a widget's history, insights, or an
  // editor) rather than the widget's own: it draws in place, with its
  // buttons always visible, even inside a tab group, where the tab keeps the
  // widget's name and the panel's title and buttons head the panel below it.
  panel?: boolean;
  className?: string;
}) {
  const group = useTabGroup();
  const frame = useWidgetFrame();
  const editing = frame?.editing ?? false;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [editing]); // back to the identity on any mode change

  if (panel) {
    return (
      <div className={`flex items-center justify-between gap-2 mb-3 shrink-0 ${className}`}>
        <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          <Icon size={14} className="opacity-50 shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
          {after}
        </div>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </div>
    );
  }
  if (group) {
    // Inside a tab group the tab row is the header: every tab carries its
    // widget's icon and title, and the shown tab's options go to the row's
    // options pane (components/TabStrip.tsx adds the toggle and full screen).
    return (
      <>
        {group.iconHost && createPortal(<Icon size={14} className="opacity-50 shrink-0" />, group.iconHost)}
        {group.titleHost && createPortal(<>{title}</>, group.titleHost)}
        {group.active && group.actionsHost && (after || right) && createPortal(
          <div className={`flex-1 flex items-center gap-2 min-w-0 ${className}`}>
            {after}
            {right && <div className="ml-auto flex items-center gap-2 shrink-0">{right}</div>}
          </div>,
          group.actionsHost
        )}
        {group.active && group.settingsHost && onSettings && createPortal(<SettingsButton c={c} onClick={onSettings} />, group.settingsHost)}
      </>
    );
  }
  const expand = !editing ? <ExpandButton c={c} /> : null;
  const settings = onSettings ? <SettingsButton c={c} onClick={() => { setOpen(false); onSettings(); }} /> : null;
  const controls = editing ? frame?.controls : null;
  const hasOptions = editing ? !!controls : !!(after || right || settings || expand);
  return (
    <div className={`flex items-center gap-3 mb-3 shrink-0 min-h-5 ${className}`}>
      <div className="relative flex-1 min-w-0 flex items-center">
        <div inert={open} className={`flex items-center gap-1.5 min-w-0 ${c.label} ${HEADER_SWAP.main} ${open ? HEADER_SWAP.mainHidden : ""}`}>
          <Icon size={14} className="opacity-50 shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
        </div>
        {/* In edit mode the tile's content sits, non-interactive, under the
            grid's drag overlay (z-10); the toggle and this pane rise above it
            and take the pointer, like the corner buttons they replace. */}
        {hasOptions && (
          <div inert={!open} className={`${HEADER_SWAP.pane} ${editing ? "z-20" : ""} ${open ? (editing ? "pointer-events-auto" : "") : HEADER_SWAP.paneHidden}`}>
            {editing ? (
              <div className="ml-auto flex items-center gap-2 shrink-0">{controls}</div>
            ) : (
              <>
                {after}
                {(right || settings || expand) && (
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    {right}
                    {(after || right) && (settings || expand) && <HeaderDivider c={c} />}
                    {expand}
                    {settings}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {hasOptions && <HeaderToggle c={c} open={open} onToggle={() => setOpen(v => !v)} className={editing ? "relative z-20 pointer-events-auto" : ""} />}
    </div>
  );
}

// ── Settings faces ───────────────────────────────────────────────────────────
// Every widget's settings share one shape (docs/design.md, Settings faces):
// the frame below (header, scrolling body, save row, Escape cancels), fields
// with a label above the control, chips for a few choices and a select for
// many, the Toggle for on/off, the Stepper for numbers you tune and a typed
// field for numbers you know, and one neutral row style for collections.

export function SettingsFace({
  c, title, children, onSave, onCancel, onReset, saving = false, saveDisabled = false, bodyRef, scroll = true,
}: {
  c: ColorClasses;
  title?: string;
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  onReset?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  scroll?: boolean;
}) {
  const t = useT();
  const faceRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  // In a tab group the row steps aside while this face shows.
  const group = useTabGroup();
  const shown = useContext(FaceShownContext) ?? true;
  const setFaceOpen = group?.setFaceOpen;
  useEffect(() => {
    if (!setFaceOpen) return;
    setFaceOpen(shown);
    return () => setFaceOpen(false);
  }, [setFaceOpen, shown]);
  // Escape cancels, like the cross: only for a face that is shown (a flip
  // card's hidden back is mounted but inert) and that holds the focus, or
  // when nothing in particular does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const face = faceRef.current;
      if (!face || face.closest("[inert]")) return;
      const active = document.activeElement;
      if (active && active !== document.body && !face.contains(active)) return;
      e.preventDefault();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div ref={faceRef} className="flex flex-col gap-3 flex-1 min-h-0">
      <WidgetHeader panel c={c} icon={SlidersHorizontal} title={title ?? t("common.settings")} />
      <div ref={bodyRef} className={`@container flex flex-col gap-3 flex-1 min-h-0 ${scroll ? "overflow-y-auto pr-3" : ""}`}>{children}</div>
      <SaveCancelRow c={c} onSave={onSave} onCancel={onCancel} onReset={onReset} saving={saving} saveDisabled={saveDisabled} />
    </div>
  );
}

// A labelled control: the label above (or beside, for a short control like
// chips or a toggle), an optional hint under it.
// Hierarchy: the label is medium weight at full strength, the hint under it
// is light, and the control stands on its own fill, so the three never read
// as the same thing.
export const SETTINGS_LABEL = "text-sm font-medium";
export const SETTINGS_HINT = "text-sm opacity-70 leading-snug";
export function SettingsField({ c, label, hint, children, inline = false }: { c: ColorClasses; label: ReactNode; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {inline ? (
        <div className="flex items-center justify-between gap-x-3 gap-y-1.5 min-h-7 flex-wrap">
          <span className={`${SETTINGS_LABEL} shrink-0 ${c.text}`}>{label}</span>
          {/* Narrow cards (the face is a size container): a group of three or
              more options takes its own line under the label, left-aligned
              like text; a toggle, a stepper or a two-way choice stays beside
              the label. */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap justify-end ml-auto @max-[26rem]:[&:has(>*:nth-child(3))]:basis-full @max-[26rem]:[&:has(>*:nth-child(3))]:justify-start @max-[26rem]:[&:has(>*:nth-child(3))]:ml-0">{children}</div>
        </div>
      ) : (
        <span className={`${SETTINGS_LABEL} ${c.text}`}>{label}</span>
      )}
      {hint && <p className={`${SETTINGS_HINT} ${c.label} ${inline ? "-mt-1" : ""}`}>{hint}</p>}
      {!inline && children}
    </div>
  );
}

// A collapsible group of related settings (a connection, an optional
// integration): one row with the name, a one-line summary of its state and a
// chevron; the fields open under it. Closed by default, so a face stays short.
export function SettingsGroup({ c, label, summary, hint, children, defaultOpen = false }: { c: ColorClasses; label: ReactNode; summary?: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`flex items-center justify-between gap-3 min-h-7 text-left rounded-md ${FOCUS_RING}`}>
        <span className={`${SETTINGS_LABEL} shrink-0 ${c.text}`}>{label}</span>
        <span className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          {!open && summary && <span className="text-sm opacity-70 truncate">{summary}</span>}
          <ChevronLeft size={14} className={`shrink-0 opacity-70 transition-transform ${open ? "rotate-90" : "-rotate-90"}`} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pl-3 border-l border-black/10 dark:border-white/10">
          {hint && <p className={`${SETTINGS_HINT} ${c.label}`}>{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

// Explanatory copy and errors inside a face.
export function SettingsNote({ c, children }: { c: ColorClasses; children: ReactNode }) {
  return <p className={`${SETTINGS_HINT} ${c.label}`}>{children}</p>;
}
// The row that adds an item to a collection: a field, then the one "Add"
// button (plus glyph and the word). Enter adds too. Every collection uses
// this, so the row cannot differ between widgets.
export function SettingsAddRow({
  c, value, onChange, onAdd, placeholder, busy = false, inputRef,
}: {
  c: ColorClasses;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  busy?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      <SettingsInput
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onAdd(); }}
        placeholder={placeholder}
        className="flex-1 min-w-0"
      />
      <SmallButton c={c} onClick={onAdd} disabled={busy} title={t("common.add")}>
        {busy ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
        {t("common.add")}
      </SmallButton>
    </div>
  );
}

// Read-only information inside a face (a status, a list of things found):
// an inset block with its own small heading and bullets, so it never reads
// as another setting.
export function SettingsInfo({ c, title, items, more }: { c: ColorClasses; title: ReactNode; items?: ReactNode[]; more?: ReactNode }) {
  return (
    <div className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 flex flex-col gap-1.5 ${c.label}`}>
      <p className="text-sm font-medium">{title}</p>
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-1 list-disc pl-4 text-sm marker:opacity-50">
          {items.map((it, i) => <li key={i} className="min-w-0 break-words">{it}</li>)}
        </ul>
      )}
      {more && <p className="text-sm opacity-70">{more}</p>}
    </div>
  );
}
export function SettingsError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-red-400 break-words">{children}</p>;
}

// One item of an editable collection, laid out like a grouped list: a neutral
// card (no palette color of its own) whose first row is the item itself, a
// leading slot (drag handle, icon, color dot), the name and trailing icon
// actions, and whose further rows are its controls, each a label on the left
// and a control on the right (SettingsListControl). Rows are the same
// height and a hairline apart, so every card reads as one table.
export function SettingsListRow({
  leading, title, actions, children, className = "", style, rowRef,
}: {
  leading?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  rowRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={rowRef} style={style} className={`flex flex-col px-3 rounded-lg bg-black/5 dark:bg-white/10 divide-y divide-black/10 dark:divide-white/10 ${className}`}>
      {/* The item's own row is a header band: a darker strip with the name in
          semibold, so it never reads as one more control. */}
      <div className="flex items-center gap-2 min-h-9 py-1 -mx-3 px-3 rounded-t-lg bg-black/5 dark:bg-white/10 last:rounded-b-lg">
        {leading}
        <div className="flex-1 min-w-0 flex items-center text-sm font-semibold [&_input]:font-semibold">{title}</div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// A control row inside a SettingsListRow (or any grouped list): the label on
// the left at the meta level, the control on the right, 36px tall.
export function SettingsListControl({ c, label, children }: { c: ColorClasses; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-9 py-1">
      <span className={`text-sm shrink-0 ${c.text}`}>{label}</span>
      <div className="flex items-center gap-1.5 min-w-0 flex-wrap justify-end">{children}</div>
    </div>
  );
}

// A bare field as a row of a list card (an address, an icon): the same 36px
// row as a control, the field filling it.
export function SettingsListField({ children }: { children: ReactNode }) {
  return <div className="flex items-center min-h-9 py-1">{children}</div>;
}

// The field that sits in a list row's title slot: borderless, so the row
// reads as a name, and a text field when you look for one.
export const LIST_TITLE_INPUT = "flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]";
// A small icon action in a row (remove, hide): 70% at rest, full on hover.
export const ROW_ACTION = `opacity-70 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING}`;

// A small toggle for modes and options: the chosen one is inverted (a solid
// dark chip in light themes, a solid light one in dark), far past 3:1 against
// its neighbours; the rest sit on a faint fill. Was: the active one has the translucent
// fill, the rest sit at 70% and brighten on hover.
export function Chip({
  c, active = false, onClick, title, children, className = "",
}: {
  c: ColorClasses;
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-7 px-2.5 rounded-md text-sm leading-none whitespace-nowrap shrink-0 transition-colors ${FOCUS_RING} ${
        active ? "bg-black/75 text-white dark:bg-white/85 dark:text-black font-medium" : `bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 ${c.text}`
      } ${className}`}
    >
      {children}
    </button>
  );
}

// The standard small action button (new game, load models, add).
export function SmallButton({
  c, onClick, title, disabled, children, className = "",
}: {
  c: ColorClasses;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40 transition-colors ${FOCUS_RING} ${c.label} ${className}`}
    >
      {children}
    </button>
  );
}

// Shows the active "only this source" filter in a widget header; the x clears it.
export function FilterChip({ c, label, onClear }: { c: ColorClasses; label: string; onClear: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-full text-sm bg-black/10 dark:bg-white/15 ${c.text} min-w-0`}>
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label="Clear filter" title="Show everything (Esc)" className={`shrink-0 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`}>
        <X size={12} />
      </button>
    </span>
  );
}
