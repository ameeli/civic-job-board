"use client";

import { useSyncExternalStore } from "react";

const todayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
function subscribe(onChange: () => void) {
  let timeout: ReturnType<typeof setTimeout>;
  function refresh() {
    clearTimeout(timeout);
    onChange();
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    timeout = setTimeout(refresh, midnight.getTime() - now.getTime());
  }
  refresh();
  document.addEventListener("visibilitychange", refresh);
  return () => {
    clearTimeout(timeout);
    document.removeEventListener("visibilitychange", refresh);
  };
}

/**
 * Today's date in the reader's own time zone, so it is rendered in the browser;
 * the server's pass leaves the heading empty.
 */
export function TodayHeading() {
  const today = useSyncExternalStore(subscribe, () => todayFormat.format(new Date()), () => null);
  return <h2 className="inbox-date">{today}</h2>;
}
