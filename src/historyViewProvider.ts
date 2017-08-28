'use strict'

import {
    TextDocumentContentProvider, Uri, Disposable, workspace, window, commands, Range, TextEditor,
    DocumentLinkProvider, DocumentLink, ProviderResult, languages, EventEmitter, Event,
    TextEditorDecorationType, StatusBarItem, ThemeColor
} from 'vscode';
import { Model } from './model';
import { git } from './git';
import { getIconUri } from './icons'

const titleDecorationType = window.createTextEditorDecorationType({
    // class color
    light: { color: '#267f99' },
    dark: { color: '#4EC9B0' }
});

const fileDecorationType = window.createTextEditorDecorationType({
    // regexp color
    light: { color: '#811f3f' },
    dark: { color: '#d16969' }
});

const subjectDecorationType = window.createTextEditorDecorationType({
    // keyword color
    light: { color: '#0000ff' },
    dark: { color: '#569cd6' }
});
const hashDecorationType = window.createTextEditorDecorationType({
    cursor: 'pointer',
    // string color
    light: { color: '#a31515' },
    dark: { color: '#ce9178' }
});
const selectedHashDecorationType = window.createTextEditorDecorationType({
    backgroundColor: new ThemeColor('merge.currentContentBackground'),
    isWholeLine: true
});
const refDecorationType = window.createTextEditorDecorationType({
    // comment color
    light: { color: '#008000' },
    dark: { color: '#608b4e' }
});
const authorDecorationType = window.createTextEditorDecorationType({
    // variable color
    light: { color: '#001080' },
    dark: { color: '#9CDCFE' }
});
const emailDecorationType = window.createTextEditorDecorationType({
    // function color
    light: { color: '#795E26' },
    dark: { color: '#DCDCAA' }
});
const moreDecorationType = window.createTextEditorDecorationType({
    cursor: 'pointer',
    // variable color
    light: { color: '#001080' },
    dark: { color: '#9cdcfe' }
});
const refreshDecorationType = window.createTextEditorDecorationType({
    cursor: 'pointer',
    // flow control coler
    light: {
        color: '#AF00DB',
        after: {
            contentIconPath: getIconUri('refresh', 'light'),
            margin: '2px',
        }
    },
    dark: {
        color: '#C586C0',
        after: {
            contentIconPath: getIconUri('refresh', 'dark'),
            margin: '2px',
        }
    }
});

const hashSeparator: string = '|';

function decorateWithoutWhitspace(options: Range[], target: string, line: number, offset: number): void {
    let start = 0;
    let newWord = true;
    let i = 0;
    for (; i < target.length; ++i) {
        if (target[i] === ' ' || target[i] === '\t' || target[i] === '\n') {
            if (!newWord) {
                newWord = true;
                options.push(new Range(line, offset + start, line, offset + i));
            }
        } else {
            if (newWord) {
                newWord = false;
                start = i;
            }
        }
    }
    if (!newWord) {
        options.push(new Range(line, offset + start, line, offset + i));
    }
}

class Clickable {
    private _link: DocumentLink;

    constructor(uri: Uri, private _range) {
        this._link = new DocumentLink(this._range, uri);
    }
    get link(): DocumentLink { return this._link; }
    get range(): Range { return this._range; }
}

export class HistoryViewProvider implements TextDocumentContentProvider, DocumentLinkProvider {
    static scheme: string = 'githd-logs';
    static defaultUri: Uri = Uri.parse(HistoryViewProvider.scheme + '://authority/Git History');

    private static _titleLabel = 'Git History';
    private static _moreLabel = '...';
    private static _refreshLabel = 'refresh';
    private static _separatorLabel = '--------------------------------------------------------------';

    private _commitsCount: number = 200;
    private _content: string;
    private _logCount: number = 0;
    private _currentLine: number = 0;
    private _loadingMore: boolean = false;
    private _loadAll: boolean = false;
    private _onDidChange = new EventEmitter<Uri>();
    private _disposables: Disposable[] = [];

