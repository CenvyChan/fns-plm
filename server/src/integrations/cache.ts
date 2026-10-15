import { createClient } from "redis";
import type { RedisClientType } from "redis";

type CacheValue = string;
type MemoryEntry = { value: CacheValue; expiresAt: number };

const DEFAULT_TTL_SECONDS = 300;
const MAX_MEMORY_ENTRIES = 1_000;
const MAX_MEMORY_VALUE_BYTES = 1_000_000;

const memory = new Map<string, MemoryEntry>();
let client: RedisClientType | undefined;
let connecting: Promise<void> | undefined;
let redisErrorCount = 0;
let lastRedisErrorAt: string | null = null;

function configuredRedisUrl(): string | undefined {
  const value = process.env.REDIS_URL?.trim();
  return value || undefined;
}

function safeError(_error: unknown): void {
  // Never log the error object: Redis errors may include URLs, credentials or commands.
  redisErrorCount += 1;
  lastRedisErrorAt = new Date().toISOString();
}

function cleanExpired(now = Date.now()): void {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  // Refresh insertion order for a simple LRU eviction policy.
  memory.delete(key);
  memory.set(key, entry);
  return entry.value;
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  cleanExpired();
  if (Buffer.byteLength(value, "utf8") > MAX_MEMORY_VALUE_BYTES) return;
  memory.delete(key);
  while (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
}

async function connectRedis(): Promise<RedisClientType | undefined> {
  const url = configuredRedisUrl();
  if (!url) return undefined;
  if (!client) {
    const next = createClient({ url });
    next.on("error", safeError);
    client = next;
  }
  if (!client.isOpen) {
    connecting ??= client.connect()
      .then(() => undefined)
      .catch((error: unknown) => {
        safeError(error);
        try { client?.disconnect(); } catch { /* ignore cleanup details */ }
      })
      .finally(() => { connecting = undefined; });
    await connecting;
  }
  return client?.isReady ? client : undefined;
}

export async function initializeCache(): Promise<void> {
  await connectRedis();
}

export async function closeCache(): Promise<void> {
  const active = client;
  client = undefined;
  if (!active?.isOpen) return;
  try { await active.quit(); }
  catch { try { await active.disconnect(); } catch { /* ignore cleanup details */ } }
}

export type CacheHealth = {
  configured: boolean;
  redisConnected: boolean;
  backend: "redis" | "memory";
  memoryEntries: number;
  redisErrorCount: number;
  lastRedisErrorAt: string | null;
};

export function cacheHealth(): CacheHealth {
  const redisConnected = Boolean(configuredRedisUrl() && client?.isReady);
  return {
    configured: Boolean(configuredRedisUrl()),
    redisConnected,
    backend: redisConnected ? "redis" : "memory",
    memoryEntries: memory.size,
    redisErrorCount,
    lastRedisErrorAt,
  };
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    const redis = await connectRedis();
    if (redis) {
      const value = await redis.get(key);
      if (value !== null) return value;
    }
  } catch (error) {
    safeError(error);
  }
  return memoryGet(key);
}

export async function cacheSet(key: string, value: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  const ttl = Number.isFinite(ttlSeconds) ? Math.max(1, Math.floor(ttlSeconds)) : DEFAULT_TTL_SECONDS;
  memorySet(key, value, ttl);
  try {
    const redis = await connectRedis();
    if (redis) await redis.set(key, value, { EX: ttl });
  } catch (error) {
    safeError(error);
  }
}

export async function cacheSetIfAbsent(key: string, value: string, ttlSeconds = 300): Promise<boolean> {
  const ttl = Number.isFinite(ttlSeconds) ? Math.max(1, Math.floor(ttlSeconds)) : 300;
  try {
    const redis = await connectRedis();
    if (redis) return (await redis.set(key, value, { EX: ttl, NX: true })) === "OK";
  } catch (error) {
    safeError(error);
  }
  if (memoryGet(key) !== null) return false;
  memorySet(key, value, ttl);
  return true;
}

export async function cacheDeleteByPrefix(prefix: string): Promise<number> {
  let deleted = 0;
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      deleted += 1;
    }
  }
  try {
    const redis = await connectRedis();
    if (redis) {
      let cursor = "0";
      do {
        const result = await redis.scan(cursor, { MATCH: `${prefix}*`, COUNT: 200 });
        cursor = result.cursor;
        if (result.keys.length) deleted += await redis.del(result.keys);
      } while (cursor !== "0");
    }
  } catch (error) {
    safeError(error);
  }
  return deleted;
}
