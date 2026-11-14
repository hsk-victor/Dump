import { describe, expect, it } from "vitest";
import { parseSyndication, syndicationUrl, type SyndicationTweet } from "../x-post";

const tweet: SyndicationTweet = {
  text: "I'm excited to ship this.\n\nGatherOS syncs bookmarks.\nTry https://t.co/site https://t.co/media",
  user: { name: "Brett", screen_name: "BrettFromDJ", profile_image_url_https: "https://pbs.twimg.com/avatar.jpg" },
  entities: {
    urls: [{ url: "https://t.co/site", expanded_url: "http://gatheros.co" }],
    media: [{ url: "https://t.co/media" }],
  },
  mediaDetails: [{
    type: "video",
    media_url_https: "https://pbs.twimg.com/poster.jpg",
    video_info: { variants: [
      { content_type: "video/mp4", bitrate: 10368000, url: "https://video.twimg.com/1376x1080/high.mp4" },
      { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/916x720/preferred.mp4" },
      { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/458x360/low.mp4" },
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/stream.m3u8" },
    ] },
  }],
};

describe("X syndication", () => {
  it("decodes HTML entities after link replacement without interpreting literal markup", () => {
    const post = parseSyndication({
      ...tweet,
      text: "Tips &amp; tricks &gt; &lt; &quot;quoted&quot; &#39; &#x1F680; <script>text</script>\nhttps://t.co/site https://t.co/media",
    });
    expect(post?.description).toBe("Tips & tricks > < \"quoted\" ' 🚀 <script>text</script>\nhttp://gatheros.co");
    expect(post?.content).toBe(post?.description);
  });
  it("uses the react-tweet token algorithm for X status URLs", () => {
    const id = "2065157792109916488";
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    expect(syndicationUrl(`https://x.com/BrettFromDJ/status/${id}`)).toBe(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`);
    expect(syndicationUrl("https://example.com/status/123")).toBeNull();
    expect(syndicationUrl("https://x.com/BrettFromDJ")).toBeNull();
  });

  it("preserves paragraphs, expands links, removes media links and chooses the best 720p mp4", () => {
    expect(parseSyndication(tweet)).toMatchObject({
      description: "I'm excited to ship this.\n\nGatherOS syncs bookmarks.\nTry http://gatheros.co",
      author: "Brett", authorHandle: "BrettFromDJ", authorAvatarUrl: "https://pbs.twimg.com/avatar.jpg",
      videoUrl: "https://video.twimg.com/916x720/preferred.mp4", videoPosterUrl: "https://pbs.twimg.com/poster.jpg",
      imageUrls: [],
    });
  });

  it("stores all photos as a gallery without inventing video", () => {
    expect(parseSyndication({ text: "Photos", user: tweet.user, photos: [{ url: "https://pbs.twimg.com/1.jpg" }, { url: "https://pbs.twimg.com/2.jpg" }] })).toMatchObject({
      imageUrl: "https://pbs.twimg.com/1.jpg", imageUrls: ["https://pbs.twimg.com/1.jpg", "https://pbs.twimg.com/2.jpg"], videoUrl: null,
    });
  });

  it("handles missing media and rejects empty/error payloads for oEmbed fallback", () => {
    expect(parseSyndication({})).toBeNull();
    expect(parseSyndication({ text: "unavailable" })).toBeNull();
    expect(parseSyndication({ text: "Just text", user: tweet.user })).toMatchObject({ imageUrls: [], videoUrl: null, videoPosterUrl: null });
  });

  it("does not use HLS when no mp4 is available", () => {
    expect(parseSyndication({ ...tweet, mediaDetails: [{ type: "video", media_url_https: "poster", video_info: { variants: [{ content_type: "application/x-mpegURL", url: "stream" }] } }] })?.videoUrl).toBeNull();
  });
});
