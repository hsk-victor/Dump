import { describe, expect, it } from "vitest";
import { desktopAccess } from "../desktop-token";

describe("desktopAccess", () => {
  it("leaves the server open when no desktop token is set", () => {
    expect(desktopAccess(undefined, undefined, null)).toBe("open");
    expect(desktopAccess("", "x", "x")).toBe("open");
  });
  it("allows the cookie and grants the launch URL param", () => {
    expect(desktopAccess("s3cret", "s3cret", null)).toBe("allowed");
    expect(desktopAccess("s3cret", undefined, "s3cret")).toBe("grant");
    expect(desktopAccess("s3cret", "old", "s3cret")).toBe("grant");
  });
  it("denies anything else", () => {
    expect(desktopAccess("s3cret", undefined, null)).toBe("denied");
    expect(desktopAccess("s3cret", "s3cre", "s3cretx")).toBe("denied");
  });
});
