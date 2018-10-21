'use strict'

import { TextDocumentContentProvider, Uri, Event, EventEmitter, TextEditor, Range, Disposable, window, workspace, languages, ThemeColor } from 'vscode';

import { Model } from './model';
import { GitService } from './gitService';
import { decorateWithoutWhitspace, getTextEditor } from './utils';

export class InfoViewProvider implements TextDocumentContentProvider {
    static scheme: string = 'githd-line';
    static defaultUri: Uri = Uri.parse(InfoViewProvider.scheme + '://authority/Commit Info');

    private _infoDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.infoView.content')
    });
    private _pathDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.infoView.path')
    });
    private _oldLineDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.infoView.old')
    });
    private _newLineDecoration = window.createTextEditorDecorationType({
        color: new ThemeColor('githd.infoView.new')
    });

    private _content: string;
    private _onDidChange = new EventEmitter<Uri>();
    private _disposables: Disposable[] = [];

    constructor(model: Model, gitService: GitService) {
        let disposable = workspace.registerTextDocumentContentProvider(InfoViewProvider.scheme, this);
        this._disposables.push(disposable);

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === InfoViewProvider.scheme) {
                this._decorate(editor);
            }
        }, null, this._disposables);

        workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.scheme === InfoViewProvider.scheme) {
                this._decorate(getTextEditor(e.document));
            }
        }, null, this._disposables);

        model.onDidChangeFilesViewContext(async context => {
            if (!context.leftRef) {
                // It is not a diff of two commits so there will be a commit info update
                this.update(await gitService.getCommitDetails(context.repo, context.rightRef, context.isStash));
            }
         }, null, this._disposables);

        this._disposables.push(this._onDidChange);
        this._disposables.push(this._infoDecoration, this._pathDecoration, this._oldLineDecoration, this._newLineDecoration);
    }

    get onDidChange(): Event<Uri> { return this._onDidChange.event; }
    
    provideTextDocumentContent(uri: Uri): string {
        return this._content;
    }

    update(content: string): void {
        this._content = content;
        this._onDidChange.fire(InfoViewProvider.defaultUri);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    _decorate(editor: TextEditor): void {
        if (this._content) {
            let infoRanges: Range[] = [];
            let pathRanges: Range[] = [];
            let oldLineRange: Range[] = [];
            let newLineRange: Range[] = [];

            let diffStarted = false;
            let i = 0;
            this._content.split(/\r?\n/g).forEach(line => {
                if (line.substr(0, 7) == 'diff --') {
                    diffStarted = true;
                    decorateWithoutWhitspace(pathRanges, line, i, 0);
                } else if (line.substr(0, 4) == '--- ') {
                    decorateWithoutWhitspace(pathRanges, line, i, 0);
                } else if (line.substr(0, 4) == '+++ ') {
                    decorateWithoutWhitspace(pathRanges, line, i, 0);
                } else if (line[0] == '-') {
                    decorateWithoutWhitspace(oldLineRange, line, i, 0);
                } else if (line[0] == '+') {
                    decorateWithoutWhitspace(newLineRange, line, i, 0);
                } else if (!diffStarted) {
                    decorateWithoutWhitspace(infoRanges, line, i, 0);
                }
                ++i;
            });
            editor.setDecorations(this._infoDecoration, infoRanges);
            editor.setDecorations(this._pathDecoration, pathRanges);
            editor.setDecorations(this._oldLineDecoration, oldLineRange);
            editor.setDecorations(this._newLineDecoration, newLineRange);
        }
    }
}