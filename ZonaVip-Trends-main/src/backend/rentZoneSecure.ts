import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

// Initialize the Firebase Admin App if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

const db = admin.firestore();

const PLATFORM_FEE_PERCENTAGE = 0.10; // 10% fee

interface RentZoneRequest {
    zoneId: string;
    durationPeriod: 'day' | 'week' | 'month' | 'year';
}

/**
 * rentZoneWithWallet
 * 
 * Secure Cloud Function to handle renting a digital asset (zone).
 * Prevents double-booking, calculates prices & fees securely on the backend,
 * and atomatically updates the seller/buyer wallets and zone state.
 */
export const rentZoneWithWallet = functions.https.onCall(async (data: RentZoneRequest, context) => {
    // 1. Verify Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const renterId = context.auth.uid;
    const { zoneId, durationPeriod } = data;

    if (!['day', 'week', 'month', 'year'].includes(durationPeriod)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid duration period.');
    }

    try {
        await db.runTransaction(async (transaction) => {
            const zoneRef = db.collection('zones').doc(zoneId);
            const buyerWalletRef = db.collection('wallets').doc(renterId);
            
            // Fetch Zone
            const zoneDoc = await transaction.get(zoneRef);
            if (!zoneDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Asset not found.');
            }

            const zoneData = zoneDoc.data()!;
            
            // 2. Validate State securely
            if (zoneData.status !== 'available') {
                throw new functions.https.HttpsError('failed-precondition', 'Asset is not available.');
            }
            if (zoneData.ownerId === renterId) {
                throw new functions.https.HttpsError('failed-precondition', 'Cannot rent your own asset.');
            }

            const sellerId = zoneData.ownerId;
            const sellerWalletRef = db.collection('wallets').doc(sellerId);
            const platformWalletRef = db.collection('wallets').doc('PLATFORM_TREASURY');

            // 3. Calculate Financials securely (no frontend input)
            const totalCost = zoneData.prices[durationPeriod];
            
            if (typeof totalCost !== 'number' || totalCost <= 0) {
                throw new functions.https.HttpsError('internal', 'Invalid asset price configuration.');
            }

            const platformFee = totalCost * PLATFORM_FEE_PERCENTAGE;
            const sellerAmount = totalCost - platformFee;

            // Fetch Wallets (Buyer and Seller and Platform)
            const buyerWallet = await transaction.get(buyerWalletRef);
            const sellerWallet = await transaction.get(sellerWalletRef);
            const platformWallet = await transaction.get(platformWalletRef);

            // Verify buyer has enough balance
            const buyerBalance = buyerWallet.exists ? buyerWallet.data()!.balance : 0;
            if (buyerBalance < totalCost) {
                throw new functions.https.HttpsError('out-of-range', 'Insufficient wallet balance.');
            }

            // Calculate Dates
            const now = admin.firestore.Timestamp.now();
            const endDate = now.toDate();
            if (durationPeriod === 'day') endDate.setDate(endDate.getDate() + 1);
            if (durationPeriod === 'week') endDate.setDate(endDate.getDate() + 7);
            if (durationPeriod === 'month') endDate.setMonth(endDate.getMonth() + 1);
            if (durationPeriod === 'year') endDate.setFullYear(endDate.getFullYear() + 1);

            // ------------------------------------
            // 4. ATOMIC WRITES
            // ------------------------------------

            // A. Update Zone
            transaction.update(zoneRef, {
                status: 'rented',
                renterId: renterId,
                rentalStart: now,
                rentalEnd: admin.firestore.Timestamp.fromDate(endDate),
                totalEarnings: admin.firestore.FieldValue.increment(totalCost),
                rentalCount: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // B. Create Transaction History
            const txRef = db.collection('transactions').doc();
            transaction.set(txRef, {
                zoneId,
                buyerId: renterId,
                sellerId,
                type: 'rent',
                amount: totalCost,
                platformFee: platformFee,
                sellerAmount: sellerAmount,
                duration: durationPeriod,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // C. Deduct from Buyer
            if (buyerWallet.exists) {
                transaction.update(buyerWalletRef, {
                    balance: admin.firestore.FieldValue.increment(-totalCost),
                    totalSpent: admin.firestore.FieldValue.increment(totalCost),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // D. Add to Seller
            if (sellerWallet.exists) {
                transaction.update(sellerWalletRef, {
                    balance: admin.firestore.FieldValue.increment(sellerAmount),
                    totalEarnings: admin.firestore.FieldValue.increment(sellerAmount),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Initialize seller wallet if they never had one
                transaction.set(sellerWalletRef, {
                    workspaceId: sellerId,
                    balance: sellerAmount,
                    pendingBalance: 0,
                    totalEarnings: sellerAmount,
                    totalSpent: 0,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // E. Add to Platform Treasury
            if (platformWallet.exists) {
                transaction.update(platformWalletRef, {
                    balance: admin.firestore.FieldValue.increment(platformFee),
                    totalEarnings: admin.firestore.FieldValue.increment(platformFee),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                transaction.set(platformWalletRef, {
                    workspaceId: 'PLATFORM',
                    balance: platformFee,
                    pendingBalance: 0,
                    totalEarnings: platformFee,
                    totalSpent: 0,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        });

        return { success: true, message: 'Asset rented successfully.' };
    } catch (error) {
        console.error("Rent transaction failed:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Transaction failed.', error);
    }
});
