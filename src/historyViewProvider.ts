'use strict'

import {
    TextDocumentContentProvider, Uri, Disposable, workspace, window, commands, Range, TextEditor,
    languages, EventEmitter, Event, StatusBarItem, ThemeColor, OverviewRulerLane
} from 'vscode';
import { Model } from './model';
import { GitService, GitLogEntry } from './gitService';
import { getIconUri } from './icons';
import { ClickableProvider } from './clickable';
import { decorateWithoutWhitspace } from './utils';
import { Tracer } from './tracer';

export class HistoryViewProvider implements TextDocumentContentProvider {
    static scheme: string = 'githd-logs';
    static defaultUri: Uri = Uri.parse(HistoryViewProvider.scheme + '://authority/Git History');

    private static _stashTitleLabel = 'Git Stashes';
    private static _titleLabel = 'Git History';
    private static _moreLabel = '\u00b7\u00b7\u00b7';
    private static _separatorLabel = '--------------------------------------------------------------';

    private _clickableProvider = new ClickableProvider(HistoryViewProvider.scheme);
    private _commitsCount: number = 200;
    private _content: string;
    private _logCount: number = 0;
    private _currentLine: number = 0;
    private _loadingMore: boolean = false;
    private _loadAll: boolean = false;
    private _onDidChange = new EventEmitter<Uri>();
    private _disposables: Disposable[] = [];

