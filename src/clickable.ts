'use strict'

import {
    Range, languages, HoverProvider, Hover, TextDocument, Position, window, Disposable,
    TextEditorDecorationType, TextEditor, TextEditorSelectionChangeKind, workspace
} from 'vscode';

import { Tracer } from './tracer';

export interface Clickable {
    readonly range: Range;
    readonly callback: () => any;
    readonly clickedDecorationType?: TextEditorDecorationType;
    getHoverMessage?: () => string | Promise<string>;
}

export class ClickableProvider implements HoverProvider {
    private _clickables: Clickable[] = [];
    private _disposables: Disposable[] = [];
    private _lastClickedItems: Clickable[] = [];

    private _decoration = window.createTextEditorDecorationType({
        cursor: 'pointer',
        textDecoration: 'underline'
    });

    constructor(private _scheme: string) {
        this._disposables.push(languages.registerHoverProvider({ scheme: _scheme }, this));
        this._disposables.push(this._decoration);

        window.onDidChangeTextEditorSelection(event => {
            let editor = event.textEditor;
            if (editor && editor.document.uri.scheme === _scheme) {
                if (event.kind === TextEditorSelectionChangeKind.Mouse) {
                    const pos: Position = event.selections[0].anchor;
                    const clickable: Clickable = this._clickables.find(e => { return e.range.contains(pos) });
                    if (clickable) {
                        this._onClicked(clickable, editor);
                    }
                }
            }
        }, null, this._disposables);

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === _scheme) {
                this._setDecorations(editor);
            }
        }, null, this._disposables);

        workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.scheme === _scheme) {
                this._setDecorations(window.visibleTextEditors.find(editor => editor.document === e.document));
            }
        }, null, this._disposables);
    }

    async provideHover(document: TextDocument, position: Position): Promise<Hover> {
        const clickable: Clickable = this._clickables.find(e => {
            return e.range.contains(position);
        });
        let content: string;
        if (clickable && clickable.getHoverMessage) {
            content = await clickable.getHoverMessage();
            return new Hover(`\`\`\`\r\n${content}\r\n\`\`\``);
        }
    }

    addClickable(clickable: Clickable): void {
        this._clickables.push(clickable);
    }

    removeClickable(range: Range): void {
        if (range) {
            [this._clickables, this._lastClickedItems].forEach(clickables => {
                const index: number = clickables.findIndex(e => { return e.range.isEqual(range); });
                if (index !== -1) {
                    clickables.splice(index, 1);
                }
            });
        }
    }

    clear(): void {
        this._clickables = [];
        this._lastClickedItems = [];
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _onClicked(clickable: Clickable, editor: TextEditor): void {
        if (clickable.clickedDecorationType) {
            editor.setDecorations(clickable.clickedDecorationType, [clickable.range]);
            const index: number = this._lastClickedItems.findIndex(
                e => { return e.clickedDecorationType === clickable.clickedDecorationType; }
            );
            if (index !== -1) {
                this._lastClickedItems.splice(index, 1);
            }
            this._lastClickedItems.push(clickable);
        }
        clickable.callback();
    }

    private _setDecorations(editor: TextEditor): void {
        if (!editor || editor.document.uri.scheme !== this._scheme) {
            Tracer.warning(`Clickable: try to set decoration to wrong scheme: ${editor ? editor.document.uri.scheme : ''}`);
            return;
        }
        this._lastClickedItems.forEach(clickable => {
            editor.setDecorations(clickable.clickedDecorationType, [clickable.range]);
        });
        editor.setDecorations(this._decoration, this._clickables.map((clickable => {
            return clickable.range;
        })));
    }
}