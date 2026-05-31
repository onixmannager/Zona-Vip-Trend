import fs from 'fs';
import path from 'path';

const file = path.resolve('src/App.tsx');
let content = fs.readFileSync(file, 'utf-8');

// Helper for both \n and \r\n
const replaceAll = (search, replacement) => {
    // Escape regex characters except our wildcards if we use regex, but we just use string replacement.
    // For exact match, we just replace.
    content = content.replace(search, replacement);
};

// 1. Google Login Fix
const googleBefore = `const docRef = doc(db, 'users', cred.user.uid);`;
const googleAfter = `const docRef = doc(db, 'creatorProfiles', cred.user.uid);`;
content = content.replace(googleBefore, googleAfter);

// 2. Profile Cards Smaller
const gridBefore = `<div className="grid grid-cols-2 md:grid-cols-3 gap-3">`;
const gridAfter = `<div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">`;
content = content.replace(gridBefore, gridAfter);

const cardBefore = `className="group relative rounded-[24px] overflow-hidden aspect-[4/5] bg-gray-100 shadow-sm hover:shadow-md transition-all active:scale-[0.98] block isolate"`;
const cardAfter = `className="group relative rounded-[20px] overflow-hidden aspect-[3/4] bg-gray-100 shadow-sm hover:shadow-md transition-all active:scale-[0.98] block isolate"`;
content = content.replace(cardBefore, cardAfter);

// 3. Wallet real data fetch
const dashBefore = `const unsubSlots = onSnapshot(collection(db, \`creatorProfiles/\${user.uid}/adSpaces\`), (snap) => {
      const fetchedSlots: AdSpace[] = [];
      snap.forEach(d => fetchedSlots.push({ id: d.id, ...d.data() } as AdSpace));
      setSlots(fetchedSlots);
    });`;
const dashAfter = `const unsubSlots = onSnapshot(collection(db, \`creatorProfiles/\${user.uid}/adSpaces\`), (snap) => {
      const fetchedSlots: AdSpace[] = [];
      snap.forEach(d => fetchedSlots.push({ id: d.id, ...d.data() } as AdSpace));
      setSlots(fetchedSlots);
    });

    const unsubTxs = onSnapshot(collection(db, \`creatorProfiles/\${user.uid}/transactions\`), (snap) => {
        const fetchedTxs: TransactionType[] = [];
        snap.forEach(d => fetchedTxs.push({ id: d.id, ...d.data() } as TransactionType));
        fetchedTxs.sort((a, b) => b.createdAt - a.createdAt);
        setTransactions(fetchedTxs);
    });`;
content = content.replace(dashBefore, dashAfter);
content = content.replace(dashBefore.replace(/\n/g, '\r\n'), dashAfter);

const cleanupBefore = `return () => {
      unsubProfile();
      unsubSlots();
      unsubStories();
      unsubNotifications();
    };`;
const cleanupAfter = `return () => {
      unsubProfile();
      unsubSlots();
      unsubStories();
      unsubNotifications();
      if (typeof unsubTxs !== 'undefined') unsubTxs();
    };`;
content = content.replace(cleanupBefore, cleanupAfter);
content = content.replace(cleanupBefore.replace(/\n/g, '\r\n'), cleanupAfter);

// Wallet render logic
const walletTxBefore = `{[
                       { id: 1, type: 'sale', title: 'Alquiler: Zona Grande', brand: 'Nike Corp', amount: 150.00, date: 'Hoy, 14:30', status: 'completed' },
                       { id: 2, type: 'withdraw', title: 'Retiro a Cuenta Bancaria', brand: '**** 4545', amount: -200.00, date: 'Ayer, 09:15', status: 'completed' },
                       { id: 3, type: 'sale', title: 'Alquiler: Minizona', brand: 'Startup X', amount: 45.00, date: 'Mar 12, 18:40', status: 'completed' },
                       { id: 4, type: 'sale', title: 'Alquiler: Subzona', brand: 'Adidas', amount: 100.00, date: 'Mar 10, 11:20', status: 'completed' },
                       { id: 5, type: 'withdraw', title: 'Retiro a PayPal', brand: 'user@email.com', amount: -150.00, date: 'Mar 05, 10:00', status: 'completed' },
                    ].map((tx, i) => (
                       <div key={tx.id} className={cn("flex items-center justify-between p-4", i !== 0 && "border-t border-gray-100")}>
                          <div className="flex items-center gap-4">
                             <div className={cn("w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-sm", 
                                tx.type === 'sale' ? "bg-gray-50 text-gray-900 border border-gray-200" : "bg-white border text-gray-900 border-gray-200"
                             )}>
                                {tx.type === 'sale' ? <ArrowDownLeft className="w-6 h-6" /> : <ArrowUpRight className="w-6 h-6" />}
                             </div>
                             <div>
                                <p className="font-bold text-gray-900 text-sm">{tx.title}</p>
                                <p className="text-gray-500 text-xs mt-0.5">{tx.brand} • {tx.date}</p>
                             </div>
                          </div>
                          <div className="text-right">
                             <p className={cn("font-black text-base", tx.type === 'sale' ? "text-gray-900" : "text-gray-500")}>
                                {tx.type === 'sale' ? '+' : ''}{tx.amount.toLocaleString('en-US', {style: 'currency', currency: 'USD'})}
                             </p>
                             <p className="text-gray-400 text-[10px] uppercase font-bold mt-1 tracking-wider text-right">Completado</p>
                          </div>
                       </div>
                    ))}`;
                    
