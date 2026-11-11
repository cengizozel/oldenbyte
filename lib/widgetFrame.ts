import { createContext, useContext, type ReactNode } from "react";

// What the grid tells every widget about the tile it sits in: whether the
// dashboard is in layout edit mode, and whether this tile is the one shown
// full screen (the grid lifts the tile over a dimmed backdrop, keeping the
// widget mounted, so its state survives). Every header gets a full-screen
// button from this, behind the one header toggle (components/ui/WidgetChrome.tsx).
// In edit mode the same toggle swaps in the tile's controls instead (move to
// another dashboard, group as tabs, remove), which the grid hands over here.
export type WidgetFrame = {
  editing: boolean;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  controls?: ReactNode;
};

export const WidgetFrameContext = createContext<WidgetFrame | null>(null);

export function useWidgetFrame(): WidgetFrame | null {
  return useContext(WidgetFrameContext);
}
