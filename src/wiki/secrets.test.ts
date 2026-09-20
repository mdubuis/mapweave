import { describe, expect, it } from "vitest";
import { hasSecretContent, splitSecretSegments, stripSecrets } from "./secrets";

describe("splitSecretSegments", () => {
  it("returns a single public segment when there is no secret block", () => {
    expect(splitSecretSegments("Just some prose.\nMore prose.")).toEqual([
      { text: "Just some prose.\nMore prose.", secret: false }
    ]);
  });

  it("splits public/secret/public around a marked block", () => {
    const body = "Before.\n:::secret\nThe true villain is the mayor.\n:::\nAfter.";
    expect(splitSecretSegments(body)).toEqual([
      { text: "Before.", secret: false },
      { text: "The true villain is the mayor.", secret: true },
      { text: "After.", secret: false }
    ]);
  });

  it("runs an unterminated secret block to the end of the document", () => {
    const body = "Before.\n:::secret\nNever closed.";
    expect(splitSecretSegments(body)).toEqual([
      { text: "Before.", secret: false },
      { text: "Never closed.", secret: true }
    ]);
  });
});

describe("stripSecrets", () => {
  it("removes secret blocks and leaves public text untouched", () => {
    const body = "Before.\n:::secret\nHidden.\n:::\nAfter.";
    expect(stripSecrets(body)).toBe("Before.\nAfter.");
  });

  it("is a no-op when there is no secret block", () => {
    expect(stripSecrets("Nothing hidden here.")).toBe("Nothing hidden here.");
  });
});

describe("hasSecretContent", () => {
  it("is true when a secret block is present", () => {
    expect(hasSecretContent("Before.\n:::secret\nHidden.\n:::\nAfter.")).toBe(true);
  });

  it("is false otherwise", () => {
    expect(hasSecretContent("Nothing hidden here.")).toBe(false);
  });
});