const walletTxAfter = `{transactions.length === 0 ? <p className="text-center text-gray-400 py-6 text-sm font-medium">No hay transacciones aún.</p> : transactions.map((tx, i) => (
                       <div key={tx.id} className={cn("flex items-center justify-between p-4", i !== 0 && "border-t border-gray-100")}>
                          <div className="flex items-center gap-4">
                             <div className={cn("w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-sm", 
                                tx.type === 'income' ? "bg-gray-50 text-gray-900 border border-gray-200" : "bg-white border text-gray-900 border-gray-200"
                             )}>
                                {tx.type === 'income' ? <ArrowDownLeft className="w-6 h-6" /> : <ArrowUpRight className="w-6 h-6" />}
                             </div>
                             <div className="flex flex-col min-w-0">
                                <p className="font-bold text-gray-900 text-sm truncate">{tx.description || (tx.type === 'income' ? 'Ingreso' : 'Retiro')}</p>
                                <p className="text-gray-500 text-xs mt-0.5 truncate">{new Date(tx.createdAt).toLocaleDateString()}</p>
                             </div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                             <p className={cn("font-black text-base", tx.type === 'income' ? "text-green-600" : "text-gray-900")}>
                                {tx.type === 'income' ? '+' : '-'}{tx.amount.toLocaleString('en-US', {style: 'currency', currency: 'USD'})}
                             </p>
                             <p className="text-gray-400 text-[10px] uppercase font-bold mt-1 tracking-wider text-right">Completado</p>
                          </div>
                       </div>
                    ))}`;
content = content.replace(walletTxBefore, walletTxAfter);
content = content.replace(walletTxBefore.replace(/\n/g, '\r\n'), walletTxAfter);

// 4. Avatar cut by banner
const avatarBefore = `<div className="px-4 flex flex-col relative z-20 -mt-[40px] mb-3 shrink-0">`;
const avatarAfter = `<div className="px-4 flex flex-col relative z-50 -mt-[40px] mb-3 shrink-0">`;
content = content.replace(avatarBefore, avatarAfter);

const avatarImgBefore = `<div className="relative inline-block w-fit mx-auto">
              <div className="absolute inset-0 bg-pink-500 rounded-full blur-xl opacity-20 scale-150 animate-pulse"></div>
              <img src={profile.photoURL} alt={profile.displayName} className="w-[80px] h-[80px] rounded-full border-[4px] border-white object-cover bg-white shadow-[0_10px_25px_rgba(0,0,0,0.1)] relative z-10" />
           </div>`;
const avatarImgAfter = `<div className="relative inline-block w-fit mx-auto z-[100]">
              <div className="absolute inset-0 bg-pink-500 rounded-full blur-xl opacity-20 scale-150 animate-pulse"></div>
              <img src={profile.photoURL} alt={profile.displayName} className="w-[80px] h-[80px] rounded-full border-[4px] border-white object-cover bg-white shadow-xl relative z-10 isolate" style={{ transform: 'translateZ(10px)' }} />
           </div>`;
content = content.replace(avatarImgBefore, avatarImgAfter);
content = content.replace(avatarImgBefore.replace(/\n/g, '\r\n'), avatarImgAfter);


// 5. Tenant Modal redesign
const tenantBefore = `{viewingTenantSlot.image && (
                       <div className="w-full aspect-[4/5] bg-gray-900 rounded-2xl overflow-hidden mb-6 relative shadow-inner flex items-center justify-center">
                          <img src={viewingTenantSlot.image} className="w-full h-full object-contain" alt="Ad" />
                       </div>
                    )}
                    <div className="flex items-center justify-center gap-3 mb-4 w-full px-2">
                       {viewingTenantSlot.brandImg && <img src={viewingTenantSlot.brandImg} className="w-12 h-12 rounded-full border border-gray-200 shadow-sm shrink-0" alt="brand" />}
                       <h3 className="font-black text-2xl text-gray-900 truncate">{viewingTenantSlot.brand}</h3>
                    </div>
                    {viewingTenantSlot.caption && (
                       <p className="text-gray-600 text-center mb-6 leading-relaxed px-4 font-medium">
                          {viewingTenantSlot.caption}
                       </p>
                    )}`;
const tenantAfter = `{viewingTenantSlot.image && (
                       <div className="w-full mb-6 relative rounded-[20px] overflow-hidden shadow-lg border border-gray-100 flex items-center justify-center bg-gray-50">
                          <img src={viewingTenantSlot.image} className="w-full h-auto object-contain max-h-[60vh]" alt="Ad" />
                       </div>
                    )}
                    <div className="flex items-center justify-center gap-3 mb-4 w-full px-2">
                       {viewingTenantSlot.brandImg && <img src={viewingTenantSlot.brandImg} className="w-10 h-10 rounded-full border border-gray-200 shadow-sm shrink-0 object-cover" alt="brand" />}
                       <h3 className="font-black text-xl md:text-2xl text-gray-900 truncate">{viewingTenantSlot.brand}</h3>
                    </div>
                    {viewingTenantSlot.caption && (
                       <p className="text-gray-700 text-center mb-6 leading-relaxed px-4 font-medium text-sm md:text-base whitespace-pre-wrap">
                          {viewingTenantSlot.caption.split(/(https?:\\/\\/[^\\s]+)/g).map((part, i) => 
                              part.match(/(https?:\\/\\/[^\\s]+)/g) 
                                ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mx-1 px-2.5 py-1 bg-pink-50 text-pink-600 rounded-lg font-bold hover:bg-pink-100 transition-colors shadow-sm"><ArrowUpRight className="w-3.5 h-3.5" /> Visitar Enlace</a>
                                : part
                          )}
                       </p>
                    )}`;
content = content.replace(tenantBefore, tenantAfter);
content = content.replace(tenantBefore.replace(/\n/g, '\r\n'), tenantAfter);

fs.writeFileSync(file, content, 'utf-8');
console.log('Patch 2 applied correctly!');
