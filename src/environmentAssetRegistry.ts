import type { EditorMapData, MapEnvironmentAsset } from './editorMapTypes'
import {
  deleteEditorEnvironmentAsset,
  loadEditorEnvironmentAssetBlob,
  saveEditorEnvironmentAsset,
} from './storage'

const ENVIRONMENT_ASSET_MAX_SIDE_PX = 2048
const ENVIRONMENT_ASSET_MIME_TYPE = 'image/png'

export interface RuntimeEnvironmentAsset {
  meta: MapEnvironmentAsset
  canvas: HTMLCanvasElement
}

export interface RuntimeEnvironmentAssetPreloadResult {
  requested: number
  loaded: number
}

const runtimeAssets = new Map<string, RuntimeEnvironmentAsset>()

function createEnvironmentAssetId(now: number): string {
  const randomPart = Math.floor(Math.random() * 0x7fffffff).toString(36)
  return `env-asset-${now.toString(36)}-${randomPart}`
}

function createImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(blob)
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Unable to load image asset.'))
    }
    image.src = url
  })
}

function resolveNormalizedSize(
  width: number,
  height: number
): { width: number; height: number } {
  if (
    width <= 0 ||
    height <= 0 ||
    (width <= ENVIRONMENT_ASSET_MAX_SIDE_PX &&
      height <= ENVIRONMENT_ASSET_MAX_SIDE_PX)
  ) {
    return {
      width: Math.max(1, width | 0),
      height: Math.max(1, height | 0),
    }
  }

  if (width >= height) {
    return {
      width: ENVIRONMENT_ASSET_MAX_SIDE_PX,
      height: Math.max(
        1,
        Math.floor(
          (height * ENVIRONMENT_ASSET_MAX_SIDE_PX + Math.floor(width / 2)) /
            width
        )
      ),
    }
  }

  return {
    width: Math.max(
      1,
      Math.floor(
        (width * ENVIRONMENT_ASSET_MAX_SIDE_PX + Math.floor(height / 2)) /
          height
      )
    ),
    height: ENVIRONMENT_ASSET_MAX_SIDE_PX,
  }
}

function drawImageToCanvas(
  image: HTMLImageElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
  }
  return canvas
}

function encodeCanvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), ENVIRONMENT_ASSET_MIME_TYPE)
  })
}

export function getRuntimeEnvironmentAsset(
  assetId: string | undefined
): RuntimeEnvironmentAsset | null {
  if (!assetId) {
    return null
  }
  return runtimeAssets.get(assetId) ?? null
}

export function setRuntimeEnvironmentAsset(
  meta: MapEnvironmentAsset,
  canvas: HTMLCanvasElement
): RuntimeEnvironmentAsset {
  const runtime: RuntimeEnvironmentAsset = { meta, canvas }
  runtimeAssets.set(meta.id, runtime)
  return runtime
}

export async function ensureRuntimeEnvironmentAsset(
  assetId: string
): Promise<RuntimeEnvironmentAsset | null> {
  const cached = runtimeAssets.get(assetId)
  if (cached) {
    return cached
  }

  const stored = await loadEditorEnvironmentAssetBlob(assetId)
  if (!stored) {
    return null
  }

  let image: HTMLImageElement
  try {
    image = await createImageFromBlob(stored.blob)
  } catch {
    return null
  }
  const canvas = drawImageToCanvas(
    image,
    stored.asset.width,
    stored.asset.height
  )
  return setRuntimeEnvironmentAsset(stored.asset, canvas)
}

export async function ensureRuntimeEnvironmentAssetsForMap(
  data: EditorMapData | null | undefined
): Promise<RuntimeEnvironmentAssetPreloadResult> {
  const result: RuntimeEnvironmentAssetPreloadResult = {
    requested: 0,
    loaded: 0,
  }
  const objects = data?.environmentObjects
  if (!objects || objects.length === 0) {
    return result
  }

  const assetIds: string[] = []
  const seenAssetIds = new Set<string>()
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]
    if (
      object.type !== 'custom' ||
      !object.assetId ||
      seenAssetIds.has(object.assetId)
    ) {
      continue
    }
    seenAssetIds.add(object.assetId)
    assetIds.push(object.assetId)
  }

  result.requested = assetIds.length
  for (let i = 0; i < assetIds.length; i++) {
    const asset = await ensureRuntimeEnvironmentAsset(assetIds[i])
    if (asset) {
      result.loaded += 1
    }
  }
  return result
}

export async function createEnvironmentAssetFromImageFile(
  name: string,
  file: File
): Promise<RuntimeEnvironmentAsset | null> {
  const image = await createImageFromBlob(file)
  const size = resolveNormalizedSize(image.naturalWidth, image.naturalHeight)
  const canvas = drawImageToCanvas(image, size.width, size.height)
  const blob = await encodeCanvasPng(canvas)
  if (!blob) {
    return null
  }

  const now = Date.now()
  const meta: MapEnvironmentAsset = {
    id: createEnvironmentAssetId(now),
    name,
    mimeType: ENVIRONMENT_ASSET_MIME_TYPE,
    width: size.width,
    height: size.height,
    createdAt: now,
    updatedAt: now,
  }
  const saved = await saveEditorEnvironmentAsset(meta, blob)
  if (!saved) {
    return null
  }
  return setRuntimeEnvironmentAsset(saved, canvas)
}

export async function updateEnvironmentAsset(
  current: MapEnvironmentAsset,
  name: string,
  file: File | null
): Promise<RuntimeEnvironmentAsset | null> {
  let canvas = runtimeAssets.get(current.id)?.canvas ?? null
  let blob: Blob | null = null
  let width = current.width
  let height = current.height

  if (file) {
    const image = await createImageFromBlob(file)
    const size = resolveNormalizedSize(image.naturalWidth, image.naturalHeight)
    canvas = drawImageToCanvas(image, size.width, size.height)
    blob = await encodeCanvasPng(canvas)
    width = size.width
    height = size.height
  } else {
    const stored = await loadEditorEnvironmentAssetBlob(current.id)
    if (!stored) {
      return null
    }
    blob = stored.blob
    if (!canvas) {
      const image = await createImageFromBlob(blob)
      canvas = drawImageToCanvas(image, stored.asset.width, stored.asset.height)
    }
  }

  if (!blob || !canvas) {
    return null
  }

  const updated: MapEnvironmentAsset = {
    ...current,
    name,
    width,
    height,
    mimeType: ENVIRONMENT_ASSET_MIME_TYPE,
    updatedAt: Date.now(),
  }
  const saved = await saveEditorEnvironmentAsset(updated, blob)
  if (!saved) {
    return null
  }
  return setRuntimeEnvironmentAsset(saved, canvas)
}

export async function deleteEnvironmentAsset(
  assetId: string
): Promise<boolean> {
  const deleted = await deleteEditorEnvironmentAsset(assetId)
  if (deleted) {
    runtimeAssets.delete(assetId)
  }
  return deleted
}
