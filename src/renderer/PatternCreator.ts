export class PatternCreator {
  static createBackgroundPattern(
    targetCtx: CanvasRenderingContext2D
  ): CanvasPattern | null {
    const canvas = this.drawBackgroundToCanvas()
    if (!canvas) return null
    return targetCtx.createPattern(canvas, 'repeat')
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
    const canvas = this.drawGroundToCanvas()
    if (!canvas) return null
    return targetCtx.createPattern(canvas, 'repeat')
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
    const canvas = this.drawObstacleToCanvas()
    if (!canvas) return null
    return targetCtx.createPattern(canvas, 'repeat')
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
    const patternSize = 160
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = patternSize
    patternCanvas.height = patternSize
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    // 暗紫色夜空底色
    patternCtx.fillStyle = '#0e0818'
    patternCtx.fillRect(0, 0, patternSize, patternSize)

    // 小星星：1px，暗淡，数量最多，有松散聚集感
    const smallStars: [number, number][] = [
      [3, 19],
      [60, 7],
      [156, 14],
      [33, 43],
      [79, 36],
      [127, 41],
      [5, 61],
      [157, 68],
      [47, 77],
      [119, 90],
      [11, 89],
      [91, 100],
      [153, 104],
      [12, 77],
      [23, 87],
      [105, 22],
      [94, 33],
      [147, 108],
      [136, 121],
      [8, 129],
      [41, 133],
      [84, 128],
      [66, 150],
      [119, 153],
      [155, 145],
      [37, 158],
      [124, 7],
      [49, 112],
    ]
    patternCtx.fillStyle = '#3d2e7a'
    for (const [x, y] of smallStars) {
      patternCtx.fillRect(x, y, 1, 1)
    }

    // 中星星：1px，较亮
    const midStars: [number, number][] = [
      [28, 11],
      [131, 6],
      [7, 38],
      [44, 65],
      [113, 70],
      [158, 48],
      [26, 117],
      [87, 105],
      [149, 136],
      [64, 153],
      [106, 147],
      [74, 20],
    ]
    patternCtx.fillStyle = '#ccbbee'
    for (const [x, y] of midStars) {
      patternCtx.fillRect(x, y, 1, 1)
    }

    // 大星星 A：3x3 中心 + 单像素十字光晕
    const bigStars: [number, number][] = [
      [17, 82],
      [99, 28],
      [141, 115],
    ]
    for (const [x, y] of bigStars) {
      patternCtx.fillStyle = '#7755cc'
      patternCtx.fillRect(x - 1, y + 1, 1, 1)
      patternCtx.fillRect(x + 3, y + 1, 1, 1)
      patternCtx.fillRect(x + 1, y - 1, 1, 1)
      patternCtx.fillRect(x + 1, y + 3, 1, 1)
      patternCtx.fillStyle = '#ffffff'
      patternCtx.fillRect(x, y, 3, 3)
    }

    // 大星星 B：2x2 中心 + 单像素十字光晕
    const brightStars: [number, number][] = [
      [55, 140],
      [72, 52],
    ]
    for (const [x, y] of brightStars) {
      patternCtx.fillStyle = '#6644bb'
      patternCtx.fillRect(x - 1, y, 1, 1)
      patternCtx.fillRect(x + 2, y, 1, 1)
      patternCtx.fillRect(x, y - 1, 1, 1)
      patternCtx.fillRect(x, y + 2, 1, 1)
      patternCtx.fillStyle = '#ffffff'
      patternCtx.fillRect(x, y, 2, 2)
    }

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
