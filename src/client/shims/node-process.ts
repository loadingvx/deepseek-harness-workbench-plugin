/** Browser stub so a leaked `node:process` import cannot break DSH ModuleLoader. */
export const cwd = (): string => '/'
export const env: Record<string, string | undefined> = {}
const processShim = { cwd, env, versions: { node: '' } }
export default processShim
