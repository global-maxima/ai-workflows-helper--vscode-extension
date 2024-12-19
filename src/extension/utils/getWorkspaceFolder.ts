import * as vscode from 'vscode';

export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}