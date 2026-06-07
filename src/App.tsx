import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, googleProvider, functions } from './firebase';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, increment, collectionGroup, orderBy, limit, startAfter, arrayUnion, arrayRemove, writeBatch, addDoc, deleteField, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Wallet, LogOut, LayoutDashboard, Share2, PlusSquare, Image as ImageIcon, Settings, User, Plus, Trash2, Loader2, UploadCloud, Eye, Compass, ArrowUpRight, ArrowDownLeft, History, TrendingUp, Clock, CheckCircle2, DollarSign, CreditCard, Heart, MessageCircle, ChevronLeft, Bell, Search, Camera, Sun, Moon, X } from 'lucide-react';
import { uploadToCloudinary, processMediaFile } from './lib/cloudinary';
import { cn } from './lib/cn';
import type { AdSpace, Connection, CreatorProfile, Notification, ProfileCard, ProfileLink, Story, StoryOverlay, TransactionType } from './types';
import { buildTokenMarket, formatTokenAmount, formatTokenPrice, TokenMarketPanel, TokenPriceStrip, type MarketOrder, type RealTokenOrder, type TokenMarket, type TokenOrderType } from './components/TokenMarket';

// -------------------------------------------------------------
// GLOBAL MODAL SYSTEM
// -------------------------------------------------------------
type AppModalState = { id: number; message: string; type: 'success' | 'error' | 'info' } | null;
let _setAppModal: ((s: AppModalState) => void) | null = null;

function showAlert(message: string, type: 'success' | 'error' | 'info' = 'info') {
  _setAppModal?.({ id: Date.now(), message, type });
}

function normalizeUsername(value: string, fallback = 'user') {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || fallback;
}

const TOKENS_PER_EURO = 10;

async function placeOrFillTokenOrder({ userId, creatorId, side, orderType, price, amount, symbol, matchingOrders }: { userId: string; creatorId: string; side: 'buy' | 'sell'; orderType: TokenOrderType; price: number; amount: number; symbol: string; matchingOrders: RealTokenOrder[] }) {
  const now = Date.now();
  const candidateOrders = matchingOrders.filter(o => o.side !== side && o.userId !== userId);
  const matchOrder = side === 'buy'
    ? candidateOrders.filter(o => o.price <= price).sort((a, b) => a.price - b.price)[0]
    : candidateOrders.filter(o => o.price >= price).sort((a, b) => b.price - a.price)[0];

  if (matchOrder) {
    const fillAmount = Math.min(matchOrder.amount, amount);
    const fillPrice = matchOrder.price;
    const cost = fillAmount * fillPrice;
    const buyerId = side === 'buy' ? userId : matchOrder.userId;
    const sellerId = side === 'sell' ? userId : matchOrder.userId;

    await runTransaction(db, async (t) => {
      const orderRef = doc(db, 'tokenOrders', matchOrder.id);
      const buyerHoldingRef = doc(db, 'creatorTokenHolders', `${buyerId}_${creatorId}`);
      const sellerHoldingRef = doc(db, 'creatorTokenHolders', `${sellerId}_${creatorId}`);
      const buyerProfileRef = doc(db, 'creatorProfiles', buyerId);
      const sellerProfileRef = doc(db, 'creatorProfiles', sellerId);

      const [orderSnap, buyerHoldingSnap, sellerHoldingSnap, buyerProfileSnap, sellerProfileSnap] = await Promise.all([
        t.get(orderRef), t.get(buyerHoldingRef), t.get(sellerHoldingRef), t.get(buyerProfileRef), t.get(sellerProfileRef),
      ]);

      if (!orderSnap.exists() || orderSnap.data()?.status !== 'open') throw new Error('La orden ya no está disponible.');
      const orderData = orderSnap.data()!;
      // makerHasEscrow: the maker pre-froze their funds/tokens when placing the order
      const makerHasEscrow = orderData.frozenBalance !== undefined;
      const makerIsSell = matchOrder.side === 'sell'; // side==='buy': taker buys, maker was selling

      const sellerBalance = sellerHoldingSnap.exists() ? sellerHoldingSnap.data()?.balance || 0 : 0;
      // Skip seller token check if maker is seller with escrow (tokens already pre-deducted)
      if (!makerHasEscrow || !makerIsSell) {
        if (sellerBalance < fillAmount) throw new Error('El vendedor no tiene tokens suficientes.');
      }
      const buyerWallet = buyerProfileSnap.exists() ? buyerProfileSnap.data()?.walletBalance || 0 : 0;
      // Skip buyer wallet check if maker is buyer with escrow (funds already pre-deducted)
      if (!makerHasEscrow || makerIsSell) {
        if (buyerWallet < cost) throw new Error('Saldo insuficiente para ejecutar la compra.');
      }
      const sellerWallet = sellerProfileSnap.exists() ? sellerProfileSnap.data()?.walletBalance || 0 : 0;

      const remaining = (orderData.amount as number) - fillAmount;
      if (remaining > 0) {
        // Reduce frozenBalance proportionally on partial fills so cancel returns correct amount
        const updatedOrder: Record<string, unknown> = { amount: remaining, updatedAt: now };
        if (makerHasEscrow) updatedOrder.frozenBalance = makerIsSell ? remaining : remaining * matchOrder.price;
        t.update(orderRef, updatedOrder);
      } else {
        t.update(orderRef, { status: 'filled', filledAt: now, filledBy: userId });
      }
      // Only deduct seller tokens if not pre-frozen (maker sell escrow already deducted them)
      if (!makerHasEscrow || !makerIsSell) {
        t.update(sellerHoldingRef, { balance: sellerBalance - fillAmount, updatedAt: now });
      }
      if (buyerHoldingSnap.exists()) {
        t.update(buyerHoldingRef, { balance: (buyerHoldingSnap.data()?.balance || 0) + fillAmount, updatedAt: now });
      } else {
        t.set(buyerHoldingRef, { userId: buyerId, creatorId, balance: fillAmount, earned: 0, createdAt: now, updatedAt: now });
      }
      // Only deduct buyer wallet if not pre-frozen (maker buy escrow already deducted funds)
      if (!makerHasEscrow || makerIsSell) {
        t.update(buyerProfileRef, { walletBalance: buyerWallet - cost });
      }
      t.update(sellerProfileRef, { walletBalance: sellerWallet + cost });
      t.set(doc(collection(db, 'tokenTrades')), { creatorId, buyerId, sellerId, price: fillPrice, amount: fillAmount, symbol, createdAt: now });
      t.set(doc(collection(db, `users/${matchOrder.userId}/notifications`)), {
        type: 'token_mint',
        message: `Tu orden de ${matchOrder.side === 'sell' ? 'venta' : 'compra'} de ${fillAmount.toFixed(2)} ${symbol} tokens ha sido ejecutada a ${fillPrice.toFixed(2)} euros.`,
        fromId: userId, read: false, createdAt: now,
      });
    });

    return { filled: true, message: `Orden ejecutada: ${fillAmount.toFixed(2)} ${symbol} a ${fillPrice.toFixed(2)} euros.` };
  }

  if (orderType === 'market') throw new Error('No hay liquidez suficiente para ejecutar a mercado.');

  // Escrow: deduct funds/tokens immediately and store frozenBalance so cancel can return them
  await runTransaction(db, async (t) => {
    if (side === 'sell') {
      const holdingRef = doc(db, 'creatorTokenHolders', `${userId}_${creatorId}`);
      const holdingSnap = await t.get(holdingRef);
      const balance = holdingSnap.exists() ? holdingSnap.data()?.balance || 0 : 0;
      if (balance < amount) throw new Error('No tienes tokens suficientes para vender.');
      t.update(holdingRef, { balance: balance - amount, updatedAt: now });
    } else {
      const profileRef = doc(db, 'creatorProfiles', userId);
      const profileSnap = await t.get(profileRef);
      const walletBalance = profileSnap.exists() ? profileSnap.data()?.walletBalance || 0 : 0;
      const frozenFunds = amount * price;
      if (walletBalance < frozenFunds) throw new Error('Saldo insuficiente para publicar esta orden de compra.');
      t.update(profileRef, { walletBalance: walletBalance - frozenFunds });
    }
    t.set(doc(collection(db, 'tokenOrders')), {
      creatorId, side, price, amount, symbol, userId,
      status: 'open',
      frozenBalance: side === 'sell' ? amount : amount * price,
      createdAt: now
    });
  });

  return {
    filled: false,
    message: side === 'buy'
      ? `Oferta de compra por ${amount} ${symbol} publicada en el order book.`
      : `Oferta de venta por ${amount} ${symbol} publicada en el order book.`,
  };
}

async function cancelTokenOrder(orderId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const now = Date.now();
  await runTransaction(db, async (t) => {
    const orderRef = doc(db, 'tokenOrders', orderId);
    const orderSnap = await t.get(orderRef);
    if (!orderSnap.exists() || orderSnap.data()?.status !== 'open') throw new Error('La orden ya no está disponible.');
    const orderData = orderSnap.data()!;
    if (orderData.userId !== user.uid) throw new Error('No autorizado.');
    t.update(orderRef, { status: 'cancelled', cancelledAt: now });
    // Return pre-frozen funds or tokens (only if order used escrow)
    if (orderData.frozenBalance !== undefined && orderData.frozenBalance > 0) {
      if (orderData.side === 'buy') {
        const profileRef = doc(db, 'creatorProfiles', user.uid);
        const profileSnap = await t.get(profileRef);
        t.update(profileRef, { walletBalance: (profileSnap.data()?.walletBalance || 0) + orderData.frozenBalance });
      } else {
        const holdingRef = doc(db, 'creatorTokenHolders', `${user.uid}_${orderData.creatorId}`);
        const holdingSnap = await t.get(holdingRef);
        if (holdingSnap.exists()) {
          t.update(holdingRef, { balance: (holdingSnap.data()?.balance || 0) + orderData.frozenBalance, updatedAt: now });
        } else {
          t.set(holdingRef, { userId: user.uid, creatorId: orderData.creatorId, balance: orderData.frozenBalance, earned: 0, createdAt: now, updatedAt: now });
        }
      }
    }
  });
}

