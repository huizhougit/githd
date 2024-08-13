import * as vs from 'vscode';

import { Tracer } from './tracer';
import { getTextEditors } from './utils';

export interface Clickable {
  readonly range: vs.Range;
  readonly callback: () => any;
  readonly clickedDecorationType?: vs.TextEditorDecorationType;
  getHoverMessage?: () => vs.MarkdownString | Promise<vs.MarkdownString>;
}

export class ClickableProvider implements vs.HoverProvider {
  private _clickables: Clickable[] = [];
  private _disposables: vs.Disposable[] = [];
  private _lastClickedItems: Clickable[] = [];

  private _decoration = vs.window.createTextEditorDecorationType({
    cursor: 'pointer',
    textDecoration: 'underline'
  });

  constructor(private _scheme: string) {
    this._disposables.push(vs.languages.registerHoverProvider({ scheme: _scheme }, this));
    this._disposables.push(this._decoration);

    vs.window.onDidChangeTextEditorSelection(
      event => {
        let editor = event.textEditor;
        if (editor && editor.document.uri.scheme === _scheme) {
          if (event.kind === vs.TextEditorSelectionChangeKind.Mouse) {
            const pos: vs.Position = event.selections[0].anchor;
            const clickable = this._clickables.find(e => {
              return e.range.contains(pos);
            });
            if (clickable) {
              this._onClicked(clickable, editor);
            }
          }
        }
      },
      null,
      this._disposables
    );

    vs.window.onDidChangeActiveTextEditor(
      editor => {
        if (editor && editor.document.uri.scheme === _scheme) {
          this._setDecorations(editor);
        }
      },
      null,
      this._disposables
    );

    vs.window.onDidChangeVisibleTextEditors(
      editors => {
        editors.forEach(editor => {
          if (editor && editor.document.uri.scheme === _scheme) {
            this._setDecorations(editor);
          }
        });
      },
      null,
      this._disposables
    );

    vs.workspace.onDidChangeTextDocument(
      e => {
        if (e.document.uri.scheme === _scheme) {
          getTextEditors(_scheme).forEach(editor => this._setDecorations(editor));
        }
      },
      null,
      this._disposables
    );
  }

  async provideHover(document: vs.TextDocument, position: vs.Position): Promise<vs.Hover | undefined> {
    const clickable = this._clickables.find(e => {
      return e.range.contains(position);
    });
    if (clickable && clickable.getHoverMessage) {
      const content = await clickable.getHoverMessage();
      return new vs.Hover(content);
    }
  }

  addClickable(clickable: Clickable): void {
    this._clickables.push(clickable);
  }

  removeClickable(range: vs.Range): void {
    if (range) {
      [this._clickables, this._lastClickedItems].forEach(clickables => {
        const index: number = clickables.findIndex(e => {
          return e.range.isEqual(range);
        });
        if (index !== -1) {
          clickables.splice(index, 1);
        }
      });
    }
  }

  clear(): void {
    this._clickables = [];
    getTextEditors(this._scheme).forEach(editor => {
      this._lastClickedItems.forEach(clickable => {
        if (clickable.clickedDecorationType) {
          editor.setDecorations(clickable.clickedDecorationType, []);
        }
      });
    });
    this._lastClickedItems = [];
  }

  dispose(): void {
    this._disposables.forEach(d => d.dispose());
  }

  private _onClicked(clickable: Clickable, editor: vs.TextEditor): void {
    if (clickable.clickedDecorationType) {
      editor.setDecorations(clickable.clickedDecorationType, [clickable.range]);
      const index: number = this._lastClickedItems.findIndex(e => {
        return e.clickedDecorationType === clickable.clickedDecorationType;
      });
      if (index !== -1) {
        this._lastClickedItems.splice(index, 1);
      }
      this._lastClickedItems.push(clickable);
    }
    clickable.callback();
  }

  private _setDecorations(editor?: vs.TextEditor): void {
    if (!editor || editor.document.uri.scheme !== this._scheme) {
      Tracer.warning(`Clickable: try to set decoration to wrong scheme: ${editor ? editor.document.uri.scheme : ''}`);
      return;
    }
    this._lastClickedItems.forEach(clickable => {
      if (clickable.clickedDecorationType) {
        editor.setDecorations(clickable.clickedDecorationType, [clickable.range]);
      }
    });
    editor.setDecorations(
      this._decoration,
      this._clickables.map(clickable => {
        return clickable.range;
      })
    );
  }
}
