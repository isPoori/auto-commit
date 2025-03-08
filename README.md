# Omga Auto Commit

This extension automatically commits and pushes changes to your Git repository at regular intervals. Perfect for projects where you want to maintain a continuous history of your work without manually committing.

## Features

- **Automatic Commits**: Automatically commit your changes at regular intervals
- **Auto Push**: Optionally push commits to remote repository
- **Customizable Delay**: Set your preferred interval between commits
- **Exclude Patterns**: Define patterns to exclude from auto-commit
- **Status Bar Integration**: Visual indicator showing auto-commit status
- **Custom Commit Messages**: Customize commit message with dynamic placeholders
- **Error Recovery**: Automatically retry failed Git operations
- **Git Remote Setup**: Configure Git remote repositories easily
- **Repository Management**: Initialize Git repositories if needed

## Commands

All commands can be accessed via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac):

- `Enable Auto-Commit`: Start automatic commit monitoring
- `Disable Auto-Commit`: Stop automatic commit monitoring
- `Toggle Auto-Commit`: Switch between enabled and disabled states
- `Commit Changes Now`: Force an immediate commit
- `Change Auto-Commit Delay`: Modify the time between automatic commits
- `Configure Git Remote`: Set up or change the remote Git repository
- `Show Commit History`: View the Git history
- `Show Recent Commits`: Display recent commits in output panel
- `Open Auto-Commit Settings`: Open the extension settings
- `Toggle Push After Commit`: Enable/disable automatic pushing
- `Edit Exclude Patterns`: Modify the file patterns to ignore
- `Edit Commit Message Template`: Change the commit message format

## Keyboard Shortcuts

- `Ctrl+Alt+Shift+C` (`Cmd+Alt+Shift+C` on Mac): Force immediate commit
- `Ctrl+Alt+Shift+A` (`Cmd+Alt+Shift+A` on Mac): Toggle auto-commit

## Settings

This extension offers several customization options:

- `autoCommit.commitDelay`: Time in milliseconds between detecting changes and committing (minimum 5000)
- `autoCommit.pushAfterCommit`: Whether to push changes after each commit
- `autoCommit.excludePatterns`: Array of glob patterns to exclude from auto-commit
- `autoCommit.commitMessage`: Commit message template with placeholders:
  - `{date}`: Current date and time
  - `{branch}`: Current Git branch name
  - `{files}`: Number of files changed
- `autoCommit.branchHandling`: How to handle different branches
- `autoCommit.maxRetries`: Maximum number of retry attempts for Git operations
- `autoCommit.retryDelay`: Time in milliseconds between retry attempts
- `autoCommit.notifyOnCommit`: Show notification on successful commit
- `autoCommit.commitOnlyWithChanges`: Only commit when there are actual changes

## Installation

1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Omga Auto Commit"
4. Click Install

## Usage

1. Open a Git repository in VS Code
2. Run the command "Enable Auto-Commit" from the Command Palette
3. Make changes to your files
4. The extension will automatically commit (and push if configured) your changes

## Requirements

- Git must be installed and available in your PATH
- VS Code 1.60.0 or higher

## Extension Settings

This extension contributes the following settings:

* `autoCommit.commitDelay`: Delay between detecting changes and committing
* `autoCommit.pushAfterCommit`: Whether to push after each commit
* `autoCommit.excludePatterns`: File patterns to exclude
* `autoCommit.commitMessage`: Commit message template
* `autoCommit.branchHandling`: How to handle different branches
* `autoCommit.maxRetries`: Maximum number of retries
* `autoCommit.retryDelay`: Delay between retries
* `autoCommit.notifyOnCommit`: Show notification on commit
* `autoCommit.commitOnlyWithChanges`: Only commit when there are changes

## Known Issues

- The extension may conflict with other Git extensions that perform automatic operations
- Large repositories with many files may experience performance issues

## Release Notes

### 1.1.0

- Initial release
- Automatic commit and push functionality
- Customizable settings
- Status bar integration

## Issues & Contributions
If you find a bug or have suggestions, please open an issue at:
[GitHub Issues](https://github.com/isPoori/auto-commit/issues)

# Developer
Pouria Hosseini 
[Telegram](https://t.me/isPoori) 

## License

This extension is licensed under the **MIT License**.