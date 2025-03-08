const vscode = require('vscode');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Enhanced auto-commit extension is now active');

    // Extension state
    let fileWatcher = null;
    let commitTimeout = null;
    let statusBarItem = null;
    let isEnabled = false;
    let lastCommitTime = null;
    let pendingChangesCount = 0;
    let currentWorkspaceRoot = null;

    // Configuration settings with defaults
    let config = {
        commitDelay: 30000,       // Default: 30 seconds
        pushAfterCommit: true,    // Default: push after each commit
        excludePatterns: ['node_modules/**', '.git/**', '**/*.log'],
        commitMessage: "Auto commit: {date} - {files} files changed",
        branchHandling: 'currentBranchOnly', // 'currentBranchOnly', 'allBranches'
        maxRetries: 3,            // Maximum number of retries for git operations
        retryDelay: 5000,         // Delay between retries in milliseconds
        notifyOnCommit: true,     // Show notification on successful commit
        commitOnlyWithChanges: true, // Only commit when there are actual changes
    };

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'extension.toggleAutoCommit';
    context.subscriptions.push(statusBarItem);

    // Register configuration change listener
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('autoCommit')) {
            loadConfiguration();
            updateStatusBar();
        }
    }));

    // Load configuration
    function loadConfiguration() {
        const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
        config.commitDelay = extensionConfig.get('commitDelay', 30000);
        config.pushAfterCommit = extensionConfig.get('pushAfterCommit', true);
        config.excludePatterns = extensionConfig.get('excludePatterns', ['node_modules/**', '.git/**', '**/*.log']);
        config.commitMessage = extensionConfig.get('commitMessage', "Auto commit: {date} - {files} files changed");
        config.branchHandling = extensionConfig.get('branchHandling', 'currentBranchOnly');
        config.maxRetries = extensionConfig.get('maxRetries', 3);
        config.retryDelay = extensionConfig.get('retryDelay', 5000);
        config.notifyOnCommit = extensionConfig.get('notifyOnCommit', true);
        config.commitOnlyWithChanges = extensionConfig.get('commitOnlyWithChanges', true);
    }

    // Initially load configuration
    loadConfiguration();

    // Update status bar with current state
    function updateStatusBar() {
        if (!statusBarItem) return;
        
        if (isEnabled) {
            statusBarItem.text = `$(sync~spin) Auto-Commit: ON`;
            statusBarItem.tooltip = `Auto-commit is enabled. ${pendingChangesCount} pending changes. Last commit: ${lastCommitTime || 'None'}`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.show();
        } else {
            statusBarItem.text = `$(sync) Auto-Commit: OFF`;
            statusBarItem.tooltip = `Click to enable auto-commit`;
            statusBarItem.backgroundColor = undefined;
            statusBarItem.show();
        }
    }

    // Toggle auto-commit on/off
    let toggleAutoCommit = vscode.commands.registerCommand('extension.toggleAutoCommit', async function () {
        if (isEnabled) {
            await disableAutoCommit();
        } else {
            await enableAutoCommit();
        }
    });

    // Command to enable auto-commit
    let enableAutoCommitCommand = vscode.commands.registerCommand('extension.enableAutoCommit', async function () {
        await enableAutoCommit();
    });

    // Command to disable auto-commit
    let disableAutoCommitCommand = vscode.commands.registerCommand('extension.disableAutoCommit', async function () {
        await disableAutoCommit();
    });

    // Command to force commit now
    let forceCommitNowCommand = vscode.commands.registerCommand('extension.forceCommitNow', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a project.');
            return;
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        await performCommit(workspaceRoot, true);
    });

    // Command to change commit delay
    let changeCommitDelayCommand = vscode.commands.registerCommand('extension.changeCommitDelay', async function () {
        const result = await vscode.window.showInputBox({
            value: String(config.commitDelay / 1000),
            placeHolder: 'Enter delay in seconds',
            validateInput: (value) => {
                if (!/^\d+$/.test(value) || parseInt(value) < 5) {
                    return 'Please enter a valid number (minimum 5 seconds)';
                }
                return null;
            }
        });
        
        if (result) {
            config.commitDelay = parseInt(result) * 1000;
            // Also update user settings
            const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
            await extensionConfig.update('commitDelay', config.commitDelay, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Commit delay updated to ${result} seconds`);
        }
    });

    async function enableAutoCommit() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a project.');
            return;
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        currentWorkspaceRoot = workspaceRoot;
        
        try {
            // Check if this is a Git repository
            if (!isGitRepository(workspaceRoot)) {
                vscode.window.showErrorMessage('This project is not a Git repository. Would you like to initialize one?', 'Yes', 'No')
                    .then(answer => {
                        if (answer === 'Yes') {
                            initializeGitRepository(workspaceRoot);
                        }
                    });
                return;
            }

            // Check for pending changes before proceeding
            const hasPendingChanges = await checkForPendingChanges(workspaceRoot);
            if (hasPendingChanges) {
                const shouldProceed = await vscode.window.showWarningMessage(
                    'There are pending changes in your repository. Would you like to commit them now?',
                    'Yes', 'No, start fresh', 'Cancel'
                );
                
                if (shouldProceed === 'Yes') {
                    await performCommit(workspaceRoot, true);
                } else if (shouldProceed === 'Cancel') {
                    return;
                }
            }
            
            // Set up file watcher for changes
            if (fileWatcher) {
                fileWatcher.dispose();
            }
            
            // Create a file system watcher with the exclude patterns
            const excludeGlob = `{${config.excludePatterns.join(',')}}`;
            fileWatcher = vscode.workspace.createFileSystemWatcher(`**/*`, false, false, false);
            
            fileWatcher.onDidChange(uri => {
                // Ignore files matching the exclude patterns
                if (shouldIgnoreFile(uri.fsPath)) return;
                pendingChangesCount++;
                scheduleCommit(workspaceRoot);
                updateStatusBar();
            });
            
            fileWatcher.onDidCreate(uri => {
                if (shouldIgnoreFile(uri.fsPath)) return;
                pendingChangesCount++;
                scheduleCommit(workspaceRoot);
                updateStatusBar();
            });
            
            fileWatcher.onDidDelete(uri => {
                if (shouldIgnoreFile(uri.fsPath)) return;
                pendingChangesCount++;
                scheduleCommit(workspaceRoot);
                updateStatusBar();
            });
            
            isEnabled = true;
            updateStatusBar();
            vscode.window.showInformationMessage(`Auto-commit enabled. Changes will be committed every ${config.commitDelay / 1000} seconds.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to enable auto-commit: ${error.message}`);
            console.error('Error enabling auto-commit:', error);
        }
    }

    function shouldIgnoreFile(filePath) {
        const relativePath = path.relative(currentWorkspaceRoot, filePath);
        return config.excludePatterns.some(pattern => {
            // Convert glob pattern to regex
            const regexPattern = pattern
                .replace(/\./g, '\\.')
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*');
            return new RegExp(`^${regexPattern}$`).test(relativePath);
        });
    }

    async function disableAutoCommit() {
        if (fileWatcher) {
            fileWatcher.dispose();
            fileWatcher = null;
        }
        
        if (commitTimeout) {
            clearTimeout(commitTimeout);
            commitTimeout = null;
        }
        
        isEnabled = false;
        pendingChangesCount = 0;
        updateStatusBar();
        vscode.window.showInformationMessage('Auto-commit disabled.');
    }

    function isGitRepository(workspaceRoot) {
        return fs.existsSync(path.join(workspaceRoot, '.git'));
    }

    function initializeGitRepository(workspaceRoot) {
        try {
            execSync(`cd "${workspaceRoot}" && git init`, { encoding: 'utf8' });
            vscode.window.showInformationMessage('Git repository initialized. Now you can enable auto-commit.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to initialize Git repository: ${error.message}`);
        }
    }

    async function checkForPendingChanges(workspaceRoot) {
        return new Promise((resolve, reject) => {
            exec(`cd "${workspaceRoot}" && git status --porcelain`, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout.trim().length > 0);
            });
        });
    }

    function scheduleCommit(workspaceRoot) {
        // Cancel previous timer
        if (commitTimeout) {
            clearTimeout(commitTimeout);
        }
        
        // Set a new timer
        commitTimeout = setTimeout(() => {
            performCommit(workspaceRoot);
        }, config.commitDelay);
    }

    async function performCommit(workspaceRoot, forced = false) {
        try {
            if (config.commitOnlyWithChanges && !forced) {
                const hasChanges = await checkForPendingChanges(workspaceRoot);
                if (!hasChanges) {
                    console.log('No changes to commit');
                    pendingChangesCount = 0;
                    updateStatusBar();
                    return;
                }
            }

            // Get current branch name
            const branch = await getCurrentBranch(workspaceRoot);
            
            // Get list of changed files for commit message
            const changedFiles = await getChangedFilesCount(workspaceRoot);
            
            // Format commit message
            let commitMessage = config.commitMessage
                .replace('{date}', new Date().toLocaleString())
                .replace('{branch}', branch)
                .replace('{files}', changedFiles);
            
            // Prepare git command
            let gitCommand = `cd "${workspaceRoot}" && git add .`;
            
            // Execute command with retries
            await executeGitCommandWithRetry(gitCommand, workspaceRoot);
            
            // Perform commit
            gitCommand = `cd "${workspaceRoot}" && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`;
            const commitResult = await executeGitCommandWithRetry(gitCommand, workspaceRoot);
            
            // Push if configured
            if (config.pushAfterCommit) {
                const remoteExists = await checkRemoteExists(workspaceRoot);
                if (remoteExists) {
                    const gitPushCommand = `cd "${workspaceRoot}" && git push -u origin ${branch}`;
                    await executeGitCommandWithRetry(gitPushCommand, workspaceRoot);
                } else {
                    console.log('No remote repository configured, skipping push');
                    if (config.notifyOnCommit) {
                        vscode.window.showInformationMessage('Changes committed but not pushed (no remote configured).');
                    }
                }
            }
            
            // Update status
            lastCommitTime = new Date().toLocaleString();
            pendingChangesCount = 0;
            updateStatusBar();
            
            if (config.notifyOnCommit) {
                vscode.window.showInformationMessage(
                    `Changes successfully committed${config.pushAfterCommit ? ' and pushed' : ''}.`,
                    'View Changes'
                ).then(selection => {
                    if (selection === 'View Changes') {
                        vscode.commands.executeCommand('git.viewHistory');
                    }
                });
            }
            
            return commitResult;
        } catch (error) {
            console.error(`Error performing commit: ${error.message}`);
            vscode.window.showErrorMessage(`Commit error: ${error.message}`);
        }
    }

    async function executeGitCommandWithRetry(command, workspaceRoot, attempt = 1) {
        return new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                if (error) {
                    if (attempt <= config.maxRetries) {
                        console.log(`Retry ${attempt}/${config.maxRetries} for command: ${command}`);
                        setTimeout(() => {
                            executeGitCommandWithRetry(command, workspaceRoot, attempt + 1)
                                .then(resolve)
                                .catch(reject);
                        }, config.retryDelay);
                    } else {
                        // Handle specific error cases
                        if (error.message.includes('nothing to commit')) {
                            resolve('nothing to commit');
                        } else {
                            reject(error);
                        }
                    }
                    return;
                }
                
                // Log output for debugging
                if (stdout) console.log(`Git output: ${stdout}`);
                if (stderr) console.log(`Git stderr: ${stderr}`);
                
                resolve(stdout);
            });
        });
    }

    async function getCurrentBranch(workspaceRoot) {
        return new Promise((resolve, reject) => {
            exec(`cd "${workspaceRoot}" && git branch --show-current`, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }

    async function getChangedFilesCount(workspaceRoot) {
        return new Promise((resolve, reject) => {
            exec(`cd "${workspaceRoot}" && git status --porcelain | wc -l`, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }

    async function checkRemoteExists(workspaceRoot) {
        return new Promise((resolve) => {
            exec(`cd "${workspaceRoot}" && git remote -v`, (error, stdout) => {
                if (error || !stdout.trim()) {
                    resolve(false);
                    return;
                }
                resolve(true);
            });
        });
    }

    // Register command to configure remote if not set
    let configureRemoteCommand = vscode.commands.registerCommand('extension.configureGitRemote', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a project.');
            return;
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        
        // Check if remote is already configured
        const remoteExists = await checkRemoteExists(workspaceRoot);
        if (remoteExists) {
            const shouldOverwrite = await vscode.window.showWarningMessage(
                'Remote repository is already configured. Do you want to overwrite it?',
                'Yes', 'No'
            );
            
            if (shouldOverwrite !== 'Yes') {
                return;
            }
        }
        
        // Ask for remote URL
        const remoteUrl = await vscode.window.showInputBox({
            placeHolder: 'Enter remote repository URL (e.g., https://github.com/username/repo.git)',
            validateInput: (value) => {
                if (!value || !value.trim()) {
                    return 'Repository URL cannot be empty';
                }
                if (!value.endsWith('.git') && !value.includes('github.com') && !value.includes('gitlab.com') && !value.includes('bitbucket.org')) {
                    return 'Please enter a valid Git repository URL';
                }
                return null;
            }
        });
        
        if (!remoteUrl) return;
        
        // Configure remote
        try {
            if (remoteExists) {
                await executeGitCommandWithRetry(`cd "${workspaceRoot}" && git remote remove origin`, workspaceRoot);
            }
            
            await executeGitCommandWithRetry(`cd "${workspaceRoot}" && git remote add origin ${remoteUrl}`, workspaceRoot);
            
            // Try to set upstream branch
            try {
                const branch = await getCurrentBranch(workspaceRoot);
                await executeGitCommandWithRetry(`cd "${workspaceRoot}" && git push -u origin ${branch}`, workspaceRoot);
                vscode.window.showInformationMessage('Remote repository configured and upstream branch set.');
            } catch (error) {
                // If push fails, just inform about remote configuration
                vscode.window.showInformationMessage('Remote repository configured. You may need to push manually the first time.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to configure remote: ${error.message}`);
        }
    });

    // Command to show commit history
    let showCommitHistoryCommand = vscode.commands.registerCommand('extension.showCommitHistory', async function () {
        vscode.commands.executeCommand('git.viewHistory');
    });

    // Command to show commit log
    let showCommitLogCommand = vscode.commands.registerCommand('extension.showCommitLog', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a project.');
            return;
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        
        try {
            const logOutput = await new Promise((resolve, reject) => {
                exec(`cd "${workspaceRoot}" && git log --oneline -n 10`, (error, stdout, stderr) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(stdout);
                });
            });
            
            // Create and show output channel
            const outputChannel = vscode.window.createOutputChannel('Git Auto-Commit Log');
            outputChannel.clear();
            outputChannel.appendLine('Recent Commits:');
            outputChannel.appendLine('---------------');
            outputChannel.appendLine(logOutput);
            outputChannel.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show commit log: ${error.message}`);
        }
    });

    // Command to show extension settings
    let showSettingsCommand = vscode.commands.registerCommand('extension.showAutoCommitSettings', function () {
        vscode.commands.executeCommand('workbench.action.openSettings', 'autoCommit');
    });

    // Command to toggle push after commit
    let togglePushAfterCommitCommand = vscode.commands.registerCommand('extension.togglePushAfterCommit', async function () {
        config.pushAfterCommit = !config.pushAfterCommit;
        // Also update user settings
        const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
        await extensionConfig.update('pushAfterCommit', config.pushAfterCommit, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Push after commit: ${config.pushAfterCommit ? 'Enabled' : 'Disabled'}`);
    });

    // Command to edit exclude patterns
    let editExcludePatternsCommand = vscode.commands.registerCommand('extension.editExcludePatterns', async function () {
        const patternsString = await vscode.window.showInputBox({
            value: config.excludePatterns.join(', '),
            placeHolder: 'Enter exclude patterns separated by commas (e.g., node_modules/**, .git/**, **/*.log)',
        });
        
        if (patternsString) {
            config.excludePatterns = patternsString.split(',').map(p => p.trim());
            // Also update user settings
            const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
            await extensionConfig.update('excludePatterns', config.excludePatterns, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Exclude patterns updated');
        }
    });

    // Command to edit commit message template
    let editCommitMessageTemplateCommand = vscode.commands.registerCommand('extension.editCommitMessageTemplate', async function () {
        const message = await vscode.window.showInputBox({
            value: config.commitMessage,
            placeHolder: 'Enter commit message template (use {date}, {branch}, {files} as placeholders)',
        });
        
        if (message) {
            config.commitMessage = message;
            // Also update user settings
            const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
            await extensionConfig.update('commitMessage', config.commitMessage, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Commit message template updated');
        }
    });

    // Register commands
    context.subscriptions.push(toggleAutoCommit);
    context.subscriptions.push(enableAutoCommitCommand);
    context.subscriptions.push(disableAutoCommitCommand);
    context.subscriptions.push(forceCommitNowCommand);
    context.subscriptions.push(changeCommitDelayCommand);
    context.subscriptions.push(configureRemoteCommand);
    context.subscriptions.push(showCommitHistoryCommand);
    context.subscriptions.push(showCommitLogCommand);
    context.subscriptions.push(showSettingsCommand);
    context.subscriptions.push(togglePushAfterCommitCommand);
    context.subscriptions.push(editExcludePatternsCommand);
    context.subscriptions.push(editCommitMessageTemplateCommand);

    // Initialize status bar
    updateStatusBar();
    
    // Create context menu for common operations
    vscode.commands.executeCommand('setContext', 'autoCommitEnabled', isEnabled);
    context.subscriptions.push(vscode.commands.registerCommand('extension.updateAutoCommitContext', () => {
        vscode.commands.executeCommand('setContext', 'autoCommitEnabled', isEnabled);
    }));
}

function deactivate() {
    // Cleanup resources
}

module.exports = {
    activate,
    deactivate
};