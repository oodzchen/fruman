import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_PICKUP_DISTANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
} from '../../constants'
import type { WeaponType, WeaponVisualType } from '../../types'
import {
  isConsumableWeaponType,
  isRangedWeaponType,
  isSecondaryWeaponType,
} from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import {
  ATTACK_MOVES,
  ATTACK_MOVESETS,
  getDefaultAttackMovesetIdForWeaponType,
  getUltimateMovesetIdForWeaponType,
  isMovesetCompatibleWithWeaponType,
} from '../AttackMoveRegistry'
import type { WeaponSlotData, WeaponSlotId } from '../Component'
import {
  DEFAULT_SKILL_MAX_CHARGES,
  WeaponComponent,
  WeaponSlotsComponent,
} from '../Component'
import type { Entity } from '../Entity'
import {
  applyOffset,
  copyTransform,
  getFrontTransform,
  getOffsetFromTransform,
  getSwingTransforms,
  setWeaponBackTransform,
} from '../WeaponPoseUtils'
import { showEntityHud } from '../hudVisibility'
import { WeaponProjectileSystem } from './WeaponProjectileSystem'
import {
  BOMB_FUSE_MS,
  DEATH_WEAPON_DROP_CHANCE_DENOMINATOR,
  WeaponDropData,
  getBodyHalfHeight,
} from './WeaponSystemShared'

export abstract class WeaponInventorySystem extends WeaponProjectileSystem {
  protected getSlotForWeaponType(weaponType: WeaponVisualType): WeaponSlotId {
    return isSecondaryWeaponType(weaponType) ? 'secondary' : 'main'
  }

  protected getSlotData(
    weaponSlots: WeaponSlotsComponent,
    slotId: WeaponSlotId
  ): WeaponSlotData {
    return slotId === 'main' ? weaponSlots.main : weaponSlots.secondary
  }

  protected clearWeaponSlot(slot: WeaponSlotData): void {
    slot.hasWeapon = false
    slot.movesetId = ''
    slot.bowAmmo = 0
    slot.bowAmmoMax = 0
    slot.skillId = ''
    slot.skillCharges = 0
  }

  protected removeDepletedConsumable(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (!weapon.isEquipped) {
      return
    }
    if (!isConsumableWeaponType(weapon.weaponType) || weapon.bowAmmo > 0) {
      return
    }
    if (weapon.weaponType === 'bomb' && weapon.bombState !== 'idle') {
      return
    }

    if (entity.weaponSlots) {
      const weaponSlots = entity.weaponSlots
      const activeSlotId = weaponSlots.activeSlot
      const activeSlot = this.getSlotData(weaponSlots, activeSlotId)
      this.clearWeaponSlot(activeSlot)

      const fallbackSlotId: WeaponSlotId =
        activeSlotId === 'main' ? 'secondary' : 'main'
      const fallbackSlot = this.getSlotData(weaponSlots, fallbackSlotId)
      if (fallbackSlot.hasWeapon) {
        weaponSlots.activeSlot = fallbackSlotId
        this.copySlotToWeapon(fallbackSlot, weapon)
        this.applyNormalAttackMoveset(
          entity,
          this.getSlotMovesetId(fallbackSlot)
        )
        weapon.isEquipped = true
        weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
        weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
        this.resetWeaponForSwap(entity)
        this.showHud(entity)
        this.triggerFreeAimIfMouseMode(entity)
        return
      }
    }

    weapon.isEquipped = false
    weapon.movesetId = ''
    weapon.skillId = ''
    weapon.skillCharges = 0
    if (entity.attackSlots) {
      entity.attackSlots.normal.hasMoveset = false
      entity.attackSlots.normal.movesetId = ''
      entity.attackSlots.ultimate.hasMoveset = false
      entity.attackSlots.ultimate.movesetId = ''
      entity.attackSlots.skill.skillId = ''
      entity.attackSlots.skill.chargesRemaining = 0
      entity.attackSlots.skill.maxCharges = 0
    }
    this.showHud(entity)
  }

  protected getDefaultMovesetIdForWeaponType(
    weaponType: WeaponVisualType
  ): string {
    return getDefaultAttackMovesetIdForWeaponType(weaponType)
  }

