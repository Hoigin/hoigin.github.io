/**
 * md2html_renderer.ts — Markdown 转 HTML 渲染模块
 *
 * 功能：基于 markdown-it + markdown-it-mathjax3-pro + highlight.js + markdown-it-emoji
 *       将 Markdown 文件渲染为 HTML，使用 post_template.html 模板包裹输出，写入同目录（同名覆盖）。
 *       数学公式由 MathJax 服务端预渲染为 CSS，代码块由 highlight.js 服务端语法高亮，
 *       Mermaid 图表输出为 <div class="mermaid"> 由客户端 mermaid.js 按当前主题渲染，
 *       主题切换时 Mermaid 会重新渲染以适配新主题，
 *       GitHub Alert 支持嵌套结构，==高亮== 由 markdown-it-mark 处理。
 *
 * 运行方式：npx tsx src/md2html_renderer.ts <input.md>
 *
 * 导出：renderMarkdown(filePath) — 可供其他模块调用
 */

import markdownit from 'markdown-it';
import mathjax from 'markdown-it-mathjax3-pro'
import hljs from 'highlight.js';
import mark from 'markdown-it-mark';
import { full as emoji } from 'markdown-it-emoji';
import alerts from 'markdown-it-github-alerts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ── markdown-it 实例 ─────────────────────────────────────────────

const md = markdownit({
    html: true,
    linkify: true,
    typographer: true
}).use(mathjax).use(mark).use(emoji).use(alerts);

// ── 替换 github-alerts 核心规则，支持嵌套 ────────────────────
// 1. nesting 计数器正确匹配 blockquote_open/close 对
// 2. [!TYPE] 是段落唯一内容时隐藏该段落
// 3. alert 内的空 inline token 填入空格防止塌缩
// 4. 扫描源码找回 markdown-it 丢失的带空格空行，在对应位置插入 <p>&nbsp;</p>

const ALERT_RE = /^\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]([^\n\r]*)/i;

/** 源码行最后一个 > 之后仅有空白且非空 → 带空格的空行 */
function isSpacedEmptyLine(srcLines: string[], lineIdx: number): boolean {
    const line = srcLines[lineIdx];
    const lastGt = line.lastIndexOf('>');
    if (lastGt < 0) return false;
    const after = line.slice(lastGt + 1);
    return after.trim() === '' && after.length > 0;
}

