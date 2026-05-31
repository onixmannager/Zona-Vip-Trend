import fs from 'fs';
import path from 'path';

const file = path.resolve('src/App.tsx');
let content = fs.readFileSync(file, 'utf-8');

// 1. Update Story type
content = content.replace(
  `  brandImg: string;\r\n  rentedBy: string;\r\n  createdAt: number;\r\n};`,
  `  brandImg: string;\n  rentedBy: string;\n  createdAt: number;\n  path?: string;\n};`
);
content = content.replace(
  `  brandImg: string;\n  rentedBy: string;\n  createdAt: number;\n};`,
  `  brandImg: string;\n  rentedBy: string;\n  createdAt: number;\n  path?: string;\n};`
);

// 2. StoryViewer signature
content = content.replace(
  `function StoryViewer({ \n  stories, \n  initialIndex, \n  onClose \n}: { \n  stories: Story[], \n  initialIndex: number, \n  onClose: () => void \n}) {\n  const [currentIndex, setCurrentIndex] = useState(initialIndex);`,
  `function StoryViewer({ \n  stories, \n  initialIndex, \n  onClose,\n  currentUser\n}: { \n  stories: Story[], \n  initialIndex: number, \n  onClose: () => void,\n  currentUser?: FirebaseUser | null\n}) {\n  const [currentIndex, setCurrentIndex] = useState(initialIndex);\n  const navigate = useNavigate();`
);
// fallback for windows line endings
content = content.replace(
  `function StoryViewer({ \r\n  stories, \r\n  initialIndex, \r\n  onClose \r\n}: { \r\n  stories: Story[], \r\n  initialIndex: number, \r\n  onClose: () => void \r\n}) {\r\n  const [currentIndex, setCurrentIndex] = useState(initialIndex);`,
  `function StoryViewer({ \n  stories, \n  initialIndex, \n  onClose,\n  currentUser\n}: { \n  stories: Story[], \n  initialIndex: number, \n  onClose: () => void,\n  currentUser?: FirebaseUser | null\n}) {\n  const [currentIndex, setCurrentIndex] = useState(initialIndex);\n  const navigate = useNavigate();`
);

// 3. StoryViewer header (profile link and delete)
content = content.replace(
  `        <div className="absolute top-6 inset-x-4 flex items-center justify-between z-30">\n            <div className="flex items-center gap-2 pointer-events-none">\n                <img src={story.brandImg} alt={story.brand} className="w-8 h-8 rounded-full border border-white/50 bg-black/50 object-cover" />\n                <span className="text-white font-bold drop-shadow-md text-sm">{story.brand}</span>\n            </div>\n            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 text-white/80 hover:text-white bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95">\n                <PlusSquare className="w-6 h-6 rotate-45" />\n            </button>\n        </div>`,
  `        <div className="absolute top-6 inset-x-4 flex items-center justify-between z-30">\n            <div className="flex items-center gap-2 pointer-events-auto cursor-pointer" onClick={(e) => { e.stopPropagation(); onClose(); navigate(\`/vip/\${story.rentedBy}\`); }}>\n                <img src={story.brandImg} alt={story.brand} className="w-8 h-8 rounded-full border border-white/50 bg-black/50 object-cover" />\n                <span className="text-white font-bold drop-shadow-md text-sm hover:underline">{story.brand}</span>\n            </div>\n            <div className="flex gap-2 pointer-events-auto">\n                {currentUser?.uid === story.rentedBy && (\n                    <button onClick={async (e) => { \n                        e.stopPropagation(); \n                        if (confirm("¿Eliminar esta historia?")) {\n                            if (story.path) await deleteDoc(doc(db, story.path));\n                            if (stories.length <= 1) onClose();\n                        }\n                    }} className="p-2 text-white/80 hover:text-red-400 bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95" title="Eliminar">\n                        <Trash2 className="w-5 h-5" />\n                    </button>\n                )}\n                <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 text-white/80 hover:text-white bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95">\n                    <PlusSquare className="w-6 h-6 rotate-45" />\n                </button>\n            </div>\n        </div>`
);
// fallback for \r\n
content = content.replace(
  `        <div className="absolute top-6 inset-x-4 flex items-center justify-between z-30">\r\n            <div className="flex items-center gap-2 pointer-events-none">\r\n                <img src={story.brandImg} alt={story.brand} className="w-8 h-8 rounded-full border border-white/50 bg-black/50 object-cover" />\r\n                <span className="text-white font-bold drop-shadow-md text-sm">{story.brand}</span>\r\n            </div>\r\n            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 text-white/80 hover:text-white bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95">\r\n                <PlusSquare className="w-6 h-6 rotate-45" />\r\n            </button>\r\n        </div>`,
  `        <div className="absolute top-6 inset-x-4 flex items-center justify-between z-30">\n            <div className="flex items-center gap-2 pointer-events-auto cursor-pointer" onClick={(e) => { e.stopPropagation(); onClose(); navigate(\`/vip/\${story.rentedBy}\`); }}>\n                <img src={story.brandImg} alt={story.brand} className="w-8 h-8 rounded-full border border-white/50 bg-black/50 object-cover" />\n                <span className="text-white font-bold drop-shadow-md text-sm hover:underline">{story.brand}</span>\n            </div>\n            <div className="flex gap-2 pointer-events-auto">\n                {currentUser?.uid === story.rentedBy && (\n                    <button onClick={async (e) => { \n                        e.stopPropagation(); \n                        if (confirm("¿Eliminar esta historia?")) {\n                            if (story.path) await deleteDoc(doc(db, story.path));\n                            if (stories.length <= 1) onClose();\n                        }\n                    }} className="p-2 text-white/80 hover:text-red-400 bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95" title="Eliminar">\n                        <Trash2 className="w-5 h-5" />\n                    </button>\n                )}\n                <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 text-white/80 hover:text-white bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95">\n                    <PlusSquare className="w-6 h-6 rotate-45" />\n                </button>\n            </div>\n        </div>`
);

