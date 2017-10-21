'use strict'

import {
    TextDocumentContentProvider, Uri, Disposable, workspace, window, commands, Range, TextEditor,
    languages, EventEmitter, Event, TextEditorDecorationType, StatusBarItem, ThemeColor
} from 'vscode';
import { Model } from './model';
import { GitService, GitLogEntry } from './gitService';
import { getIconUri } from './icons';
import { Clickable, ClickableProvider } from './clickable';
import { decorateWithoutWhitspace } from './utils';

export class HistoryViewProvider implements TextDocumentContentProvider {
    static scheme: string = 'githd-logs';
    static defaultUri: Uri = Uri.parse(HistoryViewProvider.scheme + '://authority/Git History');

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

    private _titleDecorationType = window.createTextEditorDecorationType({
        // class color
        light: { color: '#267f99' },
        dark: { color: '#4EC9B0' }
    });
    private _fileDecorationType = window.createTextEditorDecorationType({
        // regexp color
        light: { color: '#811f3f' },
        dark: { color: '#d16969' }
    });
    private _subjectDecorationType = window.createTextEditorDecorationType({
        // keyword color
        light: { color: '#0000ff' },
        dark: { color: '#569cd6' }
    });
    private _hashDecorationType = window.createTextEditorDecorationType({
        // string color
        light: { color: '#a31515' },
        dark: { color: '#ce9178' }
    });
    private _selectedHashDecorationType = window.createTextEditorDecorationType({
        backgroundColor: new ThemeColor('merge.currentContentBackground'),
        isWholeLine: true
    });
    private _refDecorationType = window.createTextEditorDecorationType({
        // comment color
        light: { color: '#008000' },
        dark: { color: '#608b4e' }
    });
    private _authorDecorationType = window.createTextEditorDecorationType({
        // variable color
        light: { color: '#001080' },
        dark: { color: '#9CDCFE' }
    });
    private _emailDecorationType = window.createTextEditorDecorationType({
        // function color
        light: { color: '#795E26' },
        dark: { color: '#DCDCAA' }
    });
    private _moreDecorationType = window.createTextEditorDecorationType({
        // variable color
        light: { color: '#001080' },
        dark: { color: '#9cdcfe' }
    });
    private _branchDecorationType = window.createTextEditorDecorationType({
        // flow control coler
        light: { color: '#AF00DB' },
        dark: { color: '#C586C0' }
    });
    private _loadingDecorationType = window.createTextEditorDecorationType({
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
    private _selectedHashDecoration: Range;
    private _moreClickableRange: Range;

    private _expressStatusBar: StatusBarItem = window.createStatusBarItem(undefined, 1);
    private _express: boolean;

    constructor(private _model: Model, private _gitService: GitService) {
        let disposable = workspace.registerTextDocumentContentProvider(HistoryViewProvider.scheme, this);
        this._disposables.push(disposable);

        this._expressStatusBar.command = 'githd.setExpressMode';
        this._expressStatusBar.tooltip = 'Turn on or off of the history vew Express mode';
        this.express = this._model.configuration.expressMode;
        this._disposables.push(this._expressStatusBar);

        this._disposables.push(this._onDidChange);
        this._disposables.push(this._clickableProvider);

        this.commitsCount = this._model.configuration.commitsCount;
        this._model.onDidChangeConfiguration(config => this.commitsCount = config.commitsCount, null, this._disposables);
        this._model.onDidChangeHistoryViewContext(context => {
            this._reset();
            this._update();
            workspace.openTextDocument(HistoryViewProvider.defaultUri)
                .then(doc => window.showTextDocument(doc, { preview: false, preserveFocus: true })
                    .then(() => commands.executeCommand('cursorTop')));
        });

        this._gitService.onDidChangeGitRepositories(repos => {
            if (repos.length > 0) {
                this._expressStatusBar.show();
            } else {
                this._expressStatusBar.hide();
            }
        });

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);

        window.onDidChangeTextEditorSelection(event => {
            let editor = event.textEditor;
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);

        if (this._gitService.getGitRepos().length > 0) {
            this._expressStatusBar.show();
        } else {
            this._expressStatusBar.hide();
        }

        this._disposables.push(
            this._titleDecorationType,
            this._fileDecorationType,
            this._subjectDecorationType,
            this._hashDecorationType,
            this._selectedHashDecorationType,
            this._refDecorationType,
            this._authorDecorationType,
            this._emailDecorationType,
            this._moreDecorationType,
            this._branchDecorationType,
            this._loadingDecorationType,
        );
    }

    get onDidChange(): Event<Uri> { return this._onDidChange.event; }

    set loadAll(value: boolean) { this._loadAll = value; }
    get express(): boolean { return this._express; }
    set express(value: boolean) {
        this._express = value;
        this._expressStatusBar.text = 'githd: Express ' + (value ? 'On' : 'Off');
    }

    private set commitsCount(count: number) {
        if ([50, 100, 200, 300, 400, 500, 1000].findIndex(a => { return a === count; }) >= 0) {
            this._commitsCount = count;
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

    private _update(): void {
        this._onDidChange.fire(HistoryViewProvider.defaultUri);
    }

    private async _updateContent(): Promise<void> {
        const context = this._model.historyViewContext;
        const loadingMore: boolean = this._loadingMore;
        if (context.specifiedPath && context.line) {
            this._loadAll = true;
        }

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
        if (this._loadAll && ((!this._express && commitsCount > 1000) || (this._express && commitsCount > 10000))) {
            slowLoading = true;
            window.showInformationMessage(`There are ${commitsCount} commits and it will take a while to load all.`);
        }
        const logCount = this._loadAll ? Number.MAX_SAFE_INTEGER : this._commitsCount;
        const entries: GitLogEntry[] = await this._gitService.getLogEntries(context.repo, this._express, logStart, logCount, context.branch,
            context.specifiedPath, context.line, context.author);
        if (entries.length === 0) {
            this._reset();
            this._content = 'No History';
            this._update();
            return;
        }

        if (!loadingMore) {
            this._reset();
            this._content = HistoryViewProvider._titleLabel;
            decorateWithoutWhitspace(this._titleDecorationOptions, this._content, 0, 0);

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

            this._content += ` (${context.repo.root})\n\n`;
            this._currentLine += 2;
        }

        const hasMore: boolean = commitsCount > logCount + this._logCount;
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
                        leftRef: null,
                        rightRef: entry.hash,
                        specifiedPath: context.specifiedPath,
                        focusedLineInfo: entry.lineInfo
                    };
                },
                clickedDecorationType: this._selectedHashDecorationType,
                getHoverMessage: async (): Promise<string> => { return await this._gitService.getCommitDetails(context.repo, entry.hash) }
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
        return;
    }

    private _setDecorations(editor: TextEditor): void {
        if (!this._content) {
            editor.setDecorations(this._loadingDecorationType, [new Range(0, 0, 0, 1)]);
            return;
        }
        editor.setDecorations(this._loadingDecorationType, []);

        editor.setDecorations(this._titleDecorationType, this._titleDecorationOptions);
        editor.setDecorations(this._fileDecorationType, this._fileDecorationRange ? [this._fileDecorationRange] : []);
        editor.setDecorations(this._branchDecorationType, this._branchDecorationRange ? [this._branchDecorationRange] : []);
        
        this._decorate(editor, this._subjectDecorationType, this._subjectDecorationOptions);
        this._decorate(editor, this._hashDecorationType, this._hashDecorationOptions);
        this._decorate(editor, this._refDecorationType, this._refDecorationOptions);
        this._decorate(editor, this._authorDecorationType, this._authorDecorationOptions);
        this._decorate(editor, this._emailDecorationType, this._emailDecorationOptions);

        editor.setDecorations(this._moreDecorationType, this._moreClickableRange ? [this._moreClickableRange] : []);
    }
    private _decorate(editor: TextEditor, type: TextEditorDecorationType, ranges: Range[]): void {
        if (this._logCount < 1000) {
            editor.setDecorations(type, ranges);
            return;
        }
        const displayCount = 300;
        let currentLine = editor.selection.active.line;
        let start: number = ranges.findIndex(range => {
            return range.start.line > currentLine - displayCount;
        });
        let end: number = ranges.findIndex(range => {
            return range.start.line > currentLine + displayCount;
        });
        if (end === -1) {
            end = ranges.length;
        }
        editor.setDecorations(type, ranges.slice(start, end));
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
        this._selectedHashDecoration = null;
        let editor: TextEditor = window.activeTextEditor;
        if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
            editor.setDecorations(this._selectedHashDecorationType, []);
        }
    }
}