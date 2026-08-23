import { GitError } from '../shared/errors.ts'

/** One-at-a-time lock so overlapping Git writes cannot corrupt the index. */
export class GitMutex {
  private busy = false

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new GitError('BUSY')
    this.busy = true
    try {
      return await fn()
    } finally {
      this.busy = false
    }
  }
}
