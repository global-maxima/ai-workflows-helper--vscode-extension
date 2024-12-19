// config.ts
import * as vscode from 'vscode';

export interface ProjectConfig {
  rootPath: string;
  maxDepth?: number;
  excludePatterns: string[];
}

export class ConfigurationManager {
  private workspaceConfigs: Map<string, ProjectConfig> = new Map();

  public getConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
    let config = this.workspaceConfigs.get(workspaceFolder.uri.fsPath);
    if (!config) {
      config = this.loadConfig(workspaceFolder);
      this.workspaceConfigs.set(workspaceFolder.uri.fsPath, config);
    }
    return config;
  }

  private loadConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
    const configuration = vscode.workspace.getConfiguration('aiWorkflowsHelper', workspaceFolder.uri);
    return {
      rootPath: workspaceFolder.uri.fsPath,
      maxDepth: configuration.get<number>('maxDepth', 3),
      excludePatterns: configuration.get<string[]>('excludePatterns', [])
    };
  }

  public handleWorkspaceFoldersChanged(event: vscode.WorkspaceFoldersChangeEvent): void {
    for (const folder of event.removed) {
      this.workspaceConfigs.delete(folder.uri.fsPath);
    }
    for (const folder of event.added) {
      const config = this.loadConfig(folder);
      this.workspaceConfigs.set(folder.uri.fsPath, config);
    }
  }
}

export function isValidDependencyPath(config: ProjectConfig, filePath: string): boolean {
  return filePath.startsWith(config.rootPath);
}