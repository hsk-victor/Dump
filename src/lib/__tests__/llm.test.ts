import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { classifyWithAi, prepareImage } from "../llm";

const fetchMock = vi.fn();
const answer = (choice: string, confidence = 0.9) =>
  new Response(JSON.stringify({ model: "typesafe/jev-1.14-20261014", answers: { topic: { type: "choice", choice, confidence } } }), { status: 200 });

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#f80" } }).png().toBuffer();
const size = async (dataUrl: string) => sharp(Buffer.from(dataUrl.split(",")[1], "base64")).metadata();

describe("classifyWithAi", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DUMP_MODEL;
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is off without a key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await classifyWithAi({ kind: "note", content: "pasta" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Jev a topic choice over the whole taxonomy and returns its pick", async () => {
    fetchMock.mockResolvedValueOnce(answer("food", 0.97));
    const out = await classifyWithAi({ kind: "article", title: "Garlic pasta", note: "try this", url: "https://x.com/p", description: null });
    expect(out).toEqual({ topic: "food", confidence: 0.97, model: "typesafe/jev-1.14-20261014" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("typesafe/jev-1.14");
    expect(body.state).toEqual({ kind: "article", url: "https://x.com/p", title: "Garlic pasta", owner_note: "try this" });
    expect(body.questions.topic.type).toBe("choice");
    expect(Object.keys(body.questions.topic.criteria)).toHaveLength(20);
  });

  it("uses DUMP_MODEL when set", async () => {
    process.env.DUMP_MODEL = "typesafe/jev-1.15";
    fetchMock.mockResolvedValueOnce(answer("tech"));
    await classifyWithAi({ kind: "note", content: "x" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("typesafe/jev-1.15");
  });

  it("returns null on API errors and unknown topics so callers fall back to rules", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad key", { status: 401 }));
    expect(await classifyWithAi({ kind: "note", content: "x" })).toBeNull();
    fetchMock.mockResolvedValueOnce(answer("cooking"));
    expect(await classifyWithAi({ kind: "note", content: "x" })).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await classifyWithAi({ kind: "note", content: "x" })).toBeNull();
  });

  it("retries rate limits", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } })).mockResolvedValueOnce(answer("music"));
    expect((await classifyWithAi({ kind: "note", content: "x" }))?.topic).toBe("music");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("prepareImage", () => {
  it("scales large images down and small ones up into Jev's limits, as JPEG", async () => {
    const big = await size((await prepareImage(await png(4000, 3000)))!);
    expect(big).toMatchObject({ format: "jpeg" });
    expect(Math.max(big.width!, big.height!)).toBeLessThanOrEqual(1568);
    expect(big.width! * big.height!).toBeLessThanOrEqual(2_458_624);

    const small = await size((await prepareImage(await png(100, 80)))!);
    expect(Math.min(small.width!, small.height!)).toBeGreaterThanOrEqual(256);

    const odd = await size((await prepareImage(await png(100, 101)))!);
    expect(odd.width! * odd.height!).toBeGreaterThanOrEqual(78_400);

    const banner = await size((await prepareImage(await png(2401, 392)))!);
    expect(banner).toMatchObject({ width: 1568, height: 256 });
  });

  it("skips images whose shape can't fit and junk bytes", async () => {
    expect(await prepareImage(await png(4000, 200))).toBeNull();
    expect(await prepareImage(Buffer.from("not an image"))).toBeNull();
  });
});
