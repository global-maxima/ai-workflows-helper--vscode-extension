// src/extension/utils/gitignore/workspacePath.ts

import * as path from 'path';
import * as vscode from 'vscode';
import { GitIgnoreError, GitIgnoreErrorCode } from './types';

/**
 * The WorkspacePath class provides utility methods for converting
 * between absolute and relative paths within the workspace.
 */
export class WorkspacePath {
  private workspaceRoot: string;
  private fs: vscode.FileSystem;

  /**
   * Constructs a new WorkspacePath instance.
   * @param workspaceRoot - The root path of the workspace.
   * @param fs - The file system interface (defaults to vscode.workspace.fs).
   * @throws {GitIgnoreError} If the workspace root is not defined.
   */
  constructor(workspaceRoot: string, fs: vscode.FileSystem = vscode.workspace.fs) {
    if (!workspaceRoot) {
      throw new GitIgnoreError(
        'Workspace root is not defined',
        GitIgnoreErrorCode.WORKSPACE_ERROR,
        workspaceRoot
      );
    }
    this.workspaceRoot = this.normalizePath(workspaceRoot);
    this.fs = fs;
  }

  /**
   * Converts an absolute path to a relative path based on the workspace root.
   * @param absolutePath - The absolute file path to convert.
   * @returns The relative path as a string.
   * @throws {GitIgnoreError} If the path is outside the workspace.
   */
  public async toRelative(absolutePath: string): Promise<string> {
    const normalizedAbsolutePath = this.normalizePath(absolutePath);
    if (!normalizedAbsolutePath.startsWith(this.workspaceRoot)) {
      throw new GitIgnoreError(
        'Path is outside the workspace',
        GitIgnoreErrorCode.INVALID_PATH,
        absolutePath
      );
    }
    const relativePath = path.relative(this.workspaceRoot, normalizedAbsolutePath).replace(/\\/g, '/');
    return relativePath;
  }

  /**
   * Converts a relative path to an absolute path based on the workspace root.
   * @param relativePath - The relative file path to convert.
   * @returns The absolute path as a string.
   */
  public async toAbsolute(relativePath: string): Promise<string> {
    const normalizedRelativePath = this.normalizePath(relativePath);
    const absolutePath = path.join(this.workspaceRoot, normalizedRelativePath).replace(/\\/g, '/');
    return absolutePath;
  }

  /**
   * Returns the workspace root path.
   * @returns The workspace root as a string.
   */
  public toString(): string {
    return this.workspaceRoot;
  }

  /**
   * Normalizes a given path by replacing backslashes with forward slashes
   * and resolving any relative segments.
   * @param inputPath - The path to normalize.
   * @returns The normalized path as a string.
   */
  private normalizePath(inputPath: string): string {
    return path.resolve(inputPath).replace(/\\/g, '/');
  }
}
