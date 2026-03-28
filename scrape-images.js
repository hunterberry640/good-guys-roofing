#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { mkdir, writeFile, access } from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const SCROLL_STEP = 300;
const SCROLL_PAUSE = 400;
const NAV_TIMEOUT = 30_000;
const DOWNLOAD_CONCURRENCY = 6;
const MIN_IMAGE_BYTES = 4_000; // skip images < 4 KB (icons / trackers)
const TRACKER_DOMAINS = [
  'facebook.com', 'google-analytics.com', 'googletagmanager.com',
  'doubleclick.net', 'twitter.com', 'linkedin.com', 'bing.com',
];

const SKIP_PATH_PATTERNS = [
  /\/blog(\/|$)/i,
  /\/blog-?\d*/i,
  /\/post\//i,
  /\/articles?\//i,
  /\/news\//i,
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

function shouldSkipPage(urlStr) {
  try {
    const u = new URL(urlStr);
    return SKIP_PATH_PATTERNS.some(pat => pat.test(u.pathname));
  } catch { return false; }
}

function normalizeUrl(raw, baseHostname) {
  try {
    const u = new URL(raw);
    if (u.hostname !== baseHostname) return null;
    u.hash = '';
    u.search = '';
    const clean = u.href.replace(/\/+$/, '');
    return clean;
  } catch { return null; }
}

function pagePathToDir(pageUrl, domain) {
  const u = new URL(pageUrl);
  let p = u.pathname.replace(/^\/+|\/+$/g, '') || '_root';
  p = p.replace(/[<>:"|?*]/g, '_');
  return path.join('downloaded-assets', domain, p);
}

function filenameFromUrl(imgUrl) {
  try {
    const u = new URL(imgUrl);
    const segments = u.pathname.split('/').filter(Boolean);
    let name = segments[segments.length - 1] || 'image';
    name = name.replace(/[<>:"|?*]/g, '_');
    if (!/\.\w{2,5}$/.test(name)) name += '.jpg';
    return name;
  } catch { return 'image.jpg'; }
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > 0 && contentLength < MIN_IMAGE_BYTES) {
    throw new Error(`Too small (${contentLength} bytes)`);
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body), fileStream);
}

function shouldSkipImage(src) {
  if (!src) return true;
  if (src.startsWith('data:')) return true;
  if (src.endsWith('.svg')) return true;
  try {
    const u = new URL(src);
    if (TRACKER_DOMAINS.some(d => u.hostname.includes(d))) return true;
    // Wix image resizer srcset variants (w_NNN,h_NNN) are blocked when fetched directly
    if (u.hostname.includes('wixstatic.com') && /\/v1\/fill\/w_\d+/.test(u.pathname)) return true;
  } catch { return true; }
  return false;
}

// ── Core: per-page processing ───────────────────────────────────────────────

async function autoScroll(page) {
  await page.evaluate(async (step, pause) => {
    await new Promise(resolve => {
      let lastHeight = 0;
      let stableCount = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
          stableCount++;
          if (stableCount >= 5) { clearInterval(timer); resolve(); }
        } else {
          stableCount = 0;
          lastHeight = newHeight;
        }
      }, pause);
      setTimeout(() => { clearInterval(timer); resolve(); }, 30_000);
    });
  }, SCROLL_STEP, SCROLL_PAUSE);
}

async function extractLinks(page, baseHostname) {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map(a => a.href)
  );
  const links = new Set();
  for (const href of hrefs) {
    const clean = normalizeUrl(href, baseHostname);
    if (clean) links.add(clean);
  }
  return links;
}

