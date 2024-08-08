import * as vs from 'vscode';

import { GitService, GitRepo } from './gitService';
import { Tracer } from './tracer';
import { ContextTracker } from './contextTracker';

export interface Configuration {
  readonly commitsCount: number;
  readonly expressMode: boolean;
  readonly displayExpress: boolean;
  readonly traceLevel: string;
  readonly blameEnabled: boolean;
  readonly disabledInEditor: boolean;
  withFolder: boolean;
}

export interface FilesViewContext {
  repo: GitRepo;
  isStash?: boolean;
  leftRef?: string;
  rightRef?: string;
  specifiedPath?: vs.Uri;
  focusedLineInfo?: string;
}

export interface HistoryViewContext {
  repo: GitRepo;
  isStash?: boolean;
  branch: string;
  specifiedPath?: vs.Uri;
  line?: number;
  author?: string;
}

function getConfiguration(): Configuration {
  return {
    withFolder: <boolean>vs.workspace.getConfiguration('githd.explorerView').get('withFolder'),
    commitsCount: <number>vs.workspace.getConfiguration('githd.logView').get('commitsCount'),
    expressMode: <boolean>vs.workspace.getConfiguration('githd.logView').get('expressMode'),
    displayExpress: <boolean>vs.workspace.getConfiguration('githd.logView').get('displayExpressStatus'),
    blameEnabled: <boolean>vs.workspace.getConfiguration('githd.blameView').get('enabled'),
    disabledInEditor: <boolean>vs.workspace.getConfiguration('githd.editor').get('disabled'),
    traceLevel: <string>vs.workspace.getConfiguration('githd').get('traceLevel')
  };
}

export class Model {
  private _config: Configuration;

  private _historyViewContextTracker = new ContextTracker<HistoryViewContext>(
    'canGoBackHistoryView',
    'canGoForwardHistoryView'
  );

  private _filesViewContextTracker = new ContextTracker<FilesViewContext>(
    'canGoBackFilesView',
    'canGoForwardFilesView'
  );

  private _onDidChangeConfiguration = new vs.EventEmitter<Configuration>();
  private _onDidChangeFilesViewContext = new vs.EventEmitter<FilesViewContext | undefined>();
  private _onDidChangeHistoryViewContext = new vs.EventEmitter<HistoryViewContext | undefined>();

  constructor(context: vs.ExtensionContext, private _gitService: GitService) {
    this._config = getConfiguration();
    Tracer.level = this._config.traceLevel;
    vs.commands.executeCommand('setContext', 'disableInEditor', this._config.disabledInEditor);

    vs.workspace.onDidChangeConfiguration(
      () => {
        let newConfig = getConfiguration();
        if (
          newConfig.withFolder !== this._config.withFolder ||
          newConfig.commitsCount !== this._config.commitsCount ||
          newConfig.expressMode !== this._config.expressMode ||
          newConfig.displayExpress !== this._config.displayExpress ||
          newConfig.blameEnabled !== this._config.blameEnabled ||
          newConfig.disabledInEditor !== this._config.disabledInEditor ||
          newConfig.traceLevel !== this._config.traceLevel
        ) {
          Tracer.info(`Model: configuration updated ${JSON.stringify(newConfig)}`);
          this._config = newConfig;
          this._onDidChangeConfiguration.fire(newConfig);
          Tracer.level = newConfig.traceLevel;
          vs.commands.executeCommand('setContext', 'disableInEditor', newConfig.disabledInEditor);
        }
      },
      null,
      context.subscriptions
    );

    vs.workspace.onDidChangeWorkspaceFolders(
      e => {
        this._gitService.updateGitRoots(vs.workspace.workspaceFolders);
      },
      null,
      context.subscriptions
    );
    this._gitService.updateGitRoots(vs.workspace.workspaceFolders);

    context.subscriptions.push(
      this._onDidChangeConfiguration,
      this._onDidChangeFilesViewContext,
      this._onDidChangeHistoryViewContext
    );
  }

  get configuration(): Configuration {
    return this._config;
  }

