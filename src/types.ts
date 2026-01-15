import type Box2DFactory from 'box2d3-wasm'

export type MainModule = Awaited<ReturnType<typeof Box2DFactory>>

// Use ReturnType to infer types from box2d functions
export type b2WorldId = ReturnType<MainModule['b2CreateWorld']>
export type b2BodyId = ReturnType<MainModule['b2CreateBody']>
export type b2JointId = ReturnType<MainModule['b2CreateRevoluteJoint']>
export type b2ShapeId = ReturnType<MainModule['b2CreatePolygonShape']>
export type b2Hull = ReturnType<MainModule['b2ComputeHull']>
export type b2Polygon = ReturnType<MainModule['b2MakePolygon']>
export type b2Vec2 = InstanceType<MainModule['b2Vec2']>

export interface EnemyTemplate {
  moveSpeed: number
  radius: number
  attackDesire: number
  color: string
  parryProficiency: number
}

export type EnemyType = 'default' | 'fast' | 'large'
