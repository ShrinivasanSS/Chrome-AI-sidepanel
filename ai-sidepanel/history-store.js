(function(global) {
  'use strict';

  const DB_NAME = 'ai-sidepanel-history';
  const DB_VERSION = 1;
  const STORE_NAME = 'conversations';

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  async function runTransaction(mode, callback) {
    const db = await openDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);

      let settled = false;

      transaction.oncomplete = () => {
        db.close();
        if (!settled) {
          resolve();
        }
      };

      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };

      Promise.resolve(callback(store, transaction))
        .then((value) => {
          settled = true;
          resolve(value);
        })
        .catch((error) => {
          settled = true;
          reject(error);
        });
    });
  }

  async function saveConversation(conversation) {
    return runTransaction('readwrite', (store) => {
      const payload = {
        ...conversation,
        id: conversation.id || (global.StorageUtils ? StorageUtils.createId('conversation') : `${Date.now()}`),
        createdAt: conversation.createdAt || new Date().toISOString()
      };

      return new Promise((resolve, reject) => {
        const request = store.put(payload);
        request.onsuccess = () => resolve(payload);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async function getRecentConversations(limit) {
    const max = Number(limit) || 10;

    return runTransaction('readonly', (store) => new Promise((resolve, reject) => {
      const index = store.index('createdAt');
      const results = [];
      const request = index.openCursor(null, 'prev');

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || results.length >= max) {
          resolve(results);
          return;
        }

        results.push(cursor.value);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    }));
  }

  async function clearConversations() {
    return runTransaction('readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));
  }

  async function getMetrics() {
    return runTransaction('readonly', (store) => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result || [];
        const historyBytes = records.reduce((total, entry) => {
          return total + new TextEncoder().encode(JSON.stringify(entry)).length;
        }, 0);

        resolve({
          historyBytes,
          historyCount: records.length
        });
      };
      request.onerror = () => reject(request.error);
    }));
  }

  global.HistoryStore = {
    saveConversation,
    getRecentConversations,
    clearConversations,
    getMetrics
  };
})(typeof self !== 'undefined' ? self : window);
