// src/extension/withDependencies/types.ts
import * as vscode from 'vscode';

export interface DependencyResult {
  uri: vscode.Uri;
  error?: string;
  referencedBy?: string[];
  defines?: string[];
  references?: string[];
}

export interface DependencyCollectionState {
  dependencies: Map<string, DependencyResult>;
  visited: Set<string>;
  depth: number;
  resolutionStrategies: Set<string>;
}

export interface DependencyContext {
  focusFiles: Set<string>;
  outputted: Set<string>;
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  token: vscode.CancellationToken;
}

export interface LanguageHandler {
  collectLocations(
    document: vscode.TextDocument
  ): Promise<Map<string, { location: vscode.Location; type: 'definition' | 'reference' }>>;
}