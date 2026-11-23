import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TodayHeading } from "./today-heading";

vi.mock("react", () => ({ useSyncExternalStore: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mountHeading() {
  const document = new EventTarget();
  vi.stubGlobal("document", document);
  vi.mocked(useSyncExternalStore).mockImplementation((_, snapshot) => snapshot());
  TodayHeading();
  const [subscribe, , serverSnapshot] = vi.mocked(useSyncExternalStore).mock.calls[0];
  const onChange = vi.fn(() => TodayHeading());
  const unsubscribe = subscribe(onChange);
  return { document, onChange, unsubscribe, serverSnapshot };
}

it("updates at each local midnight and removes its timer on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 23, 23, 59, 59));
  const { onChange, unsubscribe, serverSnapshot } = mountHeading();
  expect(TodayHeading().props.children).toBe("Monday, November 23");
  expect(serverSnapshot?.()).toBeNull();
  onChange.mockClear();

  vi.advanceTimersByTime(1000);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(TodayHeading().props.children).toBe("Tuesday, November 24");
  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(TodayHeading().props.children).toBe("Wednesday, November 25");

  unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes after a suspended tab returns and removes its listener on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 23, 22));
  const { document, onChange, unsubscribe } = mountHeading();
  onChange.mockClear();

  vi.setSystemTime(new Date(2026, 10, 24, 8));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(TodayHeading().props.children).toBe("Tuesday, November 24");
  expect(vi.getTimerCount()).toBe(1);

  unsubscribe();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
