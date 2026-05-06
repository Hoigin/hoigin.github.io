/**
 * build_index.ts — 博客文章列表构建脚本
 *
 * 功能：扫描 ./posts/ 下的日期子目录，从每个 post.html 中提取标题，
 *       生成 HTML 列表片段并注入到 index.html 的 #postList 容器中。
 *
 * 运行方式：npx ts-node src/build_index.ts
 *           或先编译：npx tsc src/build_index.ts --outDir dist && node dist/build_index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM 模式下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录（脚本所在目录的上一级）
const ROOT_DIR = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'posts');
const INDEX_FILE = path.join(ROOT_DIR, 'index.html');

/**
 * 从 post.html 文件中提取文章标题。
 * 依次尝试从 <title> 和 <h1> 中提取，若均不存在则返回目录名作为占位。
 */
function extractTitle(htmlContent: string, fallbackName: string): string {
    // 尝试匹配 <title> 标签内容
    const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1].trim()) {
        return titleMatch[1].trim();
    }

    // 尝试匹配 <h1> 标签内容
    const h1Match = htmlContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match && h1Match[1].trim()) {
        return h1Match[1].trim();
    }

    // 无法提取标题时，使用目录名作为占位
    return fallbackName;
}

/**
 * 将日期目录名（如 "20260506"）格式化为可读日期（如 "2026-05-06"）。
 */
function formatDate(dirName: string): string {
    if (dirName.length === 8 && /^\d{8}$/.test(dirName)) {
        return `${dirName.slice(0, 4)}-${dirName.slice(4, 6)}-${dirName.slice(6, 8)}`;
    }
    return dirName;
}

/**
 * 扫描 posts 目录，收集文章信息，按日期倒序排列。
 */
function scanPosts(): Array<{ title: string; date: string; dateDir: string; link: string }> {
    // 检查 posts 目录是否存在
    if (!fs.existsSync(POSTS_DIR)) {
        console.warn('posts 目录不存在，跳过文章列表生成。');
        return [];
    }

    const entries = fs.readdirSync(POSTS_DIR);
    const posts: Array<{ title: string; date: string; dateDir: string; link: string }> = [];

    for (const entry of entries) {
        const entryPath = path.join(POSTS_DIR, entry);
        // 只处理目录，跳过文件
        if (!fs.statSync(entryPath).isDirectory()) continue;

        const postFilePath = path.join(entryPath, 'post.html');
        // 跳过不存在 post.html 的目录
        if (!fs.existsSync(postFilePath)) {
            console.warn(`目录 ${entry} 中未找到 post.html，跳过。`);
            continue;
        }

        const htmlContent = fs.readFileSync(postFilePath, 'utf-8');
        const title = extractTitle(htmlContent, entry);

        // 使用 path.join + split 处理路径，兼容 Windows 和 Unix
        const relativeLink = path.join('posts', entry, 'post.html').split(path.sep).join('/');

        posts.push({
            title,
            date: formatDate(entry),
            dateDir: entry,
            link: `./${relativeLink}`,
        });
    }

    // 按日期倒序排列（最新文章在前）
    posts.sort((a, b) => b.dateDir.localeCompare(a.dateDir));

    return posts;
}

/**
 * 根据文章列表生成 HTML 片段。
 */
function generateListHTML(posts: Array<{ title: string; date: string; link: string }>): string {
    if (posts.length === 0) {
        return '<div class="post-list-empty">暂无文章</div>';
    }

    const header = '<div class="post-list-header">文章列表</div>';
    const items = posts
        .map(
            (post) =>
                `<a class="post-item" href="${post.link}">\n` +
                `  <div class="post-item-title">${post.title}</div>\n` +
                `  <div class="post-item-date">${post.date}</div>\n` +
                `</a>`
        )
        .join('\n');

    return header + '\n' + items;
}

/**
 * 将生成的 HTML 片段注入到 index.html 的 #postList 容器中。
 */
function injectPosts(): void {
    if (!fs.existsSync(INDEX_FILE)) {
        console.error('index.html 不存在，无法注入文章列表。');
        process.exit(1);
    }

    const posts = scanPosts();
    const listHTML = generateListHTML(posts);
    let indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');

    // 替换 #postList 容器内的占位注释
    const placeholderPattern = /(<div class="post-list" id="postList">)\s*(<!--[\s\S]*?-->)?\s*(<\/div>)/;
    const match = indexContent.match(placeholderPattern);

    if (match) {
        indexContent = indexContent.replace(
            placeholderPattern,
            `$1\n${listHTML}\n$3`
        );
    } else {
        // 未找到占位注释时，直接替换整个 postList div 的内容
        const divPattern = /<div class="post-list" id="postList">[\s\S]*?<\/div>/;
        if (divPattern.test(indexContent)) {
            indexContent = indexContent.replace(
                divPattern,
                `<div class="post-list" id="postList">\n${listHTML}\n</div>`
            );
        } else {
            console.error('未找到 #postList 容器，无法注入。');
            process.exit(1);
        }
    }

    fs.writeFileSync(INDEX_FILE, indexContent, 'utf-8');
    console.log(`成功注入 ${posts.length} 篇文章到 index.html。`);
}

// 执行构建
injectPosts();