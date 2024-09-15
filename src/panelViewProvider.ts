import * as vscode from 'vscode';
import { GitLogEntry } from './gitService';
import { Tracer } from './tracer';
import { Model } from './model';

export class PanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'githd.stats';
  private _extensionUri: vscode.Uri;
  private _webviewUri: vscode.Uri;
  private _view: vscode.WebviewView | undefined;
  private _commits: { stats: string; date: number }[] = [];
  private _shadowArea: { start: number; end: number } | null = null;
  private _dataBucketsCount: number;
  constructor(
    context: vscode.ExtensionContext,
    private _model: Model
  ) {
    this._extensionUri = context.extensionUri;
    this._webviewUri = vscode.Uri.joinPath(this._extensionUri, 'media');
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, this, {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      })
    );
    this._model.onDidChangeConfiguration(() => {
      const bucketsCount = this._model.configuration.dataBucketsCount;
      if (!!bucketsCount && this._dataBucketsCount !== bucketsCount) {
        this._dataBucketsCount = bucketsCount;
        this.update();
      }
    });
    this._dataBucketsCount = _model.configuration.dataBucketsCount ?? 91;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    Tracer.verbose('PanelViewProvider: resolveWebviewView');
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._webviewUri, vscode.Uri.joinPath(this._extensionUri, 'dist')]
    };
    webviewView.webview.html = this._getWebviewContent(webviewView.webview);

    // Wait a short time before updating to ensure the webview is fully loaded
    setTimeout(() => {
      this.update();
      if (this._shadowArea) {
        this.setShadowArea(this._shadowArea.start, this._shadowArea.end);
      }
    }, 500);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
      }
    });

    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'selectionMade':
          this.onSelectionMade(message.start, message.end);
          break;
      }
    });
  }

  private onSelectionMade(start: string, end: string) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    Tracer.verbose(`PanelViewProvider: selectionMade: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    const context = this._model.historyViewContext;
    if (context) {
      context.startTime = startDate;
      context.endTime = endDate;
      this._model.setHistoryViewContext(context);
    }
  }

  update() {
    Tracer.verbose(`PanelViewProvider: update: commits ${this._commits.length} buckets ${this._dataBucketsCount}`);
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateChart',
        data: this._commits,
        bucketsCount: this._dataBucketsCount
      });
    }
  }

  addLogs(logs: GitLogEntry[]) {
    const commits = logs.filter(log => !!log.stat).map(log => ({ stats: log.stat ?? '', date: log.timestamp * 1000 }));
    this._commits.push(...commits);
  }

  clearLogs() {
    this._commits = [];
  }

  setShadowArea(start: number, end: number) {
    this._shadowArea = { start, end };
    if (this._view) {
      Tracer.verbose(`PanelViewProvider: setShadowArea: ${start} - ${end}`);
      this._view.webview.postMessage({
        type: 'setShadowArea',
        start: start * 1000,
        end: end * 1000
      });
    }
  }

  private _getWebviewContent(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._webviewUri, 'stats.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._webviewUri, 'style.css'));
    const chartjsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'chart.js'));
    const chartjsAdapterUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'chartjs-adapter-date-fns.bundle.js')
    );

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <script src="${chartjsUri}"></script>
                <script src="${chartjsAdapterUri}"></script>
            </head>
            <body>
                <div id="chart-container">
                    <canvas id="chart"></canvas>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
  }
}
