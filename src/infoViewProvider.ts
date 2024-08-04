import * as vs from 'vscode';

import { FilesViewContext, Model } from './model';
import { GitService } from './gitService';
import { decorateWithoutWhitespace, getPullRequest, getTextEditor, prHoverMessage } from './utils';
import { ClickableProvider } from './clickable';

export class InfoViewProvider implements vs.TextDocumentContentProvider {
  static scheme: string = 'githd-line';
  static defaultUri: vs.Uri = vs.Uri.parse(InfoViewProvider.scheme + '://authority//Commit Info');

  private _infoDecoration = vs.window.createTextEditorDecorationType({
    color: new vs.ThemeColor('githd.infoView.content')
  });

  private _content: string | undefined;
  private _infoRanges: vs.Range[] = [];
  private _clickableProvider = new ClickableProvider(InfoViewProvider.scheme);
  private _onDidChange = new vs.EventEmitter<vs.Uri>();

  constructor(context: vs.ExtensionContext, model: Model, private _gitService: GitService) {
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
      context => this._update(context),
      null,
      context.subscriptions
    );

    context.subscriptions.push(
      this._onDidChange,
      this._infoDecoration,
      this._clickableProvider,
    );
  }

  get onDidChange(): vs.Event<vs.Uri> {
    return this._onDidChange.event;
  }

  provideTextDocumentContent(uri: vs.Uri): string {
    return this._content ?? '';
  }

  private async _update(context?: FilesViewContext) {
    this._infoRanges = [];
    this._clickableProvider.clear();

    if (!context?.rightRef) {
      return;
    }

    this._content = await this._gitService.getCommitDetails(context?.repo, context.rightRef, context?.isStash);
    if ( this._content) {
      const remoteUrl: string | undefined = context?.repo.remoteUrl;
      let addPR = false;
      if (remoteUrl) {
        // Only work for github PR url.
        addPR = remoteUrl.indexOf('github.com') > 0;
      }

      let i = 0;
      this._content.split(/\r?\n/g).forEach(line => {
        if (addPR) {
          const [pr, start] = getPullRequest(line);
          if (pr) {
            const url = remoteUrl + '/pull/' + pr.substring(1);
            this._clickableProvider.addClickable({
              range: new vs.Range(i, start, i, start + pr.length),
              callback: () => vs.env.openExternal(vs.Uri.parse(url)),
              getHoverMessage: () => prHoverMessage
            });
          }
        }
        decorateWithoutWhitespace(this._infoRanges, line, i, 0);
        ++i;
      });
    }

    this._onDidChange.fire(InfoViewProvider.defaultUri);
  }

  private _decorate(editor?: vs.TextEditor) {
    if (editor && this._content) {
      editor.setDecorations(this._infoDecoration, this._infoRanges);
    }
  }
}
