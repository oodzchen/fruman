import { SetupPoseBoundsProvider, Spine } from '@esotericsoftware/spine-pixi-v8'
import { Assets } from 'pixi.js'

interface SpineRegistration {
  skeletonKey: string
  atlasKey: string
  pool: Spine[]
  boundsWidthPx: number
  boundsHeightPx: number
  boundsOffsetX: number
  boundsOffsetY: number
}

const entries = new Map<string, SpineRegistration>()
const previewCanvases = new Map<string, HTMLCanvasElement>()

export async function loadSpineAssets(
  skeletonKey: string,
  skeletonSrc: string,
  atlasKey: string,
  atlasSrc: string
): Promise<void> {
  await Assets.load([
    { alias: skeletonKey, src: skeletonSrc },
    { alias: atlasKey, src: atlasSrc },
  ])
  if (!entries.has(skeletonKey)) {
    entries.set(skeletonKey, {
      skeletonKey,
      atlasKey,
      pool: [],
      boundsWidthPx: 0,
      boundsHeightPx: 0,
      boundsOffsetX: 0,
      boundsOffsetY: 0,
    })
  }
}

export function isSpineLoaded(skeletonKey: string): boolean {
  return entries.has(skeletonKey)
}

function createSpineInstance(reg: SpineRegistration): Spine {
  return Spine.from({
    skeleton: reg.skeletonKey,
    atlas: reg.atlasKey,
    autoUpdate: false,
    boundsProvider: new SetupPoseBoundsProvider(),
  })
}

function ensureSpineBoundsMeasured(reg: SpineRegistration): void {
  if (reg.boundsWidthPx > 0 && reg.boundsHeightPx > 0) {
    return
  }

  const temp = createSpineInstance(reg)
  temp.scale.set(1)
  temp.update(0)
  const b = temp.bounds
  reg.boundsWidthPx = b.width
  reg.boundsHeightPx = b.height
  reg.boundsOffsetX = b.x
  reg.boundsOffsetY = b.y
  releaseSpine(reg.skeletonKey, temp)
}

export function acquireSpine(skeletonKey: string): Spine | null {
  const reg = entries.get(skeletonKey)
  if (!reg) return null
  return reg.pool.pop() ?? createSpineInstance(reg)
}

export function releaseSpine(skeletonKey: string, spine: Spine): void {
  const reg = entries.get(skeletonKey)
  if (!reg) return
  spine.visible = false
  if (spine.parent) {
    spine.parent.removeChild(spine)
  }
  reg.pool.push(spine)
}

export function storeSpinePreview(
  skeletonKey: string,
  canvas: HTMLCanvasElement
): void {
  previewCanvases.set(skeletonKey, canvas)
}

export function getSpinePreviewCanvas(
  skeletonKey: string
): HTMLCanvasElement | null {
  return previewCanvases.get(skeletonKey) ?? null
}

export function getSpinePreviewMatchedScale(
  skeletonKey: string,
  fallbackScale: number
): number {
  const reg = entries.get(skeletonKey)
  const preview = previewCanvases.get(skeletonKey)
  if (!reg || !preview) {
    return fallbackScale
  }

  ensureSpineBoundsMeasured(reg)
  if (!(reg.boundsWidthPx > 0) || !(reg.boundsHeightPx > 0)) {
    return fallbackScale
  }

  const widthScale = preview.width / reg.boundsWidthPx
  const heightScale = preview.height / reg.boundsHeightPx
  if (!(widthScale > 0) || !(heightScale > 0)) {
    return fallbackScale
  }

  return (widthScale + heightScale) * 0.5
}

/**
 * 在指定缩放下获取 spine 的像素包围盒（setup pose）。
 * 首次调用时会创建一个临时实例进行测量并缓存结果。
 */
export function getSpineBoundsAtScale(
  skeletonKey: string,
  scale: number
): { width: number; height: number; offsetX: number; offsetY: number } {
  const reg = entries.get(skeletonKey)
  if (!reg) return { width: 0, height: 0, offsetX: 0, offsetY: 0 }

  ensureSpineBoundsMeasured(reg)

  return {
    width: reg.boundsWidthPx * scale,
    height: reg.boundsHeightPx * scale,
    offsetX: reg.boundsOffsetX * scale,
    offsetY: reg.boundsOffsetY * scale,
  }
}
