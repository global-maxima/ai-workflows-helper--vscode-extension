// src/extension/utils/gitignore/handler.ts
import * as path from 'path';
import ignore from 'ignore';
import * as vscode from 'vscode';
import * as os from 'os';

import {
  GitIgnoreConfig,
  GitIgnoreError,
  GitIgnoreErrorCode,
  GitIgnoreResult,
  GITIGNORE_CONSTANTS
} from './types';
import { GitIgnoreCache } from './cache';

type Ignore = ReturnType<typeof ignore>;

export class GitIgnoreHandler {
  private readonly cache: GitIgnoreCache;
  private globalIgnorePatterns: Ignore | null;
  private readonly patternCache: Map<string, Ignore> = new Map();

  constructor(
    private readonly config: GitIgnoreConfig,
    private readonly fs: vscode.FileSystem = vscode.workspace.fs
  ) {
    this.cache = new GitIgnoreCache(fs);
    this.globalIgnorePatterns = null;
    if (config.respectGlobalIgnore) {
      this.initGlobalIgnore();
    }
  }

  private parseGitignoreContent(content: string): string[] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }

  public async shouldIgnore(filePath: string): Promise<boolean> {
    return (await this.isIgnored(path.dirname(filePath), filePath)).ignored;
  }

  private normalizeGitignorePath(filePath: string): string {
    return path.normalize(filePath).split(path.sep).join('/');
  }

  public async isIgnored(
    baseDir: string,
    filePath: string
  ): Promise<GitIgnoreResult> {
    if (!this.config.enabled || !filePath) {
      if (!filePath) {
        throw new GitIgnoreError(
          'Invalid path',
          GitIgnoreErrorCode.INVALID_PATH,
          filePath
        );
      }
      return { ignored: false };
    }

    const normalizedBase = path.normalize(baseDir);
    const normalizedFile = path.normalize(filePath);
    const relativePath = this.normalizeGitignorePath(
      path.relative(normalizedBase, normalizedFile)
    );

    const gitignoreFiles = await this.findGitignoreFiles(normalizedBase);
    const loadedPatterns = new Map<string, string[]>();

    for (const gitignorePath of gitignoreFiles) {
      try {
        const content = await this.fs.readFile(vscode.Uri.file(gitignorePath));
        const patterns = this.parseGitignoreContent(content.toString());
        loadedPatterns.set(gitignorePath, patterns);
      } catch (error) {
        console.warn(`Failed to read ${gitignorePath}:`, error);
      }
    }

    for (const gitignorePath of gitignoreFiles.reverse()) {
      const patterns = loadedPatterns.get(gitignorePath);
      if (!patterns) { continue; }

      try {
        const ig = await this.getIgnoreInstance(patterns);
        if (ig.ignores(relativePath)) {
          return {
            ignored: true,
            source: gitignorePath,
            pattern: this.findMatchingPattern(patterns, relativePath),
            depth: gitignoreFiles.length - gitignoreFiles.indexOf(gitignorePath) - 1
          };
        }
      } catch (error) {
        console.debug(`Error processing ${gitignorePath}:`, error);
      }
    }

    return { ignored: false, depth: -1 };
  }

  public async isIgnoredBatch(
    baseDir: string,
    filePaths: string[]
  ): Promise<Map<string, GitIgnoreResult>> {
    const results = new Map<string, GitIgnoreResult>();
    const normalizedBase = path.normalize(baseDir);
    const gitignoreFiles = await this.findGitignoreFiles(normalizedBase);
    const loadedPatterns = new Map<string, string[]>();

    for (const gitignorePath of gitignoreFiles) {
      try {
        const content = await this.fs.readFile(vscode.Uri.file(gitignorePath));
        const patterns = this.parseGitignoreContent(content.toString());
        loadedPatterns.set(gitignorePath, patterns);
      } catch (error) {
        console.warn(`Failed to read ${gitignorePath}:`, error);
        continue;
      }
    }

    const ignoreInstances = new Map<string, Ignore>();
    for (const [gitignorePath, patterns] of loadedPatterns.entries()) {
      ignoreInstances.set(gitignorePath, await this.getIgnoreInstance(patterns));
    }

    for (const filePath of filePaths) {
      const relativePath = this.normalizeGitignorePath(
        path.relative(normalizedBase, path.normalize(filePath))
      );

      let isIgnored = false;
      let matchingSource = '';
      let matchingPattern = '';
      let depth = -1;

      for (const gitignorePath of gitignoreFiles.reverse()) {
        const ig = ignoreInstances.get(gitignorePath);
        if (!ig) { continue; }

        if (ig.ignores(relativePath)) {
          isIgnored = true;
          matchingSource = gitignorePath;
          matchingPattern = this.findMatchingPattern(
            loadedPatterns.get(gitignorePath) || [],
            relativePath
          );
          depth = gitignoreFiles.length - gitignoreFiles.indexOf(gitignorePath) - 1;
          break;
        }
      }

      results.set(filePath, {
        ignored: isIgnored,
        source: matchingSource,
        pattern: matchingPattern,
        depth
      });
    }

    return results;
  }

  private async findGitignoreFiles(baseDir: string): Promise<string[]> {
    const gitignoreFiles: string[] = [];
    let currentPath = baseDir;

    while (true) {
      const gitignorePath = path.join(currentPath, '.gitignore');
      try {
        await this.fs.stat(vscode.Uri.file(gitignorePath));
        gitignoreFiles.push(gitignorePath);
      } catch {
        // Skip silently if file doesn't exist
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) { break; }
      currentPath = parentPath;
    }

    return gitignoreFiles;
  }

  private async getIgnoreInstance(patterns: string[]): Promise<Ignore> {
    const normalizedPatterns = patterns.map(p => p.trim()).filter(p => p && !p.startsWith('#'));
    const key = normalizedPatterns.join('\n');
    let ig = this.patternCache.get(key);

    if (!ig) {
      ig = ignore().add(normalizedPatterns);
      this.patternCache.set(key, ig);
    }

    return ig;
  }

  private findMatchingPattern(patterns: string[], normalizedPath: string): string {
    for (const pattern of patterns) {
      if (!pattern || pattern.startsWith('#')) { continue; }
      const trimmedPattern = pattern.trim();
      const ig = ignore().add(trimmedPattern);
      if (ig.ignores(normalizedPath)) { return trimmedPattern; }
    }
    return '';
  }

  public clearCache(): void {
    this.patternCache.clear();
    this.cache.clear();
  }

  private async initGlobalIgnore(): Promise<void> {
    try {
      const homedir = os.homedir();
      const globalPaths = GITIGNORE_CONSTANTS.GLOBAL_GITIGNORE_PATHS.map(p =>
        path.join(homedir, p.replace('~', ''))
      );

      const patterns: string[] = [];
      for (const globalPath of globalPaths) {
        try {
          const content = await this.fs.readFile(vscode.Uri.file(globalPath));
          patterns.push(...this.parseGitignoreContent(content.toString()));
        } catch {
          console.debug(`No global gitignore found at ${globalPath}`);
        }
      }

      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const excludePath = path.join(
            workspaceFolder.uri.fsPath,
            GITIGNORE_CONSTANTS.SYSTEM_IGNORE_PATH
          );
          const content = await this.fs.readFile(vscode.Uri.file(excludePath));
          patterns.push(...this.parseGitignoreContent(content.toString()));
        }
      } catch {
        console.debug('No repository-specific excludes found');
      }

      if (patterns.length > 0) {
        this.globalIgnorePatterns = ignore().add(patterns);
      }
    } catch (error) {
      console.error('Error initializing global ignore patterns:', error);
    }
  }

  public dispose(): void {
    this.cache.clear();
    this.patternCache.clear();
  }
}