import { localizer } from '../../Localizer'
import { type EditorColorInputElement, EditorUIHelper } from '../EditorUIHelper'
import {
  appendChildren,
  createPopupButton,
  createPopupMenu,
  createStyledElement,
  getSidebarTabButtonStyle,
  styleCompactButton,
  styleDrawerModeButton,
} from './EditorBodyDrawerDom'
import type { EditorCharacterBodyDrawerOptions } from './EditorBodyDrawerTypes'
import {
  CANVAS_ZOOM_DEFAULT_PERCENT,
  CANVAS_ZOOM_MAX_PERCENT,
  CANVAS_ZOOM_MIN_PERCENT,
  CANVAS_ZOOM_STEP_PERCENT,
  CUSTOM_BODY_PRESET_ID,
  DEFAULT_BODY_BLOOD_COLOR,
  DEFAULT_BRUSH_SIZE,
  DISPLAY_PANEL_SIZE,
  DISPLAY_SIZE,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
} from './EditorBodyDrawerTypes'

export interface EditorBodyDrawerNumberRow {
  row: HTMLDivElement
  inp: HTMLInputElement
}

export interface EditorBodyDrawerLayout {
  modal: HTMLDivElement
  close: () => void
  form: HTMLDivElement
  canvasWrap: HTMLDivElement
  drawCanvas: HTMLCanvasElement
  cursorEl: HTMLDivElement
  alertEl: HTMLDivElement
  zoomSlider: HTMLInputElement
  zoomValueText: HTMLSpanElement
  tabBtnLayers: HTMLButtonElement
  tabBtnBones: HTMLButtonElement
  layerHeader: HTMLDivElement
  addLayerBtn: HTMLButtonElement
  layerList: HTMLDivElement
  bonesPanel: HTMLDivElement
  boneList: HTMLDivElement
  bonePropPanel: HTMLDivElement
  boneLengthRow: EditorBodyDrawerNumberRow
  boneWidthRow: EditorBodyDrawerNumberRow
  contourMenu: HTMLDivElement
  addContourPointBtn: HTMLButtonElement
  removeContourPointBtn: HTMLButtonElement
  layerMenu: HTMLDivElement
  renameLayerBtn: HTMLButtonElement
  styleLayerBtn: HTMLButtonElement
  duplicateLayerBtn: HTMLButtonElement
  deleteLayerBtn: HTMLButtonElement
  presetSelect: HTMLSelectElement
  modeRow: HTMLDivElement
  contourBtn: HTMLButtonElement
  selectBtn: HTMLButtonElement
  collisionBtn: HTMLButtonElement
  shapeBtn: HTMLButtonElement
  fillBtn: HTMLButtonElement
  eraseBtn: HTMLButtonElement
  textureBtn: HTMLButtonElement
  resetStaticBtn: HTMLButtonElement
  resetSkeletalBtn: HTMLButtonElement
  brushSlider: HTMLInputElement
  brushValueText: HTMLSpanElement
  colorInput: EditorColorInputElement
  bloodColorInput: EditorColorInputElement
  confirmBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
  collisionToolMenu: HTMLDivElement
  collisionCircleBtn: HTMLButtonElement
  collisionEllipseBtn: HTMLButtonElement
  collisionCapsuleBtn: HTMLButtonElement
  collisionShapeMenu: HTMLDivElement
  deleteCollisionShapeBtn: HTMLButtonElement
}

