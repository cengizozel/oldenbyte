"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type ComponentType } from "react";
import { createPortal } from "react-dom";
import * as storage from "@/lib/storage";
import { Layers } from "lucide-react";
import GridLayout from "react-grid-layout";
import type { Layout as LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget, WidgetType, WidgetSize } from "@/lib/widgets";
import { colorMap, widgets as widgetDefs, defaultSizeFor, instanceOf } from "@/lib/widgets";
import { WidgetActiveContext, usePageVisible } from "@/lib/activeDashboard";
import { layoutKey, instancesKey } from "@/lib/dashboards";
import { isDemoMode } from "@/lib/demo";
import WidgetCard from "./WidgetCard";
import WidgetShelf from "./WidgetShelf";
import NotebookWidget from "./NotepadWidget";
import TextWidget from "./TextWidget";
import RssWidget from "./RssWidget";
import RedditWidget from "./RedditWidget";
import YoutubeWidget from "./YoutubeWidget";
import F1Widget from "./F1Widget";
import ArxivWidget from "./ArxivWidget";
import HuggingFaceWidget from "./HuggingFaceWidget";
import TrackerWidget from "./TrackerWidget";
import RhythmWidget from "./RhythmWidget";
import UpkeepWidget from "./UpkeepWidget";
import BookmarksWidget from "./BookmarksWidget";
import TypingWidget from "./TypingWidget";
import dynamic from "next/dynamic";
import ChatWidget from "./ChatWidget";
import KiwixWidget from "./KiwixWidget";
import AnytypeWidget from "./AnytypeWidget";
import WeatherWidget from "./WeatherWidget";
import CalendarWidget from "./CalendarWidget";
import ScheduleWidget from "./ScheduleWidget";
import BankWidget from "./BankWidget";
import type { BankWidgetDef } from "@/lib/widgetBank";
const ReaderWidget = dynamic(() => import("./ReaderWidget"), { ssr: false });
const ChessWidget = dynamic(() => import("./ChessWidget"), { ssr: false });
const TvWidget = dynamic(() => import("./TvWidget"), { ssr: false });

const COLS = 4;
const GAP = 16;

type TabLayoutItem = LayoutItem & { tabs?: string[] };

const initialLayout: TabLayoutItem[] = [
  { i: "notebook",            x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "arxiv-default",       x: 1, y: 0, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6, tabs: ["hf-default"] },
  { i: "kiwix-default",       x: 2, y: 0, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "chat-default",        x: 3, y: 0, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "rss",                 x: 0, y: 3, w: 1, h: 5, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "f1-default",          x: 1, y: 4, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "youtube",             x: 2, y: 4, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6, tabs: ["reddit"] },
];

const initialInstances: Record<string, Widget> = {
  "notebook":      { id: "notebook",      type: "notebook", color: "amber",  title: "Notepad",  description: "A simple place for temporary notes." },
  "rss":           { id: "rss",           type: "rss",      color: "teal",   title: "Feed",     description: "Headlines from any RSS feed." },
  "reddit":        { id: "reddit",        type: "reddit",   color: "orange", title: "Reddit",   description: "Top posts from your chosen subreddits." },
  "youtube":       { id: "youtube",       type: "youtube",  color: "rose",   title: "YouTube",  description: "Latest videos from your chosen channels." },
  "f1-default":    { id: "f1-default",    type: "f1",       color: "rose",   title: "F1",       description: "Next race and driver standings." },
  "arxiv-default": { id: "arxiv-default", type: "arxiv",    color: "sky",    title: "arXiv",    description: "Latest papers from a chosen research field." },
  "hf-default":    { id: "hf-default",    type: "hf",       color: "orange", title: "HF Daily", description: "Trending AI papers curated by Hugging Face." },
  "kiwix-default": { id: "kiwix-default", type: "kiwix",    color: "teal",   title: "Kiwix",    description: "Search an offline Kiwix library (Wikipedia, etc.)." },
  "chat-default":  { id: "chat-default",  type: "chat",     color: "sky",    title: "Chat",     description: "Chat with a local or OpenAI-compatible model." },
};

