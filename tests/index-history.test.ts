import { describe, expect, it } from "vitest";

describe("Index Chart History Timeframes", () => {
  const timeframes = ["15m", "1h", "4h", "1D", "1W", "1M", "12M"];

  it("has valid timeframe definitions for financial indices", () => {
    expect(timeframes).toHaveLength(7);
    expect(timeframes).toEqual(["15m", "1h", "4h", "1D", "1W", "1M", "12M"]);
  });

  it("normalizes both upper and lower case timeframe parameters", () => {
    const normalize = (tf: string) => {
      const tfUpper = tf.trim().toUpperCase();
      return (
        tfUpper === "15M" ? "15m" :
        tfUpper === "1H" ? "1h" :
        tfUpper === "4H" ? "4h" :
        tfUpper === "1D" ? "1D" :
        tfUpper === "1W" ? "1W" :
        tfUpper === "1M" ? "1M" :
        tfUpper === "12M" ? "12M" : "1D"
      );
    };

    expect(normalize("15m")).toBe("15m");
    expect(normalize("1h")).toBe("1h");
    expect(normalize("4h")).toBe("4h");
    expect(normalize("1d")).toBe("1D");
    expect(normalize("1D")).toBe("1D");
    expect(normalize("1w")).toBe("1W");
    expect(normalize("1W")).toBe("1W");
    expect(normalize("1m")).toBe("1M");
    expect(normalize("1M")).toBe("1M");
    expect(normalize("12m")).toBe("12M");
    expect(normalize("12M")).toBe("12M");
  });
});
