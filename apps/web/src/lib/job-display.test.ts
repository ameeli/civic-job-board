import { expect, it } from "vitest";
import { employerInitials, formatPostedDate, sourceName } from "./job-display";

it("names a job source, and shows an unrecognized one as stored", () => {
  expect(sourceName("dscovery")).toBe("DSCovery");
  expect(sourceName("some-new-board")).toBe("some-new-board");
});

it("takes initials from the employer's first two words", () => {
  expect(employerInitials("Code for America")).toBe("CF");
  expect(employerInitials("Nava")).toBe("N");
  expect(employerInitials("  (U.S.) Digital Service ")).toBe("UD");
  expect(employerInitials("état de Genève")).toBe("ÉD");
});

it("shows a posted day as that calendar day in any time zone", () => {
  expect(formatPostedDate(new Date("2026-11-20T00:00:00Z"))).toBe("Nov 20, 2026");
});
