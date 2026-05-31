import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, googleProvider } from './firebase';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, increment, collectionGroup, orderBy, limit, arrayUnion, arrayRemove, writeBatch, addDoc, deleteField } from 'firebase/firestore';
import { Wallet, LogOut, LayoutDashboard, Share2, PlusSquare, Image as ImageIcon, Settings, User, Plus, Trash2, Loader2, UploadCloud, Eye, Compass, ArrowUpRight, ArrowDownLeft, History, TrendingUp, Clock, CheckCircle2, DollarSign, CreditCard, Heart, MessageCircle, ChevronLeft, Bell, Search, Camera } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { uploadToCloudinary, processMediaFile } from './lib/cloudinary';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
// TYPES
// -------------------------------------------------------------
type SizePrices = { price1: number; price7: number; price30: number; price365: number; };


type Notification = {
  id: string;
  type: 'contact_request' | 'sale' | 'general';
  message: string;
  fromId: string;
  read: boolean;
  createdAt: number;
  link?: string;
};

type ProfileCard = {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  description?: string;
  image?: string;
  imageUrl?: string;
  linkTitle?: string;
  linkUrl?: string;
  backgroundColor?: string;
  textColor?: string;
};

type CreatorProfile = {
  id?: string;
  username: string;
  displayName: string;
  photoURL: string;
  bannerURL: string;
  customCard?: ProfileCard | string;
  walletBalance: number;
  prices100?: SizePrices;
  prices50?: SizePrices;
  prices25?: SizePrices;
  views?: number;
  totalSales?: number;
  createdAt: any;
  updatedAt: any;
};

type AdSpace = {
  id: string; 
  width: number; // 25, 50, 75, or 100
  order: number; // For correct sorting
  isRented: boolean;
  pricePaid?: number;
  brand?: string;
  brandImg?: string;
  caption?: string;
  image?: string;
  rentedBy?: string;
  rentStart?: number;
  rentEnd?: number;
  forResale?: boolean;
  resalePrices?: {
    price1: number;
    price7: number;
    price30: number;
    price365: number;
  };
};

type StoryOverlay = {
  type: 'text' | 'emoji';
  content: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color?: string;
  fontFamily?: string;
  textStyle?: 'normal' | 'neon' | 'bordered' | 'bubble';
};

