// src/extension/withDependencies/typescript.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageHandler } from './types';

export class TypeScriptHandler implements LanguageHandler {
  private tsConfig: any = null;
  // added at 2024-12-17: Track resolution success for diagnostics
  private resolutionStats = {
    configBased: 0,
    fallback: 0,
    failed: 0
  };

  public async collectLocations(
    document: vscode.TextDocument
  ): Promise<Map<string, { location: vscode.Location; type: 'definition' | 'reference' }>> {
    const locations = new Map<string, { location: vscode.Location; type: 'definition' | 'reference' }>();

    try {
      await this.loadProjectConfig(document.uri);
    } catch (error) {
      console.log('Proceeding without tsconfig.json:', error);
    }

    // Reset stats for this collection
    this.resolutionStats = { configBased: 0, fallback: 0, failed: 0 };

    for (let line = 0; line < document.lineCount; line++) {
      const lineText = document.lineAt(line).text;

      const importPatterns = [
        /^\s*import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/,
        /(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        /^\s*import\s+['"]([^'"]+)['"]/,
        /^\s*import\s+type\s+{[^}]*}\s+from\s+['"]([^'"]+)['"]/,
      ];

      for (const pattern of importPatterns) {
        const match = lineText.match(pattern);
        if (match) {
          const modulePath = match[1];
          let resolvedPath = await this.resolveModulePath(document.uri, modulePath);

          if (!resolvedPath) {
            resolvedPath = await this.resolveWithoutConfig(document.uri, modulePath);
            if (resolvedPath) {
              this.resolutionStats.fallback++;
            } else {
              this.resolutionStats.failed++;
              continue;
            }
          } else {
            this.resolutionStats.configBased++;
          }

          if (resolvedPath) {
            locations.set(resolvedPath.fsPath, {
              location: new vscode.Location(resolvedPath, new vscode.Position(0, 0)),
              type: 'definition'
            });
          }
          break;
        }
      }
    }

    // added at 2024-12-17: Log resolution statistics
    console.log('TypeScript dependency resolution stats:', {
      total: this.resolutionStats.configBased + this.resolutionStats.fallback + this.resolutionStats.failed,
      configBased: this.resolutionStats.configBased,
      fallback: this.resolutionStats.fallback,
      failed: this.resolutionStats.failed
    });

    return locations;
  }

  private async loadProjectConfig(documentUri: vscode.Uri): Promise<void> {
    if (this.tsConfig !== null) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (!workspaceFolder) {
      this.tsConfig = {};
      return;
    }

    try {
      const tsconfigPath = path.join(workspaceFolder.uri.fsPath, 'tsconfig.json');
      const tsconfigContent = await vscode.workspace.fs.readFile(vscode.Uri.file(tsconfigPath));
      this.tsConfig = JSON.parse(tsconfigContent.toString());
    } catch (error) {
      this.tsConfig = {};
      throw error;
    }
  }

  private async resolveWithoutConfig(baseUri: vscode.Uri, modulePath: string): Promise<vscode.Uri | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(baseUri);
    if (!workspaceFolder) {
      return null;
    }

    // added at 2024-12-17: Handle workspace-relative paths first
    if (modulePath.startsWith('src/')) {
      const absolutePath = path.join(workspaceFolder.uri.fsPath, modulePath);
      return this.tryExtensions(absolutePath);
    }

    // Handle relative paths
    if (modulePath.startsWith('.')) {
      const basePath = path.dirname(baseUri.fsPath);
      const absolutePath = path.join(basePath, modulePath);
      return this.tryExtensions(absolutePath);
    }

    return null;
  }

  // added at 2024-12-17: Extract extension trying logic
  private async tryExtensions(basePath: string): Promise<vscode.Uri | null> {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    for (const ext of extensions) {
      const fullPath = basePath + ext;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
        return vscode.Uri.file(fullPath);
      } catch {
        // Try next extension
      }
    }

    // Try index files if no extension match
    if (!path.extname(basePath)) {
      for (const ext of extensions) {
        const indexPath = path.join(basePath, 'index' + ext);
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(indexPath));
          return vscode.Uri.file(indexPath);
        } catch {
          // Try next extension
        }
      }
    }

    return null;
  }

  private async resolveModulePath(baseUri: vscode.Uri, modulePath: string): Promise<vscode.Uri | null> {
    if (this.tsConfig?.compilerOptions?.paths) {
      const resolved = await this.resolveFromPaths(baseUri, modulePath);
      if (resolved) {
        return resolved;
      }
    }

    if (this.tsConfig?.compilerOptions?.baseUrl) {
      const resolved = await this.resolveFromBaseUrl(baseUri, modulePath);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  private async resolveFromPaths(baseUri: vscode.Uri, modulePath: string): Promise<vscode.Uri | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(baseUri);
    if (!workspaceFolder || !this.tsConfig?.compilerOptions?.paths) {
      return null;
    }

    const paths = this.tsConfig.compilerOptions.paths;
    for (const [pattern, mappings] of Object.entries(paths) as [string, string[]][]) {
      const regexPattern = pattern
        .replace(/\*/g, '(.*)')
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&');

      const regex = new RegExp(`^${regexPattern}$`);
      const match = modulePath.match(regex);

      if (match) {
        for (const mapping of mappings) {
          const resolvedPath = mapping.replace('*', match[1]);
          const fullPath = path.join(workspaceFolder.uri.fsPath, resolvedPath);

          const resolved = await this.tryExtensions(fullPath);
          if (resolved) {
            return resolved;
          }
        }
      }
    }

    return null;
  }

  private async resolveFromBaseUrl(baseUri: vscode.Uri, modulePath: string): Promise<vscode.Uri | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(baseUri);
    if (!workspaceFolder || !this.tsConfig?.compilerOptions?.baseUrl) {
      return null;
    }

    const baseUrl = path.join(workspaceFolder.uri.fsPath, this.tsConfig.compilerOptions.baseUrl);
    const fullPath = path.join(baseUrl, modulePath);

    return this.tryExtensions(fullPath);
  }
}