import { expect, it } from "vitest";
import { isKeyboardMenuOpen } from "./PhoneMenu";

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
