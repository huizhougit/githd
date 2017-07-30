'use strict'

import * as path from 'path';

import {
    TextDocumentContentProvider, Uri, Disposable, workspace, window, commands, Event, EventEmitter,
    StatusBarItem
} from 'vscode';
import { Model, HistoryViewContext } from './model';
import { git } from './git';
import { getIconUri } from './icons'

export class HistoryHtmlViewProvider implements TextDocumentContentProvider {
    static scheme: string = 'githd-history';
    static defaultUri: Uri = Uri.parse(HistoryHtmlViewProvider.scheme + '://authority/Git History');

    private static _titleLabel = 'Git History';
    private static _moreLabel = '...';
    private static _refreshLabel = 'refresh';
    private static _separatorLabel = '--------------------------------------------------------------';

    private _commitsCount: number = 200;
    private _content: string;
    private _logCount: number = 0;
    // private _currentLine: number = 0;
    private _loadingMore: boolean = false;
    private _loadAll: boolean = false;
    private _onDidChange = new EventEmitter<Uri>();
    private _disposables: Disposable[] = [];

    private _statusBarItem: StatusBarItem = window.createStatusBarItem(undefined, 2);

    constructor(private _model: Model) {
        let disposable = workspace.registerTextDocumentContentProvider(HistoryHtmlViewProvider.scheme, this);
        this._disposables.push(disposable);

        this._statusBarItem.command = 'githd.viewBranchHistory';
        this._statusBarItem.tooltip = 'Select a branch to see its history';
        this._disposables.push(this._statusBarItem);
        this._disposables.push(this._onDidChange);

        this.commitsCount = this._model.configuration.commitsCount;
        this._model.onDidChangeConfiguration(config => this.commitsCount = config.commitsCount, null, this._disposables);
        this._model.onDidChangeHistoryViewContext(context => {
            this.branch = context.branch;
            this.update();
        });

        window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme === HistoryHtmlViewProvider.scheme) {
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }
        }, null, this._disposables);
    }

    get onDidChange(): Event<Uri> { return this._onDidChange.event; }

    get loadingMore(): boolean { return this._loadingMore; }

    set loadAll(value: boolean) { this._loadAll = value; }

    private set commitsCount(count: number) {
        if ([50, 100, 200, 300, 400, 500].findIndex(a => { return a === count; }) >= 0) {
            this._commitsCount = count;
        }
    }
    private set branch(value: string) {
        this._statusBarItem.text = 'githd: ' + value;
    }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        if (uri.query) { // ref link clicked
            commands.executeCommand('workbench.action.closeActiveEditor');
            let hash: string = uri.query;
            this._model.filesViewContext = {
                leftRef: null,
                rightRef: hash
            };
            // if (this._model.configuration.useExplorer) {
            //     commands.executeCommand('workbench.view.explorer');
            //     // vscode bug could make the active doc change to another one
            //     workspace.openTextDocument(HistoryViewProvider.defaultUri).then(doc => window.showTextDocument(doc));
            // }
            return "";
        }
        // if (this._content) {
        //     return this._generateHtml();
        // }
        return new Promise<string>(async (resolve) => {
            const context = this._model.historyViewContext;
            const loadingMore: boolean = this._loadingMore;
            const loadAll: boolean = this._loadAll;
            let logStart = 0;
            if (loadingMore) {
                this._loadingMore = false;
                logStart = this._logCount;
                this._content += `
                    <div>${HistoryHtmlViewProvider._separatorLabel}</div>'
                `;
            }
            const commitsCount: number = await git.getCommitsCount(context.specifiedPath);
            if (this._loadAll && commitsCount > 1000) {
                window.showInformationMessage(`There are ${commitsCount} commits and it will take a while to load all.`);
            }
            const logCount = this._loadAll ? commitsCount : this._commitsCount;
            const entries: git.LogEntry[] = await git.getLogEntries(logStart, logCount, context.branch, context.specifiedPath);
            if (entries.length === 0) {
                //this._reset();
                resolve('No History');
                return;
            }
            if (!loadingMore) {
                let specifiedPathHtml: string = '';
                if (context.specifiedPath) {
                    specifiedPathHtml = `of<a class="specified-path">${await git.getGitRelativePath(context.specifiedPath)}</a>`;
                }

                //this._reset();
                this._content = `
                    <div>
                        <a class="title">${HistoryHtmlViewProvider._titleLabel}</a>
                        ${specifiedPathHtml}
                        on
                        <a class="branch">${context.branch}</a>
                    </div>
                `;
            }

            const hasMore: boolean = commitsCount > logCount + this._logCount;
            entries.forEach(entry => {
                ++this._logCount;
                const hashHref = uri.with({ path: null, query: entry.hash});
                const hashHtml = `<a class="hash" href="${hashHref}">${entry.hash}</a>`;
                let refHtml: string = '';
                let authorHtml: string = '';
                let emailHtml: string = '';
                let dateHtml: string = '';
                let statHtml: string = '';
                if (entry.ref) {
                    refHtml = `<a class="ref">${entry.ref}</a>`;
                }
                if (entry.author) {
                    authorHtml = `by <a class="author">${entry.author}</a> `;
                }
                if (entry.email) {
                    emailHtml = ` <a class="email">&#60${entry.email}&#62</a>`;
                }
                if (entry.date) {
                    dateHtml = `, <a class="date">${entry.date}</a>`;
                }
                if (entry.stat) {
                    let stat: string = entry.stat;
                    if (context.specifiedPath) {
                        stat = entry.stat.replace('1 file changed, ', '');
                    }
                    statHtml = `<div class="stat">${stat}</div>`;
                }

                this._content += `
                    <p>
                        <div class="subject">${entry.subject}</div>
                        <div>
                            ${hashHtml}
                            ${refHtml}
                            ${authorHtml}
                            ${emailHtml}
                            ${dateHtml}
                        </div>
                        ${statHtml}
                    </p>
                `;
            });
            // if (hasMore) {
            //     this._more = new Clickable(uri.with({ path: null, fragment: HistoryHtmlViewProvider._moreLabel }),
            //         new Range(this._currentLine, 0, this._currentLine, HistoryHtmlViewProvider._moreLabel.length));
            //     resolve(this._content + HistoryHtmlViewProvider._moreLabel);
            // } else {
            //     this._more = null;
            //     resolve(this._content);
            //     if (loadAll) {
            //         window.showInformationMessage(`All ${commitsCount} commits are loaded.`);
            //     }
            // }
            this._statusBarItem.show();
            resolve(this._generateHtml());
        });
    }

    update(uri: Uri = HistoryHtmlViewProvider.defaultUri): void {
        this._onDidChange.fire(uri);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _generateHtml(): string {
        const cssPath = Uri.file(path.join(__dirname, '..', '..', 'src', 'historyView.css')).toString();
        return `
            <head>
                <link rel="stylesheet" type="text/css" href="${cssPath}" >
            </head>
            <body>
                ${this._content}
            </body
        `;
    }
}