  get filesViewContext(): FilesViewContext | undefined {
    const current = this._filesViewContextTracker.current;
    if (!current) {
      return;
    }

    // make a deep copy to avoid caller's changes impact the tracked data.
    return {
      repo: current.repo,
      focusedLineInfo: current.focusedLineInfo,
      isStash: current.isStash,
      leftRef: current.leftRef,
      rightRef: current.rightRef,
      specifiedPath: current.specifiedPath
    };
  }

  setFilesViewContext(context: FilesViewContext) {
    Tracer.info(`Model: set filesViewContext - ${JSON.stringify(context)}`);

    context.specifiedPath?.fsPath; // touch it to make the value to be progate to the getter.
    const currentContext = this.filesViewContext;
    if (
      !currentContext ||
      currentContext.leftRef != context?.leftRef ||
      currentContext.rightRef != context?.rightRef ||
      currentContext.specifiedPath != context?.specifiedPath ||
      currentContext.focusedLineInfo != context?.focusedLineInfo
    ) {
      this._filesViewContextTracker.setContext(context);
      this._onDidChangeFilesViewContext.fire(context);
    }
    vs.commands.executeCommand('workbench.view.extension.githd-explorer');
  }

  goBackFilesViewContext() {
    if (this._filesViewContextTracker.goBack()) {
      const context = this._filesViewContextTracker.current;
      Tracer.verbose(`Model: go back files view context ${context?.leftRef}..${context?.rightRef}`);
      this._onDidChangeFilesViewContext.fire(context);
    }
  }

  goForwardFilesViewContext() {
    if (this._filesViewContextTracker.goForward()) {
      const context = this._filesViewContextTracker.current;
      Tracer.verbose(`Model: go forward files view context ${context?.leftRef}..${context?.rightRef}`);
      this._onDidChangeFilesViewContext.fire(context);
    }
  }

  clearFilesViewContexts() {
    this._filesViewContextTracker.clear();
    this._onDidChangeFilesViewContext.fire(undefined);
  }

  get historyViewContext(): HistoryViewContext | undefined {
    const current = this._historyViewContextTracker.current;
    if (!current) {
      return;
    }

    // make a deep copy to avoid caller's changes impact the tracked data.
    return {
      branch: current.branch,
      repo: current.repo,
      author: current.author,
      isStash: current.isStash,
      line: current.line,
      specifiedPath: current.specifiedPath
    };
  }

  async setHistoryViewContext(context: HistoryViewContext) {
    Tracer.info(`Model: set historyViewContext - ${JSON.stringify(context)}`);

    context.specifiedPath?.fsPath; // touch it to make the value to be progate to the getter.
    if (context && !context.branch) {
      context.branch = (await this._gitService.getCurrentBranch(context?.repo)) ?? '';
    }

    this._historyViewContextTracker.setContext(context);
    this._onDidChangeHistoryViewContext.fire(context);
  }

  goBackHistoryViewContext() {
    if (this._historyViewContextTracker.goBack()) {
      const context = this._historyViewContextTracker.current;
      Tracer.verbose(`Model: go back history view context - ${JSON.stringify(context)}`);
      this._onDidChangeHistoryViewContext.fire(context);
    }
  }

  goForwardHistoryViewContext() {
    if (this._historyViewContextTracker.goForward()) {
      const context = this._historyViewContextTracker.current;
      Tracer.verbose(`Model: go forward history view context - ${JSON.stringify(context)}`);
      this._onDidChangeHistoryViewContext.fire(context);
    }
  }

  clearHistoryViewContexts() {
    this._historyViewContextTracker.clear();
  }

  get onDidChangeConfiguration(): vs.Event<Configuration> {
    return this._onDidChangeConfiguration.event;
  }
  get onDidChangeFilesViewContext(): vs.Event<FilesViewContext | undefined> {
    return this._onDidChangeFilesViewContext.event;
  }
  get onDidChangeHistoryViewContext(): vs.Event<HistoryViewContext | undefined> {
    return this._onDidChangeHistoryViewContext.event;
  }
}
