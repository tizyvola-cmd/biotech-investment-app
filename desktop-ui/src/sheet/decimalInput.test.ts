import { describe, expect, it } from "vitest";
import { formatDecimalInput, parseInputDecimal } from "./decimalInput";

describe("parseInputDecimal", () => {
  it("accepts Italian comma decimals", () => {
    expect(parseInputDecimal("61,29")).toBe(61.29);
    expect(parseInputDecimal("1154,1801")).toBe(1154.1801);
  });

  it("accepts dot decimals", () => {
    expect(parseInputDecimal("62.855")).toBe(62.855);
  });

  it("accepts thousands dots with decimal comma", () => {
    expect(parseInputDecimal("1.234,56")).toBe(1234.56);
  });

  it("treats empty as 0", () => {
    expect(parseInputDecimal("")).toBe(0);
    expect(parseInputDecimal("  ")).toBe(0);
  });
});

describe("formatDecimalInput", () => {
  it("shows comma decimals without trailing zeros", () => {
    expect(formatDecimalInput(61.29)).toBe("61,29");
    expect(formatDecimalInput(10)).toBe("10");
  });
});
