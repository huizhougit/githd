import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import * as vs from 'vscode';
import { execSync, spawn } from 'child_process';
import { Tracer } from './tracer';
import { isEmptyHash } from './utils';

const EntrySeparator = '[githd-es]';
const FormatSeparator = '[githd-fs]';

function normalizeFilePath(fsPath: string): string {
  fsPath = path.normalize(fsPath);
  if (os.platform() == 'win32') {
    fsPath = fsPath.toLocaleLowerCase();
  }
  if (!fsPath.endsWith(path.sep)) {
    fsPath = fsPath + path.sep;
  }
  return fsPath;
}

export interface GitRepo {
  root: string;
  remoteUrl: string;
}

export enum GitRefType {
  Head,
  RemoteHead,
  Tag
}
export interface GitRef {
  type: GitRefType;
  name?: string;
  commit: string;
}

export interface GitLogEntry {
  subject: string;
  hash: string;
  ref: string;
  author: string;
  email: string;
  timestamp: number;
  date: string;
  relativeDate: string;
  stat?: string;
  lineInfo?: string;
}

export interface GitCommittedFile {
  fileUri: vs.Uri;
  oldFileUri: vs.Uri;
  gitRelativePath: string;
  gitRelativeOldPath: string;
  status: string;
  stat: string | undefined;
}

class GitCommittedFileImpl implements GitCommittedFile {
  constructor(
    private _repo: GitRepo,
    readonly gitRelativePath: string,
    readonly gitRelativeOldPath: string,
    readonly status: string
  ) {}

  stat: string | undefined;

  get fileUri(): vs.Uri {
    return vs.Uri.file(path.join(this._repo.root, this.gitRelativePath));
  }

  get oldFileUri(): vs.Uri {
    return vs.Uri.file(path.join(this._repo.root, this.gitRelativeOldPath));
  }
}

export interface GitBlameItem {
  file: vs.Uri;
  line: number;
  hash: string;
  subject?: string;
  body?: string;
  author?: string;
  date?: string;
  relativeDate?: string;
  email?: string;
  stat?: string;
}

function singleLined(value: string): string {
  return value.replace(/\r?\n|\r/g, ' ');
}

export class GitService {
  private _gitRepos: GitRepo[] = [];
  private _onDidChangeGitRepositories = new vs.EventEmitter<GitRepo[]>();
  private _onDidChangeCurrentGitRepo = new vs.EventEmitter<GitRepo>();
  private _gitPath: string;
  private _currentRepo: GitRepo | undefined;

  constructor(context: vs.ExtensionContext) {
    context.subscriptions.push(
      vs.workspace.onDidChangeWorkspaceFolders(_ => this.updateGitRoots(vs.workspace.workspaceFolders)),
      this._onDidChangeGitRepositories,
      this._onDidChangeCurrentGitRepo
    );
    let gitPath: string = vs.workspace.getConfiguration('git').get('path') ?? '';
    if (gitPath) {
      try {
        execSync(gitPath);
      } catch (err) {
        // fallback to 'git' without the path
        gitPath = 'git';
      }
    } else {
      gitPath = 'git';
    }
    this._gitPath = gitPath;
  }

  get onDidChangeGitRepositories(): vs.Event<GitRepo[]> {
    return this._onDidChangeGitRepositories.event;
  }

  get onDidChangeCurrentGitRepo(): vs.Event<GitRepo> {
    return this._onDidChangeCurrentGitRepo.event;
  }

  async updateGitRoots(wsFolders: readonly vs.WorkspaceFolder[] | undefined) {
    // reset repos first. Should optimize it to avoid firing multiple events.
    this._gitRepos = [];
    vs.commands.executeCommand('setContext', 'githd.hasGitRepo', false);
    this._onDidChangeGitRepositories.fire([]);

    const start = Date.now();
    const promises: Promise<number>[] = wsFolders
      ? wsFolders.map(wsFolder => this._scanFolder(wsFolder.uri.fsPath, true))
      : [Promise.resolve(0)];
    const count: number = await Promise.all(promises).then(results => results.reduce((a, b) => a + b, 0));
    if (count === 1) {
      this.updateCurrentGitRepo(this._gitRepos[0]);
    }
    Tracer.info(`updateGitRoots: ${wsFolders?.length} wsFolders ${count} subFolders (${Date.now() - start}ms)`);
  }

