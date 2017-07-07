# Git History Diff

View the git log. And see the commit change details.

**NOTE:** This extension uses the SourceControl UI on ActivityBar but it actually only suports showing the diff. 

## Features
* **Viw the git log (latest)**
* **Viw the change details by following the links in the log view (latest)** 
* View the change details of a specified commit
* View the change details of a specified ref name

## Usage
* _Press F1_ and type or select **_GitHD:View Log_** to get the log view.
* _press F1_ and type or select **_SCM:Switch SCM Provider_** then select **_GitHistoryDff_** so you can see the diff of each files of the specified/selected commit.
* On log view, follow the link of each commit to see the details of the changes.

## Blemish
* __Cannot switch the SCMProvider automatically.__
* __Cannot follow the link by single-click.__
* __Cannot listen to the link clicked event but leverage creating a temp file and followed by a quick delete.__

![Image of commit input](https://raw.githubusercontent.com/huizhougit/githd/master/resources/commit_input.gif)
![Image of log view](https://raw.githubusercontent.com/huizhougit/githd/master/resources/log_view.gif)

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