import { Container, type Filter, Sprite, Texture } from 'pixi.js'

import type { ClientRenderer } from '../ClientRenderer'
import { normalizeHexColor } from '../colorUtils'
import type {
  EditorMapData,
  MapEnvironmentObject,
  MapLightFlickerMode,
  MapLightObject,
} from '../editorMapTypes'
import { normalizeRenderLayer } from '../renderLayers'
import type { DayNightLightingState } from './DayNightCycle'
import { LIGHTING_MAX_LIGHTS, LightingFilter } from './LightingFilter'
import type { PixiWorldRenderer } from './PixiWorldRenderer'

const LIGHT_COLOR_CHECKPOINT = 0xffdb8c
const LIGHT_COLOR_HOUSE = 0xffb35a
const LIGHT_COLOR_DEFAULT = 0xffd27a
const LIGHT_COLOR_SUN = 0xffd060
const PLAYER_LIGHT_COLOR = 0xffe8c8
const LIGHT_SCORE_SCALE = 10000
const LIGHT_GLOW_ALPHA_SCALE = 0.58
const DAYTIME_LIGHT_FLOOR_255 = 96
const CHECKPOINT_LIGHT_OFFSET_Y_METERS = 1.45
const CHECKPOINT_ACTIVE_LIGHT_RADIUS_METERS = 5.6
const CHECKPOINT_ACTIVE_LIGHT_INTENSITY_255 = 224
const CHECKPOINT_INACTIVE_LIGHT_RADIUS_METERS = 2.4
const CHECKPOINT_INACTIVE_LIGHT_INTENSITY_255 = 72
const CHECKPOINT_INACTIVE_GLOW_OFFSET_Y_METERS = 0.8
const CHECKPOINT_INACTIVE_GLOW_ALPHA = 6.0
const CHECKPOINT_INACTIVE_GLOW_RADIUS_SCALE = 1.6
const SUN_SMALL_LIGHT_RADIUS_METERS = 2.2
const SUN_SMALL_LIGHT_INTENSITY_255 = 176
const SUN_LARGE_LIGHT_RADIUS_METERS = 4.2
const SUN_LARGE_LIGHT_INTENSITY_255 = 216
const HOUSE_LIGHT_RADIUS_METERS = 3.4
const HOUSE_LIGHT_OFFSET_Y_METERS = 1.0
const HOUSE_GLOW_ALPHA = 0.38
const MANUAL_LIGHT_GLOW_ALPHA = 0.44
const TRANSIENT_LIGHT_TYPE_HEAL = 1
const TRANSIENT_LIGHT_TYPE_CHECKPOINT = 2
const HEAL_GLOW_ALPHA = 0.78
const HEAL_GLOW_RADIUS_SCALE = 0.32
const CHECKPOINT_PULSE_GLOW_ALPHA = 0.62
const CHECKPOINT_PULSE_GLOW_RADIUS_SCALE = 0.48
const PLAYER_LIGHT_RADIUS_METERS = 5.2
const PLAYER_LIGHT_INTENSITY_255 = 210
const FILTER_BYPASS_MIN_CHANNEL_255 = 248
const FILTER_BYPASS_MIN_INTENSITY_255 = 248
const MAX_LIGHT_SCORE = 999999999
const MAX_VISIBLE_LIGHT_SOURCES = 64
const LOCAL_LIGHT_LAYER_RANGE = 2

type LightFlickerModeCode = 0 | 1 | 2

interface LayerLightingRuntime {
  readonly filter: LightingFilter
  readonly filters: Filter[]
  readonly lightData: Float32Array
  readonly lightColor: Float32Array
  readonly lightScores: Float32Array
  readonly glowWorldData: Float32Array
  readonly glowColor: Int32Array
  readonly glowSprites: Sprite[]
  glowContainer: Container
  visibleLightCount: number
  filterApplied: boolean
}

function clamp255(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  const rounded = Math.round(value)
  if (rounded <= 0) {
    return 0
  }
  if (rounded >= 255) {
    return 255
  }
  return rounded
}

function parseLightColor(color: string | undefined, fallback: number): number {
  if (!color) {
    return fallback
  }
  const normalized = normalizeHexColor(color, '#000000')
  return Number.parseInt(normalized.slice(1, 7), 16)
}

