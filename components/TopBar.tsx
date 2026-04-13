export default function TopBar() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex items-center justify-between py-1">
      <p className="text-sm font-medium text-neutral-700">a place to rest</p>
      <p className="text-xs text-neutral-500">{date}</p>
      <p className="text-xs text-neutral-500 italic">feeling quiet</p>
    </div>
  );
}
