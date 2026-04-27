import {
  CHARACTER_BODY_DRAW_HALF,
  CHARACTER_BODY_DRAW_SIZE,
} from './characterBodyProfile'
import {
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_WEAPON_CORNER_RADIUS,
  WEAPON_DEFAULT_DATA,
} from './constants'
import type {
  EditorMapData,
  EditorMapMeta,
  EditorTreeNode,
  EditorViewportState,
  MapCharacterBodyProfile,
  MapEnvironmentAsset,
  MapNpc,
  MapNpcTemplate,
  MapNpcWeapon,
  MapPlayerProperties,
  MapSettings,
} from './editorMapTypes'
import { DEFAULT_MAP_TIME_PHASE, MAP_TIME_PHASE_IDS } from './editorMapTypes'
import { resolveNpcBodyProfile } from './npcBodyProfileUtils'
import {
  DEFAULT_NPC_DROP_COUNT,
  DEFAULT_NPC_EXP_ORB_DROP_CHANCE,
  normalizeNpcDropList,
} from './npcDropUtils'
import { clampPlayerLevel, clampPlayerUpgradeLevel } from './playerUpgrade'
import { getDefaultTerrainRenderLayer } from './renderLayers'
import type {
  SaveData,
  SaveMeta,
  SaveNpcState,
  SavePlayerState,
  SaveWeaponSlotState,
} from './saveTypes'
import { normalizeSkeletalBodyProfile } from './skeletalBodyProfile'
import {
  createDefaultTerrainChunkSiteJitter,
  getTerrainChunkMaterialCodes,
  inferTerrainMaterialId,
} from './terrain/TerrainDataUtils'
import { migrateLegacyShapesToTerrain } from './terrain/TerrainLegacyShapeMigration'
import {
  DEFAULT_TERRAIN_RANDOM_SEED,
  type MapTerrainData,
  TERRAIN_CELL_SIZE_METERS,
  TERRAIN_CHUNK_SIZE,
  type TerrainContourLike,
} from './terrain/TerrainTypes'
import type { NpcType } from './types'
import {
  computeWeaponScaleFactor,
  getDefaultPlayerAmmoForWeaponType,
  isAmmoLimitedWeaponType,
  normalizeWeaponType,
  resolveWeaponStatsForSize,
} from './weaponTypeUtils'

const DB_NAME = 'sl2d'
const DB_VERSION = 7

const SETTINGS_STORE = 'settings'
const SETTINGS_KEY = 'control-panel'
const LAST_SAVE_KEY = 'last-save-id'

const MAP_META_STORE = 'editor-map-meta'
const MAP_DATA_STORE = 'editor-map-data'
const MAP_VIEW_STORE = 'editor-map-view'
const ENVIRONMENT_ASSET_STORE = 'editor-environment-assets'

const SAVE_META_STORE = 'save-meta'
const SAVE_DATA_STORE = 'save-data'

const REQUIRED_OBJECT_STORES = [
  SETTINGS_STORE,
  MAP_META_STORE,
  MAP_DATA_STORE,
  MAP_VIEW_STORE,
  ENVIRONMENT_ASSET_STORE,
  SAVE_META_STORE,
  SAVE_DATA_STORE,
] as const

let dbInstance: IDBDatabase | null = null
let dbPromise: Promise<IDBDatabase> | null = null

