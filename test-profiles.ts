import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';
import * as fs from 'fs';

const fbConfigString = fs.readFileSync('firebase-applet-config.json', 'utf8');
const firebaseConfig = JSON.parse(fbConfigString);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function test() {
  const q = query(collection(db, 'creatorProfiles'), limit(100));
  const snap = await getDocs(q);
  console.log(`Found ${snap.size} profiles`);
  snap.forEach(doc => {
     console.log(doc.id, doc.data());
  });
  process.exit(0);
}

test().catch(console.error);