// Type to component. Kept here rather than on the registry in lib/widgets.ts:
// that module is imported by the widgets themselves and by server code, so
// pointing it at components would create import cycles and pull client code
// into server bundles. The Record type makes a missing entry a type error.
type WidgetProps = { widget: Widget; className?: string };
const WIDGET_COMPONENTS: Record<Exclude<WidgetType, "custom" | "empty">, ComponentType<WidgetProps>> = {
  notebook: NotebookWidget,
  text: TextWidget,
  rss: RssWidget,
  reddit: RedditWidget,
  youtube: YoutubeWidget,
  ebook: ReaderWidget,
  f1: F1Widget,
  weather: WeatherWidget,
  calendar: CalendarWidget,
  schedule: ScheduleWidget,
  arxiv: ArxivWidget,
  hf: HuggingFaceWidget,
  tracker: TrackerWidget,
  rhythm: RhythmWidget,
  upkeep: UpkeepWidget,
  bookmarks: BookmarksWidget,
  typing: TypingWidget,
  chess: ChessWidget,
  tv: TvWidget,
  chat: ChatWidget,
  kiwix: KiwixWidget,
  anytype: AnytypeWidget,
};

function renderWidget(widget: Widget, extraClass = "", bankDefs: Record<string, BankWidgetDef> = {}) {
  const cls = `h-full ${extraClass}`;
  if (widget.type === "custom") return <BankWidget widget={widget} def={widget.bankId ? bankDefs[widget.bankId] : undefined} className={cls} />;
  const Component = widget.type === "empty" ? undefined : WIDGET_COMPONENTS[widget.type];
  if (Component) return <Component widget={widget} className={cls} />;
  return <WidgetCard widget={widget} className={cls} />;
}

// Each widget renders exactly once, through a portal into its own persistent
// DOM node, from a fixed spot in the tree (see the end of WidgetGrid). The
// edit grid and the three view layouts only render WidgetSlot placeholders that
// adopt that node. So toggling edit mode or crossing a breakpoint moves DOM
// instead of remounting widgets: chat streams, readers and feeds keep going.
// moveBefore() (where supported) moves nodes without resetting iframes or
// scroll positions; appendChild is the fallback.
function moveNode(parent: Element, node: Element) {
  if (node.parentNode === parent) return;
  const p = parent as Element & { moveBefore?: (node: Node, child: Node | null) => void };
  if (typeof p.moveBefore === "function" && parent.isConnected && node.isConnected) {
    try { p.moveBefore(node, null); return; } catch {}
  }
  parent.appendChild(node);
}

function WidgetSlot({ node, park }: { node: HTMLDivElement; park: (node: HTMLDivElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Layout effect so the node is in place before paint. On unmount the node is
  // parked (still in the document) until the next layout's slot adopts it,
  // which happens in the same commit when the layout variant changes.
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    moveNode(host, node);
    return () => { if (node.parentNode === host) park(node); };
  }, [node, park]);
  return <div ref={ref} className="h-full" />;
}

