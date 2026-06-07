import { useEffect, useState } from 'react';
import type { AdSpace, CreatorProfile } from '../types';
import { cn } from '../lib/cn';

export type MarketOrder = {
  price: number;
  amount: number;
};

type MarketTrade = {
  id: string;
  price: number;
  amount: number;
  createdAt: number;
};

export type TokenMarket = {
  symbol: string;
  creatorId: string;
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

export const formatTokenPrice = (value: number) => `$${value.toFixed(2)}`;
export const formatTokenAmount = (value: number) => value.toLocaleString('es-ES', { maximumFractionDigits: 2 });

const formatAgo = (timestamp: number) => {
  const diff = Math.max(1, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${Math.floor(hours / 24)}d`;
};

export type RealTokenOrder = { id: string; side: 'buy' | 'sell'; price: number; amount: number; userId: string };
export type TokenOrderType = 'market' | 'limit';

export function buildTokenMarket(profile: CreatorProfile, transactions: { id: string; price: number; createdAt: number; duration?: number; tokensMinted?: number }[], slots: AdSpace[], creatorId?: string, realOrders?: RealTokenOrder[]): TokenMarket {
  const basePrice = Math.max(
    1,
    transactions[0]?.price ||
      profile.prices25?.price1 ||
      profile.prices50?.price1 ||
      profile.prices100?.price1 ||
      5
  );
  const symbol = (profile.username || profile.displayName || 'VIP').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'VIP';

  const asks = (realOrders || [])
    .filter(o => o.side === 'sell')
    .map(o => ({ price: Number(o.price.toFixed(2)), amount: Number(o.amount.toFixed(2)) }))
    .sort((a, b) => a.price - b.price);
  const bids = (realOrders || [])
    .filter(o => o.side === 'buy')
    .map(o => ({ price: Number(o.price.toFixed(2)), amount: Number(o.amount.toFixed(2)) }))
    .sort((a, b) => b.price - a.price);

  const bestAsk = asks.length > 0 ? asks[0].price : Number((basePrice * 1.025).toFixed(2));
  const bestBid = bids.length > 0 ? bids[0].price : Number((basePrice * 0.975).toFixed(2));

  const trades = transactions
    .slice(0, 15)
    .map((tx, i) => ({
      id: tx.id,
      price: Number((tx.price || basePrice).toFixed(2)),
      amount: Number((tx.tokensMinted ?? Math.max(1, (tx.duration || 7) / 2)).toFixed(2)),
      createdAt: tx.createdAt || Date.now() - i * 18 * 60000
    }));
  const previous = trades[trades.length - 1]?.price || basePrice * 0.96;
  const lastPrice = trades[0]?.price || basePrice;
  const change24h = previous ? ((lastPrice - previous) / previous) * 100 : 0;
  const volume24h = trades
    .filter(t => Date.now() - t.createdAt < 24 * 60 * 60 * 1000)
    .reduce((sum, t) => sum + t.amount, 0);
  const makeHistory = (points: number) => {
    const realPrices = trades.slice(0, points).map(t => t.price).reverse();
    const filler = realPrices[0] || lastPrice;
    return Array.from({ length: points }, (_, i) => realPrices[i - (points - realPrices.length)] ?? filler);
  };

  return {
    symbol,
    creatorId: creatorId || '',
    lastPrice,
    bestAsk,
    bestBid,
    change24h,
    volume24h,
    asks,
    bids,
    trades,
    history: {
      '24h': makeHistory(24),
      '7d': makeHistory(28),
      '30d': makeHistory(30)
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

export function TokenMarketPanel({
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
  onConfirm: (side: 'buy' | 'sell', orderType: TokenOrderType, price: number) => void;
}) {
  const [timeframe, setTimeframe] = useState<'24h' | '7d' | '30d'>('24h');
  const [buyOrderType, setBuyOrderType] = useState<TokenOrderType>('market');
  const [sellOrderType, setSellOrderType] = useState<TokenOrderType>('market');
  const [buyLimitPrice, setBuyLimitPrice] = useState(market.bestAsk);
  const [sellLimitPrice, setSellLimitPrice] = useState(market.bestBid);
  const isPositive = market.change24h >= 0;
  const hasAsk = market.asks.length > 0 && market.bestAsk > 0;
  const hasBid = market.bids.length > 0 && market.bestBid > 0;
  useEffect(() => {
    setBuyLimitPrice(market.bestAsk);
    setSellLimitPrice(market.bestBid);
  }, [market.creatorId, market.bestAsk, market.bestBid]);
  const buyPrice = buyOrderType === 'market' ? market.bestAsk : buyLimitPrice;
  const sellPrice = sellOrderType === 'market' ? market.bestBid : sellLimitPrice;
  const buyTotal = buyAmount * buyPrice;
  const sellTotal = sellAmount * sellPrice;
  const canBuy = buyAmount > 0 && buyPrice > 0 && (buyOrderType === 'limit' || hasAsk);
  const canSell = sellAmount > 0 && sellPrice > 0 && (sellOrderType === 'limit' || hasBid);

  return (
    <section className="w-full rounded-[24px] border border-gray-100 bg-white shadow-sm overflow-hidden shrink-0">
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
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 mb-2">
            <button onClick={() => setBuyOrderType('market')} className={cn("h-8 rounded-lg text-[11px] font-black", buyOrderType === 'market' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>Mercado</button>
            <button onClick={() => setBuyOrderType('limit')} className={cn("h-8 rounded-lg text-[11px] font-black", buyOrderType === 'limit' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>Límite</button>
          </div>
          <input
            type="number"
            min="0"
            value={buyAmount}
            onChange={e => onBuyAmountChange(Math.max(0, Number(e.target.value) || 0))}
            className="w-full h-11 rounded-xl bg-gray-50 border border-gray-100 px-3 text-gray-900 font-bold outline-none focus:border-pink-500"
          />
          {buyOrderType === 'limit' && (
            <input
              type="number"
              min="0"
              value={buyLimitPrice}
              onChange={e => setBuyLimitPrice(Math.max(0, Number(e.target.value) || 0))}
              className="w-full h-10 rounded-xl bg-gray-50 border border-gray-100 px-3 text-gray-900 font-bold outline-none focus:border-pink-500 mt-2"
            />
          )}
          <p className="text-xs text-gray-500 font-bold mt-2">Total estimado: <span className="text-gray-900">{formatTokenPrice(buyTotal)}</span></p>
          <button disabled={!canBuy} onClick={() => onConfirm('buy', buyOrderType, buyPrice)} className="w-full mt-3 h-11 rounded-xl bg-gray-900 text-white font-black active:scale-[0.98] transition disabled:opacity-40">
            {buyOrderType === 'market' ? 'Comprar a mercado' : 'Publicar compra límite'}
          </button>
        </div>
        <div className="rounded-2xl border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-gray-900">Vender</h3>
            <span className="text-[11px] font-bold text-gray-400">{hasBid ? `Bid ${formatTokenPrice(market.bestBid)}` : 'Sin bid'}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 mb-2">
            <button onClick={() => setSellOrderType('market')} className={cn("h-8 rounded-lg text-[11px] font-black", sellOrderType === 'market' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>Mercado</button>
            <button onClick={() => setSellOrderType('limit')} className={cn("h-8 rounded-lg text-[11px] font-black", sellOrderType === 'limit' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>Límite</button>
          </div>
          <input
            type="number"
            min="0"
            value={sellAmount}
            onChange={e => onSellAmountChange(Math.max(0, Number(e.target.value) || 0))}
            className="w-full h-11 rounded-xl bg-gray-50 border border-gray-100 px-3 text-gray-900 font-bold outline-none focus:border-pink-500"
          />
          {sellOrderType === 'limit' && (
            <input
              type="number"
              min="0"
              value={sellLimitPrice}
              onChange={e => setSellLimitPrice(Math.max(0, Number(e.target.value) || 0))}
              className="w-full h-10 rounded-xl bg-gray-50 border border-gray-100 px-3 text-gray-900 font-bold outline-none focus:border-pink-500 mt-2"
            />
          )}
          <p className="text-xs text-gray-500 font-bold mt-2">
            {sellOrderType === 'market' && !hasBid ? 'Sin bid disponible' : <>Recibirias: <span className="text-gray-900">{formatTokenPrice(sellTotal)}</span></>}
          </p>
          <button disabled={!canSell} onClick={() => onConfirm('sell', sellOrderType, sellPrice)} className="w-full mt-3 h-11 rounded-xl bg-pink-500 text-white font-black active:scale-[0.98] transition disabled:opacity-40">
            {sellOrderType === 'market' ? 'Vender a mercado' : 'Publicar venta límite'}
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

export function TokenPriceStrip({ market, onOpen }: { market: TokenMarket; onOpen: () => void }) {
  const isPositive = market.change24h >= 0;

  return (
    <button onClick={onOpen} className="sticky top-0 z-30 mx-4 mb-4 rounded-2xl border border-gray-100 bg-white/95 backdrop-blur-md shadow-sm p-3 text-left w-[calc(100%-2rem)] transition active:scale-[0.99] lg:static lg:mx-8 lg:mb-8 lg:w-[calc(100%-4rem)] lg:p-5 lg:hover:border-pink-200 lg:hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">{market.symbol} Token</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl lg:text-3xl font-black text-gray-900 leading-none">{formatTokenPrice(market.lastPrice)}</span>
            <span className={cn("text-xs font-black pb-0.5", isPositive ? "text-green-500" : "text-red-500")}>
              {isPositive ? '+' : ''}{market.change24h.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right shrink-0">
          <div>
            <p className="text-[9px] font-black uppercase text-red-500">Ask</p>
            <p className="text-xs lg:text-sm font-black text-gray-900">{formatTokenPrice(market.bestAsk)}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-green-500">Bid</p>
            <p className="text-xs lg:text-sm font-black text-gray-900">{formatTokenPrice(market.bestBid)}</p>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 lg:mt-4">
        <span className="text-[11px] font-black uppercase tracking-wider text-gray-400">Mercado del creador</span>
        <span className="text-xs font-black text-pink-500">Abrir exchange</span>
      </div>
    </button>
  );
}
