import * as path from 'path';
import ignore from 'ignore';
import * as vscode from 'vscode';

import {
  GitIgnoreConfig,
  GitIgnoreError,
  GitIgnoreErrorCode,
  GitIgnoreResult,
  GITIGNORE_CONSTANTS
} from './types';
import { GitIgnoreCache } from './cache';
import { WorkspacePath } from './workspacePath';

type Ignore = ReturnType<typeof ignore>;

export class GitIgnoreHandler {
  private readonly cache: GitIgnoreCache;
  private readonly globalIgnorePatterns: Ignore | null = null;
  private readonly patternCache: Map<string, Ignore> = new Map();

  constructor(
    private readonly config: GitIgnoreConfig,
    private readonly fs: vscode.FileSystem = vscode.workspace.fs
  ) {
    this.cache = new GitIgnoreCache(fs);
    if (config.respectGlobalIgnore) {
      this.initGlobalIgnore();
    }
  }

  public async shouldIgnore(
    filePath: string,
  ): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }
    const workspaceRoot = workspaceFolder.uri.fsPath;

    const result = await this.isIgnored(workspaceRoot, filePath);
    return result.ignored;
  }

  public async isIgnored(
    workspaceRoot: string,
    filePath: string
  ): Promise<GitIgnoreResult> {
    if (!this.config.enabled) {
      return { ignored: false };
    }

    const workspacePath = new WorkspacePath(workspaceRoot);
    const relativePath = await workspacePath.toRelative(filePath);
    // Added at 2024-01-13: Normalize path for ignore library
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // Check global ignore patterns
    if (this.config.respectGlobalIgnore && this.globalIgnorePatterns) {
      if (this.globalIgnorePatterns.ignores(normalizedPath)) {
        return {
          ignored: true,
          source: 'global',
          pattern: 'global_pattern',
          depth: 0
        };
      }
    }

    // Check .git/info/exclude
    const excludeResult = await this.checkExcludeFile(workspaceRoot, normalizedPath);
    if (excludeResult.ignored) {
      return excludeResult;
    }

    // Get all applicable .gitignore files
    const gitignoreFiles = await this.findGitignoreFiles(workspaceRoot, filePath);
    let depth = 0;

    for (const gitignorePath of gitignoreFiles) {
      try {
        const entry = await this.cache.getIgnoreForPath(workspaceRoot, gitignorePath);
        const ig = await this.getIgnoreInstance(entry.patterns);

        if (ig.ignores(normalizedPath)) {
          return {
            ignored: true,
            source: gitignorePath,
            pattern: this.findMatchingPattern(entry.patterns, normalizedPath),
            depth
          };
        }
        depth++;
      } catch (error) {
        // Revised at 2024-01-13: Quieter error handling for missing .gitignore
        console.debug(`Skipping gitignore at ${gitignorePath}`);
      }
    }

    return { ignored: false, depth: -1 };
  }

  public async isIgnoredBatch(
    workspaceRoot: string,
    filePaths: string[]
  ): Promise<Map<string, GitIgnoreResult>> {
    const results = new Map<string, GitIgnoreResult>();
    const workspacePath = new WorkspacePath(workspaceRoot);

    // Group files by directory for efficiency
    const filesByDir = new Map<string, string[]>();
    for (const filePath of filePaths) {
      const dir = path.dirname(filePath);
      const existing = filesByDir.get(dir) || [];
      existing.push(filePath);
      filesByDir.set(dir, existing);
    }

    // Process each directory group
    for (const [dir, files] of filesByDir.entries()) {
      const gitignoreFiles = await this.findGitignoreFiles(workspaceRoot, dir);
      const ignoreInstances = await this.prepareIgnoreInstances(workspaceRoot, gitignoreFiles);

      for (const filePath of files) {
        const relativePath = await workspacePath.toRelative(filePath);
        // Added at 2024-01-13: Normalize path for batch operations
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const result = await this.checkIgnoreRules(
          workspacePath,
          normalizedPath,
          ignoreInstances
        );
        results.set(filePath, result);
      }
    }

    return results;
  }

  private async prepareIgnoreInstances(
    workspaceRoot: string,
    gitignoreFiles: string[]
  ): Promise<Map<string, Ignore>> {
    const instances = new Map<string, Ignore>();

    for (const gitignorePath of gitignoreFiles) {
      try {
        const entry = await this.cache.getIgnoreForPath(workspaceRoot, gitignorePath);
        const ig = await this.getIgnoreInstance(entry.patterns);
        instances.set(gitignorePath, ig);
      } catch {
        // Revised at 2024-01-13: Quieter error handling
        console.debug(`Skipping gitignore preparation for ${gitignorePath}`);
      }
    }

    return instances;
  }

  private async checkIgnoreRules(
    workspacePath: WorkspacePath,
    normalizedPath: string,
    ignoreInstances: Map<string, Ignore>
  ): Promise<GitIgnoreResult> {
    let depth = 0;

    for (const [gitignorePath, ig] of ignoreInstances.entries()) {
      if (ig.ignores(normalizedPath)) {
        return {
          ignored: true,
          source: gitignorePath,
          pattern: await this.findMatchingPattern(
            (await this.cache.getIgnoreForPath(
              workspacePath.toString(),
              gitignorePath
            )).patterns,
            normalizedPath
          ),
          depth
        };
      }
      depth++;
    }

    return { ignored: false, depth: -1 };
  }

  private async checkExcludeFile(
    workspaceRoot: string,
    normalizedPath: string
  ): Promise<GitIgnoreResult> {
    const excludePath = path.join(workspaceRoot, GITIGNORE_CONSTANTS.SYSTEM_IGNORE_PATH);

    try {
      const entry = await this.cache.getIgnoreForPath(workspaceRoot, excludePath);
      const ig = await this.getIgnoreInstance(entry.patterns);

      if (ig.ignores(normalizedPath)) {
        return {
          ignored: true,
          source: excludePath,
          pattern: this.findMatchingPattern(entry.patterns, normalizedPath),
          depth: 0
        };
      }
    } catch {
      // Revised at 2024-01-13: Quieter error handling
      console.debug(`No exclude file found at ${excludePath}`);
    }

    return { ignored: false };
  }

  private async getIgnoreInstance(patterns: string[]): Promise<Ignore> {
    const key = patterns.join('\n');
    let ig = this.patternCache.get(key);

    if (!ig) {
      ig = ignore().add(patterns);
      this.patternCache.set(key, ig);
    }

    return ig;
  }

  private async findGitignoreFiles(workspaceRoot: string, filePath: string): Promise<string[]> {
    const gitignoreFiles: string[] = [];
    let currentPath = filePath;

    while (currentPath.startsWith(workspaceRoot)) {
      const gitignorePath = path.join(path.dirname(currentPath), '.gitignore');

      try {
        await this.fs.stat(vscode.Uri.file(gitignorePath));
        gitignoreFiles.unshift(gitignorePath);
      } catch {
        // Revised at 2024-01-13: Skip silently if no .gitignore exists
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    return gitignoreFiles;
  }

  private findMatchingPattern(patterns: string[], normalizedPath: string): string {
    for (const pattern of patterns) {
      if (!pattern || pattern.startsWith('#')) {
        continue;
      }
      const ig = ignore().add(pattern);
      if (ig.ignores(normalizedPath)) {
        return pattern;
      }
    }
    return '';
  }

  public clearCache(): void {
    this.patternCache.clear();
    this.cache.clear();
  }

  private async initGlobalIgnore(): Promise<void> {
    // Implementation remains unchanged
  }

  public dispose(): void {
    this.cache.dispose();
    this.patternCache.clear();
  }
}