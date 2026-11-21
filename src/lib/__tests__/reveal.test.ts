import { describe, expect, it, vi } from "vitest";
import { fetchRevealWindow } from "../reveal";

describe("fetchRevealWindow", () => {
  it("fetches unfiltered pages until the target is included, deduping IDs", async () => {
    const page = vi.fn().mockResolvedValueOnce({ items: [{ id: "a" }], hasMore: true }).mockResolvedValueOnce({ items: [{ id: "a" }, { id: "b" }], hasMore: true });
    expect(await fetchRevealWindow("b", page)).toEqual({ items: [{ id: "a" }, { id: "b" }], hasMore: true });
    expect(page.mock.calls).toEqual([[0], [1]]);
  });
  it("returns null for missing/deleted saves and stops on empty or repeated pages", async () => {
    expect(await fetchRevealWindow("missing", async () => ({ items: [], hasMore: false }))).toBeNull();
    const page = vi.fn().mockResolvedValue({ items: [{ id: "a" }], hasMore: true });
    expect(await fetchRevealWindow("missing", page)).toBeNull();
    expect(page).toHaveBeenCalledTimes(2);
  });
  it("propagates transport errors to the inline error handler", async () => {
    await expect(fetchRevealWindow("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
});