// 4. Explorer fetch paths
content = content.replace(
  `snap.forEach(d => strs.push({ id: d.id, ...d.data() } as Story));`,
  `snap.forEach(d => strs.push({ id: d.id, path: d.ref.path, ...d.data() } as Story));`
);

// 5. Profile fetch paths
content = content.replace(
  `snap.forEach(d => fetchedStories.push({ id: d.id, ...d.data() } as Story));`,
  `snap.forEach(d => fetchedStories.push({ id: d.id, path: d.ref.path, ...d.data() } as Story));`
);
content = content.replace( // might match twice for dashboard and profile
  `snap.forEach(d => fetchedStories.push({ id: d.id, ...d.data() } as Story));`,
  `snap.forEach(d => fetchedStories.push({ id: d.id, path: d.ref.path, ...d.data() } as Story));`
);

// 6. Explorer grouping and video cover
const explorerBefore = `   const filteredProfiles = vipProfiles
       .filter(p => p.username !== userProfile?.username)
       .filter(p => 
           ((p.username || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
            (p.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()))
       )
       .filter((v, i, a) => a.findIndex(t => t.username === v.username) === i);
    
   return (
      <div className="flex-1 overflow-y-auto no-scrollbar pb-24 bg-white">
          <div className="py-2 mb-2 bg-white">
             <h3 className="px-4 text-sm font-black text-gray-900 mb-3 block mt-4">Historias Globales</h3>
             {stories.length === 0 ? (
                 <p className="text-xs text-gray-400 px-4 pb-4">No hay historias activas.</p>
             ) : (
                 <div className="flex gap-3 px-4 overflow-x-auto no-scrollbar pb-4">
                    {stories.map((s, idx) => (
                       <div key={s.id} onClick={() => setSelectedStoryIndex(idx)} className="w-[100px] h-[160px] shrink-0 rounded-2xl relative overflow-hidden bg-gray-900 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-95 group isolate transform-gpu [transform:translateZ(0)] block" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', clipPath: 'inset(0 round 1rem)' }}>
                          <img src={s.image} alt="story" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />
                          <div className="absolute inset-3 flex flex-col justify-between">
                             <div className="w-8 h-8 rounded-full border-2 border-pink-500 overflow-hidden shrink-0 shadow-lg">
                                <img src={s.brandImg} alt={s.brand} className="w-full h-full object-cover bg-white" />
                             </div>
                             <div>
                                <p className="text-[10px] font-black text-white truncate drop-shadow-md leading-tight">{s.brand}</p>
                             </div>
                          </div>
                          <div className="absolute inset-0 rounded-2xl border border-gray-100 pointer-events-none z-10" />
                       </div>
                    ))}
                 </div>
             )}`;

