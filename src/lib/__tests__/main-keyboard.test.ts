import { describe, expect, it } from "vitest";
import { jumpsToComposer, searchShortcutHint } from "../main-keyboard";

describe("main keyboard", () => {
  const event = { key: "n", metaKey: false, ctrlKey: false, altKey: false, isComposing: false };
  const context = { narrow: true, desktop: true, coarse: false };

  it("uses the platform's search hint", () => {
    expect(searchShortcutHint("MacIntel")).toBe("⌘K");
    expect(searchShortcutHint("Win32")).toBe("Ctrl K");
    expect(searchShortcutHint("Linux x86_64")).toBe("Ctrl K");
    expect(searchShortcutHint("")).toBe("Ctrl K");
  });
  it("supports physical-keyboard narrow desktop without changing mobile/touch", () => {
    expect(jumpsToComposer(event, context)).toBe(true);
    expect(jumpsToComposer(event, { ...context, desktop: false })).toBe(false);
    expect(jumpsToComposer(event, { ...context, coarse: true })).toBe(false);
    expect(jumpsToComposer(event, { ...context, narrow: false, desktop: false })).toBe(true);
  });
  it("does not steal modified, composing, or unrelated keys", () => {
    for (const patch of [{ key: "" }, { key: "x" }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      expect(jumpsToComposer({ ...event, ...patch }, context)).toBe(false);
    }
  });
});
