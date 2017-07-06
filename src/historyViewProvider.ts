'use strict'

import {
    TextDocumentContentProvider, Uri, Disposable, workspace, window, commands, scm, Range, TextEditor,
    DocumentLinkProvider, TextDocument, DocumentLink, ProviderResult, languages, EventEmitter, Event
} from 'vscode';
import { Model, LogEntry } from './model';
import path = require('path');

const titleDecorationType = window.createTextEditorDecorationType({
    light: {

    },
    dark: {
        //color: 'deepskyblue'
        //color: '#DECE39'
        //color: '#569cd6'
    }
});

const subjectDecorationType = window.createTextEditorDecorationType({
    light: {

    },
    dark: {
        //color: 'deepskyblue'
        //color: '#DECE39'
        color: '#569cd6'
    }
});
const hashDecorationType = window.createTextEditorDecorationType({
    cursor: 'pointer',
    light: {

    },
    dark: {
        //color: 'orangered',
        color: '#ce9178'
        //color: '#d16969'
    }
});
const refDecorationType = window.createTextEditorDecorationType({
    light: {

    },
    dark: {
        color: '#608b4e'
    }
});
const authorDecorationType = window.createTextEditorDecorationType({
});
const emailDecorationType = window.createTextEditorDecorationType({
    light: {

    },
    dark: {
        color: '#DCDCAA'
    }
});
const moreDecorationType = window.createTextEditorDecorationType({
    cursor: 'pointer',
    light: {

    },
    dark: {
        color: '#569cd6'
    }
});
const refreshDecorationType = window.createTextEditorDecorationType({
    cursor: 'pointer',
    light: {

    },
    dark: {
        color: '#569cd6'
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

    private static _titleLabel = 'Git History on ';
    private static _moreLabel = 'more...';
    private static _refreshLabel = 'refresh';
    private static _separatorLabel = '--------------------------------------------------------------';

    private _content: string;
    private _logCount: number = 0;
    private _separatorCount: number = 0;
    private _isLoading: boolean = false;
    private _onDidChange = new EventEmitter<Uri>();
    private _disposables: Disposable[] = [];

    private _titleDecorationOptions: Range[] = [];
    private _subjectDecorationOptions: Range[] = [];
    private _hashDecorationOptions: Range[] = [];
    private _refDecorationOptions: Range[] = [];
    private _authorDecorationOptions: Range[] = [];
    private _emailDecorationOptions: Range[] = [];
    private _dateDecorationOptions: Range[] = [];

    private _links: DocumentLink[] = [];

    private _more: Clickable;
    private _refresh: Clickable;

    constructor(private _model: Model) {
        let disposable = workspace.registerTextDocumentContentProvider(HistoryViewProvider.scheme, this);
        this._disposables.push(disposable);

        disposable = languages.registerDocumentLinkProvider({ scheme: HistoryViewProvider.scheme }, this);
        this._disposables.push(disposable);

        this._disposables.push(this._onDidChange);

        window.onDidChangeActiveTextEditor(editor => {
            if (editor.document.uri.scheme === HistoryViewProvider.scheme) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);

        workspace.onDidChangeTextDocument(event => {
            let editor: TextEditor = window.activeTextEditor;
            if (editor && editor.document.uri.scheme === HistoryViewProvider.scheme &&
                event.document === editor.document) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);
    }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        if (uri.query) {
            // There is no mouse click event to listen. So it is a little hacky here.
            // A new temp file is opened with the clicking information and closed immediately
            commands.executeCommand('workbench.action.closeActiveEditor');
            let hash: string = uri.query;
            this._model.update(hash);
            scm.inputBox.value = hash;
            commands.executeCommand('workbench.view.scm');
            return "";
        }
        if (uri.fragment) {
            if (uri.fragment === HistoryViewProvider._moreLabel) {
                commands.executeCommand('workbench.action.closeActiveEditor');
                this._isLoading = true;
                this.update();
                return "";
            }
            if (uri.fragment === HistoryViewProvider._refreshLabel) {
                commands.executeCommand('workbench.action.closeActiveEditor');
                this.update();
                return "";
            }
        }

        const isLoading: boolean = this._isLoading;
        let logStart = 0;
        const logCount = 200;
        if (isLoading) {
            this._isLoading = false;
            logStart = this._logCount;
            this._content += HistoryViewProvider._separatorLabel + '\n\n';
            ++this._separatorCount;
        }
        const commitsCount: number = await this._model.getCommitsCount();
        const entries: LogEntry[] = await this._model.getLogEntries(logStart, logCount);
        if (!isLoading) {
            const branchName: string = await this._model.getCurrentBranch();
            this._reset();
            this._content = HistoryViewProvider._titleLabel;
            decorateWithoutWhitspace(this._titleDecorationOptions, this._content, 0, 0);
            this._hashDecorationOptions.push(
                new Range(0, this._content.length, 0, this._content.length + branchName.length)
            );
            this._content += branchName + '    ';
            const label: string = HistoryViewProvider._refreshLabel;
            this._refresh = new Clickable(HistoryViewProvider.defaultUri.with({ fragment: label }),
                new Range(0, this._content.length, 0, this._content.length + label.length));
            this._content += label + '\n\n';
        }
        return new Promise<string>(resolve => {
            // 2 lines for title and 2 lines for each separator
            let line = 2 + this._logCount * 3 + this._separatorCount * 2;
            const hasMore: boolean = commitsCount > logCount + this._logCount;

            entries.forEach(entry => {
                ++this._logCount;
                this._content += entry.subject + '\n';
                decorateWithoutWhitspace(this._subjectDecorationOptions, entry.subject, line++, 0);

                let info: string = entry.hash;
                let range = new Range(line, 0, line, info.length);
                this._hashDecorationOptions.push(range);
                this._links.push(new DocumentLink(range, uri.with({ path: '', query: entry.hash })));

                if (entry.ref) {
                    let start: number = info.length;
                    info += entry.ref;
                    decorateWithoutWhitspace(this._refDecorationOptions, entry.ref, line, start);
                }
                if (entry.author) {
                    info += ' by ';
                    let start: number = info.length;
                    info += entry.author;
                    decorateWithoutWhitspace(this._authorDecorationOptions, entry.author, line, start);
                }
                if (entry.email) {
                    info += ' <';
                    let start: number = info.length - 1;
                    info += entry.email;
                    this._emailDecorationOptions.push(new Range(line, start, line, info.length + 1));
                    info += '>';
                }
                if (entry.date) {
                    info += ', ';
                    let start: number = info.length;
                    info += entry.date;
                    decorateWithoutWhitspace(this._dateDecorationOptions, entry.date, line, start);
                }
                this._content += info + '\n\n';
                line += 2;
            });
            if (hasMore) {
                this._more = new Clickable(uri.with({ fragment: HistoryViewProvider._moreLabel }),
                    new Range(line, 0, line, HistoryViewProvider._moreLabel.length));
                resolve(this._content + HistoryViewProvider._moreLabel);
            } else {
                this._more = null;
                resolve(this._content);
            }
            if (!isLoading) {
                commands.executeCommand('cursorTop');
            }
        });
    }

    get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    update(uri: Uri = HistoryViewProvider.defaultUri): void {
        this._onDidChange.fire(uri);
    }

    provideDocumentLinks(): ProviderResult<DocumentLink[]> {
        if (this._more) {
            return this._links.concat(this._more.link, this._refresh.link);
        }
        return this._links.concat(this._refresh.link);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _setDecorations(editor: TextEditor): void {
        editor.setDecorations(subjectDecorationType, this._subjectDecorationOptions);
        editor.setDecorations(hashDecorationType, this._hashDecorationOptions);
        editor.setDecorations(refDecorationType, this._refDecorationOptions);
        editor.setDecorations(authorDecorationType, this._authorDecorationOptions);
        editor.setDecorations(emailDecorationType, this._emailDecorationOptions);
        editor.setDecorations(refreshDecorationType, [this._refresh.range]);
        if (this._more) {
            editor.setDecorations(moreDecorationType, [this._more.range]);
        }
    }
    private _reset(): void {
        this._content = HistoryViewProvider._titleLabel;
        this._logCount = 0;
        this._separatorCount = 0;
        this._more = null;
        this._refresh = null;
        this._links = [];
        this._subjectDecorationOptions = [];
        this._hashDecorationOptions = [];
        this._refDecorationOptions = [];
        this._authorDecorationOptions = [];
        this._emailDecorationOptions = [];
        this._dateDecorationOptions = [];
    }
}