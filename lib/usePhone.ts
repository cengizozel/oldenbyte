"use client";

import { useEffect, useState } from "react";

// A phone-width window. The layout bands in WidgetGrid follow the grid's own
// width; this follows the real viewport, which the overview needs because it
// lays the grid out wider than the screen.
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 599px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
