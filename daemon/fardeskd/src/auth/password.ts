// Password hashing: scrypt with a random salt, stored as `scrypt$N$r$p$salt$hash` (base64 parts).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { FardeskError } from "../core/errors.js";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const SCRYPT_COST = 2 ** 15;
export const SCRYPT_BLOCK_SIZE = 8;
export const SCRYPT_PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCHEME = "scrypt";
const SEPARATOR = "$";
const BASE64 = "base64";
const MEMORY_PER_BLOCK = 128;
const MEMORY_HEADROOM = 2;
const MAX_ACCEPTED_COST = 2 ** 20;
const STORED_PARTS = 6;

type Params = { N: number; r: number; p: number };
type Parsed = { params: Params; salt: Buffer; hash: Buffer };

const memoryFor = ({ N, r, p }: Params): number => MEMORY_PER_BLOCK * N * (r + p) * MEMORY_HEADROOM;

const derive = async (password: string, salt: Buffer, params: Params, keyLength: number): Promise<Buffer> =>
  scryptAsync(password, salt, keyLength, { ...params, maxmem: memoryFor(params) });

function malformed(reason: string): FardeskError {
  return new FardeskError("internal", `stored password hash is malformed: ${reason}`);
}

function parseNumber(text: string, label: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) throw malformed(`${label} is not a positive integer`);
  return value;
}

function parseStored(stored: string): Parsed {
  const parts = stored.split(SEPARATOR);
  if (parts.length !== STORED_PARTS || parts[0] !== SCHEME) throw malformed(`expected ${SCHEME}$N$r$p$salt$hash`);
  const [, cost, blockSize, parallelism, salt, hash] = parts as [string, string, string, string, string, string];
  const params = { N: parseNumber(cost, "N"), r: parseNumber(blockSize, "r"), p: parseNumber(parallelism, "p") };
  if (params.N > MAX_ACCEPTED_COST || (params.N & (params.N - 1)) !== 0) throw malformed("N must be a power of two within limits");
  const parsed = { params, salt: Buffer.from(salt, BASE64), hash: Buffer.from(hash, BASE64) };
  if (parsed.salt.length === 0 || parsed.hash.length === 0) throw malformed("salt or hash is empty");
  return parsed;
}

export async function hashPassword(password: string): Promise<string> {
  const params = { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM };
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, params, KEY_BYTES);
  return [SCHEME, params.N, params.r, params.p, salt.toString(BASE64), hash.toString(BASE64)].join(SEPARATOR);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { params, salt, hash } = parseStored(stored);
  const candidate = await derive(password, salt, params, hash.length);
  return timingSafeEqual(candidate, hash);
}
