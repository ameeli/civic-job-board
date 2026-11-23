"use client";

import { useSyncExternalStore } from "react";

const todayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const noUpdates = () => () => {};

/**
 * Today's date in the reader's own time zone, so it is rendered in the browser;
 * the server's pass leaves the heading empty.
 */
export function TodayHeading() {
  const today = useSyncExternalStore(noUpdates, () => todayFormat.format(new Date()), () => null);
  return <h2 className="inbox-date">{today}</h2>;
}
