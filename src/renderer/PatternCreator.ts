import { Texture } from 'pixi.js'

export class PatternCreator {
  // 保持源 canvas 引用存活，防止 GC 导致 CanvasPattern 失效
  private static bgCanvas: HTMLCanvasElement | null = null

  static createBackgroundPattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    this.bgCanvas = this.drawBackgroundToCanvas()
    if (!this.bgCanvas) return null
    return targetCtx.createPattern(this.bgCanvas, 'repeat')
  }

  static createBackgroundImage(): HTMLImageElement | null {
    const canvas = this.drawBackgroundToCanvas()
    if (!canvas) return null
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    return image
  }

  static createBackgroundTexture(): Texture | null {
    const canvas = this.drawBackgroundToCanvas()
    if (!canvas) return null
    this.bgCanvas = canvas
    return Texture.from(canvas)
  }

  private static drawBackgroundToCanvas(): HTMLCanvasElement | null {
    const W = 220
    const H = 150
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = W
    patternCanvas.height = H
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    // 昏暗天空底色
    patternCtx.fillStyle = '#0d0b18'
    patternCtx.fillRect(0, 0, W, H)

    return patternCanvas
  }
}
