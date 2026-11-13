export const THEMES = [
  { id: "paper", label: "Broadsheet" },
  { id: "zine", label: "Scrapbook" },
  { id: "night", label: "Night edition" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

export const THEME_KEY = "dump-theme";
export const DENSITY_KEY = "dump-density";

export function isTheme(v: unknown): v is Theme {
  return THEMES.some((t) => t.id === v);
}

/** Runs before first paint so the saved theme (or ?theme=) applies without a flash. */
export const THEME_INIT_SCRIPT = `(()=>{try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("${THEME_KEY}");if(${JSON.stringify(THEMES.map((t) => t.id))}.indexOf(t)>-1){document.documentElement.dataset.theme=t;if(q)localStorage.setItem("${THEME_KEY}",t)}var d=localStorage.getItem("${DENSITY_KEY}");if(d)document.documentElement.style.setProperty("--col-w",d+"px")}catch(e){}})()`;
