// The server's routes that run on a device (docs/app-bundle.md). In the
// repository this list is empty: tools/app-bundle/build.mjs writes the real
// one into the copy it builds from, with one entry per route file it packs.
import type { NextRequest } from "next/server";

export type RouteModule = Partial<Record<string, (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response>>;
// The path as a pattern, the names of its [parts], and the route file.
export type Route = [pattern: RegExp, names: string[], load: () => Promise<RouteModule>];

export const routes: Route[] = [];
