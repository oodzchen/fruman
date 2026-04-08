import {
  Container,
  FillGradient,
  FillPattern,
  Graphics,
  Matrix,
  Sprite,
  Text,
  Texture,
} from 'pixi.js'

type RenderFillStyle = string | CanvasGradient | CanvasPattern
type TextureImageSource =
  | HTMLCanvasElement
  | HTMLImageElement
  | HTMLVideoElement
  | ImageBitmap
  | OffscreenCanvas
  | VideoFrame

interface RenderTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

// Path command types encoded as numeric constants
const CMD_MOVE_TO = 0
const CMD_LINE_TO = 1
const CMD_RECT = 2
const CMD_ARC = 3
const CMD_ELLIPSE = 4
const CMD_QUADRATIC = 5
const CMD_CLOSE_PATH = 6

// Max float params per command: ellipse uses 8 floats
const PATH_CMD_INITIAL_CAPACITY = 256
const PATH_DATA_INITIAL_CAPACITY = 2048

interface RenderState {
  container: Container
  fillStyle: RenderFillStyle
  strokeStyle: RenderFillStyle
  globalAlpha: number
  globalCompositeOperation: GlobalCompositeOperation
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  transform: RenderTransform
  renderZIndex: number
}

interface TextMeta {
  text: string
  fontFamily: string
  fontSize: number
  fill: string | FillGradient | FillPattern
  anchorX: number
  anchorY: number
}

const RENDER_Z_ORDER_STEP = 1000000

export interface RenderContext2D {
  canvas: { width: number; height: number }
  fillStyle: RenderFillStyle
  strokeStyle: RenderFillStyle
  globalAlpha: number
  globalCompositeOperation: GlobalCompositeOperation
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  save(): void
  restore(): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  rect(x: number, y: number, width: number, height: number): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean
  ): void
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean
  ): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  fill(): void
  stroke(): void
  clip(): void
  fillRect(x: number, y: number, width: number, height: number): void
  strokeRect(x: number, y: number, width: number, height: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  rotate(angle: number): void
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void
  fillText(text: string, x: number, y: number): void
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradient
  setLineDash(segments: number[]): void
  getTransform(): DOMMatrix
}

function copyTransform(
  dst: RenderTransform,
  src: RenderTransform
): RenderTransform {
  dst.a = src.a
  dst.b = src.b
  dst.c = src.c
  dst.d = src.d
  dst.e = src.e
  dst.f = src.f
  return dst
}

function resetTransform(t: RenderTransform): void {
  t.a = 1
  t.b = 0
  t.c = 0
  t.d = 1
  t.e = 0
  t.f = 0
}

function appendTranslation(
  transform: RenderTransform,
  x: number,
  y: number
): void {
  transform.e += transform.a * x + transform.c * y
  transform.f += transform.b * x + transform.d * y
}

function appendScale(transform: RenderTransform, x: number, y: number): void {
  transform.a *= x
  transform.b *= x
  transform.c *= y
  transform.d *= y
}

function appendRotation(transform: RenderTransform, angle: number): void {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const a = transform.a
  const b = transform.b
  const c = transform.c
  const d = transform.d
  transform.a = a * cos + c * sin
  transform.b = b * cos + d * sin
  transform.c = c * cos - a * sin
  transform.d = d * cos - b * sin
}

function resetState(state: RenderState, root: Container): void {
  state.container = root
  state.fillStyle = '#000000'
  state.strokeStyle = '#000000'
  state.globalAlpha = 1
  state.globalCompositeOperation = 'source-over'
  state.lineWidth = 1
  state.lineCap = 'butt'
  state.lineJoin = 'miter'
  state.font = '10px sans-serif'
  state.textAlign = 'start'
  state.textBaseline = 'alphabetic'
  resetTransform(state.transform)
  state.renderZIndex = 0
}

function createState(root: Container): RenderState {
  return {
    container: root,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    renderZIndex: 0,
  }
}

function copyState(dst: RenderState, src: RenderState): void {
  dst.container = src.container
  dst.fillStyle = src.fillStyle
  dst.strokeStyle = src.strokeStyle
  dst.globalAlpha = src.globalAlpha
  dst.globalCompositeOperation = src.globalCompositeOperation
  dst.lineWidth = src.lineWidth
  dst.lineCap = src.lineCap
  dst.lineJoin = src.lineJoin
  dst.font = src.font
  dst.textAlign = src.textAlign
  dst.textBaseline = src.textBaseline
  copyTransform(dst.transform, src.transform)
  dst.renderZIndex = src.renderZIndex
}

