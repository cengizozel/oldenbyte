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
      <p className="text-sm text-neutral-500">a place to rest</p>
      <p className="text-xs text-neutral-400">{date}</p>
      <p className="text-xs text-neutral-400 italic">feeling quiet</p>
    </div>
  );
}
