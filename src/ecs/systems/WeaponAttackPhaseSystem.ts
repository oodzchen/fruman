import {
  normalizeCharacterMaxComboCount,
  scaleCharacterWindupMs,
} from '../../characterActionConfig'
import {
  BOW_GRAVITY_SCALE,
  BOW_MAX_DRAW_MS,
  BOW_MAX_SPEED,
  BOW_MIN_FORCE_RATIO,
  BOW_MIN_SPEED,
  BOW_MIN_WINDUP_MS,
  BOW_RECOVER_MS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  GRAPE_GRAVITY_SCALE,
  GRAPE_MAX_SPEED,
  GRAPE_MIN_FORCE_RATIO,
  GRAPE_MIN_SPEED,
  GRAPE_MIN_WINDUP_MS,
  GRAPE_PROJECTILE_DENSITY,
  GRAPE_PROJECTILE_LIFETIME_MS,
  GRAPE_PROJECTILE_RADIUS,
  GRAPE_PROJECTILE_RESTITUTION,
  GRAPE_RECOVER_MS,
  JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR,
  JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR,
  SOUND_DB_BOW_SNAP,
  SOUND_DB_SWORD_HIT_OBSTACLE,
  SOUND_DB_SWORD_SWING,
  WEAPON_DEFAULT_DATA,
  WEAPON_IMPACT_LEVEL,
} from '../../constants'
import type { WeaponTemplate, WeaponType, WeaponVisualType } from '../../types'
import { getGrapeChargeRangeScale } from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type {
  AttackMoveData,
  AttackSequenceData,
  ImpactLevel,
} from '../AttackMoveData'
import { ATTACK_MOVES, ATTACK_MOVESETS } from '../AttackMoveRegistry'
import type { Entity } from '../Entity'
import {
  applyOffset,
  clamp01,
  copyTransform,
  getFrontTransform,
  getOffsetFromTransform,
  getSwingTransforms,
  lerpRelativeTransform,
  setWeaponBackTransform,
} from '../WeaponPoseUtils'
import { WeaponDefenseSystem } from './WeaponDefenseSystem'
import {
  DEFAULT_PROJECTILE_DENSITY,
  DEFAULT_PROJECTILE_LIFETIME_MS,
  DEFAULT_PROJECTILE_RESTITUTION,
  REBOUND_PAUSE_MS,
  getBodyHalfHeight,
} from './WeaponSystemShared'

