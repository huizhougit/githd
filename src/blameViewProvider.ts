'use strict'

import { window, Disposable, TextEditor, Range, ThemeColor, DecorationOptions } from "vscode";

import { Model } from "./model";
import { GitService, GitBlameItem } from "./gitService";
import { Tracer } from "./tracer";

export class BlameViewProvider implements Disposable {
    private _filePath: string;
    private _line: number;
    private _decoration = window.createTextEditorDecorationType({
        after: {
            color: new ThemeColor('editorLineNumber.foreground'),
            fontStyle: 'italic'
        }        
    });
    private _debouncing: NodeJS.Timer;
    private _disposables: Disposable[] = [];

    constructor(private _model: Model, private _gitService: GitService) {
        window.onDidChangeTextEditorSelection(e => {
            try {
                const file = e.textEditor.document.uri;
                if (file.scheme === 'file') {
                    this._onDidChangeSelection(e.textEditor);
                }
            } catch (err) {
                Tracer.warning(`BlameViewProvider onDidChangeTextEditorSelection\r\n${err}`);
                this._filePath = null;
                this._line = null;
            }
        }, null, this._disposables);
        this._disposables.push(this._decoration);
    }

    dispose(): void {
        Disposable.from(...this._disposables).dispose();
    }

    private async _onDidChangeSelection(editor: TextEditor) {
        const file = editor.document.uri;
        if (file.scheme !== 'file') {
            return;
        }

        const line = editor.selection.active.line + 1;
        if (file.fsPath !== this._filePath || line != this._line) {
            this._filePath = file.fsPath;
            this._line = line;
            this._clear(editor);
            clearTimeout(this._debouncing);
            this._debouncing = setTimeout(() => {
                this._update(editor);
            }, 250);
        }
    }

    private async _update(editor: TextEditor): Promise<void> {
        const file = editor.document.uri;
        const filePath = file.fsPath;
        const line = editor.selection.active.line + 1;
        Tracer.verbose(`Try to update blame. ${filePath}: ${line}`);
        const blame = await this._gitService.getBlameItem(file, line);
        if (filePath !== editor.document.uri.fsPath || line != editor.selection.active.line + 1) {
            // git blame could take long time and the active line has changed
            Tracer.info(`This update is outdated. ${filePath}: ${line}`);
            return;
        }

        Tracer.verbose(`Update blame view. ${filePath} ${line}\r\n${JSON.stringify(blame)}`);
        const options: DecorationOptions = {
            range: new Range(line - 1, Number.MAX_SAFE_INTEGER, line - 1, Number.MAX_SAFE_INTEGER),
            renderOptions: {
                after: {
                    contentText: `\u00a0\u00a0\u00a0\u00a0${blame.author} [${blame.date}]\u00a0\u2022\u00a0${blame.subject}`
                }
            }
        };
        editor.setDecorations(this._decoration, [options]);
    }

    private _clear(editor: TextEditor): void {
        editor.setDecorations(this._decoration, []);
    }
}