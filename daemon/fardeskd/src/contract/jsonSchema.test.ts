import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { contractFixtures } from "./fixtures.js";
import { contractJsonSchema, contractNames, formatJson, schemaFileName, SCHEMA_ID_BASE } from "./jsonSchema.js";
import { contractSchemas, type ContractName } from "./schema.js";

const ajv = new Ajv2020({ strict: true, validateFormats: false, allErrors: true });
for (const name of contractNames()) ajv.addSchema(contractJsonSchema(name), name);

function ajvAccepts(name: ContractName, value: unknown): boolean {
  const validate = ajv.getSchema(name);
  if (validate === undefined) throw new Error(`schema ${name} not registered`);
  return validate(value) as boolean;
}

function firstFixture(name: ContractName): Record<string, unknown> {
  const first: unknown = Object.values(contractFixtures[name])[0];
  return structuredClone(first) as Record<string, unknown>;
}

function withoutFirstKey(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).slice(1));
}

function withFirstKeyWrongType(value: Record<string, unknown>): Record<string, unknown> {
  const [firstKey] = Object.keys(value);
  return { ...value, [firstKey as string]: { unexpected: true } };
}

/** Patch bodies: every key is optional, so leaving one out is valid by design. */
const PATCH_CONTRACTS: readonly ContractName[] = ["LabelRequest"];



function invalidValues(name: ContractName): readonly unknown[] {
  const base = firstFixture(name);
  return [
    ...(PATCH_CONTRACTS.includes(name) ? [] : [withoutFirstKey(base)]),
    withFirstKeyWrongType(base),
    "not an object",
    null,
  ];
}

describe("generated JSON Schema documents", () => {
  it("gives every contract name a stable $id and the 2020-12 dialect", () => {
    for (const name of contractNames()) {
      const document = contractJsonSchema(name);
      expect(document.$id).toBe(`${SCHEMA_ID_BASE}${name}.schema.json`);
      expect(document.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schemaFileName(name)).toBe(`${name}.schema.json`);
    }
  });

  it("lists every name of contractSchemas exactly once", () => {
    expect([...contractNames()].sort()).toEqual(Object.keys(contractSchemas).sort());
  });

  it("puts $schema and $id first and is deterministic", () => {
    for (const name of contractNames()) {
      expect(Object.keys(contractJsonSchema(name)).slice(0, 2)).toEqual(["$schema", "$id"]);
      expect(formatJson(contractJsonSchema(name))).toBe(formatJson(contractJsonSchema(name)));
    }
  });

  it("formats JSON with two spaces and a trailing newline", () => {
    expect(formatJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  it("uses no $ref so every document stands alone", () => {
    for (const name of contractNames()) {
      expect(formatJson(contractJsonSchema(name))).not.toContain("$ref");
    }
  });
});

describe("fixtures against the generated JSON Schema", () => {
  for (const name of contractNames()) {
    for (const [caseName, value] of Object.entries(contractFixtures[name])) {
      it(`${name}/${caseName} validates with ajv`, () => {
        expect(ajvAccepts(name, JSON.parse(formatJson(value)))).toBe(true);
      });
    }
  }
});

describe("invalid values are rejected by zod and ajv", () => {
  for (const name of contractNames()) {
    it(`${name} rejects a missing field, a wrong type and a non-object`, () => {
      for (const value of invalidValues(name)) {
        expect(contractSchemas[name].safeParse(value).success).toBe(false);
        expect(ajvAccepts(name, value)).toBe(false);
      }
    });
  }

  for (const name of contractNames().filter((each) => !Array.isArray(firstFixture(each)))) {
    // Every contract is read tolerantly: a field a newer 4.x adds is dropped, never an error (VERSIONING.md, section 3).
    it(`${name} accepts an unknown extra field and drops it`, () => {
      for (const value of Object.values(contractFixtures[name])) {
        const parsed = contractSchemas[name].safeParse({ ...(value as Record<string, unknown>), fieldFromANewerApp: { nested: true } });
        expect(parsed.success).toBe(true);
        expect(parsed.data).toEqual(value);
      }
    });
  }

  const wrongEnums: readonly (readonly [ContractName, Record<string, unknown>])[] = [
    ["SessionSummary", { ...firstFixture("SessionSummary"), status: "paused" }],
    ["SessionSummary", { ...firstFixture("SessionSummary"), replyMode: "shout" }],
    ["Machine", { ...firstFixture("Machine"), os: "windows" }],
    ["PermissionRequest", { decision: "maybe" }],
    ["DeviceRequest", { ...firstFixture("DeviceRequest"), environment: "staging" }],
    ["DeviceRequest", { ...firstFixture("DeviceRequest"), apnsToken: "not-hex" }],
    ["ErrorResponse", { error: { code: "teapot", message: "x" } }],
    ["Activity", { ...firstFixture("Activity"), kind: "video" }],
    ["StreamEvent", { type: "goodbye" }],
    ["OkResult", { ok: false }],
  ];

  it.each(wrongEnums)("%s rejects a wrong enum or pattern value", (name, value) => {
    expect(contractSchemas[name].safeParse(value).success).toBe(false);
    expect(ajvAccepts(name, value)).toBe(false);
  });

  it("fails loudly when asked for an unregistered schema", () => {
    expect(() => ajvAccepts("Nope" as ContractName, {})).toThrow("not registered");
  });
});
