import { db, auth } from '../firebase';
import { 
    collection, 
    doc, 
    writeBatch, 
    getDoc, 
    getDocs, 
    query, 
    where, 
    serverTimestamp,
    runTransaction,
    setDoc,
    Timestamp
} from 'firebase/firestore';

export type ZoneType = 'slot' | 'subslot' | 'banner';
export type ZoneStatus = 'available' | 'rented' | 'for_sale' | 'inactive';

export interface ZonePrices {
    day: number;
    week: number;
    month: number;
    year: number;
}

export interface Zone {
    id: string;
    type: ZoneType;
    parentId: string | null;
    positionIndex: number; // 0-14, or relative index
    ownerId: string; // The current owner of the digital asset
    status: ZoneStatus;
    prices: ZonePrices;
    rentalStart: Timestamp | null;
    rentalEnd: Timestamp | null;
    renterId: string | null;
    imgUrl: string | null;
    link: string | null;
    totalEarnings: number;
    rentalCount: number;
    clicks?: number;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface Workspace {
    id: string;
    ownerId: string;
    slug: string;
    name: string;
    views: number;
    createdAt: Timestamp;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const marketplaceService = {
  // 1. SPLIT (Long Press) -> Divides a 'slot' into 4 'subslots'
  async splitSlot(slotId: string, ownerId: string) {
    if (!auth.currentUser) throw new Error("Not authenticated");

    try {
        await runTransaction(db, async (transaction) => {
            const slotRef = doc(db, 'zones', slotId);
            const slotDoc = await transaction.get(slotRef);

            if (!slotDoc.exists()) throw new Error("Slot no existe.");
            const slotData = slotDoc.data() as Zone;

            if (slotData.type !== 'slot' || slotData.status !== 'available') {
                throw new Error("Solo slots disponibles pueden ser divididos.");
            }
            if (slotData.ownerId !== ownerId) {
                throw new Error("No eres propietario del slot.");
            }

            // Marcar padre como inactivo
            transaction.update(slotRef, { 
                status: 'inactive', 
                updatedAt: serverTimestamp() 
            });

            // Crear 4 subslots
            for (let i = 0; i < 4; i++) {
                const subSlotRef = doc(collection(db, 'zones'));
                transaction.set(subSlotRef, {
                    type: 'subslot',
                    parentId: slotId,
                    positionIndex: i,
                    ownerId: ownerId,
                    status: 'available',
                    prices: { day: 5, week: 30, month: 100, year: 1000 }, // Default pricing
                    rentalStart: null,
                    rentalEnd: null,
                    renterId: null,
                    imgUrl: null,
                    link: null,
                    totalEarnings: 0,
                    rentalCount: 0,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
        });
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'zones (split transaction)');
    }
  },

  // 2. MERGE (Link) -> Combines 3 slots in a row into a 'banner'
  async mergeToBanner(slotIds: string[], ownerId: string, rowIndex: number) {
    if (!auth.currentUser) throw new Error("Not authenticated");

    try {
        await runTransaction(db, async (transaction) => {
            const slotDocs = await Promise.all(slotIds.map(id => transaction.get(doc(db, 'zones', id))));
            
            for (const doc of slotDocs) {
                if (!doc.exists()) throw new Error("Uno o más slots no existen.");
                const data = doc.data() as Zone;
                if (data.status !== 'available') throw new Error("Todos los slots deben estar disponibles.");
                if (data.ownerId !== ownerId) throw new Error("Solo el propietario puede hacer merge.");
            }

            // Marcar los 3 originales como inactivos (reservados para banner)
            slotIds.forEach(id => {
                transaction.update(doc(db, 'zones', id), { 
                    status: 'inactive',
                    updatedAt: serverTimestamp() 
                });
            });

            // Crear el banner
            const bannerRef = doc(collection(db, 'zones'));
            transaction.set(bannerRef, {
                type: 'banner',
                parentId: JSON.stringify(slotIds), // Array of linked IDs
                positionIndex: rowIndex, // Fila del 0 al 4
                ownerId: ownerId,
                status: 'available',
                prices: { day: 50, week: 300, month: 1000, year: 10000 },
                rentalStart: null,
                rentalEnd: null,
                renterId: null,
                imgUrl: null,
                link: null,
                totalEarnings: 0,
                rentalCount: 0,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'zones (merge transaction)');
    }
  },

  // 3. RENT/LEASE -> Alquilar un zona específica
  async rentZone(zoneId: string, durationPeriod: 'day' | 'week' | 'month' | 'year') {
    if (!auth.currentUser) throw new Error("Not authenticated");
    try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/api/rentZoneWithWallet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ data: { zoneId, durationPeriod } })
        });
        
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error?.message || "Failed to rent zone");
        }
        return result.data;
    } catch (error: any) {
        console.error("Rent error:", error);
        throw new Error(error.message || "Failed to rent zone");
    }
  },

