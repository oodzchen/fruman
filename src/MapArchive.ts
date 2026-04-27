import { type AsyncZippable, strFromU8, strToU8, unzip, zip } from 'fflate'

import type { EditorMapData, MapEnvironmentAsset } from './editorMapTypes'
import {
  type ArchivedEnvironmentAsset,
  ENVIRONMENT_ASSET_DIR,
  ENVIRONMENT_ASSET_MANIFEST_PATH,
  MAP_JSON_PATH,
  MAP_META_JSON_PATH,
  PNG_MIME_TYPE,
  createEditorMapArchiveMeta,
  extractArchiveMapData,
  extractArchiveMapName,
  findMapJsonFile,
  findMapMetaJsonFile,
  isArchivedEnvironmentAsset,
} from './mapDataValidation'
import {
  loadEditorEnvironmentAssetBlob,
  saveEditorEnvironmentAsset,
} from './storage'

export { isEditorMapArchiveData } from './mapDataValidation'

export interface UnpackedEditorMapArchive {
  data: EditorMapData
  name: string | null
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

export async function packEditorMapData(
  data: EditorMapData,
  name?: string
): Promise<Blob> {
  const files: AsyncZippable = {
    [MAP_JSON_PATH]: [strToU8(JSON.stringify(data, null, 2)), { level: 6 }],
  }
  const meta = createEditorMapArchiveMeta(name)
  if (meta) {
    files[MAP_META_JSON_PATH] = [
      strToU8(JSON.stringify(meta, null, 2)),
      { level: 6 },
    ]
  }
  await appendEnvironmentAssetFiles(data, files)
  const zipped = await zipAsync(files)
  return new Blob([copyToArrayBuffer(zipped)], { type: 'application/zip' })
}

export async function unpackEditorMapArchive(
  archiveBytes: Uint8Array
): Promise<UnpackedEditorMapArchive | null> {
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
  let name = extractArchiveMapName(parsed)
  const metaJson = findMapMetaJsonFile(files)
  if (metaJson) {
    try {
      name =
        extractArchiveMapName(JSON.parse(strFromU8(metaJson)) as unknown) ??
        name
    } catch {}
  }
  await restoreEnvironmentAssets(files)
  return { data, name }
}

export async function unpackEditorMapData(
  archiveBytes: Uint8Array
): Promise<EditorMapData | null> {
  const archive = await unpackEditorMapArchive(archiveBytes)
  return archive?.data ?? null
}
