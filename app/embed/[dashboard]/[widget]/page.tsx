"use client";

import { use, useEffect, useState } from "react";
import * as storage from "@/lib/storage";
import { instancesKey } from "@/lib/dashboards";
import type { Widget } from "@/lib/widgets";
import type { BankWidgetDef } from "@/lib/widgetBank";
import { renderWidget } from "@/components/widgetRegistry";

// One widget on its own, filling the window: no top bar, no grid, no other
// widgets. For an app's in-app web view (docs/api-v1.md): the app draws its
// own navigation and shows a widget it has not rebuilt natively through this
// page. /embed/<dashboard id>/<widget id>, signed in like any other page.
//
// It is the same component the grid renders, reading and saving the same
// settings, so what you do here shows on the dashboard and the other way
// round.
export default function EmbedPage({ params }: { params: Promise<{ dashboard: string; widget: string }> }) {
  const { dashboard, widget: widgetId } = use(params);
  const [state, setState] = useState<{ widget: Widget | null; loaded: boolean; failed: boolean }>({ widget: null, loaded: false, failed: false });
  const [bankDefs, setBankDefs] = useState<Record<string, BankWidgetDef>>({});

  useEffect(() => {
    let stale = false;
    storage.getItemResult(instancesKey(dashboard)).then(res => {
      if (stale) return;
      if (!res.ok) { setState({ widget: null, loaded: true, failed: true }); return; }
      let found: Widget | null = null;
      try { found = (JSON.parse(res.value ?? "{}") as Record<string, Widget>)[widgetId] ?? null; } catch {}
      setState({ widget: found, loaded: true, failed: false });
    });
    return () => { stale = true; };
  }, [dashboard, widgetId]);

  // A widget from a widget file needs its definition.
  const isCustom = state.widget?.type === "custom";
  useEffect(() => {
    if (!isCustom) return;
    fetch("/api/widget-bank")
      .then(r => r.json())
      .then((d: { widgets?: BankWidgetDef[] }) => setBankDefs(Object.fromEntries((d.widgets ?? []).map(def => [def.id, def]))))
      .catch(() => {});
  }, [isCustom]);

  useEffect(() => {
    if (state.widget?.title) document.title = state.widget.title;
  }, [state.widget]);

  return (
    <main className="h-dvh p-2 bg-[var(--page-bg)]">
      {!state.loaded ? null : state.widget ? (
        renderWidget(state.widget, "", bankDefs)
      ) : (
        <div className="h-full flex items-center justify-center text-center px-6">
          <p className="text-sm text-[var(--text-secondary)]">
            {state.failed ? "Could not reach the server. Try again in a moment." : "This widget is not on that dashboard any more."}
          </p>
        </div>
      )}
    </main>
  );
}
