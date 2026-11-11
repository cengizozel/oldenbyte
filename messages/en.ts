// English, the source language. Every user-facing string lives here under a
// dotted key (see lib/i18n.ts). To add a language, copy this file to
// messages/<code>.ts, translate the values, and register it in lib/i18n.ts;
// anything left out falls back to English. Placeholders in braces, like
// {name}, are filled in by the caller and must be kept as they are. A key
// ending in _one or _other is a plural pair chosen by {count}.
const en = {
  common: {
    settings: "Settings",
    save: "Save",
    cancel: "Cancel",
    add: "Add",
    remove: "Remove",
    removeNamed: "Remove {name}",
    reset: "Reset",
    keep: "Keep",
    resetQuestion: "Reset?",
    backToDefaults: "Back to defaults",
    options: "Options",
    closeOptions: "Close options",
    fullScreen: "Full screen",
    exitFullScreen: "Exit full screen (Esc)",
    refreshNow: "Refresh now",
    back: "Back",
    less: "Less {label}",
    more: "More {label}",
    andMore_one: "and {count} more",
    andMore_other: "and {count} more",
  },
  empty: {
    youtube: "add YouTube channels",
    reddit: "add subreddits",
    rss: "add an RSS feed URL",
    bookmarks: "add bookmarks",
    tracker: "add activities",
    rhythm: "add things to log",
    upkeep: "add essentials",
    text: "add text",
    arxiv: "choose a category",
    weather: "choose a location",
    calendar: "connect a CalDAV calendar",
    tv: "add a channel",
  },
} as const;

export default en;
export type Messages = typeof en;
