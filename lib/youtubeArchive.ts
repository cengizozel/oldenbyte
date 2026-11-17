// The YouTube widget's archive: an add-on for the "youtube.archive" slot
// (docs/addons.md) plus how the widget uses it. One connection shared by
// every YouTube widget: set it up in any of them and all of them use it.
import { addonValues, type ListedAddon } from "./addons";

// addon: the add-on's id. values: what the user typed into its fields.
// open: where video links go; videos the archive has open there, the rest
// still fall back to YouTube. mark: which side gets a badge once links open
// in the archive, the videos it has ("archive", the default) or the ones it
// does not ("youtube"). only: list nothing until the archive has it, which
// makes any badge moot.
export type ArchiveConfig = {
  addon: string;
  values: Record<string, string>;
  open: "youtube" | "archive";
  mark?: "archive" | "youtube";
  only?: boolean;
};

export const ARCHIVE_KEY = "youtube-archive";
// Where the connection lived when TubeArchivist was built in.
export const OLD_TA_KEY = "youtube-tubearchivist";

type OldTa = { url?: string; token?: string; open?: "youtube" | "ta"; serverUrl?: string; mark?: "ta" | "yt"; only?: boolean };

// The built-in TubeArchivist connection as the TubeArchivist add-on's.
export function fromOldTa(old: unknown): ArchiveConfig | undefined {
  const o = (old && typeof old === "object" ? old : {}) as OldTa;
  if (!o.url || !o.token) return undefined;
  return {
    addon: "tubearchivist",
    values: { url: o.url, token: o.token, ...(o.serverUrl ? { serverUrl: o.serverUrl } : {}) },
    open: o.open === "ta" ? "archive" : "youtube",
    ...(o.mark ? { mark: o.mark === "yt" ? ("youtube" as const) : ("archive" as const) } : {}),
    ...(o.only ? { only: true } : {}),
  };
}

export function parseArchive(raw: string | null): ArchiveConfig | undefined {
  if (!raw) return undefined;
  try {
    const a = JSON.parse(raw) as Partial<ArchiveConfig>;
    if (typeof a.addon !== "string" || !a.addon || !a.values || typeof a.values !== "object") return undefined;
    return { addon: a.addon, values: a.values, open: a.open === "archive" ? "archive" : "youtube", ...(a.mark ? { mark: a.mark } : {}), ...(a.only ? { only: true } : {}) };
  } catch {
    return undefined;
  }
}

// The add-on and values to use, when videos are set to open in the archive
// and the connection is complete; null otherwise.
export function activeArchive(cfg: ArchiveConfig | undefined, addons: ListedAddon[]): { addon: ListedAddon; values: Record<string, string>; cfg: ArchiveConfig } | null {
  if (!cfg || cfg.open !== "archive") return null;
  const addon = addons.find(a => a.id === cfg.addon && a.slot === "youtube.archive");
  const values = addon ? addonValues(addon, cfg.values) : null;
  return addon && values ? { addon, values, cfg } : null;
}

// The add-ons this account can pick, fetched once per page.
let listing: Promise<ListedAddon[]> | null = null;
export function loadAddons(fresh = false): Promise<ListedAddon[]> {
  if (!listing || fresh) {
    listing = fetch("/api/addons")
      .then(r => (r.ok ? r.json() : { addons: [] }))
      .then((d: { addons?: ListedAddon[] }) => d.addons ?? [])
      .catch(() => { listing = null; return []; });
  }
  return listing;
}