function AppModalOverlay() {
  const [modal, setModal] = useState<AppModalState>(null);
  useEffect(() => { _setAppModal = setModal; return () => { _setAppModal = null; }; }, []);

  const iconMap = { success: <CheckCircle2 className="w-10 h-10 text-teal-500" />, error: <X className="w-10 h-10 text-pink-500" />, info: <Settings className="w-10 h-10 text-indigo-600" /> };
  const borderMap = { success: 'border-teal-500/30', error: 'border-pink-500/30', info: 'border-indigo-600/30' };
  const btnMap = { success: 'bg-teal-500 hover:bg-teal-600 text-white', error: 'bg-pink-500 hover:bg-pink-600 text-white', info: 'bg-gray-800 hover:bg-gray-700 text-white' };

  return (
    <AnimatePresence>
      {modal && (
        <>
          <motion.div key={`bd-${modal.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal(null)} className="fixed inset-0 bg-black/60 z-[999] backdrop-blur-sm" />
          <motion.div key={`md-${modal.id}`} initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 20 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }} className="fixed inset-0 z-[999] flex items-center justify-center p-6">
            <div className={cn("bg-gray-100 rounded-[28px] p-7 w-full max-w-[320px] shadow-2xl flex flex-col items-center gap-4 border", borderMap[modal.type])}>
              {iconMap[modal.type]}
              <p className="text-gray-900 text-center text-[15px] font-semibold leading-snug">{modal.message}</p>
              <button onClick={() => setModal(null)} className={cn("w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-95", btnMap[modal.type])}>
                Entendido
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

let bodyScrollLockCount = 0;

function useLockBodyScroll(isLocked: boolean | null | undefined) {
  useEffect(() => {
    if (isLocked) {
      bodyScrollLockCount++;
      document.body.style.overflow = 'hidden';
      
      return () => {
        bodyScrollLockCount--;
        if (bodyScrollLockCount <= 0) {
          bodyScrollLockCount = 0;
          document.body.style.overflow = '';
        }
      };
    }
  }, [isLocked]);
}

// -------------------------------------------------------------
// STORY VIEWER COMPONENT
// -------------------------------------------------------------
function StoryViewer({ 
  stories, 
  initialIndex, 
  onClose 
}: { 
  stories: Story[], 
  initialIndex: number, 
  onClose: () => void 
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentIndex < stories.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        onClose();
      }
    }, 5000); // 5 seconds per story

    return () => clearTimeout(timer);
  }, [currentIndex, stories.length, onClose]);

  const handlePress = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) {
      if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    } else {
      if (currentIndex < stories.length - 1) setCurrentIndex(currentIndex + 1);
      else onClose();
    }
  };

  const story = stories[currentIndex];

  if (!story) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black z-50 flex flex-col max-w-[500px] mx-auto select-none" onClick={handlePress}>
        {/* Progress bars */}
        <div className="absolute top-2 inset-x-2 flex gap-1 z-20 pointer-events-none">
            {stories.map((s, i) => (
               <div key={s.id} className="h-[3px] flex-1 bg-white/30 rounded-full overflow-hidden">
                  {i === currentIndex ? (
                     <motion.div 
                        key={currentIndex}
                        className="h-full bg-white"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 5, ease: "linear" }}
                     />
                  ) : (
                     <div className="h-full bg-white" style={{ width: i < currentIndex ? "100%" : "0%" }} />
                  )}
               </div>
            ))}
        </div>
        
        <div className="absolute top-6 inset-x-4 flex items-center justify-between z-30">
            <div className="flex items-center gap-2 pointer-events-none">
                <img src={story.brandImg} alt={story.brand} className="w-8 h-8 rounded-full border border-white/50 bg-black/50 object-cover" />
                <span className="text-white font-bold drop-shadow-md text-sm">{story.brand}</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 text-white/80 hover:text-white bg-black/20 rounded-full backdrop-blur-sm transition-colors cursor-pointer active:scale-95">
                <PlusSquare className="w-6 h-6 rotate-45" />
            </button>
        </div>
        
        {(!story.mediaType || story.mediaType === 'image') ? (
            <img src={story.image} className="w-full h-full object-contain" alt="Story" style={{ filter: story.filter || 'none' }} />
        ) : (
            <video 
               src={story.image}
               className="w-full h-full object-contain" 
               autoPlay 
               playsInline 
               muted 
               style={{ filter: story.filter || 'none' }}
               onTimeUpdate={(e) => {
                   const v = e.currentTarget;
                   const start = story.clipStart || 0;
                   const duration = story.clipDuration || 10;
                   if (v.currentTime >= start + duration) {
                       v.currentTime = start;
                   }
               }}
               onLoadedMetadata={(e) => {
                   if (story.clipStart !== undefined) {
                       e.currentTarget.currentTime = story.clipStart;
                   }
               }}
            />
        )}

        {story.overlays && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {(() => {
                    try {
                        const overlays: StoryOverlay[] = JSON.parse(story.overlays);
                        return overlays.map((overlay, idx) => (
                            <div 
                                key={idx}
                                className="absolute transform-gpu whitespace-pre-wrap text-center flex flex-col items-center justify-center"
                                style={{ 
                                    left: `50%`, 
                                    top: `50%`, 
                                    transform: `translate(-50%, -50%) translate(${overlay.x}px, ${overlay.y}px) scale(${overlay.scale}) rotate(${overlay.rotation}deg)`,
                                    color: overlay.color || '#ffffff',
                                    fontFamily: overlay.fontFamily || 'Inter, sans-serif',
                                    fontSize: overlay.type === 'emoji' ? '64px' : '32px',
                                    lineHeight: 1.1,
                                    textShadow: overlay.textStyle === 'bordered' ? '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000' :
                                                overlay.textStyle === 'neon' ? `0 0 10px ${overlay.color}, 0 0 20px ${overlay.color}, 0 0 30px ${overlay.color}` :
                                                '2px 2px 4px rgba(0,0,0,0.5)',
                                    backgroundColor: overlay.textStyle === 'bubble' ? 'rgba(0,0,0,0.5)' : 'transparent',
                                    padding: overlay.textStyle === 'bubble' ? '8px 16px' : '0',
                                    borderRadius: overlay.textStyle === 'bubble' ? '16px' : '0'
                                }}
                            >
                                {overlay.content}
                            </div>
                        ));
                    } catch (e) {
                        return null;
                    }
                })()}
            </div>
        )}
    </motion.div>
  );
}

// -------------------------------------------------------------
// UI COMPONENTS
// -------------------------------------------------------------
function ImageUpload({ value, onChange, label, className, variant = 'banner' }: { value: string, onChange: (url: string) => void, label?: string, className?: string, variant?: 'avatar' | 'banner' | 'story' }) {
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
       const url = await uploadToCloudinary(file);
       onChange(url);
    } catch (e: any) {
       showAlert("Error subiendo imagen. Verifica Cloudinary config.", 'error');
    }
    setIsUploading(false);
  };

  return (
     <div className={cn("flex flex-col gap-1 w-full", className)}>
        {label && <label className="font-bold text-gray-700 ml-1 text-sm text-center">{label}</label>}
        <div className={cn("relative flex justify-center", variant === 'avatar' && "mx-auto")}>
           {value ? (
              <div className={cn("relative overflow-hidden group isolate", variant === 'avatar' ? 'w-[80px] h-[80px] rounded-full shadow-[0_10px_25px_rgba(0,0,0,0.1)]' : 'w-full h-32 rounded-[24px]')}>
                 <img src={value} className="w-full h-full object-cover" alt="Upload preview" />
                 <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => onChange('')} className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition"><Trash2 className="w-4 h-4"/></button>
                 </div>
                 <div className={cn("absolute inset-0 pointer-events-none", variant === 'avatar' ? 'rounded-full border-[4px] border-white' : 'rounded-[24px] border border-gray-200')} />
              </div>
           ) : (
              <label className={cn("bg-gray-50 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 hover:border-pink-500 hover:bg-pink-50 transition cursor-pointer", isUploading && "pointer-events-none opacity-50", variant === 'avatar' ? 'w-[80px] h-[80px] rounded-full border-[4px] border-white shadow-sm' : variant === 'story' ? 'w-auto h-auto py-2 px-4 border-none !bg-transparent rounded-full flex-row gap-2' : 'w-full h-32 rounded-[24px]')}>
                 {isUploading ? <Loader2 className="w-5 h-5 text-gray-400 animate-spin" /> : <ImageIcon className="w-5 h-5 text-gray-500" />}
                 {variant !== 'avatar' && <span className="text-sm font-bold text-gray-500">{isUploading ? 'Subiendo...' : variant === 'story' ? 'Foto' : 'Subir'}</span>}
                 <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>
           )}
        </div>
     </div>
  );
}

type RenderItem = 
  | { type: 'single', slot: AdSpace, order: number }
  | { type: 'group25', id: string, slots: AdSpace[], order: number };

function groupSlotsForRender(slots: AdSpace[]): RenderItem[] {
  const items: RenderItem[] = [];
  const grouped25s: Record<string, AdSpace[]> = {};

  slots.forEach(s => {
    if (s.width === 25) {
      const parentId = s.id.substring(0, s.id.lastIndexOf('-'));
      if (!grouped25s[parentId]) grouped25s[parentId] = [];
      grouped25s[parentId].push(s);
    } else {
      items.push({ type: 'single', slot: s, order: s.order });
    }
  });

  Object.entries(grouped25s).forEach(([parentId, children]) => {
    const minOrder = Math.min(...children.map(c => c.order));
    items.push({ type: 'group25', id: parentId, slots: children, order: minOrder });
  });

  return items.sort((a, b) => a.order - b.order);
}

const SlotCard: React.FC<{ 
  slot: AdSpace, 
  isSelected?: boolean,
  onRent?: (s: AdSpace) => void,
  isAdmin?: boolean,
  onDivide?: (id: string) => void,
  onJoin?: (id: string) => void,
  onEditPrices?: (s: AdSpace) => void,
  onDelete?: (id: string) => void,
  onViewTenant?: (s: AdSpace) => void
}> = ({ slot, isSelected, onRent, isAdmin, onDivide, onJoin, onEditPrices, onDelete, onViewTenant }) => {
  const gridClass = {
    25: 'col-span-1 row-span-1',
    50: 'col-span-2 row-span-2',
    75: 'col-span-3 row-span-2',
    100: 'col-span-4 row-span-2'
  }[slot.width as 25 | 50 | 75 | 100] || 'col-span-4 row-span-2';

  const aspectClass = {
    25: 'aspect-[10/7.65]',
    50: 'aspect-[10/7.65]',
    75: 'aspect-[5/2.55]',
    100: 'aspect-[20/7.65]'
  }[slot.width as 25 | 50 | 75 | 100] || 'aspect-[20/7.65]';

  const bgClass = {
    25: 'bg-white border border-gray-200 text-gray-900',
    50: 'bg-white border border-gray-200 text-gray-900',
    75: 'bg-white border border-gray-200 text-gray-900',
    100: 'bg-white border border-gray-200 text-gray-900'
  }[slot.width as 25 | 50 | 75 | 100] || 'bg-white border border-gray-200 text-gray-900';

  const iconColor = {
    25: 'text-gray-400 group-hover:text-gray-600',
    50: 'text-gray-400 group-hover:text-gray-600',
    75: 'text-gray-400 group-hover:text-gray-600',
    100: 'text-gray-400 group-hover:text-gray-600'
  }[slot.width as 25 | 50 | 75 | 100] || 'text-gray-400 group-hover:text-gray-600';

  return (
    <div className={cn("relative w-full h-full rounded-[24px] transition-all transform-gpu [transform:translateZ(0)]", gridClass, isSelected && "ring-4 ring-pink-500 scale-[0.98] blur-none shadow-xl z-10")}>
      <div className={cn("w-full h-full shadow-sm rounded-[24px] overflow-hidden group relative flex flex-col items-center justify-center transition-colors block isolate", bgClass, aspectClass)} style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', clipPath: 'inset(0 round 24px)' }}>
         {slot.isRented ? (
               <button onClick={() => { 
                  if (slot.forResale && onRent && !isAdmin) {
                     onRent(slot);
                  } else if (onViewTenant) {
                     onViewTenant(slot);
                  }
               }} className="absolute inset-0 w-full h-full rounded-[24px] bg-black flex flex-col justify-end overflow-hidden outline-none text-left cursor-pointer group/rented transition-transform active:scale-[0.98] block" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', clipPath: 'inset(0 round 24px)' }}>
                {slot.image ? (
                   <div className="absolute inset-0 w-full h-full rounded-[24px] overflow-hidden" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', clipPath: 'inset(0 round 24px)' }}>
                      <img src={slot.image} className="w-full h-full object-cover object-center" alt="Ad" />
                   </div>
                ) : (
                   <>
                      <div className={cn("absolute inset-0 w-full h-full bg-gray-900 border-2 border-dashed flex flex-col items-center justify-center opacity-80", slot.forResale ? "border-green-500" : "border-gray-700")}>
                         <span className={cn("font-bold text-xs uppercase tracking-widest rotate-[-15deg]", slot.forResale ? "text-green-400" : "text-gray-500")}>{slot.forResale ? 'EN REVENTA' : (slot.brand || 'RESERVADO')}</span>
                      </div>
                      {slot.brand && !slot.forResale && (
                         <div className="absolute top-2 left-2 md:top-3 md:left-3 bg-white/90 backdrop-blur-md px-2 py-1 md:px-3 md:py-1.5 rounded-full text-[8px] md:text-[10px] font-bold text-gray-900 flex items-center gap-1 md:gap-1.5 shadow-sm max-w-[80%] overflow-hidden z-10">
                            {slot.brandImg && <img src={slot.brandImg} className="w-3 h-3 md:w-3.5 md:h-3.5 rounded-full shrink-0" alt="brand" />}
                            <span className="truncate leading-none">{slot.brand}</span>
                         </div>
                      )}
                      <div className={cn("absolute top-2 right-2 md:top-3 md:right-3 backdrop-blur-md px-1.5 py-0.5 md:px-2 md:py-1 rounded-full text-[7px] md:text-[9px] text-white font-bold tracking-wide z-10", slot.forResale ? "bg-green-600/80" : "bg-black/60")}>
                         {slot.forResale ? 'Reventa' : 'Patroc.'}
                      </div>
                      {slot.caption && !slot.forResale && (
                         <div className="relative z-10 p-2 md:p-3 bg-gradient-to-t from-black via-black/40 to-transparent w-full">
                             <p className="text-white font-medium text-[8px] md:text-[11px] leading-tight line-clamp-2 md:line-clamp-3">{slot.caption}</p>
                         </div>
                      )}
                   </>
                )}
             </button>
         ) : (
             <button 
                onClick={() => {
                  if (isAdmin && onEditPrices) onEditPrices(slot);
                  else if (onRent && !isAdmin) onRent(slot);
                }}
                className={cn(
                  "absolute inset-0 w-full h-full bg-transparent transition-colors flex flex-col items-center justify-center rounded-[24px]"
                )}
             >
                <div className={cn(
                  "w-8 h-8 md:w-10 md:h-10 bg-white shadow-sm rounded-full flex items-center justify-center transition-all",
                  "group-hover:scale-110 group-hover:shadow-md",
                  isAdmin && "mb-1 md:mb-2"
                )}>
                   <LayoutDashboard className={cn("w-4 h-4 md:w-5 md:h-5 transition-colors", iconColor)} />
                </div>
                {isAdmin && <span className="font-bold text-gray-900 text-[9px] md:text-sm text-center leading-tight px-1">Precios</span>}
             </button>
         )}

         {(!slot.isRented && (onDivide || onJoin || onDelete)) && (
            <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 flex gap-1 z-20">
               {onDelete && (
                  <button onClick={(e) => { e.stopPropagation(); onDelete(slot.id); }} className="bg-red-50/90 backdrop-blur-sm p-1.5 md:p-1.5 rounded-lg md:rounded-lg shadow-sm border border-red-100 text-red-500 hover:text-red-700 hover:bg-red-100" title="Borrar">
                     <Trash2 className="w-3.5 h-3.5 md:w-3.5 md:h-3.5" />
                  </button>
               )}
               {slot.width > 25 && onDivide && (
                  <button onClick={(e) => { e.stopPropagation(); onDivide(slot.id); }} className="bg-white/90 backdrop-blur-sm p-1.5 md:p-1.5 rounded-lg md:rounded-lg shadow-sm border border-gray-100 text-gray-600 hover:text-pink-500 hover:bg-white" title="Dividir">
                     <Share2 className="w-3.5 h-3.5 md:w-3.5 md:h-3.5 rotate-90" />
                  </button>
               )}
               {onJoin && (
                  <button onClick={(e) => { e.stopPropagation(); onJoin(slot.id); }} className="bg-white/90 backdrop-blur-sm p-1.5 md:p-1.5 rounded-lg md:rounded-lg shadow-sm border border-gray-100 text-gray-600 hover:text-blue-500 hover:bg-white" title="Unir">
                     <PlusSquare className="w-3.5 h-3.5 md:w-3.5 md:h-3.5" />
                  </button>
               )}
            </div>
         )}
         <div className="absolute inset-0 rounded-[24px] border border-gray-200 pointer-events-none z-20" />
      </div>
    </div>
  );
};

// -------------------------------------------------------------
// APP ENTRY POINT
// -------------------------------------------------------------
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null | undefined>(undefined);
  
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">Loading app...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/login" element={<Login user={user} />} />
        <Route path="/dashboard" element={<Dashboard user={user} />} />
        <Route path="/vip/:username" element={<PublicProfile currentUser={user} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <AppModalOverlay />
    </BrowserRouter>
  );
}

// -------------------------------------------------------------
// HOME
// -------------------------------------------------------------
function Home({ user }: { user: FirebaseUser | null }) {
  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col font-sans">
      <header className="w-full max-w-5xl mx-auto p-6 flex justify-between items-center">
        <h1 className="font-['Space_Grotesk'] text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">ZonaVip</h1>
        <div>
          {user ? (
            <Link to="/dashboard" className="px-5 py-2 bg-gray-900 text-white rounded-full font-medium hover:bg-gray-800 transition">Ir al Dashboard</Link>
          ) : (
            <Link to="/login" className="px-5 py-2 bg-gray-900 text-white rounded-full font-medium hover:bg-gray-800 transition">Acceder / Registro</Link>
          )}
        </div>
      </header>
      <main className="flex-1 w-full flex flex-col">
        <section className="max-w-5xl mx-auto flex flex-col items-center justify-center p-6 text-center py-16 md:py-24">
          <h2 className="text-4xl md:text-6xl font-black text-gray-900 tracking-tight leading-tight mb-6">Monetiza tu perfil con <br/><span className="text-pink-500">Espacios VIP</span></h2>
          <p className="text-xl text-gray-500 max-w-2xl mb-10">Convierte tu influencia en ingresos alquilando espacios publicitarios en tu propio perfil. Maneja temporalidades y precios.</p>
          {user ? (
            <Link to="/dashboard" className="px-8 py-3.5 bg-pink-500 text-white rounded-full font-bold text-lg hover:bg-pink-600 shadow-lg hover:shadow-xl transition-all">Ir a mi Zona Vip</Link>
          ) : (
            <Link to="/login" className="px-8 py-3.5 bg-pink-500 text-white rounded-full font-bold text-lg hover:bg-pink-600 shadow-lg hover:shadow-xl transition-all">Crear mi Zona Vip</Link>
          )}
        </section>

        <section className="bg-white w-full py-20 border-y border-gray-100">
          <div className="max-w-5xl mx-auto px-6">
            <div className="text-center mb-16">
                <h3 className="text-3xl font-black text-gray-900 mb-4">¿Qué es ZonaVip?</h3>
                <p className="text-lg text-gray-500 max-w-2xl mx-auto">Es la plataforma definitiva para que los creadores de contenido gestionen y automaticen el alquiler de espacios publicitarios y menciones en sus perfiles, permitiendo a las marcas anunciarse directamente.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="flex flex-col items-center text-center p-6 bg-pink-50 rounded-[2rem]">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6">
                        <LayoutDashboard className="w-8 h-8 text-pink-500" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3">Escaparate Digital</h4>
                    <p className="text-gray-600">Configura tu perfil público con espacios publicitarios en forma de grilla, dividiendo posiciones fijas con sus respectivos precios por día, semana, mes o año.</p>
                </div>
                <div className="flex flex-col items-center text-center p-6 bg-purple-50 rounded-[2rem]">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6">
                        <Wallet className="w-8 h-8 text-purple-500" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3">Pagos Automáticos</h4>
                    <p className="text-gray-600">Las marcas pueden comprar y reservar los activos en un par de clics. Los fondos se depositarán directamente en tu cartera digital y podrás retirarlos fácilmente.</p>
                </div>
                <div className="flex flex-col items-center text-center p-6 bg-blue-50 rounded-[2rem]">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6">
                        <ImageIcon className="w-8 h-8 text-blue-500" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3">Métricas y Control</h4>
                    <p className="text-gray-600">Alquila diferentes modalidades como posiciones fijas o modo historia tipo feed VIP. Mantén control total y absoluto sobre lo que aparece en tu zona y cuánto cobras.</p>
                </div>
            </div>
          </div>
        </section>
      </main>
      
      <footer className="w-full bg-gray-50 py-8 text-center text-gray-400 font-medium">
        <p>© {new Date().getFullYear()} ZonaVip. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}

// -------------------------------------------------------------
// LOGIN
// -------------------------------------------------------------
function Login({ user }: { user: FirebaseUser | null }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegister) {
        if (!username) return setError('El nombre de usuario es obligatorio');
        const cleanUsername = normalizeUsername(username);
        const usernameQuery = query(collection(db, 'creatorProfiles'), where('username', '==', cleanUsername));
        const usernameSnap = await getDocs(usernameQuery);
        if (!usernameSnap.empty) return setError('Ese nombre de usuario ya está en uso. Elige otro.');
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await initUser(cred.user, cleanUsername);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
         setError('¡El registro con email está deshabilitado! Ve a tu consola de Firebase -> Authentication -> Sign-in method y habilita "Email/Password". O usa Google.');
      } else {
         setError(err.message);
      }
    }
  };

  const handleGoogle = async () => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const docRef = doc(db, 'users', cred.user.uid);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        let generatedUsername = normalizeUsername(cred.user.email?.split('@')[0] || 'user', `user-${cred.user.uid.slice(0, 6)}`);
        const googleUsernameQuery = query(collection(db, 'creatorProfiles'), where('username', '==', generatedUsername));
        const googleUsernameSnap = await getDocs(googleUsernameQuery);
        if (!googleUsernameSnap.empty) generatedUsername = `${generatedUsername}${cred.user.uid.slice(0, 4)}`;
        await initUser(cred.user, generatedUsername);
      }
    } catch (err: any) {
      if (err.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        setError(`Error de dominio: Ve a tu consola de Firebase -> Authentication -> Settings -> Authorized domains y añade exactamente este dominio: ${domain}`);
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError('El popup de Google se cerró antes de terminar.');
      } else {
        setError(`Error de Google Auth: ${err.message || err.code}`);
      }
    }
  };

  const initUser = async (u: FirebaseUser, baseUsername: string) => {
    const cleanUsername = normalizeUsername(baseUsername, `user-${u.uid.slice(0, 6)}`);
    const usernameRef = doc(db, 'usernames', cleanUsername);
    const userRef = doc(db, 'users', u.uid);
    const profileRef = doc(db, 'creatorProfiles', u.uid);

    await runTransaction(db, async (transaction) => {
      const usernameSnap = await transaction.get(usernameRef);
      if (usernameSnap.exists()) throw new Error('El nombre de usuario ya esta en uso. Elige otro.');
      transaction.set(usernameRef, { uid: u.uid });
      transaction.set(userRef, {
        email: u.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      transaction.set(profileRef, {
        username: cleanUsername,
        displayName: baseUsername,
        photoURL: u.photoURL || 'https://i.pravatar.cc/150?u=' + u.uid,
        bannerURL: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80',
        walletBalance: 0,
        prices100: { price1: 15, price7: 45, price30: 150, price365: 600 },
        prices50: { price1: 10, price7: 30, price30: 100, price365: 350 },
        prices25: { price1: 5, price7: 15, price30: 45, price365: 200 },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      for (let i = 1; i <= 5; i++) {
        const space: AdSpace = {
          id: `slot-${i}`,
          width: 100,
          order: i * 1000,
          isRented: false
        };
        transaction.set(doc(db, `creatorProfiles/${u.uid}/adSpaces`, space.id), space);
      }
    });
  };
  return (
    <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center px-4 font-sans">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl flex flex-col items-center">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent mb-6">
          {isRegister ? 'Crea tu Zona Vip' : 'Entrar a tu Zona Vip'}
        </h2>
        {error && <div className="w-full p-3 mb-4 bg-red-50 text-red-600 text-sm rounded-xl">{error}</div>}
        <form onSubmit={handleAuth} className="w-full flex flex-col gap-4">
          {isRegister && (
             <input type="text" placeholder="Nombre de usuario (ej. elrubius)" value={username} onChange={e=>setUsername(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:border-pink-500 focus:bg-white transition" />
          )}
          <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:border-pink-500 focus:bg-white transition" />
          <input type="password" placeholder="Contraseña" value={password} onChange={e=>setPassword(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:border-pink-500 focus:bg-white transition" />
          <button type="submit" className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold mt-2 shadow-md hover:bg-gray-800 transition">
            {isRegister ? 'Registrarse' : 'Iniciar Sesión'}
          </button>
        </form>
        <div className="w-full flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-gray-200"></div><span className="text-sm text-gray-400">o</span><div className="flex-1 h-px bg-gray-200"></div>
        </div>
        <button onClick={handleGoogle} className="w-full py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-medium shadow-sm hover:bg-gray-50 transition flex items-center justify-center gap-3">
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continuar con Google
        </button>
        <p className="mt-8 text-sm text-gray-500">
          {isRegister ? '¿Ya tienes cuenta?' : '¿No tienes tu zona vip?'}
          <button type="button" onClick={()=>setIsRegister(!isRegister)} className="text-pink-500 font-bold ml-1 hover:underline">
            {isRegister ? 'Iniciar Sesión' : 'Regístrate'}
          </button>
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// EXPLORER VIEW COMPONENT
// -------------------------------------------------------------
import { useInView } from 'react-intersection-observer';

const ProfileExploreCard: React.FC<{ p: CreatorProfile }> = ({ p }) => {
   const [hasAvailable, setHasAvailable] = useState<boolean | null>(null);
   const { ref, inView } = useInView({
     triggerOnce: true,
     rootMargin: '200px 0px',
   });

   useEffect(() => {
      if (!p.id || !inView) return;
      const fetchSlots = async () => {
         try {
            const slotsRef = collection(db, `creatorProfiles/${p.id}/adSpaces`);
            const snap = await getDocs(slotsRef);
            let available = false;
            const now = Date.now();
            snap.forEach(d => {
               const data = d.data();
               const isExpired = data.isRented && data.rentEnd && now > data.rentEnd;
               if (!data.isRented || isExpired) available = true;
            });
            setHasAvailable(available);
         } catch(e: any) {
            console.error("Error fetching slots for availability:", e);
            setHasAvailable(false);
         }
      };
      fetchSlots();
   }, [p.id, inView]);

   return (
      <Link 
         key={p.username}
         to={`/vip/${p.username}`}
         ref={ref}
         className="group relative rounded-[24px] overflow-hidden aspect-[4/5] bg-gray-100 shadow-sm hover:shadow-md transition-all active:scale-[0.98] block isolate"
         style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', willChange: 'transform', clipPath: 'inset(0 round 24px)' }}
      >
         {/* Dot indicator */}
         {hasAvailable !== null && (
            <div className="absolute top-2 right-2 z-10">
               <div className={cn("w-3 h-3 rounded-full border-2 border-white shadow-sm", hasAvailable ? "bg-green-500" : "bg-red-500")} />
            </div>
         )}
         {/* Usamos el banner o la foto para el fondo */}
         <div className="absolute inset-0 w-full h-full rounded-[24px] overflow-hidden" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)', clipPath: 'inset(0 round 24px)' }}>
            <img 
               src={p.bannerURL || p.photoURL || `https://i.pravatar.cc/300?u=${p.username}`}
               alt="Fondo del perfil" 
               className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/80" />
         </div>
         
         <div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
               <img 
                  src={p.photoURL || `https://i.pravatar.cc/150?u=${p.username}`}
                  alt={p.displayName}
                  className="w-7 h-7 rounded-full border border-white/50 bg-black/50 object-cover shrink-0" 
               />
               <div className="flex flex-col min-w-0">
                  <span className="text-[13px] font-black tracking-tight text-white truncate flex items-center gap-1 leading-tight">
                     {p.displayName}
                     <CheckCircle2 className="w-3 h-3 text-pink-400 shrink-0" />
                  </span>
                  <span className="text-[10px] font-medium text-white/80 truncate leading-tight">
                     @{p.username}
                  </span>
               </div>
            </div>
            <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/20 text-white backdrop-blur-sm">
                   <Eye className="w-3 h-3 inline-block mr-1" />
                   {(p.views || 0).toLocaleString()} visitas
                </span>
            </div>
         </div>
         <div className="absolute inset-0 rounded-[24px] border border-gray-100 pointer-events-none z-10" />
      </Link>
   );
}

function ExplorerView({ currentUser, userProfile, searchQuery, onOverlayChange }: { currentUser: FirebaseUser; userProfile: CreatorProfile | null; searchQuery: string; onOverlayChange?: (active: boolean) => void }) {
   const [vipProfiles, setVipProfiles] = useState<CreatorProfile[]>([]);
   const [stories, setStories] = useState<Story[]>([]);
   const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
   const [lastProfileDoc, setLastProfileDoc] = useState<any>(null);
   const [hasMoreProfiles, setHasMoreProfiles] = useState(true);
   const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);

   useLockBodyScroll(selectedStoryIndex !== null);

   useEffect(() => {
     onOverlayChange?.(selectedStoryIndex !== null);
   }, [selectedStoryIndex]);

   const loadProfiles = async () => {
       if (isLoadingProfiles || !hasMoreProfiles) return;
       setIsLoadingProfiles(true);
       try {
          const qProfiles = lastProfileDoc
             ? query(collection(db, 'creatorProfiles'), orderBy('username'), startAfter(lastProfileDoc), limit(24))
             : query(collection(db, 'creatorProfiles'), orderBy('username'), limit(24));
          const snap = await getDocs(qProfiles);
          const profiles: CreatorProfile[] = [];
          snap.forEach(d => profiles.push({ id: d.id, ...d.data() } as any));
          profiles.sort((a, b) => (b.views || 0) - (a.views || 0));
          setVipProfiles(current => [...current, ...profiles].filter((v, i, a) => a.findIndex(t => t.username === v.username) === i));
          setLastProfileDoc(snap.docs[snap.docs.length - 1] || null);
          setHasMoreProfiles(snap.docs.length === 24);
       } catch (err) {
          console.error("Error fetching profiles:", err);
       }
       setIsLoadingProfiles(false);
   };

   useEffect(() => {
       loadProfiles();

       const unsubStories = onSnapshot(collectionGroup(db, 'stories'), (snap) => {
           const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
           const strs: Story[] = [];
           snap.forEach(d => strs.push({ id: d.id, ...d.data() } as Story));
           strs.sort((a, b) => b.createdAt - a.createdAt);
           setStories(strs.filter(s => s.createdAt > oneDayAgo).slice(0, 30));
       }, (err) => {
           console.error("Error fetching stories:", err);
       });

       return () => { unsubStories(); };
   }, []);

   const filteredProfiles = vipProfiles
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
                          {s.mediaType === 'video' ? (
                            <video src={s.image} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" muted playsInline preload="metadata" />
                          ) : (
                            <img src={s.image} alt="story" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                          )}
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
             )}
          </div>

          <div className="p-4 pt-0">
             {filteredProfiles.length === 0 ? (
                 <div className="py-12 flex flex-col items-center justify-center text-center text-gray-400">
                    <Compass className="w-12 h-12 mb-3 opacity-20" />
                    <p className="font-bold text-gray-600">No se encontraron perfiles</p>
                    <p className="text-sm">Intenta buscar con otras palabras.</p>
                 </div>
             ) : (
                 <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                       {filteredProfiles.map((p) => (
                          <ProfileExploreCard key={p.username} p={p} />
                       ))}
                    </div>
                    {hasMoreProfiles && !searchQuery && (
                       <button onClick={loadProfiles} disabled={isLoadingProfiles} className="mt-4 w-full py-3 rounded-2xl bg-gray-100 text-gray-900 font-bold text-sm disabled:opacity-50">
                          {isLoadingProfiles ? 'Cargando...' : 'Cargar m?s'}
                       </button>
                    )}
                 </>
             )}
          </div>
          
          <AnimatePresence>
            {selectedStoryIndex !== null && (
               <StoryViewer 
                  stories={stories}
                  initialIndex={selectedStoryIndex}
                  onClose={() => setSelectedStoryIndex(null)}
               />
            )}
          </AnimatePresence>
      </div>
   );
}

