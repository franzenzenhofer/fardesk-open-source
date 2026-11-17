import { z } from "zod";
import { contractSchemas, type ContractName } from "./schema.js";

export const SCHEMA_ID_BASE = "https://fardesk.local/schema/";
const JSON_INDENT = 2;

export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

export function contractNames(): readonly ContractName[] {
  return Object.keys(contractSchemas) as ContractName[];
}

export function schemaFileName(name: ContractName): string {
  return `${name}.schema.json`;
}

export function contractJsonSchema(name: ContractName): JsonSchemaDocument {
  const { $schema, ...definition } = z.toJSONSchema(contractSchemas[name] as z.ZodType, {
    target: "draft-2020-12",
    reused: "inline",
  });
  return { $schema, $id: `${SCHEMA_ID_BASE}${schemaFileName(name)}`, ...definition };
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}
