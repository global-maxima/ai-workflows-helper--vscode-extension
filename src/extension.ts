import * as path from 'path';
import * as vscode from 'vscode';
import { DependencyCollector } from './extension/withDependencies/collector';
import { FileSystemManager } from './extension/utils/fileSystem';
import { ConfigManager } from './extension/config';
import { GitIgnoreHandler } from './extension/utils/gitignore/handler';
import { GitIgnoreConfig, validateConfig } from './extension/utils/gitignore/types';

interface DependencyContext {
	outputted: Set<string>;
	focusFiles: Set<string>;
	progress: vscode.Progress<{ message?: string }>;
	token: vscode.CancellationToken;
}

let configManager: ConfigManager;
let gitIgnoreHandler: GitIgnoreHandler;
let fileSystemManager: FileSystemManager;
let dependencyCollector: DependencyCollector;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	try {
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
			cacheTimeout: config.gitignore.cacheTimeout,
		});

		gitIgnoreHandler = new GitIgnoreHandler(gitIgnoreConfig);
		fileSystemManager = new FileSystemManager(gitIgnoreHandler);
		dependencyCollector = new DependencyCollector(gitIgnoreHandler);

		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(async e => {
				if (e.affectsConfiguration('dependencyCollector.gitignore')) {
					const newConfig = configManager.getConfig(workspaceFolder);
					const updatedGitIgnoreConfig = validateConfig({
						enabled: newConfig.gitignore.enabled,
						respectGlobalIgnore: newConfig.gitignore.respectGlobalIgnore,
						respectNestedIgnores: newConfig.gitignore.respectNestedIgnores,
						cacheTimeout: newConfig.gitignore.cacheTimeout,
					});
					await updateGitIgnoreConfig(updatedGitIgnoreConfig);
				}
			})
		);

		// Register commands
		context.subscriptions.push(
			vscode.commands.registerCommand('dependencyCollector.collectDependencies',
				collectDependenciesCommand),
			vscode.commands.registerCommand('dependencyCollector.streamToFile',
				streamToFileCommand),
			vscode.commands.registerCommand('dependencyCollector.clearCache',
				clearCacheCommand)
		);

		// Register workspace change handlers
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

		console.log('Dependency Collector extension activated');
	} catch (error) {
		console.error('Failed to activate Dependency Collector extension:', error);
		throw error;
	}
}

export function deactivate(): void {
	try {
		if (gitIgnoreHandler) {
			gitIgnoreHandler.dispose();
		}
		if (dependencyCollector) {
			dependencyCollector.dispose();
		}
		console.log('Dependency Collector extension deactivated');
	} catch (error) {
		console.error('Error during extension deactivation:', error);
	}
}

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
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Collecting dependencies...',
			cancellable: true
		}, async (progress, token) => {
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
		});
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

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Streaming dependencies...',
			cancellable: true
		}, async (progress, token) => {
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
		});
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