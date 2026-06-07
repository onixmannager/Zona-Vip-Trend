import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

admin.initializeApp();

/**
 * Cloud Function: executeTokenTrade
 *
 * Executes a token market order (market or limit) using Admin SDK, bypassing
 * Security Rules to allow cross-user writes (buyer ↔ seller holdings + wallets).
 *
 * Input: { creatorId, side, orderType, price, amount, symbol }
 * Returns: { filled: boolean, message: string }
 */
export const executeTokenTrade = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'El usuario debe estar autenticado.');
    }

    const { creatorId, side, orderType, price, amount, symbol } = data;
    const userId = context.auth.uid;

    if (!creatorId || !side || !orderType || !symbol) {
        throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros requeridos.');
    }
    if (!['buy', 'sell'].includes(side)) {
        throw new functions.https.HttpsError('invalid-argument', 'side debe ser buy o sell.');
    }
    if (!['market', 'limit'].includes(orderType)) {
        throw new functions.https.HttpsError('invalid-argument', 'orderType debe ser market o limit.');
    }
    if (typeof price !== 'number' || price <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'price debe ser un número mayor que 0.');
    }
    if (typeof amount !== 'number' || amount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'amount debe ser un número mayor que 0.');
    }

    const db = admin.firestore();
    const now = Date.now();

    // Find open orders on the opposite side for this creator
    const oppositeSide = side === 'buy' ? 'sell' : 'buy';
    const ordersSnap = await db.collection('tokenOrders')
        .where('creatorId', '==', creatorId)
        .where('side', '==', oppositeSide)
        .where('status', '==', 'open')
        .get();

    const candidateOrders = ordersSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter((o: any) => o.userId !== userId);

    // Best match: cheapest ask for a buy, highest bid for a sell
    const matchOrder: any = side === 'buy'
        ? candidateOrders.filter((o: any) => o.price <= price).sort((a: any, b: any) => a.price - b.price)[0]
        : candidateOrders.filter((o: any) => o.price >= price).sort((a: any, b: any) => b.price - a.price)[0];

    if (matchOrder) {
        const fillAmount = Math.min(matchOrder.amount, amount);

        return await db.runTransaction(async (transaction) => {
            const orderRef = db.collection('tokenOrders').doc(matchOrder.id);
            const orderSnap = await transaction.get(orderRef);
            if (!orderSnap.exists || orderSnap.data()?.status !== 'open') {
                throw new functions.https.HttpsError('failed-precondition', 'La orden ya no está disponible.');
            }

            const buyerId = side === 'buy' ? userId : matchOrder.userId;
            const sellerId = side === 'sell' ? userId : matchOrder.userId;

            const buyerHoldingRef = db.collection('creatorTokenHolders').doc(`${buyerId}_${creatorId}`);
            const sellerHoldingRef = db.collection('creatorTokenHolders').doc(`${sellerId}_${creatorId}`);
            const buyerProfileRef = db.collection('creatorProfiles').doc(buyerId);
            const sellerProfileRef = db.collection('creatorProfiles').doc(sellerId);

            const [buyerHoldingSnap, sellerHoldingSnap, buyerProfileSnap] = await Promise.all([
                transaction.get(buyerHoldingRef),
                transaction.get(sellerHoldingRef),
                transaction.get(buyerProfileRef),
            ]);

            const sellerBalance = sellerHoldingSnap.exists ? sellerHoldingSnap.data()?.balance || 0 : 0;
            if (sellerBalance < fillAmount) {
                throw new functions.https.HttpsError('failed-precondition', 'El vendedor no tiene tokens suficientes.');
            }

            const cost = fillAmount * matchOrder.price;
            const buyerWalletBalance = buyerProfileSnap.exists ? buyerProfileSnap.data()?.walletBalance || 0 : 0;
            if (buyerWalletBalance < cost) {
                throw new functions.https.HttpsError('failed-precondition', 'Saldo insuficiente para ejecutar la compra.');
            }

            const remaining = (orderSnap.data()!.amount as number) - fillAmount;
            if (remaining > 0) {
                transaction.update(orderRef, { amount: remaining, updatedAt: now });
            } else {
                transaction.update(orderRef, { status: 'filled', filledAt: now, filledBy: userId });
            }

            transaction.update(sellerHoldingRef, { balance: admin.firestore.FieldValue.increment(-fillAmount), updatedAt: now });
            if (buyerHoldingSnap.exists) {
                transaction.update(buyerHoldingRef, { balance: admin.firestore.FieldValue.increment(fillAmount), updatedAt: now });
            } else {
                transaction.set(buyerHoldingRef, { userId: buyerId, creatorId, balance: fillAmount, earned: 0, createdAt: now, updatedAt: now });
            }

            transaction.update(buyerProfileRef, { walletBalance: admin.firestore.FieldValue.increment(-cost) });
            transaction.update(sellerProfileRef, { walletBalance: admin.firestore.FieldValue.increment(cost) });

            transaction.set(db.collection('tokenTrades').doc(), {
                creatorId, buyerId, sellerId, price: matchOrder.price, amount: fillAmount, symbol, createdAt: now,
            });

            transaction.set(db.collection(`users/${matchOrder.userId}/notifications`).doc(), {
                type: 'token_mint',
                message: `Tu orden de ${matchOrder.side === 'sell' ? 'venta' : 'compra'} de ${fillAmount.toFixed(2)} ${symbol} tokens ha sido ejecutada a ${matchOrder.price.toFixed(2)} euros.`,
                fromId: userId,
                read: false,
                createdAt: now,
            });

            return { filled: true, message: `Orden ejecutada: ${fillAmount.toFixed(2)} ${symbol} a ${matchOrder.price.toFixed(2)} euros.` };
        });
    }

    if (orderType === 'market') {
        throw new functions.https.HttpsError('failed-precondition', 'No hay liquidez suficiente para ejecutar a mercado.');
    }

    // Limit order: validate balances then place
    if (side === 'sell') {
        const holdingSnap = await db.collection('creatorTokenHolders').doc(`${userId}_${creatorId}`).get();
        const balance = holdingSnap.exists ? holdingSnap.data()?.balance || 0 : 0;
        if (balance < amount) {
            throw new functions.https.HttpsError('failed-precondition', 'No tienes tokens suficientes para vender.');
        }
    }
    if (side === 'buy') {
        const profileSnap = await db.collection('creatorProfiles').doc(userId).get();
        const walletBalance = profileSnap.exists ? profileSnap.data()?.walletBalance || 0 : 0;
        if (walletBalance < amount * price) {
            throw new functions.https.HttpsError('failed-precondition', 'Saldo insuficiente para publicar esta orden de compra.');
        }
    }

    await db.collection('tokenOrders').add({
        creatorId, side, price, amount, symbol, userId, status: 'open', createdAt: now,
    });

    return {
        filled: false,
        message: side === 'buy'
            ? `Oferta de compra por ${amount} ${symbol} publicada en el order book.`
            : `Oferta de venta por ${amount} ${symbol} publicada en el order book.`,
    };
});
