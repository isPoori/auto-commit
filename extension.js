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
    let changedFilesSet = new Set(); // Track changed files since last commit

    // Configuration settings with defaults
    let config = {
        commitDelay: 30000,       // Default: 30 seconds
        pushAfterCommit: true,    // Default: push after each commit
        excludePatterns: ['node_modules/**', '.git/**', '**/*.log'],
        commitMessage: "Auto commit: {date} - {files} files changed",
        detailedCommitMessage: true, // Default: include detailed file changes
        maxFilesToList: 5,        // Maximum number of files to list in commit message
        branchHandling: 'currentBranchOnly', // 'currentBranchOnly', 'allBranches'
        maxRetries: 3,            // Maximum number of retries for git operations
        retryDelay: 5000,         // Delay between retries in milliseconds
        notifyOnCommit: true,     // Show notification on successful commit
        commitOnlyWithChanges: true, // Only commit when there are actual changes
        confirmBeforePush: false, // Ask for confirmation before pushing to remote
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
        config.detailedCommitMessage = extensionConfig.get('detailedCommitMessage', true);
        config.maxFilesToList = extensionConfig.get('maxFilesToList', 5);
        config.branchHandling = extensionConfig.get('branchHandling', 'currentBranchOnly');
        config.maxRetries = extensionConfig.get('maxRetries', 3);
        config.retryDelay = extensionConfig.get('retryDelay', 5000);
        config.notifyOnCommit = extensionConfig.get('notifyOnCommit', true);
        config.commitOnlyWithChanges = extensionConfig.get('commitOnlyWithChanges', true);
        config.confirmBeforePush = extensionConfig.get('confirmBeforePush', false);
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

    // Function to schedule a commit
    function scheduleCommit(workspaceRoot) {
        if (commitTimeout) {
            clearTimeout(commitTimeout);
        }
        
        commitTimeout = setTimeout(async () => {
            await performCommit(workspaceRoot);
            commitTimeout = null;
        }, config.commitDelay);
    }
    
    // Helper function to check if a file should be ignored based on exclude patterns
    function shouldIgnoreFile(filePath) {
        if (!filePath) return true;
        
        const relativePath = path.relative(currentWorkspaceRoot, filePath);
        
        for (const pattern of config.excludePatterns) {
            if (vscode.languages.match({ pattern }, vscode.Uri.file(filePath))) {
                return true;
            }
        }
        
        return false;
    }
    
    // Handle file path for tracking
    function trackFileChange(filePath) {
        if (!filePath || shouldIgnoreFile(filePath)) return;
        
        const relativePath = path.relative(currentWorkspaceRoot, filePath);
        changedFilesSet.add(relativePath);
    }

    // Disable auto-commit
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
        changedFilesSet.clear();
        pendingChangesCount = 0;
        updateStatusBar();
        vscode.commands.executeCommand('extension.updateAutoCommitContext');
        vscode.window.showInformationMessage('Auto-commit disabled.');
    }

    async function enableAutoCommit() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a project.');
            return;
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        currentWorkspaceRoot = workspaceRoot;
        
        // First check if Git is installed
        try {
            execSync('git --version', { encoding: 'utf8' });
        } catch (error) {
            vscode.window.showErrorMessage('Git is not installed or not in the PATH. Please install Git before using Auto-Commit.');
            return;
        }
        
        // Now check if this is a Git repository
        const isRepo = await safeIsGitRepository(workspaceRoot);
        
        if (!isRepo) {
            const shouldInitialize = await vscode.window.showInformationMessage(
                'This project is not a Git repository. Would you like to initialize one?', 
                'Yes', 'No'
            );
            
            if (shouldInitialize === 'Yes') {
                const initialized = await safeInitializeGitRepository(workspaceRoot);
                if (!initialized) {
                    vscode.window.showErrorMessage('Failed to initialize Git repository. Auto-commit has been disabled.');
                    return;
                }
                vscode.window.showInformationMessage('Git repository initialized successfully!');
            } else {
                vscode.window.showInformationMessage('Auto-commit requires a Git repository. Operation cancelled.');
                return;
            }
        }
        
        // Double-check that we now have a Git repository
        const repoExists = await safeIsGitRepository(workspaceRoot);
        if (!repoExists) {
            vscode.window.showErrorMessage('Unable to confirm Git repository exists. Auto-commit has been disabled.');
            return;
        }
        
        // Check if remote exists and offer to set it up
        const remoteExists = await safeCheckRemoteExists(workspaceRoot);
        if (!remoteExists && config.pushAfterCommit) {
            const shouldConfigure = await vscode.window.showInformationMessage(
                'No remote repository is configured. Would you like to set one up now?',
                'Yes', 'Not Now'
            );
            
            if (shouldConfigure === 'Yes') {
                vscode.commands.executeCommand('extension.configureGitRemote');
            }
        }
        
        // Clear previous changed files
        changedFilesSet.clear();
        
        // Set up file watcher for changes
        if (fileWatcher) {
            fileWatcher.dispose();
        }
        
        try {
            fileWatcher = vscode.workspace.createFileSystemWatcher(`**/*`, false, false, false);
            
            fileWatcher.onDidChange(uri => {
                if (shouldIgnoreFile(uri.fsPath)) return;
                pendingChangesCount++;
                trackFileChange(uri.fsPath);
                scheduleCommit(workspaceRoot);
                updateStatusBar();
            });
            
            fileWatcher.onDidCreate(uri => {
                if (shouldIgnoreFile(uri.fsPath)) return;
                pendingChangesCount++;
                trackFileChange(uri.fsPath);
                scheduleCommit(workspaceRoot);
                updateStatusBar();
            });
            
            fileWatcher.onDidDelete(uri => {
                if (shouldIgnoreFile(uri.fsPath)) return;
                pendingChangesCount++;
                trackFileChange(uri.fsPath);
                scheduleCommit(workspaceRoot);
                updateStatusBar();
            });
            
            isEnabled = true;
            updateStatusBar();
            vscode.commands.executeCommand('extension.updateAutoCommitContext');
            vscode.window.showInformationMessage(`Auto-commit enabled. Changes will be committed every ${config.commitDelay / 1000} seconds.`);
        } catch (error) {
            console.error('Error setting up file watcher:', error);
            vscode.window.showErrorMessage(`Failed to set up file watcher: ${error.message}`);
        }
    }
    
    // Safe check for Git repository
    async function safeIsGitRepository(workspaceRoot) {
        try {
            // Check using the fs module
            if (fs.existsSync(path.join(workspaceRoot, '.git'))) {
                return true;
            }
            
            // Double-check with Git command
            try {
                execSync(`cd "${workspaceRoot}" && git rev-parse --is-inside-work-tree`, {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                return true;
            } catch (cmdError) {
                return false;
            }
        } catch (error) {
            console.error('Error checking Git repository:', error);
            return false;
        }
    }
    
    // Safe Git repository initialization
    async function safeInitializeGitRepository(workspaceRoot) {
        return new Promise((resolve) => {
            try {
                // Check if directory exists and is accessible
                if (!fs.existsSync(workspaceRoot)) {
                    console.error(`Directory does not exist: ${workspaceRoot}`);
                    resolve(false);
                    return;
                }
                
                // Make sure we have write permissions
                try {
                    const testFile = path.join(workspaceRoot, '.git-test');
                    fs.writeFileSync(testFile, 'test');
                    fs.unlinkSync(testFile);
                } catch (fsError) {
                    console.error(`No write permission in directory: ${workspaceRoot}`, fsError);
                    resolve(false);
                    return;
                }
                
                // Initialize Git repository
                let command = `cd "${workspaceRoot}" && git init`;
                
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Git init error: ${error.message}`);
                        console.error(`Git init stderr: ${stderr}`);
                        resolve(false);
                        return;
                    }
                    
                    // Create a .gitignore file
                    try {
                        const gitignoreContent = `# Auto-generated .gitignore\r\nnode_modules/\r\n.DS_Store\r\nThumbs.db\r\n*.log\r\n.vscode/\r\ndist/\r\nbuild/\r\n*.tmp\r\n`;
                        fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), gitignoreContent);
                    } catch (writeError) {
                        console.error('Error creating .gitignore:', writeError);
                        // Continue even if .gitignore creation fails
                    }
                    
                    // Make an initial commit
                    command = `cd "${workspaceRoot}" && git add .gitignore && git config --local user.name "Auto Commit" && git config --local user.email "auto@commit.local" && git commit -m "Initial commit"`;
                    
                    exec(command, (commitError, commitStdout, commitStderr) => {
                        if (commitError) {
                            console.error(`Initial commit error: ${commitError.message}`);
                            console.error(`Initial commit stderr: ${commitStderr}`);
                            // Still resolve true as repository was initialized, even if commit failed
                        }
                        
                        // Double-check repository was created
                        if (fs.existsSync(path.join(workspaceRoot, '.git'))) {
                            resolve(true);
                        } else {
                            console.error('Git directory not found after initialization');
                            resolve(false);
                        }
                    });
                });
            } catch (error) {
                console.error('Fatal error during Git initialization:', error);
                resolve(false);
            }
        });
    }
    
    // Function to get detailed file changes for commit message
    async function getDetailedFileChanges(workspaceRoot) {
        if (changedFilesSet.size === 0) return '';
        
        // Convert the Set to Array and get the most recent files
        const changedFiles = Array.from(changedFilesSet);
        const filesToShow = changedFiles.slice(0, config.maxFilesToList);
        const additionalCount = changedFiles.length - filesToShow.length;
        
        let filesList = filesToShow.map(file => `\n- ${file}`).join('');
        if (additionalCount > 0) {
            filesList += `\n- and ${additionalCount} more file(s)`;
        }
        
        return filesList;
    }

    async function performCommit(workspaceRoot, forced = false) {
        try {
            // First verify we're in a Git repository
            const isRepo = await safeIsGitRepository(workspaceRoot);
            if (!isRepo) {
                console.error('Not a Git repository when attempting to commit');
                vscode.window.showErrorMessage('Cannot commit: Not in a Git repository. Auto-commit has been disabled.');
                await disableAutoCommit();
                return;
            }
    
            // Check for changes if needed
            if (config.commitOnlyWithChanges && !forced) {
                try {
                    const hasChanges = await safeCheckForPendingChanges(workspaceRoot);
                    if (!hasChanges) {
                        console.log('No changes to commit');
                        pendingChangesCount = 0;
                        changedFilesSet.clear();
                        updateStatusBar();
                        return;
                    }
                } catch (error) {
                    console.error('Error checking for pending changes:', error);
                    // Continue anyway as best effort
                }
            }
    
            // Get current branch name (with fallback)
            let branch = 'main';
            try {
                branch = await safeGetCurrentBranch(workspaceRoot);
            } catch (error) {
                console.error('Error getting current branch:', error);
            }
            
            // Get list of changed files for commit message (with fallback)
            let changedFiles = '0';
            try {
                changedFiles = await safeGetChangedFilesCount(workspaceRoot);
            } catch (error) {
                console.error('Error getting changed files count:', error);
            }
            
            // Get detailed file changes if enabled
            let detailedChanges = '';
            if (config.detailedCommitMessage) {
                try {
                    detailedChanges = await getDetailedFileChanges(workspaceRoot);
                } catch (error) {
                    console.error('Error getting detailed file changes:', error);
                }
            }
            
            // Format commit message
            let commitMessage = config.commitMessage
                .replace('{date}', new Date().toLocaleString())
                .replace('{branch}', branch)
                .replace('{files}', changedFiles);
                
            // Add detailed file changes if available
            if (detailedChanges) {
                commitMessage += `${detailedChanges}`;
            }
            
            // Safety check for empty message
            if (!commitMessage.trim()) {
                commitMessage = `Auto commit: ${new Date().toLocaleString()}`;
            }
            
            // Make sure the message doesn't have problematic characters
            commitMessage = commitMessage.replace(/"/g, '\\"');
            
            // Execute Git add command
            try {
                await safeExecuteGitCommand(`cd "${workspaceRoot}" && git add .`, workspaceRoot);
                
                // Perform commit
                await safeExecuteGitCommand(`cd "${workspaceRoot}" && git commit -m "${commitMessage}"`, workspaceRoot);
                
                // Push if configured
                if (config.pushAfterCommit) {
                    try {
                        const remoteExists = await safeCheckRemoteExists(workspaceRoot);
                        if (remoteExists) {
                            // Ask for confirmation if enabled
                            let shouldPush = true;
                            if (config.confirmBeforePush) {
                                const pushConfirmation = await vscode.window.showInformationMessage(
                                    'Changes committed. Push to remote repository?',
                                    'Yes', 'No'
                                );
                                shouldPush = (pushConfirmation === 'Yes');
                            }
                            
                            if (shouldPush) {
                                await safeExecuteGitCommand(`cd "${workspaceRoot}" && git push -u origin ${branch}`, workspaceRoot);
                                if (config.notifyOnCommit) {
                                    vscode.window.showInformationMessage(
                                        `Changes committed and pushed to ${branch}.`,
                                        'View Changes'
                                    ).then(selection => {
                                        if (selection === 'View Changes') {
                                            vscode.commands.executeCommand('git.viewHistory');
                                        }
                                    });
                                }
                            } else {
                                vscode.window.showInformationMessage('Changes committed but not pushed.');
                            }
                        } else {
                            console.log('No remote repository configured, skipping push');
                            if (config.notifyOnCommit) {
                                vscode.window.showInformationMessage(
                                    'Changes committed but not pushed (no remote configured). Would you like to set up a remote?',
                                    'Configure Remote', 'Not Now'
                                ).then(selection => {
                                    if (selection === 'Configure Remote') {
                                        vscode.commands.executeCommand('extension.configureGitRemote');
                                    }
                                });
                            }
                        }
                    } catch (pushError) {
                        console.error('Error pushing changes:', pushError);
                        vscode.window.showWarningMessage(`Changes committed but failed to push: ${pushError.message}`);
                    }
                }
                
                // Update status
                lastCommitTime = new Date().toLocaleString();
                pendingChangesCount = 0;
                changedFilesSet.clear();
                updateStatusBar();
                
                if (config.notifyOnCommit && !config.pushAfterCommit) {
                    vscode.window.showInformationMessage(
                        `Changes successfully committed.`,
                        'View Changes'
                    ).then(selection => {
                        if (selection === 'View Changes') {
                            vscode.commands.executeCommand('git.viewHistory');
                        }
                    });
                }
            } catch (error) {
                // Handle nothing to commit error gracefully
                if (error.message && error.message.includes('nothing to commit')) {
                    console.log('Nothing to commit');
                    pendingChangesCount = 0;
                    changedFilesSet.clear();
                    updateStatusBar();
                    return;
                }
                
                console.error(`Error performing commit operations: ${error.message}`);
                vscode.window.showErrorMessage(`Commit error: ${error.message}`);
            }
        } catch (outerError) {
            console.error(`Fatal error in performCommit: ${outerError.message}`);
            vscode.window.showErrorMessage(`Failed to commit changes: ${outerError.message}`);
        }
    }
    
    // Safer Git command execution
    async function safeExecuteGitCommand(command, workspaceRoot, attempt = 1) {
        return new Promise((resolve, reject) => {
            // First verify we're still in a Git repository
            if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
                reject(new Error('Not a Git repository when attempting to execute command'));
                return;
            }
            
            exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                if (error) {
                    if (attempt <= config.maxRetries) {
                        console.log(`Retry ${attempt}/${config.maxRetries} for command: ${command}`);
                        setTimeout(() => {
                            safeExecuteGitCommand(command, workspaceRoot, attempt + 1)
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
    
    async function safeCheckForPendingChanges(workspaceRoot) {
        return new Promise((resolve) => {
            exec(`cd "${workspaceRoot}" && git status --porcelain`, (error, stdout) => {
                if (error) {
                    console.error(`Error checking pending changes: ${error.message}`);
                    resolve(false);
                    return;
                }
                resolve(stdout.trim().length > 0);
            });
        });
    }
    
    async function safeGetCurrentBranch(workspaceRoot) {
        return new Promise((resolve) => {
            exec(`cd "${workspaceRoot}" && git branch --show-current`, (error, stdout) => {
                if (error) {
                    console.error(`Error getting current branch: ${error.message}`);
                    resolve('main'); // Default fallback
                    return;
                }
                const branch = stdout.trim();
                resolve(branch || 'main'); // Fallback if empty
            });
        });
    }
    
    async function safeGetChangedFilesCount(workspaceRoot) {
        return new Promise((resolve) => {
            exec(`cd "${workspaceRoot}" && git status --porcelain | wc -l`, (error, stdout) => {
                if (error) {
                    console.error(`Error getting changed files count: ${error.message}`);
                    resolve('0'); // Default fallback
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }
    
    async function safeCheckRemoteExists(workspaceRoot) {
        return new Promise((resolve) => {
            exec(`cd "${workspaceRoot}" && git remote -v`, (error, stdout) => {
                if (error) {
                    console.error(`Error checking remote: ${error.message}`);
                    resolve(false);
                    return;
                }
                resolve(stdout.trim().length > 0);
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
        const remoteExists = await safeCheckRemoteExists(workspaceRoot);
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
                await safeExecuteGitCommand(`cd "${workspaceRoot}" && git remote remove origin`, workspaceRoot);
            }
            
            await safeExecuteGitCommand(`cd "${workspaceRoot}" && git remote add origin ${remoteUrl}`, workspaceRoot);
            
            // Try to set upstream branch
            try {
                const branch = await safeGetCurrentBranch(workspaceRoot);
                
                // Ask if user wants to push immediately
                const shouldPush = await vscode.window.showInformationMessage(
                    'Remote repository configured. Would you like to push your current branch now?',
                    'Yes', 'No'
                );
                
                if (shouldPush === 'Yes') {
                    try {
                        await safeExecuteGitCommand(`cd "${workspaceRoot}" && git push -u origin ${branch}`, workspaceRoot);
                        vscode.window.showInformationMessage('Remote repository configured and changes pushed successfully.');
                    } catch (pushError) {
                        vscode.window.showErrorMessage(`Failed to push changes: ${pushError.message}`);
                    }
                } else {
                    vscode.window.showInformationMessage('Remote repository configured. You can push changes manually or wait for the next auto-commit.');
                }
            } catch (error) {
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

    // Command to toggle detailed commit messages
    let toggleDetailedCommitCommand = vscode.commands.registerCommand('extension.toggleDetailedCommit', async function () {
        config.detailedCommitMessage = !config.detailedCommitMessage;
        // Also update user settings
        const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
        await extensionConfig.update('detailedCommitMessage', config.detailedCommitMessage, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Detailed commit messages: ${config.detailedCommitMessage ? 'Enabled' : 'Disabled'}`);
    });

    // Command to toggle confirmation before push
    let toggleConfirmBeforePushCommand = vscode.commands.registerCommand('extension.toggleConfirmBeforePush', async function () {
        config.confirmBeforePush = !config.confirmBeforePush;
        // Also update user settings
        const extensionConfig = vscode.workspace.getConfiguration('autoCommit');
        await extensionConfig.update('confirmBeforePush', config.confirmBeforePush, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Confirm before push: ${config.confirmBeforePush ? 'Enabled' : 'Disabled'}`);
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
    context.subscriptions.push(toggleDetailedCommitCommand);
    context.subscriptions.push(toggleConfirmBeforePushCommand);
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