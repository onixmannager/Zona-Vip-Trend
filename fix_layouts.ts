import * as fs from 'fs';

// Fix Dashboard
let dashboard = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
dashboard = dashboard.replace('fixed inset-0 z-[400] bg-black/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 font-sans animate-in fade-in duration-200 overflow-hidden', 'fixed inset-0 z-[400] bg-gray-50 font-sans animate-in slide-in-from-bottom-8 duration-200 overflow-y-auto overflow-x-hidden pt-16');
dashboard = dashboard.replace('bg-gray-50 border border-gray-100 rounded-[2.5rem] w-[92vw] md:w-[85vw] lg:w-[80vw] max-w-[1200px] h-[85vh] md:h-[90vh] overflow-y-auto flex flex-col shadow-2xl relative custom-scrollbar animate-in zoom-in-95 duration-200 mt-safe mb-safe text-gray-900', 'w-full max-w-5xl mx-auto min-h-screen flex flex-col text-gray-900 pb-12');
dashboard = dashboard.replace('sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 sm:px-8 py-5 flex items-center justify-between shadow-sm', 'fixed top-0 left-0 right-0 z-20 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 sm:px-8 py-4 flex items-center justify-between shadow-sm');
fs.writeFileSync('src/components/Dashboard.tsx', dashboard, 'utf-8');

// Fix Instructions
let instructions = fs.readFileSync('src/components/Instructions.tsx', 'utf-8');
instructions = instructions.replace('fixed inset-0 z-[1000] bg-black/50 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 md:p-12 transition-all', 'fixed inset-0 z-[1000] bg-white flex flex-col transition-all overflow-hidden');
instructions = instructions.replace('w-full max-w-6xl h-full max-h-[90vh] bg-white rounded-[2.5rem] flex flex-col md:flex-row overflow-hidden font-sans text-gray-900 shadow-2xl relative border border-gray-100', 'w-full h-full bg-white flex flex-col md:flex-row font-sans text-gray-900 relative');
fs.writeFileSync('src/components/Instructions.tsx', instructions, 'utf-8');

// Fix App.tsx "Activo Publicitario Libre"
let app = fs.readFileSync('src/App.tsx', 'utf-8');
app = app.replace(/Activo Publicitario Libre/g, 'Anuncio Libre');
fs.writeFileSync('src/App.tsx', app, 'utf-8');
