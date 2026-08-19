/**
 * 提示音设置：选择内置提示音 或 上传自定义音频文件。
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { BUILTIN_SOUNDS } from '../../shared/workbench-sounds/builtins.ts'
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
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Language code: 'zh' | 'en' */
  lang?: 'zh' | 'en'
}

export function SoundSettings({ t, lang = 'zh' }: SoundSettingsProps) {
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

  // Load custom sounds on mount
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

  // Close dropdown on outside click
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
      label: lang === 'zh' ? s.nameZh : s.name,
      kind: 'builtin' as const,
      desc: lang === 'zh' ? s.descriptionZh : s.description,
    })),
    ...customSounds.map(s => ({
      id: s.id,
      label: lang === 'zh' ? s.nameZh : s.name,
      kind: 'custom' as const,
      desc: s.filename,
    })),
  ]

  const selectedSound = allSounds.find(s => s.id === selectedId) ?? allSounds[0]

  const savePref = (id: string) => {
    try { localStorage.setItem(PREF_KEY, id) } catch { /* ignore */ }
    setSelectedId(id)
  }

  const preview = () => {
    const builtin = BUILTIN_SOUNDS.find(s => s.id === selectedId)
    if (builtin) {
      playBuiltinSound(builtin, acRef)
    } else {
      const custom = customSounds.find(s => s.id === selectedId)
      if (custom) {
        playCustomSound(custom.playUrl)
      }
    }
  }

  const handleSelect = (id: string) => {
    savePref(id)
    setShowDropdown(false)
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
        setUploadStatus(data.message ?? t('sessions.soundUploadFail'))
      }
    } catch {
      setUploadStatus(t('sessions.soundUploadFail'))
    }

    // Reset file input
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
        <button
          type="button"
          className={css.soundBtn}
          onClick={() => { setShowDropdown(!showDropdown); setShowUpload(false) }}
          title={selectedSound.desc}
        >
          🔊
        </button>
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
                  onClick={() => handleSelect(sound.id)}
                >
                  <span className={css.soundLabel}>{sound.label}</span>
                  <span className={css.soundDesc}>{sound.desc}</span>
                  {sound.kind === 'custom' && (
                    <button
                      type="button"
                      className={css.deleteBtn}
                      onClick={(e) => handleDelete(sound.id, e)}
                      title={t('sessions.soundDelete')}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className={css.dropdownFooter}>
              <button type="button" className={css.previewBtn} onClick={preview}>
                ▶ {t('sessions.soundPreview')}
              </button>
            </div>
          </div>
        )}
      </div>

      {showUpload && (
        <div className={css.uploadPanel}>
          <div className={css.uploadHeader}>
            <span>{t('sessions.soundUpload')}</span>
            <button type="button" className={css.closeBtn} onClick={() => setShowUpload(false)}>×</button>
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
            {uploadStatus && <span className={css.uploadStatus}>{uploadStatus}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
