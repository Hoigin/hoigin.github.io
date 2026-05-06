/**
 * build_index.ts — 博客文章列表构建脚本
 *
 * 功能：扫描 ./posts/ 下的日期子目录，从每个 post.html 中提取标题，
 *       生成 HTML 列表片段替换 index_template.html 中的 {{POST_LIST}}，
 *       输出最终的 index.html。
 *
 * 运行方式：npx tsx src/build_index.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'posts');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'index_template.html');
const OUTPUT_FILE = path.join(ROOT_DIR, 'index.html');

/**
 * 从 post.html 中提取文章标题。
 * 依次尝试 <title> 和 <h1>，若均不存在则返回目录名。
 */
function extractTitle(htmlContent: string, fallbackName: string): string {
    const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1].trim()) {
        return titleMatch[1].trim();
    }
    const h1Match = htmlContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match && h1Match[1].trim()) {
        return h1Match[1].trim();
    }
    return fallbackName;
}

/**
 * 将日期目录名格式化为可读日期，如 "20260506" → "2026-05-06"。
 */
function formatDate(dirName: string): string {
    if (dirName.length === 8 && /^\d{8}$/.test(dirName)) {
        return `${dirName.slice(0, 4)}-${dirName.slice(4, 6)}-${dirName.slice(6, 8)}`;
    }
    return dirName;
}

/**
 * 扫描 posts 目录，按日期倒序收集文章信息。
 */
function scanPosts(): Array<{ title: string; date: string; dateDir: string; link: string }> {
    if (!fs.existsSync(POSTS_DIR)) {
        console.warn('posts 目录不存在，跳过文章列表生成。');
        return [];
    }

    const posts: Array<{ title: string; date: string; dateDir: string; link: string }> = [];

    for (const entry of fs.readdirSync(POSTS_DIR)) {
        const entryPath = path.join(POSTS_DIR, entry);
        if (!fs.statSync(entryPath).isDirectory()) continue;

        const postFilePath = path.join(entryPath, 'post.html');
        if (!fs.existsSync(postFilePath)) {
            console.warn(`目录 ${entry} 中未找到 post.html，跳过。`);
            continue;
        }

        const title = extractTitle(fs.readFileSync(postFilePath, 'utf-8'), entry);
        const relativeLink = path.join('posts', entry, 'post.html').split(path.sep).join('/');

        posts.push({
            title,
            date: formatDate(entry),
            dateDir: entry,
            link: `./${relativeLink}`,
        });
    }

    posts.sort((a, b) => b.dateDir.localeCompare(a.dateDir));
    return posts;
}

/**
 * 生成文章列表 HTML 片段。
 * 格式：<a> 标签内标题左、日期右，日期用灰色小字。
 */
function generateListHTML(posts: Array<{ title: string; date: string; link: string }>, indent: string): string {
    if (posts.length === 0) {
        return `${indent}<p class="no-posts">暂无文章。</p>`;
    }

    return posts
        .map(post =>
            `${indent}<a class="post-item" href="${post.link}">` +
            `\n${indent}    <span class="post-title">${post.title}</span>` +
            `\n${indent}    <span class="post-date">${post.date}</span>` +
            `\n${indent}</a>`
        )
        .join('\n');
}

/**
 * 从模板中提取 {{POST_LIST}} 所在行的缩进（前导空格），
 * 确保生成的 HTML 与模板格式对齐。
 */
function getPlaceholderIndent(templateContent: string): string {
    const match = templateContent.match(/^(\s*){{POST_LIST}}/m);
    return match ? match[1] : '';
}

/**
 * 读取模板文件，替换 {{POST_LIST}} 占位符，输出到 index.html。
 */
function build(): void {
    if (!fs.existsSync(TEMPLATE_FILE)) {
        console.error('index_template.html 不存在，无法构建。');
        process.exit(1);
    }

    const posts = scanPosts();
    const templateContent = fs.readFileSync(TEMPLATE_FILE, 'utf-8');
    const indent = getPlaceholderIndent(templateContent);
    const listHTML = generateListHTML(posts, indent);
    // 替换整行（包括前导缩进），从新行开始写入列表内容
    const outputContent = templateContent.replace(/^\s*{{POST_LIST}}/m, listHTML);

    fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');
    console.log(`构建完成：${posts.length} 篇文章已写入 index.html。`);
}

build();