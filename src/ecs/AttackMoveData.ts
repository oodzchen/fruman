export type AttackKind = 'slash' | 'thrust' | 'strike' | 'sweep'

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
  knockback: number // 冲击力
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