md.core.ruler.at('github-alerts', (state) => {
    const tokens = state.tokens;
    const srcLines = state.src.split('\n');

    // 收集所有 alert 范围，从内到外处理以避免 splice 影响外层索引
    const ranges: { openIdx: number; closeIdx: number; firstContentIdx: number; match: RegExpMatchArray; level: number }[] = [];

    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'blockquote_open') continue;
        let nesting = 1;
        let j = i + 1;
        while (j < tokens.length && nesting > 0) {
            if (tokens[j].type === 'blockquote_open') nesting++;
            else if (tokens[j].type === 'blockquote_close') nesting--;
            j++;
        }
        const fcIdx = tokens.findIndex((t, k) => k > i && k < j && t.type === 'inline');
        if (fcIdx < 0) continue;
        const match = tokens[fcIdx].content.match(ALERT_RE);
        if (!match) continue;
        ranges.push({ openIdx: i, closeIdx: j - 1, firstContentIdx: fcIdx, match, level: tokens[i].level });
    }

    ranges.sort((a, b) => b.closeIdx - a.closeIdx);

    for (const { openIdx, closeIdx, firstContentIdx, match, level } of ranges) {
        const type = match[1].toLowerCase();
        const title = match[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
        const icon = DEFAULT_ALERT_ICONS[type] ?? '';
        const firstContent = tokens[firstContentIdx];

        // 剥离 [!TYPE]，若段落只剩标题则隐藏
        firstContent.content = firstContent.content.slice(match[0].length).trimStart();
        if (!firstContent.content) {
            firstContent.children = [];
            firstContent.hidden = true;
            if (tokens[firstContentIdx - 1].type === 'paragraph_open') tokens[firstContentIdx - 1].hidden = true;
            if (tokens[firstContentIdx + 1].type === 'paragraph_close') tokens[firstContentIdx + 1].hidden = true;
        }

        tokens[openIdx].type = 'alert_open';
        tokens[openIdx].tag = 'div';
        tokens[openIdx].meta = { title, type, icon };
        tokens[closeIdx].type = 'alert_close';
        tokens[closeIdx].tag = 'div';

        // alert 内的空 inline token 填入（非嵌套场景下的空行）
        for (let k = openIdx + 1; k < closeIdx; k++) {
            if (tokens[k].type !== 'inline' || tokens[k].content.trim() || tokens[k].hidden) continue;
            tokens[k].content = ' ';
            tokens[k].children = [];
        }

        // 扫描源码找回嵌套 blockquote 丢失的带空格行
        const open = tokens[openIdx];
        if (!open.map) continue;
        const [startLine, endLine] = open.map;
        const targetGtCount = level + 1;

        const spacedSourceLines: number[] = [];
        for (let lineIdx = startLine; lineIdx < endLine; lineIdx++) {
            const line = srcLines[lineIdx];
            if ((line.match(/>/g) || []).length !== targetGtCount) continue;
            if (!isSpacedEmptyLine(srcLines, lineIdx)) continue;
            spacedSourceLines.push(lineIdx);
        }

        // 先计算所有插入位置，再从高到低 splice 避免索引偏移
        const insertPositions: number[] = [];
        for (const spacedLine of spacedSourceLines) {
            // 按 map[0] 定位：插入到空格行之后第一个 token 之前
            let insertPos = closeIdx;
            for (let k = openIdx + 1; k < closeIdx; k++) {
                const m = tokens[k].map;
                if (m && m[0] > spacedLine) { insertPos = k; break; }
            }
            insertPositions.push(insertPos);
        }

        insertPositions.sort((a, b) => b - a);
        for (const insertPos of insertPositions) {

            const nbspace = new state.Token('inline', '', 0);
            nbspace.content = ' ';
            nbspace.children = [];
            const pOpen = new state.Token('paragraph_open', 'p', 1);
            const pClose = new state.Token('paragraph_close', 'p', -1);
            tokens.splice(insertPos, 0, pOpen, nbspace, pClose);
        }
    }
});

const DEFAULT_ALERT_ICONS: Record<string, string> = {
    note: '<svg class="octicon octicon-info" viewBox="0 0 16 16" width="16" height="16"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    tip: '<svg class="octicon octicon-light-bulb" viewBox="0 0 16 16" width="16" height="16"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
    important: '<svg class="octicon octicon-report" viewBox="0 0 16 16" width="16" height="16"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    warning: '<svg class="octicon octicon-alert" viewBox="0 0 16 16" width="16" height="16"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    caution: '<svg class="octicon octicon-stop" viewBox="0 0 16 16" width="16" height="16"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>'
};

// ── 处理普通引用中的带空格空行 ──────────────────────
// 源码中 > 后仅跟空白（非空）时，markdown-it 可能丢弃内容，
// 导致空引用（无段落）或空段落（不可见）。
// 此规则在对应位置填入或插入不可折断空格使其可见，
// 与 GitHub Alert 中带空格空行的渲染逻辑一致。

