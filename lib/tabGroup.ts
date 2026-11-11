import { createContext, useContext } from "react";

// A widget inside a tab group does not draw its own header row: the tab row
// is the header. The group tells each member whether it is the shown tab and
// where in the tab row its header icon and title (every tab shows its own, so
// a tab reads exactly what the widget's header would, "BBC News" rather than
// "Feed") and its right-hand actions (only the shown tab) belong, and
// WidgetHeader portals them there (components/ui/WidgetChrome.tsx).
export type TabGroupHosts = {
  icons: Record<string, HTMLElement | null>;
  titles: Record<string, HTMLElement | null>;
  actions: HTMLElement | null;
  // The row's common group (settings, then full screen): the shown widget's
  // settings control goes here, so a divider can sit between its own
  // actions and the pair every widget has.
  settings: HTMLElement | null;
};

export type TabGroupMembership = {
  containerId: string;
  active: boolean;
  iconHost: HTMLElement | null;
  titleHost: HTMLElement | null;
  actionsHost: HTMLElement | null;
  settingsHost: HTMLElement | null;
};

export const TabGroupContext = createContext<TabGroupMembership | null>(null);

export function useTabGroup(): TabGroupMembership | null {
  return useContext(TabGroupContext);
}
