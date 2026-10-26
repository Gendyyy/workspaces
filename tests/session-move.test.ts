import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { moveSessionToDirectory, sessionsRootFor } from "../extensions/workspaces/data.ts";

const temporaryRoots: string[] = [];
const movedFiles: string[] = [];

function fixture() {
	const root = mkdtempSync(join(homedir(), ".pi-workspaces-move-test-"));
	temporaryRoots.push(root);
	const sourceDir = join(root, "source");
	const targetDir = join(root, "target");
	mkdirSync(sourceDir);
	mkdirSync(targetDir);
	const sourcePath = join(sourceDir, "20240501_test-session.jsonl");
	const body = '{"type":"message","id":"one","message":{"role":"user","content":"keep me"}}\n{"type":"message","id":"two"}\n';
	writeFileSync(sourcePath, `${JSON.stringify({
		type: "session",
		version: 3,
		id: "test-session",
		timestamp: "2024-05-01T10:00:00.000Z",
		cwd: sourceDir,
	})}\n${body}`);
	return { root, sourceDir, targetDir, sourcePath, body };
}

afterEach(() => {
	for (const file of movedFiles.splice(0)) {
		try { unlinkSync(file); } catch { /* already removed */ }
	}
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("moveSessionToDirectory", () => {
	test("recognizes default cwd-scoped session folders on Windows and POSIX", () => {
		const cwd = join(homedir(), "workspaces", "example");
		const encoded = `--${cwd.replace(/^[/\\\\]/, "").replace(/[/\\\\:]/g, "-")}--`;
		expect(sessionsRootFor(join("C:\\\\agent", "sessions", encoded), cwd)).toBeUndefined();
		expect(sessionsRootFor(join("/", "agent", "sessions", encoded), cwd)).toBeUndefined();
		expect(sessionsRootFor(join("/", "custom-sessions"), cwd)).toBe(join("/", "custom-sessions"));
	});

	test("relocates the default session file and preserves its transcript", () => {
		const { root, targetDir, sourcePath, body } = fixture();
		const activeSessionDir = join(root, "sessions", "--source--");
		mkdirSync(dirname(activeSessionDir), { recursive: true });
		const result = moveSessionToDirectory(sourcePath, targetDir, undefined, activeSessionDir);
		expect(result.ok).toBe(true);
		expect(result.path).toBeDefined();
		movedFiles.push(result.path!);
		expect(existsSync(sourcePath)).toBe(false);
		const contents = readFileSync(result.path!, "utf8");
		const newline = contents.indexOf("\n");
		const header = JSON.parse(contents.slice(0, newline));
		expect(header.cwd).toBe(targetDir);
		expect(header.id).toBe("test-session");
		expect(contents.slice(newline + 1)).toBe(body);
		expect(result.path).toContain(join(root, "sessions"));
	});

	test("rewrites the header in place for custom flat session roots", () => {
		const { sourceDir, targetDir, sourcePath, body } = fixture();
		const result = moveSessionToDirectory(sourcePath, targetDir, sourceDir);
		expect(result).toEqual({ ok: true, path: sourcePath });
		const contents = readFileSync(sourcePath, "utf8");
		const newline = contents.indexOf("\n");
		expect(JSON.parse(contents.slice(0, newline)).cwd).toBe(targetDir);
		expect(contents.slice(newline + 1)).toBe(body);
	});

	test("rejects missing and same-directory targets without changing the source", () => {
		const { sourceDir, sourcePath } = fixture();
		expect(moveSessionToDirectory(sourcePath, join(sourceDir, "missing")).ok).toBe(false);
		expect(moveSessionToDirectory(sourcePath, sourceDir).error).toBe("Session is already in that directory");
		expect(existsSync(sourcePath)).toBe(true);
		expect(readFileSync(sourcePath, "utf8")).toContain('"cwd":"');
	});
});
