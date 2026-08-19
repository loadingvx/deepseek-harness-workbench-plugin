/**
 * 提示音设置：选择内置提示音 或 上传自定义音频文件。
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { BUILTIN_SOUNDS } from '../../shared/workbench-sounds/builtins.ts'
import { MAX_SOUND_UPLOAD_BYTES } from '../../shared/workbench-sounds/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconPlay, IconVolume } from './icons.tsx'
import { uiLocaleFromTranslate, type Translate } from './types.ts'
import { playBuiltinSound, playCustomSound } from './useSessionMonitor.ts'
import css from './SoundSettings.module.css'

const SOUNDS_HTTP_PREFIX = '/workbench-sounds'
const PREF_KEY = 'dsh-workbench-sound-id'

interface CustomSound {
  id: string
  name: string
  nameZh: string
  filename: string
  playUrl: string
}

interface SoundOption {
  id: string
  label: string
  kind: 'builtin' | 'custom'
  desc: string
}

export interface SoundSettingsProps {
  t: Translate
}

function builtinSoundKey(id: string, field: 'name' | 'desc'): string {
  return `sessions.sound.builtin.${id}.${field}`
}

function mapUploadError(message: string, t: Translate): string {
  const trimmed = message.trim()
  if (trimmed === '') return t('sessions.soundUploadFail')
  if (/unsupported audio format/i.test(trimmed)) return t('sessions.soundUploadUnsupported')
  if (/file too large/i.test(trimmed)) {
    return t('sessions.soundUploadTooLarge', { max: Math.round(MAX_SOUND_UPLOAD_BYTES / 1024 / 1024) })
  }
  if (/empty file/i.test(trimmed)) return t('sessions.soundUploadEmpty')
  if (/expected multipart|no file found/i.test(trimmed)) return t('sessions.soundUploadFail')
  return t('sessions.soundUploadFail')
}

export function SoundSettings({ t }: SoundSettingsProps) {
  const lang = uiLocaleFromTranslate(t)
  const [selectedId, setSelectedId] = useState<string>(() => {
    try { return localStorage.getItem(PREF_KEY) ?? 'chime-ascending' } catch { return 'chime-ascending' }
  })
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>('')
  const acRef = useRef<{ ac: AudioContext | null }>({ ac: null })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`${SOUNDS_HTTP_PREFIX}/`)
      .then(r => r.json())
      .then((data: { ok: boolean; index?: { custom: CustomSound[] } }) => {
        if (data.ok && data.index?.custom) {
          setCustomSounds(data.index.custom.map((s: CustomSound) => ({
            ...s,
            playUrl: `${SOUNDS_HTTP_PREFIX}/${s.id}`,
          })))
        }
      })
      .catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDropdown])

  const allSounds: SoundOption[] = [
    ...BUILTIN_SOUNDS.map(s => ({
      id: s.id,
      label: t(builtinSoundKey(s.id, 'name')),
      kind: 'builtin' as const,
      desc: t(builtinSoundKey(s.id, 'desc')),
    })),
    ...customSounds.map(s => ({
      id: s.id,
      label: lang === 'zh' ? s.nameZh : s.name,
      kind: 'custom' as const,
      desc: s.filename,
    })),
  ]

  const selectedSound = allSounds.find(s => s.id === selectedId) ?? allSounds[0]
  const pickerLabel = selectedSound !== undefined
    ? `${selectedSound.label} — ${selectedSound.desc}`
    : t('sessions.soundSelect')

  const savePref = (id: string) => {
    try { localStorage.setItem(PREF_KEY, id) } catch { /* ignore */ }
    setSelectedId(id)
  }

  const previewSound = (id: string, event?: ReactMouseEvent): void => {
    event?.stopPropagation()
    const builtin = BUILTIN_SOUNDS.find(s => s.id === id)
    if (builtin) {
      playBuiltinSound(builtin, acRef)
      return
    }
    const custom = customSounds.find(s => s.id === id)
    if (custom) {
      playCustomSound(custom.playUrl)
    }
  }

  const handleSelect = (id: string) => {
    savePref(id)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadStatus(t('sessions.soundUploading'))

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`${SOUNDS_HTTP_PREFIX}/`, { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; entry?: CustomSound; message?: string }
      if (data.ok && data.entry) {
        const newSound: CustomSound = {
          ...data.entry,
          playUrl: `${SOUNDS_HTTP_PREFIX}/${data.entry.id}`,
        }
        setCustomSounds(prev => [...prev.filter(s => s.id !== newSound.id), newSound])
        savePref(newSound.id)
        setUploadStatus(t('sessions.soundUploadOk'))
        setShowUpload(false)
      } else {
        setUploadStatus(mapUploadError(data.message ?? '', t))
      }
    } catch {
      setUploadStatus(t('sessions.soundUploadFail'))
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDelete = async (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`${SOUNDS_HTTP_PREFIX}/${id}`, { method: 'DELETE' })
      setCustomSounds(prev => prev.filter(s => s.id !== id))
      if (selectedId === id) {
        savePref('chime-ascending')
      }
    } catch { /* ignore */ }
  }

  return (
    <div className={css.root}>
      <div className={css.soundPicker} ref={dropdownRef}>
        <IconButton
          dense
          label={pickerLabel}
          active={showDropdown}
          className={css.soundBtn}
          onClick={() => { setShowDropdown(!showDropdown); setShowUpload(false) }}
          title={pickerLabel}
        >
          <IconVolume />
        </IconButton>
        {showDropdown && (
          <div className={css.dropdown}>
            <div className={css.dropdownHeader}>
              <span>{t('sessions.soundSelect')}</span>
              <button
                type="button"
                className={css.uploadBtn}
                onClick={() => { setShowUpload(true); setShowDropdown(false) }}
              >
                + {t('sessions.soundUpload')}
              </button>
            </div>
            <div className={css.soundList}>
              {allSounds.map(sound => (
                <div
                  key={sound.id}
                  className={`${css.soundItem}${sound.id === selectedId ? ` ${css.selected}` : ''}`}
                  onClick={() => { handleSelect(sound.id) }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={sound.id === selectedId}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleSelect(sound.id)
                    }
                  }}
                >
                  <div className={css.soundMain}>
                    <span className={css.soundLabel}>{sound.label}</span>
                    <span className={css.soundDesc}>{sound.desc}</span>
                  </div>
                  <div className={css.soundActions}>
                    <IconButton
                      dense
                      className={css.playBtn}
                      label={t('sessions.soundPreview')}
                      title={t('sessions.soundPreview')}
                      onClick={(event) => { previewSound(sound.id, event) }}
                    >
                      <IconPlay />
                    </IconButton>
                    {sound.kind === 'custom' ? (
                      <button
                        type="button"
                        className={css.deleteBtn}
                        onClick={(e) => handleDelete(sound.id, e)}
                        title={t('sessions.soundDelete')}
                        aria-label={t('sessions.soundDelete')}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showUpload && (
        <div className={css.uploadPanel}>
          <div className={css.uploadHeader}>
            <span>{t('sessions.soundUploadPanel')}</span>
            <button
              type="button"
              className={css.closeBtn}
              onClick={() => setShowUpload(false)}
              aria-label={t('sessions.soundClose')}
            >
              ×
            </button>
          </div>
          <div className={css.uploadBody}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ogg,.mp3,.wav,.webm,.m4a,.flac"
              className={css.fileInput}
              onChange={handleFileChange}
            />
            <span className={css.uploadHint}>{t('sessions.soundUploadHint')}</span>
            {uploadStatus !== '' ? <span className={css.uploadStatus}>{uploadStatus}</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}
