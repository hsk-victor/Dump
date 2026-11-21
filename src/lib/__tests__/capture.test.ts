import { describe, expect, it } from "vitest";
import { canSubmit, extractDropUrl, fileError, selectDrop, submitsEditor } from "../capture";

describe("capture submit gating", () => {
  it("requires content and locks writes", () => {
    expect(canSubmit({ text: " \n", file: null }, false)).toBe(false);
    expect(canSubmit({ text: "note", file: null }, false)).toBe(true);
    expect(canSubmit({ text: "", file: new File([], "a.txt") }, false)).toBe(true);
    expect(canSubmit({ text: "note", file: null }, true)).toBe(false);
  });
  it("accepts Enter but not newlines or IME keys", () => {
    const key = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
    expect(submitsEditor(key)).toBe(true);
    expect(submitsEditor({ ...key, shiftKey: true })).toBe(false);
    expect(submitsEditor({ ...key, isComposing: true })).toBe(false);
    expect(submitsEditor({ ...key, keyCode: 229 })).toBe(false);
    expect(submitsEditor({ ...key, key: "a" })).toBe(false);
  });
});

describe("drop selection", () => {
  const data = (files: File[] = [], plain = "", uri = "", items: unknown[] = []) => ({ files, items, getData: (type: string) => type === "text/uri-list" ? uri : plain }) as unknown as Pick<DataTransfer, "files" | "items" | "getData">;
  it("extracts explicit HTTP(S) links and ignores URI comments", () => {
    expect(extractDropUrl("# comment\r\nhttps://example.com/path")).toBe("https://example.com/path");
    expect(extractDropUrl("title https://example.com/path")).toBe("https://example.com/path");
    for (const value of ["", "note", "file:///a", "javascript:alert(1)", "http://", "https://a.com https://b.com"]) expect(extractDropUrl(value)).toBeNull();
  });
  it("prefers one actual file over incidental text", () => {
    const file = new File(["hi"], "hello.txt");
    expect(selectDrop(data([file], "https://example.com"))).toEqual({ file, text: "" });
    expect(selectDrop(data([], "https://fallback.com", "https://example.com"))).toEqual({ text: "https://example.com/", file: null });
  });
  it("rejects multiple items, folders, invalid text and oversize files", () => {
    expect(selectDrop(data([new File([], "a"), new File([], "b")]))).toHaveProperty("error");
    expect(selectDrop(data([], "", "", [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }]))).toHaveProperty("error");
    expect(selectDrop(data())).toHaveProperty("error");
    expect(fileError(new File([], "dir", { type: "inode/directory" }))).toContain("Folders");
    expect(fileError({ name: "large", size: 15 * 1024 * 1024 + 1, type: "" } as File)).toContain("15 MB");
  });
});
