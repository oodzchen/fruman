import * as fabric from 'fabric'

import { PatternCreator } from '../renderer/PatternCreator'

interface EditorPatternManagerContext {
  fabricCanvas: () => fabric.Canvas | null
}

export class EditorPatternManager {
  private readonly context: EditorPatternManagerContext

  private groundPatternMap = new Map<fabric.Object, fabric.Pattern>()
  private groundPatternImage: HTMLImageElement | null = null
  private groundPatternTransformScratch: fabric.TMat2D = [1, 0, 0, 1, 0, 0]

  private obstaclePatternMap = new Map<fabric.Object, fabric.Pattern>()
  private obstaclePatternImage: HTMLImageElement | null = null
  private obstaclePatternTransformScratch: fabric.TMat2D = [1, 0, 0, 1, 0, 0]

  constructor(context: EditorPatternManagerContext) {
    this.context = context
  }

  clearAll(): void {
    this.groundPatternMap.clear()
    this.obstaclePatternMap.clear()
  }

  deletePattern(object: fabric.Object): void {
    this.groundPatternMap.delete(object)
    this.obstaclePatternMap.delete(object)
  }

  hasGroundPattern(object: fabric.Object): boolean {
    return this.groundPatternMap.has(object)
  }

  hasObstaclePattern(object: fabric.Object): boolean {
    return this.obstaclePatternMap.has(object)
  }

  applyGroundPatternToObject(object: fabric.Object): void {
    const image = this.getGroundPatternImage()
    if (!image) {
      return
    }

    const pattern = new fabric.Pattern({
      source: image,
      repeat: 'repeat',
      patternTransform: [1, 0, 0, 1, 0, 0] as fabric.TMat2D,
    })
    this.groundPatternMap.set(object, pattern)
    object.set('fill', pattern)
    this.updateGroundPatternTransform(object)

    object.on('scaling', () => {
      this.updateGroundPatternTransform(object)
    })
    object.on('modified', () => {
      this.updateGroundPatternTransform(object)
    })
  }

  updateGroundPatternTransform(object: fabric.Object): void {
    const pattern = this.groundPatternMap.get(object)
    if (!pattern) {
      return
    }

    const scaleX = object.scaleX ?? 1
    const scaleY = object.scaleY ?? 1
    const invScaleX = scaleX !== 0 ? 1 / scaleX : 1
    const invScaleY = scaleY !== 0 ? 1 / scaleY : 1

    const transform =
      pattern.patternTransform ?? this.groundPatternTransformScratch
    transform[0] = invScaleX
    transform[1] = 0
    transform[2] = 0
    transform[3] = invScaleY
    transform[4] = 0
    transform[5] = 0
    pattern.patternTransform = transform

    if (object.canvas) {
      object.canvas.requestRenderAll()
    }
  }

  applyObstaclePatternToObject(object: fabric.Object): void {
    const image = this.getObstaclePatternImage()
    if (!image) {
      return
    }

    const pattern = new fabric.Pattern({
      source: image,
      repeat: 'repeat',
      patternTransform: [1, 0, 0, 1, 0, 0] as fabric.TMat2D,
    })
    this.obstaclePatternMap.set(object, pattern)
    object.set('fill', pattern)
    this.updateObstaclePatternTransform(object)

    object.on('scaling', () => {
      this.updateObstaclePatternTransform(object)
    })
    object.on('modified', () => {
      this.updateObstaclePatternTransform(object)
    })
  }

  updateObstaclePatternTransform(object: fabric.Object): void {
    const pattern = this.obstaclePatternMap.get(object)
    if (!pattern) {
      return
    }

    const scaleX = object.scaleX ?? 1
    const scaleY = object.scaleY ?? 1
    const invScaleX = scaleX !== 0 ? 1 / scaleX : 1
    const invScaleY = scaleY !== 0 ? 1 / scaleY : 1

    const transform =
      pattern.patternTransform ?? this.obstaclePatternTransformScratch
    transform[0] = invScaleX
    transform[1] = 0
    transform[2] = 0
    transform[3] = invScaleY
    transform[4] = 0
    transform[5] = 0
    pattern.patternTransform = transform

    if (object.canvas) {
      object.canvas.requestRenderAll()
    }
  }

  private getGroundPatternImage(): HTMLImageElement | null {
    if (!this.groundPatternImage) {
      this.groundPatternImage = PatternCreator.createGroundImage(() => {
        const canvas = this.context.fabricCanvas()
        if (canvas) {
          canvas.requestRenderAll()
        }
      })
    }
    return this.groundPatternImage
  }

  private getObstaclePatternImage(): HTMLImageElement | null {
    if (!this.obstaclePatternImage) {
      this.obstaclePatternImage = PatternCreator.createObstacleImage(() => {
        const canvas = this.context.fabricCanvas()
        if (canvas) {
          canvas.requestRenderAll()
        }
      })
    }
    return this.obstaclePatternImage
  }
}