const explorerAfter = `   const filteredProfiles = vipProfiles
       .filter(p => p.username !== userProfile?.username)
       .filter(p => 
           ((p.username || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
            (p.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()))
       )
       .filter((v, i, a) => a.findIndex(t => t.username === v.username) === i);
    
   const explorerCoverStories: {story: Story, index: number}[] = [];
   const explorerSeenUsers = new Set<string>();
   stories.forEach((s, idx) => {
       if (!explorerSeenUsers.has(s.rentedBy)) {
           explorerSeenUsers.add(s.rentedBy);
           explorerCoverStories.push({ story: s, index: idx });
       }
   });

   return (
      <div className="flex-1 overflow-y-auto no-scrollbar pb-24 bg-white">
          <div className="py-2 mb-2 bg-white">
             <h3 className="px-4 text-sm font-black text-gray-900 mb-3 block mt-4">Historias Globales</h3>
             {stories.length === 0 ? (
                 <p className="text-xs text-gray-400 px-4 pb-4">No hay historias activas.</p>
             ) : (
                 <div className="flex gap-3 px-4 overflow-x-auto no-scrollbar pb-4">
                    {explorerCoverStories.map(({ story: s, index: idx }) => (
                       <div key={s.id} onClick={() => setSelectedStoryIndex(idx)} className="w-[100px] h-[160px] shrink-0 rounded-2xl relative overflow-hidden bg-gray-900 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-95 group isolate transform-gpu [transform:translateZ(0)] block" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', clipPath: 'inset(0 round 1rem)' }}>
                          {s.mediaType === 'video' ? (
                             <video src={s.image} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" preload="metadata" />
                          ) : (
                             <img src={s.image} alt="story" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />
                          <div className="absolute inset-3 flex flex-col justify-between">
                             <div className="w-8 h-8 rounded-full border-2 border-pink-500 overflow-hidden shrink-0 shadow-lg pointer-events-none">
                                <img src={s.brandImg} alt={s.brand} className="w-full h-full object-cover bg-white" />
                             </div>
                             <div>
                                <p className="text-[10px] font-black text-white truncate drop-shadow-md leading-tight pointer-events-none">{s.brand}</p>
                             </div>
                          </div>
                          <div className="absolute inset-0 rounded-2xl border border-gray-100 pointer-events-none z-10" />
                       </div>
                    ))}
                 </div>
             )}`;
content = content.replace(explorerBefore, explorerAfter);
content = content.replace(explorerBefore.replace(/\n/g, '\r\n'), explorerAfter); // windows fallback

// 7. Update StoryViewer usages to pass currentUser
content = content.replace(
  `<StoryViewer \n                  stories={stories} \n                  initialIndex={selectedStoryIndex} \n                  onClose={() => setSelectedStoryIndex(null)} \n               />`,
  `<StoryViewer \n                  stories={stories} \n                  initialIndex={selectedStoryIndex} \n                  onClose={() => setSelectedStoryIndex(null)} \n                  currentUser={currentUser}\n               />`
);
content = content.replace(
  `<StoryViewer \r\n                  stories={stories} \r\n                  initialIndex={selectedStoryIndex} \r\n                  onClose={() => setSelectedStoryIndex(null)} \r\n               />`,
  `<StoryViewer \n                  stories={stories} \n                  initialIndex={selectedStoryIndex} \n                  onClose={() => setSelectedStoryIndex(null)} \n                  currentUser={currentUser}\n               />`
);

content = content.replace(
  `<StoryViewer \n                  stories={(stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }])}\n                  initialIndex={selectedStoryIndex} \n                  onClose={() => setSelectedStoryIndex(null)} \n               />`,
  `<StoryViewer \n                  stories={(stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo1', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo2', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo3', createdAt: Date.now() }])}\n                  initialIndex={selectedStoryIndex} \n                  onClose={() => setSelectedStoryIndex(null)} \n                  currentUser={currentUser}\n               />`
);
content = content.replace(
  `<StoryViewer \r\n                  stories={(stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }])}\r\n                  initialIndex={selectedStoryIndex} \r\n                  onClose={() => setSelectedStoryIndex(null)} \r\n               />`,
  `<StoryViewer \n                  stories={(stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo1', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo2', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo3', createdAt: Date.now() }])}\n                  initialIndex={selectedStoryIndex} \n                  onClose={() => setSelectedStoryIndex(null)} \n                  currentUser={currentUser}\n               />`
);

