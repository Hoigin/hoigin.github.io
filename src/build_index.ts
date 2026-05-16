/**
 * build_index.ts — 博客文章列表构建脚本
 *
 * 功能：扫描 ./posts/ 下的日期子目录，读取每个目录中的 meta.yaml 元数据，
 *       生成 HTML 列表片段替换 index_template.html 中的 {{POST_LIST}}，
 *       输出最终的 index.html。
 *
 * 运行方式：npx tsx src/build_index.ts
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'posts');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'index_template.html');
const OUTPUT_FILE = path.join(ROOT_DIR, 'index.html');

interface PostMeta {
    title: string;
    date: string;
    github?: string;
    tags?: string[];
}

/**
 * 扫描 posts 目录，读取每个子目录中的 meta.yaml，按日期倒序收集文章信息。
 */
function scanPosts(): Array<{ title: string; date: string; link: string }> {
    if (!fs.existsSync(POSTS_DIR)) {
        console.warn('posts 目录不存在，跳过文章列表生成。');
        return [];
    }

    const posts: Array<{ title: string; date: string; link: string }> = [];

    for (const entry of fs.readdirSync(POSTS_DIR)) {
        const entryPath = path.join(POSTS_DIR, entry);
        if (!fs.statSync(entryPath).isDirectory()) continue;

        const metaFile = path.join(entryPath, 'meta.yaml');
        if (!fs.existsSync(metaFile)) {
            console.warn(`目录 ${entry} 下缺少 meta.yaml，跳过。`);
            continue;
        }

        const meta = yaml.load(fs.readFileSync(metaFile, 'utf-8')) as PostMeta;

        if (!meta.title) {
            console.warn(`meta.yaml (${entry}): 缺少 title 字段，跳过。`);
            continue;
        }
        if (!meta.date) {
            console.warn(`meta.yaml (${entry}): 缺少 date 字段，跳过。`);
            continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
            console.warn(`meta.yaml (${entry}): date 格式应为 YYYY-MM-DD — "${meta.date}"，跳过。`);
            continue;
        }

        // 查找目录下的 .html 文件作为文章链接
        const htmlFiles = fs.readdirSync(entryPath)
            .filter(f => f.endsWith('.html') && fs.statSync(path.join(entryPath, f)).isFile());

        if (htmlFiles.length === 0) {
            console.warn(`目录 ${entry} 下没有 .html 文件，跳过。`);
            continue;
        }

        // 一个目录下可能有多个 .html 文件，每个都生成一条文章条目
        // 如果只有一个 .html 文件，则用 meta.yaml 的标题和日期
        // 如果有多个，则用同一个 meta 的标题和日期，链接指向各自的 .html
        for (const htmlFile of htmlFiles) {
            const relativeLink = path.join('posts', entry, htmlFile).split(path.sep).join('/');
            posts.push({
                title: meta.title,
                date: meta.date,
                link: `./${relativeLink}`,
            });
        }
    }

    posts.sort((a, b) => b.date.localeCompare(a.date));

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
            `\n${indent}    <span class="post-icon">📄</span>` +
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
    const outputContent = templateContent.replace(/^\s*{{POST_LIST}}/m, listHTML);

    fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');
    console.log(`构建完成：${posts.length} 篇文章已写入 index.html。`);
}

build();