import { describe, it, expect } from "vitest";
import { truncateId, gradeColor } from "../constants";

describe("truncateId", () => {
  it("truncates long strings with ellipsis", () => {
    const txid = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
    expect(truncateId(txid)).toBe("323df21f...dec2");
  });

  it("returns short strings unchanged", () => {
    expect(truncateId("abc")).toBe("abc");
    expect(truncateId("12345678...1234")).toBe("12345678...1234");
  });

  it("respects custom tailLen", () => {
    const txid = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
    expect(truncateId(txid, 6)).toBe("323df21f...29dec2");
  });

  it("handles strings at the boundary length", () => {
    // 8 + 4 + 3 = 15 chars or fewer should not be truncated
    const exact15 = "123456789012345";
    expect(truncateId(exact15)).toBe(exact15);

    // 16 chars should be truncated
    const sixteen = "1234567890123456";
    expect(truncateId(sixteen)).toBe("12345678...3456");
  });
});

describe("gradeColor", () => {
  it("returns correct color for known grades", () => {
    expect(gradeColor("A+")).toBe("text-severity-good");
    expect(gradeColor("F")).toBe("text-severity-critical");
  });

  it("returns fallback for unknown grades", () => {
    expect(gradeColor("Z")).toBe("text-muted");
    expect(gradeColor("Z", "text-red")).toBe("text-red");
  });
});
