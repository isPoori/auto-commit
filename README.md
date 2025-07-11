# Omga Auto Commit

A VS Code extension that automatically commits and pushes your changes to Git repositories at regular intervals. Perfect for continuous version control without manual intervention.

## Key Features

- **Smart Auto-Commit**: Automatic commits with detailed file change tracking
- **Repository Management**: Initialize and configure Git repositories with prompts
- **Customizable Behavior**: Configure commit intervals, messages, and push settings
- **File Change Detection**: Identifies which files changed for detailed commit messages
- **Push Confirmation**: Optional confirmation before pushing changes to remote
- **Error Recovery**: Auto-retry for failed Git operations

## Usage

1. Open a Git repository in VS Code
2. Run `Enable Auto-Commit` from the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac)
3. Make changes to your files
4. The extension will automatically commit and track changed files

## Commands

Access these commands via the Command Palette:

| Command | Description |
|---------|-------------|
| `Enable Auto-Commit` | Start automatic commit monitoring |
| `Disable Auto-Commit` | Stop automatic commit monitoring |
| `Toggle Auto-Commit` | Switch between enabled/disabled states |
| `Commit Changes Now` | Force an immediate commit |
| `Change Auto-Commit Delay` | Modify time between automatic commits |
| `Configure Git Remote` | Set up or change remote Git repository |
| `Toggle Detailed Commit Messages` | Enable/disable file-specific commit details |
| `Toggle Confirmation Before Push` | Enable/disable push confirmation |

## Settings

| Setting | Description |
|---------|-------------|
| `autoCommit.commitDelay` | Time between commits in milliseconds (min 5000) |
| `autoCommit.pushAfterCommit` | Whether to push after each commit |
| `autoCommit.detailedCommitMessage` | Include specific file changes in commit messages |
| `autoCommit.maxFilesToList` | Maximum files to list in commit message |
| `autoCommit.confirmBeforePush` | Ask for confirmation before pushing |
| `autoCommit.excludePatterns` | File patterns to exclude from auto-commit |
| `autoCommit.commitMessage` | Commit message template with placeholders: `{date}`, `{branch}`, `{files}` |

## Keyboard Shortcuts

- `Ctrl+Alt+Shift+C` (`Cmd+Alt+Shift+C` on Mac): Force immediate commit
- `Ctrl+Alt+Shift+A` (`Cmd+Alt+Shift+A` on Mac): Toggle auto-commit

## Requirements

- Git installed and available in PATH
- VS Code 1.60.0 or higher

## Support & Contributions

Found a bug or have a feature request? Please open an issue at:
[GitHub Issues](https://github.com/isPoori/auto-commit/issues)

## Developer

Pouria Hosseini  
[Telegram](https://t.me/isPoori)
- - -
[Mail](mail:pouriahosseini@outlook.com)

## License

MIT License
