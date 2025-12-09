import * as vs from 'vscode';

import { GitService, GitRepo } from './gitService';
import { Tracer } from './tracer';
import { ContextTracker } from './contextTracker';
import { Dataloader } from './dataloader';

export interface Configuration {
  readonly commitsCount: number;
  readonly expressMode: boolean;
  readonly displayExpress: boolean;
  readonly traceLevel: string;
  readonly blameViewMode: 'disabled' | 'blame' | 'detail';
  readonly disabledInEditor: boolean;
  withFolder: boolean;
  readonly cacheEnabled: boolean;
  readonly dataBucketsCount: number;
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
  startTime?: Date;
  endTime?: Date;
}

function getConfiguration(): Configuration {
  return {
    withFolder: <boolean>vs.workspace.getConfiguration('githd.explorerView').get('withFolder'),
    commitsCount: <number>vs.workspace.getConfiguration('githd.logView').get('commitsCount'),
    expressMode: <boolean>vs.workspace.getConfiguration('githd.logView').get('expressMode'),
    displayExpress: <boolean>vs.workspace.getConfiguration('githd.logView').get('displayExpressStatus'),
    blameViewMode: <'disabled' | 'blame' | 'detail'>vs.workspace.getConfiguration('githd.blameView').get('enabled'),
    disabledInEditor: <boolean>vs.workspace.getConfiguration('githd.editor').get('disabled'),
    traceLevel: <string>vs.workspace.getConfiguration('githd').get('traceLevel'),
    cacheEnabled: <boolean>vs.workspace.getConfiguration('githd').get('cacheEnabled'),
    dataBucketsCount: <number>vs.workspace.getConfiguration('githd.statsView').get('dataBucketsCount')
  };
}

export class Model {
  private _config: Configuration;

  private _historyViewContextTracker = new ContextTracker<HistoryViewContext>(
    'githd.canGoBackHistoryView',
    'githd.canGoForwardHistoryView'
  );

  private _filesViewContextTracker = new ContextTracker<FilesViewContext>(
    'githd.canGoBackFilesView',
    'canGoForwardFilesView'
  );

  private _onDidChangeConfiguration = new vs.EventEmitter<Configuration>();
  private _onDidChangeFilesViewContext = new vs.EventEmitter<FilesViewContext | undefined>();
  private _onDidChangeHistoryViewContext = new vs.EventEmitter<HistoryViewContext | undefined>();

  constructor(
    context: vs.ExtensionContext,
    private _loader: Dataloader
  ) {
    this._config = getConfiguration();
    Tracer.level = this._config.traceLevel;
    vs.commands.executeCommand('setContext', 'githd.disableInEditor', this._config.disabledInEditor);
    this._loader.enableCache(this._config.cacheEnabled);

    vs.workspace.onDidChangeConfiguration(
      () => {
        let newConfig = getConfiguration();
        if (
          newConfig.withFolder !== this._config.withFolder ||
          newConfig.commitsCount !== this._config.commitsCount ||
          newConfig.expressMode !== this._config.expressMode ||
          newConfig.displayExpress !== this._config.displayExpress ||
          newConfig.blameViewMode !== this._config.blameViewMode ||
          newConfig.disabledInEditor !== this._config.disabledInEditor ||
          newConfig.traceLevel !== this._config.traceLevel ||
          newConfig.cacheEnabled !== this._config.cacheEnabled ||
          newConfig.dataBucketsCount !== this._config.dataBucketsCount
        ) {
          Tracer.info(`Model: configuration updated ${JSON.stringify(newConfig)}`);
          this._config = newConfig;
          this._onDidChangeConfiguration.fire(newConfig);
          Tracer.level = newConfig.traceLevel;
          vs.commands.executeCommand('setContext', 'githd.disableInEditor', newConfig.disabledInEditor);
          this._loader.enableCache(newConfig.cacheEnabled);
        }
      },
      null,
      context.subscriptions
    );

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
    context.specifiedPath?.fsPath; // touch it to make the value to be progate to the getter.

    Tracer.info(`Model: set filesViewContext - ${JSON.stringify(context)}`);

    const currentContext = this.filesViewContext;
    if (
      !currentContext ||
      currentContext.leftRef != context?.leftRef ||
      currentContext.rightRef != context?.rightRef ||
      currentContext.specifiedPath != context?.specifiedPath ||
      currentContext.focusedLineInfo != context?.focusedLineInfo
    ) {
      this._filesViewContextTracker.setContext({
        repo: context.repo,
        focusedLineInfo: context.focusedLineInfo,
        isStash: context.isStash,
        leftRef: context.leftRef,
        rightRef: context.rightRef,
        specifiedPath: context.specifiedPath
      });
      this._onDidChangeFilesViewContext.fire(context);
    }

    // sleep a bit to make sure the context set event is fired before opening the view
    setTimeout(() => {
      vs.commands.executeCommand('workbench.view.extension.githd-explorer');
    }, 100);
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
      specifiedPath: current.specifiedPath,
      startTime: current.startTime,
      endTime: current.endTime
    };
  }

  async setHistoryViewContext(context: HistoryViewContext) {
    context.specifiedPath?.fsPath; // touch it to make the value to be progate to the getter.
    if (context && !context.branch) {
      context.branch = await this._loader.getCurrentBranch(context?.repo);
    }

    Tracer.info(`Model: set historyViewContext - ${JSON.stringify(context)}`);

    this._historyViewContextTracker.setContext({
      branch: context.branch,
      repo: context.repo,
      author: context.author,
      isStash: context.isStash,
      line: context.line,
      specifiedPath: context.specifiedPath,
      startTime: context.startTime,
      endTime: context.endTime
    });
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
