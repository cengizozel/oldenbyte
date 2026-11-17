import type { MetadataRoute } from "next";

// The web app manifest: what makes the dashboard installable from a phone's
// browser ("Add to Home Screen"), opening full screen with its own icon like
// an app (docs/mobile.md). Served at /manifest.webmanifest, which the sign-in
// gate lets through (proxy.ts): browsers fetch it without the session.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "oldenbyte",
    short_name: "oldenbyte",
    description: "Your personal dashboard: notes, feeds, calendar and routines on one page.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // The dark page color: the splash screen and the system bars while it loads.
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed, logo inside the safe zone: Android crops this one to its own icon shape.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