  protected getSlotMovesetId(slot: WeaponSlotData): string {
    return (
      slot.movesetId || this.getDefaultMovesetIdForWeaponType(slot.weaponType)
    )
  }

  protected getWeaponMovesetId(weapon: WeaponComponent): string {
    return (
      weapon.movesetId ||
      this.getDefaultMovesetIdForWeaponType(weapon.weaponType)
    )
  }

  protected applyNormalAttackMoveset(entity: Entity, movesetId: string): void {
    if (entity.attackSlots) {
      entity.attackSlots.normal.hasMoveset = movesetId.length > 0
      entity.attackSlots.normal.movesetId = movesetId
    }
    if (entity.weapon) {
      entity.weapon.movesetId = movesetId
    }
    if (entity.npcAI) {
      entity.npcAI.movesetId = movesetId
    }
    if (entity.weapon?.weaponType) {
      this.applyUltimateMoveset(entity, entity.weapon.weaponType)
    }
    this.applySkillMoveset(entity)
  }

  protected applyUltimateMoveset(entity: Entity, weaponType: string): void {
    if (!entity.attackSlots) return
    const movesetId = getUltimateMovesetIdForWeaponType(
      weaponType as Parameters<typeof getUltimateMovesetIdForWeaponType>[0]
    )
    entity.attackSlots.ultimate.hasMoveset = movesetId.length > 0
    entity.attackSlots.ultimate.movesetId = movesetId
  }

  protected applySkillMoveset(entity: Entity): void {
    if (!entity.attackSlots || !entity.weapon) return
    const skill = entity.attackSlots.skill
    const skillId = entity.weapon.skillId
    skill.skillId = skillId
    skill.maxCharges = skillId ? DEFAULT_SKILL_MAX_CHARGES : 0
    // 切换武器时，从 weapon.skillCharges 恢复次数
    skill.chargesRemaining = skillId ? entity.weapon.skillCharges : 0
  }

  handleUltimateRequest(entity: Entity, maxLandDist?: number): void {
    this.ultimateHandler.handleUltimateRequest(entity, maxLandDist)
  }

  handleSkillRequest(entity: Entity): void {
    if (!entity.attackSlots || !entity.weapon) return
    const skill = entity.attackSlots.skill
    if (!skill.skillId || skill.chargesRemaining <= 0) return
    skill.chargesRemaining--
    entity.weapon.skillCharges = skill.chargesRemaining
    // 同步到当前武器槽
    if (entity.weaponSlots) {
      const activeSlotData =
        entity.weaponSlots.activeSlot === 'main'
          ? entity.weaponSlots.main
          : entity.weaponSlots.secondary
      activeSlotData.skillCharges = skill.chargesRemaining
    }
    this.skillHandler.handleSkillRequest(entity)
  }

  protected getNormalAttackMovesetId(entity: Entity): string {
    const attackSlot = entity.attackSlots?.normal
    if (attackSlot && attackSlot.hasMoveset && attackSlot.movesetId) {
      return attackSlot.movesetId
    }
    return entity.weapon?.movesetId || ''
  }

  protected canMovesetUseWeapon(
    movesetId: string,
    weaponType: WeaponVisualType
  ): boolean {
    if (weaponType === 'arrow') return false
    return isMovesetCompatibleWithWeaponType(
      movesetId,
      weaponType as WeaponType
    )
  }

