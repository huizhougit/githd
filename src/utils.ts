import * as vs from 'vscode';

export const prHoverMessage = new vs.MarkdownString('Click to see GitHub PR');

export function decorateWithoutWhitespace(ranges: vs.Range[], target: string, line: number, offset: number) {
  let start = 0;
  let newWord = true;
  let i = 0;
  for (; i < target.length; ++i) {
    if (target[i] === ' ' || target[i] === '\t' || target[i] === '\n') {
      if (!newWord) {
        newWord = true;
        ranges.push(new vs.Range(line, offset + start, line, offset + i));
      }
    } else {
      if (newWord) {
        newWord = false;
        start = i;
      }
    }
  }
  if (!newWord) {
    ranges.push(new vs.Range(line, offset + start, line, offset + i));
  }
}

export function getTextEditors(scheme: string): vs.TextEditor[] {
  return vs.window.visibleTextEditors.filter(editor => editor.document.uri.scheme === scheme);
}

// getRangeForPullRequests finds the pull request id and its start position in the content.
// The assumption is the PR id is represented by #123 in the subject.
export function getPullRequests(content: string): [string, number][] {
  const found = content.match(/#[0-9]+/g);
  if (!found) {
    return [];
  }
  return found.map(pr => [pr, content.indexOf(pr)]);
}

export function isEmptyHash(hash: string | undefined): boolean {
  return !hash || hash.startsWith('0000');
}

export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), wait);
  };
}