// 8. Profile stories grouping
const profileBefore = `{((stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }]).length > 0 || canUploadStory) && (
            <div className="px-4 mb-4 shrink-0 w-full overflow-x-auto no-scrollbar">
                <div className="flex gap-3 items-center">
                    {/* Add Story Button */}
                    {canUploadStory && (
                        <button 
                            onClick={() => setIsUploadingStory(true)}
                            className="relative shrink-0 flex items-center justify-center group"
                        >
                            <div className="w-[56px] h-[56px] rounded-full p-[2px] border-2 border-dashed border-pink-300 group-hover:border-pink-500 transition-colors">
                                <div className="w-full h-full rounded-full bg-pink-50 flex items-center justify-center group-hover:bg-pink-100 transition-colors">
                                    <Plus className="w-6 h-6 text-pink-500" />
                                </div>
                            </div>
                        </button>
                    )}
                    
                    {/* List of Stories */}
                    {((stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }])).map((story, idx, arr) => (
                        <button 
                            key={story.id} 
                            onClick={() => setSelectedStoryIndex(idx)}
                            className="relative shrink-0 group cursor-pointer"
                        >
                            <div className="w-[56px] h-[56px] rounded-full p-[2.5px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                                <div className="w-full h-full rounded-full border-2 border-white overflow-hidden bg-white">
                                    <img src={story.brandImg} alt={story.brand} className="w-full h-full object-cover" />
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        )}`;

const profileAfter = `{(() => {
            const actualStories = stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo1', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo2', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo3', createdAt: Date.now() }];
            
            const profileCoverStories: {story: Story, index: number}[] = [];
            const profileSeenUsers = new Set<string>();
            actualStories.forEach((s, idx) => {
                if (!profileSeenUsers.has(s.rentedBy)) {
                    profileSeenUsers.add(s.rentedBy);
                    profileCoverStories.push({ story: s, index: idx });
                }
            });

            if (!(actualStories.length > 0 || canUploadStory)) return null;

            return (
                <div className="px-4 mb-4 shrink-0 w-full overflow-x-auto no-scrollbar">
                    <div className="flex gap-3 items-center">
                        {/* Add Story Button */}
                        {canUploadStory && (
                            <button 
                                onClick={() => setIsUploadingStory(true)}
                                className="relative shrink-0 flex items-center justify-center group"
                            >
                                <div className="w-[56px] h-[56px] rounded-full p-[2px] border-2 border-dashed border-pink-300 group-hover:border-pink-500 transition-colors">
                                    <div className="w-full h-full rounded-full bg-pink-50 flex items-center justify-center group-hover:bg-pink-100 transition-colors">
                                        <Plus className="w-6 h-6 text-pink-500" />
                                    </div>
                                </div>
                            </button>
                        )}
                        
                        {/* List of Stories */}
                        {profileCoverStories.map(({ story, index: idx }) => (
                            <button 
                                key={story.id} 
                                onClick={() => setSelectedStoryIndex(idx)}
                                className="relative shrink-0 group cursor-pointer outline-none"
                            >
                                <div className="w-[56px] h-[56px] rounded-full p-[2.5px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                                    <div className="w-full h-full rounded-full border-2 border-white overflow-hidden bg-white">
                                        <img src={story.brandImg} alt={story.brand} className="w-full h-full object-cover" />
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            );
        })()}`;
content = content.replace(profileBefore, profileAfter);
content = content.replace(profileBefore.replace(/\n/g, '\r\n'), profileAfter);

// 9. ContactsModal self message
content = content.replace(
  `{isAccepted && currentUser && c.users.includes(currentUser.uid) && (`,
  `{isAccepted && currentUser && c.users.includes(currentUser.uid) && otherUid !== currentUser.uid && (`
);

fs.writeFileSync(file, content, 'utf-8');
console.log('Patch applied correctly!');
