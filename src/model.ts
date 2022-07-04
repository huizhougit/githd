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
  private _filesViewContext: FilesViewContext | undefined;

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
    return this._filesViewContext;
  }
  set filesViewContext(context: FilesViewContext | undefined) {
    Tracer.info(`Model: set filesViewContext - ${JSON.stringify(context)}`);

    if (!this._filesViewContext) {
      this._filesViewContext = context;
      this._onDidChangeFilesViewContext.fire(this._filesViewContext);
    } else if (
      this._filesViewContext.leftRef != context?.leftRef ||
      this._filesViewContext.rightRef != context?.rightRef ||
      this._filesViewContext.specifiedPath != context?.specifiedPath ||
      this._filesViewContext.focusedLineInfo != context?.focusedLineInfo
    ) {
      this._filesViewContext = context;
      this._onDidChangeFilesViewContext.fire(this._filesViewContext);
    }
    vs.commands.executeCommand('workbench.view.extension.githd-explorer');
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
