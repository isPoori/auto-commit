# Omga Auto Commit

Auto Commit is a Visual Studio Code extension that automatically commits and pushes your code changes to Git every 30 seconds.

## Features
- Watches for file changes in your workspace.
- Commits changes automatically with a timestamp.
- Pushes the committed changes to the remote repository.
- Provides commands to enable or disable auto commit.

## Installation
### From VS Code Marketplace
1. Open **Visual Studio Code**.
2. Go to **Extensions** (`Ctrl+Shift+X` on Windows/Linux or `Cmd+Shift+X` on macOS).
3. Search for **Omga Auto Commit**.
4. Click **Install**.

## Usage
### Enable Auto Commit
1. Open **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
2. Type and select: `Enable Auto Commit`.
3. Your changes will now be committed and pushed automatically every 30 seconds.

### Disable Auto Commit
1. Open **Command Palette**.
2. Type and select: `Disable Auto Commit`.
3. Auto commit will be turned off.

## Requirements
- You must have **Git** installed and initialized in your workspace (`git init` if not already initialized).
- The workspace must be a valid Git repository with a remote set up.

## Notes
- If no changes are detected, no commit will be made.
- If an error occurs (e.g., no remote repository), an error message will be displayed.

## Issues & Contributions
If you find a bug or have suggestions, please open an issue at:
[GitHub Issues](https://github.com/isPoori/auto-commit/issues)

## License
This extension is licensed under the **MIT License**.

