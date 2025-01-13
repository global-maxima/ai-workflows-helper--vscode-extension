import path from 'path';
import * as vscode from 'vscode';

export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  }

  return workspaceFolder;
}