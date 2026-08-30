import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

@Injectable()
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.entries.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      value,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}
