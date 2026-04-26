import {
  drawCharacterBrowGeometry,
  drawCharacterEyeGeometry,
  getCharacterBrowBounds,
  getCharacterBrowGeometry,
  getCharacterEyeBounds,
  getCharacterEyeGeometry,
} from '../../characterBodyProfile'
import {
  DEFAULT_CHARACTER_BROW_OFFSET_X,
  DEFAULT_CHARACTER_BROW_OFFSET_Y,
  DEFAULT_CHARACTER_BROW_ROTATION_DEG,
  DEFAULT_CHARACTER_BROW_SCALE,
  DEFAULT_CHARACTER_BROW_STYLE,
  DEFAULT_CHARACTER_EYE_ROTATION_DEG,
  DEFAULT_CHARACTER_EYE_SCALE,
  DEFAULT_CHARACTER_EYE_STYLE,
} from '../../characterBodyProfile'
import type {
  BoneSegment,
  MapCharacterBodyBrowStyle,
  MapCharacterBodyCollisionShape,
  MapCharacterBodyEyeStyle,
  MapCharacterBodyProfile,
  MapCharacterBodyVisualLayer,
} from '../../editorMapTypes'
import { deriveSkeletalBodyGeometry } from '../../skeletalBodyProfile'
import {
  centerLoop,
  extractMaskLoops,
  limitEditorLoopPoints,
  pickLargestLoop,
  readAlphaBounds,
  readMaskFill,
} from './EditorBodyDrawerGeometry'
import { mirrorLocalPoints } from './EditorBodyDrawerPresets'
import type { EditorBodyLayer } from './EditorBodyDrawerTypes'
import {
  CUSTOM_BODY_PRESET_ID,
  DRAW_WORLD_SIZE,
  MASK_ALPHA_THRESHOLD,
  MAX_PROFILE_POINTS,
} from './EditorBodyDrawerTypes'
import type { EditorCharacterBodyPresetId } from './EditorBodyDrawerTypes'
import { TRANSPARENT_BODY_COLOR } from './EditorBodyDrawerTypes'

function readCroppedCanvasDataUrl(
  outputCtx: CanvasRenderingContext2D,
  width: number,
  height: number
): string | null {
  const alpha = outputCtx.getImageData(0, 0, width, height).data
  for (let i = 3; i < alpha.length; i += 4) {
    if (alpha[i] >= MASK_ALPHA_THRESHOLD) {
      return outputCtx.canvas.toDataURL('image/png')
    }
  }
  return null
}

export function buildSurfaceDataUrl(
  shapeCtx: CanvasRenderingContext2D,
  textureCtx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  mirrorHorizontally: boolean
): string | null {
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width
  outputCanvas.height = height
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) {
    return null
  }
  outputCtx.clearRect(0, 0, width, height)
  if (mirrorHorizontally) {
    outputCtx.save()
    outputCtx.translate(width, 0)
    outputCtx.scale(-1, 1)
  }
  outputCtx.drawImage(
    shapeCtx.canvas,
    minX,
    minY,
    width,
    height,
    0,
    0,
    width,
    height
  )
  outputCtx.globalCompositeOperation = 'source-atop'
  outputCtx.drawImage(
    textureCtx.canvas,
    minX,
    minY,
    width,
    height,
    0,
    0,
    width,
    height
  )
  if (mirrorHorizontally) {
    outputCtx.restore()
  }
  outputCtx.globalCompositeOperation = 'source-over'
  return readCroppedCanvasDataUrl(outputCtx, width, height)
}

export function cropCanvasDataUrl(
  source: CanvasImageSource,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  mirrorHorizontally = false
): string | null {
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width
  outputCanvas.height = height
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) {
    return null
  }
  outputCtx.clearRect(0, 0, width, height)
  if (mirrorHorizontally) {
    outputCtx.save()
    outputCtx.translate(width, 0)
    outputCtx.scale(-1, 1)
  }
  outputCtx.drawImage(source, minX, minY, width, height, 0, 0, width, height)
  if (mirrorHorizontally) {
    outputCtx.restore()
  }
  return readCroppedCanvasDataUrl(outputCtx, width, height)
}

