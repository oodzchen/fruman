export class PatternCreator {
  // 保持源 canvas 引用存活，防止 GC 导致 CanvasPattern 失效
  private static bgCanvas: HTMLCanvasElement | null = null
  private static groundCanvas: HTMLCanvasElement | null = null
  private static obstacleCanvas: HTMLCanvasElement | null = null

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

  static createGroundPattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    this.groundCanvas = this.drawGroundToCanvas()
    if (!this.groundCanvas) return null
    return targetCtx.createPattern(this.groundCanvas, 'repeat')
  }

  static createGroundImage(onLoad?: () => void): HTMLImageElement | null {
    const canvas = this.drawGroundToCanvas()
    if (!canvas) return null
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    if (onLoad) {
      image.onload = onLoad
    }
    return image
  }

  static createObstaclePattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    this.obstacleCanvas = this.drawObstacleToCanvas()
    if (!this.obstacleCanvas) return null
    return targetCtx.createPattern(this.obstacleCanvas, 'repeat')
  }

  static createObstacleImage(onLoad?: () => void): HTMLImageElement | null {
    const canvas = this.drawObstacleToCanvas()
    if (!canvas) return null
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    if (onLoad) {
      image.onload = onLoad
    }
    return image
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

    // 云1：大云，左上
    drawCloud(65, 42, largePuffs)
    // 云2：中云，右下
    drawCloud(155, 105, mediumPuffs)
    // 云3：大云，跨越右/左边界（cx=210 右侧延伸超出 W=220）
    // 在原位置画右半，在 cx-W 位置画左半，保证无缝平铺
    drawCloud(210, 68, largePuffs)
    drawCloud(210 - W, 68, largePuffs)

    return patternCanvas
  }

  private static drawGroundToCanvas(): HTMLCanvasElement | null {
    const size = 96
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    // 砖缝底色
    patternCtx.fillStyle = '#3e2a15'
    patternCtx.fillRect(0, 0, size, size)

    // 8 块不规则石块，边缘分割点固定（左右 y=35,65；上下 x=40,72）保证无缝平铺
    // 顶点均为整数坐标
    const stones: [number, number][][] = [
      [
        [0, 0],
        [40, 0],
        [58, 28],
        [22, 42],
        [0, 35],
      ], // 左上
      [
        [40, 0],
        [72, 0],
        [96, 0],
        [96, 35],
        [78, 52],
        [58, 28],
      ], // 右上
      [
        [0, 35],
        [22, 42],
        [28, 58],
        [0, 65],
      ], // 左中
      [
        [22, 42],
        [58, 28],
        [78, 52],
        [65, 74],
        [32, 78],
        [28, 58],
      ], // 中央
      [
        [78, 52],
        [96, 35],
        [96, 65],
        [65, 74],
      ], // 右中
      [
        [0, 65],
        [28, 58],
        [32, 78],
        [40, 96],
        [0, 96],
      ], // 左下
      [
        [40, 96],
        [72, 96],
        [65, 74],
        [32, 78],
      ], // 下中
      [
        [72, 96],
        [96, 96],
        [96, 65],
        [65, 74],
      ], // 右下
    ]

    // 三色着色，相邻石块颜色不同
    const colors = [
      '#8a6845',
      '#7a5c3c',
      '#7a5c3c',
      '#966f4a',
      '#8a6845',
      '#8a6845',
      '#7a5c3c',
      '#966f4a',
    ]

    for (let i = 0; i < stones.length; i++) {
      const pts = stones[i]
      patternCtx.beginPath()
      patternCtx.moveTo(pts[0][0], pts[0][1])
      for (let j = 1; j < pts.length; j++) {
        patternCtx.lineTo(pts[j][0], pts[j][1])
      }
      patternCtx.closePath()
      patternCtx.fillStyle = colors[i]
      patternCtx.fill()
    }

    return patternCanvas
  }

  private static drawObstacleToCanvas(): HTMLCanvasElement | null {
    const size = 88
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    // 石缝底色
    patternCtx.fillStyle = '#2a1808'
    patternCtx.fillRect(0, 0, size, size)

    // 8 块不规则石块，边缘分割点固定（左右 y=30,58；上下 x=36,64）保证无缝平铺
    // 顶点比地面更锐利，体现堆砌粗粝感
    const stones: [number, number][][] = [
      [
        [0, 0],
        [36, 0],
        [48, 22],
        [15, 35],
        [0, 30],
      ], // 左上
      [
        [36, 0],
        [64, 0],
        [88, 0],
        [88, 30],
        [68, 48],
        [48, 22],
      ], // 右上
      [
        [0, 30],
        [15, 35],
        [20, 52],
        [0, 58],
      ], // 左中
      [
        [15, 35],
        [48, 22],
        [68, 48],
        [58, 70],
        [28, 68],
        [20, 52],
      ], // 中央
      [
        [68, 48],
        [88, 30],
        [88, 58],
        [58, 70],
      ], // 右中
      [
        [0, 58],
        [20, 52],
        [28, 68],
        [36, 88],
        [0, 88],
      ], // 左下
      [
        [36, 88],
        [64, 88],
        [58, 70],
        [28, 68],
      ], // 下中
      [
        [64, 88],
        [88, 88],
        [88, 58],
        [58, 70],
      ], // 右下
    ]

    // 三色着色，相邻石块颜色不同
    const colors = [
      '#6b3f14',
      '#5a3310',
      '#5a3310',
      '#744518',
      '#6b3f14',
      '#6b3f14',
      '#5a3310',
      '#744518',
    ]

    for (let i = 0; i < stones.length; i++) {
      const pts = stones[i]
      patternCtx.beginPath()
      patternCtx.moveTo(pts[0][0], pts[0][1])
      for (let j = 1; j < pts.length; j++) {
        patternCtx.lineTo(pts[j][0], pts[j][1])
      }
      patternCtx.closePath()
      patternCtx.fillStyle = colors[i]
      patternCtx.fill()
    }

    return patternCanvas
  }
}
