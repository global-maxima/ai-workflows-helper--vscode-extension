// src/extension.ts

import * as path from 'path';
import * as vscode from 'vscode';

// --- Snippet #1 imports (renamed or redirected as needed) ---
import { collectDiagnostics } from './extension/withDiagnostics';
import { getUrisToProcess } from './extension/utils/getUrisToProcess';
import { showTimedMessage } from './extension/utils/showTimedMessage';
import { FileSystemManager } from './extension/utils/fileSystem';
import { DependencyCollector } from './extension/withDependencies/collector';

// --- Snippet #2 imports ---
import { ConfigManager } from './extension/config';
import { GitIgnoreHandler } from './extension/utils/gitignore/handler';
import {
	GitIgnoreConfig,
	validateConfig
} from './extension/utils/gitignore/types';

/**
 * Context used for the dependency collector
 */
interface DependencyContext {
	outputted: Set<string>
	focusFiles: Set<string>
	progress: vscode.Progress<{ message?: string }>
	token: vscode.CancellationToken
}

// --- Unified singletons ---
let configManager: ConfigManager;
let gitIgnoreHandler: GitIgnoreHandler;
let fileSystemManager: FileSystemManager;
let dependencyCollector: DependencyCollector;

// --------------------------------------------------------------------------
// Snippet #1 classes / functions needed
// --------------------------------------------------------------------------

/**
 * ExtensionError for more controlled error handling
 */
class ExtensionError extends Error {
	constructor(message: string, public readonly details?: unknown) {
		super(message);
		this.name = 'ExtensionError';
	}
}

/**
 * Helper to wrap the VS Code progress call (if you prefer using your own).
 * Otherwise, we could inline calls to `vscode.window.withProgress`.
 */
function withProgress<T>(
	title: string,
	operation: (
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		token: vscode.CancellationToken
	) => Promise<T>
): Thenable<T> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: title,
			cancellable: true
		},
		operation
	);
}

/**
 * Recursively processes files/folders, applying a `processor` to each file.
 */
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

/**
 * Creates and registers a VS Code command.
 */
function createCommand(
	id: string,
	handler: (uri?: vscode.Uri, uris?: vscode.Uri[]) => Promise<void>
): vscode.Disposable {
	return vscode.commands.registerCommand(id, handler);
}

// --------------------------------------------------------------------------
// Combined activate() function
// --------------------------------------------------------------------------

