
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  // 1. Load your existing HTML (the file your app would normally serve)
  console.log("render hit:", req.url);
  console.log("lol");

  // __dirname = /var/task/site/api
  const filePath = path.join(__dirname, "..", "build", "index.html");
  //                 /var/task/site/api  ..  -> /var/task/site/build/index.html

  let html;
  try {
    html = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error("Failed to read index.html at", filePath, err);
    return res.status(500).send("Template not found");
  }

  // 3. (Optional) Inject any server-side meta tags
  const metaTag = `<meta name="hello" content="world">`;
  html = html.replace("</head>", `  ${metaTag}\n</head>`);

  // 4. Return the modified HTML
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}