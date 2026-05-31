import * as fs from 'fs';
const file = './src/components/Dashboard.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Fix dark mode overrides that got missed or messed up
content = content.replace(/bg-\[#0c0d16\]\/80 backdrop-blur-sm border rounded-2xl p-5/g, "bg-white border rounded-2xl p-5");
content = content.replace(/bg-\[#0c0d16\]/g, "bg-white");
content = content.replace(/hover:bg-\[#11121d\]/g, "hover:bg-gray-50");
content = content.replace(/bg-\[rgba\(0,0,0,0\.5\)\]/g, "bg-white");

content = content.replace(/bg-\[rgba\(0,0,0,0\.2\)\]/g, "bg-gray-50");

// Also the root variables inside App and index.css already correctly handles the generic colors.
content = content.replace(/text-\[var\(--cream\)\]/g, "text-black");
content = content.replace(/text-\[var\(--muted2\)\]/g, "text-gray-500");
content = content.replace(/text-\[var\(--muted\)\]/g, "text-gray-400");
content = content.replace(/text-\[var\(--gold\)\]/g, "text-blue-600");
content = content.replace(/border-\[var\(--gold\)\]/g, "border-blue-600");
content = content.replace(/bg-\[var\(--gold\)\]/g, "bg-blue-600");
content = content.replace(/border-\[var\(--gold-dim\)\]/g, "border-blue-200");
content = content.replace(/ring-\[var\(--gold-dim\)\]/g, "ring-blue-200");

// Ensure input text fields are styled well
content = content.replace(/border-\[rgba\(237,232,224,0\.1\)\]/g, "border-gray-200");
content = content.replace(/focus:border-\[var\(--gold\)\]/g, "focus:border-blue-600");

fs.writeFileSync(file, content, 'utf-8');
console.log('Fixed leftover dark classes');
