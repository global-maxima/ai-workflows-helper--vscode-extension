import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectConfig, isValidDependencyPath } from '../config';
import { FileSystemManager } from '../utils/fileSystem';
import { DependencyResult, DependencyCollectionState, DependencyContext, LanguageHandler } from './types';
import { RustHandler } from './rust';
import { TypeScriptHandler } from './typescript';
import { GitIgnoreHandler } from '../utils/gitignore/handler';

export class DependencyCollector {
  private handlers: Map<string, LanguageHandler>;
  private configCache: Map<string, { handler: LanguageHandler; config: any }>;
  private gitIgnoreHandler: GitIgnoreHandler;
  private fileSystemManager: FileSystemManager;

  constructor(gitIgnoreHandler: GitIgnoreHandler) {
    const handlers = new Map<string, LanguageHandler>();
    handlers.set('rust', new RustHandler());
    handlers.set('typescript', new TypeScriptHandler());
    handlers.set('javascript', new TypeScriptHandler());

    this.handlers = handlers;
    this.configCache = new Map();
    this.gitIgnoreHandler = gitIgnoreHandler;
    this.fileSystemManager = new FileSystemManager(gitIgnoreHandler);
  }

  public dispose(): void {
    this.configCache.clear();
  }

  private async getOrCreateHandlerConfig(
    uri: vscode.Uri,
    handler: LanguageHandler
  ): Promise<any> {
    const cacheKey = `${uri.fsPath}-${handler.constructor.name}`;
    let cached = this.configCache.get(cacheKey);

    if (!cached) {
      cached = {
        handler,
        config: await this.initializeHandlerConfig(uri, handler)
      };
      this.configCache.set(cacheKey, cached);
    }

    return cached.config;
  }

  private async initializeHandlerConfig(
    uri: vscode.Uri,
    handler: LanguageHandler
  ): Promise<any> {
    if (handler instanceof TypeScriptHandler) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        return null;
      }