function toPixiFillStyle(
  style: RenderFillStyle
): string | FillGradient | FillPattern {
  if (typeof style === 'string') {
    return style
  }
  if (style instanceof FillGradient) {
    return style
  }
  if (style instanceof FillPattern) {
    return style
  }
  return '#ffffff'
}

// Reusable stroke style objects — PixiJS reads properties immediately in .stroke()
const reusableColorStroke = {
  color: '' as string,
  width: 1,
  cap: 'butt' as CanvasLineCap,
  join: 'miter' as CanvasLineJoin,
}
const reusableFillStroke = {
  fill: null as FillGradient | FillPattern | null,
  width: 1,
  cap: 'butt' as CanvasLineCap,
  join: 'miter' as CanvasLineJoin,
}

function applyStrokeStyle(
  graphics: Graphics,
  style: RenderFillStyle,
  lineWidth: number,
  lineCap: CanvasLineCap,
  lineJoin: CanvasLineJoin
): void {
  if (typeof style === 'string') {
    reusableColorStroke.color = style
    reusableColorStroke.width = lineWidth
    reusableColorStroke.cap = lineCap
    reusableColorStroke.join = lineJoin
    graphics.stroke(reusableColorStroke)
  } else {
    const fill = toPixiFillStyle(style)
    reusableFillStroke.fill =
      fill instanceof FillGradient || fill instanceof FillPattern
        ? fill
        : new FillPattern(Texture.WHITE, 'repeat')
    reusableFillStroke.width = lineWidth
    reusableFillStroke.cap = lineCap
    reusableFillStroke.join = lineJoin
    graphics.stroke(reusableFillStroke)
  }
}

let cachedFontString = ''
let cachedFontResult = { fontSize: 10, fontFamily: 'sans-serif' }

function parseFont(font: string): { fontSize: number; fontFamily: string } {
  if (font === cachedFontString) {
    return cachedFontResult
  }
  cachedFontString = font
  const match = /(\d+)px\s+(.+)/.exec(font)
  if (!match) {
    cachedFontResult = { fontSize: 10, fontFamily: 'sans-serif' }
    return cachedFontResult
  }
  const fontSize = Number.parseInt(match[1], 10)
  cachedFontResult = {
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 10,
    fontFamily: match[2] || 'sans-serif',
  }
  return cachedFontResult
}

function getTextAnchorX(textAlign: CanvasTextAlign): number {
  if (textAlign === 'center') {
    return 0.5
  }
  if (textAlign === 'right' || textAlign === 'end') {
    return 1
  }
  return 0
}

function getTextAnchorY(textBaseline: CanvasTextBaseline): number {
  if (textBaseline === 'middle') {
    return 0.5
  }
  if (
    textBaseline === 'bottom' ||
    textBaseline === 'alphabetic' ||
    textBaseline === 'ideographic'
  ) {
    return 1
  }
  return 0
}

