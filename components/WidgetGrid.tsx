"use client";

import { useState, useRef, useEffect } from "react";
import * as storage from "@/lib/storage";
import { RotateCcw } from "lucide-react";
import GridLayout from "react-grid-layout";
import type { Layout as LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/lib/widgets";
import { colorMap } from "@/lib/widgets";
import WidgetCard from "./WidgetCard";
import NotebookWidget from "./NotebookWidget";
import TextWidget from "./TextWidget";
import RssWidget from "./RssWidget";
import dynamic from "next/dynamic";
const ReaderWidget = dynamic(() => import("./ReaderWidget"), { ssr: false });

const COLS = 2;
const GAP = 16;

const initialLayout: LayoutItem[] = [
  { i: "notebook", x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 1, maxW: 2, maxH: 6 },
  { i: "ebook",    x: 1, y: 0, w: 1, h: 2, minW: 1, minH: 1, maxW: 2, maxH: 6 },
  { i: "text",     x: 0, y: 2, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 6 },
  { i: "rss",      x: 1, y: 2, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 6 },
];

function renderWidget(widget: Widget) {
  if (widget.type === "notebook") return <NotebookWidget widget={widget} className="h-full" />;
  if (widget.type === "text")     return <TextWidget     widget={widget} className="h-full" />;
  if (widget.type === "rss")      return <RssWidget      widget={widget} className="h-full" />;
  if (widget.type === "ebook")    return <ReaderWidget   widget={widget} className="h-full" />;
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

  const [layout, setLayout] = useState<LayoutItem[]>(initialLayout);
  const [instances, setInstances] = useState<Record<string, Widget>>(
    () => Object.fromEntries(widgets.map(w => [w.id, w]))
  );

  // Load persisted layout from DB after hydration
  useEffect(() => {
    Promise.all([
      storage.getItem("widget-layout"),
      storage.getItem("widget-instances"),
    ]).then(([savedLayout, savedInstances]) => {
      try {
        if (savedInstances) {
          const parsed: Record<string, Widget> = JSON.parse(savedInstances);
          const clean = Object.fromEntries(
            Object.entries(parsed).filter(([, w]) => colorMap[w.color] !== undefined)
          );
          const validIds = new Set(Object.keys(clean));
          setInstances(clean);
          if (savedLayout) {
            const parsedLayout = JSON.parse(savedLayout);
            setLayout(parsedLayout.filter((l: LayoutItem) => validIds.has(l.i)));
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

  const numRows = Math.max(...layout.map(l => l.y + l.h), 1);
  const rowHeight = size.height > 0
    ? Math.floor((size.height - (numRows - 1) * GAP) / numRows)
    : 200;

  function reset() {
    setLayout(initialLayout);
    setInstances(Object.fromEntries(widgets.map(w => [w.id, w])));
    storage.removeItem("widget-layout");
    storage.removeItem("widget-instances");
  }

  function removeWidget(instanceId: string) {
    setLayout(l => l.filter(item => item.i !== instanceId));
    setInstances(prev => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  }

  function findNextPosition(currentLayout: LayoutItem[]): { x: number; y: number } {
    if (currentLayout.length === 0) return { x: 0, y: 0 };

    // Build a set of occupied cells
    const occupied = new Set<string>();
    for (const item of currentLayout) {
      for (let row = item.y; row < item.y + item.h; row++) {
        for (let col = item.x; col < item.x + item.w; col++) {
          occupied.add(`${col},${row}`);
        }
      }
    }

    // Scan left-to-right, top-to-bottom for the first empty 1×1 cell
    const maxY = Math.max(...currentLayout.map(l => l.y + l.h));
    for (let row = 0; row <= maxY; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!occupied.has(`${col},${row}`)) {
          return { x: col, y: row };
        }
      }
    }

    // Grid is fully packed — append a new row
    return { x: 0, y: maxY };
  }

  function addWidget(template: Widget, instanceId?: string) {
    const id = instanceId ?? `${template.id}-${Date.now()}`;
    const { x, y } = findNextPosition(layout);

    // Number the title if instances of this type already exist
    const sameType = Object.values(instances).filter(w => w.type === template.type);
    const title = sameType.length === 0
      ? template.title
      : `${template.title} ${sameType.length + 1}`;

    setInstances(prev => ({ ...prev, [id]: { ...template, id, title } }));
    setLayout(l => [...l, {
      i: id, x, y, w: 1, h: 1,
      minW: 1, minH: 1, maxW: 2, maxH: 6,
    }]);
  }

  return (
    <>
    {/* Fixed shelf — outside the flex column so it never shifts children indices */}
    {editing && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-white/95 backdrop-blur-sm border border-neutral-200 rounded-2xl shadow-lg px-3 py-2.5">
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
          onClick={reset}
          className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          title="Reset layout"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    )}

    <div className="flex flex-col flex-1 min-h-0 gap-2">

      {/* Grid */}
      <div ref={containerRef} className="flex-1 min-h-0">
        {editing ? (
          size.width > 0 && (
            <GridLayout
              layout={layout}
              cols={COLS}
              rowHeight={rowHeight}
              width={size.width}
              margin={[GAP, GAP]}
              containerPadding={[0, 0]}
              onLayoutChange={(l) => setLayout([...l])}
              isDraggable
              isResizable
              isDroppable
              droppingItem={droppingId ? { i: droppingId, w: 1, h: 1 } : undefined}
              onDrop={(newLayout) => {
                if (!droppingId) return;
                setLayout(newLayout.map(l =>
                  l.i === droppingId
                    ? { ...l, minW: 1, minH: 1, maxW: 2, maxH: 6 }
                    : l
                ));
                setDroppingId(null);
              }}
              resizeHandles={["se"]}
              compactType="vertical"
            >
              {layout.map(({ i }) => {
                const widget = instances[i];
                if (!widget) return <div key={i} />;
                return (
                  <div key={i} className="relative rounded-2xl">
                    <div className="pointer-events-none h-full">
                      {renderWidget(widget)}
                    </div>
                    <div className="absolute inset-0 z-10 rounded-2xl border-2 border-dashed border-neutral-300 cursor-grab" />
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
                  className="min-h-0 overflow-hidden"
                  style={{
                    gridColumn: `${item.x + 1} / span ${item.w}`,
                    gridRow: `${item.y + 1} / span ${item.h}`,
                  }}
                >
                  {renderWidget(widget)}
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
