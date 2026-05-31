import * as fs from 'fs';
const file = './src/App.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Replace standard variables to match modern light theme
content = content.replace(/text-\[var\(--cream\)\]/g, "text-gray-900");
content = content.replace(/text-\[var\(--muted2\)\]/g, "text-gray-500");
content = content.replace(/text-\[var\(--muted\)\]/g, "text-gray-400");
content = content.replace(/text-\[var\(--gold\)\]/g, "text-blue-600");
content = content.replace(/text-\[var\(--gold-light\)\]/g, "text-blue-800");

// Font replacement
content = content.replace(/font-\[var\(--fb\)\]/g, "font-sans");
content = content.replace(/font-\[var\(--fh\)\]/g, "font-extrabold");
content = content.replace(/font-\[var\(--fc\)\]/g, "font-bold");

fs.writeFileSync(file, content, 'utf-8');
console.log('App.tsx finalized');
