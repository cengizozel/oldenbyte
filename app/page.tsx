import Container from "@/components/Container";
import Section from "@/components/Section";
import Card from "@/components/Card";

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <Container>

        {/* Header */}
        <header className="mb-14">
          <p className="text-sm text-neutral-400 tracking-widest uppercase">comfort</p>
        </header>

        {/* Daily */}
        <Section title="Daily">
          <Card>
            <p className="text-sm text-neutral-400">coming soon</p>
          </Card>
        </Section>

        {/* Saved */}
        <Section title="Saved">
          <Card>
            <p className="text-sm text-neutral-400">coming soon</p>
          </Card>
        </Section>

        {/* Random */}
        <Section title="Random">
          <Card>
            <p className="text-sm text-neutral-400">coming soon</p>
          </Card>
        </Section>

        {/* Journal */}
        <Section title="Journal">
          <Card>
            <p className="text-sm text-neutral-400">coming soon</p>
          </Card>
        </Section>

      </Container>
    </div>
  );
}
