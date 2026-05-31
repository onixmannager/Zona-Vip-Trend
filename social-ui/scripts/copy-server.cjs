const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, {recursive: true});
fs.copyFileSync(path.join(root, 'server.cjs'), path.join(dist, 'server.cjs'));
