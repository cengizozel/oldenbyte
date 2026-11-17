// /api/v1/settings: the same key and value store the website uses, under the
// versioned path. GET ?key=, POST { key, value, version? }, DELETE ?key=.
// See docs/api.md (Settings) for the compare-and-set behaviour of `version`.
export { GET, POST, DELETE } from "@/app/api/settings/route";
