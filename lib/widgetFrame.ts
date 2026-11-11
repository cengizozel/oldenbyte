import { createContext, useContext, type ReactNode } from "react";
import type { WidgetColor } from "@/lib/widgets";

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
  // The widget this frame was made for (a single header reads it; a tab row
  // passes its shown tab's id instead) and the palette setter behind the
  // header's color button.
  widgetId?: string;
  colorOf?: (widgetId: string) => WidgetColor | undefined;
  setColor?: (widgetId: string, color: WidgetColor) => void;
};

export const WidgetFrameContext = createContext<WidgetFrame | null>(null);

export function useWidgetFrame(): WidgetFrame | null {
  return useContext(WidgetFrameContext);
}
