'use strict'

import { window, Disposable, TextEditor, Range, ThemeColor, DecorationOptions, HoverProvider, TextDocument, Position, Hover, languages, commands, MarkdownString, Uri } from "vscode";

import { Model } from "./model";
import { GitService, GitBlameItem, GitRepo } from "./gitService";
import { Tracer } from "./tracer";


class BlameViewStatsProvider implements Disposable, HoverProvider {
    private _disposables: Disposable[] = [];
    constructor(private _owner: BlameViewProvider) {
        this._disposables.push(languages.registerHoverProvider({ scheme: 'file' }, this));
    }

    dispose(): void {
        Disposable.from(...this._disposables).dispose();
    }

    async provideHover(document: TextDocument, position: Position): Promise<Hover> {
        if (!this._owner.isInRange(document, position)) {
            return;
        }
        return new Hover(`
_Committed Files_
\`\`\`
${this._owner.blame.stat}
\`\`\`
>
`);
    }
}

export class BlameViewProvider implements Disposable, HoverProvider {
    private _blame: GitBlameItem;
    private _statsProvider: BlameViewStatsProvider;
    private _decoration = window.createTextEditorDecorationType({
        after: {
            color: new ThemeColor('editorLineNumber.foreground'),
            fontStyle: 'italic'
        }        
    });
    private _debouncing: NodeJS.Timer;
    private _enabled : boolean;
    private _disposables: Disposable[] = [];

    constructor(model: Model, private _gitService: GitService) {
        this.enabled = model.configuration.blameEnabled;
        this._statsProvider = new BlameViewStatsProvider(this);
        this._disposables.push(languages.registerHoverProvider({ scheme: 'file' }, this));
        window.onDidChangeTextEditorSelection(e => {
            try {
                const file = e.textEditor.document.uri;
                if (file.scheme === 'file') {
                    this._onDidChangeSelection(e.textEditor);
                }
            } catch (err) {
                Tracer.warning(`BlameViewProvider onDidChangeTextEditorSelection ${err}`);
                this._blame = null;
            }
        }, null, this._disposables);

        model.onDidChangeConfiguration(config => {
            this.enabled = config.blameEnabled;
        }, null, this._disposables);

        this._disposables.push(this._statsProvider);
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
        if (!this.isInRange(document, position)) {
            return;
        }

        const repo: GitRepo = await this._gitService.getGitRepo(this._blame.file);
        const ref: string = this._blame.hash;
        const args: string = encodeURIComponent(JSON.stringify([ repo, ref ]));
        const cmd: string = `[${ref}](command:githd.openCommit?${args} "Click to see commit details")`;
        const content: string = `
_${cmd}_
_${this._blame.author}_
_<<${this.blame.email}>>_
(_${this._blame.date}_)

_\`${this._blame.subject}\`_
>
`;
        let markdown = new MarkdownString(content);
        markdown.isTrusted = true;
        return new Hover(markdown);
    }
    
    private async _onDidChangeSelection(editor: TextEditor) {
        const file = editor.document.uri;
        if (!this._enabled || file.scheme !== 'file') {
            return;
        }

        const line = editor.selection.active.line;
        if (!this._blame || line != this._blame.line || file !== this._blame.file) {
            this._blame = { file, line };
            this._clear(editor);
            clearTimeout(this._debouncing);
            this._debouncing = setTimeout(() => this._update(editor), 250);
        }
    }

    isInRange(doc: TextDocument, pos: Position): boolean {
        if (!this._enabled || !this._blame || pos.line != this._blame.line
            || pos.character < doc.lineAt(this._blame.line).range.end.character
            || doc.uri !== this._blame.file) {
            return false;
        }
        return true;
    }

    private async _update(editor: TextEditor): Promise<void> {
        const file = editor.document.uri;
        const line = editor.selection.active.line;
        Tracer.verbose(`Try to update blame. ${file.fsPath}: ${line}`);
        this._blame = await this._gitService.getBlameItem(file, line);
        if (file !== editor.document.uri || line != editor.selection.active.line) {
            // git blame could take long time and the active line has changed
            Tracer.info(`This update is outdated. ${file.fsPath}: ${line}`);
            this._blame = null;
            return;
        }

        Tracer.verbose(`Update blame view. ${file.fsPath}: ${line}`);
        const options: DecorationOptions = {
            range: new Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
            renderOptions: {
                after: {
                    contentText: `\u00a0\u00a0\u00a0\u00a0${this._blame.author} [${this._blame.relativeDate}]\u00a0\u2022\u00a0${this._blame.subject}`
                }
            }
        };
        editor.setDecorations(this._decoration, [options]);
    }

    private _clear(editor: TextEditor): void {
        editor.setDecorations(this._decoration, []);
    }
}