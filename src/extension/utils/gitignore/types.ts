import * as vscode from 'vscode';

/**
 * Configuration options for GitIgnore handling
 */
export interface GitIgnoreConfig {
  /** Master switch for gitignore functionality */
  enabled: boolean;

  /** Whether to respect global gitignore files */
  respectGlobalIgnore: boolean;

  /** Whether to respect nested .gitignore files */
  respectNestedIgnores: boolean;

  /** Cache timeout in milliseconds */
  cacheTimeout: number;

  /** Workspace-specific overrides */
  workspaceOverrides?: Map<string, Partial<GitIgnoreConfig>>;
}

/**
 * Error codes for GitIgnore operations
 */
export enum GitIgnoreErrorCode {
  /** Error parsing gitignore patterns */
  PARSE_ERROR = 'PARSE_ERROR',

  /** Error accessing gitignore file */
  ACCESS_ERROR = 'ACCESS_ERROR',

  /** Invalid path format or location */
  INVALID_PATH = 'INVALID_PATH',

  /** Workspace-related error */
  WORKSPACE_ERROR = 'WORKSPACE_ERROR',

  /** Cache operation error */
  CACHE_ERROR = 'CACHE_ERROR'
}

/**
 * Custom error class for GitIgnore operations
 */
export class GitIgnoreError extends Error {
  constructor(
    message: string,
    public readonly code: GitIgnoreErrorCode,
    public readonly path: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'GitIgnoreError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GitIgnoreError);
    }
  }

  /**
   * Creates a formatted error message including path and cause
   */
  public getDetailedMessage(): string {
    let message = `${this.message} (${this.code}) at ${this.path}`;
    if (this.cause) {
      message += `\nCaused by: ${this.cause.message}`;
    }
    return message;
  }
}

/**
 * Cache entry for gitignore patterns
 * All paths stored should use forward slashes
 */
export interface GitIgnoreCacheEntry {
  /** Raw gitignore patterns (normalized to use forward slashes) */
  patterns: string[];

  /** Last update timestamp */
  timestamp: number;

  /** Nested .gitignore files (paths normalized to use forward slashes) */
  nestedIgnores: Map<string, GitIgnoreCacheEntry>;

  /** File hash for change detection */
  fileHash?: string;

  /** Original file path (normalized to use forward slashes) */
  sourcePath: string;
}

/**
 * Result of a gitignore check
 */
export interface GitIgnoreResult {
  /** Whether the path is ignored */
  ignored: boolean;

  /** Source of the ignore rule (normalized to use forward slashes) */
  source?: string;

  /** Matching pattern */
  pattern?: string;

  /** Distance from nearest .gitignore */
  depth?: number;
}

/**
 * Constants used in GitIgnore handling
 */
export const GITIGNORE_CONSTANTS = {
  /** Default cache timeout in milliseconds */
  DEFAULT_CACHE_TIMEOUT: 5000,

  /** Standard locations for global gitignore files */
  GLOBAL_GITIGNORE_PATHS: [
    '~/.gitignore',
    '~/.config/git/ignore'
  ],

  /** Repository-specific excludes file */
  SYSTEM_IGNORE_PATH: '.git/info/exclude',

  /** Maximum depth for nested .gitignore files */
  MAXIMUM_NESTED_DEPTH: 10,

  /** Hash algorithm for file change detection */
  HASH_ALGORITHM: 'sha1'
} as const;

/**
 * Path format options for consistent handling
 * Added at 2024-01-13: New interface for path handling
 */
export interface PathOptions {
  /** Whether to normalize backslashes to forward slashes */
  normalizeSlashes: boolean;

  /** Whether to normalize case (lowercase on Windows) */
  normalizeCase: boolean;

  /** Whether to resolve symlinks */
  resolveSymlinks: boolean;
}

/**
 * Default path options
 * Added at 2024-01-13: Default settings for path handling
 */
export const DEFAULT_PATH_OPTIONS: PathOptions = {
  normalizeSlashes: true,
  normalizeCase: process.platform === 'win32',
  resolveSymlinks: true
} as const;

/**
 * Validates a GitIgnoreConfig object
 */
export function validateConfig(config: Partial<GitIgnoreConfig>): GitIgnoreConfig {
  return {
    enabled: config.enabled ?? true,
    respectGlobalIgnore: config.respectGlobalIgnore ?? true,
    respectNestedIgnores: config.respectNestedIgnores ?? true,
    cacheTimeout: config.cacheTimeout ?? GITIGNORE_CONSTANTS.DEFAULT_CACHE_TIMEOUT,
    workspaceOverrides: config.workspaceOverrides
  };
}

/**
 * Path normalization utility
 * Added at 2024-01-13: Helper function for consistent path normalization
 */
export function normalizePath(
  path: string,
  options: Partial<PathOptions> = DEFAULT_PATH_OPTIONS
): string {
  let normalized = path;

  if (options.normalizeSlashes ?? DEFAULT_PATH_OPTIONS.normalizeSlashes) {
    normalized = normalized.replace(/\\/g, '/');
  }

  if (options.normalizeCase ?? DEFAULT_PATH_OPTIONS.normalizeCase) {
    if (process.platform === 'win32') {
      // Normalize Windows drive letter case
      normalized = normalized.replace(/^[A-Z]:/, letter => letter.toLowerCase());
      // Normalize path case on Windows
      normalized = normalized.toLowerCase();
    }
  }

  return normalized;
}

/**
 * Type guard for GitIgnoreError
 * Added at 2024-01-13: Helper for error type checking
 */
export function isGitIgnoreError(error: unknown): error is GitIgnoreError {
  return error instanceof GitIgnoreError;
}

/**
 * Interface for path resolution context
 * Added at 2024-01-13: Context for path resolution operations
 */
export interface PathResolutionContext {
  /** Base directory for relative path resolution */
  baseDir: string;

  /** Path normalization options */
  options: PathOptions;

  /** Whether to throw on resolution failure */
  throwOnError: boolean;
}

/**
 * Default path resolution context
 * Added at 2024-01-13: Default settings for path resolution
 */
export const DEFAULT_PATH_RESOLUTION_CONTEXT: PathResolutionContext = {
  baseDir: process.cwd(),
  options: DEFAULT_PATH_OPTIONS,
  throwOnError: true
} as const;