import { describe, expect, it } from "vitest";
import { contractFixtures } from "./fixtures.js";
import { contractJsonSchema, contractNames } from "./jsonSchema.js";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type JsonObject = { readonly [key: string]: Json };

const TAG_KEYS = ["kind", "type"] as const;

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: Json | undefined): readonly Json[] {
  return Array.isArray(value) ? (value as readonly Json[]) : [];
}

function keyOf(tag: string, prop: string, detail: string): string {
  return `${tag}|${prop}${detail}`;
}

function valueKey(tag: string, prop: string, value: Json | undefined): string {
  return keyOf(tag, prop, `=${JSON.stringify(value)}`);
}

function schemaTag(node: JsonObject): string {
  const properties = node["properties"];
  if (!isObject(properties)) return "";
  for (const tagKey of TAG_KEYS) {
    const property = properties[tagKey];
    if (isObject(property) && typeof property["const"] === "string") return property["const"];
  }
  return "";
}

function isNullSchema(node: Json): boolean {
  return isObject(node) && node["type"] === "null";
}

/** Every value, union member and null/non-null shape a fixture set must show for this schema node. */
function requiredKeys(node: JsonObject, tag: string, prop: string, out: Set<string>): void {
  if ("const" in node) out.add(valueKey(tag, prop, node["const"]));
  for (const value of asArray(node["enum"])) out.add(valueKey(tag, prop, value));
  if (node["type"] === "boolean" && !("const" in node)) {
    out.add(valueKey(tag, prop, true));
    out.add(valueKey(tag, prop, false));
  }
  const members = [...asArray(node["anyOf"]), ...asArray(node["oneOf"])].filter(isObject);
  if (members.some(isNullSchema)) {
    out.add(keyOf(tag, prop, ":null"));
    out.add(keyOf(tag, prop, ":value"));
  }
  for (const member of members.filter((candidate) => !isNullSchema(candidate))) requiredKeys(member, tag, prop, out);
  if (isObject(node["items"])) requiredKeys(node["items"], tag, prop, out);
  const properties = node["properties"];
  if (isObject(properties)) {
    const childTag = schemaTag(node);
    for (const [childProp, child] of Object.entries(properties)) {
      if (isObject(child)) requiredKeys(child, childTag, childProp, out);
    }
  }
}

function instanceTags(value: JsonObject): readonly string[] {
  const own = TAG_KEYS.map((tagKey) => value[tagKey]).filter((tag): tag is string => typeof tag === "string");
  return ["", ...own];
}

function shownKeys(value: Json, tag: string, prop: string, out: Set<string>): void {
  if (value === null) out.add(keyOf(tag, prop, ":null"));
  else if (Array.isArray(value)) {
    for (const item of value as readonly Json[]) shownKeys(item, tag, prop, out);
  } else if (isObject(value)) {
    for (const childTag of instanceTags(value)) {
      for (const [childProp, child] of Object.entries(value)) shownKeys(child, childTag, childProp, out);
    }
  } else {
    out.add(valueKey(tag, prop, value));
    out.add(keyOf(tag, prop, ":value"));
  }
}

function shownKeysOfFixtures(values: readonly Json[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) shownKeys(value, "", "", out);
  return out;
}

describe("fixture coverage guard", () => {
  for (const name of contractNames()) {
    it(`${name} fixtures show every enum value, union member and null shape`, () => {
      const required = new Set<string>();
      requiredKeys(contractJsonSchema(name) as JsonObject, "", "", required);
      const shown = shownKeysOfFixtures(Object.values(contractFixtures[name]) as Json[]);
      expect([...required].filter((key) => !shown.has(key))).toEqual([]);
    });
  }

  it("actually detects a missing variant", () => {
    const required = new Set<string>();
    requiredKeys(contractJsonSchema("PermissionRequest") as JsonObject, "", "", required);
    const shown = shownKeysOfFixtures([{ decision: "allow" }]);
    expect([...required].filter((key) => !shown.has(key))).toEqual([
      valueKey("", "decision", "deny"),
      valueKey("", "decision", "allow_always"),
      valueKey("", "decision", "approve_bypass"),
      valueKey("", "decision", "approve_manual"),
      valueKey("", "decision", "revise"),
    ]);
  });
});
