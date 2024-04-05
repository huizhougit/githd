import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import * as vs from 'vscode';
import { exec } from 'child_process';
import { Tracer } from './tracer';

const EntrySeparator = '[githd-es]';
const FormatSeparator = '[githd-fs]';

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toDateString();
}

function normalizeFilePath(fsPath: string): string {
  fsPath = path.normalize(fsPath);
  if (os.platform() == 'win32') {
    fsPath = fsPath.toLocaleLowerCase();
  }
  return fsPath;
}

function isSubPath(parentPath: string, fsPath: string): boolean {
  const rel = path.relative(parentPath, fsPath);
  return rel == "" || !(rel.startsWith('..') || path.isAbsolute(rel));
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
  date: string;
  stat?: string;
  lineInfo?: string;
}

export interface GitCommittedFile {
  fileUri: vs.Uri;
  oldFileUri: vs.Uri;
  gitRelativePath: string;
  gitRelativeOldPath: string;
  status: string;
}

class GitCommittedFileImpl implements GitCommittedFile {
  constructor(
    private _repo: GitRepo,
    readonly gitRelativePath: string,
    readonly gitRelativeOldPath: string,
    readonly status: string
  ) {}

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
  subject: string;
  body: string;
  author: string;
  date: string;
  relativeDate: string;
  email: string;
  stat: string;
}

function singleLined(value: string): string {
  return value.replace(/\r?\n|\r/g, ' ');
}

export class GitService {
  private _gitRepos: GitRepo[] = [];
  private _onDidChangeGitRepositories = new vs.EventEmitter<GitRepo[]>();
  private _gitPath: string = vs.workspace.getConfiguration('git').get('path') ?? 'git';

  constructor(context: vs.ExtensionContext) {
    context.subscriptions.push(this._onDidChangeGitRepositories);
  }

  get onDidChangeGitRepositories(): vs.Event<GitRepo[]> {
    return this._onDidChangeGitRepositories.event;
  }

  updateGitRoots(wsFolders: readonly vs.WorkspaceFolder[] | undefined) {
    // reset repos first. Should optimize it to avoid firing multiple events.
    this._gitRepos = [];
    vs.commands.executeCommand('setContext', 'hasGitRepo', false);
    this._onDidChangeGitRepositories.fire([]);

    const start = Date.now();
    let count = 0;
    if (wsFolders) {
      wsFolders.forEach(wsFolder => {
        count += this._scanFolder(wsFolder.uri.fsPath, true);
      });
    }

    Tracer.info(`updateGitRoots: ${wsFolders?.length} wsFolders ${count} subFolders (${Date.now() - start}ms)`);
  }

  getGitRepos(): GitRepo[] {
    return this._gitRepos;
  }

