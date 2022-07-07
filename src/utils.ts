import * as vs from 'vscode';

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

export function getTextEditor(document: vs.TextDocument): vs.TextEditor | undefined {
  return vs.window.visibleTextEditors.find(editor => editor.document === document);
}

// getRangeForPullRequest finds the pull request id and its start position in the content.
// The assumption is the PR id is represented by #123 in the subject.
export function getPullRequest(content: string): [string, number] {
  const found = content.match(/#[0-9]+/g);
  if (!found) {
    return ['', 0];
  }
  return [found[0], content.indexOf(found[0])];
}
