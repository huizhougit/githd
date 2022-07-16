import * as vs from 'vscode';

import { HistoryViewContext, Model } from './model';
import { GitService, GitLogEntry } from './gitService';
import { getIconUri } from './icons';
import { ClickableProvider } from './clickable';
import { decorateWithoutWhitespace, getTextEditor, getPullRequest } from './utils';
import { Tracer } from './tracer';

const firstLoadingCount = 25;
const loadingPageSize = 300;

const stashTitleLabel = 'Git Stashes';
const titleLabel = 'Git History';
const moreLabel = '\u00b7\u00b7\u00b7';
const separatorLabel = '--------------------------------------------------------------';

const branchHoverMessage = new vs.MarkdownString('Select a branch to see its history');
const authorHoverMessage = new vs.MarkdownString('Select an author to see the commits');
const loadMoreHoverMessage = new vs.MarkdownString('Load more commits');
const prHoverMessage = new vs.MarkdownString('Click to see GitHub PR');

function getHistoryViewEditor(): vs.TextEditor | undefined {
  return vs.window.visibleTextEditors.find(editor => editor.document.uri.scheme === HistoryViewProvider.scheme);
}

export class HistoryViewProvider implements vs.TextDocumentContentProvider {
  static scheme: string = 'githd-logs';
  static defaultUri: vs.Uri = vs.Uri.parse(HistoryViewProvider.scheme + '://authority/Git History');

  private _clickableProvider = new ClickableProvider(HistoryViewProvider.scheme);
  private _commitsCount = 200;
  private _content = '';
  private _logCount = 0;
  private _currentLine = 0;
  private _loadAll = false;
  private _updating = false;
  private _loadMoreClicked = false;
  private _leftCount = 0;
  private _totalCommitsCount = 0;
  private _onDidChange = new vs.EventEmitter<vs.Uri>();

