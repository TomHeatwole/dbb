
import fs from "fs";
import path from "path";

export default function handler(req, res) {
    // 1. Load your existing HTML (the file your app would normally serve)
    const filePath = path.join(process.cwd(), "public", "index.html");
    let html = fs.readFileSync(filePath, "utf8");
  
    // 2. Inject your server-side meta tag
    const metaTag = `<meta name="hello" content="world">`;
  
    // simple injection before </head>
    html = html.replace("</head>", `  ${metaTag}\n</head>`);
  
    // 3. Return the modified HTML
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  }