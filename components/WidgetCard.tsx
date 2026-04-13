import type { Widget } from "@/lib/widgets";

export default function WidgetCard({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const muted = widget.type === "empty";

  return (
    <div
      className={`
        rounded-2xl border border-neutral-200 bg-white p-5
        flex flex-col h-full
        ${muted ? "opacity-40" : ""}
        ${className}
      `}
    >
      <p className="text-xs font-medium tracking-widest text-neutral-400 uppercase mb-3">
        {widget.title}
      </p>
      <p className="text-sm text-neutral-300">{widget.description}</p>
    </div>
  );
}
