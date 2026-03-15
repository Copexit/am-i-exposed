import { createRequire } from 'module';
const require = createRequire('/home/user/.npm/_npx/705bc6b22212b352/node_modules/');
const { chromium } = require('playwright');

// Use known-good test transactions
const TX_HASH = '#tx=8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684'; // OP_RETURN (simple, fast)
const TX2_HASH = '#tx=0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7'; // Taproot (more findings)
const ADDR_HASH = '#addr=bc1q5nfww5jn5k4ghg7dpa4gy85x7uu3l4g0m0re76';
const BASE_URL = 'http://localhost:3000';
const OUT = '/home/user/am-i-exposed/screenshots';

async function waitForResults(page, timeout = 40000) {
  try {
    await page.waitForFunction(() => {
      const body = document.body.innerText || '';
      return body.includes('Privacy Score') ||
             body.includes('Grade') ||
             body.includes('privacy failures') ||
             body.includes('privacy issues') ||
             body.includes('/100');
    }, { timeout });
    console.log('  Results detected, waiting for full render...');
  } catch {
    console.log('  Timeout waiting for results, proceeding...');
  }
  await page.waitForTimeout(8000);
}

async function navigateWithHash(page, hash) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

async function capture(browser, name, hash, width, height, extraScrolls = false) {
  console.log(`\nCapturing: ${name} (${width}x${height})`);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await navigateWithHash(page, hash);
  await waitForResults(page);

  // Get page dimensions for smart scrolling
  const dims = await page.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight,
    scrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  console.log(`  Page dims: ${dims.scrollWidth}x${dims.scrollHeight} (viewport: ${dims.viewportWidth}x${dims.viewportHeight})`);

  // Full page screenshot
  await page.screenshot({
    path: `${OUT}/${name}-full.png`,
    fullPage: true,
  });
  console.log(`  Saved: ${name}-full.png`);

  // Viewport-only screenshot (above the fold)
  await page.screenshot({
    path: `${OUT}/${name}-viewport.png`,
    fullPage: false,
  });
  console.log(`  Saved: ${name}-viewport.png`);

  // For desktop xl+, capture scroll positions to verify sticky sidebar
  if (extraScrolls && dims.scrollHeight > dims.viewportHeight + 200) {
    const scrollPoints = [
      Math.min(800, dims.scrollHeight - dims.viewportHeight),
      Math.min(1600, dims.scrollHeight - dims.viewportHeight),
      Math.min(2800, dims.scrollHeight - dims.viewportHeight),
      dims.scrollHeight - dims.viewportHeight, // bottom
    ];

    for (let i = 0; i < scrollPoints.length; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollPoints[i]);
      await page.waitForTimeout(500);
      const suffix = i < scrollPoints.length - 1 ? `scroll${i+1}` : 'bottom';
      await page.screenshot({
        path: `${OUT}/${name}-${suffix}.png`,
        fullPage: false,
      });
      console.log(`  Saved: ${name}-${suffix}.png (scrollY=${scrollPoints[i]})`);
    }
  }

  // Measure key layout metrics
  const layoutInfo = await page.evaluate(() => {
    // Try to find the two-column container
    const allDivs = document.querySelectorAll('div');
    let twoColContainer = null;
    let sidebar = null;
    let _mainCol = null;

    for (const div of allDivs) {
      const cls = div.className || '';
      if (cls.includes('xl:grid-cols') || cls.includes('xl:flex') || cls.includes('sidebar') || cls.includes('sticky')) {
        if (!twoColContainer && (cls.includes('grid-cols') || cls.includes('xl:grid'))) {
          twoColContainer = div;
        }
        if (cls.includes('sticky')) {
          sidebar = div;
        }
      }
    }

    return {
      twoColContainer: twoColContainer ? {
        className: twoColContainer.className.substring(0, 200),
        width: twoColContainer.getBoundingClientRect().width,
        children: twoColContainer.children.length,
        childWidths: Array.from(twoColContainer.children).map(c => Math.round(c.getBoundingClientRect().width)),
      } : null,
      stickyEl: sidebar ? {
        className: sidebar.className.substring(0, 200),
        rect: sidebar.getBoundingClientRect(),
      } : null,
      overflowX: document.body.scrollWidth > window.innerWidth,
    };
  });
  console.log(`  Layout: ${JSON.stringify(layoutInfo, null, 2)}`);

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop wide (1920x1080) - TX scan with OP_RETURN
  await capture(browser, '01-desktop-tx', TX_HASH, 1920, 1080, true);

  // 2. Desktop wide (1920x1080) - Taproot TX (more findings)
  await capture(browser, '02-desktop-tx2', TX2_HASH, 1920, 1080, true);

  // 3. Desktop wide (1920x1080) - Address scan
  await capture(browser, '03-desktop-addr', ADDR_HASH, 1920, 1080, true);

  // 4. Tablet (1024x768) - TX scan
  await capture(browser, '04-tablet-tx', TX_HASH, 1024, 768, false);

  // 5. Mobile (375x812) - TX scan
  await capture(browser, '05-mobile-tx', TX_HASH, 375, 812, false);

  // 6. Desktop at xl breakpoint boundary (1280x800)
  await capture(browser, '06-xl-boundary', TX_HASH, 1280, 800, true);

  await browser.close();
  console.log('\n=== All captures complete! ===');
})();
