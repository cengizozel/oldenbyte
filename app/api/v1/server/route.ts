import { v1, API_VERSION, API_MIN_VERSION } from "@/lib/apiV1";
import { isRegistrationEnabled } from "@/lib/appconfig";
import { prisma } from "@/lib/prisma";
import pkg from "@/package.json";

// GET /api/v1/server (no sign-in): is this an oldenbyte server, and which API
// does it speak. The first thing an app asks after the user types an address.
export async function GET() {
  const [users, registration] = await Promise.all([
    prisma.user.count().catch(() => 0),
    isRegistrationEnabled().catch(() => false),
  ]);
  return v1({
    name: "oldenbyte",
    version: pkg.version,
    api: { version: API_VERSION, min: API_MIN_VERSION },
    // False on a server nobody has set up yet: the first account is made on the website.
    ready: users > 0,
    registration,
    // What this server's pages do for an app that shows them: "app-settings"
    // means the dashboard's settings offer a way into the app's own settings
    // (a message to the app's web view), so the app need not draw one.
    features: ["app-settings"],
  });
}
