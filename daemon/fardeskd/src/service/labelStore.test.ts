import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { NO_LABEL, createLabelStore } from "./labelStore.js";

const newPath = (): string => join(makeTempDir(), "state", "labels.json");
const onDisk = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("label store", () => {
  it("answers no label for an unknown session", () => {
    expect(createLabelStore(newPath()).get("a")).toEqual(NO_LABEL);
  });

  it("applies a patch: only the keys present change", () => {
    const store = createLabelStore(newPath());
    expect(store.patch("a", { name: "  Release work  ", color: "#1AA1FB" })).toEqual({ name: "Release work", color: "#1AA1FB", pinned: false, image: null });
    expect(store.patch("a", { pinned: true })).toEqual({ name: "Release work", color: "#1AA1FB", pinned: true, image: null });
    expect(store.patch("a", { color: "#F965B5" })).toEqual({ name: "Release work", color: "#F965B5", pinned: true, image: null });
    expect(store.get("a")).toEqual({ name: "Release work", color: "#F965B5", pinned: true, image: null });
  });

  it("stores an empty name as null and clears keys with null", () => {
    const store = createLabelStore(newPath());
    store.patch("a", { name: "Named", color: "#0B9371" });
    expect(store.patch("a", { name: "   " })).toEqual({ name: null, color: "#0B9371", pinned: false, image: null });
    expect(store.patch("a", { color: null })).toEqual(NO_LABEL);
    expect(store.patch("a", { name: null })).toEqual(NO_LABEL);
  });

  it("removes the entry once name and colour are null and pinned is false", () => {
    const path = newPath();
    const store = createLabelStore(path);
    store.patch("a", { pinned: true });
    store.patch("b", { name: "Keep" });
    expect(onDisk(path)).toEqual({ labels: { a: { name: null, color: null, pinned: true, image: null }, b: { name: "Keep", color: null, pinned: false, image: null } } });
    store.patch("a", { pinned: false });
    expect(onDisk(path)).toEqual({ labels: { b: { name: "Keep", color: null, pinned: false, image: null } } });
  });

  it("keeps an image through name, colour and pin changes and clearing them", () => {
    const path = newPath();
    const store = createLabelStore(path);
    store.setImage("a", "0123456789abcdef");
    store.patch("a", { name: "Named", color: "#1AA1FB", pinned: true });
    expect(store.get("a").image).toBe("0123456789abcdef");
    store.patch("a", { name: null, color: null, pinned: false });
    expect(onDisk(path)).toEqual({ labels: { a: { name: null, color: null, pinned: false, image: "0123456789abcdef" } } });
    store.setImage("a", null);
    expect(onDisk(path)).toEqual({ labels: {} });
  });

  it("reads a label stored before chat images existed as image null", () => {
    const path = newPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ labels: { a: { name: "Old", color: null, pinned: false } } }));
    expect(createLabelStore(path).get("a")).toEqual({ name: "Old", color: null, pinned: false, image: null });
  });

  it("survives a reload", () => {
    const path = newPath();
    createLabelStore(path).patch("a", { name: "Persisted", color: "#8F36C5", pinned: true });
    expect(createLabelStore(path).get("a")).toEqual({ name: "Persisted", color: "#8F36C5", pinned: true, image: null });
  });

  it("fails loudly on a corrupt file", () => {
    const path = newPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ labels: { a: { name: null, color: "#ff0000", pinned: true } } }));
    expect(() => createLabelStore(path)).toThrow(/label store/);
  });
});
