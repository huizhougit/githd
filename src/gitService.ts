'use strict'

import * as path from 'path';
import * as fs from 'fs';

import { workspace, Uri, commands, WorkspaceFolder, Event, EventEmitter, Disposable, window } from 'vscode';
import { spawn } from 'child_process';

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

function exec(args: string[], cwd: string): Promise<string> {
    let content: string = '';
    let gitShow = spawn('git', args, { cwd });
    let out = gitShow.stdout;
    out.setEncoding('utf8');
    return new Promise<string>((resolve, reject) => {
        out.on('data', data => content += data);
        out.on('end', () => resolve(content));
        out.on('error', err => reject(err));
    });
}

export class GitService {
    private _gitRepos: GitRepo[] = [];
    private _onDidChangeGitRepositories = new EventEmitter<GitRepo[]>();
    private _disposables: Disposable[] = [];
    
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

        wsFolders.forEach(async (wsFolder, index) => {
            this.getGitRepo(wsFolder.uri);
            const root = wsFolder.uri.fsPath;
            this._scanSubFolders(root);
        });
    }

    getGitRepos(): GitRepo[] {
        return this._gitRepos;
    }

    async getGitRepo(uri: Uri): Promise<GitRepo> {
        let fsPath = uri.fsPath;
        if (fs.statSync(fsPath).isFile()) {
            fsPath = path.dirname(fsPath);
        }
        let root: string = (await exec(['rev-parse', '--show-toplevel'], fsPath)).trim();
        if (root) {
            root = path.normalize(root);
            if (this._gitRepos.findIndex((value: GitRepo) => { return value.root == root; }) === -1) {
                this._gitRepos.push({ root });
                commands.executeCommand('setContext', 'hasGitRepo', true);
                this._onDidChangeGitRepositories.fire(this.getGitRepos());
            }
        }
        return { root };
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
        return (await exec(['rev-parse', '--abbrev-ref', 'HEAD'], repo.root)).trim();
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
        return parseInt(await exec(args, repo.root));
    }

    async getRefs(repo: GitRepo): Promise<GitRef[]> {
        if (!repo) {
            return [];
        }
        const result = await exec(['for-each-ref', '--format', '%(refname) %(objectname:short)'], repo.root);
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

    async getCommittedFiles(repo: GitRepo, leftRef: string, rightRef: string): Promise<GitCommittedFile[]> {
        if (!repo) {
            return [];
        }
        let args = ['show', '--format=%h', '--name-status', rightRef];
        if (leftRef) {
            args = ['diff', '--name-status', `${leftRef}..${rightRef}`];
        }
        const result = await exec(args, repo.root);
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

    async getLogEntries(repo: GitRepo, express: boolean, start: number, count: number, branch: string,
        file?: Uri, line?: number, author?: string): Promise<GitLogEntry[]> {

        if (!repo) {
            return [];
        }
        const entrySeparator = '471a2a19-885e-47f8-bff3-db43a3cdfaed';
        const itemSeparator = 'e69fde18-a303-4529-963d-f5b63b7b1664';
        const format = `--format=${entrySeparator}%s${itemSeparator}%h${itemSeparator}%d${itemSeparator}%aN${itemSeparator}%ae${itemSeparator}%ct${itemSeparator}%cr${itemSeparator}`;
        let args: string[] = ['log', format, '--simplify-merges', `--skip=${start}`, `--max-count=${count}`, branch];
        if (!express || !!line) {
            args.push('--shortstat');
        }
        if (author) {
            args.push(`--author=${author}`);
        }
        if (file) {
            const filePath: string = await this.getGitRelativePath(file);
            args.push('--follow', filePath);
            if (line) {
                args.push(`-L ${line},${line}:${filePath}`);
            }
        }

        const result = await exec(args, repo.root);
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
                        subject = value.replace(/\r?\n|\r/g, ' ');
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

    async getCommitDetails(repo: GitRepo, ref: string): Promise<string> {
        if (!repo) {
            return null;
        }
        const format: string = ` Commit:        %H
 Author:        %aN <%aE>
 AuthorDate:    %ad
 Commit:        %cN <%cE>
 CommitDate:    %cd

 %s
`;
        let details: string = await exec(['show', `--format=${format}`, '--no-patch', '--date=local', ref], repo.root);
        const shortstat: string = await exec(['show', '--format=', '--shortstat', ref], repo.root);
        const stat = await exec(['show', '--format=', '--stat', ref], repo.root);
        details += shortstat + '\r\n';
        details += (await exec(['show', '--format=', '--stat', ref], repo.root)).substr(0, stat.length - shortstat.length);
        return details;
    }

    async getAuthors(repo: GitRepo): Promise<{ name: string, email: string }[]> {
        if (!repo) {
            return null;
        }
        const result: string = (await exec(['shortlog', '-se', 'HEAD'], repo.root)).trim();
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

    private _scanSubFolders(root: string): void {
        const children = fs.readdirSync(root);
        children.filter(child => child !== '.git').forEach(async (child) => {
            const fullPath = path.join(root, child);
            if (fs.statSync(fullPath).isDirectory()) {
                let gitRoot: string = (await exec(['rev-parse', '--show-toplevel'], fullPath)).trim();
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