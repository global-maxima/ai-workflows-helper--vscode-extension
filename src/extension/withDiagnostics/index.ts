import * as vscode from 'vscode';
import * as path from 'path';

export async function collectDiagnostics(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<string> {
  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  const diagnostics = vscode.languages.getDiagnostics(uri);

  if (diagnostics.length === 0) {
    return '';
  }

  let output = `--- ${relativePath} ---\n`;
  for (const d of diagnostics) {
    output += `${d.source ?? 'unknown'} ${d.code ?? 'no-code'}: ${d.message} (${d.severity})\n`;
    output += `  at lines ${d.range.start.line + 1}:${d.range.start.character + 1}-${d.range.end.line + 1}:${d.range.end.character + 1}\n`;
  }
  return output + '\n';
}