  async getGitRepo(fsPath: string): Promise<GitRepo | undefined> {
    if (fs.statSync(fsPath).isFile()) {
      fsPath = path.dirname(fsPath);
    }
    fsPath = normalizeFilePath(fsPath);
    let repo = this._gitRepos.find(r => isSubPath(r.root, fsPath));
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
        vs.commands.executeCommand('setContext', 'hasGitRepo', true);
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

  async getCommitsCount(repo: GitRepo, branch: string, author?: string): Promise<number> {
    if (!repo) {
      return 0;
    }
    let args: string[] = ['rev-list', '--simplify-merges', '--count', branch];
    if (author) {
      args.push(`--author=${author}`);
    }
    return parseInt(await this._exec(args, repo.root));
  }

  async getRefs(repo: GitRepo): Promise<GitRef[]> {
    if (!repo) {
      return [];
    }
    const result = await this._exec(['for-each-ref', '--format="%(refname) %(objectname:short)"'], repo.root);
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

  async getCommittedFiles(
    repo: GitRepo,
    rightRef: string,
    leftRef?: string,
    isStash?: boolean
  ): Promise<GitCommittedFile[]> {
    if (!repo) {
      return [];
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
    return files;
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
    author?: string
  ): Promise<GitLogEntry[]> {
    Tracer.info(
      `Get entries. repo: ${repo.root}, express: ${express}, start: ${start}, count: ${count}, branch: ${branch}, ` +
        `isStash: ${isStash}, file: ${file?.fsPath}, line: ${line}, author: ${author}`
    );
    if (!repo) {
      return [];
    }
    let format = EntrySeparator;
    if (isStash) {
      format += '%gd:';
    }
    format += `%s${FormatSeparator}%h${FormatSeparator}%d${FormatSeparator}%aN${FormatSeparator}%ae${FormatSeparator}%ct${FormatSeparator}%cr${FormatSeparator}`;
    let args: string[] = [`--format="${format}"`];
    if (!express && !line) {
      args.push('--shortstat');
    }
    if (isStash) {
      args.unshift('stash', 'list');
    } else {
      args.unshift('log', `--skip=${start}`, `--max-count=${count}`, '--simplify-merges', branch);
      if (author) {
        args.push(`--author=${author}`);
      }
      if (file) {
        const filePath = (await this.getGitRelativePath(file)) ?? '.';
        if (line) {
          args.push(`-L ${line},${line}:${filePath} --no-patch`);
        } else {
          args.push('--follow', filePath);
        }
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
      let date: string;
      let stat: string;
      let lineInfo: string;
      entry.split(FormatSeparator).forEach((value, index) => {
        switch (index % 8) {
          case 0:
            subject = singleLined(value);
            break;
          case 1:
            hash = value;
            break;
          case 2:
            ref = value;
            break;
          case 3:
            author = value;
            break;
          case 4:
            email = value;
            break;
          case 5:
            date = formatDate(parseInt(value));
            break;
          case 6:
            date += ` (${value})`;
            break;
          case 7:
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
              date,
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
      ['show', `--format="${format}"`, '--no-patch', '--date=local', ref],
      repo.root
    );
    const body = (await this._exec(['show', '--format=%b', '--no-patch', ref], repo.root)).trim();
    if (body) {
      details += body + '\r\n\r\n';
    }
    details += '-----------------------------\r\n\r\n';
    details += await this._exec(['show', '--format=', '--stat', ref], repo.root);
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
      item = item.substr(start + 1).trim();
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
        const info = line.substr(infoName.length).trim();
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
    const stat = ' ' + items[3]?.trim() ?? '';
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

  private _scanFolder(folder: string, includeSubFolders?: boolean): number {
    let count = 0;
    const children = fs.readdirSync(folder, { withFileTypes: true });
    children
      .filter(child => child.isDirectory())
      .forEach(async child => {
        if (child.name === '.git') {
          this.getGitRepo(folder);
          count++;
        } else if (includeSubFolders) {
          count += this._scanFolder(path.join(folder, child.name));
        }
      });
    return count;
  }

  private async _getRemoteUrl(fsPath: string): Promise<string> {
    let remote = (await this._exec(['remote', 'get-url', '--push', 'origin'], fsPath)).trim();
    if (remote.startsWith('git@')) {
      remote = remote.replace(':', '/').replace('git@', 'https://');
    }
    let url = remote.replace(/\.git$/g, '');
    // Do a best guess if it's a valid git repository url. In case user configs
    // the host name.
    if (url.search(/\.(com|org|net|io|cloud)\//g) > 0) {
      return url;
    }

    Tracer.info('Remote URL: ' + remote);
    // If it's not considered as a valid one, we try to compose a github one.
    return url.replace(/:\/\/.*?\//g, '://github.com/');
  }

  private async _exec(args: string[], cwd: string): Promise<string> {
    const start = Date.now();
    const cmd = this._gitPath + ' ' + args.join(' ');
    return new Promise(resolve => {
      exec(cmd, { encoding: 'utf8', cwd }, (err, stdout) => {
        if (err) {
          Tracer.error(`git command failed: ${cmd} (${Date.now() - start}ms) ${cwd} ${err.message}`);
        } else {
          Tracer.verbose(`git command: ${cmd}. Output size: ${stdout.length} (${Date.now() - start}ms) ${cwd}`);
          resolve(stdout);
        }
      });
    });
  }
}
