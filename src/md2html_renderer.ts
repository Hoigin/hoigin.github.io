/**
 * md2html_renderer.ts — Markdown 转 HTML 渲染模块
 *
 * 功能：基于 markdown-it + highlight.js + markdown-it-emoji 将 Markdown 文件
 *       渲染为 HTML，使用 post_template.html 模板包裹输出，写入同目录（同名覆盖）。
 *       代码块自带语言标签和行号，无需额外插件。
 *
 * 运行方式：npx tsx src/md2html_renderer.ts <input.md>
 *
 * 导出：renderMarkdown(filePath) — 可供其他模块调用
 */

import markdownit from 'markdown-it';
import hljs from 'highlight.js';
import { full as emoji } from 'markdown-it-emoji';
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
}).use(emoji);

// ── 自定义 fence 渲染器 ──────────────────────────────────────────
// 覆盖默认渲染，使用双列布局（行号列 + 代码列）避免跨行 span 被截断

md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0];
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

    // 行号列宽度：数字宽度 + padding(1em) + 小margin(0.2em)
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
 * 模板中的 {{TITLE}} 和 {{CONTENT}} 占位符会被替换。
 * 渲染后的 HTML 会去除多余空行并添加缩进，<pre> 内容不受影响。
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

    const htmlContent = md.render(mdContent);
    const formattedContent = formatHtml(htmlContent);

    const template = fs.readFileSync(path.join(ROOT_DIR, 'post_template.html'), 'utf-8');
    const fullHtml = template
        .replace('{{TITLE}}', title)
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