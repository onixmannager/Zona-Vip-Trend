import * as fs from 'fs';

const files = [
    './src/components/AdminPanel.tsx',
    './src/components/PublicWorkspace.tsx'
];

for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Root elements
    content = content.replace('bg-black/80 backdrop-blur-sm', 'bg-black/40 backdrop-blur-md');
    content = content.replace('bg-[#050505] border border-white/10', 'bg-gray-50 border border-gray-100');
    content = content.replace('shadow-[0_32px_80px_rgba(0,0,0,0.8)]', 'shadow-2xl');
    content = content.replace('bg-black/80 backdrop-blur-xl border-b border-white/10', 'bg-white/90 backdrop-blur-xl border-b border-gray-100');
    content = content.replace('font-[var(--fb)]', 'font-sans text-gray-900');

    // General replacements
    content = content.replace(/bg-\[#11121d\] border border-white\/5 rounded-2xl/g, "bg-white border border-gray-100 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.02)]");
    content = content.replace(/bg-\[#11121d\] border border-white\/10 rounded-2xl/g, "bg-white border border-gray-100 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.02)]");
    content = content.replace(/bg-gradient-to-br from-\[#11121d\] to-\[#08090f\] border border-white\/10 rounded-2xl/g, "bg-white border border-gray-100 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.02)]");
    content = content.replace(/bg-gradient-to-br from-\[#11121d\] to-\[#08090f\] border border-white\/10/g, "bg-white border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.02)]");

    content = content.replace(/text-white/g, "text-gray-900");
    content = content.replace(/text-\[var\(--cream\)\]/g, "text-gray-900");
    content = content.replace(/text-\[var\(--muted2\)\]/g, "text-gray-500");
    content = content.replace(/text-\[var\(--muted\)\]/g, "text-gray-400");
    content = content.replace(/text-\[var\(--gold\)\]/g, "text-blue-600");
    content = content.replace(/bg-\[var\(--gold\)\] text-black/g, "bg-blue-600 text-white shadow-md");
    content = content.replace(/border-\[var\(--gold\)\]/g, "border-blue-600");
    content = content.replace(/border-\[var\(--border\)\]/g, "border-gray-200");
    content = content.replace(/text-\[var\(--gold-light\)\]/g, "text-blue-800");

    content = content.replace(/border-white\/10/g, "border-gray-100");
    content = content.replace(/border-white\/5/g, "border-gray-100");
    content = content.replace(/bg-\[rgba\(0,0,0,0.3\)\]/g, "bg-gray-50");
    content = content.replace(/bg-black\/40/g, "bg-gray-50");
    content = content.replace(/hover:bg-\[#1a1b26\]/g, "hover:bg-gray-50");
    content = content.replace(/bg-red-500\/10 text-red-500 border border-red-500\/30/g, "bg-red-50 text-red-600 border border-red-100");
    content = content.replace(/bg-green-500\/10 text-green-400 border border-green-500\/30/g, "bg-green-50 text-green-600 border border-green-100");

    // Close buttons
    content = content.replace("w-10 h-10 border border-white/10 rounded-full flex items-center justify-center text-[var(--muted2)] hover:bg-white/10 hover:text-white transition-colors", "w-10 h-10 border border-gray-200 bg-white rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 shadow-sm transition-colors");
    
    // Header labels
    content = content.replace("font-[var(--fh)] text-lg md:text-2xl text-white uppercase tracking-widest flex items-center gap-2", "font-extrabold text-xl md:text-2xl text-gray-900 tracking-tight flex items-center gap-3");
    
    fs.writeFileSync(filePath, content, 'utf-8');
}
console.log('Successfully updated other files');
