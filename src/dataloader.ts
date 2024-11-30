// Dataloader is a class that can be used to load data from cache or git repository.

import * as path from 'path';
import * as vs from 'vscode';
import { GitLogEntry, GitRepo, GitService } from './gitService';
import { Tracer } from './tracer';
import { LRUCache } from 'lru-cache';
import { debounce } from './utils';

class Cache {
  // cached log entries count
  static readonly logEntriesCount = 1200;
  // current branch
  branch: string = '';
  // all commits in current branch
  commits: string[] = [];
  // key: history view context, value: GitLogEntry[]
  logEntries = new LRUCache<string, GitLogEntry[]>({ max: 5 });
  // key: history view context, value: total commits count
  counts = new LRUCache<string, number>({ max: 100 });

  constructor() {}

  countKey(branch: string, author?: string, startTime?: Date, endTime?: Date): string {
    return `${branch},${author ?? ''},${startTime?.getTime() ?? ''},${endTime?.getTime() ?? ''}`;
  }

  logEntryKey(
    branch: string,
    stash?: boolean,
    file?: string,
    line?: number,
    author?: string,
    startTime?: Date,
    endTime?: Date
  ): string {
    return `${branch},${stash ? '1' : ''},${file ?? ''},${line ?? ''},${author ?? ''},${startTime?.getTime() ?? ''},${endTime?.getTime() ?? ''}`;
  }

  clear() {
    this.branch = '';
    this.commits = [];
    this.logEntries.clear();
    this.counts.clear();
  }
}

export class Dataloader {
  private _cacheEnabled = true;
  private _cache = new Cache();
  private _fsWatcher: vs.FileSystemWatcher | undefined;
  private _repo: GitRepo | undefined;
  private _updating = false;
  private _debouncedUpdate: (repo: GitRepo) => void;

  constructor(
    ctx: vs.ExtensionContext,
    private _gitService: GitService
  ) {
    this._debouncedUpdate = debounce((repo: GitRepo) => this._updateCaches(repo), 1000);
    this._gitService.onDidChangeCurrentGitRepo(repo => this._updateRepo(repo), null, ctx.subscriptions);
  }

  enableCache(enable: boolean): void {
    if (this._cacheEnabled === enable) {
      return;
    }

    this._cacheEnabled = enable;
    enable ? this._enableCache() : this._disableCache();
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
    if (!this._useCache(repo.root)) {
      return this._gitService.getLogEntries(
        repo,
        express,
        start,
        count,
        branch,
        isStash,
        file,
        line,
        author,
        startTime,
        endTime
      );
    }

    const key = this._cache.logEntryKey(branch, isStash ?? false, file?.fsPath, line, author, startTime, endTime);
    const cache: GitLogEntry[] | undefined = this._cache.logEntries.get(key);
    if (cache) {
      if (cache.length < Cache.logEntriesCount) {
        // We have the full log entries
        return cache.slice(start, start + count);
      }

      if (start + count < cache.length) {
        return cache.slice(start, start + count);
      }
    }

    const entries = await this._gitService.getLogEntries(
      repo,
      express,
      start,
      count,
      branch,
      isStash,
      file,
      line,
      author,
      startTime,
      endTime
    );

    // Only update cache when loading the first page
    if (start == 0) {
      // We try to load a bigger first page than we can cache, in this case, we
      // only cache it if we can cache all entries
      if (count >= Cache.logEntriesCount && entries.length < Cache.logEntriesCount) {
        this._cache.logEntries.set(key, entries);
      } else if (count < Cache.logEntriesCount) {
        // Update the cache asynchronously
        Promise.resolve().then(async () => {
          const cacheEntries = await this._gitService.getLogEntries(
            repo,
            express,
            0,
            Cache.logEntriesCount,
            branch,
            isStash,
            file,
            line,
            author,
            startTime,
            endTime
          );

          this._cache.logEntries.set(key, cacheEntries);
          Tracer.info(`Dataloader: update log entries cache ${key}, ${cacheEntries.length}`);
        });
      }
    } else {
      Tracer.info(`Dataloader: cache missing for non-first page ${key}, start {${start}}, count ${count}`);
    }
    return entries;
  }

