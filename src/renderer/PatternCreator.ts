import { Texture } from 'pixi.js'

export class PatternCreator {
  // 保持源 canvas 引用存活，防止 GC 导致 CanvasPattern 失效
  private static bgCanvas: HTMLCanvasElement | null = null
  private static cloudCanvas: HTMLCanvasElement | null = null

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

  // 云层纹理：白色云朵，透明背景，通过 tint 实现颜色渐变
  static createCloudTexture(): Texture | null {
    const canvas = this.drawCloudsToCanvas()
    if (!canvas) return null
    this.cloudCanvas = canvas
    return Texture.from(canvas)
  }

  private static drawCloudsToCanvas(): HTMLCanvasElement | null {
    const W = 220
    const H = 150
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.clearRect(0, 0, W, H)

    const fillCircle = (x: number, y: number, r: number) => {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    const largePuffs: [number, number, number][] = [
      [0, 0, 24],
      [-22, 10, 18],
      [24, 8, 21],
      [-10, 22, 16],
      [15, 24, 15],
      [36, 18, 13],
      [-34, 18, 12],
    ]
    const mediumPuffs: [number, number, number][] = [
      [0, 0, 19],
      [-18, 9, 15],
      [20, 7, 17],
      [-7, 20, 14],
      [13, 21, 13],
      [28, 15, 11],
    ]

    const drawCloud = (
      cx: number,
      cy: number,
      puffs: [number, number, number][]
    ) => {
      ctx.fillStyle = '#ffffff'
      for (const [dx, dy, r] of puffs) {
        fillCircle(cx + dx, cy + dy, r)
      }
    }

    drawCloud(65, 42, largePuffs)
    drawCloud(145, 72, mediumPuffs)

    return canvas
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

    const fillCircle = (x: number, y: number, r: number) => {
      patternCtx.beginPath()
      patternCtx.arc(x, y, r, 0, Math.PI * 2)
      patternCtx.fill()
    }

    // 云朵由多个圆叠加组成，puffs: [dx, dy, r]（相对于云中心）
    const largePuffs: [number, number, number][] = [
      [0, 0, 24],
      [-22, 10, 18],
      [24, 8, 21],
      [-10, 22, 16],
      [15, 24, 15],
      [36, 18, 13],
      [-34, 18, 12],
    ]
    const mediumPuffs: [number, number, number][] = [
      [0, 0, 19],
      [-18, 9, 15],
      [20, 7, 17],
      [-7, 20, 14],
      [13, 21, 13],
      [28, 15, 11],
    ]

    const drawCloud = (
      cx: number,
      cy: number,
      puffs: [number, number, number][]
    ) => {
      // 云体
      patternCtx.fillStyle = '#1e1932'
      for (const [dx, dy, r] of puffs) {
        fillCircle(cx + dx, cy + dy, r)
      }
      // 顶部微亮，增加体积感
      patternCtx.fillStyle = '#2a2444'
      fillCircle(cx, cy - 5, 16)
    }

    drawCloud(65, 42, largePuffs)
    drawCloud(145, 72, mediumPuffs)

    return patternCanvas
  }
}
