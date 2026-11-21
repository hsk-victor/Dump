"use client";

import { useEffect, useState } from "react";
import { desktopSettings, type ShortcutSettings } from "@/lib/desktop-settings";

export default function DesktopShortcutSettings({ open }: { open: boolean }) {
  const [desktop, setDesktop] = useState(false);
  const [settings, setSettings] = useState<ShortcutSettings | null>(null);
  const [binding, setBinding] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !desktopSettings.available()) return;
    setDesktop(true);
    let active = true;
    void desktopSettings.read().then((value) => {
      if (active) { setSettings(value); setBinding(value.binding); setMessage(value.error); }
    }).catch(() => { if (active) setMessage("Couldn’t load the shortcut."); });
    return () => { active = false; };
  }, [open]);

  if (!desktop) return null;

  return <div className="d-shortcut-setting">
    <label className="d-settings-label" htmlFor="capture-shortcut">Quick capture shortcut</label>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (saving || !settings) return;
      setSaving(true);
      try {
        const value = await desktopSettings.apply(binding);
        setSettings(value); setBinding(value.binding); setMessage(value.error || "Shortcut saved.");
      } catch (error) {
        setMessage(typeof error === "string" ? error : "Couldn’t change the shortcut.");
      } finally { setSaving(false); }
    }}>
      <input id="capture-shortcut" className="d-kind-select" value={binding} autoComplete="off" spellCheck={false}
        disabled={saving || !settings} aria-describedby="capture-shortcut-status"
        onChange={(event) => { setBinding(event.target.value); setMessage(null); }} />
      <button className="d-ghost-btn" type="submit" disabled={saving || !settings || !binding.trim()}>{saving ? "Applying…" : "Apply"}</button>
    </form>
    <p id="capture-shortcut-status" role="status">{message}</p>
  </div>;
}
