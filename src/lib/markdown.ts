import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string;
}