export function createEditorBodyDrawerLayout(
  options: EditorCharacterBodyDrawerOptions
): EditorBodyDrawerLayout {
  const { modal, close } = EditorUIHelper.createModal({ zIndex: 10002 })
  modal.tabIndex = -1
  modal.style.padding = '12px'
  modal.style.boxSizing = 'border-box'
  modal.style.overflow = 'auto'

  const form = EditorUIHelper.createFormContainer({ minWidth: '1100px' })
  form.style.minWidth = 'min(1100px, calc(100% - 24px))'
  form.style.width = 'min(1100px, calc(100% - 24px))'
  form.style.maxWidth = 'calc(100% - 48px)'
  form.style.maxHeight = 'calc(100% - 48px)'
  form.style.padding = '20px'
  form.style.overflow = 'hidden'
  form.style.position = 'relative'

  form.appendChild(EditorUIHelper.createFormTitle(options.title))

  const content = createStyledElement(
    'div',
    'display:flex;gap:16px;align-items:stretch;justify-content:space-between;min-height:0;flex:1 1 auto;overflow:auto;flex-wrap:nowrap;'
  )
  form.appendChild(content)

  const sidebar = createStyledElement(
    'div',
    'width:112px;max-width:112px;display:flex;flex-direction:column;gap:10px;flex:0 0 112px;overflow-y:auto;overflow-x:hidden;'
  )
  const canvasColumn = createStyledElement(
    'div',
    'flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-width:0;min-height:0;overflow:hidden;'
  )
  const layerSidebar = createStyledElement(
    'div',
    'width:96px;max-width:96px;display:flex;flex-direction:column;gap:8px;flex:0 0 96px;min-height:0;overflow-x:hidden;overflow-y:auto;'
  )
  appendChildren(content, sidebar, canvasColumn, layerSidebar)

  const canvasWrap = createStyledElement(
    'div',
    'flex:1 1 auto;width:100%;display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden;position:relative;'
  )
  canvasColumn.appendChild(canvasWrap)

  const drawCanvas = document.createElement('canvas')
  drawCanvas.width = DISPLAY_SIZE
  drawCanvas.height = DISPLAY_SIZE
  drawCanvas.style.cssText = [
    `width:${DISPLAY_PANEL_SIZE}px`,
    `height:${DISPLAY_PANEL_SIZE}px`,
    'display:block',
    'image-rendering:pixelated',
    'background:rgba(0,0,0,0.65)',
    'border:1px solid rgba(255,255,255,0.2)',
    'touch-action:none',
    'pointer-events:auto',
    'user-select:none',
    'cursor:none',
  ].join(';')

  const cursorEl = createStyledElement(
    'div',
    [
      'position:absolute',
      'left:0',
      'top:0',
      'width:0',
      'height:0',
      'border:1px solid rgba(0,0,0,0.95)',
      'border-radius:50%',
      'pointer-events:none',
      'transform:translate(-50%,-50%)',
      'display:none',
      'box-sizing:border-box',
      'background:#ffffff',
      'box-shadow:0 0 0 1px rgba(255,255,255,0.95)',
      'opacity:0.95',
    ].join(';')
  )
  appendChildren(canvasWrap, drawCanvas, cursorEl)

  const canvasFooter = createStyledElement(
    'div',
    'flex:0 0 auto;width:100%;min-height:52px;padding-top:10px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:8px;box-sizing:border-box;'
  )
  canvasColumn.appendChild(canvasFooter)

  const alertEl = createStyledElement(
    'div',
    [
      'min-height:16px',
      'font-size:11px',
      'line-height:1.4',
      'text-align:center',
      'color:#e2b73c',
      'display:none',
      'width:100%',
    ].join(';')
  )
  canvasFooter.appendChild(alertEl)

  const zoomRow = createStyledElement(
    'div',
    'display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;width:100%;'
  )
  const zoomLabel = createStyledElement(
    'span',
    'font-size:11px;color:rgba(255,255,255,0.78);line-height:1;',
    localizer.t('editor_body_drawer_zoom')
  )
  const zoomSlider = document.createElement('input')
  zoomSlider.type = 'range'
  zoomSlider.min = String(CANVAS_ZOOM_MIN_PERCENT)
  zoomSlider.max = String(CANVAS_ZOOM_MAX_PERCENT)
  zoomSlider.step = String(CANVAS_ZOOM_STEP_PERCENT)
  zoomSlider.value = String(CANVAS_ZOOM_DEFAULT_PERCENT)
  zoomSlider.style.cssText = 'width:160px;max-width:160px;cursor:pointer;'
  const zoomValueText = createStyledElement(
    'span',
    'min-width:40px;font-size:11px;line-height:1;text-align:right;color:rgba(255,255,255,0.92);',
    `${CANVAS_ZOOM_DEFAULT_PERCENT}%`
  )
  appendChildren(zoomRow, zoomLabel, zoomSlider, zoomValueText)
  canvasFooter.appendChild(zoomRow)

  const sidebarTabBar = createStyledElement(
    'div',
    'display:flex;gap:4px;margin-bottom:2px;flex:0 0 auto;'
  )
  const tabBtnLayers = createStyledElement(
    'button',
    getSidebarTabButtonStyle(true),
    localizer.t('editor_body_drawer_tab_static')
  )
  const tabBtnBones = createStyledElement(
    'button',
    getSidebarTabButtonStyle(false),
    localizer.t('editor_body_drawer_tab_skeletal')
  )
  appendChildren(sidebarTabBar, tabBtnLayers, tabBtnBones)
  layerSidebar.appendChild(sidebarTabBar)

  const layerHeader = createStyledElement(
    'div',
    'display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto;'
  )
  const layerTitle = createStyledElement(
    'div',
    'font-size:11px;line-height:1;color:rgba(255,255,255,0.82);',
    localizer.t('editor_body_drawer_layers')
  )
  const addLayerBtn = EditorUIHelper.createButton('+')
  addLayerBtn.style.cssText = [
    'width:18px',
    'height:18px',
    'padding:0',
    'font-size:11px',
    'font-weight:700',
    'line-height:1',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'color:rgba(255,255,255,0.92)',
    'background:rgba(255,255,255,0.08)',
    'border:1px solid rgba(255,255,255,0.2)',
  ].join(';')
  appendChildren(layerHeader, layerTitle, addLayerBtn)
  layerSidebar.appendChild(layerHeader)

  const layerList = createStyledElement(
    'div',
    [
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'min-height:0',
      'overflow-y:auto',
      'padding-right:2px',
    ].join(';')
  )
  layerSidebar.appendChild(layerList)

  const bonesPanel = createStyledElement(
    'div',
    'display:none;flex-direction:column;gap:4px;min-height:0;flex:1 1 auto;'
  )
  const boneList = createStyledElement(
    'div',
    [
      'display:flex',
      'flex-direction:column',
      'gap:0',
      'overflow-y:auto',
      'flex:1 1 auto',
      'min-height:0',
    ].join(';')
  )
  const bonePropPanel = createStyledElement(
    'div',
    [
      'display:none',
      'flex-direction:column',
      'gap:6px',
      'flex:0 0 auto',
      'padding-top:6px',
      'border-top:1px solid rgba(255,255,255,0.12)',
    ].join(';')
  )
  appendChildren(bonesPanel, boneList, bonePropPanel)
  layerSidebar.appendChild(bonesPanel)

  const boneLengthRow = createBonePropRow('len', 0.15, 0.01)
  const boneWidthRow = createBonePropRow('wid', 0.06, 0.01)
  appendChildren(bonePropPanel, boneLengthRow.row, boneWidthRow.row)

  const contourMenu = createPopupMenu('112px', 2)
  const addContourPointBtn = createPopupButton(
    localizer.t('editor_polygon_menu_add_point'),
    '11px'
  )
  const removeContourPointBtn = createPopupButton(
    localizer.t('editor_polygon_menu_remove_point'),
    '11px'
  )
  appendChildren(contourMenu, addContourPointBtn, removeContourPointBtn)
  canvasWrap.appendChild(contourMenu)

  const layerMenu = createPopupMenu('96px', 3)
  const renameLayerBtn = createPopupButton(
    localizer.t('editor_body_drawer_layer_rename'),
    '10px'
  )
  const styleLayerBtn = createPopupButton(
    localizer.t('editor_body_drawer_layer_style'),
    '10px'
  )
  const duplicateLayerBtn = createPopupButton(
    localizer.t('editor_body_drawer_layer_duplicate'),
    '10px'
  )
  const deleteLayerBtn = createPopupButton(
    localizer.t('editor_body_drawer_layer_delete'),
    '10px'
  )
  appendChildren(
    layerMenu,
    renameLayerBtn,
    styleLayerBtn,
    duplicateLayerBtn,
    deleteLayerBtn
  )
  form.appendChild(layerMenu)

  sidebar.appendChild(
    createStyledElement(
      'div',
      'font-size:11px;line-height:1.6;color:rgba(255,255,255,0.72);',
      localizer.t('editor_body_drawer_hint')
    )
  )

  const presetWrap = createStyledElement(
    'div',
    'display:flex;flex-direction:column;gap:6px;'
  )
  const presetLabel = createStyledElement(
    'div',
    'font-size:11px;line-height:1;color:rgba(255,255,255,0.78);',
    localizer.t('editor_body_drawer_preset')
  )
  const presetSelect = createPresetSelect()
  appendChildren(presetWrap, presetLabel, presetSelect)
  sidebar.appendChild(presetWrap)

  const modeRow = EditorUIHelper.createButtonRow({
    gap: '8px',
    marginTop: '0',
    justifyContent: 'flex-start',
  })
  modeRow.style.flexWrap = 'wrap'
  modeRow.style.alignItems = 'stretch'
  sidebar.appendChild(modeRow)

  const contourBtn = createModeButton(
    localizer.t('editor_body_drawer_mode_contour'),
    true
  )
  const selectBtn = createModeButton(
    localizer.t('editor_body_drawer_mode_select'),
    true
  )
  const collisionBtn = createModeButton(
    localizer.t('editor_body_drawer_mode_collision'),
    true
  )
  const shapeBtn = createModeButton(
    localizer.t('editor_body_drawer_mode_shape'),
    true
  )
  const fillBtn = createModeButton(localizer.t('editor_body_drawer_mode_fill'))
  const eraseBtn = createModeButton(
    localizer.t('editor_body_drawer_mode_erase')
  )
  const textureBtn = createModeButton(
    localizer.t('editor_body_drawer_mode_texture')
  )
  appendChildren(
    modeRow,
    contourBtn,
    selectBtn,
    collisionBtn,
    shapeBtn,
    fillBtn,
    eraseBtn,
    textureBtn
  )

  const brushRow = EditorUIHelper.createFormRow(
    localizer.t('editor_body_drawer_brush'),
    { labelWidth: '36px', gap: '8px', marginBottom: '0' }
  )
  const brushControls = createStyledElement(
    'div',
    'display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0;'
  )
  const brushSlider = document.createElement('input')
  brushSlider.type = 'range'
  brushSlider.min = String(MIN_BRUSH_SIZE)
  brushSlider.max = String(MAX_BRUSH_SIZE)
  brushSlider.step = '1'
  brushSlider.value = String(DEFAULT_BRUSH_SIZE)
  brushSlider.style.cssText = 'width:60px;max-width:60px;cursor:pointer;'
  const brushValueText = createStyledElement(
    'span',
    'display:inline-block;min-width:24px;font-size:12px;text-align:right;',
    String(DEFAULT_BRUSH_SIZE)
  )
  appendChildren(brushControls, brushSlider, brushValueText)
  brushRow.row.appendChild(brushControls)
  sidebar.appendChild(brushRow.row)

  const colorRow = EditorUIHelper.createFormRow(
    localizer.t('editor_body_drawer_color'),
    { labelWidth: '36px', gap: '8px', marginBottom: '0' }
  )
  const colorInput = EditorUIHelper.createColorInput('#d6a86c')
  colorInput.value =
    options.initialProfile?.color ?? options.initialColor ?? colorInput.value
  colorRow.row.appendChild(colorInput)
  sidebar.appendChild(colorRow.row)

  const bloodColorRow = EditorUIHelper.createFormRow(
    localizer.t('editor_body_drawer_blood_color'),
    { labelWidth: '36px', gap: '8px', marginBottom: '0' }
  )
  const bloodColorInput = EditorUIHelper.createColorInput('#7a1010')
  bloodColorInput.value =
    options.initialProfile?.bloodColor ?? DEFAULT_BODY_BLOOD_COLOR
  bloodColorRow.row.appendChild(bloodColorInput)
  sidebar.appendChild(bloodColorRow.row)

  const actionRow = createStyledElement(
    'div',
    'display:flex;flex-direction:column;gap:8px;'
  )
  const resetStaticBtn = EditorUIHelper.createButton(
    localizer.t('editor_body_drawer_reset_shape')
  )
  const resetSkeletalBtn = EditorUIHelper.createButton(
    localizer.t('editor_body_drawer_reset_skeletal')
  )
  styleCompactButton(resetStaticBtn)
  styleCompactButton(resetSkeletalBtn)
  appendChildren(actionRow, resetStaticBtn, resetSkeletalBtn)
  sidebar.appendChild(actionRow)

  const footer = EditorUIHelper.createButtonRow({
    gap: '12px',
    marginTop: '16px',
  })
  const confirmBtn = EditorUIHelper.createButton(
    localizer.t('editor_btn_confirm'),
    { primary: true }
  )
  const cancelBtn = EditorUIHelper.createButton(
    localizer.t('editor_btn_cancel')
  )
  appendChildren(footer, confirmBtn, cancelBtn)
  form.appendChild(footer)

  const collisionToolMenu = createPopupMenu('96px', 3)
  const collisionCircleBtn = createPopupButton(
    localizer.t('editor_body_drawer_collision_shape_circle'),
    '10px'
  )
  const collisionEllipseBtn = createPopupButton(
    localizer.t('editor_body_drawer_collision_shape_ellipse'),
    '10px'
  )
  const collisionCapsuleBtn = createPopupButton(
    localizer.t('editor_body_drawer_collision_shape_capsule'),
    '10px'
  )
  appendChildren(
    collisionToolMenu,
    collisionCircleBtn,
    collisionEllipseBtn,
    collisionCapsuleBtn
  )
  form.appendChild(collisionToolMenu)

  const collisionShapeMenu = createPopupMenu('96px', 3)
  const deleteCollisionShapeBtn = createPopupButton(
    localizer.t('editor_body_drawer_collision_delete'),
    '10px'
  )
  collisionShapeMenu.appendChild(deleteCollisionShapeBtn)
  form.appendChild(collisionShapeMenu)

  modal.appendChild(form)

  return {
    modal,
    close,
    form,
    canvasWrap,
    drawCanvas,
    cursorEl,
    alertEl,
    zoomSlider,
    zoomValueText,
    tabBtnLayers,
    tabBtnBones,
    layerHeader,
    addLayerBtn,
    layerList,
    bonesPanel,
    boneList,
    bonePropPanel,
    boneLengthRow,
    boneWidthRow,
    contourMenu,
    addContourPointBtn,
    removeContourPointBtn,
    layerMenu,
    renameLayerBtn,
    styleLayerBtn,
    duplicateLayerBtn,
    deleteLayerBtn,
    presetSelect,
    modeRow,
    contourBtn,
    selectBtn,
    collisionBtn,
    shapeBtn,
    fillBtn,
    eraseBtn,
    textureBtn,
    resetStaticBtn,
    resetSkeletalBtn,
    brushSlider,
    brushValueText,
    colorInput,
    bloodColorInput,
    confirmBtn,
    cancelBtn,
    collisionToolMenu,
    collisionCircleBtn,
    collisionEllipseBtn,
    collisionCapsuleBtn,
    collisionShapeMenu,
    deleteCollisionShapeBtn,
  }
}

