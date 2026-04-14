"use client";

import { useState } from "react";
import TopBar from "@/components/TopBar";
import WidgetGrid from "@/components/WidgetGrid";
import { widgets } from "@/lib/widgets";

export default function Home() {
  const [editing, setEditing] = useState(false);
  return (
    <div className="min-h-screen md:h-screen bg-stone-200 flex flex-col p-4 md:p-6 gap-4 md:gap-5 md:overflow-hidden">
      <TopBar editing={editing} onToggleEdit={() => setEditing(e => !e)} />
      <WidgetGrid widgets={widgets} editing={editing} onToggleEdit={() => setEditing(e => !e)} />
    </div>
  );
}
