import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationManager } from './extension/config';
import { DependencyCollector } from './extension/withDependencies';
import { collectDiagnostics } from './extension/withDiagnostics';
import { getUrisToProcess } from './extension/utils/getUrisToProcess';
import { showTimedMessage } from './extension/utils/showTimedMessage';
import { FileSystemManager } from './extension/utils/fileSystem';

// added at 2024-12-19: Configuration constants
const CONFIG = {
	PROGRESS_DISPLAY_MS: 3000,
	DEFAULT_MAX_DEPTH: 3,
} as const;

const configManager = new ConfigurationManager();
const dependencyCollector = new DependencyCollector();
const fileSystem = new FileSystemManager();

// added at 2024-12-19: Unified error handling
class ExtensionError extends Error {
	constructor(message: string, public readonly details?: unknown) {
		super(message);
		this.name = 'ExtensionError';
	}
}

// added at 2024-12-19: Resource cleanup utilities
function withProgress<T>(
	title: string,
	operation: (
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		token: vscode.CancellationToken
	) => Promise<T>
): Thenable<T> {  // Changed return type from Promise<T> to Thenable<T>
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "AI Workflow Helper",
		cancellable: true
	}, operation);
}

// added at 2024-12-19: Unified file processing
async function processFiles(
	uris: vscode.Uri[],
	processor: (uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) => Promise<string>,
	workspaceFolder: vscode.WorkspaceFolder
): Promise<string> {
	let output = '';

	for (const uri of uris) {
		const stats = await vscode.workspace.fs.stat(uri);

		if (stats.type === vscode.FileType.Directory) {
			const folderName = path.basename(uri.fsPath);
			output += `--- Folder: ${folderName} ---\n`;
			const folderUris = await vscode.workspace.findFiles(
				new vscode.RelativePattern(uri, '**/*')
			);

			for (const folderUri of folderUris) {
				output += await processor(folderUri, workspaceFolder);
			}
		} else {
			output += await processor(uri, workspaceFolder);
		}
	}

	return output;
}

// added at 2024-12-19: Command registration factory
function createCommand(
	id: string,
	handler: (uri?: vscode.Uri, uris?: vscode.Uri[]) => Promise<void>
): vscode.Disposable {
	return vscode.commands.registerCommand(id, handler);
}

export function activate(context: vscode.ExtensionContext) {
	// added at 2024-12-19: Lazy configuration loading
	const getWorkspaceConfig = (uri: vscode.Uri) => {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) {
			throw new ExtensionError('No workspace folder found for the given file');
		}
		return {
			folder: workspaceFolder,
			config: configManager.getConfig(workspaceFolder)
		};
	};

	const commands = [
		{
			id: 'ai-workflows-helper.copyAsTextStream',
			handler: async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					throw new ExtensionError('No files or folders selected.');
				}

				const { folder } = getWorkspaceConfig(filesToProcess[0]);

				await withProgress("Processing files...", async (progress) => {
					const output = await processFiles(
						filesToProcess,
						(uri, workspace) => FileSystemManager.readFileToStream(uri, workspace, {}),
						folder
					);

					await vscode.env.clipboard.writeText(output);
					progress.report({ increment: 100, message: 'Content copied' });
				});
			}
		},
		{
			id: 'ai-workflows-helper.copyAsTextStreamWithDiagnostics',
			handler: async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					throw new ExtensionError('No files or folders selected.');
				}

				const { folder } = getWorkspaceConfig(filesToProcess[0]);

				await withProgress("Processing files with diagnostics...", async (progress) => {
					const output = await processFiles(
						filesToProcess,
						async (uri, workspace) => {
							const content = await FileSystemManager.readFileToStream(uri, workspace, {});
							const diagnostics = await collectDiagnostics(uri, workspace);
							return content + (diagnostics ? `\n${diagnostics}` : '');
						},
						folder
					);

					await vscode.env.clipboard.writeText(output);
					progress.report({ increment: 100, message: 'Content copied with diagnostics' });
				});
			}
		},
		{
			id: 'ai-workflows-helper.copyWithLocalDependencies',
			handler: async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					throw new ExtensionError('No files selected.');
				}

				await withProgress("Processing dependencies...", async (progress, token) => {
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
						if (token.isCancellationRequested) { break; }

						try {
							const { folder, config } = getWorkspaceConfig(uri);
							const result = await dependencyCollector.collectAndStreamDependencies(
								uri,
								config,
								context
							);

							textStream += result.textStream;
							totalProcessedCount += result.processedCount;
							totalErrorCount += result.errorCount;
						} catch (error) {
							totalErrorCount++;
							throw new ExtensionError(
								`Error processing ${uri.fsPath}`,
								error
							);
						}
					}

					if (totalErrorCount > 0) {
						showTimedMessage(
							`Completed with ${totalErrorCount} errors. Some dependencies may be missing.`,
							'warning'
						);
					}

					await vscode.env.clipboard.writeText(textStream);
					progress.report({
						increment: 100,
						message: `Content copied (${totalProcessedCount} files)`
					});
				});
			}
		},
		{
			id: 'ai-workflows-helper.copyDiagnosticsOnly',
			handler: async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					throw new ExtensionError('No files or folders selected.');
				}

				const { folder } = getWorkspaceConfig(filesToProcess[0]);

				const output = await processFiles(
					filesToProcess,
					(uri, workspace) => collectDiagnostics(uri, workspace),
					folder
				);

				if (!output) {
					showTimedMessage('No diagnostics found.', 'info');
					return;
				}

				await vscode.env.clipboard.writeText(output);
				showTimedMessage('Diagnostics copied.');
			}
		}
	];

	// Register commands
	const disposables = commands.map(({ id, handler }) =>
		createCommand(id, async (uri, uris) => {
			try {
				await handler(uri, uris);
			} catch (error) {
				if (error instanceof ExtensionError) {
					vscode.window.showErrorMessage(error.message);
					console.error('Extension error details:', error.details);
				} else {
					vscode.window.showErrorMessage('An unexpected error occurred.');
					console.error('Unexpected error:', error);
				}
			}
		})
	);

	context.subscriptions.push(
		...disposables,
		vscode.workspace.onDidChangeWorkspaceFolders(event => {
			configManager.handleWorkspaceFoldersChanged(event);
		})
	);
}

export function deactivate() { }