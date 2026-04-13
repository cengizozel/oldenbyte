export default function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      {children}
    </div>
  );
}
