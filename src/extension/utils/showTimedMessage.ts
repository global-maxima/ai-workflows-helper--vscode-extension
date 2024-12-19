import * as vscode from 'vscode';

export function showTimedMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  if (type === 'error') {
    vscode.window.showErrorMessage(message);
    return;
  }

  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: message,
    cancellable: false
  }, async () => {
    await new Promise(resolve => setTimeout(resolve, 3000));
  });
}