md.core.ruler.push('blockquote-spaced-lines', (state) => {
    const tokens = state.tokens;
    const srcLines = state.src.split('\n');

    // 收集需要插入的位置：从内到外处理以避免 splice 影响外层索引
    const inserts: { blockIdx: number; lineIdx: number; closeIdx: number; hasInline: boolean; inlineIdx: number }[] = [];

    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'blockquote_open') continue;

        let nesting = 1;
        let j = i + 1;
        while (j < tokens.length && nesting > 0) {
            if (tokens[j].type === 'blockquote_open') nesting++;
            else if (tokens[j].type === 'blockquote_close') nesting--;
            j++;
        }

        const closeIdx = j - 1;
        const open = tokens[i];
        if (!open.map) continue;

        const [startLine, endLine] = open.map;
        const level = open.level;
        const targetGtCount = level + 1;

        for (let lineIdx = startLine; lineIdx < endLine; lineIdx++) {
            const line = srcLines[lineIdx];
            if ((line.match(/>/g) || []).length !== targetGtCount) continue;
            if (!isSpacedEmptyLine(srcLines, lineIdx)) continue;

            // 查找对应位置的空 inline token
            let hasInline = false;
            let inlineIdx = -1;
            for (let k = i + 1; k < closeIdx; k++) {
                if (tokens[k].type !== 'inline' || tokens[k].content.trim() || tokens[k].hidden) continue;
                const prev = tokens[k - 1];
                if (prev?.type === 'paragraph_open' && prev.map && prev.map[0] === lineIdx) {
                    hasInline = true;
                    inlineIdx = k;
                    break;
                }
            }

            inserts.push({ blockIdx: i, lineIdx, closeIdx, hasInline, inlineIdx });
        }
    }

    // 从内到外处理（closeIdx 降序），避免 splice 累积偏移
    inserts.sort((a, b) => b.closeIdx - a.closeIdx);

    // 先处理 hasInline（直接修改 token，不 splice）
    for (const { hasInline, inlineIdx } of inserts) {
        if (!hasInline) continue;
        const textToken = new state.Token('text', '', 0);
        textToken.content = ' ';
        tokens[inlineIdx].children = [textToken];
        tokens[inlineIdx].content = ' ';
    }

    // 计算 splice 位置，从高到低处理避免索引偏移
    const spliceInserts: { blockIdx: number; lineIdx: number; insertPos: number }[] = [];
    for (const { blockIdx, lineIdx, closeIdx, hasInline } of inserts) {
        if (hasInline) continue;
        let insertPos = closeIdx;
        for (let k = blockIdx + 1; k < closeIdx; k++) {
            const m = tokens[k].map;
            if (m && m[0] > lineIdx) { insertPos = k; break; }
        }
        spliceInserts.push({ blockIdx, lineIdx, insertPos });
    }
    spliceInserts.sort((a, b) => b.insertPos - a.insertPos);

    for (const { lineIdx, insertPos } of spliceInserts) {
        const nbspace = new state.Token('inline', '', 0);
        nbspace.content = ' ';
        const textChild = new state.Token('text', '', 0);
        textChild.content = ' ';
        nbspace.children = [textChild];
        const pOpen = new state.Token('paragraph_open', 'p', 1);
        pOpen.map = [lineIdx, lineIdx + 1];
        const pClose = new state.Token('paragraph_close', 'p', -1);
        tokens.splice(insertPos, 0, pOpen, nbspace, pClose);
    }
});

// ── 自定义表格单元格渲染器（将 align 属性转为 style） ──────────────
// markdown-it 默认输出 align="center" 等 HTML5 废弃属性，
// 转为 style="text-align:..." 以确保浏览器渲染对齐效果

md.renderer.rules.td = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const alignAttr = token.attrs?.find(a => a[0] === 'align');
    const style = alignAttr ? ` style="text-align:${alignAttr[1]}"` : '';
    const content = token.children ? self.renderInline(token.children, options, env) : '';
    return `<td${style}>${content}</td>`;
};

md.renderer.rules.th = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const alignAttr = token.attrs?.find(a => a[0] === 'align');
    const style = alignAttr ? ` style="text-align:${alignAttr[1]}"` : '';
    const content = token.children ? self.renderInline(token.children, options, env) : '';
    return `<th${style}>${content}</th>`;
};

// ── 自定义 fence 渲染器 ──────────────────────────────────────────
// Mermaid 代码块输出 <div class="mermaid"> 由客户端渲染，
// 其他代码块使用双列布局（行号列 + 代码列）避免跨行 span 被截断

md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0];

    // Mermaid 图表：输出 <div class="mermaid">，由客户端 mermaid.js 渲染
    if (lang === 'mermaid') {
        return `<div class="mermaid">${md.utils.escapeHtml(token.content.trim())}</div>`;
    }

    const content = token.content;

    // 语法高亮或纯文本转义
    let highlighted: string;
    if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    } else {
        highlighted = md.utils.escapeHtml(content);
    }

    // 去除高亮输出末尾多余换行
    if (highlighted.endsWith('\n')) {
        highlighted = highlighted.slice(0, -1);
    }

    // 行号：根据原始内容的行数生成
    const lines = content.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    const lineNumbers = lines.map((_, i) => i + 1).join('\n');

    // 行号列宽度：数字宽度 + padding(1em)
    // 数字实际占 digits × 0.6em（等宽字体每字约0.6em宽）
    const digits = String(lines.length).length;
    const linenoWidth = Math.round((digits * 0.6 + 1.0) * 100) / 100;

    // 语言标签（无语言时不显示）
    const langLabel = lang ? `<span class="post-code-lang">${lang}</span>` : '';

    // 代码块 HTML：结构标签用 \n 分隔，缩进由 formatHtml() 后处理统一添加
    // <pre> 内的换行是内容换行（white-space:pre），formatHtml 会识别并跳过
    return `<div class="post-code-block">\n${langLabel}\n<div class="post-code-content" style="grid-template-columns:${linenoWidth}em 1fr">\n<pre class="post-code-line-numbers">${lineNumbers}</pre>\n<pre><code class="hljs">${highlighted}</code></pre>\n</div>\n</div>`;
};

