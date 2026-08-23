import { Icon } from './icons.tsx'

export type FileGlyph = 'folder' | 'folderOpen' | 'file' | 'ts' | 'js' | 'json' | 'md' | 'css' | 'html' | 'img' | 'code' | 'cfg'

const EXT_GLYPH: Record<string, FileGlyph> = {
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.jsonc': 'json',
  '.md': 'md',
  '.mdx': 'md',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'img',
  '.png': 'img',
  '.jpg': 'img',
  '.jpeg': 'img',
  '.gif': 'img',
  '.webp': 'img',
  '.ico': 'img',
  '.py': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.kt': 'code',
  '.c': 'code',
  '.h': 'code',
  '.cpp': 'code',
  '.vue': 'code',
  '.svelte': 'code',
  '.yml': 'cfg',
  '.yaml': 'cfg',
  '.toml': 'cfg',
  '.ini': 'cfg',
  '.env': 'cfg',
  '.xml': 'cfg',
}

export function fileGlyph(kind: 'file' | 'directory', name: string, open = false): FileGlyph {
  if (kind === 'directory') return open ? 'folderOpen' : 'folder'
  const dot = name.lastIndexOf('.')
  if (dot <= 0) {
    const lower = name.toLowerCase()
    if (lower === 'dockerfile' || lower === 'makefile') return 'cfg'
    return 'file'
  }
  return EXT_GLYPH[name.slice(dot).toLowerCase()] ?? 'file'
}

function FolderGlyph({ open }: { open: boolean }) {
  if (open) {
    return (
      <path
        d="M1.8 4.2h4.1l1.2 1.3H14.2v6.8H1.8zM2.4 7.2h11.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    )
  }
  return (
    <path
      d="M1.8 3.6h4.2l1.2 1.4H14.2v7.4H1.8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  )
}

function DocGlyph() {
  return (
    <>
      <path d="M4 2.4h5.2L12.2 5.4V13.6H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.1 2.5V5.5h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </>
  )
}

/** Compact type glyph for explorer rows. Color comes from `data-kind` CSS. */
export function FileKindIcon({ kind, name, open = false }: { kind: 'file' | 'directory'; name: string; open?: boolean }) {
  const glyph = fileGlyph(kind, name, open)
  return (
    <span data-kind={glyph} aria-hidden>
      <Icon size={14}>
        {glyph === 'folder' || glyph === 'folderOpen' ? <FolderGlyph open={glyph === 'folderOpen'} /> : <DocGlyph />}
      </Icon>
    </span>
  )
}
