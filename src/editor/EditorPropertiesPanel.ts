import { fabric } from 'fabric'

import { localizer } from '../Localizer'
import {
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { setWeaponBackTransform } from '../ecs/WeaponPoseUtils'
import { computeWeaponScaleFactor } from '../ecs/factories/PlayerFactory'
import type { EditorMapData } from '../editorMapTypes'
import {
  HUD_SLOT_SIZE,
  HUD_SLOT_SPACING,
  drawHudWeaponSlot,
} from '../renderer/HudWeaponSlotRenderer'
import { renderWeapon } from '../renderer/WeaponRenderer'
import type { EnemyPatrolMode, WeaponType } from '../types'
import type { EditorObjectFactory } from './EditorObjectFactory'
import {
  computeWeaponRenderDimensions,
  renderEnemyPreviewToContext,
} from './EditorRenderUtils'
import { EditorUIHelper } from './EditorUIHelper'
import type {
  EditorObjectData,
  EnemyMarker,
  EnemyMarkerData,
  WeaponMarker,
  WeaponMarkerData,
} from './types'

export interface EditorPropertiesPanelContext {
  getFabricCanvas: () => fabric.Canvas | null
  weaponMarkerMap: Map<fabric.Object, WeaponMarkerData>
  enemyMarkerMap: Map<fabric.Object, EnemyMarkerData>
  editorObjectMap: Map<fabric.Object, EditorObjectData>
  objectFactory: EditorObjectFactory
  requestRender: () => void
  getMapSnapshot: () => EditorMapData
  applyMapSnapshot: (data: EditorMapData) => void
  onHistoryCapture: () => void
  getOrCreateEnemyWeaponMarker: (
    enemyData: EnemyMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ) => WeaponMarker | null
  updateEnemyMarkerVisual: (
    marker: EnemyMarker,
    radiusMeters: number,
    color: string,
    facing: number
  ) => void
  updateWeaponMarkerVisual: (marker: WeaponMarker, sizeLevel: number) => void
}

export class EditorPropertiesPanel {
  private context: EditorPropertiesPanelContext

  constructor(context: EditorPropertiesPanelContext) {
    this.context = context
  }

  public async showEnemyPropertiesDialog(marker: EnemyMarker) {
    const data = this.context.enemyMarkerMap.get(marker)
    if (!data) {
      return
    }
    const baseSnapshot = this.context.getMapSnapshot()
    let committed = false

    const editorData = this.context.editorObjectMap.get(marker)
    const enemyTypeLocal = localizer.t(`editor_enemy_${data.enemyType}`)
    const objectName = editorData?.name ?? ''

    const dialog = EditorUIHelper.createPropertiesDialog(
      `[${enemyTypeLocal}] ${objectName}`
    )

    const { leftPanel, rightPanel, previewCanvas, previewCtx, close, modal } =
      dialog
    const weaponSlotsCanvas = EditorUIHelper.createPreviewCanvas({
      width: 160,
      height: 64,
    })
    weaponSlotsCanvas.style.marginTop = '12px'
    rightPanel.appendChild(weaponSlotsCanvas)
    const weaponSlotsCtx = weaponSlotsCanvas.getContext('2d')

    // Radius
    const radiusRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_radius')
    )
    const radiusInput = EditorUIHelper.createNumberInput({
      value: data.radius,
      min: '0.1',
      step: '0.1',
    })
    radiusRow.row.appendChild(radiusInput)
    leftPanel.appendChild(radiusRow.row)

    // Move Speed
    const speedRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_move_speed')
    )
    const speedInput = EditorUIHelper.createNumberInput({
      value: data.moveSpeed,
      min: '0',
      step: '0.1',
    })
    speedRow.row.appendChild(speedInput)
    leftPanel.appendChild(speedRow.row)

    // Attack Desire
    const desireRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_attack_desire')
    )
    const desireInput = EditorUIHelper.createNumberInput({
      value: data.attackDesire,
      min: '0',
      max: '100',
      step: '1',
    })
    desireRow.row.appendChild(desireInput)
    leftPanel.appendChild(desireRow.row)

    // Parry Proficiency
    const parryRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_parry')
    )
    const parryInput = EditorUIHelper.createNumberInput({
      value: data.parryProficiency,
      min: '0',
      max: '100',
      step: '1',
    })
    parryRow.row.appendChild(parryInput)
    leftPanel.appendChild(parryRow.row)

    // Patrol Mode
    const patrolRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_patrol_mode')
    )
    const patrolModes: EnemyPatrolMode[] = ['patrol', 'guard']
    const patrolSelect = EditorUIHelper.createSelect({
      options: patrolModes.map((mode) => ({
        value: mode,
        label: localizer.t(`editor_enemy_patrol_${mode}`),
      })),
      selected: data.initialPatrolMode,
    })
    patrolRow.row.appendChild(patrolSelect)
    leftPanel.appendChild(patrolRow.row)

    // Facing
    const facingRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_facing')
    )
    const facingSelect = EditorUIHelper.createSelect({
      options: [
        { value: '1', label: localizer.t('editor_enemy_facing_right') },
        { value: '-1', label: localizer.t('editor_enemy_facing_left') },
      ],
      selected: String(data.facing ?? 1),
    })
    facingRow.row.appendChild(facingSelect)
    leftPanel.appendChild(facingRow.row)

    // Health
    const healthRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_max_health')
    )
    const healthInput = EditorUIHelper.createNumberInput({
      value: data.maxHealth,
      min: '1',
      step: '1',
    })
    healthRow.row.appendChild(healthInput)
    leftPanel.appendChild(healthRow.row)

    // Posture
    const postureRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_max_posture')
    )
    const postureInput = EditorUIHelper.createNumberInput({
      value: data.maxPosture,
      min: '0',
      step: '1',
    })
    postureRow.row.appendChild(postureInput)
    leftPanel.appendChild(postureRow.row)

    // Toughness
    const toughnessRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_max_toughness')
    )
    const toughnessInput = EditorUIHelper.createNumberInput({
      value: data.maxToughness,
      min: '0',
      step: '1',
    })
    toughnessRow.row.appendChild(toughnessInput)
    leftPanel.appendChild(toughnessRow.row)

    // Color
    const colorRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_color')
    )
    const colorInput = EditorUIHelper.createTextInput({ value: data.color })
    colorRow.row.appendChild(colorInput)

    const colorPicker = EditorUIHelper.createColorInput(data.color)
    colorPicker.addEventListener('input', () => {
      colorInput.value = colorPicker.value
    })
    colorInput.addEventListener('input', () => {
      const value = colorInput.value.trim()
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        colorPicker.value = value
      }
    })
    colorRow.row.appendChild(colorPicker)
    leftPanel.appendChild(colorRow.row)

    // Main Weapon
    const mainWeaponRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_category_main')
    )
    const mainWeaponSelect = EditorUIHelper.createSelect({
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_sword'), value: 'sword' },
      ],
      selected: data.mainWeapon ?? 'none',
    })
    mainWeaponRow.row.appendChild(mainWeaponSelect)

    const mainWeaponConfigBtn = EditorUIHelper.createButton(
      localizer.t('editor_weapon_menu_properties')
    )
    mainWeaponConfigBtn.style.fontSize = '11px'
    mainWeaponConfigBtn.style.marginLeft = '8px'
    mainWeaponConfigBtn.addEventListener('click', async () => {
      const weaponValue = mainWeaponSelect.value
      if (weaponValue && weaponValue !== 'none') {
        const weaponMarker = this.context.getOrCreateEnemyWeaponMarker(
          data,
          weaponValue as WeaponType,
          'main'
        )
        if (weaponMarker) {
          await this.showWeaponPropertiesDialog(weaponMarker)
          renderEnemyPreview()
        }
      }
    })
    mainWeaponRow.row.appendChild(mainWeaponConfigBtn)
    leftPanel.appendChild(mainWeaponRow.row)

    const updateMainWeaponConfigBtnVisibility = () => {
      const weaponType = mainWeaponSelect.value
      mainWeaponConfigBtn.style.display =
        weaponType && weaponType !== 'none' ? 'inline-block' : 'none'

      if (weaponType === 'none' || !weaponType) {
        if (data.mainWeaponMarker) {
          this.context.weaponMarkerMap.delete(data.mainWeaponMarker)
          data.mainWeaponMarker = undefined
        }
      }
    }
    const handleMainWeaponChange = () => {
      updateMainWeaponConfigBtnVisibility()
      renderEnemyPreview()
    }
    mainWeaponSelect.addEventListener('change', handleMainWeaponChange)
    updateMainWeaponConfigBtnVisibility()

    // Secondary Weapon
    const secondaryWeaponRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_category_secondary')
    )
    const secondaryWeaponSelect = EditorUIHelper.createSelect({
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_bow'), value: 'bow' },
      ],
      selected: data.secondaryWeapon ?? 'none',
    })
    secondaryWeaponRow.row.appendChild(secondaryWeaponSelect)

    const secondaryWeaponConfigBtn = EditorUIHelper.createButton(
      localizer.t('editor_weapon_menu_properties')
    )
    secondaryWeaponConfigBtn.style.fontSize = '11px'
    secondaryWeaponConfigBtn.style.marginLeft = '8px'
    secondaryWeaponConfigBtn.addEventListener('click', async () => {
      const weaponValue = secondaryWeaponSelect.value
      if (weaponValue && weaponValue !== 'none') {
        const weaponMarker = this.context.getOrCreateEnemyWeaponMarker(
          data,
          weaponValue as WeaponType,
          'secondary'
        )
        if (weaponMarker) {
          await this.showWeaponPropertiesDialog(weaponMarker)
          renderEnemyPreview()
        }
      }
    })
    secondaryWeaponRow.row.appendChild(secondaryWeaponConfigBtn)
    leftPanel.appendChild(secondaryWeaponRow.row)

    const updateSecondaryWeaponConfigBtnVisibility = () => {
      const weaponType = secondaryWeaponSelect.value
      secondaryWeaponConfigBtn.style.display =
        weaponType && weaponType !== 'none' ? 'inline-block' : 'none'

      if (weaponType === 'none' || !weaponType) {
        if (data.secondaryWeaponMarker) {
          this.context.weaponMarkerMap.delete(data.secondaryWeaponMarker)
          data.secondaryWeaponMarker = undefined
        }
      }
    }
    const handleSecondaryWeaponChange = () => {
      updateSecondaryWeaponConfigBtnVisibility()
      renderEnemyPreview()
    }
    secondaryWeaponSelect.addEventListener(
      'change',
      handleSecondaryWeaponChange
    )
    updateSecondaryWeaponConfigBtnVisibility()

    // Buttons
    const buttonRow = EditorUIHelper.createButtonRow()
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    buttonRow.appendChild(confirmBtn)
    buttonRow.appendChild(cancelBtn)
    leftPanel.appendChild(buttonRow)

    // Preview rendering
    const colorRegex = /^#[0-9a-fA-F]{6}$/
    const getValidColor = () => {
      const value = colorInput.value.trim()
      return colorRegex.test(value) ? value : data.color
    }

    type WeaponSlotPreview = {
      hasWeapon: boolean
      weaponType: WeaponType
      weaponWidth: number
      weaponHeight: number
      sizeLevel: number
      sizeMaxLevel: number
      ammo: number
    }

    const mainSlotPreview: WeaponSlotPreview = {
      hasWeapon: false,
      weaponType: 'sword',
      weaponWidth: 0,
      weaponHeight: 0,
      sizeLevel: 0,
      sizeMaxLevel: 0,
      ammo: 0,
    }

    const secondarySlotPreview: WeaponSlotPreview = {
      hasWeapon: false,
      weaponType: 'sword',
      weaponWidth: 0,
      weaponHeight: 0,
      sizeLevel: 0,
      sizeMaxLevel: 0,
      ammo: 0,
    }

    const previewPlayerPos = { x: 0, y: 0 }
    const previewWeaponTransform = { x: 0, y: 0, rotation: 0 }
    const weaponAmmoTextCache: string[] = []
    const previewPixelsPerMeter = 60
    const previewWeaponColor = '#b4bdc7'

    const getAmmoText = (ammo: number): string => {
      const cached = weaponAmmoTextCache[ammo]
      if (cached) return cached
      const text = String(ammo)
      weaponAmmoTextCache[ammo] = text
      return text
    }

    const resetWeaponSlotPreview = (slot: WeaponSlotPreview) => {
      slot.hasWeapon = false
      slot.weaponType = 'sword'
      slot.weaponWidth = 0
      slot.weaponHeight = 0
      slot.sizeLevel = 0
      slot.sizeMaxLevel = 0
      slot.ammo = 0
    }

    const fillWeaponSlotPreview = (
      slot: WeaponSlotPreview,
      weaponValue: string,
      marker: WeaponMarker | undefined
    ) => {
      if (!weaponValue || weaponValue === 'none') {
        resetWeaponSlotPreview(slot)
        return
      }

      const weaponType = weaponValue as WeaponType
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const markerData = marker
        ? this.context.weaponMarkerMap.get(marker)
        : null
      const markerMatches =
        markerData && markerData.weaponType === weaponType ? markerData : null
      const sizeLevel = markerMatches
        ? markerMatches.sizeLevel
        : template.sizeLevel
      const scaleFactor = computeWeaponScaleFactor(template, sizeLevel)

      slot.hasWeapon = true
      slot.weaponType = weaponType
      slot.weaponWidth = template.width * scaleFactor
      slot.weaponHeight = template.height * scaleFactor
      slot.sizeLevel = sizeLevel
      slot.sizeMaxLevel = template.sizeMaxLevel
      slot.ammo =
        weaponType === 'bow'
          ? (markerMatches?.bowAmmo ?? DEFAULT_BOW_AMMO_ENEMY)
          : 0
    }

    const renderWeaponSlotsPreview = () => {
      if (!weaponSlotsCtx) {
        return
      }

      const canvasWidth = weaponSlotsCanvas.width
      const canvasHeight = weaponSlotsCanvas.height
      weaponSlotsCtx.clearRect(0, 0, canvasWidth, canvasHeight)

      const totalWidth = HUD_SLOT_SIZE * 2 + HUD_SLOT_SPACING
      const startX = Math.round((canvasWidth - totalWidth) / 2)
      const slotY = Math.round((canvasHeight - HUD_SLOT_SIZE) / 2)
      const secondaryX = startX + HUD_SLOT_SIZE + HUD_SLOT_SPACING

      const mainAmmoValue = mainSlotPreview.ammo < 0 ? 0 : mainSlotPreview.ammo
      const secondaryAmmoValue =
        secondarySlotPreview.ammo < 0 ? 0 : secondarySlotPreview.ammo

      drawHudWeaponSlot(
        weaponSlotsCtx,
        startX,
        slotY,
        HUD_SLOT_SIZE,
        true,
        mainSlotPreview.hasWeapon,
        mainSlotPreview.weaponType === 'bow' ? 'bow' : 'sword',
        mainSlotPreview.weaponWidth,
        mainSlotPreview.weaponHeight,
        mainSlotPreview.sizeLevel,
        mainSlotPreview.sizeMaxLevel,
        mainAmmoValue,
        mainSlotPreview.weaponType === 'bow' ? getAmmoText(mainAmmoValue) : ''
      )
      drawHudWeaponSlot(
        weaponSlotsCtx,
        secondaryX,
        slotY,
        HUD_SLOT_SIZE,
        false,
        secondarySlotPreview.hasWeapon,
        secondarySlotPreview.weaponType === 'bow' ? 'bow' : 'sword',
        secondarySlotPreview.weaponWidth,
        secondarySlotPreview.weaponHeight,
        secondarySlotPreview.sizeLevel,
        secondarySlotPreview.sizeMaxLevel,
        secondaryAmmoValue,
        secondarySlotPreview.weaponType === 'bow'
          ? getAmmoText(secondaryAmmoValue)
          : ''
      )
    }

    const renderEnemyPreview = () => {
      if (!previewCtx) {
        return
      }
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
      const radiusMeters = Number.parseFloat(radiusInput.value)
      const radius =
        Number.isFinite(radiusMeters) && radiusMeters > 0
          ? radiusMeters
          : data.radius
      const color = getValidColor()
      const facing = Number.parseInt(facingSelect.value, 10)

      fillWeaponSlotPreview(
        mainSlotPreview,
        mainWeaponSelect.value,
        data.mainWeaponMarker
      )
      fillWeaponSlotPreview(
        secondarySlotPreview,
        secondaryWeaponSelect.value,
        data.secondaryWeaponMarker
      )

      const centerX = Math.round(previewCanvas.width / 2)
      const centerY = Math.round((previewCanvas.height * 58) / 100)
      previewPlayerPos.x = centerX / previewPixelsPerMeter
      previewPlayerPos.y = centerY / previewPixelsPerMeter

      const renderMainWeapon = () => {
        if (!mainSlotPreview.hasWeapon) {
          return
        }
        setWeaponBackTransform(
          previewPlayerPos,
          facing,
          previewWeaponTransform,
          radius,
          mainSlotPreview.weaponType
        )
        const weaponX = Math.round(
          previewWeaponTransform.x * previewPixelsPerMeter
        )
        const weaponY = Math.round(
          previewWeaponTransform.y * previewPixelsPerMeter
        )
        const weaponWidth = Math.round(
          mainSlotPreview.weaponWidth * previewPixelsPerMeter
        )
        const weaponHeight = Math.round(
          mainSlotPreview.weaponHeight * previewPixelsPerMeter
        )
        if (weaponWidth <= 0 || weaponHeight <= 0) {
          return
        }

        previewCtx.save()
        previewCtx.translate(weaponX, weaponY)
        previewCtx.rotate(previewWeaponTransform.rotation)
        renderWeapon(
          previewCtx,
          mainSlotPreview.weaponType === 'bow' ? 'bow' : 'sword',
          weaponWidth,
          weaponHeight,
          previewWeaponColor,
          false,
          0
        )
        previewCtx.restore()
      }

      if (facing < 0) {
        renderMainWeapon()
      }
      renderEnemyPreviewToContext(
        previewCtx,
        centerX,
        centerY,
        radius,
        color,
        previewPixelsPerMeter,
        facing
      )
      if (facing >= 0) {
        renderMainWeapon()
      }
      renderWeaponSlotsPreview()
    }

    const updateEnemyVisualFromInputs = () => {
      const radiusMeters = Number.parseFloat(radiusInput.value)
      const facing = Number.parseInt(facingSelect.value, 10)
      if (Number.isFinite(radiusMeters) && radiusMeters > 0) {
        this.context.updateEnemyMarkerVisual(
          marker,
          radiusMeters,
          getValidColor(),
          facing
        )
        this.context.requestRender()
      } else {
        renderEnemyPreview()
      }
    }

    radiusInput.addEventListener('input', () => {
      updateEnemyVisualFromInputs()
      renderEnemyPreview()
    })
    colorPicker.addEventListener('input', () => {
      updateEnemyVisualFromInputs()
      renderEnemyPreview()
    })
    colorInput.addEventListener('input', () => {
      renderEnemyPreview()
      if (colorRegex.test(colorInput.value.trim())) {
        updateEnemyVisualFromInputs()
      }
    })
    facingSelect.addEventListener('change', () => {
      updateEnemyVisualFromInputs()
      renderEnemyPreview()
    })

    renderEnemyPreview()

    // Confirm handler
    confirmBtn.addEventListener('click', () => {
      const radius = Number.parseFloat(radiusInput.value)
      const moveSpeed = Number.parseFloat(speedInput.value)
      const attackDesire = Number.parseFloat(desireInput.value)
      const parryProficiency = Number.parseFloat(parryInput.value)
      const initialPatrolMode = patrolSelect.value as EnemyPatrolMode
      const facing = Number.parseInt(facingSelect.value, 10)
      const maxHealth = Number.parseFloat(healthInput.value)
      const maxPosture = Number.parseFloat(postureInput.value)
      const maxToughness = Number.parseFloat(toughnessInput.value)
      const color = getValidColor()

      if (
        !Number.isFinite(radius) ||
        radius <= 0 ||
        !Number.isFinite(moveSpeed) ||
        moveSpeed < 0 ||
        !Number.isFinite(attackDesire) ||
        attackDesire < 0 ||
        !Number.isFinite(parryProficiency) ||
        parryProficiency < 0 ||
        !Number.isFinite(maxHealth) ||
        maxHealth <= 0 ||
        !Number.isFinite(maxPosture) ||
        maxPosture < 0 ||
        !Number.isFinite(maxToughness) ||
        maxToughness < 0 ||
        color.length === 0
      ) {
        return
      }

      data.radius = radius
      data.moveSpeed = moveSpeed
      data.attackDesire = attackDesire
      data.parryProficiency = parryProficiency
      data.initialPatrolMode = initialPatrolMode
      data.maxHealth = maxHealth
      data.maxPosture = maxPosture
      data.maxToughness = maxToughness
      data.color = color
      data.facing = facing

      const mainVal = mainWeaponSelect.value
      if (mainVal === 'none') {
        data.mainWeapon = undefined
        marker.mainWeapon = undefined
        if (data.mainWeaponMarker) {
          this.context.weaponMarkerMap.delete(data.mainWeaponMarker)
          data.mainWeaponMarker = undefined
        }
      } else {
        const weaponType = mainVal as WeaponType
        data.mainWeapon = weaponType
        marker.mainWeapon = data.mainWeapon
        this.context.getOrCreateEnemyWeaponMarker(data, weaponType, 'main')
      }

      const secVal = secondaryWeaponSelect.value
      if (secVal === 'none') {
        data.secondaryWeapon = undefined
        marker.secondaryWeapon = undefined
        if (data.secondaryWeaponMarker) {
          this.context.weaponMarkerMap.delete(data.secondaryWeaponMarker)
          data.secondaryWeaponMarker = undefined
        }
      } else {
        const weaponType = secVal as WeaponType
        data.secondaryWeapon = weaponType
        marker.secondaryWeapon = data.secondaryWeapon
        this.context.getOrCreateEnemyWeaponMarker(data, weaponType, 'secondary')
      }

      data.equipWeapon = !!data.mainWeapon || !!data.secondaryWeapon
      marker.equipWeapon = data.equipWeapon

      marker.radius = radius
      marker.moveSpeed = moveSpeed
      marker.attackDesire = attackDesire
      marker.parryProficiency = parryProficiency
      marker.initialPatrolMode = initialPatrolMode
      marker.maxHealth = maxHealth
      marker.maxPosture = maxPosture
      marker.maxToughness = maxToughness
      marker.color = color
      marker.facing = facing

      this.context.updateEnemyMarkerVisual(
        marker,
        data.radius,
        data.color,
        data.facing
      )
      this.context.requestRender()
      committed = true
      this.context.onHistoryCapture()
      close()
    })

    const closeDialog = () => {
      if (!committed) {
        this.context.applyMapSnapshot(baseSnapshot)
      }
      close()
    }

    cancelBtn.addEventListener('click', closeDialog)

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeDialog()
      }
    })

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return
    }
    dialog.show(viewport)
  }

  public async showWeaponPropertiesDialog(marker: WeaponMarker) {
    const data = this.context.weaponMarkerMap.get(marker)
    if (!data) {
      return
    }
    const baseSnapshot = this.context.getMapSnapshot()
    let committed = false

    const template = WEAPON_DEFAULT_DATA[marker.weaponType]
    const isBow = marker.weaponType === 'bow'

    const getSizeName = (level: number): string => {
      if (isBow) {
        return level === 1
          ? localizer.t('editor_weapon_size_bow_1')
          : localizer.t('editor_weapon_size_bow_2')
      } else {
        switch (level) {
          case 1:
            return localizer.t('editor_weapon_size_sword_1')
          case 2:
            return localizer.t('editor_weapon_size_sword_2')
          case 3:
            return localizer.t('editor_weapon_size_sword_3')
          case 4:
            return localizer.t('editor_weapon_size_sword_4')
          default:
            return String(level)
        }
      }
    }

    const editorData = this.context.editorObjectMap.get(marker)
    const weaponCategoryName = localizer.t(`editor_weapon_${data.weaponType}`)
    const objectName = editorData?.name ?? ''
    const dialog = EditorUIHelper.createPropertiesDialog(
      `[${weaponCategoryName}] ${objectName}`
    )
    const { leftPanel, previewCanvas, previewCtx, close, modal } = dialog

    const sizeOptions: Array<{ value: string; label: string }> = []
    for (let i = 1; i <= template.sizeMaxLevel; i++) {
      sizeOptions.push({
        value: String(i),
        label: `${i} - ${getSizeName(i)}`,
      })
    }
    const sizeRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_size')
    )
    const sizeSelect = EditorUIHelper.createSelect({
      options: sizeOptions,
      selected: String(data.sizeLevel),
    })
    sizeRow.row.appendChild(sizeSelect)
    leftPanel.appendChild(sizeRow.row)

    const attackRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_attack_damage')
    )
    const attackInput = EditorUIHelper.createNumberInput({
      value: data.attackDamage,
      min: '0',
      step: '0.1',
    })
    attackRow.row.appendChild(attackInput)
    leftPanel.appendChild(attackRow.row)

    const postureRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_posture_damage')
    )
    const postureInput = EditorUIHelper.createNumberInput({
      value: data.postureDamage,
      min: '0',
      step: '0.1',
    })
    postureRow.row.appendChild(postureInput)
    leftPanel.appendChild(postureRow.row)

    const toughnessRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_toughness_damage')
    )
    const toughnessInput = EditorUIHelper.createNumberInput({
      value: data.toughnessDamage,
      min: '0',
      step: '0.1',
    })
    toughnessRow.row.appendChild(toughnessInput)
    leftPanel.appendChild(toughnessRow.row)

    let bowAmmoInput: HTMLInputElement | null = null
    if (isBow) {
      const ammoRow = EditorUIHelper.createFormRow(
        localizer.t('editor_weapon_prop_bow_ammo')
      )
      bowAmmoInput = EditorUIHelper.createNumberInput({
        value: data.bowAmmo ?? DEFAULT_BOW_AMMO_PLAYER,
        min: '0',
        step: '1',
      })
      ammoRow.row.appendChild(bowAmmoInput)
      leftPanel.appendChild(ammoRow.row)
    }

    const buttonRow = EditorUIHelper.createButtonRow()
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    buttonRow.appendChild(confirmBtn)
    buttonRow.appendChild(cancelBtn)
    leftPanel.appendChild(buttonRow)

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return
    }
    dialog.show(viewport)

    const renderWeaponPreview = () => {
      if (!previewCtx) {
        return
      }
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)

      const sizeLevel = Number.parseInt(sizeSelect.value, 10)
      const pixelsPerMeter = 60
      const dims = computeWeaponRenderDimensions(
        template,
        sizeLevel,
        pixelsPerMeter,
        isBow
      )
      const centerX = previewCanvas.width * 0.5
      const centerY = previewCanvas.height * 0.6
      const previewType = marker.weaponType === 'bow' ? 'bow' : 'sword'
      const previewColor = '#b4bdc7'

      previewCtx.save()
      previewCtx.translate(centerX, centerY)
      renderWeapon(
        previewCtx,
        previewType,
        dims.widthPx,
        dims.heightPx,
        previewColor
      )
      previewCtx.restore()
    }

    sizeSelect.addEventListener('input', () => {
      const sizeLevel = Number.parseInt(sizeSelect.value, 10)
      if (Number.isFinite(sizeLevel) && sizeLevel > 0) {
        this.context.updateWeaponMarkerVisual(marker, sizeLevel)
        this.context.requestRender()
      }
      renderWeaponPreview()
    })
    attackInput.addEventListener('input', renderWeaponPreview)
    postureInput.addEventListener('input', renderWeaponPreview)
    toughnessInput.addEventListener('input', renderWeaponPreview)
    if (bowAmmoInput) {
      bowAmmoInput.addEventListener('input', renderWeaponPreview)
    }
    renderWeaponPreview()

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        if (!committed) {
          this.context.applyMapSnapshot(baseSnapshot)
        }
        close()
        resolve()
      }

      confirmBtn.addEventListener('click', () => {
        const sizeLevel = Number.parseInt(sizeSelect.value, 10)
        const attackDamage = Number.parseFloat(attackInput.value)
        const postureDamage = Number.parseFloat(postureInput.value)
        const toughnessDamage = Number.parseFloat(toughnessInput.value)
        const bowAmmo = bowAmmoInput
          ? Number.parseInt(bowAmmoInput.value, 10)
          : data.bowAmmo

        if (
          !Number.isFinite(sizeLevel) ||
          !Number.isFinite(attackDamage) ||
          !Number.isFinite(postureDamage) ||
          !Number.isFinite(toughnessDamage)
        ) {
          cleanup()
          return
        }

        if (bowAmmoInput && !Number.isFinite(bowAmmo)) {
          cleanup()
          return
        }

        data.sizeLevel = sizeLevel
        data.attackDamage = attackDamage
        data.postureDamage = postureDamage
        data.toughnessDamage = toughnessDamage
        if (bowAmmoInput) {
          data.bowAmmo = bowAmmo
        }

        marker.sizeLevel = sizeLevel
        marker.attackDamage = attackDamage
        marker.postureDamage = postureDamage
        marker.toughnessDamage = toughnessDamage
        if (bowAmmoInput) {
          marker.bowAmmo = bowAmmo
        }

        this.context.updateWeaponMarkerVisual(marker, sizeLevel)
        this.context.requestRender()
        committed = true
        this.context.onHistoryCapture()
        cleanup()
      })

      cancelBtn.addEventListener('click', cleanup)
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup()
        }
      })
    })
  }
}
