'use strict'

import * as path from 'path';
import * as fs from 'fs';

import { workspace, Uri, commands, WorkspaceFolder, Event, EventEmitter, Disposable, window } from 'vscode';
import { spawn } from 'child_process';
import { Tracer } from './tracer';

function formatDate(timestamp: number): string {
    return (new Date(timestamp * 1000)).toDateString();
}

export interface GitRepo {
    root: string;
}

export enum GitRefType {
    Head,
    RemoteHead,
    Tag
}
export interface GitRef {
    type: GitRefType;
    name?: string;
    commit?: string;
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
    uri: Uri;
    gitRelativePath: string;
    status: string;
}

export interface GitBlameItem {
    file: Uri;
    line: number;
    hash?: string;
    subject?: string;
    author?: string;
    date?: string;
    relativeDate?: string;
    email?: string;
    stat?: string
}

function exec(gitPath: string, args: string[], cwd: string): Promise<string> {
    const start = Date.now();
    let content: string = '';
    if (!gitPath) {
        gitPath = 'git';
    }
    let gitShow = spawn(gitPath, args, { cwd });
    let out = gitShow.stdout;
    out.setEncoding('utf8');
    return new Promise<string>((resolve, reject) => {
        out.on('data', data => content += data);
        out.on('end', () => {
            resolve(content);
            Tracer.verbose(`git command: git ${args.join(' ')} (${Date.now() - start}ms)`);
        });
        out.on('error', err => {
            reject(err);
            Tracer.error(`git command failed: git ${args.join(' ')} (${Date.now() - start}ms) ${err.message}`);
        });
    });
}

function singleLined(value: string): string {
    return value.replace(/\r?\n|\r/g, ' ');
}

export class GitService {
    private _gitRepos: GitRepo[] = [];
    private _onDidChangeGitRepositories = new EventEmitter<GitRepo[]>();
    private _disposables: Disposable[] = [];
    private _gitPath: string = workspace.getConfiguration('git').get('path');
    
    constructor() {
        this._disposables.push(this._onDidChangeGitRepositories);
    }

    get onDidChangeGitRepositories(): Event<GitRepo[]> { return this._onDidChangeGitRepositories.event; }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    updateGitRoots(wsFolders: WorkspaceFolder[]): void {
        // reset repos first. Should optimize it to avoid firing multiple events.
        this._gitRepos = [];
        commands.executeCommand('setContext', 'hasGitRepo', false);
        this._onDidChangeGitRepositories.fire([]);

        if (wsFolders) {
            wsFolders.forEach(wsFolder => {
                this.getGitRepo(wsFolder.uri);
                const root = wsFolder.uri.fsPath;
                this._scanSubFolders(root);
            });
        }
    }

    getGitRepos(): GitRepo[] {
        return this._gitRepos;
    }

    async getGitRepo(uri: Uri): Promise<GitRepo> {
        let fsPath = uri.fsPath;
        if (fs.statSync(fsPath).isFile()) {
            fsPath = path.dirname(fsPath);
        }
        const repo: GitRepo = this._gitRepos.find(r => fsPath.startsWith(r.root));
        if (repo) {
            return repo;
        }
        let root: string = (await exec(this._gitPath, ['rev-parse', '--show-toplevel'], fsPath)).trim();
        if (root) {
            root = path.normalize(root);
            if (this._gitRepos.findIndex((value: GitRepo) => { return value.root == root; }) === -1) {
                this._gitRepos.push({ root });
                commands.executeCommand('setContext', 'hasGitRepo', true);
                this._onDidChangeGitRepositories.fire(this.getGitRepos());
            }
        }
        return root ? { root } : null;
    }

    async getGitRelativePath(file: Uri) {
        const repo: GitRepo = await this.getGitRepo(file);
        if (!repo) {
            return;
        }
        let relative: string = path.relative(repo.root, file.fsPath).replace(/\\/g, '/');
        return relative === '' ? '.' : relative;
    }

