import * as vs from 'vscode';

import { Model } from './model';
import { GitService, GitBlameItem } from './gitService';
import { Tracer } from './tracer';
import { getTextEditor, getPullRequest } from './utils';

const NotCommitted = `Not committed yet`;

class BlameViewStatProvider implements vs.Disposable, vs.HoverProvider {
  private _disposables: vs.Disposable[] = [];
  constructor(private _owner: BlameViewProvider) {
    this._disposables.push(vs.languages.registerHoverProvider({ scheme: 'file' }, this));
  }

  dispose(): void {
    vs.Disposable.from(...this._disposables).dispose();
  }

  provideHover(document: vs.TextDocument, position: vs.Position): vs.ProviderResult<vs.Hover> {
    if (!this._owner.isAvailable(document, position)) {
      return;
    }
    let markdown = new vs.MarkdownString(`*\`Committed Files\`*\r\n>\r\n`);
    markdown.appendCodeblock(this._owner.blame?.stat ?? '', 'txt');
    markdown.appendMarkdown('>');
    return new vs.Hover(markdown);
  }
}

export class BlameViewProvider implements vs.HoverProvider {
  private _blame: GitBlameItem | undefined;
  private _statProvider: BlameViewStatProvider;
  private _debouncing: NodeJS.Timer | undefined;
  private _enabled = false;
  private _decoration = vs.window.createTextEditorDecorationType({
    after: {
      color: new vs.ThemeColor('githd.blameView.info'),
      fontStyle: 'italic'
    }
  });

  constructor(context: vs.ExtensionContext, model: Model, private _gitService: GitService) {
    this.enabled = model.configuration.blameEnabled;
    this._statProvider = new BlameViewStatProvider(this);
    context.subscriptions.push(
      vs.languages.registerHoverProvider({ scheme: 'file' }, this),
      this._statProvider,
      this._decoration
    );
    vs.window.onDidChangeTextEditorSelection(
      e => {
        this._onDidChangeSelection(e.textEditor);
      },
      null,
      context.subscriptions
    );

    vs.window.onDidChangeActiveTextEditor(
      editor => {
        if (editor) {
          this._onDidChangeActiveTextEditor(editor);
        }
      },
      null,
      context.subscriptions
    );

    vs.workspace.onDidChangeTextDocument(
      e => {
        this._onDidChangeTextDocument(getTextEditor(e.document));
      },
      null,
      context.subscriptions
    );

    model.onDidChangeConfiguration(
      config => {
        this.enabled = config.blameEnabled;
      },
      null,
      context.subscriptions
    );
  }

  private set enabled(value: boolean) {
    if (this._enabled !== value) {
      Tracer.info(`Blame view: set enabled ${value}`);
      this._enabled = value;
    }
  }

  get blame(): GitBlameItem | undefined {
    return this._blame;
  }

  provideHover(document: vs.TextDocument, position: vs.Position): vs.ProviderResult<vs.Hover> {
    if (!this.isAvailable(document, position)) {
      return;
    }

    const blame = this._blame;
    if (!blame) {
      return;
    }

    return new Promise(async resolve => {
      const repo = await this._gitService.getGitRepo(blame.file.fsPath);
      const ref: string = blame.hash;
      const args: string = encodeURIComponent(JSON.stringify([repo, ref, blame.file]));
      const cmd: string = `[*${ref}*](command:githd.openCommit?${args} "Click to see commit details")`;
      let subject = blame.subject;
      const [pr, start] = getPullRequest(blame.subject);
      if (pr) {
        subject =
          subject.substring(0, start) +
          `[*${pr}*](${repo?.remoteUrl}/pull/${pr.substring(1)} "Click to see the PR")` +
          subject.substring(start + pr.length);
      }

      Tracer.verbose(`Blame view: ${cmd}`);
      const content: string = `
${cmd}
*\`${blame.author}\`*
*\`${blame.email}\`*
*\`(${blame.date})\`*

${subject}

${blame.body}
>`;

      let markdown = new vs.MarkdownString(content);
      markdown.isTrusted = true;
      return resolve(new vs.Hover(markdown));
    });
  }

  isAvailable(doc: vs.TextDocument, pos: vs.Position): boolean {
    if (
      !this._enabled ||
      !this._blame?.hash ||
      doc.isDirty ||
      pos.line != this._blame?.line ||
      pos.character < doc.lineAt(this._blame.line).range.end.character ||
      doc.uri !== this._blame?.file
    ) {
      return false;
    }
    return true;
  }

  private async _onDidChangeSelection(editor: vs.TextEditor) {
    if (!editor) {
      Tracer.info('_onDidChangeSelection with null or undefined editor');
      return;
    }
    const file = editor.document.uri;
    if (!this._enabled || file.scheme !== 'file' || editor.document.isDirty) {
      return;
    }
    Tracer.verbose('Blame view: onDidChangeSelection');

    const line = editor.selection.active.line;
    if (!this._blame || line != this._blame.line || file !== this._blame.file) {
      // this._blame = { file, line, stat: '' };
      this._clear(editor);
      clearTimeout(this._debouncing);
      this._debouncing = setTimeout(() => this._update(editor), 250);
    }
  }

  private async _onDidChangeActiveTextEditor(editor: vs.TextEditor) {
    if (!editor) {
      Tracer.info('_onDidChangeActiveTextEditor with null or undefined editor');
      return;
    }
    const file = editor.document.uri;
    if (!this._enabled || file.scheme !== 'file' || editor.document.isDirty) {
      return;
    }
    Tracer.verbose('Blame view: onDidChangeActiveTextEditor');
    this._clear(editor);
    this._update(editor);
  }

  private async _onDidChangeTextDocument(editor?: vs.TextEditor) {
    if (!editor) {
      Tracer.info('_onDidChange.TextDocument with null or undefined editor');
      return;
    }
    const file = editor.document.uri;
    if (!this._enabled || file.scheme !== 'file') {
      return;
    }
    Tracer.verbose(`Blame view: onDidChange.TextDocument. isDirty ${editor.document.isDirty}`);

    this._clear(editor);
    if (!editor.document.isDirty) {
      this._update(editor);
    }
  }

  private async _update(editor: vs.TextEditor): Promise<void> {
    const file = editor.document.uri;
    const line = editor.selection.active.line;
    Tracer.verbose(`Try to update blame. ${file.fsPath}: ${line}`);
    this._blame = await this._gitService.getBlameItem(file, line);
    if (file !== editor.document.uri || line != editor.selection.active.line || editor.document.isDirty) {
      // git blame could take long time and the active line has changed
      Tracer.info(`This update is outdated. ${file.fsPath}: ${line}, dirty ${editor.document.isDirty}`);
      this._blame = undefined;
    }

    if (!this._blame) {
      return;
    }

    let contentText = '\u00a0\u00a0\u00a0\u00a0';
    if (this._blame?.hash) {
      contentText += `${this._blame.author} [${this._blame.relativeDate}]\u00a0\u2022\u00a0${this._blame.subject}`;
    } else {
      contentText += NotCommitted;
    }
    const options: vs.DecorationOptions = {
      range: new vs.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
      renderOptions: { after: { contentText } }
    };
    editor.setDecorations(this._decoration, [options]);
  }

  private _clear(editor: vs.TextEditor): void {
    this._blame = undefined;
    editor.setDecorations(this._decoration, []);
  }
}
