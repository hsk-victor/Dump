const TRACKING_PARAM = /^(utm_|mc_|fbclid$|gclid$|dclid$|msclkid$|igshid$|si$|ref_src$|ref_url$)/i;
const X_HOSTS = new Set(["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com", "twitfix.com"]);

/** Comparison key only: never used as the stored or displayed URL. */
export function canonicalUrl(input: string): string {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return input;
    url.hostname = url.hostname.toLowerCase().replace(/^(?:(?:www|m|mobile)\.)+/, "");
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }

    if (X_HOSTS.has(url.hostname)) {
      url.hostname = "x.com";
      url.protocol = "https:";
      const status = url.pathname.match(/^\/(?:[^/]+|i\/web)\/status(?:es)?\/(\d+)(?:\/(?:photo|video)\/\d+)?$/);
      if (status) {
        url.pathname = `/i/web/status/${status[1]}`;
        url.search = "";
      } else {
        url.searchParams.delete("s");
        url.searchParams.delete("t");
      }
    }

    if (url.hostname === "youtube.com" || url.hostname === "youtu.be") {
      const video = url.hostname === "youtu.be"
        ? url.pathname.match(/^\/([^/]+)$/)?.[1]
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1];
      if (video) {
        url.protocol = "https:";
        url.hostname = "youtube.com";
        url.pathname = "/watch";
        url.search = "";
        url.searchParams.set("v", video);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return input;
  }
}