function useScrollDirection() {
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up');

  useEffect(() => {
    let lastScrollY = window.scrollY || 0;
    // Map to keep track of last scroll for different elements
    const lastScrolls = new Map<EventTarget, number>();
    let ticking = false;

    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | Document;
      const isDocument = target === document || target === document.documentElement || target === document.body;
      const el = isDocument ? window : (target as HTMLElement);
      const currentScrollY = isDocument ? window.scrollY : (target as HTMLElement).scrollTop;
      
      // Only track document or main containers
      if (!isDocument) {
         if (!(target as HTMLElement).classList?.contains('overflow-y-auto')) return;
      }

      const prevScrollY = lastScrolls.get(target) || 0;

      if (Math.abs(currentScrollY - prevScrollY) < 10) {
        return;
      }

      lastScrolls.set(target, currentScrollY > 0 ? currentScrollY : 0);

      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollDirection(currentScrollY > prevScrollY ? 'down' : 'up');
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  return scrollDirection;
}

function BottomNav({ activeTab, onTabChange, unreadCount = 0 }: { activeTab: string, onTabChange: (tab: 'profile'|'explorer'|'admin'|'wallet'|'settings'|'notifications') => void, unreadCount?: number }) {
  const scrollDirection = useScrollDirection();
  const isVisible = scrollDirection === 'up';

  return (
    <nav className={cn(
      "fixed bottom-0 w-full max-w-[500px] h-[60px] bg-white border-t border-gray-100 flex items-center justify-around z-50 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] px-2 transition-transform duration-300",
      isVisible ? "translate-y-0" : "translate-y-[100%]"
    )}>
        <button onClick={() => onTabChange('profile')} className={cn("flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors relative", activeTab === 'profile' ? "text-pink-500" : "text-gray-400 hover:text-gray-600")}>
           <User className="w-6 h-6" strokeWidth={activeTab === 'profile' ? 2.5 : 2} />
        </button>
        <button onClick={() => onTabChange('explorer')} className={cn("flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors", activeTab === 'explorer' ? "text-pink-500" : "text-gray-400 hover:text-gray-600")}>
           <Search className="w-6 h-6" strokeWidth={activeTab === 'explorer' ? 2.5 : 2} />
        </button>
        <button onClick={() => onTabChange('admin')} className={cn("flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors", activeTab === 'admin' ? "text-pink-500" : "text-gray-400 hover:text-gray-600")}>
           <LayoutDashboard className="w-6 h-6" strokeWidth={activeTab === 'admin' ? 2.5 : 2} />
        </button>
        <button onClick={() => onTabChange('wallet')} className={cn("flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors", activeTab === 'wallet' ? "text-pink-500" : "text-gray-400 hover:text-gray-600")}>
           <Wallet className="w-6 h-6" strokeWidth={activeTab === 'wallet' ? 2.5 : 2} />
        </button>
        <button onClick={() => onTabChange('notifications')} className={cn("flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors relative", activeTab === 'notifications' ? "text-pink-500" : "text-gray-400 hover:text-gray-600")}>
           <div className="relative">
             <Bell className="w-6 h-6" strokeWidth={activeTab === 'notifications' ? 2.5 : 2} />
             {unreadCount > 0 && <span className="absolute -top-[2px] -right-[2px] w-2 h-2 bg-pink-500 rounded-full border border-white"></span>}
           </div>
        </button>
        <button onClick={() => onTabChange('settings')} className={cn("flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors", activeTab === 'settings' ? "text-pink-500" : "text-gray-400 hover:text-gray-600")}>
           <Settings className="w-6 h-6" strokeWidth={activeTab === 'settings' ? 2.5 : 2} />
        </button>
    </nav>
  );
}

// -------------------------------------------------------------
// DASHBOARD (MOBILE-APP LAYOUT, UNIFIED)
// -------------------------------------------------------------
const checkAndCleanExpiredSlots = (slots: AdSpace[], dbProfileId: string, isOwner: boolean): AdSpace[] => {
  const now = Date.now();
  const expiredSlots = slots.filter(s => s.isRented && s.rentEnd && now > s.rentEnd);
  
  if (expiredSlots.length > 0) {
      const batch = writeBatch(db);
      expiredSlots.forEach(s => {
           batch.update(doc(db, `creatorProfiles/${dbProfileId}/adSpaces`, s.id), {
               isRented: false,
               brand: deleteField(),
               brandImg: deleteField(),
               caption: deleteField(),
               image: deleteField(),
               rentedBy: deleteField(),
               rentStart: deleteField(),
               rentEnd: deleteField(),
               pricePaid: deleteField(),
               forResale: deleteField(),
               resalePrices: deleteField()
           });
      });
      batch.commit().catch(e => console.error("Error clearing expired slots:", e));
  }
  
  return slots.map(s => {
      if (s.isRented && s.rentEnd && now > s.rentEnd) {
           const cleanSlot = { ...s, isRented: false };
           delete cleanSlot.brand;
           delete cleanSlot.brandImg;
           delete cleanSlot.caption;
           delete cleanSlot.image;
           delete cleanSlot.rentedBy;
           delete cleanSlot.rentStart;
           delete cleanSlot.rentEnd;
           delete cleanSlot.pricePaid;
           delete cleanSlot.forResale;
           delete cleanSlot.resalePrices;
           return cleanSlot;
      }
      return s;
  });
};

function Dashboard({ user }: { user: FirebaseUser | null }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [slots, setSlots] = useState<AdSpace[]>([]);
  const [rentedSlots, setRentedSlots] = useState<{slot: AdSpace, profileId: string, profileUsername?: string, profilePhoto?: string, profileDisplayName?: string}[]>([]);
  const [tokenTransactions, setTokenTransactions] = useState<{id: string, profileId: string, profileUsername?: string, profilePhoto?: string, profileDisplayName?: string, price: number, tokensMinted?: number, createdAt: number}[]>([]);
  const [tokenHoldings, setTokenHoldings] = useState<{id: string, profileId: string, profileUsername?: string, profilePhoto?: string, profileDisplayName?: string, balance: number}[]>([]);
  const [myOpenTokenOrders, setMyOpenTokenOrders] = useState<RealTokenOrder[]>([]);
  const [p2pTradesBuy, setP2pTradesBuy] = useState<{id: string; creatorId: string; symbol: string; price: number; amount: number; createdAt: number}[]>([]);
  const [p2pTradesSell, setP2pTradesSell] = useState<{id: string; creatorId: string; symbol: string; price: number; amount: number; createdAt: number}[]>([]);
  const [walletOrderBook, setWalletOrderBook] = useState<TokenMarket | null>(null);
  const [walletOpenSellOffers, setWalletOpenSellOffers] = useState<MarketOrder[]>([]);
  const [walletBuyTokenAmount, setWalletBuyTokenAmount] = useState(1);
  const [walletSellTokenAmount, setWalletSellTokenAmount] = useState(1);
  const [walletCreatorId, setWalletCreatorId] = useState<string>('');
  const [walletCreatorOrders, setWalletCreatorOrders] = useState<RealTokenOrder[]>([]);
  const [walletMarketData, setWalletMarketData] = useState<{ profile: CreatorProfile; txs: { id: string; price: number; createdAt: number; tokensMinted?: number }[] } | null>(null);
  const [walletDefaultSide, setWalletDefaultSide] = useState<'buy' | 'sell'>('buy');
  const [adminViewTab, setAdminViewTab] = useState<'mine' | 'rented'>('mine');
  const [stories, setStories] = useState<Story[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'profile' | 'admin' | 'settings' | 'wallet' | 'explorer' | 'notifications'>(
    (location.state as any)?.tab || 'profile'
  );
  const [explorerOverlayActive, setExplorerOverlayActive] = useState(false);
  const [walletSubTab, setWalletSubTab] = useState<'balance' | 'tokens'>('balance');
  
  // Explorer state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Tenant edit state
  const [selectedTenantSlot, setSelectedTenantSlot] = useState<{slot: AdSpace, profileId: string, profileUsername?: string} | null>(null);
  const [tenantEditImage, setTenantEditImage] = useState('');
  const [tenantEditBrand, setTenantEditBrand] = useState('');
  const [tenantEditBrandImg, setTenantEditBrandImg] = useState('');
  const [tenantEditCaption, setTenantEditCaption] = useState('');
  const [tenantEditForResale, setTenantEditForResale] = useState(false);
  const [tenantEditResalePrices, setTenantEditResalePrices] = useState({ price1: 0, price7: 0, price30: 0, price365: 0 });
  const [tenantEditLink, setTenantEditLink] = useState('');
  
  // Settings state
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [editBanner, setEditBanner] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editProfileLinks, setEditProfileLinks] = useState<ProfileLink[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState<'photo' | 'banner' | null>(null);

  // Price Modal State
  const [editingSize, setEditingSize] = useState<number | null>(null);
  const [deletingSlot, setDeletingSlot] = useState<string | null>(null);
  const [price1, setPrice1] = useState<number>(0);
  const [price7, setPrice7] = useState<number>(0);
  const [price30, setPrice30] = useState<number>(0);
  const [price365, setPrice365] = useState<number>(0);
  const [isSavingPrices, setIsSavingPrices] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isProcessingSlot, setIsProcessingSlot] = useState(false);
  const [confirmClearSlot, setConfirmClearSlot] = useState(false);

  // Light mode state
  const [lightMode, setLightMode] = useState(() => localStorage.getItem('zona-vip-theme') === 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = lightMode ? 'light' : '';
    localStorage.setItem('zona-vip-theme', lightMode ? 'light' : 'dark');
  }, [lightMode]);

  // Withdraw modal state
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawInput, setWithdrawInput] = useState('');

  useLockBodyScroll(editingSize !== null || deletingSlot !== null || !!walletOrderBook);

  // Subscribe to real orders for the wallet order book
  useEffect(() => {
    if (!walletCreatorId) { setWalletCreatorOrders([]); return; }
    const q = query(
      collection(db, 'tokenOrders'),
      where('creatorId', '==', walletCreatorId),
      where('status', '==', 'open')
    );
    const unsub = onSnapshot(q, (snap) => {
      setWalletCreatorOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as RealTokenOrder)));
    }, (err) => console.log('tokenOrders wallet error', err));
    return () => unsub();
  }, [walletCreatorId]);

  useEffect(() => {
    if (!walletCreatorId || !walletMarketData) return;
    setWalletOrderBook(buildTokenMarket(walletMarketData.profile, walletMarketData.txs, [], walletCreatorId, walletCreatorOrders));
  }, [walletCreatorOrders, walletMarketData, walletCreatorId]);

  useEffect(() => {
    setWalletOpenSellOffers(walletCreatorOrders.filter(o => o.side === 'sell' && o.userId === user?.uid).map(o => ({ price: o.price, amount: o.amount })));
  }, [walletCreatorOrders, user?.uid]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    
    const unsubProfile = onSnapshot(doc(db, 'creatorProfiles', user.uid), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as CreatorProfile;
        setProfile(data);
        if (!editName && !editUsername) {
           setEditName(data.displayName || '');
           setEditUsername(data.username || '');
           setEditPhoto(data.photoURL || '');
           setEditBanner(data.bannerURL || '');
           setEditBio(data.profileBio || '');
           setEditProfileLinks(data.profileLinks || []);
        }
      } else {
        // Fallback if profile is somehow missing (e.g., interrupted registration)
        try {
            const baseUsername = user.email?.split('@')[0] || `user_${Date.now()}`;
            const generatedUsername = baseUsername.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const initialProfile = {
              username: generatedUsername,
              displayName: baseUsername,
              photoURL: user.photoURL || 'https://i.pravatar.cc/150?u=' + user.uid,
              bannerURL: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80',
              walletBalance: 0,
              prices100: { price1: 15, price7: 45, price30: 150, price365: 600 },
              prices50: { price1: 10, price7: 30, price30: 100, price365: 350 },
              prices25: { price1: 5, price7: 15, price30: 45, price365: 200 },
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            await setDoc(doc(db, 'creatorProfiles', user.uid), initialProfile);
        } catch (e) {
            console.error("Failed to create fallback profile", e);
        }
      }
      setLoading(false);
    }, (err) => { handleFirestoreError(err, OperationType.GET, 'creatorProfiles'); setLoading(false); });

    const unsubSlots = onSnapshot(collection(db, `creatorProfiles/${user.uid}/adSpaces`), (snap) => {
       const fetchedSlots: AdSpace[] = [];
       snap.forEach(d => fetchedSlots.push({ id: d.id, ...d.data() } as AdSpace));
       fetchedSlots.sort((a,b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
       setSlots(checkAndCleanExpiredSlots(fetchedSlots, user.uid, true));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${user.uid}/adSpaces`));

   const unsubRentedSlots = onSnapshot(
      query(collectionGroup(db, 'adSpaces'), where('rentedBy', '==', user.uid)),
      async (snap) => {
        const fetched: {slot: AdSpace, profileId: string, profileUsername?: string, profilePhoto?: string, profileDisplayName?: string}[] = [];
        const now = Date.now();
        for (const d of snap.docs) {
           const data = d.data() as AdSpace;
           if (data.isRented && data.rentEnd && now > data.rentEnd) continue;
           const parts = d.ref.path.split('/');
               if (parts.length >= 4) {
                  const profileId = parts[1];
                  let profileUsername = profileId;
                  let profilePhoto: string | undefined;
                  let profileDisplayName: string | undefined;
                  try {
                    const profileSnap = await getDoc(doc(db, 'creatorProfiles', profileId));
                    if (profileSnap.exists()) {
                       profileUsername = profileSnap.data().username || profileId;
                       profilePhoto = profileSnap.data().photoURL;
                       profileDisplayName = profileSnap.data().displayName;
                    }
                  } catch (e) {
                    console.error("Error fetching creator profile", e);
                  }
                  fetched.push({ slot: data, profileId, profileUsername, profilePhoto, profileDisplayName });
               }
        }
        setRentedSlots(fetched);
      },
      (err) => console.log('Error fetching rented slots', err)
    );

    const unsubStories = onSnapshot(collection(db, `creatorProfiles/${user.uid}/stories`), (snap) => {
       const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
       const fetchedStories: Story[] = [];
       snap.forEach(d => fetchedStories.push({ id: d.id, ...d.data() } as Story));
       fetchedStories.sort((a, b) => b.createdAt - a.createdAt);
       setStories(fetchedStories.filter(s => s.createdAt > oneDayAgo));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${user.uid}/stories`));

    const unsubNotifs = onSnapshot(query(collection(db, `users/${user.uid}/notifications`)), (snap) => {
       const fetchedNotifs: Notification[] = [];
       snap.forEach(d => fetchedNotifs.push({ id: d.id, ...d.data() } as Notification));
       fetchedNotifs.sort((a, b) => b.createdAt - a.createdAt);
       setNotifications(fetchedNotifs);
    }, (err) => console.log('Error fetching notifs', err));

    const unsubTokenTxs = onSnapshot(query(collectionGroup(db, 'transactions'), where('buyerId', '==', user.uid)), async (snap) => {
       const fetched: {id: string, profileId: string, profileUsername?: string, profilePhoto?: string, profileDisplayName?: string, price: number, tokensMinted?: number, createdAt: number}[] = [];
       for (const d of snap.docs) {
          const data = d.data() as { price: number, tokensMinted?: number, createdAt: number };
          const parts = d.ref.path.split('/');
          if (parts.length >= 4) {
             const profileId = parts[1];
             let profileUsername = profileId;
             let profilePhoto: string | undefined;
             let profileDisplayName: string | undefined;
             try {
               const profileSnap = await getDoc(doc(db, 'creatorProfiles', profileId));
               if (profileSnap.exists()) {
                  profileUsername = profileSnap.data().username || profileId;
                  profilePhoto = profileSnap.data().photoURL;
                  profileDisplayName = profileSnap.data().displayName;
               }
             } catch (e) {
               console.error("Error fetching token creator profile", e);
             }
             fetched.push({ id: d.id, profileId, profileUsername, profilePhoto, profileDisplayName, price: data.price || 0, tokensMinted: data.tokensMinted, createdAt: data.createdAt || 0 });
          }
       }
       fetched.sort((a, b) => b.createdAt - a.createdAt);
       setTokenTransactions(fetched);

       const legacyByProfile: Record<string, { balance: number; username?: string }> = {};
       fetched.forEach(t => {
          const minted = t.tokensMinted ?? t.price ?? 0;
          if (minted <= 0) return;
          if (!legacyByProfile[t.profileId]) legacyByProfile[t.profileId] = { balance: 0, username: t.profileUsername };
          legacyByProfile[t.profileId].balance += minted;
       });
       await Promise.all(Object.entries(legacyByProfile).map(async ([creatorId, holding]) => {
          const holdingRef = doc(db, 'creatorTokenHolders', `${user.uid}_${creatorId}`);
          const holdingSnap = await getDoc(holdingRef);
          if (!holdingSnap.exists()) {
             const now = Date.now();
             await setDoc(holdingRef, {
                userId: user.uid,
                creatorId,
                creatorUsername: holding.username || creatorId,
                balance: holding.balance,
                earned: 0,
                createdAt: now,
                updatedAt: now
             });
          }
       }));
    }, (err) => console.log('Error fetching token transactions', err));


    const unsubTokenHoldings = onSnapshot(query(collection(db, 'creatorTokenHolders'), where('userId', '==', user.uid)), async (snap) => {
       const fetched: {id: string, profileId: string, profileUsername?: string, profilePhoto?: string, profileDisplayName?: string, balance: number}[] = [];
       for (const d of snap.docs) {
          const data = d.data() as { creatorId: string, balance: number };
          let profileUsername = data.creatorId;
          let profilePhoto: string | undefined;
          let profileDisplayName: string | undefined;
          try {
            const profileSnap = await getDoc(doc(db, 'creatorProfiles', data.creatorId));
            if (profileSnap.exists()) {
               profileUsername = profileSnap.data().username || data.creatorId;
               profilePhoto = profileSnap.data().photoURL;
               profileDisplayName = profileSnap.data().displayName;
            }
          } catch (e) {
            console.error("Error fetching token holding profile", e);
          }
          fetched.push({ id: d.id, profileId: data.creatorId, profileUsername, profilePhoto, profileDisplayName, balance: data.balance || 0 });
       }
       setTokenHoldings(fetched.filter(h => h.balance > 0));
    }, (err) => console.log('Error fetching token holdings', err));

    // Listener: current user's own open orders (for cancel button)
    const unsubMyOrders = onSnapshot(
      query(collection(db, 'tokenOrders'), where('userId', '==', user.uid), where('status', '==', 'open')),
      (snap) => setMyOpenTokenOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as RealTokenOrder))),
      (err) => console.log('myOrders error', err)
    );

    // P2P trade history: tokenTrades is a separate collection from creatorProfiles/X/transactions
    const unsubP2pBuy = onSnapshot(
      query(collection(db, 'tokenTrades'), where('buyerId', '==', user.uid)),
      (snap) => setP2pTradesBuy(snap.docs.map(d => ({ id: d.id, ...d.data() } as any))),
      (err) => console.log('p2pTrades buy error', err)
    );
    const unsubP2pSell = onSnapshot(
      query(collection(db, 'tokenTrades'), where('sellerId', '==', user.uid)),
      (snap) => setP2pTradesSell(snap.docs.map(d => ({ id: d.id, ...d.data() } as any))),
      (err) => console.log('p2pTrades sell error', err)
    );

    return () => { unsubProfile(); unsubSlots(); unsubRentedSlots(); unsubStories(); unsubNotifs(); unsubTokenTxs(); unsubTokenHoldings(); unsubMyOrders(); unsubP2pBuy(); unsubP2pSell(); };
  }, [user, navigate]);

  const handleSaveProfile = async () => {
     if (!user) return;
     setIsSaving(true);
     try {
         const cleanNewUsername = editUsername.toLowerCase().replace(/[^a-z0-9-]/g, '');
         const oldUsername = profile?.username;

         if (cleanNewUsername !== oldUsername) {
           await runTransaction(db, async (transaction) => {
             const newUsernameRef = doc(db, 'usernames', cleanNewUsername);
             const newUsernameSnap = await transaction.get(newUsernameRef);
             if (newUsernameSnap.exists()) throw new Error('Ese nombre de usuario ya está en uso. Elige otro.');
             transaction.set(newUsernameRef, { uid: user.uid });
             if (oldUsername) transaction.delete(doc(db, 'usernames', oldUsername));
           });
         }

         await updateDoc(doc(db, 'creatorProfiles', user.uid), {
             displayName: editName,
             username: cleanNewUsername,
             photoURL: editPhoto,
             bannerURL: editBanner,
             profileBio: editBio,
             profileLinks: editProfileLinks.filter(l => l.url.trim()),
             updatedAt: serverTimestamp()
         });
         showAlert('¡Perfil guardado correctamente!', 'success');
     } catch (err: any) { showAlert(err.message, 'error'); }
     setIsSaving(false);
  };

  const handleDivide = async (slotId: string) => {
    if (!user || isProcessingSlot) return;
    const slotIndex = slots.findIndex(s => s.id === slotId);
    if (slotIndex === -1) return;
    const slot = slots[slotIndex];
    if (!slot || slot.width <= 25 || slot.isRented) return;

    setIsProcessingSlot(true);
    const path = `creatorProfiles/${user.uid}/adSpaces`;
    const batch = writeBatch(db);

    if (slot.width === 100) {
      const slotA: AdSpace = { ...slot, id: `${slot.id}-a`, width: 50, order: slot.order };
      const slotB: AdSpace = { ...slot, id: `${slot.id}-b`, width: 50, order: slot.order + 500 };
      batch.delete(doc(db, path, slot.id));
      batch.set(doc(db, path, slotA.id), slotA);
      batch.set(doc(db, path, slotB.id), slotB);
    } else if (slot.width === 50) {
      const s1: AdSpace = { ...slot, id: `${slot.id}-1`, width: 25, order: slot.order };
      const s2: AdSpace = { ...slot, id: `${slot.id}-2`, width: 25, order: slot.order + 100 };
      const s3: AdSpace = { ...slot, id: `${slot.id}-3`, width: 25, order: slot.order + 200 };
      const s4: AdSpace = { ...slot, id: `${slot.id}-4`, width: 25, order: slot.order + 300 };
      batch.delete(doc(db, path, slot.id));
      batch.set(doc(db, path, s1.id), s1);
      batch.set(doc(db, path, s2.id), s2);
      batch.set(doc(db, path, s3.id), s3);
      batch.set(doc(db, path, s4.id), s4);
    }

    try {
      await batch.commit();
    } catch(e: any) {
      showAlert(e.message || 'No se pudo dividir el espacio.', 'error');
    } finally {
      setIsProcessingSlot(false);
    }
  };

  const handleJoin = async (slotId: string) => {
    if (!user || isProcessingSlot) return;
    const slotIndex = slots.findIndex(s => s.id === slotId);
    if (slotIndex === -1) return;
    const slot = slots[slotIndex];
    if (slot.isRented) return;

    setIsProcessingSlot(true);
    const path = `creatorProfiles/${user.uid}/adSpaces`;
    const batch = writeBatch(db);

    if (slot.width === 25) {
      const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
      const siblings = slots.filter(s => s.id.startsWith(parentId + '-') && s.width === 25);
      if (siblings.length !== 4) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar las 4 piezas.', 'error'); return; }
      const freshSnap = await getDocs(collection(db, path));
      const freshSiblings = freshSnap.docs.map(d => d.data() as AdSpace).filter(s => s.id.startsWith(parentId + '-') && s.width === 25);
      if (freshSiblings.length !== 4) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar las 4 piezas.', 'error'); return; }
      if (freshSiblings.some(s => s.isRented)) { setIsProcessingSlot(false); showAlert('No puedes unir si alguna parte est? alquilada.', 'error'); return; }
      
      const minOrder = Math.min(...freshSiblings.map(s => s.order));
      const newSlot: AdSpace = { ...freshSiblings[0], id: parentId, width: 50, order: minOrder };
      for (const s of freshSiblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    } else if (slot.width === 50) {
      const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
      const siblings = slots.filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
      if (siblings.length !== 2) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar ambas mitades.', 'error'); return; }
      const freshSnap = await getDocs(collection(db, path));
      const freshSiblings = freshSnap.docs.map(d => d.data() as AdSpace).filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
      if (freshSiblings.length !== 2) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar ambas mitades.', 'error'); return; }
      if (freshSiblings.some(s => s.isRented)) { setIsProcessingSlot(false); showAlert('No puedes unir si alguna parte est? alquilada.', 'error'); return; }
      
      const minOrder = Math.min(...freshSiblings.map(s => s.order));
      const newSlot: AdSpace = { ...freshSiblings[0], id: parentId, width: 100, order: minOrder };
      for (const s of freshSiblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    }

    try {
       await batch.commit();
    } catch(e: any) {
       showAlert(e.message || 'No se pudieron unir los espacios.', 'error');
    } finally {
       setIsProcessingSlot(false);
    }
  };

  const handleResetSlots = async () => {
     if (!user || isProcessingSlot) return;
     setIsProcessingSlot(true);
     const path = `creatorProfiles/${user.uid}/adSpaces`;
     const batch = writeBatch(db);
     
     for (const s of slots) {
         batch.delete(doc(db, path, s.id));
     }
     
     const newBaseSlots = Array.from({ length: 5 }).map((_, i) => ({
      id: `slot-${i + 1}`,
      isRented: false,
      width: 100,
      order: i * 1000
    }));

    for (const sm of newBaseSlots) {
       batch.set(doc(db, path, sm.id), sm);
    }

    try {
       await batch.commit();
    } catch(e: any) {
       showAlert(e.message || 'No se pudo reiniciar la distribucion.', 'error');
    } finally {
       setIsProcessingSlot(false);
    }
  };

  const handleSaveTenantEdit = async () => {
    if (!selectedTenantSlot || isProcessingSlot) return;
    setIsProcessingSlot(true);
    try {
        await updateDoc(doc(db, `creatorProfiles/${selectedTenantSlot.profileId}/adSpaces`, selectedTenantSlot.slot.id), {
            image: tenantEditImage,
            brand: tenantEditBrand,
            brandImg: tenantEditBrandImg,
            caption: tenantEditCaption,
            link: tenantEditLink,
            forResale: tenantEditForResale,
            resalePrices: tenantEditForResale ? tenantEditResalePrices : deleteField()
        });
        showAlert('Cambios guardados.', 'success');
        setSelectedTenantSlot(null);
    } catch(e: any) { showAlert(e.message, 'error'); }
    finally { setIsProcessingSlot(false); }
  };

  const handleClearTenantData = async () => {
    if (!selectedTenantSlot || isProcessingSlot) return;
    setIsProcessingSlot(true);
    try {
        await updateDoc(doc(db, `creatorProfiles/${selectedTenantSlot.profileId}/adSpaces`, selectedTenantSlot.slot.id), {
            brand: '',
            brandImg: '',
            caption: '',
            image: '',
            link: '',
            forResale: deleteField(),
            resalePrices: deleteField()
        });
        setTenantEditBrand('');
        setTenantEditBrandImg('');
        setTenantEditCaption('');
        setTenantEditImage('');
        setTenantEditLink('');
        setTenantEditForResale(false);
        showAlert('Anuncio borrado. El espacio queda limpio.', 'success');
        setSelectedTenantSlot(null);
    } catch(e: any) { showAlert('Error al liberar: ' + e.message, 'error'); }
    finally { setIsProcessingSlot(false); }
  };

  const handleTenantDivide = async () => {
    if (!selectedTenantSlot || isProcessingSlot) return;
    const { slot, profileId } = selectedTenantSlot;
    if (slot.width <= 25) return;
    
    setIsProcessingSlot(true);
    const path = `creatorProfiles/${profileId}/adSpaces`;
    const batch = writeBatch(db);

    if (slot.width === 100) {
      const slotA: AdSpace = { ...slot, id: `${slot.id}-a`, width: 50, order: slot.order };
      const slotB: AdSpace = { ...slot, id: `${slot.id}-b`, width: 50, order: slot.order + 500 };
      batch.delete(doc(db, path, slot.id));
      batch.set(doc(db, path, slotA.id), slotA);
      batch.set(doc(db, path, slotB.id), slotB);
    } else if (slot.width === 50) {
      const s1: AdSpace = { ...slot, id: `${slot.id}-1`, width: 25, order: slot.order };
      const s2: AdSpace = { ...slot, id: `${slot.id}-2`, width: 25, order: slot.order + 100 };
      const s3: AdSpace = { ...slot, id: `${slot.id}-3`, width: 25, order: slot.order + 200 };
      const s4: AdSpace = { ...slot, id: `${slot.id}-4`, width: 25, order: slot.order + 300 };
      batch.delete(doc(db, path, slot.id));
      batch.set(doc(db, path, s1.id), s1);
      batch.set(doc(db, path, s2.id), s2);
      batch.set(doc(db, path, s3.id), s3);
      batch.set(doc(db, path, s4.id), s4);
    }

    try {
      await batch.commit();
      showAlert('Espacio dividido exitosamente.', 'success');
      setSelectedTenantSlot(null);
    } catch(e: any) {
      showAlert(e.message || 'No se pudo dividir el espacio.', 'error');
    } finally {
      setIsProcessingSlot(false);
    }
  };

  const handleTenantJoin = async () => {
    if (!selectedTenantSlot || isProcessingSlot) return;
    if (!user) return;
    const { slot, profileId } = selectedTenantSlot;
    if (slot.width >= 100) return;
    
    setIsProcessingSlot(true);
    const path = `creatorProfiles/${profileId}/adSpaces`;
    const batch = writeBatch(db);

    try {
        const snap = await getDocs(collection(db, path));
        const allSlots = snap.docs.map(d => d.data() as AdSpace);
        
        if (slot.width === 25) {
          const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
          const siblings = allSlots.filter(s => s.id.startsWith(parentId + '-') && s.width === 25);
          if (siblings.length !== 4) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar las 4 piezas.', 'error'); return; }
          if (siblings.some(s => !s.isRented || s.rentedBy !== user.uid)) {
              setIsProcessingSlot(false); showAlert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.', 'error'); return;
          }
          
          const minOrder = Math.min(...siblings.map(s => s.order));
          const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 50, order: minOrder };
          for (const s of siblings) batch.delete(doc(db, path, s.id));
          batch.set(doc(db, path, parentId), newSlot);
        } else if (slot.width === 50) {
          const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
          const siblings = allSlots.filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
          if (siblings.length !== 2) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar ambas mitades.', 'error'); return; }
          if (siblings.some(s => !s.isRented || s.rentedBy !== user.uid)) {
              setIsProcessingSlot(false); showAlert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.', 'error'); return;
          }
          
          const minOrder = Math.min(...siblings.map(s => s.order));
          const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 100, order: minOrder };
          for (const s of siblings) batch.delete(doc(db, path, s.id));
          batch.set(doc(db, path, parentId), newSlot);
        }

        await batch.commit();
        showAlert('Espacios unidos exitosamente.', 'success');
        setSelectedTenantSlot(null);
    } catch(e: any) {
        showAlert(e.message || 'No se pudieron unir los espacios.', 'error');
    } finally {
        setIsProcessingSlot(false);
    }
  };

  const handleCreateSlot = async () => {
    if (!user || isProcessingSlot) return;
    setIsProcessingSlot(true);
    const maxOrder = slots.length > 0 ? Math.max(...slots.map(s => s.order)) : 0;
    const newSlot: AdSpace = {
        id: `slot-extra-${Date.now()}`,
        width: 100,
        order: maxOrder + 1000,
        isRented: false
    };
    try {
      await setDoc(doc(db, `creatorProfiles/${user.uid}/adSpaces`, newSlot.id), newSlot);
    } catch(e: any) {
      showAlert(e.message || 'No se pudo crear el espacio.', 'error');
    } finally {
      setIsProcessingSlot(false);
    }
  };

  const handleDeleteSlot = (slotId: string) => {
    setDeletingSlot(slotId);
  };

  const handleDeleteSlotConfirm = async (slotId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `creatorProfiles/${user.uid}/adSpaces`, slotId));
    } catch(e: any) {
      showAlert(e.message || 'No se pudo borrar el espacio.', 'error');
    }
  };

  const openPricesModal = (s: AdSpace) => {
      setEditingSize(s.width);
      const prices = s.width === 100 ? profile?.prices100 : s.width === 50 ? profile?.prices50 : profile?.prices25;
      const def = s.width === 100 ? {p1:15, p7:45, p30:150, p365:600} : s.width === 50 ? {p1:10, p7:30, p30:100, p365:350} : {p1:5, p7:15, p30:45, p365:200};
      setPrice1(prices?.price1 || def.p1);
      setPrice7(prices?.price7 || def.p7);
      setPrice30(prices?.price30 || def.p30);
      setPrice365(prices?.price365 || def.p365);
  };

  const handleSavePrices = async () => {
      if (!user || !editingSize) return;
      setIsSavingPrices(true);
      const key = `prices${editingSize}`;
      try {
        await updateDoc(doc(db, 'creatorProfiles', user.uid), {
          [key]: { price1, price7, price30, price365 },
          updatedAt: serverTimestamp()
        });
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
          setEditingSize(null);
        }, 1000);
      } catch(e: any) {
        showAlert(e.message || 'No se pudieron guardar los precios.', 'error');
      } finally {
        setIsSavingPrices(false);
      }
  };

  if (!user || loading || !profile) return <div className="min-h-[100dvh] flex items-center justify-center font-sans tracking-wide">Cargando...</div>;

  return (
    <div className="min-h-[100dvh] bg-white flex justify-center overflow-x-hidden font-sans relative isolate">
      <div className="hidden lg:block absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        {profile.bannerURL ? <img src={profile.bannerURL} className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-35" alt="" /> : <div className="absolute inset-0 bg-gradient-to-br from-pink-950 via-gray-950 to-purple-950" />}
        <div className="absolute inset-0 bg-gray-950/65" />
      </div>
      <main className="w-full max-w-[500px] bg-white relative flex flex-col pb-[80px] min-h-[100dvh]">
        
        {/* TOP BAR IF NOT PROFILE VIEW */}
        {activeTab !== 'profile' && (
           <header className="px-6 h-[64px] border-b border-gray-100 flex items-center gap-4 sticky top-0 z-30 bg-white/90 backdrop-blur-md">
             <div className="flex items-center flex-1 gap-3 h-full overflow-hidden">
                <h1 className="font-['Space_Grotesk'] text-xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent shrink-0">
                   {activeTab === 'explorer' ? 'Explorar' : activeTab === 'admin' ? 'Gestión VIP' : activeTab === 'wallet' ? 'Billetera' : activeTab === 'notifications' ? 'Notificaciones' : 'Ajustes'}
                </h1>
                {activeTab === 'explorer' && (
                   <div className="relative flex-1 max-w-[200px]">
                      <input 
                         type="text" 
                         value={searchQuery}
                         onChange={e => setSearchQuery(e.target.value)}
                         placeholder="Buscar creadores..." 
                         className="w-full bg-gray-50 border border-gray-100 rounded-full h-[32px] pl-8 pr-3 text-[13px] outline-none focus:border-pink-300 focus:bg-white transition-all placeholder-gray-400 font-medium"
                      />
                      <svg className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                   </div>
                )}
             </div>
             <button onClick={() => signOut(auth)} className="text-gray-400 hover:text-red-500 transition shrink-0"><LogOut className="w-5 h-5"/></button>
           </header>
        )}

        {/* --- VIEW: PROFILE --- */}
        {activeTab === 'profile' && (
           <div id="profile-scroll-container" className="flex-1 overflow-y-auto no-scrollbar pb-12">
              <ProfileView profile={profile} slots={slots} stories={stories} isOwnerPreview={true} profileId={user.uid} currentUser={user} onDivide={handleDivide} onJoin={handleJoin} />
           </div>
        )}

        {/* --- VIEW: ADMIN --- */}
        {activeTab === 'admin' && (
           <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto pb-24">
              <div className="flex bg-gray-100 p-1 rounded-2xl shrink-0">
                 <button onClick={() => setAdminViewTab('mine')} className={cn("flex-1 py-2 font-bold text-sm rounded-xl transition-all", adminViewTab === 'mine' ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700")}>Mi Perfil</button>
                 <button onClick={() => setAdminViewTab('rented')} className={cn("flex-1 py-2 font-bold text-sm rounded-xl transition-all", adminViewTab === 'rented' ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700")}>Zonas Inquilino</button>
              </div>

              {adminViewTab === 'mine' ? (
                <>
                  <div className="bg-pink-50 border border-pink-100 rounded-3xl p-6 text-center shadow-sm">
                     <h3 className="font-black text-gray-900 text-xl mb-1">Distribución de ZonasVip</h3>
                     <p className="text-sm text-gray-500">Aquí puedes dividir (hasta 25%), unir ZonasVip o cambiar sus precios.</p>
                  </div>
                  
                  <div className="bg-gray-50 rounded-[32px] border border-gray-100 p-4 shrink-0">
                     <div className="grid grid-cols-4 gap-2 md:gap-3 w-full bg-white rounded-3xl p-3 border border-gray-100 grid-flow-row-dense">
                        {groupSlotsForRender(slots).map((item) => {
                           if (item.type === 'single') {
                              const isBaseSlot = /^(slot-[1-5])($|-)/.test(item.slot.id);
                              return (
                                 <SlotCard 
                                    key={item.slot.id}
                                    slot={item.slot}
                                    isAdmin={true}
                                    isSelected={editingSize === item.slot.width}
                                    onDivide={handleDivide}
                                    onJoin={item.slot.width < 100 ? handleJoin : undefined}
                                    onEditPrices={openPricesModal}
                                    onDelete={(!isBaseSlot && item.slot.width === 100) ? handleDeleteSlot : undefined}
                                 />
                              );
                           } else {
                              return (
                                 <div key={item.id} className="col-span-2 row-span-2 grid grid-cols-2 grid-rows-2 gap-2 md:gap-3 w-full h-full aspect-[10/7.65] relative bg-white rounded-[24px] overflow-hidden isolate">
                                    {item.slots.sort((a, b) => a.order - b.order).map(slot => {
                                       const isBaseSlot = /^(slot-[1-5])($|-)/.test(slot.id);
                                       return (
                                         <SlotCard 
                                            key={slot.id}
                                            slot={slot}
                                            isAdmin={true}
                                            isSelected={editingSize === slot.width}
                                            onDivide={handleDivide}
                                            onJoin={handleJoin}
                                            onEditPrices={openPricesModal}
                                            onDelete={(!isBaseSlot && slot.width === 100) ? handleDeleteSlot : undefined}
                                         />
                                       );
                                    })}
                                 </div>
                              );
                           }
                        })}
                        <button onClick={handleCreateSlot} className="col-span-4 aspect-[20/7.65] w-full bg-transparent border-2 border-dashed border-gray-200 hover:border-pink-300 hover:bg-pink-50/50 rounded-[24px] flex flex-col items-center justify-center group transition-all">
                           <div className="w-10 h-10 rounded-full bg-gray-50 group-hover:bg-white flex items-center justify-center mb-2 shadow-sm transition-all text-gray-400 group-hover:text-pink-500 group-hover:scale-110">
                              <Plus className="w-5 h-5" />
                           </div>
                           <span className="font-bold text-sm text-gray-400 group-hover:text-pink-500">Crear ZonaVip</span>
                        </button>
                     </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-purple-50 border border-purple-100 rounded-3xl p-6 text-center shadow-sm">
                     <h3 className="font-black text-gray-900 text-xl mb-1">Zonas Inquilino</h3>
                     <p className="text-sm text-gray-500">Espacios que estás patrocinando en perfiles de terceros.</p>
                  </div>
                  
                  <div className="bg-purple-50 rounded-[32px] border border-purple-100 p-4 shrink-0">
                     <div className="grid grid-cols-4 gap-2 md:gap-3 w-full bg-white rounded-3xl p-3 border border-purple-100 grid-flow-row-dense">
                        {rentedSlots.length === 0 ? (
                           <p className="col-span-4 text-gray-500 text-center py-10">No estás alquilando ZonasVip en otros perfiles.</p>
                        ) : (
                           rentedSlots.map(r => {
                              const gridClass = {
                                25: 'col-span-1 row-span-1',
                                50: 'col-span-2 row-span-2',
                                75: 'col-span-3 row-span-2',
                                100: 'col-span-4 row-span-2'
                              }[r.slot.width as 25 | 50 | 75 | 100] || 'col-span-4 row-span-2';
                              return (
                                 <div role="button" tabIndex={0} onClick={() => {
                                    setSelectedTenantSlot(r);
                                    setTenantEditImage(r.slot.image || '');
                                    setTenantEditBrand(r.slot.brand || '');
                                    setTenantEditBrandImg(r.slot.brandImg || '');
                                    setTenantEditCaption(r.slot.caption || '');
                                    setTenantEditLink(r.slot.link || '');
                                    setTenantEditForResale(r.slot.forResale || false);
                                    const def = r.slot.width === 100 ? {p1:15, p7:45, p30:150, p365:600} : r.slot.width === 50 ? {p1:10, p7:30, p30:100, p365:350} : {p1:5, p7:15, p30:45, p365:200};
                                    setTenantEditResalePrices({
                                      price1: r.slot.resalePrices?.price1 || def.p1,
                                      price7: r.slot.resalePrices?.price7 || def.p7,
                                      price30: r.slot.resalePrices?.price30 || def.p30,
                                      price365: r.slot.resalePrices?.price365 || def.p365
                                    });
                                 }} key={`${r.profileId}-${r.slot.id}`} title={`Visitar/Editar slot en @${r.profileUsername}`} className={cn("block w-full h-full relative group/link transition-transform active:scale-95 text-left cursor-pointer", gridClass)}>
                                    <div className="pointer-events-none w-full h-full group-hover/link:ring-4 ring-purple-300 rounded-[24px] transition-all transform-gpu [transform:translateZ(0)]">
                                       <SlotCard slot={r.slot} />
                                    </div>
                                    <div className="absolute -top-2 -right-2 bg-purple-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-md z-30 pointer-events-none">
                                       @{r.profileUsername}
                                    </div>
                                 </div>
                              );
                           })
                        )}
                     </div>
                  </div>
                </>
              )}
           </div>
        )}

        {/* --- VIEW: SETTINGS --- */}
        {activeTab === 'settings' && (
           <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto pb-24">
              <div className="flex flex-col bg-gray-50 p-4 rounded-xl gap-3">
                 <div className="flex items-center justify-between font-mono text-sm">
                    <span className="truncate text-gray-500">zonaviptrends.com/vip/{profile.username}</span>
                    <button onClick={async () => { 
                        try {
                           await navigator.clipboard.writeText(`https://zonaviptrends.com/vip/${profile.username}`);
                           setIsCopied(true);
                           setTimeout(() => setIsCopied(false), 2000);
                        } catch (err) {
                           console.error('Error al copiar', err);
                        }
                    }} className="text-pink-500 font-bold ml-2 shrink-0">{isCopied ? '¡Copiado!' : 'Copiar enlace'}</button>
                 </div>
              </div>

              <div className="flex flex-col gap-1">
                 <label className="font-bold text-gray-700 ml-1 text-sm">Nombre de Pantalla</label>
                 <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" />
              </div>
              <div className="flex flex-col gap-1">
                 <label className="font-bold text-gray-700 ml-1 text-sm">Username</label>
                 <input type="text" value={editUsername} onChange={e => setEditUsername(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" />
              </div>
              <div className="flex justify-center my-2">
                  <ImageUpload label="Foto de Perfil" value={editPhoto} onChange={setEditPhoto} variant="avatar" className="w-auto items-center" />
              </div>
              <ImageUpload label="Banner URL" value={editBanner} onChange={setEditBanner} variant="banner" />

              <div className="flex flex-col gap-1">
                 <label className="font-bold text-gray-700 ml-1 text-sm">Presentación (Bio)</label>
                 <textarea value={editBio} onChange={e => setEditBio(e.target.value)} rows={3} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500 resize-none text-sm" placeholder="Cuéntale algo a tu audiencia..." />
              </div>

              <div className="flex flex-col gap-2">
                 <div className="flex items-center justify-between ml-1">
                    <label className="font-bold text-gray-700 text-sm">Mis Enlaces</label>
                    <button onClick={() => setEditProfileLinks(prev => [...prev, { title: '', url: '' }])} className="text-pink-500 font-bold text-xs flex items-center gap-1 hover:text-pink-600 transition-colors">
                       <Plus className="w-3.5 h-3.5" /> Añadir
                    </button>
                 </div>
                 {editProfileLinks.length === 0 && (
                    <p className="text-gray-400 text-xs ml-1">Sin enlaces todavía. Pulsa «Añadir» para crear uno.</p>
                 )}
                 {editProfileLinks.map((lnk, i) => (
                    <div key={i} className="flex gap-2 items-start">
                       <div className="flex flex-col gap-1.5 flex-1">
                          <input type="text" value={lnk.title} onChange={e => { const n = [...editProfileLinks]; n[i] = { ...n[i], title: e.target.value }; setEditProfileLinks(n); }} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-pink-500 text-sm" placeholder="Título del enlace" />
                          <input type="url" value={lnk.url} onChange={e => { const n = [...editProfileLinks]; n[i] = { ...n[i], url: e.target.value }; setEditProfileLinks(n); }} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-pink-500 text-sm" placeholder="https://..." />
                       </div>
                       <button onClick={() => setEditProfileLinks(prev => prev.filter((_, j) => j !== i))} className="mt-1 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors shrink-0">
                          <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                 ))}
              </div>

              <button disabled={isSaving} onClick={handleSaveProfile} className="mt-4 w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition active:scale-95">
                 {isSaving ? 'Guardando...' : 'Guardar Cambios'}
              </button>

              {/* Light / Dark mode toggle */}
              <div className="flex items-center justify-between px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl">
                <div className="flex items-center gap-3">
                  {lightMode ? <Sun className="w-5 h-5 text-pink-500" /> : <Moon className="w-5 h-5 text-gray-500" />}
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{lightMode ? 'Modo Claro' : 'Modo Oscuro'}</p>
                    <p className="text-gray-500 text-xs">{lightMode ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}</p>
                  </div>
                </div>
                <button onClick={() => setLightMode(v => !v)} className={cn("relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none", lightMode ? "bg-pink-500" : "bg-gray-300")}>
                  <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300", lightMode ? "translate-x-6" : "translate-x-0")} />
                </button>
              </div>
           </div>
        )}

        {/* --- VIEW: EXPLORER --- */}
        {activeTab === 'explorer' && user && (
           <ExplorerView currentUser={user} userProfile={profile} searchQuery={searchQuery} onOverlayChange={setExplorerOverlayActive} />
        )}

        {/* --- VIEW: NOTIFICATIONS --- */}
        {activeTab === 'notifications' && (
           <div className="flex-1 overflow-y-auto no-scrollbar bg-gray-50 pb-24 border-t border-gray-100">
               {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center text-gray-500 min-h-[50vh]">
                     <Bell className="w-12 h-12 mb-4 text-gray-300" />
                     <p className="font-medium">No tienes notificaciones aún.</p>
                  </div>
               ) : (
                  <div className="flex flex-col">
                     {notifications.map(n => (
                        <div key={n.id} onClick={() => { updateDoc(doc(db, `users/${user!.uid}/notifications`, n.id), { read: true }); if (n.link) navigate(n.link); }} className={cn("p-4 border-b border-gray-100 cursor-pointer flex gap-4 transition-colors", n.read ? "bg-white" : "bg-pink-50/50 hover:bg-pink-50")}>
                           <div className="mt-1 shrink-0">
                               {n.type === 'contact_request' ? <User className="w-5 h-5 text-pink-500" /> : n.type === 'sale' ? <DollarSign className="w-5 h-5 text-green-500" /> : <Bell className="w-5 h-5 text-blue-500" />}
                           </div>
                           <div className="flex-1">
                               <p className={cn("text-sm text-gray-900 leading-snug mb-1", !n.read && "font-semibold")}>{n.message}</p>
                               <span className="text-xs text-gray-400 font-medium tracking-wide block">{new Date(n.createdAt).toLocaleDateString()}</span>
                           </div>
                           {!n.read && <div className="w-2 h-2 rounded-full bg-pink-500 mt-2 shrink-0"></div>}
                        </div>
                     ))}
                  </div>
               )}
           </div>
        )}

        {/* --- VIEW: WALLET --- */}
        {activeTab === 'wallet' && (
           <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50">
              {/* Sub-tab selector */}
              <div className="px-4 pt-4 pb-2 shrink-0">
                 <div className="flex bg-gray-100 p-1 rounded-2xl">
                    <button onClick={() => setWalletSubTab('balance')} className={cn("flex-1 py-2 font-bold text-sm rounded-xl transition-all", walletSubTab === 'balance' ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700")}>Mi Billetera</button>
                    <button onClick={() => setWalletSubTab('tokens')} className={cn("flex-1 py-2 font-bold text-sm rounded-xl transition-all", walletSubTab === 'tokens' ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700")}>Wallet Tokens</button>
                 </div>
              </div>

              {/* APARTADO 1: Billetera actual — sin tocar nada */}
              {walletSubTab === 'balance' && (
                 <div className="flex-1 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto pb-24">
                    {/* Balance Card */}
                    <div className="bg-gray-900 rounded-[32px] p-6 border border-gray-800 shadow-xl relative overflow-hidden">
                       
                       <div className="flex items-center justify-between mb-2 relative z-10">
                          <div className="flex items-center gap-2 text-gray-400">
                             <Wallet className="w-5 h-5 text-gray-400" />
                             <span className="font-bold text-sm">Balance Disponible</span>
                          </div>
                          <button className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-700 transition-colors border border-gray-700">
                             <History className="w-4 h-4 text-gray-300" />
                          </button>
                       </div>
                       <div className="flex items-baseline gap-1 relative z-10">
                          <span className="text-4xl md:text-5xl font-black text-white tracking-tight">${profile?.walletBalance?.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) || '0.00'}</span>
                          <span className="text-gray-400 font-bold">USD</span>
                       </div>
                       
                       <div className="mt-8 flex gap-3 relative z-10">
                          <button onClick={() => {
                              if (!profile || profile.walletBalance <= 0) { showAlert("No tienes balance disponible para retirar.", 'error'); return; }
                              setWithdrawInput('');
                              setShowWithdrawModal(true);
                          }} className="flex-1 bg-white hover:bg-gray-100 text-gray-900 py-3.5 rounded-[16px] font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm">
                             <ArrowUpRight className="w-5 h-5" />
                             Retirar
                          </button>
                          <button onClick={() => showAlert("Métodos de pago en desarrollo. Por ahora usamos pago simulado para hacer pruebas.", 'info')} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3.5 rounded-[16px] font-bold flex items-center justify-center gap-2 transition-all active:scale-95 border border-gray-700 shadow-sm">
                             <CreditCard className="w-5 h-5" />
                             <span className="truncate">Métodos P.</span>
                          </button>
                       </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3 md:gap-4">
                       <div className="bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm">
                          <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                             <TrendingUp className="w-5 h-5 text-gray-900" />
                          </div>
                          <p className="text-gray-500 text-xs font-bold mb-1 uppercase tracking-wider">Ventas Totales</p>
                          <p className="text-2xl font-black text-gray-900">${(profile?.totalSales || 0).toLocaleString('en-US', {minimumFractionDigits:2})}</p>
                       </div>
                       <div className="bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm">
                          <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                             <CheckCircle2 className="w-5 h-5 text-gray-900" />
                          </div>
                          <p className="text-gray-500 text-xs font-bold mb-1 uppercase tracking-wider">Zonas Activas</p>
                          <p className="text-2xl font-black text-gray-900">{slots.filter(s => s.isRented).length} <span className="text-gray-300 text-lg font-medium">/ {slots.length}</span></p>
                       </div>
                    </div>

                    {/* Transactions History */}
                    <div>
                       <div className="flex items-center justify-between mb-4 px-1">
                          <h3 className="font-black text-gray-900 text-lg">Historial Reciente</h3>
                          <button className="text-gray-900 text-sm font-bold flex items-center gap-1 hover:text-gray-600 transition-colors">
                             Ver todo <ArrowUpRight className="w-4 h-4" />
                          </button>
                       </div>
                       
                       <div className="bg-white rounded-[24px] border border-gray-100 p-2 overflow-hidden shadow-sm">
                          <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400">
                             <History className="w-8 h-8 mb-2 text-gray-200" />
                             <p className="text-sm font-medium">No hay transacciones aún.</p>
                          </div>
                       </div>
                    </div>
                 </div>
              )}

              {/* APARTADO 2: Wallet de Tokens */}
              {walletSubTab === 'tokens' && (
                 <div className="flex-1 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto pb-24">
                    {/* Token Balance Card */}
                    <div className="bg-gray-900 rounded-[32px] p-6 border border-gray-800 shadow-xl relative overflow-hidden">
                       <div className="flex items-center justify-between mb-2 relative z-10">
                          <div className="flex items-center gap-2 text-gray-400">
                             <DollarSign className="w-5 h-5 text-gray-400" />
                             <span className="font-bold text-sm">Tokens en Cartera</span>
                          </div>
                          <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center border border-gray-700">
                             <TrendingUp className="w-4 h-4 text-gray-300" />
                          </div>
                       </div>
                       <div className="flex items-baseline gap-1 relative z-10 mb-1">
                          <span className="text-4xl md:text-5xl font-black text-white tracking-tight">{formatTokenAmount(tokenHoldings.reduce((sum, h) => sum + h.balance, 0))}</span>
                          <span className="text-gray-400 font-bold">Tokens</span>
                       </div>
                       <p className="text-gray-500 text-xs font-medium relative z-10">Balance real tras alquileres, compras y ventas</p>
                    </div>

                    {/* Token List */}
                    <div>
                       <div className="flex items-center justify-between mb-4 px-1">
                          <h3 className="font-black text-gray-900 text-lg">Mis Tokens</h3>
                          <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">{tokenHoldings.length} activos</span>
                       </div>
                       <div className="flex flex-col gap-3">
                          {(() => {
                             const byProfile: Record<string, {count: number, profileUsername: string, profilePhoto?: string, profileDisplayName?: string, txs: { id: string; price: number; createdAt: number; duration?: number; tokensMinted?: number }[]}> = {};
                             tokenHoldings.forEach(r => {
                                if (!byProfile[r.profileId]) byProfile[r.profileId] = {
                                   count: 0,
                                   profileUsername: r.profileUsername || r.profileId,
                                   profilePhoto: r.profilePhoto,
                                   profileDisplayName: r.profileDisplayName,
                                   txs: tokenTransactions.filter(tx => tx.profileId === r.profileId).map(tx => ({ id: tx.id, price: tx.price || 1, createdAt: tx.createdAt || Date.now(), tokensMinted: tx.tokensMinted ?? tx.price ?? 1 }))
                                };
                                byProfile[r.profileId].count += r.balance;
                             });                             const tokenList = Object.entries(byProfile);
                             if (tokenList.length === 0) return <p className="text-gray-400 text-sm text-center py-6">No tienes tokens en cartera.</p>;
                             return tokenList.map(([pid, t]) => {
                                const symbol = (t.profileUsername || t.profileDisplayName || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'VIP';
                                const marketProfile = { username: t.profileUsername, displayName: t.profileDisplayName || t.profileUsername, photoURL: t.profilePhoto || '', bannerURL: '', walletBalance: 0, prices25: { price1: t.txs[0]?.price || 1, price7: 0, price30: 0, price365: 0 }, createdAt: null, updatedAt: null } as CreatorProfile;
                                return (
                                   <div key={pid} className="bg-white rounded-[24px] border border-gray-100 p-4 shadow-sm flex items-center gap-4">
                                      <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                                         {t.profilePhoto ? <img src={t.profilePhoto} alt={symbol} className="w-full h-full object-cover" /> : <span className="text-white font-black text-[10px] tracking-wider">{symbol}</span>}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                         <p className="font-black text-gray-900 text-sm">{t.profileDisplayName || t.profileUsername || 'Perfil'}</p>
                                         <p className="text-gray-400 text-xs font-bold mt-0.5">@{t.profileUsername}</p>
                                         <div className="flex gap-2 mt-2">
                                            <button onClick={() => { setWalletCreatorId(pid); setWalletDefaultSide('buy'); setWalletMarketData({ profile: marketProfile, txs: t.txs }); }} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[11px] font-black">Comprar</button>
                                            <button onClick={() => { setWalletCreatorId(pid); setWalletDefaultSide('sell'); setWalletMarketData({ profile: marketProfile, txs: t.txs }); }} className="px-3 py-1.5 rounded-lg bg-pink-500 text-white text-[11px] font-black">Vender</button>
                                         </div>
                                      </div>
                                      <div className="text-right shrink-0">
                                         <p className="font-black text-gray-900 text-lg">{formatTokenAmount(t.count)}</p>
                                         <p className="text-gray-400 text-[11px] font-bold">tokens</p>
                                      </div>
                                   </div>
                                );
                             });
                          })()}
                       </div>
                    </div>

                    {/* Open Limit Orders — with cancel button */}
                    {myOpenTokenOrders.length > 0 && (
                    <div>
                       <div className="flex items-center justify-between mb-4 px-1">
                          <h3 className="font-black text-gray-900 text-lg">Órdenes Abiertas</h3>
                          <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">{myOpenTokenOrders.length} activas</span>
                       </div>
                       <div className="bg-white rounded-[24px] border border-gray-100 p-2 overflow-hidden shadow-sm flex flex-col divide-y divide-gray-50">
                          {myOpenTokenOrders.map(order => {
                            const sym = (order.symbol || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
                            const isBuy = order.side === 'buy';
                            return (
                              <div key={order.id} className="flex items-center gap-3 px-3 py-3">
                                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white font-black text-[9px]", isBuy ? "bg-gray-900" : "bg-pink-500")}>
                                  {sym}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-gray-900 text-sm leading-tight">{isBuy ? 'Compra límite' : 'Venta límite'} · {sym}</p>
                                  <p className="text-gray-400 text-xs">{formatTokenAmount(order.amount)} tokens @ {formatTokenPrice(order.price)}</p>
                                </div>
                                <button
                                  onClick={async () => {
                                    try {
                                      await cancelTokenOrder(order.id);
                                      showAlert('Orden cancelada. Los fondos han sido devueltos.', 'success');
                                    } catch (e: any) { showAlert('Error al cancelar: ' + e.message, 'error'); }
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-black hover:bg-red-50 hover:text-red-500 transition-colors"
                                >
                                  Cancelar
                                </button>
                              </div>
                            );
                          })}
                       </div>
                    </div>
                    )}

                    {/* Token Transaction History — rentals + P2P trades merged */}
                    <div>
                       <div className="flex items-center justify-between mb-4 px-1">
                          <h3 className="font-black text-gray-900 text-lg">Historial Reciente</h3>
                          <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">{tokenTransactions.length + p2pTradesBuy.length + p2pTradesSell.length} ops.</span>
                       </div>
                       <div className="bg-white rounded-[24px] border border-gray-100 p-2 overflow-hidden shadow-sm">
                          {tokenTransactions.length === 0 && p2pTradesBuy.length === 0 && p2pTradesSell.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400">
                               <History className="w-8 h-8 mb-2 text-gray-200" />
                               <p className="text-sm font-medium">No hay historial de tokens aún.</p>
                            </div>
                          ) : (() => {
                            // Merge rental mints + P2P trades, sort by date
                            const rentalItems = tokenTransactions.map(tx => ({
                              id: tx.id, kind: 'rental' as const,
                              sym: (tx.profileUsername || tx.profileId || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
                              label: tx.profileDisplayName || tx.profileUsername || tx.profileId,
                              sub: 'Alquiler',
                              photo: tx.profilePhoto,
                              amount: tx.tokensMinted ?? tx.price ?? 0,
                              sign: '+',
                              createdAt: tx.createdAt || 0,
                            }));
                            const p2pBuyItems = p2pTradesBuy.map(t => ({
                              id: `buy-${t.id}`, kind: 'p2p' as const,
                              sym: (t.symbol || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
                              label: (t.symbol || t.creatorId || 'Token').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
                              sub: 'Compra P2P',
                              photo: undefined,
                              amount: t.amount,
                              sign: '+',
                              createdAt: t.createdAt || 0,
                            }));
                            const p2pSellItems = p2pTradesSell.map(t => ({
                              id: `sell-${t.id}`, kind: 'p2p' as const,
                              sym: (t.symbol || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
                              label: (t.symbol || t.creatorId || 'Token').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(),
                              sub: 'Venta P2P',
                              photo: undefined,
                              amount: t.amount,
                              sign: '-',
                              createdAt: t.createdAt || 0,
                            }));
                            const all = [...rentalItems, ...p2pBuyItems, ...p2pSellItems].sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
                            return (
                              <div className="flex flex-col divide-y divide-gray-50">
                                {all.map(item => {
                                  const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
                                  return (
                                    <div key={item.id} className="flex items-center gap-3 px-3 py-3">
                                      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0 overflow-hidden", item.kind === 'p2p' && item.sign === '+' ? "bg-gray-900" : item.kind === 'p2p' ? "bg-pink-500" : "bg-gray-900")}>
                                        {item.photo ? <img src={item.photo} alt={item.sym} className="w-full h-full object-cover" /> : <span className="text-white font-black text-[9px]">{item.sym}</span>}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-gray-900 text-sm leading-tight truncate">{item.label}</p>
                                        <p className="text-gray-400 text-xs">{item.sub} · {dateStr}</p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className={cn("font-black text-sm", item.sign === '+' ? "text-gray-900" : "text-pink-500")}>{item.sign}{formatTokenAmount(item.amount)}</p>
                                        <p className="text-gray-400 text-[10px] font-bold">{item.sym} tokens</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                       </div>
                    </div>
                 </div>
              )}
           </div>
        )}

        <AnimatePresence>
          {walletOrderBook && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setWalletOrderBook(null)} className="fixed inset-0 bg-black/55 z-50 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 28, scale: 0.98 }} className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-h-[92dvh] overflow-hidden rounded-t-[28px] bg-white shadow-2xl md:inset-6 md:bottom-auto md:max-w-none md:rounded-[28px]">
                <div className="flex h-full max-h-[92dvh] flex-col">
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 md:px-7">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Order book</p>
                      <h2 className="text-xl font-black text-gray-900 md:text-2xl">{walletOrderBook.symbol} Market</h2>
                    </div>
                    <button onClick={() => setWalletOrderBook(null)} className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-900">
                      <PlusSquare className="h-5 w-5 rotate-45" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 md:p-7">
                    <TokenMarketPanel
                      market={walletOrderBook}
                      openSellOffers={walletOpenSellOffers}
                      buyAmount={walletBuyTokenAmount}
                      sellAmount={walletSellTokenAmount}
                      onBuyAmountChange={setWalletBuyTokenAmount}
                      onSellAmountChange={setWalletSellTokenAmount}
                      onConfirm={async (side, orderType, price) => {
                        if (!user || !walletOrderBook.creatorId) return;
                        const amount = side === 'buy' ? walletBuyTokenAmount : walletSellTokenAmount;
                        if (amount <= 0) { showAlert('Introduce una cantidad mayor que cero.', 'error'); return; }
                        try {
                          const result = await placeOrFillTokenOrder({
                            userId: user.uid,
                            creatorId: walletOrderBook.creatorId,
                            side,
                            orderType,
                            price,
                            amount,
                            symbol: walletOrderBook.symbol,
                            matchingOrders: walletCreatorOrders
                          });
                          showAlert(result.message, result.filled ? 'success' : 'info');
                        } catch (e: any) { showAlert('Error al ejecutar la orden: ' + e.message, 'error'); }
                      }}
                    />
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* BOTTOM NAVIGATION */}
        {!explorerOverlayActive && <BottomNav activeTab={activeTab} onTabChange={setActiveTab} unreadCount={notifications.filter(n => !n.read).length} />}

        {/* PRICE EDIT MODAL */}
        <AnimatePresence>
            {deletingSlot && (
              <React.Fragment key="deleting">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingSlot(null)} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[400px] bg-white rounded-[32px] p-6 z-50 shadow-2xl flex flex-col items-center">
                   <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
                      <Trash2 className="w-8 h-8 text-red-500" />
                   </div>
                   <h3 className="font-black text-xl mb-2 text-center text-gray-900">¿Eliminar esta ZonaVip?</h3>
                   <p className="text-gray-500 text-center text-sm mb-6 leading-relaxed">
                     Esta acción no se puede deshacer. Perderás este espacio publicitario de forma permanente.
                   </p>
                   <div className="flex gap-3 w-full">
                      <button onClick={() => setDeletingSlot(null)} className="flex-1 py-3.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-2xl font-bold transition-colors active:scale-95">
                         Cancelar
                      </button>
                      <button onClick={() => { handleDeleteSlotConfirm(deletingSlot); setDeletingSlot(null); }} className="flex-1 py-3.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold transition-colors active:scale-95 shadow-[0_4px_12px_rgba(239,68,68,0.3)]">
                         Si, eliminar
                      </button>
                   </div>
                </motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {editingSize && (
              <React.Fragment key="editing">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingSize(null)} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] bg-white rounded-t-[32px] z-50 shadow-2xl h-[85vh] overflow-hidden flex flex-col"><div className="flex-1 overflow-y-auto p-6 pb-16">
                   <h3 className="font-black text-xl mb-6">Precios (Zona {editingSize}%)</h3>
                   <div className="flex flex-col gap-3">
                      {(() => {
                         const colorTheme = {
                           25: { border: 'border-gray-800', bg: 'bg-white', text: 'text-gray-900', tsub: 'text-gray-500', check: 'focus:border-gray-800' },
                           50: { border: 'border-gray-800', bg: 'bg-white', text: 'text-gray-900', tsub: 'text-gray-500', check: 'focus:border-gray-800' },
                           75: { border: 'border-gray-800', bg: 'bg-white', text: 'text-gray-900', tsub: 'text-gray-500', check: 'focus:border-gray-800' },
                           100: { border: 'border-gray-800', bg: 'bg-white', text: 'text-gray-900', tsub: 'text-gray-500', check: 'focus:border-gray-800' }
                         }[editingSize as 25|50|75|100] || { border: 'border-gray-800', bg: 'bg-white', text: 'text-gray-900', tsub: 'text-gray-500', check: 'focus:border-gray-800' };

                         return [
                            { d: 1, label: '1 Día', val: price1, set: setPrice1 },
                            { d: 7, label: '1 Semana', val: price7, set: setPrice7 },
                            { d: 30, label: '1 Mes', val: price30, set: setPrice30 },
                            { d: 365, label: '1 Año', val: price365, set: setPrice365 }
                         ].map(item => (
                            <div key={item.d} className={cn("flex items-center justify-between p-3 rounded-2xl border transition-colors", colorTheme.bg, colorTheme.border)}>
                               <span className={cn("font-bold", colorTheme.text)}>{item.label}</span>
                               <div className="flex items-center gap-2">
                                   <span className={cn("font-black", colorTheme.tsub)}>$</span>
                                   <input type="number" value={item.val} onChange={e=>item.set(Number(e.target.value))} className={cn("w-20 bg-white px-3 py-2 rounded-xl text-center font-bold text-lg outline-none border border-transparent transition-colors", colorTheme.check, colorTheme.text)} />
                               </div>
                            </div>
                         ));
                      })()}
                   </div>
                   <button disabled={isSavingPrices || saveSuccess} onClick={handleSavePrices} className={cn("w-full mt-6 py-4 text-white rounded-2xl font-bold shadow-md transition active:scale-95 text-lg disabled:opacity-80 flex items-center justify-center gap-2", {
                         25: saveSuccess ? 'bg-green-500' : 'bg-gray-900 hover:bg-black',
                         50: saveSuccess ? 'bg-green-500' : 'bg-gray-900 hover:bg-black',
                         75: saveSuccess ? 'bg-green-500' : 'bg-gray-900 hover:bg-black',
                         100: saveSuccess ? 'bg-green-500' : 'bg-gray-900 hover:bg-black'
                       }[editingSize as 25|50|75|100] || (saveSuccess ? 'bg-green-500' : 'bg-gray-900 hover:bg-black'))}>
                      {isSavingPrices ? 'Guardando...' : saveSuccess ? (
                          <>
                             <CheckCircle2 className="w-5 h-5" />
                             ¡Guardado!
                          </>
                      ) : 'Guardar Precios'}
                   </button>
                   <button onClick={() => setEditingSize(null)} className="w-full mt-2 py-3 text-gray-500 font-bold hover:text-gray-900">Cancelar</button>
                </div></motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {selectedTenantSlot && (
              <React.Fragment key="editing-tenant">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setSelectedTenantSlot(null); setConfirmClearSlot(false); }} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 left-1/2 w-full max-w-[500px] -translate-x-1/2 bg-white rounded-t-[32px] z-50 shadow-2xl h-[85vh] overflow-hidden flex flex-col md:top-1/2 md:bottom-auto md:max-w-[760px] md:h-[82vh] md:-translate-y-1/2 md:rounded-[32px]"><div className="flex-1 overflow-y-auto p-6 pb-16">
                   <div className="flex justify-between items-center mb-6">
                      <h3 className="font-black text-xl text-gray-900">Editar ZonaVip</h3>
                      {confirmClearSlot ? (
                        <div className="flex gap-2 items-center">
                          <span className="text-xs text-gray-500 font-medium">¿Seguro?</span>
                          <button onClick={() => { setConfirmClearSlot(false); handleClearTenantData(); }} className="text-white text-xs font-bold bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 transition-colors">Sí, liberar</button>
                          <button onClick={() => setConfirmClearSlot(false)} className="text-gray-500 text-xs font-bold bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmClearSlot(true)} className="text-red-500 text-sm font-bold bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-100 transition-colors">Liberar Espacio</button>
                      )}
                   </div>
                   
                   <p className="text-sm text-gray-500 mb-6">Puedes actualizar el banner y el texto que aparece en este espacio en tiempo real.</p>
                   
                   {(!selectedTenantSlot.slot.brand && !selectedTenantSlot.slot.image) ? (
                     <>
                       <div className="flex gap-2 mb-6">
                          {selectedTenantSlot.slot.width > 25 && (
                             <button disabled={isProcessingSlot} onClick={handleTenantDivide} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition">
                                Dividir Espacio
                             </button>
                          )}
                          {selectedTenantSlot.slot.width < 100 && (() => {
                             const parentId = selectedTenantSlot.slot.id.substring(0, selectedTenantSlot.slot.id.lastIndexOf('-'));
                             const requiredSiblings = selectedTenantSlot.slot.width === 25 ? 4 : 2;
                             const siblingsCount = rentedSlots.filter(s => s.profileId === selectedTenantSlot.profileId && s.slot.id.startsWith(parentId + '-') && s.slot.width === selectedTenantSlot.slot.width).length;
                             
                             if (siblingsCount === requiredSiblings) {
                                 return (
                                    <button disabled={isProcessingSlot} onClick={handleTenantJoin} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition">
                                       Unir con vecinos
                                    </button>
                                 );
                             }
                             return null;
                          })()}
                       </div>

                       <div className="flex flex-col gap-4 mb-6">
                           <label className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-100 transition">
                              <input type="checkbox" checked={tenantEditForResale} onChange={e => {
                                  setTenantEditForResale(e.target.checked);
                                  if (e.target.checked) {
                                     setTenantEditBrand('');
                                     setTenantEditBrandImg('');
                                     setTenantEditCaption('');
                                     setTenantEditImage('');
                                  }
                              }} className="w-5 h-5 accent-pink-500 rounded-md" />
                              <div>
                                <span className="font-bold text-gray-900 block">Poner en Reventa</span>
                                <span className="text-xs text-gray-500">Permite que otros anunciantes compren tu espacio.</span>
                              </div>
                           </label>

                           {tenantEditForResale && (
                             <div className="bg-white border-2 border-green-500 rounded-2xl p-4 shadow-sm mb-4">
                                <h4 className="font-black text-green-600 mb-3 text-sm">Configurar Precios de Reventa</h4>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                   <div className="flex flex-col gap-1"><label className="text-xs font-bold text-gray-400 ml-1">1 Día (€)</label><input type="number" min="0" value={tenantEditResalePrices.price1} onChange={e => setTenantEditResalePrices({...tenantEditResalePrices, price1: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-50 rounded-xl outline-none font-black text-xl text-center border focus:border-green-500" /></div>
                                   <div className="flex flex-col gap-1"><label className="text-xs font-bold text-gray-400 ml-1">7 Días (€)</label><input type="number" min="0" value={tenantEditResalePrices.price7} onChange={e => setTenantEditResalePrices({...tenantEditResalePrices, price7: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-50 rounded-xl outline-none font-black text-xl text-center border focus:border-green-500" /></div>
                                   <div className="flex flex-col gap-1"><label className="text-xs font-bold text-gray-400 ml-1">1 Mes (€)</label><input type="number" min="0" value={tenantEditResalePrices.price30} onChange={e => setTenantEditResalePrices({...tenantEditResalePrices, price30: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-50 rounded-xl outline-none font-black text-xl text-center border focus:border-green-500" /></div>
                                   <div className="flex flex-col gap-1"><label className="text-xs font-bold text-gray-400 ml-1">1 Año (€)</label><input type="number" min="0" value={tenantEditResalePrices.price365} onChange={e => setTenantEditResalePrices({...tenantEditResalePrices, price365: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-50 rounded-xl outline-none font-black text-xl text-center border focus:border-green-500" /></div>
                                </div>
                             </div>
                           )}
                       </div>
                     </>
                   ) : (
                     <div className="bg-blue-50 border border-blue-100 text-blue-800 p-4 rounded-2xl mb-6 text-sm">
                       <strong className="block mb-1">¿Quieres revender, dividir o fusionar?</strong>
                       Primero debes <b>Liberar Espacio</b> (botón superior derecho) para borrar tu anuncio actual. Tu espacio quedará en blanco pero seguirás siendo el propietario.
                     </div>
                   )}

                   {!tenantEditForResale && (
                     <div className="flex flex-col gap-4 mb-6">
                         <ImageUpload label="Imagen del Anuncio" value={tenantEditImage} onChange={setTenantEditImage} />
                         
                         <div className="flex flex-col gap-1">
                            <label className="font-bold text-gray-700 ml-1 text-sm">Nombre de la Marca</label>
                            <input type="text" value={tenantEditBrand} onChange={e => setTenantEditBrand(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" placeholder="Ej. Nike, Spotify..." />
                         </div>
  
                         <ImageUpload label="Logo de la Marca" value={tenantEditBrandImg} onChange={setTenantEditBrandImg} />
                         
                         <div className="flex flex-col gap-1">
                            <label className="font-bold text-gray-700 ml-1 text-sm">Caption (Texto inferior)</label>
                            <input type="text" value={tenantEditCaption} onChange={e => setTenantEditCaption(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" placeholder="Texto que aparecerá..." />
                         </div>

                         <div className="flex flex-col gap-1">
                            <label className="font-bold text-gray-700 ml-1 text-sm">Enlace (Opcional)</label>
                            <input type="url" value={tenantEditLink} onChange={e => setTenantEditLink(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" placeholder="https://tusitio.com" />
                         </div>
                     </div>
                   )}

                   <button disabled={isProcessingSlot} onClick={handleSaveTenantEdit} className="w-full py-4 text-white rounded-2xl font-bold shadow-md transition active:scale-95 text-lg disabled:opacity-80 flex items-center justify-center gap-2 bg-gray-900 hover:bg-black">
                      {isProcessingSlot ? 'Guardando...' : 'Guardar Cambios'}
                   </button>
                   <button onClick={() => setSelectedTenantSlot(null)} className="w-full mt-2 py-3 text-gray-500 font-bold hover:text-gray-900 min-h-[44px]">Cerrar</button>
                </div></motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>

      </main>

      {/* Withdraw Modal */}
      <AnimatePresence>
        {showWithdrawModal && profile && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowWithdrawModal(false)} className="fixed inset-0 bg-black/60 z-[200] backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 20 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }} className="fixed inset-0 z-[200] flex items-center justify-center p-6">
              <div className="bg-gray-100 rounded-[28px] p-7 w-full max-w-[340px] shadow-2xl flex flex-col gap-5 border border-teal-500/20">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-xl text-gray-900">Retirar fondos</h3>
                  <button onClick={() => setShowWithdrawModal(false)} className="p-1.5 rounded-full bg-gray-200 hover:bg-gray-300 transition"><X className="w-4 h-4 text-gray-600" /></button>
                </div>
                <p className="text-gray-500 text-sm">Máximo disponible: <span className="font-black text-gray-900">${profile.walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></p>
                <input
                  type="number"
                  min="0"
                  max={profile.walletBalance}
                  step="0.01"
                  value={withdrawInput}
                  onChange={e => setWithdrawInput(e.target.value)}
                  placeholder="0.00"
                  className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500 text-gray-900 font-black text-xl text-center"
                />
                <div className="flex gap-3">
                  <button onClick={() => setShowWithdrawModal(false)} className="flex-1 py-3 bg-gray-200 text-gray-900 rounded-xl font-bold text-sm hover:bg-gray-300 transition-colors">Cancelar</button>
                  <button onClick={async () => {
                    const amount = parseFloat(withdrawInput);
                    if (isNaN(amount) || amount <= 0 || amount > profile.walletBalance) { showAlert('Monto inválido.', 'error'); return; }
                    try {
                      await updateDoc(doc(db, `creatorProfiles/${user!.uid}`), { walletBalance: increment(-amount) });
                      setShowWithdrawModal(false);
                      showAlert(`Has retirado $${amount} exitosamente (Simulado).`, 'success');
                    } catch(e: any) { showAlert(e.message, 'error'); }
                  }} className="flex-1 py-3 bg-pink-500 text-white rounded-xl font-bold text-sm hover:bg-pink-600 transition-colors">Confirmar</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
function PublicProfile({ currentUser }: { currentUser: FirebaseUser | null }) {
  const { username } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [slots, setSlots] = useState<AdSpace[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessingSlot, setIsProcessingSlot] = useState(false);
  const [storyOverlayActive, setStoryOverlayActive] = useState(false);

  const handleDivide = async (slotId: string) => {
    if (!currentUser || isProcessingSlot || !profileId) return;
    const slotIndex = slots.findIndex(s => s.id === slotId);
    if (slotIndex === -1) return;
    const slot = slots[slotIndex];
    if (!slot || slot.width <= 25) return;
    if (slot.isRented && slot.rentedBy !== currentUser.uid) return;

    setIsProcessingSlot(true);
    const path = `creatorProfiles/${profileId}/adSpaces`;
    const batch = writeBatch(db);

    if (slot.width === 100) {
      const slotA: AdSpace = { ...slot, id: `${slot.id}-a`, width: 50, order: slot.order };
      const slotB: AdSpace = { ...slot, id: `${slot.id}-b`, width: 50, order: slot.order + 500 };
      batch.delete(doc(db, path, slot.id));
      batch.set(doc(db, path, slotA.id), slotA);
      batch.set(doc(db, path, slotB.id), slotB);
    } else if (slot.width === 50) {
      const s1: AdSpace = { ...slot, id: `${slot.id}-1`, width: 25, order: slot.order };
      const s2: AdSpace = { ...slot, id: `${slot.id}-2`, width: 25, order: slot.order + 100 };
      const s3: AdSpace = { ...slot, id: `${slot.id}-3`, width: 25, order: slot.order + 200 };
      const s4: AdSpace = { ...slot, id: `${slot.id}-4`, width: 25, order: slot.order + 300 };
      batch.delete(doc(db, path, slot.id));
      batch.set(doc(db, path, s1.id), s1);
      batch.set(doc(db, path, s2.id), s2);
      batch.set(doc(db, path, s3.id), s3);
      batch.set(doc(db, path, s4.id), s4);
    }

    try {
      await batch.commit();
    } catch(e: any) {
      showAlert(e.message || 'No se pudo dividir el espacio.', 'error');
    } finally {
      setIsProcessingSlot(false);
    }
  };

  const handleJoin = async (slotId: string) => {
    if (!currentUser || isProcessingSlot || !profileId) return;
    const slotIndex = slots.findIndex(s => s.id === slotId);
    if (slotIndex === -1) return;
    const slot = slots[slotIndex];
    if (!slot || slot.width >= 100) return;
    if (slot.isRented && slot.rentedBy !== currentUser.uid) return;

    setIsProcessingSlot(true);
    const path = `creatorProfiles/${profileId}/adSpaces`;
    const batch = writeBatch(db);

    if (slot.width === 25) {
      const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
      const siblings = slots.filter(s => s.id.startsWith(parentId + '-') && s.width === 25);
      if (siblings.length !== 4) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar las 4 piezas.', 'error'); return; }
      
      if (slot.isRented) {
         if (siblings.some(s => !s.isRented || s.rentedBy !== currentUser.uid)) {
             setIsProcessingSlot(false); showAlert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.', 'error'); return;
         }
      } else {
         if (siblings.some(s => s.isRented)) { setIsProcessingSlot(false); showAlert('No puedes unir si alguna parte está alquilada por otro.', 'error'); return; }
      }
      
      const minOrder = Math.min(...siblings.map(s => s.order));
      const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 50, order: minOrder };
      for (const s of siblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    } else if (slot.width === 50) {
      const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
      const siblings = slots.filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
      if (siblings.length !== 2) { setIsProcessingSlot(false); showAlert('Faltan partes para unir. Deben estar ambas mitades.', 'error'); return; }
      
      if (slot.isRented) {
         if (siblings.some(s => !s.isRented || s.rentedBy !== currentUser.uid)) {
             setIsProcessingSlot(false); showAlert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.', 'error'); return;
         }
      } else {
         if (siblings.some(s => s.isRented)) { setIsProcessingSlot(false); showAlert('No puedes unir si alguna parte está alquilada por otro.', 'error'); return; }
      }
      
      const minOrder = Math.min(...siblings.map(s => s.order));
      const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 100, order: minOrder };
      for (const s of siblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    }

    try {
       await batch.commit();
    } catch(e: any) {
       showAlert(e.message || 'No se pudieron unir los espacios.', 'error');
    } finally {
       setIsProcessingSlot(false);
    }
  };

  const viewIncrementedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!username) return;
    const fetchProfile = async () => {
      try {
        const q = query(collection(db, 'creatorProfiles'), where('username', '==', username));
        const snap = await getDocs(q);
        if (!snap.empty) {
           const docObj = snap.docs[0];
           const data = docObj.data() as CreatorProfile;
           setProfileId(docObj.id);
           if ((!currentUser || currentUser.uid !== docObj.id) && viewIncrementedRef.current !== docObj.id) {
              viewIncrementedRef.current = docObj.id;
              data.views = (data.views || 0) + 1;
              updateDoc(docObj.ref, { views: increment(1) }).catch(e => console.log('view increment fail', e));
           }
           setProfile(data);
        } else {
           setProfile(null);
        }
      } catch (err) { handleFirestoreError(err, OperationType.GET, 'creatorProfiles'); } finally { setLoading(false); }
    };
    fetchProfile();
  }, [username, currentUser?.uid]);

  useEffect(() => {
    if (!profileId) return;
    const unsub = onSnapshot(collection(db, `creatorProfiles/${profileId}/adSpaces`), (snap) => {
       const fetchedSlots: AdSpace[] = [];
       snap.forEach(d => fetchedSlots.push({ id: d.id, ...d.data() } as AdSpace));
       fetchedSlots.sort((a,b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
       const isOwner = currentUser?.uid === profileId;
       setSlots(checkAndCleanExpiredSlots(fetchedSlots, profileId, isOwner));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${profileId}/adSpaces`));

    const unsubStories = onSnapshot(collection(db, `creatorProfiles/${profileId}/stories`), (snap) => {
       const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
       const fetchedStories: Story[] = [];
       snap.forEach(d => fetchedStories.push({ id: d.id, ...d.data() } as Story));
       fetchedStories.sort((a, b) => b.createdAt - a.createdAt);
       setStories(fetchedStories.filter(s => s.createdAt > oneDayAgo));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${profileId}/stories`));

    return () => { unsub(); unsubStories(); };
  }, [profileId]);

  if (loading) return <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center font-sans">Cargando perfil...</div>;
  if (!profile) return <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center text-gray-500 font-sans">Perfil no encontrado.</div>;

  return (
    <div className="min-h-[100dvh] bg-white flex justify-center overflow-x-hidden font-sans relative isolate">
      <div className="hidden lg:block absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        {profile.bannerURL ? <img src={profile.bannerURL} className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-35" alt="" /> : <div className="absolute inset-0 bg-gradient-to-br from-pink-950 via-gray-950 to-purple-950" />}
        <div className="absolute inset-0 bg-gray-950/65" />
      </div>
      <main className={cn("w-full max-w-[500px] bg-white relative flex flex-col min-h-[100dvh]", currentUser ? "pb-[60px]" : "")}>
         <div id="profile-scroll-container" className="flex-1 overflow-y-auto w-full pb-10">
            <ProfileView profile={profile} slots={slots} stories={stories} isOwnerPreview={false} profileId={profileId} currentUser={currentUser} onBack={currentUser ? () => navigate('/dashboard', { state: { tab: 'explorer' } }) : undefined} onOverlayChange={setStoryOverlayActive} />
         </div>
         {currentUser && !storyOverlayActive && (
             <BottomNav activeTab="explorer" onTabChange={(tab) => navigate('/dashboard', { state: { tab } })} />
         )}
      </main>
    </div>
  );
}

// -------------------------------------------------------------
// PROFILE LOGIC (USED IN BOTH PUBLIC TRULY AND ADMIN TEST)
// -------------------------------------------------------------
function TransactionsModal({ transactions, onClose }: { transactions: TransactionType[], onClose: () => void }) {
  const [profiles, setProfiles] = useState<Record<string, CreatorProfile>>({});

  useEffect(() => {
    const fetchProfiles = async () => {
      const uids = new Set<string>();
      transactions.forEach(t => {
         if (t.buyerId && t.buyerId !== 'anonymous') uids.add(t.buyerId);
      });
      const toFetch = Array.from(uids).filter(uid => !profiles[uid]);
      if (toFetch.length === 0) return;
      
      const proms = toFetch.map(uid => getDoc(doc(db, `creatorProfiles/${uid}`)));
      const snaps = await Promise.all(proms);
      
      const newMap = { ...profiles };
      snaps.forEach((docSnap, i) => {
         if (docSnap.exists()) newMap[toFetch[i]] = docSnap.data() as CreatorProfile;
      });
      setProfiles(newMap);
    };
    fetchProfiles();
  }, [transactions]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 w-full max-w-[500px] left-1/2 -translate-x-1/2 bg-white rounded-t-[32px] p-6 z-50 shadow-2xl pb-16 h-[85vh] flex flex-col">
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-500">
                  <History className="w-5 h-5" />
               </div>
               <div>
                  <h3 className="font-black text-xl text-gray-900">Historial de Ventas</h3>
                  <p className="text-xs text-gray-500">Transacciones de este perfil</p>
               </div>
             </div>
             <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"><PlusSquare className="w-5 h-5 rotate-45" /></button>
          </div>
          
          <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
             {transactions.length === 0 ? <p className="text-gray-400 text-center py-10 text-sm">Aún no hay transacciones.</p> :
                <div className="flex flex-col gap-3">
                   {transactions.map(t => {
                      const p = profiles[t.buyerId];
                      return (
                         <div key={t.id} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                             {p ? (
                               <img src={p.photoURL} alt={p.displayName} className="w-12 h-12 rounded-full object-cover bg-white shrink-0" />
                             ) : (
                               <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                                  <User className="w-6 h-6 text-gray-400" />
                               </div>
                             )}
                             <div className="flex-1 min-w-0">
                                <p className="font-bold text-gray-900 text-sm truncate">{t.brand}</p>
                                <p className="text-xs text-gray-500 truncate mt-0.5">
                                   Alquilado por: {p ? p.displayName : 'Anónimo'}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                   <span className="text-[10px] font-bold text-pink-600 bg-pink-50 px-2 py-0.5 rounded-full">{t.duration} días</span>
                                   <span className="text-[10px] text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</span>
                                </div>
                             </div>
                             <div className="text-right shrink-0">
                                 <p className="font-black text-lg text-emerald-500">${t.price.toFixed(2)}</p>
                             </div>
                         </div>
                      )
                   })}
                </div>
             }
          </div>
      </motion.div>
    </>
  );
}

type DirectMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: number;
};

function ChatModal({ connectionId, otherProfile, currentUser, onClose }: { connectionId: string, otherProfile: CreatorProfile | null, currentUser: FirebaseUser, onClose: () => void }) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, `connections/${connectionId}/messages`), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      const msgs: DirectMessage[] = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() } as DirectMessage));
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, err => handleFirestoreError(err, OperationType.LIST, `connections/${connectionId}/messages`));
    return () => unsub();
  }, [connectionId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const msgText = text;
      setText('');
      await addDoc(collection(db, `connections/${connectionId}/messages`), {
        senderId: currentUser.uid,
        text: msgText,
        createdAt: Date.now()
      });
      // Optionally update notification for otherProfile... (omitted to keep simple, since task only says "they can send direct private messages")
    } catch (e: any) { showAlert(e.message, 'error'); }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-4 md:inset-auto md:w-[400px] md:h-[600px] md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 bg-white rounded-[32px] z-[60] shadow-2xl flex flex-col overflow-hidden">
         <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-white z-10 shrink-0">
            <div className="flex items-center gap-3">
               <button onClick={onClose} className="p-2 -ml-2 text-gray-400 hover:text-gray-900 bg-gray-50 rounded-full"><ChevronLeft className="w-5 h-5"/></button>
               {otherProfile && (
                  <div className="flex items-center gap-2">
                     <img src={otherProfile.photoURL || `https://i.pravatar.cc/150`} className="w-8 h-8 rounded-full border border-gray-100" />
                     <strong className="text-sm font-bold text-gray-900 truncate max-w-[150px]">{otherProfile.displayName}</strong>
                  </div>
               )}
            </div>
         </div>
         
         <div className="flex-1 overflow-y-auto p-4 bg-gray-50 flex flex-col gap-3">
            {messages.length === 0 ? (
               <div className="flex-1 flex items-center justify-center text-center px-4">
                  <p className="text-xs text-gray-400 font-medium bg-gray-100 px-4 py-2 rounded-full">Este es el inicio de tu chat. ¡Saluda!</p>
               </div>
            ) : (
               messages.map(m => {
                 const isMine = m.senderId === currentUser.uid;
                 return (
                   <div key={m.id} className={cn("flex flex-col max-w-[75%]", isMine ? "self-end items-end" : "self-start items-start")}>
                      <div className={cn("px-4 py-2.5 rounded-2xl text-[14px] leading-snug text-gray-900 border shadow-sm", isMine ? "bg-gray-50 border-gray-100 rounded-br-sm" : "bg-white border-gray-100 rounded-bl-sm")}>
                         {m.text}
                      </div>
                      <span className="text-[10px] text-gray-400 mt-1 px-1">{new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                   </div>
                 )
               })
            )}
            <div ref={scrollRef} />
         </div>

         <form onSubmit={handleSend} className="p-3 bg-white border-t border-gray-100 shrink-0 flex gap-2">
            <input 
               type="text" 
               placeholder="Escribe un mensaje..." 
               value={text}
               onChange={e => setText(e.target.value)}
               className="flex-1 bg-gray-100 border-none rounded-full px-4 text-sm focus:ring-2 focus:ring-pink-500 outline-none h-[44px]"
            />
            <button type="submit" disabled={!text.trim()} className="w-[44px] h-[44px] bg-pink-500 hover:bg-pink-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-full flex items-center justify-center transition-colors">
               <PlusSquare className="w-5 h-5 -rotate-90" />
            </button>
         </form>
      </motion.div>
    </>
  );
}

function ContactsModal({ connections, profileId, onClose, currentUser }: { connections: Connection[], profileId: string, onClose: () => void, currentUser?: FirebaseUser | null }) {
  const [profiles, setProfiles] = useState<Record<string, CreatorProfile>>({});
  const [selectedChat, setSelectedChat] = useState<{connectionId: string, otherProfile: CreatorProfile | null} | null>(null);
  
  const isOwnerViewing = currentUser?.uid === profileId;

  useEffect(() => {
    const fetchProfiles = async () => {
      const uids = new Set<string>();
      connections.forEach(c => c.users.forEach(u => u !== profileId && uids.add(u)));
      
      const toFetch = Array.from(uids).filter(uid => !profiles[uid]);
      if (toFetch.length === 0) return;
      
      const proms = toFetch.map(uid => getDoc(doc(db, `creatorProfiles/${uid}`)));
      const snaps = await Promise.all(proms);
      
      const newMap = { ...profiles };
      snaps.forEach((docSnap, i) => {
         if (docSnap.exists()) newMap[toFetch[i]] = docSnap.data() as CreatorProfile;
      });
      setProfiles(newMap);
    };
    fetchProfiles();
  }, [connections, profileId]);

  const handleAccept = async (c: Connection) => {
    try {
      if (!currentUser) return;
      const myProfileDoc = await getDoc(doc(db, 'creatorProfiles', currentUser.uid));
      const myUsername = myProfileDoc.exists() ? myProfileDoc.data().username : currentUser.uid;
      const myName = myProfileDoc.exists() ? myProfileDoc.data().displayName : (currentUser.displayName || 'Usuario');

      const batch = writeBatch(db);
      batch.update(doc(db, 'connections', c.id), { status: 'accepted' });
      
      const otherUid = c.users.find(u => u !== profileId);
      if (otherUid) {
         const notifRef = doc(collection(db, `users/${otherUid}/notifications`));
         batch.set(notifRef, {
             type: 'contact_request',
             message: `${myName} aceptó tu solicitud de contacto.`,
             fromId: profileId,
             read: false,
             createdAt: Date.now(),
             link: `/vip/${myUsername}` 
         });
      }
      await batch.commit();
    } catch (e: any) { showAlert(e.message, 'error'); }
  };

  const handleReject = async (c: Connection) => {
    await deleteDoc(doc(db, 'connections', c.id));
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 w-full max-w-[500px] left-1/2 -translate-x-1/2 bg-white rounded-t-[32px] p-6 z-50 shadow-2xl pb-16 h-[85vh] flex flex-col">
          <div className="flex justify-between items-center mb-4">
             <h3 className="font-black text-xl text-gray-900">Contactos</h3>
             <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900"><PlusSquare className="w-6 h-6 rotate-45" /></button>
          </div>
          
          <div className="flex-1 overflow-y-auto no-scrollbar">
             {connections.length === 0 ? <p className="text-gray-400 text-center py-6 text-sm">Sin contactos aún.</p> :
             <div className="flex flex-col gap-3">
                {connections.map(c => {
                   const otherUid = c.users.find(u => u !== profileId);
                   const p = profiles[otherUid || ''];
                   const displayName = p?.displayName || 'Usuario';
                   const photoURL = p?.photoURL || `https://i.pravatar.cc/150?u=${otherUid}`;
                   const isAccepted = c.status === 'accepted';
                   const isPendingSent = c.status === 'pending' && c.initiator === profileId;
                   const isPendingReceived = c.status === 'pending' && c.initiator !== profileId;

                   return (
                      <div key={c.id} className={cn("flex items-center gap-3 p-3 rounded-2xl border", isPendingReceived ? "bg-pink-50 border-pink-100" : "bg-gray-50 border-gray-100")}>
                          <img src={photoURL} alt={displayName} className="w-10 h-10 rounded-full object-cover bg-white" />
                          <div className="flex-1 min-w-0">
                             {p ? (
                                <Link to={`/vip/${p.username}`} onClick={onClose} className="font-bold text-gray-900 text-sm truncate block hover:underline">{displayName}</Link>
                             ) : (
                                <span className="font-bold text-gray-900 text-sm truncate block">{displayName}</span>
                             )}
                             {isAccepted && <p className="text-xs text-gray-500 truncate">{p ? `@${p.username}` : 'Sin perfil aún'}</p>}
                             {isPendingSent && <p className="text-xs text-pink-500 font-medium truncate">Petición enviada</p>}
                             {isPendingReceived && <p className="text-xs text-indigo-500 font-medium truncate">Quiere conectar</p>}
                          </div>
                          {isAccepted && currentUser && c.users.includes(currentUser.uid) && otherUid !== currentUser.uid && (
                            <button onClick={() => setSelectedChat({ connectionId: c.id, otherProfile: p || null })} className="w-8 h-8 flex items-center justify-center bg-pink-100 text-pink-600 rounded-full hover:bg-pink-200 transition-colors" title="Enviar mensaje"><MessageCircle className="w-4 h-4" /></button>
                          )}
                          {isOwnerViewing && isAccepted && (
                            <button onClick={() => handleReject(c)} className="w-8 h-8 flex items-center justify-center bg-gray-200 text-gray-600 rounded-full hover:bg-red-100 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                          )}
                          {isOwnerViewing && isPendingSent && (
                            <button onClick={() => handleReject(c)} className="w-8 h-8 flex items-center justify-center bg-pink-100 text-pink-600 rounded-full hover:bg-red-100 hover:text-red-500 transition-colors" title="Cancelar petición"><Trash2 className="w-4 h-4" /></button>
                          )}
                          {isOwnerViewing && isPendingReceived && (
                             <div className="flex gap-1">
                                <button onClick={() => handleAccept(c)} className="bg-pink-500 text-white px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-pink-600 transition-colors">Aceptar</button>
                                <button onClick={() => handleReject(c)} className="w-8 h-8 flex items-center justify-center bg-gray-200 text-gray-600 rounded-full hover:bg-red-100 hover:text-red-500 transition-colors" title="Rechazar"><Trash2 className="w-4 h-4" /></button>
                             </div>
                          )}
                      </div>
                   )
                })}
             </div>}
          </div>
      </motion.div>
      <AnimatePresence>
         {selectedChat && currentUser && (
            <ChatModal connectionId={selectedChat.connectionId} otherProfile={selectedChat.otherProfile} currentUser={currentUser} onClose={() => setSelectedChat(null)} />
         )}
      </AnimatePresence>
    </>
  );
}

const smoothScrollTo = (container: HTMLElement, targetPosition: number, duration: number, callback?: () => void) => {
  const startPosition = container.scrollTop;
  const distance = targetPosition - startPosition;
  let startTime: number | null = null;
  const animation = (currentTime: number) => {
    if (startTime === null) startTime = currentTime;
    const timeElapsed = currentTime - startTime;
    const progress = Math.min(timeElapsed / duration, 1);
    const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
    container.scrollTo(0, startPosition + distance * ease);
    if (timeElapsed < duration) {
       requestAnimationFrame(animation);
    } else {
       if (callback) callback();
    }
  };
  requestAnimationFrame(animation);
};

function StoryUploader({ onPublish, onCancel, isProcessing }: { onPublish: (media: { url: string, type: 'image'|'video', publicId?: string }, overlays: StoryOverlay[], filter: string, clipStart: number, clipDuration: number) => void, onCancel: () => void, isProcessing: boolean }) {
  const [media, setMedia] = useState<{url: string, type: 'image'|'video', publicId?: string} | null>(null);
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // New features
  const [filter, setFilter] = useState<string>('none');
  const [clipStart, setClipStart] = useState<number>(0);
  const [clipDuration, setClipDuration] = useState<number>(10);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Overlay Editor State
  const [editingOverlay, setEditingOverlay] = useState<boolean>(false);
  const [newOverlayText, setNewOverlayText] = useState('');
  const [newOverlayStyle, setNewOverlayStyle] = useState<'normal'|'neon'|'bordered'|'bubble'>('normal');
  const [newOverlayColor, setNewOverlayColor] = useState('#ffffff');
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(file);
        video.onloadedmetadata = async () => {
            setVideoDuration(video.duration);
            setClipDuration(Math.min(video.duration, 10));
            setClipStart(0);
            await process(file);
        }
    } else {
        await process(file);
    }
    
    async function process(f: File) {
        setIsUploadingMedia(true);
        try {
            const m = await processMediaFile(f);
            setMedia(m);
        } catch(err) {
            showAlert('Error procesando archivo.', 'error');
        }
        setIsUploadingMedia(false);
    }
  };

  const addOverlay = (type: 'text'|'emoji', content: string) => {
      setOverlays([...overlays, {
          type,
          content,
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          color: newOverlayColor,
          textStyle: newOverlayStyle
      }]);
      setEditingOverlay(false);
      setNewOverlayText('');
  };

  // Video looping logic
  useEffect(() => {
     if (media?.type !== 'video' || !videoRef.current) return;
     const v = videoRef.current;
     const handleTimeUpdate = () => {
         if (v.currentTime >= clipStart + clipDuration) {
             v.currentTime = clipStart;
         }
     };
     v.addEventListener('timeupdate', handleTimeUpdate);
     return () => v.removeEventListener('timeupdate', handleTimeUpdate);
  }, [media, clipStart, clipDuration]);

  // Force video to start at clipStart when it changes
  useEffect(() => {
     if (media?.type === 'video' && videoRef.current) {
         videoRef.current.currentTime = clipStart;
     }
  }, [clipStart, media]);

  const filters = [
      { name: 'Normal', value: 'none' },
      { name: 'B&W', value: 'grayscale(100%)' },
      { name: 'Sepia', value: 'sepia(100%)' },
      { name: 'Dark', value: 'contrast(150%) brightness(80%)' },
      { name: 'Vibrant', value: 'saturate(200%)' },
      { name: 'Blur', value: 'blur(4px)' }
  ];

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
       <div className="flex justify-between items-center p-4 z-40 bg-gradient-to-b from-black/50 to-transparent absolute top-0 left-0 right-0">
          <button onClick={onCancel} className="text-white p-2 rounded-full bg-black/40 backdrop-blur-sm">
             <PlusSquare className="w-6 h-6 rotate-45" />
          </button>
          
          <div className="flex gap-2">
             {media && (
                 <>
                  <button onClick={() => setEditingOverlay('emoji' as any)} className="text-white p-2 text-xl rounded-full bg-black/40 backdrop-blur-sm">??</button>
                  <button onClick={() => setEditingOverlay('text' as any)} className="text-white p-2 font-black rounded-full bg-black/40 backdrop-blur-sm h-10 w-10">Aa</button>
                 </>
             )}
          </div>
       </div>

       <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-gray-900 rounded-[32px] m-2">
          {!media ? (
             <div className="text-center p-6">
                {isUploadingMedia ? (
                   <div className="text-white font-bold opacity-70 animate-pulse">Procesando...</div>
                ) : (
                   <label className="bg-white/10 hover:bg-white/20 text-white px-6 py-4 rounded-2xl cursor-pointer font-bold inline-flex items-center gap-3 transition">
                      <Camera className="w-6 h-6" />
                      Subir Imagen o Video (Máx 10s)
                      <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
                   </label>
                )}
             </div>
          ) : (
             <div className="w-full h-full relative" style={{ overflow: 'hidden' }}>
                {media.type === 'video' ? (
                   <video ref={videoRef} src={media.url} className="w-full h-full object-contain pointer-events-none" autoPlay loop muted playsInline style={{ filter }} />
                ) : (
                   <img src={media.url} className="w-full h-full object-contain pointer-events-none" alt="Preview" style={{ filter }} />
                )}

                {/* Overlays Canvas */}
                {overlays.map((o, i) => (
                    <motion.div 
                        key={i}
                        drag
                        dragMomentum={false}
                        onDragEnd={(_, info) => {
                            const newOverlays = [...overlays];
                            newOverlays[i].x += info.offset.x;
                            newOverlays[i].y += info.offset.y;
                            setOverlays(newOverlays);
                        }}
                        className="absolute transform-gpu whitespace-pre-wrap text-center flex flex-col items-center justify-center cursor-move"
                        style={{ 
                            left: '50%', top: '50%',
                            x: o.x, y: o.y, scale: o.scale, rotate: o.rotation,
                            color: o.color || '#ffffff',
                            fontFamily: o.fontFamily || 'Inter, sans-serif',
                            fontSize: o.type === 'emoji' ? '64px' : '32px',
                            lineHeight: 1.1,
                            textShadow: o.textStyle === 'bordered' ? '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000' :
                                        o.textStyle === 'neon' ? `0 0 10px ${o.color}, 0 0 20px ${o.color}, 0 0 30px ${o.color}` :
                                        '2px 2px 4px rgba(0,0,0,0.5)',
                            backgroundColor: o.textStyle === 'bubble' ? 'rgba(0,0,0,0.5)' : 'transparent',
                            padding: o.textStyle === 'bubble' ? '8px 16px' : '0',
                            borderRadius: o.textStyle === 'bubble' ? '16px' : '0'
                        }}
                    >
                        {o.content}
                    </motion.div>
                ))}
             </div>
          )}
       </div>

       {media && !editingOverlay && (
          <div className="px-4 py-2 bg-black/50 z-40">
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                 {filters.map(f => (
                     <button key={f.name} onClick={() => setFilter(f.value)} className={cn("px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors", filter === f.value ? "bg-white text-black" : "bg-black/40 text-white border border-white/20 hover:bg-white/10")}>{f.name}</button>
                 ))}
              </div>
              {media.type === 'video' && videoDuration > 10 && (
                 <div className="flex flex-col mt-2 px-2">
                    <div className="flex justify-between text-white text-[10px] mb-1">
                       <span>Inicio: {clipStart.toFixed(1)}s</span>
                       <span>Fin: {(clipStart + clipDuration).toFixed(1)}s</span>
                    </div>
                    <input 
                       type="range" 
                       min="0" 
                       max={Math.max(0, videoDuration - clipDuration)}
                       step="0.1" 
                       value={clipStart}
                       onChange={e => setClipStart(parseFloat(e.target.value))}
                       className="w-full accent-pink-500"
                    />
                 </div>
              )}
          </div>
       )}

       {editingOverlay && (
          <div className="absolute inset-0 bg-black/80 z-[110] flex flex-col p-6 items-center justify-center backdrop-blur-sm">
             {editingOverlay === 'emoji' as any ? (
                 <div className="grid grid-cols-4 gap-4 bg-white/10 p-6 rounded-3xl">
                     {['??','?','??','??','??','??','??','??','??','??','??','??'].map(e => (
                         <button key={e} onClick={() => addOverlay('emoji', e)} className="text-4xl hover:scale-110 transition-transform">{e}</button>
                     ))}
                     <button onClick={() => setEditingOverlay(false)} className="col-span-4 mt-2 text-white/50 text-sm py-2">Cancelar</button>
                 </div>
             ) : (
                 <div className="w-full max-w-sm flex flex-col gap-4">
                     <div className="flex gap-2 justify-center mb-4">
                         {['normal','neon','bordered','bubble'].map(s => (
                             <button key={s} onClick={() => setNewOverlayStyle(s as any)} className={cn("px-3 py-1 rounded-full text-xs font-bold capitalize transition", newOverlayStyle === s ? "bg-white text-black" : "bg-white/20 text-white")}>{s}</button>
                         ))}
                     </div>
                     <div className="flex gap-2 justify-center mb-4">
                         {['#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'].map(c => (
                             <button key={c} onClick={() => setNewOverlayColor(c)} className={cn("w-8 h-8 rounded-full border-2 transition", newOverlayColor === c ? "border-white scale-110" : "border-transparent")} style={{backgroundColor: c}} />
                         ))}
                     </div>
                     <textarea 
                        value={newOverlayText}
                        onChange={e => setNewOverlayText(e.target.value)}
                        autoFocus
                        className="bg-transparent text-white text-center text-3xl font-bold outline-none resize-none placeholder:text-white/30 truncate"
                        placeholder="Escribe algo..."
                        rows={3}
                     />
                     <div className="flex gap-2 mt-4">
                         <button onClick={() => setEditingOverlay(false)} className="flex-1 py-3 text-white/70 font-bold hover:text-white transition">Cancelar</button>
                         <button onClick={() => { if (newOverlayText.trim()) addOverlay('text', newOverlayText); else setEditingOverlay(false); }} className="flex-1 py-3 bg-white text-black rounded-xl font-bold hover:bg-gray-100 transition active:scale-95">Añadir</button>
                     </div>
                 </div>
             )}
          </div>
       )}

       <div className="p-4 z-40 bg-gradient-to-t from-black/50 to-transparent">
          {media && (
              <button 
                onClick={() => onPublish(media, overlays, filter, clipStart, clipDuration)}
                disabled={isProcessing}
                className="w-full py-4 bg-white text-black rounded-2xl font-bold text-lg hover:bg-gray-100 transition active:scale-95 disabled:opacity-50 disabled:active:scale-100 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
              >
                  {isProcessing ? "Publicando..." : "Compartir Historia"}
              </button>
          )}
       </div>
    </div>
  );
}

function ProfileCustomCard({ card }: { card?: CreatorProfile['customCard'] }) {
  if (!card) return null;

  const data: ProfileCard = typeof card === 'string' ? { title: card } : card;
  if (data.enabled === false) return null;

  const title = data.title || data.subtitle;
  const subtitle = data.title ? data.subtitle : '';
  const description = data.description;
  const image = data.image || data.imageUrl;
  const hasContent = title || subtitle || description || image;

  if (!hasContent) return null;

  return (
    <div
      className="mx-4 mb-4 rounded-[24px] overflow-hidden border border-gray-100 bg-gray-900 text-white shadow-sm shrink-0"
      style={{
        backgroundColor: data.backgroundColor || undefined,
        color: data.textColor || undefined
      }}
    >
      {image && <img src={image} alt={title || 'Tarjeta de perfil'} className="w-full h-36 object-cover bg-gray-100" />}
      <div className="p-4">
        {subtitle && <p className="text-xs font-black uppercase tracking-wider opacity-70 mb-1">{subtitle}</p>}
        {title && <h2 className="text-lg font-black leading-tight">{title}</h2>}
        {description && <p className="text-sm leading-snug opacity-80 mt-2">{description}</p>}
        {data.linkUrl && (
          <a href={data.linkUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-3 text-sm font-bold underline underline-offset-4">
            {data.linkTitle || 'Abrir enlace'}
            <ArrowUpRight className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function ProfileView({ profile, slots, stories = [], isOwnerPreview, profileId, currentUser, onDivide, onJoin, onBack, onOverlayChange }: { profile: CreatorProfile, slots: AdSpace[], stories?: Story[], isOwnerPreview: boolean, profileId?: string | null, currentUser?: FirebaseUser | null, onDivide?: (id: string) => void, onJoin?: (id: string) => void, onBack?: () => void, onOverlayChange?: (active: boolean) => void }) {
  const [selectedSlot, setSelectedSlot] = useState<AdSpace | null>(null);
  const [viewingTenantSlot, setViewingTenantSlot] = useState<AdSpace | null>(null);
  const [showProfileCard, setShowProfileCard] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<number>(7);
  
  const [transactions, setTransactions] = useState<TransactionType[]>([]);
  const [showTransactionsModal, setShowTransactionsModal] = useState(false);
  const [buyTokenAmount, setBuyTokenAmount] = useState(10);
  const [sellTokenAmount, setSellTokenAmount] = useState(5);
  const [confirmMarketAction, setConfirmMarketAction] = useState<'buy' | 'sell' | null>(null);
  const [marketOrderType, setMarketOrderType] = useState<TokenOrderType>('market');
  const [marketOrderPrice, setMarketOrderPrice] = useState(0);
  const [showMarketModal, setShowMarketModal] = useState(false);
  const [openSellOffers, setOpenSellOffers] = useState<MarketOrder[]>([]);
  const [realTokenOrders, setRealTokenOrders] = useState<RealTokenOrder[]>([]);

  // Connections state
  const [connections, setConnections] = useState<Connection[]>([]);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Stories state
  const [isUploadingStory, setIsUploadingStory] = useState(false);
  const [storyImage, setStoryImage] = useState('');
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);

  useEffect(() => {
    onOverlayChange?.(isUploadingStory || selectedStoryIndex !== null);
  }, [isUploadingStory, selectedStoryIndex]);

  const scanTriggeredRef = useRef(false);
  const txsCountRef = useRef<number | undefined>(undefined);

  useLockBodyScroll(!!selectedSlot || !!viewingTenantSlot || showProfileCard || showTransactionsModal || showContactsModal || showCancelConfirm || !!confirmMarketAction || showMarketModal || isUploadingStory || selectedStoryIndex !== null);

  // Subscribe to real token orders for this creator's order book
  useEffect(() => {
    if (!profileId) return;
    const q = query(
      collection(db, 'tokenOrders'),
      where('creatorId', '==', profileId),
      where('status', '==', 'open')
    );
    const unsub = onSnapshot(q, (snap) => {
      setRealTokenOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as RealTokenOrder)));
    }, (err) => console.log('tokenOrders profile error', err));
    return () => unsub();
  }, [profileId]);

  useEffect(() => {
    setOpenSellOffers(realTokenOrders.filter(o => o.side === 'sell' && o.userId === currentUser?.uid).map(o => ({ price: o.price, amount: o.amount })));
  }, [realTokenOrders, currentUser?.uid]);

  useEffect(() => {
     if (!profileId) return;
     const q = query(collection(db, 'connections'), where('users', 'array-contains', profileId));
     const unsub = onSnapshot(q, snap => {
        const conns: Connection[] = [];
        snap.forEach(d => conns.push({ id: d.id, ...d.data() } as Connection));
        setConnections(conns);
     }, err => handleFirestoreError(err, OperationType.LIST, 'connections'));
     return () => unsub();
  }, [profileId]);

  useEffect(() => {
     if (!profileId) return;
     const q = query(collection(db, `creatorProfiles/${profileId}/transactions`), orderBy('createdAt', 'desc'));
     const unsub = onSnapshot(q, snap => {
        const txs: TransactionType[] = [];
        snap.forEach(d => txs.push({ id: d.id, ...d.data() } as TransactionType));
        setTransactions(txs);
     }, err => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${profileId}/transactions`));
     return () => unsub();
  }, [profileId]);

  useEffect(() => {
      // Trigger scan when slots are fully loaded, and if there are new transactions
      if (isOwnerPreview || slots.length === 0) return;
      
      const currentTxsCount = transactions.length;
      const isInitialLoad = !scanTriggeredRef.current;
      const hasNewTransactions = txsCountRef.current !== undefined && currentTxsCount > txsCountRef.current;
      
      if (isInitialLoad || hasNewTransactions) {
         scanTriggeredRef.current = true;
         txsCountRef.current = currentTxsCount;
         
         setTimeout(() => {
             const container = document.getElementById('profile-scroll-container');
             if (!container) return;
             // Check if scrolling is actually possible
             const scrollHeight = container.scrollHeight - container.clientHeight;
             if (scrollHeight > 50) { 
                const durationDown = Math.max(1200, Math.min(2500, scrollHeight * 1.5));
                smoothScrollTo(container, scrollHeight, durationDown, () => {
                   setTimeout(() => {
                      const durationUp = durationDown * 0.7;
                      smoothScrollTo(container, 0, durationUp);
                   }, 200);
                });
             }
         }, 800); // Wait 800ms for images to naturally render after slots appear
      }
  }, [slots.length, transactions.length, isOwnerPreview]);

  const acceptedCount = connections.filter(c => c.status === 'accepted').length;
  const pendingRequestsCount = connections.filter(c => c.status === 'pending' && c.initiator !== profileId).length;
  const contactStatus = currentUser ? connections.find(c => c.users.includes(currentUser.uid)) : null;

  const handleRequestContact = async () => {
     if (!currentUser || !profileId) return;
     const sortedIds = [currentUser.uid, profileId].sort();
     const id = sortedIds.join('_');
     try {
       const myProfileDoc = await getDoc(doc(db, 'creatorProfiles', currentUser.uid));
       const myUsername = myProfileDoc.exists() ? myProfileDoc.data().username : currentUser.uid;
       const myName = myProfileDoc.exists() ? myProfileDoc.data().displayName : (currentUser.displayName || 'Usuario');

       const batch = writeBatch(db);
       batch.set(doc(db, 'connections', id), {
         users: sortedIds,
         status: 'pending',
         initiator: currentUser.uid,
         createdAt: Date.now()
       });
       const notifRef = doc(collection(db, `users/${profileId}/notifications`));
       batch.set(notifRef, {
         type: 'contact_request',
         message: `${myName} quiere conectar contigo`,
         fromId: currentUser.uid,
         read: false,
         createdAt: Date.now(),
         link: `/vip/${myUsername}` 
       });
       await batch.commit();
     } catch (e: any) { showAlert(e.message, 'error'); }
  }

  const handleAcceptContact = async () => {
    if (!contactStatus || !currentUser) return;
    try {
      const myProfileDoc = await getDoc(doc(db, 'creatorProfiles', currentUser.uid));
      const myUsername = myProfileDoc.exists() ? myProfileDoc.data().username : currentUser.uid;
      const myName = myProfileDoc.exists() ? myProfileDoc.data().displayName : (currentUser.displayName || 'Usuario');

      const batch = writeBatch(db);
      batch.update(doc(db, 'connections', contactStatus.id), { status: 'accepted' });
      
      const otherUid = contactStatus.users.find(u => u !== currentUser.uid);
      if (otherUid) {
         const notifRef = doc(collection(db, `users/${otherUid}/notifications`));
         batch.set(notifRef, {
             type: 'contact_request',
             message: `${myName} aceptó tu solicitud de contacto.`,
             fromId: currentUser.uid,
             read: false,
             createdAt: Date.now(),
             link: `/vip/${myUsername}`
         });
      }
      await batch.commit();
    } catch (e: any) { showAlert(e.message, 'error'); }
  }

  const handleCancelContact = async () => {
    if (!contactStatus) return;
    try {
      await deleteDoc(doc(db, 'connections', contactStatus.id));
    } catch (e: any) { showAlert(e.message, 'error'); }
  }

  // Rent state
  const [rentImage, setRentImage] = useState('');
  const [rentBrand, setRentBrand] = useState('');
  const [rentBrandImg, setRentBrandImg] = useState('');
  const [rentCaption, setRentCaption] = useState('');
  const [rentLink, setRentLink] = useState('');

  const handleRent = async () => {
      if (!selectedSlot || !profileId) return;
      if (!currentUser) { showAlert("Inicia sesión para alquilar y recibir tokens.", 'error'); return; }
      if (isOwnerPreview || currentUser?.uid === profileId) { showAlert("El dueño del perfil no puede alquilar/publicar espacios en su propio perfil.", 'error'); return; }
      if (!rentImage.trim() || !rentBrand.trim()) { showAlert("Sube tu anuncio y pon el nombre de tu marca.", 'error'); return; }
      
      setIsProcessing(true);
      
      // Compute correct price based on duration selected
      let price = 0;
      if (selectedSlot.forResale && selectedSlot.resalePrices) {
         price = selectedDuration === 1 ? selectedSlot.resalePrices.price1
           : selectedDuration === 7 ? selectedSlot.resalePrices.price7
           : selectedDuration === 30 ? selectedSlot.resalePrices.price30
           : selectedSlot.resalePrices.price365;
      } else {
         const prices = selectedSlot.width === 100 ? profile?.prices100 : selectedSlot.width === 50 ? profile?.prices50 : profile?.prices25;
         const def = selectedSlot.width === 100 ? {p1:15, p7:45, p30:150, p365:600} : selectedSlot.width === 50 ? {p1:10, p7:30, p30:100, p365:350} : {p1:5, p7:15, p30:45, p365:200};
         
         price = selectedDuration === 1 ? (prices?.price1 || def.p1) 
            : selectedDuration === 7 ? (prices?.price7 || def.p7) 
            : selectedDuration === 30 ? (prices?.price30 || def.p30)
            : (prices?.price365 || def.p365);
      }

      try {
             const now = Date.now();
             const tokensToMint = Math.floor(price * TOKENS_PER_EURO);
             const slotRef = doc(db, `creatorProfiles/${profileId}/adSpaces`, selectedSlot.id);
             const sellerId = selectedSlot.forResale && selectedSlot.rentedBy ? selectedSlot.rentedBy : profileId;
             const holdingRef = doc(db, 'creatorTokenHolders', `${currentUser.uid}_${profileId}`);

             await runTransaction(db, async (transaction) => {
               const slotSnap = await transaction.get(slotRef);
               if (!slotSnap.exists()) throw new Error('Este espacio ya no existe.');
               const liveSlot = slotSnap.data() as AdSpace;
               const liveIsRented = liveSlot.isRented === true && (liveSlot.rentEnd || 9999999999999) > now;
               if (liveIsRented && liveSlot.rentedBy !== currentUser.uid) throw new Error('Este espacio ya ha sido alquilado por otra persona.');

               const myRentSnap = await transaction.get(doc(db, 'creatorProfiles', currentUser.uid));
               const myRentData = myRentSnap.exists() ? myRentSnap.data() : null;
               const tenantBalance = myRentData?.walletBalance || 0;
               if (tenantBalance < price) throw new Error('Saldo insuficiente para alquilar este espacio.');
               const holdingSnap = await transaction.get(holdingRef);

               transaction.update(slotRef, {
                 isRented: true,
                 rentedBy: currentUser.uid,
                 brand: rentBrand,
                 brandImg: rentBrandImg || myRentData?.photoURL || currentUser.photoURL || 'https://i.pravatar.cc/150?u=' + currentUser.uid,
                 image: rentImage,
                 caption: rentCaption || `?Espacio patrocinado por ${selectedDuration} d?as!`,
                 link: rentLink,
                 pricePaid: price,
                 rentStart: now,
                 rentEnd: now + selectedDuration * 24 * 60 * 60 * 1000,
                 forResale: deleteField(),
                 resalePrices: deleteField()
               });

               transaction.set(doc(collection(db, `creatorProfiles/${profileId}/transactions`)), {
                 slotId: selectedSlot.id,
                 buyerId: currentUser.uid,
                 sellerId: sellerId,
                 brand: rentBrand,
                 price: price,
                 tokensMinted: tokensToMint,
                 duration: selectedDuration,
                 createdAt: now
               });

               transaction.update(doc(db, `creatorProfiles/${sellerId}`), {
                 totalSales: increment(price),
                 walletBalance: increment(price)
               });

               transaction.update(doc(db, `creatorProfiles/${currentUser.uid}`), {
                 walletBalance: increment(-price)
               });

               transaction.set(doc(collection(db, `users/${sellerId}/notifications`)), {
                 type: 'sale',
                 message: `?Nueva venta! ${rentBrand} ha comprado un espacio VIP.`,
                 fromId: currentUser.uid,
                 read: false,
                 createdAt: now,
                 link: `/vip/${profile?.username}`
               });

               transaction.set(doc(collection(db, `users/${currentUser.uid}/notifications`)), {
                 type: 'token_mint',
                 message: `Has recibido ${tokensToMint} ${tokenMarket.symbol} tokens por alquilar en el perfil de ${profile.displayName}.`,
                 fromId: profileId,
                 read: false,
                 createdAt: now,
                 link: `/vip/${profile?.username}`
               });

               if (holdingSnap.exists()) {
                 transaction.update(holdingRef, {
                   balance: increment(tokensToMint),
                   updatedAt: now
                 });
               } else {
                 transaction.set(holdingRef, {
                   userId: currentUser.uid,
                   creatorId: profileId,
                   creatorUsername: profile.username || profileId,
                   balance: tokensToMint,
                   earned: 0,
                   createdAt: now,
                   updatedAt: now
                 });
               }
             });

             try {
               const holdersSnap = await getDocs(
                 query(collection(db, 'creatorTokenHolders'),
                   where('creatorId', '==', profileId),
                   where('userId', '!=', currentUser.uid))
               );
               if (!holdersSnap.empty) {
                 const totalHeld = holdersSnap.docs.reduce((s, d) => s + (d.data().balance || 0), 0) + price;
                 const notifBatch = writeBatch(db);
                 holdersSnap.docs.forEach(d => {
                   const holderData = d.data();
                   const holderShare = totalHeld > 0 ? ((holderData.balance / totalHeld) * price).toFixed(2) : '0.00';
                   notifBatch.set(doc(collection(db, `users/${holderData.userId}/notifications`)), {
                     type: 'token_mint',
                     message: `Nueva renta en el perfil de ${profile.displayName || profile.username}: ${rentBrand} alquil? por ${price}?. Tienes ${holderData.balance} ${tokenMarket.symbol} tokens. Beneficio estimado: ${holderShare}?.`,
                     fromId: profileId,
                     read: false,
                     createdAt: Date.now(),
                     link: `/vip/${profile?.username}`
                   });
                 });
                 await notifBatch.commit();
               }
             } catch (holdingErr) {
               console.error('Error notifying token holders:', holdingErr);
             }
             setSelectedSlot(null);
             setRentImage('');
             setRentBrand('');
             setRentBrandImg('');
             setRentCaption('');
             setRentLink('');
             showAlert(`Alquiler confirmado. Se han minteado ${tokensToMint} ${tokenMarket.symbol} tokens en tu wallet.`, 'success');
      } catch(e: any) { showAlert(e.message, 'error'); }
      setIsProcessing(false);
  };

  const handlePublishStory = async (media: { url: string, type: 'image'|'video', publicId?: string }, overlays: StoryOverlay[], filter: string, clipStart: number, clipDuration: number) => {
      if (!profileId || !currentUser || !media.url.trim()) return;
      const isOwnerProfile = currentUser.uid === profileId;
      if (isOwnerProfile) return;

      const isTenantActive = slots.some(s => s.isRented && s.rentedBy === currentUser.uid);
      if (!isTenantActive) return;

      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentStoriesFromUser = stories?.filter(s => s.rentedBy === currentUser.uid && s.createdAt > oneDayAgo) || [];
      if (recentStoriesFromUser.length >= 1) {
          showAlert('Solo puedes publicar 1 historia al día como inquilino VIP.', 'error');
          return;
      }

      setIsProcessing(true);
      try {
          const myStorySnap = await getDoc(doc(db, 'creatorProfiles', currentUser.uid));
          const myStoryData = myStorySnap.exists() ? myStorySnap.data() : null;
          const newStory: Story = {
              id: `story-${Date.now()}`,
              image: media.url,
              mediaType: media.type,
              overlays: JSON.stringify(overlays),
              filter: filter,
              clipStart: clipStart,
              clipDuration: clipDuration,
              brand: myStoryData?.displayName || currentUser.displayName || 'Marca',
              brandImg: myStoryData?.photoURL || currentUser.photoURL || `https://i.pravatar.cc/150?u=${currentUser.uid}`,
              rentedBy: currentUser.uid,
              createdAt: Date.now(),
              ...(media.publicId ? { cloudinaryPublicId: media.publicId } : {})
          };
          await setDoc(doc(db, `creatorProfiles/${profileId}/stories`, newStory.id), newStory);
          setIsUploadingStory(false);
          setStoryImage('');
          showAlert('¡Historia publicada exitosamente!', 'success');
      } catch(e: any) { showAlert(e.message, 'error'); }
      setIsProcessing(false);
  };

  const isTenant = currentUser && slots.some(s => s.isRented && s.rentedBy === currentUser.uid);
  const isOwnerProfile = !!currentUser && currentUser.uid === profileId;
  const canUploadStory = !!isTenant && !isOwnerPreview && currentUser?.uid !== profileId;
  const tokenMarket = useMemo(() => buildTokenMarket(profile, transactions, slots, profileId || '', realTokenOrders), [profile, transactions, slots, profileId, realTokenOrders]);
  const marketActionAmount = confirmMarketAction === 'buy' ? buyTokenAmount : sellTokenAmount;
  const marketActionPrice = marketOrderPrice || (confirmMarketAction === 'buy' ? tokenMarket.bestAsk : (tokenMarket.bestBid || tokenMarket.lastPrice));
  const marketActionTotal = marketActionAmount * marketActionPrice;
  const executeMarketAction = async () => {
    if (!confirmMarketAction || !currentUser || !profileId) return;
    if (marketActionAmount <= 0) {
      showAlert('Introduce una cantidad mayor que cero.', 'error');
      return;
    }
    try {
      const result = await placeOrFillTokenOrder({
        userId: currentUser.uid,
        creatorId: profileId,
        side: confirmMarketAction,
        orderType: marketOrderType,
        price: marketActionPrice,
        amount: marketActionAmount,
        symbol: tokenMarket.symbol,
        matchingOrders: realTokenOrders
      });
      showAlert(result.message, result.filled ? 'success' : 'info');
    } catch (e: any) {
      showAlert('Error al ejecutar la orden: ' + e.message, 'error');
    }
    setConfirmMarketAction(null);
  };

  return (
    <>
        <div className="w-full h-[90px] lg:h-[220px] bg-gray-100 relative overflow-hidden shrink-0">
          <div className="absolute top-4 inset-x-4 z-30 flex items-center justify-between">
             {onBack ? (
                <button onClick={onBack} title="Volver a explorar" className="h-[32px] w-[88px] bg-white/90 backdrop-blur-md rounded-full border border-gray-100 shadow-sm flex items-center justify-center gap-0.5 transition-colors active:scale-95 outline-none">
                   <ChevronLeft className="w-4 h-4 text-pink-500 -ml-1" strokeWidth={3} />
                   <span className="font-['Space_Grotesk'] font-bold text-gray-900 tracking-tight text-[12px] leading-none">
                     Zona<span className="text-pink-500">Vip</span>
                   </span>
                </button>
             ) : (
                <div className="h-[32px] w-[88px] bg-white/90 backdrop-blur-md rounded-full border border-gray-100 shadow-sm flex items-center justify-center">
                   <span className="font-['Space_Grotesk'] font-bold text-gray-900 tracking-tight text-[12px] leading-none">
                     Zona<span className="text-pink-500">Vip</span>
                   </span>
                </div>
             )}
             <div className="h-[32px] w-[88px] bg-white/90 backdrop-blur-md rounded-full border border-gray-100 shadow-sm flex items-center justify-center" title="Vistas del perfil">
                <span className="font-['Space_Grotesk'] font-bold text-gray-900 tracking-tight text-[12px] leading-none">
                  Vistas <span className="text-pink-500">{profile.views || 0}</span>
                </span>
             </div>
          </div>
          {profile.bannerURL ? <img src={profile.bannerURL} className="w-full h-full object-cover" alt="Banner" /> : <div className="w-full h-full bg-gradient-to-br from-pink-50 to-purple-50"></div>}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/40 to-transparent"></div>
        </div>
        <div className="px-4 flex flex-col relative z-20 -mt-[40px] mb-3 shrink-0">
           <div className="absolute left-6 top-[50px] w-[72px] z-30">
              <button onClick={() => setShowContactsModal(true)} className="w-full flex flex-col items-center py-1 rounded-xl bg-white border border-gray-200 shadow-sm hover:bg-gray-100 active:bg-white transition-all group outline-none relative">
                 <span className="text-[8px] uppercase font-bold tracking-wider text-gray-900 mb-1">Contactos</span>
                 <span className="text-base font-semibold text-gray-900 leading-none">{acceptedCount}</span>
                 {isOwnerPreview && pendingRequestsCount > 0 && (
                    <div className="absolute -top-2 -right-2 bg-pink-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">{pendingRequestsCount}</div>
                 )}
              </button>
              {!isOwnerPreview && currentUser && currentUser.uid !== profileId && !contactStatus && (
                 <button onClick={handleRequestContact} title="Agregar contacto" className="absolute -bottom-2 -left-2 w-6 h-6 bg-pink-500 hover:bg-pink-600 text-white rounded-full flex items-center justify-center shadow-md border-[2px] border-white transition-all active:scale-90">
                    <Plus className="w-3.5 h-3.5" strokeWidth={3} />
                 </button>
              )}
              {!isOwnerPreview && currentUser && currentUser.uid !== profileId && contactStatus && contactStatus.status === 'pending' && (
                 <button onClick={contactStatus.initiator === currentUser.uid ? () => setShowCancelConfirm(true) : handleCancelContact} className="absolute -bottom-2 -left-2 w-6 h-6 outline-none rounded-full flex items-center justify-center shadow-md border-[2px] border-white transition-all bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-500 cursor-pointer active:scale-90" title={contactStatus.initiator === currentUser.uid ? 'Cancelar petición' : 'Rechazar petición'}>
                    <Clock className="w-3.5 h-3.5" />
                 </button>
              )}
           </div>

           <button onClick={() => setShowTransactionsModal(true)} className="absolute right-6 top-[50px] w-[72px] flex flex-col items-center py-1 rounded-xl bg-white border border-gray-200 shadow-sm hover:bg-gray-100 active:bg-white transition-all group z-30">
              <span className="text-[8px] uppercase font-bold tracking-wider text-gray-900 mb-1">Ventas</span>
              <span className="text-base font-semibold text-gray-900 leading-none">{transactions.length}</span>
           </button>

           <div className="relative inline-block w-fit mx-auto">
              <div className="absolute inset-0 bg-pink-500 rounded-full blur-xl opacity-20 scale-150 animate-pulse"></div>
              <button onClick={() => setShowProfileCard(true)} className="relative z-10 rounded-full outline-none focus:ring-2 focus:ring-pink-400 focus:ring-offset-2 active:scale-95 transition-transform" aria-label="Ver tarjeta de perfil">
                 <img src={profile.photoURL} alt={profile.displayName} className="w-[80px] h-[80px] rounded-full border-[4px] border-white object-cover bg-white shadow-[0_10px_25px_rgba(0,0,0,0.1)]" />
              </button>
           </div>
           <div className="text-center mt-3">
              <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none mb-1">{profile.displayName.replace(/^ZonaVip\s+/i, '')}</h1>
              <div className="flex items-center justify-center gap-1.5 mt-1.5">
                <div className="bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">Verificado</div>
              </div>
           </div>
        </div>

        <TokenPriceStrip market={tokenMarket} onOpen={() => setShowMarketModal(true)} />



        <ProfileCustomCard card={profile.customCard} />

        {!isOwnerPreview && currentUser && currentUser.uid !== profileId && contactStatus && contactStatus.status === 'pending' && contactStatus.initiator !== currentUser.uid && (
           <div className="flex justify-center mb-5 shrink-0 relative z-20">
              <div className="flex gap-2">
                 <button onClick={handleAcceptContact} className="px-6 py-2 bg-pink-500 text-white rounded-full font-bold text-sm hover:bg-pink-600 transition-colors">
                    Aceptar Contacto
                 </button>
                 <button onClick={handleCancelContact} className="px-6 py-2 bg-gray-100 text-gray-900 rounded-full font-bold text-sm hover:bg-gray-200 transition-colors">
                    Rechazar
                 </button>
              </div>
           </div>
        )}

        <div className="lg:px-8 lg:pb-10">
          <div className="lg:min-w-0">
        {/* Stories Section */}
        {(stories.length > 0 || canUploadStory) && (
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
                    {stories.map((story, idx, arr) => (
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
        )}

        <div className="px-2 shrink-0 pb-12 w-full">
           <div className="grid grid-cols-4 gap-2 md:gap-3 w-full bg-gray-50/50 rounded-3xl p-3 border border-gray-100 grid-flow-row-dense">
              {groupSlotsForRender(slots).map((item) => {
                 if (item.type === 'single') {
                    return (
                       <SlotCard 
                         key={item.slot.id}
                         slot={item.slot}
                         isSelected={selectedSlot?.id === item.slot.id}
                         onRent={setSelectedSlot}
                         onDivide={onDivide}
                         onJoin={onJoin && item.slot.width < 100 ? onJoin : undefined}
                         onViewTenant={setViewingTenantSlot}
                       />
                    );
                 } else {
                    return (
                       <div key={item.id} className="col-span-2 row-span-2 grid grid-cols-2 grid-rows-2 gap-2 md:gap-3 w-full h-full aspect-[10/7.65] relative bg-white rounded-[24px] overflow-hidden isolate">
                          {item.slots.sort((a, b) => a.order - b.order).map(slot => (
                            <SlotCard 
                               key={slot.id}
                               slot={slot}
                               isSelected={selectedSlot?.id === slot.id}
                               onRent={setSelectedSlot}
                               onDivide={onDivide}
                               onJoin={onJoin}
                               onViewTenant={setViewingTenantSlot}
                            />
                          ))}
                       </div>
                    );
                 }
              })}
           </div>
        </div>
          </div>

        </div>

        <AnimatePresence>
            {selectedSlot && (
              <React.Fragment key="selected-slot">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedSlot(null)} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 left-1/2 w-full max-w-[500px] -translate-x-1/2 bg-white rounded-t-[32px] z-50 shadow-2xl h-[85vh] overflow-hidden flex flex-col md:top-1/2 md:bottom-auto md:max-w-[760px] md:h-[82vh] md:-translate-y-1/2 md:rounded-[32px]"><div className="flex-1 overflow-y-auto p-6 pb-16">
                   <h2 className="text-2xl font-black tracking-tight text-center text-gray-900 mb-2">Alquilar ZonaVip</h2>
                   <p className="text-center text-gray-500 font-medium text-[15px] mb-2 leading-snug">
                     Elige la duración para patrocinar a <strong className="text-gray-800">{profile.displayName}</strong>.
                   </p>
                   
                   {selectedSlot.width === 100 && (
                     <div className="bg-white border border-gray-800 rounded-xl p-3 mb-6">
                        <p className="text-xs text-gray-700 font-semibold text-center leading-relaxed">
                          Estás adquiriendo <strong className="font-black text-gray-900">1 Zona Grande (Premium)</strong> que contiene 2 Subzonas y 8 Minizonas en total, que podrás realquilar o usar como quieras.
                        </p>
                     </div>
                   )}
                   {selectedSlot.width === 50 && (
                     <div className="bg-white border border-gray-800 rounded-xl p-3 mb-6">
                        <p className="text-xs text-gray-700 font-semibold text-center leading-relaxed">
                          Estás adquiriendo <strong className="font-black text-gray-900">1 Subzona</strong> que contiene 4 Minizonas en total, que podrás realquilar o usar como quieras.
                        </p>
                     </div>
                   )}
                   {selectedSlot.width === 25 && (
                     <div className="bg-white border border-gray-800 rounded-xl p-3 mb-6">
                        <p className="text-xs text-gray-700 font-semibold text-center leading-relaxed">
                          Estás adquiriendo <strong className="font-black text-gray-900">1 Minizona</strong>, que podrás realquilar o usar como quieras.
                        </p>
                     </div>
                   )}

                   <div className="grid grid-cols-2 gap-3 mb-6">
                      {[
                        { days: 1, label: '1 Día', price: selectedSlot.forResale && selectedSlot.resalePrices ? selectedSlot.resalePrices.price1 : selectedSlot.width === 100 ? (profile.prices100?.price1 || 15) : selectedSlot.width === 50 ? (profile.prices50?.price1 || 10) : (profile.prices25?.price1 || 5) },
                        { days: 7, label: '1 Semana', price: selectedSlot.forResale && selectedSlot.resalePrices ? selectedSlot.resalePrices.price7 : selectedSlot.width === 100 ? (profile.prices100?.price7 || 45) : selectedSlot.width === 50 ? (profile.prices50?.price7 || 30) : (profile.prices25?.price7 || 15) },
                        { days: 30, label: '1 Mes', price: selectedSlot.forResale && selectedSlot.resalePrices ? selectedSlot.resalePrices.price30 : selectedSlot.width === 100 ? (profile.prices100?.price30 || 150) : selectedSlot.width === 50 ? (profile.prices50?.price30 || 100) : (profile.prices25?.price30 || 45) },
                        { days: 365, label: '1 Año', price: selectedSlot.forResale && selectedSlot.resalePrices ? selectedSlot.resalePrices.price365 : selectedSlot.width === 100 ? (profile.prices100?.price365 || 600) : selectedSlot.width === 50 ? (profile.prices50?.price365 || 350) : (profile.prices25?.price365 || 200) }
                      ].map(dur => {
                         const colorTheme = {
                           25: { border: 'border-gray-900', bg: 'bg-gray-50', text: 'text-gray-900' },
                           50: { border: 'border-gray-900', bg: 'bg-gray-50', text: 'text-gray-900' },
                           75: { border: 'border-gray-900', bg: 'bg-gray-50', text: 'text-gray-900' },
                           100: { border: 'border-gray-900', bg: 'bg-gray-50', text: 'text-gray-900' }
                         }[selectedSlot.width as 25|50|75|100] || { border: 'border-gray-900', bg: 'bg-gray-50', text: 'text-gray-900' };

                         return (
                         <button 
                           key={dur.days}
                           onClick={() => setSelectedDuration(dur.days)}
                           className={cn("flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-95", selectedDuration === dur.days ? `${colorTheme.border} ${colorTheme.bg}` : "border-gray-100 bg-white hover:border-gray-200")}
                         >
                            <span className={cn("text-xs font-bold uppercase tracking-wide mb-1", selectedDuration === dur.days ? colorTheme.text : "text-gray-400")}>{dur.label}</span>
                            <span className={cn("text-xl font-black", selectedDuration === dur.days ? "text-gray-900" : "text-gray-600")}>${dur.price}</span>
                         </button>
                         );
                      })}
                   </div>

                   <div className="flex flex-col gap-4 mb-6">
                       <ImageUpload label="Imagen del Anuncio (Obligatorio)" value={rentImage} onChange={setRentImage} />
                       
                       <div className="flex flex-col gap-1">
                          <label className="font-bold text-gray-700 ml-1 text-sm">Nombre de la Marca</label>
                          <input type="text" value={rentBrand} onChange={e => setRentBrand(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" placeholder="Ej. Nike, Spotify..." />
                       </div>

                       <ImageUpload label="Logo de la Marca (Opcional)" value={rentBrandImg} onChange={setRentBrandImg} />
                       
                       <div className="flex flex-col gap-1">
                          <label className="font-bold text-gray-700 ml-1 text-sm">Caption (Opcional)</label>
                          <input type="text" value={rentCaption} onChange={e => setRentCaption(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" placeholder="Texto que aparecerá..." />
                       </div>

                       <div className="flex flex-col gap-1">
                          <label className="font-bold text-gray-700 ml-1 text-sm">Enlace (Opcional)</label>
                          <input type="url" value={rentLink} onChange={e => setRentLink(e.target.value)} className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-pink-500" placeholder="https://tusitio.com" />
                       </div>
                   </div>
                   
                   <button 
                     disabled={isProcessing || !rentImage.trim() || !rentBrand.trim()}
                     onClick={handleRent}
                     className={cn("w-full py-4 text-white rounded-2xl font-bold text-lg transition active:scale-[0.98] disabled:opacity-50",
                       {
                         25: 'bg-gray-900 hover:bg-black',
                         50: 'bg-gray-900 hover:bg-black',
                         75: 'bg-gray-900 hover:bg-black',
                         100: 'bg-gray-900 hover:bg-black'
                       }[selectedSlot.width as 25|50|75|100] || 'bg-gray-900 hover:bg-black'
                     )}
                   >
                       {isProcessing ? "Procesando pago..." : isOwnerPreview ? "Probar Flujo de Pago" : "Pagar y Reservar"}
                   </button>
                   <button onClick={() => setSelectedSlot(null)} className="w-full mt-3 py-3 text-gray-500 hover:text-gray-900 font-bold transition">Cancelar</button>
                </div></motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {isUploadingStory && (
               <React.Fragment key="uploading">
                 <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50">
                    <StoryUploader 
                       onCancel={() => setIsUploadingStory(false)}
                       onPublish={handlePublishStory}
                       isProcessing={isProcessing}
                    />
                 </motion.div>
               </React.Fragment>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {selectedStoryIndex !== null && (
               <StoryViewer 
                  stories={stories}
                  initialIndex={selectedStoryIndex}
                  onClose={() => setSelectedStoryIndex(null)}
               />
            )}
        </AnimatePresence>

        <AnimatePresence>
            {showContactsModal && (
               <ContactsModal connections={connections} profileId={profileId!} onClose={() => setShowContactsModal(false)} currentUser={currentUser} />
            )}
        </AnimatePresence>

        <AnimatePresence>
            {showCancelConfirm && (
                <>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 px-6">
                      <div className="bg-white rounded-[24px] p-6 w-full max-w-[320px] shadow-2xl flex flex-col">
                          <h3 className="font-bold text-center text-lg text-gray-900 mb-2">Cancelar petición</h3>
                          <p className="text-gray-500 text-center text-sm mb-6 leading-snug">¿Quieres cancelar la solicitud de contacto enviada?</p>
                          <div className="flex gap-3">
                              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">Volver</button>
                              <button onClick={() => { handleCancelContact(); setShowCancelConfirm(false); }} className="flex-1 py-3 bg-pink-500 text-white rounded-xl font-bold text-sm hover:bg-pink-600 transition-colors">Sí, cancelar</button>
                          </div>
                      </div>
                  </motion.div>
                </>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {showTransactionsModal && (
               <TransactionsModal transactions={transactions} onClose={() => setShowTransactionsModal(false)} />
            )}
        </AnimatePresence>

        <AnimatePresence>
            {showMarketModal && (
                <>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowMarketModal(false)} className="fixed inset-0 bg-black/55 z-50 backdrop-blur-sm" />
                  <motion.div initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 28, scale: 0.98 }} className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-h-[92dvh] overflow-hidden rounded-t-[28px] bg-white shadow-2xl md:inset-6 md:bottom-auto md:max-w-none md:rounded-[28px]">
                    <div className="flex h-full max-h-[92dvh] flex-col">
                      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 md:px-7">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Exchange del creador</p>
                          <h2 className="text-xl font-black text-gray-900 md:text-2xl">{tokenMarket.symbol} Market</h2>
                        </div>
                        <button onClick={() => setShowMarketModal(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-900">
                          <PlusSquare className="h-5 w-5 rotate-45" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 md:p-7">
                        <TokenMarketPanel
                          market={tokenMarket}
                          openSellOffers={openSellOffers}
                          buyAmount={buyTokenAmount}
                          sellAmount={sellTokenAmount}
                          onBuyAmountChange={setBuyTokenAmount}
                          onSellAmountChange={setSellTokenAmount}
                          onConfirm={(side, orderType, price) => { setMarketOrderType(orderType); setMarketOrderPrice(price); setConfirmMarketAction(side); }}
                        />
                      </div>
                    </div>
                  </motion.div>
                </>
            )}
        </AnimatePresence>
        <AnimatePresence>
            {confirmMarketAction && (
                <>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirmMarketAction(null)} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 px-6">
                      <div className="bg-white rounded-[24px] p-6 w-full max-w-[340px] shadow-2xl flex flex-col">
                          <h3 className="font-black text-center text-xl text-gray-900 mb-2">
                            Confirmar {confirmMarketAction === 'buy' ? 'compra' : 'venta'}
                          </h3>
                          <p className="text-gray-500 text-center text-sm mb-5 leading-snug">
                            {formatTokenAmount(marketActionAmount)} {tokenMarket.symbol} a {formatTokenPrice(marketActionPrice)} por token.
                          </p>
                          <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 mb-5 flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-gray-400">Total</span>
                            <span className="text-2xl font-black text-gray-900">{formatTokenPrice(marketActionTotal)}</span>
                          </div>
                          <div className="flex gap-3">
                              <button onClick={() => setConfirmMarketAction(null)} className="flex-1 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">Cancelar</button>
                              <button onClick={executeMarketAction} className="flex-1 py-3 bg-pink-500 text-white rounded-xl font-bold text-sm hover:bg-pink-600 transition-colors">Ejecutar</button>
                          </div>
                      </div>
                  </motion.div>
                </>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {viewingTenantSlot && (
              <React.Fragment key="view-tenant">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewingTenantSlot(null)} className="fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 m-auto w-[90%] max-w-[400px] md:max-w-[600px] h-fit max-h-[90vh] bg-white rounded-3xl z-[100] shadow-2xl flex flex-col overflow-hidden">
                    {viewingTenantSlot.image && (
                       <div className="w-full bg-gray-950 overflow-hidden flex-shrink-0">
                          <img src={viewingTenantSlot.image} className="w-full h-auto block max-h-[55vh] object-contain" alt="Ad" />
                       </div>
                    )}
                    <div className="flex flex-col p-5 md:p-6 gap-3 overflow-y-auto">
                       {(viewingTenantSlot.brand || viewingTenantSlot.brandImg) && (
                         <div className="flex items-center gap-3">
                            {viewingTenantSlot.brandImg && <img src={viewingTenantSlot.brandImg} className="w-10 h-10 rounded-full border border-gray-200 shadow-sm shrink-0 object-cover" alt="brand" />}
                            {viewingTenantSlot.brand && <span className="font-black text-lg text-gray-900 leading-tight">{viewingTenantSlot.brand}</span>}
                         </div>
                       )}
                       {viewingTenantSlot.link && (
                          <a
                            href={viewingTenantSlot.link.startsWith('http') ? viewingTenantSlot.link : `https://${viewingTenantSlot.link}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pink-600 hover:text-pink-700 font-bold text-base underline underline-offset-2 truncate transition-colors"
                          >
                            {viewingTenantSlot.link.replace(/^https?:\/\//, '')}
                          </a>
                       )}
                       {viewingTenantSlot.caption && (
                          <p className="text-gray-600 text-sm leading-relaxed font-medium">
                             {viewingTenantSlot.caption}
                          </p>
                       )}
                       <button onClick={() => setViewingTenantSlot(null)} className="w-full mt-1 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold rounded-2xl transition active:scale-95 text-sm">Cerrar</button>
                    </div>
                </motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>

        <AnimatePresence>
            {showProfileCard && (
              <React.Fragment key="profile-card">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowProfileCard(false)} className="fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 m-auto w-[90%] max-w-[400px] md:max-w-[520px] h-fit max-h-[90vh] bg-white rounded-3xl z-[100] shadow-2xl flex flex-col overflow-hidden">
                  {/* Header con banner/gradiente */}
                  <div className="relative w-full h-28 shrink-0 overflow-hidden">
                    {profile.bannerURL
                      ? <img src={profile.bannerURL} className="w-full h-full object-cover" alt="" />
                      : <div className="w-full h-full bg-gradient-to-br from-pink-500 via-purple-600 to-gray-900" />
                    }
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    {/* Avatar centrado sobre el borde */}
                    <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 w-[72px] h-[72px] rounded-full border-[3px] border-white shadow-lg overflow-hidden bg-white">
                      <img src={profile.photoURL} alt={profile.displayName} className="w-full h-full object-cover" />
                    </div>
                  </div>

                  {/* Contenido */}
                  <div className="flex flex-col items-center px-6 pt-12 pb-5 gap-3 overflow-y-auto">
                    <div className="text-center">
                      <h2 className="font-black text-xl text-gray-900 leading-tight">{profile.displayName.replace(/^ZonaVip\s+/i, '')}</h2>
                      <p className="text-gray-400 text-xs font-bold tracking-wide mt-0.5">@{profile.username}</p>
                    </div>

                    {profile.profileBio && (
                      <p className="text-gray-600 text-sm text-center leading-relaxed px-2 font-medium">
                        {profile.profileBio}
                      </p>
                    )}

                    {profile.profileLinks && profile.profileLinks.length > 0 && (
                      <div className="w-full flex flex-col gap-2 mt-1">
                        {profile.profileLinks.filter(l => l.url?.trim()).map((lnk, i) => (
                          <a
                            key={i}
                            href={lnk.url.startsWith('http') ? lnk.url : `https://${lnk.url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between w-full px-4 py-3 bg-gray-50 hover:bg-pink-50 border border-gray-200 hover:border-pink-200 rounded-2xl transition-colors group"
                          >
                            <span className="font-bold text-gray-900 text-sm truncate group-hover:text-pink-600 transition-colors">{lnk.title || lnk.url.replace(/^https?:\/\//, '')}</span>
                            <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-pink-500 shrink-0 ml-2 transition-colors" />
                          </a>
                        ))}
                      </div>
                    )}

                    {(!profile.profileBio && (!profile.profileLinks || profile.profileLinks.length === 0)) && (
                      <p className="text-gray-400 text-sm text-center py-2">Este perfil aún no tiene presentación.</p>
                    )}

                    <button onClick={() => setShowProfileCard(false)} className="w-full mt-2 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold rounded-2xl transition active:scale-95 text-sm">Cerrar</button>
                  </div>
                </motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>
    </>
  );
}
