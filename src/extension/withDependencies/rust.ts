// src/extension/withDependencies/rust.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageHandler } from './types';

export class RustHandler implements LanguageHandler {
  // added at 2024-12-17: Language-specific location collection for Rust
  public async collectLocations(
    document: vscode.TextDocument
  ): Promise<Map<string, { location: vscode.Location; type: 'definition' | 'reference' }>> {
    const locations = new Map<string, { location: vscode.Location; type: 'definition' | 'reference' }>();

    for (let line = 0; line < document.lineCount; line++) {
      const lineText = document.lineAt(line).text;
      const modMatch = lineText.match(/^\s*mod\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/);

      if (modMatch) {
        const modName = modMatch[1];
        const modFile = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), `${modName}.rs`));
        const modDirFile = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), modName, 'mod.rs'));

        const [modFileExists, modDirExists] = await Promise.all([
          this.checkFileExists(modFile),
          this.checkFileExists(modDirFile)
        ]);

        const targetUri = modFileExists ? modFile : modDirExists ? modDirFile : null;
        if (targetUri) {
          locations.set(targetUri.fsPath, {
            location: new vscode.Location(targetUri, new vscode.Position(0, 0)),
            type: 'definition'
          });
        }
      }
    }

    return locations;
  }

  private async checkFileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}