function createBonePropRow(
  label: string,
  value: number,
  step: number
): EditorBodyDrawerNumberRow {
  const row = createStyledElement(
    'div',
    'display:flex;align-items:center;gap:4px;'
  )
  const lbl = createStyledElement(
    'span',
    'font-size:10px;color:rgba(255,255,255,0.62);min-width:36px;font-family:monospace;',
    label
  )
  const inp = document.createElement('input')
  inp.type = 'number'
  inp.min = String(step)
  inp.max = '2'
  inp.step = String(step)
  inp.value = String(value)
  inp.style.cssText = [
    'width:48px',
    'font-size:10px',
    'font-family:monospace',
    'color:#fff',
    'background:rgba(255,255,255,0.08)',
    'border:1px solid rgba(255,255,255,0.2)',
    'padding:2px 4px',
    'border-radius:2px',
  ].join(';')
  appendChildren(row, lbl, inp)
  return { row, inp }
}

function createPresetSelect(): HTMLSelectElement {
  const presetSelect = EditorUIHelper.createSelect({
    options: [
      {
        value: CUSTOM_BODY_PRESET_ID,
        label: localizer.t('editor_body_drawer_preset_custom'),
      },
      {
        value: 'banana',
        label: localizer.t('editor_body_drawer_preset_banana'),
      },
      {
        value: 'kiwano',
        label: localizer.t('editor_body_drawer_preset_kiwano'),
      },
      {
        value: 'pandaAnt',
        label: localizer.t('editor_body_drawer_preset_panda_ant'),
      },
      {
        value: 'pineapple',
        label: localizer.t('editor_body_drawer_preset_pineapple'),
      },
      {
        value: 'tomato',
        label: localizer.t('editor_body_drawer_preset_tomato'),
      },
      {
        value: 'watermelon',
        label: localizer.t('editor_body_drawer_preset_watermelon'),
      },
    ],
    selected: CUSTOM_BODY_PRESET_ID,
    width: '100%',
  })
  presetSelect.style.flex = '1 1 auto'
  presetSelect.style.width = '100%'
  presetSelect.style.background = 'rgba(255,255,255,0.08)'
  presetSelect.style.borderColor = 'rgba(255,255,255,0.18)'
  presetSelect.style.color = 'rgba(255,255,255,0.92)'
  presetSelect.style.padding = '6px 8px'
  presetSelect.style.fontSize = '11px'
  return presetSelect
}

function createModeButton(label: string, primary = false): HTMLButtonElement {
  const button = EditorUIHelper.createButton(label, { primary })
  styleDrawerModeButton(button)
  return button
}