  getGitRepos(): GitRepo[] {
    return this._gitRepos;
  }

  get currentGitRepo(): GitRepo | undefined {
    return this._currentRepo;
  }

  updateCurrentGitRepo(repo: GitRepo) {
    this._currentRepo = repo;
    this._onDidChangeCurrentGitRepo.fire(repo);
  }

  async getGitRepo(fsPath: string): Promise<GitRepo | undefined> {
    if (fs.statSync(fsPath).isFile()) {
      fsPath = path.dirname(fsPath);
    }
    fsPath = normalizeFilePath(fsPath);
    let repo = this._gitRepos.find(r => fsPath.startsWith(r.root));
    if (repo) {
      return repo;
    }
    let root = (await this._exec(['rev-parse', '--show-toplevel'], fsPath)).trim();
    if (root) {
      root = normalizeFilePath(root);
      if (
        this._gitRepos.findIndex((value: GitRepo) => {
          return value.root == root;
        }) === -1
      ) {
        const remoteUrl = await this._getRemoteUrl(fsPath);
        repo = { root, remoteUrl };
        this._gitRepos.push(repo);
        vs.commands.executeCommand('setContext', 'githd.hasGitRepo', true);
        this._onDidChangeGitRepositories.fire(this.getGitRepos());
      }
    }
    return repo;
  }

  async getGitRelativePath(file?: vs.Uri): Promise<string | undefined> {
    if (!file) {
      return;
    }
    const repo = await this.getGitRepo(file.fsPath);
    if (!repo) {
      return;
    }
    let relative: string = path.relative(repo.root, file.fsPath).replace(/\\/g, '/');
    return relative === '' ? '.' : relative;
  }

  async getCurrentBranch(repo: GitRepo | undefined): Promise<string | undefined> {
    if (!repo) {
      return;
    }
    return (await this._exec(['rev-parse', '--abbrev-ref', 'HEAD'], repo.root)).trim();
  }