function applyFlatPathToGraphics(
  graphics: Graphics,
  cmdTypes: Int8Array,
  cmdData: Float64Array,
  cmdCount: number
): void {
  let dataIndex = 0
  for (let i = 0; i < cmdCount; i++) {
    const type = cmdTypes[i]
    if (type === CMD_MOVE_TO) {
      graphics.moveTo(cmdData[dataIndex], cmdData[dataIndex + 1])
      dataIndex += 2
    } else if (type === CMD_LINE_TO) {
      graphics.lineTo(cmdData[dataIndex], cmdData[dataIndex + 1])
      dataIndex += 2
    } else if (type === CMD_RECT) {
      graphics.rect(
        cmdData[dataIndex],
        cmdData[dataIndex + 1],
        cmdData[dataIndex + 2],
        cmdData[dataIndex + 3]
      )
      dataIndex += 4
    } else if (type === CMD_ARC) {
      graphics.arc(
        cmdData[dataIndex],
        cmdData[dataIndex + 1],
        cmdData[dataIndex + 2],
        cmdData[dataIndex + 3],
        cmdData[dataIndex + 4],
        cmdData[dataIndex + 5] !== 0
      )
      dataIndex += 6
    } else if (type === CMD_ELLIPSE) {
      const ex = cmdData[dataIndex]
      const ey = cmdData[dataIndex + 1]
      const erx = cmdData[dataIndex + 2]
      const ery = cmdData[dataIndex + 3]
      const erot = cmdData[dataIndex + 4]
      const esa = cmdData[dataIndex + 5]
      const eea = cmdData[dataIndex + 6]
      const eccw = cmdData[dataIndex + 7] !== 0
      dataIndex += 8
      if (erot === 0 && esa === 0 && eea === Math.PI * 2 && !eccw) {
        graphics.ellipse(ex, ey, erx, ery)
      } else {
        const steps = 24
        const angleSpan = eea - esa
        for (let step = 0; step <= steps; step++) {
          const ratio = step / steps
          const theta = esa + angleSpan * ratio
          const cosTheta = Math.cos(theta)
          const sinTheta = Math.sin(theta)
          const localX = erx * cosTheta
          const localY = ery * sinTheta
          const cosRot = Math.cos(erot)
          const sinRot = Math.sin(erot)
          const px = ex + localX * cosRot - localY * sinRot
          const py = ey + localX * sinRot + localY * cosRot
          if (step === 0) {
            graphics.moveTo(px, py)
          } else {
            graphics.lineTo(px, py)
          }
        }
      }
    } else if (type === CMD_QUADRATIC) {
      graphics.quadraticCurveTo(
        cmdData[dataIndex],
        cmdData[dataIndex + 1],
        cmdData[dataIndex + 2],
        cmdData[dataIndex + 3]
      )
      dataIndex += 4
    } else if (type === CMD_CLOSE_PATH) {
      graphics.closePath()
    }
  }
}

function resetDisplayObject(displayObject: Container): void {
  displayObject.visible = true
  displayObject.alpha = 1
  displayObject.blendMode = 'normal'
  displayObject.mask = null
  displayObject.zIndex = 0
}

function hideDisplayObject(displayObject: Container): void {
  displayObject.visible = false
  displayObject.mask = null
}

export class PixiRenderContext2D implements RenderContext2D {
  readonly canvas = { width: 0, height: 0 }

  fillStyle: RenderFillStyle = '#000000'
  strokeStyle: RenderFillStyle = '#000000'
  globalAlpha = 1
  globalCompositeOperation: GlobalCompositeOperation = 'source-over'
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  font = '10px sans-serif'
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'

  private readonly root: Container
  private readonly frameItems: Container[] = []
  private readonly graphicsPool: Graphics[] = []
  private readonly textPool: Text[] = []
  private readonly textMetaPool: TextMeta[] = []
  private readonly spritePool: Sprite[] = []
  private readonly containerPool: Container[] = []
  private readonly imageTextureCache = new WeakMap<object, Texture>()
  private graphicsPoolIndex = 0
  private textPoolIndex = 0
  private spritePoolIndex = 0
  private containerPoolIndex = 0
  private renderZIndex = 0
  private frameOrder = 0
  private readonly tempMatrix = new Matrix()
  private readonly reusableDOMMatrix = new DOMMatrix()

  // Flat path command buffers — zero per-command allocation
  private pathCmdTypes: Int8Array
  private pathCmdData: Float64Array
  private pathCmdCount = 0
  private pathDataIndex = 0

  // State pool — zero per-save allocation
  private readonly statePool: RenderState[] = []
  private statePoolSize = 0
  private stateStackTop = 0

  constructor(root: Container, width: number, height: number) {
    this.root = root
    this.canvas.width = width
    this.canvas.height = height
    this.pathCmdTypes = new Int8Array(PATH_CMD_INITIAL_CAPACITY)
    this.pathCmdData = new Float64Array(PATH_DATA_INITIAL_CAPACITY)
    // Initial state at index 0
    this.statePool.push(createState(root))
    this.statePoolSize = 1
    this.stateStackTop = 0
    this.syncFromState()
  }

