"use client";

import { useState, useRef, useEffect } from "react";
import GridLayout from "react-grid-layout";
import type { Layout as LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/lib/widgets";
import WidgetCard from "./WidgetCard";
import NotebookWidget from "./NotebookWidget";

const COLS = 2;
const GAP = 16;

const initialLayout: LayoutItem[] = [
  { i: "notebook", x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 1, maxW: 2, maxH: 3 },
  { i: "ebook",    x: 1, y: 0, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 3 },
  { i: "one-item", x: 1, y: 1, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 3 },
  { i: "empty-1",  x: 0, y: 2, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 3 },
  { i: "empty-2",  x: 1, y: 2, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 3 },
];

function renderWidget(widget: Widget) {
  if (widget.type === "notebook") {
    return <NotebookWidget widget={widget} className="h-full" />;
  }
  return <WidgetCard widget={widget} className="h-full" />;
}

export default function WidgetGrid({ widgets }: { widgets: Widget[] }) {
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<LayoutItem[]>(initialLayout);
  const [activeIds, setActiveIds] = useState<string[]>(() => initialLayout.map(l => l.i));
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

  const widgetById = Object.fromEntries(widgets.map(w => [w.id, w]));
  const inactiveWidgets = widgets.filter(w => !activeIds.includes(w.id));

  const numRows = Math.max(...layout.map(l => l.y + l.h), 1);
  const rowHeight = size.height > 0
    ? Math.floor((size.height - (numRows - 1) * GAP) / numRows)
    : 200;

  function removeWidget(id: string) {
    setActiveIds(ids => ids.filter(i => i !== id));
    setLayout(l => l.filter(item => item.i !== id));
  }

  function addWidget(widget: Widget) {
    const maxY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    setActiveIds(ids => [...ids, widget.id]);
    setLayout(l => [...l, {
      i: widget.id,
      x: 0, y: maxY,
      w: 1, h: 1,
      minW: 1, minH: 1, maxW: 2, maxH: 3,
    }]);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">

      {/* Edit toggle */}
      <div className="flex justify-end">
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-neutral-400 hover:text-neutral-600"
        >
          {editing ? "done" : "edit"}
        </button>
      </div>

      {/* Widget shelf — visible in edit mode, shows widgets not on the grid */}
      {editing && (
        <div className="border border-neutral-200 rounded-2xl bg-white p-3">
          <p className="text-xs text-neutral-400 tracking-widest uppercase mb-2.5">Add widgets</p>
          {inactiveWidgets.length === 0 ? (
            <p className="text-xs text-neutral-300 italic">All widgets are on the grid.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {inactiveWidgets.map(widget => (
                <div
                  key={widget.id}
                  draggable
                  onDragStart={() => setDroppingId(widget.id)}
                  onDragEnd={() => setDroppingId(null)}
                  onClick={() => addWidget(widget)}
                  className="flex flex-col gap-0.5 px-3 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 hover:bg-white hover:border-neutral-300 cursor-grab w-32 select-none"
                >
                  <span className="text-xs font-medium text-neutral-500">{widget.title}</span>
                  <span className="text-xs text-neutral-300 truncate">{widget.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
              onDrop={(newLayout, item) => {
                if (!droppingId) return;
                setActiveIds(ids => [...ids, droppingId]);
                setLayout(newLayout.map(l =>
                  l.i === droppingId
                    ? { ...l, minW: 1, minH: 1, maxW: 2, maxH: 3 }
                    : l
                ));
                setDroppingId(null);
              }}
              resizeHandles={["se"]}
              compactType="vertical"
            >
              {layout.map(({ i }) => {
                const widget = widgetById[i];
                if (!widget) return <div key={i} />;
                return (
                  <div key={i} className="relative rounded-2xl overflow-hidden">
                    <div className="absolute inset-0 z-10 rounded-2xl border-2 border-dashed border-neutral-300 cursor-grab" />
                    {/* Remove button — stops mousedown so drag doesn't swallow the click */}
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => removeWidget(i)}
                      className="absolute top-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-neutral-200 text-neutral-400 hover:text-neutral-600 text-sm leading-none shadow-sm"
                    >
                      ×
                    </button>
                    {renderWidget(widget)}
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
              const widget = widgetById[item.i];
              if (!widget) return null;
              return (
                <div
                  key={item.i}
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
  );
}
