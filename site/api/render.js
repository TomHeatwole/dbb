import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RENDER_DIR = path.dirname(fileURLToPath(import.meta.url));

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return null;
  }
}

function readLocalTemplate() {
  const candidates = [
    // Copied next to this function by postbuild (Vercel bundle)
    path.join(RENDER_DIR, "_spa-template.html"),
    // Local `npm run serve` after a CRA build
    path.join(process.cwd(), "build", "index.html"),
    path.join(process.cwd(), "index.html"),
  ];
  for (const filePath of candidates) {
    const html = readIfExists(filePath);
    if (html) {
      return html;
    }
  }
  return null;
}

async function loadHtmlTemplate(req) {
  const local = readLocalTemplate();
  if (local) {
    return local;
  }

  // Last resort on Vercel: the built SPA is also a static file at /index.html
  const vercelHost = process.env.VERCEL_URL;
  const origin = vercelHost ? `https://${vercelHost}` : getOrigin(req);
  if (!origin) {
    return null;
  }
  try {
    const resp = await fetch(`${origin}/index.html`);
    if (resp.ok) {
      return await resp.text();
    }
  } catch (_) {
    // fall through
  }
  return null;
}

// Cache route metadata so we don't hit the filesystem on every request
let routeMetaCache = null;
function loadRouteMeta() {
  if (routeMetaCache) {
    return routeMetaCache;
  }
  const candidates = [
    path.join(process.cwd(), "routeMeta.json"),
    path.join(RENDER_DIR, "..", "routeMeta.json"),
  ];
  for (const metaPath of candidates) {
    const raw = readIfExists(metaPath);
    if (raw) {
      try {
        routeMetaCache = JSON.parse(raw);
        return routeMetaCache;
      } catch (_) {
        // try the next path
      }
    }
  }
  routeMetaCache = {};
  return routeMetaCache;
}

function getPathFromRequest(req) {
  // Prefer original URL when behind Express; fall back to req.url
  const rawUrl =
    (req.originalUrl && typeof req.originalUrl === "string"
      ? req.originalUrl
      : null) || (typeof req.url === "string" ? req.url : "/");
  const pathOnly = rawUrl.split("?")[0] || "/";
  return pathOnly;
}

function pickMetaForPath(routeMeta, pathOnly) {
  if (!routeMeta || typeof routeMeta !== "object") {
    return null;
  }

  const keys = Object.keys(routeMeta);
  if (!keys.length) {
    return null;
  }

  // Exact match or longest-prefix match (for things like "/team/:id")
  let bestConfig = null;
  let bestLen = -1;
  for (const key of keys) {
    if (key === "*") {
      continue;
    }
    if (
      pathOnly === key
      || (pathOnly.startsWith(key) && (pathOnly.length === key.length || pathOnly[key.length] === '/'))
    ) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestConfig = routeMeta[key];
      }
    }
  }

  if (!bestConfig && routeMeta["*"]) {
    bestConfig = routeMeta["*"];
  }

  return bestConfig || null;
}

function getOrigin(req) {
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "";
  const protoHeader = req.headers["x-forwarded-proto"] || "https";
  const protocol = Array.isArray(protoHeader)
    ? protoHeader[0]
    : String(protoHeader).split(",")[0];
  if (!host) {
    return "";
  }
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

export default async function handler(req, res) {
  let html = await loadHtmlTemplate(req);
  if (!html) {
    return res.status(500).send("Template not found");
  }

  const routeMeta = loadRouteMeta();
  const requestPath = getPathFromRequest(req);
  const origin = getOrigin(req);

  const metaConfig = pickMetaForPath(routeMeta, requestPath) || {};
  const defaultTitle = "The Hwang Dynasty";
  const defaultDescription =
    "Because Sleeper is too lazy for BestBall in browser";
  const defaultImage = "/logo.png";

  let ogTitle = metaConfig.ogTitle || defaultTitle;
  const ogDescription =
    (typeof metaConfig.ogDescription === "string" &&
      metaConfig.ogDescription.length > 0
      ? metaConfig.ogDescription
      : defaultDescription);
  const ogImagePath = metaConfig.ogImage || defaultImage;

  const canonicalPath =
    requestPath && requestPath.startsWith("/")
      ? requestPath
      : `/${requestPath || ""}`;
  const ogUrl = origin ? `${origin}${canonicalPath}` : canonicalPath;
  const ogImage = origin
    ? `${origin}${ogImagePath.startsWith("/") ? ogImagePath : `/${ogImagePath}`}`
    : ogImagePath;

  // Strip any existing description/OG meta tags from the built HTML
  html = html
    .replace(
      /<meta[^>]+name=["']description["'][^>]*>\s*/i,
      ""
    )
    .replace(
      /<meta[^>]+property=["']og:title["'][^>]*>\s*/i,
      ""
    )
    .replace(
      /<meta[^>]+property=["']og:description["'][^>]*>\s*/i,
      ""
    )
    .replace(
      /<meta[^>]+property=["']og:image["'][^>]*>\s*/i,
      ""
    )
    .replace(
      /<meta[^>]+property=["']og:url["'][^>]*>\s*/i,
      ""
    )
    .replace(
      /<meta[^>]+property=["']og:type["'][^>]*>\s*/i,
      ""
    );

  const ogMetaBlock = [
    `<meta name="description" content="${ogDescription}">`,
    `<meta property="og:title" content="${ogTitle}">`,
    `<meta property="og:description" content="${ogDescription}">`,
    `<meta property="og:image" content="${ogImage}">`,
    `<meta property="og:url" content="${ogUrl}">`,
    `<meta property="og:type" content="website">`,
  ].join("\n  ");

  // Inject our OG/meta block just before </head>
  html = html.replace("</head>", `  ${ogMetaBlock}\n</head>`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}