      try {
        const tsconfigPath = path.join(workspaceFolder.uri.fsPath, 'tsconfig.json');
        const tsconfigContent = await vscode.workspace.fs.readFile(vscode.Uri.file(tsconfigPath));
        return JSON.parse(tsconfigContent.toString());
      } catch {
        return null;
      }
    }

    return null;
  }

  private async collectDependenciesWithState(
    uri: vscode.Uri,
    config: ProjectConfig,
    state: DependencyCollectionState
  ): Promise<void> {
    if (state.depth >= (config.maxDepth || 3) || state.visited.has(uri.fsPath)) {
      return;
    }

    // Check if file should be ignored
    if (await this.gitIgnoreHandler.shouldIgnore(uri.fsPath)) {
      return;
    }

    state.visited.add(uri.fsPath);
    state.depth++;

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const handler = this.handlers.get(document.languageId);

      if (!handler) {
        console.log(`No handler found for language: ${document.languageId}`);
        return;
      }

      const handlerConfig = await this.getOrCreateHandlerConfig(uri, handler);
      const locations = await handler.collectLocations(document);

      for (const [depPath, info] of locations) {
        const def = info.location.uri;

        if (!isValidDependencyPath(config, def.fsPath) ||
          config.excludePatterns.some(pattern =>
            def.fsPath.includes(pattern.replace('**', ''))) ||
          await this.gitIgnoreHandler.shouldIgnore(def.fsPath)) {
          continue;
        }

        const relativePath = path.relative(config.rootPath, uri.fsPath);
        let existingDep = state.dependencies.get(def.fsPath);

        if (!existingDep) {
          existingDep = {
            uri: def,
            referencedBy: [relativePath],
            defines: [],
            references: []
          };
          state.dependencies.set(def.fsPath, existingDep);

          await this.collectDependenciesWithState(def, config, state);
        } else if (!existingDep.referencedBy?.includes(relativePath)) {
          existingDep.referencedBy = [...(existingDep.referencedBy || []), relativePath];
        }

        if (info.type === 'definition') {
          existingDep.defines = existingDep.defines || [];
          if (!existingDep.defines.includes(relativePath)) {
            existingDep.defines.push(relativePath);
          }
        } else {
          existingDep.references = existingDep.references || [];
          if (!existingDep.references.includes(relativePath)) {
            existingDep.references.push(relativePath);
          }
        }
      }
    } catch (error) {
      state.dependencies.set(uri.fsPath, {
        uri,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    state.depth--;
  }

  private generateDiagnostics(
    uri: vscode.Uri,
    state: DependencyCollectionState,
    context: { outputted: Set<string> }
  ): string {
    let diagnostics = '/*\n';
    diagnostics += ' * Dependency Collection Diagnostics:\n';
    diagnostics += ` * Focus file: ${uri.fsPath}\n`;
    diagnostics += ` * Total dependencies found: ${state.dependencies.size}\n`;

    const errorCount = Array.from(state.dependencies.values()).filter(d => d.error).length;
    if (errorCount > 0) {
      diagnostics += ` * Errors encountered: ${errorCount}\n`;
    }

    diagnostics += ' * Dependencies:\n';
    for (const [depPath, dep] of state.dependencies.entries()) {
      diagnostics += ` *   - ${depPath}\n`;
      if (dep.error) {
        diagnostics += ` *     Error: ${dep.error}\n`;
      } else {
        diagnostics += ` *     Referenced by: ${dep.referencedBy?.join(', ') || 'none'}\n`;
        if (dep.defines?.length) {
          diagnostics += ` *     Defines: ${dep.defines.join(', ')}\n`;
        }
        if (dep.references?.length) {
          diagnostics += ` *     References: ${dep.references.join(', ')}\n`;
        }
      }
    }

    diagnostics += ' * Already outputted files:\n';
    for (const outputted of context.outputted) {
      diagnostics += ` *   - ${outputted}\n`;
    }
    diagnostics += ' */\n\n';
    return diagnostics;
  }

  public async collectAndStreamDependencies(
    uri: vscode.Uri,
    config: ProjectConfig,
    context: DependencyContext
  ): Promise<{
    textStream: string;
    processedCount: number;
    errorCount: number;
  }> {
    let textStream = '';
    let processedCount = 0;
    let errorCount = 0;

    try {
      const state: DependencyCollectionState = {
        dependencies: new Map(),
        visited: new Set(),
        depth: 0,
        resolutionStrategies: new Set<string>()
      };

      await this.collectDependenciesWithState(uri, config, state);
      textStream += this.generateDiagnostics(uri, state, context);

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (workspaceFolder && !context.outputted.has(uri.fsPath)) {
        // Check gitignore before reading
        if (!await this.gitIgnoreHandler.shouldIgnore(uri.fsPath)) {
          textStream += await FileSystemManager.readFileToStream(uri, workspaceFolder, {
            isFocusFile: true
          });
          context.outputted.add(uri.fsPath);
          processedCount++;
        }
      }

      const sortedDeps = Array.from(state.dependencies.entries())
        .sort(([pathA, depA], [pathB, depB]) => {
          if (!!depA.error !== !!depB.error) {
            return depA.error ? 1 : -1;
          }
          return pathA.localeCompare(pathB);
        });

      for (const [depPath, dep] of sortedDeps) {
        if (context.token.isCancellationRequested) {
          break;
        }

        if (context.outputted.has(depPath)) {
          continue;
        }

        if (dep.error) {
          errorCount++;
          textStream += `--- Error processing ${depPath} ---\n`;
          textStream += `/* Error Context:\n`;
          textStream += ` * - Error: ${dep.error}\n`;
          if (dep.referencedBy?.length) {
            textStream += ` * - Referenced by: ${dep.referencedBy.join(', ')}\n`;
          }
          textStream += ` */\n\n`;
          context.outputted.add(depPath);
          continue;
        }

        const depWorkspaceFolder = vscode.workspace.getWorkspaceFolder(dep.uri);
        if (!depWorkspaceFolder) {
          continue;
        }

        // Check gitignore before reading
        if (!await this.gitIgnoreHandler.shouldIgnore(depPath)) {
          textStream += await FileSystemManager.readFileToStream(
            dep.uri,
            depWorkspaceFolder,
            {
              isFocusFile: context.focusFiles.has(depPath),
              referencedBy: dep.referencedBy,
              defines: dep.defines,
              references: dep.references
            }
          );
          context.outputted.add(depPath);
          processedCount++;
        }

        context.progress.report({
          message: `Processing dependencies... (${processedCount}/${state.dependencies.size} files)`,
          increment: 100 / (state.dependencies.size + 1)
        });
      }
    } catch (error) {
      console.error('Error in collectAndStreamDependencies:', error);
      errorCount++;
      textStream += `/*\n * Critical Error in Dependency Collection:\n * ${error}\n */\n\n`;
    }

    return { textStream, processedCount, errorCount };
  }
}