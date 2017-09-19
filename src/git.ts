'use strict'

import * as path from 'path';

import { workspace, Uri, commands, env } from 'vscode';
import { spawn } from 'child_process';

function formatDate(timestamp: number): string {
    return (new Date(timestamp * 1000)).toDateString();
}

export namespace git {

    export enum RefType {
        Head,
        RemoteHead,
        Tag
    }
    export interface Ref {
        type: RefType;
        name?: string;
        commit?: string;
    }

    export interface LogEntry {
        subject: string;
        hash: string;
        ref: string;
        author: string;
        email: string;
        date: string;
        stat?: string;
        lineInfo?: string;
    }

    export interface CommittedFile {
        uri: Uri;
        gitRelativePath: string;
        status: string;
    }

    let _gitRootPath: string;
    async function getGitRoot(): Promise<string> {
        if (!_gitRootPath && workspace.rootPath) {
            _gitRootPath = (await exec(['rev-parse', '--show-toplevel'], workspace.rootPath)).trim();
        }
        return _gitRootPath;
    }

    (async function checkGitRepository(): Promise<void> {
        const gitRootPath = await getGitRoot();
        if (gitRootPath && gitRootPath.trim()) {
            commands.executeCommand('setContext', 'isGitRepo', true);
        }
    })();

    async function exec(args: string[], cwd?: string): Promise<string> {
        if (!cwd) {
            cwd = await getGitRoot();
        }
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

    export async function isGitRepo(): Promise<boolean> {
        if (await getGitRoot()) {
            return true;
        }
        return false;
    }

    export function getGitRootPath(): string {
        return _gitRootPath;
    }

    export async function getGitRelativePath(file: Uri) {
        let gitRoot: string = await getGitRoot();
        return path.relative(gitRoot, file.fsPath).replace(/\\/g, '/');
    }

    export async function getCurrentBranch(): Promise<string> {
        return (await exec(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    }

    export async function getCommitsCount(file?: Uri, author?: string): Promise<number> {
        let args: string[] = ['rev-list', '--simplify-merges', '--count', 'HEAD'];
        if (author) {
            args.push(`--author=${author}`);
        }
        if (file) {
            args.push(await getGitRelativePath(file));
        }
        return parseInt(await exec(args));
    }

    export async function getRefs(): Promise<Ref[]> {
        const result = await exec(['for-each-ref', '--format', '%(refname) %(objectname:short)']);

        const fn = (line): Ref | null => {
            let match: RegExpExecArray | null;

            if (match = /^refs\/heads\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: match[1], commit: match[2], type: RefType.Head };
            } else if (match = /^refs\/remotes\/([^/]+)\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: `${match[1]}/${match[2]}`, commit: match[3], type: RefType.RemoteHead };
            } else if (match = /^refs\/tags\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: match[1], commit: match[2], type: RefType.Tag };
            }

            return null;
        };

        return result.trim().split('\n')
            .filter(line => !!line)
            .map(fn)
            .filter(ref => !!ref) as Ref[];
    }

    export async function getCommittedFiles(leftRef: string, rightRef: string): Promise<CommittedFile[]> {
        const gitRootPath = await getGitRoot();
        let args = ['show', '--format=%h', '--name-status', rightRef];
        if (leftRef) {
            args = ['diff', '--name-status', `${leftRef}..${rightRef}`];
        }
        const result = await exec(args);
        let files: CommittedFile[] = [];
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
                files.push({ gitRelativePath, status, uri: Uri.file(path.join(gitRootPath, gitRelativePath)) });
            }
        });
        return files;
    }

    export async function getLogEntries(express: boolean, start: number, count: number, branch: string,
        file?: Uri, line?: number, author?: string): Promise<LogEntry[]> {

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
            const filePath: string = await getGitRelativePath(file);
            args.push('--follow', filePath);
            if (line) {
                args.push(`-L ${line},${line}:${filePath}`);
            }
        }

        const result = await exec(args);
        let entries: LogEntry[] = [];

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

    export async function getCommitDetails(ref: string): Promise<string> {
        const format: string =
` Commit:        %H
 Author:        %aN <%aE>
 AuthorDate:    %ad
 Commit:        %cN <%cE>
 CommitDate:    %cd

 %s
`;
        let details: string = await exec(['show', `--format=${format}`, '--no-patch', '--date=local', ref]);
        const shortstat: string = await exec(['show', '--format=', '--shortstat', ref]);
        const stat = await exec(['show', '--format=', '--stat', ref]);
        details += shortstat + '\r\n';
        details += (await exec(['show', '--format=', '--stat', ref])).substr(0, stat.length - shortstat.length);
        return details;
    }

    export async function getAuthors(): Promise<{name: string, email: string}[]> {
        const result: string = (await exec(['shortlog', '-se', 'HEAD'])).trim();
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
}