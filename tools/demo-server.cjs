const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

http.createServer((request, response) => {
    const script = request.url === '/reader.js';
    const filename = script ? 'app/src/main/assets/reader.js' : 'tests/fixtures/reader.html';
    response.writeHead(200, {
        'Content-Type': script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(fs.readFileSync(path.join(root, filename)));
}).listen(4177, '127.0.0.1', () => {
    console.log('Reader demo: http://127.0.0.1:4177/manga/example/123');
});