export function drawMergedSurface(
  compositeCtx: CanvasRenderingContext2D,
  shapeCtx: CanvasRenderingContext2D,
  textureCtx: CanvasRenderingContext2D,
  browCtx: CanvasRenderingContext2D,
  layers: EditorBodyLayer[],
  coreCenterX: number,
  coreCenterY: number,
  eyeX: number,
  eyeY: number,
  eyeScaleX: number,
  eyeScaleY: number,
  eyeRotationDeg: number,
  eyeStyle: MapCharacterBodyEyeStyle,
  browStyle: MapCharacterBodyBrowStyle,
  editorFacing: number,
  browOffsetX: number,
  browOffsetY: number,
  browScaleX: number,
  browScaleY: number,
  browRotationDeg: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let mergedBounds = readAlphaBounds(shapeCtx, DRAW_WORLD_SIZE)
  compositeCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
  compositeCtx.drawImage(shapeCtx.canvas, 0, 0)
  compositeCtx.save()
  compositeCtx.globalCompositeOperation = 'source-atop'
  compositeCtx.drawImage(textureCtx.canvas, 0, 0)
  compositeCtx.restore()
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (layer.kind === 'core') {
      continue
    }
    if (layer.kind === 'eye') {
      const eyeGeometry = getCharacterEyeGeometry(
        coreCenterX + eyeX,
        coreCenterY + eyeY,
        editorFacing,
        eyeScaleX,
        eyeScaleY,
        eyeStyle,
        eyeRotationDeg
      )
      drawCharacterEyeGeometry(compositeCtx, eyeGeometry, '#17120e')
      const eyeBounds = getCharacterEyeBounds(eyeGeometry)
      const eyeMinX = eyeBounds.minX
      const eyeMinY = eyeBounds.minY
      const eyeMaxX = eyeBounds.maxX
      const eyeMaxY = eyeBounds.maxY
      if (!mergedBounds) {
        mergedBounds = {
          minX: eyeMinX,
          minY: eyeMinY,
          maxX: eyeMaxX,
          maxY: eyeMaxY,
        }
      } else {
        if (eyeMinX < mergedBounds.minX) {
          mergedBounds.minX = eyeMinX
        }
        if (eyeMinY < mergedBounds.minY) {
          mergedBounds.minY = eyeMinY
        }
        if (eyeMaxX > mergedBounds.maxX) {
          mergedBounds.maxX = eyeMaxX
        }
        if (eyeMaxY > mergedBounds.maxY) {
          mergedBounds.maxY = eyeMaxY
        }
      }
      continue
    }
    if (layer.kind === 'brow') {
      if (browStyle !== 'custom' && browStyle !== 'none') {
        const eyeGeometry = getCharacterEyeGeometry(
          coreCenterX + eyeX,
          coreCenterY + eyeY,
          editorFacing,
          eyeScaleX,
          eyeScaleY,
          eyeStyle,
          eyeRotationDeg
        )
        const browGeometry = getCharacterBrowGeometry(
          eyeGeometry,
          browStyle,
          browOffsetX,
          browOffsetY,
          browScaleX,
          browScaleY,
          browRotationDeg
        )
        if (browGeometry) {
          drawCharacterBrowGeometry(compositeCtx, browGeometry, '#231711')
          const browBounds = getCharacterBrowBounds(browGeometry)
          const browMinX = browBounds.minX
          const browMaxX = browBounds.maxX
          const browMinY = browBounds.minY
          const browMaxY = browBounds.maxY
          if (!mergedBounds) {
            mergedBounds = {
              minX: browMinX,
              minY: browMinY,
              maxX: browMaxX,
              maxY: browMaxY,
            }
          } else {
            if (browMinX < mergedBounds.minX) mergedBounds.minX = browMinX
            if (browMinY < mergedBounds.minY) mergedBounds.minY = browMinY
            if (browMaxX > mergedBounds.maxX) mergedBounds.maxX = browMaxX
            if (browMaxY > mergedBounds.maxY) mergedBounds.maxY = browMaxY
          }
        }
      }
      compositeCtx.drawImage(browCtx.canvas, 0, 0)
      const browBounds = layer.boundsDirty
        ? readAlphaBounds(browCtx, DRAW_WORLD_SIZE)
        : layer.bounds
      if (browBounds) {
        if (!mergedBounds) {
          mergedBounds = {
            minX: browBounds.minX,
            minY: browBounds.minY,
            maxX: browBounds.maxX,
            maxY: browBounds.maxY,
          }
        } else {
          if (browBounds.minX < mergedBounds.minX) {
            mergedBounds.minX = browBounds.minX
          }
          if (browBounds.minY < mergedBounds.minY) {
            mergedBounds.minY = browBounds.minY
          }
          if (browBounds.maxX > mergedBounds.maxX) {
            mergedBounds.maxX = browBounds.maxX
          }
          if (browBounds.maxY > mergedBounds.maxY) {
            mergedBounds.maxY = browBounds.maxY
          }
        }
      }
      continue
    }
    if (layer.canvas) {
      compositeCtx.drawImage(layer.canvas, 0, 0)
      const layerBounds = layer.boundsDirty
        ? readAlphaBounds(
            layer.ctx as CanvasRenderingContext2D,
            DRAW_WORLD_SIZE
          )
        : layer.bounds
      if (layerBounds) {
        if (!mergedBounds) {
          mergedBounds = {
            minX: layerBounds.minX,
            minY: layerBounds.minY,
            maxX: layerBounds.maxX,
            maxY: layerBounds.maxY,
          }
        } else {
          if (layerBounds.minX < mergedBounds.minX) {
            mergedBounds.minX = layerBounds.minX
          }
          if (layerBounds.minY < mergedBounds.minY) {
            mergedBounds.minY = layerBounds.minY
          }
          if (layerBounds.maxX > mergedBounds.maxX) {
            mergedBounds.maxX = layerBounds.maxX
          }
          if (layerBounds.maxY > mergedBounds.maxY) {
            mergedBounds.maxY = layerBounds.maxY
          }
        }
      }
    }
  }
  return mergedBounds
}

