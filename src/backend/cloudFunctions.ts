import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// In a real environment, read from Firebase Config or Secret Manager
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_...';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_...';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16' as any // Use an appropriate api version
});

// Make sure firebase admin is initialized in your index.ts before deploying
// admin.initializeApp();

/**
 * 🚀 Cloud Function: aggregateUserMetrics
 * 
 * Scheduled function to calculate gamification metrics, update wallet total earnings,
 * and calculate occupancy rate across all active users.
 * 
 * Recommended invocation: Every hour (0 * * * *)
 */
export const aggregateUserMetrics = functions.pubsub.schedule('every 1 hours').onRun(async (context) => {
    const db = admin.firestore();
    
    // 1. Fetch all zones
    const zonesSnapshot = await db.collection('zones').get();
    
    // Group zones by owner
    const userZones: Record<string, admin.firestore.DocumentData[]> = {};
    zonesSnapshot.forEach(doc => {
        const zone = doc.data();
        if (!userZones[zone.ownerId]) userZones[zone.ownerId] = [];
        userZones[zone.ownerId].push(zone);
    });

    // 2. Process metrics per user
    const batch = db.batch();
    const metricsCollectionInfo = [];

    for (const ownerId of Object.keys(userZones)) {
        const myZones = userZones[ownerId];
        
        let totalEarnings = 0;
        let rentedCount = 0;
        let activeCount = 0;

        myZones.forEach(zone => {
            totalEarnings += (zone.totalEarnings || 0);
            if (zone.status !== 'inactive') {
                activeCount++;
                if (zone.status === 'rented') rentedCount++;
            }
            
            // Detect smart alerts
            if (zone.status === 'available' && (zone.totalEarnings || 0) === 0) {
                // Generate an alert or suggestion
                // (In a real app, write this alert to a subcollection user/{id}/alerts)
            }
        });

        // 3. Update wallet with total metrics (aggregated source of truth)
        const walletRef = db.collection('wallets').doc(ownerId);
        batch.update(walletRef, {
            totalEarnings: totalEarnings, // Updates the history for gamification
            lastMetricsUpdate: admin.firestore.FieldValue.serverTimestamp()
        });
        
        metricsCollectionInfo.push({ ownerId, totalEarnings, activeCount, rentedCount });
    }

    // Commit state
    try {
        await batch.commit();
        console.log(`Successfully aggregated metrics for ${metricsCollectionInfo.length} users.`);
    } catch (err) {
        console.error('Failed to commit aggregated metrics batch:', err);
    }
});


/**
 * 🚀 Cloud Function: suggestPriceOptimization
 * 
 * Triggered daily to analyze each zone's performance compared to market average.
 */
export const suggestPriceOptimization = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    // Logic: Look for zones with 0 rentals but active for 7+ days
    // -> generate Notification -> suggest price decrease
    
    // Logic: Look for zones with 100% occupancy
    // -> generate Notification -> suggest price increase
    console.log("Price optimization scan complete.");
});

/**
 * 🚀 Cloud Function: trackView
 * Prevent abusives refreshes by storing IP or relying on callable function constraints
 * In this demo, we use a Callable function which allows tracking requests and rate-limiting
 */
export const trackView = functions.https.onCall(async (data, context) => {
    const { workspaceId } = data;
    if (!workspaceId) throw new functions.https.HttpsError('invalid-argument', 'Missing workspaceId');
    
    // In a real prod environment, check limits using IP from context.rawRequest.ip
    
    const db = admin.firestore();
    const workspaceRef = db.collection('workspaces').doc(workspaceId);
    
    try {
        await workspaceRef.update({
            views: admin.firestore.FieldValue.increment(1)
        });
        return { success: true };
    } catch (err) {
        // Handle case where workspace doesn't exist
        console.error("View tracking error:", err);
        return { success: false };
    }
});

/**
 * 🚀 Cloud Function: trackClick
 * Track clicks on zones.
 */
