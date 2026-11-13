"use client";

import { useEffect, useState } from "react";
import { THEMES, THEME_KEY, isTheme, type Theme } from "@/lib/theme";

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(isTheme(t) ? t : "paper");
  }, []);

  function pick(t: Theme) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem(THEME_KEY, t);
  }

  return (
    <div className="d-themes" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} role="radio" aria-checked={theme === t.id} onClick={() => pick(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
