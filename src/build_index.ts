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

interface PostEntry {
    title: string;
    date: string;
    file?: string;
    github?: string;
    tags?: string[];
}

/**
 * 扫描 posts 目录，读取每个子目录中的 meta.yaml，按日期倒序收集文章信息。
 * meta.yaml 格式为数组，每条记录含 title、date、file（可选）、github（可选）、tags（可选）。
 * 单篇文章可省略 file 字段，自动匹配目录下唯一的 .html 文件。
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
            console.warn(`目录 ${entry} 下缺少 meta.yaml 文件，跳过。`);
            continue;
        }

        const entries = yaml.load(fs.readFileSync(metaFile, 'utf-8')) as PostEntry[];
        if (!Array.isArray(entries)) {
            console.warn(`meta.yaml (${entry}): 格式应为数组，跳过。`);
            continue;
        }

        // 查找目录下的所有 .html 文件
        const htmlFiles = fs.readdirSync(entryPath)
            .filter(f => f.endsWith('.html') && fs.statSync(path.join(entryPath, f)).isFile());

        for (const meta of entries) {
            if (!meta.title) {
                console.warn(`meta.yaml (${entry}): 缺少 title 字段，跳过该条目。`);
                continue;
            }
            if (!meta.date) {
                console.warn(`meta.yaml (${entry}): 缺少 date 字段，跳过该条目。`);
                continue;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
                console.warn(`meta.yaml (${entry}): date 格式应为 YYYY-MM-DD — "${meta.date}"，跳过该条目。`);
                continue;
            }

            let link: string;
            if (meta.file) {
                // 显式指定了 file 字段，直接使用
                const filePath = path.join(entryPath, meta.file);
                if (!fs.existsSync(filePath)) {
                    console.warn(`meta.yaml (${entry}): 引用的文件不存在 — ${meta.file}`);
                    continue;
                }
                link = `./posts/${entry}/${meta.file}`;
            } else if (htmlFiles.length === 1) {
                // 省略 file 字段且目录下只有一个 .html，自动匹配
                link = `./posts/${entry}/${htmlFiles[0]}`;
            } else if (htmlFiles.length > 1) {
                console.warn(`meta.yaml (${entry}): 目录下有多个 .html 文件但未指定 file 字段，跳过该条目。`);
                continue;
            } else {
                console.warn(`meta.yaml (${entry}): 目录下没有 .html 文件，跳过该条目。`);
                continue;
            }

            posts.push({ title: meta.title, date: meta.date, link });
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