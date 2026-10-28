export const MAX_PENDING_IMPORT_PREVIEWS = 8
export const MAX_PENDING_IMPORT_PREVIEW_MEMORY_BYTES = 32 * 1024 * 1024
const MEMORY_ACCOUNTING_MULTIPLIER = 4

export type PreviewCacheValue = { token: string; expiresAt: number }
export type PreviewCacheMeasure<T> = (value: T) => number

type CacheEntry<T> = { value: T; memoryBytes: number }

/**
 * Charge four times the UTF-8 JSON size to conservatively account for retained
 * JavaScript strings, row objects, and container overhead. The aggregate charge
 * is capped independently of the entry count.
 */
export function estimatePreviewMemoryBytes(value: unknown): number {
  const serialized = JSON.stringify(value)
  return Buffer.byteLength(serialized ?? '', 'utf8') * MEMORY_ACCOUNTING_MULTIPLIER
}

export class BoundedPreviewCache<T extends PreviewCacheValue> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private currentMemoryBytes = 0

  constructor(
    readonly maxEntries = MAX_PENDING_IMPORT_PREVIEWS,
    readonly maxMemoryBytes = MAX_PENDING_IMPORT_PREVIEW_MEMORY_BYTES,
    private readonly measureBytes: PreviewCacheMeasure<T> = estimatePreviewMemoryBytes,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer')
    if (!Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes < 1) throw new RangeError('maxMemoryBytes must be a positive integer')
  }

  get size(): number { return this.entries.size }
  get memoryBytes(): number { return this.currentMemoryBytes }

  get(token: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(token)
    if (!entry) return undefined
    if (entry.value.expiresAt <= now) {
      this.delete(token)
      return undefined
    }
    return entry.value
  }

  set(value: T, now = Date.now()): boolean {
    this.prune(now)
    const memoryBytes = this.measureBytes(value)
    if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 0 || memoryBytes > this.maxMemoryBytes) return false

    this.delete(value.token)
    while (this.entries.size >= this.maxEntries || this.currentMemoryBytes + memoryBytes > this.maxMemoryBytes) {
      const oldestToken = this.entries.keys().next().value as string | undefined
      if (oldestToken === undefined) break
      this.delete(oldestToken)
    }
    this.entries.set(value.token, { value, memoryBytes })
    this.currentMemoryBytes += memoryBytes
    return true
  }

  delete(token: string): boolean {
    const entry = this.entries.get(token)
    if (!entry) return false
    this.entries.delete(token)
    this.currentMemoryBytes -= entry.memoryBytes
    return true
  }

  prune(now = Date.now()): void {
    for (const [token, entry] of this.entries) {
      if (entry.value.expiresAt <= now) this.delete(token)
    }
  }
}
