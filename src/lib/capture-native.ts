export type ClipboardPayload = { text?: string; file?: { name: string; type: string; base64: string }; message?: string };
type NativeWindow = Window & { __TAURI_INTERNALS__?: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } };

async function invoke(command: string, args?: Record<string, unknown>) {
  const native = (window as NativeWindow).__TAURI_INTERNALS__;
  if (native) await native.invoke(command, args);
}

export const captureNative = {
  available: () => Boolean((window as NativeWindow).__TAURI_INTERNALS__),
  attention: () => invoke("capture_attention"),
  recents: (items: { id: string; label: string }[]) => invoke("capture_recents", { items }),
  hide: () => invoke("capture_hide"),
  resize: (height: number) => invoke("capture_resize", { height }),
  saved: () => invoke("capture_saved"),
  writing: (writing: boolean) => invoke("capture_writing", { writing }),
  listen(handlers: { focus: () => void; open: () => void; clipboard: (payload: ClipboardPayload) => void }) {
    // Native dispatches DOM CustomEvents via eval, so no core:event permission is needed.
    const clipboard = (event: Event) => handlers.clipboard((event as CustomEvent<ClipboardPayload>).detail);
    window.addEventListener("dump:capture-focus", handlers.focus);
    window.addEventListener("dump:capture-open", handlers.open);
    window.addEventListener("dump:clipboard-payload", clipboard);
    return () => {
      window.removeEventListener("dump:capture-focus", handlers.focus);
      window.removeEventListener("dump:capture-open", handlers.open);
      window.removeEventListener("dump:clipboard-payload", clipboard);
    };
  },
};