function hasRequiredObjectStores(db: IDBDatabase): boolean {
  for (let i = 0; i < REQUIRED_OBJECT_STORES.length; i++) {
    if (!db.objectStoreNames.contains(REQUIRED_OBJECT_STORES[i])) {
      return false
    }
  }
  return true
}

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    if (!hasRequiredObjectStores(dbInstance)) {
      dbInstance.close()
      dbInstance = null
      dbPromise = null
    } else {
      return Promise.resolve(dbInstance)
    }
  }
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
      dbInstance.onversionchange = () => {
        dbInstance?.close()
        dbInstance = null
        dbPromise = null
      }
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

      if (!db.objectStoreNames.contains(MAP_VIEW_STORE)) {
        db.createObjectStore(MAP_VIEW_STORE, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(ENVIRONMENT_ASSET_STORE)) {
        db.createObjectStore(ENVIRONMENT_ASSET_STORE, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(SAVE_META_STORE)) {
        const saveMetaStore = db.createObjectStore(SAVE_META_STORE, {
          keyPath: 'id',
        })
        saveMetaStore.createIndex('updatedAt', 'updatedAt', { unique: false })
      }

      if (!db.objectStoreNames.contains(SAVE_DATA_STORE)) {
        db.createObjectStore(SAVE_DATA_STORE, { keyPath: 'id' })
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

interface StoredMapViewRecord {
  id: string
  view: EditorViewportState
}

interface StoredEnvironmentAssetRecord extends MapEnvironmentAsset {
  blob: Blob
}

function toEnvironmentAssetMeta(
  record: StoredEnvironmentAssetRecord
): MapEnvironmentAsset {
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function createInitialSaveWeaponSlotState(
  weaponConfig: MapNpcWeapon | null | undefined
): SaveWeaponSlotState | null {
  const weaponType = normalizeWeaponType(weaponConfig?.weaponType)
  if (!weaponType) {
    return null
  }

  const template = WEAPON_DEFAULT_DATA[weaponType]
  const sizeLevel =
    typeof weaponConfig?.sizeLevel === 'number' &&
    Number.isFinite(weaponConfig.sizeLevel) &&
    weaponConfig.sizeLevel > 0
      ? Math.round(weaponConfig.sizeLevel)
      : template.sizeLevel
  const scaleFactor = computeWeaponScaleFactor(template, sizeLevel)
  const resolvedStats = resolveWeaponStatsForSize(template, sizeLevel, {
    attackDamage: weaponConfig?.attackDamage,
    postureDamage: weaponConfig?.postureDamage,
    toughnessDamage: weaponConfig?.toughnessDamage,
  })
  const bowAmmo =
    isAmmoLimitedWeaponType(weaponType) &&
    typeof weaponConfig?.bowAmmo === 'number' &&
    Number.isFinite(weaponConfig.bowAmmo) &&
    weaponConfig.bowAmmo >= 0
      ? Math.round(weaponConfig.bowAmmo)
      : getDefaultPlayerAmmoForWeaponType(weaponType)
  const scaledWidth = template.width * scaleFactor
  const scaledHeight = template.height * scaleFactor

  return {
    weaponType,
    sizeLevel,
    width: scaledWidth,
    height: scaledHeight,
    baseWidth: scaledWidth,
    sizeMaxLevel: template.sizeMaxLevel,
    cornerRadius: DEFAULT_WEAPON_CORNER_RADIUS,
    weight: template.weight * scaleFactor,
    attackDamage: resolvedStats.attackDamage,
    postureDamage: resolvedStats.postureDamage,
    toughnessDamage: resolvedStats.toughnessDamage,
    bowAmmo: isAmmoLimitedWeaponType(weaponType) ? bowAmmo : 0,
    bowAmmoMax: isAmmoLimitedWeaponType(weaponType) ? bowAmmo : 0,
  }
}

function createInitialSavePlayerWeaponState(
  playerProps: MapPlayerProperties | null | undefined
): Pick<SavePlayerState, 'mainWeapon' | 'secondaryWeapon' | 'activeSlot'> {
  const mainWeapon = createInitialSaveWeaponSlotState(playerProps?.mainWeapon)
  const secondaryWeapon = createInitialSaveWeaponSlotState(
    playerProps?.secondaryWeapon
  )

  return {
    mainWeapon,
    secondaryWeapon,
    activeSlot: mainWeapon ? 'main' : secondaryWeapon ? 'secondary' : 'main',
  }
}

function compareEditorMapMetaOrder(a: EditorMapMeta, b: EditorMapMeta): number {
  const aDefault = a.isDefault === true ? 1 : 0
  const bDefault = b.isDefault === true ? 1 : 0
  if (aDefault !== bDefault) {
    return bDefault - aDefault
  }
  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt
  }
  return a.id.localeCompare(b.id)
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
        result.sort(compareEditorMapMetaOrder)
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
        const normalized = normalizeEditorMapData(result.data)
        if (normalized !== result.data) {
          void persistNormalizedEditorMapData(mapId, normalized)
        }
        resolve(normalized)
      }

      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function persistNormalizedEditorMapData(
  mapId: string,
  data: EditorMapData
): Promise<void> {
  try {
    const db = await openDB()
    const record: StoredMapDataRecord = { id: mapId, data }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(MAP_DATA_STORE, 'readwrite')
      tx.objectStore(MAP_DATA_STORE).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // Ignore background normalization persistence failures.
  }
}

export async function loadEditorMapViewState(
  mapId: string
): Promise<EditorViewportState | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(MAP_VIEW_STORE, 'readonly')
      const store = tx.objectStore(MAP_VIEW_STORE)
      const request = store.get(mapId)

      request.onsuccess = () => {
        const result = request.result as StoredMapViewRecord | undefined
        if (!result || result.id !== mapId) {
          resolve(null)
          return
        }
        resolve(result.view)
      }

      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function listEditorEnvironmentAssets(): Promise<
  MapEnvironmentAsset[]
> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(ENVIRONMENT_ASSET_STORE, 'readonly')
      const store = tx.objectStore(ENVIRONMENT_ASSET_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        const result = request.result as
          | StoredEnvironmentAssetRecord[]
          | undefined
        if (!result || result.length === 0) {
          resolve([])
          return
        }
        const assets = result.map(toEnvironmentAssetMeta)
        assets.sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt - b.createdAt
          }
          return a.id.localeCompare(b.id)
        })
        resolve(assets)
      }

      request.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

