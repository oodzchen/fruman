import { FOLLOW_INTERACTION_RANGE } from '../../constants'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { WeaponSystem } from './WeaponSystem'

/**
 * 交互系统 - 统一处理所有基于上下文的互动逻辑
 *
 * 互动键（E键）会根据当前环境执行不同的操作：
 * 1. 优先级1：附近有武器 → 拾取/替换武器
 * 2. 优先级2：附近有门 → 开门（未来）
 * 3. 优先级3：附近有NPC → 对话（未来）
 * 4. 默认行为：切换HUD显示
 */
export class InteractionSystem extends System {
  private weaponSystem: WeaponSystem | null = null

  setWeaponSystem(weaponSystem: WeaponSystem): void {
    this.weaponSystem = weaponSystem
  }

  update(entities: Entity[], _deltaTime: number): void {
    for (const entity of entities) {
      if (!entity.input || !entity.stats) continue
      if (entity.stats.isDead) continue

      const inputBuffer = entity.input.inputBuffer
      let interactionConsumed = false

      // 绝招进行中时跳过武器拾取
      if (entity.weapon?.ultimatePhase == null) {
        // 尝试拾取/替换武器 (内部处理了自动拾取和按键替换)
        if (this.weaponSystem && this.weaponSystem.tryPickUpWeapon(entity)) {
          interactionConsumed = true
        }
      }

      if (!inputBuffer.hasActiveAction('interact')) {
        // 如果没有按互动键，且没有触发自动拾取（tryPickUpWeapon返回false），
        // 则不执行后续依赖按键的逻辑
        continue
      }

      // 优先级2：绑定/解绑追随同伴（仅对玩家有效，玩家无 npcAI 组件）
      if (!interactionConsumed && !entity.npcAI) {
        if (this.tryToggleFollowBind(entity, entities)) {
          interactionConsumed = true
        }
      }

      // 优先级3：开门（未来扩展）
      // if (!interactionConsumed && this.tryOpenDoor(entity)) {
      //   interactionConsumed = true
      // }

      // 优先级4：NPC对话（未来扩展）
      // if (!interactionConsumed && this.tryTalkToNPC(entity)) {
      //   interactionConsumed = true
      // }

      // 默认行为：切换HUD显示
      if (!interactionConsumed) {
        this.toggleHUDVisibility(entity)
        interactionConsumed = true
      }

      // 清除互动键输入
      if (interactionConsumed) {
        inputBuffer.clearAction('interact')
      }
    }
  }

  private tryToggleFollowBind(player: Entity, entities: Entity[]): boolean {
    if (!player.transform) return false
    const px = player.transform.x
    const py = player.transform.y
    const rangeSq = FOLLOW_INTERACTION_RANGE * FOLLOW_INTERACTION_RANGE
    let nearest: Entity | null = null
    let nearestDistSq = rangeSq

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i]
      if (!e.follow || !e.transform) continue
      const dx = e.transform.x - px
      const dy = e.transform.y - py
      const distSq = dx * dx + dy * dy
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearest = e
      }
    }

    if (!nearest?.follow) return false

    if (nearest.follow.followTargetId === null) {
      nearest.follow.followTargetId = player.id
      nearest.follow.bondFlashTimer = 1200
    } else {
      nearest.follow.followTargetId = null
      nearest.follow.state = 'idle'
      nearest.follow.unbondFlashTimer = 1200
    }
    return true
  }

  /**
   * 切换HUD显示
   */
  private toggleHUDVisibility(entity: Entity): void {
    if (!entity.stats) return
    entity.stats.hudVisibleTimer = entity.stats.combatExitTimeout
  }

  // 未来扩展：开门交互
  // private tryOpenDoor(entity: Entity): boolean {
  //   // 检查附近是否有门
  //   // 如果有，打开门，返回true
  //   // 否则返回false
  //   return false
  // }

  // 未来扩展：NPC对话
  // private tryTalkToNPC(entity: Entity): boolean {
  //   // 检查附近是否有NPC
  //   // 如果有，开始对话，返回true
  //   // 否则返回false
  //   return false
  // }
}
