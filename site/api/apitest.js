
export default function handler(req, res) {
    // Return HTML that includes a meta tag
    res.setHeader("Content-Type", "text/html; charset=utf-8");
  
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="hello" content="world">
        </head>
        <body>
          <h1>Hello from your Vercel server-side function!</h1>
        </body>
      </html>
    `);
  }