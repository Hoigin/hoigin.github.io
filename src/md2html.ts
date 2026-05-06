// Typora-style Markdown → HTML rendering engine
// Supports: math, code, mermaid, highlight, strikethrough, task lists,
//           definition lists, nested lists, tables, blockquotes, footnotes

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Data types ─────────────────────────────────────────────────────

interface ListItem {
  type: 'ul' | 'ol' | 'task';
  indent: number;
  content: string;
  extraBlocks: string[];
  checked?: boolean;
  orderNum?: number;
}

// ── Renderer ───────────────────────────────────────────────────────

export class TyporaMarkdownRenderer {
  // footnote state (reset per render call)
  private footnoteCounter = 1;
  private footnoteDefs: Map<string, string> = new Map();
  private footnoteRefsMap: Map<string, number> = new Map();

  render(markdown: string): string {
    // normalize CRLF → LF
    const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // reset footnote state
    this.footnoteCounter = 1;
    this.footnoteDefs = new Map();
    this.footnoteRefsMap = new Map();

    const bodyHtml = this.processBlocks(normalized);
    return this.wrapDocument(bodyHtml);
  }

  // ── Block-level processing ──────────────────────────────────────

  private processBlocks(md: string): string {
    const lines = md.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trimEnd();

      // ── blank line ──
      if (trimmed === '') { i++; continue; }

      // ── footnote definition [^word]: ... ──
      const fnDef = trimmed.match(/^\[\^(\w+)\]:\s+(.+)$/);
      if (fnDef) {
        this.footnoteDefs.set(fnDef[1], fnDef[2]);
        i++;
        continue;
      }

      // ── fenced code block ──
      if (trimmed.startsWith('```')) {
        const lang = trimmed.match(/^```(\w*)/)?.[1] || '';
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trimEnd() !== '```') {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // closing ```
        if (lang === 'mermaid') {
          result.push(`<div class="mermaid">${this.escapeHtml(codeLines.join('\n'))}</div>`);
        } else {
          result.push(this.renderCodeBlock(codeLines.join('\n'), lang));
        }
        continue;
      }

      // ── block math $$ ──
      if (trimmed === '$$') {
        const mathLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trimEnd() !== '$$') {
          mathLines.push(lines[i]);
          i++;
        }
        i++; // closing $$ (or EOF)
        result.push(`<div class="math-block">${this.escapeHtml(mathLines.join('\n'))}</div>`);
        continue;
      }
      // single-line $$...$$
      const singleMath = trimmed.match(/^\$\$(.+)\$\$$/);
      if (singleMath) {
        result.push(`<div class="math-block">${this.escapeHtml(singleMath[1])}</div>`);
        i++;
        continue;
      }

      // ── heading ──
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        result.push(`<h${level}>${this.renderInline(headingMatch[2])}</h${level}>`);
        i++;
        continue;
      }

      // ── horizontal rule ──
      if (trimmed.match(/^[-*_]{3,}$/) && !trimmed.includes('***')) {
        result.push('<hr>');
        i++;
        continue;
      }

      // ── blockquote ──
      if (trimmed.startsWith('>')) {
        const bqLines: string[] = [];
        while (i < lines.length && lines[i].trimEnd().startsWith('>')) {
          bqLines.push(lines[i].trimEnd().replace(/^>\s?/, ''));
          i++;
        }
        result.push(`<blockquote>${this.processBlocks(bqLines.join('\n'))}</blockquote>`);
        continue;
      }

      // ── table ──
      if (trimmed.startsWith('|') && i + 1 < lines.length &&
          lines[i + 1].trimEnd().match(/^\|[\s\-:]+\|/)) {
        result.push(this.renderTable(lines, i));
        while (i < lines.length && lines[i].trimEnd().startsWith('|')) i++;
        continue;
      }

      // ── definition list ──
      // pattern: term line followed by `: definition` lines
      if (this.looksLikeDefinitionList(lines, i)) {
        result.push(this.renderDefinitionList(lines, i));
        // advance past definition list
        while (i < lines.length) {
          const t = lines[i].trimEnd();
          if (t === '') { i++; break; }
          if (t.startsWith(': ')) { i++; continue; }
          // a term line: next line must be `: ...`
          if (i + 1 < lines.length && lines[i + 1].trimEnd().startsWith(': ')) { i++; continue; }
          break;
        }
        continue;
      }

