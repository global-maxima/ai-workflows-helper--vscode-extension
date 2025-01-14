// src/extension/utils/fileSystem.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { GitIgnoreHandler } from './gitignore/handler';

interface FileReadOptions {
  encoding?: BufferEncoding;  // This restricts to valid Buffer encodings
  isFocusFile?: boolean;
  referencedBy?: string[];
  defines?: string[];
  references?: string[];
}

interface FileStreamOptions extends FileReadOptions {
  includeMetadata?: boolean;
  relativePath?: boolean;
}

export class FileSystemManager {
  constructor(
    private readonly gitIgnoreHandler: GitIgnoreHandler,
    private readonly fs: vscode.FileSystem = vscode.workspace.fs
  ) { }



  /**
   * Reads a file's content with gitignore checks
   */
  public async readFile(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    options: FileReadOptions = {}
  ): Promise<string> {
    // Check gitignore before reading
    const ignoreResult = await this.gitIgnoreHandler.isIgnored(
      workspaceFolder.uri.fsPath,
      uri.fsPath
    );

    if (ignoreResult.ignored) {
      throw new Error(
        `File ${uri.fsPath} is ignored by gitignore (${ignoreResult.source})`
      );
    }

    try {
      const content = await this.fs.readFile(uri);
      // The encoding will now be properly typed as BufferEncoding
      return Buffer.from(content).toString(options.encoding || 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file ${uri.fsPath}: ${error}`);
    }
  }

  /**
   * Reads a file and returns its contents as a formatted string stream
   */
  public async readFileToStream(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    options: FileStreamOptions = {}
  ): Promise<string> {
    let content = '';

    // Add file metadata as comments if any metadata options are present
    if (options.isFocusFile || options.referencedBy?.length || options.defines?.length || options.references?.length) {
      content += `/* ${uri.fsPath}\n`;
      if (options.isFocusFile) {
        content += ' * - Focus File\n';
      }
      if (options.referencedBy?.length) {
        content += ` * - Referenced by: ${options.referencedBy.join(', ')}\n`;
      }
      if (options.defines?.length) {
        content += ` * - Defines: ${options.defines.join(', ')}\n`;
      }
      if (options.references?.length) {
        content += ` * - References: ${options.references.join(', ')}\n`;
      }
      content += ' */\n\n';
    }

    try {
      // Check gitignore before reading
      if (await this.gitIgnoreHandler.isIgnored(workspaceFolder.uri.fsPath, uri.fsPath)) {
        return `/* File ${uri.fsPath} is ignored by gitignore */\n`;
      }

      const fileContent = await vscode.workspace.fs.readFile(uri);
      content += Buffer.from(fileContent).toString(options.encoding || 'utf8');
      content += '\n';
    } catch (error) {
      content += `/* Error reading file: ${error} */\n`;
    }

    return content;
  }

  /**
   * Lists files in a directory with gitignore filtering
   */
  public async listFiles(
    directory: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    pattern?: string
  ): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    await this.traverseDirectory(directory, workspaceFolder, files, pattern);
    return files;
  }

  private async traverseDirectory(
    directory: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    accumulator: vscode.Uri[],
    pattern?: string
  ): Promise<void> {
    // Check if directory itself is ignored
    const dirIgnoreResult = await this.gitIgnoreHandler.isIgnored(
      workspaceFolder.uri.fsPath,
      directory.fsPath
    );

    if (dirIgnoreResult.ignored) {
      return;
    }

    try {
      const entries = await this.fs.readDirectory(directory);

      for (const [name, type] of entries) {
        const fullPath = vscode.Uri.file(path.join(directory.fsPath, name));

        // Check if entry is ignored
        const ignoreResult = await this.gitIgnoreHandler.isIgnored(
          workspaceFolder.uri.fsPath,
          fullPath.fsPath
        );

        if (ignoreResult.ignored) {
          continue;
        }

        if (type === vscode.FileType.Directory) {
          await this.traverseDirectory(fullPath, workspaceFolder, accumulator, pattern);
        } else if (type === vscode.FileType.File) {
          if (!pattern || this.matchesPattern(name, pattern)) {
            accumulator.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Error reading directory ${directory.fsPath}:`, error);
    }
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const extension = pattern.slice(1); // Include the dot
      return filename.endsWith(extension);
    }
    return new RegExp(pattern).test(filename);
  }

  /**
   * Checks if a file exists and is not ignored
   */
  public async fileExists(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<boolean> {
    try {
      // Check gitignore first
      const ignoreResult = await this.gitIgnoreHandler.isIgnored(
        workspaceFolder.uri.fsPath,
        uri.fsPath
      );

      if (ignoreResult.ignored) {
        return false;
      }

      await this.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets file metadata with gitignore check
   */
  public async getFileMetadata(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<vscode.FileStat | null> {
    // Check gitignore first
    const ignoreResult = await this.gitIgnoreHandler.isIgnored(
      workspaceFolder.uri.fsPath,
      uri.fsPath
    );

    if (ignoreResult.ignored) {
      return null;
    }

    try {
      return await this.fs.stat(uri);
    } catch {
      return null;
    }
  }

  /**
   * Batch check multiple files against gitignore
   */
  public async filterIgnoredFiles(
    uris: vscode.Uri[],
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<vscode.Uri[]> {
    const results = await this.gitIgnoreHandler.isIgnoredBatch(
      workspaceFolder.uri.fsPath,
      uris.map(uri => uri.fsPath)
    );

    return uris.filter(uri => !results.get(uri.fsPath)?.ignored);
  }

  /**
   * Creates a read stream with gitignore check
   */
  public async createReadStream(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    options: FileReadOptions = {}
  ): Promise<NodeJS.ReadableStream> {
    const content = await this.readFile(uri, workspaceFolder, options);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(content));
        controller.close();
      },
    }) as unknown as NodeJS.ReadableStream;
  }
}

// Helper class for streaming
class ReadableStream implements ReadableStreamDefaultController {
  private controller?: ReadableStreamDefaultController;

  constructor(private readonly source: {
    start: (controller: ReadableStreamDefaultController) => void,
    encoding?: BufferEncoding  // Add encoding option
  }) { }

  enqueue(chunk: string | Buffer, encoding?: BufferEncoding): void {
    if (typeof chunk === 'string') {
      // Convert string to Buffer with proper encoding
      const buffer = Buffer.from(chunk, encoding || 'utf8');
      this.controller?.enqueue(buffer);
    } else {
      this.controller?.enqueue(chunk);
    }
  }

  close(): void {
    this.controller?.close();
  }

  error(reason: any): void {
    this.controller?.error(reason);
  }

  get desiredSize(): number | null {
    return this.controller?.desiredSize ?? null;
  }
}