    async getCurrentBranch(repo: GitRepo): Promise<string> {
        if (!repo) {
            return null;
        }
        return (await exec(this._gitPath, ['rev-parse', '--abbrev-ref', 'HEAD'], repo.root)).trim();
    }

    async getCommitsCount(repo: GitRepo, file?: Uri, author?: string): Promise<number> {
        if (!repo) {
            return 0;
        }
        let args: string[] = ['rev-list', '--simplify-merges', '--count', 'HEAD'];
        if (author) {
            args.push(`--author=${author}`);
        }
        if (file) {
            args.push(await this.getGitRelativePath(file));
        }
        return parseInt(await exec(this._gitPath, args, repo.root));
    }

    async getRefs(repo: GitRepo): Promise<GitRef[]> {
        if (!repo) {
            return [];
        }
        const result = await exec(this._gitPath, ['for-each-ref', '--format', '%(refname) %(objectname:short)'], repo.root);
        const fn = (line): GitRef | null => {
            let match: RegExpExecArray | null;

            if (match = /^refs\/heads\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: match[1], commit: match[2], type: GitRefType.Head };
            } else if (match = /^refs\/remotes\/([^/]+)\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: `${match[1]}/${match[2]}`, commit: match[3], type: GitRefType.RemoteHead };
            } else if (match = /^refs\/tags\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: match[1], commit: match[2], type: GitRefType.Tag };
            }

            return null;
        };

        return result.trim().split('\n')
            .filter(line => !!line)
            .map(fn)
            .filter(ref => !!ref) as GitRef[];
    }

    async getCommittedFiles(repo: GitRepo, leftRef: string, rightRef: string, isStash: boolean): Promise<GitCommittedFile[]> {
        if (!repo) {
            return [];
        }
        let args = ['show', '--format=%h', '--name-status', rightRef];
        if (leftRef) {
            args = ['diff', '--name-status', `${leftRef}..${rightRef}`];
        } else if (isStash) {
            args.unshift('stash');
        }
        const result = await exec(this._gitPath, args, repo.root);
        let files: GitCommittedFile[] = [];
        result.split(/\r?\n/g).forEach((value, index) => {
            if (value) {
                let info = value.split(/\t/g);
                if (info.length < 2) {
                    return;
                }
                let gitRelativePath: string;
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
                        gitRelativePath = info[1];
                        break;
                    case 'R':
                    case 'C':
                        gitRelativePath = info[2];
                        break;
                    default:
                        throw new Error('Cannot parse ' + info);
                }
                files.push({ gitRelativePath, status, uri: Uri.file(path.join(repo.root, gitRelativePath)) });
            }
        });
        return files;
    }

    async getLogEntries(repo: GitRepo, express: boolean, start: number, count: number, branch: string, isStash?: boolean,
        file?: Uri, line?: number, author?: string): Promise<GitLogEntry[]> {
        Tracer.info(`Get entries. repo: ${repo.root}, express: ${express}, start: ${start}, count: ${count}, branch: ${branch},` +
            `isStash: ${isStash}, file: ${file ? file.fsPath : ''}, line: ${line}, author: ${author}`);
        if (!repo) {
            return [];
        }
        const entrySeparator = '471a2a19-885e-47f8-bff3-db43a3cdfaed';
        const itemSeparator = 'e69fde18-a303-4529-963d-f5b63b7b1664';
        let format = `--format=${entrySeparator}`;
        if (isStash) {
            format += '%gd: ';
        }
        format += `%s${itemSeparator}%h${itemSeparator}%d${itemSeparator}%aN${itemSeparator}%ae${itemSeparator}%ct${itemSeparator}%cr${itemSeparator}`;
        let args: string[] = [format];
        if (!express || !!line) {
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
                const filePath: string = await this.getGitRelativePath(file);
                if (line) {
                    args.push(`-L ${line},${line}:${filePath}`);
                } else {
                    args.push('--follow', filePath);
                }
            }
        }

        const result = await exec(this._gitPath, args, repo.root);
        let entries: GitLogEntry[] = [];

        result.split(entrySeparator).forEach(entry => {
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
            entry.split(itemSeparator).forEach((value, index) => {
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
                        entries.push({ subject, hash, ref, author, email, date, stat, lineInfo });
                        break;
                }
            });
        });
        return entries;
    }

    async getCommitDetails(repo: GitRepo, ref: string, isStash: boolean): Promise<string> {
        if (!repo) {
            return null;
        }

        const format: string = isStash ?
` Stash:        %H
 Author:        %aN <%aE>
 AuthorDate:    %ad

 %s
 ` :
` Commit:        %H
 Author:        %aN <%aE>
 AuthorDate:    %ad
 Commit:        %cN <%cE>
 CommitDate:    %cd

 %s
`;
        let details: string = await exec(this._gitPath, ['show', `--format=${format}`, '--no-patch', '--date=local', ref], repo.root);
        details += await exec(this._gitPath, ['show', '--format=', '--stat', ref], repo.root);
        return details;
    }

    async getCommitStats(repo: GitRepo, ref: string): Promise<string> {
        if (!repo) {
            return null;
        }
        return exec(this._gitPath, ['show', '--format=', '--stat', ref], repo.root);
    }

    async getShortRef(repo: GitRepo, ref: string): Promise<string> {
        if (!repo) {
            return null;
        }
        return (await exec(this._gitPath, ['rev-parse', '--short=', ref], repo.root)).trim();
    }

    async getAuthors(repo: GitRepo): Promise<{ name: string, email: string }[]> {
        if (!repo) {
            return null;
        }
        const result: string = (await exec(this._gitPath, ['shortlog', '-se', 'HEAD'], repo.root)).trim();
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

    async getBlameItem(file: Uri, line: number): Promise<GitBlameItem> {
        const repo: GitRepo = await this.getGitRepo(file);
        if (!repo) {
            return null;
        }

        const filePath = file.fsPath;
        const result = await exec(this._gitPath, ['blame', `${filePath}`, '-L', `${line + 1},${line + 1}`, '--incremental', '--root'], repo.root);
        let hash: string;
        let subject: string;
        let author: string;
        let date: string;
        let email: string;
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
                        date = (new Date(parseInt(info) * 1000)).toLocaleDateString();
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
            Tracer.warning(`Blame info missed. repo ${repo.root} file ${filePath}:${line} ${hash}` +
                ` author: ${author}, mail: ${email}, date: ${date}, summary: ${subject}`);
            return null;
        }

        // get additional info: abbrev hash, relative date, stat
        const addition: string = await exec(this._gitPath, ['show', `--format=%h %cr`, '--stat', `${hash}`], repo.root);
        const firstLine = addition.split(/\r?\n/g)[0];
        const items = firstLine.split(' ');
        hash = items[0];
        const relativeDate = firstLine.substr(hash.length).trim();
        const stat = ` ${addition.substr(firstLine.length).trim()}`;
        return { file, line, subject, hash, author, date, email, relativeDate, stat };
    }

    private _scanSubFolders(root: string): void {
        const children = fs.readdirSync(root);
        children.filter(child => child !== '.git').forEach(async (child) => {
            const fullPath = path.join(root, child);
            if (fs.statSync(fullPath).isDirectory()) {
                let gitRoot: string = (await exec(this._gitPath, ['rev-parse', '--show-toplevel'], fullPath)).trim();
                if (gitRoot) {
                    gitRoot = path.normalize(gitRoot);
                    if (this._gitRepos.findIndex((value: GitRepo) => { return value.root == gitRoot; }) === -1) {
                        this._gitRepos.push({ root: gitRoot });
                        commands.executeCommand('setContext', 'hasGitRepo', true);
                        this._onDidChangeGitRepositories.fire(this.getGitRepos());
                    }
                }
                //this._scanSubFolders(fullPath);
            }
        });
    }
}