      // ── list (any kind) ──
      if (this.isListLine(trimmed)) {
        const listResult = this.renderListBlock(lines, i);
        result.push(listResult.html);
        i = listResult.endIdx;
        continue;
      }

      // ── HTML tags pass-through ──
      if (trimmed.startsWith('<')) {
        result.push(trimmed);
        i++;
        continue;
      }

      // ── paragraph ──
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trimEnd() !== '' && !this.isBlockStart(lines[i].trimEnd())) {
        // break if next line is a definition — this line is a definition term
        if (i + 1 < lines.length && lines[i + 1].trimEnd().startsWith(': ') &&
            !lines[i].trimEnd().startsWith(': ') &&
            !this.isListLine(lines[i].trimEnd())) {
          break;
        }
        paraLines.push(lines[i].trimEnd());
        i++;
      }
      if (paraLines.length > 0) {
        result.push(`<p>${this.renderInline(paraLines.join('\n'))}</p>`);
      }
    }

    // footnote section
    if (this.footnoteRefsMap.size > 0) {
      result.push('<div class="footnotes"><hr><ol>');
      for (const [key, idx] of [...this.footnoteRefsMap.entries()].sort((a, b) => a[1] - b[1])) {
        const content = this.footnoteDefs.has(key)
          ? this.renderInline(this.footnoteDefs.get(key)!)
          : key;
        result.push(`<li id="fn-${idx}">${content}<a href="#fnref-${idx}" class="footnote-backref">↩</a></li>`);
      }
      result.push('</ol></div>');
    }

    return result.join('\n');
  }

  // ── Inline processing ───────────────────────────────────────────

  private renderInline(text: string): string {
    // protect code spans
    const codeStore: string[] = [];
    text = text.replace(/`([^`]+)`/g, (_m, code) => {
      codeStore.push(`<code>${this.escapeHtml(code)}</code>`);
      return `§C${codeStore.length - 1}§`;
    });

    // protect inline math
    const mathStore: string[] = [];
    text = text.replace(/\$([^$]+)\$/g, (_m, math) => {
      mathStore.push(`<span class="math-inline">${this.escapeHtml(math)}</span>`);
      return `§M${mathStore.length - 1}§`;
    });

    // escaped chars — render as literal
    text = text.replace(/\\([\\`*_{}[\]()#+\-.!~>=|])/g, '§E$1§');

    // highlight ==...==
    text = text.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // strikethrough ~~...~~
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // bold+italic ***...***
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

    // bold **...**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // italic *...*
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // footnote references [^word]
    text = text.replace(/\[\^(\w+)\]/g, (_m, key) => {
      const idx = this.footnoteCounter++;
      this.footnoteRefsMap.set(key, idx);
      return `<sup class="footnote-ref"><a href="#fn-${idx}" id="fnref-${idx}">${idx}</a></sup>`;
    });

    // images ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');

    // links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // restore escaped chars
    text = text.replace(/§E(.?)§/g, '$1');

    // restore protected spans
    for (let ci = 0; ci < codeStore.length; ci++) {
      text = text.replace(`§C${ci}§`, codeStore[ci]);
    }
    for (let mi = 0; mi < mathStore.length; mi++) {
      text = text.replace(`§M${mi}§`, mathStore[mi]);
    }

    // hard line breaks (two trailing spaces)
    text = text.replace(/  \n/g, '<br>\n');

    return text;
  }

  // ── Code block ──────────────────────────────────────────────────

  private renderCodeBlock(code: string, lang: string): string {
    const langAttr = lang ? ` class="language-${lang}"` : '';
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="code-block">${langLabel}<pre><code${langAttr}>${this.escapeHtml(code)}</code></pre></div>`;
  }

  // ── Table ───────────────────────────────────────────────────────

  private renderTable(lines: string[], startIdx: number): string {
    const headerLine = lines[startIdx].trimEnd();
    const sepLine = lines[startIdx + 1].trimEnd();
    const aligns = this.parseTableAlign(sepLine);
    const headers = this.parseTableRow(headerLine);

    let html = '<table>\n<thead>\n<tr>\n';
    headers.forEach((h, ci) => {
      const alignAttr = aligns[ci] ? ` style="text-align:${aligns[ci]}"` : '';
      html += `<th${alignAttr}>${this.renderInline(h)}</th>\n`;
    });
    html += '</tr>\n</thead>\n<tbody>\n';

    let rowIdx = startIdx + 2;
    while (rowIdx < lines.length && lines[rowIdx].trimEnd().startsWith('|')) {
      const cells = this.parseTableRow(lines[rowIdx].trimEnd());
      html += '<tr>\n';
      cells.forEach((cell, ci) => {
        const alignAttr = aligns[ci] ? ` style="text-align:${aligns[ci]}"` : '';
        html += `<td${alignAttr}>${this.renderInline(cell)}</td>\n`;
      });
      html += '</tr>\n';
      rowIdx++;
    }
    html += '</tbody>\n</table>';
    return html;
  }

  private parseTableAlign(sep: string): string[] {
    return sep.split('|').filter(c => c.trim()).map(cell => {
      const t = cell.trim();
      if (t.startsWith(':') && t.endsWith(':')) return 'center';
      if (t.endsWith(':')) return 'right';
      if (t.startsWith(':')) return 'left';
      return '';
    });
  }

  private parseTableRow(line: string): string[] {
    return line.split('|').slice(1, -1).map(c => c.trim());
  }

  // ── Definition list ─────────────────────────────────────────────

  private looksLikeDefinitionList(lines: string[], i: number): boolean {
    const trimmed = lines[i].trimEnd();
    if (trimmed === '' || trimmed.startsWith(': ') || trimmed.startsWith('#') ||
        trimmed.startsWith('> ') || trimmed.startsWith('|') || trimmed.startsWith('$$') ||
        trimmed.startsWith('```') || this.isListLine(trimmed) ||
        trimmed.match(/^[-*_]{3,}$/)) {
      return false;
    }
    // current line is a term, next line must be `: definition`
    if (i + 1 < lines.length && lines[i + 1].trimEnd().startsWith(': ')) {
      return true;
    }
    return false;
  }

  private renderDefinitionList(lines: string[], startIdx: number): string {
    const html: string[] = ['<dl>'];
    let i = startIdx;

    while (i < lines.length) {
      const trimmed = lines[i].trimEnd();
      if (trimmed === '') { i++; break; }

      if (trimmed.startsWith(': ')) {
        html.push(`<dd>${this.renderInline(trimmed.slice(2))}</dd>`);
        i++;
      } else if (i + 1 < lines.length && lines[i + 1].trimEnd().startsWith(': ')) {
        html.push(`<dt>${this.renderInline(trimmed)}</dt>`);
        i++;
      } else {
        break;
      }
    }

    html.push('</dl>');
    return html.join('\n');
  }

  // ── List block ──────────────────────────────────────────────────
  // Renders a top-level list block and everything inside it,
  // including nested sub-lists, code blocks, tables, blockquotes.

  private renderListBlock(lines: string[], startIdx: number): { html: string; endIdx: number } {
    const items: ListItem[] = [];
    let i = startIdx;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trimEnd();
      // stripped = content without leading whitespace (for pattern matching)
      const stripped = trimmed.replace(/^\s+/, '');

      // ── blank line ──
      if (trimmed === '') {
        let peek = i + 1;
        while (peek < lines.length && lines[peek].trimEnd() === '') peek++;
        if (peek < lines.length && this.isListOrEmbedded(lines[peek].trimEnd())) {
          i = peek;
          continue;
        }
        break;
      }

      // ── fenced code block (at any indent) ──
      if (stripped.startsWith('```')) {
        const lang = stripped.match(/^```(\w*)/)?.[1] || '';
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trimEnd().replace(/^\s+/, '') !== '```') {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        if (items.length > 0) {
          if (lang === 'mermaid') {
            items[items.length - 1].extraBlocks.push(
              `<div class="mermaid">${this.escapeHtml(codeLines.join('\n'))}</div>`);
          } else {
            items[items.length - 1].extraBlocks.push(this.renderCodeBlock(codeLines.join('\n'), lang));
          }
        }
        continue;
      }

      // ── table (at any indent) ──
      if (stripped.startsWith('|') && i + 1 < lines.length &&
          lines[i + 1].trimEnd().replace(/^\s+/, '').match(/^\|[\s\-:]+\|/)) {
        const tableHtml = this.renderTable(lines, i);
        while (i < lines.length && lines[i].trimEnd().replace(/^\s+/, '').startsWith('|')) i++;
        if (items.length > 0) {
          items[items.length - 1].extraBlocks.push(tableHtml);
        }
        continue;
      }

      // ── blockquote (at any indent) ──
      if (stripped.startsWith('>')) {
        const bqLines: string[] = [];
        while (i < lines.length && lines[i].trimEnd().replace(/^\s+/, '').startsWith('>')) {
          bqLines.push(lines[i].trimEnd().replace(/^\s+/, '').replace(/^>\s?/, ''));
          i++;
        }
        if (items.length > 0) {
          items[items.length - 1].extraBlocks.push(
            `<blockquote>${this.processBlocks(bqLines.join('\n'))}</blockquote>`);
        }
        continue;
      }

      // ── task list item ──
      const taskMatch = stripped.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        const checked = taskMatch[1].toLowerCase() === 'x';
        items.push({
          type: 'task', indent: this.getListIndent(line),
          content: this.renderInline(taskMatch[2]), extraBlocks: [], checked,
        });
        i++;
        continue;
      }

      // ── unordered list item ──
      const ulMatch = stripped.match(/^[-*+]\s+(.*)$/);
      if (ulMatch) {
        items.push({
          type: 'ul', indent: this.getListIndent(line),
          content: this.renderInline(ulMatch[1]), extraBlocks: [],
        });
        i++;
        continue;
      }

      // ── ordered list item ──
      const olMatch = stripped.match(/^(\d+)\.\s+(.*)$/);
      if (olMatch) {
        items.push({
          type: 'ol', indent: this.getListIndent(line),
          content: this.renderInline(olMatch[2]), extraBlocks: [],
          orderNum: parseInt(olMatch[1]),
        });
        i++;
        continue;
      }

      // ── indented non-list content (paragraph continuation for last item) ──
      if (trimmed !== '' && line.match(/^\s{4,}/)) {
        const contLines: string[] = [];
        while (i < lines.length) {
          const cl = lines[i];
          const ct = cl.trimEnd();
          const cs = ct.replace(/^\s+/, '');
          if (ct === '') { i++; break; }
          // if it's a list item, code block, table, or blockquote, break out
          if (this.isListLine(cs) || cs.startsWith('```') || cs.startsWith('|') || cs.startsWith('>')) break;
          contLines.push(ct);
          i++;
        }
        if (contLines.length > 0 && items.length > 0) {
          items[items.length - 1].extraBlocks.push(
            `<p>${this.renderInline(contLines.join('\n'))}</p>`);
        }
        continue;
      }

      // ── non-list, non-embedded line → end of list ──
      break;
    }

    return { html: this.buildListHtml(items), endIdx: i };
  }

  private getListIndent(line: string): number {
    const spaces = line.match(/^(\s*)/)?.[1].length || 0;
    return Math.floor(spaces / 4);
  }

  private isListLine(trimmed: string): boolean {
    // stripped = content after removing leading whitespace (for indent detection)
    const stripped = trimmed.replace(/^\s+/, '');
    return !!stripped.match(/^[-*+]\s/) || !!stripped.match(/^\d+\.\s/) ||
           !!stripped.match(/^[-*+]\s+\[[ xX]\]/);
  }

  // Check if a line (with leading whitespace preserved) is a list item at any indent
  private isListLineContent(trimmed: string): boolean {
    return this.isListLine(trimmed);
  }

  private isListOrEmbedded(trimmed: string): boolean {
    return this.isListLine(trimmed) ||
           trimmed.replace(/^\s+/, '').startsWith('```') ||
           trimmed.startsWith('|') ||
           trimmed.startsWith('>');
  }

  private isBlockStart(trimmed: string): boolean {
    return !!trimmed.match(/^#{1,6}\s/) ||
           trimmed.startsWith('>') ||
           trimmed.startsWith('|') ||
           trimmed.startsWith('```') ||
           trimmed.startsWith('$$') ||
           !!trimmed.match(/^[-*_]{3,}$/) ||
           this.isListLine(trimmed);
  }

  // ── Build nested list HTML ──────────────────────────────────────

  private buildListHtml(items: ListItem[]): string {
    if (items.length === 0) return '';

    const html: string[] = [];
    const rootType = items[0].type;
    const isTaskList = items[0].type === 'task';
    html.push(rootType === 'ol' ? '<ol>' : (isTaskList ? '<ul class="task-list">' : '<ul>'));

    let idx = 0;
    while (idx < items.length) {
      const item = items[idx];

      if (item.type === 'task') {
        const checkbox = item.checked
          ? '<input type="checkbox" checked disabled>'
          : '<input type="checkbox" disabled>';
        html.push(`<li>${checkbox}${item.content}`);
      } else {
        html.push(`<li>${item.content}`);
      }

      // append extra blocks (code, table, quote, paragraph)
      for (const block of item.extraBlocks) {
        html.push(block);
      }

      // check for nested sub-items
      const nextIdx = idx + 1;
      if (nextIdx < items.length && items[nextIdx].indent > item.indent) {
        // collect all items at deeper indent level (direct children)
        const subItems: ListItem[] = [];
        let j = nextIdx;
        const childIndent = items[j].indent;
        while (j < items.length) {
          if (items[j].indent >= childIndent) {
            // items at same or deeper child level belong to this sub-list
            // BUT items at the same indent as parent are siblings, not children
            if (items[j].indent > item.indent) {
              subItems.push(items[j]);
              j++;
            } else {
              break;
            }
          } else {
            break;
          }
        }
        html.push(this.buildListHtml(subItems));
        idx = j - 1;
      }

      html.push('</li>');
      idx++;
    }

    html.push(rootType === 'ol' ? '</ol>' : '</ul>');
    return html.join('\n');
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Document wrapper ────────────────────────────────────────────

  private wrapDocument(bodyHtml: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Markdown Rendered Document</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
${this.getTyporaCSS()}
</style>
</head>
<body>
<div class="typora-content">
${bodyHtml}
</div>
<script>
document.addEventListener('DOMContentLoaded', function() {
  renderMathInElement(document.body, {
    delimiters: [
      {left: '$$', right: '$$', display: true},
      {left: '$', right: '$', display: false}
    ],
    throwOnError: false
  });
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
});
</script>
</body>
</html>`;
  }

  private getTyporaCSS(): string {
    return `
.typora-content {
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 60px;
  color: #333;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 16px;
  line-height: 1.8;
  -webkit-font-smoothing: antialiased;
}

.typora-content h1 {
  font-size: 2em; font-weight: 700; margin: 2em 0 1em;
  padding-bottom: 0.3em; border-bottom: 2px solid #eaecef; color: #1a1a1a;
}
.typora-content h2 {
  font-size: 1.5em; font-weight: 600; margin: 1.5em 0 0.8em;
  padding-bottom: 0.2em; border-bottom: 1px solid #eaecef; color: #2c2c2c;
}
.typora-content h3 { font-size: 1.25em; font-weight: 600; margin: 1.2em 0 0.6em; color: #3c3c3c; }
.typora-content h4 { font-size: 1.1em; font-weight: 600; margin: 1em 0 0.5em; color: #444; }
.typora-content h5 { font-size: 1em; font-weight: 600; margin: 0.8em 0 0.4em; }
.typora-content h6 { font-size: 0.9em; font-weight: 600; margin: 0.7em 0 0.3em; color: #666; }

.typora-content p { margin: 0 0 1em; }
.typora-content strong { font-weight: 700; color: #1a1a1a; }
.typora-content em { font-style: italic; }
.typora-content mark { background: #fff3cd; padding: 2px 4px; border-radius: 2px; }
.typora-content del { color: #999; text-decoration: line-through; }
.typora-content u { text-decoration: underline; text-underline-offset: 2px; }

.typora-content a {
  color: #4183c4; text-decoration: none;
  border-bottom: 1px solid transparent; transition: border-color 0.2s;
}
.typora-content a:hover { border-bottom-color: #4183c4; }

.typora-content img { max-width: 100%; border-radius: 4px; margin: 0.5em 0; }

.typora-content code {
  background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 3px;
  padding: 2px 6px; font-size: 0.9em;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  color: #e83e8c;
}
.typora-content .code-block {
  background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px;
  margin: 1em 0; overflow-x: auto;
}
.typora-content .code-block .code-lang {
  display: block; padding: 4px 12px; font-size: 0.8em; color: #666;
  background: #f0f0f0; border-bottom: 1px solid #e0e0e0;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.typora-content .code-block pre { margin: 0; padding: 16px; background: transparent; }
.typora-content .code-block code {
  background: transparent; border: none; padding: 0;
  color: #333; font-size: 0.9em; line-height: 1.6;
}

.typora-content .math-block { text-align: center; margin: 1.5em 0; overflow-x: auto; }
.typora-content .math-inline { }

.typora-content blockquote {
  border-left: 4px solid #dfe2e5; padding: 0.5em 1em;
  margin: 1em 0; color: #666; background: #f9f9f9;
  border-radius: 0 4px 4px 0;
}
.typora-content blockquote blockquote { margin: 0.5em 0; border-left-color: #ccc; }

.typora-content ul, .typora-content ol { margin: 0.5em 0 1em; padding-left: 2em; }
.typora-content li { margin: 0.25em 0; }
.typora-content li > ul, .typora-content li > ol { margin: 0.2em 0; }
.typora-content .task-list { list-style: none; padding-left: 0; }
.typora-content .task-list li input[type="checkbox"] {
  margin-right: 6px; vertical-align: middle; accent-color: #4183c4;
}

.typora-content table {
  width: 100%; border-collapse: collapse; margin: 1em 0;
  font-size: 0.95em; overflow-x: auto; display: block;
}
.typora-content th, .typora-content td { border: 1px solid #dfe2e5; padding: 8px 12px; }
.typora-content th { background: #f6f8fa; font-weight: 600; color: #1a1a1a; }
.typora-content tr:nth-child(even) { background: #f9f9f9; }
.typora-content tr:hover { background: #f0f4f8; }

.typora-content hr {
  border: none; height: 2px;
  background: linear-gradient(to right, transparent, #d0d0d0, transparent);
  margin: 2em 0;
}

.typora-content dt { font-weight: 700; margin-top: 0.8em; }
.typora-content dd { margin-left: 1.5em; color: #555; margin-bottom: 0.3em; }

.typora-content .footnotes { font-size: 0.85em; color: #666; margin-top: 2em; }
.typora-content .footnote-ref a { color: #4183c4; text-decoration: none; }
.typora-content .footnote-backref { color: #4183c4; font-size: 0.8em; }

.typora-content .mermaid { margin: 1em 0; text-align: center; }

@media (max-width: 768px) { .typora-content { padding: 20px 24px; }
`;
  }
}

// ── CLI entry point ────────────────────────────────────────────────

const isMain = process.argv[1]?.replace(/\.ts$/, '').endsWith('md2html');
if (isMain) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath) {
    console.error('Usage: npx tsx src/md2html.ts <input.md> [output.html]');
    process.exit(1);
  }
  const md = readFileSync(resolve(inputPath), 'utf-8');
  const renderer = new TyporaMarkdownRenderer();
  const html = renderer.render(md);
  if (outputPath) {
    writeFileSync(resolve(outputPath), html, 'utf-8');
    console.log(`Written to ${outputPath}`);
  } else {
    console.log(html);
  }
}