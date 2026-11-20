import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isKeyboardMenuOpen } from "./PhoneMenu";

it("bounds shared menus to available space and allows contained wheel scrolling", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const menu = css.match(/\.d-menu\s*\{([^}]+)\}/)?.[1];
  expect(menu).toContain("max-height: var(--available-height");
  expect(menu).toContain("overflow-y: auto");
  expect(menu).toContain("overscroll-behavior: contain");
  expect(css.match(/\.d-menu-positioner\s*\{([^}]+)\}/)?.[1]).toContain("z-index: 50");
});

it("uses instant opening for keyboard navigation and activation, not pointer input", () => {
  expect(isKeyboardMenuOpen({ reason: "list-navigation", event: new Event("keydown") })).toBe(true);
  expect(isKeyboardMenuOpen({
    reason: "trigger-press",
    event: Object.assign(new Event("click"), { detail: 0 }),
  })).toBe(true);
  expect(isKeyboardMenuOpen({
    reason: "item-press",
    event: Object.assign(new Event("click"), { detail: 0 }),
  })).toBe(true);
  expect(isKeyboardMenuOpen({
    reason: "trigger-press",
    event: Object.assign(new Event("click"), { detail: 1 }),
  })).toBe(false);
  expect(isKeyboardMenuOpen({ reason: "trigger-hover", event: new Event("pointerenter") })).toBe(false);
});