export default function WidgetGrid({
  widgets,
  editing = false,
  onRegisterEditControls,
  dashboardId = "default",
  active = true,
}: {
  widgets: Widget[];
  editing?: boolean;
  // Lets the TopBar cancel an edit session (revert to the pre-edit layout).
  onRegisterEditControls?: (controls: { cancel: () => void }) => void;
  dashboardId?: string;
  // Whether this dashboard is the one on screen (page.tsx keeps hidden ones
  // mounted). Feeds useWidgetActive() together with tab visibility.
  active?: boolean;
}) {
  const LAYOUT_KEY = layoutKey(dashboardId);
  const INSTANCES_KEY = instancesKey(dashboardId);

  const [layout, setLayout] = useState<TabLayoutItem[]>(initialLayout);
  const [instances, setInstances] = useState<Record<string, Widget>>(initialInstances);
  const [loaded, setLoaded] = useState(false);
  // layout/instances start at the starter defaults. A missing or failed read
  // (absent key, or a 401/network blip) leaves them at those defaults, and the
  // persist effects below fire on the load transition, which would overwrite a
  // real dashboard with the starter. Skip that first post-load write and only
  // save genuine later edits, so a bad read can never clobber saved data.
  const layoutHydrated = useRef(false);
  const instancesHydrated = useRef(false);

  // Community widget-bank definitions: render existing instances and offer
  // templates in the shelf's Community group.
  const [bankDefs, setBankDefs] = useState<Record<string, BankWidgetDef>>({});
  const [bankTemplates, setBankTemplates] = useState<Widget[]>([]);
  useEffect(() => {
    fetch("/api/widget-bank")
      .then(r => r.json())
      .then((d: { widgets?: BankWidgetDef[] }) => {
        const defs: Record<string, BankWidgetDef> = {};
        const templates: Widget[] = [];
        for (const def of d.widgets ?? []) {
          defs[def.id] = def;
          templates.push({
            id: def.id,
            type: "custom",
            bankId: def.id,
            color: def.color ?? "neutral",
            title: def.title,
            description: def.description,
            digestable: def.digestable ?? false,
          });
        }
        setBankDefs(defs);
        setBankTemplates(templates);
      })
      .catch(() => {});
  }, []);

  const pageVisible = usePageVisible();

  // Persistent per-widget DOM nodes the portals render into (see WidgetSlot).
  // Created on first use, dropped once the widget leaves the dashboard.
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const parkingRef = useRef<HTMLDivElement>(null);
  const getNode = (id: string) => {
    let node = nodesRef.current.get(id);
    if (!node) {
      node = document.createElement("div");
      node.style.height = "100%";
      nodesRef.current.set(id, node);
    }
    return node;
  };
  const park = useCallback((node: HTMLDivElement) => {
    if (parkingRef.current) moveNode(parkingRef.current, node);
  }, []);
  const slot = (id: string) => <WidgetSlot node={getNode(id)} park={park} />;
  const [gridReady, setGridReady] = useState(false);
  const [groupingSource, setGroupingSource] = useState<string | null>(null);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});

  // ── Edit-session history (undo/redo) and cancel-revert ────────────────────
  type Snap = { layout: TabLayoutItem[]; instances: Record<string, Widget>; activeTabs: Record<string, string> };
  const historyRef = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const editStartRef = useRef<Snap | null>(null);
  const [histVersion, setHistVersion] = useState(0);
  const layoutRef = useRef(layout);
  const instancesRef = useRef(instances);
  const activeTabsRef = useRef(activeTabs);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { instancesRef.current = instances; }, [instances]);
  useEffect(() => { activeTabsRef.current = activeTabs; }, [activeTabs]);

  const takeSnap = (): Snap => structuredClone({
    layout: layoutRef.current,
    instances: instancesRef.current,
    activeTabs: activeTabsRef.current,
  });

  function pushHistory() {
    historyRef.current.past.push(takeSnap());
    if (historyRef.current.past.length > 50) historyRef.current.past.shift();
    historyRef.current.future = [];
    setHistVersion(v => v + 1);
  }

  function applySnap(snap: Snap) {
    setLayout(snap.layout);
    setInstances(snap.instances);
    setActiveTabs(snap.activeTabs);
  }

  function undo() {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push(takeSnap());
    applySnap(h.past.pop()!);
    setHistVersion(v => v + 1);
  }

  function redo() {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(takeSnap());
    applySnap(h.future.pop()!);
    setHistVersion(v => v + 1);
  }

  // Wipe the dashboard empty (undoable, like everything else in the session).
  function wipe() {
    pushHistory();
    setLayout([]);
    setInstances({});
    setActiveTabs({});
    setGroupingSource(null);
  }

  // Entering edit mode records the revert point and clears the session history.
  useEffect(() => {
    if (editing) {
      editStartRef.current = takeSnap();
      historyRef.current = { past: [], future: [] };
      setHistVersion(v => v + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    onRegisterEditControls?.({
      cancel: () => {
        if (editStartRef.current) applySnap(editStartRef.current);
        historyRef.current = { past: [], future: [] };
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterEditControls]);

  // Load persisted layout from DB after hydration. Only mark loaded (which
  // enables the persist effects below) once the reads SUCCEED: a failed read
  // must not let the in-memory default get written over real, momentarily
  // unreachable data (e.g. during a deploy restart). It retries on next mount.
  useEffect(() => {
    Promise.all([
      storage.getItemResult(LAYOUT_KEY),
      storage.getItemResult(INSTANCES_KEY),
    ]).then(([layoutR, instR]) => {
      if (!layoutR.ok || !instR.ok) return; // read failed: leave state alone, don't persist
      const savedLayout = layoutR.value;
      const savedInstances = instR.value;
      try {
        if (savedInstances) {
          const parsed: Record<string, Widget> = JSON.parse(savedInstances);
          const titleByType = Object.fromEntries(widgetDefs.map(w => [w.type, w.title]));
          const clean = Object.fromEntries(
            Object.entries(parsed)
              .filter(([, w]) => colorMap[w.color] !== undefined)
              .map(([k, w]) => [k, titleByType[w.type] ? { ...w, title: titleByType[w.type] } : w])
          );
          const validIds = new Set(Object.keys(clean));
          setInstances(clean);
          if (savedLayout) {
            const parsedLayout: TabLayoutItem[] = JSON.parse(savedLayout);
            setLayout(parsedLayout.filter((l) => validIds.has(l.i)));
          }
        } else if (savedLayout) {
          setLayout(JSON.parse(savedLayout));
        }
      } catch {}
      setLoaded(true);
    });
    // The keys derive from dashboardId, fixed for this grid's lifetime (each
    // dashboard mounts its own grid), so this runs once.
  }, [LAYOUT_KEY, INSTANCES_KEY]);

  const [droppingId, setDroppingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!layoutHydrated.current) { layoutHydrated.current = true; return; }
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout, loaded, LAYOUT_KEY]);

  useEffect(() => {
    if (!loaded) return;
    if (!instancesHydrated.current) { instancesHydrated.current = true; return; }
    storage.setItem(INSTANCES_KEY, JSON.stringify(instances));
  }, [instances, loaded, INSTANCES_KEY]);

  // Cancel grouping mode when edit mode is turned off
  useEffect(() => {
    if (!editing) setGroupingSource(null);
  }, [editing]);

  // react-grid-layout mounts each tile at the origin and transitions it into
  // place; suppress that one-time entrance animation, then re-enable transitions
  // so drag/resize still animate smoothly.
  useEffect(() => {
    if (!editing) { setGridReady(false); return; }
    const id = setTimeout(() => setGridReady(true), 250);
    return () => clearTimeout(id);
  }, [editing]);

  const isMobile = size.width > 0 && size.width < 600;

  // View-mode layout band: full 4-col grid that fits the viewport, a scrolling
  // 2-col reflow for narrow windows, and a stacked list on phones.
  const viewMode: "stack" | "two" | "full" =
    size.width === 0 ? "full" : size.width < 600 ? "stack" : size.width < 900 ? "two" : "full";

  // Whether the grid should fill the viewport height (no page scroll) vs.
  // grow with content and let the page scroll.
  const fillViewport = editing ? !isMobile : viewMode === "full";

  const numRows = Math.max(...layout.map(l => l.y + l.h), 1);
  const rowHeight = size.height > 0
    ? Math.floor((size.height - (numRows - 1) * GAP) / numRows)
    : 200;

  async function handleExport() {
    const res = await fetch("/api/settings/export");
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oldenbyte-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await fetch("/api/settings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      window.location.reload();
    } catch {}
  }

  function removeWidget(instanceId: string) {
    pushHistory();
    const item = layout.find(l => l.i === instanceId) as TabLayoutItem | undefined;
    const tabsToRemove = item?.tabs ?? [];
    setLayout(l => l.filter(li => li.i !== instanceId));
    setInstances(prev => {
      const next = { ...prev };
      delete next[instanceId];
      for (const tabId of tabsToRemove) delete next[tabId];
      return next;
    });
    setActiveTabs(prev => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  }

  // Starting size for a new or ungrouped instance: bank defs carry their own,
  // built-in types read it from the registry in lib/widgets.ts.
  function sizeFor(w: Widget | undefined): WidgetSize {
    if (w?.type === "custom") return (w.bankId ? bankDefs[w.bankId]?.defaultSize : undefined) ?? { w: 1, h: 3 };
    return defaultSizeFor(w?.type ?? "empty");
  }

  function findNextPosition(
    currentLayout: TabLayoutItem[],
    defaultW: number,
    defaultH: number,
  ): { x: number; y: number; w: number; h: number } {
    if (currentLayout.length === 0) return { x: 0, y: 0, w: defaultW, h: defaultH };

    const occupied = new Set<string>();
    for (const item of currentLayout) {
      for (let row = item.y; row < item.y + item.h; row++) {
        for (let col = item.x; col < item.x + item.w; col++) {
          occupied.add(`${col},${row}`);
        }
      }
    }

    const maxY = Math.max(...currentLayout.map(l => l.y + l.h));
    const capW = Math.min(defaultW, COLS);

    let best: { x: number; y: number; w: number; h: number; area: number } | null = null;

    for (let row = 0; row < maxY; row++) {
      for (let col = 0; col <= COLS - 1; col++) {
        if (occupied.has(`${col},${row}`)) continue;

        let availW = 0;
        while (col + availW < COLS && availW < capW && !occupied.has(`${col + availW},${row}`)) availW++;
        if (availW === 0) continue;

        let availH = 0;
        outer: while (availH < defaultH) {
          for (let dx = 0; dx < availW; dx++) {
            if (occupied.has(`${col + dx},${row + availH}`)) break outer;
          }
          availH++;
        }
        if (availH === 0) continue;

        const area = availW * availH;
        if (!best || area > best.area) {
          best = { x: col, y: row, w: availW, h: availH, area };
        }
        if (availW === capW && availH === defaultH) break;
      }
      if (best?.w === capW && best?.h === defaultH) break;
    }

    if (best) return { x: best.x, y: best.y, w: best.w, h: best.h };

    return { x: 0, y: maxY, w: defaultW, h: defaultH };
  }

  function addWidget(template: Widget, instanceId?: string) {
    pushHistory();
    const id = instanceId ?? `${template.id}-${Date.now()}`;
    const { w: dw, h: dh } = sizeFor(template);
    const { x, y, w, h } = findNextPosition(layout, dw, dh);

    const layoutIds = new Set(layout.map(l => l.i));
    // Bank widgets all share the "custom" type; siblings are same-def only.
    const sameType = Object.values(instances).filter(w =>
      (template.type === "custom" ? w.bankId === template.bankId : w.type === template.type) && layoutIds.has(w.id)
    );
    const title = sameType.length === 0
      ? template.title
      : `${template.title} ${sameType.length + 1}`;

    setInstances(prev => ({ ...prev, [id]: instanceOf(template, id, title) }));
    setLayout(l => [...l, {
      i: id, x, y, w, h,
      minW: 1, minH: 1, maxW: 4, maxH: 6,
    }]);
  }

  function handleGroupStart(id: string) {
    setGroupingSource(prev => prev === id ? null : id);
  }

  function handleGroupWith(targetId: string) {
    if (!groupingSource || groupingSource === targetId) {
      setGroupingSource(null);
      return;
    }
    const sourceId = groupingSource;
    pushHistory();
    setLayout(prev => {
      // If the source is itself a tab group, carry its tabs into the target
      // instead of dropping them (the source cell is removed below).
      const sourceTabs = prev.find(item => item.i === sourceId)?.tabs ?? [];
      return prev
        .filter(item => item.i !== sourceId)
        .map(item =>
          item.i === targetId
            ? { ...item, tabs: [...(item.tabs ?? []), sourceId, ...sourceTabs] }
            : item
        );
    });
    setActiveTabs(prev => {
      const next = { ...prev };
      delete next[sourceId]; // source is no longer a container
      next[targetId] = sourceId;
      return next;
    });
    setGroupingSource(null);
  }

  function handleUngroupTab(containerId: string, tabId: string) {
    pushHistory();
    setLayout(prev => {
      const updated = prev.map(item =>
        item.i === containerId
          ? { ...item, tabs: (item.tabs ?? []).filter(t => t !== tabId) }
          : item
      );
      const { w: dw, h: dh } = sizeFor(instances[tabId]);
      const pos = findNextPosition(updated, dw, dh);
      return [...updated, { i: tabId, x: pos.x, y: pos.y, w: pos.w, h: pos.h, minW: 1, minH: 1, maxW: 4, maxH: 6 }];
    });
    setActiveTabs(prev => {
      const next = { ...prev };
      if (next[containerId] === tabId) delete next[containerId];
      return next;
    });
  }

  function renderWithTabs(item: TabLayoutItem, isEditMode: boolean) {
    const hasTabs = (item.tabs?.length ?? 0) > 0;
    if (!hasTabs) {
      if (!instances[item.i]) return null;
      return slot(item.i);
    }
    const activeId = activeTabs[item.i] ?? item.i;
    const activeWidget = instances[activeId];
    const activeC = colorMap[activeWidget?.color ?? "neutral"];
    return (
      <div className={`flex flex-col h-full rounded-2xl overflow-hidden border ${activeC.border} ${activeC.bg} ${activeC.glow}`}>
        <div className={`shrink-0 flex gap-1 px-2 pt-1.5 pb-1 overflow-x-auto border-b ${activeC.border}`}>
          {[item.i, ...(item.tabs ?? [])].map(tabId => {
            const w = instances[tabId];
            const c = colorMap[w?.color ?? "neutral"];
            const isActive = tabId === activeId;
            return (
              <button
                key={tabId}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setActiveTabs(prev => ({ ...prev, [item.i]: tabId }))}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all border ${
                  isActive
                    ? `${c.bg} ${c.border} opacity-100`
                    : "bg-transparent border-transparent opacity-40 hover:opacity-70"
                }`}
              >
                <span className={`${c.label}`}>{w?.title ?? tabId}</span>
                {isEditMode && tabId !== item.i && (
                  <span
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); handleUngroupTab(item.i, tabId); }}
                    className="ml-0.5 leading-none text-neutral-400 hover:text-neutral-700"
                  >×</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-h-0 relative">
          {[item.i, ...(item.tabs ?? [])].map(tabId => {
            const w = instances[tabId];
            if (!w) return null;
            return (
              <div key={tabId} className="absolute inset-0" style={{ display: tabId === activeId ? "block" : "none" }}>
                {slot(tabId)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Every widget placed on the dashboard (cells and their tabs), with the
  // classes it renders with. Tab members drop their own card chrome because the
  // tab container draws it. This list, not the layout variant, decides what is
  // mounted, so a widget only unmounts when it leaves the dashboard.
  const mounted: { id: string; extraClass: string }[] = [];
  if (loaded) {
    const seen = new Set<string>();
    for (const item of layout) {
      const tabbed = (item.tabs?.length ?? 0) > 0;
      for (const id of [item.i, ...(item.tabs ?? [])]) {
        if (seen.has(id) || !instances[id]) continue;
        seen.add(id);
        mounted.push({ id, extraClass: tabbed ? "!rounded-none !border-0 !shadow-none" : "" });
      }
    }
  }
  const mountedKey = mounted.map(m => m.id).join("|");

  // Drop the DOM nodes of widgets that left the dashboard (their portals have
  // unmounted by now). Undoing a removal mounts the widget fresh.
  useEffect(() => {
    const keep = new Set(mountedKey ? mountedKey.split("|") : []);
    for (const [id, node] of nodesRef.current) {
      if (keep.has(id)) continue;
      node.remove();
      nodesRef.current.delete(id);
    }
  }, [mountedKey]);

  return (
    <WidgetActiveContext.Provider value={active && pageVisible}>
    {/* Fixed shelf: outside the flex column so it never shifts children indices */}
    {editing && (
      <WidgetShelf
        templates={widgets}
        bankTemplates={bankTemplates}
        onAdd={addWidget}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyRef.current.past.length > 0 && histVersion >= 0}
        canRedo={historyRef.current.future.length > 0}
        onWipe={wipe}
        onTemplateDragStart={template => {
          const id = `${template.id}-${Date.now()}`;
          setInstances(prev => ({ ...prev, [id]: instanceOf(template, id) }));
          setDroppingId(id);
        }}
        onTemplateDragEnd={() => setDroppingId(null)}
        onExport={handleExport}
        onImportFile={handleImport}
        backupDisabled={isDemoMode()}
      />
    )}

    <div className={`flex flex-col gap-2 ${fillViewport ? "flex-1 min-h-0" : ""}`}>

      {/* Grid */}
      <div ref={containerRef} className={`relative ${fillViewport ? "flex-1 min-h-0" : ""} ${editing && !gridReady ? "[&_.react-grid-item]:!transition-none" : ""}`}>
        {editing && size.width > 0 && (
          <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${isMobile ? 1 : COLS}, 1fr)`,
              gridTemplateRows: `repeat(${numRows}, ${rowHeight}px)`,
              gap: GAP,
            }}
          >
            {Array.from({ length: (isMobile ? 1 : COLS) * numRows }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-dashed border-neutral-900/10" />
            ))}
          </div>
        )}
        {!loaded ? null : editing ? (
          size.width > 0 && (
            <GridLayout
              layout={layout}
              cols={isMobile ? 1 : COLS}
              rowHeight={rowHeight}
              width={size.width}
              margin={[GAP, GAP]}
              containerPadding={[0, 0]}
              onLayoutChange={(newLayout) => {
                setLayout(prev => {
                  const tabsMap: Record<string, string[]> = {};
                  for (const item of prev) {
                    if (item.tabs?.length) tabsMap[item.i] = item.tabs;
                  }
                  return newLayout.map(l => ({
                    ...l,
                    ...(tabsMap[l.i] ? { tabs: tabsMap[l.i] } : {}),
                  }));
                });
              }}
              isDraggable
              isResizable
              isDroppable
              onDragStart={() => pushHistory()}
              onResizeStart={() => pushHistory()}
              droppingItem={droppingId ? { i: droppingId, w: 1, h: 1 } : undefined}
              onDrop={(newLayout) => {
                if (!droppingId) return;
                pushHistory();
                setLayout(newLayout.map(l =>
                  l.i === droppingId
                    ? { ...l, minW: 1, minH: 1, maxW: 4, maxH: 6 }
                    : l
                ));
                setDroppingId(null);
              }}
              resizeHandles={["se"]}
              compactType="vertical"
            >
              {layout.map((item) => {
                const { i } = item;
                const widget = instances[i];
                if (!widget) return <div key={i} />;
                const isGroupingSource = groupingSource === i;
                const isGroupingTarget = groupingSource !== null && groupingSource !== i;
                return (
                  <div key={i} className="relative rounded-2xl overflow-hidden flex flex-col h-full">
                    {(item.tabs?.length ?? 0) > 0 && (
                      <div
                        className="shrink-0 relative z-20"
                        onMouseDown={e => e.stopPropagation()}
                      >
                        {(() => {
                          const activeId = activeTabs[item.i] ?? item.i;
                          const activeWidget = instances[activeId];
                          const activeC = colorMap[activeWidget?.color ?? "neutral"];
                          return (
                            <div className={`flex gap-1 px-2 pt-1.5 pb-1 overflow-x-auto ${activeC.bg} border-b ${activeC.border}`}>
                              {[item.i, ...(item.tabs ?? [])].map(tabId => {
                                const w = instances[tabId];
                                const c = colorMap[w?.color ?? "neutral"];
                                const isActive = tabId === activeId;
                                return (
                                  <button
                                    key={tabId}
                                    onMouseDown={e => e.stopPropagation()}
                                    onClick={() => setActiveTabs(prev => ({ ...prev, [item.i]: tabId }))}
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all border ${
                                      isActive
                                        ? `${c.bg} ${c.border} opacity-100`
                                        : "bg-transparent border-transparent opacity-40 hover:opacity-70"
                                    }`}
                                  >
                                    <span className={`${c.label}`}>{w?.title ?? tabId}</span>
                                    {tabId !== item.i && (
                                      <span
                                        onMouseDown={e => e.stopPropagation()}
                                        onClick={e => { e.stopPropagation(); handleUngroupTab(item.i, tabId); }}
                                        className="ml-0.5 leading-none text-neutral-400 hover:text-neutral-700"
                                      >×</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <div className="pointer-events-none flex-1 min-h-0 relative">
                      {(() => {
                        const activeId = activeTabs[item.i] ?? item.i;
                        const hasTabs = (item.tabs?.length ?? 0) > 0;
                        if (!hasTabs) return instances[item.i] ? slot(item.i) : null;
                        return [item.i, ...(item.tabs ?? [])].map(tabId => {
                          const w = instances[tabId];
                          if (!w) return null;
                          return (
                            <div key={tabId} className="absolute inset-0" style={{ display: tabId === activeId ? "block" : "none" }}>
                              {slot(tabId)}
                            </div>
                          );
                        });
                      })()}
                    </div>
                    {/* Border overlay, highlighted when this is the grouping source */}
                    <div className={`absolute inset-0 z-10 rounded-2xl border-2 cursor-grab transition-colors ${
                      isGroupingSource
                        ? "border-blue-400 bg-blue-400/10"
                        : "border-dashed border-neutral-300"
                    }`} />
                    {/* Grouping target overlay */}
                    {isGroupingTarget && (
                      <div
                        onMouseDown={e => e.stopPropagation()}
                        onClick={() => handleGroupWith(i)}
                        className="absolute inset-0 z-20 rounded-2xl bg-black/15 flex items-center justify-center cursor-pointer hover:bg-black/25 transition-colors"
                      >
                        <div className="bg-white rounded-xl px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm flex items-center gap-1.5 pointer-events-none">
                          <Layers size={11} />
                          Add as tab
                        </div>
                      </div>
                    )}
                    {/* Layers (group) button */}
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => handleGroupStart(i)}
                      aria-label={isGroupingSource ? "Cancel grouping" : "Group with another widget as tabs"}
                      aria-pressed={isGroupingSource}
                      title={isGroupingSource ? "Cancel grouping" : "Group as tabs"}
                      className={`absolute top-2 right-8 z-20 w-5 h-5 flex items-center justify-center rounded-full border shadow-sm transition-colors ${
                        isGroupingSource
                          ? "bg-blue-100 border-blue-300 text-blue-600"
                          : "bg-white border-neutral-200 text-neutral-400 hover:text-neutral-600"
                      }`}
                    >
                      <Layers size={10} />
                    </button>
                    {/* Remove button */}
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => removeWidget(i)}
                      aria-label={`Remove ${widget.title}`}
                      title="Remove widget"
                      className="absolute top-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-neutral-200 text-neutral-400 hover:text-neutral-600 text-sm leading-none shadow-sm"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </GridLayout>
          )
        ) : viewMode === "stack" ? (
          <div className="flex flex-col gap-4 pb-4">
            {[...layout]
              .sort((a, b) => a.y === b.y ? a.x - b.x : a.y - b.y)
              .map((item) => {
                const widget = instances[item.i];
                if (!widget) return null;
                return (
                  <div key={item.i} className="h-80 shrink-0">
                    {renderWithTabs(item, false)}
                  </div>
                );
              })}
          </div>
        ) : viewMode === "two" ? (
          <div
            className="grid gap-4 pb-4"
            style={{
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gridAutoRows: "120px",
              gridAutoFlow: "row dense",
            }}
          >
            {[...layout]
              .sort((a, b) => a.y === b.y ? a.x - b.x : a.y - b.y)
              .map((item) => {
                const widget = instances[item.i];
                if (!widget) return null;
                return (
                  <div
                    key={item.i}
                    className="min-h-0 min-w-0"
                    style={{
                      gridColumn: `span ${Math.min(item.w, 2)}`,
                      gridRow: `span ${item.h}`,
                    }}
                  >
                    {renderWithTabs(item, false)}
                  </div>
                );
              })}
          </div>
        ) : (
          <div
            className="h-full grid gap-4"
            style={{
              // minmax(0, 1fr) keeps every track the same width even when a
              // widget's content is intrinsically wide; paired with min-w-0 on
              // cells so no widget can stop shrinking and squeeze the others.
              gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${numRows}, minmax(0, 1fr))`,
            }}
          >
            {layout.map((item) => {
              const widget = instances[item.i];
              if (!widget) return null;
              return (
                <div
                  key={item.i}
                  className="min-h-0 min-w-0"
                  style={{
                    gridColumn: `${item.x + 1} / span ${item.w}`,
                    gridRow: `${item.y + 1} / span ${item.h}`,
                  }}
                >
                  {renderWithTabs(item, false)}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>

    {/* Stable portal host: rendered after the layouts so their slots adopt the
        nodes before widget layout effects run. Also parks nodes between
        slots. Never moves in the tree, so widgets never remount. */}
    <div ref={parkingRef} aria-hidden className="fixed w-0 h-0 overflow-hidden invisible pointer-events-none">
      {mounted.map(({ id, extraClass }) => createPortal(renderWidget(instances[id], extraClass, bankDefs), getNode(id), id))}
    </div>
    </WidgetActiveContext.Provider>
  );
}
