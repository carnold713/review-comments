// A tiny site with review comments: node examples/server.js, then open http://localhost:4600
// Uses the code in this folder (source: 'local'). In your own project, leave `source` out to follow GitHub.
const http = require('http');
const fs = require('fs');
const path = require('path');
const reviewComments = require('..');

const comments = reviewComments({
  source: process.env.RC_SOURCE || 'local',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  deletePassword: process.env.DELETE_PASSWORD || 'demo',
});

const pages = {'/': 'index.html', '/app': 'app.html'};
http.createServer((req, res) => {
  if (comments.handle(req, res)) return;
  const route = req.url.split('?')[0];
  const file = pages[route];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(comments.inject(html, {page: route === '/' ? 'home' : 'app', label: route === '/' ? 'Example page' : 'Example app'}));
}).listen(process.env.PORT || 4600, () => console.log('Example on http://localhost:' + (process.env.PORT || 4600)));
