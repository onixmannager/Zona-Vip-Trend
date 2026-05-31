import * as fs from 'fs';

const filePath = './src/components/Dashboard.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

// Replace Root Container
content = content.replace('bg-black/80 backdrop-blur-sm', 'bg-black/40 backdrop-blur-md');
content = content.replace('font-[var(--fb)]', 'font-sans text-gray-900');
content = content.replace('bg-[#050505] border border-white/10', 'bg-gray-50 border border-gray-100');
content = content.replace('shadow-[0_32px_80px_rgba(0,0,0,0.8)]', 'shadow-2xl');
content = content.replace('bg-black/80 backdrop-blur-xl border-b border-white/10', 'bg-white/90 backdrop-blur-xl border-b border-gray-100');

// Replace Header text
content = content.replace('font-[var(--fh)] text-lg md:text-2xl text-white uppercase tracking-widest', 'font-extrabold text-xl md:text-2xl text-black tracking-tight');
content = content.replace('text-[var(--gold)]', 'text-blue-600'); // the Activity icon

// Replace Share button
content = content.replace("bg-[var(--gold)] text-black border-[var(--gold)] shadow-[0_0_15px_rgba(191,155,90,0.4)]", "bg-black text-white border-black shadow-md");
content = content.replace("border-[var(--gold-dim)] text-[var(--gold)] hover:bg-[rgba(191,155,90,0.1)]", "border-gray-200 bg-white text-gray-700 hover:bg-gray-50");
content = content.replace("text-xs md:text-sm border rounded-full font-[var(--fc)] uppercase tracking-wider", "text-sm border rounded-xl font-bold");

// Replace Close Button
content = content.replace("border border-white/10 rounded-full flex items-center justify-center text-[var(--muted2)] hover:bg-white/10 hover:text-white", "border border-gray-200 bg-white rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-black shadow-sm");

// Replace Main Cards
content = content.replace("bg-gradient-to-br from-[#11121d] to-[#08090f] border border-white/10 rounded-3xl p-6 md:p-8 flex flex-col justify-between relative overflow-hidden shadow-2xl", "bg-gradient-to-br from-blue-600 to-indigo-800 border-none rounded-[2.5rem] p-8 md:p-10 flex flex-col justify-between relative overflow-hidden shadow-lg");
content = content.replace("bg-gradient-to-br from-[#11121d] to-[#08090f] border border-white/10 rounded-3xl p-6 md:p-8 flex flex-col justify-between shadow-2xl", "bg-white border border-gray-100 rounded-[2.5rem] p-8 md:p-10 flex flex-col justify-between shadow-[0_4px_24px_rgb(0,0,0,0.03)]");

content = content.replace("bg-[rgba(34,197,94,0.1)] text-green-400 hover:bg-[rgba(34,197,94,0.2)] hover:text-green-300 border border-[rgba(34,197,94,0.2)]", "bg-white/10 text-white hover:bg-white/20 border border-white/20");
content = content.replace("bg-[var(--gold)] text-black hover:bg-yellow-400 border border-[var(--gold)]", "bg-white text-blue-900 hover:bg-blue-50 border-none");
content = content.replace("shadow-[0_0_15px_rgba(191,155,90,0.3)] hover:shadow-[0_0_25px_rgba(191,155,90,0.5)]", "shadow-md");
content = content.replace(/rounded-full text-xs font-\[var\(--fc\)\] uppercase tracking-wider transition-all font-bold/g, 'rounded-xl text-sm transition-all font-bold');

content = content.replace("font-[var(--fh)] text-5xl md:text-6xl text-[var(--cream)]", "font-extrabold text-5xl md:text-7xl text-white tracking-tighter");
content = content.replace("bg-orange-400/10 border border-orange-400/20 text-orange-400", "bg-black/20 text-white border border-white/10 backdrop-blur-sm");
content = content.replace("font-[var(--fh)] text-4xl mt-auto text-[var(--gold-light)]", "font-extrabold text-4xl mt-auto text-black tracking-tight");

// Replace KPI cards
content = content.replace(/bg-\[#0c0d16\]\/80 backdrop-blur-sm border border-white\/5 rounded-2xl p-5 md:p-6 shadow-xl transition-all hover:bg-\[#11121d\]/g, "bg-white border border-gray-100 rounded-[2rem] p-6 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-md transition-all");
content = content.replace(/font-\[var\(--fh\)\] text-2xl md:text-3xl text-white/g, "font-extrabold text-3xl text-black");

// Replace Sections Titles
content = content.replace(/font-\[var\(--fh\)\] text-2xl md:text-3xl text-white flex items-center gap-3/g, "font-extrabold text-2xl text-black flex items-center gap-3");
content = content.replace("text-[var(--gold)] p-2 bg-[rgba(191,155,90,0.1)] rounded-lg", "text-blue-600 p-2 bg-blue-50 border border-blue-100 rounded-xl");
content = content.replace("text-green-400 p-2 bg-green-400/10 rounded-lg", "text-emerald-600 p-2 bg-emerald-50 border border-emerald-100 rounded-xl");
content = content.replace("text-purple-400 p-2 bg-purple-400/10 rounded-lg", "text-fuchsia-600 p-2 bg-fuchsia-50 border border-fuchsia-100 rounded-xl");

// Lists and Tables
content = content.replace(/bg-\[#11121d\] border border-white\/5 rounded-2xl/g, "bg-white border border-gray-100 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.02)]");
content = content.replace(/bg-\[var\(--gold-dk\)\] text-\[var\(--gold\)\]/g, "bg-blue-50 text-blue-600 border border-blue-100");
content = content.replace(/text-white/g, "text-black");
content = content.replace(/text-\[var\(--cream\)\]/g, "text-gray-900");
content = content.replace(/text-\[var\(--muted2\)\]/g, "text-gray-500");
content = content.replace(/text-\[var\(--muted\)\]/g, "text-gray-400");
content = content.replace(/border-white\/10/g, "border-gray-100");
content = content.replace(/border-white\/5/g, "border-gray-100");
content = content.replace(/bg-\[rgba\(0,0,0,0.3\)\]/g, "bg-gray-50");
content = content.replace(/bg-black\/40/g, "bg-gray-50");
content = content.replace(/hover:bg-\[#1a1b26\]/g, "hover:bg-gray-50");
content = content.replace(/text-\[var\(--gold-light\)\]/g, "text-blue-800");

// Fix any lingering explicit black text overrides since we converted white text to black:
content = content.replace(/text-black/g, "text-gray-900"); 

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully re-themed Dashboard');
