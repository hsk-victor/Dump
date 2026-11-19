import { describe, expect, it } from "vitest";
import { bookmarkletAllowed, desktopAccess } from "../desktop-token";

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

describe("bookmarkletAllowed", () => {
  it("lets the key open /dump only", () => {
    expect(bookmarkletAllowed("k3y", "/dump", "k3y")).toBe(true);
    expect(bookmarkletAllowed("k3y", "/api/dumps", "k3y")).toBe(false);
    expect(bookmarkletAllowed("k3y", "/", "k3y")).toBe(false);
  });

  it("denies a wrong, missing or unset key", () => {
    expect(bookmarkletAllowed("k3y", "/dump", "k3")).toBe(false);
    expect(bookmarkletAllowed("k3y", "/dump", null)).toBe(false);
    expect(bookmarkletAllowed(undefined, "/dump", "")).toBe(false);
    expect(bookmarkletAllowed("", "/dump", "")).toBe(false);
  });
});