export const trackClick = functions.https.onCall(async (data, context) => {
    const { zoneId } = data;
    if (!zoneId) throw new functions.https.HttpsError('invalid-argument', 'Missing zoneId');
    
    const db = admin.firestore();
    const zoneRef = db.collection('zones').doc(zoneId);
    
    try {
        await zoneRef.update({
            clicks: admin.firestore.FieldValue.increment(1)
        });
        return { success: true };
    } catch (err) {
        console.error("Click tracking error:", err);
        return { success: false };
    }
});

/**
 * 🚀 Cloud Function: createStripeCheckoutSession
 * Create a Stripe Checkout session to add funds to a user's internal wallet.
 */
export const createStripeCheckoutSession = functions.https.onCall(async (data, context) => {
    // 1. Verify Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    
    const uid = context.auth.uid;
    const { amount } = data; // Ensure amount is in cents, or convert here
    
    // 2. Validate amount (e.g. minimum 500 cents = $5.00)
    if (!amount || typeof amount !== 'number' || amount < 500) {
        throw new functions.https.HttpsError('invalid-argument', 'Amount must be a number and at least 500 cents.');
    }

    try {
        // 3. Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: 'usd', // or eur
                    product_data: {
                        name: 'Añadir fondos a la Wallet',
                        description: 'Saldo para alquilar slots en el marketplace',
                    },
                    unit_amount: amount, // amount in cents
                },
                quantity: 1,
            }],
            success_url: `https://tusitio.com/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `https://tusitio.com/dashboard?payment=cancelled`,
            // Pass the user ID so the webhook knows who to credit
            client_reference_id: uid, 
        });

        return { id: session.id, url: session.url };
    } catch (error: any) {
        console.error('Error creating Stripe session:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * 🚀 Cloud Function: stripeWebhook
 * Listen to Stripe Webhooks securely, verify signature, and update wallet.
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
    const rawBody = req.rawBody; // Needed for Stripe signature verification
    const signature = req.headers['stripe-signature'] as string;

    let event: Stripe.Event;

    // 1. Verify Signature
    try {
        if (!rawBody) throw new Error("Missing raw body");
        event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
        console.error(`⚠️ Webhook signature verification failed:`, err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // 2. Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        
        // Ensure payment is actually collected
        if (session.payment_status === 'paid' && userId) {
            const amountTotal = session.amount_total; // Amount in cents
            if (amountTotal && amountTotal > 0) {
                const db = admin.firestore();
                
                try {
                    await db.runTransaction(async (transaction) => {
                        const walletRef = db.collection('wallets').doc(userId);
                        const walletDoc = await transaction.get(walletRef);
                        
                        // Increment balance (convert cents to dollars or keep cents depending on your choice)
                        // Assuming frontend uses dollars/euros:
                        const amountInFiat = amountTotal / 100;

                        if (!walletDoc.exists) {
                            transaction.set(walletRef, {
                                ownerId: userId,
                                balance: amountInFiat,
                                pendingBalance: 0,
                                totalEarnings: 0,
                                totalSpent: 0
                            });
                        } else {
                            transaction.update(walletRef, {
                                balance: admin.firestore.FieldValue.increment(amountInFiat)
                            });
                        }
                        
                        // Register transaction for history
                        const txRef = db.collection('transactions').doc();
                        transaction.set(txRef, {
                            type: 'deposit',
                            amount: amountInFiat,
                            buyerId: userId,
                            status: 'completed',
                            stripeSessionId: session.id,
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    });
                    console.log(`✅ Successfully funded wallet for user ${userId} with ${amountTotal} cents.`);
                } catch (txErr) {
                    console.error('❌ Firestore transaction failed in webhook:', txErr);
                }
            }
        }
    }

    res.json({ received: true });
});

/**
 * 🚀 Cloud Function: requestManualPayout
 * Escrow funds and create a manual payout request.
 */
export const requestManualPayout = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    
    const uid = context.auth.uid;
    const { amount, paymentMethod, paymentDetails } = data;

    if (!amount || typeof amount !== 'number' || amount < 20) {
        throw new functions.https.HttpsError('invalid-argument', 'El retiro mínimo es de 20.');
    }
    if (!paymentMethod || !['bizum', 'iban'].includes(paymentMethod)) {
        throw new functions.https.HttpsError('invalid-argument', 'Método de pago inválido.');
    }
    if (!paymentDetails || typeof paymentDetails !== 'string' || paymentDetails.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'Detalles de pago inválidos.');
    }

    const db = admin.firestore();

    try {
        await db.runTransaction(async (transaction) => {
            // 1. Check if user already has a pending request
            const existingRequestsQuery = await transaction.get(
                db.collection('payoutRequests').where('userId', '==', uid).where('status', '==', 'pending')
            );
            if (!existingRequestsQuery.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Ya tienes un retiro pendiente.');
            }

            // 2. Safely get wallet & lock
            const walletRef = db.collection('wallets').doc(uid);
            const walletDoc = await transaction.get(walletRef);

            if (!walletDoc.exists) {
                throw new functions.https.HttpsError('failed-precondition', 'Wallet not found.');
            }

            const currentBalance = walletDoc.data()?.balance || 0;
            if (currentBalance < amount) {
                throw new functions.https.HttpsError('failed-precondition', 'Saldo insuficiente.');
            }

            // 3. Move funds
            transaction.update(walletRef, {
                balance: admin.firestore.FieldValue.increment(-amount),
                pendingBalance: admin.firestore.FieldValue.increment(amount)
            });

            // 4. Create request
            const requestRef = db.collection('payoutRequests').doc();
            transaction.set(requestRef, {
                userId: uid,
                amount: amount,
                paymentMethod,
                paymentDetails,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                processedAt: null
            });
        });
        
        // Mock sending Resend Email: "Solicitud recibida"
        console.log(`[Email sent: Payout Request created for $${amount} to ${uid}]`);
        return { success: true };
    } catch (error: any) {
        console.error('Error requesting payout:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Error interno');
    }
});