export function serializeVisualLayers(
  layers: EditorBodyLayer[],
  coreCenterX: number,
  coreCenterY: number,
  editorFacing: number
): MapCharacterBodyVisualLayer[] {
  const serialized: MapCharacterBodyVisualLayer[] = []
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (
      (layer.kind !== 'brow' && layer.kind !== 'paint') ||
      !layer.ctx ||
      !layer.canvas
    ) {
      continue
    }
    const bounds = layer.boundsDirty
      ? readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
      : layer.bounds
    if (!bounds) {
      continue
    }
    const dataUrl = cropCanvasDataUrl(
      layer.canvas,
      bounds.minX,
      bounds.minY,
      bounds.maxX + 1,
      bounds.maxY + 1,
      editorFacing < 0
    )
    if (!dataUrl) {
      continue
    }
    serialized.push({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      offsetX:
        Math.round(
          ((bounds.minX + bounds.maxX) * 0.5 - coreCenterX) *
            editorFacing *
            1000
        ) / 1000,
      offsetY:
        Math.round(((bounds.minY + bounds.maxY) * 0.5 - coreCenterY) * 1000) /
        1000,
      width: bounds.maxX + 1 - bounds.minX,
      height: bounds.maxY + 1 - bounds.minY,
      dataUrl,
    })
  }
  return serialized
}

export function buildSkeletalProfile(
  boneSegments: readonly BoneSegment[],
  color: string,
  bloodColor: string,
  exportBaseWidth: number,
  exportBaseHeight: number,
  presetId: EditorCharacterBodyPresetId,
  staticProfile: MapCharacterBodyProfile | null
): MapCharacterBodyProfile | null {
  const geometry = deriveSkeletalBodyGeometry(boneSegments)
  if (!geometry) {
    return null
  }
  const preservedStaticProfile = staticProfile ?? {
    points: [],
  }
  return {
    ...preservedStaticProfile,
    presetId:
      presetId !== CUSTOM_BODY_PRESET_ID
        ? presetId
        : preservedStaticProfile.presetId,
    width:
      preservedStaticProfile.width ??
      Math.max(0.01, Math.round(exportBaseWidth * 1000) / 1000),
    height:
      preservedStaticProfile.height ??
      Math.max(0.01, Math.round(exportBaseHeight * 1000) / 1000),
    color,
    bloodColor,
    skeletalMode: true,
    boneSegments: boneSegments.slice(),
  }
}