  private readonly _titleDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.title')
  });
  private readonly _branchDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.branch')
  });
  private readonly _fileDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.filePath')
  });
  private readonly _subjectDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.subject')
  });
  private readonly _hashDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.hash')
  });
  private readonly _selectedHashDecoration = vs.window.createTextEditorDecorationType({
    backgroundColor: new vs.ThemeColor('merge.currentContentBackground'),
    isWholeLine: true,
    overviewRulerColor: 'darkgreen',
    overviewRulerLane: vs.OverviewRulerLane.Full
  });
  private readonly _refDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.ref')
  });
  private readonly _authorDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.author')
  });
  private readonly _emailDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.email')
  });
  private readonly _moreDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.historyView.more')
  });
  private readonly _loadingDecoration = vs.window.createTextEditorDecorationType({
    light: {
      after: {
        contentIconPath: getIconUri('loading', 'light')
      }
    },
    dark: {
      after: {
        contentIconPath: getIconUri('loading', 'dark')
      }
    }
  });

  private _titleDecorationOptions: vs.Range[] = [];
  private _fileDecorationRange: vs.Range | undefined;
  private _branchDecorationRange: vs.Range | undefined;
  private _subjectDecorationOptions: vs.Range[] = [];
  private _hashDecorationOptions: vs.Range[] = [];
  private _refDecorationOptions: vs.Range[] = [];
  private _authorDecorationOptions: vs.Range[] = [];
  private _emailDecorationOptions: vs.Range[] = [];
  private _moreClickableRange: vs.Range | undefined;

  private _repoStatusBar: vs.StatusBarItem = vs.window.createStatusBarItem(undefined, 1);
  private _expressStatusBar: vs.StatusBarItem = vs.window.createStatusBarItem(undefined, 2);
  private _express = false;

  constructor(context: vs.ExtensionContext, private _model: Model, private _gitService: GitService) {
    Tracer.info('Creating history view');
    context.subscriptions.push(vs.workspace.registerTextDocumentContentProvider(HistoryViewProvider.scheme, this));

    this._expressStatusBar.command = 'githd.setExpressMode';
    this._expressStatusBar.tooltip = 'Turn on or off of the history view Express mode';
    this.express = this._model.configuration.expressMode;
    this.commitsCount = this._model.configuration.commitsCount;
    this._model.onDidChangeConfiguration(
      config => {
        this.commitsCount = config.commitsCount;
        this._updateExpressStatusBar();
      },
      null,
      context.subscriptions
    );
    this._model.onDidChangeHistoryViewContext(context => {
      Tracer.verbose(`HistoryView: onDidChangeHistoryViewContext`);
      vs.workspace.openTextDocument(HistoryViewProvider.defaultUri).then(async doc => {
        vs.window.showTextDocument(doc, {
          preview: false,
          preserveFocus: true
        });
        this._loadMoreClicked = false;
        await this._updateContent(false);
        this._moveToTop(getHistoryViewEditor());
      });
    });

    this._gitService.onDidChangeGitRepositories(repos => {
      this._updateExpressStatusBar();
    });

    vs.window.onDidChangeActiveTextEditor(
      editor => {
        if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
          Tracer.verbose(`HistoryView: onDidChangeActiveTextEditor`);
          if (!this._updating) {
            // If it's updating, _setDecorations will be called after it's updated.
            this._setDecorations(editor);
          }
          this.repo = this._model.historyViewContext?.repo?.root;
        } else {
          this.repo = undefined;
        }
      },
      null,
      context.subscriptions
    );

    vs.workspace.onDidChangeTextDocument(
      e => {
        if (e.document.uri.scheme === HistoryViewProvider.scheme) {
          Tracer.verbose('HistoryView: onDidChangeTextDocument');
          const editor = getTextEditor(e.document);
          this._setDecorations(editor);
          if (this._leftCount > 0) {
            this._updateContent(false);
          } else {
            if (!this._loadMoreClicked) {
              this._moveToTop(editor);
            }
            this._updating = false;
          }
        }
      },
      null,
      context.subscriptions
    );

    vs.workspace.onDidCloseTextDocument(doc => {
      if (doc.uri.scheme === HistoryViewProvider.scheme) {
        Tracer.verbose('HistoryView: onDidCloseTextDocument');
        this._reset();
      }
    });

    this._updateExpressStatusBar();

    context.subscriptions.push(
      this._expressStatusBar,
      this._repoStatusBar,
      this._onDidChange,
      this._clickableProvider,
      this._titleDecoration,
      this._fileDecoration,
      this._subjectDecoration,
      this._hashDecoration,
      this._selectedHashDecoration,
      this._refDecoration,
      this._authorDecoration,
      this._emailDecoration,
      this._moreDecoration,
      this._branchDecoration,
      this._loadingDecoration
    );
    Tracer.info('History view created');
  }

  get onDidChange(): vs.Event<vs.Uri> {
    return this._onDidChange.event;
  }

  set loadAll(value: boolean) {
    this._loadAll = value;
  }
  get express(): boolean {
    return this._express;
  }
  set express(value: boolean) {
    this._express = value;
    this._expressStatusBar.text = 'githd: Express ' + (value ? 'On' : 'Off');
  }

  private set commitsCount(count: number) {
    if (
      [100, 200, 300, 400, 500, 1000].findIndex(a => {
        return a === count;
      }) >= 0
    ) {
      this._commitsCount = count;
    }
  }

  private set repo(repo: string | undefined) {
    if (repo) {
      this._repoStatusBar.text = 'githd: Repository ' + repo;
      this._repoStatusBar.show();
    } else {
      this._repoStatusBar.hide();
    }
  }

  provideTextDocumentContent(uri: vs.Uri): string {
    Tracer.verbose(`HistoryView: provideTextDocumentContent length: ${this._content.length}`);
    return this._content;
  }

  private _updateExpressStatusBar() {
    if (this._model.configuration.displayExpress && this._gitService.getGitRepos().length > 0) {
      this._expressStatusBar.show();
    } else {
      this._expressStatusBar.hide();
    }
  }

  private _update() {
    Tracer.info(`HistoryView: _update`);
    this._onDidChange.fire(HistoryViewProvider.defaultUri);
  }

  // When start showing the history view page, we do two phase loading for better
  // user experience. Firstly, it displays the first firstLoadingCount entries.
  // Then, it displays the left ones right after the first displaying.
  private async _updateContent(loadMore: boolean): Promise<void> {
    const context = this._model.historyViewContext;
    if (!context) {
      return;
    }

    Tracer.verbose(
      `HistoryView: left count ${this._leftCount}, current total count ${this._totalCommitsCount}, load more ${loadMore}`
    );

    this._updating = true;

    Tracer.info(`HistoryView: _updateContent. ${JSON.stringify(context)}`);

    const prevContent = this._content;
    const isStash = context.isStash ?? false;
    const firstLoading = this._leftCount == 0;
    let logCount = this._express ? 2 * firstLoadingCount : firstLoadingCount;
    if (firstLoading) {
      if (loadMore) {
        this._content = this._content.substring(0, this._content.length - moreLabel.length - 1);
        this._content += separatorLabel + '\n\n';
        this._currentLine += 2;
      } else {
        this._reset();
      }

      // No pagination loading for statsh or line history.
      if (isStash || (context.specifiedPath && context.line)) {
        logCount = Number.MAX_SAFE_INTEGER;
      } else {
        const commitsCount = await this._gitService.getCommitsCount(
          context.repo,
          context.branch,
          context.specifiedPath,
          context.author
        );
        let loadingCount = Math.min(commitsCount - this._logCount, this._commitsCount);
        if (this._loadAll) {
          loadingCount = commitsCount - this._logCount;
        }
        this._leftCount = Math.max(0, loadingCount - firstLoadingCount);
        this._totalCommitsCount = commitsCount;
      }
    } else {
      logCount = this._express ? 5 * loadingPageSize : loadingPageSize;
      logCount = Math.min(logCount, this._leftCount);
      this._leftCount = this._leftCount - logCount;
    }

    const entries: GitLogEntry[] = await this._gitService.getLogEntries(
      context.repo,
      this._express,
      this._logCount,
      logCount,
      context.branch,
      context.isStash,
      context.specifiedPath,
      context.line,
      context.author
    );
    if (entries.length === 0) {
      this._reset();
      this._content = isStash ? 'No Stash' : 'No History';
      this._update();
      return;
    }

    let content = '';
    if (firstLoading && !loadMore) {
      this._reset();
      content = await this._updateTitleInfo(context);
    }

    // const hasMore = !firstLoading && !isStash && this._currentTotalCount > logCount + this._logCount;
    entries.forEach(entry => {
      ++this._logCount;
      content += this._updateSubject(entry.subject, context.repo.remoteUrl);
      content += this._updateInfo(context, entry, isStash);
      content += this._updateStat(context, entry);
      content += '\n';
      ++this._currentLine;
    });

    // All loadings are finished.
    if (this._leftCount == 0) {
      if (this._totalCommitsCount > this._logCount) {
        content += this._createClickableForMore();
      } else {
        this._moreClickableRange = undefined;
      }
      this._totalCommitsCount = 0;
    }

    this._content += content;
    if (this._content == prevContent) {
      this._setDecorations(getHistoryViewEditor());
      this._updating = false;
    } else {
      this._update();
    }

    this.repo = context.repo.root; // Update the status bar UI.
  }

  private async _updateTitleInfo(context: HistoryViewContext): Promise<string> {
    let content = context.isStash ? stashTitleLabel : titleLabel;
    decorateWithoutWhitespace(this._titleDecorationOptions, content, 0, 0);
    if (context.isStash) {
      this._currentLine += 2;
      return content + ' \n\n';
    }

    if (context.specifiedPath) {
      content += ' of ';
      let start: number = content.length;
      content += await this._gitService.getGitRelativePath(context.specifiedPath);
      this._fileDecorationRange = new vs.Range(this._currentLine, start, this._currentLine, content.length);

      if (context.line) {
        content += ' at line ' + context.line;
      }
    }
    content += ' on ';

    this._branchDecorationRange = new vs.Range(0, content.length, 0, content.length + context.branch.length);
    this._clickableProvider.addClickable({
      range: this._branchDecorationRange,
      callback: () => vs.commands.executeCommand('githd.viewBranchHistory', context),
      getHoverMessage: () => branchHoverMessage
    });
    content += context.branch;

    content += ' by ';
    let author = context.author;
    if (!author) {
      content += 'all ';
      author = 'authors';
    }
    let start: number = content.length;
    content += author;
    let range = new vs.Range(this._currentLine, start, this._currentLine, content.length);
    this._emailDecorationOptions.push(range);
    this._clickableProvider.addClickable({
      range,
      callback: () => vs.commands.executeCommand('githd.viewAuthorHistory'),
      getHoverMessage: () => authorHoverMessage
    });

    this._currentLine += 2;
    return content + ' \n\n';
  }

  private _updateSubject(subject: string, remoteUrl: string): string {
    // PR link only works for github for now.
    if (remoteUrl.indexOf('github.com') > 0) {
      const [pr, start] = getPullRequest(subject);
      if (pr) {
        // Only work for github PR url.
        const url = remoteUrl + '/pull/' + pr.substring(1);
        this._clickableProvider.addClickable({
          range: new vs.Range(this._currentLine, start, this._currentLine, start + pr.length),
          callback: () => {
            vs.env.openExternal(vs.Uri.parse(url));
          },
          getHoverMessage: () => prHoverMessage
        });
      }
    }
    decorateWithoutWhitespace(this._subjectDecorationOptions, subject, this._currentLine, 0);
    ++this._currentLine;
    return subject + '\n';
  }

  private _updateInfo(context: HistoryViewContext, entry: GitLogEntry, isStash: boolean): string {
    let info: string = entry.hash;
    let range = new vs.Range(this._currentLine, 0, this._currentLine, info.length);
    this._hashDecorationOptions.push(range);
    this._clickableProvider.addClickable({
      range,
      callback: () => {
        this._model.filesViewContext = {
          repo: context.repo,
          isStash,
          leftRef: undefined,
          rightRef: entry.hash,
          specifiedPath: context.specifiedPath,
          focusedLineInfo: entry.lineInfo
        };
      },
      clickedDecorationType: this._selectedHashDecoration,
      getHoverMessage: async () => {
        const markdown = new vs.MarkdownString();
        const details = await this._gitService.getCommitDetails(context.repo, entry.hash, isStash);
        markdown.appendCodeblock(details, 'txt');
        return markdown;
      }
    });

    if (entry.ref) {
      let start: number = info.length;
      info += entry.ref;
      decorateWithoutWhitespace(this._refDecorationOptions, entry.ref, this._currentLine, start);
    }
    if (entry.author) {
      info += ' by ';
      let start: number = info.length;
      info += entry.author;
      decorateWithoutWhitespace(this._authorDecorationOptions, entry.author, this._currentLine, start);
    }
    if (entry.email) {
      info += ' <';
      let start: number = info.length;
      info += entry.email;
      range = new vs.Range(this._currentLine, start, this._currentLine, info.length);
      this._emailDecorationOptions.push(range);
      info += '>';
    }
    if (entry.date) {
      info += ', ';
      info += entry.date;
    }
    ++this._currentLine;
    return info + '\n';
  }

  private _updateStat(context: HistoryViewContext, entry: GitLogEntry): string {
    if (!entry.stat) {
      return '';
    }

    let stat: string = entry.stat;
    if (context.specifiedPath) {
      stat = entry.stat.replace('1 file changed, ', '');
    }
    ++this._currentLine;
    return stat + '\n';
  }

  private _createClickableForMore(): string {
    this._moreClickableRange = new vs.Range(this._currentLine, 0, this._currentLine, moreLabel.length);
    this._clickableProvider.addClickable({
      range: this._moreClickableRange,
      callback: () => {
        if (this._moreClickableRange) {
          this._clickableProvider.removeClickable(this._moreClickableRange);
          this._moreClickableRange = undefined;
        }
        this._loadMoreClicked = true;
        this._updateContent(true);
      },
      getHoverMessage: () => loadMoreHoverMessage
    });
    return moreLabel + ' '; // Add a space to avoid user clicking on it by accident.
  }

  private _moveToTop(editor?: vs.TextEditor) {
    Tracer.verbose('HistoryView: _moveToTop');
    if (editor) {
      editor.selection = new vs.Selection(0, 0, 0, 0);
      editor.revealRange(new vs.Range(0, 0, 0, 0));
    }
  }

  private _setDecorations(editor?: vs.TextEditor) {
    if (editor?.document.uri.scheme !== HistoryViewProvider.scheme) {
      Tracer.warning(`HistoryView: try to set decoration to wrong scheme: ${editor ? editor.document.uri.scheme : ''}`);
      return;
    }
    Tracer.verbose(
      `HistoryView: _setDecorations cnontent length: ${this._content.length}, _subjectDecorationOptions size: ${this._subjectDecorationOptions.length}`
    );

    if (!this._content) {
      Tracer.verbose('HistoryView: _loadingDecoration used');
      editor.setDecorations(this._loadingDecoration, [new vs.Range(0, 0, 0, 1)]);
      return;
    }

    editor.selection = new vs.Selection(0, 0, 0, 0);

    editor.setDecorations(this._loadingDecoration, []);

    editor.setDecorations(this._titleDecoration, this._titleDecorationOptions);
    editor.setDecorations(this._fileDecoration, this._fileDecorationRange ? [this._fileDecorationRange] : []);
    editor.setDecorations(this._branchDecoration, this._branchDecorationRange ? [this._branchDecorationRange] : []);

    editor.setDecorations(this._subjectDecoration, this._subjectDecorationOptions);
    editor.setDecorations(this._hashDecoration, this._hashDecorationOptions);
    editor.setDecorations(this._refDecoration, this._refDecorationOptions);
    editor.setDecorations(this._authorDecoration, this._authorDecorationOptions);
    editor.setDecorations(this._emailDecoration, this._emailDecorationOptions);

    editor.setDecorations(this._moreDecoration, this._moreClickableRange ? [this._moreClickableRange] : []);
  }

  private _clearDecorations() {
    Tracer.verbose('HistoryView: _clearDecorations');
    this._clickableProvider.clear();
    this._moreClickableRange = undefined;

    this._titleDecorationOptions = [];
    this._fileDecorationRange = undefined;
    this._branchDecorationRange = undefined;
    this._subjectDecorationOptions = [];
    this._hashDecorationOptions = [];
    this._refDecorationOptions = [];
    this._authorDecorationOptions = [];
    this._emailDecorationOptions = [];
  }

  private _reset() {
    Tracer.verbose('HistoryView: _reset');
    this._clearDecorations();
    this._content = '';
    this._logCount = 0;
    this._currentLine = 0;
  }
}
