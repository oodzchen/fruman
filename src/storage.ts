const DB_NAME = 'sl2d'
const DB_VERSION = 1
const STORE_NAME = 'settings'
const SETTINGS_KEY = 'control-panel'

let dbInstance: IDBDatabase | null = null
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance)
  }
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })

  return dbPromise
}

export async function loadStoredValues(): Promise<Record<string, string>> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(SETTINGS_KEY)

      request.onsuccess = () => {
        const result = request.result as Record<string, string> | undefined
        resolve(result && typeof result === 'object' ? result : {})
      }

      request.onerror = () => resolve({})
    })
  } catch {
    return {}
  }
}

export function saveStoredValues(values: Record<string, string>): void {
  openDB()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(values, SETTINGS_KEY)
    })
    .catch(() => {})
}
