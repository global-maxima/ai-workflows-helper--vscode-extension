// src/extension/config.ts
import * as vscode from 'vscode';
import { GitIgnoreConfig, validateConfig as validateGitIgnoreConfig } from './utils/gitignore/types';

export interface ProjectConfig {
  rootPath: string;
  maxDepth: number;
  excludePatterns: string[];
  gitignore: GitIgnoreConfig;
  version: number;
}

const DEFAULT_CONFIG: Omit<ProjectConfig, 'rootPath'> = {
  maxDepth: 3,
  excludePatterns: [],
  gitignore: {
    enabled: true,
    respectGlobalIgnore: true,
    respectNestedIgnores: true,
    cacheTimeout: 5000,
    workspaceOverrides: new Map()
  },
  version: 1
};

export class ConfigManager {
  private workspaceConfigs: Map<string, ProjectConfig> = new Map();
  private readonly configurationChangeListener: vscode.Disposable;

  constructor() {
    this.configurationChangeListener = vscode.workspace.onDidChangeConfiguration(
      this.handleConfigurationChanged.bind(this)
    );
  }

  public get(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
    return this.getConfig(workspaceFolder);
  }

  public getConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
    let config = this.workspaceConfigs.get(workspaceFolder.uri.fsPath);
    if (!config) {
      config = this.loadConfig(workspaceFolder);
      this.workspaceConfigs.set(workspaceFolder.uri.fsPath, config);
    }
    return config;
  }

  private loadConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
    const configuration = vscode.workspace.getConfiguration('ai-workflows-helper', workspaceFolder.uri);

    const rawConfig = {
      rootPath: workspaceFolder.uri.fsPath,
      maxDepth: configuration.get<number>('maxDepth', DEFAULT_CONFIG.maxDepth),
      excludePatterns: configuration.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns),
      gitignore: {
        enabled: configuration.get<boolean>('gitignore.enabled', DEFAULT_CONFIG.gitignore.enabled),
        respectGlobalIgnore: configuration.get<boolean>(
          'gitignore.respectGlobalIgnore',
          DEFAULT_CONFIG.gitignore.respectGlobalIgnore
        ),
        respectNestedIgnores: configuration.get<boolean>(
          'gitignore.respectNestedIgnores',
          DEFAULT_CONFIG.gitignore.respectNestedIgnores
        ),
        cacheTimeout: configuration.get<number>(
          'gitignore.cacheTimeout',
          DEFAULT_CONFIG.gitignore.cacheTimeout
        ),
        workspaceOverrides: new Map()
      },
      version: DEFAULT_CONFIG.version
    };

    return this.validateConfig(rawConfig);
  }

  private validateConfig(config: ProjectConfig): ProjectConfig {
    if (!config.rootPath) {
      throw new Error('Configuration must include rootPath');
    }

    return {
      ...config,
      maxDepth: Math.max(1, Math.min(10, config.maxDepth || DEFAULT_CONFIG.maxDepth)),
      excludePatterns: this.validateExcludePatterns(config.excludePatterns),
      gitignore: validateGitIgnoreConfig(config.gitignore)
    };
  }

  private validateExcludePatterns(patterns: string[]): string[] {
    return patterns.filter(pattern => {
      try {
        new RegExp(pattern.replace(/\*/g, '.*'));
        return true;
      } catch {
        console.warn(`Invalid exclude pattern: ${pattern}`);
        return false;
      }
    });
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

  private handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('ai-workflows-helper')) {
      // Reload all configurations
      for (const [path, _] of this.workspaceConfigs) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.find(
          folder => folder.uri.fsPath === path
        );
        if (workspaceFolder) {
          const newConfig = this.loadConfig(workspaceFolder);
          this.workspaceConfigs.set(path, newConfig);
        }
      }
    }
  }

  public dispose(): void {
    this.configurationChangeListener.dispose();
  }
}

export function isValidDependencyPath(config: ProjectConfig, filePath: string): boolean {
  if (!filePath.startsWith(config.rootPath)) {
    return false;
  }

  // Check against exclude patterns
  for (const pattern of config.excludePatterns) {
    if (new RegExp(pattern.replace(/\*/g, '.*')).test(filePath)) {
      return false;
    }
  }

  return true;
}

export function getConfigurationSchema(): any {
  return {
    type: 'object',
    properties: {
      maxDepth: {
        type: 'number',
        default: DEFAULT_CONFIG.maxDepth,
        minimum: 1,
        maximum: 10,
        description: 'Maximum depth for dependency collection'
      },
      excludePatterns: {
        type: 'array',
        items: {
          type: 'string'
        },
        default: DEFAULT_CONFIG.excludePatterns,
        description: 'Patterns to exclude from collection'
      },
      gitignore: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            default: DEFAULT_CONFIG.gitignore.enabled,
            description: 'Enable .gitignore support'
          },
          respectGlobalIgnore: {
            type: 'boolean',
            default: DEFAULT_CONFIG.gitignore.respectGlobalIgnore,
            description: 'Respect global .gitignore files'
          },
          respectNestedIgnores: {
            type: 'boolean',
            default: DEFAULT_CONFIG.gitignore.respectNestedIgnores,
            description: 'Respect nested .gitignore files'
          },
          cacheTimeout: {
            type: 'number',
            default: DEFAULT_CONFIG.gitignore.cacheTimeout,
            minimum: 1000,
            description: 'Cache timeout in milliseconds'
          }
        }
      }
    }
  };
}