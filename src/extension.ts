// src/extension.ts
import * as vscode from 'vscode';
import { ConfigurationManager } from './extension/config';
import { DependencyCollector } from './extension/withDependencies';
import { getUrisToProcess } from './extension/utils';

const configManager = new ConfigurationManager();
const dependencyCollector = new DependencyCollector();

const copyWithLocalDeps = vscode.commands.registerCommand(
	'ai-workflows-helper.copyWithLocalDependencies',
	async (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
		const filesToProcess = getUrisToProcess(uri, uris);
		if (filesToProcess.length === 0) {
			vscode.window.showWarningMessage('No files selected.');
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "AI Workflow Helper",
			cancellable: true
		}, async (progress, token) => {
			const context = {
				focusFiles: new Set(filesToProcess.map(u => u.fsPath)),
				outputted: new Set<string>(),
				progress,
				token
			};

			let textStream = '';
			let totalProcessedCount = 0;
			let totalErrorCount = 0;

			for (const uri of filesToProcess) {
				if (token.isCancellationRequested) {
					break;
				}

				try {
					const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
					if (!workspaceFolder) {
						throw new Error('No workspace folder found for the given file');
					}
					const config = configManager.getConfig(workspaceFolder);

					const { textStream: newContent, processedCount, errorCount } =
						await dependencyCollector.collectAndStreamDependencies(uri, config, context);

					textStream += newContent;
					totalProcessedCount += processedCount;
					totalErrorCount += errorCount;
				} catch (error) {
					vscode.window.showErrorMessage(`Error processing ${uri.fsPath}: ${error}`);
					totalErrorCount++;
				}
			}

			if (totalErrorCount > 0) {
				vscode.window.showWarningMessage(
					`Completed with ${totalErrorCount} errors. Some dependencies may be missing.`
				);
			}

			await vscode.env.clipboard.writeText(textStream);
			progress.report({
				increment: 100,
				message: `Content copied (${totalProcessedCount} files)`
			});

			await new Promise(resolve => setTimeout(resolve, 3000));
		});
	}
);

export function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const config = configManager.getConfig(folder);
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(async event => {
			configManager.handleWorkspaceFoldersChanged(event);
		})
	);

	context.subscriptions.push(copyWithLocalDeps);
}

export function deactivate() { }