function resolveFlickerModeCode(
  mode: MapLightFlickerMode | undefined
): LightFlickerModeCode {
  if (mode === 'candle') {
    return 1
  }
  if (mode === 'torch') {
    return 2
  }
  return 0
}

function createGlowTexture(): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return Texture.WHITE
  }

  const center = canvas.width >> 1
  const gradient = ctx.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center
  )
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.16, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.32, 'rgba(255, 255, 255, 0.92)')
  gradient.addColorStop(0.54, 'rgba(255, 255, 255, 0.42)')
  gradient.addColorStop(0.76, 'rgba(255, 255, 255, 0.1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(center, center, center, 0, Math.PI * 2)
  ctx.fill()
  return Texture.from(canvas)
}

export class WorldLightingController {
  private readonly pixelsPerMeter: number
  private readonly fallbackFilter: LightingFilter
  private readonly glowTexture: Texture
  private readonly layerRuntimes = new Map<number, LayerLightingRuntime>()
  private readonly sourceScores = new Float32Array(MAX_VISIBLE_LIGHT_SOURCES)
  private readonly sourceScreenData = new Float32Array(
    MAX_VISIBLE_LIGHT_SOURCES * 4
  )
  private readonly sourceWorldGlowData = new Float32Array(
    MAX_VISIBLE_LIGHT_SOURCES * 4
  )
  private readonly sourceColor = new Int32Array(MAX_VISIBLE_LIGHT_SOURCES)
  private readonly sourceLayer = new Int32Array(MAX_VISIBLE_LIGHT_SOURCES)
  private readonly mapLightX: number[] = []
  private readonly mapLightY: number[] = []
  private readonly mapLightRadius: number[] = []
  private readonly mapLightLayer: number[] = []
  private readonly mapLightColor: number[] = []
  private readonly mapLightIntensity: number[] = []
  private readonly mapLightNightOnly: number[] = []
  private readonly mapLightFlicker: LightFlickerModeCode[] = []
  private readonly mapLightGlowAlpha: number[] = []
  private readonly mapLightSeed: number[] = []
  private mapLightCount = 0
  private sourceLightCount = 0
  private elapsedMs = 0
  private filterActive = true

  constructor(glowContainer: Container, pixelsPerMeter: number) {
    glowContainer.visible = false
    this.pixelsPerMeter = pixelsPerMeter
    this.fallbackFilter = new LightingFilter()
    this.glowTexture = createGlowTexture()
  }

  getFilter(): LightingFilter {
    return this.fallbackFilter
  }

  getVisibleLightCount(): number {
    return this.sourceLightCount
  }

  getMapLightCount(): number {
    return this.mapLightCount
  }

  isFilterActive(): boolean {
    return this.filterActive
  }

  destroy(): void {
    for (const runtime of this.layerRuntimes.values()) {
      for (let i = 0; i < runtime.glowSprites.length; i++) {
        runtime.glowSprites[i].destroy()
      }
      runtime.glowSprites.length = 0
      runtime.glowContainer.visible = false
    }
    this.layerRuntimes.clear()
    if (this.glowTexture !== Texture.WHITE) {
      this.glowTexture.destroy(true)
    }
  }

  setMap(map: EditorMapData | null): void {
    this.mapLightCount = 0
    this.mapLightX.length = 0
    this.mapLightY.length = 0
    this.mapLightRadius.length = 0
    this.mapLightLayer.length = 0
    this.mapLightColor.length = 0
    this.mapLightIntensity.length = 0
    this.mapLightNightOnly.length = 0
    this.mapLightFlicker.length = 0
    this.mapLightGlowAlpha.length = 0
    this.mapLightSeed.length = 0

    if (!map) {
      return
    }

    const manualLights = map.lights
    if (manualLights && manualLights.length > 0) {
      for (let i = 0; i < manualLights.length; i++) {
        this.appendManualLight(manualLights[i])
      }
    }

    const environmentObjects = map.environmentObjects
    if (environmentObjects && environmentObjects.length > 0) {
      for (let i = 0; i < environmentObjects.length; i++) {
        this.appendEnvironmentLight(environmentObjects[i])
      }
    }
  }

