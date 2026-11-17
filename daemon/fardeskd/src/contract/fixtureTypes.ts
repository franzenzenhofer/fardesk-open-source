import type { z } from "zod";
import type { ContractName, contractSchemas } from "./schema.js";

export type FixtureCases<Name extends ContractName> = Readonly<Record<string, z.input<(typeof contractSchemas)[Name]>>>;

export type FixtureCase<Name extends ContractName> = z.input<(typeof contractSchemas)[Name]>;

export type ContractFixtures = { readonly [Name in ContractName]: FixtureCases<Name> };
