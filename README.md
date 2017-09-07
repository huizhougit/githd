# Git History Diff

View the git history. See the committed changes.

## Features
* View **branch history**.
* View **file history**.
* View **folder history**.
* View **commit details**.
* Select a commit from the history view to see the **committed changes**.
* Input a commit sha1 to see the **committed changes**.
* View **all the diffs** between current branch and the selected one.
* View the **diff of a file** between current branch and the selected one.
* View the **diff of a folder** between current branch and the selected one.

## _**0.8.0 Behavior Changes**_
|Behavior |Old operation |New operation
|-|-|-
|_Display the committed files_ |~~Ctrl/Cmd+click the SHA1~~ |_**Single-click** the SHA1_
|_Display more commits on History view_ |~~Ctrl/Cmd+click the ...~~ ;   |_**Single-click** the ···_
|_Select a branch_ |~~Click the statusbar item~~ |_Click the **branch name** from the History view_

## Commands
_Press F1_ and type or select below commands to run.
* `GitHD: View History`
* `GitHD: View Branch History`
* `GitHD: View Entire History`
* `GitHD: View Branch Diff`
* `GitHD: Input Ref`

## Usage
### View Branch History and the Committed Changes
**Note**, when you select different branch to see it's history, the repo will not checkout to that branch.
![Image of branch history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/branch_history.gif) 

### View File or Folder History
![Image of file history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/file_history.gif) 

![Image of folder history](https://raw.githubusercontent.com/huizhougit/githd/master/resources/folder_history.png) 

### Diff Branch
![Image of diff branch](https://raw.githubusercontent.com/huizhougit/githd/master/resources/diff_branch.gif) 

### Display of the Committed Files
![Image of display files](https://raw.githubusercontent.com/huizhougit/githd/master/resources/display_files.gif) 

## <a id="config"></a>Configuration
_Press F1_ and type or select `Preferences: Open Workspace Settings` or  `Preferences: Open User Settings` and set the configurations.

![Image of the configurations](https://raw.githubusercontent.com/huizhougit/githd/master/resources/configurations.png)

## Changes
[Change Log](https://github.com/huizhougit/githd/blob/master/CHANGELOG.md#080)

## Blemish
* _Cannot focus on the explorer view automatically after selecting the commit._

## License
[MIT](https://raw.githubusercontent.com/huizhougit/githd/master/LICENSE)

## Unofficial Author's Words
>This is the tool I wanted but could not find so wrote myself.
>
>I don't know why I put the Blemish here.
>
>我会说中文。
>
>Enjoy it!