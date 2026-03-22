import type { WeaponType } from '../types'

export type AttackKind = 'slash' | 'thrust' | 'strike' | 'sweep'

// 冲击力等级：小=无位移，中=普通位移，大=较大位移，极大=大位移+倒地
export type ImpactLevel = 'small' | 'medium' | 'large' | 'extreme'

// 单个攻击动作
export type AttackMoveData = {
  id: string // 'sword_slash_front'
  kind: AttackKind // 动作类型
  windupMs: number // 前摇 ms
  swingMs: number // 挥砍 ms
  pauseMs: number // 停顿 ms
  recoverMs: number // 回收 ms
  attackDamage: number // 0=使用武器默认
  postureDamage: number
  toughnessDamage: number
  damageScaleNumerator?: number // 伤害/削韧系数分子（默认 1）
  damageScaleDenominator?: number // 伤害/削韧系数分母（默认 1）
  compatibleWeaponTypes?: WeaponType[] // 兼容武器类型，未配置则默认兼容全部
  impactLevel?: ImpactLevel // 冲击力等级覆盖（未设置则使用武器默认等级）
  isUnstoppable: boolean // 霸体
  swingDirection: 'toFront' | 'toHead'
  radiusScale: number // 攻击范围百分比(100=1x)
  soundId: number
}

// 动作序列（连招）
export type AttackSequenceData = {
  id: string
  moves: string[] // AttackMoveData.id 列表
  loop: boolean
}

// 派生关系
export type AttackDerivation = {
  fromMoveId: string
  afterStep: number // -1=任意步
  toSequenceId: string
  condition: 'input' | 'hold' | 'auto'
}

// 招式集
export type AttackMoveset = {
  id: string
  defaultSequenceId: string
  sequences: AttackSequenceData[]
  derivations: AttackDerivation[]
}
