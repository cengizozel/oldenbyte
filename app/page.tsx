import TopBar from "@/components/TopBar";
import WidgetCard from "@/components/WidgetCard";
import { widgets } from "@/lib/widgets";

export default function Home() {
  return (
    <div className="min-h-screen md:h-screen bg-neutral-50 flex flex-col p-6 gap-5">
      <TopBar />

      <div className="grid grid-cols-1 md:grid-cols-2 md:grid-rows-3 gap-4 flex-1 min-h-0">
        {widgets.map((widget, i) => (
          <WidgetCard
            key={widget.id}
            widget={widget}
            className={i === 0 ? "md:row-span-2" : ""}
          />
        ))}
      </div>
    </div>
  );
}
