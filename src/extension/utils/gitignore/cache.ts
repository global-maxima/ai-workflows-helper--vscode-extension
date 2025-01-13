import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  GitIgnoreError,
  GitIgnoreErrorCode,
  GitIgnoreCacheEntry,
  GITIGNORE_CONSTANTS
} from './types';
import { WorkspacePath } from './workspacePath';

interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  lastCleanup: number;
}

export class GitIgnoreCache {
  private cache: Map<string, GitIgnoreCacheEntry> = new Map();
  private workspacePaths: Map<string, WorkspacePath> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
    lastCleanup: Date.now()
  };
  private readonly maxCacheSize: number;
  private cleanupTimeout?: NodeJS.Timeout;
  private readonly cleanupInterval: number;

  constructor(
    private readonly fs: vscode.FileSystem = vscode.workspace.fs,
    options: {
      maxCacheSize?: number;
      cleanupInterval?: number;
    } = {}
  ) {
    this.maxCacheSize = options.maxCacheSize || 1000;
    this.cleanupInterval = options.cleanupInterval || GITIGNORE_CONSTANTS.DEFAULT_CACHE_TIMEOUT;
    this.scheduleCleanup();
  }

  /**
   * Normalizes a path for cache key generation
   */
  private normalizeCachePath(inputPath: string): string {
    // Added at 2024-01-13: Ensure consistent cache keys
    return inputPath.replace(/\\/g, '/').toLowerCase();
  }

  public async getIgnoreForPath(
    workspaceRoot: string,
    filePath: string,
    includeNested: boolean = true
  ): Promise<GitIgnoreCacheEntry> {
    const workspacePath = this.getWorkspacePath(workspaceRoot);
    const absolutePath = await workspacePath.toAbsolute(filePath);
    // Added at 2024-01-13: Normalize cache key
    const cacheKey = this.normalizeCachePath(absolutePath);

    const cacheEntry = this.cache.get(cacheKey);
    if (cacheEntry && await this.isCacheValid(cacheEntry)) {
      this.stats.hits++;
      return cacheEntry;
    }

    this.stats.misses++;
    const entry = await this.loadAndCacheIgnore(workspacePath, absolutePath);

    if (includeNested) {
      await this.loadNestedIgnores(workspacePath, entry);
    }

    return entry;
  }

  private async loadAndCacheIgnore(
    workspacePath: WorkspacePath,
    absolutePath: string
  ): Promise<GitIgnoreCacheEntry> {
    try {
      const content = await this.fs.readFile(vscode.Uri.file(absolutePath));
      const fileHash = this.calculateHash(content);

      // Added at 2024-01-13: Normalize patterns before storing
      const patterns = content
        .toString()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(pattern => pattern.replace(/\\/g, '/')); // Normalize pattern slashes

      const entry: GitIgnoreCacheEntry = {
        patterns,
        timestamp: Date.now(),
        nestedIgnores: new Map(),
        fileHash,
        // Added at 2024-01-13: Store normalized source path
        sourcePath: this.normalizeCachePath(absolutePath)
      };

      // Added at 2024-01-13: Use normalized path as cache key
      this.addToCache(this.normalizeCachePath(absolutePath), entry);
      return entry;
    } catch (error) {
      throw new GitIgnoreError(
        'Failed to load gitignore file',
        GitIgnoreErrorCode.ACCESS_ERROR,
        absolutePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async loadNestedIgnores(
    workspacePath: WorkspacePath,
    parentEntry: GitIgnoreCacheEntry,
    depth: number = 0
  ): Promise<void> {
    if (depth >= GITIGNORE_CONSTANTS.MAXIMUM_NESTED_DEPTH) {
      return;
    }

    const parentDir = path.dirname(parentEntry.sourcePath);
    const entries = await this.fs.readDirectory(vscode.Uri.file(parentDir));

    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        // Added at 2024-01-13: Use normalized paths for nested gitignore
        const nestedPath = this.normalizeCachePath(path.join(parentDir, name, '.gitignore'));
        try {
          const nestedEntry = await this.getIgnoreForPath(
            workspacePath.toString(),
            nestedPath,
            false // Prevent infinite recursion
          );
          parentEntry.nestedIgnores.set(nestedPath, nestedEntry);
          await this.loadNestedIgnores(workspacePath, nestedEntry, depth + 1);
        } catch (error) {
          // Revised at 2024-01-13: Quieter error handling for missing .gitignore
          console.debug(`Skipping nested gitignore at ${nestedPath}`);
        }
      }
    }
  }

  private async isCacheValid(entry: GitIgnoreCacheEntry): Promise<boolean> {
    const age = Date.now() - entry.timestamp;
    if (age > this.cleanupInterval) {
      return false;
    }

    try {
      const content = await this.fs.readFile(vscode.Uri.file(entry.sourcePath));
      const currentHash = this.calculateHash(content);
      return currentHash === entry.fileHash;
    } catch {
      return false;
    }
  }

  public invalidateCache(path: string, recursive: boolean = true): void {
    this.stats.invalidations++;
    // Added at 2024-01-13: Normalize path for cache invalidation
    const normalizedPath = this.normalizeCachePath(path);
    this.cache.delete(normalizedPath);

    if (recursive) {
      for (const [cachePath, entry] of this.cache.entries()) {
        const normalizedCachePath = this.normalizeCachePath(cachePath);
        if (entry.nestedIgnores.has(normalizedPath) ||
          normalizedCachePath.startsWith(normalizedPath)) {
          this.cache.delete(cachePath);
        }
      }
    }
  }

  private calculateHash(content: Uint8Array): string {
    return crypto
      .createHash(GITIGNORE_CONSTANTS.HASH_ALGORITHM)
      .update(content)
      .digest('hex');
  }

  private addToCache(path: string, entry: GitIgnoreCacheEntry): void {
    if (this.cache.size >= this.maxCacheSize) {
      this.performCacheEviction();
    }
    // Added at 2024-01-13: Use normalized path as cache key
    this.cache.set(this.normalizeCachePath(path), entry);
  }

  private getWorkspacePath(workspaceRoot: string): WorkspacePath {
    // Added at 2024-01-13: Normalize workspace root for cache key
    const normalizedRoot = this.normalizeCachePath(workspaceRoot);
    let workspacePath = this.workspacePaths.get(normalizedRoot);
    if (!workspacePath) {
      workspacePath = new WorkspacePath(workspaceRoot, this.fs);
      this.workspacePaths.set(normalizedRoot, workspacePath);
    }
    return workspacePath;
  }

  private performCacheEviction(): void {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = Math.floor(this.maxCacheSize * 0.2); // Remove 20%
    entries.slice(0, toRemove).forEach(([key]) => this.cache.delete(key));
  }

  private scheduleCleanup(): void {
    this.cleanupTimeout = setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [path, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.cleanupInterval) {
          this.cache.delete(path);
          cleanedCount++;
        }
      }

      this.stats.lastCleanup = now;
      if (cleanedCount > 0) {
        console.debug(`Cleaned up ${cleanedCount} expired cache entries`);
      }
    }, this.cleanupInterval);
  }

  public clear(): void {
    this.cache.clear();
    this.workspacePaths.clear();
  }

  public dispose(): void {
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
    }
    this.cache.clear();
    this.workspacePaths.clear();
  }

  public getStats(): Readonly<CacheStats> {
    return { ...this.stats };
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}