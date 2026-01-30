import type { EditorMapData, EditorMapMeta } from './editorMapTypes'

const DB_NAME = 'sl2d'
const DB_VERSION = 2

const SETTINGS_STORE = 'settings'
const SETTINGS_KEY = 'control-panel'

const MAP_META_STORE = 'editor-map-meta'
const MAP_DATA_STORE = 'editor-map-data'

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

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE)
      }

      if (!db.objectStoreNames.contains(MAP_META_STORE)) {
        db.createObjectStore(MAP_META_STORE, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(MAP_DATA_STORE)) {
        db.createObjectStore(MAP_DATA_STORE, { keyPath: 'id' })
      }
    }
  })

  return dbPromise
}

export async function loadStoredValues(): Promise<Record<string, string>> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly')
      const store = tx.objectStore(SETTINGS_STORE)
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
      const tx = db.transaction(SETTINGS_STORE, 'readwrite')
      const store = tx.objectStore(SETTINGS_STORE)
      store.put(values, SETTINGS_KEY)
    })
    .catch(() => {})
}

interface StoredMapDataRecord {
  id: string
  data: EditorMapData
}

export async function listEditorMaps(): Promise<EditorMapMeta[]> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(MAP_META_STORE, 'readonly')
      const store = tx.objectStore(MAP_META_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        const result = request.result as EditorMapMeta[] | undefined
        if (!result || result.length === 0) {
          resolve([])
          return
        }
        result.sort((a, b) => b.updatedAt - a.updatedAt)
        resolve(result)
      }

      request.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

