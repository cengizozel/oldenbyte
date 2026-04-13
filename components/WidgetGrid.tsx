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

  // Fill container height: distribute evenly across rows
  const numRows = Math.max(...layout.map(l => l.y + l.h));
  const rowHeight = size.height > 0
    ? Math.floor((size.height - (numRows - 1) * GAP) / numRows)
    : 200;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">

      {/* Edit toggle — sits above the grid in its own row */}
      <div className="flex justify-end">
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-neutral-400 hover:text-neutral-600"
        >
          {editing ? "done" : "edit"}
        </button>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0">
      {editing ? (
        /* Edit mode — drag + resize */
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
            resizeHandles={["se"]}
            compactType="vertical"
          >
            {layout.map(({ i }) => {
              const widget = widgetById[i];
              if (!widget) return <div key={i} />;
              return (
                <div key={i} className="relative rounded-2xl overflow-hidden">
                  {/* Overlay: blocks widget interaction, shows drag cursor */}
                  <div className="absolute inset-0 z-10 rounded-2xl border-2 border-dashed border-neutral-300 cursor-grab" />
                  {renderWidget(widget)}
                </div>
              );
            })}
          </GridLayout>
        )
      ) : (
        /* View mode — static CSS grid reflecting saved layout */
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
