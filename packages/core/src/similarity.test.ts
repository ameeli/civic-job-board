import { describe, expect, it } from "vitest";
import { sameLevel } from "./similarity";

describe("sameLevel", () => {
  it("tells titles at different levels apart", () => {
    expect(sameLevel("Software Engineer", "Software Engineer II")).toBe(false);
    expect(sameLevel("Software Engineer II", "Software Engineer III")).toBe(false);
    expect(sameLevel("Product Manager", "Senior Product Manager")).toBe(false);
    expect(sameLevel("Junior Data Analyst", "Data Analyst")).toBe(false);
    expect(sameLevel("Staff Engineer", "Principal Engineer")).toBe(false);
    expect(sameLevel("Product Manager", "Product Director")).toBe(false);
  });

  it("treats spellings of one level as the same", () => {
    expect(sameLevel("Sr. Software Engineer (Remote)", "Senior Software Engineer")).toBe(true);
    expect(sameLevel("Software Engineer 2", "Software Engineer II")).toBe(true);
    expect(sameLevel("Data Analyst", "Data Analyst - Remote")).toBe(true);
  });
});
