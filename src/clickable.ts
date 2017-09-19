'use strict'

import {
    Range, languages, HoverProvider, Hover, TextDocument, Position, window, Disposable,
    TextEditorDecorationType, TextEditor, TextEditorSelectionChangeKind
} from 'vscode';

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

    private _decorationType = window.createTextEditorDecorationType({
        cursor: 'pointer',
        textDecoration: 'underline'
    });

    constructor(scheme: string) {
        this._disposables.push(languages.registerHoverProvider({scheme}, this));
        this._disposables.push(this._decorationType);

        window.onDidChangeTextEditorSelection(event => {
            let editor = event.textEditor;
            if (editor && editor.document.uri.scheme === scheme) {
                if (event.kind === TextEditorSelectionChangeKind.Mouse) {
                    const pos: Position = event.selections[0].anchor;
                    const clickable: Clickable = this._clickables.find(e => { return e.range.contains(pos) });
                    if (clickable) {
                        this._onClicked(clickable, editor);
                    }
                }
                editor.setDecorations(this._decorationType, this._clickables.map((clickable => {
                    return clickable.range;
                })));
            }
        }, null, this._disposables);
        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === scheme) {
                this._lastClickedItems.forEach(clickable => {
                    editor.setDecorations(clickable.clickedDecorationType, [clickable.range]);
                });
                editor.setDecorations(this._decorationType, this._clickables.map((clickable => {
                    return clickable.range;
                })));
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
            return new Hover('\`\`\`\`\r\n' + content + '\r\n\`\`\`\`', clickable.range);
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
}