  protected playInvalidAttackFeedback(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!weapon) return
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    copyTransform(this.tempTransform, weapon.visual)
    weapon.visual.rotation += facing === 1 ? 0.22 : -0.22
    weapon.visual.x += facing * 0.08
    this.startBlockReturn(entity, weapon, playerPos)
  }

  protected copyWeaponToSlot(
    slot: WeaponSlotData,
    weapon: WeaponComponent
  ): void {
    slot.hasWeapon = true
    slot.weaponType = weapon.weaponType
    slot.movesetId = this.getWeaponMovesetId(weapon)
    slot.width = weapon.baseWidth
    slot.height = weapon.height
    slot.baseWidth = weapon.baseWidth
    slot.sizeLevel = weapon.sizeLevel
    slot.sizeMaxLevel = weapon.sizeMaxLevel
    slot.cornerRadius = weapon.cornerRadius
    slot.weight = weapon.weight
    slot.attackDamage = weapon.attackDamage
    slot.postureDamage = weapon.postureDamage
    slot.toughnessDamage = weapon.toughnessDamage
    slot.bowAmmo = weapon.bowAmmo
    slot.bowAmmoMax = weapon.bowAmmoMax
    slot.skillId = weapon.skillId
    slot.skillCharges = weapon.skillCharges
  }

  protected copySlotToWeapon(
    slot: WeaponSlotData,
    weapon: WeaponComponent
  ): void {
    weapon.width = slot.baseWidth
    weapon.height = slot.height
    weapon.baseWidth = slot.baseWidth
    weapon.sizeLevel = slot.sizeLevel
    weapon.sizeMaxLevel = slot.sizeMaxLevel
    weapon.blockWidthStart = weapon.baseWidth
    weapon.blockWidthTarget = weapon.baseWidth
    weapon.cornerRadius = slot.cornerRadius
    weapon.weight = slot.weight
    weapon.weaponType = slot.weaponType
    weapon.movesetId = this.getSlotMovesetId(slot)
    weapon.attackDamage = slot.attackDamage
    weapon.postureDamage = slot.postureDamage
    weapon.toughnessDamage = slot.toughnessDamage
    weapon.bowAmmo = slot.bowAmmo
    weapon.bowAmmoMax = slot.bowAmmoMax
    weapon.skillId = slot.skillId
    weapon.skillCharges = slot.skillCharges
  }

  protected fillWeaponDropDataFromWeapon(
    weapon: WeaponComponent,
    out: WeaponDropData
  ): void {
    out.weaponType = weapon.weaponType
    out.movesetId = this.getWeaponMovesetId(weapon)
    out.width = weapon.baseWidth
    out.height = weapon.height
    out.baseWidth = weapon.baseWidth
    out.sizeLevel = weapon.sizeLevel
    out.sizeMaxLevel = weapon.sizeMaxLevel
    out.cornerRadius = weapon.cornerRadius
    out.weight = weapon.weight
    out.attackDamage = weapon.attackDamage
    out.postureDamage = weapon.postureDamage
    out.toughnessDamage = weapon.toughnessDamage
    out.bowAmmo = weapon.bowAmmo
    out.bowAmmoMax = weapon.bowAmmoMax
    out.skillId = weapon.skillId
  }

  protected fillWeaponDropDataFromSlot(
    slot: WeaponSlotData,
    out: WeaponDropData
  ): void {
    out.weaponType = slot.weaponType
    out.movesetId = this.getSlotMovesetId(slot)
    out.width = slot.baseWidth
    out.height = slot.height
    out.baseWidth = slot.baseWidth
    out.sizeLevel = slot.sizeLevel
    out.sizeMaxLevel = slot.sizeMaxLevel
    out.cornerRadius = slot.cornerRadius
    out.weight = slot.weight
    out.attackDamage = slot.attackDamage
    out.postureDamage = slot.postureDamage
    out.toughnessDamage = slot.toughnessDamage
    out.bowAmmo = slot.bowAmmo
    out.bowAmmoMax = slot.bowAmmoMax
    out.skillId = slot.skillId
  }

  protected resetWeaponForSwap(entity: Entity): void {
    const weapon = entity.weapon
    if (!weapon) return

    this.resetAssassinationState(entity, true)

    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.lastAttackTimestamp = 0
    weapon.activeSequenceId = ''
    weapon.activeMoveIndex = 0
    weapon.activeMoveId = ''
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryCounterTimerMs = 0
    weapon.parryCounterActive = false
    weapon.reboundLockedPause = false
    weapon.isColliding = false
    weapon.hitEntityIds.clear()
    weapon.parryHitWeaponIds.clear()
    weapon.bowIsDrawing = false
    weapon.bowDrawElapsedMs = 0
    weapon.bowDrawRatio = 0
    weapon.bowForceRatio = 0
    weapon.bowReleaseRatio = 0
    weapon.bowReleasePending = false
    weapon.bowReleaseDelayMs = 0
    weapon.bowReleaseDelayTotalMs = 0
    weapon.bowRecoverElapsedMs = 0
    weapon.bowAimAngle = 0
    weapon.bowHasAim = false
    weapon.bowFreeAim = false
    weapon.bowFreeAimAngle = 0
    weapon.bowFreeAimReticleX = 0
    weapon.bowFreeAimReticleY = 0
    weapon.bowFreeAimUseMouse = false
    weapon.bowFreeAimUseReticle = false
    weapon.bowFreeAimLastMouseX = 0
    weapon.bowFreeAimLastMouseY = 0
    weapon.bowFreeAimReticleOffsetX = 0
    weapon.bowFreeAimReticleOffsetY = 0
    this.resetBombState(weapon)
    weapon.isDropping = false
    weapon.isDropped = false
    weapon.isRecovering = false
    weapon.dropElapsedTime = 0
    weapon.dropStartOffset.dx = 0
    weapon.dropStartOffset.dy = 0
    weapon.dropStartOffset.rotation = 0
    weapon.dropEndOffset.dx = 0
    weapon.dropEndOffset.dy = 0
    weapon.dropEndOffset.rotation = 0
    this.clearAttackImpactState(weapon)

    if (entity.input) {
      entity.input.facingOverride = null
    }
  }

  /**
   * 尝试拾取附近的武器
   * @returns 如果消费了互动键（进行了武器替换）返回true，否则返回false
   */
  tryPickUpWeapon(entity: Entity): boolean {
    if (!entity.transform || !entity.weapon) return false
    if (entity.stats?.isDead) return false
    if (
      entity.weapon.weaponType === 'bomb' &&
      entity.weapon.bombState !== 'idle'
    ) {
      return false
    }
    const weaponSlots = entity.weaponSlots
    const entityLayer = entity.render?.renderLayer ?? 0

    // 检查是否靠近独立的武器实体
    for (const weaponEntity of this.allEntities) {
      // 独立武器实体：有 weapon 组件但没有 stats 组件
      if (!weaponEntity.weapon || weaponEntity.stats) continue
      if (weaponEntity.arrow || weaponEntity.weapon.weaponType === 'arrow')
        continue
      if (weaponEntity.weapon.isEquipped) continue
      if (!weaponEntity.transform) continue
      if ((weaponEntity.render?.renderLayer ?? 0) !== entityLayer) continue

      const dx = entity.transform.x - weaponEntity.transform.x
      const dy = entity.transform.y - weaponEntity.transform.y
      const distance = Math.hypot(dx, dy)

      if (distance <= DEFAULT_WEAPON_PICKUP_DISTANCE) {
        // 检查拾取冷却时间
        if (weaponEntity.weapon.pickupCooldownEndTime > this.currentTimeMs) {
          continue // 还在冷却期内，跳过
        }

        if (weaponEntity.weapon.weaponType === 'hook') {
          if (entity.grapple && !entity.grapple.hasGrapple) {
            entity.grapple.hasGrapple = true
            entity.grapple.isPulling = false
            entity.grapple.pullElapsedMs = 0
            weaponEntity.weapon.isEquipped = true
            this.showHud(entity)
            this.playPickupItemSound(entity)
          }
          continue
        }

        if (weaponSlots) {
          const targetSlotId = this.getSlotForWeaponType(
            weaponEntity.weapon.weaponType
          )
          const targetSlot = this.getSlotData(weaponSlots, targetSlotId)

          // 自动拾取逻辑：如果槽位为空，直接捡起，不需要按互动键
          if (!targetSlot.hasWeapon) {
            this.copyWeaponToSlot(targetSlot, weaponEntity.weapon)
            weaponEntity.weapon.isEquipped = true
            this.showHud(entity)

            if (!entity.weapon.isEquipped) {
              weaponSlots.activeSlot = targetSlotId
            }

            if (weaponSlots.activeSlot === targetSlotId) {
              this.copySlotToWeapon(targetSlot, entity.weapon)
              this.applyNormalAttackMoveset(
                entity,
                this.getSlotMovesetId(targetSlot)
              )
              entity.weapon.isEquipped = true
              entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
              entity.weapon.visual.rotation =
                DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
              this.resetWeaponForSwap(entity)

              // 立即更新视觉位置，防止闪烁
              const facing = entity.input?.lastMoveDirection || 1
              const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
              if (entity.stats?.isInCombat) {
                getFrontTransform(
                  entity.transform,
                  facing,
                  entity.weapon.visual,
                  radius,
                  entity.weapon.weaponType,
                  entity.weapon.width
                )
              } else {
                setWeaponBackTransform(
                  entity.transform,
                  facing,
                  entity.weapon.visual,
                  radius,
                  entity.weapon.weaponType,
                  entity.weapon.width,
                  getBodyHalfHeight(entity.render, radius)
                )
              }
            }
            this.playPickupItemSound(entity)
            continue // 已自动拾取，继续检查其他武器（或结束）
          }

          // 替换逻辑：槽位已满，必须按互动键（E）
          const interacted = entity.input?.inputBuffer.tryExecute(
            'interact',
            () => !entity.isStunned(),
            () => {}
          )

          if (!interacted) continue

          // 在玩家脚下掉落旧武器
          const facing = entity.weapon.attackFacing

          // Sync active weapon state to slot before dropping if we are dropping the active slot
          if (
            weaponSlots.activeSlot === targetSlotId &&
            entity.weapon &&
            entity.weapon.isEquipped
          ) {
            this.copyWeaponToSlot(targetSlot, entity.weapon)
          }

          this.fillWeaponDropDataFromSlot(targetSlot, this.tempWeaponDropData)
          this.dropWeapon(
            entity.transform.x,
            entity.transform.y,
            facing,
            this.tempWeaponDropData,
            entity.render?.renderLayer ?? 0
          )

          this.copyWeaponToSlot(targetSlot, weaponEntity.weapon)
          weaponEntity.weapon.isEquipped = true

          if (!entity.weapon.isEquipped) {
            weaponSlots.activeSlot = targetSlotId
          }

          if (weaponSlots.activeSlot === targetSlotId) {
            this.copySlotToWeapon(targetSlot, entity.weapon)
            this.applyNormalAttackMoveset(
              entity,
              this.getSlotMovesetId(targetSlot)
            )
            entity.weapon.isEquipped = true
            entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
            entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
            this.resetWeaponForSwap(entity)
            this.showHud(entity)
            this.triggerFreeAimIfMouseMode(entity)
          }
          this.playPickupItemSound(entity)
          return true // 替换武器，已消费互动键
        }

        // 如果玩家武器未装备，直接装备并应用属性
        if (!entity.weapon.isEquipped) {
          entity.weapon.width = weaponEntity.weapon.width
          entity.weapon.height = weaponEntity.weapon.height
          entity.weapon.baseWidth = weaponEntity.weapon.baseWidth
          entity.weapon.cornerRadius = weaponEntity.weapon.cornerRadius
          entity.weapon.weight = weaponEntity.weapon.weight
          entity.weapon.weaponType = weaponEntity.weapon.weaponType
          entity.weapon.movesetId = this.getWeaponMovesetId(weaponEntity.weapon)
          entity.weapon.attackDamage = weaponEntity.weapon.attackDamage
          entity.weapon.postureDamage = weaponEntity.weapon.postureDamage
          entity.weapon.toughnessDamage = weaponEntity.weapon.toughnessDamage
          entity.weapon.bowAmmo = weaponEntity.weapon.bowAmmo
          entity.weapon.bowAmmoMax = weaponEntity.weapon.bowAmmoMax
          entity.weapon.isEquipped = true
          this.applyNormalAttackMoveset(entity, entity.weapon.movesetId)
          entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          this.resetWeaponForSwap(entity)

          // 立即更新视觉位置，防止闪烁
          const newFacing = entity.input?.lastMoveDirection || 1
          const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
          if (entity.stats?.isInCombat) {
            getFrontTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width
            )
          } else {
            setWeaponBackTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width,
              getBodyHalfHeight(entity.render, radius)
            )
          }

          // 标记武器实体为已拾取（会在后续清理）
          weaponEntity.weapon.isEquipped = true
          this.showHud(entity)
          this.triggerFreeAimIfMouseMode(entity)
          this.playPickupItemSound(entity)
          return false // 自动拾取，未消费互动键
        }

        // 如果玩家已有武器，需要按 E 键（interact）才能替换
        if (entity.weapon.isEquipped) {
          const interacted = entity.input?.inputBuffer.tryExecute(
            'interact',
            () => !entity.isStunned(),
            () => {}
          )

          if (!interacted) continue

          // 在玩家脚下掉落旧武器
          const facing = entity.weapon.attackFacing
          this.fillWeaponDropDataFromWeapon(
            entity.weapon,
            this.tempWeaponDropData
          )
          this.dropWeapon(
            entity.transform.x,
            entity.transform.y,
            facing,
            this.tempWeaponDropData,
            entity.render?.renderLayer ?? 0
          )

          // 替换为新武器属性
          entity.weapon.width = weaponEntity.weapon.width
          entity.weapon.height = weaponEntity.weapon.height
          entity.weapon.baseWidth = weaponEntity.weapon.baseWidth
          entity.weapon.cornerRadius = weaponEntity.weapon.cornerRadius
          entity.weapon.weight = weaponEntity.weapon.weight
          entity.weapon.weaponType = weaponEntity.weapon.weaponType
          entity.weapon.movesetId = this.getWeaponMovesetId(weaponEntity.weapon)
          entity.weapon.attackDamage = weaponEntity.weapon.attackDamage
          entity.weapon.postureDamage = weaponEntity.weapon.postureDamage
          entity.weapon.toughnessDamage = weaponEntity.weapon.toughnessDamage
          entity.weapon.bowAmmo = weaponEntity.weapon.bowAmmo
          this.applyNormalAttackMoveset(entity, entity.weapon.movesetId)
          entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          this.resetWeaponForSwap(entity)

          // 立即更新视觉位置，防止闪烁
          const newFacing = entity.input?.lastMoveDirection || 1
          const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
          if (entity.stats?.isInCombat) {
            getFrontTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width
            )
          } else {
            setWeaponBackTransform(
              entity.transform,
              newFacing,
              entity.weapon.visual,
              radius,
              entity.weapon.weaponType,
              entity.weapon.width,
              getBodyHalfHeight(entity.render, radius)
            )
          }

          // 标记武器实体为已拾取（会在后续清理）
          weaponEntity.weapon.isEquipped = true
          this.showHud(entity)
          this.triggerFreeAimIfMouseMode(entity)
          this.playPickupItemSound(entity)
          return true // 替换武器，已消费互动键
        }
      }
    }

    // 没有可拾取的武器，未消费互动键
    return false
  }

  protected showHud(entity: Entity): void {
    showEntityHud(entity)
  }

  protected playPickupItemSound(entity: Entity): void {
    if (!entity.transform) {
      return
    }
    this.statsSystem?.playSoundAt(
      SOUND_IDS.PICKUP_EQUIPMENT,
      entity.transform.x,
      entity.transform.y
    )
  }

  dropWeaponsOnDeath(entity: Entity): void {
    if (!entity.transform) return

    const transform = entity.transform
    const weaponSlots = entity.weaponSlots
    const weapon = entity.weapon
    if (weapon) {
      this.destroyStaggerDropBody(weapon)
      weapon.isDropping = false
      weapon.isDropped = false
      weapon.isRecovering = false
    }
    let facing =
      weapon?.attackFacing ??
      entity.input?.lastMoveDirection ??
      entity.npcAI?.lastFacing ??
      1
    if (facing === 0) {
      facing = 1
    }

    const dropOffset = 0.35
    const dropFromSlot = (
      slot: WeaponSlotData,
      dropFacing: number,
      offsetX: number
    ) => {
      if (!slot.hasWeapon) return
      this.fillWeaponDropDataFromSlot(slot, this.tempWeaponDropData)
      if (this.shouldDropWeaponOnDeath()) {
        this.dropWeapon(
          transform.x + offsetX,
          transform.y,
          dropFacing,
          this.tempWeaponDropData,
          entity.render?.renderLayer ?? 0
        )
      }
      slot.hasWeapon = false
    }

    if (
      weaponSlots &&
      (weaponSlots.main.hasWeapon || weaponSlots.secondary.hasWeapon)
    ) {
      // Sync active weapon state (ammo, etc.) to the slot before dropping
      if (weapon && weapon.isEquipped) {
        const activeSlot = this.getSlotData(weaponSlots, weaponSlots.activeSlot)
        this.copyWeaponToSlot(activeSlot, weapon)
      }

      const hasMain = weaponSlots.main.hasWeapon
      const hasSecondary = weaponSlots.secondary.hasWeapon
      if (hasMain && hasSecondary) {
        dropFromSlot(weaponSlots.main, facing, facing * dropOffset)
        dropFromSlot(weaponSlots.secondary, -facing, -facing * dropOffset)
      } else if (hasMain) {
        dropFromSlot(weaponSlots.main, facing, 0)
      } else {
        dropFromSlot(weaponSlots.secondary, facing, 0)
      }
      if (weapon) {
        weapon.isEquipped = false
      }
      return
    }

    if (weapon && weapon.isEquipped) {
      this.fillWeaponDropDataFromWeapon(weapon, this.tempWeaponDropData)
      if (this.shouldDropWeaponOnDeath()) {
        this.dropWeapon(
          transform.x,
          transform.y,
          facing,
          this.tempWeaponDropData,
          entity.render?.renderLayer ?? 0
        )
      }
      weapon.isEquipped = false
    }
  }

  protected shouldDropWeaponOnDeath(): boolean {
    return ((Math.random() * DEATH_WEAPON_DROP_CHANCE_DENOMINATOR) | 0) === 0
  }

  setGroundWeaponPickupCooldown(entity: Entity, cooldownMs: number): void {
    if (!entity.weapon) {
      return
    }
    const delayMs = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 0
    entity.weapon.pickupCooldownEndTime = this.currentTimeMs + delayMs
  }

  switchWeaponSlot(entity: Entity, slotId: WeaponSlotId): void {
    if (!entity.weapon || !entity.weaponSlots) return
    if (entity.stats?.isDead) return
    if (
      entity.weapon.weaponType === 'bomb' &&
      entity.weapon.bombState !== 'idle'
    ) {
      return
    }

    const weaponSlots = entity.weaponSlots
    if (weaponSlots.activeSlot === slotId) return

    const targetSlot = this.getSlotData(weaponSlots, slotId)
    if (!targetSlot.hasWeapon) return

    const currentSlot = this.getSlotData(weaponSlots, weaponSlots.activeSlot)
    this.copyWeaponToSlot(currentSlot, entity.weapon)

    weaponSlots.activeSlot = slotId
    this.copySlotToWeapon(targetSlot, entity.weapon)
    this.applyNormalAttackMoveset(entity, this.getSlotMovesetId(targetSlot))
    entity.weapon.isEquipped = true
    entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    this.resetWeaponForSwap(entity)
    this.showHud(entity)
    this.triggerFreeAimIfMouseMode(entity)
  }

  protected triggerFreeAimIfMouseMode(entity: Entity): void {
    if (
      entity.weapon &&
      isRangedWeaponType(entity.weapon.weaponType) &&
      entity.input &&
      entity.input.mouseAimActive
    ) {
      entity.input.freeAimToggleRequested = true
    }
  }

  startAttack(entity: Entity, movesetIdOverride?: string): void {
    if (!entity.transform || !entity.input || !entity.weapon) return
    if (!entity.weapon.isEquipped) return
    if (isRangedWeaponType(entity.weapon.weaponType)) return
    if (entity.stats?.isDead) return
    if (entity.isStunned()) {
      entity.input.inputBuffer.clearAll()
      entity.input.inputBuffer.bufferAction('attack')
      return
    }

    const weapon = entity.weapon
    const assassinationTarget = this.getAssassinationTarget(entity)
    const facing =
      assassinationTarget && assassinationTarget.transform
        ? assassinationTarget.transform.x >= entity.transform.x
          ? 1
          : -1
        : entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : 1
    if (
      assassinationTarget &&
      this.startAssassination(entity, assassinationTarget)
    ) {
      return
    }
    if (weapon.weaponType === 'bomb') {
      if (weapon.bombState === 'idle') {
        if (weapon.bowAmmo <= 0) {
          return
        }
        weapon.bowAmmo = Math.max(0, weapon.bowAmmo - 1)
        weapon.bombState = 'lit'
        weapon.bombFuseDurationMs = BOMB_FUSE_MS
        weapon.bombFuseRemainingMs = BOMB_FUSE_MS
        weapon.bombThrowWindupElapsedMs = 0
        weapon.bombThrowVelocityX = 0
        weapon.bombThrowVelocityY = 0
        weapon.bombThrowAimAngle = 0
        weapon.bombThrownRotation = 0
        weapon.attackFacing = facing
        this.statsSystem?.playSoundAt(
          SOUND_IDS.BOMB_IGNITE,
          weapon.visual.x,
          weapon.visual.y
        )
        this.statsSystem?.enterCombat(entity)
        this.removeDepletedConsumable(entity, weapon)
      } else if (weapon.bombState === 'lit') {
        this.startBombThrowWindup(entity, weapon, facing)
        this.statsSystem?.enterCombat(entity)
      }
      return
    }

    const now = this.currentTimeMs
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    let attackRadius = this.getAttackRadius(entity)
    weapon.attackRadius = attackRadius
    weapon.attackFacing = facing
    let equippedMovesetId =
      movesetIdOverride ?? this.getNormalAttackMovesetId(entity)
    if (
      !equippedMovesetId ||
      !this.canMovesetUseWeapon(equippedMovesetId, weapon.weaponType)
    ) {
      const fallbackId = getDefaultAttackMovesetIdForWeaponType(
        weapon.weaponType
      )
      if (
        fallbackId &&
        this.canMovesetUseWeapon(fallbackId, weapon.weaponType)
      ) {
        equippedMovesetId = fallbackId
      } else {
        weapon.attackQueued = false
        this.playInvalidAttackFeedback(entity, weapon, playerPos, facing)
        return
      }
    }
    weapon.movesetId = equippedMovesetId

    if (weapon.movesetId && weapon.attackPhase !== 'idle') {
      const moveset = ATTACK_MOVESETS[weapon.movesetId]
      const seq = moveset?.sequences.find(
        (sequence) => sequence.id === weapon.activeSequenceId
      )
      if (seq && !seq.loop && weapon.activeMoveIndex + 1 >= seq.moves.length) {
        return
      }
    }

    if (weapon.parryCounterTimerMs > 0) {
      weapon.parryCounterActive = true
      weapon.parryCounterTimerMs = 0
    }

    if (weapon.attackPhase === 'idle') {
      if (weapon.movesetId) {
        const moveset = ATTACK_MOVESETS[weapon.movesetId]
        if (moveset) {
          weapon.activeSequenceId = moveset.defaultSequenceId
          weapon.activeMoveIndex = 0
          const seq = moveset.sequences.find(
            (sequence) => sequence.id === weapon.activeSequenceId
          )
          if (seq && seq.moves.length > 0) {
            const firstMoveId = seq.moves[0]
            const move = ATTACK_MOVES[firstMoveId]
            if (move) {
              if (!this.isMoveCompatibleWithWeapon(move, weapon.weaponType)) {
                weapon.attackQueued = false
                return
              }
              weapon.activeMoveId = firstMoveId
              weapon.swingDirection = move.swingDirection
              weapon.impactLevel = this.resolveImpactLevel(move, weapon)
              weapon.isUnstoppable = move.isUnstoppable
              attackRadius = (attackRadius * move.radiusScale) / 100
              weapon.attackRadius = attackRadius
            }
          }
        }
      }

      getSwingTransforms(
        attackRadius,
        facing,
        this.getMoveKind(weapon),
        weapon.swingDirection,
        playerPos,
        weapon.weaponType,
        weapon.width,
        weapon.swingStartTransform,
        weapon.swingEndTransform
      )

      getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
      getOffsetFromTransform(
        weapon.swingStartTransform,
        playerPos,
        weapon.swingStartOffset
      )
      getOffsetFromTransform(
        weapon.swingEndTransform,
        playerPos,
        weapon.swingEndOffset
      )

      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      this.beginAttackImpactState(entity, weapon)

      applyOffset(
        weapon.attackStartOffset,
        playerPos,
        weapon.attackStartTransform
      )

      weapon.attackRadius = attackRadius
      weapon.comboCount = 1
      weapon.attackQueued = false

      applyOffset(weapon.attackStartOffset, playerPos, weapon.visual)

      weapon.hitEntityIds.clear()
      return
    }

    if (!weapon.attackQueued) {
      weapon.attackQueued = true
      weapon.lastAttackTimestamp = now
    }
  }
}
