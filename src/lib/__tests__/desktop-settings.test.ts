import { afterEach, expect, it, vi } from "vitest";
import { desktopSettings } from "../desktop-settings";

afterEach(() => vi.unstubAllGlobals());

it("does not expose settings outside the desktop app", async () => {
  expect(desktopSettings.available()).toBe(false);
  vi.stubGlobal("window", {});
  expect(desktopSettings.available()).toBe(false);
  await expect(desktopSettings.read()).rejects.toThrow("only available in the desktop app");
});

it("uses only the two shortcut commands and propagates errors", async () => {
  const settings = { binding: "Ctrl+Alt+D", error: null };
  const invoke = vi.fn().mockResolvedValue(settings);
  vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
  expect(desktopSettings.available()).toBe(true);
  expect(await desktopSettings.read()).toEqual(settings);
  expect(await desktopSettings.apply(settings.binding)).toEqual(settings);
  expect(invoke.mock.calls).toEqual([["shortcut_settings", undefined], ["set_capture_shortcut", { binding: settings.binding }]]);
  invoke.mockRejectedValue("Use a shortcut like Ctrl+Shift+Space.");
  await expect(desktopSettings.apply("")).rejects.toBe("Use a shortcut like Ctrl+Shift+Space.");
  invoke.mockResolvedValue({ ...settings, error: "Shortcut unavailable" });
  expect((await desktopSettings.apply(settings.binding)).error).toBe("Shortcut unavailable");
});
