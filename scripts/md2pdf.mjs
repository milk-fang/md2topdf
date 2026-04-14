#!/usr/bin/env node

import fs from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const katex = require('katex');
const texmath = require('markdown-it-texmath');
const DEFAULT_FORMAT = 'A4';
const SUPPORTED_FORMATS = new Set(['A4', 'Letter']);
const MIME_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);
let katexCssCache = null;

export function printUsage() {
  console.error('Usage: node scripts/md2pdf.mjs <input.md> [--output <path>] [--format A4|Letter]');
}

export function normalizeFormat(format = DEFAULT_FORMAT) {
  const normalized = String(format).trim().toLowerCase();
  if (normalized === 'a4') {
    return 'A4';
  }
  if (normalized === 'letter') {
    return 'Letter';
  }

  throw new Error(`Unsupported PDF format: ${format}. Supported formats: ${[...SUPPORTED_FORMATS].join(', ')}.`);
}

export function resolveOutputPath(inputPath, outputPath) {
  if (outputPath) {
    return path.resolve(outputPath);
  }

  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.pdf`);
}

export function parseArgs(argv) {
  const args = [...argv];
  let inputPath = '';
  let outputPath = '';
  let format = DEFAULT_FORMAT;

  while (args.length > 0) {
    const current = args.shift();
    if (!current) {
      continue;
    }

    if (current === '--help' || current === '-h') {
      return { help: true };
    }

    if (current === '--output') {
      outputPath = args.shift() ?? '';
      if (!outputPath) {
        throw new Error('Missing value for --output.');
      }
      continue;
    }

    if (current === '--format') {
      const nextFormat = args.shift();
      if (!nextFormat) {
        throw new Error('Missing value for --format.');
      }
      format = normalizeFormat(nextFormat);
      continue;
    }

    if (current.startsWith('--')) {
      throw new Error(`Unknown option: ${current}`);
    }

    if (inputPath) {
      throw new Error(`Unexpected extra argument: ${current}`);
    }

    inputPath = current;
  }

  if (!inputPath) {
    throw new Error('Missing input Markdown file path.');
  }

  const absoluteInputPath = path.resolve(inputPath);
  return {
    help: false,
    format,
    inputPath: absoluteInputPath,
    outputPath: resolveOutputPath(absoluteInputPath, outputPath)
  };
}

export function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES.get(extension);
  if (!mimeType) {
    throw new Error(`Unsupported image type for "${filePath}". Supported types: ${[...MIME_TYPES.keys()].join(', ')}`);
  }

  return mimeType;
}

export function stripQueryAndHash(source) {
  const match = /^(.*?)(?:[?#].*)?$/.exec(source);
  return match?.[1] ?? source;
}

export function isRemoteUrl(source) {
  return /^https?:\/\//i.test(source);
}

export function isDataUrl(source) {
  return /^data:/i.test(source);
}

export function resolveChromiumExecutablePath() {
  const explicitPath = process.env.MD2PDF_CHROMIUM_EXECUTABLE?.trim();
  if (explicitPath) {
    const resolvedExplicitPath = path.resolve(explicitPath);
    if (fs.existsSync(resolvedExplicitPath)) {
      return resolvedExplicitPath;
    }
  }

  const playwrightRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
    : '';
  if (!playwrightRoot || !fs.existsSync(playwrightRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(playwrightRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));

  for (const entry of candidates) {
    const executableCandidates = [
      path.join(playwrightRoot, entry.name, 'chrome-win64', 'chrome.exe'),
      path.join(playwrightRoot, entry.name, 'chrome-win', 'chrome.exe'),
      path.join(playwrightRoot, entry.name, 'chrome-linux', 'chrome'),
      path.join(playwrightRoot, entry.name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    ];

    for (const executablePath of executableCandidates) {
      if (fs.existsSync(executablePath)) {
        return executablePath;
      }
    }
  }

  return null;
}

function hasUnsupportedScheme(source) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(source) && !/^[a-zA-Z]:[\\/]/.test(source);
}

export function resolveImageFilePath(markdownFilePath, source) {
  if (!source || !source.trim()) {
    throw new Error('Encountered an image with an empty source path.');
  }

  if (isRemoteUrl(source)) {
    throw new Error(`Remote images are not supported in v1: ${source}`);
  }

  if (isDataUrl(source)) {
    return null;
  }

  if (hasUnsupportedScheme(source)) {
    throw new Error(`Unsupported image source scheme: ${source}`);
  }

  let normalizedSource = stripQueryAndHash(source.trim());
  try {
    normalizedSource = decodeURI(normalizedSource);
  } catch {
    normalizedSource = normalizedSource;
  }

  return path.resolve(path.dirname(markdownFilePath), normalizedSource);
}

export function imageFileToDataUri(imagePath) {
  const mimeType = getMimeType(imagePath);
  const fileBytes = fs.readFileSync(imagePath);
  return `data:${mimeType};base64,${fileBytes.toString('base64')}`;
}

export function inlineAssetUrls(cssSource, baseDir) {
  return cssSource.replace(/url\(([^)]+)\)/g, (fullMatch, rawTarget) => {
    const cleanedTarget = rawTarget.trim().replace(/^['"]|['"]$/g, '');
    if (!cleanedTarget || cleanedTarget.startsWith('data:') || /^https?:\/\//i.test(cleanedTarget)) {
      return fullMatch;
    }

    const assetPath = path.resolve(baseDir, stripQueryAndHash(cleanedTarget));
    if (!fs.existsSync(assetPath)) {
      return fullMatch;
    }

    return `url(${imageFileToDataUri(assetPath)})`;
  });
}

export function getKatexStyles() {
  if (katexCssCache !== null) {
    return katexCssCache;
  }

  const katexCssPath = require.resolve('katex/dist/katex.min.css');
  const katexCssSource = fs.readFileSync(katexCssPath, 'utf8');
  katexCssCache = inlineAssetUrls(katexCssSource, path.dirname(katexCssPath));
  return katexCssCache;
}

export function embedImageSource(markdownFilePath, source) {
  const resolvedPath = resolveImageFilePath(markdownFilePath, source);
  if (resolvedPath === null) {
    return source;
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Image file not found for "${source}": ${resolvedPath}`);
  }

  return imageFileToDataUri(resolvedPath);
}