// ── HTML 格式化 ────────────────────────────────────────────────────
// 去除多余空行，在块级标签边界强制拆行，按嵌套深度添加缩进
// <pre> 内容不受影响（缩进会破坏 white-space:pre 渲染）

// 块级开标签（需独占一行并增加缩进）
const BLOCK_OPEN_RE = /^<(div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary|dl|dt|dd|hr|br)[\s>]/i;
// 块级闭标签（需独占一行并减少缩进）
const BLOCK_CLOSE_RE = /^<\/(div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary|dl|dt|dd)>/i;

function formatHtml(html: string): string {
    // 去除连续空行（仅对 <pre> 外的内容生效，<pre> 内的空行是代码语义必须保留）
    // 先用占位符保护 <pre> 内容，压缩后再还原
    const preBlocks: string[] = [];
    html = html.replace(/<pre[\s>][^]*?<\/pre>/gi, (match) => {
        preBlocks.push(match);
        return `\x00PRE${preBlocks.length - 1}\x00`;
    });
    html = html.replace(/\n{2,}/g, '\n');
    html = html.replace(/\x00PRE(\d+)\x00/g, (_, idx) => preBlocks[Number(idx)]);

    // 在块级闭标签边界强制拆行：闭标签后紧跟任何块级标签（开或闭）时，插入 \n
    // 例如 </div><p> → </div>\n<p>，</div></li> → </div>\n</li>
    // 注意：正则有3个捕获组，$1=闭标签完整串，$2=标签名，$3=开/闭标签起始部分
    const blockTagNames = 'div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary|dl|dt|dd';
    html = html.replace(
        new RegExp(`(<\\/(${blockTagNames})>)(<\\/?(?:${blockTagNames}|hr|br)[\\s>])`, 'gi'),
        '$1\n$3'
    );

    // 按行处理：内容在 <body> 内，初始深度为 1（4 格缩进）
    const result: string[] = [];
    let inPre = false;
    let depth = 1;
    let preIndentDepth = 0; // <pre> 内容行的缩进层级，用于 HTML 源码可读性

    for (const line of html.split('\n')) {
        // <pre> 内：保留原始空白（代码的语义缩进不能 trim）
        // 加上 preIndentDepth 层缩进使 HTML 源码整洁，JS 会在页面加载时剥离这些缩进
        if (inPre) {
            result.push('    '.repeat(preIndentDepth) + line);
            if (line.includes('</pre')) {
                inPre = false;
            }
            continue;
        }

        const trimmed = line.trim();
        if (trimmed === '') continue;

        // 计算缩进：闭标签行用 depth-1，开标签行用 depth，混合行用 depth
        const isCloseOnly = BLOCK_CLOSE_RE.test(trimmed) && !BLOCK_OPEN_RE.test(trimmed);
        const indent = isCloseOnly ? depth - 1 : depth;
        result.push('    '.repeat(Math.max(0, indent)) + trimmed);

        // 检测此行是否进入 <pre>
        if (trimmed.includes('<pre')) {
            inPre = true;
            // <pre> 内容比 <pre> 标签深一层，data-indent 记录层数供 JS 剥离
            preIndentDepth = indent + 1;
            result[result.length - 1] = result[result.length - 1].replace(
                /<pre(\s[^>]*)?>/,
                (_match, attrs) => attrs ? `<pre${attrs} data-indent="${preIndentDepth}">` : `<pre data-indent="${preIndentDepth}">`
            );
        }

        // 更新深度
        depth += countBlockOpens(trimmed) - countBlockCloses(trimmed);
        if (depth < 0) depth = 0;
    }

    return result.join('\n');
}

function countBlockOpens(line: string): number {
    let count = 0;
    const re = /<(div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary|dl|dt|dd)[\s>]/gi;
    while (re.exec(line) !== null) count++;
    return count;
}

