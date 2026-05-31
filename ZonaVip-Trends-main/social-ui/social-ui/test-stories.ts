import { initializeApp } from 'firebase/app';
import { getFirestore, collectionGroup, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const fbConfigString = fs.readFileSync('firebase-applet-config.json', 'utf8');
const firebaseConfig = JSON.parse(fbConfigString);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function test() {
  const snap = await getDocs(collectionGroup(db, 'stories'));
  console.log(`Found ${snap.size} stories`);
  process.exit(0);
}

test().catch(console.error);