type Story = {
  id: string;
  image: string;
  mediaType?: 'image' | 'video';
  overlays?: string; // JSON string of StoryOverlay[]
  filter?: string;
  clipStart?: number;
  clipDuration?: number;
  brand: string;
  brandImg: string;
  rentedBy: string;
  createdAt: number;
};

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
            <img src={story.image} className="w-full h-full object-cover" alt="Story" style={{ filter: story.filter || 'none' }} />
        ) : (
            <video 
               src={story.image} 
               className="w-full h-full object-cover" 
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
       alert("Error subiendo imagen. Verifica Cloudinary config.");
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
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await initUser(cred.user, username);
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
        const generatedUsername = cred.user.email?.split('@')[0] || `user_${Date.now()}`;
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
    await setDoc(doc(db, 'users', u.uid), {
      email: u.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'users'));

    const profile = {
      username: baseUsername.toLowerCase().replace(/[^a-z0-9-]/g, ''),
      displayName: baseUsername,
      photoURL: u.photoURL || 'https://i.pravatar.cc/150?u=' + u.uid,
      bannerURL: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80',
      walletBalance: 0,
      prices100: { price1: 15, price7: 45, price30: 150, price365: 600 },
      prices50: { price1: 10, price7: 30, price30: 100, price365: 350 },
      prices25: { price1: 5, price7: 15, price30: 45, price365: 200 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'creatorProfiles', u.uid), profile)
      .catch(e => handleFirestoreError(e, OperationType.CREATE, 'creatorProfiles'));

    for (let i=1; i<=5; i++) {
      const space: AdSpace = {
        id: `slot-${i}`,
        width: 100,
        order: i * 1000,
        isRented: false
      };
      await setDoc(doc(db, `creatorProfiles/${u.uid}/adSpaces`, space.id), space)
        .catch(e => handleFirestoreError(e, OperationType.CREATE, `creatorProfiles/${u.uid}/adSpaces`));
    }
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

function ExplorerView({ currentUser, userProfile, searchQuery }: { currentUser: FirebaseUser; userProfile: CreatorProfile | null; searchQuery: string }) {
   const [vipProfiles, setVipProfiles] = useState<CreatorProfile[]>([]);
   const [stories, setStories] = useState<Story[]>([]);
   const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);

   useLockBodyScroll(selectedStoryIndex !== null);

   useEffect(() => {
       const qProfiles = query(collection(db, 'creatorProfiles'), limit(100)); // Fetch enough to filter, no index needed yet
       const unsubProfiles = onSnapshot(qProfiles, (snap) => {
           const profiles: CreatorProfile[] = [];
           snap.forEach(d => profiles.push({ id: d.id, ...d.data() } as any));
           // Ordenar por views de mayor a menor (o 0 si no existe)
           profiles.sort((a, b) => (b.views || 0) - (a.views || 0));
           setVipProfiles(profiles);
       }, (err) => {
           console.error("Error fetching profiles:", err);
       });

       const unsubStories = onSnapshot(collectionGroup(db, 'stories'), (snap) => {
           const strs: Story[] = [];
           snap.forEach(d => strs.push({ id: d.id, ...d.data() } as Story));
           strs.sort((a, b) => b.createdAt - a.createdAt);
           setStories(strs.slice(0, 30));
       }, (err) => {
           console.error("Error fetching stories:", err);
       });

       return () => { unsubProfiles(); unsubStories(); };
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
                 <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {filteredProfiles.map((p) => (
                       <ProfileExploreCard key={p.username} p={p} />
                    ))}
                 </div>
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
  const [rentedSlots, setRentedSlots] = useState<{slot: AdSpace, profileId: string, profileUsername?: string}[]>([]);
  const [adminViewTab, setAdminViewTab] = useState<'mine' | 'rented'>('mine');
  const [stories, setStories] = useState<Story[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'profile' | 'admin' | 'settings' | 'wallet' | 'explorer' | 'notifications'>(
    (location.state as any)?.tab || 'profile'
  );
  
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
  
  // Settings state
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [editBanner, setEditBanner] = useState('');
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

  useLockBodyScroll(editingSize !== null || deletingSlot !== null);

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
       snap.forEach(d => fetchedSlots.push(d.data() as AdSpace));
       fetchedSlots.sort((a,b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
       setSlots(checkAndCleanExpiredSlots(fetchedSlots, user.uid, true));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${user.uid}/adSpaces`));

   const unsubRentedSlots = onSnapshot(
      query(collectionGroup(db, 'adSpaces'), where('rentedBy', '==', user.uid)),
      async (snap) => {
        const fetched: {slot: AdSpace, profileId: string, profileUsername?: string}[] = [];
        const now = Date.now();
        for (const d of snap.docs) {
           const data = d.data() as AdSpace;
           if (data.isRented && data.rentEnd && now > data.rentEnd) continue;
           const parts = d.ref.path.split('/');
               if (parts.length >= 4) {
                  const profileId = parts[1];
                  let profileUsername = profileId;
                  try {
                    const profileSnap = await getDoc(doc(db, 'creatorProfiles', profileId));
                    if (profileSnap.exists()) {
                       profileUsername = profileSnap.data().username || profileId;
                    }
                  } catch (e) {
                    console.error("Error fetching creator profile", e);
                  }
                  fetched.push({ slot: data, profileId, profileUsername });
               }
        }
        setRentedSlots(fetched);
      },
      (err) => console.log('Error fetching rented slots', err)
    );

    const unsubStories = onSnapshot(collection(db, `creatorProfiles/${user.uid}/stories`), (snap) => {
       const fetchedStories: Story[] = [];
       snap.forEach(d => fetchedStories.push({ id: d.id, ...d.data() } as Story));
       fetchedStories.sort((a, b) => b.createdAt - a.createdAt);
       setStories(fetchedStories);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${user.uid}/stories`));

    const unsubNotifs = onSnapshot(query(collection(db, `users/${user.uid}/notifications`)), (snap) => {
       const fetchedNotifs: Notification[] = [];
       snap.forEach(d => fetchedNotifs.push({ id: d.id, ...d.data() } as Notification));
       fetchedNotifs.sort((a, b) => b.createdAt - a.createdAt);
       setNotifications(fetchedNotifs);
    }, (err) => console.log('Error fetching notifs', err));

    return () => { unsubProfile(); unsubSlots(); unsubRentedSlots(); unsubStories(); unsubNotifs(); };
  }, [user, navigate]);

  const handleSaveProfile = async () => {
     if (!user) return;
     setIsSaving(true);
     try {
         await updateDoc(doc(db, 'creatorProfiles', user.uid), {
             displayName: editName,
             username: editUsername.toLowerCase().replace(/[^a-z0-9-]/g, ''),
             photoURL: editPhoto,
             bannerURL: editBanner,
             updatedAt: serverTimestamp()
         });
         alert('Guardado');
     } catch (err: any) { alert(err.message); }
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
    } catch(e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
    setIsProcessingSlot(false);
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
      if (siblings.length !== 4) { setIsProcessingSlot(false); return alert('Faltan partes para unir. Deben estar las 4 piezas.'); }
      if (siblings.some(s => s.isRented)) { setIsProcessingSlot(false); return alert('No puedes unir si alguna parte está alquilada.'); }
      
      const minOrder = Math.min(...siblings.map(s => s.order));
      const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 50, order: minOrder };
      for (const s of siblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    } else if (slot.width === 50) {
      const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
      const siblings = slots.filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
      if (siblings.length !== 2) { setIsProcessingSlot(false); return alert('Faltan partes para unir. Deben estar ambas mitades.'); }
      if (siblings.some(s => s.isRented)) { setIsProcessingSlot(false); return alert('No puedes unir si alguna parte está alquilada.'); }
      
      const minOrder = Math.min(...siblings.map(s => s.order));
      const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 100, order: minOrder };
      for (const s of siblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    }

    try {
       await batch.commit();
    } catch(e) {
       handleFirestoreError(e, OperationType.WRITE, path);
    }
    setIsProcessingSlot(false);
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
    } catch(e) {
       console.error(e);
    }
    setIsProcessingSlot(false);
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
            forResale: tenantEditForResale,
            resalePrices: tenantEditForResale ? tenantEditResalePrices : deleteField()
        });
        alert("¡Cambios guardados!");
        setSelectedTenantSlot(null);
    } catch(e: any) { alert(e.message); }
    setIsProcessingSlot(false);
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
            forResale: deleteField(),
            resalePrices: deleteField()
        });
        setTenantEditBrand('');
        setTenantEditBrandImg('');
        setTenantEditCaption('');
        setTenantEditImage('');
        setTenantEditForResale(false);
        alert("¡Anuncio borrado! El espacio está libre.");
        setSelectedTenantSlot(null);
    } catch(e: any) { alert('Error al liberar: ' + e.message); }
    setIsProcessingSlot(false);
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
      alert('Espacio dividido exitosamente.');
      setSelectedTenantSlot(null);
    } catch(e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
    setIsProcessingSlot(false);
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
          if (siblings.length !== 4) { setIsProcessingSlot(false); return alert('Faltan partes para unir. Deben estar las 4 piezas.'); }
          if (siblings.some(s => !s.isRented || s.rentedBy !== user.uid)) {
              setIsProcessingSlot(false); return alert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.');
          }
          
          const minOrder = Math.min(...siblings.map(s => s.order));
          const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 50, order: minOrder };
          for (const s of siblings) batch.delete(doc(db, path, s.id));
          batch.set(doc(db, path, parentId), newSlot);
        } else if (slot.width === 50) {
          const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
          const siblings = allSlots.filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
          if (siblings.length !== 2) { setIsProcessingSlot(false); return alert('Faltan partes para unir. Deben estar ambas mitades.'); }
          if (siblings.some(s => !s.isRented || s.rentedBy !== user.uid)) {
              setIsProcessingSlot(false); return alert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.');
          }
          
          const minOrder = Math.min(...siblings.map(s => s.order));
          const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 100, order: minOrder };
          for (const s of siblings) batch.delete(doc(db, path, s.id));
          batch.set(doc(db, path, parentId), newSlot);
        }

        await batch.commit();
        alert('Espacios unidos exitosamente.');
        setSelectedTenantSlot(null);
    } catch(e) {
        handleFirestoreError(e, OperationType.WRITE, path);
    }
    setIsProcessingSlot(false);
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
    await setDoc(doc(db, `creatorProfiles/${user.uid}/adSpaces`, newSlot.id), newSlot)
      .catch(e => handleFirestoreError(e, OperationType.CREATE, `creatorProfiles/${user.uid}/adSpaces`));
    setIsProcessingSlot(false);
  };

  const handleDeleteSlot = (slotId: string) => {
    setDeletingSlot(slotId);
  };

  const handleDeleteSlotConfirm = async (slotId: string) => {
    if (!user) return;
    await deleteDoc(doc(db, `creatorProfiles/${user.uid}/adSpaces`, slotId))
      .catch(e => handleFirestoreError(e, OperationType.DELETE, `creatorProfiles/${user.uid}/adSpaces`));
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
      await updateDoc(doc(db, 'creatorProfiles', user.uid), {
          [key]: { price1, price7, price30, price365 },
          updatedAt: serverTimestamp()
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'creatorProfiles'));
      
      setIsSavingPrices(false);
      setSaveSuccess(true);
      setTimeout(() => {
          setSaveSuccess(false);
          setEditingSize(null);
      }, 1000);
  };

  if (!user || loading || !profile) return <div className="min-h-[100dvh] flex items-center justify-center font-sans tracking-wide">Cargando...</div>;

  return (
    <div className="min-h-[100dvh] bg-[#FDFDFD] flex justify-center overflow-x-hidden font-sans">
      <main className="w-full max-w-[500px] lg:max-w-[1180px] bg-white shadow-[0_0_80px_rgba(0,0,0,0.1)] relative flex flex-col pb-[80px] min-h-[100dvh]">
        
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

              <button disabled={isSaving} onClick={handleSaveProfile} className="mt-4 w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition active:scale-95">
                 {isSaving ? 'Guardando...' : 'Guardar Cambios'}
              </button>
           </div>
        )}

        {/* --- VIEW: EXPLORER --- */}
        {activeTab === 'explorer' && user && (
           <ExplorerView currentUser={user} userProfile={profile} searchQuery={searchQuery} />
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
           <div className="flex-1 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto pb-24 bg-gray-50/50">
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
                    <button onClick={async () => {
                        if (!profile || profile.walletBalance <= 0) { alert("No tienes balance disponible para retirar."); return; }
                        const amountStr = window.prompt(`Ingresa el monto a retirar (Max: $${profile.walletBalance}):`);
                        if (!amountStr) return;
                        const amount = parseFloat(amountStr);
                        if (isNaN(amount) || amount <= 0 || amount > profile.walletBalance) { alert("Monto inválido."); return; }
                        try {
                            await updateDoc(doc(db, `creatorProfiles/${user.uid}`), { walletBalance: increment(-amount) });
                            alert(`Has retirado $${amount} exitosamente (Simulado).`);
                        } catch(e: any) { alert(e.message); }
                    }} className="flex-1 bg-white hover:bg-gray-100 text-gray-900 py-3.5 rounded-[16px] font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm">
                       <ArrowUpRight className="w-5 h-5" />
                       Retirar
                    </button>
                    <button onClick={() => alert("Métodos de pago en desarrollo. Por ahora usamos pago simulado para hacer pruebas.")} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3.5 rounded-[16px] font-bold flex items-center justify-center gap-2 transition-all active:scale-95 border border-gray-700 shadow-sm">
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
                    <p className="text-gray-500 text-xs font-bold mb-1 uppercase tracking-wider">Ventas (Mes)</p>
                    <p className="text-2xl font-black text-gray-900">${((profile?.walletBalance || 0) * 0.4 + 195).toLocaleString('en-US', {minimumFractionDigits:2})}</p>
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
                    {[
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
                    ))}
                 </div>
              </div>
           </div>
        )}

        {/* BOTTOM NAVIGATION */}
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} unreadCount={notifications.filter(n => !n.read).length} />

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
                <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 w-full max-w-[500px] bg-white rounded-t-[32px] z-50 shadow-2xl h-[85vh] overflow-hidden flex flex-col"><div className="flex-1 overflow-y-auto p-6 pb-16">
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
    </div>
  );
}

