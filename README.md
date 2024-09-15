# Git History Diff

View git history. View commit details. View diff of committed files. View git blame info. View stash details.

GitHD aims to bring the most useful git history inside with the simplest and the most convenient way.

## What's new in 2.5

- Add stats chart. It reflects the commit stats of the history view.
  ![Image of stats chart](https://raw.githubusercontent.com/huizhougit/githd/master/resources/stats_chart.gif)

## Features

- View **branch history**.
- View **file history**.
- View **folder history**.
- View **line history**.
- View history **by author**.
- Select a commit from the history view to see **diff of committed files**.
- View **git stashes** and related **files' diffs**.
- View **git blame** which displays the latest commit info at the end of each line. Hover on it to see details.
- Input a commit sha1 to see **diff of the committed files**.
- View **all the diffs** between current branch and the selected one or between the two selected ones.
- View the **diff of a file or folder** between current branch and the selected one or between the two selected ones.
- View file diff between **un-committed local** and specified commit.
- Go back or forward on History view.
- Go back or forward on Explorer view.
- Check the previous (older) or next (newer) commit.
- Go to github PR links from blame view and commit info.
- View commit **stats chart**. It reflects the commit stats of the history view.

## Commands

_Press F1_ and type or select below commands to run.

- `GitHD: View History`
- `GitHD: View Branch History`
- `GitHD: View File History`
- `GitHD: View Line History`
- `GitHD: View Entire History`
- `GitHD: View Stashes`
- `GitHD: View Branch Diff`
- `GitHD: View Un-committed File Diff`
- `GitHD: Input Ref`

## Usage

### View Branch History and the Committed Changes

**Note**, when you select different branch to see it's history, the repo will not checkout to that branch.

![Image of branch history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/branch_history.gif)

### View File or Folder History

![Image of file history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/file_history.gif)

![Image of folder history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/folder_history.png)

### View line history and diff

![Image of line history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/line_history.png)

![Image of line diff](https://raw.githubusercontent.com/huizhougit/githd/master/resources/line_diff.png)

### Diff Branch

- Select a branch or ref to compare with current branch
- Select two branches or refs to compare with current branch. You are able to select a local branch to compare with another local or remote branch.
- Input a SHA to compare with current branch (`F1 -> GitHD: View Branch Diff -> Enter Commit SHA -> SHA`)
- Input two SHAs to see their diffs (`F1 -> GitHD: View Branch Diff -> Enter Commit SHA -> SHA1 .. SHA2`)

![Image of diff branch](https://raw.githubusercontent.com/huizhougit/githd/master/resources/diff_branch.gif)

### Git Blame

You are able to see the latest commit info of each line. Hover on it to see the details and
click the SHA to see committed files and their changes. You could disable it in the settings.

![Image of blame](https://raw.githubusercontent.com/huizhougit/githd/master/resources/blame.png)

![Image of blame](https://raw.githubusercontent.com/huizhougit/githd/master/resources/blame_hover.png)

### Display of the Committed Files

![Image of display files](https://raw.githubusercontent.com/huizhougit/githd/master/resources/display_files.gif)

### Express Mode

When the express mode is enabled, the History View will be loaded significantly faster especially when there are too many commits. But the stat info for each commit will not be displayed. You could toggle it in the settings.

## Settings

_Press F1_ and type or select `Preferences: Open Workspace Settings` or `Preferences: Open User Settings`. Search _**githd**_ and set the configurations.

![Image of the configurations](https://raw.githubusercontent.com/huizhougit/githd/master/resources/configurations.png)

## Changes

[Change Log](https://github.com/huizhougit/githd/blob/master/CHANGELOG.md)

## License

[MIT](https://raw.githubusercontent.com/huizhougit/githd/master/LICENSE)

## Thanks

**Big thanks** to all the contributors and users!

## Unofficial Author's Words

> This is the tool I wanted but could not find so wrote myself.
>
> 我会说中文。
>
> Enjoy it!
