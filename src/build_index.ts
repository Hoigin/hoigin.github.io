/**
 * build_index.ts — 博客文章列表构建脚本
 *
 * 功能：读取 posts.json 中的文章列表，生成 HTML 列表片段替换
 *       index_template.html 中的 {{POST_LIST}}，输出最终的 index.html。
 *
 * 运行方式：npx tsx src/build_index.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'index_template.html');
const OUTPUT_FILE = path.join(ROOT_DIR, 'index.html');

interface PostEntry {
    title: string;
    date: string;
    file: string;
    github?: string;
    tags?: string[];
}

/**
 * 读取 posts.json 并解析为文章列表。
 */
function loadPosts(): PostEntry[] {
    const postsFile = path.join(ROOT_DIR, 'posts.json');
    if (!fs.existsSync(postsFile)) {
        console.error('posts.json 不存在，无法构建。');
        process.exit(1);
    }
    const raw = fs.readFileSync(postsFile, 'utf-8');
    try {
        return JSON.parse(raw) as PostEntry[];
    } catch (e) {
        console.error('posts.json 格式错误：', e);
        process.exit(1);
    }
}

/**
 * 校验文章列表的必填字段和引用文件是否存在。
 * 仅输出警告，不终止构建（允许草稿条目）。
 */
function validatePosts(posts: PostEntry[]): void {
    for (const post of posts) {
        if (!post.title) {
            console.warn(`posts.json: 缺少 title 字段 — ${JSON.stringify(post)}`);
        }
        if (!post.date) {
            console.warn(`posts.json: 缺少 date 字段 — ${JSON.stringify(post)}`);
        }
        if (post.date && !/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
            console.warn(`posts.json: date 格式应为 YYYY-MM-DD — "${post.date}" (file: ${post.file})`);
        }
        if (!post.file) {
            console.warn(`posts.json: 缺少 file 字段 — ${JSON.stringify(post)}`);
            continue;
        }
        const filePath = path.join(ROOT_DIR, post.file);
        if (!fs.existsSync(filePath)) {
            console.warn(`posts.json: 引用的文件不存在 — ${post.file}`);
        }
    }
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

    const posts = loadPosts();
    validatePosts(posts);

    posts.sort((a, b) => b.date.localeCompare(a.date));

    const postsForHTML = posts.map(post => ({
        title: post.title,
        date: post.date,
        link: `./${post.file}`,
    }));

    const templateContent = fs.readFileSync(TEMPLATE_FILE, 'utf-8');
    const indent = getPlaceholderIndent(templateContent);
    const listHTML = generateListHTML(postsForHTML, indent);
    const outputContent = templateContent.replace(/^\s*{{POST_LIST}}/m, listHTML);

    fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');
    console.log(`构建完成：${posts.length} 篇文章已写入 index.html。`);
}

build();