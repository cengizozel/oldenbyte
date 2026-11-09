import { createContext, useContext } from "react";

// A widget inside a tab group does not draw its own header row: the tab row
// is the header. The group tells each member whether it is the shown tab and
// where in the tab row its header icon (every tab shows its icon) and its
// right-hand actions (only the shown tab) belong, and WidgetHeader portals
// them there (components/ui/WidgetChrome.tsx).
export type TabGroupHosts = { icons: Record<string, HTMLElement | null>; actions: HTMLElement | null };

export type TabGroupMembership = {
  containerId: string;
  active: boolean;
  iconHost: HTMLElement | null;
  actionsHost: HTMLElement | null;
};

export const TabGroupContext = createContext<TabGroupMembership | null>(null);

export function useTabGroup(): TabGroupMembership | null {
  return useContext(TabGroupContext);
}