  async getCommitsCount(
    repo: GitRepo,
    branch: string,
    author?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<number> {
    if (!this._useCache(repo.root)) {
      return this._gitService.getCommitsCount(repo, branch, author, startTime, endTime);
    }

    const key = this._cache.countKey(branch, author, startTime, endTime);
    const count: number | undefined = this._cache.counts.get(key);
    if (count) {
      return count;
    }

    const result = await this._gitService.getCommitsCount(repo, branch, author, startTime, endTime);
    this._cache.counts.set(key, result);
    return result;
  }

  async getCurrentBranch(repo?: GitRepo): Promise<string> {
    if (!repo) {
      return '';
    }

    return this._useCache(repo.root) ? this._cache.branch : ((await this._gitService.getCurrentBranch(repo)) ?? '');
  }

  async getNextCommit(repo: GitRepo | undefined, ref: string): Promise<string> {
    if (!repo) {
      return '';
    }

    const commits: string[] = this._useCache(repo.root) ? this._cache.commits : await this._gitService.getCommits(repo);
    const index: number = commits.indexOf(ref);
    return index > 0 ? commits[index - 1] : '';
  }

  async getPreviousCommit(repo: GitRepo | undefined, ref: string): Promise<string> {
    if (!repo) {
      return '';
    }

    const commits: string[] = this._useCache(repo.root) ? this._cache.commits : await this._gitService.getCommits(repo);
    const index: number = commits.indexOf(ref);
    return index >= 0 && index + 1 < commits.length ? commits[index + 1] : '';
  }

  // Returns [has previous commit, has next commit]
  async hasNeighborCommits(repo: GitRepo | undefined, ref: string): Promise<[boolean, boolean]> {
    if (!repo) {
      return [false, false];
    }

    const commits: string[] = this._useCache(repo.root) ? this._cache.commits : await this._gitService.getCommits(repo);
    const index: number = commits.indexOf(ref);
    return [index >= 0 && index + 1 < commits.length, index > 0];
  }

  private _enableCache() {
    const repo: GitRepo | undefined = this._gitService.currentGitRepo;
    if (!repo) {
      return;
    }

    // Don't cache if we are in a remote repo because createFileSystemWatcher will not work
    if (repo.root.startsWith('/mnt')) {
      this._cacheEnabled = false;
      return;
    }

    this._repo = repo;
    const watching = new vs.RelativePattern(path.join(repo.root, '.git'), '**');
    this._fsWatcher = vs.workspace.createFileSystemWatcher(watching);
    this._fsWatcher.onDidChange(uri => this._handleFileUpdate(repo, uri));
    this._fsWatcher.onDidCreate(uri => this._handleFileUpdate(repo, uri));
    this._fsWatcher.onDidDelete(uri => this._handleFileUpdate(repo, uri));
    this._handleFileUpdate(repo);

    Tracer.info(`Dataloader: started watching ${watching.baseUri.fsPath}`);
  }

  private _disableCache() {
    this._repo = undefined;
    if (this._fsWatcher) {
      this._fsWatcher.dispose();
    }
    this._cache.clear();
    this._updating = false;
  }

  private async _updateRepo(repo: GitRepo): Promise<void> {
    if (!this._cacheEnabled || this._repo?.root === repo.root) {
      return;
    }

    // reenable cache in the new repo
    this._disableCache();
    this._enableCache();
  }

  private _handleFileUpdate(repo: GitRepo, uri?: vs.Uri) {
    Tracer.verbose(`Dataloader: _handleFileUpdate: current repo:${repo.root}, uri:${uri?.fsPath}`);

    // There will be many related file updates in a short time for a single user git command.
    // We want to batch them together have less updates.
    this._updating = true;
    this._debouncedUpdate(repo);
  }

  private async _updateCaches(repo: GitRepo): Promise<void> {
    Tracer.verbose(`Dataloader: _updateCaches: updating cache for ${repo.root}`);

    const branch = (await this._gitService.getCurrentBranch(repo)) ?? '';
    const [commits, count, logs] = await Promise.all([
      this._gitService.getCommits(repo, branch),
      this._gitService.getCommitsCount(repo, branch),
      this._gitService.getLogEntries(repo, false, 0, Cache.logEntriesCount, branch)
    ]);

    if (this._repo?.root !== repo.root) {
      // The cache data fetching is finished after the repo is changed. We don't update
      Tracer.warning(`Dataloader: different repo: ${repo.root} ${this._repo?.root}`);
      return;
    }

    this._cache.branch = branch;
    this._cache.commits = commits;
    this._cache.counts.set(this._cache.countKey(branch), count);
    this._cache.logEntries.set(this._cache.logEntryKey(branch), logs);
    this._updating = false;

    Tracer.verbose(`Dataloader: _updateCaches: cache updated for ${repo.root}`);
  }

  private _useCache(repo: string): boolean {
    if (!this._cacheEnabled) {
      return false;
    }
    if (repo !== this._repo?.root) {
      Tracer.warning(`Dataloader: different repo: ${repo} ${this._repo?.root}`);
      return false;
    }
    if (this._updating) {
      Tracer.info('Dataloader: updating');
      return false;
    }
    return true;
  }
}