function countBlockCloses(line: string): number {
    let count = 0;
    const re = /<\/(div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary|dl|dt|dd)>/gi;
    while (re.exec(line) !== null) count++;
    return count;
}

// ── 主函数 ────────────────────────────────────────────────────────

/**
 * 将 Markdown 文件渲染为 HTML 并写入同目录。
 * 模板中的 {{TITLE}}、{{CONTENT}}、{{MATHJAX_CSS}}、{{MERMAID_SCRIPT}} 占位符会被替换。
 * 渲染后的 HTML 会去除多余空行并添加缩进，<pre> 内容不受影响。
 * Mermaid 脚本仅在页面包含 mermaid 图表时注入，由客户端动态加载并按当前主题渲染；
 * 主题切换时客户端还原原始源码并调用 mermaid.run() 重新渲染以适配新主题。
 *
 * @param filePath - Markdown 文件的路径（相对或绝对均可）
 * @returns 输出 HTML 文件的绝对路径
 */
export function renderMarkdown(filePath: string): string {
    const absolutePath = path.resolve(filePath);
    const mdContent = fs.readFileSync(absolutePath, 'utf-8');

    // 从首个 # 标题行提取文章标题
    const titleMatch = mdContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

    const env: Record<string, any> = {};
    const htmlContent = md.render(mdContent, env);

    // Typora 下载的网络图片保存为 URL 编码文件名（如 https%3A%2F%2F...webp），
    // 但浏览器解码 src 中的 %3A → :、%2F → /，把本地路径变成远程 URL 导致图片无法加载。
    // 将 <img src> 中的 % 二次编码为 %25，浏览器解码一层后仍为 %3A%2F，匹配磁盘文件名。
    // 本地图片路径不含 % 字符，不受此逻辑影响。
    const fixedContent = htmlContent.replace(
        /<img\s[^>]*src="([^"]*)"[^>]*>/g,
        (match, src) => {
            if (!src.includes('%')) return match;
            const fixedSrc = src.replace(/%/g, '%25');
            return match.replace(src, fixedSrc);
        }
    );

    const formattedContent = formatHtml(fixedContent);

    // 提取 MathJax 构建时生成的 CSS 样式表（隐藏 assistive-mml 等）
    // 构建完整的 <style> 标签，CSS 内容缩进 8 格与 <head> 层级对齐
    const cssLines = (env.mathjax_stylesheet || '')
        .split('\n').map((line: string) => line.trim() ? '        ' + line : '').join('\n');
    const mathjaxCssBlock = cssLines ? `<style id="mathjaxCss">\n${cssLines}\n    </style>` : '';

    // Mermaid 条件加载：仅当页面含 .mermaid 元素时注入脚本
    // 先保存原始源码到 data-original，再手动调用 mermaid.run() 渲染
    const hasMermaid = formattedContent.includes('class="mermaid"');
    const mermaidScript = hasMermaid ? `
    if (document.querySelector('.mermaid')) {
        document.querySelectorAll('.mermaid').forEach(el => {
            el.setAttribute('data-original', el.innerHTML);
        });
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
        s.onload = () => {
            const theme = saved === 'dark' ? 'dark' : 'default';
            mermaid.initialize({ startOnLoad: false, theme });
            mermaid.run();
        };
        document.head.appendChild(s);
    }` : '';

    const template = fs.readFileSync(path.join(ROOT_DIR, 'post_template.html'), 'utf-8');
    const fullHtml = template
        .replace('{{TITLE}}', title)
        .replace('{{MATHJAX_CSS}}', mathjaxCssBlock)
        .replace('{{MERMAID_SCRIPT}}', mermaidScript)
        .replace('{{CONTENT}}', formattedContent);

    // 输出到同目录，.md → .html，同名覆盖
    const outputPath = absolutePath.replace(/\.md$/, '.html');
    fs.writeFileSync(outputPath, fullHtml, 'utf-8');

    console.log(`渲染完成：${outputPath}`);
    return outputPath;
}

// ── CLI 入口 ─────────────────────────────────────────────────────

const isMain = process.argv[1]?.replace(/\.ts$/, '').endsWith('md2html_renderer');
if (isMain) {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('用法：npx tsx src/md2html_renderer.ts <input.md>');
        process.exit(1);
    }
    renderMarkdown(inputPath);
}