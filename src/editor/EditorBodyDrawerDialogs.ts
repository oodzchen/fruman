import { localizer } from '../Localizer'
import type {
  MapCharacterBodyBrowStyle,
  MapCharacterBodyEyeStyle,
} from '../editorMapTypes'
import type { EditorBodyLayer } from './EditorBodyDrawerTypes'
import { EditorUIHelper } from './EditorUIHelper'

export async function confirmDeleteBodyDrawerLayer(
  viewport: HTMLElement,
  layerName: string
): Promise<boolean> {
  return await new Promise((resolve) => {
    const { modal, close } = EditorUIHelper.createModal({ zIndex: 10003 })
    const form = EditorUIHelper.createFormContainer({
      minWidth: '280px',
    })
    form.style.minWidth = '280px'
    form.style.padding = '16px'
    form.style.gap = '12px'

    const title = EditorUIHelper.createFormTitle(
      localizer.t('editor_body_drawer_layer_delete')
    )
    title.style.marginBottom = '8px'

    const text = document.createElement('div')
    text.textContent = localizer
      .t('editor_body_drawer_layer_delete_confirm')
      .replace('{name}', layerName)
    text.style.cssText =
      'font-size:11px;line-height:1.5;color:rgba(255,255,255,0.84);'

    const footer = EditorUIHelper.createButtonRow({
      gap: '8px',
      marginTop: '0',
    })
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    footer.appendChild(confirmBtn)
    footer.appendChild(cancelBtn)
    form.appendChild(title)
    form.appendChild(text)
    form.appendChild(footer)
    modal.appendChild(form)
    viewport.appendChild(modal)

    confirmBtn.addEventListener('click', () => {
      close()
      resolve(true)
    })
    cancelBtn.addEventListener('click', () => {
      close()
      resolve(false)
    })
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        close()
        resolve(false)
      }
    })
  })
}

export async function chooseBodyDrawerLayerStyle(
  viewport: HTMLElement,
  layer: EditorBodyLayer,
  selectedEyeStyle: MapCharacterBodyEyeStyle,
  selectedBrowStyle: MapCharacterBodyBrowStyle
): Promise<MapCharacterBodyEyeStyle | MapCharacterBodyBrowStyle | null> {
  return await new Promise((resolve) => {
    const { modal, close } = EditorUIHelper.createModal({ zIndex: 10003 })
    const form = EditorUIHelper.createFormContainer({
      minWidth: '280px',
    })
    form.style.minWidth = '280px'
    form.style.padding = '16px'
    form.style.gap = '10px'

    const title = EditorUIHelper.createFormTitle(
      localizer.t('editor_body_drawer_layer_style')
    )
    title.style.marginBottom = '4px'

    const select = EditorUIHelper.createSelect({
      options: getStyleOptions(layer),
      selected: layer.kind === 'eye' ? selectedEyeStyle : selectedBrowStyle,
      width: '100%',
    })

    const footer = EditorUIHelper.createButtonRow({
      gap: '8px',
      marginTop: '4px',
    })
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    footer.appendChild(confirmBtn)
    footer.appendChild(cancelBtn)
    form.appendChild(title)
    form.appendChild(select)
    form.appendChild(footer)
    modal.appendChild(form)
    viewport.appendChild(modal)

    confirmBtn.addEventListener('click', () => {
      const nextValue = select.value as
        | MapCharacterBodyEyeStyle
        | MapCharacterBodyBrowStyle
      close()
      resolve(nextValue)
    })
    cancelBtn.addEventListener('click', () => {
      close()
      resolve(null)
    })
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        close()
        resolve(null)
      }
    })
  })
}

function getStyleOptions(
  layer: EditorBodyLayer
): Array<{ value: string; label: string }> {
  if (layer.kind === 'eye') {
    return [
      {
        value: 'standard',
        label: localizer.t('editor_body_drawer_style_eye_standard'),
      },
      {
        value: 'noOutline',
        label: localizer.t('editor_body_drawer_style_eye_no_outline'),
      },
      {
        value: 'pupilOnly',
        label: localizer.t('editor_body_drawer_style_eye_pupil_only'),
      },
      {
        value: 'cute',
        label: localizer.t('editor_body_drawer_style_eye_cute'),
      },
      {
        value: 'transparent',
        label: localizer.t('editor_body_drawer_style_eye_transparent'),
      },
    ]
  }
  return [
    {
      value: 'none',
      label: localizer.t('editor_body_drawer_style_brow_none'),
    },
    {
      value: 'thick',
      label: localizer.t('editor_body_drawer_style_brow_thick'),
    },
    {
      value: 'thin',
      label: localizer.t('editor_body_drawer_style_brow_thin'),
    },
    {
      value: 'straight',
      label: localizer.t('editor_body_drawer_style_brow_straight'),
    },
  ]
}
