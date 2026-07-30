import {
  Language,
  getInitialLanguage,
  localizer,
  saveLanguagePreference,
} from '../Localizer'
import { MapImportExportPanel } from '../MapImportExportPanel'
import { enPageTranslations } from './pageTranslations/en'
import {
  type PageTranslationKey,
  type PageTranslations,
  zhHansPageTranslations,
} from './pageTranslations/zh-Hans'

const PAGE_TRANSLATIONS: Record<Language, PageTranslations> = {
  [Language.ZhHans]: zhHansPageTranslations,
  [Language.En]: enPageTranslations,
}

const LANGUAGE_LABEL_KEYS: Record<Language, PageTranslationKey> = {
  [Language.ZhHans]: 'language_zh_hans',
  [Language.En]: 'language_en',
}

export class PageLocalizer {
  private currentLanguage = getInitialLanguage()

  init(): void {
    const languageSelect = document.getElementById('pageLanguageSelect')
    if (languageSelect instanceof HTMLSelectElement) {
      for (const language of Object.values(Language)) {
        const option = document.createElement('option')
        option.value = language
        option.dataset.pageI18n = LANGUAGE_LABEL_KEYS[language]
        languageSelect.appendChild(option)
      }
      languageSelect.value = this.currentLanguage
      languageSelect.addEventListener('change', () => {
        const nextLang =
          languageSelect.value === Language.ZhHans
            ? Language.ZhHans
            : Language.En
        this.currentLanguage = nextLang
        saveLanguagePreference(nextLang)
        this.applyTranslations()
        void localizer.setLanguage(nextLang)
      })
    }

    this.applyTranslations()

    localizer.onLanguageChange((lang) => {
      if (this.currentLanguage !== lang) {
        this.currentLanguage = lang
        if (languageSelect instanceof HTMLSelectElement) {
          languageSelect.value = lang
        }
        this.applyTranslations()
      }
    })

    const mapPanel = document.getElementById('mapPanel')
    if (mapPanel) {
      new MapImportExportPanel(mapPanel, (key) => this.t(key))
    }
  }

  t(key: PageTranslationKey): string {
    return PAGE_TRANSLATIONS[this.currentLanguage][key]
  }

  private applyTranslations(): void {
    document.documentElement.lang = this.currentLanguage

    const textElements =
      document.querySelectorAll<HTMLElement>('[data-page-i18n]')
    textElements.forEach((element) => {
      const key = element.dataset.pageI18n as PageTranslationKey | undefined
      if (key) {
        element.textContent = this.t(key)
      }
    })

    const titleElements = document.querySelectorAll<HTMLElement>(
      '[data-page-i18n-title]'
    )
    titleElements.forEach((element) => {
      const key = element.dataset.pageI18nTitle as
        | PageTranslationKey
        | undefined
      if (!key) {
        return
      }
      const parameterKey = element.dataset.pageI18nTitleParameter as
        | PageTranslationKey
        | undefined
      const title = this.t(key)
      element.title = parameterKey
        ? title.replace('{0}', this.t(parameterKey))
        : title
    })
  }
}
