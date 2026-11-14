import { describe, expect, it } from "vitest";
import { classifyHeuristic } from "../classify";

describe("classifyHeuristic", () => {
  it("does not turn domains or dotted run-on words into tags", () => {
    const { tags } = classifyHeuristic({ description: "bookmarks.no pic.twitter.com this.gatheros https://gatheros.co" });
    expect(tags.some((tag) => tag.includes("."))).toBe(false);
  });
  it.each([
    [{ title: "The best creamy garlic pasta recipe", description: "Ready in 20 minutes with simple ingredients" }, "food"],
    [{ url: "https://github.com/vercel/next.js", domain: "github.com", title: "vercel/next.js: The React Framework" }, "tech"],
    [{ title: "OpenAI releases a new GPT model with better reasoning" }, "ai"],
    [{ title: "10 things to do in Kyoto", description: "A 3-day itinerary for your Japan trip" }, "travel"],
    [{ title: "A 20-minute full body workout you can do at home without a gym" }, "health"],
    [{ title: "Rick Astley - Never Gonna Give You Up (Official Music Video)", domain: "youtube.com" }, "music"],
    [{ content: "remember to call mom tomorrow about the birthday dinner plans" }, "personal"],
    [{ title: "Arsenal win the Premier League title after dramatic final match" }, "sports"],
    [{ title: "Untitled", description: "zzz qqq" }, "other"],
  ] as const)("%o -> %s", (input, topic) => {
    expect(classifyHeuristic(input).topic).toBe(topic);
  });

  it("extracts hashtags and keywords as tags", () => {
    const { tags } = classifyHeuristic({ title: "Sourdough bread recipe #baking", description: "Crusty sourdough bread at home" });
    expect(tags).toContain("baking");
    expect(tags).toContain("sourdough");
    expect(tags).toContain("recipe");
    expect(tags.length).toBeLessThanOrEqual(5);
  });
});

describe("tags from stem keywords", () => {
  it("uses the real word, not the stem", () => {
    const { tags } = classifyHeuristic({ title: "Astronomers spot a new galaxy with the telescope" });
    expect(tags).toContain("astronomers");
    expect(tags.some((t) => t === "astronom")).toBe(false);
  });
});
