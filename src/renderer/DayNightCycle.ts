const DEBUG_CYCLE = false
export const DAY_CYCLE_MS = DEBUG_CYCLE ? 60_000 : 3_600_000

// 每段时长（6段均匀分布）
const SEG_MS = DAY_CYCLE_MS / 6

interface DayPhase {
  readonly skyColor: number
  readonly cloudColor: number
}

// 6个时间节点：早晨 中午 傍晚 夜晚 深夜 凌晨
const PHASES: readonly DayPhase[] = [
  { skyColor: 0x4a90d9, cloudColor: 0xe8f0f8 }, // 早晨：蓝天，淡白云
  { skyColor: 0x5bbfff, cloudColor: 0xffffff }, // 中午：亮蓝天，纯白云
  { skyColor: 0xc8740a, cloudColor: 0xddc480 }, // 傍晚：昏黄天，黄白云
  { skyColor: 0x0d0b18, cloudColor: 0x2a2444 }, // 夜晚：近黑天，暗色云
  { skyColor: 0x000000, cloudColor: 0x000000 }, // 深夜：纯黑，云不可见
  { skyColor: 0x0a0f2e, cloudColor: 0x1c1c3a }, // 凌晨：暗蓝天，暗色云
]

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

export class DayNightCycle {
  private elapsed = 0

  update(deltaMs: number): void {
    this.elapsed = (this.elapsed + (deltaMs | 0)) % DAY_CYCLE_MS
  }

  getColors(): { sky: number; cloud: number } {
    const seg = (this.elapsed / SEG_MS) | 0
    const segElapsed = this.elapsed - seg * SEG_MS
    const t256 = ((segElapsed << 8) / SEG_MS) | 0

    const a = PHASES[seg]
    const b = PHASES[(seg + 1) % PHASES.length]

    return {
      sky: lerpColor(a.skyColor, b.skyColor, t256),
      cloud: lerpColor(a.cloudColor, b.cloudColor, t256),
    }
  }
}
