import { createCatalogCache, type CatalogCache } from './catalog-api.ts'
import { translate, type UltraSlashKey, type UiLocale } from '../../shared/ultra-slash/locales.ts'

export type SlashTranslate = (key: string, vars?: Record<string, string | number>) => string

interface SlashI18n {
  locale: UiLocale
  t: SlashTranslate
}

function fallbackT(key: string, vars?: Record<string, string | number>): string {
  return translate('zh', key as UltraSlashKey, vars)
}

let cache: CatalogCache | undefined
let i18n: SlashI18n = { locale: 'zh', t: fallbackT }
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getSlashCache(): CatalogCache {
  cache ??= createCatalogCache()
  return cache
}

export function getSlashI18n(): SlashI18n {
  return i18n
}

export function subscribeSlashI18n(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setSlashI18n(next: SlashI18n): void {
  i18n = next
  emit()
}