  // 4. FETCH DATA -> Obtener el mapa de zonas
  async getActiveZones() {
    try {
        const q = query(collection(db, 'zones'), where('status', '!=', 'inactive'));
        const querySnapshot = await getDocs(q);
        const zones: Zone[] = [];
        querySnapshot.forEach(doc => zones.push({ id: doc.id, ...doc.data() } as Zone));
        return zones;
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'zones');
        return [];
    }
  },

  // 5. DASHBOARD -> Fetch user's own zones
  async getMyZones(userId: string) {
      if (!auth.currentUser || auth.currentUser.uid !== userId) throw new Error("Unauthorized");
      try {
          const q = query(collection(db, 'zones'), where('ownerId', '==', userId));
          const querySnapshot = await getDocs(q);
          const zones: Zone[] = [];
          querySnapshot.forEach(doc => zones.push({ id: doc.id, ...doc.data() } as Zone));
          return zones;
      } catch (error) {
          handleFirestoreError(error, OperationType.LIST, 'zones');
          return [];
      }
  },

  // 6. DASHBOARD -> Update zone prices
  async updateZonePrices(zoneId: string, prices: ZonePrices) {
      if (!auth.currentUser) throw new Error("Not authenticated");
      try {
          const zoneRef = doc(db, 'zones', zoneId);
          await runTransaction(db, async (transaction) => {
              const zoneDoc = await transaction.get(zoneRef);
              if (!zoneDoc.exists()) throw new Error("Not found");
              const zoneData = zoneDoc.data() as Zone;
              if (zoneData.ownerId !== auth.currentUser!.uid) throw new Error("Not owner");

              transaction.update(zoneRef, {
                  prices,
                  updatedAt: serverTimestamp()
              });
          });
      } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, 'zones');
      }
  },

  // 7. DASHBOARD -> Update content
  async updateZoneContent(zoneId: string, imgUrl: string, link: string) {
      if (!auth.currentUser) throw new Error("Not authenticated");
      try {
          const zoneRef = doc(db, 'zones', zoneId);
          await runTransaction(db, async (transaction) => {
              const zoneDoc = await transaction.get(zoneRef);
              if (!zoneDoc.exists()) throw new Error("Not found");
              const zoneData = zoneDoc.data() as Zone;
              if (zoneData.ownerId !== auth.currentUser!.uid) throw new Error("Not owner");

              transaction.update(zoneRef, {
                  imgUrl,
                  link,
                  updatedAt: serverTimestamp()
              });
          });
      } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, 'zones');
      }
  },

  // 8. DASHBOARD -> Toggle state (activate / deactivate)
  async toggleZoneState(zoneId: string, newStatus: ZoneStatus) {
      if (!auth.currentUser) throw new Error("Not authenticated");
      try {
          const zoneRef = doc(db, 'zones', zoneId);
          await runTransaction(db, async (transaction) => {
              const zoneDoc = await transaction.get(zoneRef);
              if (!zoneDoc.exists()) throw new Error("Not found");
              const zoneData = zoneDoc.data() as Zone;
              if (zoneData.ownerId !== auth.currentUser!.uid) throw new Error("Not owner");
              
              // Do not allow toggling state if currently rented
              if (zoneData.status === 'rented' && newStatus !== 'rented') {
                  throw new Error("Cannot change status while rented");
              }

              transaction.update(zoneRef, {
                  status: newStatus,
                  updatedAt: serverTimestamp()
              });
          });
      } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, 'zones');
      }
  },

  // 9. WALLET -> Fetch user wallet
  async getMyWallet(userId: string) {
      if (!auth.currentUser || auth.currentUser.uid !== userId) throw new Error("Unauthorized");
      try {
          const walletDoc = await getDoc(doc(db, 'wallets', userId));
          if (walletDoc.exists()) {
              return walletDoc.data();
          }
          return { balance: 0, pendingBalance: 0, totalEarnings: 0, totalSpent: 0 };
      } catch (error) {
          console.error("Wallet error:", error);
          return { balance: 0, pendingBalance: 0, totalEarnings: 0, totalSpent: 0 };
      }
  },

  // 9b. PAYOUT -> Request manual payout
  async requestPayout(amount: number, paymentMethod: 'bizum' | 'iban', paymentDetails: string) {
        if (!auth.currentUser) throw new Error("Not authenticated");
        try {
            const token = await auth.currentUser.getIdToken();
            const response = await fetch('/api/requestManualPayout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ data: { amount, paymentMethod, paymentDetails } })
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error?.message || "Failed to request payout");
            }
            return result.data;
        } catch (error: any) {
            console.error("Payout error:", error);
            throw new Error(error.message || "Failed to request payout");
        }
  },

  // 9c. Payout -> get my history
  async getMyPayouts() {
        if (!auth.currentUser) throw new Error("Not authenticated");
        try {
            // Need orderBy from firestore
            const { orderBy } = await import('firebase/firestore');
            const q = query(
                collection(db, 'payoutRequests'), 
                where('userId', '==', auth.currentUser.uid),
                // Note: we might not use orderBy if we don't have an index yet, so we just filter in client or query without order 
                // Let's just fetch all and sort in client to avoid index requirement for now
            );
            const querySnapshot = await getDocs(q);
            const payouts: any[] = [];
            querySnapshot.forEach(doc => payouts.push({ id: doc.id, ...doc.data() }));
            return payouts.sort((a,b) => {
                const ta = a.createdAt?.toMillis() || 0;
                const tb = b.createdAt?.toMillis() || 0;
                return tb - ta;
            });
        } catch (error) {
            handleFirestoreError(error, OperationType.LIST, 'payoutRequests');
            return [];
        }
  },

  // 10. WORKSPACE -> Get or create a basic workspace for a user
  async ensureWorkspace(userId: string, email: string | null) {
      if (!auth.currentUser || auth.currentUser.uid !== userId) throw new Error("Unauthorized");
      try {
          const workspaceRef = doc(db, 'workspaces', userId);
          const workspaceDoc = await getDoc(workspaceRef);
          if (workspaceDoc.exists()) {
              return workspaceDoc.data() as Workspace;
          }
          
          // Create default workspace
          const splitEmail = email ? email.split('@')[0] : 'user';
          const defaultName = splitEmail + "'s Marketplace";
          const defaultSlug = splitEmail + "-" + Math.floor(Math.random() * 10000);
          
          const newWorkspace: Workspace = {
              id: userId,
              ownerId: userId,
              slug: defaultSlug,
              name: defaultName,
              views: 0,
              createdAt: serverTimestamp() as Timestamp
          };
          
          await setDoc(workspaceRef, newWorkspace);
          return newWorkspace;
      } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'workspaces');
          throw error;
      }
  },

  // 11. PUBLIC WORKSPACE -> Fetch by slug
  async getWorkspaceBySlug(slug: string) {
      try {
          const q = query(collection(db, 'workspaces'), where('slug', '==', slug));
          const querySnapshot = await getDocs(q);
          if (querySnapshot.empty) return null;
          return { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() } as Workspace;
      } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'workspaces');
          return null;
      }
  },

  // 12. PUBLIC WORKSPACE -> Fetch active zones for a workspace
  async getPublicWorkspaceZones(workspaceId: string) {
      try {
          // Fetch only available or rented zones (no inactive)
          const q = query(collection(db, 'zones'), where('ownerId', '==', workspaceId));
          const querySnapshot = await getDocs(q);
          const zones: Zone[] = [];
          querySnapshot.forEach(doc => {
              const zone = { id: doc.id, ...doc.data() } as Zone;
              if (zone.status !== 'inactive') {
                  zones.push(zone);
              }
          });
          return zones;
      } catch (error) {
          handleFirestoreError(error, OperationType.LIST, 'zones');
          return [];
      }
  }
};