export function buildProfile(
  workCanvas: HTMLCanvasElement,
  maskCtx: CanvasRenderingContext2D,
  shapeCtx: CanvasRenderingContext2D,
  textureCtx: CanvasRenderingContext2D,
  browCtx: CanvasRenderingContext2D,
  layers: EditorBodyLayer[],
  layerOrder: number[],
  color: string,
  eyeX: number,
  eyeY: number,
  eyeScaleX: number,
  eyeScaleY: number,
  eyeRotationDeg: number,
  eyeStyle: MapCharacterBodyEyeStyle,
  browStyle: MapCharacterBodyBrowStyle,
  editorFacing: number,
  browOffsetX: number,
  browOffsetY: number,
  browScaleX: number,
  browScaleY: number,
  browRotationDeg: number,
  bloodColor: string,
  presetId: EditorCharacterBodyPresetId,
  usePureImageSurface: boolean,
  collisionShapes: MapCharacterBodyCollisionShape[],
  exportBaseWidth: number,
  exportBaseHeight: number,
  exportReferenceWidth: number,
  exportReferenceHeight: number
): MapCharacterBodyProfile | null {
  const workCtx = workCanvas.getContext('2d')
  if (!workCtx) {
    return null
  }
  const size = DRAW_WORLD_SIZE
  const maskFill = readMaskFill(maskCtx, size)
  if (!maskFill) {
    return null
  }

  const loops = extractMaskLoops(maskFill.filled, size, size)
  const loop = pickLargestLoop(loops)
  if (!loop || loop.length < 6) {
    return null
  }

  const coreCenterX = Math.round((maskFill.minX + maskFill.maxX) * 0.5)
  const coreCenterY = Math.round((maskFill.minY + maskFill.maxY) * 0.5)
  const centered = centerLoop(loop, coreCenterX, coreCenterY)
  const canonicalCentered =
    editorFacing < 0 ? mirrorLocalPoints(centered) : centered
  const simplified = limitEditorLoopPoints(
    canonicalCentered,
    MAX_PROFILE_POINTS
  )
  if (simplified.length < 6) {
    return null
  }
  const surfaceBounds = usePureImageSurface
    ? {
        minX: maskFill.minX,
        minY: maskFill.minY,
        maxX: maskFill.maxX,
        maxY: maskFill.maxY,
      }
    : drawMergedSurface(
        workCtx,
        shapeCtx,
        textureCtx,
        browCtx,
        layers,
        coreCenterX,
        coreCenterY,
        eyeX,
        eyeY,
        eyeScaleX,
        eyeScaleY,
        eyeRotationDeg,
        eyeStyle,
        browStyle,
        editorFacing,
        browOffsetX,
        browOffsetY,
        browScaleX,
        browScaleY,
        browRotationDeg
      )
  const maskWidthPx = maskFill.maxX + 1 - maskFill.minX
  const maskHeightPx = maskFill.maxY + 1 - maskFill.minY
  const scaleX = exportBaseWidth / Math.max(1, exportReferenceWidth)
  const scaleY = exportBaseHeight / Math.max(1, exportReferenceHeight)
  const uniformScale =
    scaleX > 0 && scaleY > 0
      ? (scaleX + scaleY) * 0.5
      : scaleX > 0
        ? scaleX
        : scaleY
  const width = Math.max(
    0.01,
    Math.round(maskWidthPx * uniformScale * 1000) / 1000
  )
  const height = Math.max(
    0.01,
    Math.round(maskHeightPx * uniformScale * 1000) / 1000
  )

  const textureDataUrl = usePureImageSurface
    ? null
    : buildSurfaceDataUrl(
        shapeCtx,
        textureCtx,
        maskFill.minX,
        maskFill.minY,
        maskFill.maxX + 1,
        maskFill.maxY + 1,
        editorFacing < 0
      )
  const surfaceDataUrl = usePureImageSurface
    ? buildSurfaceDataUrl(
        shapeCtx,
        textureCtx,
        maskFill.minX,
        maskFill.minY,
        maskFill.maxX + 1,
        maskFill.maxY + 1,
        editorFacing < 0
      )
    : surfaceBounds
      ? cropCanvasDataUrl(
          workCanvas,
          surfaceBounds.minX,
          surfaceBounds.minY,
          surfaceBounds.maxX + 1,
          surfaceBounds.maxY + 1,
          editorFacing < 0
        )
      : textureDataUrl
  const serializedLayers = serializeVisualLayers(
    layers,
    coreCenterX,
    coreCenterY,
    editorFacing
  )

  return {
    points: simplified,
    collisionShapes: collisionShapes.length > 0 ? collisionShapes : undefined,
    presetId: presetId !== CUSTOM_BODY_PRESET_ID ? presetId : undefined,
    width,
    height,
    color: usePureImageSurface ? TRANSPARENT_BODY_COLOR : color,
    bloodColor,
    eyeX: Math.round(eyeX * editorFacing * 1000) / 1000,
    eyeY: Math.round(eyeY * 1000) / 1000,
    eyeScaleX:
      Math.abs(eyeScaleX - DEFAULT_CHARACTER_EYE_SCALE) > 0.001
        ? Math.round(eyeScaleX * 1000) / 1000
        : undefined,
    eyeScaleY:
      Math.abs(eyeScaleY - DEFAULT_CHARACTER_EYE_SCALE) > 0.001
        ? Math.round(eyeScaleY * 1000) / 1000
        : undefined,
    eyeRotationDeg:
      eyeRotationDeg !== DEFAULT_CHARACTER_EYE_ROTATION_DEG
        ? eyeRotationDeg * editorFacing
        : undefined,
    eyeStyle: eyeStyle !== DEFAULT_CHARACTER_EYE_STYLE ? eyeStyle : undefined,
    browStyle:
      browStyle !== DEFAULT_CHARACTER_BROW_STYLE ? browStyle : undefined,
    browOffsetX:
      browOffsetX !== DEFAULT_CHARACTER_BROW_OFFSET_X
        ? Math.round(browOffsetX * editorFacing * 1000) / 1000
        : undefined,
    browOffsetY:
      browOffsetY !== DEFAULT_CHARACTER_BROW_OFFSET_Y ? browOffsetY : undefined,
    browScaleX:
      Math.abs(browScaleX - DEFAULT_CHARACTER_BROW_SCALE) > 0.001
        ? Math.round(browScaleX * 1000) / 1000
        : undefined,
    browScaleY:
      Math.abs(browScaleY - DEFAULT_CHARACTER_BROW_SCALE) > 0.001
        ? Math.round(browScaleY * 1000) / 1000
        : undefined,
    browRotationDeg:
      browRotationDeg !== DEFAULT_CHARACTER_BROW_ROTATION_DEG
        ? browRotationDeg * editorFacing
        : undefined,
    embeddedEye: !textureDataUrl && !usePureImageSurface && !!surfaceDataUrl,
    surfaceOffsetX: surfaceBounds
      ? Math.round(
          ((surfaceBounds.minX + surfaceBounds.maxX) * 0.5 - coreCenterX) *
            editorFacing *
            1000
        ) / 1000
      : undefined,
    surfaceOffsetY: surfaceBounds
      ? Math.round(
          ((surfaceBounds.minY + surfaceBounds.maxY) * 0.5 - coreCenterY) * 1000
        ) / 1000
      : undefined,
    surfaceWidth: surfaceBounds
      ? surfaceBounds.maxX + 1 - surfaceBounds.minX
      : undefined,
    surfaceHeight: surfaceBounds
      ? surfaceBounds.maxY + 1 - surfaceBounds.minY
      : undefined,
    layerOrder: serializedLayers.length > 0 ? layerOrder : undefined,
    layers: serializedLayers.length > 0 ? serializedLayers : undefined,
    surfaceDataUrl: surfaceDataUrl ?? undefined,
    textureDataUrl: textureDataUrl ?? undefined,
  }
}
