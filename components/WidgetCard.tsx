import { colorMap, type Widget } from "@/lib/widgets";

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
    <div
      className={`
        rounded-2xl border p-5
        flex flex-col h-full
        ${c.bg} ${c.border}
        ${muted ? "opacity-40" : ""}
        ${className}
      `}
    >
      <p className={`text-xs font-semibold tracking-widest uppercase mb-2 ${c.label}`}>
        {widget.title}
      </p>
      <p className={`text-sm ${muted ? "text-neutral-500" : c.text}`}>
        {widget.description}
      </p>
    </div>
  );
}
