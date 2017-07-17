'use strict'

import {
    TextDocumentContentProvider, Uri, Disposable, workspace, window, commands, scm, Range, TextEditor,
    DocumentLinkProvider, DocumentLink, ProviderResult, languages, EventEmitter, Event,
    TextEditorDecorationType, StatusBarItem, StatusBarAlignment
} from 'vscode';
import { FileProvider } from './model';
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

    private _branch: string;
    private _specifiedFile: string;
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

    private _links: DocumentLink[] = [];
    private _more: Clickable;
    private _refresh: Clickable;

    private _statusBarItem: StatusBarItem = window.createStatusBarItem(undefined, 2);

    constructor(private _fileProvider: FileProvider, private _commitsCount: number = 200) {
        let disposable = workspace.registerTextDocumentContentProvider(HistoryViewProvider.scheme, this);
        this._disposables.push(disposable);

        disposable = languages.registerDocumentLinkProvider({ scheme: HistoryViewProvider.scheme }, this);
        this._disposables.push(disposable);

        this._statusBarItem.command = 'githd.selectBranch';
        this._statusBarItem.tooltip = 'Select the branch to see its history';
        this._disposables.push(this._statusBarItem);
        this._disposables.push(this._onDidChange);

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }
        }, null, this._disposables);

        window.onDidChangeTextEditorSelection(event => {
            let editor = event.textEditor;
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);
    }

    get loadingMore(): boolean { return this._loadingMore; }
    get onDidChange(): Event<Uri> { return this._onDidChange.event; }

    set fileProvider(provider: FileProvider) { this._fileProvider = provider; }
    set commitsCount(count: number) {
        if ([50, 100, 200, 300, 400, 500].findIndex(a => { return a === count; }) >= 0) {
            this._commitsCount = count;
        }
    }
    set branch(value: string) {
        if (value !== this._branch) {
            this._branch = value;
            this._statusBarItem.text = 'githd: ' + value;
        }
    }
    set specifiedFile(value: string) { this._specifiedFile = value; }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        // There is no mouse click event to listen. So it is a little hacky here.
        // A new temp file is opened with the clicking information and closed immediately

        if (uri.query) { // ref link clicked
            commands.executeCommand('workbench.action.closeActiveEditor');
            let hash: string = uri.query;
            this._fileProvider.update(hash);
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
                this._branch = undefined;
                this.update();
                return "";
            }
        }

        if (!this._branch) {
            this.branch = await git.getCurrentBranch();
        }

        const loadingMore: boolean = this._loadingMore;
        const loadAll: boolean = this._loadAll;
        let logStart = 0;
        if (loadingMore) {
            this._loadingMore = false;
            logStart = this._logCount;
            this._content += HistoryViewProvider._separatorLabel + '\n\n';
            this._currentLine += 2;
        }
        const commitsCount: number = await git.getCommitsCount(this._specifiedFile);
        if (this._loadAll && commitsCount > 1000) {
            window.showInformationMessage(`There are ${commitsCount} commits and it will take a while to load all.`);
        }
        const logCount = this._loadAll ? commitsCount : this._commitsCount;
        const entries: git.LogEntry[] = await git.getLogEntries(logStart, logCount, this._branch, this._specifiedFile);
        if (entries.length === 0) {
            this._reset();
            return 'No History';
        }

        if (!loadingMore) {
            this._reset();
            this._content = HistoryViewProvider._titleLabel;
            decorateWithoutWhitspace(this._titleDecorationOptions, this._content, 0, 0);

            if (this._specifiedFile) {
                this._content += ' of ';
                let start: number = this._content.length;
                this._content += this._specifiedFile;
                this._fileDecorationOptions.push(new Range(this._currentLine, start, this._currentLine, this._content.length));
            }
            this._content += ' on ';

            this._refresh = new Clickable(
                HistoryViewProvider.defaultUri.with({ path: null, fragment: HistoryViewProvider._refreshLabel }),
                new Range(0, this._content.length, 0, this._content.length + this._branch.length)
            );
            this._content += this._branch;
            this._content += '\n\n';
            this._currentLine += 2;
        }

        return new Promise<string>(resolve => {
            const hasMore: boolean = commitsCount > logCount + this._logCount;

            entries.forEach(entry => {
                ++this._logCount;
                decorateWithoutWhitspace(this._subjectDecorationOptions, entry.subject, this._currentLine, 0);
                this._content += entry.subject + '\n';
                ++this._currentLine;

                let info: string = entry.hash;
                let range = new Range(this._currentLine, 0, this._currentLine, info.length);
                this._hashDecorationOptions.push(range);
                this._links.push(new DocumentLink(range, uri.with({ path: null, query: entry.hash })));

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
                    if (this._specifiedFile) {
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
                if (loadAll) {
                    window.showInformationMessage(`All ${commitsCount} commits are loaded.`);
                }
            }
            this._statusBarItem.show();
        });
    }

    update(loadAll: boolean = false, uri: Uri = HistoryViewProvider.defaultUri): void {
        this._loadAll = loadAll;
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

        editor.setDecorations(refreshDecorationType, [{ range: this._refresh.range, hoverMessage: 'Refresh the history' }]);
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
    }
}