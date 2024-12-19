import * as vscode from 'vscode';

export function getUrisToProcess(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): vscode.Uri[] {
  if (uris && uris.length > 0) {
    return uris;
  }
  return uri ? [uri] : [];
}

export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}