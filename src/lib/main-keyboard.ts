export function searchShortcutHint(platform: string) {
  return /mac/i.test(platform) ? "⌘K" : "Ctrl K";
}

export function jumpsToComposer(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean },
  context: { narrow: boolean; desktop: boolean; coarse: boolean },
) {
  return event.key === "n" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing
    && (!context.narrow || (context.desktop && !context.coarse));
}