export async function activate(
	context: vscode.ExtensionContext
): Promise<void> {
	try {
		// --- Snippet #2 standard activation logic ---
		configManager = new ConfigManager();
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('No workspace folder found');
		}
		const config = configManager.getConfig(workspaceFolder);

		const gitIgnoreConfig: GitIgnoreConfig = validateConfig({
			enabled: config.gitignore.enabled,
			respectGlobalIgnore: config.gitignore.respectGlobalIgnore,
			respectNestedIgnores: config.gitignore.respectNestedIgnores,
			cacheTimeout: config.gitignore.cacheTimeout
		});

		gitIgnoreHandler = new GitIgnoreHandler(gitIgnoreConfig);
		fileSystemManager = new FileSystemManager(gitIgnoreHandler);
		dependencyCollector = new DependencyCollector(gitIgnoreHandler);

		// Watch for config changes that affect gitignore
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(async e => {
				if (e.affectsConfiguration('ai-workflows-helper.gitignore')) {
					const newConfig = configManager.getConfig(workspaceFolder);
					const updatedGitIgnoreConfig = validateConfig({
						enabled: newConfig.gitignore.enabled,
						respectGlobalIgnore: newConfig.gitignore.respectGlobalIgnore,
						respectNestedIgnores: newConfig.gitignore.respectNestedIgnores,
						cacheTimeout: newConfig.gitignore.cacheTimeout
					});
					await updateGitIgnoreConfig(updatedGitIgnoreConfig);
				}
			})
		);

		// Register snippet #2 commands
		context.subscriptions.push(
			vscode.commands.registerCommand(
				'ai-workflows-helper.collectDependencies',
				collectDependenciesCommand
			),
			vscode.commands.registerCommand(
				'ai-workflows-helper.streamToFile',
				streamToFileCommand
			),
			vscode.commands.registerCommand(
				'ai-workflows-helper.clearCache',
				clearCacheCommand
			)
		);

		// Register watchers for .gitignore changes
		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				gitIgnoreHandler.clearCache();
			}),
			vscode.workspace.onDidCreateFiles(e => {
				for (const file of e.files) {
					if (path.basename(file.fsPath) === '.gitignore') {
						gitIgnoreHandler.clearCache();
						break;
					}
				}
			}),
			vscode.workspace.onDidDeleteFiles(e => {
				for (const file of e.files) {
					if (path.basename(file.fsPath) === '.gitignore') {
						gitIgnoreHandler.clearCache();
						break;
					}
				}
			}),
			vscode.workspace.onDidChangeTextDocument(e => {
				if (path.basename(e.document.uri.fsPath) === '.gitignore') {
					gitIgnoreHandler.clearCache();
				}
			})
		);

		// --- Snippet #1 commands (AI Workflows Helper) ---
		//    We’ll just reuse the config retrieval from snippet #1
		const getWorkspaceConfig = (uri: vscode.Uri) => {
			const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
			if (!wsFolder) {
				throw new ExtensionError('No workspace folder found for the given file');
			}
			return {
				folder: wsFolder,
				config: configManager.getConfig(wsFolder)
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

					await withProgress('Processing files...', async (progress) => {
						const output = await processFiles(
							filesToProcess,
							async (thisUri, workspace) => {
								// use our unified fileSystemManager here
								return fileSystemManager.readFileToStream(thisUri, workspace, {});
							},
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

					await withProgress('Processing files with diagnostics...', async (progress) => {
						const output = await processFiles(
							filesToProcess,
							async (thisUri, workspace) => {
								const content = await fileSystemManager.readFileToStream(
									thisUri,
									workspace,
									{}
								);
								const diagnostics = await collectDiagnostics(thisUri, workspace);
								return content + (diagnostics ? `\n${diagnostics}` : '');
							},
							folder
						);

						await vscode.env.clipboard.writeText(output);
						progress.report({
							increment: 100,
							message: 'Content copied with diagnostics'
						});
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

					await withProgress('Processing dependencies...', async (progress, token) => {
						const contextData = {
							focusFiles: new Set(filesToProcess.map(u => u.fsPath)),
							outputted: new Set<string>(),
							progress,
							token
						};
						let textStream = '';
						let totalProcessedCount = 0;
						let totalErrorCount = 0;

						for (const thisUri of filesToProcess) {
							if (token.isCancellationRequested) {
								break;
							}
							try {
								const { folder, config } = getWorkspaceConfig(thisUri);
								const result = await dependencyCollector.collectAndStreamDependencies(
									thisUri,
									config,
									contextData
								);
								textStream += result.textStream;
								totalProcessedCount += result.processedCount;
								totalErrorCount += result.errorCount;
							} catch (error) {
								totalErrorCount++;
								throw new ExtensionError(
									`Error processing ${thisUri.fsPath}`,
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
						(thisUri, workspace) => collectDiagnostics(thisUri, workspace),
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

		// Register snippet #1 commands with error handling
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

		context.subscriptions.push(...disposables);

		console.log('Dependency Collector + AI Workflows Helper extension activated');

	} catch (error) {
		console.error('Failed to activate extension:', error);
		throw error;
	}
}

// --------------------------------------------------------------------------
// Combined deactivate() function
// --------------------------------------------------------------------------

export function deactivate(): void {
	try {
		if (gitIgnoreHandler) {
			gitIgnoreHandler.dispose();
		}
		if (dependencyCollector) {
			dependencyCollector.dispose();
		}
		console.log('Dependency Collector + AI Workflows Helper extension deactivated');
	} catch (error) {
		console.error('Error during extension deactivation:', error);
	}
}

// --------------------------------------------------------------------------
// Internal commands from snippet #2
// --------------------------------------------------------------------------

async function updateGitIgnoreConfig(newConfig: GitIgnoreConfig): Promise<void> {
	try {
		if (gitIgnoreHandler) {
			gitIgnoreHandler.dispose();
		}
		gitIgnoreHandler = new GitIgnoreHandler(newConfig);
		fileSystemManager = new FileSystemManager(gitIgnoreHandler);
		dependencyCollector = new DependencyCollector(gitIgnoreHandler);
	} catch (error) {
		console.error('Failed to update gitignore configuration:', error);
		vscode.window.showErrorMessage('Failed to update gitignore configuration');
	}
}

async function collectDependenciesCommand(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	if (!workspaceFolder) {
		throw new Error('No workspace folder found');
	}

	try {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Collecting dependencies...',
				cancellable: true
			},
			async (progress, token) => {
				const config = configManager.getConfig(workspaceFolder);
				const context: DependencyContext = {
					outputted: new Set(),
					focusFiles: new Set([editor.document.uri.fsPath]),
					progress,
					token
				};

				const result = await dependencyCollector.collectAndStreamDependencies(
					editor.document.uri,
					config,
					context
				);

				if (result.errorCount > 0) {
					vscode.window.showWarningMessage(
						`Completed with ${result.errorCount} errors. Check output for details.`
					);
				} else {
					vscode.window.showInformationMessage(
						`Successfully processed ${result.processedCount} files`
					);
				}
			}
		);
	} catch (error) {
		console.error('Error collecting dependencies:', error);
		vscode.window.showErrorMessage('Failed to collect dependencies');
	}
}

async function streamToFileCommand(): Promise<void> {
	try {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor');
			return;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (!workspaceFolder) {
			vscode.window.showWarningMessage('File not in workspace');
			return;
		}

		const outputUri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file('dependencies.txt'),
			filters: { 'Text files': ['txt'] }
		});

		if (!outputUri) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Streaming dependencies...',
				cancellable: true
			},
			async (progress, token) => {
				const config = configManager.getConfig(workspaceFolder);
				const context: DependencyContext = {
					outputted: new Set(),
					focusFiles: new Set([editor.document.uri.fsPath]),
					progress,
					token
				};

				const result = await dependencyCollector.collectAndStreamDependencies(
					editor.document.uri,
					config,
					context
				);

				await vscode.workspace.fs.writeFile(
					outputUri,
					Buffer.from(result.textStream)
				);

				vscode.window.showInformationMessage(
					`Dependencies saved to ${outputUri.fsPath}`
				);
			}
		);
	} catch (error) {
		console.error('Error streaming to file:', error);
		vscode.window.showErrorMessage('Failed to stream dependencies to file');
	}
}

async function clearCacheCommand(): Promise<void> {
	try {
		gitIgnoreHandler.clearCache();
		vscode.window.showInformationMessage('Cache cleared successfully');
	} catch (error) {
		console.error('Error clearing cache:', error);
		vscode.window.showErrorMessage('Failed to clear cache');
	}
}
