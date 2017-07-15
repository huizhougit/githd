# Git History Diff

View the git log. And see the commit change details.

**NOTE:** This extension uses the SourceControl UI on ActivityBar but it actually only suports showing the diff. 

## Features
* **Config to list the committed files in Explorer View or SCM View (latest)**
* Viw the git log
* Viw the change details by following the links in the log view
* View the change details of a specified commit or ref

## Usage
### History View
* _Press F1_ and type or select `GitHD: View Log` to get the log view.
* _Press F1_ and type or select `GitHD: View Entire Log` to get the log view for all the history. **Note**, it may take a long time if the history is large.
* _Press F1_ and type or select `GitHD: Select Branch` to get the log view of that branch. You can also select the branch on the StatusBar. **Note**, it will NOT checkout to that branch.
            
    ![Image of branch select](https://raw.githubusercontent.com/huizhougit/githd/master/resources/statusbar_select_branch.png)

    ![Image of branch select](https://raw.githubusercontent.com/huizhougit/githd/master/resources/select_branch.png)

![Image of log view](https://raw.githubusercontent.com/huizhougit/githd/master/resources/log_view.gif)

### <a id="config"></a>Configuration

![Image of the configurations](https://raw.githubusercontent.com/huizhougit/githd/master/resources/configurations.png)

### Diff of Committed Files
You can config to use the Explorer View or the SCM View to list the committed files. See [Configuration](#config)
* #### SCM View of the Committed Files
    * _press F1_ and type or select `SCM: Switch SCM Provider` then select `GitHistoryDff` so you can see the diff of each files of the specified/selected commit.
    * On log view, follow the link of each commit to see the details of the changes.

    ![Image of commit input](https://raw.githubusercontent.com/huizhougit/githd/master/resources/commit_input.gif)

* #### Explorer View of the Committed Files
    * Select whether list the folders of the commited files in the Explorer View.

        ![Image of folder/nofolder select](https://raw.githubusercontent.com/huizhougit/githd/master/resources/statusbar_nofolder.png)

    * Committed Files without folder
    
        ![Image of committed files without folder](https://raw.githubusercontent.com/huizhougit/githd/master/resources/explorer_nofolder.png)

    * Committed Files with folder
    
        ![Image of committed files without folder](https://raw.githubusercontent.com/huizhougit/githd/master/resources/explorer_folder.png)

## Blemish
* _Cannot switch the SCMProvider automatically._
* _Cannot follow the link by single-click._
* _Cannot listen to the link clicked event but leverage creating a temp file and followed by a quick delete._

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