import { type AsyncZippable, strFromU8, strToU8, unzip, zip } from 'fflate'

import type { EditorMapData, MapEnvironmentAsset } from './editorMapTypes'
import {
  loadEditorEnvironmentAssetBlob,
  saveEditorEnvironmentAsset,
} from './storage'

const MAP_JSON_PATH = 'map.json'
const ENVIRONMENT_ASSET_MANIFEST_PATH = 'environment-assets.json'
const ENVIRONMENT_ASSET_DIR = 'environment-assets/'
const PNG_MIME_TYPE = 'image/png'

interface ArchivedEnvironmentAsset {
  meta: MapEnvironmentAsset
  path: string
}

function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) {
        reject(error)
        return
      }
      resolve(data)
    })
  })
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) {
        reject(error)
        return
      }
      resolve(files)
    })
  })
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isEditorMapArchiveData(value: unknown): value is EditorMapData {
  if (!isObjectRecord(value)) {
    return false
  }
  const version = value.version
  return (
    (version === 1 || version === 2 || version === 3) &&
    typeof value.canvasWidth === 'number' &&
    typeof value.canvasHeight === 'number' &&
    typeof value.pixelsPerMeter === 'number' &&
    isObjectRecord(value.playerSpawn) &&
    isObjectRecord(value.camera) &&
    (Array.isArray(value.shapes) || value.shapes === undefined)
  )
}

function isEnvironmentAsset(value: unknown): value is MapEnvironmentAsset {
  return (
    isObjectRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  )
}

function isArchivedEnvironmentAsset(
  value: unknown
): value is ArchivedEnvironmentAsset {
  return (
    isObjectRecord(value) &&
    isEnvironmentAsset(value.meta) &&
    typeof value.path === 'string'
  )
}

function extractArchiveMapData(parsed: unknown): EditorMapData | null {
  if (isEditorMapArchiveData(parsed)) {
    return parsed
  }
  if (isObjectRecord(parsed) && isEditorMapArchiveData(parsed.map)) {
    return parsed.map
  }
  return null
}

function getReferencedEnvironmentAssetIds(data: EditorMapData): string[] {
  const objects = data.environmentObjects
  if (!objects || objects.length === 0) {
    return []
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]
    if (
      object.type !== 'custom' ||
      !object.assetId ||
      seen.has(object.assetId)
    ) {
      continue
    }
    seen.add(object.assetId)
    ids.push(object.assetId)
  }
  return ids
}

function createEnvironmentAssetPath(assetId: string): string {
  return `${ENVIRONMENT_ASSET_DIR}${encodeURIComponent(assetId)}.png`
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function appendEnvironmentAssetFiles(
  data: EditorMapData,
  files: AsyncZippable
): Promise<void> {
  const assetIds = getReferencedEnvironmentAssetIds(data)
  if (assetIds.length === 0) {
    return
  }
  const archivedAssets: ArchivedEnvironmentAsset[] = []
  for (let i = 0; i < assetIds.length; i++) {
    const stored = await loadEditorEnvironmentAssetBlob(assetIds[i])
    if (!stored) {
      continue
    }
    const path = createEnvironmentAssetPath(stored.asset.id)
    const meta: MapEnvironmentAsset = {
      ...stored.asset,
      mimeType: PNG_MIME_TYPE,
    }
    archivedAssets.push({ meta, path })
    files[path] = [await blobToUint8Array(stored.blob), { level: 0 }]
  }
  if (archivedAssets.length > 0) {
    files[ENVIRONMENT_ASSET_MANIFEST_PATH] = [
      strToU8(JSON.stringify(archivedAssets, null, 2)),
      { level: 6 },
    ]
  }
}

function parseEnvironmentAssetManifest(
  files: Record<string, Uint8Array>
): ArchivedEnvironmentAsset[] {
  const manifestFile = files[ENVIRONMENT_ASSET_MANIFEST_PATH]
  if (!manifestFile) {
    return []
  }
  const parsed = JSON.parse(strFromU8(manifestFile)) as unknown
  if (!Array.isArray(parsed)) {
    return []
  }
  const assets: ArchivedEnvironmentAsset[] = []
  for (let i = 0; i < parsed.length; i++) {
    const asset = parsed[i]
    if (isArchivedEnvironmentAsset(asset)) {
      assets.push(asset)
    }
  }
  return assets
}

async function restoreEnvironmentAssets(
  files: Record<string, Uint8Array>
): Promise<void> {
  const archivedAssets = parseEnvironmentAssetManifest(files)
  for (let i = 0; i < archivedAssets.length; i++) {
    const asset = archivedAssets[i]
    const data = files[asset.path]
    if (!data) {
      continue
    }
    const blob = new Blob([copyToArrayBuffer(data)], { type: PNG_MIME_TYPE })
    await saveEditorEnvironmentAsset(
      {
        ...asset.meta,
        mimeType: PNG_MIME_TYPE,
      },
      blob
    )
  }
}

function findMapJsonFile(files: Record<string, Uint8Array>): Uint8Array | null {
  const direct = files[MAP_JSON_PATH]
  if (direct) {
    return direct
  }
  const fileNames = Object.keys(files)
  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i]
    if (fileName.toLowerCase().endsWith('.json')) {
      return files[fileName]
    }
  }
  return null
}

export async function packEditorMapData(data: EditorMapData): Promise<Blob> {
  const files: AsyncZippable = {
    [MAP_JSON_PATH]: [strToU8(JSON.stringify(data, null, 2)), { level: 6 }],
  }
  await appendEnvironmentAssetFiles(data, files)
  const zipped = await zipAsync(files)
  return new Blob([copyToArrayBuffer(zipped)], { type: 'application/zip' })
}

export async function unpackEditorMapData(
  archiveBytes: Uint8Array
): Promise<EditorMapData | null> {
  const files = await unzipAsync(archiveBytes)
  const mapJson = findMapJsonFile(files)
  if (!mapJson) {
    return null
  }
  const parsed = JSON.parse(strFromU8(mapJson)) as unknown
  const data = extractArchiveMapData(parsed)
  if (!data) {
    return null
  }
  await restoreEnvironmentAssets(files)
  return data
}