  async getCommitsCount(
    repo: GitRepo,
    branch: string,
    author?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<number> {
    if (!repo) {
      return 0;
    }
    let args: string[] = ['rev-list', '--simplify-merges', '--count', branch];
    if (author) {
      args.push(`--author=${author}`);
    }
    if (startTime) {
      args.push(`--after=${startTime.toISOString()}`);
    }
    if (endTime) {
      args.push(`--before=${endTime.toISOString()}`);
    }

    // the '--' is to avoid same branch and file names caused error
    args.push('--');

    return parseInt(await this._exec(args, repo.root));
  }

  async getRefs(repo: GitRepo): Promise<GitRef[]> {
    if (!repo) {
      return [];
    }
    const result = await this._exec(['for-each-ref', '--format=%(refname) %(objectname:short)'], repo.root);
    const fn = (line: string): GitRef | null => {
      let match: RegExpExecArray | null;

      if ((match = /^refs\/heads\/([^ ]+) ([0-9a-f]+)$/.exec(line))) {
        return { name: match[1], commit: match[2], type: GitRefType.Head };
      } else if ((match = /^refs\/remotes\/([^/]+)\/([^ ]+) ([0-9a-f]+)$/.exec(line))) {
        return {
          name: `${match[1]}/${match[2]}`,
          commit: match[3],
          type: GitRefType.RemoteHead
        };
      } else if ((match = /^refs\/tags\/([^ ]+) ([0-9a-f]+)$/.exec(line))) {
        return { name: match[1], commit: match[2], type: GitRefType.Tag };
      }

      return null;
    };

    return result
      .trim()
      .split('\n')
      .filter(line => !!line)
      .map(fn)
      .filter(ref => !!ref) as GitRef[];
  }

  // returns [total commits stats, [commits]]
  async getCommittedFiles(
    repo: GitRepo,
    rightRef: string,
    leftRef?: string,
    isStash?: boolean
  ): Promise<[string, GitCommittedFile[]]> {
    if (!repo) {
      return ['', []];
    }
    let args = ['show', '--format=%h', '--name-status', rightRef];
    if (leftRef) {
      args = ['diff', '--name-status', `${leftRef}..${rightRef}`];
    } else if (isStash) {
      args.unshift('stash');
    }
    const result = await this._exec(args, repo.root);
    let files: GitCommittedFile[] = [];
    result.split(/\r?\n/g).forEach((value, index) => {
      if (value) {
        let info = value.split(/\t/g);
        if (info.length < 2) {
          return;
        }
        let gitRelativePath: string;
        let gitRelativeOldPath: string;
        const status: string = info[0][0].toLocaleUpperCase();
        // A    filename
        // M    filename
        // D    filename
        // RXX  file_old    file_new
        // CXX  file_old    file_new
        switch (status) {
          case 'M':
          case 'A':
          case 'D':
          case 'T':
            gitRelativeOldPath = info[1];
            gitRelativePath = info[1];
            break;
          case 'R':
          case 'C':
            gitRelativeOldPath = info[1];
            gitRelativePath = info[2];
            break;
          default:
            throw new Error('Cannot parse ' + info);
        }
        files.push(new GitCommittedFileImpl(repo, gitRelativePath, gitRelativeOldPath, status));
      }
    });
    const stats: string = !leftRef && !isStash ? await this._updateCommitsStats(repo, rightRef, files) : '';
    return [stats, files];
  }

  async getLogEntries(
    repo: GitRepo,
    express: boolean,
    start: number,
    count: number,
    branch: string,
    isStash?: boolean,
    file?: vs.Uri,
    line?: number,
    author?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<GitLogEntry[]> {
    Tracer.info(
      `Get entries. repo: ${repo.root}, express: ${express}, start: ${start}, count: ${count}, branch: ${branch}, ` +
        `isStash: ${isStash}, file: ${file?.fsPath}, line: ${line}, author: ${author}, ` +
        `startTime: ${startTime?.toISOString()}, endTime: ${endTime?.toISOString()}`
    );
    if (!repo) {
      return [];
    }
    let format = EntrySeparator;
    if (isStash) {
      format += '%gd:';
    }

    enum logItem {
      subject,
      hash,
      ref,
      author,
      email,
      timestamp,
      date,
      relativeDate,
      additional,
      total
    }

    format += `%s${FormatSeparator}%h${FormatSeparator}%d${FormatSeparator}%aN${FormatSeparator}%ae${FormatSeparator}%ct${FormatSeparator}%cd${FormatSeparator}%cr${FormatSeparator}`;
    let args: string[] = [`--format=${format}`, '--date=local'];
    if (!express && !line) {
      args.push('--shortstat');
    }
    if (isStash) {
      args.unshift('stash', 'list');
    } else {
      args.unshift('log', `--skip=${start}`, `--max-count=${count}`, '--date-order', '--simplify-merges', branch);
      if (author) {
        args.push(`--author=${author}`);
      }
      if (startTime) {
        args.push(`--after=${startTime.toISOString()}`);
      }
      if (endTime) {
        args.push(`--before=${endTime.toISOString()}`);
      }

      if (file) {
        const filePath = (await this.getGitRelativePath(file)) ?? '.';
        if (line) {
          args.push(`-L ${line},${line}:${filePath}`, '--');
        } else {
          args.push('--follow', '--', filePath);
        }
      } else {
        // the '--' is to avoid same branch and file names caused error
        args.push('--');
      }
    }

    const result = await this._exec(args, repo.root);
    let entries: GitLogEntry[] = [];

    result.split(EntrySeparator).forEach(entry => {
      if (!entry) {
        return;
      }
      let subject: string;
      let hash: string;
      let ref: string;
      let author: string;
      let email: string;
      let timestamp: number;
      let date: string;
      let relativeDate: string;
      let stat: string;
      let lineInfo: string;
      entry.split(FormatSeparator).forEach((value, index) => {
        switch (index % logItem.total) {
          case logItem.subject:
            subject = singleLined(value);
            break;
          case logItem.hash:
            hash = value;
            break;
          case logItem.ref:
            ref = value;
            break;
          case logItem.author:
            author = value;
            break;
          case logItem.email:
            email = value;
            break;
          case logItem.timestamp:
            timestamp = parseInt(value);
            break;
          case logItem.date:
            date = value;
            break;
          case logItem.relativeDate:
            relativeDate = value;
            break;
          case logItem.additional:
            if (!!line) {
              lineInfo = value.trim();
            } else {
              stat = value.trim();
            }
            entries.push({
              subject,
              hash,
              ref,
              author,
              email,
              timestamp,
              date,
              relativeDate,
              stat,
              lineInfo
            });
            break;
        }
      });
    });
    return entries;
  }

  async getCommitDetails(repo: GitRepo | undefined, ref: string, isStash?: boolean): Promise<string> {
    if (!repo) {
      return '';
    }

    const format: string = isStash
      ? `Stash:         %H %nAuthor:        %aN <%aE> %nAuthorDate:    %ad %n%n%s %n`
      : 'Commit:        %H %nAuthor:        %aN <%aE> %nAuthorDate:    %ad %nCommit:        %cN <%cE> %nCommitDate:    %cd %n%n%s %n';
    let details: string = await this._exec(
      ['show', `--format=${format}`, '--no-patch', '--date=local', ref],
      repo.root
    );
    const body = (await this._exec(['show', '--format=%b', '--no-patch', ref], repo.root)).trim();
    if (body) {
      details += body + '\r\n\r\n';
    }
    details += '-----------------------------\r\n\r\n';
    details += await this._exec(['show', '--format=', '--stat', '--stat-width=120', ref], repo.root);
    return details;
  }

  async getAuthors(repo: GitRepo): Promise<{ name: string; email: string }[]> {
    if (!repo) {
      return [];
    }
    const result: string = (await this._exec(['shortlog', '-se', 'HEAD'], repo.root)).trim();
    return result.split(/\r?\n/g).map(item => {
      item = item.trim();
      let start: number = item.search(/ |\t/);
      item = item.substring(start + 1).trim();
      start = item.indexOf('<');

      const name: string = item.substring(0, start);
      const email: string = item.substring(start + 1, item.length - 1);
      return { name, email };
    });
  }

  async getBlameItem(file: vs.Uri, line: number): Promise<GitBlameItem | undefined> {
    const repo = await this.getGitRepo(file.fsPath);
    if (!repo) {
      return;
    }

    const filePath = file.fsPath;
    const result = await this._exec(
      ['blame', `${filePath}`, '-L', `${line + 1},${line + 1}`, '--incremental', '--root'],
      repo.root
    );
    let hash = '';
    let subject = '';
    let author = '';
    let date = '';
    let email = '';
    result.split(/\r?\n/g).forEach((line, index) => {
      if (index == 0) {
        hash = line.split(' ')[0];
      } else {
        const infoName = line.split(' ')[0];
        const info = line.substring(infoName.length).trim();
        if (!info) {
          return;
        }
        switch (infoName) {
          case 'author':
            author = info;
            break;
          case 'committer-time':
            date = new Date(parseInt(info) * 1000).toLocaleDateString();
            break;
          case 'author-mail':
            email = info;
            break;
          case 'summary':
            subject = singleLined(info);
            break;
          default:
            break;
        }
      }
    });
    if ([hash, subject, author, email, date].some(v => !v)) {
      Tracer.warning(
        `Blame info missed. repo ${repo.root} file ${filePath}:${line} ${hash}` +
          ` author: ${author}, mail: ${email}, date: ${date}, summary: ${subject}`
      );
      return;
    }

    if (isEmptyHash(hash)) {
      Tracer.verbose(`Blame info skipped. repo ${repo.root} file ${filePath}:${line} ${hash}`);
      return { file, line, hash };
    }

    // get additional info: abbrev hash, relative date, body, stat
    const addition: string = await this._exec(
      ['show', `--format=%h${FormatSeparator}%cr${FormatSeparator}%b${FormatSeparator}`, '--stat', `${hash}`],
      repo.root
    );
    //const firstLine = addition.split(/\r?\n/g)[0];
    const items = addition.split(FormatSeparator);
    hash = items[0] ?? '';
    const relativeDate = items[1] ?? '';
    const body = items[2]?.trim() ?? '';
    const stat = ' ' + items[3]?.trim();
    return {
      file,
      line,
      subject,
      body,
      hash,
      author,
      date,
      email,
      relativeDate,
      stat
    };
  }

  // commits will be updated with stats
  private async _updateCommitsStats(repo: GitRepo, ref: string, commits: GitCommittedFile[]): Promise<string> {
    const res: string = await this._exec(['show', '--format=', '--stat', '--stat-width=200', ref], repo.root);
    const stats = new Map<string, string>(); // [oldFilePath, stat]
    let total = '';
    res.split(/\r?\n/g).forEach(line => {
      const items = line.split('|');
      if (items.length == 2) {
        stats.set(items[0].trim(), items[1].trim()); // TODO: rename is not handled
      } else if (line.indexOf('changed') > 0) {
        total = line;
      }
    });

    commits.forEach(commit => (commit.stat = stats.get(commit.gitRelativeOldPath)));
    return total;
  }

  async getCommits(repo: GitRepo, branch?: string): Promise<string[]> {
    if (!branch) {
      return [];
    }

    const result: string = await this._exec(
      ['log', '--format=%h', '--simplify-merges', '--date-order', branch, '--'],
      repo.root
    );
    return result.split(/\r?\n/g);
  }

  private async _scanFolder(folder: string, includeSubFolders?: boolean): Promise<number> {
    const children = fs.readdirSync(folder, { withFileTypes: true });
    const promises = children
      .filter(child => child.isDirectory() || child.isFile())
      .map(async child => {
        if (child.name === '.git') {
          await this.getGitRepo(folder);
          return 1;
        }
        if (includeSubFolders && child.isDirectory()) {
          return await this._scanFolder(path.join(folder, child.name));
        }
        return 0;
      });
    return await Promise.all(promises).then(results => results.reduce((a, b) => a + b, 0));
  }

  private async _getRemoteUrl(fsPath: string): Promise<string> {
    let remotes = (await this._exec(['remote'], fsPath)).split(/\r?\n/g);
    const remote = remotes.find(r => r === 'upstream') || remotes.find(r => r === 'origin');
    if (!remote) {
      return '';
    }

    let remoteGit = (await this._exec(['remote', 'get-url', '--push', remote], fsPath)).trim();
    if (remoteGit.startsWith('git@')) {
      remoteGit = remoteGit.replace(':', '/').replace('git@', 'https://');
    }
    let url = remoteGit.replace(/\.git$/g, '');
    // Do a best guess if it's a valid git repository url. In case user configs
    // the host name.
    if (url.search(/\.(com|org|net|io|cloud)\//g) > 0) {
      return url;
    }

    Tracer.info('Remote URL: ' + remoteGit);
    // If it's not considered as a valid one, we try to compose a github one.
    return url.replace(/:\/\/.*?\//g, '://github.com/');
  }

  private async _exec(args: string[], cwd: string): Promise<string> {
    const start = Date.now();
    const cmd = this._gitPath;

    try {
      const result = await new Promise<string>((resolve, reject) => {
        const childProcess = spawn(cmd, args, { cwd });
        childProcess.stdout.setEncoding('utf8');
        childProcess.stderr.setEncoding('utf8');
        let stdout = '',
          stderr = '';
        childProcess.stdout.on('data', chunk => {
          stdout += chunk;
        });
        childProcess.stderr.on('data', chunk => {
          stderr += chunk;
        });
        childProcess.on('error', reject).on('close', code => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(stderr);
          }
        });
      });

      Tracer.verbose(
        `git command: ${cmd} ${args.join(' ')}. Output size: ${result.length} (${Date.now() - start}ms) ${cwd}`
      );
      return result;
    } catch (err) {
      Tracer.error(`git command failed: ${cmd} ${args.join(' ')} (${Date.now() - start}ms) ${cwd} ${err}`);
      return '';
    }
  }
}
