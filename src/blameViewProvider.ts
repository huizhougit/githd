'use strict'

import {
    window, Disposable, TextEditor, Range, ThemeColor, DecorationOptions, HoverProvider, TextDocument,
    Position, Hover, languages, MarkdownString, workspace, TextDocumentContentChangeEvent } from "vscode";

import { Model } from "./model";
import { GitService, GitBlameItem, GitRepo } from "./gitService";
import { Tracer } from "./tracer";
import { getTextEditor } from "./utils";

const NotCommitted = `Not committed yet`;

class BlameViewStatProvider implements Disposable, HoverProvider {
    private _disposables: Disposable[] = [];
    constructor(private _owner: BlameViewProvider) {
        this._disposables.push(languages.registerHoverProvider({ scheme: 'file' }, this));
    }

    dispose(): void {
        Disposable.from(...this._disposables).dispose();
    }

    async provideHover(document: TextDocument, position: Position): Promise<Hover> {
        if (!this._owner.isAvailable(document, position)) {
            return;
        }
        return new Hover(`
*\`Committed Files\`*
\`\`\`
${this._owner.blame.stat}
\`\`\`
>
`);
    }
}

export class BlameViewProvider implements Disposable, HoverProvider {
    private _blame: GitBlameItem;
    private _statProvider: BlameViewStatProvider;
    private _debouncing: NodeJS.Timer;
    private _enabled : boolean;
    private _decoration = window.createTextEditorDecorationType({
        after: {
            color: new ThemeColor('editorLineNumber.foreground'),
            fontStyle: 'italic'
        }        
    });
    private _disposables: Disposable[] = [];

    constructor(model: Model, private _gitService: GitService) {
        this.enabled = model.configuration.blameEnabled;
        this._statProvider = new BlameViewStatProvider(this);
        this._disposables.push(languages.registerHoverProvider({ scheme: 'file' }, this));
        window.onDidChangeTextEditorSelection(e => {
            try {
                this._onDidChangeSelection(e.textEditor);
            } catch (err) {
                Tracer.warning(`BlameViewProvider onDidChangeTextEditorSelection ${err}`);
                this._blame = null;
            }
        }, null, this._disposables);

        window.onDidChangeActiveTextEditor(editor => {
            try {
                this._onDidChangeActiveTextEditor(editor);
            } catch (err) {
                Tracer.warning(`BlameViewProvider onDidChangeActiveTextEditor ${err}`);
                this._blame = null;
            }
        }, null, this._disposables);

        workspace.onDidChangeTextDocument(e => {
            try {
                this._onDidChangeTextDocument(getTextEditor(e.document), e.contentChanges);
            } catch (err) {
                Tracer.warning(`BlameViewProvider onDidChangeTextDocument ${err}`);
                this._blame = null;
            }
        }, null, this._disposables);

        model.onDidChangeConfiguration(config => {
            this.enabled = config.blameEnabled;
        }, null, this._disposables);

        this._disposables.push(this._statProvider);
        this._disposables.push(this._decoration);
    }

    private set enabled(value: boolean) {
        if (this._enabled !== value) {
            Tracer.info(`Blame view: set enabled ${value}`);
            this._enabled = value;
        }
    }

    get blame(): GitBlameItem {
        return this._blame;
    }

    dispose(): void {
        Disposable.from(...this._disposables).dispose();
    }

    async provideHover(document: TextDocument, position: Position): Promise<Hover> {
        if (!this.isAvailable(document, position)) {
            return;
        }

        const repo: GitRepo = await this._gitService.getGitRepo(this._blame.file);
        const ref: string = this._blame.hash;
        const args: string = encodeURIComponent(JSON.stringify([ repo, ref, this._blame.file ]));
        const cmd: string = `[*${ref}*](command:githd.openCommit?${args} "Click to see commit details")`;
        Tracer.verbose(`Blame view: ${cmd}`);
        const content: string = `
${cmd}
*\`${this._blame.author}\`*
*\`${this.blame.email}\`*
*\`(${this._blame.date})\`*
>`;

        let markdown = new MarkdownString(content);
        markdown.appendText(`${this._blame.subject}\r\n`);
        markdown.appendMarkdown('>');
        markdown.isTrusted = true;
        return new Hover(markdown);
    }

    isAvailable(doc: TextDocument, pos: Position): boolean {
        if (!this._enabled || !this._blame || !this._blame.hash || doc.isDirty || pos.line != this._blame.line
            || pos.character < doc.lineAt(this._blame.line).range.end.character || doc.uri !== this._blame.file) {
            return false;
        }
        return true;
    }

    private async _onDidChangeSelection(editor: TextEditor) {
        const file = editor.document.uri;
        if (!this._enabled || file.scheme !== 'file' || editor.document.isDirty) {
            return;
        }
        Tracer.verbose('Blame view: onDidChangeSelection');

        const line = editor.selection.active.line;
        if (!this._blame || line != this._blame.line || file !== this._blame.file) {
            this._blame = { file, line };
            this._clear(editor);
            clearTimeout(this._debouncing);
            this._debouncing = setTimeout(() => this._update(editor), 250);
        }
    }

    private async _onDidChangeActiveTextEditor(editor: TextEditor) {
        const file = editor.document.uri;
        if (!this._enabled || file.scheme !== 'file' || editor.document.isDirty) {
            return;
        }
        Tracer.verbose('Blame view: onDidChangeActiveTextEditor');
        this._blame = null;
        this._clear(editor);
        this._update(editor);
    }

    private async _onDidChangeTextDocument(editor: TextEditor, contentChanges: TextDocumentContentChangeEvent[]) {
        const file = editor.document.uri;
        if (!this._enabled || file.scheme !== 'file') {
            return;
        }
        Tracer.verbose(`Blame view: onDidChangeTextDocument. isDirty ${editor.document.isDirty}`);

        this._blame = null;
        this._clear(editor);
        if (!editor.document.isDirty) {
            this._update(editor);
        }
    }

    private async _update(editor: TextEditor): Promise<void> {
        const file = editor.document.uri;
        const line = editor.selection.active.line;
        Tracer.verbose(`Try to update blame. ${file.fsPath}: ${line}`);
        this._blame = await this._gitService.getBlameItem(file, line);
        if (file !== editor.document.uri || line != editor.selection.active.line || editor.document.isDirty) {
            // git blame could take long time and the active line has changed
            Tracer.info(`This update is outdated. ${file.fsPath}: ${line}, dirty ${editor.document.isDirty}`);
            this._blame = null;
            return;
        }

        let contentText = '\u00a0\u00a0\u00a0\u00a0';
        if (this._blame.hash) {
            contentText += `${this._blame.author} [${this._blame.relativeDate}]\u00a0\u2022\u00a0${this._blame.subject}`;
        } else {
            contentText += NotCommitted;
        }
        const options: DecorationOptions = {
            range: new Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
            renderOptions: { after: { contentText } }
        };
        editor.setDecorations(this._decoration, [options]);
    }

    private _clear(editor: TextEditor): void {
        editor.setDecorations(this._decoration, []);
    }
}