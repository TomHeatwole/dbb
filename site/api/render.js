
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  // 1. Load your existing HTML (the file your app would normally serve)
  console.log("render hit:", req.url);
  console.log("lol");
  const filePath = path.join(process.cwd(), "site", "build", "index.html");
  let html = fs.readFileSync(filePath, "utf8");
  // html = html.replace(/"\/static\//g, '"/build/static/');


  // 2. Resolve the public URL for this request (scheme + host)
  // const host =
  //   req.headers["x-forwarded-host"] ||
  //   req.headers.host ||
  //   "";
  // const protoHeader = req.headers["x-forwarded-proto"] || "https";
  // const protocol = Array.isArray(protoHeader)
  //   ? protoHeader[0]
  //   : String(protoHeader).split(",")[0];
  // const origin = host ? `${protocol}://${host}`.replace(/\/+$/, "") : "";

  // // Replace all CRA-style %PUBLIC_URL% tokens with the actual site root
  // if (origin) {
  //   html = html.replace(/%PUBLIC_URL%/g, origin);
  // } else {
  //   // Fallback: strip the placeholder so assets resolve relative to /
  //   html = html.replace(/%PUBLIC_URL%/g, "");
  // }

  // 3. (Optional) Inject any server-side meta tags
  const metaTag = `<meta name="hello" content="world">`;
  html = html.replace("</head>", `  ${metaTag}\n</head>`);

  // 4. Return the modified HTML
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}