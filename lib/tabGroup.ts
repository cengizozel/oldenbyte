import { createContext, useContext } from "react";

// A widget inside a tab group does not draw its own header row: the tab row
// is the header. The group tells each member whether it is the shown tab and
// where in the tab row its header icon and right-hand actions belong, and
// WidgetHeader portals them there (components/ui/WidgetChrome.tsx).
export type TabGroupHosts = { icon: HTMLElement | null; actions: HTMLElement | null };

export type TabGroupMembership = {
  containerId: string;
  active: boolean;
  hosts: TabGroupHosts;
};

export const TabGroupContext = createContext<TabGroupMembership | null>(null);

export function useTabGroup(): TabGroupMembership | null {
  return useContext(TabGroupContext);
}
