import * as vs from 'vscode';

const maxTrackedCount = 100;

export class ContextTracker<T> {
  private _tracker: T[] = [];
  private _nextIndex: number = 0;

  constructor(private _goBackFlag: string, private _goForwardFlag: string) {
  }

  setContext(context: T) {
    if (JSON.stringify(context) == JSON.stringify(this.current)) {
      return;
    }

    vs.commands.executeCommand('setContext', this._goForwardFlag, false);
    if (this._nextIndex == 1) { // we don't want the current one to be an empty
      vs.commands.executeCommand('setContext', this._goBackFlag, true);
    }

    if (this._nextIndex == maxTrackedCount) {
      this._tracker = this._tracker.slice(1, this._nextIndex);
    } else {
      this._nextIndex++
      this._tracker = this._tracker.slice(0, this._nextIndex);
    }
    this._tracker[this._nextIndex - 1] = context;
  }

  get current(): T | undefined {
    return this._nextIndex > 0 ?
      this._tracker[this._nextIndex - 1] : undefined;
  }

  goBack(): boolean {
    if (this._nextIndex <= 1) {
      return false;
    }

    if (this._nextIndex == this._tracker.length) {
      vs.commands.executeCommand('setContext', this._goForwardFlag, true);
    }

    this._nextIndex--;
    if (this._nextIndex <= 1) {
      vs.commands.executeCommand('setContext', this._goBackFlag, false);
    }

    return true;
  }

  goForward(): boolean {
    if (this._nextIndex == this._tracker.length) {
      return false;
    }

    if (this._nextIndex <= 1) {
      vs.commands.executeCommand('setContext', this._goBackFlag, true);
    }

    this._nextIndex++;
    if (this._nextIndex == this._tracker.length) {
      vs.commands.executeCommand('setContext', this._goForwardFlag, false);
    }
    return true;
  }

  clear() {
    this._nextIndex = 0;
    this._tracker = [];
    vs.commands.executeCommand('setContext', this._goBackFlag, false);
    vs.commands.executeCommand('setContext', this._goForwardFlag, false);
  }
}