export async function loadEditorMapData(
  mapId: string
): Promise<EditorMapData | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(MAP_DATA_STORE, 'readonly')
      const store = tx.objectStore(MAP_DATA_STORE)
      const request = store.get(mapId)

      request.onsuccess = () => {
        const result = request.result as StoredMapDataRecord | undefined
        if (!result || result.id !== mapId) {
          resolve(null)
          return
        }
        resolve(result.data)
      }

      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function createEditorMap(
  name: string,
  initialData: EditorMapData
): Promise<EditorMapMeta | null> {
  try {
    const db = await openDB()
    const now = Date.now()
    const mapId = `map-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
    const meta: EditorMapMeta = {
      id: mapId,
      name,
      createdAt: now,
      updatedAt: now,
    }
    const dataRecord: StoredMapDataRecord = { id: mapId, data: initialData }

    return new Promise((resolve) => {
      const tx = db.transaction([MAP_META_STORE, MAP_DATA_STORE], 'readwrite')
      const metaStore = tx.objectStore(MAP_META_STORE)
      const dataStore = tx.objectStore(MAP_DATA_STORE)

      metaStore.put(meta)
      dataStore.put(dataRecord)

      tx.oncomplete = () => resolve(meta)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveEditorMap(
  meta: EditorMapMeta,
  data: EditorMapData
): Promise<EditorMapMeta | null> {
  try {
    const db = await openDB()
    const nextMeta: EditorMapMeta = {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
      isDefault: meta.isDefault,
      thumbnail: meta.thumbnail,
    }
    const dataRecord: StoredMapDataRecord = { id: meta.id, data }

    return new Promise((resolve) => {
      const tx = db.transaction([MAP_META_STORE, MAP_DATA_STORE], 'readwrite')
      tx.objectStore(MAP_META_STORE).put(nextMeta)
      tx.objectStore(MAP_DATA_STORE).put(dataRecord)
      tx.oncomplete = () => resolve(nextMeta)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveEditorMapMeta(
  meta: EditorMapMeta
): Promise<EditorMapMeta | null> {
  try {
    const db = await openDB()
    const nextMeta: EditorMapMeta = {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
      isDefault: meta.isDefault,
      thumbnail: meta.thumbnail,
    }

    return new Promise((resolve) => {
      const tx = db.transaction(MAP_META_STORE, 'readwrite')
      tx.objectStore(MAP_META_STORE).put(nextMeta)
      tx.oncomplete = () => resolve(nextMeta)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function deleteEditorMap(mapId: string): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction([MAP_META_STORE, MAP_DATA_STORE], 'readwrite')
      tx.objectStore(MAP_META_STORE).delete(mapId)
      tx.objectStore(MAP_DATA_STORE).delete(mapId)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function getDefaultMap(): Promise<{
  meta: EditorMapMeta
  data: EditorMapData
} | null> {
  try {
    const metaList = await listEditorMaps()
    const defaultMeta = metaList.find((m) => m.isDefault)
    if (!defaultMeta) {
      return null
    }
    const data = await loadEditorMapData(defaultMeta.id)
    if (!data) {
      return null
    }
    return { meta: defaultMeta, data }
  } catch {
    return null
  }
}

export async function ensureDefaultMap(
  canvasWidth: number,
  canvasHeight: number,
  pixelsPerMeter: number
): Promise<{ meta: EditorMapMeta; data: EditorMapData }> {
  const existing = await getDefaultMap()
  if (existing) {
    return existing
  }

  const defaultData = buildDefaultMapData(
    canvasWidth,
    canvasHeight,
    pixelsPerMeter
  )
  const meta = await createEditorMap('默认地图', defaultData)
  if (!meta) {
    throw new Error('Failed to create default map')
  }

  meta.isDefault = true
  await saveEditorMap(meta, defaultData)

  return { meta, data: defaultData }
}

function buildDefaultMapData(
  canvasWidth: number,
  canvasHeight: number,
  pixelsPerMeter: number
): EditorMapData {
  const canvasHeightMeters = canvasHeight / pixelsPerMeter
  const groundHalfHeight = 0.5
  const groundCenterY = canvasHeightMeters - groundHalfHeight
  const playerSpawnY = Math.max(1.2, groundCenterY - 1.2)

  const groundShape: EditorMapData['shapes'][number] = {
    objectKind: 'ground',
    shape: {
      kind: 'rect',
      center: { x: 0, y: groundCenterY },
      halfWidth: 60,
      halfHeight: groundHalfHeight,
      rotationRad: 0,
    },
  }

  const obstacleShapes: EditorMapData['shapes'] = [
    {
      objectKind: 'obstacle',
      shape: {
        kind: 'rect',
        center: { x: -9.5, y: groundCenterY - 1.5 },
        halfWidth: 1.5,
        halfHeight: 1.5,
        rotationRad: 0,
      },
    },
    {
      objectKind: 'obstacle',
      shape: {
        kind: 'rect',
        center: { x: -5, y: groundCenterY - 2.5 },
        halfWidth: 1.5,
        halfHeight: 2.5,
        rotationRad: 0,
      },
    },
    {
      objectKind: 'obstacle',
      shape: {
        kind: 'rect',
        center: { x: 0, y: groundCenterY - 3.5 },
        halfWidth: 1.5,
        halfHeight: 3.5,
        rotationRad: 0,
      },
    },
    {
      objectKind: 'obstacle',
      shape: {
        kind: 'rect',
        center: { x: 5, y: groundCenterY - 5.5 },
        halfWidth: 1.5,
        halfHeight: 5.5,
        rotationRad: 0,
      },
    },
    {
      objectKind: 'obstacle',
      shape: {
        kind: 'rect',
        center: { x: 10, y: groundCenterY - 7.5 },
        halfWidth: 1.5,
        halfHeight: 7.5,
        rotationRad: 0,
      },
    },
    {
      objectKind: 'obstacle',
      shape: {
        kind: 'rect',
        center: { x: 15, y: groundCenterY - 10.5 },
        halfWidth: 1.5,
        halfHeight: 10.5,
        rotationRad: 0,
      },
    },
  ]

  const playerSpawnX = -12

  return {
    version: 1,
    canvasWidth,
    canvasHeight,
    pixelsPerMeter,
    playerSpawn: { x: playerSpawnX, y: playerSpawnY },
    camera: { x: 0, y: 0, zoom: 1 },
    shapes: [groundShape, ...obstacleShapes],
    enemies: [],
    weapons: [],
  }
}
