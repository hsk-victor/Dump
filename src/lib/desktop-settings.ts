export interface ShortcutSettings {
  binding: string;
  error: string | null;
}

type NativeWindow = Window & { __TAURI_INTERNALS__?: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } };

async function invoke(command: string, args?: Record<string, unknown>) {
  const native = typeof window === "undefined" ? undefined : (window as NativeWindow).__TAURI_INTERNALS__;
  if (!native) throw new Error("Shortcut settings are only available in the desktop app.");
  return native.invoke<ShortcutSettings>(command, args);
}

export const desktopSettings = {
  available: () => typeof window !== "undefined" && Boolean((window as NativeWindow).__TAURI_INTERNALS__),
  async read() {
    return invoke("shortcut_settings");
  },
  async apply(binding: string) {
    return invoke("set_capture_shortcut", { binding });
  },
};
