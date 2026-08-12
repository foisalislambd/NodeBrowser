const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Express-shaped demo</h1><p>http.createServer in NodeBrowser (not the npm express CLI).</p><p>' + req.url + '</p>');
});

server.listen(4000, () => {
  console.log('listening on 4000');
});
