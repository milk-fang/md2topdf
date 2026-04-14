import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

import {
  convertMarkdownFileToPdf,
  getMimeType,
  imageFileToDataUri,
  inlineAssetUrls,
  renderMarkdownToHtml,
  resolveChromiumExecutablePath,
  resolveImageFilePath
} from '../scripts/md2pdf.mjs';

const cliScriptPath = path.resolve('scripts/md2pdf.mjs');
const tinyGifBase64 = 'R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-'));
  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function createFixtureImages(tempDir) {
  const pngPath = path.join(tempDir, '测试 图片.png');
  const transparentPngPath = path.join(tempDir, 'transparent.png');
  const jpegPath = path.join(tempDir, 'photo.jpg');
  const webpPath = path.join(tempDir, 'grid.webp');
  const svgPath = path.join(tempDir, 'vector.svg');

  const executablePath = resolveChromiumExecutablePath();
  const browser = await chromium.launch({
    executablePath: executablePath ?? undefined,
    headless: true
  });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { height: 900, width: 1400 }
    });

    await page.setContent(`<!DOCTYPE html>
      <html>
        <body style="margin:0;background:#ffffff;font-family:sans-serif;">
          <div id="art" style="width:1100px;height:500px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#2563eb,#14b8a6);color:white;font-size:80px;font-weight:700;letter-spacing:4px;">
            PNG DETAIL
          </div>
          <div id="photo" style="margin-top:24px;width:1100px;height:500px;background:
              radial-gradient(circle at 20% 30%, rgba(255,255,255,0.9), rgba(255,255,255,0) 20%),
              linear-gradient(120deg, #f97316, #ef4444 45%, #111827);">
          </div>
          <div id="alpha" style="margin-top:24px;width:900px;height:420px;background:transparent;display:flex;align-items:center;justify-content:center;">
            <div style="width:340px;height:340px;border-radius:999px;background:rgba(16,185,129,0.55);border:12px solid rgba(15,23,42,0.9);"></div>
          </div>
          <canvas id="webp" width="1200" height="600"></canvas>
        </body>
      </html>`);

    await page.locator('#art').screenshot({ path: pngPath, type: 'png' });
    await page.locator('#photo').screenshot({ path: jpegPath, quality: 100, type: 'jpeg' });
    await page.locator('#alpha').screenshot({ omitBackground: true, path: transparentPngPath, type: 'png' });

    const webpDataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('#webp');
      const context = canvas.getContext('2d');
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#1d4ed8';
      context.lineWidth = 18;
      for (let x = 50; x < canvas.width; x += 90) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(canvas.width - x / 3, canvas.height);
        context.stroke();
      }
      context.fillStyle = '#0f172a';
      context.font = 'bold 120px sans-serif';
      context.fillText('WEBP', 390, 330);
      return canvas.toDataURL('image/webp', 1);
    });

    const webpBase64 = webpDataUrl.replace(/^data:image\/webp;base64,/, '');
    await writeFile(webpPath, Buffer.from(webpBase64, 'base64'));
  } finally {
    await browser.close();
  }

  await writeFile(
    svgPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#111827"/>
          <stop offset="100%" stop-color="#9333ea"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="500" rx="32" fill="url(#bg)"/>
      <text x="100" y="285" font-size="180" font-family="Segoe UI, sans-serif" fill="#ffffff">SVG VECTOR</text>
    </svg>`,
    'utf8'
  );

  return {
    jpegPath,
    pngPath,
    svgPath,
    transparentPngPath,
    webpPath
  };
}

test('resolveImageFilePath decodes relative paths with spaces and Chinese names', async () => {
  await withTempDir(async (tempDir) => {
    const markdownPath = path.join(tempDir, 'doc.md');
    const expectedPath = path.join(tempDir, 'images', '测试 图片.png');
    const resolvedPath = resolveImageFilePath(markdownPath, './images/%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png');
    assert.equal(resolvedPath, expectedPath);
  });
});

test('imageFileToDataUri chooses the correct MIME types', async () => {
  await withTempDir(async (tempDir) => {
    const gifPath = path.join(tempDir, 'sample.gif');
    const pngPath = path.join(tempDir, 'sample.png');
    const svgPath = path.join(tempDir, 'sample.svg');

    await writeFile(gifPath, Buffer.from(tinyGifBase64, 'base64'));
    await writeFile(pngPath, Buffer.from(tinyPngBase64, 'base64'));
    await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>', 'utf8');

    assert.equal(getMimeType(gifPath), 'image/gif');
    assert.equal(getMimeType(pngPath), 'image/png');
    assert.equal(getMimeType(svgPath), 'image/svg+xml');
    assert.match(imageFileToDataUri(pngPath), /^data:image\/png;base64,/);
  });
});

test('renderMarkdownToHtml embeds local image bytes as data URIs', async () => {
  await withTempDir(async (tempDir) => {
    const markdownPath = path.join(tempDir, 'guide.md');
    const imagePath = path.join(tempDir, '测试 图片.png');
    await writeFile(imagePath, Buffer.from(tinyPngBase64, 'base64'));

    const html = renderMarkdownToHtml('![diagram](./%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png)', markdownPath);
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, /%E6%B5%8B%E8%AF%95/);
  });
});

test('renderMarkdownToHtml renders inline and block formulas with KaTeX markup', async () => {
  await withTempDir(async (tempDir) => {
    const markdownPath = path.join(tempDir, 'formula.md');
    const html = renderMarkdownToHtml(
      [
        '行内公式：$E = mc^2$',
        '',
        '$$',
        '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
        '$$'
      ].join('\n'),
      markdownPath
    );

    assert.match(html, /class="katex"/);
    assert.match(html, /mathml/);
  });
});

test('inlineAssetUrls converts local font references to data URIs', async () => {
  await withTempDir(async (tempDir) => {
    const fontPath = path.join(tempDir, 'sample.woff2');
    await writeFile(fontPath, Buffer.from('d09GMgABAAAAA', 'utf8'));
    const css = inlineAssetUrls("@font-face{src:url('./sample.woff2') format('woff2');}", tempDir);
    assert.match(css, /data:font\/woff2;base64,/);
  });
});

test('CLI converts Markdown with local images into a non-empty PDF', async () => {
  await withTempDir(async (tempDir) => {
    const outputPath = path.join(tempDir, 'result.pdf');
    const markdownPath = path.join(tempDir, 'sample.md');

    await createFixtureImages(tempDir);
    await writeFile(
      markdownPath,
      [
        '# Image Fidelity Demo',
        '',
        '行内公式示例：$E = mc^2$。',
        '',
        '$$',
        '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
        '$$',
        '',
        '![PNG](./%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png)',
        '',
        '![JPEG](./photo.jpg)',
        '',
        '![Transparent PNG](./transparent.png)',
        '',
        '![WEBP](./grid.webp)',
        '',
        '![SVG](./vector.svg)'
      ].join('\n'),
      'utf8'
    );

    const result = spawnSync(process.execPath, [cliScriptPath, markdownPath, '--output', outputPath], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const pdfBytes = await readFile(outputPath);
    assert.ok(pdfBytes.length > 1_000, `Expected PDF to be non-empty, got ${pdfBytes.length} bytes.`);
    assert.match(result.stdout, /PDF created:/);
  });
});

test('convertMarkdownFileToPdf fails clearly when a local image is missing', async () => {
  await withTempDir(async (tempDir) => {
    const markdownPath = path.join(tempDir, 'missing.md');
    await writeFile(markdownPath, '![missing](./nope.png)', 'utf8');

    await assert.rejects(
      () => convertMarkdownFileToPdf({ inputPath: markdownPath }),
      /Image file not found for "\.\/nope\.png"/
    );
  });
});

test('convertMarkdownFileToPdf rejects remote images in v1', async () => {
  await withTempDir(async (tempDir) => {
    const markdownPath = path.join(tempDir, 'remote.md');
    await writeFile(markdownPath, '![remote](https://example.com/image.png)', 'utf8');

    await assert.rejects(
      () => convertMarkdownFileToPdf({ inputPath: markdownPath }),
      /Remote images are not supported in v1/
    );
  });
});
