import { expect, it } from "vitest";
import { htmlText } from "./html-text";

it("keeps a board's text one block per line, with entities decoded and scripts dropped", () => {
  expect(htmlText("<h2>Data &amp; Design</h2><p>A  <b>bold</b>\tplan</p><ul><li>One</li><li>Two</li></ul><script>x()</script>"))
    .toBe("Data & Design\nA bold plan\nOne\nTwo");
  expect(htmlText("<p>Position:&nbsp;</p><p>Remote\u00a0 first</p>")).toBe("Position:\nRemote first");
  expect(htmlText("")).toBe("");
});
