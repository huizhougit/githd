'use strict'

import { TextDocumentContentProvider, Uri, Event, EventEmitter, TextEditor, Range, Disposable, window, workspace, languages } from 'vscode';
import { decorateWithoutWhitspace } from './utils';

export class LineDiffViewProvider implements TextDocumentContentProvider {
    static scheme: string = 'githd-line';
    static defaultUri: Uri = Uri.parse(LineDiffViewProvider.scheme + '://authority/Line Diff');

    private _infoDecoration = window.createTextEditorDecorationType({
        // comment color
        light: { color: '#008000' },
        dark: { color: '#608b4e' }
    });
    private _pathDecoration = window.createTextEditorDecorationType({
        light: { color: '#000080' },
        dark: { color: '#569CD6' }
    });
    private _oldLineDecoration = window.createTextEditorDecorationType({
        light: { color: '#A31515' },
        dark: { color: '#CE9178' }
    });
    private _newLineDecoration = window.createTextEditorDecorationType({
        light: { color: '#09885A' },
        dark: { color: '#B5CEA8' }
    });

    private _content: string;
    private _onDidChange = new EventEmitter<Uri>();
    private _disposables: Disposable[] = [];

    constructor() {
        let disposable = workspace.registerTextDocumentContentProvider(LineDiffViewProvider.scheme, this);
        this._disposables.push(disposable);

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === LineDiffViewProvider.scheme) {
                this._decorate(editor);
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
        this._onDidChange.fire(LineDiffViewProvider.defaultUri);
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