export function renderMarkdownToHtml(markdownSource, markdownFilePath) {
  const renderer = new MarkdownIt({
    breaks: false,
    html: false,
    linkify: true
  });
  renderer.use(texmath, {
    delimiters: 'dollars',
    engine: katex,
    katexOptions: {
      output: 'htmlAndMathml',
      strict: 'ignore',
      throwOnError: false
    }
  });
  const defaultImageRenderer = renderer.renderer.rules.image;

  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const source = token.attrGet('src');
    if (!source) {
      throw new Error('Encountered an image token without a src attribute.');
    }

    token.attrSet('src', embedImageSource(markdownFilePath, source));

    if (typeof defaultImageRenderer === 'function') {
      return defaultImageRenderer(tokens, index, options, env, self);
    }

    return self.renderToken(tokens, index, options);
  };

  return renderer.render(markdownSource);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildHtmlDocument(markdownBody, { inputPath, format }) {
  const safeTitle = escapeHtml(path.basename(inputPath));
  const baseHref = pathToFileURL(`${path.dirname(inputPath)}${path.sep}`).href;
  const katexStyles = getKatexStyles();

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="${baseHref}">
    <title>${safeTitle}</title>
    <style>
      @page {
        size: ${format};
        margin: 18mm 15mm 18mm 15mm;
      }

      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: #1f2328;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 12pt;
        line-height: 1.65;
        word-break: break-word;
      }

      main {
        width: 100%;
      }

      h1, h2, h3, h4, h5, h6 {
        color: #0f172a;
        line-height: 1.25;
        break-after: avoid-page;
      }

      p, blockquote, ul, ol {
        margin: 0 0 1em;
      }

      code, pre {
        font-family: "Cascadia Code", "Consolas", monospace;
      }

      pre {
        margin: 1em 0;
        padding: 12px;
        overflow: auto;
        background: #f6f8fa;
        border-radius: 6px;
        white-space: pre-wrap;
        break-inside: avoid-page;
        page-break-inside: avoid;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
        break-inside: avoid-page;
        page-break-inside: avoid;
      }

      th, td {
        border: 1px solid #d0d7de;
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }

      img, svg, figure {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 1em auto;
        break-inside: avoid-page;
        page-break-inside: avoid;
      }

      hr {
        border: 0;
        border-top: 1px solid #d0d7de;
        margin: 1.5em 0;
      }

      blockquote {
        margin: 1em 0;
        padding-left: 1em;
        border-left: 4px solid #d0d7de;
        color: #57606a;
      }

      .katex-display {
        margin: 1em 0;
        overflow-x: auto;
        overflow-y: hidden;
        break-inside: avoid-page;
        page-break-inside: avoid;
      }

      .katex {
        font-size: 1.04em;
      }

      ${katexStyles}
    </style>
  </head>
  <body>
    <main>${markdownBody}</main>
  </body>
</html>`;
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    const pendingImages = Array.from(document.images).map((image) => {
      if (image.complete) {
        if (image.naturalWidth === 0) {
          throw new Error(`Image failed to render: ${image.currentSrc || image.src}`);
        }
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener(
          'error',
          () => reject(new Error(`Image failed to render: ${image.currentSrc || image.src}`)),
          { once: true }
        );
      });
    });

    await Promise.all(pendingImages);

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

async function launchBrowser() {
  const executablePath = resolveChromiumExecutablePath();
  try {
    return await chromium.launch({
      executablePath: executablePath ?? undefined,
      headless: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
      throw new Error(
        `Chromium is not available for Playwright. Set MD2PDF_CHROMIUM_EXECUTABLE to an existing browser path or run "cmd /c npx playwright install chromium".\n${message}`
      );
    }

    throw error;
  }
}

export async function convertMarkdownFileToPdf({ inputPath, outputPath, format = DEFAULT_FORMAT }) {
  const normalizedFormat = normalizeFormat(format);
  const absoluteInputPath = path.resolve(inputPath);
  const absoluteOutputPath = path.resolve(outputPath ?? resolveOutputPath(absoluteInputPath));

  let markdownSource;
  try {
    markdownSource = await readFile(absoluteInputPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read Markdown file: ${absoluteInputPath}\n${message}`);
  }

  const markdownBody = renderMarkdownToHtml(markdownSource, absoluteInputPath);
  const htmlDocument = buildHtmlDocument(markdownBody, {
    format: normalizedFormat,
    inputPath: absoluteInputPath
  });

  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(htmlDocument, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await waitForAssets(page);
    await page.pdf({
      format: normalizedFormat,
      path: absoluteOutputPath,
      preferCSSPageSize: true,
      printBackground: true
    });
  } finally {
    await browser.close();
  }

  return absoluteOutputPath;
}

export async function main(argv = process.argv.slice(2)) {
  let cliArgs;
  try {
    cliArgs = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    return 1;
  }

  if (cliArgs.help) {
    printUsage();
    return 0;
  }

  try {
    const outputPath = await convertMarkdownFileToPdf(cliArgs);
    console.log(`PDF created: ${outputPath}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFilePath && currentFilePath === invokedFilePath) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
