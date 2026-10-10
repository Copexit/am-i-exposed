#!/usr/bin/env node
// Generates sitemap.xml with git-based lastmod dates
import { lastMod, ROUTE_SOURCES } from "./lastmod.mjs";
import { writeFileSync, existsSync } from "fs";

const PAGES = [
  { path: "/", priority: "1.0", changefreq: "weekly", source: "src/app/page.tsx" },
  { path: "/setup-guide/", priority: "0.7", changefreq: "monthly", source: "src/app/setup-guide/page.tsx" },
  { path: "/about/", priority: "0.6", changefreq: "monthly", source: "src/app/about/page.tsx" },
  { path: "/faq/", priority: "0.7", changefreq: "monthly", source: "src/app/faq/page.tsx" },
  { path: "/glossary/", priority: "0.7", changefreq: "monthly", source: "src/app/glossary/page.tsx" },
  { path: "/guide/", priority: "0.8", changefreq: "monthly", source: "src/app/guide/page.tsx" },
  { path: "/guide/labeling/", priority: "0.7", changefreq: "monthly", source: ROUTE_SOURCES["/guide/labeling/"] },
  { path: "/guide/spending/", priority: "0.7", changefreq: "monthly", source: ROUTE_SOURCES["/guide/spending/"] },
  { path: "/observatory/", priority: "0.7", changefreq: "daily", source: "src/app/observatory/page.tsx" },
  { path: "/observatory/wabisabi/", priority: "0.7", changefreq: "daily", source: ROUTE_SOURCES["/observatory/wabisabi/"] },
  { path: "/observatory/whirlpool/", priority: "0.6", changefreq: "daily", source: ROUTE_SOURCES["/observatory/whirlpool/"] },
  { path: "/observatory/p2p/", priority: "0.7", changefreq: "daily", source: ROUTE_SOURCES["/observatory/p2p/"] },
  { path: "/graph/", priority: "0.6", changefreq: "monthly", source: "src/app/graph/page.tsx" },
  { path: "/agents/", priority: "0.6", changefreq: "monthly", source: "src/app/agents/page.tsx" },
  { path: "/welcome/", priority: "0.5", changefreq: "yearly", source: "src/app/welcome/page.tsx" },
];

// Video tutorial page exists only on the Pages build (flag on) once its source is present.
const TUTORIAL = { path: "/tutorial/", priority: "0.7", changefreq: "monthly", source: "src/app/tutorial/page.tsx" };
if (process.env.NEXT_PUBLIC_VIDEOS === "1" && existsSync(TUTORIAL.source)) PAGES.push(TUTORIAL);


const urls = PAGES.map(
  (p) =>
    `  <url>\n    <loc>https://am-i.exposed${p.path}</loc>\n    <lastmod>${lastMod(p.source)}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

writeFileSync("public/sitemap.xml", xml);
console.log("Sitemap generated with git-based lastmod dates");