export abstract class WeaponAttackPhaseSystem extends WeaponDefenseSystem {
  protected handleIdlePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void {
    if (!entity.input || !entity.weapon) return

    const weapon = entity.weapon
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const bodyHalfHeight = getBodyHalfHeight(entity.render, radius)

    if (entity.stats?.isInCombat) {
      getFrontTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width
      )
    } else {
      setWeaponBackTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width,
        bodyHalfHeight
      )
    }

    let canChain = false
    let nextMove: AttackMoveData | null = null
    let nextMoveIndex = -1
    let sequenceMoveCount = 0

    if (weapon.attackQueued && weapon.movesetId) {
      const moveset = ATTACK_MOVESETS[weapon.movesetId]
      const seq = moveset?.sequences.find(
        (sequence) => sequence.id === weapon.activeSequenceId
      )
      if (seq) {
        sequenceMoveCount = seq.moves.length
        nextMoveIndex = this.getNextComboMoveIndex(seq, weapon)
        if (nextMoveIndex >= 0) {
          canChain = true
          nextMove = ATTACK_MOVES[seq.moves[nextMoveIndex]] || null
        }
      }
    }

    if (canChain && nextMove) {
      if (!this.isMoveCompatibleWithWeapon(nextMove, weapon.weaponType)) {
        weapon.attackQueued = false
        return
      }
      weapon.attackQueued = false
      weapon.comboCount += 1

      weapon.activeMoveIndex = nextMoveIndex
      weapon.activeMoveId = nextMove.id
      weapon.swingDirection = this.resolveChainedSwingDirection(
        nextMove,
        weapon,
        playerPos,
        nextMoveIndex,
        sequenceMoveCount
      )
      weapon.impactLevel = this.resolveImpactLevel(nextMove, weapon)
      weapon.isUnstoppable = nextMove.isUnstoppable
      attackRadius = (attackRadius * nextMove.radiusScale) / 100

      getSwingTransforms(
        attackRadius,
        attackFacing,
        nextMove.kind,
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
      weapon.attackFacing = attackFacing
      this.beginAttackImpactState(entity, weapon)

      // Update attackStartTransform based on current visual (which was just set)
      applyOffset(
        weapon.attackStartOffset,
        playerPos,
        weapon.attackStartTransform
      )

      // Visual starts at attackStartTransform
      copyTransform(weapon.visual, weapon.attackStartTransform)

      weapon.attackRadius = attackRadius
      weapon.hitEntityIds.clear()
    }
  }

  protected getActiveMove(weapon: Entity['weapon']): AttackMoveData | null {
    if (!weapon || !weapon.activeMoveId) return null
    return ATTACK_MOVES[weapon.activeMoveId] || null
  }

  protected resolveChainedSwingDirection(
    move: AttackMoveData,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number },
    moveIndex: number,
    sequenceMoveCount: number
  ): 'toFront' | 'toHead' {
    if (
      move.kind !== 'slash' ||
      sequenceMoveCount <= 0 ||
      moveIndex !== sequenceMoveCount - 1
    ) {
      return move.swingDirection
    }
    return weapon.visual.y > playerPos.y ? 'toHead' : 'toFront'
  }

  protected getSequenceMoveIndexForComboCount(
    seq: AttackSequenceData,
    weapon: Entity['weapon'],
    comboCount: number
  ): number {
    if (!weapon || seq.moves.length === 0 || comboCount <= 0) {
      return -1
    }
    const maxComboCount = normalizeCharacterMaxComboCount(weapon.maxComboCount)
    if (maxComboCount < seq.moves.length && comboCount >= maxComboCount) {
      return seq.moves.length - 1
    }
    const moveIndex = comboCount - 1
    if (moveIndex < seq.moves.length) {
      return moveIndex
    }
    if (seq.loop) {
      return moveIndex % seq.moves.length
    }
    return -1
  }

  protected getNextComboMoveIndex(
    seq: AttackSequenceData,
    weapon: Entity['weapon']
  ): number {
    if (!weapon) {
      return -1
    }
    const maxComboCount = normalizeCharacterMaxComboCount(weapon.maxComboCount)
    if (weapon.comboCount >= maxComboCount) {
      return -1
    }
    return this.getSequenceMoveIndexForComboCount(
      seq,
      weapon,
      weapon.comboCount + 1
    )
  }

  protected resolveImpactLevel(
    move: AttackMoveData,
    weapon: Entity['weapon']
  ): ImpactLevel {
    if (move.impactLevel !== undefined) return move.impactLevel
    if (!weapon) {
      return 'medium'
    }
    const baseImpactLevel =
      (WEAPON_IMPACT_LEVEL as Record<string, ImpactLevel>)[weapon.weaponType] ??
      'medium'
    if (weapon.weaponType === 'arrow' || weapon.weaponType === 'grapeShot') {
      return baseImpactLevel
    }
    const template = WEAPON_DEFAULT_DATA[weapon.weaponType]
    if (!template) {
      return baseImpactLevel
    }
    const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
    const currentLevel =
      Number.isFinite(weapon.sizeLevel) && weapon.sizeLevel > 0
        ? weapon.sizeLevel
        : baseLevel
    const levelOffset = currentLevel - baseLevel
    const baseIndex =
      baseImpactLevel === 'small'
        ? 0
        : baseImpactLevel === 'medium'
          ? 1
          : baseImpactLevel === 'large'
            ? 2
            : 3
    const nextIndex = Math.max(0, Math.min(3, baseIndex + levelOffset))
    if (nextIndex === 0) {
      return 'small'
    }
    if (nextIndex === 1) {
      return 'medium'
    }
    if (nextIndex === 2) {
      return 'large'
    }
    return 'extreme'
  }

  protected isMoveCompatibleWithWeapon(
    move: AttackMoveData,
    weaponType: WeaponVisualType
  ): boolean {
    const compatibleWeaponTypes = move.compatibleWeaponTypes
    if (!compatibleWeaponTypes || compatibleWeaponTypes.length === 0) {
      return true
    }
    if (weaponType === 'arrow') {
      return false
    }
    return compatibleWeaponTypes.includes(weaponType as WeaponType)
  }

  protected applyDamageOverrides(
    entity: Entity,
    weapon: Entity['weapon']
  ): void {
    if (!weapon) return
    const move = this.getActiveMove(weapon)
    if (move) {
      const damageScaleNumerator =
        move.damageScaleNumerator && move.damageScaleNumerator > 0
          ? move.damageScaleNumerator
          : 1
      const damageScaleDenominator =
        move.damageScaleDenominator && move.damageScaleDenominator > 0
          ? move.damageScaleDenominator
          : 1
      if (damageScaleNumerator !== damageScaleDenominator) {
        if (weapon.originalAttackDamage === null) {
          weapon.originalAttackDamage = weapon.attackDamage
        }
        if (weapon.originalPostureDamage === null) {
          weapon.originalPostureDamage = weapon.postureDamage
        }
        if (weapon.originalToughnessDamage === null) {
          weapon.originalToughnessDamage = weapon.toughnessDamage
        }
        weapon.attackDamage = Math.max(
          1,
          Math.floor(
            (weapon.originalAttackDamage * damageScaleNumerator) /
              damageScaleDenominator
          )
        )
        weapon.postureDamage = Math.max(
          1,
          Math.floor(
            (weapon.originalPostureDamage * damageScaleNumerator) /
              damageScaleDenominator
          )
        )
        weapon.toughnessDamage = Math.max(
          1,
          Math.floor(
            (weapon.originalToughnessDamage * damageScaleNumerator) /
              damageScaleDenominator
          )
        )
      }
      if (move.attackDamage > 0) {
        weapon.originalAttackDamage = weapon.attackDamage
        weapon.attackDamage = move.attackDamage
      }
      if (move.postureDamage > 0) {
        weapon.originalPostureDamage = weapon.postureDamage
        weapon.postureDamage = move.postureDamage
      }
      if (move.toughnessDamage > 0) {
        weapon.originalToughnessDamage = weapon.toughnessDamage
        weapon.toughnessDamage = move.toughnessDamage
      }
    }
    const isJumpAttack = entity.movement ? !entity.movement.isGrounded : false
    if (!isJumpAttack) {
      return
    }
    if (weapon.originalAttackDamage === null) {
      weapon.originalAttackDamage = weapon.attackDamage
    }
    if (weapon.originalPostureDamage === null) {
      weapon.originalPostureDamage = weapon.postureDamage
    }
    if (weapon.originalToughnessDamage === null) {
      weapon.originalToughnessDamage = weapon.toughnessDamage
    }
    weapon.attackDamage = Math.max(
      1,
      Math.floor(
        (weapon.originalAttackDamage * JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR) /
          JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR
      )
    )
    weapon.postureDamage = Math.max(
      1,
      Math.floor(
        (weapon.originalPostureDamage * JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR) /
          JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR
      )
    )
    weapon.toughnessDamage = Math.max(
      1,
      Math.floor(
        (weapon.originalToughnessDamage * JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR) /
          JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR
      )
    )
  }

  protected restoreDamageOverrides(weapon: Entity['weapon']): void {
    if (!weapon) return
    if (weapon.originalAttackDamage !== null) {
      weapon.attackDamage = weapon.originalAttackDamage
      weapon.originalAttackDamage = null
    }
    if (weapon.originalPostureDamage !== null) {
      weapon.postureDamage = weapon.originalPostureDamage
      weapon.originalPostureDamage = null
    }
    if (weapon.originalToughnessDamage !== null) {
      weapon.toughnessDamage = weapon.originalToughnessDamage
      weapon.originalToughnessDamage = null
    }
  }

  protected getWindupScaleRatio(weapon: Entity['weapon']): {
    numerator: number
    denominator: number
  } {
    if (!weapon) {
      return { numerator: 3, denominator: 3 }
    }
    if (weapon.weaponType === 'arrow' || weapon.weaponType === 'grapeShot') {
      return { numerator: 3, denominator: 3 }
    }
    const template = WEAPON_DEFAULT_DATA[weapon.weaponType]
    if (!template) {
      return { numerator: 3, denominator: 3 }
    }
    const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
    const currentLevel =
      Number.isFinite(weapon.sizeLevel) && weapon.sizeLevel > 0
        ? weapon.sizeLevel
        : baseLevel
    const deltaLevel = currentLevel - baseLevel
    const numerator = Math.max(1, 3 + deltaLevel)
    return { numerator, denominator: 3 }
  }

  protected scaleWindupDuration(
    baseMs: number,
    weapon: Entity['weapon']
  ): number {
    if (baseMs <= 0) {
      return 0
    }
    const ratio = this.getWindupScaleRatio(weapon)
    const weaponScaledMs = Math.max(
      1,
      Math.floor((baseMs * ratio.numerator) / ratio.denominator)
    )
    return scaleCharacterWindupMs(
      weaponScaledMs,
      weapon?.attackSpeedLevel ?? 'fast'
    )
  }

  protected getWindupMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    const baseMs = move ? move.windupMs : DEFAULT_WEAPON_ATTACK_WINDUP_MS
    return this.scaleWindupDuration(baseMs, weapon)
  }

  protected getSwingMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    return move ? move.swingMs : DEFAULT_WEAPON_ATTACK_SWING_MS
  }

  protected getPauseMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    const baseMs = move ? move.pauseMs : DEFAULT_WEAPON_ATTACK_PAUSE_MS
    return scaleCharacterWindupMs(baseMs, weapon?.attackSpeedLevel ?? 'fast')
  }

  protected getRecoverMs(weapon: Entity['weapon']): number {
    const move = this.getActiveMove(weapon)
    return move ? move.recoverMs : DEFAULT_WEAPON_ATTACK_RECOVER_MS
  }

  protected getRangedTemplate(weapon: Entity['weapon']): WeaponTemplate {
    return weapon?.weaponType === 'grape'
      ? WEAPON_DEFAULT_DATA.grape
      : WEAPON_DEFAULT_DATA.bow
  }

  protected getRangedMinWindupMs(weapon: Entity['weapon']): number {
    const baseMs =
      weapon?.weaponType === 'grape' ? GRAPE_MIN_WINDUP_MS : BOW_MIN_WINDUP_MS
    return this.scaleWindupDuration(baseMs, weapon)
  }

  protected getRangedMinForceRatio(weapon: Entity['weapon']): number {
    const baseRatio =
      weapon?.weaponType === 'grape'
        ? GRAPE_MIN_FORCE_RATIO
        : BOW_MIN_FORCE_RATIO
    return Math.max(
      baseRatio,
      Math.min(1, this.getRangedMinWindupMs(weapon) / BOW_MAX_DRAW_MS)
    )
  }

  protected getRangedRecoverMs(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape' ? GRAPE_RECOVER_MS : BOW_RECOVER_MS
  }

  protected getRangedLaunchSpeed(
    weapon: Entity['weapon'],
    drawRatio: number
  ): number {
    const clamped = Math.max(0, Math.min(1, drawRatio))
    if (weapon?.weaponType === 'grape') {
      const baseSpeed =
        GRAPE_MIN_SPEED + (GRAPE_MAX_SPEED - GRAPE_MIN_SPEED) * clamped
      return baseSpeed * getGrapeChargeRangeScale(clamped)
    }
    return BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * clamped
  }

  protected getRangedGravityScale(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_GRAVITY_SCALE
      : BOW_GRAVITY_SCALE
  }

  protected getRangedProjectileVisualType(
    weapon: Entity['weapon']
  ): Extract<WeaponVisualType, 'arrow' | 'grapeShot'> {
    return weapon?.weaponType === 'grape' ? 'grapeShot' : 'arrow'
  }

  protected getRangedProjectileDensity(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_PROJECTILE_DENSITY
      : DEFAULT_PROJECTILE_DENSITY
  }

  protected getRangedProjectileRestitution(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_PROJECTILE_RESTITUTION
      : DEFAULT_PROJECTILE_RESTITUTION
  }

  protected getRangedProjectileLifetimeMs(weapon: Entity['weapon']): number {
    return weapon?.weaponType === 'grape'
      ? GRAPE_PROJECTILE_LIFETIME_MS
      : DEFAULT_PROJECTILE_LIFETIME_MS
  }

  protected getRangedProjectileRadius(
    weapon: Entity['weapon'],
    projectileThickness: number
  ): number {
    if (weapon?.weaponType === 'grape') {
      return GRAPE_PROJECTILE_RADIUS
    }
    return Math.max(0.08, projectileThickness)
  }

  protected isRangedProjectileSticky(weapon: Entity['weapon']): boolean {
    return weapon?.weaponType !== 'grape'
  }

  protected playRangedFireSound(
    entity: Entity,
    weapon: Entity['weapon']
  ): void {
    if (!weapon) {
      return
    }
    if (weapon?.weaponType === 'grape') {
      const grapeWeapon = weapon
      this.statsSystem?.playSoundAt(
        SOUND_IDS.GRAPE_FIRE,
        grapeWeapon.visual.x,
        grapeWeapon.visual.y
      )
      this.emitSoundAt(
        grapeWeapon.visual.x,
        grapeWeapon.visual.y,
        entity,
        SOUND_DB_BOW_SNAP
      )
      return
    }

    this.statsSystem?.playSoundAt(
      SOUND_IDS.BOW_SNAP,
      weapon.visual.x,
      weapon.visual.y
    )
    this.emitSoundAt(
      weapon.visual.x,
      weapon.visual.y,
      entity,
      SOUND_DB_BOW_SNAP
    )
  }

  protected getBowMinWindupMs(weapon: Entity['weapon']): number {
    return this.getRangedMinWindupMs(weapon)
  }

  protected getBowMinForceRatio(weapon: Entity['weapon']): number {
    return this.getRangedMinForceRatio(weapon)
  }

  protected handleWindupPhase(entity: Entity, weapon: Entity['weapon']): void {
    if (!weapon || !entity.transform) return

    const isGrounded = entity.movement?.isGrounded ?? true
    const baseWindupDuration = isGrounded
      ? this.getWindupMs(weapon)
      : this.scaleWindupDuration(250, weapon)
    const windupDuration = weapon.parryCounterActive
      ? baseWindupDuration / 2
      : baseWindupDuration

    const t = clamp01(weapon.attackElapsedMs / windupDuration)

    lerpRelativeTransform(
      weapon.attackStartOffset,
      weapon.swingStartOffset,
      t,
      this.tempRelativeTransform
    )

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    applyOffset(this.tempRelativeTransform, this.tempPlayerPos, weapon.visual)

    if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
      const facing =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : weapon.attackFacing
      this.interruptWindupToBlock(entity, this.tempPlayerPos, facing)
      return
    }

    if (t >= 1) {
      weapon.parryCounterActive = false
      this.statsSystem?.playSoundAt(
        SOUND_IDS.SWORD_SWING_NORMAL,
        weapon.visual.x,
        weapon.visual.y
      )
      this.emitSoundAt(
        weapon.visual.x,
        weapon.visual.y,
        entity,
        SOUND_DB_SWORD_SWING
      )
      weapon.attackPhase = 'swing'
      this.applyDamageOverrides(entity, weapon)
      weapon.attackElapsedMs = 0
      // We don't need to copyTransform(attackStartTransform, swingStartTransform) anymore for logic,
      // but keeping data consistent is fine. However, logic now relies on offsets.
      copyTransform(weapon.attackStartTransform, weapon.swingStartTransform)
      weapon.hitEntityIds.clear()
    }
  }

  protected handleSwingPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    const previousWeaponX = weapon.visual.x
    const previousWeaponY = weapon.visual.y
    const previousWeaponRotation = weapon.visual.rotation

    const t = clamp01(weapon.attackElapsedMs / this.getSwingMs(weapon))

    lerpRelativeTransform(
      weapon.swingStartOffset,
      weapon.swingEndOffset,
      t,
      this.tempRelativeTransform
    )
    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    const obstacle = this.checkObstacleCollision(
      entity,
      weapon,
      previousWeaponX,
      previousWeaponY,
      previousWeaponRotation
    )
    if (obstacle) {
      weapon.attackCollisionSource = 'obstacle'
      weapon.isColliding = true
      this.statsSystem?.playSoundAt(
        SOUND_IDS.SWORD_HIT_OBSTACLE,
        weapon.visual.x,
        weapon.visual.y
      )
      this.emitSoundAt(
        weapon.visual.x,
        weapon.visual.y,
        entity,
        SOUND_DB_SWORD_HIT_OBSTACLE
      )
      this.applyPushback(entity, weapon)
      if (this.shouldSkipObstacleRebound(weapon, obstacle)) {
        this.finishObstacleHitWithoutRebound(weapon, playerPos, now)
      } else {
        this.startRebound(entity, playerPos, now, 'obstacle')
      }
      return
    }
    this.tryQueueHeavyGroundHitSound(entity, weapon)
    this.checkEntityHits(entity, weapon)
    if (t >= 1) {
      this.tryEmitCompletedFinalSwingCameraShake(entity, weapon)
      this.enterAttackPause(weapon, playerPos, now)
    }
  }

  protected handlePausePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    const currentFacing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : attackFacing
    if (currentFacing !== weapon.attackFacing) {
      this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
      return
    }

    // Allow interrupting pause/recovery with block
    // Allow blocking even if stunned IF we are in a locked pause (rebound recovery)
    if (
      entity.input &&
      entity.input.blockRequested &&
      (!entity.isStunned() || weapon.reboundLockedPause)
    ) {
      if (entity.isStunned() && entity.movement) {
        entity.movement.knockbackDuration = 0
      }
      this.interruptWindupToBlock(entity, playerPos, currentFacing)
      return
    }

    copyTransform(weapon.visual, weapon.attackStartTransform)

    if (weapon.attackCollisionSource !== 'obstacle') {
      this.checkObstacleCollision(entity, weapon)
    }
    if (entity.movement && !entity.movement.isGrounded) {
      this.checkEntityHits(entity, weapon)
    }
    this.tryQueueHeavyGroundHitSound(entity, weapon)

    const pauseMs = this.getPauseMs(weapon)
    const pauseThreshold = weapon.reboundLockedPause
      ? Math.max(REBOUND_PAUSE_MS, pauseMs)
      : pauseMs
    const reachedPause = weapon.attackElapsedMs >= pauseThreshold
    if (weapon.reboundLockedPause && !reachedPause) {
      return
    }
    if (weapon.reboundLockedPause && reachedPause) {
      weapon.reboundLockedPause = false
    }
    if (!reachedPause) return

    let canChain = false
    let nextMove: AttackMoveData | null = null
    let nextMoveIndex = -1
    let sequenceMoveCount = 0

    if (weapon.attackQueued && weapon.attackPhase !== 'rebound') {
      if (weapon.movesetId) {
        const moveset = ATTACK_MOVESETS[weapon.movesetId]
        const seq = moveset?.sequences.find(
          (sequence) => sequence.id === weapon.activeSequenceId
        )
        if (seq) {
          sequenceMoveCount = seq.moves.length
          nextMoveIndex = this.getNextComboMoveIndex(seq, weapon)
          if (nextMoveIndex >= 0) {
            canChain = true
            nextMove = ATTACK_MOVES[seq.moves[nextMoveIndex]] || null
          }
        }
      }
    }

    if (canChain && nextMove) {
      if (!this.isMoveCompatibleWithWeapon(nextMove, weapon.weaponType)) {
        weapon.attackQueued = false
      } else {
        weapon.attackQueued = false
        weapon.comboCount += 1

        weapon.activeMoveIndex = nextMoveIndex
        weapon.activeMoveId = nextMove.id
        weapon.swingDirection = this.resolveChainedSwingDirection(
          nextMove,
          weapon,
          playerPos,
          nextMoveIndex,
          sequenceMoveCount
        )
        weapon.impactLevel = this.resolveImpactLevel(nextMove, weapon)
        weapon.isUnstoppable = nextMove.isUnstoppable
        attackRadius = (attackRadius * nextMove.radiusScale) / 100

        getSwingTransforms(
          attackRadius,
          weapon.attackFacing,
          nextMove.kind,
          weapon.swingDirection,
          playerPos,
          weapon.weaponType,
          weapon.width,
          weapon.swingStartTransform,
          weapon.swingEndTransform
        )

        getOffsetFromTransform(
          weapon.visual,
          playerPos,
          weapon.attackStartOffset
        )
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

        weapon.attackPhase = nextMove.windupMs > 0 ? 'windup' : 'swing'
        weapon.attackElapsedMs = 0
        weapon.lastAttackTimestamp = now
        this.beginAttackImpactState(entity, weapon)

        if (weapon.attackPhase === 'windup') {
          // Update attackStartTransform based on current visual
          applyOffset(
            weapon.attackStartOffset,
            playerPos,
            weapon.attackStartTransform
          )
          copyTransform(weapon.visual, weapon.attackStartTransform)
        } else {
          // Skip windup, go directly to swing
          this.statsSystem?.playSoundAt(
            SOUND_IDS.SWORD_SWING_NORMAL,
            weapon.visual.x,
            weapon.visual.y
          )
          this.emitSoundAt(
            weapon.visual.x,
            weapon.visual.y,
            entity,
            SOUND_DB_SWORD_SWING
          )
          this.applyDamageOverrides(entity, weapon)
          copyTransform(weapon.swingStartTransform, weapon.visual)
          copyTransform(weapon.attackStartTransform, weapon.visual)
        }

        weapon.hitEntityIds.clear()
        return
      }
    }

    weapon.attackPhase = 'recover'
    weapon.reboundLockedPause = false
    weapon.attackElapsedMs = 0
    copyTransform(weapon.attackStartTransform, weapon.visual)
  }

  protected handleRecoverPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.input || !entity.weapon) return

    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1

    if (facing !== weapon.attackFacing) {
      this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
      return
    }

    const t = clamp01(weapon.attackElapsedMs / this.getRecoverMs(weapon))

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    getOffsetFromTransform(
      this.tempTransform,
      playerPos,
      this.tempTargetRelativeTransform
    )

    lerpRelativeTransform(
      weapon.attackStartOffset,
      this.tempTargetRelativeTransform,
      t,
      this.tempRelativeTransform
    )

    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)
    this.tryQueueHeavyGroundHitSound(entity, weapon)

    if (t >= 1) {
      weapon.attackPhase = 'idle'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackQueued = false
      weapon.comboCount = 0
      weapon.swingDirection = 'toFront'
      weapon.nextSwingDirection = 'toFront'
      weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
      this.clearAttackImpactState(weapon)
    }
  }

  protected resetAttackStateForInterrupt(weapon: Entity['weapon']): void {
    if (!weapon) return
    this.restoreDamageOverrides(weapon)
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.reboundLockedPause = false
    weapon.parryCounterActive = false
    weapon.hitEntityIds.clear()
    this.clearAttackImpactState(weapon)
  }

  protected resetWeaponToCombatIdle(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    this.resetAttackStateForInterrupt(weapon)
    weapon.attackPhase = 'idle'
    weapon.attackFacing = facing
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryHitWeaponIds.clear()
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    getFrontTransform(
      playerPos,
      facing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width
    )
  }

  protected interruptWindupToBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    this.resetAttackStateForInterrupt(weapon)
    weapon.attackFacing = facing
    this.startBlock(entity, playerPos, facing)
  }
}
