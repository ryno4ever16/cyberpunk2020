import { describe, it, expect } from "vitest";

describe("vitest toolchain sanity", () => {
  it("runs pure JS assertions", () => {
    expect(1 + 1).toBe(2);
  });
});
