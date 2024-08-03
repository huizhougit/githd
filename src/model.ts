import * as vs from 'vscode';

import { GitService, GitRepo } from './gitService';
import { Tracer } from './tracer';

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

  private _historyViewContext: HistoryViewContext | undefined;
  private _filesViewContextTracker: FilesViewContext[] = [];
  private _nextFilesViewContextIndex: number = 0;

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
    return this._nextFilesViewContextIndex > 0 ?
      this._filesViewContextTracker[this._nextFilesViewContextIndex - 1] : undefined;
  }

  setFilesViewContext(context: FilesViewContext) {
    Tracer.info(`Model: set filesViewContext - ${JSON.stringify(context)}`);

    const maxTrackedCount = 100;
    const currentContext = this.filesViewContext;
    if (!currentContext ||
      currentContext.leftRef != context?.leftRef ||
      currentContext.rightRef != context?.rightRef ||
      currentContext.specifiedPath != context?.specifiedPath ||
      currentContext.focusedLineInfo != context?.focusedLineInfo
    ) {
      if (this._nextFilesViewContextIndex == 0) {
        vs.commands.executeCommand('setContext', 'canGoBackFilesView', true);
      }

      if (this._nextFilesViewContextIndex == maxTrackedCount) {
        this._filesViewContextTracker = this._filesViewContextTracker.slice(1, this._nextFilesViewContextIndex);
      } else {
        this._nextFilesViewContextIndex++
        this._filesViewContextTracker = this._filesViewContextTracker.slice(0, this._nextFilesViewContextIndex);
      }
      this._filesViewContextTracker[this._nextFilesViewContextIndex-1] = context;
      this._onDidChangeFilesViewContext.fire(context);
    }
    vs.commands.executeCommand('workbench.view.extension.githd-explorer');
  }

  goBackFilesViewContext() {
    if (this._nextFilesViewContextIndex == 0) {
      return;
    }

    if (this._nextFilesViewContextIndex == this._filesViewContextTracker.length) {
      vs.commands.executeCommand('setContext', 'canGoForwardFilesView', true);
    }

    this._nextFilesViewContextIndex--;
    if (this._nextFilesViewContextIndex == 0) {
      vs.commands.executeCommand('setContext', 'canGoBackFilesView', false);
    }
    const goToContext = this.filesViewContext;
    Tracer.verbose(`Model: go back files view context ${goToContext?.leftRef}..${goToContext?.rightRef}`);
    this._onDidChangeFilesViewContext.fire(goToContext);
  }

  goForwardFilesViewContext() {
    if (this._nextFilesViewContextIndex == this._filesViewContextTracker.length) {
      return;
    }

    if (this._nextFilesViewContextIndex == 0) {
      vs.commands.executeCommand('setContext', 'canGoBackFilesView', true);
    }

    this._nextFilesViewContextIndex++;
    if (this._nextFilesViewContextIndex == this._filesViewContextTracker.length) {
      vs.commands.executeCommand('setContext', 'canGoForwardFilesView', false);
    }
    const goToContext = this.filesViewContext;
    Tracer.verbose(`Model: go forward files view context ${goToContext?.leftRef}..${goToContext?.rightRef}`);
    this._onDidChangeFilesViewContext.fire(goToContext);
  }

  clearFilesViewContexts() {
    this._filesViewContextTracker = [];
    this._nextFilesViewContextIndex = 0;
    vs.commands.executeCommand('setContext', 'canGoBackFilesView', false);
    vs.commands.executeCommand('setContext', 'canGoForwardFilesView', false);
    this._onDidChangeFilesViewContext.fire(undefined);
  }

  get historyViewContext(): HistoryViewContext | undefined {
    return this._historyViewContext;
  }
  async setHistoryViewContext(context: HistoryViewContext | undefined) {
    Tracer.info(`Model: set historyViewContext - ${JSON.stringify(context)}`);

    this._historyViewContext = context;
    if (this._historyViewContext && !this._historyViewContext?.branch) {
      this._historyViewContext.branch = (await this._gitService.getCurrentBranch(context?.repo)) ?? '';
    }
    this._onDidChangeHistoryViewContext.fire(this._historyViewContext);
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
