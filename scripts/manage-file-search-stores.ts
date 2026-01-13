import { GoogleGenAI } from '@google/genai';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error('❌ Missing required environment variable: GOOGLE_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify readline question
function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Format bytes to human-readable size
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Format date
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

// List all File Search Stores
async function listStores() {
  console.log('\n📚 Fetching File Search Stores...\n');
  
  try {
    const response = await ai.fileSearchStores.list();
    // The response is a Pager object with stores in pageInternal
    const stores = (response as any).pageInternal || [];

    if (stores.length === 0) {
      console.log('No File Search Stores found.');
      return [];
    }

    console.log(`Found ${stores.length} store(s):\n`);
    
    stores.forEach((store: any, index: number) => {
      console.log(`${index + 1}. ${store.displayName || 'Unnamed Store'}`);
      console.log(`   ID: ${store.name}`);
      console.log(`   Documents: ${store.activeDocumentsCount || 0} active, ${store.pendingDocumentsCount || 0} pending, ${store.failedDocumentsCount || 0} failed`);
      console.log(`   Size: ${formatBytes(parseInt(store.sizeBytes || '0'))}`);
      console.log(`   Created: ${store.createTime ? formatDate(store.createTime) : 'Unknown'}`);
      console.log(`   Updated: ${store.updateTime ? formatDate(store.updateTime) : 'Unknown'}`);
      console.log('');
    });

    return stores;
  } catch (error: any) {
    console.error('❌ Error listing stores:', error.message);
    console.error('Full error:', error);
    return [];
  }
}

// Get detailed information about a specific store
async function getStoreDetails(storeName: string) {
  console.log(`\n🔍 Fetching details for store: ${storeName}...\n`);
  
  try {
    const store = await ai.fileSearchStores.get({ name: storeName });
    
    console.log('Store Details:');
    console.log('─'.repeat(50));
    console.log(`Display Name: ${store.displayName || 'Unnamed Store'}`);
    console.log(`Resource Name: ${store.name}`);
    console.log(`Created: ${store.createTime ? formatDate(store.createTime) : 'Unknown'}`);
    console.log(`Last Updated: ${store.updateTime ? formatDate(store.updateTime) : 'Unknown'}`);
    console.log('');
    console.log('Document Statistics:');
    console.log(`  Active: ${store.activeDocumentsCount || 0}`);
    console.log(`  Pending: ${store.pendingDocumentsCount || 0}`);
    console.log(`  Failed: ${store.failedDocumentsCount || 0}`);
    console.log(`  Total Size: ${formatBytes(parseInt(store.sizeBytes || '0'))}`);
    console.log('─'.repeat(50));
    
    return store;
  } catch (error: any) {
    console.error('❌ Error fetching store details:', error.message);
    return null;
  }
}

// Delete a File Search Store
async function deleteStore(storeName: string) {
  console.log(`\n⚠️  WARNING: You are about to delete store: ${storeName}`);
  console.log('This action cannot be undone!\n');
  
  const confirmation = await question('Type "DELETE" to confirm: ');
  
  if (confirmation !== 'DELETE') {
    console.log('❌ Deletion cancelled.');
    return false;
  }
  
  try {
    console.log('\n🗑️  Deleting store...');
    
    // First try without force
    try {
      await ai.fileSearchStores.delete({ name: storeName });
      console.log('✅ Store deleted successfully!');
      return true;
    } catch (firstError: any) {
      // If it fails due to non-empty store, try with force using REST API
      if (firstError.message?.includes('non-empty') || firstError.message?.includes('FAILED_PRECONDITION')) {
        console.log('⚠️  Store contains documents. Attempting force delete...');
        
        // Use direct REST API call with force=true
        const url = `https://generativelanguage.googleapis.com/v1beta/${storeName}?force=true`;
        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            'x-goog-api-key': GOOGLE_API_KEY!,
          },
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(JSON.stringify(error));
        }
        
        console.log('✅ Store and all documents deleted successfully!');
        return true;
      }
      throw firstError;
    }
  } catch (error: any) {
    console.error('❌ Error deleting store:', error.message || error);
    return false;
  }
}

// Main menu
async function showMenu() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   File Search Store Management Tool       ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('\nOptions:');
  console.log('  1. List all stores');
  console.log('  2. Get store details');
  console.log('  3. Delete a store');
  console.log('  4. Exit');
  console.log('');
  
  const choice = await question('Select an option (1-4): ');
  return choice.trim();
}

// Main program loop
async function main() {
  let running = true;
  
  while (running) {
    const choice = await showMenu();
    
    switch (choice) {
      case '1':
        await listStores();
        break;
        
      case '2':
        const stores = await listStores();
        if (stores.length > 0) {
          const storeInput = await question('\nEnter store number or full resource name: ');
          const storeIndex = parseInt(storeInput) - 1;
          
          let storeName: string;
          if (!isNaN(storeIndex) && storeIndex >= 0 && storeIndex < stores.length) {
            storeName = stores[storeIndex].name!;
          } else {
            storeName = storeInput;
          }
          
          await getStoreDetails(storeName);
        }
        break;
        
      case '3':
        const storesToDelete = await listStores();
        if (storesToDelete.length > 0) {
          const deleteInput = await question('\nEnter store number or full resource name to delete: ');
          const deleteIndex = parseInt(deleteInput) - 1;
          
          let storeNameToDelete: string;
          if (!isNaN(deleteIndex) && deleteIndex >= 0 && deleteIndex < storesToDelete.length) {
            storeNameToDelete = storesToDelete[deleteIndex].name!;
          } else {
            storeNameToDelete = deleteInput;
          }
          
          await deleteStore(storeNameToDelete);
        }
        break;
        
      case '4':
        console.log('\n👋 Goodbye!');
        running = false;
        break;
        
      default:
        console.log('\n❌ Invalid option. Please select 1-4.');
    }
    
    if (running) {
      await question('\nPress Enter to continue...');
    }
  }
  
  rl.close();
}

// Run the program
main().catch((error) => {
  console.error('Fatal error:', error);
  rl.close();
  process.exit(1);
});