/**
 * 🚀 Cloud Function: adminUpdatePayoutStatus
 * Admin approves/rejects/pays payouts.
 */
export const adminUpdatePayoutStatus = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    
    // In a real app, verify admin role!
    // const adminDoc = await admin.firestore().collection('admins').doc(context.auth.uid).get();
    // if (!adminDoc.exists) throw new functions.https.HttpsError('permission-denied', 'Admins only.');

    const { payoutId, newStatus } = data; // 'approved', 'rejected', 'paid'
    if (!payoutId || !['approved', 'rejected', 'paid'].includes(newStatus)) {
        throw new functions.https.HttpsError('invalid-argument', 'Argumentos inválidos.');
    }

    const db = admin.firestore();

    try {
        await db.runTransaction(async (transaction) => {
            const payoutRef = db.collection('payoutRequests').doc(payoutId);
            const payoutDoc = await transaction.get(payoutRef);

            if (!payoutDoc.exists) throw new functions.https.HttpsError('not-found', 'Payout request not found.');
            const payoutData = payoutDoc.data()!;
            
            if (payoutData.status === 'paid' || payoutData.status === 'rejected') {
                throw new functions.https.HttpsError('failed-precondition', 'Cannot update a closed payout.');
            }

            const walletRef = db.collection('wallets').doc(payoutData.userId);

            if (newStatus === 'rejected') {
                // Return funds to balance, subtract from pending
                transaction.update(walletRef, {
                    balance: admin.firestore.FieldValue.increment(payoutData.amount),
                    pendingBalance: admin.firestore.FieldValue.increment(-payoutData.amount)
                });
            } else if (newStatus === 'paid' && payoutData.status !== 'paid') {
                // Remove from pending
                transaction.update(walletRef, {
                    pendingBalance: admin.firestore.FieldValue.increment(-payoutData.amount)
                });
            }

            // Update status
            transaction.update(payoutRef, {
                status: newStatus,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        // Mock sending Resend Email based on status changes
        console.log(`[Email sent: Payout ${payoutId} changed status to ${newStatus}]`);
        return { success: true };
    } catch (error: any) {
        console.error('Error updating payout:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Error interno');
    }
});

/**
 * 🚀 Cloud Function: deleteExpiredStories
 *
 * Scheduled every hour. Finds all stories older than 24 hours and:
 *  1. Deletes the asset from Cloudinary (if cloudinaryPublicId is present).
 *  2. Deletes the asset from Mux (if muxAssetId is present).
 *  3. Deletes the Firestore document.
 *
 * Requires the following environment variables to be set in Firebase config / Secret Manager:
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET
 */
export const deleteExpiredStories = functions.pubsub.schedule('every 1 hours').onRun(async (_context) => {
    const db = admin.firestore();

    const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
    const CLOUDINARY_API_KEY    = process.env.CLOUDINARY_API_KEY    || '';
    const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
    const MUX_TOKEN_ID          = process.env.MUX_TOKEN_ID          || '';
    const MUX_TOKEN_SECRET      = process.env.MUX_TOKEN_SECRET      || '';

    const hasCloudinaryConfig = !!CLOUDINARY_CLOUD_NAME && !!CLOUDINARY_API_KEY && !!CLOUDINARY_API_SECRET;
    const hasMuxConfig        = !!MUX_TOKEN_ID && !!MUX_TOKEN_SECRET;

    // Lazy-load Mux only if configured
    let mux: any = null;
    if (hasMuxConfig) {
        const MuxModule = await import('@mux/mux-node');
        const Mux = MuxModule.default;
        mux = new Mux({ tokenId: MUX_TOKEN_ID, tokenSecret: MUX_TOKEN_SECRET });
    }

    const cutoffMs  = Date.now() - 24 * 60 * 60 * 1000; // 24 horas atrás

    // Fetch all creatorProfiles to iterate their stories subcollections
    const profilesSnap = await db.collection('creatorProfiles').get();
    let deleted = 0;
    let errors  = 0;

    for (const profileDoc of profilesSnap.docs) {
        const storiesSnap = await db
            .collection(`creatorProfiles/${profileDoc.id}/stories`)
            .where('createdAt', '<=', cutoffMs)
            .get();

        for (const storyDoc of storiesSnap.docs) {
            const story = storyDoc.data();

            // 1. Delete from Cloudinary
            if (hasCloudinaryConfig && story.cloudinaryPublicId) {
                try {
                    const resourceType = story.mediaType === 'video' ? 'video' : 'image';
                    const credentials  = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64');
                    const cloudinaryRes = await fetch(
                        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/upload/${story.cloudinaryPublicId}`,
                        { method: 'DELETE', headers: { Authorization: `Basic ${credentials}` } }
                    );
                    if (!cloudinaryRes.ok) {
                        const errBody = await cloudinaryRes.json().catch(() => ({}));
                        console.warn(`Cloudinary delete warning for ${story.cloudinaryPublicId}:`, errBody);
                    }
                } catch (err) {
                    console.error(`Error deleting Cloudinary asset ${story.cloudinaryPublicId}:`, err);
                    errors++;
                }
            }

            // 2. Delete from Mux
            if (mux && story.muxAssetId) {
                try {
                    await mux.video.assets.delete(story.muxAssetId);
                } catch (err) {
                    console.error(`Error deleting Mux asset ${story.muxAssetId}:`, err);
                    errors++;
                }
            }

            // 3. Delete Firestore document
            try {
                await storyDoc.ref.delete();
                deleted++;
            } catch (err) {
                console.error(`Error deleting story doc ${storyDoc.id}:`, err);
                errors++;
            }
        }
    }

    console.log(`deleteExpiredStories: ${deleted} stories deleted, ${errors} errors.`);
});

/**
 * 🚀 Cloud Function: executeTokenTrade
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
                transaction.get(buyerProfileRef)
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
                creatorId, buyerId, sellerId, price: matchOrder.price, amount: fillAmount, symbol, createdAt: now
            });

            transaction.set(db.collection(`users/${matchOrder.userId}/notifications`).doc(), {
                type: 'token_mint',
                message: `Tu orden de ${matchOrder.side === 'sell' ? 'venta' : 'compra'} de ${fillAmount.toFixed(2)} ${symbol} tokens ha sido ejecutada a ${matchOrder.price.toFixed(2)} euros.`,
                fromId: userId,
                read: false,
                createdAt: now
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
        creatorId, side, price, amount, symbol, userId, status: 'open', createdAt: now
    });

    return {
        filled: false,
        message: side === 'buy'
            ? `Oferta de compra por ${amount} ${symbol} publicada en el order book.`
            : `Oferta de venta por ${amount} ${symbol} publicada en el order book.`
    };
});
