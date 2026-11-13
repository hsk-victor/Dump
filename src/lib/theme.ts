export const MODE_KEY = "dump-mode";
export const DENSITY_KEY = "dump-density";

/** Runs before first paint so the saved light/dark mode and card size apply without a flash. */
export const THEME_INIT_SCRIPT = `(()=>{try{var m=localStorage.getItem("${MODE_KEY}")||"light";document.documentElement.dataset.mode=m;var d=localStorage.getItem("${DENSITY_KEY}");if(d)document.documentElement.style.setProperty("--col-w",d+"px")}catch(e){}})()`;
