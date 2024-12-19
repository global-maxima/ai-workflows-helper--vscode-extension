// fileSystem.ts
import * as vscode from 'vscode';
import * as path from 'path';

export interface FileContext {
  isFocusFile?: boolean;
  referencedBy?: string[];
  defines?: string[];
  references?: string[];
}

export class FileSystemManager {
  public static async readFileToStream(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    context: FileContext = {}
  ): Promise<string> {
    const filePath = uri.fsPath;
    const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

    try {
      const fileContent = await vscode.workspace.fs.readFile(uri);
      const contentString = Buffer.from(fileContent).toString('utf8');

      let contextBlock = '/*\n';
      contextBlock += ' * File Context:\n';
      if (context.isFocusFile) {
        contextBlock += ' * - Focus File (explicitly selected by user)\n';
      }
      if (context.referencedBy?.length) {
        contextBlock += ' * - Referenced by:\n';
        contextBlock += context.referencedBy.map(ref => ` *   - ${ref}`).join('\n') + '\n';
      }
      if (context.defines?.length) {
        contextBlock += ' * - Defines symbols:\n';
        contextBlock += context.defines.map(def => ` *   - ${def}`).join('\n') + '\n';
      }
      if (context.references?.length) {
        contextBlock += ' * - References symbols:\n';
        contextBlock += context.references.map(ref => ` *   - ${ref}`).join('\n') + '\n';
      }
      contextBlock += ' */\n\n';

      return `--- ${relativePath} ---\n${contextBlock}${contentString}\n\n`;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to read file: ${relativePath}`);
      return '';
    }
  }
}