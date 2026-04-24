import {
  DEFAULT_MAP_TIME_PHASE,
  MAP_TIME_PHASE_IDS,
  type MapTimePhaseId,
} from '../editorMapTypes'

const DEBUG_CYCLE = false
export const DAY_CYCLE_MS = DEBUG_CYCLE ? 60_000 : 3_600_000

// 每段时长（6段均匀分布）
export const DAY_CYCLE_SEGMENT_MS = DAY_CYCLE_MS / 6
const SEG_MS = DAY_CYCLE_SEGMENT_MS
const PHASE_MASK_OFFSET_MS = 3 * SEG_MS

interface DayPhase {
  readonly skyColor: number
  readonly cloudColor: number
  readonly ambientColor: number
  readonly ambientIntensity255: number
  readonly localLightVisibility255: number
}

export interface DayNightLightingState {
  readonly sky: number
  readonly cloud: number
  readonly ambientColor: number
  readonly ambientIntensity255: number
  readonly localLightVisibility255: number
}

// 6个时间节点：早晨 中午 傍晚 夜晚 深夜 凌晨
const PHASES: readonly DayPhase[] = [
  {
    skyColor: 0x4a90d9,
    cloudColor: 0xe8f0f8,
    ambientColor: 0xfff1d3,
    ambientIntensity255: 206,
    localLightVisibility255: 72,
  }, // 早晨：暖日环境光，局部灯光开始淡出
  {
    skyColor: 0x5bbfff,
    cloudColor: 0xffffff,
    ambientColor: 0xffffff,
    ambientIntensity255: 255,
    localLightVisibility255: 0,
  }, // 中午：最亮环境光，无需局部灯光
  {
    skyColor: 0xc8740a,
    cloudColor: 0xddc480,
    ambientColor: 0xf4c37a,
    ambientIntensity255: 168,
    localLightVisibility255: 124,
  }, // 傍晚：暖色环境光，灯光重新显现
  {
    skyColor: 0x0d0b18,
    cloudColor: 0x2a2444,
    ambientColor: 0x7c86b5,
    ambientIntensity255: 84,
    localLightVisibility255: 255,
  }, // 夜晚：冷色低环境光，灯光最明显
  {
    skyColor: 0x000000,
    cloudColor: 0x000000,
    ambientColor: 0x53608e,
    ambientIntensity255: 52,
    localLightVisibility255: 255,
  }, // 深夜：最低环境光
  {
    skyColor: 0x0a0f2e,
    cloudColor: 0x1c1c3a,
    ambientColor: 0x8694c8,
    ambientIntensity255: 108,
    localLightVisibility255: 196,
  }, // 凌晨：冷蓝过渡，灯光仍然明显
]

export function isMapTimePhaseId(value: string): value is MapTimePhaseId {
  return (MAP_TIME_PHASE_IDS as readonly string[]).includes(value)
}

export function getMapTimePhaseElapsedMs(
  phase: MapTimePhaseId | undefined
): number {
  const resolvedPhase = phase ?? DEFAULT_MAP_TIME_PHASE
  for (let i = 0; i < MAP_TIME_PHASE_IDS.length; i++) {
    if (MAP_TIME_PHASE_IDS[i] === resolvedPhase) {
      return i * SEG_MS
    }
  }
  return PHASE_MASK_OFFSET_MS
}

function lerpColor(a: number, b: number, t256: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const r = ar + (((br - ar) * t256) >> 8)
  const g = ag + (((bg - ag) * t256) >> 8)
  const bv = ab + (((bb - ab) * t256) >> 8)
  return (r << 16) | (g << 8) | bv
}

function lerpByte(a: number, b: number, t256: number): number {
  return a + (((b - a) * t256) >> 8)
}

export class DayNightCycle {
  private elapsed = PHASE_MASK_OFFSET_MS

  private normalizeElapsed(elapsedMs: number): number {
    const normalized = Math.round(elapsedMs) % DAY_CYCLE_MS
    if (normalized < 0) {
      return normalized + DAY_CYCLE_MS
    }
    return normalized
  }

  update(deltaMs: number): void {
    this.elapsed = this.normalizeElapsed(this.elapsed + (deltaMs | 0))
  }

  getElapsed(): number {
    return this.elapsed
  }

  setElapsed(elapsedMs: number | undefined): void {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) {
      this.elapsed = PHASE_MASK_OFFSET_MS
      return
    }
    this.elapsed = this.normalizeElapsed(elapsedMs)
  }

  advanceToNextPhase(): void {
    const seg = (this.elapsed / SEG_MS) | 0
    this.elapsed = ((seg + 1) % PHASES.length) * SEG_MS
  }

  getLightingState(): DayNightLightingState {
    const seg = (this.elapsed / SEG_MS) | 0
    const segElapsed = this.elapsed - seg * SEG_MS
    const t256 = ((segElapsed << 8) / SEG_MS) | 0

    const a = PHASES[seg]
    const b = PHASES[(seg + 1) % PHASES.length]

    return {
      sky: lerpColor(a.skyColor, b.skyColor, t256),
      cloud: lerpColor(a.cloudColor, b.cloudColor, t256),
      ambientColor: lerpColor(a.ambientColor, b.ambientColor, t256),
      ambientIntensity255: lerpByte(
        a.ambientIntensity255,
        b.ambientIntensity255,
        t256
      ),
      localLightVisibility255: lerpByte(
        a.localLightVisibility255,
        b.localLightVisibility255,
        t256
      ),
    }
  }

  getColors(): { sky: number; cloud: number } {
    const lightingState = this.getLightingState()
    return {
      sky: lightingState.sky,
      cloud: lightingState.cloud,
    }
  }
}
