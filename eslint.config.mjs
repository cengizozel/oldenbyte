import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next.js recommended rules (React, hooks, accessibility basics, Core Web
// Vitals) plus TypeScript. Run with `npm run lint`; CI runs it on every push.
const config = [
  ...nextVitals,
  ...nextTs,
  {
    // These rules target the React Compiler, which this app does not use;
    // they flag patterns that are correct without it (reading a ref during
    // render to avoid a stale closure, syncing state in an effect). Kept as
    // warnings to guide new code without failing CI on working code.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts", "tools/**", "widget-bank/**"],
  },
];

export default config;