  update(
    deltaMs: number,
    lightingState: DayNightLightingState,
    renderer: ClientRenderer,
    worldRenderer: PixiWorldRenderer,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    this.elapsedMs += deltaMs | 0
    if (this.elapsedMs >= 1_000_000_000) {
      this.elapsedMs %= 1_000_000_000
    }

    this.beginFrame()

    if (zoom > 0 && screenWidth > 0 && screenHeight > 0) {
      this.collectMapLights(
        lightingState.localLightVisibility255,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
      this.collectPlayerLight(
        lightingState.localLightVisibility255,
        renderer,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
      this.collectRuntimeCheckpointLights(
        lightingState.localLightVisibility255,
        renderer,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
      this.collectInactiveCheckpointLights(
        lightingState.localLightVisibility255,
        renderer,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
      this.collectSunPickupLights(
        lightingState.localLightVisibility255,
        renderer,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
      this.collectTransientLights(
        lightingState.localLightVisibility255,
        renderer,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }

    this.applyLayerLighting(lightingState, worldRenderer)
  }

  private appendManualLight(light: MapLightObject): void {
    const radius =
      typeof light.radius === 'number' && Number.isFinite(light.radius)
        ? light.radius
        : 0
    if (!(radius > 0)) {
      return
    }
    this.appendBaseLight(
      light.x,
      light.y,
      radius,
      normalizeRenderLayer(light.renderLayer, 0),
      parseLightColor(light.color, LIGHT_COLOR_DEFAULT),
      clamp255(light.intensity ?? 220),
      light.nightOnly === true ? 1 : 0,
      resolveFlickerModeCode(light.flicker),
      MANUAL_LIGHT_GLOW_ALPHA
    )
  }

  private appendEnvironmentLight(
    environmentObject: MapEnvironmentObject
  ): void {
    if (environmentObject.hidden === true) {
      return
    }
    if (environmentObject.type !== 'house') {
      return
    }
    this.appendBaseLight(
      environmentObject.x,
      environmentObject.y - HOUSE_LIGHT_OFFSET_Y_METERS,
      HOUSE_LIGHT_RADIUS_METERS,
      0,
      LIGHT_COLOR_HOUSE,
      212,
      1,
      0,
      HOUSE_GLOW_ALPHA
    )
  }

  private appendBaseLight(
    x: number,
    y: number,
    radius: number,
    renderLayer: number,
    color: number,
    intensity: number,
    nightOnly: 0 | 1,
    flicker: LightFlickerModeCode,
    glowAlpha: number
  ): void {
    this.mapLightX.push(x)
    this.mapLightY.push(y)
    this.mapLightRadius.push(radius)
    this.mapLightLayer.push(renderLayer | 0)
    this.mapLightColor.push(color)
    this.mapLightIntensity.push(clamp255(intensity))
    this.mapLightNightOnly.push(nightOnly)
    this.mapLightFlicker.push(flicker)
    this.mapLightGlowAlpha.push(glowAlpha)
    this.mapLightSeed.push(
      this.computeLightSeed(x, y, radius, color, renderLayer)
    )
    this.mapLightCount += 1
  }

  private beginFrame(): void {
    this.sourceLightCount = 0
    this.filterActive = false
    for (let i = 0; i < MAX_VISIBLE_LIGHT_SOURCES; i++) {
      this.sourceScores[i] = -MAX_LIGHT_SCORE
    }
  }

  private collectMapLights(
    lightVisibility255: number,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    for (let i = 0; i < this.mapLightCount; i++) {
      const visibility255 = this.mapLightNightOnly[i]
        ? lightVisibility255
        : Math.max(DAYTIME_LIGHT_FLOOR_255, lightVisibility255)
      if (visibility255 <= 0) {
        continue
      }

      const flicker256 = this.getFlickerScale256(
        this.mapLightFlicker[i],
        this.mapLightSeed[i]
      )
      const scaledIntensity255 =
        (((this.mapLightIntensity[i] * visibility255) >> 8) * flicker256) >> 8
      if (scaledIntensity255 <= 4) {
        continue
      }

      this.insertVisibleLightSource(
        this.mapLightX[i],
        this.mapLightY[i],
        this.mapLightRadius[i],
        this.mapLightLayer[i],
        this.mapLightColor[i],
        scaledIntensity255,
        this.mapLightGlowAlpha[i],
        0.58,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }
  }

  private collectRuntimeCheckpointLights(
    lightVisibility255: number,
    renderer: ClientRenderer,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    if (lightVisibility255 <= 0) {
      return
    }
    const checkpointCount = renderer.getActiveCheckpointLightCount()
    for (let i = 0; i < checkpointCount; i++) {
      const checkpointRadius = renderer.getActiveCheckpointLightRadius(i)
      const lightRadius =
        checkpointRadius > 0
          ? Math.max(
              CHECKPOINT_ACTIVE_LIGHT_RADIUS_METERS,
              checkpointRadius * 2 + 1
            )
          : CHECKPOINT_ACTIVE_LIGHT_RADIUS_METERS
      this.insertVisibleLightSource(
        renderer.getActiveCheckpointLightX(i),
        renderer.getActiveCheckpointLightY(i) -
          CHECKPOINT_LIGHT_OFFSET_Y_METERS,
        lightRadius,
        renderer.getActiveCheckpointLightLayer(i),
        LIGHT_COLOR_CHECKPOINT,
        (CHECKPOINT_ACTIVE_LIGHT_INTENSITY_255 * lightVisibility255) >> 8,
        0,
        0,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }
  }

  private collectInactiveCheckpointLights(
    lightVisibility255: number,
    renderer: ClientRenderer,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    const count = renderer.getInactiveCheckpointLightCount()
    for (let i = 0; i < count; i++) {
      const visibility255 = Math.max(
        DAYTIME_LIGHT_FLOOR_255,
        lightVisibility255
      )
      const intensity255 =
        (CHECKPOINT_INACTIVE_LIGHT_INTENSITY_255 * visibility255) >> 8
      if (intensity255 <= 4) {
        continue
      }
      this.insertVisibleLightSource(
        renderer.getInactiveCheckpointLightX(i),
        renderer.getInactiveCheckpointLightY(i) -
          CHECKPOINT_INACTIVE_GLOW_OFFSET_Y_METERS,
        CHECKPOINT_INACTIVE_LIGHT_RADIUS_METERS,
        renderer.getInactiveCheckpointLightLayer(i),
        LIGHT_COLOR_CHECKPOINT,
        intensity255,
        CHECKPOINT_INACTIVE_GLOW_ALPHA,
        CHECKPOINT_INACTIVE_GLOW_RADIUS_SCALE,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }
  }

  private collectSunPickupLights(
    lightVisibility255: number,
    renderer: ClientRenderer,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    const visibility255 = lightVisibility255
    const smallCount = renderer.getSunPickupSmallCount()
    for (let i = 0; i < smallCount; i++) {
      const intensity255 = (SUN_SMALL_LIGHT_INTENSITY_255 * visibility255) >> 8
      if (intensity255 <= 4) {
        continue
      }
      this.insertVisibleLightSource(
        renderer.getSunPickupSmallX(i),
        renderer.getSunPickupSmallY(i),
        SUN_SMALL_LIGHT_RADIUS_METERS,
        renderer.getSunPickupSmallLayer(i),
        LIGHT_COLOR_SUN,
        intensity255,
        0,
        0,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }
    const largeCount = renderer.getSunPickupLargeCount()
    for (let i = 0; i < largeCount; i++) {
      const intensity255 = (SUN_LARGE_LIGHT_INTENSITY_255 * visibility255) >> 8
      if (intensity255 <= 4) {
        continue
      }
      this.insertVisibleLightSource(
        renderer.getSunPickupLargeX(i),
        renderer.getSunPickupLargeY(i),
        SUN_LARGE_LIGHT_RADIUS_METERS,
        renderer.getSunPickupLargeLayer(i),
        LIGHT_COLOR_SUN,
        intensity255,
        0,
        0,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }
  }

  private collectPlayerLight(
    lightVisibility255: number,
    renderer: ClientRenderer,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    if (!renderer.hasPlayerPosition()) {
      return
    }
    const intensity255 = (PLAYER_LIGHT_INTENSITY_255 * lightVisibility255) >> 8
    if (intensity255 <= 4) {
      return
    }
    this.insertVisibleLightSource(
      renderer.getPlayerWorldX(),
      renderer.getPlayerWorldY(),
      PLAYER_LIGHT_RADIUS_METERS,
      renderer.getPlayerRenderLayer(),
      PLAYER_LIGHT_COLOR,
      intensity255,
      0,
      0,
      cameraXPx,
      cameraYPx,
      zoom,
      shakeXPx,
      shakeYPx,
      screenWidth,
      screenHeight
    )
  }

  private collectTransientLights(
    lightVisibility255: number,
    renderer: ClientRenderer,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    const lightCount = renderer.getTransientLightCount()
    for (let i = 0; i < lightCount; i++) {
      const lightLife = renderer.getTransientLightLife(i)
      const lightAge = renderer.getTransientLightAge(i)
      const lifeRatio = lightLife > 0 ? lightAge / lightLife : 1
      const remainingRatio = Math.max(0, 1 - lifeRatio)
      const baseIntensity255 =
        Math.round(
          renderer.getTransientLightIntensity(i) * 255 * remainingRatio
        ) | 0
      if (baseIntensity255 <= 0) {
        continue
      }
      const type = renderer.getTransientLightType(i)
      let finalIntensity255 = baseIntensity255
      let glowAlpha = 0
      let glowRadiusScale = CHECKPOINT_PULSE_GLOW_RADIUS_SCALE
      let radius = renderer.getTransientLightRadius(i)
      if (type === TRANSIENT_LIGHT_TYPE_CHECKPOINT) {
        finalIntensity255 = (baseIntensity255 * lightVisibility255) >> 8
        radius *= 0.5 + lifeRatio
        glowAlpha = CHECKPOINT_PULSE_GLOW_ALPHA
      } else if (type === TRANSIENT_LIGHT_TYPE_HEAL) {
        finalIntensity255 =
          (baseIntensity255 *
            Math.max(DAYTIME_LIGHT_FLOOR_255, lightVisibility255)) >>
          8
        radius *= 0.8 + remainingRatio * 0.35
        glowAlpha = HEAL_GLOW_ALPHA
        glowRadiusScale = HEAL_GLOW_RADIUS_SCALE
      }
      if (finalIntensity255 <= 0) {
        continue
      }
      this.insertVisibleLightSource(
        renderer.getTransientLightX(i),
        renderer.getTransientLightY(i),
        radius,
        renderer.getTransientLightLayer(i),
        renderer.getTransientLightColor(i),
        finalIntensity255,
        glowAlpha,
        glowRadiusScale,
        cameraXPx,
        cameraYPx,
        zoom,
        shakeXPx,
        shakeYPx,
        screenWidth,
        screenHeight
      )
    }
  }

  private insertVisibleLightSource(
    worldX: number,
    worldY: number,
    radiusMeters: number,
    renderLayer: number,
    color: number,
    intensity255: number,
    glowAlphaScale: number,
    glowRadiusScale: number,
    cameraXPx: number,
    cameraYPx: number,
    zoom: number,
    shakeXPx: number,
    shakeYPx: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    const worldXPx = worldX * this.pixelsPerMeter
    const worldYPx = worldY * this.pixelsPerMeter
    const worldRadiusPx = radiusMeters * this.pixelsPerMeter
    const screenRadiusPx = worldRadiusPx * zoom
    if (!(screenRadiusPx > 0)) {
      return
    }

    const centerX = screenWidth * 0.5
    const bottomY = screenHeight
    const screenX = (worldXPx - cameraXPx - centerX) * zoom + centerX + shakeXPx
    const screenY = (worldYPx - cameraYPx - bottomY) * zoom + bottomY + shakeYPx

    if (
      screenX < -screenRadiusPx ||
      screenX > screenWidth + screenRadiusPx ||
      screenY < -screenRadiusPx ||
      screenY > screenHeight + screenRadiusPx
    ) {
      return
    }

    const score = this.computeLightScore(
      screenX,
      screenY,
      intensity255,
      screenWidth,
      screenHeight
    )
    let insertAt = 0
    while (
      insertAt < this.sourceLightCount &&
      score <= this.sourceScores[insertAt]
    ) {
      insertAt += 1
    }

    if (insertAt >= MAX_VISIBLE_LIGHT_SOURCES) {
      return
    }

    const copyUntil =
      this.sourceLightCount < MAX_VISIBLE_LIGHT_SOURCES
        ? this.sourceLightCount
        : MAX_VISIBLE_LIGHT_SOURCES - 1
    for (let i = copyUntil; i > insertAt; i--) {
      this.copyVisibleSourceSlot(i - 1, i)
    }

    const shaderIntensity = intensity255 / 255
    const glowAlpha = shaderIntensity * LIGHT_GLOW_ALPHA_SCALE * glowAlphaScale
    this.sourceScores[insertAt] = score
    this.writeVisibleSourceSlot(
      insertAt,
      screenX,
      screenY,
      screenRadiusPx,
      shaderIntensity,
      color,
      worldXPx,
      worldYPx,
      worldRadiusPx * glowRadiusScale,
      glowAlpha,
      renderLayer
    )

    if (this.sourceLightCount < MAX_VISIBLE_LIGHT_SOURCES) {
      this.sourceLightCount += 1
    }
  }

  private copyVisibleSourceSlot(from: number, to: number): void {
    const fromBase = from << 2
    const toBase = to << 2
    this.sourceScores[to] = this.sourceScores[from]
    this.sourceScreenData[toBase] = this.sourceScreenData[fromBase]
    this.sourceScreenData[toBase + 1] = this.sourceScreenData[fromBase + 1]
    this.sourceScreenData[toBase + 2] = this.sourceScreenData[fromBase + 2]
    this.sourceScreenData[toBase + 3] = this.sourceScreenData[fromBase + 3]
    this.sourceWorldGlowData[toBase] = this.sourceWorldGlowData[fromBase]
    this.sourceWorldGlowData[toBase + 1] =
      this.sourceWorldGlowData[fromBase + 1]
    this.sourceWorldGlowData[toBase + 2] =
      this.sourceWorldGlowData[fromBase + 2]
    this.sourceWorldGlowData[toBase + 3] =
      this.sourceWorldGlowData[fromBase + 3]
    this.sourceColor[to] = this.sourceColor[from]
    this.sourceLayer[to] = this.sourceLayer[from]
  }

  private writeVisibleSourceSlot(
    index: number,
    screenX: number,
    screenY: number,
    screenRadiusPx: number,
    shaderIntensity: number,
    color: number,
    worldXPx: number,
    worldYPx: number,
    glowRadiusPx: number,
    glowAlpha: number,
    renderLayer: number
  ): void {
    const base = index << 2
    this.sourceScreenData[base] = screenX
    this.sourceScreenData[base + 1] = screenY
    this.sourceScreenData[base + 2] = screenRadiusPx
    this.sourceScreenData[base + 3] = shaderIntensity
    this.sourceWorldGlowData[base] = worldXPx
    this.sourceWorldGlowData[base + 1] = worldYPx
    this.sourceWorldGlowData[base + 2] = glowRadiusPx
    this.sourceWorldGlowData[base + 3] = glowAlpha
    this.sourceColor[index] = color
    this.sourceLayer[index] = renderLayer | 0
  }

  private applyLayerLighting(
    lightingState: DayNightLightingState,
    worldRenderer: PixiWorldRenderer
  ): void {
    const ambientNearIdentity = this.isAmbientNearIdentity(
      lightingState.ambientColor,
      lightingState.ambientIntensity255
    )
    const layerCount = worldRenderer.getBucketLayerCount()

    for (let i = 0; i < layerCount; i++) {
      const layer = worldRenderer.getBucketLayerAt(i)
      const lightingContainer = worldRenderer.getLayerLightingContainer(layer)
      const glowContainer = worldRenderer.getLayerGlowContainer(layer)
      if (!lightingContainer || !glowContainer) {
        continue
      }

      const runtime = this.ensureLayerRuntime(layer, glowContainer)
      runtime.filter.setAmbient(
        lightingState.ambientColor,
        lightingState.ambientIntensity255
      )
      this.beginLayerFrame(runtime)

      for (
        let sourceIndex = 0;
        sourceIndex < this.sourceLightCount;
        sourceIndex++
      ) {
        if (!this.isLightAffectingLayer(layer, this.sourceLayer[sourceIndex])) {
          continue
        }
        this.insertLayerLight(runtime, sourceIndex)
      }

      const shouldApplyFilter =
        runtime.visibleLightCount > 0 || !ambientNearIdentity
      if (shouldApplyFilter) {
        runtime.filter.setLightCount(runtime.visibleLightCount)
        runtime.filter.commit()
      }
      if (runtime.filterApplied !== shouldApplyFilter) {
        lightingContainer.filters = shouldApplyFilter ? runtime.filters : null
        runtime.filterApplied = shouldApplyFilter
      }

      this.updateLayerGlowSprites(runtime)
      if (shouldApplyFilter) {
        this.filterActive = true
      }
    }
  }

  private ensureLayerRuntime(
    layer: number,
    glowContainer: Container
  ): LayerLightingRuntime {
    const cached = this.layerRuntimes.get(layer)
    if (cached) {
      cached.glowContainer = glowContainer
      return cached
    }

    const filter = new LightingFilter()
    const runtime: LayerLightingRuntime = {
      filter,
      filters: [filter],
      lightData: filter.getLightDataBuffer(),
      lightColor: filter.getLightColorBuffer(),
      lightScores: new Float32Array(LIGHTING_MAX_LIGHTS),
      glowWorldData: new Float32Array(LIGHTING_MAX_LIGHTS * 4),
      glowColor: new Int32Array(LIGHTING_MAX_LIGHTS),
      glowSprites: [],
      glowContainer,
      visibleLightCount: 0,
      filterApplied: false,
    }
    this.layerRuntimes.set(layer, runtime)
    return runtime
  }

  private beginLayerFrame(runtime: LayerLightingRuntime): void {
    runtime.visibleLightCount = 0
    for (let i = 0; i < LIGHTING_MAX_LIGHTS; i++) {
      runtime.lightScores[i] = -MAX_LIGHT_SCORE
    }
  }

  private isLightAffectingLayer(
    targetLayer: number,
    sourceLayer: number
  ): boolean {
    return (
      Math.abs((targetLayer | 0) - (sourceLayer | 0)) <= LOCAL_LIGHT_LAYER_RANGE
    )
  }

  private insertLayerLight(
    runtime: LayerLightingRuntime,
    sourceIndex: number
  ): void {
    const sourceBase = sourceIndex << 2
    const score = this.sourceScores[sourceIndex]
    let insertAt = 0
    while (
      insertAt < runtime.visibleLightCount &&
      score <= runtime.lightScores[insertAt]
    ) {
      insertAt += 1
    }

    if (insertAt >= LIGHTING_MAX_LIGHTS) {
      return
    }

    const copyUntil =
      runtime.visibleLightCount < LIGHTING_MAX_LIGHTS
        ? runtime.visibleLightCount
        : LIGHTING_MAX_LIGHTS - 1
    for (let i = copyUntil; i > insertAt; i--) {
      this.copyLayerLightSlot(runtime, i - 1, i)
    }

    const screenRadiusPx = this.sourceScreenData[sourceBase + 2]
    const base = insertAt << 2
    const invRadiusSq =
      screenRadiusPx > 0 ? 1 / (screenRadiusPx * screenRadiusPx) : 0
    const color = this.sourceColor[sourceIndex] | 0

    runtime.lightScores[insertAt] = score
    runtime.lightData[base] = this.sourceScreenData[sourceBase]
    runtime.lightData[base + 1] = this.sourceScreenData[sourceBase + 1]
    runtime.lightData[base + 2] = invRadiusSq
    runtime.lightData[base + 3] = this.sourceScreenData[sourceBase + 3]
    runtime.lightColor[base] = ((color >> 16) & 0xff) / 255
    runtime.lightColor[base + 1] = ((color >> 8) & 0xff) / 255
    runtime.lightColor[base + 2] = (color & 0xff) / 255
    runtime.lightColor[base + 3] = 1
    runtime.glowWorldData[base] = this.sourceWorldGlowData[sourceBase]
    runtime.glowWorldData[base + 1] = this.sourceWorldGlowData[sourceBase + 1]
    runtime.glowWorldData[base + 2] = this.sourceWorldGlowData[sourceBase + 2]
    runtime.glowWorldData[base + 3] = this.sourceWorldGlowData[sourceBase + 3]
    runtime.glowColor[insertAt] = color

    if (runtime.visibleLightCount < LIGHTING_MAX_LIGHTS) {
      runtime.visibleLightCount += 1
    }
  }

  private copyLayerLightSlot(
    runtime: LayerLightingRuntime,
    from: number,
    to: number
  ): void {
    const fromBase = from << 2
    const toBase = to << 2
    runtime.lightScores[to] = runtime.lightScores[from]
    runtime.lightData[toBase] = runtime.lightData[fromBase]
    runtime.lightData[toBase + 1] = runtime.lightData[fromBase + 1]
    runtime.lightData[toBase + 2] = runtime.lightData[fromBase + 2]
    runtime.lightData[toBase + 3] = runtime.lightData[fromBase + 3]
    runtime.lightColor[toBase] = runtime.lightColor[fromBase]
    runtime.lightColor[toBase + 1] = runtime.lightColor[fromBase + 1]
    runtime.lightColor[toBase + 2] = runtime.lightColor[fromBase + 2]
    runtime.lightColor[toBase + 3] = runtime.lightColor[fromBase + 3]
    runtime.glowWorldData[toBase] = runtime.glowWorldData[fromBase]
    runtime.glowWorldData[toBase + 1] = runtime.glowWorldData[fromBase + 1]
    runtime.glowWorldData[toBase + 2] = runtime.glowWorldData[fromBase + 2]
    runtime.glowWorldData[toBase + 3] = runtime.glowWorldData[fromBase + 3]
    runtime.glowColor[to] = runtime.glowColor[from]
  }

  private updateLayerGlowSprites(runtime: LayerLightingRuntime): void {
    runtime.glowContainer.visible = runtime.visibleLightCount > 0
    for (let i = 0; i < runtime.visibleLightCount; i++) {
      const sprite = this.ensureGlowSprite(runtime, i)
      const base = i << 2
      const diameter = runtime.glowWorldData[base + 2] * 2
      sprite.visible = true
      sprite.position.set(
        runtime.glowWorldData[base],
        runtime.glowWorldData[base + 1]
      )
      sprite.scale.set(diameter / this.glowTexture.width)
      sprite.alpha = runtime.glowWorldData[base + 3]
      sprite.tint = runtime.glowColor[i] | 0
    }

    for (
      let i = runtime.visibleLightCount;
      i < runtime.glowSprites.length;
      i++
    ) {
      const sprite = runtime.glowSprites[i]
      sprite.visible = false
      sprite.alpha = 1
    }
  }

  private ensureGlowSprite(
    runtime: LayerLightingRuntime,
    index: number
  ): Sprite {
    while (runtime.glowSprites.length <= index) {
      const sprite = new Sprite(this.glowTexture)
      sprite.anchor.set(0.5)
      sprite.visible = false
      sprite.blendMode = 'add'
      runtime.glowContainer.addChild(sprite)
      runtime.glowSprites.push(sprite)
    }
    return runtime.glowSprites[index]
  }

  private computeLightScore(
    screenX: number,
    screenY: number,
    intensity255: number,
    screenWidth: number,
    screenHeight: number
  ): number {
    const centerX = screenWidth * 0.5
    const centerY = screenHeight * 0.55
    const dx = screenX - centerX
    const dy = screenY - centerY
    return intensity255 * LIGHT_SCORE_SCALE - (dx * dx + dy * dy)
  }

  private computeLightSeed(
    x: number,
    y: number,
    radius: number,
    color: number,
    renderLayer: number
  ): number {
    let seed = Math.imul((x * 100) | 0, 1103515245)
    seed ^= Math.imul((y * 100) | 0, 12345)
    seed ^= Math.imul((radius * 100) | 0, 0x1b873593)
    seed ^= Math.imul(renderLayer | 0, 0x85ebca6b)
    seed ^= color | 0
    return seed | 0
  }

  private getFlickerScale256(mode: LightFlickerModeCode, seed: number): number {
    if (mode === 0) {
      return 256
    }

    const periodA = mode === 1 ? 700 : 520
    const periodB = mode === 1 ? 460 : 320
    const waveA = this.getTriangleWave256(
      this.elapsedMs + (seed & 255),
      periodA
    )
    const waveB = this.getTriangleWave256(
      ((this.elapsedMs * 3) >> 1) + ((seed >> 3) & 255),
      periodB
    )

    if (mode === 1) {
      return 188 + ((waveA * 30 + waveB * 22) >> 8)
    }
    return 206 + ((waveA * 24 + waveB * 18) >> 8)
  }

  private getTriangleWave256(elapsedMs: number, periodMs: number): number {
    if (periodMs <= 0) {
      return 256
    }
    const phase = elapsedMs % periodMs
    const half = periodMs >> 1
    if (half <= 0) {
      return 256
    }
    const triangle = phase <= half ? phase : periodMs - phase
    return Math.min(256, Math.max(0, (triangle << 8) / half))
  }

  private isAmbientNearIdentity(color: number, intensity255: number): boolean {
    if (intensity255 < FILTER_BYPASS_MIN_INTENSITY_255) {
      return false
    }
    return (
      ((color >> 16) & 0xff) >= FILTER_BYPASS_MIN_CHANNEL_255 &&
      ((color >> 8) & 0xff) >= FILTER_BYPASS_MIN_CHANNEL_255 &&
      (color & 0xff) >= FILTER_BYPASS_MIN_CHANNEL_255
    )
  }
}
