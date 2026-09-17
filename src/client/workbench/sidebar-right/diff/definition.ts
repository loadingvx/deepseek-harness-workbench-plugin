import type { Translate } from '../../types.ts'
import { gitDiffFileName, parseGitDiffAddress } from './address.ts'
import { WORKBENCH_DIFF_ID, WORKBENCH_DIFF_KIND } from '../ids.ts'

export type GitDiffTabDefinition = {
  id: string
  kind: string
  patterns: readonly string[]
  priority: 'extension'
  canOpen: (address: string) => boolean
  title: (address: string) => string
}

export function gitDiffTabDefinition(t: Translate): GitDiffTabDefinition {
  return {
    id: WORKBENCH_DIFF_ID,
    kind: WORKBENCH_DIFF_KIND,
    patterns: ['dsh-resource://git-diff/**', 'dsh-resource://git-diff/**/.**'],
    priority: 'extension',
    canOpen: (address) => parseGitDiffAddress(address) !== null,
    title: (address) => {
      const parsed = parseGitDiffAddress(address)
      if (parsed === null) return t('editor.diffTab')
      const name = gitDiffFileName(parsed.path)
      return parsed.hash !== undefined
        ? `${name} · ${t('editor.commitDiffTab')}`
        : `${name} · ${t('editor.diffTab')}`
    },
  }
}
