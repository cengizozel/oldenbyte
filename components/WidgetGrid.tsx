"use client";

import { useState, useRef, useEffect } from "react";
import * as storage from "@/lib/storage";
import { RotateCcw, GripVertical, Download, Upload, Layers } from "lucide-react";
import GridLayout from "react-grid-layout";
import type { Layout as LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/lib/widgets";
import { colorMap, widgets as widgetDefs } from "@/lib/widgets";
import WidgetCard from "./WidgetCard";
import NotebookWidget from "./NotepadWidget";
import TextWidget from "./TextWidget";
import RssWidget from "./RssWidget";
import RedditWidget from "./RedditWidget";
import YoutubeWidget from "./YoutubeWidget";
import F1Widget from "./F1Widget";
import ArxivWidget from "./ArxivWidget";
import HuggingFaceWidget from "./HuggingFaceWidget";
import dynamic from "next/dynamic";
const ReaderWidget = dynamic(() => import("./ReaderWidget"), { ssr: false });

const COLS = 4;
const GAP = 16;

type TabLayoutItem = LayoutItem & { tabs?: string[] };

const initialLayout: TabLayoutItem[] = [
  { i: "notebook",            x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "arxiv-default",       x: 1, y: 0, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6, tabs: ["hf-default"] },
  { i: "ebook",               x: 2, y: 0, w: 2, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "rss",                 x: 0, y: 3, w: 1, h: 5, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "f1-default",          x: 1, y: 4, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "reddit",              x: 2, y: 4, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
  { i: "youtube",             x: 3, y: 4, w: 1, h: 4, minW: 1, minH: 1, maxW: 4, maxH: 6 },
];

const initialInstances: Record<string, Widget> = {
  "notebook":      { id: "notebook",      type: "notebook", color: "amber",  title: "Notepad",  description: "A simple place for temporary notes." },
  "ebook":         { id: "ebook",         type: "ebook",    color: "sky",    title: "Reader",   description: "Read a PDF or EPUB file." },
  "rss":           { id: "rss",           type: "rss",      color: "teal",   title: "Feed",     description: "Headlines from any RSS feed." },
  "reddit":        { id: "reddit",        type: "reddit",   color: "orange", title: "Reddit",   description: "Top posts from your chosen subreddits." },
  "youtube":       { id: "youtube",       type: "youtube",  color: "rose",   title: "YouTube",  description: "Latest videos from your chosen channels." },
  "f1-default":    { id: "f1-default",    type: "f1",       color: "rose",   title: "F1",       description: "Next race and driver standings." },
  "arxiv-default": { id: "arxiv-default", type: "arxiv",    color: "sky",    title: "arXiv",    description: "Latest papers from a chosen research field." },
  "hf-default":    { id: "hf-default",    type: "hf",       color: "orange", title: "HF Daily", description: "Trending AI papers curated by Hugging Face." },
};

function renderWidget(widget: Widget) {
  if (widget.type === "notebook") return <NotebookWidget widget={widget} className="h-full" />;
  if (widget.type === "text")     return <TextWidget     widget={widget} className="h-full" />;
  if (widget.type === "rss")      return <RssWidget      widget={widget} className="h-full" />;
  if (widget.type === "reddit")   return <RedditWidget   widget={widget} className="h-full" />;
  if (widget.type === "youtube")  return <YoutubeWidget  widget={widget} className="h-full" />;
  if (widget.type === "ebook")    return <ReaderWidget   widget={widget} className="h-full" />;
  if (widget.type === "f1")       return <F1Widget       widget={widget} className="h-full" />;
  if (widget.type === "arxiv")    return <ArxivWidget    widget={widget} className="h-full" />;
  if (widget.type === "hf")       return <HuggingFaceWidget widget={widget} className="h-full" />;
  return <WidgetCard widget={widget} className="h-full" />;
}

export default function WidgetGrid({
  widgets,
  editing = false,
  onToggleEdit,
}: {
  widgets: Widget[];
  editing?: boolean;
  onToggleEdit?: () => void;
}) {

  const [layout, setLayout] = useState<TabLayoutItem[]>(initialLayout);
  const [instances, setInstances] = useState<Record<string, Widget>>(initialInstances);
  const [groupingSource, setGroupingSource] = useState<string | null>(null);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});

  // Load persisted layout from DB after hydration
  useEffect(() => {
    Promise.all([
      storage.getItem("widget-layout"),
      storage.getItem("widget-instances"),
    ]).then(([savedLayout, savedInstances]) => {
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
    });
  }, []);

  const [droppingId, setDroppingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Draggable shelf
  const shelfRef = useRef<HTMLDivElement>(null);
  const [shelfPos, setShelfPos] = useState<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current || !shelfRef.current) return;
      setShelfPos({
        x: Math.max(0, Math.min(window.innerWidth  - shelfRef.current.offsetWidth,  e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - shelfRef.current.offsetHeight, e.clientY - dragOffset.current.y)),
      });
    }
    function onTouchMove(e: TouchEvent) {
      if (!isDragging.current || !shelfRef.current) return;
      const t = e.touches[0];
      setShelfPos({
        x: Math.max(0, Math.min(window.innerWidth  - shelfRef.current.offsetWidth,  t.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - shelfRef.current.offsetHeight, t.clientY - dragOffset.current.y)),
      });
      e.preventDefault();
    }
    function onUp() { isDragging.current = false; }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onUp);
    };
  }, []);

  function startShelfDrag(clientX: number, clientY: number, currentTarget: HTMLDivElement) {
    const rect = currentTarget.getBoundingClientRect();
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
    if (shelfPos === null) setShelfPos({ x: rect.left, y: rect.top });
    isDragging.current = true;
  }

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
    storage.setItem("widget-layout", JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    storage.setItem("widget-instances", JSON.stringify(instances));
  }, [instances]);

  // Cancel grouping mode when edit mode is turned off
  useEffect(() => {
    if (!editing) setGroupingSource(null);
  }, [editing]);

  const isMobile = size.width > 0 && size.width < 600;

  const numRows = Math.max(...layout.map(l => l.y + l.h), 1);
  const rowHeight = size.height > 0
    ? Math.floor((size.height - (numRows - 1) * GAP) / numRows)
    : 200;

  function reset() {
    setLayout(initialLayout);
    setInstances(initialInstances);
    setActiveTabs({});
    setGroupingSource(null);
    storage.removeItem("widget-layout");
    storage.removeItem("widget-instances");
  }

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

  const importRef = useRef<HTMLInputElement>(null);
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    e.target.value = "";
  }

  function removeWidget(instanceId: string) {
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

  const DEFAULT_SIZE: Partial<Record<string, { w: number; h: number }>> = {
    notebook: { w: 2, h: 2 },
    ebook:    { w: 2, h: 3 },
    text:     { w: 2, h: 1 },
    rss:      { w: 2, h: 3 },
    reddit:   { w: 1, h: 3 },
    youtube:  { w: 1, h: 3 },
    f1:       { w: 1, h: 2 },
    arxiv:    { w: 2, h: 3 },
    hf:       { w: 2, h: 3 },
  };

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
    const id = instanceId ?? `${template.id}-${Date.now()}`;
    const { w: dw, h: dh } = DEFAULT_SIZE[template.type] ?? { w: 2, h: 2 };
    const { x, y, w, h } = findNextPosition(layout, dw, dh);

    const layoutIds = new Set(layout.map(l => l.i));
    const sameType = Object.values(instances).filter(w => w.type === template.type && layoutIds.has(w.id));
    const title = sameType.length === 0
      ? template.title
      : `${template.title} ${sameType.length + 1}`;

    setInstances(prev => ({ ...prev, [id]: { ...template, id, title } }));
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
    setLayout(prev =>
      prev
        .filter(item => item.i !== sourceId)
        .map(item =>
          item.i === targetId
            ? { ...item, tabs: [...(item.tabs ?? []), sourceId] }
            : item
        )
    );
    setActiveTabs(prev => ({ ...prev, [targetId]: sourceId }));
    setGroupingSource(null);
  }

  function handleUngroupTab(containerId: string, tabId: string) {
    setLayout(prev => {
      const updated = prev.map(item =>
        item.i === containerId
          ? { ...item, tabs: (item.tabs ?? []).filter(t => t !== tabId) }
          : item
      );
      const widget = instances[tabId];
      const { w: dw, h: dh } = DEFAULT_SIZE[widget?.type ?? ""] ?? { w: 2, h: 2 };
      const pos = findNextPosition(updated, dw, dh);
      return [...updated, { i: tabId, x: pos.x, y: pos.y, w: pos.w, h: pos.h, minW: 1, minH: 1, maxW: 4, maxH: 6 }];
    });
    setActiveTabs(prev => {
      const next = { ...prev };
      if (next[containerId] === tabId) delete next[containerId];
      return next;
    });
  }

  function renderTabBar(item: TabLayoutItem, isEditMode: boolean) {
    const allTabIds = [item.i, ...(item.tabs ?? [])];
    const activeId = activeTabs[item.i] ?? item.i;
    return (
      <div className="flex gap-1 px-2 pt-1.5 pb-1 shrink-0 overflow-x-auto">
        {allTabIds.map(tabId => {
          const w = instances[tabId];
          const c = colorMap[w?.color ?? "neutral"];
          const isActive = tabId === activeId;
          return (
            <button
              key={tabId}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setActiveTabs(prev => ({ ...prev, [item.i]: tabId }))}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-all border ${
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
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  function renderWithTabs(item: TabLayoutItem, isEditMode: boolean) {
    const hasTabs = (item.tabs?.length ?? 0) > 0;
    if (!hasTabs) {
      const widget = instances[item.i];
      if (!widget) return null;
      return renderWidget(widget);
    }
    const activeId = activeTabs[item.i] ?? item.i;
    const activeWidget = instances[activeId];
    return (
      <div className="flex flex-col h-full">
        {renderTabBar(item, isEditMode)}
        <div className="flex-1 min-h-0">
          {activeWidget && renderWidget(activeWidget)}
        </div>
      </div>
    );
  }

  return (
    <>
    {/* Fixed shelf — outside the flex column so it never shifts children indices */}
    {editing && (
      <div
        ref={shelfRef}
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest("button,[draggable]")) return;
          e.preventDefault();
          startShelfDrag(e.clientX, e.clientY, e.currentTarget);
        }}
        onTouchStart={e => {
          if ((e.target as HTMLElement).closest("button,[draggable]")) return;
          startShelfDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget);
        }}
        className={`fixed z-50 flex items-center gap-2 bg-[var(--shelf-bg)] backdrop-blur-sm border border-[var(--surface-border)] rounded-2xl shadow-lg px-3 py-2.5 select-none cursor-grab active:cursor-grabbing ${shelfPos === null ? "bottom-6 left-1/2 -translate-x-1/2" : ""}`}
        style={shelfPos !== null ? { left: shelfPos.x, top: shelfPos.y } : undefined}
      >
        <GripVertical size={14} className="text-neutral-300 shrink-0 cursor-grab" />
        <div className="w-px h-4 bg-neutral-200 mx-0.5" />
        {widgets.map(template => {
          const c = colorMap[template.color];
          return (
            <div
              key={template.id}
              draggable
              onDragStart={() => {
                const id = `${template.id}-${Date.now()}`;
                setInstances(prev => ({ ...prev, [id]: { ...template, id } }));
                setDroppingId(id);
              }}
              onDragEnd={() => setDroppingId(null)}
              onClick={() => addWidget(template)}
              className={`flex flex-col gap-0.5 px-3 py-2 rounded-xl border cursor-grab select-none ${c.bg} ${c.border}`}
            >
              <span className={`text-xs font-semibold ${c.label}`}>{template.title}</span>
            </div>
          );
        })}
        <div className="w-px h-4 bg-neutral-200 mx-1" />
        <button
          onClick={handleExport}
          className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          title="Export backup"
        >
          <Download size={13} />
        </button>
        <button
          onClick={() => importRef.current?.click()}
          className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          title="Import backup"
        >
          <Upload size={13} />
        </button>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        <div className="w-px h-4 bg-neutral-200 mx-1" />
        <button
          onClick={reset}
          className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          title="Reset layout"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    )}

    <div className={`flex flex-col gap-2 ${isMobile ? "" : "flex-1 min-h-0"}`}>

      {/* Grid */}
      <div ref={containerRef} className={`relative ${isMobile ? "" : "flex-1 min-h-0"}`}>
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
        {editing ? (
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
              droppingItem={droppingId ? { i: droppingId, w: 1, h: 1 } : undefined}
              onDrop={(newLayout) => {
                if (!droppingId) return;
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
                  <div key={i} className="relative rounded-2xl flex flex-col h-full">
                    {(item.tabs?.length ?? 0) > 0 && (
                      <div
                        className="shrink-0 relative z-20"
                        onMouseDown={e => e.stopPropagation()}
                      >
                        {renderTabBar(item, true)}
                      </div>
                    )}
                    <div className="pointer-events-none flex-1 min-h-0">
                      {(() => {
                        const activeId = activeTabs[item.i] ?? item.i;
                        const activeWidget = instances[activeId];
                        return activeWidget ? renderWidget(activeWidget) : null;
                      })()}
                    </div>
                    {/* Border overlay — highlighted when this is the grouping source */}
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
                      className="absolute top-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-neutral-200 text-neutral-400 hover:text-neutral-600 text-sm leading-none shadow-sm"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </GridLayout>
          )
        ) : isMobile ? (
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
        ) : (
          <div
            className="h-full grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gridTemplateRows: `repeat(${numRows}, 1fr)`,
            }}
          >
            {layout.map((item) => {
              const widget = instances[item.i];
              if (!widget) return null;
              return (
                <div
                  key={item.i}
                  className="min-h-0"
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
    </>
  );
}
