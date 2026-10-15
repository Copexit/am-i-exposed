export interface SealedEnvelope {
  format: "am-i-exposed-sealed";
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  gzip: boolean;
  ct: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

const DEFAULT_ITERATIONS = 600000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 10000000;

export function isSealedEnvelope(x: unknown): x is SealedEnvelope {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    e.format === "am-i-exposed-sealed" &&
    e.v === 1 &&
    e.kdf === "PBKDF2-SHA256" &&
    typeof e.iterations === "number" &&
    Number.isInteger(e.iterations) &&
    typeof e.salt === "string" &&
    typeof e.iv === "string" &&
    typeof e.gzip === "boolean" &&
    typeof e.ct === "string"
  );
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(
  data: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(data).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  // NFC: the same password typed on another OS (which may compose accents differently) opens the file
  const base = await subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealJson(
  value: unknown,
  password: string,
  opts?: { iterations?: number },
): Promise<SealedEnvelope> {
  const iterations = opts?.iterations ?? DEFAULT_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  let data: Uint8Array<ArrayBuffer> = new TextEncoder().encode(JSON.stringify(value));
  const gzip = typeof CompressionStream !== "undefined";
  if (gzip) data = await pipe(data, new CompressionStream("gzip"));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return {
    format: "am-i-exposed-sealed",
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: toB64(salt),
    iv: toB64(iv),
    gzip,
    ct: toB64(ct),
  };
}

export async function openJson<T = unknown>(env: SealedEnvelope, password: string): Promise<T> {
  if (!isSealedEnvelope(env)) throw new Error("Invalid sealed file");
  if (env.iterations < MIN_ITERATIONS || env.iterations > MAX_ITERATIONS) {
    throw new Error("Invalid sealed file: iteration count out of range");
  }
  let salt: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>;
  try {
    salt = fromB64(env.salt);
    iv = fromB64(env.iv);
    ct = fromB64(env.ct);
  } catch {
    throw new Error("Invalid sealed file: bad encoding");
  }
  if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid sealed file: bad salt or iv");
  const key = await deriveKey(password, salt, env.iterations);
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  } catch {
    throw new WrongPasswordError();
  }
  try {
    if (env.gzip) plain = await pipe(plain, new DecompressionStream("gzip"));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new Error("Sealed file content is malformed");
  }
}
