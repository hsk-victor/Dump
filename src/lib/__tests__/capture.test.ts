import { describe, expect, it } from "vitest";
import { canSubmit, dragOverError, extractDropUrl, fileError, selectDrop, submitsEditor } from "../capture";

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

describe("dragover classification", () => {
  const hover = (items: unknown[], types: string[] = ["Files"], files: File[] = []) => ({ items, types, files }) as unknown as Pick<DataTransfer, "items" | "types" | "files">;
  it("rejects multiple protected file entries even when files are not exposed", () => {
    expect(dragOverError(hover([{ kind: "file" }, { kind: "file" }]))).toBe("Dump one item at a time.");
    expect(dragOverError(hover([], ["Files"], [new File([], "a"), new File([], "b")]))).toBe("Dump one item at a time.");
  });
  it("keeps single files, images and possible links accepted in protected mode", () => {
    expect(dragOverError(hover([{ kind: "file", type: "image/png" }]))).toBeNull();
    expect(dragOverError(hover([{ kind: "file", type: "application/pdf" }, { kind: "string", type: "text/plain" }]))).toBeNull();
    for (const type of ["text/plain", "text/uri-list"]) expect(dragOverError(hover([{ kind: "string", type }], [type]))).toBeNull();
    expect(dragOverError(hover([], ["Files"]))).toBeNull();
  });
  it("rejects empty, unsupported, folder and detectably oversized payloads", () => {
    expect(dragOverError(hover([], []))).toContain("Drop one HTTP");
    expect(dragOverError(hover([{ kind: "string", type: "text/html" }], ["text/html"]))).toContain("Drop one HTTP");
    expect(dragOverError(hover([{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }]))).toContain("Folders");
    expect(dragOverError(hover([{ kind: "file", type: "inode/directory" }]))).toContain("Folders");
    expect(dragOverError(hover([{ kind: "file", getAsFile: () => ({ name: "large", type: "", size: 15 * 1024 * 1024 + 1 }) }]))).toContain("15 MB");
  });
});