export async function loadEditorEnvironmentAssetBlob(
  assetId: string
): Promise<{ asset: MapEnvironmentAsset; blob: Blob } | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(ENVIRONMENT_ASSET_STORE, 'readonly')
      const store = tx.objectStore(ENVIRONMENT_ASSET_STORE)
      const request = store.get(assetId)

      request.onsuccess = () => {
        const result = request.result as
          | StoredEnvironmentAssetRecord
          | undefined
        if (!result || result.id !== assetId) {
          resolve(null)
          return
        }
        resolve({ asset: toEnvironmentAssetMeta(result), blob: result.blob })
      }

      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveEditorEnvironmentAsset(
  asset: MapEnvironmentAsset,
  blob: Blob
): Promise<MapEnvironmentAsset | null> {
  try {
    const db = await openDB()
    const record: StoredEnvironmentAssetRecord = { ...asset, blob }
    return new Promise((resolve) => {
      const tx = db.transaction(ENVIRONMENT_ASSET_STORE, 'readwrite')
      tx.objectStore(ENVIRONMENT_ASSET_STORE).put(record)
      tx.oncomplete = () => resolve(asset)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function deleteEditorEnvironmentAsset(
  assetId: string
): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(ENVIRONMENT_ASSET_STORE, 'readwrite')
      tx.objectStore(ENVIRONMENT_ASSET_STORE).delete(assetId)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
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
    const dataRecord: StoredMapDataRecord = {
      id: mapId,
      data: normalizeEditorMapData(initialData),
    }

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
    const dataRecord: StoredMapDataRecord = {
      id: meta.id,
      data: normalizeEditorMapData(data),
    }

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

export async function saveEditorMapViewState(
  mapId: string,
  view: EditorViewportState
): Promise<boolean> {
  try {
    const db = await openDB()
    const record: StoredMapViewRecord = { id: mapId, view }
    return new Promise((resolve) => {
      const tx = db.transaction(MAP_VIEW_STORE, 'readwrite')
      tx.objectStore(MAP_VIEW_STORE).put(record)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
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
      const tx = db.transaction(
        [MAP_META_STORE, MAP_DATA_STORE, MAP_VIEW_STORE],
        'readwrite'
      )
      tx.objectStore(MAP_META_STORE).delete(mapId)
      tx.objectStore(MAP_DATA_STORE).delete(mapId)
      tx.objectStore(MAP_VIEW_STORE).delete(mapId)
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

  const shapes = [groundShape, ...obstacleShapes]
  const migratedTerrain = migrateLegacyShapesToTerrain(
    shapes,
    pixelsPerMeter,
    1,
    TERRAIN_CELL_SIZE_METERS,
    TERRAIN_CHUNK_SIZE,
    DEFAULT_TERRAIN_RANDOM_SEED
  )

  return {
    version: 3,
    canvasWidth,
    canvasHeight,
    pixelsPerMeter,
    playerSpawn: { x: playerSpawnX, y: playerSpawnY },
    settings: { initialTimePhase: DEFAULT_MAP_TIME_PHASE },
    camera: { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM },
    shapes: [],
    npcs: [],
    weapons: [],
    checkpoints: [],
    npcTemplates: [],
    terrain: {
      version: 4,
      cellSize: TERRAIN_CELL_SIZE_METERS,
      chunkSize: TERRAIN_CHUNK_SIZE,
      randomSeed: DEFAULT_TERRAIN_RANDOM_SEED,
      chunks: [],
      layers: migratedTerrain.layers,
      contours: migratedTerrain.contours,
    },
  }
}

interface StoredSaveDataRecord {
  id: string
  data: SaveData
}

function normalizeBodyProfile(
  profile: MapCharacterBodyProfile | undefined
): MapCharacterBodyProfile | undefined {
  if (!profile || profile.points.length < 6) {
    return normalizeSkeletalBodyProfile(profile)
  }

  let minX = profile.points[0]
  let maxX = profile.points[0]
  let minY = profile.points[1]
  let maxY = profile.points[1]
  for (let i = 2; i < profile.points.length; i += 2) {
    const x = profile.points[i]
    const y = profile.points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const eyeX = profile.eyeX
  const eyeY = profile.eyeY
  if (
    typeof eyeX !== 'number' ||
    !Number.isFinite(eyeX) ||
    typeof eyeY !== 'number' ||
    !Number.isFinite(eyeY)
  ) {
    return normalizeSkeletalBodyProfile(profile)
  }

  const looksLikeLegacyAbsoluteEye =
    eyeX >= 0 &&
    eyeX <= CHARACTER_BODY_DRAW_SIZE &&
    eyeY >= 0 &&
    eyeY <= CHARACTER_BODY_DRAW_SIZE &&
    minX < 0 &&
    maxX > 0 &&
    minY < 0 &&
    maxY > 0
  if (!looksLikeLegacyAbsoluteEye) {
    return normalizeSkeletalBodyProfile(profile)
  }

  const currentOverflow =
    (eyeX < minX ? minX - eyeX : eyeX > maxX ? eyeX - maxX : 0) +
    (eyeY < minY ? minY - eyeY : eyeY > maxY ? eyeY - maxY : 0)
  const shiftedEyeX = eyeX - CHARACTER_BODY_DRAW_HALF
  const shiftedEyeY = eyeY - CHARACTER_BODY_DRAW_HALF
  const shiftedOverflow =
    (shiftedEyeX < minX
      ? minX - shiftedEyeX
      : shiftedEyeX > maxX
        ? shiftedEyeX - maxX
        : 0) +
    (shiftedEyeY < minY
      ? minY - shiftedEyeY
      : shiftedEyeY > maxY
        ? shiftedEyeY - maxY
        : 0)

  if (shiftedOverflow >= currentOverflow) {
    return normalizeSkeletalBodyProfile(profile)
  }

  return normalizeSkeletalBodyProfile({
    ...profile,
    eyeX: shiftedEyeX,
    eyeY: shiftedEyeY,
  })
}

function normalizeMapNpc(npc: MapNpc): MapNpc {
  const normalizedDrops =
    npc.drops === undefined ? undefined : normalizeNpcDropList(npc.drops)
  const npcType = npc.npcType ?? npc.enemyType ?? ('default' as NpcType)
  return {
    ...npc,
    npcType,
    npcFactions: npc.npcFactions ?? npc.enemyFactions,
    bodyProfile: resolveNpcBodyProfile(
      npcType,
      normalizeBodyProfile(npc.bodyProfile)
    ),
    drops: normalizedDrops,
  }
}

function normalizeMapNpcTemplate(template: MapNpcTemplate): MapNpcTemplate {
  const normalizedDrops =
    template.drops === undefined
      ? undefined
      : normalizeNpcDropList(template.drops)
  const npcType =
    template.npcType ?? template.enemyType ?? ('default' as NpcType)
  return {
    ...template,
    npcType,
    npcFactions: template.npcFactions ?? template.enemyFactions,
    bodyProfile: resolveNpcBodyProfile(
      npcType,
      normalizeBodyProfile(template.bodyProfile)
    ),
    drops: normalizedDrops,
  }
}

function migrateLegacyNpcDrops<
  T extends { drops?: MapNpc['drops'] | MapNpcTemplate['drops'] },
>(entry: T, mapVersion: number | undefined): T {
  if (entry.drops === undefined) {
    return entry
  }
  const drops = normalizeNpcDropList(entry.drops)
  if ((mapVersion ?? 1) >= 2) {
    return { ...entry, drops }
  }
  for (let i = 0; i < drops.length; i++) {
    if (drops[i].itemType === 'expOrb') {
      return { ...entry, drops }
    }
  }
  const migratedDrops = drops.slice()
  migratedDrops.push({
    itemType: 'expOrb',
    chance: DEFAULT_NPC_EXP_ORB_DROP_CHANCE,
    count: DEFAULT_NPC_DROP_COUNT,
  })
  return { ...entry, drops: migratedDrops }
}

function normalizeMapPlayer(
  player: EditorMapData['player']
): EditorMapData['player'] {
  if (!player) return player
  return {
    ...player,
    npcFactions: player.npcFactions ?? player.enemyFactions,
    bodyProfile: normalizeBodyProfile(player.bodyProfile),
  }
}

function normalizeTerrainContourMetadata(
  terrain: MapTerrainData | undefined
): MapTerrainData | undefined {
  if (
    !terrain ||
    !terrain.contours ||
    terrain.contours.length === 0 ||
    !terrain.layers ||
    terrain.layers.length === 0
  ) {
    return terrain
  }

  const referencedContourIds = new Set<number>()
  for (let i = 0; i < terrain.layers.length; i++) {
    const contourId = terrain.layers[i].contourId
    if (typeof contourId === 'number' && Number.isFinite(contourId)) {
      referencedContourIds.add(contourId | 0)
    }
  }
  if (referencedContourIds.size === 0) {
    return terrain
  }

  let normalizedContours: TerrainContourLike[] | null = null
  for (let i = 0; i < terrain.contours.length; i++) {
    const contour = terrain.contours[i]
    if (
      !referencedContourIds.has(contour.id | 0) ||
      contour.straightEdge !== undefined ||
      contour.shapeKind !== undefined
    ) {
      continue
    }

    const inferred = inferLegacyStraightEdgeContourMetadata(contour.points)
    if (!inferred) {
      continue
    }

    if (!normalizedContours) {
      normalizedContours = terrain.contours.slice()
    }
    normalizedContours[i] = {
      ...contour,
      ...inferred,
    }
  }

  if (!normalizedContours) {
    return terrain
  }

  return {
    ...terrain,
    contours: normalizedContours,
  }
}

function inferLegacyStraightEdgeContourMetadata(
  points: readonly number[]
): Pick<TerrainContourLike, 'shapeKind' | 'straightEdge'> | null {
  const vertices = normalizeContourVertices(points)
  const vertexCount = vertices.length >> 1
  if (vertexCount < 3) {
    return null
  }
  if (vertexCount === 3) {
    return {
      shapeKind: 'triangle',
      straightEdge: true,
    }
  }
  if (vertexCount === 4 && isLegacyRectangleContour(vertices)) {
    return {
      shapeKind: 'rect',
      straightEdge: true,
    }
  }
  if (isLegacyOrthogonalContour(vertices)) {
    return {
      shapeKind: 'polygon',
      straightEdge: true,
    }
  }
  return null
}

function normalizeContourVertices(points: readonly number[]): number[] {
  if (points.length < 6 || (points.length & 1) !== 0) {
    return []
  }
  let end = points.length
  while (
    end >= 4 &&
    points[0] === points[end - 2] &&
    points[1] === points[end - 1]
  ) {
    end -= 2
  }
  if (end < 6) {
    return []
  }
  return Array.from(points.slice(0, end))
}

function isLegacyRectangleContour(points: readonly number[]): boolean {
  if (points.length !== 8) {
    return false
  }

  const ax = points[0]
  const ay = points[1]
  const bx = points[2]
  const by = points[3]
  const cx = points[4]
  const cy = points[5]
  const dx = points[6]
  const dy = points[7]

  const abx = bx - ax
  const aby = by - ay
  const bcx = cx - bx
  const bcy = cy - by
  const cdx = dx - cx
  const cdy = dy - cy
  const dax = ax - dx
  const day = ay - dy

  const abLenSq = abx * abx + aby * aby
  const bcLenSq = bcx * bcx + bcy * bcy
  const cdLenSq = cdx * cdx + cdy * cdy
  const daLenSq = dax * dax + day * day
  if (abLenSq === 0 || bcLenSq === 0 || cdLenSq === 0 || daLenSq === 0) {
    return false
  }

  const diagonalCenterDeltaX = ax + cx - (bx + dx)
  const diagonalCenterDeltaY = ay + cy - (by + dy)
  if (
    diagonalCenterDeltaX < -1 ||
    diagonalCenterDeltaX > 1 ||
    diagonalCenterDeltaY < -1 ||
    diagonalCenterDeltaY > 1
  ) {
    return false
  }

  const parallelScale0 = Math.max(1, abLenSq + cdLenSq)
  const parallelScale1 = Math.max(1, bcLenSq + daLenSq)
  const perpendicularScale = Math.max(1, abLenSq + bcLenSq)
  return (
    isNearlyCollinear(cross2(abx, aby, cdx, cdy), parallelScale0) &&
    isNearlyCollinear(cross2(bcx, bcy, dax, day), parallelScale1) &&
    isNearlyPerpendicular(dot2(abx, aby, bcx, bcy), perpendicularScale)
  )
}

function isLegacyOrthogonalContour(points: readonly number[]): boolean {
  const vertexCount = points.length >> 1
  if (vertexCount < 4) {
    return false
  }
  let previousAxis = -1
  for (let i = 0; i < points.length; i += 2) {
    const nextIndex = (i + 2) % points.length
    const dx = points[nextIndex] - points[i]
    const dy = points[nextIndex + 1] - points[i + 1]
    if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) {
      return false
    }
    const axis = dx === 0 ? 0 : 1
    if (axis === previousAxis) {
      return false
    }
    previousAxis = axis
  }
  return true
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function dot2(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by
}

function isNearlyCollinear(value: number, scale: number): boolean {
  const absValue = value < 0 ? -value : value
  return absValue * 128 <= scale
}

function isNearlyPerpendicular(value: number, scale: number): boolean {
  const absValue = value < 0 ? -value : value
  return absValue * 128 <= scale
}

function normalizeMapSettings(settings: MapSettings | undefined): MapSettings {
  const initialTimePhase = settings?.initialTimePhase
  return {
    initialTimePhase:
      initialTimePhase && MAP_TIME_PHASE_IDS.includes(initialTimePhase)
        ? initialTimePhase
        : DEFAULT_MAP_TIME_PHASE,
  }
}

function normalizeEditorMapData(data: EditorMapData): EditorMapData {
  const settings = normalizeMapSettings(data.settings)
  if (isMapDataFastNormalized(data)) {
    const normalizedTerrain = normalizeTerrainContourMetadata(data.terrain)
    if (
      normalizedTerrain === data.terrain &&
      data.settings?.initialTimePhase === settings.initialTimePhase
    ) {
      return data
    }
    return {
      ...data,
      settings,
      terrain: normalizedTerrain,
    }
  }
  const sourceVersion = data.version
  const shapes = Array.isArray(data.shapes) ? data.shapes : []
  const rawNpcs = data.npcs ?? data.enemies ?? []
  const terrainNormalization = normalizeMapTerrain(
    data.terrain,
    shapes,
    data.pixelsPerMeter
  )
  const editorTree = data.editorTree
    ? {
        ...data.editorTree,
        nodes: data.editorTree.nodes.map<EditorTreeNode>((node) => {
          if (node.type === 'enemy') {
            return { ...node, type: 'npc' }
          }
          if (node.type === 'ground' || node.type === 'obstacle') {
            const shapeIndex = node.index ?? -1
            const terrainIndex =
              shapeIndex >= 0 &&
              shapeIndex < terrainNormalization.legacyShapeProxyIndices.length
                ? terrainNormalization.legacyShapeProxyIndices[shapeIndex] >= 0
                  ? terrainNormalization.legacyShapeProxyIndices[shapeIndex]
                  : undefined
                : undefined
            return {
              ...node,
              type: 'terrain',
              index: terrainIndex,
            }
          }
          return { ...node, type: node.type }
        }),
      }
    : undefined

  return {
    ...data,
    version: 3,
    settings,
    player: normalizeMapPlayer(data.player),
    shapes: [],
    npcs: rawNpcs.map((npc) =>
      migrateLegacyNpcDrops(normalizeMapNpc(npc), sourceVersion)
    ),
    terrain: normalizeTerrainContourMetadata(terrainNormalization.terrain),
    npcTemplates: (data.npcTemplates ?? []).map((template) =>
      migrateLegacyNpcDrops(normalizeMapNpcTemplate(template), sourceVersion)
    ),
    editorTree,
  }
}

function isMapDataFastNormalized(data: EditorMapData): boolean {
  if (data.version !== 3) {
    return false
  }
  if ((data.shapes?.length ?? 0) > 0 || (data.enemies?.length ?? 0) > 0) {
    return false
  }
  if (
    data.terrain &&
    typeof data.terrain === 'object' &&
    data.terrain.version !== 4
  ) {
    return false
  }
  const editorTreeNodes = data.editorTree?.nodes
  if (editorTreeNodes && editorTreeNodes.length > 0) {
    for (let i = 0; i < editorTreeNodes.length; i++) {
      const nodeType = editorTreeNodes[i].type
      if (
        nodeType === 'enemy' ||
        nodeType === 'ground' ||
        nodeType === 'obstacle'
      ) {
        return false
      }
    }
  }
  const player = data.player
  if (player?.enemyFactions !== undefined) {
    return false
  }
  const npcs = data.npcs
  if (npcs && npcs.length > 0) {
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i]
      if (npc.enemyType !== undefined || npc.enemyFactions !== undefined) {
        return false
      }
    }
  }
  const npcTemplates = data.npcTemplates
  if (npcTemplates && npcTemplates.length > 0) {
    for (let i = 0; i < npcTemplates.length; i++) {
      const template = npcTemplates[i]
      if (
        template.enemyType !== undefined ||
        template.enemyFactions !== undefined
      ) {
        return false
      }
    }
  }
  return true
}

function normalizeMapTerrain(
  terrain: EditorMapData['terrain'],
  legacyShapes: ReadonlyArray<EditorMapData['shapes'][number]>,
  pixelsPerMeter: number
): {
  terrain: MapTerrainData | undefined
  legacyShapeProxyIndices: number[]
} {
  const shapeProxyIndices: number[] = []
  const chunkSize =
    terrain && terrain.chunkSize > 0
      ? Math.floor(terrain.chunkSize)
      : TERRAIN_CHUNK_SIZE
  const cellSize =
    terrain && terrain.cellSize > 0
      ? terrain.cellSize
      : TERRAIN_CELL_SIZE_METERS
  const randomSeed = terrain?.randomSeed ?? DEFAULT_TERRAIN_RANDOM_SEED
  const normalizeChunks = (
    chunks: ReadonlyArray<{
      chunkX: number
      chunkY: number
      cells: ArrayLike<number>
      materialCodes?: ArrayLike<number>
      siteJitter?: ArrayLike<number>
    }>
  ) =>
    chunks.map((chunk) => {
      const cellCount = chunkSize * chunkSize
      const cells = new Array<number>(cellCount)
      const materialCodes = getTerrainChunkMaterialCodes(chunk)
      for (let i = 0; i < cellCount; i++) {
        cells[i] = (materialCodes[i] ?? 0) | 0
      }
      const siteJitterSource =
        chunk.siteJitter && chunk.siteJitter.length === cellCount * 2
          ? chunk.siteJitter
          : createDefaultTerrainChunkSiteJitter(
              chunk.chunkX | 0,
              chunk.chunkY | 0,
              chunkSize,
              randomSeed
            )
      const siteJitter = new Array<number>(cellCount * 2)
      for (let i = 0; i < siteJitter.length; i++) {
        siteJitter[i] = siteJitterSource[i] | 0
      }
      return {
        chunkX: chunk.chunkX | 0,
        chunkY: chunk.chunkY | 0,
        cells,
        materialCodes: cells.slice(),
        siteJitter,
      }
    })
  const normalizedLayers =
    terrain?.layers && terrain.layers.length > 0
      ? terrain.layers
          .map((layer) => {
            const chunks = normalizeChunks(layer.chunks)
            if (chunks.length === 0) {
              return null
            }
            const materialId =
              layer.materialId ?? inferTerrainMaterialId(chunks)
            return {
              materialId,
              offsetCellX: layer.offsetCellX | 0,
              offsetCellY: layer.offsetCellY | 0,
              offsetXUnits: layer.offsetXUnits
                ? Math.round(layer.offsetXUnits)
                : 0,
              offsetYUnits: layer.offsetYUnits
                ? Math.round(layer.offsetYUnits)
                : 0,
              renderLayer:
                typeof layer.renderLayer === 'number'
                  ? layer.renderLayer | 0
                  : getDefaultTerrainRenderLayer(materialId),
              contourId:
                typeof layer.contourId === 'number'
                  ? layer.contourId | 0
                  : undefined,
              chunks,
            }
          })
          .filter((layer): layer is NonNullable<typeof layer> => layer !== null)
      : []
  if (normalizedLayers.length === 0) {
    if (!Array.isArray(terrain?.chunks) || terrain.chunks.length === 0) {
      if (!terrain?.contours || terrain.contours.length === 0) {
        if (legacyShapes.length === 0) {
          return {
            terrain: undefined,
            legacyShapeProxyIndices: shapeProxyIndices,
          }
        }
      } else {
        // noop
      }
    } else {
      const legacyChunks = normalizeChunks(terrain.chunks)
      if (legacyChunks.length > 0) {
        const materialId = inferTerrainMaterialId(legacyChunks)
        normalizedLayers.push({
          materialId,
          offsetCellX: 0,
          offsetCellY: 0,
          offsetXUnits: 0,
          offsetYUnits: 0,
          renderLayer: getDefaultTerrainRenderLayer(materialId),
          contourId: undefined,
          chunks: legacyChunks,
        })
      }
    }
  }
  const normalizedContours =
    terrain?.contours?.map((contour) => ({
      id: contour.id | 0,
      points: contour.points.map((value) => value | 0),
      fillMaterialId: contour.fillMaterialId,
      renderLayer:
        typeof contour.renderLayer === 'number'
          ? contour.renderLayer | 0
          : undefined,
      shapeKind: contour.shapeKind,
      straightEdge:
        typeof contour.straightEdge === 'boolean'
          ? contour.straightEdge
          : undefined,
    })) ?? []
  const visibleLayerCount = normalizedLayers.reduce(
    (count, layer) => count + ((layer.contourId ?? 0) > 0 ? 0 : 1),
    0
  )
  const nextContourId = normalizedContours.reduce(
    (maxId, contour) => Math.max(maxId, (contour.id | 0) + 1),
    1
  )
  const migratedShapes = migrateLegacyShapesToTerrain(
    legacyShapes,
    pixelsPerMeter,
    nextContourId,
    cellSize,
    chunkSize,
    randomSeed
  )
  for (let i = 0; i < migratedShapes.contourIndexByShape.length; i++) {
    const contourIndex = migratedShapes.contourIndexByShape[i]
    shapeProxyIndices.push(
      contourIndex >= 0
        ? visibleLayerCount + normalizedContours.length + contourIndex
        : -1
    )
  }
  if (
    normalizedLayers.length === 0 &&
    normalizedContours.length === 0 &&
    migratedShapes.layers.length === 0 &&
    migratedShapes.contours.length === 0
  ) {
    return {
      terrain: undefined,
      legacyShapeProxyIndices: shapeProxyIndices,
    }
  }
  return {
    terrain: {
      version: 4,
      cellSize,
      chunkSize,
      randomSeed,
      chunks: [],
      layers: [...normalizedLayers, ...migratedShapes.layers],
      contours: [...normalizedContours, ...migratedShapes.contours],
    },
    legacyShapeProxyIndices: shapeProxyIndices,
  }
}

function normalizeSaveNpcState(npc: SaveNpcState): SaveNpcState {
  return {
    ...npc,
    npcType: npc.npcType ?? npc.enemyType ?? ('default' as NpcType),
  }
}

function normalizeSaveData(saveData: SaveData): SaveData {
  const normalizedMapData = normalizeEditorMapData(saveData.mapData)
  const initialPlayerWeapons =
    saveData.worldStateReady === false
      ? createInitialSavePlayerWeaponState(normalizedMapData.player)
      : null
  const mainWeapon =
    saveData.player.mainWeapon ?? initialPlayerWeapons?.mainWeapon ?? null
  const secondaryWeapon =
    saveData.player.secondaryWeapon ??
    initialPlayerWeapons?.secondaryWeapon ??
    null
  let activeSlot = saveData.player.activeSlot

  if (saveData.worldStateReady === false) {
    if (activeSlot === 'main' && !mainWeapon && secondaryWeapon) {
      activeSlot = 'secondary'
    } else if (activeSlot === 'secondary' && !secondaryWeapon && mainWeapon) {
      activeSlot = 'main'
    }
  }

  return {
    ...saveData,
    mapData: normalizedMapData,
    timeCycleElapsedMs:
      typeof saveData.timeCycleElapsedMs === 'number' &&
      Number.isFinite(saveData.timeCycleElapsedMs)
        ? Math.max(0, Math.round(saveData.timeCycleElapsedMs))
        : undefined,
    player: {
      ...saveData.player,
      level: clampPlayerLevel(saveData.player.level),
      exp:
        typeof saveData.player.exp === 'number' &&
        Number.isFinite(saveData.player.exp) &&
        saveData.player.exp >= 0
          ? Math.round(saveData.player.exp)
          : 0,
      pendingUpgradePoints:
        typeof saveData.player.pendingUpgradePoints === 'number' &&
        Number.isFinite(saveData.player.pendingUpgradePoints) &&
        saveData.player.pendingUpgradePoints >= 0
          ? Math.round(saveData.player.pendingUpgradePoints)
          : 0,
      attackLevel: clampPlayerUpgradeLevel(saveData.player.attackLevel),
      defenseLevel: clampPlayerUpgradeLevel(saveData.player.defenseLevel),
      agilityLevel: clampPlayerUpgradeLevel(saveData.player.agilityLevel),
      toughnessLevel: clampPlayerUpgradeLevel(saveData.player.toughnessLevel),
      mainWeapon,
      secondaryWeapon,
      activeSlot,
    },
    npcs: (saveData.npcs ?? saveData.enemies ?? []).map(normalizeSaveNpcState),
    groundSunPickups: saveData.groundSunPickups ?? [],
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const db = await openDB()
    const saves = await new Promise<SaveMeta[]>((resolve) => {
      const tx = db.transaction(SAVE_META_STORE, 'readonly')
      const store = tx.objectStore(SAVE_META_STORE)
      const index = store.index('updatedAt')
      const request = index.openCursor(null, 'prev')

      const results: SaveMeta[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          results.push(cursor.value as SaveMeta)
          cursor.continue()
        } else {
          resolve(results)
        }
      }

      request.onerror = () => resolve([])
    })
    return applySaveMapThumbnailFallbacks(saves)
  } catch {
    return []
  }
}

async function applySaveMapThumbnailFallbacks(
  saves: SaveMeta[]
): Promise<SaveMeta[]> {
  if (saves.length === 0) {
    return saves
  }

  let needsFallback = false
  const mapIds = new Set<string>()
  for (let i = 0; i < saves.length; i++) {
    const save = saves[i]
    if (save.thumbnail && save.thumbnail.length > 0) {
      continue
    }
    if (typeof save.mapId !== 'string' || save.mapId.length === 0) {
      continue
    }
    needsFallback = true
    mapIds.add(save.mapId)
  }

  if (!needsFallback) {
    return saves
  }

  const mapThumbnails = await loadMapThumbnailLookup(mapIds)
  if (mapThumbnails.size === 0) {
    return saves
  }

  for (let i = 0; i < saves.length; i++) {
    const save = saves[i]
    if (save.thumbnail && save.thumbnail.length > 0) {
      continue
    }
    const thumbnail = mapThumbnails.get(save.mapId)
    if (thumbnail && thumbnail.length > 0) {
      saves[i] = {
        ...save,
        thumbnail,
      }
    }
  }

  return saves
}

async function loadMapThumbnailLookup(
  mapIds: ReadonlySet<string>
): Promise<Map<string, string>> {
  const thumbnails = new Map<string, string>()
  if (mapIds.size === 0) {
    return thumbnails
  }

  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(MAP_META_STORE, 'readonly')
      const store = tx.objectStore(MAP_META_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        const metas = request.result as EditorMapMeta[] | undefined
        if (metas) {
          for (let i = 0; i < metas.length; i++) {
            const meta = metas[i]
            if (
              mapIds.has(meta.id) &&
              meta.thumbnail &&
              meta.thumbnail.length > 0
            ) {
              thumbnails.set(meta.id, meta.thumbnail)
            }
          }
        }
        resolve()
      }
      request.onerror = () => resolve()
    })
  } catch {
    // Keep save thumbnails unchanged when map metadata cannot be read.
  }

  return thumbnails
}

export async function loadSaveData(saveId: string): Promise<SaveData | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(SAVE_DATA_STORE, 'readonly')
      const store = tx.objectStore(SAVE_DATA_STORE)
      const request = store.get(saveId)

      request.onsuccess = () => {
        const result = request.result as StoredSaveDataRecord | undefined
        if (!result || result.id !== saveId) {
          resolve(null)
          return
        }
        resolve(normalizeSaveData(result.data))
      }

      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function createSave(
  name: string,
  mapId: string,
  mapName: string,
  mapData: EditorMapData,
  playerMaxHealth: number
): Promise<SaveMeta | null> {
  try {
    const db = await openDB()
    const now = Date.now()
    const saveId = `save-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
    const initialPlayerWeapons = createInitialSavePlayerWeaponState(
      mapData.player
    )
    const initialPlayerFacing =
      typeof mapData.player?.facing === 'number' && mapData.player.facing < 0
        ? -1
        : 1

    const meta: SaveMeta = {
      id: saveId,
      name,
      createdAt: now,
      updatedAt: now,
      playTimeMs: 0,
      mapId,
      mapName,
      playerHealth: playerMaxHealth,
      playerMaxHealth,
      thumbnail: undefined,
    }

    const initialSaveData: SaveData = {
      version: 1,
      meta,
      mapId,
      mapData,
      playTimeMs: 0,
      worldStateReady: false,
      activeCheckpoint: null,
      player: {
        position: { x: mapData.playerSpawn.x, y: mapData.playerSpawn.y },
        facing: initialPlayerFacing,
        level: 1,
        exp: 0,
        pendingUpgradePoints: 0,
        attackLevel: 0,
        defenseLevel: 0,
        agilityLevel: 0,
        toughnessLevel: 0,
        health: playerMaxHealth,
        maxHealth: playerMaxHealth,
        posture: 100,
        maxPosture: 100,
        toughness: 100,
        maxToughness: 100,
        mainWeapon: initialPlayerWeapons.mainWeapon,
        secondaryWeapon: initialPlayerWeapons.secondaryWeapon,
        activeSlot: initialPlayerWeapons.activeSlot,
      },
      npcs: [],
      groundWeapons: [],
      groundSunPickups: [],
      camera: {
        x: mapData.camera.x,
        y: mapData.camera.y,
        zoom: mapData.camera.zoom,
      },
    }

    const dataRecord: StoredSaveDataRecord = {
      id: saveId,
      data: initialSaveData,
    }

    return new Promise((resolve) => {
      const tx = db.transaction([SAVE_META_STORE, SAVE_DATA_STORE], 'readwrite')
      tx.objectStore(SAVE_META_STORE).put(meta)
      tx.objectStore(SAVE_DATA_STORE).put(dataRecord)

      tx.oncomplete = () => resolve(meta)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function updateSave(saveData: SaveData): Promise<SaveMeta | null> {
  try {
    const db = await openDB()
    const now = Date.now()

    const meta: SaveMeta = {
      ...saveData.meta,
      updatedAt: now,
      playTimeMs: saveData.playTimeMs,
      playerHealth: saveData.player.health,
      playerMaxHealth: saveData.player.maxHealth,
      thumbnail: saveData.meta.thumbnail,
    }

    const updatedSaveData: SaveData = {
      ...saveData,
      meta,
    }

    const dataRecord: StoredSaveDataRecord = {
      id: saveData.meta.id,
      data: updatedSaveData,
    }

    return new Promise((resolve) => {
      const tx = db.transaction([SAVE_META_STORE, SAVE_DATA_STORE], 'readwrite')
      tx.objectStore(SAVE_META_STORE).put(meta)
      tx.objectStore(SAVE_DATA_STORE).put(dataRecord)

      tx.oncomplete = () => resolve(meta)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function deleteSave(saveId: string): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction([SAVE_META_STORE, SAVE_DATA_STORE], 'readwrite')
      tx.objectStore(SAVE_META_STORE).delete(saveId)
      tx.objectStore(SAVE_DATA_STORE).delete(saveId)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function hasSaves(): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(SAVE_META_STORE, 'readonly')
      const store = tx.objectStore(SAVE_META_STORE)
      const request = store.count()

      request.onsuccess = () => resolve(request.result > 0)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function getLastSaveId(): Promise<string | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly')
      const store = tx.objectStore(SETTINGS_STORE)
      const request = store.get(LAST_SAVE_KEY)

      request.onsuccess = () => {
        const result = request.result as string | undefined
        resolve(result ?? null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setLastSaveId(saveId: string): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(SETTINGS_STORE, 'readwrite')
    const store = tx.objectStore(SETTINGS_STORE)
    store.put(saveId, LAST_SAVE_KEY)
  } catch {
    // Ignore errors
  }
}

export async function loadEditorSetting<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly')
      const store = tx.objectStore(SETTINGS_STORE)
      const request = store.get(key)

      request.onsuccess = () => {
        const result = request.result as T | undefined
        resolve(result ?? null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveEditorSetting(
  key: string,
  value: unknown
): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite')
      tx.objectStore(SETTINGS_STORE).put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
  }
}
