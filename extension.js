const vscode = require('vscode');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('auto-commit extension is now active');

    // File watcher for detecting changes
    let fileWatcher = null;
    let commitTimeout = null;
    const COMMIT_DELAY = 30000; // 30-second delay between commits

    // Command to enable auto-commit
    let enableAutoCommit = vscode.commands.registerCommand('extension.enableAutoCommit', function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a project.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        
        // Check if this is a Git repository
        if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
            vscode.window.showErrorMessage('This project is not a Git repository.');
            return;
        }

        // Set up file watcher for changes
        if (fileWatcher) {
            fileWatcher.dispose();
        }

        fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.*');
        
        fileWatcher.onDidChange(() => scheduleCommit(workspaceRoot));
        fileWatcher.onDidCreate(() => scheduleCommit(workspaceRoot));
        fileWatcher.onDidDelete(() => scheduleCommit(workspaceRoot));

        vscode.window.showInformationMessage('Auto-commit enabled. Changes will be committed and pushed every 30 seconds.');
    });

    // Command to disable auto-commit
    let disableAutoCommit = vscode.commands.registerCommand('extension.disableAutoCommit', function () {
        if (fileWatcher) {
            fileWatcher.dispose();
            fileWatcher = null;
        }
        
        if (commitTimeout) {
            clearTimeout(commitTimeout);
            commitTimeout = null;
        }

        vscode.window.showInformationMessage('Auto-commit disabled.');
    });

    function scheduleCommit(workspaceRoot) {
        // Cancel previous timer
        if (commitTimeout) {
            clearTimeout(commitTimeout);
        }

        // Set a new timer
        commitTimeout = setTimeout(() => {
            const commitMessage = `Auto commit: ${new Date().toLocaleString()}`;
            
            // Execute Git commands
            exec(`cd "${workspaceRoot}" && git add . && git commit -m "${commitMessage}" && git push origin HEAD`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error: ${error.message}`);
                    if (error.message.includes('nothing to commit')) {
                        vscode.window.showInformationMessage('No changes to commit.');
                    } else {
                        vscode.window.showErrorMessage(`Commit error: ${error.message}`);
                    }
                    return;
                }
                
                // نمایش خروجی stdout و stderr
                if (stdout) {
                    console.log(`stdout: ${stdout}`);
                }
                if (stderr) {
                    console.log(`stderr: ${stderr}`);
                }
                
                vscode.window.showInformationMessage('Changes successfully committed and pushed.');
            });
        }, COMMIT_DELAY);
    }

    context.subscriptions.push(enableAutoCommit);
    context.subscriptions.push(disableAutoCommit);
}

function deactivate() {
    // Cleanup resources
}

module.exports = {
    activate,
    deactivate
};