async function extractImageUrls(page) {
  return page.evaluate(() => {
    const urls = new Set();

    // <img> src
    document.querySelectorAll('img').forEach(img => {
      if (img.src) urls.add(img.src);
      if (img.currentSrc) urls.add(img.currentSrc);
    });

    // <img> srcset
    document.querySelectorAll('img[srcset]').forEach(img => {
      img.srcset.split(',').forEach(entry => {
        const src = entry.trim().split(/\s+/)[0];
        if (src) urls.add(src);
      });
    });

    // <source> srcset inside <picture>
    document.querySelectorAll('picture source[srcset]').forEach(src => {
      src.srcset.split(',').forEach(entry => {
        const s = entry.trim().split(/\s+/)[0];
        if (s) urls.add(s);
      });
    });

    // CSS background-image on all elements
    document.querySelectorAll('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const matches = bg.matchAll(/url\(["']?(.*?)["']?\)/g);
        for (const m of matches) {
          if (m[1]) urls.add(m[1]);
        }
      }
    });

    return [...urls];
  });
}

// ── Core: crawler ───────────────────────────────────────────────────────────

async function crawl(startUrl) {
  const origin = new URL(startUrl);
  const baseHostname = origin.hostname;
  const domain = baseHostname;

  const visited = new Set();
  const queue = [normalizeUrl(startUrl, baseHostname) || startUrl];
  const globalImages = new Set();
  let downloadedCount = 0;
  let pageCount = 0;

  log(`Starting crawl of ${domain}`);
  log(`Output → downloaded-assets/${domain}/\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    while (queue.length > 0) {
      const pageUrl = queue.shift();
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);

      if (shouldSkipPage(pageUrl)) {
        log(`⏭ Skipping blog/article page: ${pageUrl}\n`);
        continue;
      }

      pageCount++;

      log(`[Page ${pageCount}/${pageCount + queue.length}] ${pageUrl}`);

      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
        await autoScroll(page);

        // Discover new links
        const links = await extractLinks(page, baseHostname);
        for (const link of links) {
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
          }
        }

        // Extract images
        const rawImages = await extractImageUrls(page);
        const newImages = rawImages.filter(src => !shouldSkipImage(src) && !globalImages.has(src));

        if (newImages.length > 0) {
          const dir = pagePathToDir(pageUrl, domain);
          await ensureDir(dir);

          const usedNames = new Set();

          // Download in batches
          for (let i = 0; i < newImages.length; i += DOWNLOAD_CONCURRENCY) {
            const batch = newImages.slice(i, i + DOWNLOAD_CONCURRENCY);
            await Promise.allSettled(batch.map(async (imgUrl) => {
              if (globalImages.has(imgUrl)) return;
              globalImages.add(imgUrl);

              let name = filenameFromUrl(imgUrl);
              // Deduplicate filenames within the same directory
              if (usedNames.has(name)) {
                const ext = path.extname(name);
                const base = path.basename(name, ext);
                let n = 2;
                while (usedNames.has(`${base}_${n}${ext}`)) n++;
                name = `${base}_${n}${ext}`;
              }
              usedNames.add(name);

              const dest = path.join(dir, name);
              try {
                await downloadImage(imgUrl, dest);
                downloadedCount++;
                log(`  ✓ ${name}`);
              } catch (err) {
                log(`  ✗ ${name} — ${err.message}`);
              }
            }));
          }
        }

        log(`  → ${newImages.length} new images on this page (${downloadedCount} total downloaded)\n`);
      } catch (err) {
        log(`  ⚠ Page error: ${err.message}\n`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  log(`\n✅ Done! Crawled ${pageCount} pages, downloaded ${downloadedCount} images.`);
  log(`   Output: downloaded-assets/${domain}/`);
}

// ── CLI entry ───────────────────────────────────────────────────────────────

const url = process.argv[2];

if (!url) {
  console.error('\nUsage: node scrape-images.js <url>\n');
  console.error('Example: node scrape-images.js https://www.goodguysroofing.com\n');
  process.exit(1);
}

try {
  new URL(url);
} catch {
  console.error(`\nInvalid URL: "${url}"\n`);
  process.exit(1);
}

crawl(url).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