// -------------------------------------------------------------
// PUBLIC PROFILE
// -------------------------------------------------------------
function PublicProfile({ currentUser }: { currentUser: FirebaseUser | null }) {
  const { username } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [slots, setSlots] = useState<AdSpace[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessingSlot, setIsProcessingSlot] = useState(false);

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
    } catch(e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
    setIsProcessingSlot(false);
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
      if (siblings.length !== 4) { setIsProcessingSlot(false); return alert('Faltan partes para unir. Deben estar las 4 piezas.'); }
      
      if (slot.isRented) {
         if (siblings.some(s => !s.isRented || s.rentedBy !== currentUser.uid)) {
             setIsProcessingSlot(false); return alert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.');
         }
      } else {
         if (siblings.some(s => s.isRented)) { setIsProcessingSlot(false); return alert('No puedes unir si alguna parte está alquilada por otro.'); }
      }
      
      const minOrder = Math.min(...siblings.map(s => s.order));
      const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 50, order: minOrder };
      for (const s of siblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    } else if (slot.width === 50) {
      const parentId = slot.id.substring(0, slot.id.lastIndexOf('-'));
      const siblings = slots.filter(s => s.id.startsWith(parentId + '-') && s.width === 50);
      if (siblings.length !== 2) { setIsProcessingSlot(false); return alert('Faltan partes para unir. Deben estar ambas mitades.'); }
      
      if (slot.isRented) {
         if (siblings.some(s => !s.isRented || s.rentedBy !== currentUser.uid)) {
             setIsProcessingSlot(false); return alert('Para unir, debes ser el inquilino de TODAS las sub-partes que quieres unir.');
         }
      } else {
         if (siblings.some(s => s.isRented)) { setIsProcessingSlot(false); return alert('No puedes unir si alguna parte está alquilada por otro.'); }
      }
      
      const minOrder = Math.min(...siblings.map(s => s.order));
      const newSlot: AdSpace = { ...siblings[0], id: parentId, width: 100, order: minOrder };
      for (const s of siblings) batch.delete(doc(db, path, s.id));
      batch.set(doc(db, path, parentId), newSlot);
    }

    try {
       await batch.commit();
    } catch(e) {
       handleFirestoreError(e, OperationType.WRITE, path);
    }
    setIsProcessingSlot(false);
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
       snap.forEach(d => fetchedSlots.push(d.data() as AdSpace));
       fetchedSlots.sort((a,b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
       const isOwner = currentUser?.uid === profileId;
       setSlots(checkAndCleanExpiredSlots(fetchedSlots, profileId, isOwner));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${profileId}/adSpaces`));

    const unsubStories = onSnapshot(collection(db, `creatorProfiles/${profileId}/stories`), (snap) => {
       const fetchedStories: Story[] = [];
       snap.forEach(d => fetchedStories.push({ id: d.id, ...d.data() } as Story));
       fetchedStories.sort((a, b) => b.createdAt - a.createdAt);
       setStories(fetchedStories);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `creatorProfiles/${profileId}/stories`));

    return () => { unsub(); unsubStories(); };
  }, [profileId]);

  if (loading) return <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center font-sans">Cargando perfil...</div>;
  if (!profile) return <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center text-gray-500 font-sans">Perfil no encontrado.</div>;

  return (
    <div className="min-h-[100dvh] bg-[#FDFDFD] flex justify-center overflow-x-hidden font-sans">
      <main className={cn("w-full max-w-[500px] lg:max-w-[1180px] bg-white shadow-[0_0_80px_rgba(0,0,0,0.1)] relative flex flex-col min-h-[100dvh]", currentUser ? "pb-[60px]" : "")}>
         <div id="profile-scroll-container" className="flex-1 overflow-y-auto w-full pb-10">
            <ProfileView profile={profile} slots={slots} stories={stories} isOwnerPreview={false} profileId={profileId} currentUser={currentUser} onBack={currentUser ? () => navigate('/dashboard', { state: { tab: 'explorer' } }) : undefined} onDivide={handleDivide} onJoin={handleJoin} />
         </div>
         {currentUser && (
             <BottomNav activeTab="explorer" onTabChange={(tab) => navigate('/dashboard', { state: { tab } })} />
         )}
      </main>
    </div>
  );
}

// -------------------------------------------------------------
// PROFILE LOGIC (USED IN BOTH PUBLIC TRULY AND ADMIN TEST)
// -------------------------------------------------------------
type Connection = {
  id: string;
  users: string[];
  status: 'pending' | 'accepted';
  initiator: string;
  createdAt: number;
}

type TransactionType = {
  id: string;
  slotId: string;
  buyerId: string;
  brand: string;
  price: number;
  duration: number;
  createdAt: number;
};

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
    } catch (e: any) { alert(e.message); }
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
    } catch (e: any) { alert(e.message); }
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
                          {isAccepted && currentUser && c.users.includes(currentUser.uid) && (
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

function StoryUploader({ onPublish, onCancel, isProcessing }: { onPublish: (media: { url: string, type: 'image'|'video' }, overlays: StoryOverlay[], filter: string, clipStart: number, clipDuration: number) => void, onCancel: () => void, isProcessing: boolean }) {
  const [media, setMedia] = useState<{url: string, type: 'image'|'video'} | null>(null);
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
            alert("Error procesando archivo.");
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
                  <button onClick={() => setEditingOverlay('emoji' as any)} className="text-white p-2 text-xl rounded-full bg-black/40 backdrop-blur-sm">😊</button>
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
                   <video ref={videoRef} src={media.url} className="w-full h-full object-cover pointer-events-none" autoPlay loop muted playsInline style={{ filter }} />
                ) : (
                   <img src={media.url} className="w-full h-full object-cover pointer-events-none" alt="Preview" style={{ filter }} />
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
                     {['🔥','✨','❤️','😂','🥺','🚀','💎','👀','💯','💀','🎉','🙌'].map(e => (
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

type MarketOrder = {
  price: number;
  amount: number;
};

type MarketTrade = {
  id: string;
  price: number;
  amount: number;
  createdAt: number;
};

type TokenMarket = {
  symbol: string;
  lastPrice: number;
  bestAsk: number;
  bestBid: number;
  change24h: number;
  volume24h: number;
  asks: MarketOrder[];
  bids: MarketOrder[];
  trades: MarketTrade[];
  history: Record<'24h' | '7d' | '30d', number[]>;
};

const formatTokenPrice = (value: number) => `$${value.toFixed(2)}`;
const formatTokenAmount = (value: number) => value.toLocaleString('es-ES', { maximumFractionDigits: 2 });

const formatAgo = (timestamp: number) => {
  const diff = Math.max(1, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${Math.floor(hours / 24)}d`;
};

function buildTokenMarket(profile: CreatorProfile, transactions: { id: string; price: number; createdAt: number; duration?: number }[], slots: AdSpace[]): TokenMarket {
  const basePrice = Math.max(
    1,
    transactions[0]?.price ||
      profile.prices25?.price1 ||
      profile.prices50?.price1 ||
      profile.prices100?.price1 ||
      5
  );
  const rentedSlots = Math.max(1, slots.filter(s => s.isRented).length);
  const symbol = (profile.username || profile.displayName || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'VIP';
  const asks = Array.from({ length: 6 }, (_, i) => ({
    price: Number((basePrice * (1.025 + i * 0.018)).toFixed(2)),
    amount: Number((8 + rentedSlots * 1.35 + i * 3.15).toFixed(2))
  })).sort((a, b) => a.price - b.price);
  const bids = Array.from({ length: 6 }, (_, i) => ({
    price: Number((basePrice * (0.985 - i * 0.018)).toFixed(2)),
    amount: Number((7 + rentedSlots * 1.1 + i * 2.75).toFixed(2))
  })).sort((a, b) => b.price - a.price);
  const trades = transactions
    .slice(0, 15)
    .map((tx, i) => ({
      id: tx.id,
      price: Number((tx.price || basePrice).toFixed(2)),
      amount: Number(Math.max(1, (tx.duration || 7) / 2).toFixed(2)),
      createdAt: tx.createdAt || Date.now() - i * 18 * 60000
    }));
  if (trades.length === 0) {
    for (let i = 0; i < 10; i++) {
      trades.push({
        id: `demo-trade-${i}`,
        price: Number((basePrice * (1 + Math.sin(i + rentedSlots) * 0.035)).toFixed(2)),
        amount: Number((3 + i * 1.4).toFixed(2)),
        createdAt: Date.now() - (i + 1) * 22 * 60000
      });
    }
  }
  const previous = trades[trades.length - 1]?.price || basePrice * 0.96;
  const lastPrice = trades[0]?.price || basePrice;
  const change24h = previous ? ((lastPrice - previous) / previous) * 100 : 0;
  const volume24h = trades
    .filter(t => Date.now() - t.createdAt < 24 * 60 * 60 * 1000)
    .reduce((sum, t) => sum + t.amount, 0);
  const makeHistory = (points: number, waveSize: number, trendSize: number) =>
    Array.from({ length: points }, (_, i) => {
      const wave = Math.sin((i + rentedSlots) / 2.7) * waveSize;
      const trend = (i - points / 2) * (change24h / trendSize);
      return Number((basePrice * (1 + wave + trend)).toFixed(2));
    });

  return {
    symbol,
    lastPrice,
    bestAsk: asks[0].price,
    bestBid: bids[0].price,
    change24h,
    volume24h,
    asks,
    bids,
    trades,
    history: {
      '24h': makeHistory(24, 0.045, 1000),
      '7d': makeHistory(28, 0.07, 850),
      '30d': makeHistory(30, 0.11, 700)
    }
  };
}

function PriceSparkline({ points }: { points: number[] }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(0.01, max - min);
  const d = points.map((point, i) => {
    const x = (i / Math.max(1, points.length - 1)) * 100;
    const y = 42 - ((point - min) / range) * 34;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 100 46" className="w-full h-28 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="#ff2a85" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      <path d={`${d} L 100 46 L 0 46 Z`} fill="rgba(255,42,133,0.08)" />
    </svg>
  );
}

function TokenMarketPanel({
  market,
  openSellOffers,
  buyAmount,
  sellAmount,
  onBuyAmountChange,
  onSellAmountChange,
  onConfirm
}: {
  market: TokenMarket;
  openSellOffers: MarketOrder[];
  buyAmount: number;
  sellAmount: number;
  onBuyAmountChange: (value: number) => void;
  onSellAmountChange: (value: number) => void;
  onConfirm: (side: 'buy' | 'sell') => void;
}) {
  const [timeframe, setTimeframe] = useState<'24h' | '7d' | '30d'>('24h');
  const isPositive = market.change24h >= 0;
  const buyTotal = buyAmount * market.bestAsk;
  const sellTotal = sellAmount * market.bestBid;
  const hasBid = market.bids.length > 0 && market.bestBid > 0;
  const canBuy = buyAmount > 0 && market.bestAsk > 0;
  const canSell = sellAmount > 0;

  return (
    <section className="mx-4 mb-4 rounded-[24px] border border-gray-100 bg-white shadow-sm overflow-hidden shrink-0 lg:mx-0 lg:mb-0">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">{market.symbol} Token</p>
            <div className="flex items-end gap-2 mt-1">
              <h2 className="text-3xl font-black text-gray-900 leading-none">{formatTokenPrice(market.lastPrice)}</h2>
              <span className={cn("text-xs font-black pb-1", isPositive ? "text-green-500" : "text-red-500")}>
                {isPositive ? '+' : ''}{market.change24h.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Vol 24h</p>
            <p className="text-sm font-black text-gray-900">{formatTokenAmount(market.volume24h)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Mejor ask</p>
            <p className="text-lg font-black text-gray-900">{formatTokenPrice(market.bestAsk)}</p>
          </div>
          <div className="rounded-2xl bg-green-500/10 border border-green-500/20 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-green-500">Mejor bid</p>
            <p className="text-lg font-black text-gray-900">{formatTokenPrice(market.bestBid)}</p>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-black text-gray-900">Precio</h3>
          <div className="flex bg-gray-100 p-1 rounded-full">
            {(['24h', '7d', '30d'] as const).map(label => (
              <button
                key={label}
                onClick={() => setTimeframe(label)}
                className={cn("px-3 py-1 rounded-full text-[11px] font-black", timeframe === label ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <PriceSparkline points={market.history[timeframe]} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3 p-4 border-b border-gray-100">
        <div className="rounded-2xl border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-gray-900">Comprar</h3>
            <span className="text-[11px] font-bold text-gray-400">Ask {formatTokenPrice(market.bestAsk)}</span>
          </div>
          <input
            type="number"
            min="0"
            value={buyAmount}
            onChange={e => onBuyAmountChange(Math.max(0, Number(e.target.value) || 0))}
            className="w-full h-11 rounded-xl bg-gray-50 border border-gray-100 px-3 text-gray-900 font-bold outline-none focus:border-pink-500"
          />
          <p className="text-xs text-gray-500 font-bold mt-2">Total estimado: <span className="text-gray-900">{formatTokenPrice(buyTotal)}</span></p>
          <button disabled={!canBuy} onClick={() => onConfirm('buy')} className="w-full mt-3 h-11 rounded-xl bg-gray-900 text-white font-black active:scale-[0.98] transition disabled:opacity-40">
            Comprar al mercado
          </button>
        </div>
        <div className="rounded-2xl border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-gray-900">Vender</h3>
            <span className="text-[11px] font-bold text-gray-400">{hasBid ? `Bid ${formatTokenPrice(market.bestBid)}` : 'Sin bid'}</span>
          </div>
          <input
            type="number"
            min="0"
            value={sellAmount}
            onChange={e => onSellAmountChange(Math.max(0, Number(e.target.value) || 0))}
            className="w-full h-11 rounded-xl bg-gray-50 border border-gray-100 px-3 text-gray-900 font-bold outline-none focus:border-pink-500"
          />
          <p className="text-xs text-gray-500 font-bold mt-2">
            {hasBid ? <>Recibirias: <span className="text-gray-900">{formatTokenPrice(sellTotal)}</span></> : 'Quedara como oferta abierta'}
          </p>
          <button disabled={!canSell} onClick={() => onConfirm('sell')} className="w-full mt-3 h-11 rounded-xl bg-pink-500 text-white font-black active:scale-[0.98] transition disabled:opacity-40">
            Vender al mercado
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
        <div>
          <h3 className="text-sm font-black text-gray-900 mb-2">Libro de ordenes</h3>
          <div className="space-y-1">
            {market.asks.slice(0, 8).map((order, i) => (
              <div key={`ask-${i}`} className="grid grid-cols-2 text-xs font-bold bg-red-500/5 rounded-lg px-2 py-1.5">
                <span className="text-red-500">{formatTokenPrice(order.price)}</span>
                <span className="text-right text-gray-500">{formatTokenAmount(order.amount)}</span>
              </div>
            ))}
            {market.bids.slice(0, 8).map((order, i) => (
              <div key={`bid-${i}`} className="grid grid-cols-2 text-xs font-bold bg-green-500/5 rounded-lg px-2 py-1.5">
                <span className="text-green-500">{formatTokenPrice(order.price)}</span>
                <span className="text-right text-gray-500">{formatTokenAmount(order.amount)}</span>
              </div>
            ))}
            {openSellOffers.map((order, i) => (
              <div key={`open-sell-${i}`} className="grid grid-cols-2 text-xs font-bold bg-gray-100 rounded-lg px-2 py-1.5">
                <span className="text-gray-900">Oferta {formatTokenPrice(order.price)}</span>
                <span className="text-right text-gray-500">{formatTokenAmount(order.amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-black text-gray-900 mb-2">Trades</h3>
          <div className="space-y-1">
            {market.trades.slice(0, 15).map(trade => (
              <div key={trade.id} className="grid grid-cols-[1fr_0.8fr_1fr] gap-2 text-xs font-bold rounded-lg bg-gray-50 px-2 py-1.5">
                <span className="text-gray-900">{formatTokenPrice(trade.price)}</span>
                <span className="text-gray-500 text-right">{formatTokenAmount(trade.amount)}</span>
                <span className="text-gray-400 text-right">{formatAgo(trade.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TokenPriceStrip({ market }: { market: TokenMarket }) {
  const isPositive = market.change24h >= 0;

  return (
    <div className="sticky top-0 z-30 mx-4 mb-4 rounded-2xl border border-gray-100 bg-white/95 backdrop-blur-md shadow-sm p-3 lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">{market.symbol} Token</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-black text-gray-900 leading-none">{formatTokenPrice(market.lastPrice)}</span>
            <span className={cn("text-xs font-black pb-0.5", isPositive ? "text-green-500" : "text-red-500")}>
              {isPositive ? '+' : ''}{market.change24h.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right shrink-0">
          <div>
            <p className="text-[9px] font-black uppercase text-red-500">Ask</p>
            <p className="text-xs font-black text-gray-900">{formatTokenPrice(market.bestAsk)}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-green-500">Bid</p>
            <p className="text-xs font-black text-gray-900">{formatTokenPrice(market.bestBid)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileView({ profile, slots, stories = [], isOwnerPreview, profileId, currentUser, onDivide, onJoin, onBack }: { profile: CreatorProfile, slots: AdSpace[], stories?: Story[], isOwnerPreview: boolean, profileId?: string | null, currentUser?: FirebaseUser | null, onDivide?: (id: string) => void, onJoin?: (id: string) => void, onBack?: () => void }) {
  const [selectedSlot, setSelectedSlot] = useState<AdSpace | null>(null);
  const [viewingTenantSlot, setViewingTenantSlot] = useState<AdSpace | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<number>(7);
  
  type TransactionType = {
     id: string;
     slotId: string;
     buyerId: string;
     brand: string;
     price: number;
     duration: number;
     createdAt: number;
  };
  const [transactions, setTransactions] = useState<TransactionType[]>([]);
  const [showTransactionsModal, setShowTransactionsModal] = useState(false);
  const [buyTokenAmount, setBuyTokenAmount] = useState(10);
  const [sellTokenAmount, setSellTokenAmount] = useState(5);
  const [confirmMarketAction, setConfirmMarketAction] = useState<'buy' | 'sell' | null>(null);
  const [openSellOffers, setOpenSellOffers] = useState<MarketOrder[]>([]);

  // Connections state
  const [connections, setConnections] = useState<Connection[]>([]);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Stories state
  const [isUploadingStory, setIsUploadingStory] = useState(false);
  const [storyImage, setStoryImage] = useState('');
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);

  const scanTriggeredRef = useRef(false);
  const txsCountRef = useRef<number | undefined>(undefined);

  useLockBodyScroll(!!selectedSlot || !!viewingTenantSlot || showTransactionsModal || showContactsModal || showCancelConfirm || !!confirmMarketAction || isUploadingStory || selectedStoryIndex !== null);

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
     } catch (e: any) { alert(e.message); }
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
    } catch (e: any) { alert(e.message); }
  }

  const handleCancelContact = async () => {
    if (!contactStatus) return;
    try {
      await deleteDoc(doc(db, 'connections', contactStatus.id));
    } catch (e: any) { alert(e.message); }
  }

  // Rent state
  const [rentImage, setRentImage] = useState('');
  const [rentBrand, setRentBrand] = useState('');
  const [rentBrandImg, setRentBrandImg] = useState('');
  const [rentCaption, setRentCaption] = useState('');

  const handleRent = async () => {
      if (!selectedSlot || !profileId) return;
      if (isOwnerPreview || currentUser?.uid === profileId) { alert("El dueño del perfil no puede alquilar/publicar espacios en su propio perfil."); return; }
      if (!rentImage.trim() || !rentBrand.trim()) { alert("Sube tu anuncio y pon el nombre de tu marca."); return; }
      
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
             const batch = writeBatch(db);
             batch.update(doc(db, `creatorProfiles/${profileId}/adSpaces`, selectedSlot.id), {
                 isRented: true,
                 rentedBy: currentUser?.uid || 'anonymous',
                 brand: rentBrand,
                 brandImg: rentBrandImg || currentUser?.photoURL || 'https://i.pravatar.cc/150?u=' + currentUser?.uid,
                 image: rentImage,
                 caption: rentCaption || `¡Espacio patrocinado por ${selectedDuration} días!`,
                 pricePaid: price,
                 rentStart: Date.now(),
                 rentEnd: Date.now() + selectedDuration * 24 * 60 * 60 * 1000,
                 forResale: deleteField(),
                 resalePrices: deleteField()
             });
             
             const sellerId = selectedSlot.forResale ? selectedSlot.rentedBy : profileId;
             
             batch.set(doc(collection(db, `creatorProfiles/${profileId}/transactions`)), {
                 slotId: selectedSlot.id,
                 buyerId: currentUser?.uid || 'anonymous',
                 sellerId: sellerId,
                 brand: rentBrand,
                 price: price,
                 duration: selectedDuration,
                 createdAt: Date.now()
             });
             
             if (sellerId) {
                batch.update(doc(db, `creatorProfiles/${sellerId}`), {
                    totalSales: increment(price),
                    walletBalance: increment(price)
                });
             }

             const notifRef = doc(collection(db, `users/${sellerId}/notifications`));
             batch.set(notifRef, {
                 type: 'sale',
                 message: `¡Nueva venta! ${rentBrand} ha comprado un espacio VIP.`,
                 fromId: currentUser?.uid || 'anonymous',
                 read: false,
                 createdAt: Date.now(),
                 link: `/vip/${profile?.username}`
             });

             await batch.commit();

             setSelectedSlot(null);
             setRentImage('');
             setRentBrand('');
             setRentBrandImg('');
             setRentCaption('');
             alert("¡Pago simulado con éxito!");
      } catch(e: any) { alert(e.message); }
      setIsProcessing(false);
  };

  const handlePublishStory = async (media: { url: string, type: 'image'|'video' }, overlays: StoryOverlay[], filter: string, clipStart: number, clipDuration: number) => {
      if (!profileId || !currentUser || !media.url.trim()) return;
      const isOwnerProfile = currentUser.uid === profileId;
      
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentStoriesFromUser = stories?.filter(s => s.rentedBy === currentUser.uid && s.createdAt > oneDayAgo) || [];
      if (!isOwnerProfile && recentStoriesFromUser.length >= 1) {
          alert('Solo puedes publicar 1 historia al día como inquilino VIP.');
          return;
      }

      setIsProcessing(true);
      try {
          const newStory: Story = {
              id: `story-${Date.now()}`,
              image: media.url,
              mediaType: media.type,
              overlays: JSON.stringify(overlays),
              filter: filter,
              clipStart: clipStart,
              clipDuration: clipDuration,
              brand: currentUser.displayName || 'Marca',
              brandImg: currentUser.photoURL || `https://i.pravatar.cc/150?u=${currentUser.uid}`,
              rentedBy: currentUser.uid,
              createdAt: Date.now()
          };
          await setDoc(doc(db, `creatorProfiles/${profileId}/stories`, newStory.id), newStory);
          setIsUploadingStory(false);
          setStoryImage('');
          alert('¡Historia publicada exitosamente!');
      } catch(e: any) { alert(e.message); }
      setIsProcessing(false);
  };

  const isTenant = currentUser && slots.some(s => s.isRented && s.rentedBy === currentUser.uid);
  const isOwnerProfile = !!currentUser && currentUser.uid === profileId;
  const canUploadStory = isOwnerProfile || (!!isTenant && !isOwnerPreview && currentUser?.uid !== profileId);
  const tokenMarket = useMemo(() => buildTokenMarket(profile, transactions, slots), [profile, transactions, slots]);
  const marketActionAmount = confirmMarketAction === 'buy' ? buyTokenAmount : sellTokenAmount;
  const marketActionPrice = confirmMarketAction === 'buy' ? tokenMarket.bestAsk : (tokenMarket.bestBid || tokenMarket.lastPrice);
  const marketActionTotal = marketActionAmount * marketActionPrice;
  const executeMarketAction = () => {
    if (!confirmMarketAction) return;
    if (marketActionAmount <= 0) {
      alert('Introduce una cantidad mayor que cero.');
      return;
    }
    const side = confirmMarketAction === 'buy' ? 'Compra' : 'Venta';
    const hasBid = tokenMarket.bids.length > 0 && tokenMarket.bestBid > 0;
    if (confirmMarketAction === 'sell' && !hasBid) {
      setOpenSellOffers(current => [
        { price: tokenMarket.lastPrice, amount: marketActionAmount },
        ...current
      ].slice(0, 5));
    }
    const fallbackText = confirmMarketAction === 'sell' && !hasBid ? 'No hay bid disponible; queda como oferta abierta.' : `${side} ejecutada al mercado.`;
    alert(fallbackText);
    setConfirmMarketAction(null);
  };

  return (
    <>
        <div className="w-full h-[90px] bg-gray-100 relative overflow-hidden shrink-0">
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
              <img src={profile.photoURL} alt={profile.displayName} className="w-[80px] h-[80px] rounded-full border-[4px] border-white object-cover bg-white shadow-[0_10px_25px_rgba(0,0,0,0.1)] relative z-10" />
           </div>
           <div className="text-center mt-3">
              <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none mb-1">{profile.displayName.replace(/^ZonaVip\s+/i, '')}</h1>
              <div className="flex items-center justify-center gap-1.5 mt-1.5">
                <div className="bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">Verificado</div>
              </div>
           </div>
        </div>

        <TokenPriceStrip market={tokenMarket} />

        <div className="lg:hidden">
          <TokenMarketPanel
            market={tokenMarket}
            openSellOffers={openSellOffers}
            buyAmount={buyTokenAmount}
            sellAmount={sellTokenAmount}
            onBuyAmountChange={setBuyTokenAmount}
            onSellAmountChange={setSellTokenAmount}
            onConfirm={setConfirmMarketAction}
          />
        </div>

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

        <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-5 lg:px-5 lg:pb-8">
          <div className="lg:col-span-7 xl:col-span-8 lg:min-w-0">
        {/* Stories Section */}
        {((stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }]).length > 0 || canUploadStory) && (
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
          <aside className="hidden lg:block lg:col-span-5 xl:col-span-4 lg:sticky lg:top-5 lg:min-w-0">
            <TokenMarketPanel
              market={tokenMarket}
              openSellOffers={openSellOffers}
              buyAmount={buyTokenAmount}
              sellAmount={sellTokenAmount}
              onBuyAmountChange={setBuyTokenAmount}
              onSellAmountChange={setSellTokenAmount}
              onConfirm={setConfirmMarketAction}
            />
          </aside>
        </div>

        <AnimatePresence>
            {selectedSlot && (
              <React.Fragment key="selected-slot">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedSlot(null)} className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} className="fixed bottom-0 w-full max-w-[500px] bg-white rounded-t-[32px] z-50 shadow-2xl h-[85vh] overflow-hidden flex flex-col"><div className="flex-1 overflow-y-auto p-6 pb-16">
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
                  stories={(stories.length > 0 ? stories : [{ id: 'demo-1', brand: 'Nike', brandImg: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1552066344-2464c1135c32?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-2', brand: 'Spotify', brandImg: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1614680376573-3e4e120f14f5?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }, { id: 'demo-3', brand: 'Netflix', brandImg: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=150&h=150&q=80', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80', rentedBy: 'demo', createdAt: Date.now() }])}
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
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 m-auto w-[90%] max-w-[400px] h-fit bg-white rounded-3xl p-6 z-[100] shadow-2xl flex flex-col items-center">
                    {viewingTenantSlot.image && (
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
                    )}
                    <button onClick={() => setViewingTenantSlot(null)} className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold rounded-2xl transition active:scale-95">Cerrar</button>
                </motion.div>
              </React.Fragment>
            )}
        </AnimatePresence>
    </>
  );
}