    private _titleDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.title')
    });
    private _branchDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.branch')
    });
    private _fileDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.filePath')
    });
    private _subjectDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.subject')
    });
    private _hashDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.hash')
    });
    private _selectedHashDecoration = window.createTextEditorDecorationType({
        backgroundColor: new ThemeColor('merge.currentContentBackground'),
        isWholeLine: true,
        overviewRulerColor: 'darkgreen',
        overviewRulerLane: OverviewRulerLane.Full
    });
    private _refDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.ref')
    });
    private _authorDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.author')
    });
    private _emailDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.email')
    });
    private _moreDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.historyView.more')
    });
    private _loadingDecoration = window.createTextEditorDecorationType({
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

    private _titleDecorationOptions: Range[] = [];
    private _fileDecorationRange: Range;
    private _branchDecorationRange: Range;
    private _subjectDecorationOptions: Range[] = [];
    private _hashDecorationOptions: Range[] = [];
    private _refDecorationOptions: Range[] = [];
    private _authorDecorationOptions: Range[] = [];
    private _emailDecorationOptions: Range[] = [];
    private _dateDecorationOptions: Range[] = [];
    private _moreClickableRange: Range;

    private _repoStatusBar: StatusBarItem = window.createStatusBarItem(undefined, 1);
    private _expressStatusBar: StatusBarItem = window.createStatusBarItem(undefined, 2);
    private _express: boolean;

    constructor(private _model: Model, private _gitService: GitService) {
        Tracer.info('Creating history view');
        let disposable = workspace.registerTextDocumentContentProvider(HistoryViewProvider.scheme, this);
        this._disposables.push(disposable);

        this._expressStatusBar.command = 'githd.setExpressMode';
        this._expressStatusBar.tooltip = 'Turn on or off of the history vew Express mode';
        this.express = this._model.configuration.expressMode;
        this._disposables.push(this._expressStatusBar);

        this._disposables.push(this._repoStatusBar);
        this._disposables.push(this._onDidChange);
        this._disposables.push(this._clickableProvider);

        this.commitsCount = this._model.configuration.commitsCount;
        this._model.onDidChangeConfiguration(config => {
            this.commitsCount = config.commitsCount;
            this._updateExpressStatusBar();
        }, null, this._disposables);
        this._model.onDidChangeHistoryViewContext(context => {
            this._reset();
            this._update();
            workspace.openTextDocument(HistoryViewProvider.defaultUri)
                .then(doc => window.showTextDocument(doc, { preview: false, preserveFocus: true })
                    .then(() => commands.executeCommand('cursorTop')));
        });

        this._gitService.onDidChangeGitRepositories(repos => {
            this._updateExpressStatusBar();
        });

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
                this.repo = this._model.historyViewContext.repo.root;
            } else {
                this.repo = null;
            }
        }, null, this._disposables);

        workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(window.activeTextEditor);
            }
        }, null, this._disposables);

        this._updateExpressStatusBar();

        this._disposables.push(
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
            this._loadingDecoration,
        );
        Tracer.info('History view created');
    }

    get onDidChange(): Event<Uri> { return this._onDidChange.event; }

    set loadAll(value: boolean) { this._loadAll = value; }
    get express(): boolean { return this._express; }
    set express(value: boolean) {
        this._express = value;
        this._expressStatusBar.text = 'githd: Express ' + (value ? 'On' : 'Off');
    }

    private set commitsCount(count: number) {
        if ([100, 200, 300, 400, 500, 1000].findIndex(a => { return a === count; }) >= 0) {
            this._commitsCount = count;
        }
    }

    private set repo(repo: string) {
        if (repo) {
            this._repoStatusBar.text = 'githd: Repository ' + repo;
            this._repoStatusBar.show();
        } else {
            this._repoStatusBar.hide();
        }
    }

    provideTextDocumentContent(uri: Uri): string {
        if (this._content) {
            return this._content;
        }
        this._updateContent();
        return ' ';
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _updateExpressStatusBar(): void {
        if (this._model.configuration.displayExpress && this._gitService.getGitRepos().length > 0) {
            this._expressStatusBar.show();
        } else {
            this._expressStatusBar.hide();
        }
    }

    private _update(): void {
        this._onDidChange.fire(HistoryViewProvider.defaultUri);
    }

    private async _updateContent(): Promise<void> {
        const context = this._model.historyViewContext;
        const loadingMore: boolean = this._loadingMore;
        const isStash = context.isStash;
        if (context.specifiedPath && context.line) {
            this._loadAll = true;
        }

        Tracer.info(`Update history view content. ${JSON.stringify(context)}`);

        let logStart = 0;
        if (loadingMore) {
            this._loadingMore = false;
            logStart = this._logCount;
            this._content = this._content.substr(0, this._content.length - HistoryViewProvider._moreLabel.length - 1);
            this._content += HistoryViewProvider._separatorLabel + '\n\n';
            this._currentLine += 2;
        }
        const commitsCount: number = await this._gitService.getCommitsCount(context.repo, context.specifiedPath, context.author);
        let slowLoading = false;
        let express = this._express;
        if (this._loadAll && !express && commitsCount > 1000) {
            window.showInformationMessage(`Too many commits to be loaded and express mode is enabled.`);
            express = true;
        }
        if (this._loadAll && commitsCount > 30000) {
            slowLoading = true;
            window.showInformationMessage(`There are ${commitsCount} commits and it will take a while to load all.`);
        }
        const logCount = this._loadAll ? Number.MAX_SAFE_INTEGER : this._commitsCount;
        const entries: GitLogEntry[] = await this._gitService.getLogEntries(context.repo, express, logStart, logCount, context.branch,
            context.isStash, context.specifiedPath, context.line, context.author);
        if (entries.length === 0) {
            this._reset();
            this._content = isStash ? 'No Stash' : 'No History';
            this._update();
            return;
        }

        if (!loadingMore) {
            this._reset();
            this._content = isStash ? HistoryViewProvider._stashTitleLabel : HistoryViewProvider._titleLabel;
            decorateWithoutWhitspace(this._titleDecorationOptions, this._content, 0, 0);

            if (!isStash) { // TODO: need to refine
                if (context.specifiedPath) {
                    this._content += ' of ';
                    let start: number = this._content.length;
                    this._content += await this._gitService.getGitRelativePath(context.specifiedPath);
                    this._fileDecorationRange = new Range(this._currentLine, start, this._currentLine, this._content.length);

                    if (context.line) {
                        this._content += ' at line ' + context.line;
                    }
                }
                this._content += ' on ';

                this._branchDecorationRange = new Range(0, this._content.length, 0, this._content.length + context.branch.length);
                this._clickableProvider.addClickable({
                    range: this._branchDecorationRange,
                    callback: () => commands.executeCommand('githd.viewBranchHistory', context),
                    getHoverMessage: (): string => { return 'Select a branch to see its history' }
                })
                this._content += context.branch;

                this._content += ' by ';
                let author: string = context.author;
                if (!author) {
                    this._content += 'all ';
                    author = 'authors';
                }
                let start: number = this._content.length;
                this._content += author;
                let range = new Range(this._currentLine, start, this._currentLine, this._content.length);
                this._emailDecorationOptions.push(range);
                this._clickableProvider.addClickable({
                    range,
                    callback: () => commands.executeCommand('githd.viewAuthorHistory'),
                    getHoverMessage: (): string => { return 'Select an author to see the commits' }
                });
            }

            this._content += ` \n\n`;
            this._currentLine += 2;
        }

        const hasMore: boolean = !isStash && commitsCount > logCount + this._logCount;
        entries.forEach(entry => {
            ++this._logCount;
            decorateWithoutWhitspace(this._subjectDecorationOptions, entry.subject, this._currentLine, 0);
            this._content += entry.subject + '\n';
            ++this._currentLine;

            let info: string = entry.hash;
            let range = new Range(this._currentLine, 0, this._currentLine, info.length);
            this._hashDecorationOptions.push(range);
            this._clickableProvider.addClickable({
                range,
                callback: (): void => {
                    this._model.filesViewContext = {
                        repo: context.repo,
                        isStash,
                        leftRef: null,
                        rightRef: entry.hash,
                        specifiedPath: context.specifiedPath,
                        focusedLineInfo: entry.lineInfo
                    };
                },
                clickedDecorationType: this._selectedHashDecoration,
                getHoverMessage: async (): Promise<string> => { return await this._gitService.getCommitDetails(context.repo, entry.hash, isStash) }
            });

            if (entry.ref) {
                let start: number = info.length;
                info += entry.ref;
                decorateWithoutWhitspace(this._refDecorationOptions, entry.ref, this._currentLine, start);
            }
            if (entry.author) {
                info += ' by ';
                let start: number = info.length;
                info += entry.author;
                decorateWithoutWhitspace(this._authorDecorationOptions, entry.author, this._currentLine, start);
            }
            if (entry.email) {
                info += ' <';
                let start: number = info.length;
                info += entry.email;
                range = new Range(this._currentLine, start, this._currentLine, info.length);
                this._emailDecorationOptions.push(range);
                info += '>';
            }
            if (entry.date) {
                info += ', ';
                let start: number = info.length;
                info += entry.date;
                decorateWithoutWhitspace(this._dateDecorationOptions, entry.date, this._currentLine, start);
            }
            this._content += info + '\n';
            ++this._currentLine;

            if (entry.stat) {
                let stat: string = entry.stat;
                if (context.specifiedPath) {
                    stat = entry.stat.replace('1 file changed, ', '');
                }
                this._content += stat + '\n';
                ++this._currentLine;
            }

            this._content += '\n';
            ++this._currentLine;
        });
        if (hasMore) {
            this._moreClickableRange = new Range(this._currentLine, 0, this._currentLine, HistoryViewProvider._moreLabel.length);
            this._clickableProvider.addClickable({
                range: this._moreClickableRange,
                callback: () => {
                    this._clickableProvider.removeClickable(this._moreClickableRange);
                    this._moreClickableRange = null;
                    this._loadingMore = true;
                    this._updateContent();
                },
                getHoverMessage: (): string => { return 'Load more commits' }
            });
            this._content += HistoryViewProvider._moreLabel + ' ';
        } else {
            this._moreClickableRange = null;
            if (slowLoading) {
                window.showInformationMessage(`All ${commitsCount} commits are loaded.`);
            }
        }
        this._update();
        this.repo = context.repo.root;
    }

    private _setDecorations(editor: TextEditor): void {
        if (!editor) {
            return;
        }
        if (!this._content) {
            editor.setDecorations(this._loadingDecoration, [new Range(0, 0, 0, 1)]);
            return;
        }
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

    private _reset(): void {
        this._clickableProvider.clear();
        this._content = '';
        this._logCount = 0;
        this._currentLine = 0;
        this._moreClickableRange = null;

        this._titleDecorationOptions = [];
        this._fileDecorationRange = null;
        this._branchDecorationRange = null;
        this._subjectDecorationOptions = [];
        this._hashDecorationOptions = [];
        this._refDecorationOptions = [];
        this._authorDecorationOptions = [];
        this._emailDecorationOptions = [];
        this._dateDecorationOptions = [];
        let editor: TextEditor = window.activeTextEditor;
        if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
            editor.setDecorations(this._selectedHashDecoration, []);
        }
    }
}