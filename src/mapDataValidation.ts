import { strFromU8 } from 'fflate'

import type { EditorMapData, MapEnvironmentAsset } from './editorMapTypes'

export const MAP_JSON_PATH = 'map.json'
export const MAP_META_JSON_PATH = 'map-meta.json'
export const ENVIRONMENT_ASSET_MANIFEST_PATH = 'environment-assets.json'
export const ENVIRONMENT_ASSET_DIR = 'environment-assets/'
export const PNG_MIME_TYPE = 'image/png'

export interface ArchivedEnvironmentAsset {
  meta: MapEnvironmentAsset
  path: string
}

export interface EditorMapArchiveMeta {
  version: 1
  name?: string
}

export function isObjectRecord(
  value: unknown
): value is Record<string, unknown> {
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

export function isEnvironmentAsset(
  value: unknown
): value is MapEnvironmentAsset {
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

export function isArchivedEnvironmentAsset(
  value: unknown
): value is ArchivedEnvironmentAsset {
  return (
    isObjectRecord(value) &&
    isEnvironmentAsset(value.meta) &&
    typeof value.path === 'string'
  )
}

export function extractArchiveMapData(parsed: unknown): EditorMapData | null {
  if (isEditorMapArchiveData(parsed)) {
    return parsed
  }
  if (isObjectRecord(parsed) && isEditorMapArchiveData(parsed.map)) {
    return parsed.map
  }
  return null
}

export function extractArchiveMapName(parsed: unknown): string | null {
  if (!isObjectRecord(parsed)) {
    return null
  }
  const name = parsed.name
  return typeof name === 'string' && name.length > 0 ? name : null
}

export function createEditorMapArchiveMeta(
  name: string | null | undefined
): EditorMapArchiveMeta | null {
  if (!name || name.length === 0) {
    return null
  }
  return {
    version: 1,
    name,
  }
}

export function findMapJsonFile(
  files: Record<string, Uint8Array>
): Uint8Array | null {
  const direct = files[MAP_JSON_PATH]
  if (direct) {
    return direct
  }

  const fileNames = Object.keys(files)
  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i]
    if (fileName.toLowerCase().endsWith(`/${MAP_JSON_PATH}`)) {
      return files[fileName]
    }
  }

  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i]
    const lowerName = fileName.toLowerCase()
    if (
      lowerName.endsWith('.json') &&
      !lowerName.endsWith(ENVIRONMENT_ASSET_MANIFEST_PATH)
    ) {
      return files[fileName]
    }
  }

  return null
}

export function findMapMetaJsonFile(
  files: Record<string, Uint8Array>
): Uint8Array | null {
  const direct = files[MAP_META_JSON_PATH]
  if (direct) {
    return direct
  }

  const fileNames = Object.keys(files)
  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i]
    if (fileName.toLowerCase().endsWith(`/${MAP_META_JSON_PATH}`)) {
      return files[fileName]
    }
  }

  return null
}

export function parseMapJsonBytes(bytes: Uint8Array): EditorMapData | null {
  const parsed = JSON.parse(strFromU8(bytes)) as unknown
  return extractArchiveMapData(parsed)
}

export function parseMapMetaJsonBytes(bytes: Uint8Array): string | null {
  const parsed = JSON.parse(strFromU8(bytes)) as unknown
  return extractArchiveMapName(parsed)
}
