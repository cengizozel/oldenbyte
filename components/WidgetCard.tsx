import { Box } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import { WidgetHeader } from "./ui/WidgetChrome";

export default function WidgetCard({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const muted = widget.type === "empty";

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>
      <WidgetHeader c={c} icon={Box} title={widget.title} className={muted ? "opacity-40" : ""} />
      <p className={`text-sm ${muted ? "text-neutral-500 opacity-40" : c.text}`}>
        {widget.description}
      </p>
    </div>
  );
}
