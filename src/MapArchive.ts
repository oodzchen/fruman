import { type AsyncZippable, strFromU8, strToU8, unzip, zip } from 'fflate'

import type { EditorMapData, MapCharacterBodyProfile } from './editorMapTypes'

const MAP_JSON_PATH = 'map.json'
const ASSET_DIR = 'assets/'
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'
const DATA_URL_PREFIX = 'data:'
const ASSET_NAME_PADDING = 4

type ProfileAssetKey =
  | 'surfaceDataUrl'
  | 'textureDataUrl'
  | 'skeletalSurfaceDataUrl'

type ProfileAssetOwner = {
  bodyProfile?: MapCharacterBodyProfile
}

type ArchiveAsset = {
  path: string
  data: Uint8Array
}

const PROFILE_ASSET_KEYS: readonly ProfileAssetKey[] = [
  'surfaceDataUrl',
  'textureDataUrl',
  'skeletalSurfaceDataUrl',
]

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

function extractArchiveMapData(parsed: unknown): EditorMapData | null {
  if (isEditorMapArchiveData(parsed)) {
    return parsed
  }
  if (isObjectRecord(parsed) && isEditorMapArchiveData(parsed.map)) {
    return parsed.map
  }
  return null
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    return null
  }
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) {
    return null
  }
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase()
  const payload = dataUrl.slice(commaIndex + 1)
  if (metadata.endsWith(';base64')) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return strToU8(decodeURIComponent(payload))
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    let chunkBinary = ''
    for (let j = 0; j < chunk.length; j++) {
      chunkBinary += String.fromCharCode(chunk[j])
    }
    binary += chunkBinary
  }
  return btoa(binary)
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

async function convertImageDataUrlToPngBytes(
  dataUrl: string
): Promise<Uint8Array | null> {
  const image = await loadImage(dataUrl)
  if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.drawImage(image, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) {
    return null
  }
  return new Uint8Array(await blob.arrayBuffer())
}

async function readPngAssetBytes(dataUrl: string): Promise<Uint8Array | null> {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    return null
  }
  if (dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return dataUrlToBytes(dataUrl)
  }
  return convertImageDataUrlToPngBytes(dataUrl)
}

function createAssetPath(index: number): string {
  return `${ASSET_DIR}image-${index.toString().padStart(ASSET_NAME_PADDING, '0')}.png`
}

function getProfileOwners(data: EditorMapData): ProfileAssetOwner[] {
  const owners: ProfileAssetOwner[] = []
  if (data.player) {
    owners.push(data.player)
  }
  owners.push(...data.npcs)
  if (data.enemies) {
    owners.push(...data.enemies)
  }
  if (data.npcTemplates) {
    owners.push(...data.npcTemplates)
  }
  return owners
}

async function extractProfileAssets(
  profile: MapCharacterBodyProfile,
  pathByDataUrl: Map<string, string>,
  assets: ArchiveAsset[]
): Promise<void> {
  const registerAsset = async (dataUrl: string): Promise<string | null> => {
    const cachedPath = pathByDataUrl.get(dataUrl)
    if (cachedPath) {
      return cachedPath
    }
    const bytes = await readPngAssetBytes(dataUrl)
    if (!bytes) {
      return null
    }
    const path = createAssetPath(assets.length + 1)
    pathByDataUrl.set(dataUrl, path)
    assets.push({ path, data: bytes })
    return path
  }

  for (let i = 0; i < PROFILE_ASSET_KEYS.length; i++) {
    const key = PROFILE_ASSET_KEYS[i]
    const value = profile[key]
    if (typeof value !== 'string' || !value.startsWith(DATA_URL_PREFIX)) {
      continue
    }
    const path = await registerAsset(value)
    if (path) {
      profile[key] = path
    }
  }

  const layers = profile.layers
  if (layers) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (!layer.dataUrl.startsWith(DATA_URL_PREFIX)) {
        continue
      }
      const path = await registerAsset(layer.dataUrl)
      if (path) {
        layer.dataUrl = path
      }
    }
  }

  const boneSegments = profile.boneSegments
  if (boneSegments) {
    for (let i = 0; i < boneSegments.length; i++) {
      const segment = boneSegments[i]
      const value = segment.shapeDataUrl
      if (typeof value !== 'string' || !value.startsWith(DATA_URL_PREFIX)) {
        continue
      }
      const path = await registerAsset(value)
      if (path) {
        segment.shapeDataUrl = path
      }
    }
  }
}

async function extractMapAssets(data: EditorMapData): Promise<ArchiveAsset[]> {
  const assets: ArchiveAsset[] = []
  const pathByDataUrl = new Map<string, string>()
  const owners = getProfileOwners(data)
  for (let i = 0; i < owners.length; i++) {
    const profile = owners[i].bodyProfile
    if (!profile) {
      continue
    }
    await extractProfileAssets(profile, pathByDataUrl, assets)
  }
  return assets
}

function resolveAssetDataUrl(
  value: string,
  files: Record<string, Uint8Array>
): string | null {
  if (value.startsWith(DATA_URL_PREFIX)) {
    return value
  }
  if (!value.startsWith(ASSET_DIR)) {
    return null
  }
  const asset = files[value]
  if (!asset) {
    return null
  }
  return `${PNG_DATA_URL_PREFIX}${bytesToBase64(asset)}`
}

function restoreProfileAssets(
  profile: MapCharacterBodyProfile,
  files: Record<string, Uint8Array>
): boolean {
  for (let i = 0; i < PROFILE_ASSET_KEYS.length; i++) {
    const key = PROFILE_ASSET_KEYS[i]
    const value = profile[key]
    if (typeof value !== 'string') {
      continue
    }
    const dataUrl = resolveAssetDataUrl(value, files)
    if (!dataUrl) {
      if (value.startsWith(ASSET_DIR)) {
        return false
      }
      continue
    }
    profile[key] = dataUrl
  }

  const layers = profile.layers
  if (layers) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const dataUrl = resolveAssetDataUrl(layer.dataUrl, files)
      if (!dataUrl) {
        if (layer.dataUrl.startsWith(ASSET_DIR)) {
          return false
        }
        continue
      }
      layer.dataUrl = dataUrl
    }
  }

  const boneSegments = profile.boneSegments
  if (boneSegments) {
    for (let i = 0; i < boneSegments.length; i++) {
      const segment = boneSegments[i]
      const value = segment.shapeDataUrl
      if (typeof value !== 'string') {
        continue
      }
      const dataUrl = resolveAssetDataUrl(value, files)
      if (!dataUrl) {
        if (value.startsWith(ASSET_DIR)) {
          return false
        }
        continue
      }
      segment.shapeDataUrl = dataUrl
    }
  }

  return true
}

function restoreMapAssets(
  data: EditorMapData,
  files: Record<string, Uint8Array>
): boolean {
  const owners = getProfileOwners(data)
  for (let i = 0; i < owners.length; i++) {
    const profile = owners[i].bodyProfile
    if (!profile) {
      continue
    }
    if (!restoreProfileAssets(profile, files)) {
      return false
    }
  }
  return true
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

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export async function packEditorMapData(data: EditorMapData): Promise<Blob> {
  const exportData = structuredClone(data)
  const assets = await extractMapAssets(exportData)
  const files: AsyncZippable = {
    [MAP_JSON_PATH]: [
      strToU8(JSON.stringify(exportData, null, 2)),
      { level: 6 },
    ],
  }
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    files[asset.path] = [asset.data, { level: 0 }]
  }
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
  if (!restoreMapAssets(data, files)) {
    return null
  }
  return data
}
