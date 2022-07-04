import * as vs from 'vscode';

import { Model } from './model';
import { GitService } from './gitService';
import { decorateWithoutWhitespace, getTextEditor } from './utils';

export class InfoViewProvider implements vs.TextDocumentContentProvider {
  static scheme: string = 'githd-line';
  static defaultUri: vs.Uri = vs.Uri.parse(InfoViewProvider.scheme + '://authority/Commit Info');

  private _infoDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.infoView.content')
  });
  private _pathDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.infoView.path')
  });
  private _oldLineDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.infoView.old')
  });
  private _newLineDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.infoView.new')
  });

  private _content: string | undefined;
  private _onDidChange = new vs.EventEmitter<vs.Uri>();

  constructor(context: vs.ExtensionContext, model: Model, gitService: GitService) {
    context.subscriptions.push(vs.workspace.registerTextDocumentContentProvider(InfoViewProvider.scheme, this));

    vs.window.onDidChangeActiveTextEditor(
      editor => {
        if (editor && editor.document.uri.scheme === InfoViewProvider.scheme) {
          this._decorate(editor);
        }
      },
      null,
      context.subscriptions
    );

    vs.workspace.onDidChangeTextDocument(
      e => {
        if (e.document.uri.scheme === InfoViewProvider.scheme) {
          this._decorate(getTextEditor(e.document));
        }
      },
      null,
      context.subscriptions
    );

    model.onDidChangeFilesViewContext(
      async context => {
        if (context?.rightRef && !context.leftRef) {
          // It is not a diff of two commits so there will be a commit info update
          this.update(await gitService.getCommitDetails(context?.repo, context.rightRef, context.isStash ?? false));
        }
      },
      null,
      context.subscriptions
    );

    context.subscriptions.push(
      this._onDidChange,
      this._infoDecoration,
      this._pathDecoration,
      this._oldLineDecoration,
      this._newLineDecoration
    );
  }

  get onDidChange(): vs.Event<vs.Uri> {
    return this._onDidChange.event;
  }

  provideTextDocumentContent(uri: vs.Uri): string {
    return this._content ?? '';
  }

  update(content: string) {
    this._content = content;
    this._onDidChange.fire(InfoViewProvider.defaultUri);
  }

  _decorate(editor?: vs.TextEditor) {
    if (editor && this._content) {
      let infoRanges: vs.Range[] = [];
      let pathRanges: vs.Range[] = [];
      let oldLineRange: vs.Range[] = [];
      let newLineRange: vs.Range[] = [];

      let diffStarted = false;
      let i = 0;
      this._content.split(/\r?\n/g).forEach(line => {
        if (line.substring(0, 6) == 'diff --') {
          diffStarted = true;
          decorateWithoutWhitespace(pathRanges, line, i, 0);
        } else if (line.substring(0, 3) == '--- ') {
          decorateWithoutWhitespace(pathRanges, line, i, 0);
        } else if (line.substring(0, 3) == '+++ ') {
          decorateWithoutWhitespace(pathRanges, line, i, 0);
        } else if (line[0] == '-') {
          decorateWithoutWhitespace(oldLineRange, line, i, 0);
        } else if (line[0] == '+') {
          decorateWithoutWhitespace(newLineRange, line, i, 0);
        } else if (!diffStarted) {
          decorateWithoutWhitespace(infoRanges, line, i, 0);
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
