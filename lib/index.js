import { createRequire } from "node:module";
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/shared/redact.ts
/** 展示用脱敏：URL、主机名、路径保留；token / 密码只留头尾。 */
const SENSITIVE_QUERY = /([?&](?:access_token|api[_-]?key|auth(?:orization)?|jwt|password|secret|session|token)=)([^&#\s]+)/gi;
const BEARER = /\b(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi;
const KNOWN_TOKEN = /\b((?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|npm|sk|xox[baprs])[_-])([A-Za-z0-9_-]{8,})/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi;
function maskSecret(value) {
	if (value.length <= 6) return "***";
	return `${value.slice(0, 3)}***${value.slice(-2)}`;
}
function maskUserInfo(userInfo) {
	const colon = userInfo.indexOf(":");
	if (colon === -1) return looksLikeToken(userInfo) ? maskSecret(userInfo) : userInfo;
	const user = userInfo.slice(0, colon);
	const secret = userInfo.slice(colon + 1);
	if (secret === "") return userInfo;
	return `${user}:${maskSecret(secret)}`;
}
function looksLikeToken(value) {
	if (value.length < 16) return false;
	if (/^[0-9a-f]{7,40}$/i.test(value)) return false;
	return /^[A-Za-z0-9._~+/-]+=*$/.test(value);
}
/** 给即将展示给用户或写入错误条的文本做脱敏。可重复调用。 */
function redactSecrets(raw) {
	let text = raw;
	text = text.replace(URL_USERINFO, (_all, protocol, userInfo) => {
		return `${protocol}${maskUserInfo(userInfo)}@`;
	});
	text = text.replace(SENSITIVE_QUERY, (_all, prefix, value) => `${prefix}${maskSecret(value)}`);
	text = text.replace(BEARER, (_all, prefix, value) => `${prefix}${maskSecret(value)}`);
	text = text.replace(KNOWN_TOKEN, (_all, prefix, rest) => `${prefix}${maskSecret(rest)}`);
	return text;
}
//#endregion
//#region src/shared/errors.ts
const COPY = {
	GIT_NOT_FOUND: {
		messageZh: "本机没有可用的 git 命令。",
		hintZh: "请先安装 Git，并确认终端里执行 `git --version` 能成功。Debian/Ubuntu 可用 `sudo apt install git`。"
	},
	NOT_A_REPO: {
		messageZh: "当前工作区还不是 Git 仓库。",
		hintZh: "请在右侧「源代码管理」里初始化仓库，或打开一个已经是仓库的文件夹。不会自动执行 git init。"
	},
	NO_WORKSPACE: {
		messageZh: "还没有选中工作区。",
		hintZh: "请先在左侧打开或创建一个工作区，再使用 Git。"
	},
	UNKNOWN_WORKSPACE: {
		messageZh: "找不到这个工作区。",
		hintZh: "工作区可能已被删除。请刷新页面，或重新选择一个本地目录。"
	},
	UNKNOWN_REPO: {
		messageZh: "找不到这个 Git 仓库。",
		hintZh: "只能选当前目录、已纳入的上一级，或当前目录下的仓库、软链和子模块。请从列表里重新选。"
	},
	EMPTY_MESSAGE: {
		messageZh: "提交说明不能为空。",
		hintZh: "请用一两句话写清楚这次改了什么，然后再提交。"
	},
	NOTHING_STAGED: {
		messageZh: "没有已暂存的文件，无法提交。",
		hintZh: "请先勾选要提交的文件（暂存），确认右侧 diff 无误后再提交。"
	},
	INDEX_LOCKED: {
		messageZh: "Git 正被其他进程占用（存在 index.lock）。",
		hintZh: "请等当前 Git 操作结束。若确认没有其他 Git 窗口，再检查仓库里的 `.git/index.lock`。"
	},
	DIRTY_WORKTREE: {
		messageZh: "工作区还有未提交的改动。",
		hintZh: "请先提交或处理这些文件，再切换分支、拉取或推送，以免改动丢失。"
	},
	BUSY: {
		messageZh: "上一次 Git 操作还在进行。",
		hintZh: "请稍等当前操作完成，不要连续点击。"
	},
	BRANCH_MISSING: {
		messageZh: "本地没有这个分支。",
		hintZh: "请从列表里选一个已经存在的本地分支。要新建，请用 GRAPH 栏的「新建分支」。"
	},
	BRANCH_EXISTS: {
		messageZh: "这个分支名已经有了。",
		hintZh: "请换一个名字，或先切到已有分支再继续。"
	},
	BRANCH_INVALID: {
		messageZh: "分支名不合法。",
		hintZh: "不要用空格、..、~ ^ : ? * [ \\，也不要以 - / . 开头或以 / . 结尾。最长 64 个字符。"
	},
	MERGE_CONFLICT: {
		messageZh: "合并时出现冲突，已自动取消，工作区保持原样。",
		hintZh: "两边改了同一处。请在终端里手动处理，或先和同事对齐后再拉取。本插件不会留下半成品合并。"
	},
	IDENTITY_MISSING: {
		messageZh: "还没有配置 Git 用户信息，无法提交。",
		hintZh: "请填写姓名和邮箱。新仓库可以在初始化时填写；已有仓库可在终端执行：\ngit config --global user.name \"你的名字\"\ngit config --global user.email \"you@example.com\""
	},
	IDENTITY_INVALID: {
		messageZh: "姓名或邮箱格式不正确。",
		hintZh: "姓名不能为空，也不能包含换行。邮箱必须包含 @，例如 you@company.com。"
	},
	INVALID_PATH: {
		messageZh: "文件路径不合法。",
		hintZh: "只能操作当前仓库内的相对路径，不能使用 .. 或仓库外的绝对路径。"
	},
	NETWORK: {
		messageZh: "无法连接工作台服务。",
		hintZh: "请确认 DeepSeek Harness 网页仍在运行，然后点击右上角刷新。"
	},
	BAD_REQUEST: {
		messageZh: "请求参数不完整。",
		hintZh: "请刷新页面后重试。若仍然失败，请重新打开工作区。"
	},
	GIT_FAILED: {
		messageZh: "Git 命令执行失败。",
		hintZh: "请查看详细原因。常见情况：合并进行中、钩子拒绝、或仓库状态异常。"
	},
	FS_NOT_FOUND: {
		messageZh: "找不到这个文件或文件夹。",
		hintZh: "它可能已被删除或移动。请在左侧目录里重新点开，或点刷新。"
	},
	FS_IS_DIRECTORY: {
		messageZh: "这是一个文件夹，不能当文件打开。",
		hintZh: "请在目录树里展开它，再点里面的文件。"
	},
	FS_TOO_LARGE: {
		messageZh: "文件超过 1.5 MB，编辑器不会打开。",
		hintZh: "太大的文件会把浏览器卡死。请用本机编辑器打开，或换一个更小的文件。"
	},
	FS_BINARY: {
		messageZh: "这是二进制文件，无法在文本编辑器中打开。",
		hintZh: "图片、压缩包、字体等请用本机应用打开。工作台只编辑文本文件。"
	},
	FS_WRITE_FAILED: {
		messageZh: "无法保存这个文件。",
		hintZh: "请确认文件不是只读、磁盘还有空间，然后重试。"
	},
	FS_EXISTS: {
		messageZh: "这个名字已经有人用了。",
		hintZh: "换一个名字，或先把同名文件处理掉再试。"
	},
	FS_RENAME_FAILED: {
		messageZh: "无法重命名或移动这个文件。",
		hintZh: "请确认目标位置可以写入、源文件没有被占用，然后重试。"
	},
	FS_DELETE_FAILED: {
		messageZh: "无法删除这个文件。",
		hintZh: "请确认文件没有被占用，或没有权限限制，然后重试。"
	},
	FS_MKDIR_FAILED: {
		messageZh: "无法创建这个文件夹。",
		hintZh: "请确认上层目录可以写入、磁盘还有空间，然后重试。"
	},
	FS_COPY_FAILED: {
		messageZh: "无法复制这个文件。",
		hintZh: "请确认目标位置可以写入、源文件还在，然后重试。"
	},
	FS_REVEAL_FAILED: {
		messageZh: "没法打开系统文件管理器。",
		hintZh: "请确认本机访达 / 资源管理器 / 文件管理器能正常打开，然后重试。"
	},
	LLM_UNAVAILABLE: {
		messageZh: "现在没法调用模型。",
		hintZh: "请确认会话里已经配好可用模型。这次调用不会写入当前对话。也可以先自己动手完成。"
	},
	LLM_FAILED: {
		messageZh: "模型调用失败。",
		hintZh: "请稍后重试。常见原因：模型未就绪、网络中断、思考占用了输出、或内容太长。"
	},
	NOTHING_TO_DESCRIBE: {
		messageZh: "没有可描述的改动。",
		hintZh: "请先修改或暂存文件，再点自动生成。工作区是干净的时候无法生成提交说明。"
	},
	NO_REMOTE: {
		messageZh: "这个仓库还没有配置远程地址。",
		hintZh: "请先添加远程，例如：git remote add origin <仓库地址>。没有远程时不能推送或拉取。"
	},
	NO_UPSTREAM: {
		messageZh: "当前分支还没有对应的远端分支。",
		hintZh: "第一次推送会自动设置跟踪。若要拉取，请先推送一次，或确认远程已有同名分支。"
	},
	NOTHING_TO_PUSH: {
		messageZh: "没有需要推送的新提交。",
		hintZh: "本地已经和远端同步，或还没有任何提交。提交之后才会出现推送按钮。"
	},
	NOTHING_TO_PULL: {
		messageZh: "远端没有可拉取的新提交。",
		hintZh: "当前分支没有落后远端。只有远端有更新时才会出现拉取按钮。"
	},
	REMOTE_AHEAD: {
		messageZh: "远端有新提交，不能直接推送。",
		hintZh: "请先点「拉取」，把远端更新接到本地，确认没有冲突后再推送。"
	},
	DIVERGED: {
		messageZh: "本地和远端都有对方没有的提交，当前拉取方式无法接入。",
		hintZh: "请在齿轮设置里把拉取改为「合并」（git pull --no-rebase），或在终端处理分叉后再试。"
	},
	AUTH_FAILED: {
		messageZh: "远程仓库拒绝了身份验证。",
		hintZh: "请检查 SSH 密钥或 HTTPS 凭据是否有效。本插件不会弹出密码框，需要本机已经配置好认证。"
	},
	REMOTE_UNREACHABLE: {
		messageZh: "连不上远程仓库。",
		hintZh: "请检查网络、远程地址，以及本机能否访问该 Git 服务，然后重试。"
	},
	DETACHED_HEAD: {
		messageZh: "当前处于分离 HEAD，不能推送或拉取。",
		hintZh: "请先切换到一个普通分支，再同步远端。"
	},
	EDITOR_NOT_FOUND: {
		messageZh: "本机没有找到可用的外部编辑器。",
		hintZh: "请先安装 Cursor 或 VS Code，并确认终端里能执行 `cursor` 或 `code`。装好后点右上角三角重新选择。"
	},
	EDITOR_FAILED: {
		messageZh: "外部编辑器没有打开成功。",
		hintZh: "请确认这个软件还能启动。也可以点三角换一个本机应用再试。"
	},
	EDITOR_UNKNOWN: {
		messageZh: "不支持用这个应用打开。",
		hintZh: "请从列表里选 Cursor、VS Code 或系统默认应用。不会执行列表以外的命令。"
	},
	TERM_NO_SHELL: {
		messageZh: "本机没有可用的命令行程序。",
		hintZh: "请确认系统里有 bash 或 zsh，并且终端里能执行 `bash`。"
	},
	TERM_FAILED: {
		messageZh: "工作区命令行没有启动成功。",
		hintZh: "请确认已经打开本地工作区，然后点「重新连接」。若反复失败，请确认本机有 bash/zsh，并且 DeepSeek Harness 能创建伪终端。"
	}
};
/** Structured Git failure with Chinese copy the UI can show as-is. */
var GitError = class extends Error {
	code;
	messageZh;
	hintZh;
	constructor(code, detail) {
		const copy = COPY[code];
		const safe = detail === void 0 ? void 0 : redactSecrets(detail);
		const messageZh = safe && (code === "GIT_FAILED" || code === "LLM_FAILED") ? `${copy.messageZh} ${safe}` : copy.messageZh;
		super(`${code}: ${messageZh}`);
		this.name = "GitError";
		this.code = code;
		this.messageZh = messageZh;
		this.hintZh = copy.hintZh;
	}
	toFail() {
		return {
			ok: false,
			code: this.code,
			messageZh: this.messageZh,
			hintZh: this.hintZh
		};
	}
};
function fail(code, detail) {
	return new GitError(code, detail).toFail();
}
function toFail(error) {
	if (error instanceof GitError) return error.toFail();
	if (error instanceof Error && error.message.includes("index.lock")) return fail("INDEX_LOCKED");
	if (error instanceof Error && /without inject|llm/i.test(error.message)) return fail("LLM_UNAVAILABLE");
	return fail("GIT_FAILED", error instanceof Error ? error.message : String(error));
}
//#endregion
//#region src/shared/branch-name.ts
/** Reject names that git would refuse or that look like flags / path tricks. */
function invalidBranchName(raw) {
	const name = raw.trim();
	if (name === "") return "empty";
	if (name.length > 64) return "invalid";
	if (name === "HEAD" || name === "@") return "invalid";
	if (/^[./-]/.test(name)) return "invalid";
	if (/[./]$/.test(name) || name.endsWith(".lock")) return "invalid";
	if (name.includes("..") || name.includes("//") || name.includes("@{")) return "invalid";
	if (/[\s~^:?*[\\]/.test(name)) return "invalid";
	return null;
}
function normalizeBranchName(raw) {
	return raw.trim();
}
function normalizeFileFilter(raw) {
	return raw.trim().slice(0, 80);
}
/** `.ts` / `*.tsx` 当成扩展名；其余按文件名或路径包含匹配（不走正则）。 */
function entryMatchesFilter(name, path, query) {
	const q = normalizeFileFilter(query).toLowerCase();
	if (q === "") return false;
	const nameL = name.toLowerCase();
	const pathL = path.toLowerCase();
	if (q.startsWith("*.") && q.length > 2) return nameL.endsWith(q.slice(1));
	if (/^\.[a-z0-9]+$/i.test(q)) return nameL === q || nameL.startsWith(`${q}.`) || nameL.endsWith(q);
	return nameL.includes(q) || pathL.includes(q);
}
function shouldSkipSearchDir(name, query) {
	const q = normalizeFileFilter(query).toLowerCase();
	if (name === ".git" && !q.includes(".git")) return true;
	if (name === "node_modules" && !q.includes("node_modules")) return true;
	return false;
}
//#endregion
//#region src/host/git-exec.ts
const DEFAULT_TIMEOUT_MS = 3e4;
function classifyFailure(stderr, exitCode) {
	const text = `${stderr}`;
	if (/index\.lock/i.test(text)) return new GitError("INDEX_LOCKED");
	if (/not a git repository/i.test(text)) return new GitError("NOT_A_REPO");
	if (/did not match any file/i.test(text) && /pathspec/i.test(text)) return new GitError("INVALID_PATH");
	if (/please tell me who you are/i.test(text) || /user\.email/i.test(text) || /user\.name/i.test(text)) return new GitError("IDENTITY_MISSING");
	if (/your local changes/i.test(text) || /would be overwritten/i.test(text)) return new GitError("DIRTY_WORKTREE");
	if (/already exists/i.test(text)) return new GitError("BRANCH_EXISTS");
	if (/pathspec '.*' did not match/i.test(text)) return new GitError("BRANCH_MISSING");
	if (/conflict|automatic merge failed|fix conflicts|unmerged paths/i.test(text)) return new GitError("MERGE_CONFLICT");
	if (/authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|403 forbidden|401 unauthorized/i.test(text)) return new GitError("AUTH_FAILED");
	if (/could not resolve host|unable to access|failed to connect|connection refused|network is unreachable|timed out/i.test(text)) return new GitError("REMOTE_UNREACHABLE");
	if (/not possible to fast-forward|diverging branches|need to specify how to reconcile/i.test(text)) return new GitError("DIVERGED");
	if (/rejected.*non-fast-forward|failed to push some refs|updates were rejected/i.test(text)) return new GitError("REMOTE_AHEAD");
	if (/no upstream|no tracking information|does not have a corresponding remote/i.test(text)) return new GitError("NO_UPSTREAM");
	return new GitError("GIT_FAILED", redactSecrets(text.trim() || `退出码 ${exitCode}`).slice(0, 400));
}
/** Run `git` with a timeout and map common failures to GitError. */
function runGit(options) {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(options.signal.reason ?? /* @__PURE__ */ new Error("aborted"));
			return;
		}
		const child = spawn("git", options.args, {
			cwd: options.cwd,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GIT_OPTIONAL_LOCKS: "0",
				...options.env
			},
			stdio: [
				options.input !== void 0 ? "pipe" : "ignore",
				"pipe",
				"pipe"
			]
		});
		if (options.input !== void 0 && child.stdin) {
			child.stdin.on("error", () => {});
			child.stdin.end(options.input, "utf8");
		}
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const onAbort = () => {
			child.kill("SIGTERM");
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new GitError("GIT_FAILED", `命令超时（${timeoutMs}ms）：git ${options.args.join(" ")}`));
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			if (error.code === "ENOENT") reject(new GitError("GIT_NOT_FOUND"));
			else reject(new GitError("GIT_FAILED", error.message));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			const exitCode = code ?? 1;
			if (exitCode !== 0 && !options.allowNonZero) {
				reject(classifyFailure(`${stdout}\n${stderr}`, exitCode));
				return;
			}
			resolve({
				stdout,
				stderr,
				exitCode
			});
		});
	});
}
async function gitAvailable(signal) {
	try {
		return {
			ok: true,
			version: (await runGit({
				cwd: process.cwd(),
				args: ["--version"],
				signal,
				timeoutMs: 8e3
			})).stdout.trim()
		};
	} catch (error) {
		if (error instanceof GitError && error.code === "GIT_NOT_FOUND") return { ok: false };
		throw error;
	}
}
//#endregion
//#region src/host/git-ignore.ts
async function isGitWorkTree(root) {
	try {
		const result = await runGit({
			cwd: root,
			args: ["rev-parse", "--is-inside-work-tree"],
			allowNonZero: true,
			timeoutMs: 4e3
		});
		return result.exitCode === 0 && result.stdout.trim() === "true";
	} catch {
		return false;
	}
}
/** Paths that `git check-ignore` treats as ignored (untracked + matching .gitignore). Tracked files stay out. */
async function ignoredPathSet(root, paths) {
	const unique = [...new Set(paths.filter((path) => path !== ""))];
	if (unique.length === 0) return /* @__PURE__ */ new Set();
	if (!await isGitWorkTree(root)) return /* @__PURE__ */ new Set();
	try {
		const result = await runGit({
			cwd: root,
			args: [
				"check-ignore",
				"-z",
				"--stdin"
			],
			input: `${unique.join("\0")}\0`,
			allowNonZero: true,
			timeoutMs: 8e3
		});
		if (result.exitCode !== 0 && result.exitCode !== 1) return /* @__PURE__ */ new Set();
		return new Set(result.stdout.split("\0").filter(Boolean));
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
async function attachIgnored(root, entries) {
	const ignored = await ignoredPathSet(root, entries.map((entry) => entry.path));
	return entries.map((entry) => ({
		...entry,
		ignored: ignored.has(entry.path)
	}));
}
const MAX_DIR_ENTRIES = 400;
const MAX_SEARCH_VISITS = 4e3;
const BINARY_EXT = /* @__PURE__ */ new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".bmp",
	".tif",
	".tiff",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".zip",
	".gz",
	".tgz",
	".bz2",
	".7z",
	".rar",
	".xz",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".wasm",
	".so",
	".dylib",
	".dll",
	".exe",
	".bin",
	".class",
	".mp3",
	".mp4",
	".mov",
	".wav",
	".avi",
	".mkv",
	".webm",
	".sqlite",
	".db",
	".lock"
]);
const LANGUAGE_BY_EXT = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".json": "json",
	".md": "markdown",
	".css": "css",
	".scss": "scss",
	".html": "html",
	".yml": "yaml",
	".yaml": "yaml",
	".py": "python",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".kt": "kotlin",
	".sh": "shell",
	".bash": "shell",
	".zsh": "shell",
	".toml": "toml",
	".xml": "xml",
	".sql": "sql",
	".vue": "vue",
	".svelte": "svelte"
};
/** Jail a user path to the workspace root. Empty / `.` means the root itself. */
function assertSafeWorkspacePath(root, filePath) {
	const trimmed = filePath.trim();
	if (trimmed.startsWith("-")) throw new GitError("INVALID_PATH");
	const resolved = resolve(root, trimmed === "" || trimmed === "." ? "" : trimmed);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || normalize(rel).split(sep).includes("..")) throw new GitError("INVALID_PATH");
	return rel.split("\\").join("/");
}
async function resolveInside(root, rel) {
	const full = rel === "" ? root : join(root, rel);
	let real;
	try {
		real = await realpath(full);
	} catch (error) {
		if (isNotFound(error)) {
			if (rel === "") throw new GitError("FS_NOT_FOUND");
			const parent = dirname(full);
			try {
				const parentReal = await realpath(parent);
				if (relative(root, parentReal).startsWith("..")) throw new GitError("INVALID_PATH");
				return join(parentReal, rel.split("/").pop() ?? "");
			} catch (inner) {
				if (inner instanceof GitError) throw inner;
				throw new GitError("FS_NOT_FOUND");
			}
		}
		throw new GitError("INVALID_PATH");
	}
	if (relative(root, real).startsWith("..")) throw new GitError("INVALID_PATH");
	return real;
}
function isNotFound(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isPermission(error) {
	return error instanceof Error && "code" in error && error.code === "EACCES";
}
function looksBinary(buffer, path) {
	if (BINARY_EXT.has(extname(path).toLowerCase())) return true;
	return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}
function languageOf(path) {
	return LANGUAGE_BY_EXT[extname(path).toLowerCase()] ?? "plaintext";
}
const IMAGE_EXT_MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".bmp": "image/bmp",
	".svg": "image/svg+xml"
};
/** Map an image file to a MIME type, validating magic bytes so text can never be served as an image. */
function imageMimeOf(path, buffer) {
	const ext = extname(path).toLowerCase();
	if (ext === ".svg") {
		const sample = buffer.subarray(0, 512).toString("utf8").trimStart();
		return sample.startsWith("<?xml") || sample.startsWith("<svg") || sample.startsWith("<") ? "image/svg+xml" : null;
	}
	const mime = IMAGE_EXT_MIME[ext];
	if (mime === void 0) return null;
	if (mime === "image/png") {
		const magic = Buffer.from([
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		]);
		return buffer.length >= 8 && buffer.subarray(0, 8).equals(magic) ? mime : null;
	}
	if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? mime : null;
	if (mime === "image/gif") return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "GIF8" ? mime : null;
	if (mime === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" ? mime : null;
	if (mime === "image/avif") return buffer.length >= 12 && buffer.toString("ascii", 4, 12) === "ftypavif" ? mime : null;
	if (mime === "image/x-icon") return buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0 ? mime : null;
	if (mime === "image/bmp") return buffer.length >= 2 && buffer[0] === 66 && buffer[1] === 77 ? mime : null;
	return null;
}
function toPosix(rel) {
	return rel.split("\\").join("/");
}
/** Workspace-rooted directory listing and text file IO. */
var WorkspaceFs = class {
	async list(root, dirPath = "") {
		const rel = assertSafeWorkspacePath(root, dirPath);
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (!info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		let names;
		try {
			names = await readdir(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("GIT_FAILED", "没有权限读取这个文件夹。");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		names.sort((left, right) => left.localeCompare(right, "zh"));
		const truncated = names.length > MAX_DIR_ENTRIES;
		const slice = truncated ? names.slice(0, MAX_DIR_ENTRIES) : names;
		const entries = [];
		for (const name of slice) {
			const childRel = rel === "" ? name : `${rel}/${name}`;
			const childAbs = join(abs, name);
			try {
				const childReal = await realpath(childAbs);
				if (relative(root, childReal).startsWith("..")) continue;
				const childStat = await stat(childReal);
				entries.push({
					name,
					path: toPosix(childRel),
					kind: childStat.isDirectory() ? "directory" : "file",
					hidden: name.startsWith("."),
					ignored: false
				});
			} catch {}
		}
		entries.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.name.localeCompare(right.name, "zh");
		});
		return {
			path: rel,
			entries: await attachIgnored(root, entries),
			truncated
		};
	}
	async search(root, query, showHidden = false) {
		const q = normalizeFileFilter(query);
		if (q === "") return {
			query: "",
			hits: [],
			truncated: false
		};
		const absRoot = await resolveInside(root, "");
		const hits = [];
		const queue = [""];
		let visits = 0;
		let truncated = false;
		const revealHidden = showHidden || q.startsWith(".");
		while (queue.length > 0) {
			if (hits.length >= 200 || visits >= MAX_SEARCH_VISITS) {
				truncated = true;
				break;
			}
			const rel = queue.shift() ?? "";
			const abs = rel === "" ? absRoot : join(absRoot, rel);
			let names;
			try {
				names = await readdir(abs);
			} catch {
				continue;
			}
			visits += 1;
			for (const name of names) {
				if (hits.length >= 200 || visits >= MAX_SEARCH_VISITS) {
					truncated = true;
					break;
				}
				const hidden = name.startsWith(".");
				if (hidden && !revealHidden) continue;
				if (shouldSkipSearchDir(name, q)) continue;
				const childRel = rel === "" ? name : `${rel}/${name}`;
				const childAbs = join(abs, name);
				try {
					const childReal = await realpath(childAbs);
					if (relative(root, childReal).startsWith("..")) continue;
					const kind = (await stat(childReal)).isDirectory() ? "directory" : "file";
					const path = toPosix(childRel);
					if (entryMatchesFilter(name, path, q)) hits.push({
						name,
						path,
						kind,
						hidden,
						ignored: false
					});
					if (kind === "directory") queue.push(childRel);
				} catch {}
			}
		}
		hits.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.path.localeCompare(right.path, "zh");
		});
		return {
			query: q,
			hits: await attachIgnored(root, hits),
			truncated
		};
	}
	async resolveAbsolute(root, filePath) {
		return resolveInside(root, assertSafeWorkspacePath(root, filePath));
	}
	async read(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 15e5) throw new GitError("FS_TOO_LARGE");
		let buffer;
		try {
			buffer = await readFile(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("FS_WRITE_FAILED");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (looksBinary(buffer, rel)) throw new GitError("FS_BINARY");
		const ignored = (await ignoredPathSet(root, [rel])).has(rel);
		return {
			path: rel,
			content: buffer.toString("utf8"),
			size: buffer.length,
			language: languageOf(rel),
			ignored
		};
	}
	/** Read a workspace image as raw bytes. Rejects non-images, directories, and files over the image cap. */
	async readImage(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 8e6) throw new GitError("FS_TOO_LARGE");
		let buffer;
		try {
			buffer = await readFile(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("FS_WRITE_FAILED");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		const mime = imageMimeOf(rel, buffer);
		if (mime === null) throw new GitError("FS_BINARY");
		return {
			buffer,
			mime
		};
	}
	/**
	* Read a spreadsheet / delimited-text file (xlsx, csv, tsv) as raw bytes
	* for in-browser table preview. Validates the container so arbitrary
	* workspace files cannot be served as data.
	*/
	async readData(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		const abs = await resolveInside(root, rel);
		let info;
		try {
			info = await stat(abs);
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 8e6) throw new GitError("FS_TOO_LARGE");
		let buffer;
		try {
			buffer = await readFile(abs);
		} catch (error) {
			if (isPermission(error)) throw new GitError("FS_WRITE_FAILED");
			throw new GitError("GIT_FAILED", error instanceof Error ? error.message : String(error));
		}
		const ext = extname(rel).toLowerCase();
		if (ext === ".xlsx") {
			const magic = Buffer.from([
				80,
				75,
				3,
				4
			]);
			if (buffer.length < 4 || !buffer.subarray(0, 4).equals(magic)) throw new GitError("FS_BINARY");
			return {
				buffer,
				mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
			};
		}
		const mime = ext === ".csv" ? "text/csv; charset=utf-8" : ext === ".tsv" ? "text/tab-separated-values; charset=utf-8" : null;
		if (mime === null) throw new GitError("FS_BINARY");
		if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) throw new GitError("FS_BINARY");
		return {
			buffer,
			mime
		};
	}
	/** Rename or move a workspace entry (file or folder). Rejects names that already exist or paths inside the source itself. */
	async rename(root, fromPath, toPath) {
		const fromRel = assertSafeWorkspacePath(root, fromPath);
		const toRel = assertSafeWorkspacePath(root, toPath);
		if (fromRel === "" || toRel === "") throw new GitError("INVALID_PATH");
		if (fromRel === toRel) throw new GitError("FS_EXISTS");
		if (toRel === fromRel || toRel.startsWith(fromRel + "/")) throw new GitError("INVALID_PATH");
		const fromAbs = await resolveInside(root, fromRel);
		const toAbs = await resolveInside(root, toRel);
		let target;
		try {
			target = await stat(toAbs);
		} catch (error) {
			if (!isNotFound(error)) throw new GitError("FS_RENAME_FAILED");
		}
		if (target !== void 0) throw new GitError("FS_EXISTS");
		try {
			await rename(fromAbs, toAbs);
		} catch (error) {
			if (error instanceof GitError) throw error;
			throw new GitError("FS_RENAME_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(toRel) };
	}
	/** Delete a workspace entry (file or folder, recursively). */
	async delete(root, filePath) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("INVALID_PATH");
		const abs = await resolveInside(root, rel);
		try {
			await rm(abs, {
				recursive: true,
				force: false
			});
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			if (error instanceof GitError) throw error;
			throw new GitError("FS_DELETE_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(rel) };
	}
	/** Create an empty folder. Parent must already exist. Rejects names that already exist. */
	async mkdir(root, dirPath) {
		const rel = assertSafeWorkspacePath(root, dirPath);
		if (rel === "") throw new GitError("INVALID_PATH");
		const abs = await resolveInside(root, rel);
		try {
			await stat(abs);
			throw new GitError("FS_EXISTS");
		} catch (error) {
			if (error instanceof GitError) throw error;
			if (!isNotFound(error)) throw new GitError("FS_MKDIR_FAILED");
		}
		try {
			await mkdir(abs, { recursive: false });
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			if (error instanceof GitError) throw error;
			throw new GitError("FS_MKDIR_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(rel) };
	}
	/** Copy a file or folder to a new workspace path. Destination must not exist. */
	async copy(root, fromPath, toPath) {
		const fromRel = assertSafeWorkspacePath(root, fromPath);
		const toRel = assertSafeWorkspacePath(root, toPath);
		if (fromRel === "" || toRel === "") throw new GitError("INVALID_PATH");
		if (fromRel === toRel) throw new GitError("FS_EXISTS");
		if (toRel === fromRel || toRel.startsWith(fromRel + "/")) throw new GitError("INVALID_PATH");
		const fromAbs = await resolveInside(root, fromRel);
		const toAbs = await resolveInside(root, toRel);
		try {
			await stat(fromAbs);
		} catch (error) {
			if (isNotFound(error)) throw new GitError("FS_NOT_FOUND");
			throw new GitError("FS_COPY_FAILED");
		}
		try {
			if (await stat(toAbs) !== void 0) throw new GitError("FS_EXISTS");
		} catch (error) {
			if (error instanceof GitError) throw error;
			if (!isNotFound(error)) throw new GitError("FS_COPY_FAILED");
		}
		try {
			await cp(fromAbs, toAbs, {
				recursive: true,
				errorOnExist: true,
				force: false
			});
		} catch (error) {
			if (error instanceof GitError) throw error;
			throw new GitError("FS_COPY_FAILED", error instanceof Error ? error.message : void 0);
		}
		return { path: toPosix(toRel) };
	}
	async write(root, filePath, content) {
		const rel = assertSafeWorkspacePath(root, filePath);
		if (rel === "") throw new GitError("FS_IS_DIRECTORY");
		if (Buffer.byteLength(content, "utf8") > 15e5) throw new GitError("FS_TOO_LARGE");
		const abs = await resolveInside(root, rel);
		try {
			if ((await stat(abs)).isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		} catch (error) {
			if (error instanceof GitError) throw error;
			if (!isNotFound(error)) throw new GitError("FS_WRITE_FAILED");
			await mkdir(dirname(abs), { recursive: true });
		}
		try {
			await writeFile(abs, content, "utf8");
		} catch (error) {
			if (error instanceof GitError) throw error;
			throw new GitError("FS_WRITE_FAILED", error instanceof Error ? error.message : void 0);
		}
		return {
			path: rel,
			size: Buffer.byteLength(content, "utf8")
		};
	}
};
//#endregion
//#region src/shared/git-sync-prefs.ts
const DEFAULT_GIT_SYNC_PREFS = {
	pullMode: "merge",
	pushMode: "safe"
};
function parsePullMode(raw) {
	if (raw === "ff-only" || raw === "rebase" || raw === "merge") return raw;
	return DEFAULT_GIT_SYNC_PREFS.pullMode;
}
function parsePushMode(raw) {
	if (raw === "lease" || raw === "safe") return raw;
	return DEFAULT_GIT_SYNC_PREFS.pushMode;
}
function pullArgs(mode) {
	switch (mode) {
		case "ff-only": return ["pull", "--ff-only"];
		case "rebase": return ["pull", "--rebase"];
		default: return [
			"pull",
			"--no-rebase",
			"--no-edit"
		];
	}
}
function pushArgs(mode, remote, setUpstream) {
	if (setUpstream) return [
		"push",
		"-u",
		remote,
		"HEAD"
	];
	if (mode === "lease") return ["push", "--force-with-lease"];
	return ["push"];
}
//#endregion
//#region src/shared/git-identity.ts
const DEFAULT_INIT_BRANCH = "main";
const NAME_MAX = 128;
const EMAIL_MAX = 254;
/** Reject names git would store poorly or that look empty to a person. */
function invalidGitUserName(raw) {
	const name = raw.trim();
	if (name === "") return "empty";
	if (name.length > NAME_MAX) return "invalid";
	if (/[\r\n\0]/.test(name)) return "invalid";
	return null;
}
/** Git is permissive; we only require a non-empty local-part@host so 小白能一眼看懂。 */
function invalidGitUserEmail(raw) {
	const email = raw.trim();
	if (email === "") return "empty";
	if (email.length > EMAIL_MAX) return "invalid";
	if (/[\s\r\n\0]/.test(email)) return "invalid";
	if (!/^[^\s@]+@[^\s@]+$/.test(email)) return "invalid";
	return null;
}
function normalizeGitUserName(raw) {
	return raw.trim();
}
function normalizeGitUserEmail(raw) {
	return raw.trim();
}
function normalizeInitBranch(raw) {
	const name = normalizeBranchName(raw);
	return name === "" ? DEFAULT_INIT_BRANCH : name;
}
/** Empty input becomes `main`. Only reject names git would refuse. */
function invalidInitBranch(raw) {
	return invalidBranchName(normalizeInitBranch(raw)) === "invalid" ? "invalid" : null;
}
//#endregion
//#region src/host/mutex.ts
/** One-at-a-time lock so overlapping Git writes cannot corrupt the index. */
var GitMutex = class {
	busy = false;
	async run(fn) {
		if (this.busy) throw new GitError("BUSY");
		this.busy = true;
		try {
			return await fn();
		} finally {
			this.busy = false;
		}
	}
};
//#endregion
//#region src/host/git-service.ts
const KIND_LABEL = {
	modified: "已修改",
	added: "新增",
	deleted: "已删除",
	renamed: "已重命名",
	untracked: "未跟踪",
	conflict: "冲突"
};
function letterKind(letter) {
	switch (letter) {
		case "A": return "added";
		case "D": return "deleted";
		case "R":
		case "C": return "renamed";
		case "U": return "conflict";
		case "?": return "untracked";
		default: return "modified";
	}
}
/** Parse `git log --format=%D` decorations into HEAD + typed ref marks. */
function parseDecorations(raw) {
	if (raw.trim() === "") return {
		head: false,
		refs: []
	};
	let head = false;
	const refs = [];
	for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
		if (part === "HEAD") {
			head = true;
			continue;
		}
		if (part.startsWith("HEAD -> ")) {
			head = true;
			refs.push({
				name: part.slice(8),
				kind: "branch"
			});
			continue;
		}
		if (part.startsWith("tag: ")) {
			refs.push({
				name: part.slice(5),
				kind: "tag"
			});
			continue;
		}
		if (part.includes("/") && part.endsWith("/HEAD")) continue;
		refs.push({
			name: part,
			kind: part.includes("/") ? "remote" : "branch"
		});
	}
	return {
		head,
		refs
	};
}
/** Parse `git log --format=%P` parent hashes. */
function parseParents(raw) {
	if (raw === void 0 || raw.trim() === "") return [];
	const seen = /* @__PURE__ */ new Set();
	const parents = [];
	for (const part of raw.trim().split(/\s+/)) {
		if (!/^[0-9a-f]{7,64}$/i.test(part) || seen.has(part)) continue;
		seen.add(part);
		parents.push(part);
	}
	return parents;
}
function parsePath(raw) {
	const trimmed = raw.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	const arrow = trimmed.indexOf(" -> ");
	return arrow === -1 ? trimmed : trimmed.slice(arrow + 4);
}
/** Visible header so an empty new file is not mistaken for “no diff”. */
function emptyNewFileDiff(path) {
	return [
		`diff --git a/${path} b/${path}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ b/${path}`
	].join("\n") + "\n";
}
function assertSafeRepoPath(root, filePath) {
	if (filePath.trim() === "") throw new GitError("INVALID_PATH");
	if (filePath.startsWith("-")) throw new GitError("INVALID_PATH");
	const resolved = resolve(root, filePath);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || rel === "" || normalize(rel).split(sep).includes("..")) throw new GitError("INVALID_PATH");
	return rel.split("\\").join("/");
}
function parseBranchLine(line) {
	const rest = line.startsWith("## ") ? line.slice(3) : line;
	if (rest.startsWith("HEAD (no branch)") || rest === "HEAD" || rest.startsWith("HEAD...")) {
		const detachedMatch = /^HEAD(?: \(no branch\))?(?:\.\.\.(\S+))?/.exec(rest);
		return {
			branch: void 0,
			detached: true,
			ahead: 0,
			behind: 0,
			...detachedMatch?.[1] ? { upstream: detachedMatch[1] } : {}
		};
	}
	const unborn = rest.replace(/^(?:No commits yet on |Initial commit on )/, "");
	const match = /^(\S+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(unborn);
	let ahead = 0;
	let behind = 0;
	const tracking = match?.[3];
	if (tracking) {
		const aheadMatch = /ahead (\d+)/.exec(tracking);
		const behindMatch = /behind (\d+)/.exec(tracking);
		if (aheadMatch) ahead = Number(aheadMatch[1]);
		if (behindMatch) behind = Number(behindMatch[1]);
	}
	return {
		branch: match?.[1],
		detached: false,
		ahead,
		behind,
		...match?.[2] ? { upstream: match[2] } : {}
	};
}
function parsePorcelain(stdout) {
	const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
	const header = lines.find((line) => line.startsWith("## ")) ?? "## HEAD";
	const files = [];
	for (const line of lines) {
		if (line.startsWith("## ")) continue;
		if (line.startsWith("!! ")) continue;
		if (line.startsWith("?")) {
			files.push({
				path: parsePath(line.slice(3)),
				kind: "untracked",
				staged: false,
				labelZh: KIND_LABEL.untracked
			});
			continue;
		}
		if (line.length < 4) continue;
		const x = line[0] ?? " ";
		const y = line[1] ?? " ";
		const path = parsePath(line.slice(3));
		if (x !== " " && x !== "?") {
			const kind = letterKind(x);
			files.push({
				path,
				kind,
				staged: true,
				labelZh: KIND_LABEL[kind]
			});
		}
		if (y !== " ") {
			const kind = letterKind(y);
			files.push({
				path,
				kind,
				staged: false,
				labelZh: KIND_LABEL[kind]
			});
		}
	}
	return {
		header,
		files
	};
}
/** Workspace-rooted Git operations with structured Chinese errors. */
var GitService = class {
	extraEnv;
	mutex = new GitMutex();
	/**
	* Extra env for git subprocesses. Tests pass `GIT_CONFIG_GLOBAL` so `--global`
	* writes never touch the developer's real `~/.gitconfig`.
	*/
	constructor(extraEnv = {}) {
		this.extraEnv = extraEnv;
	}
	run(options) {
		return runGit({
			...options,
			env: {
				...this.extraEnv,
				...options.env
			}
		});
	}
	async readConfig(cwd, key, file, signal) {
		const result = await this.run({
			cwd,
			args: [
				"config",
				`--${file}`,
				"--null",
				"--get",
				key
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) return void 0;
		const value = result.stdout.replace(/\0+$/, "").trim();
		return value === "" ? void 0 : value;
	}
	async identity(root, signal) {
		if (!(await gitAvailable(signal)).ok) throw new GitError("GIT_NOT_FOUND");
		const [nameLocal, nameGlobal, nameSystem, emailLocal, emailGlobal, emailSystem, branchLocal, branchGlobal, branchSystem] = await Promise.all([
			this.readConfig(root, "user.name", "local", signal),
			this.readConfig(root, "user.name", "global", signal),
			this.readConfig(root, "user.name", "system", signal),
			this.readConfig(root, "user.email", "local", signal),
			this.readConfig(root, "user.email", "global", signal),
			this.readConfig(root, "user.email", "system", signal),
			this.readConfig(root, "init.defaultBranch", "local", signal),
			this.readConfig(root, "init.defaultBranch", "global", signal),
			this.readConfig(root, "init.defaultBranch", "system", signal)
		]);
		return {
			name: nameLocal ?? nameGlobal ?? nameSystem ?? "",
			email: emailLocal ?? emailGlobal ?? emailSystem ?? "",
			defaultBranch: normalizeInitBranch(branchLocal ?? branchGlobal ?? branchSystem ?? "main")
		};
	}
	/** Create a repo in the workspace. Does not run unless the caller asked. Idempotent if already a repo. */
	async initRepo(root, input, signal) {
		return this.mutex.run(async () => {
			const name = normalizeGitUserName(input.name);
			const email = normalizeGitUserEmail(input.email);
			const branch = normalizeInitBranch(input.branch);
			if (invalidGitUserName(name) !== null || invalidGitUserEmail(email) !== null) throw new GitError(invalidGitUserName(name) === "empty" || invalidGitUserEmail(email) === "empty" ? "IDENTITY_MISSING" : "IDENTITY_INVALID");
			if (invalidInitBranch(branch) !== null) throw new GitError("BRANCH_INVALID");
			if (!(await gitAvailable(signal)).ok) throw new GitError("GIT_NOT_FOUND");
			if ((await this.probe(root, signal)).isRepo) return this.status(root, signal);
			try {
				await this.run({
					cwd: root,
					args: [
						"init",
						"-b",
						branch
					],
					signal
				});
			} catch {
				await this.run({
					cwd: root,
					args: ["init"],
					signal
				});
				await this.run({
					cwd: root,
					args: [
						"symbolic-ref",
						"HEAD",
						`refs/heads/${branch}`
					],
					signal
				});
			}
			await this.run({
				cwd: root,
				args: [
					"config",
					"user.email",
					email
				],
				signal
			});
			await this.run({
				cwd: root,
				args: [
					"config",
					"user.name",
					name
				],
				signal
			});
			return this.status(root, signal);
		});
	}
	async probe(root, signal) {
		const available = await gitAvailable(signal);
		if (!available.ok) return {
			gitAvailable: false,
			isRepo: false,
			detached: false,
			ahead: 0,
			behind: 0,
			hasHead: false
		};
		try {
			const inside = await runGit({
				cwd: root,
				args: ["rev-parse", "--is-inside-work-tree"],
				signal,
				allowNonZero: true
			});
			if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return {
				gitAvailable: true,
				gitVersion: available.version,
				isRepo: false,
				detached: false,
				ahead: 0,
				behind: 0,
				hasHead: false
			};
			const top = await runGit({
				cwd: root,
				args: ["rev-parse", "--show-toplevel"],
				signal
			});
			const status = await runGit({
				cwd: root,
				args: [
					"status",
					"--porcelain=v1",
					"-b"
				],
				signal
			});
			const remotes = await runGit({
				cwd: root,
				args: ["remote"],
				signal,
				allowNonZero: true
			});
			const head = await runGit({
				cwd: root,
				args: [
					"rev-parse",
					"--verify",
					"HEAD"
				],
				signal,
				allowNonZero: true
			});
			const { header } = parsePorcelain(status.stdout);
			const branch = parseBranchLine(header);
			const remote = remotes.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
			return {
				gitAvailable: true,
				gitVersion: available.version,
				isRepo: true,
				root: top.stdout.trim(),
				detached: branch.detached,
				ahead: branch.ahead,
				behind: branch.behind,
				hasHead: head.exitCode === 0,
				...branch.branch !== void 0 ? { branch: branch.branch } : {},
				...remote !== void 0 ? { remote } : {},
				...branch.upstream !== void 0 ? { upstream: branch.upstream } : {}
			};
		} catch (error) {
			if (error instanceof GitError && error.code === "NOT_A_REPO") return {
				gitAvailable: true,
				gitVersion: available.version,
				isRepo: false,
				detached: false,
				ahead: 0,
				behind: 0,
				hasHead: false
			};
			throw error;
		}
	}
	async status(root, signal) {
		const probe = await this.probe(root, signal);
		if (!probe.gitAvailable) throw new GitError("GIT_NOT_FOUND");
		if (!probe.isRepo) return {
			probe,
			staged: [],
			unstaged: [],
			untracked: []
		};
		const { files } = parsePorcelain((await runGit({
			cwd: root,
			args: [
				"status",
				"--porcelain=v1",
				"-b"
			],
			signal
		})).stdout);
		return {
			probe,
			staged: files.filter((file) => file.staged),
			unstaged: files.filter((file) => !file.staged && file.kind !== "untracked"),
			untracked: files.filter((file) => file.kind === "untracked")
		};
	}
	async diff(root, path, staged = false, signal) {
		await this.requireRepo(root, signal);
		const safePath = path !== void 0 ? assertSafeRepoPath(root, path) : void 0;
		if (safePath !== void 0 && !staged) {
			const untracked = await this.diffUntrackedFile(root, safePath, signal);
			if (untracked !== void 0) return {
				staged,
				path: safePath,
				text: untracked,
				empty: untracked.trim() === ""
			};
		}
		const args = [
			"diff",
			"--no-color",
			"--find-renames"
		];
		if (staged) args.push("--cached");
		if (safePath !== void 0) args.push("--", safePath);
		const text = (await runGit({
			cwd: root,
			args,
			signal,
			allowNonZero: true
		})).stdout;
		return {
			staged,
			text,
			empty: text.trim() === "",
			...safePath !== void 0 ? { path: safePath } : {}
		};
	}
	async log(root, limit = 80, signal) {
		await this.requireRepo(root, signal);
		const result = await runGit({
			cwd: root,
			args: [
				"log",
				`--max-count=${Math.min(Math.max(1, Math.floor(limit)), 100)}`,
				"--decorate=short",
				"--topo-order",
				"--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1f%P",
				"--date=iso-strict",
				"HEAD",
				"--branches",
				"--remotes",
				"--tags"
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) return [];
		return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
			const [hash, shortHash, author, date, subject, decorations, parentRaw] = line.split("");
			const marks = parseDecorations(decorations ?? "");
			return {
				hash: hash ?? "",
				shortHash: shortHash ?? "",
				author: author ?? "",
				date: date ?? "",
				subject: subject ?? "",
				head: marks.head,
				refs: marks.refs,
				parents: parseParents(parentRaw)
			};
		});
	}
	async branches(root, signal) {
		await this.requireRepo(root, signal);
		const list = (await runGit({
			cwd: root,
			args: [
				"branch",
				"--list",
				"--format=%(refname:short)%09%(HEAD)"
			],
			signal
		})).stdout.split(/\r?\n/).filter(Boolean).map((line) => {
			const [name, head] = line.split("	");
			return {
				name: name ?? "",
				current: head === "*"
			};
		}).filter((branch) => branch.name !== "");
		if (list.length > 0) return list;
		const head = await runGit({
			cwd: root,
			args: [
				"symbolic-ref",
				"--short",
				"HEAD"
			],
			signal,
			allowNonZero: true
		});
		const name = head.exitCode === 0 ? head.stdout.trim() : "";
		return name === "" ? [] : [{
			name,
			current: true
		}];
	}
	async stage(root, paths, signal) {
		await this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			if (paths.length === 0) throw new GitError("INVALID_PATH");
			await runGit({
				cwd: root,
				args: [
					"add",
					"--",
					...paths.map((path) => assertSafeRepoPath(root, path))
				],
				signal
			});
		});
	}
	async unstage(root, paths, signal) {
		await this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			if (paths.length === 0) throw new GitError("INVALID_PATH");
			const safe = paths.map((path) => assertSafeRepoPath(root, path));
			try {
				await runGit({
					cwd: root,
					args: [
						"restore",
						"--staged",
						"--",
						...safe
					],
					signal
				});
			} catch (error) {
				if (!(error instanceof GitError) || !/could not resolve '?HEAD'?/i.test(error.message)) throw error;
				await runGit({
					cwd: root,
					args: [
						"rm",
						"--cached",
						"-q",
						"--",
						...safe
					],
					signal
				});
			}
		});
	}
	/** Discard worktree edits (`git restore`) or delete untracked paths (`git clean -f`). */
	async restore(root, paths, signal) {
		await this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			if (paths.length === 0) throw new GitError("INVALID_PATH");
			const safe = paths.map((path) => assertSafeRepoPath(root, path));
			const snapshot = await this.status(root, signal);
			const untracked = new Set(snapshot.untracked.map((file) => file.path));
			const tracked = safe.filter((path) => !untracked.has(path));
			const junk = safe.filter((path) => untracked.has(path));
			if (tracked.length > 0) await runGit({
				cwd: root,
				args: [
					"restore",
					"--worktree",
					"--",
					...tracked
				],
				signal
			});
			if (junk.length === 0) return;
			const files = [];
			const dirs = [];
			for (const path of junk) try {
				if ((await stat(join(root, path))).isDirectory()) dirs.push(path);
				else files.push(path);
			} catch {
				files.push(path);
			}
			if (files.length > 0) await runGit({
				cwd: root,
				args: [
					"clean",
					"-f",
					"--",
					...files
				],
				signal
			});
			if (dirs.length > 0) await runGit({
				cwd: root,
				args: [
					"clean",
					"-fd",
					"--",
					...dirs
				],
				signal
			});
		});
	}
	async commit(root, message, all = false, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const trimmed = message.trim();
			if (trimmed === "") throw new GitError("EMPTY_MESSAGE");
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length === 0) {
				const rest = [...snapshot.unstaged, ...snapshot.untracked].map((file) => file.path);
				if (!all || rest.length === 0) throw new GitError("NOTHING_STAGED");
				await runGit({
					cwd: root,
					args: [
						"add",
						"--",
						...rest.map((path) => assertSafeRepoPath(root, path))
					],
					signal
				});
			}
			await this.assertNoMergeLock(root);
			await runGit({
				cwd: root,
				args: [
					"commit",
					"-m",
					trimmed
				],
				signal
			});
			return {
				hash: (await runGit({
					cwd: root,
					args: ["rev-parse", "HEAD"],
					signal
				})).stdout.trim(),
				subject: trimmed
			};
		});
	}
	/** Update remote-tracking refs, then re-read ahead/behind. Caller must already hold the mutex. */
	async refreshTracking(root, probe, signal) {
		if (probe.remote === void 0) return probe;
		await runGit({
			cwd: root,
			args: [
				"fetch",
				"--prune",
				probe.remote
			],
			signal,
			timeoutMs: 9e4
		});
		return this.probe(root, signal);
	}
	async abortInterruptedPull(root, mode, signal) {
		await runGit({
			cwd: root,
			args: mode === "rebase" ? ["rebase", "--abort"] : ["merge", "--abort"],
			signal,
			allowNonZero: true,
			timeoutMs: 15e3
		});
	}
	async push(root, signal, pushMode = "safe") {
		const mode = parsePushMode(pushMode);
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			let probe = await this.probe(root, signal);
			if (probe.detached) throw new GitError("DETACHED_HEAD");
			if (probe.remote === void 0) throw new GitError("NO_REMOTE");
			if (!probe.hasHead) throw new GitError("NOTHING_TO_PUSH");
			probe = await this.refreshTracking(root, probe, signal);
			if (probe.behind > 0 && mode !== "lease") throw new GitError("REMOTE_AHEAD");
			if (probe.ahead === 0 && probe.upstream !== void 0) throw new GitError("NOTHING_TO_PUSH");
			const branch = probe.branch;
			if (branch === void 0 || branch.trim() === "") throw new GitError("BRANCH_MISSING");
			const setUpstream = probe.upstream === void 0;
			await runGit({
				cwd: root,
				args: pushArgs(mode, probe.remote, setUpstream),
				signal,
				timeoutMs: 9e4
			});
			return {
				remote: probe.remote,
				branch,
				setUpstream
			};
		});
	}
	async pull(root, signal, pullMode = "merge") {
		const mode = parsePullMode(pullMode);
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			let probe = await this.probe(root, signal);
			if (probe.detached) throw new GitError("DETACHED_HEAD");
			if (probe.remote === void 0) throw new GitError("NO_REMOTE");
			if (probe.upstream === void 0) throw new GitError("NO_UPSTREAM");
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0) throw new GitError("DIRTY_WORKTREE");
			probe = await this.refreshTracking(root, probe, signal);
			if (probe.behind === 0) throw new GitError("NOTHING_TO_PULL");
			const branch = probe.branch;
			if (branch === void 0 || branch.trim() === "") throw new GitError("BRANCH_MISSING");
			try {
				await runGit({
					cwd: root,
					args: pullArgs(mode),
					signal,
					timeoutMs: 9e4
				});
			} catch (error) {
				await this.abortInterruptedPull(root, mode, signal);
				throw error;
			}
			return {
				remote: probe.remote,
				branch
			};
		});
	}
	async switchBranch(root, name, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const trimmed = this.requireExistingBranch(name, await this.branches(root, signal));
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0) throw new GitError("DIRTY_WORKTREE");
			await runGit({
				cwd: root,
				args: [
					"switch",
					"--",
					trimmed
				],
				signal
			});
			return { branch: trimmed };
		});
	}
	async fetch(root, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const probe = await this.probe(root, signal);
			if (probe.remote === void 0) throw new GitError("NO_REMOTE");
			await runGit({
				cwd: root,
				args: [
					"fetch",
					"--prune",
					probe.remote
				],
				signal,
				timeoutMs: 9e4
			});
			return { remote: probe.remote };
		});
	}
	async createBranch(root, name, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const trimmed = this.requireNewBranchName(name);
			if ((await this.branches(root, signal)).some((branch) => branch.name === trimmed)) throw new GitError("BRANCH_EXISTS");
			await runGit({
				cwd: root,
				args: [
					"switch",
					"-c",
					trimmed
				],
				signal
			});
			return { branch: trimmed };
		});
	}
	async mergeBranch(root, name, signal) {
		return this.mutex.run(async () => {
			await this.requireRepo(root, signal);
			const probe = await this.probe(root, signal);
			if (probe.detached) throw new GitError("DETACHED_HEAD");
			const current = probe.branch;
			if (current === void 0 || current.trim() === "") throw new GitError("BRANCH_MISSING");
			const trimmed = this.requireExistingBranch(name, await this.branches(root, signal));
			if (trimmed === current) throw new GitError("GIT_FAILED", "不能把当前分支合并到自己。");
			const snapshot = await this.status(root, signal);
			if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0) throw new GitError("DIRTY_WORKTREE");
			await this.assertNoMergeLock(root);
			try {
				await runGit({
					cwd: root,
					args: [
						"merge",
						"--no-edit",
						"--",
						trimmed
					],
					signal
				});
			} catch (error) {
				const conflict = await this.hasMergeHead(root);
				await runGit({
					cwd: root,
					args: ["merge", "--abort"],
					signal,
					allowNonZero: true
				});
				if (conflict || error instanceof GitError && error.code === "MERGE_CONFLICT") throw new GitError("MERGE_CONFLICT");
				throw error;
			}
			return {
				branch: current,
				from: trimmed
			};
		});
	}
	/** Untracked files are invisible to `git diff`; show them as a full addition. */
	async diffUntrackedFile(root, safePath, signal) {
		let info;
		try {
			info = await stat(join(root, safePath));
		} catch {
			return;
		}
		if (info.isDirectory()) throw new GitError("FS_IS_DIRECTORY");
		if (info.size > 15e5) throw new GitError("FS_TOO_LARGE");
		if ((await runGit({
			cwd: root,
			args: [
				"ls-files",
				"--error-unmatch",
				"--",
				safePath
			],
			signal,
			allowNonZero: true
		})).exitCode === 0) return void 0;
		const result = await runGit({
			cwd: root,
			args: [
				"diff",
				"--no-color",
				"--no-index",
				"--",
				"/dev/null",
				safePath
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode > 1 && result.stdout.trim() === "") throw new GitError("GIT_FAILED", result.stderr.trim() || `无法读取未跟踪文件 ${safePath}`);
		if (result.stdout.trim() !== "") return result.stdout;
		return emptyNewFileDiff(safePath);
	}
	requireNewBranchName(name) {
		if (invalidBranchName(name) !== null) throw new GitError("BRANCH_INVALID");
		return normalizeBranchName(name);
	}
	requireExistingBranch(name, existing) {
		const reason = invalidBranchName(name);
		if (reason !== null) throw new GitError(reason === "empty" ? "BRANCH_MISSING" : "BRANCH_INVALID");
		const trimmed = normalizeBranchName(name);
		if (!existing.some((branch) => branch.name === trimmed)) throw new GitError("BRANCH_MISSING");
		return trimmed;
	}
	/** Files touched by a commit, with their change kind (A/M/D/R/…). Works for the root commit too. */
	async commitFiles(root, hash, signal) {
		await this.requireRepo(root, signal);
		const result = await runGit({
			cwd: root,
			args: [
				"diff-tree",
				"--no-commit-id",
				"--root",
				"--name-status",
				"-r",
				await this.requireCommitHash(hash, root, signal)
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) throw new GitError("GIT_FAILED", result.stderr.trim() || "无法读取提交 " + hash + " 的改动文件");
		const files = [];
		for (const line of result.stdout.split(/\r?\n/)) {
			if (line.trim() === "") continue;
			const parts = line.split("	");
			const letter = (parts[0] ?? "").trim();
			if (letter === "") continue;
			const path = parts.length >= 3 ? parts[2] ?? "" : parts[1] ?? "";
			if (path.trim() === "") continue;
			const kind = letterKind(letter.charAt(0) ?? "M");
			files.push({
				path: path.trim(),
				kind,
				staged: false,
				labelZh: KIND_LABEL[kind]
			});
		}
		return files;
	}
	/** Unified diff of a single file inside a commit. */
	async commitDiff(root, hash, path, signal) {
		await this.requireRepo(root, signal);
		const safeHash = await this.requireCommitHash(hash, root, signal);
		const safePath = assertSafeRepoPath(root, path);
		const result = await runGit({
			cwd: root,
			args: [
				"show",
				"--no-color",
				"--format=",
				safeHash,
				"--",
				safePath
			],
			signal,
			allowNonZero: true
		});
		if (result.exitCode !== 0) throw new GitError("GIT_FAILED", result.stderr.trim() || "无法读取提交 " + hash + " 中 " + path + " 的差异");
		return {
			staged: false,
			path: safePath,
			text: result.stdout,
			empty: result.stdout.trim() === ""
		};
	}
	async requireCommitHash(hash, root, signal) {
		const trimmed = hash.trim();
		if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) throw new GitError("INVALID_PATH");
		const verified = await runGit({
			cwd: root,
			args: [
				"rev-parse",
				"--verify",
				"--quiet",
				trimmed + "^{commit}"
			],
			signal,
			allowNonZero: true
		});
		if (verified.exitCode !== 0 || verified.stdout.trim() === "") throw new GitError("GIT_FAILED", "找不到这个提交。");
		return verified.stdout.trim();
	}
	async requireRepo(root, signal) {
		const probe = await this.probe(root, signal);
		if (!probe.gitAvailable) throw new GitError("GIT_NOT_FOUND");
		if (!probe.isRepo) throw new GitError("NOT_A_REPO");
	}
	async hasMergeHead(root) {
		try {
			await access(join(root, ".git", "MERGE_HEAD"));
			return true;
		} catch {
			return false;
		}
	}
	async assertNoMergeLock(root) {
		try {
			await access(join(root, ".git", "index.lock"));
			throw new GitError("INDEX_LOCKED");
		} catch (error) {
			if (error instanceof GitError) throw error;
		}
		if (await this.hasMergeHead(root)) throw new GitError("GIT_FAILED", "仓库正在合并中，请先处理合并再提交。");
	}
};
const SKIP_CHILD_NAMES = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	".next",
	"dist",
	"build",
	"coverage",
	"vendor"
]);
function isSkippedChildName(name) {
	return SKIP_CHILD_NAMES.has(name);
}
function folderNameFromPath(path) {
	const trimmed = path.replace(/[\\/]+$/, "");
	if (trimmed === "" || trimmed === "/") return "/";
	const parts = trimmed.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] || trimmed;
}
function isCurrentRepoId(id) {
	return id === void 0 || id === "" || id === ".";
}
function parseNearbyRepoId(id) {
	if (isCurrentRepoId(id)) return { kind: "current" };
	if (id === "..") return { kind: "parent" };
	if (id === void 0) return null;
	const name = id.trim();
	if (name === "" || name === "." || name === "..") return null;
	if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return null;
	if (/[\\\0]/.test(name) || name.includes("..")) return null;
	if (name.split("/").some((part) => part === "" || part === "." || part.startsWith("-"))) return null;
	return {
		kind: "child",
		child: name
	};
}
//#endregion
//#region src/shared/commit-template.ts
const MAX_COMMIT_TEMPLATE_CHARS = 4e3;
const DEFAULT_COMMIT_TEMPLATE_ZH = [
	"你是 Git 提交说明生成器。根据用户给出的 diff 写一条符合 Conventional Commits 的提交说明。",
	"规则：",
	"1. 只输出提交说明本身，不要解释、不要用 Markdown 代码块、不要加引号。",
	"2. 第一行：type(scope): 摘要，不超过 72 个字符。type 只能是 feat、fix、docs、style、refactor、perf、test、chore、build、ci。",
	"3. 如有必要，空一行后写正文：说明为什么改、影响范围；不要逐行复述 diff。",
	"4. 摘要和正文使用中文；文件名、符号、API 名称保持原文。",
	"5. 不要编造 diff 里没有的改动。"
].join("\n");
[
	"You are a Git commit-message generator. Write a Conventional Commits message from the given diff.",
	"Rules:",
	"1. Output only the commit message. No explanation, no Markdown fences, no quotation marks.",
	"2. First line: type(scope): summary, at most 72 characters. type must be feat, fix, docs, style, refactor, perf, test, chore, build, or ci.",
	"3. If needed, add a blank line and a body: why it changed and the impact. Do not restate the diff line by line.",
	"4. Write the summary and body in English. Keep file names, symbols, and API names as-is.",
	"5. Do not invent changes that are not in the diff."
].join("\n");
/** Host fallback when the client sends nothing. UI should send the locale default. */
const DEFAULT_COMMIT_TEMPLATE = DEFAULT_COMMIT_TEMPLATE_ZH;
/** Empty / oversized / non-string input falls back to the built-in Chinese template. */
function resolveCommitTemplate(raw, fallback = DEFAULT_COMMIT_TEMPLATE) {
	if (typeof raw !== "string") return fallback;
	const trimmed = raw.replace(/\r\n/g, "\n").trim();
	if (trimmed === "") return fallback;
	return trimmed.length > 4e3 ? trimmed.slice(0, MAX_COMMIT_TEMPLATE_CHARS).trim() : trimmed;
}
//#endregion
//#region src/host/commit-message.ts
const MAX_DIFF_CHARS = 6e4;
const GENERATE_TIMEOUT_MS$1 = 45e3;
const COMMIT_MAX_TOKENS = 1024;
const PLUGIN_SOURCE$1 = {
	kind: "plugin",
	plugin: "dsh-workbench-plugin"
};
function sanitizeCommitMessage(raw) {
	let text = raw.replace(/\r\n/g, "\n").trim();
	const fenced = /^```(?:\w+)?\n([\s\S]*?)\n```$/m.exec(text);
	if (fenced?.[1] !== void 0) text = fenced[1].trim();
	text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
	if (text.length > 4e3) text = text.slice(0, 4e3).trim();
	return text;
}
function buildCommitUserPrompt(input) {
	const parts = ["请根据下面的仓库改动生成提交说明。"];
	if (input.staged.trim() !== "") parts.push("", "## 已暂存", input.staged.trim());
	if (input.unstaged.trim() !== "") parts.push("", "## 未暂存", input.unstaged.trim());
	if (input.untracked.length > 0) {
		parts.push("", "## 未跟踪");
		for (const file of input.untracked) {
			parts.push("", `### ${file.path}`);
			parts.push(file.patch.trim() === "" ? "（新文件，未能读取内容）" : file.patch.trim());
		}
	}
	let body = parts.join("\n");
	if (body.length > MAX_DIFF_CHARS) body = `${body.slice(0, MAX_DIFF_CHARS)}\n\n…（差异过长，已截断。请只根据已给出的部分总结。）`;
	return body;
}
function createCommitAssemble() {
	return {
		parts: /* @__PURE__ */ new Map(),
		types: [],
		sawReasoning: false,
		fail: "",
		finishKind: "",
		failCode: ""
	};
}
function applyCommitChunk(state, chunk) {
	state.types.push(chunk.type ?? "unknown");
	if (chunk.type === "text-delta" && typeof chunk.text === "string") {
		const index = typeof chunk.index === "number" ? chunk.index : 0;
		const part = state.parts.get(index) ?? {
			text: "",
			closed: false
		};
		if (!part.closed) state.parts.set(index, {
			text: part.text + chunk.text,
			closed: false
		});
	}
	if (chunk.type === "reasoning-delta" || chunk.block?.type === "reasoning") state.sawReasoning = true;
	if (chunk.type === "block-end" && chunk.block?.type === "text" && typeof chunk.block.text === "string") {
		const index = typeof chunk.index === "number" ? chunk.index : 0;
		state.parts.set(index, {
			text: chunk.block.text,
			closed: true
		});
	}
	if (chunk.type === "finish") {
		state.finishKind = chunk.reason?.kind ?? "";
		state.failCode = chunk.reason?.failure?.code ?? "";
		if (state.finishKind === "error" || state.finishKind === "aborted") state.fail = chunk.reason?.failure?.message ?? (state.finishKind === "aborted" ? "生成已取消或超时。" : "模型没有返回可用结果。");
	}
}
function commitAssembleText(state) {
	return [...state.parts.entries()].sort((left, right) => left[0] - right[0]).map(([, part]) => part.text).join("");
}
/** Live preview: hide unfinished markdown fences so the textarea fills with real words. */
function previewCommitMessage(raw) {
	let text = raw.replace(/\r\n/g, "\n");
	text = text.replace(/^```(?:\w+)?\r?\n?/, "");
	text = text.replace(/\n```[ \t]*$/, "");
	if (text.length > 4e3) text = text.slice(0, 4e3);
	return text;
}
function summarizeTypes$1(types) {
	if (types.length === 0) return "没有任何数据";
	const counts = /* @__PURE__ */ new Map();
	for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
	return [...counts.entries()].map(([type, count]) => `${type}×${count}`).join("，");
}
function commitAssembleResult(state) {
	const text = commitAssembleText(state);
	const trace = summarizeTypes$1(state.types);
	if (state.fail !== "") {
		const code = state.failCode === "" ? "" : ` [${state.failCode}]`;
		return {
			text,
			fail: `${state.fail}${code}（${trace}）`
		};
	}
	if (sanitizeCommitMessage(text) !== "") return {
		text,
		fail: ""
	};
	if (state.types.length === 0) return {
		text,
		fail: "模型接口没有返回任何数据。请确认「模型」已配置，然后重试。"
	};
	if (state.finishKind === "max-tokens") return {
		text,
		fail: state.sawReasoning ? `模型把输出额度用在了思考过程上，没有写出提交说明。（${trace}）` : `模型输出被截断，没有完整提交说明。（${trace}）`
	};
	if (state.sawReasoning) return {
		text,
		fail: `模型只返回了思考过程，没有写出提交说明。（${trace}）`
	};
	if (state.finishKind === "") return {
		text,
		fail: `模型调用没有正常结束。（${trace}）`
	};
	return {
		text,
		fail: `模型没有返回提交说明。（${trace}）`
	};
}
function pickCommitRoute(providers, models, preferred) {
	if (providers.length === 0) throw new GitError("LLM_UNAVAILABLE");
	if (preferred !== void 0 && preferred.provider !== "" && preferred.model !== "" && providers.some((provider) => provider.id === preferred.provider)) return {
		provider: preferred.provider,
		model: preferred.model
	};
	const ranked = [...providers].sort((left, right) => {
		const score = (id) => id.includes("deepseek") ? 0 : 1;
		return score(left.id) - score(right.id);
	});
	for (const provider of ranked) {
		const first = models[provider.id]?.[0]?.id;
		if (first) return {
			provider: provider.id,
			model: first
		};
	}
	throw new GitError("LLM_UNAVAILABLE");
}
function pickCommitReasoningEffort(info) {
	const efforts = info?.reasoning?.efforts ?? [];
	if (efforts.length === 0) return void 0;
	return efforts.some((effort) => effort.id === "off") ? "off" : void 0;
}
async function collectChangePayload(git, root, signal) {
	const status = await git.status(root, signal);
	if (status.staged.length + status.unstaged.length + status.untracked.length === 0) throw new GitError("NOTHING_TO_DESCRIBE");
	if (status.staged.length > 0) return {
		staged: (await git.diff(root, void 0, true, signal)).text,
		unstaged: "",
		untracked: []
	};
	const unstaged = status.unstaged.length > 0 ? (await git.diff(root, void 0, false, signal)).text : "";
	const untracked = [];
	for (const file of status.untracked.slice(0, 20)) try {
		const result = await git.diff(root, file.path, false, signal);
		untracked.push({
			path: file.path,
			patch: result.text.slice(0, 8e3)
		});
	} catch {
		untracked.push({
			path: file.path,
			patch: ""
		});
	}
	return {
		staged: "",
		unstaged,
		untracked
	};
}
function readLlm$2(ctx) {
	const llm = ctx.llm ?? ctx.get("llm");
	if (llm === void 0 || typeof llm.stream !== "function" || typeof llm.listProviders !== "function") throw new GitError("LLM_UNAVAILABLE");
	return llm;
}
function readPreferredRoute$1(ctx) {
	const selection = (ctx.agentDefaultModel ?? ctx.get("agentDefaultModel"))?.currentSelection?.();
	if (typeof selection?.provider === "string" && selection.provider !== "" && typeof selection.model === "string" && selection.model !== "") return {
		provider: selection.provider,
		model: selection.model
	};
}
async function resolveRoute$2(ctx) {
	const llm = readLlm$2(ctx);
	const providers = llm.listProviders();
	const preferred = readPreferredRoute$1(ctx);
	if (preferred !== void 0 && providers.some((provider) => provider.id === preferred.provider)) return preferred;
	const models = {};
	for (const provider of providers) try {
		models[provider.id] = await llm.listModels(provider.id);
	} catch {
		models[provider.id] = [];
	}
	return pickCommitRoute(providers, models, preferred);
}
async function resolveReasoningEffort$1(llm, route, signal) {
	if (typeof llm.resolveModelInfo !== "function") return "off";
	try {
		return pickCommitReasoningEffort(await llm.resolveModelInfo(route.provider, route.model, signal));
	} catch {
		return;
	}
}
function buildUserMessage$1(text) {
	return {
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: PLUGIN_SOURCE$1
	};
}
/** Stream commit text as the model writes it. Throws GitError when the call fails. */
async function* streamCommitMessage(ctx, git, root, options) {
	const signal = options?.signal;
	const system = resolveCommitTemplate(options?.template);
	const payload = await collectChangePayload(git, root, signal);
	const llm = readLlm$2(ctx);
	const route = await resolveRoute$2(ctx);
	const reasoningEffort = await resolveReasoningEffort$1(llm, route, signal);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, GENERATE_TIMEOUT_MS$1);
	const onAbort = () => {
		controller.abort();
	};
	signal?.addEventListener("abort", onAbort);
	try {
		const state = createCommitAssemble();
		let last = "";
		for await (const chunk of llm.stream({
			provider: route.provider,
			model: route.model,
			system,
			messages: [buildUserMessage$1(buildCommitUserPrompt(payload))],
			maxTokens: COMMIT_MAX_TOKENS,
			temperature: .2,
			purpose: "session-title",
			...reasoningEffort === void 0 ? {} : { reasoningEffort },
			signal: controller.signal
		})) {
			if (controller.signal.aborted) break;
			applyCommitChunk(state, chunk);
			const visible = previewCommitMessage(commitAssembleText(state));
			if (visible !== last) {
				last = visible;
				yield {
					type: "delta",
					text: visible
				};
			}
		}
		if (signal?.aborted) throw new GitError("LLM_FAILED", "生成已取消。");
		const assembled = commitAssembleResult(state);
		if (assembled.fail !== "") throw new GitError("LLM_FAILED", `${assembled.fail} 路由：${route.provider} / ${route.model}`);
		yield {
			type: "done",
			message: sanitizeCommitMessage(assembled.text)
		};
	} catch (error) {
		if (error instanceof GitError) throw error;
		if (controller.signal.aborted) throw new GitError("LLM_FAILED", signal?.aborted ? "生成已取消。" : "生成超时或已取消，请稍后重试。");
		throw new GitError("LLM_FAILED", error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
/** One-shot auxiliary LLM call: fixed prompt + current diff → commit message. */
async function generateCommitMessage(ctx, git, root, options) {
	let message = "";
	for await (const event of streamCommitMessage(ctx, git, root, options)) if (event.type === "done") message = event.message;
	return message;
}
const DEFAULT_BLACKLIST = [
	{
		id: "rm-rf",
		kind: "rm",
		enabled: true,
		pattern: "rm -rf"
	},
	{
		id: "mkfs",
		kind: "other",
		enabled: true,
		pattern: "mkfs"
	},
	{
		id: "dd-of",
		kind: "other",
		enabled: true,
		pattern: "dd of="
	},
	{
		id: "fork-bomb",
		kind: "other",
		enabled: true,
		pattern: ":(){"
	},
	{
		id: "write-sd",
		kind: "other",
		enabled: true,
		pattern: ">/dev/sd"
	},
	{
		id: "shutdown",
		kind: "other",
		enabled: true,
		pattern: "shutdown"
	},
	{
		id: "reboot",
		kind: "other",
		enabled: true,
		pattern: "reboot"
	},
	{
		id: "halt",
		kind: "other",
		enabled: true,
		pattern: "halt"
	},
	{
		id: "poweroff",
		kind: "other",
		enabled: true,
		pattern: "poweroff"
	},
	{
		id: "init-0",
		kind: "other",
		enabled: true,
		pattern: "init 0"
	},
	{
		id: "init-6",
		kind: "other",
		enabled: true,
		pattern: "init 6"
	},
	{
		id: "git-reset-hard",
		kind: "other",
		enabled: true,
		pattern: "git reset --hard"
	},
	{
		id: "git-clean-f",
		kind: "other",
		enabled: true,
		pattern: "git clean -f"
	},
	{
		id: "find-delete",
		kind: "other",
		enabled: true,
		pattern: "find -delete"
	},
	{
		id: "format-drive",
		kind: "other",
		enabled: true,
		pattern: "format"
	}
];
const LEGACY_RULE_TO_IDS = {
	rmRf: ["rm-rf"],
	mkfs: ["mkfs"],
	ddDisk: ["dd-of"],
	forkBomb: ["fork-bomb"],
	writeDisk: ["write-sd"],
	shutdown: [
		"shutdown",
		"reboot",
		"halt",
		"poweroff",
		"init-0",
		"init-6"
	],
	formatDrive: ["format-drive"],
	gitResetHard: ["git-reset-hard"],
	gitClean: ["git-clean-f"],
	findDelete: ["find-delete"]
};
function cloneBlacklist(rules) {
	return rules.map((rule) => ({ ...rule }));
}
function resolveKind(raw, pattern) {
	if (raw === "rm" || raw === "other") return raw;
	const stripped = pattern.replace(/^sudo\s+/i, "");
	return /^rm\b/i.test(stripped) ? "rm" : "other";
}
function resolveBlacklistRule(raw, index) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const source = raw;
	const pattern = typeof source.pattern === "string" ? source.pattern.replace(/[\r\n]+/g, " ") : "";
	const clipped = pattern.length > 80 ? pattern.slice(0, 80) : pattern;
	const kind = resolveKind(source.kind, clipped.trim());
	return {
		id: typeof source.id === "string" && source.id.trim() !== "" ? source.id.trim().slice(0, 64) : `${kind}-${index}`,
		kind,
		enabled: source.enabled !== false,
		pattern: clipped
	};
}
function resolveBlacklist(raw, legacyRules) {
	if (Array.isArray(raw)) {
		const next = [];
		const seen = /* @__PURE__ */ new Set();
		for (const item of raw) {
			if (next.length >= 40) break;
			const rule = resolveBlacklistRule(item, next.length);
			if (rule === null) continue;
			let id = rule.id;
			if (seen.has(id)) id = `${id}-${next.length}`;
			seen.add(id);
			next.push({
				...rule,
				id
			});
		}
		return next;
	}
	if (legacyRules !== null && typeof legacyRules === "object" && !Array.isArray(legacyRules)) {
		const flags = legacyRules;
		return DEFAULT_BLACKLIST.map((rule) => {
			let enabled = rule.enabled;
			for (const [legacy, ids] of Object.entries(LEGACY_RULE_TO_IDS)) if (ids.includes(rule.id) && typeof flags[legacy] === "boolean") {
				enabled = flags[legacy];
				break;
			}
			return {
				...rule,
				enabled
			};
		});
	}
	return cloneBlacklist(DEFAULT_BLACKLIST);
}
function tokenize(text) {
	return text.split(/\s+/).filter(Boolean);
}
function stripSudo(tokens) {
	if (tokens[0]?.toLowerCase() === "sudo") return tokens.slice(1);
	return tokens;
}
function parseRmNeed(pattern) {
	const tokens = stripSudo(tokenize(pattern));
	if (tokens.length === 0 || tokens[0]?.toLowerCase() !== "rm") return null;
	let recursive = false;
	let force = false;
	let extraFlags = "";
	const paths = [];
	for (const token of tokens.slice(1)) {
		if (token === "--") continue;
		if (token === "--recursive" || token.startsWith("--recursive=")) {
			recursive = true;
			continue;
		}
		if (token === "--force" || token.startsWith("--force=")) {
			force = true;
			continue;
		}
		if (token.startsWith("--")) continue;
		if (/^-[A-Za-z]+$/.test(token)) {
			if (/[rR]/.test(token)) recursive = true;
			if (/f/.test(token)) force = true;
			extraFlags += token.slice(1).replace(/[rRf]/g, "");
			continue;
		}
		paths.push(token);
	}
	return {
		recursive,
		force,
		extraFlags: extraFlags.toLowerCase(),
		paths,
		anyRm: !recursive && !force && extraFlags === "" && paths.length === 0
	};
}
function shortFlagsIn(tokens) {
	let flags = "";
	for (const token of tokens) {
		if (token === "--") break;
		if (token.startsWith("--")) {
			if (token === "--recursive" || token.startsWith("--recursive=")) flags += "r";
			if (token === "--force" || token.startsWith("--force=")) flags += "f";
			continue;
		}
		if (/^-[A-Za-z]+$/.test(token)) flags += token.slice(1).toLowerCase();
	}
	return flags;
}
function rmInvocations(command) {
	const chunks = command.split(/[|;&\n]+/);
	const found = [];
	for (const chunk of chunks) {
		const tokens = stripSudo(tokenize(chunk.replace(/^\s*\(+/, "")));
		const index = tokens.findIndex((token) => token.toLowerCase() === "rm");
		if (index === -1) continue;
		found.push(tokens.slice(index + 1));
	}
	return found;
}
function rmMatchesNeed(args, need) {
	if (need.anyRm) return true;
	const flags = shortFlagsIn(args);
	if (need.recursive && !flags.includes("r")) return false;
	if (need.force && !flags.includes("f")) return false;
	for (const letter of need.extraFlags) if (!flags.includes(letter)) return false;
	const paths = [];
	for (const token of args) {
		if (token === "--") continue;
		if (token.startsWith("-") && token !== "-") continue;
		paths.push(token);
	}
	for (const required of need.paths) if (!paths.some((path) => {
		if (required === "/") return path === "/" || path === "/*";
		return path === required || path.startsWith(`${required}/`);
	})) return false;
	return true;
}
function commandMatchesRm(command, pattern) {
	const effective = pattern.trim().replace(/^sudo\s+/i, "");
	const need = parseRmNeed(/^rm\b/i.test(effective) ? pattern.trim() : `rm ${effective}`);
	if (need === null) return false;
	return rmInvocations(command).some((args) => rmMatchesNeed(args, need));
}
function shortFlagPresent(tokens, letter) {
	const lower = letter.toLowerCase();
	for (const token of tokens) {
		if (token === "--") break;
		if (/^-[A-Za-z]+$/.test(token) && token.toLowerCase().includes(lower)) return true;
	}
	return false;
}
function commandHasToken(command, token) {
	const needle = token.toLowerCase();
	if (needle === "") return false;
	const words = tokenize(command);
	if (needle.startsWith("--")) return words.some((word) => {
		const lower = word.toLowerCase();
		return lower === needle || lower.startsWith(`${needle}=`);
	});
	if (/^-[A-Za-z]{1,3}$/.test(token)) return [...token.slice(1)].every((letter) => shortFlagPresent(words, letter));
	if (/[/=><:{]/.test(token)) return command.toLowerCase().replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
	if (/^[A-Za-z][\w]*$/.test(token)) return words.some((word) => {
		const lower = word.toLowerCase();
		return lower === needle || lower.startsWith(`${needle}.`);
	});
	return words.some((word) => word.toLowerCase() === needle);
}
function commandMatchesOther(command, pattern) {
	const tokens = tokenize(pattern);
	if (tokens.length === 0) return false;
	return tokens.every((token) => commandHasToken(command, token));
}
/** True when an enabled blacklist rule matches this command line. */
function commandMatchesBlacklist(command, rules) {
	const text = command.trim();
	if (text === "") return false;
	for (const rule of rules) {
		if (!rule.enabled) continue;
		const pattern = rule.pattern.trim();
		if (pattern === "") continue;
		if (rule.kind === "rm") {
			if (commandMatchesRm(text, pattern)) return true;
			continue;
		}
		if (commandMatchesOther(text, pattern)) return true;
	}
	return false;
}
//#endregion
//#region src/shared/term-assist-prefs.ts
const DEFAULT_TERM_ASSIST_SEPARATOR = "--------";
const DEFAULT_TERM_ASSIST_PREFS = {
	showSeparator: true,
	separatorText: DEFAULT_TERM_ASSIST_SEPARATOR,
	showExplain: true,
	directRunKnownCommands: true,
	blockDestructive: true,
	blacklist: cloneBlacklist(DEFAULT_BLACKLIST)
};
function asBool(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
function resolveSeparatorText(raw) {
	if (typeof raw !== "string") return DEFAULT_TERM_ASSIST_SEPARATOR;
	const text = redactSecrets(raw.replace(/[\r\n]+/g, " ").trim());
	if (text === "") return DEFAULT_TERM_ASSIST_SEPARATOR;
	return text.length > 80 ? text.slice(0, 80) : text;
}
/** Accepts stored JSON, a host POST body, or a partial draft. Always returns a complete prefs object. */
function resolveTermAssistPrefs(raw) {
	if (raw === void 0 || raw === null || typeof raw !== "object" || Array.isArray(raw)) return cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS);
	const source = raw;
	return {
		showSeparator: asBool(source.showSeparator, DEFAULT_TERM_ASSIST_PREFS.showSeparator),
		separatorText: resolveSeparatorText(source.separatorText),
		showExplain: asBool(source.showExplain, DEFAULT_TERM_ASSIST_PREFS.showExplain),
		directRunKnownCommands: asBool(source.directRunKnownCommands, DEFAULT_TERM_ASSIST_PREFS.directRunKnownCommands),
		blockDestructive: asBool(source.blockDestructive, DEFAULT_TERM_ASSIST_PREFS.blockDestructive),
		blacklist: resolveBlacklist(source.blacklist, source.destructiveRules)
	};
}
function cloneTermAssistPrefs(prefs) {
	return {
		showSeparator: prefs.showSeparator,
		separatorText: prefs.separatorText,
		showExplain: prefs.showExplain,
		directRunKnownCommands: prefs.directRunKnownCommands,
		blockDestructive: prefs.blockDestructive,
		blacklist: cloneBlacklist(prefs.blacklist)
	};
}
//#endregion
//#region src/shared/term-assist.ts
const MAX_TERM_ASSIST_INPUT = 4e3;
const MAX_TERM_ASSIST_TRANSCRIPT = 6e3;
/** Common argv0 tokens. Keep lowercase; matching is case-insensitive. */
const KNOWN_SHELL_COMMANDS = /* @__PURE__ */ new Set([
	".",
	"alias",
	"ansible",
	"apt",
	"awk",
	"bash",
	"brew",
	"bun",
	"cargo",
	"cat",
	"cd",
	"chmod",
	"chown",
	"clang",
	"clear",
	"cmake",
	"code",
	"column",
	"cp",
	"curl",
	"cut",
	"date",
	"deno",
	"df",
	"diff",
	"dig",
	"dnf",
	"docker",
	"dsh",
	"du",
	"echo",
	"env",
	"eval",
	"exec",
	"exit",
	"export",
	"false",
	"fc",
	"fd",
	"find",
	"free",
	"fzf",
	"gcc",
	"gh",
	"git",
	"go",
	"grep",
	"head",
	"helm",
	"help",
	"history",
	"htop",
	"id",
	"ip",
	"java",
	"journalctl",
	"jq",
	"kill",
	"killall",
	"kubectl",
	"less",
	"ln",
	"ls",
	"lsof",
	"make",
	"man",
	"mise",
	"mkdir",
	"more",
	"mount",
	"mv",
	"mvn",
	"mysql",
	"nano",
	"netstat",
	"node",
	"nohup",
	"npm",
	"npx",
	"nslookup",
	"nvim",
	"pacman",
	"ping",
	"pipx",
	"bunx",
	"pip",
	"pip3",
	"pnpm",
	"podman",
	"printenv",
	"printf",
	"ps",
	"psql",
	"pwd",
	"python",
	"python3",
	"rg",
	"rm",
	"rsync",
	"rustc",
	"scp",
	"screen",
	"sed",
	"set",
	"sh",
	"shift",
	"sleep",
	"sort",
	"source",
	"ss",
	"ssh",
	"stat",
	"sudo",
	"systemctl",
	"tail",
	"tar",
	"tee",
	"terraform",
	"time",
	"timeout",
	"tmux",
	"top",
	"touch",
	"tr",
	"traceroute",
	"tree",
	"true",
	"type",
	"ulimit",
	"umask",
	"uname",
	"uniq",
	"unzip",
	"uv",
	"vim",
	"wait",
	"watch",
	"wc",
	"wget",
	"which",
	"whoami",
	"xargs",
	"yarn",
	"yum",
	"zip",
	"zsh"
]);
const ASK_EN = /^(please|pls|plz|can you|could you|would you|how (?:do|can|to|would)|what(?:'s| is| are)?|why\b|where\b|who\b|help me\b|i (?:want|need|would)|show me\b|tell me\b|explain\b|list all\b|list the\b)/i;
const ASK_CJK = /(请帮|帮我|帮忙|怎么|如何|为何|为什么|什么是|看看|看一下|解释一下|告诉我|我想|我要|能否|可不可以|麻烦|帮下|求助)/;
const CJK = /[\u3400-\u9fff]/;
const PROMPT_PREFIX = /^(?:[>$%❯➜]\s+|PS\s*>\s+)/;
const HASH_PROMPT = /^#\s+/;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PATH_START = /^(?:\.\.?\/|~\/|\/)/;
const ASK_LINE = /^(?:ASK|NOTE|说明)\s*[:：]\s*/i;
const GREETING = /^(hi|hey|hello|hola|yo|thanks|thank you|thx|ok|okay|bye|goodbye|你好|您好|嗨|谢谢|感谢|再见)(?:[\s!.。！？?,，~～].*)?$/i;
/** English glue words: `sort by disk usage` is a request, not `sort(1)` argv. */
const PROSE_WORD = /^(a|an|the|this|that|these|those|my|all|by|of|from|into|onto|with|using|and|or|to|in|on|for|per|vs|versus|current|directory|folder|files?|lines?|disk|usage|size|largest|smallest|desc|asc|ascending|descending|please)$/i;
const ARGV_TOKEN = /^(?:-{1,2}[\w.-]+|[.~]?\/\S*|\S+\.\w+|\d+|[A-Za-z0-9._*+[\]%@:=,-]+)$/;
/** Strip a pasted prompt character so ` $ ls` still counts as a command. */
function stripTermPrompt(raw) {
	let text = raw.replace(/\r\n/g, "\n").trim();
	text = stripPromptPrefix(text);
	if (text.startsWith("`") && text.endsWith("`") || text.startsWith("\"") && text.endsWith("\"")) text = text.slice(1, -1).trim();
	return text;
}
function stripPromptPrefix(text) {
	const stripped = text.replace(PROMPT_PREFIX, "");
	if (stripped !== text) return stripped;
	if (!text.includes("\n") && HASH_PROMPT.test(text)) return text.replace(HASH_PROMPT, "");
	return text;
}
function firstToken(text) {
	return (text.split(/[\s;|&<>]+/, 1)[0] ?? "").replace(/^\(+/, "").toLowerCase();
}
function isQuestion(text) {
	if (ASK_EN.test(text) || ASK_CJK.test(text)) return true;
	if (text.includes("？")) return true;
	if (/\?\s*$/.test(text) && !text.startsWith("[")) return true;
	return false;
}
function restLooksLikeArgv(text) {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length <= 1) return true;
	if (/[|;&><]/.test(text)) return true;
	const token = firstToken(text);
	if (token === "echo" || token === "printf") return true;
	const rest = words.slice(1);
	if (rest.some((word) => PROSE_WORD.test(word))) return false;
	if (CJK.test(text)) return false;
	return rest.every((word) => ARGV_TOKEN.test(word));
}
/**
* Heuristic: a real argv line goes straight to the PTY.
* Anything that reads as a request is sent to the model.
* First-token allowlist is not enough: `sort by disk usage` starts with `sort`
* but is English, not `sort(1)` flags.
*/
function classifyTermAssistInput(raw) {
	const text = stripTermPrompt(raw);
	if (text === "") return "ask";
	if (isQuestion(text)) return "ask";
	const token = firstToken(text);
	const known = KNOWN_SHELL_COMMANDS.has(token) || token.endsWith(".sh") || token.endsWith(".bash");
	if (CJK.test(text) && !known) return "ask";
	if (known) return restLooksLikeArgv(text) ? "run" : "ask";
	if (PATH_START.test(text) || ENV_ASSIGN.test(text)) return "run";
	return "ask";
}
/**
* Hard veto when an enabled blacklist rule matches.
* Ordinary `rm file` is not blocked unless the user adds a rule for it.
*/
function looksDestructiveCommand(command, prefs) {
	const text = command.trim();
	if (text === "") return false;
	const p = resolveTermAssistPrefs(prefs);
	if (!p.blockDestructive) return false;
	return commandMatchesBlacklist(text, p.blacklist);
}
/** Chinese PTY note when assist refuses a destructive command. Secrets already redacted. */
function destructiveAssistNote(command) {
	const shown = redactSecrets(command.trim().replace(/\s+/g, " "));
	const clip = shown.length > 160 ? `${shown.slice(0, 159)}…` : shown;
	return [
		"已拒绝执行：命令命中助手黑名单，AI 助手不会代为执行，以免误删文件或系统。",
		clip === "" ? "" : `拦截：${clip}`,
		"如确需操作，请在下方终端自行核对路径后手动输入。黑名单可在齿轮设置里增删。"
	].filter((line) => line !== "").join("\n");
}
function sanitizeAssistCommand(raw) {
	let text = raw.replace(/\r\n/g, "\n").trim();
	const fenced = /^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/m.exec(text);
	if (fenced?.[1] !== void 0) text = fenced[1].trim();
	text = text.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, "").replace(/\n```[ \t]*$/, "").trim();
	text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
	text = stripPromptPrefix(text);
	if (text.length > 4e3) text = text.slice(0, MAX_TERM_ASSIST_INPUT).trim();
	return text;
}
/** Live preview: hide unfinished fences so the bar fills with real words. */
function previewAssistText(raw) {
	let text = raw.replace(/\r\n/g, "\n");
	text = text.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, "");
	text = text.replace(/\n```[ \t]*$/, "");
	text = stripPromptPrefix(text);
	if (text.length > 4e3) text = text.slice(0, MAX_TERM_ASSIST_INPUT);
	return text;
}
function stripAskPrefix(text) {
	return text.replace(ASK_LINE, "").trim();
}
function unwrapSpokenEcho(command) {
	const m = /^(echo|printf)\s+(?:-[nEe]+\s+)*(.*)$/.exec(command.trim());
	if (m === null) return null;
	if (m[1] === "printf" && /%[a-zA-Z]/.test(command)) return null;
	const rest = m[2].trim();
	if (rest === "" || /[;|&<>`$()]/.test(rest)) return null;
	const unquoted = rest.replace(/^(['"])([\s\S]*)\1$/, "$2");
	if (GREETING.test(unquoted)) return unquoted;
	if (/\s/.test(unquoted) && /[A-Za-z\u3400-\u9fff]/.test(unquoted) && !unquoted.startsWith("-")) return unquoted;
	return null;
}
function isSpokenReply(text) {
	if (GREETING.test(text)) return true;
	if (ASK_EN.test(text) || ASK_CJK.test(text)) return true;
	if (/[.!?。！？]/.test(text) && text.split(/\s+/).length >= 3) return true;
	return false;
}
/**
* Model output: known argv / path / env assignment → command.
* Greetings, prose, and lone unknown tokens → comment (never executed).
*/
function looksLikeModelCommand(text) {
	if (classifyTermAssistInput(text) === "run") return unwrapSpokenEcho(text) === null;
	if (isSpokenReply(text) || unwrapSpokenEcho(text) !== null) return false;
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length <= 1) return false;
	if (CJK.test(text)) return false;
	return /^[A-Za-z0-9._+-]+(\s+(-{1,2}[\w.-]+|\S+))*$/.test(text) && words.length <= 8;
}
function parseAssistOutput(raw, prefs) {
	const text = sanitizeAssistCommand(raw);
	if (text === "") return { kind: "empty" };
	if (ASK_LINE.test(text)) {
		const note = stripAskPrefix(text);
		return {
			kind: "ask",
			note: note === "" ? text : note
		};
	}
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
	const comments = [];
	let commandLine;
	for (const line of lines) {
		if (commandLine === void 0 && line.startsWith("#")) {
			const body = line.replace(/^\s*#+\s?/, "").trim();
			if (body !== "") comments.push(body);
			continue;
		}
		if (commandLine === void 0) {
			commandLine = line;
			continue;
		}
		break;
	}
	const explain = comments[0] ?? "";
	if (commandLine === void 0) {
		if (comments.length === 0) return { kind: "empty" };
		return {
			kind: "ask",
			note: comments.join("\n")
		};
	}
	if (ASK_LINE.test(commandLine)) {
		const note = stripAskPrefix(commandLine);
		return {
			kind: "ask",
			note: note === "" ? commandLine : note
		};
	}
	const command = commandLine.replace(PROMPT_PREFIX, "").trim();
	if (command === "") return { kind: "empty" };
	const spoken = unwrapSpokenEcho(command);
	if (spoken !== null) return {
		kind: "ask",
		note: spoken
	};
	if (looksDestructiveCommand(command, prefs)) return {
		kind: "ask",
		note: destructiveAssistNote(command)
	};
	if (looksLikeModelCommand(command)) return {
		kind: "command",
		command,
		explain
	};
	if (comments.length > 0) return {
		kind: "ask",
		note: [...comments, command].join("\n")
	};
	return {
		kind: "ask",
		note: text
	};
}
function clipAssistInput(raw) {
	const text = raw.replace(/\r\n/g, "\n").trim();
	return text.length > 4e3 ? text.slice(0, MAX_TERM_ASSIST_INPUT) : text;
}
function clipAssistTranscript(raw) {
	const text = redactSecrets(raw.replace(/\r\n/g, "\n").trim());
	if (text.length <= 6e3) return text;
	return text.slice(text.length - MAX_TERM_ASSIST_TRANSCRIPT);
}
function buildTermAssistUserPrompt(input) {
	const parts = ["请根据下面的用户输入给出命令或 ASK 说明。"];
	if (input.cwd !== void 0 && input.cwd !== "") parts.push("", `工作目录：${input.cwd}`);
	const transcript = input.transcript === void 0 ? "" : clipAssistTranscript(input.transcript);
	if (transcript !== "") parts.push("", "最近终端输出：", transcript);
	parts.push("", "用户输入：", clipAssistInput(input.text));
	return parts.join("\n");
}
//#endregion
//#region src/shared/term-assist-prompt.ts
const MAX_TERM_ASSIST_TEMPLATE_CHARS = 4e3;
const DEFAULT_TERM_ASSIST_TEMPLATE_ZH = [
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 要执行一条命令：先写一行井号注释（一句话说明对应哪句用户输入），下一行再写命令本身。不要 Markdown，不要 $ 前缀。例如：",
	"# 列出当前目录",
	"ls -la",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：不要输出命令，输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 注释必须是一行，写清「用户想做什么」。不要把注释写成可执行命令。不要输出分隔线。",
	"3. 语言必须跟用户输入一致：输入含中文（含中英夹杂）就用中文写注释和 ASK；输入是英文就用英文。不要中英混写回答。",
	"4. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"5. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。即使用户直接粘贴了这类命令，也不要原样回显成可执行行。",
	"6. 若输入已经是完整命令，注释用用户原文（语言仍跟用户一致），下一行原样输出该命令。",
	"7. 文件名、参数保持原文。"
].join("\n");
[
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. To run a command: first one hash comment (one line summarizing the user request), then the command itself. No Markdown, no $ prefix. Example:",
	"# list files in the current directory",
	"ls -la",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): do not emit a command; output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. The comment must be one line stating what they asked for. Do not make the comment itself executable. Do not emit a separator line.",
	"3. Match the user’s language: if the input contains Chinese (including mixed Chinese/English), write the comment and ASK in Chinese; if the input is English, write them in English. Do not mix languages in the reply.",
	"4. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"5. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk. Even if the user pasted such a command, do not echo it as a runnable line.",
	"6. If the input is already a complete command, comment with the user’s text (same language) and echo the command unchanged.",
	"7. Keep file names and flags as written."
].join("\n");
[
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 要执行一条命令：先写一行井号注释（一句话说明对应哪句用户输入），下一行再写命令本身。不要 Markdown，不要 $ 前缀。例如：",
	"# 列出当前目录",
	"ls -la",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：不要输出命令，输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 注释必须是一行，写清「用户想做什么」。不要把注释写成可执行命令。不要输出分隔线。",
	"3. 语言必须跟用户输入一致：输入含中文（含中英夹杂）就用中文写注释和 ASK；输入是英文就用英文。不要中英混写回答。",
	"4. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"5. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。",
	"6. 若输入已经是完整命令，注释用用户原文（语言仍跟用户一致），下一行原样输出该命令。",
	"7. 文件名、参数保持原文。"
].join("\n"), [
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. To run a command: first one hash comment (one line summarizing the user request), then the command itself. No Markdown, no $ prefix. Example:",
	"# list files in the current directory",
	"ls -la",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): do not emit a command; output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. The comment must be one line stating what they asked for. Do not make the comment itself executable. Do not emit a separator line.",
	"3. Match the user’s language: if the input contains Chinese (including mixed Chinese/English), write the comment and ASK in Chinese; if the input is English, write them in English. Do not mix languages in the reply.",
	"4. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"5. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk.",
	"6. If the input is already a complete command, comment with the user’s text (same language) and echo the command unchanged.",
	"7. Keep file names and flags as written."
].join("\n"), [
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 要执行一条命令：先写一行井号注释（一句话说明对应哪句用户输入），下一行再写命令本身。不要 Markdown，不要 $ 前缀。例如：",
	"# 列出当前目录",
	"ls -la",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：不要输出命令，输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 注释必须是一行、用用户的语言，写清「用户想做什么」；不要把注释写成可执行命令。",
	"3. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"4. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。",
	"5. 若输入已经是完整命令，注释用用户原文，下一行原样输出该命令。",
	"6. 文件名、参数保持原文。B 的正文用用户的语言。"
].join("\n"), [
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. To run a command: first one hash comment (one line summarizing the user request), then the command itself. No Markdown, no $ prefix. Example:",
	"# list files in the current directory",
	"ls -la",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): do not emit a command; output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. The comment must be one line, in the user’s language, stating what they asked for. Do not make the comment itself executable.",
	"3. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"4. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk.",
	"5. If the input is already a complete command, comment with the user’s text and echo the command unchanged.",
	"6. Keep file names and flags as written. Write B in the same language as the user."
].join("\n"), [
	"你是工作区终端助手。用户可能输入 shell 命令、描述要做的事，也可能只是打招呼或提问。",
	"先判断输出类型，再按下面的格式只输出一种结果：",
	"A. 可在 bash/zsh 里直接执行的一条命令：只输出命令本身。不要解释、不要 Markdown、不要 $ 前缀。",
	"B. 不能当命令执行的内容（问候、闲聊、知识回答、缺信息、风险说明）：输出",
	"ASK: <回答正文>",
	"规则：",
	"1. 问候或闲聊（例如 hello、你好、谢谢）必须走 B，禁止输出 echo/printf 或任何会报 command not found 的词。",
	"2. 不要编造不存在的文件或参数；优先用当前工作目录里能跑的命令。",
	"3. 不要输出 rm -rf、mkfs、reboot、fork bomb 等破坏性命令；这类请求走 B，说明风险。",
	"4. 若输入已经是完整命令，原样输出该命令（走 A）。",
	"5. 文件名、参数保持原文。B 的正文用用户的语言。"
].join("\n"), [
	"You are a workspace terminal assistant. The user may type a shell command, describe a task, or just greet you / ask a question.",
	"Decide the output type, then emit exactly one of:",
	"A. One command that can run in bash/zsh as-is: output only the command. No explanation, no Markdown, no $ prefix.",
	"B. Anything that must not run as a command (greeting, chit-chat, a knowledge answer, missing facts, a warning): output",
	"ASK: <the reply>",
	"Rules:",
	"1. Greetings and small talk (hello, hi, thanks) MUST use B. Do not emit echo/printf or any token that would print command not found.",
	"2. Do not invent files or flags. Prefer commands that work in the current working directory.",
	"3. Never emit destructive commands (rm -rf, mkfs, reboot, fork bomb). Use B and state the risk.",
	"4. If the input is already a complete command, echo it unchanged (A).",
	"5. Keep file names and flags as written. Write B in the same language as the user."
].join("\n");
/** Host fallback when the client sends nothing. UI should send the locale default. */
const DEFAULT_TERM_ASSIST_TEMPLATE = DEFAULT_TERM_ASSIST_TEMPLATE_ZH;
/** Empty / oversized / non-string input falls back to the built-in Chinese template. */
function resolveTermAssistTemplate(raw, fallback = DEFAULT_TERM_ASSIST_TEMPLATE) {
	if (typeof raw !== "string") return fallback;
	const trimmed = raw.replace(/\r\n/g, "\n").trim();
	if (trimmed === "") return fallback;
	return trimmed.length > 4e3 ? trimmed.slice(0, MAX_TERM_ASSIST_TEMPLATE_CHARS).trim() : trimmed;
}
//#endregion
//#region src/host/term-assist.ts
const GENERATE_TIMEOUT_MS = 3e4;
const ASSIST_MAX_TOKENS = 512;
const PLUGIN_SOURCE = {
	kind: "plugin",
	plugin: "dsh-workbench-plugin"
};
function readLlm$1(ctx) {
	const llm = ctx.llm ?? ctx.get("llm");
	if (llm === void 0 || typeof llm.stream !== "function" || typeof llm.listProviders !== "function") throw new GitError("LLM_UNAVAILABLE");
	return llm;
}
function readPreferredRoute(ctx) {
	const selection = (ctx.agentDefaultModel ?? ctx.get("agentDefaultModel"))?.currentSelection?.();
	if (typeof selection?.provider === "string" && selection.provider !== "" && typeof selection.model === "string" && selection.model !== "") return {
		provider: selection.provider,
		model: selection.model
	};
}
async function resolveRoute$1(ctx) {
	const llm = readLlm$1(ctx);
	const providers = llm.listProviders();
	const preferred = readPreferredRoute(ctx);
	if (preferred !== void 0 && providers.some((provider) => provider.id === preferred.provider)) return preferred;
	const models = {};
	for (const provider of providers) try {
		models[provider.id] = await llm.listModels(provider.id);
	} catch {
		models[provider.id] = [];
	}
	return pickCommitRoute(providers, models, preferred);
}
async function resolveReasoningEffort(llm, route, signal) {
	if (typeof llm.resolveModelInfo !== "function") return "off";
	try {
		return pickCommitReasoningEffort(await llm.resolveModelInfo(route.provider, route.model, signal));
	} catch {
		return;
	}
}
function buildUserMessage(text) {
	return {
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: PLUGIN_SOURCE
	};
}
function summarizeTypes(types) {
	if (types.length === 0) return "没有任何数据";
	const counts = /* @__PURE__ */ new Map();
	for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
	return [...counts.entries()].map(([type, count]) => `${type}×${count}`).join("，");
}
function assistAssembleResult(state) {
	const text = commitAssembleText(state);
	const trace = summarizeTypes(state.types);
	if (state.fail !== "") {
		const code = state.failCode === "" ? "" : ` [${state.failCode}]`;
		return {
			text,
			fail: `${state.fail}${code}（${trace}）`
		};
	}
	if (parseAssistOutput(text).kind !== "empty") return {
		text,
		fail: ""
	};
	if (state.types.length === 0) return {
		text,
		fail: "模型接口没有返回任何数据。请确认会话里已经配好模型，然后重试。"
	};
	if (state.finishKind === "max-tokens") return {
		text,
		fail: state.sawReasoning ? `模型把输出额度用在了思考过程上，没有写出命令。（${trace}）` : `模型输出被截断，没有完整命令。（${trace}）`
	};
	if (state.sawReasoning) return {
		text,
		fail: `模型只返回了思考过程，没有写出命令。（${trace}）`
	};
	if (state.finishKind === "") return {
		text,
		fail: `模型调用没有正常结束。（${trace}）`
	};
	return {
		text,
		fail: `模型没有返回可用的命令。（${trace}）`
	};
}
/** Stream a shell command (or ASK note) as the model writes it. */
async function* streamTermAssist(ctx, options) {
	const text = clipAssistInput(options.text);
	if (text === "") throw new GitError("LLM_FAILED", "请先输入命令，或用一句话描述你想做什么。");
	const signal = options.signal;
	const system = resolveTermAssistTemplate(options.template, DEFAULT_TERM_ASSIST_TEMPLATE);
	const llm = readLlm$1(ctx);
	const route = await resolveRoute$1(ctx);
	const reasoningEffort = await resolveReasoningEffort(llm, route, signal);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, GENERATE_TIMEOUT_MS);
	const onAbort = () => {
		controller.abort();
	};
	signal?.addEventListener("abort", onAbort);
	const user = buildTermAssistUserPrompt({
		text,
		cwd: options.cwd,
		transcript: options.transcript === void 0 ? void 0 : clipAssistTranscript(options.transcript)
	});
	try {
		const state = createCommitAssemble();
		let last = "";
		for await (const chunk of llm.stream({
			provider: route.provider,
			model: route.model,
			system,
			messages: [buildUserMessage(user)],
			maxTokens: ASSIST_MAX_TOKENS,
			temperature: .1,
			purpose: "session-title",
			...reasoningEffort === void 0 ? {} : { reasoningEffort },
			signal: controller.signal
		})) {
			if (controller.signal.aborted) break;
			applyCommitChunk(state, chunk);
			const visible = previewAssistText(previewCommitMessage(commitAssembleText(state)));
			if (visible !== last) {
				last = visible;
				yield {
					type: "delta",
					text: redactSecrets(visible)
				};
			}
		}
		if (signal?.aborted) throw new GitError("LLM_FAILED", "生成已取消。");
		const assembled = assistAssembleResult(state);
		if (assembled.fail !== "") throw new GitError("LLM_FAILED", `${assembled.fail} 路由：${route.provider} / ${route.model}`);
		yield {
			type: "done",
			message: redactSecrets(sanitizeDone(assembled.text, options.prefs))
		};
	} catch (error) {
		if (error instanceof GitError) throw error;
		if (controller.signal.aborted) throw new GitError("LLM_FAILED", signal?.aborted ? "生成已取消。" : "生成超时或已取消，请稍后重试。");
		throw new GitError("LLM_FAILED", error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
function sanitizeDone(raw, prefs) {
	const parsed = parseAssistOutput(raw, resolveTermAssistPrefs(prefs));
	if (parsed.kind === "command") return parsed.explain === "" ? parsed.command : `# ${parsed.explain}\n${parsed.command}`;
	if (parsed.kind === "ask") return `ASK: ${parsed.note}`;
	return previewAssistText(raw).trim();
}
//#endregion
//#region src/host/git-nearby.ts
/** True when this directory itself has a `.git` file or folder (does not walk up). */
async function hasGitRoot(dir) {
	try {
		const info = await stat(join(dir, ".git"));
		return info.isDirectory() || info.isFile();
	} catch {
		return false;
	}
}
async function realOrSelf(dir) {
	try {
		return await realpath(dir);
	} catch {
		return dir;
	}
}
function childIdOf(id) {
	const parsed = parseNearbyRepoId(id);
	return parsed?.kind === "child" ? parsed.child ?? null : null;
}
/**
* Resolve a workspace-relative folder / symlink / submodule to its git cwd.
* The id must stay a safe relative path under the workspace; the target may
* sit outside when the workspace entry itself is a symlink.
*/
async function resolveChildGitPath(workspace, id) {
	const child = childIdOf(id);
	if (child === null) return null;
	let rel;
	try {
		rel = assertSafeWorkspacePath(workspace, child);
	} catch {
		return null;
	}
	if (rel === "") return null;
	try {
		return await realpath(join(workspace, rel));
	} catch {
		return null;
	}
}
async function classifyChild(workspace, id) {
	const child = childIdOf(id);
	if (child === null) return null;
	let rel;
	try {
		rel = assertSafeWorkspacePath(workspace, child);
	} catch {
		return null;
	}
	if (rel === "") return null;
	const full = join(workspace, rel);
	const real = await resolveChildGitPath(workspace, rel);
	if (real === null) return null;
	if (!await hasGitRoot(real)) return null;
	let kind = "child";
	try {
		if ((await lstat(full)).isSymbolicLink()) kind = "link";
		else if ((await lstat(join(real, ".git"))).isFile()) kind = "submodule";
	} catch {
		kind = "child";
	}
	return {
		id: rel,
		kind,
		name: rel.includes("/") ? rel : folderNameFromPath(rel) || rel,
		isRepo: true
	};
}
/** `path =` entries from `.gitmodules`. Ignores comments and unknown keys. */
function parseGitmodulePaths(text) {
	const paths = [];
	const seen = /* @__PURE__ */ new Set();
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
		const match = /^path\s*=\s*(.+)$/.exec(line);
		if (match === null) continue;
		let value = match[1].trim();
		if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2 || value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1);
		if (value === "" || seen.has(value)) continue;
		seen.add(value);
		paths.push(value);
	}
	return paths;
}
async function submodulePaths(workspace) {
	try {
		return parseGitmodulePaths(await readFile(join(workspace, ".gitmodules"), "utf8"));
	} catch {
		return [];
	}
}
async function scanNearbyGit(workspace, signal) {
	const root = await realOrSelf(workspace);
	const workspaceName = folderNameFromPath(root) || basename(root) || root;
	const current = {
		id: ".",
		kind: "current",
		name: workspaceName,
		isRepo: await hasGitRoot(root)
	};
	let parent = null;
	const parentDir = dirname(root);
	if (parentDir !== root && parentDir !== "") {
		if (signal?.aborted) return {
			workspaceName,
			current,
			parent: null,
			children: []
		};
		if (await hasGitRoot(parentDir)) parent = {
			id: "..",
			kind: "parent",
			name: folderNameFromPath(parentDir) || parentDir,
			isRepo: true
		};
	}
	const childrenById = /* @__PURE__ */ new Map();
	const consider = async (id) => {
		if (signal?.aborted) return;
		const found = await classifyChild(root, id);
		if (found === null || childrenById.has(found.id)) return;
		childrenById.set(found.id, found);
	};
	let names = [];
	try {
		names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name);
	} catch {
		names = [];
	}
	for (const name of names) {
		if (signal?.aborted) break;
		if (isSkippedChildName(name)) continue;
		await consider(name);
	}
	for (const path of await submodulePaths(root)) {
		if (signal?.aborted) break;
		await consider(path);
	}
	const children = [...childrenById.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
	return {
		workspaceName,
		current,
		parent,
		children
	};
}
/**
* Resolve a nearby-repo id to an absolute git cwd.
* `undefined` / `.` → workspace. `..` → parent only if it is a git root.
* Any other id must be a child folder, symlink, or registered submodule that is a git root.
*/
async function resolveNearbyGitPath(workspace, repoId) {
	const parsed = parseNearbyRepoId(repoId);
	if (parsed === null) throw new GitError("UNKNOWN_REPO");
	const root = await realOrSelf(workspace);
	if (parsed.kind === "current") return root;
	if (parsed.kind === "parent") {
		const parentDir = dirname(root);
		if (parentDir === root || parentDir === "") throw new GitError("UNKNOWN_REPO");
		if (!await hasGitRoot(parentDir)) throw new GitError("UNKNOWN_REPO");
		return realOrSelf(parentDir);
	}
	const child = parsed.child;
	if (child === void 0) throw new GitError("UNKNOWN_REPO");
	const found = await classifyChild(root, child);
	if (found === null) throw new GitError("UNKNOWN_REPO");
	const real = await resolveChildGitPath(root, found.id);
	if (real === null) throw new GitError("UNKNOWN_REPO");
	return real;
}
//#endregion
//#region src/host/workspace.ts
function readWorkspaceRegistry(ctx) {
	return ctx.get("workspaceRegistry");
}
/** Resolve a workspace directory. Prefer an explicit id, then a single registered workspace. */
function resolveWorkspacePath(ctx, workspaceId, fallbackCwd) {
	const registry = readWorkspaceRegistry(ctx);
	if (workspaceId !== void 0 && workspaceId !== "") {
		const found = registry?.get(workspaceId);
		if (found === void 0) throw new GitError("UNKNOWN_WORKSPACE");
		return found.path;
	}
	const listed = registry?.list() ?? [];
	if (listed.length === 1) return listed[0].path;
	if (fallbackCwd !== void 0 && fallbackCwd !== "") return fallbackCwd;
	if (listed.length === 0) throw new GitError("NO_WORKSPACE");
	throw new GitError("NO_WORKSPACE");
}
//#endregion
//#region src/shared/types.ts
const EXTERNAL_EDITOR_IDS = [
	"cursor",
	"vscode",
	"vscode-insiders",
	"codium",
	"windsurf",
	"zed",
	"system"
];
function isExternalEditorId(value) {
	return typeof value === "string" && EXTERNAL_EDITOR_IDS.includes(value);
}
//#endregion
//#region src/host/external-open.ts
const CATALOG = [
	{
		id: "cursor",
		label: "Cursor",
		bins: {
			linux: ["cursor"],
			darwin: ["cursor"],
			win32: ["cursor.cmd", "cursor"]
		}
	},
	{
		id: "vscode",
		label: "VS Code",
		bins: {
			linux: ["code"],
			darwin: ["code"],
			win32: ["code.cmd", "code"]
		}
	},
	{
		id: "vscode-insiders",
		label: "VS Code Insiders",
		bins: {
			linux: ["code-insiders"],
			darwin: ["code-insiders"],
			win32: ["code-insiders.cmd", "code-insiders"]
		}
	},
	{
		id: "codium",
		label: "VSCodium",
		bins: {
			linux: ["codium"],
			darwin: ["codium"],
			win32: ["codium.cmd", "codium"]
		}
	},
	{
		id: "windsurf",
		label: "Windsurf",
		bins: {
			linux: ["windsurf"],
			darwin: ["windsurf"],
			win32: ["windsurf.cmd", "windsurf"]
		}
	},
	{
		id: "zed",
		label: "Zed",
		bins: {
			linux: ["zed", "zeditor"],
			darwin: ["zed"],
			win32: ["zed.exe", "zed"]
		}
	},
	{
		id: "system",
		label: "System",
		bins: {
			linux: ["xdg-open"],
			darwin: ["open"],
			win32: ["explorer.exe"]
		}
	}
];
const SETTLE_MS = 600;
function binsFor(spec, platform) {
	return spec.bins[platform] ?? spec.bins.linux ?? [];
}
function looksLikeBareName(bin) {
	return /^[A-Za-z0-9._-]+$/.test(bin);
}
/** Resolve a catalog binary on PATH. Never accepts a user-supplied command string. */
async function whichOnPath(bin, envPath = process.env.PATH ?? "") {
	if (!looksLikeBareName(bin)) return void 0;
	const dirs = envPath.split(delimiter).filter((dir) => dir !== "");
	const win = process.platform === "win32";
	const names = win && !bin.includes(".") ? [
		bin,
		`${bin}.cmd`,
		`${bin}.exe`
	] : [bin];
	const mode = win ? constants.F_OK : constants.X_OK;
	for (const dir of dirs) for (const name of names) {
		const full = join(dir, name);
		try {
			await access(full, mode);
			return full;
		} catch {}
	}
}
function launchDetached(bin, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, [...args], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			env: process.env
		});
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) {
				reject(error);
				return;
			}
			child.unref();
			resolve();
		};
		const timer = setTimeout(() => {
			finish();
		}, SETTLE_MS);
		child.on("error", (error) => {
			finish(error.code === "ENOENT" ? new GitError("EDITOR_NOT_FOUND") : new GitError("EDITOR_FAILED"));
		});
		child.on("exit", (code) => {
			if (code === 0 || code === null) {
				finish();
				return;
			}
			finish(new GitError("EDITOR_FAILED"));
		});
	});
}
/** Detect allowlisted local editors and open a workspace-jailed path in one of them. */
var ExternalOpen = class {
	fs;
	deps;
	constructor(fs, deps = {}) {
		this.fs = fs;
		this.deps = deps;
	}
	platform() {
		return this.deps.platform ?? process.platform;
	}
	async resolveBin(spec) {
		const lookup = this.deps.which ?? whichOnPath;
		for (const bin of binsFor(spec, this.platform())) {
			const found = await lookup(bin);
			if (found !== void 0) return found;
		}
	}
	async list() {
		const editors = [];
		for (const spec of CATALOG) editors.push({
			id: spec.id,
			label: spec.label,
			available: await this.resolveBin(spec) !== void 0
		});
		return { editors };
	}
	async open(root, filePath = "", app) {
		const spec = await this.pickSpec(app);
		const bin = await this.resolveBin(spec);
		if (bin === void 0) throw new GitError("EDITOR_NOT_FOUND");
		const abs = await this.fs.resolveAbsolute(root, filePath);
		await (this.deps.launch ?? launchDetached)(bin, [abs]);
		return {
			app: spec.id,
			path: filePath.trim() === "." ? "" : filePath.trim()
		};
	}
	/** Open the system file manager at this workspace path (Finder / Explorer / Files). */
	async reveal(root, filePath = "") {
		const abs = await this.fs.resolveAbsolute(root, filePath);
		const lookup = this.deps.which ?? whichOnPath;
		const launch = this.deps.launch ?? launchDetached;
		const platform = this.platform();
		const rel = filePath.trim() === "." ? "" : filePath.trim();
		if (platform === "darwin") {
			const bin = await lookup("open");
			if (bin === void 0) throw new GitError("FS_REVEAL_FAILED");
			await launch(bin, ["-R", abs]);
			return { path: rel };
		}
		if (platform === "win32") {
			const bin = await lookup("explorer.exe") ?? await lookup("explorer");
			if (bin === void 0) throw new GitError("FS_REVEAL_FAILED");
			await launch(bin, [`/select,${abs}`]);
			return { path: rel };
		}
		const bin = await lookup("xdg-open");
		if (bin === void 0) throw new GitError("FS_REVEAL_FAILED");
		let target = abs;
		try {
			if (!(await stat(abs)).isDirectory()) target = dirname(abs);
		} catch {
			target = dirname(abs);
		}
		await launch(bin, [target]);
		return { path: rel };
	}
	async pickSpec(app) {
		if (app !== void 0 && app !== "") {
			if (!isExternalEditorId(app)) throw new GitError("EDITOR_UNKNOWN");
			const chosen = CATALOG.find((item) => item.id === app);
			if (chosen === void 0) throw new GitError("EDITOR_UNKNOWN");
			return chosen;
		}
		for (const id of EXTERNAL_EDITOR_IDS) {
			const spec = CATALOG.find((item) => item.id === id);
			if (spec === void 0) continue;
			if (await this.resolveBin(spec) !== void 0) return spec;
		}
		throw new GitError("EDITOR_NOT_FOUND");
	}
};
//#endregion
//#region src/shared/new-file-path.ts
function sanitizeTermId(value) {
	if (typeof value !== "string") return "main";
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.length > 64) return "main";
	if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return "main";
	return trimmed;
}
function termSessionKey(workspaceId, termId) {
	return `${workspaceId}::${sanitizeTermId(termId)}`;
}
//#endregion
//#region src/host/terminal.ts
const MAX_BUFFER = 2e5;
const MAX_WRITE = 256e3;
const ALLOWED_SHELL = /^(bash|zsh|sh|dash|pwsh|powershell|cmd)$/;
const ALLOWED_ABS = /^\/(bin|usr\/bin|usr\/local\/bin)\/(bash|zsh|sh|dash)$/;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
function looksLikeAllowedShell(path) {
	const trimmed = path.trim();
	if (ALLOWED_ABS.test(trimmed)) return true;
	if (process.platform === "win32" && /\.exe$/i.test(trimmed) && /[\\/]/.test(trimmed)) return true;
	return !trimmed.includes("/") && !trimmed.includes("\\") && ALLOWED_SHELL.test(trimmed);
}
async function pickShell(env = process.env, exists) {
	const check = exists ?? (async (abs) => {
		try {
			await access(abs, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
	const preferred = env.SHELL !== void 0 && looksLikeAllowedShell(env.SHELL) ? [env.SHELL] : [];
	const winCandidates = process.platform === "win32" ? [
		"C:/Program Files/Git/bin/bash.exe",
		"C:/Program Files/Git/usr/bin/bash.exe",
		join(process.env.SYSTEMROOT ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe")
	] : [];
	const candidates = [
		...preferred,
		...winCandidates,
		"/bin/bash",
		"/usr/bin/bash",
		"/bin/zsh",
		"/usr/bin/zsh",
		"/bin/sh",
		"/usr/bin/sh"
	];
	const seen = /* @__PURE__ */ new Set();
	for (const item of candidates) {
		if (seen.has(item)) continue;
		seen.add(item);
		if (!looksLikeAllowedShell(item)) continue;
		const abs = item.startsWith("/") || process.platform === "win32" && /^[a-zA-Z]:[\\/]/.test(item) ? item : void 0;
		if (abs === void 0) continue;
		if (await check(abs)) return abs;
	}
	throw new GitError("TERM_NO_SHELL");
}
function clampSize(value, min, max, fallback) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}
function termColorEnv(base, cwd) {
	return {
		...base,
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		PWD: cwd
	};
}
function appendBuffer(current, chunk) {
	const next = current + chunk;
	return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
}
function writeSse(res, event) {
	res.write(`data: ${JSON.stringify(event)}\n\n`);
}
async function loadNodePty() {
	try {
		return await import("node-pty");
	} catch {
		const candidates = [join(homedir(), ".dsh/profiles/node_modules/node-pty"), join(process.cwd(), "node_modules/node-pty")];
		for (const dir of candidates) try {
			return createRequire(join(dir, "package.json"))(dir);
		} catch {}
		throw new GitError("TERM_FAILED");
	}
}
async function defaultSpawnPty(bin, cwd, cols, rows, env) {
	return (await loadNodePty()).spawn(bin, [], {
		name: "xterm-256color",
		cols,
		rows,
		cwd,
		env: termColorEnv(env, cwd)
	});
}
/** One real PTY per workspace terminal tab. Output is redacted before it reaches the browser. */
var TerminalHub = class {
	deps;
	sessions = /* @__PURE__ */ new Map();
	constructor(deps = {}) {
		this.deps = deps;
	}
	key(workspaceId, termId) {
		return termSessionKey(workspaceId, termId);
	}
	async attach(workspaceId, cwd, res, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId) {
		const session = await this.ensure(workspaceId, cwd, cols, rows, termId);
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "keep-alive"
		});
		writeSse(res, {
			type: "hello",
			cwd: session.cwd,
			shell: basename(session.shell),
			cols: session.cols,
			rows: session.rows
		});
		if (session.buffer !== "") writeSse(res, {
			type: "out",
			text: session.buffer
		});
		const send = (event) => {
			writeSse(res, event);
		};
		session.listeners.add(send);
		const ping = setInterval(() => {
			res.write(": ping\n\n");
		}, 15e3);
		const drop = () => {
			clearInterval(ping);
			session.listeners.delete(send);
		};
		res.on("close", drop);
		res.on("error", drop);
	}
	async write(workspaceId, cwd, data, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId) {
		if (data.length > MAX_WRITE) throw new GitError("BAD_REQUEST");
		(await this.ensure(workspaceId, cwd, cols, rows, termId)).pty.write(data);
		return { ok: true };
	}
	async resize(workspaceId, cwd, cols, rows, termId) {
		const nextCols = clampSize(cols, 10, 400, DEFAULT_COLS);
		const nextRows = clampSize(rows, 4, 200, DEFAULT_ROWS);
		const session = await this.ensure(workspaceId, cwd, nextCols, nextRows, termId);
		session.cols = nextCols;
		session.rows = nextRows;
		session.pty.resize(nextCols, nextRows);
		return {
			ok: true,
			cols: nextCols,
			rows: nextRows
		};
	}
	async interrupt(workspaceId, cwd, termId) {
		(await this.ensure(workspaceId, cwd, DEFAULT_COLS, DEFAULT_ROWS, termId)).pty.write("");
		return { ok: true };
	}
	async close(workspaceId, termId) {
		this.kill(this.key(workspaceId, termId));
		return { ok: true };
	}
	async restart(workspaceId, cwd, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId) {
		const key = this.key(workspaceId, termId);
		const existing = this.sessions.get(key);
		const listeners = existing === void 0 ? /* @__PURE__ */ new Set() : new Set(existing.listeners);
		if (existing !== void 0) {
			existing.listeners.clear();
			this.sessions.delete(key);
			try {
				existing.pty.kill();
			} catch {}
		}
		const session = await this.ensure(workspaceId, cwd, cols, rows, termId);
		for (const listener of listeners) session.listeners.add(listener);
		return {
			cwd: session.cwd,
			shell: basename(session.shell),
			cols: session.cols,
			rows: session.rows
		};
	}
	disposeAll() {
		for (const id of [...this.sessions.keys()]) this.kill(id);
	}
	kill(key) {
		const session = this.sessions.get(key);
		if (session === void 0) return;
		this.sessions.delete(key);
		try {
			session.pty.kill();
		} catch {}
		for (const listener of session.listeners) listener({
			type: "exit",
			code: null
		});
		session.listeners.clear();
	}
	emit(session, event) {
		if (event.type === "out") {
			const text = redactSecrets(event.text);
			session.buffer = appendBuffer(session.buffer, text);
			const safe = {
				...event,
				text
			};
			for (const listener of session.listeners) listener(safe);
			return;
		}
		for (const listener of session.listeners) listener(event);
	}
	async ensure(workspaceId, cwd, cols, rows, termId) {
		const key = this.key(workspaceId, termId);
		const existing = this.sessions.get(key);
		if (existing !== void 0 && existing.cwd === cwd) return existing;
		if (existing !== void 0) this.kill(key);
		const shell = await pickShell(this.deps.env ?? process.env, this.deps.exists);
		const spawnPty = this.deps.spawnPty ?? defaultSpawnPty;
		const nextCols = clampSize(cols, 10, 400, DEFAULT_COLS);
		const nextRows = clampSize(rows, 4, 200, DEFAULT_ROWS);
		const pty = await spawnPty(shell, cwd, nextCols, nextRows, this.deps.env ?? process.env);
		const session = {
			cwd,
			shell,
			pty,
			buffer: "",
			cols: nextCols,
			rows: nextRows,
			listeners: /* @__PURE__ */ new Set()
		};
		this.sessions.set(key, session);
		pty.onData((chunk) => {
			this.emit(session, {
				type: "out",
				text: chunk
			});
		});
		pty.onExit((event) => {
			if (this.sessions.get(key) !== session) return;
			this.emit(session, {
				type: "exit",
				code: event.exitCode
			});
			this.sessions.delete(key);
		});
		return session;
	}
};
//#endregion
//#region src/shared/version.ts
const PLUGIN_NAME = "dsh-workbench-plugin";
function parseSemver(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (match === null) return null;
	return [
		Number(match[1]),
		Number(match[2]),
		Number(match[3])
	];
}
/** True when `latest` is a higher x.y.z than `current`. Garbage versions never trigger an upgrade. */
function isNewer(latest, current) {
	const next = parseSemver(latest);
	const now = parseSemver(current);
	if (next === null || now === null) return false;
	if (next[0] !== now[0]) return next[0] > now[0];
	if (next[1] !== now[1]) return next[1] > now[1];
	return next[2] > now[2];
}
function upgradeCommand(latest) {
	return `dsh plugin --profile web add ${PLUGIN_NAME}@${latest}`;
}
//#endregion
//#region src/host/update-check.ts
const REGISTRY_LATEST = `https://registry.npmjs.org/${PLUGIN_NAME}/latest`;
const CACHE_MS = 216e5;
const FETCH_MS = 4e3;
let cached = null;
function readInstalledVersion(from = fileURLToPath(import.meta.url)) {
	let dir = dirname(from);
	for (let i = 0; i < 8; i++) {
		try {
			const raw = readFileSync(join(dir, "package.json"), "utf8");
			const pkg = JSON.parse(raw);
			if (pkg.name === "dsh-workbench-plugin" && typeof pkg.version === "string" && pkg.version !== "") return pkg.version;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return "0.0.0";
}
async function defaultFetchLatest(signal) {
	const response = await fetch(REGISTRY_LATEST, {
		signal,
		headers: { accept: "application/json" }
	});
	if (!response.ok) return null;
	const body = await response.json();
	if (typeof body !== "object" || body === null || !("version" in body)) return null;
	const version = body.version;
	return typeof version === "string" && version !== "" ? version : null;
}
function snapshot(current, latest) {
	const outdated = latest !== null && isNewer(latest, current);
	return {
		name: PLUGIN_NAME,
		current,
		latest,
		outdated,
		command: latest === null ? `dsh plugin --profile web add ${PLUGIN_NAME}` : upgradeCommand(latest)
	};
}
/** Compare the installed plugin with npm latest. Network/registry failures stay quiet. */
async function checkPluginUpdate(deps = {}) {
	const installed = readInstalledVersion();
	const now = deps.now ?? Date.now;
	if (cached !== null && now() - cached.at < CACHE_MS && cached.value.current === installed) return cached.value;
	const fetchLatest = deps.fetchLatest ?? defaultFetchLatest;
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, FETCH_MS);
	let latest = null;
	try {
		latest = await fetchLatest(controller.signal);
	} catch {
		latest = null;
	} finally {
		clearTimeout(timer);
	}
	const value = snapshot(installed, latest);
	if (latest !== null) cached = {
		at: now(),
		value
	};
	return value;
}
//#endregion
//#region src/shared/usage-format.ts
/** Strip a trailing /v1 so DeepSeek-style `/user/balance` can be tried at the origin. */
function billingOrigin(baseURL) {
	return baseURL.replace(/\/+$/, "").replace(/\/v1$/i, "");
}
function uniqueUrls(urls) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const url of urls) {
		if (url === "" || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}
/** Candidate billing URLs for one configured endpoint. Never includes credentials. */
function billingUrls(baseURL) {
	const origin = billingOrigin(baseURL);
	const raw = baseURL.replace(/\/+$/, "");
	return uniqueUrls([
		`${origin}/user/balance`,
		`${raw}/user/balance`,
		`${raw}/user/info`,
		`${origin}/user/info`,
		`${raw}/dashboard/billing/credit_grants`,
		`${origin}/v1/dashboard/billing/credit_grants`
	]);
}
function asAmount(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		if (Number.isInteger(value)) return String(value);
		return String(value);
	}
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return void 0;
	return trimmed;
}
function rowFromRecord(record, fallbackCurrency = "") {
	const total = asAmount(record.total_balance ?? record.totalBalance ?? record.total_available ?? record.balance ?? record.credit ?? record.total);
	if (total === void 0) return null;
	const currency = typeof record.currency === "string" && record.currency.trim() !== "" ? record.currency.trim() : fallbackCurrency;
	const granted = asAmount(record.granted_balance ?? record.grantedBalance ?? record.total_granted);
	const toppedUp = asAmount(record.topped_up_balance ?? record.toppedUpBalance ?? record.chargeBalance);
	const used = asAmount(record.total_used ?? record.used ?? record.used_balance);
	return {
		currency,
		total,
		...granted === void 0 ? {} : { granted },
		...toppedUp === void 0 ? {} : { toppedUp },
		...used === void 0 ? {} : { used }
	};
}
/**
* Accept known provider billing JSON. Unknown shapes return null so the
* caller can try the next URL instead of showing a blank number.
*/
function parseBalanceBody(body) {
	if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
	const root = body;
	const nested = typeof root.data === "object" && root.data !== null && !Array.isArray(root.data) ? root.data : void 0;
	const infos = Array.isArray(root.balance_infos) ? root.balance_infos : Array.isArray(nested?.balance_infos) ? nested.balance_infos : void 0;
	if (infos !== void 0) {
		const balances = [];
		for (const item of infos) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
			const row = rowFromRecord(item, "CNY");
			if (row !== null) balances.push(row);
		}
		if (balances.length === 0) return null;
		const available = root.is_available;
		return {
			balances,
			...typeof available === "boolean" ? { accountAvailable: available } : {}
		};
	}
	const source = nested ?? root;
	const row = rowFromRecord(source);
	if (row === null) return null;
	const status = source.status;
	const accountAvailable = typeof root.is_available === "boolean" ? root.is_available : typeof status === "string" && status !== "" ? !/disabled|banned|exhausted|insufficient/i.test(status) : void 0;
	return {
		balances: [row],
		...accountAvailable === void 0 ? {} : { accountAvailable }
	};
}
//#endregion
//#region src/host/provider-usage.ts
const FETCH_TIMEOUT_MS = 8e3;
const DEFAULT_DEEPSEEK_BASE = "https://api.deepseek.com";
const DEEPSEEK_PROVIDER = "deepseek-official";
function readLlm(ctx) {
	const llm = ctx.llm ?? ctx.get("llm");
	if (llm === void 0 || typeof llm.listProviders !== "function") throw new GitError("LLM_UNAVAILABLE");
	return llm;
}
function defaultRoute(ctx) {
	const selection = (ctx.agentDefaultModel ?? ctx.get("agentDefaultModel"))?.currentSelection?.();
	if (typeof selection?.provider === "string" && selection.provider !== "" && typeof selection.model === "string" && selection.model !== "") return {
		provider: selection.provider,
		model: selection.model,
		...typeof selection.reasoningEffort === "string" && selection.reasoningEffort !== "" ? { reasoningEffort: selection.reasoningEffort } : {},
		source: "default"
	};
}
function loggedRoute(agent) {
	const config = (agent?.session?.requestHeader?.())?.config;
	if (typeof config?.provider !== "string" || config.provider === "") return void 0;
	if (typeof config.model !== "string" || config.model === "") return void 0;
	return {
		provider: config.provider,
		model: config.model,
		...typeof config.reasoningEffort === "string" && config.reasoningEffort !== "" ? { reasoningEffort: config.reasoningEffort } : {}
	};
}
function agentFor(ctx, sessionId) {
	if (sessionId === void 0 || sessionId === "") return void 0;
	const found = ctx.get("agents")?.get?.(sessionId);
	if (found !== void 0) return found;
	return (ctx.sessions ?? ctx.get("sessions"))?.binding?.(sessionId);
}
function resolveRoute(ctx, sessionId) {
	const logged = loggedRoute(agentFor(ctx, sessionId));
	if (logged !== void 0) return {
		...logged,
		source: "session"
	};
	const fallback = defaultRoute(ctx);
	if (fallback !== void 0) return fallback;
	throw new GitError("LLM_UNAVAILABLE");
}
function settingsSection(ctx, ns) {
	const settings = ctx.get("settings");
	try {
		return settings?.get?.(ns);
	} catch {
		return;
	}
}
function asRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	return value;
}
function asNonEmpty(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function connectionFor(ctx, provider) {
	if (provider === DEEPSEEK_PROVIDER) {
		const section = asRecord(settingsSection(ctx, "llm-deepseek"));
		return {
			baseURL: asNonEmpty(section?.baseURL) ?? DEFAULT_DEEPSEEK_BASE,
			apiKeyEnv: asNonEmpty(section?.apiKeyEnv) ?? "DEEPSEEK_API_KEY"
		};
	}
	const profile = asRecord(asRecord(asRecord(settingsSection(ctx, "llm-pi-ai"))?.providers)?.[provider]);
	return {
		baseURL: asNonEmpty(profile?.baseURL) ?? "",
		apiKeyEnv: asNonEmpty(profile?.apiKeyEnv) ?? ""
	};
}
async function resolveApiKey(ctx, ref) {
	if (ref === "" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return void 0;
	const credentials = ctx.get("credentials");
	if (credentials !== void 0 && typeof credentials.resolve === "function") try {
		return asNonEmpty((await credentials.resolve(ref))?.value);
	} catch {
		return;
	}
	const ambient = asNonEmpty(ctx.get("launchEnvironment")?.get?.(ref)?.value);
	if (ambient !== void 0) return ambient;
	return asNonEmpty(process.env[ref]);
}
function providerNameOf(llm, provider) {
	const match = (llm.listConfigurableProviders?.() ?? []).find((item) => item.provider === provider);
	if (match !== void 0 && match.displayName.trim() !== "") return match.displayName;
	if (provider === DEEPSEEK_PROVIDER) return "DeepSeek";
	return provider;
}
async function modelNameOf(llm, provider, model, signal) {
	try {
		const info = await llm.resolveModelInfo?.(provider, model, signal);
		if (typeof info?.name === "string" && info.name.trim() !== "") return info.name;
	} catch {}
	try {
		const match = (await llm.listModels(provider)).find((item) => item.id === model);
		if (typeof match?.name === "string" && match.name.trim() !== "") return match.name;
	} catch {}
	return model;
}
function endpointLabel(baseURL) {
	if (baseURL === "") return void 0;
	try {
		const url = new URL(baseURL.includes("://") ? baseURL : `https://${baseURL}`);
		return redactSecrets(`${url.host}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")}`);
	} catch {
		return redactSecrets(billingOrigin(baseURL));
	}
}
async function readJson$1(response) {
	const text = await response.text();
	if (text.trim() === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
async function queryBalance(baseURL, apiKey, fetchImpl, signal) {
	const urls = billingUrls(baseURL);
	if (urls.length === 0) return {
		status: "unsupported",
		balances: []
	};
	let sawAuth = false;
	let sawHttp = false;
	for (const url of urls) {
		if (signal.aborted) break;
		try {
			const response = await fetchImpl(url, {
				method: "GET",
				signal,
				headers: {
					accept: "application/json",
					authorization: `Bearer ${apiKey}`,
					"user-agent": "dsh-workbench-plugin/usage (+https://github.com/loadingvx/deepseek-harness-workbench-plugin)"
				}
			});
			if (response.status === 401 || response.status === 403) {
				sawAuth = true;
				continue;
			}
			if (response.status === 404 || response.status === 405) continue;
			if (!response.ok) {
				sawHttp = true;
				continue;
			}
			const parsed = parseBalanceBody(await readJson$1(response));
			if (parsed === null) continue;
			return {
				status: "ok",
				balances: parsed.balances,
				accountAvailable: parsed.accountAvailable
			};
		} catch (error) {
			if (signal.aborted) break;
			if (error instanceof Error && error.name === "AbortError") break;
			sawHttp = true;
		}
	}
	if (sawAuth) return {
		status: "auth",
		balances: []
	};
	if (sawHttp) return {
		status: "failed",
		balances: []
	};
	return {
		status: "unsupported",
		balances: []
	};
}
function timeoutSignal(parent) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, FETCH_TIMEOUT_MS);
	const onParent = () => {
		controller.abort();
	};
	parent?.addEventListener("abort", onParent);
	if (parent?.aborted) controller.abort();
	return {
		signal: controller.signal,
		cancel: () => {
			clearTimeout(timer);
			parent?.removeEventListener("abort", onParent);
		}
	};
}
/** Current session model plus that provider's account balance. Never returns secrets. */
async function readProviderUsage(ctx, sessionId, options) {
	const llm = readLlm(ctx);
	const route = resolveRoute(ctx, sessionId);
	const connection = connectionFor(ctx, route.provider);
	const [modelName, apiKey] = await Promise.all([modelNameOf(llm, route.provider, route.model, options?.signal), connection.apiKeyEnv === "" ? Promise.resolve(void 0) : resolveApiKey(ctx, connection.apiKeyEnv)]);
	const fetchedAt = options?.now?.() ?? Date.now();
	const snapshot = (balanceStatus, extra) => ({
		provider: route.provider,
		providerName: providerNameOf(llm, route.provider),
		model: route.model,
		modelName,
		...route.reasoningEffort === void 0 ? {} : { reasoningEffort: route.reasoningEffort },
		source: route.source,
		...endpointLabel(connection.baseURL) === void 0 ? {} : { endpoint: endpointLabel(connection.baseURL) },
		balanceStatus,
		balances: [],
		fetchedAt,
		...extra
	});
	if (connection.baseURL === "" && route.provider !== DEEPSEEK_PROVIDER) {
		if (apiKey === void 0) return snapshot(connection.apiKeyEnv === "" ? "unsupported" : "no_key");
		return snapshot("unsupported");
	}
	if (apiKey === void 0) return snapshot("no_key");
	const gated = timeoutSignal(options?.signal);
	try {
		const result = await queryBalance(connection.baseURL === "" ? DEFAULT_DEEPSEEK_BASE : connection.baseURL, apiKey, options?.fetch ?? fetch, gated.signal);
		return snapshot(result.status, {
			balances: result.balances,
			...result.accountAvailable === void 0 ? {} : { accountAvailable: result.accountAvailable }
		});
	} finally {
		gated.cancel();
	}
}
//#endregion
//#region src/host/http.ts
function send(res, status, body) {
	const json = JSON.stringify(redactFail(body));
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(json);
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1e6) {
				reject(/* @__PURE__ */ new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", reject);
	});
}
async function readJson(req) {
	const raw = await readBody(req);
	if (raw.trim() === "") return {};
	const parsed = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid json");
	return parsed;
}
function query(url, key) {
	const value = url.searchParams.get(key);
	return value === null || value === "" ? void 0 : value;
}
function redactFail(body) {
	if (typeof body !== "object" || body === null || !("ok" in body) || body.ok !== false) return body;
	const failBody = body;
	return {
		...failBody,
		messageZh: redactSecrets(failBody.messageZh),
		hintZh: redactSecrets(failBody.hintZh)
	};
}
function asStringArray(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string");
}
async function wrap(run) {
	try {
		return {
			ok: true,
			value: await run()
		};
	} catch (error) {
		return toFail(error);
	}
}
async function writeCommitMessageStream(res, run) {
	const controller = new AbortController();
	let closed = false;
	const abort = () => {
		closed = true;
		controller.abort();
	};
	const onResponseClose = () => {
		if (!res.writableEnded) abort();
	};
	res.on("close", onResponseClose);
	res.statusCode = 200;
	res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("connection", "keep-alive");
	res.setHeader("x-accel-buffering", "no");
	const writeLine = (body) => {
		if (!res.writable || res.writableEnded) return;
		res.write(`${JSON.stringify(redactFail(body))}\n`);
	};
	try {
		for await (const event of run(controller.signal)) {
			if (controller.signal.aborted) break;
			if (event.type === "delta") writeLine({
				type: "delta",
				text: redactSecrets(event.text)
			});
			else writeLine({
				type: "done",
				message: redactSecrets(event.message)
			});
		}
	} catch (error) {
		if (!closed && !res.destroyed) writeLine(toFail(error));
	} finally {
		res.off("close", onResponseClose);
		if (!res.writableEnded) res.end();
	}
}
/** Register the `/git` JSON API used by the sidebar panel and workbench. */
function registerGitHttp(ctx, git, fs, editors = new ExternalOpen(fs), term = new TerminalHub()) {
	const server = ctx.webServer;
	if (server === void 0) throw new Error("dsh-workbench-plugin: 需要 webServer 才能提供工作台接口，请把本插件装到 web profile。");
	const handler = async (req, res) => {
		const host = req.headers.host ?? "127.0.0.1";
		const url = new URL(req.url ?? "/git", `http://${host}`);
		const route = url.pathname.replace(/\/+$/, "") || "/git";
		const method = (req.method ?? "GET").toUpperCase();
		if (method === "OPTIONS") {
			res.statusCode = 204;
			res.end();
			return;
		}
		const workspaceId = query(url, "workspaceId");
		const rootOf = (body) => {
			return resolveWorkspacePath(ctx, typeof body?.workspaceId === "string" ? body.workspaceId : workspaceId);
		};
		const repoOf = (body) => {
			if (typeof body?.repo === "string" && body.repo !== "") return body.repo;
			return query(url, "repo");
		};
		const gitRootOf = (body) => {
			return resolveNearbyGitPath(rootOf(body), repoOf(body));
		};
		let result;
		try {
			if (method === "GET" && route === "/git/nearby") result = await wrap(() => scanNearbyGit(rootOf()));
			else if (method === "GET" && route === "/git/probe") result = await wrap(async () => git.probe(await gitRootOf()));
			else if (method === "GET" && route === "/git/identity") result = await wrap(async () => git.identity(await gitRootOf()));
			else if (method === "POST" && route === "/git/init") {
				const body = await readJson(req);
				const name = typeof body.name === "string" ? body.name : "";
				const email = typeof body.email === "string" ? body.email : "";
				const branch = typeof body.branch === "string" ? body.branch : "";
				if (!isCurrentRepoId(repoOf(body))) result = fail("UNKNOWN_REPO");
				else result = await wrap(() => git.initRepo(rootOf(body), {
					name,
					email,
					branch
				}));
			} else if (method === "GET" && route === "/git/status") result = await wrap(async () => git.status(await gitRootOf()));
			else if (method === "GET" && route === "/git/diff") {
				const path = query(url, "path");
				const staged = query(url, "staged") === "1";
				result = await wrap(async () => git.diff(await gitRootOf(), path, staged));
			} else if (method === "GET" && route === "/git/log") {
				const limit = Number(query(url, "limit") ?? "80");
				result = await wrap(async () => git.log(await gitRootOf(), Number.isFinite(limit) ? limit : 80));
			} else if (method === "GET" && route === "/git/branches") result = await wrap(async () => git.branches(await gitRootOf()));
			else if (method === "POST" && route === "/git/stage") {
				const body = await readJson(req);
				result = await wrap(async () => {
					await git.stage(await gitRootOf(body), asStringArray(body.paths));
					return { done: true };
				});
			} else if (method === "POST" && route === "/git/unstage") {
				const body = await readJson(req);
				result = await wrap(async () => {
					await git.unstage(await gitRootOf(body), asStringArray(body.paths));
					return { done: true };
				});
			} else if (method === "POST" && route === "/git/restore") {
				const body = await readJson(req);
				result = await wrap(async () => {
					await git.restore(await gitRootOf(body), asStringArray(body.paths));
					return { done: true };
				});
			} else if (method === "POST" && route === "/git/commit") {
				const body = await readJson(req);
				const message = typeof body.message === "string" ? body.message : "";
				const all = body.all === true;
				result = await wrap(async () => git.commit(await gitRootOf(body), message, all));
			} else if (method === "POST" && route === "/git/commit-message/stream") {
				const body = await readJson(req);
				const gitRoot = await gitRootOf(body);
				await writeCommitMessageStream(res, (signal) => streamCommitMessage(ctx, git, gitRoot, {
					signal,
					template: typeof body.template === "string" ? body.template : void 0
				}));
				return;
			} else if (method === "POST" && route === "/git/term/assist/stream") {
				const body = await readJson(req);
				const text = typeof body.text === "string" ? body.text : "";
				await writeCommitMessageStream(res, (signal) => streamTermAssist(ctx, {
					signal,
					text,
					cwd: typeof body.cwd === "string" ? body.cwd : void 0,
					transcript: typeof body.transcript === "string" ? body.transcript : void 0,
					template: typeof body.template === "string" ? body.template : void 0,
					prefs: body.prefs
				}));
				return;
			} else if (method === "POST" && route === "/git/commit-message") {
				const body = await readJson(req);
				result = await wrap(async () => {
					return { message: await generateCommitMessage(ctx, git, await gitRootOf(body), { template: typeof body.template === "string" ? body.template : void 0 }) };
				});
			} else if (method === "POST" && route === "/git/push") {
				const body = await readJson(req);
				result = await wrap(async () => git.push(await gitRootOf(body), void 0, parsePushMode(body.pushMode)));
			} else if (method === "POST" && route === "/git/pull") {
				const body = await readJson(req);
				result = await wrap(async () => git.pull(await gitRootOf(body), void 0, parsePullMode(body.pullMode)));
			} else if (method === "POST" && route === "/git/fetch") {
				const body = await readJson(req);
				result = await wrap(async () => git.fetch(await gitRootOf(body)));
			} else if (method === "POST" && route === "/git/create-branch") {
				const body = await readJson(req);
				const name = typeof body.name === "string" ? body.name : "";
				result = await wrap(async () => git.createBranch(await gitRootOf(body), name));
			} else if (method === "POST" && route === "/git/merge") {
				const body = await readJson(req);
				const name = typeof body.name === "string" ? body.name : "";
				result = await wrap(async () => git.mergeBranch(await gitRootOf(body), name));
			} else if (method === "POST" && route === "/git/switch") {
				const body = await readJson(req);
				const name = typeof body.name === "string" ? body.name : "";
				result = await wrap(async () => git.switchBranch(await gitRootOf(body), name));
			} else if (method === "GET" && route === "/git/fs/list") result = await wrap(() => fs.list(rootOf(), query(url, "path") ?? ""));
			else if (method === "GET" && route === "/git/fs/search") result = await wrap(() => fs.search(rootOf(), query(url, "q") ?? "", query(url, "hidden") === "1"));
			else if (method === "GET" && route === "/git/fs/read") {
				const path = query(url, "path");
				if (path === void 0) result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.read(rootOf(), path));
			} else if (method === "GET" && route === "/git/fs/img") {
				const path = query(url, "path");
				if (path === void 0) {
					send(res, 400, fail("BAD_REQUEST"));
					return;
				}
				try {
					const image = await fs.readImage(rootOf(), path);
					res.statusCode = 200;
					res.setHeader("content-type", image.mime);
					res.setHeader("cache-control", "no-store");
					res.end(image.buffer);
				} catch (error) {
					send(res, 400, toFail(error));
				}
				return;
			} else if (method === "GET" && route === "/git/fs/raw") {
				const path = query(url, "path");
				if (path === void 0) {
					send(res, 400, fail("BAD_REQUEST"));
					return;
				}
				try {
					const data = await fs.readData(rootOf(), path);
					res.statusCode = 200;
					res.setHeader("content-type", data.mime);
					res.setHeader("cache-control", "no-store");
					res.end(data.buffer);
				} catch (error) {
					send(res, 400, toFail(error));
				}
				return;
			} else if (method === "POST" && route === "/git/fs/rename") {
				const body = await readJson(req);
				const from = typeof body.from === "string" ? body.from : "";
				const to = typeof body.to === "string" ? body.to : "";
				if (from === "" || to === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.rename(rootOf(body), from, to));
			} else if (method === "POST" && route === "/git/fs/delete") {
				const body = await readJson(req);
				const path = typeof body.path === "string" ? body.path : "";
				if (path === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.delete(rootOf(body), path));
			} else if (method === "POST" && route === "/git/fs/mkdir") {
				const body = await readJson(req);
				const path = typeof body.path === "string" ? body.path : "";
				if (path === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.mkdir(rootOf(body), path));
			} else if (method === "POST" && route === "/git/fs/copy") {
				const body = await readJson(req);
				const from = typeof body.from === "string" ? body.from : "";
				const to = typeof body.to === "string" ? body.to : "";
				if (from === "" || to === "") result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.copy(rootOf(body), from, to));
			} else if (method === "POST" && route === "/git/fs/reveal") {
				const body = await readJson(req);
				const path = typeof body.path === "string" ? body.path : "";
				result = await wrap(() => editors.reveal(rootOf(body), path));
			} else if (method === "GET" && route === "/git/commit-files") {
				const hash = query(url, "hash");
				if (hash === void 0) result = fail("BAD_REQUEST");
				else result = await wrap(async () => git.commitFiles(await gitRootOf(), hash));
			} else if (method === "GET" && route === "/git/commit-diff") {
				const hash = query(url, "hash");
				const path = query(url, "path");
				if (hash === void 0 || path === void 0) result = fail("BAD_REQUEST");
				else result = await wrap(async () => git.commitDiff(await gitRootOf(), hash, path));
			} else if (method === "POST" && route === "/git/fs/write") {
				const body = await readJson(req);
				const path = typeof body.path === "string" ? body.path : "";
				const content = typeof body.content === "string" ? body.content : null;
				if (path === "" || content === null) result = fail("BAD_REQUEST");
				else result = await wrap(() => fs.write(rootOf(body), path, content));
			} else if (method === "GET" && route === "/git/fs/editors") result = await wrap(() => editors.list());
			else if (method === "POST" && route === "/git/fs/open") {
				const body = await readJson(req);
				const path = typeof body.path === "string" ? body.path : "";
				const app = typeof body.app === "string" ? body.app : void 0;
				result = await wrap(() => editors.open(rootOf(body), path, app));
			} else if (method === "GET" && route === "/git/term/stream") {
				const id = workspaceId;
				if (id === void 0) result = fail("NO_WORKSPACE");
				else {
					const cols = Number(query(url, "cols") ?? "80");
					const rows = Number(query(url, "rows") ?? "24");
					await term.attach(id, rootOf(), res, cols, rows, sanitizeTermId(query(url, "termId")));
					return;
				}
			} else if (method === "POST" && route === "/git/term/write") {
				const body = await readJson(req);
				const data = typeof body.data === "string" ? body.data : "";
				result = await wrap(() => term.write(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), data, 80, 24, sanitizeTermId(body.termId)));
			} else if (method === "POST" && route === "/git/term/resize") {
				const body = await readJson(req);
				result = await wrap(() => term.resize(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), Number(body.cols), Number(body.rows), sanitizeTermId(body.termId)));
			} else if (method === "POST" && route === "/git/term/interrupt") {
				const body = await readJson(req);
				result = await wrap(() => term.interrupt(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), sanitizeTermId(body.termId)));
			} else if (method === "POST" && route === "/git/term/close") {
				const body = await readJson(req);
				result = await wrap(() => term.close(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", sanitizeTermId(body.termId)));
			} else if (method === "GET" && route === "/git/update") result = await wrap(() => checkPluginUpdate());
			else if (method === "GET" && route === "/git/usage") result = await wrap(() => readProviderUsage(ctx, query(url, "sessionId")));
			else if (method === "POST" && route === "/git/term/restart") {
				const body = await readJson(req);
				result = await wrap(() => term.restart(typeof body.workspaceId === "string" ? body.workspaceId : workspaceId ?? "", rootOf(body), Number(body.cols), Number(body.rows), sanitizeTermId(body.termId)));
			} else result = fail("BAD_REQUEST");
		} catch (error) {
			result = toFail(error);
		}
		send(res, result.ok ? 200 : 400, result);
	};
	const dispose = server.register({
		kind: "prefix",
		path: "/git",
		handler
	});
	return () => {
		term.disposeAll();
		dispose();
	};
}
//#endregion
//#region src/host/tools.ts
function cwdOf(ctx, exec) {
	return resolveWorkspacePath(ctx, void 0, exec.agent?.session?.header?.cwd);
}
function text(value) {
	return [{
		type: "text",
		text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
	}];
}
function failPayload(error) {
	const fail = toFail(error);
	return {
		ok: false,
		code: fail.code,
		message: fail.messageZh,
		hint: fail.hintZh
	};
}
/** Register model-facing git_* tools. Read-only except commit (user must approve). No delete / reset --hard / clean. */
function registerGitTools(ctx, git) {
	const disposeStatus = ctx.tools.register(defineTool({
		name: "git_status",
		description: "Show git status of the current workspace: branch, ahead/behind, staged, unstaged, and untracked files.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(_args, exec) {
			try {
				return {
					ok: true,
					...await git.status(cwdOf(ctx, exec), exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: () => ({
			card: "generic",
			title: "Git 状态",
			kind: "search"
		})
	}));
	const disposeDiff = ctx.tools.register(defineTool({
		name: "git_diff",
		description: "Show a git diff. Optional path limits the file; staged=true uses the index.",
		parameters: {
			path: {
				type: "string",
				description: "Repository-relative file path"
			},
			staged: {
				type: "boolean",
				description: "If true, show staged diff"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				const path = typeof args.path === "string" ? args.path : void 0;
				const staged = args.staged === true;
				return {
					ok: true,
					...await git.diff(cwdOf(ctx, exec), path, staged, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: (args) => ({
			card: "diff",
			title: args.path ? `Git diff ${args.path}` : "Git diff",
			diffs: [{
				path: typeof args.path === "string" ? args.path : ".",
				oldText: "",
				newText: ""
			}]
		})
	}));
	const disposeLog = ctx.tools.register(defineTool({
		name: "git_log",
		description: "Show recent git commits in the current workspace.",
		parameters: { limit: {
			type: "number",
			description: "Number of commits, default 20, max 100. Includes local branches, remotes, and tags."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				const limit = typeof args.limit === "number" ? args.limit : 20;
				return {
					ok: true,
					entries: await git.log(cwdOf(ctx, exec), limit, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: () => ({
			card: "generic",
			title: "Git 提交历史"
		})
	}));
	const disposeBranch = ctx.tools.register(defineTool({
		name: "git_branch",
		description: "List local branches, or switch to an existing local branch. Switching is refused when the worktree is dirty. Does not create branches or touch remotes.",
		parameters: {
			action: {
				type: "string",
				required: true,
				description: "list or switch",
				enum: ["list", "switch"]
			},
			name: {
				type: "string",
				description: "Existing local branch name when action is switch"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				const root = cwdOf(ctx, exec);
				if (args.action === "switch") {
					if (typeof args.name !== "string" || args.name.trim() === "") throw new GitError("BRANCH_MISSING");
					return {
						ok: true,
						...await git.switchBranch(root, args.name, exec.signal)
					};
				}
				return {
					ok: true,
					branches: await git.branches(root, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.action === "switch" ? `切换分支 ${args.name ?? ""}` : "Git 分支"
		})
	}));
	const disposeCommit = ctx.tools.register(defineTool({
		name: "git_commit",
		description: "Create a git commit from already-staged files. Requires a non-empty message. Does not stage, delete, restore, reset, push, or amend. The user must approve this call.",
		parameters: { message: {
			type: "string",
			required: true,
			description: "Commit message"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {}
			},
			render: (_args, value) => text(value)
		},
		async execute(args, exec) {
			try {
				if (typeof args.message !== "string") throw new GitError("EMPTY_MESSAGE");
				return {
					ok: true,
					...await git.commit(cwdOf(ctx, exec), args.message, exec.signal)
				};
			} catch (error) {
				return failPayload(error);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Git 提交",
			content: typeof args.message === "string" ? args.message : ""
		})
	}));
	const offAsk = ctx.on("tools/pre-execute", async (exec, next) => {
		if (exec.name !== "git_commit") return next();
		return {
			kind: "ask",
			reason: "提交会写入 Git 历史。请确认提交说明和已暂存文件后再允许。"
		};
	});
	return () => {
		disposeStatus();
		disposeDiff();
		disposeLog();
		disposeBranch();
		disposeCommit();
		offAsk();
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-workbench-plugin";
const inject = [
	"tools",
	"webServer",
	"llm",
	"agentDefaultModel"
];
/** Host half: Git service, workspace files, JSON API, and model-facing tools. */
function apply(ctx) {
	const git = new GitService();
	const fs = new WorkspaceFs();
	ctx.effect(() => registerGitHttp(ctx, git, fs), "workbench: http");
	ctx.effect(() => registerGitTools(ctx, git), "workbench: tools");
}
//#endregion
export { apply, inject, name };