    private _titleDecorationOptions: Range[] = [];
    private _fileDecorationOptions: Range[] = [];
    private _subjectDecorationOptions: Range[] = [];
    private _hashDecorationOptions: Range[] = [];
    private _refDecorationOptions: Range[] = [];
    private _authorDecorationOptions: Range[] = [];
    private _emailDecorationOptions: Range[] = [];
    private _dateDecorationOptions: Range[] = [];
    private _selectedHashDecoration: Range;
    
    private _links: DocumentLink[] = [];
    private _more: Clickable;
    private _refresh: Clickable;

    private _branchStatusBar: StatusBarItem = window.createStatusBarItem(undefined, 2);
    private _expressStatusBar: StatusBarItem = window.createStatusBarItem(undefined, 1);
    private _express: boolean;

    constructor(private _model: Model) {
        let disposable = workspace.registerTextDocumentContentProvider(HistoryViewProvider.scheme, this);
        this._disposables.push(disposable);

        disposable = languages.registerDocumentLinkProvider({ scheme: HistoryViewProvider.scheme }, this);
        this._disposables.push(disposable);

        this._branchStatusBar.command = 'githd.viewBranchHistory';
        this._branchStatusBar.tooltip = 'Select a branch to see its history';
        this._disposables.push(this._branchStatusBar);

        this._expressStatusBar.command = 'githd.setExpressMode';
        this._expressStatusBar.tooltip = 'Turn on or off of the history vew Express mode';
        this.express = this._model.configuration.expressMode;
        this._disposables.push(this._expressStatusBar);

        this._disposables.push(this._onDidChange);

        this.commitsCount = this._model.configuration.commitsCount;
        this._model.onDidChangeConfiguration(config => this.commitsCount = config.commitsCount, null, this._disposables);
        this._model.onDidChangeHistoryViewContext(context => {
            this.branch = context.branch;
            this.update();
            workspace.openTextDocument(HistoryViewProvider.defaultUri)
                .then(doc => {
                    window.showTextDocument(doc, { preview: false });
                    if (!this._loadingMore) {
                        commands.executeCommand('cursorTop');
                    }
                });
        });

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
                this._branchStatusBar.show();
            } else {
                this._branchStatusBar.hide();
            }
        }, null, this._disposables);

        window.onDidChangeTextEditorSelection(event => {
            let editor = event.textEditor;
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);

        (async () => {
            if (await git.isGitRepo()) {
                this._expressStatusBar.show();
            }
        })();
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
    private set branch(value: string) {
        this._branchStatusBar.text = 'githd: ' + value;
    }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        // There is no mouse click event to listen. So it is a little hacky here.
        // A new temp file is opened with the clicking information and closed immediately

        if (uri.query) { // ref link clicked
            commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
                const hash: string = uri.query.split(hashSeparator)[0];
                const line: number = parseInt(uri.query.split(hashSeparator)[1]);
                this._model.filesViewContext = {
                    leftRef: null,
                    rightRef: hash
                };
                if (this._model.configuration.useExplorer) {
                    commands.executeCommand('workbench.view.explorer');
                    // vscode bug could make the active doc change to another one
                    workspace.openTextDocument(HistoryViewProvider.defaultUri).then(doc => window.showTextDocument(doc));
                }
                this._selectedHashDecoration = new Range(line, 0, line, hash.length);
                let editor: TextEditor = window.activeTextEditor;
                if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                    editor.setDecorations(selectedHashDecorationType, [this._selectedHashDecoration]);
                }
            });
            return "";
        }
        if (uri.fragment) {
            if (uri.fragment === HistoryViewProvider._moreLabel) {
                commands.executeCommand('workbench.action.closeActiveEditor');
                this._loadingMore = true;
                this.update();
                return "";
            }
            if (uri.fragment === HistoryViewProvider._refreshLabel) {
                commands.executeCommand('workbench.action.closeActiveEditor');
                this.update();
                return "";
            }
        }

        return new Promise<string>(async (resolve) => {
            const context = this._model.historyViewContext;
            const loadingMore: boolean = this._loadingMore;
            let logStart = 0;
            if (loadingMore) {
                this._loadingMore = false;
                logStart = this._logCount;
                this._content += HistoryViewProvider._separatorLabel + '\n\n';
                this._currentLine += 2;
            }
            const commitsCount: number = await git.getCommitsCount(context.specifiedPath);
            let slowLoading = false;
            if (this._loadAll && ((!this._express && commitsCount > 1000) || (this._express && commitsCount > 10000))) {
                slowLoading = true;
                window.showInformationMessage(`There are ${commitsCount} commits and it will take a while to load all.`);
            }
            const logCount = this._loadAll ? Number.MAX_SAFE_INTEGER : this._commitsCount;
            const entries: git.LogEntry[] = await git.getLogEntries(this._express, logStart, logCount, context.branch, context.specifiedPath);
            if (entries.length === 0) {
                this._reset();
                resolve('No History');
                return;
            }

            if (!loadingMore) {
                this._reset();
                this._content = HistoryViewProvider._titleLabel;
                decorateWithoutWhitspace(this._titleDecorationOptions, this._content, 0, 0);

                if (context.specifiedPath) {
                    this._content += ' of ';
                    let start: number = this._content.length;
                    this._content += await git.getGitRelativePath(context.specifiedPath);
                    this._fileDecorationOptions.push(new Range(this._currentLine, start, this._currentLine, this._content.length));
                }
                this._content += ' on ';

                this._refresh = new Clickable(
                    HistoryViewProvider.defaultUri.with({ path: null, fragment: HistoryViewProvider._refreshLabel }),
                    new Range(0, this._content.length, 0, this._content.length + context.branch.length)
                );
                this._content += context.branch;
                this._content += '\n\n';
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
                this._links.push(new DocumentLink(range, uri.with({ path: null, query: entry.hash + hashSeparator + range.start.line })));

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
                    let start: number = info.length - 1;
                    info += entry.email;
                    this._emailDecorationOptions.push(new Range(this._currentLine, start, this._currentLine, info.length + 1));
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
                this._more = new Clickable(uri.with({ path: null, fragment: HistoryViewProvider._moreLabel }),
                    new Range(this._currentLine, 0, this._currentLine, HistoryViewProvider._moreLabel.length));
                resolve(this._content + HistoryViewProvider._moreLabel);
            } else {
                this._more = null;
                resolve(this._content);
                if (slowLoading) {
                    window.showInformationMessage(`All ${commitsCount} commits are loaded.`);
                }
            }
            this._branchStatusBar.show();
        });
    }

    update(uri: Uri = HistoryViewProvider.defaultUri): void {
        this._onDidChange.fire(uri);
    }

    provideDocumentLinks(): ProviderResult<DocumentLink[]> {
        if (this._more) {
            return this._links.concat(this._refresh.link, this._more.link);
        }
        return this._links.concat(this._refresh.link);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _setDecorations(editor: TextEditor): void {
        editor.setDecorations(titleDecorationType, this._titleDecorationOptions);
        editor.setDecorations(fileDecorationType, this._fileDecorationOptions);
        
        this._decorate(editor, subjectDecorationType, this._subjectDecorationOptions);
        this._decorate(editor, hashDecorationType, this._hashDecorationOptions);
        this._decorate(editor, refDecorationType, this._refDecorationOptions);
        this._decorate(editor, authorDecorationType, this._authorDecorationOptions);
        this._decorate(editor, emailDecorationType, this._emailDecorationOptions);

        if (this._selectedHashDecoration) {
            editor.setDecorations(selectedHashDecorationType, [this._selectedHashDecoration]);
        }
        if (this._refresh) {
            editor.setDecorations(refreshDecorationType, [{ range: this._refresh.range, hoverMessage: 'Refresh the history' }]);
        }
        if (this._more) {
            editor.setDecorations(moreDecorationType, [this._more.range]);
        }
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
        this._content = '';
        this._logCount = 0;
        this._currentLine = 0;
        this._more = null;
        this._refresh = null;
        this._links = [];

        this._titleDecorationOptions = [];
        this._fileDecorationOptions = [];
        this._subjectDecorationOptions = [];
        this._hashDecorationOptions = [];
        this._refDecorationOptions = [];
        this._authorDecorationOptions = [];
        this._emailDecorationOptions = [];
        this._dateDecorationOptions = [];
        this._selectedHashDecoration = null;
    }
}