  resize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
  }

  beginFrame(): void {
    for (let i = 0; i < this.frameItems.length; i++) {
      hideDisplayObject(this.frameItems[i])
    }
    this.frameItems.length = 0
    this.graphicsPoolIndex = 0
    this.textPoolIndex = 0
    this.spritePoolIndex = 0
    this.containerPoolIndex = 0
    this.frameOrder = 0
    this.pathCmdCount = 0
    this.pathDataIndex = 0
    this.stateStackTop = 0
    resetState(this.statePool[0], this.root)
    this.syncFromState()
  }

  setRenderZIndex(zIndex: number): void {
    this.renderZIndex = zIndex
    this.currentState().renderZIndex = zIndex
  }

  save(): void {
    this.updateStateFromPublicFields()
    const srcIndex = this.stateStackTop
    const dstIndex = srcIndex + 1
    this.stateStackTop = dstIndex
    // Grow pool if needed
    if (dstIndex >= this.statePoolSize) {
      this.statePool.push(createState(this.root))
      this.statePoolSize++
    }
    copyState(this.statePool[dstIndex], this.statePool[srcIndex])
    this.syncFromState()
  }

  restore(): void {
    if (this.stateStackTop > 0) {
      this.stateStackTop--
    }
    this.syncFromState()
  }

  beginPath(): void {
    this.pathCmdCount = 0
    this.pathDataIndex = 0
  }

  closePath(): void {
    this.pushCmd(CMD_CLOSE_PATH)
  }

  moveTo(x: number, y: number): void {
    this.pushCmd(CMD_MOVE_TO)
    this.pushData2(x, y)
  }

  lineTo(x: number, y: number): void {
    this.pushCmd(CMD_LINE_TO)
    this.pushData2(x, y)
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.pushCmd(CMD_RECT)
    this.pushData4(x, y, width, height)
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    this.pushCmd(CMD_ARC)
    this.ensureDataCapacity(6)
    const idx = this.pathDataIndex
    this.pathCmdData[idx] = x
    this.pathCmdData[idx + 1] = y
    this.pathCmdData[idx + 2] = radius
    this.pathCmdData[idx + 3] = startAngle
    this.pathCmdData[idx + 4] = endAngle
    this.pathCmdData[idx + 5] = counterclockwise ? 1 : 0
    this.pathDataIndex = idx + 6
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    this.pushCmd(CMD_ELLIPSE)
    this.ensureDataCapacity(8)
    const idx = this.pathDataIndex
    this.pathCmdData[idx] = x
    this.pathCmdData[idx + 1] = y
    this.pathCmdData[idx + 2] = radiusX
    this.pathCmdData[idx + 3] = radiusY
    this.pathCmdData[idx + 4] = rotation
    this.pathCmdData[idx + 5] = startAngle
    this.pathCmdData[idx + 6] = endAngle
    this.pathCmdData[idx + 7] = counterclockwise ? 1 : 0
    this.pathDataIndex = idx + 8
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.pushCmd(CMD_QUADRATIC)
    this.pushData4(cpx, cpy, x, y)
  }

  fill(): void {
    if (this.pathCmdCount === 0) {
      return
    }
    const graphics = this.acquireGraphics()
    applyFlatPathToGraphics(
      graphics,
      this.pathCmdTypes,
      this.pathCmdData,
      this.pathCmdCount
    )
    graphics.fill(toPixiFillStyle(this.fillStyle))
  }

  stroke(): void {
    if (this.pathCmdCount === 0) {
      return
    }
    const graphics = this.acquireGraphics()
    applyFlatPathToGraphics(
      graphics,
      this.pathCmdTypes,
      this.pathCmdData,
      this.pathCmdCount
    )
    applyStrokeStyle(
      graphics,
      this.strokeStyle,
      this.lineWidth,
      this.lineCap,
      this.lineJoin
    )
  }

  clip(): void {
    if (this.pathCmdCount === 0) {
      return
    }
    const state = this.currentState()
    const mask = this.acquireGraphics()
    applyFlatPathToGraphics(
      mask,
      this.pathCmdTypes,
      this.pathCmdData,
      this.pathCmdCount
    )
    mask.fill('#ffffff')
    const clipContainer = this.acquireContainer()
    clipContainer.zIndex = state.renderZIndex
    state.container.addChild(clipContainer)
    clipContainer.mask = mask
    this.frameItems.push(clipContainer)
    state.container = clipContainer
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    const graphics = this.acquireGraphics()
    graphics.rect(x, y, width, height)
    graphics.fill(toPixiFillStyle(this.fillStyle))
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    const graphics = this.acquireGraphics()
    graphics.rect(x, y, width, height)
    applyStrokeStyle(
      graphics,
      this.strokeStyle,
      this.lineWidth,
      this.lineCap,
      this.lineJoin
    )
  }

  clearRect(_x: number, _y: number, _width: number, _height: number): void {
    this.beginFrame()
  }

  translate(x: number, y: number): void {
    appendTranslation(this.currentState().transform, x, y)
  }

  scale(x: number, y: number): void {
    appendScale(this.currentState().transform, x, y)
  }

  rotate(angle: number): void {
    appendRotation(this.currentState().transform, angle)
  }

  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    const sprite = this.acquireSprite(image)
    const stateTransform = this.currentState().transform
    this.tempMatrix.set(
      stateTransform.a,
      stateTransform.b,
      stateTransform.c,
      stateTransform.d,
      stateTransform.e + stateTransform.a * dx + stateTransform.c * dy,
      stateTransform.f + stateTransform.b * dx + stateTransform.d * dy
    )
    sprite.setFromMatrix(this.tempMatrix)
    sprite.width = dw
    sprite.height = dh
  }

  fillText(text: string, x: number, y: number): void {
    const textIndex = this.textPoolIndex
    const textObject = this.acquireText()
    let textMeta = this.textMetaPool[textIndex]
    if (!textMeta) {
      textMeta = {
        text: '',
        fontFamily: '',
        fontSize: 0,
        fill: '',
        anchorX: -1,
        anchorY: -1,
      }
      this.textMetaPool[textIndex] = textMeta
    }
    const parsedFont = parseFont(this.font)
    const fill = toPixiFillStyle(this.fillStyle)
    const anchorX = getTextAnchorX(this.textAlign)
    const anchorY = getTextAnchorY(this.textBaseline)
    if (textMeta.text !== text) {
      textObject.text = text
      textMeta.text = text
    }
    if (textMeta.fontFamily !== parsedFont.fontFamily) {
      textObject.style.fontFamily = parsedFont.fontFamily
      textMeta.fontFamily = parsedFont.fontFamily
    }
    if (textMeta.fontSize !== parsedFont.fontSize) {
      textObject.style.fontSize = parsedFont.fontSize
      textMeta.fontSize = parsedFont.fontSize
    }
    if (textMeta.fill !== fill) {
      textObject.style.fill = fill
      textMeta.fill = fill
    }
    if (textMeta.anchorX !== anchorX || textMeta.anchorY !== anchorY) {
      textObject.anchor.set(anchorX, anchorY)
      textMeta.anchorX = anchorX
      textMeta.anchorY = anchorY
    }
    const stateTransform = this.currentState().transform
    this.tempMatrix.set(
      stateTransform.a,
      stateTransform.b,
      stateTransform.c,
      stateTransform.d,
      stateTransform.e + stateTransform.a * x + stateTransform.c * y,
      stateTransform.f + stateTransform.b * x + stateTransform.d * y
    )
    textObject.setFromMatrix(this.tempMatrix)
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradient {
    return new FillGradient({
      type: 'radial',
      textureSpace: 'global',
      center: { x: x0, y: y0 },
      innerRadius: r0,
      outerCenter: { x: x1, y: y1 },
      outerRadius: r1,
      colorStops: [],
    })
  }

  setLineDash(_segments: number[]): void {}

  getTransform(): DOMMatrix {
    const transform = this.currentState().transform
    const m = this.reusableDOMMatrix
    m.a = transform.a
    m.b = transform.b
    m.c = transform.c
    m.d = transform.d
    m.e = transform.e
    m.f = transform.f
    return m
  }

  // --- Path buffer helpers (zero allocation) ---

  private pushCmd(type: number): void {
    const idx = this.pathCmdCount
    if (idx >= this.pathCmdTypes.length) {
      const newTypes = new Int8Array(this.pathCmdTypes.length * 2)
      newTypes.set(this.pathCmdTypes)
      this.pathCmdTypes = newTypes
    }
    this.pathCmdTypes[idx] = type
    this.pathCmdCount = idx + 1
  }

  private ensureDataCapacity(count: number): void {
    const needed = this.pathDataIndex + count
    if (needed > this.pathCmdData.length) {
      let newSize = this.pathCmdData.length * 2
      while (newSize < needed) newSize *= 2
      const newData = new Float64Array(newSize)
      newData.set(this.pathCmdData)
      this.pathCmdData = newData
    }
  }

  private pushData2(a: number, b: number): void {
    this.ensureDataCapacity(2)
    const idx = this.pathDataIndex
    this.pathCmdData[idx] = a
    this.pathCmdData[idx + 1] = b
    this.pathDataIndex = idx + 2
  }

  private pushData4(a: number, b: number, c: number, d: number): void {
    this.ensureDataCapacity(4)
    const idx = this.pathDataIndex
    this.pathCmdData[idx] = a
    this.pathCmdData[idx + 1] = b
    this.pathCmdData[idx + 2] = c
    this.pathCmdData[idx + 3] = d
    this.pathDataIndex = idx + 4
  }

  // --- Internal state/pool helpers ---

  private currentState(): RenderState {
    return this.statePool[this.stateStackTop]
  }

  private syncFromState(): void {
    const state = this.currentState()
    this.fillStyle = state.fillStyle
    this.strokeStyle = state.strokeStyle
    this.globalAlpha = state.globalAlpha
    this.globalCompositeOperation = state.globalCompositeOperation
    this.lineWidth = state.lineWidth
    this.lineCap = state.lineCap
    this.lineJoin = state.lineJoin
    this.font = state.font
    this.textAlign = state.textAlign
    this.textBaseline = state.textBaseline
    this.renderZIndex = state.renderZIndex
  }

  private updateStateFromPublicFields(): RenderState {
    const state = this.currentState()
    state.fillStyle = this.fillStyle
    state.strokeStyle = this.strokeStyle
    state.globalAlpha = this.globalAlpha
    state.globalCompositeOperation = this.globalCompositeOperation
    state.lineWidth = this.lineWidth
    state.lineCap = this.lineCap
    state.lineJoin = this.lineJoin
    state.font = this.font
    state.textAlign = this.textAlign
    state.textBaseline = this.textBaseline
    state.renderZIndex = this.renderZIndex
    return state
  }

  private applyDisplayObjectState(displayObject: Container): void {
    const state = this.updateStateFromPublicFields()
    displayObject.alpha = state.globalAlpha
    displayObject.blendMode =
      state.globalCompositeOperation === 'lighter' ? 'add' : 'normal'
    displayObject.zIndex =
      state.renderZIndex * RENDER_Z_ORDER_STEP + this.frameOrder
    this.frameOrder += 1
    this.tempMatrix.set(
      state.transform.a,
      state.transform.b,
      state.transform.c,
      state.transform.d,
      state.transform.e,
      state.transform.f
    )
    displayObject.setFromMatrix(this.tempMatrix)
  }

  private acquireGraphics(): Graphics {
    let graphics = this.graphicsPool[this.graphicsPoolIndex]
    if (!graphics) {
      graphics = new Graphics()
      this.graphicsPool[this.graphicsPoolIndex] = graphics
    }
    this.graphicsPoolIndex += 1
    graphics.clear()
    resetDisplayObject(graphics)
    graphics.roundPixels = false
    this.applyDisplayObjectState(graphics)
    const parent = this.currentState().container
    if (graphics.parent !== parent) {
      parent.addChild(graphics)
    }
    this.frameItems.push(graphics)
    return graphics
  }

  private acquireText(): Text {
    let textObject = this.textPool[this.textPoolIndex]
    if (!textObject) {
      textObject = new Text({ text: '', style: {} })
      this.textPool[this.textPoolIndex] = textObject
    }
    this.textPoolIndex += 1
    resetDisplayObject(textObject)
    textObject.roundPixels = false
    this.applyDisplayObjectState(textObject)
    const parent = this.currentState().container
    if (textObject.parent !== parent) {
      parent.addChild(textObject)
    }
    this.frameItems.push(textObject)
    return textObject
  }

  private acquireSprite(image: CanvasImageSource): Sprite {
    let sprite = this.spritePool[this.spritePoolIndex]
    if (!sprite) {
      sprite = new Sprite()
      this.spritePool[this.spritePoolIndex] = sprite
    }
    this.spritePoolIndex += 1
    resetDisplayObject(sprite)
    sprite.roundPixels = false
    sprite.texture = this.getTexture(image)
    this.applyDisplayObjectState(sprite)
    const parent = this.currentState().container
    if (sprite.parent !== parent) {
      parent.addChild(sprite)
    }
    this.frameItems.push(sprite)
    return sprite
  }

  private acquireContainer(): Container {
    let container = this.containerPool[this.containerPoolIndex]
    if (!container) {
      container = new Container()
      this.containerPool[this.containerPoolIndex] = container
    }
    this.containerPoolIndex += 1
    resetDisplayObject(container)
    return container
  }

  private getTexture(image: CanvasImageSource): Texture {
    const source = image as TextureImageSource
    if (typeof image === 'object' && image !== null) {
      const cached = this.imageTextureCache.get(image)
      if (cached) {
        return cached
      }
      const created = Texture.from(source)
      this.imageTextureCache.set(image, created)
      return created
    }
    return Texture.from(source)
  }
}
