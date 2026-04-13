export default function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="text-xs font-medium tracking-widest text-neutral-400 uppercase mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}
