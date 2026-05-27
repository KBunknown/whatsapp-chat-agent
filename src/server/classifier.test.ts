import { describe, expect, it } from "vitest";
import { classifyOutcome, isOptOut } from "./classifier.js";

describe("message classification", () => {
  it("detects silent opt-out phrases", () => {
    expect(isOptOut("No thanks")).toBe(true);
    expect(isOptOut("please remove me")).toBe(true);
    expect(classifyOutcome("stop")).toBe("opted_out");
  });

  it("classifies supportive and undecided replies", () => {
    expect(classifyOutcome("Yes, tell me more")).toBe("supportive");
    expect(classifyOutcome("Maybe, why should I vote for him?")).toBe("undecided");
  });
});
