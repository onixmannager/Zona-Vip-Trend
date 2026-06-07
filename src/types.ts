export type SizePrices = { price1: number; price7: number; price30: number; price365: number; };

export type Notification = {
  id: string;
  type: 'contact_request' | 'sale' | 'token_mint' | 'general';
  message: string;
  fromId: string;
  read: boolean;
  createdAt: number;
  link?: string;
};

export type ProfileCard = {
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

export type ProfileLink = {
  title: string;
  url: string;
};

export type CreatorProfile = {
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
  profileBio?: string;
  profileLinks?: ProfileLink[];
  createdAt: any;
  updatedAt: any;
};

export type AdSpace = {
  id: string;
  width: number;
  order: number;
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
  resalePrices?: SizePrices;
  link?: string;
};

export type StoryOverlay = {
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

export type Story = {
  id: string;
  image: string;
  mediaType?: 'image' | 'video';
  overlays?: string;
  filter?: string;
  clipStart?: number;
  clipDuration?: number;
  brand: string;
  brandImg: string;
  rentedBy: string;
  createdAt: number;
  cloudinaryPublicId?: string;
};

export type Connection = {
  id: string;
  users: string[];
  status: 'pending' | 'accepted';
  initiator: string;
  createdAt: number;
};

export type TransactionType = {
  id: string;
  slotId: string;
  buyerId: string;
  brand: string;
  price: number;
  tokensMinted?: number;
  duration: number;
  createdAt: number;
};
