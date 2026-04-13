# oldenbyte

Minimal Next.js + Tailwind + Prisma + SQLite starter.

## Stack

- **Next.js 16** — App Router, TypeScript
- **Tailwind CSS** — utility-first styling
- **Prisma 7** — ORM with SQLite

## Structure

```
app/
  layout.tsx        root layout
  page.tsx          homepage
lib/
  prisma.ts         Prisma client singleton
prisma/
  schema.prisma     database schema
  migrations/       migration history
  dev.db            local SQLite database (gitignored)
prisma.config.ts    Prisma 7 config (DB connection)
```

## Getting Started

```bash
npm install
npx prisma migrate dev
npm run dev
```
