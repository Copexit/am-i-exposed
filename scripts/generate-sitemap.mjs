#!/usr/bin/env node
// Generates sitemap.xml with git-based lastmod dates
import { execSync } from "child_process";
import { writeFileSync } from "fs";

const PAGES = [
  { path: "/", priority: "1.0", changefreq: "weekly", source: "src/app/page.tsx" },
  { path: "/methodology/", priority: "0.8", changefreq: "monthly", source: "src/app/methodology/page.tsx" },
  { path: "/setup-guide/", priority: "0.7", changefreq: "monthly", source: "src/app/setup-guide/page.tsx" },
  { path: "/about/", priority: "0.6", changefreq: "monthly", source: "src/app/about/page.tsx" },
  { path: "/faq/", priority: "0.7", changefreq: "monthly", source: "src/app/faq/page.tsx" },
  { path: "/glossary/", priority: "0.7", changefreq: "monthly", source: "src/app/glossary/page.tsx" },
];

function getLastMod(file) {
  try {
    const date = execSync(`git log -1 --format=%cI -- ${file}`, { encoding: "utf-8" }).trim();
    return date.split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

const urls = PAGES.map(
  (p) =>
    `  <url>\n    <loc>https://am-i.exposed${p.path}</loc>\n    <lastmod>${getLastMod(p.source)}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

writeFileSync("public/sitemap.xml", xml);
console.log("Sitemap generated with git-based lastmod dates");
