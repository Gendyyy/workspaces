/**
 * Renderer for the workspaces panel. Turns view state into tagged segments so
 * the painter can record click targets for every row and every chrome control.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { abbreviatePath, relativeTime } from "../data.ts";
import { hintRowsFor } from "./actions.ts";
import { emptyLine, hintLine, type LayoutLine, type Seg } from "./layout.ts";
import type { DirectoryEntry } from "../data.ts";
import { SESSION_PAGE_SIZE, type Entry, type SortMode } from "./state.ts";

/** Session index under the cursor, as rows are painted. */
export type FolderRow =
	| { kind: "create"; path: string }
	| { kind: "move"; path: string }
	| { kind: "jump"; path: string }
	| { kind: "parent"; path: string }
	| { kind: "dir"; entry: DirectoryEntry };

export interface ListView {
	mode: "list" | "rename" | "confirm-delete";
	filter: string;
	regexMode: boolean;
	regexError?: string;
	searching: boolean;
	renameValue: string;
	deleteTitle: string;
	notice?: { text: string; tone: "info" | "error" };
	showingHidden: boolean;
	sortMode: SortMode;
	entries: Entry[];
	start: number;
	selected: number;
	bodyRows: number;
}

export interface FolderView {
	purpose: "new-session" | "move-session";
	folderPath: string;
	folderFilter: string;
	folderRows: FolderRow[];
	folderStart: number;
	folderSelected: number;
	bodyRows: number;
	notice?: { text: string; tone: "info" | "error" };
}

/** Header controls for the list: sort and hidden badges plus close. */
export function listHeader(view: ListView): Seg[] {
	return [
		{ text: " ", color: "border" },
		{ text: "Workspaces", color: "accent", bold: true },
		{ text: " · ", color: "borderMuted" },
		{ text: `sort: ${view.sortMode}`, color: "muted", hit: { type: "toggle-sort" } },
		{ text: " · ", color: "borderMuted" },
		{
			text: view.showingHidden ? "hidden on" : "hidden off",
			color: view.showingHidden ? "accent" : "muted",
			hit: { type: "toggle-hidden" },
		},
	];
}

/** Header controls for the folder browser. */
export function folderHeaderSegs(title = "New session"): Seg[] {
	return [{ text: " ", color: "border" }, { text: title, color: "accent", bold: true }];
}

/** The always-present close control on the right of the header. */
export function closeControl(): Seg[] {
	return [{ text: "✕ ", color: "muted", hit: { type: "close" } }];
}

/** Filter, rename, or delete prompt row. */
function promptLine(view: ListView, innerW: number): LayoutLine {
	if (view.mode === "rename") {
		return {
			segs: [
				{ text: " ", },
				{ text: "rename ", color: "accent", bold: true },
				{ text: truncateToWidth(view.renameValue, Math.max(1, innerW - 9), "…") },
				{ text: "▏", color: "dim" },
			],
		};
	}
	if (view.mode === "confirm-delete") {
		return {
			segs: [
				{ text: " " },
				{ text: 'delete "', color: "error" },
				{ text: truncateToWidth(view.deleteTitle, Math.max(1, innerW - 24), "…"), color: "error", bold: true },
				{ text: '"? ', color: "error" },
				{ text: " y delete ", color: "success", bold: true, hit: { type: "confirm-delete" } },
				{ text: "· ", color: "dim" },
				{ text: " n cancel ", color: "muted", hit: { type: "cancel-mode" } },
			],
		};
	}
	if (view.filter) {
		const mode: Seg = {
			text: " /re ",
			color: view.regexMode ? "accent" : "muted",
			bold: view.regexMode,
			hit: { type: "toggle-regex" },
		};
		const error: Seg = view.regexError ? { text: " invalid regex", color: "error" } : { text: "" };
		const room = Math.max(1, innerW - 4 - visibleWidth(mode.text) - visibleWidth(error.text));
		return {
			segs: [
				{ text: " " },
				{ text: "⌕ ", color: "muted", hit: { type: "clear-filter" } },
				mode,
				{ text: truncateToWidth(view.filter, room, "…"), hit: { type: "focus-search" } },
				error,
				{ text: "▏", color: "dim" },
			],
		};
	}
	if (view.searching) {
		return {
			segs: [
				{ text: " " },
				{ text: "⌕ ", color: "muted", hit: { type: "focus-search" } },
				{ text: "▏", color: "dim" },
			],
		};
	}
	return {
		segs: [
			{ text: " " },
			{ text: "⌕ ", color: "muted", hit: { type: "focus-search" } },
			{ text: "/ to search", color: "dim", hit: { type: "focus-search" } },
		],
	};
}

/** Hint rows, replaced by the current notice when one is set. */
function footerLines(
	innerW: number,
	notice: ListView["notice"],
	mode: "list" | "rename" | "confirm-delete" | "folder" | "move-folder",
): LayoutLine[] {
	if (notice) {
		return [
			{
				segs: [
					{ text: " " },
					{
						text: truncateToWidth(notice.text, Math.max(1, innerW - 2), "…"),
						color: notice.tone === "error" ? "error" : "warning",
					},
				],
			},
		];
	}
	return hintRowsFor(mode).map((buttons) => hintLine(buttons, innerW));
}

/** Draw one list row, tagging every visible run with the row's action. */
function entryLine(entry: Entry, selected: boolean, rowIndex: number, innerW: number): LayoutLine {
	if (entry.kind === "workspace") {
		const workspace = entry.workspace;
		const count = workspace.sessions.length;
		const meta = count === 1 ? "1 session" : `${count} sessions`;
		const badges = `${workspace.branch ? ` ⟨${workspace.branch}⟩` : ""}${workspace.isCurrent ? " ●" : ""}${workspace.missing ? " ⚠ missing" : ""}`;
		const labelBudget = Math.max(8, innerW - 4 - visibleWidth(badges) - visibleWidth(meta) - 2);
		const segs: Seg[] = [
			{ text: ` ${entry.expanded ? "▾" : "▸"} `, color: "accent", hit: { type: "activate" } },
			{
				text: truncateToWidth(workspace.label, labelBudget, "…"),
				color: workspace.isCurrent ? "accent" : "text",
				bold: true,
				hit: { type: "activate" },
			},
		];
		if (workspace.branch) segs.push({ text: ` ⟨${workspace.branch}⟩`, color: "muted", hit: { type: "activate" } });
		if (workspace.isCurrent) segs.push({ text: " ●", color: "success", hit: { type: "activate" } });
		if (workspace.missing) segs.push({ text: " ⚠ missing", color: "warning", hit: { type: "activate" } });
		segs.push(...rightAligned(segs, { text: `${meta} `, color: "dim", hit: { type: "activate" } }, innerW));
		return { segs, selected, rowIndex };
	}

	if (entry.kind === "more") {
		const count = Math.min(SESSION_PAGE_SIZE, entry.total - entry.showing);
		return {
			segs: [
				{ text: "      ↓ ", color: "accent", hit: { type: "activate" } },
				{
					text: `View ${count} more session${count === 1 ? "" : "s"}…`,
					color: "accent",
					bold: true,
					hit: { type: "activate" },
				},
			],
			selected,
			rowIndex,
		};
	}

	const session = entry.session;
	const meta = `${relativeTime(session.modified)} · ${session.messageCount}`;
	const title = entry.matchSnippet ? `${session.title} · ${entry.matchSnippet}` : session.title;
	const titleBudget = Math.max(8, innerW - 8 - visibleWidth(meta) - 2);
	const segs: Seg[] = [
		{ text: "    ", hit: { type: "activate" } },
		{
			text: session.isCurrent ? "● " : "○ ",
			color: session.isCurrent ? "success" : "muted",
			hit: { type: "activate" },
		},
		{
			text: truncateToWidth(title, titleBudget, "…"),
			color: session.isCurrent ? "accent" : "text",
			hit: { type: "activate" },
		},
	];
	if (session.missingCwd) segs.push({ text: " ⚠", color: "warning", hit: { type: "activate" } });
	segs.push(...rightAligned(segs, { text: `${meta} `, color: "dim", hit: { type: "activate" } }, innerW));
	return { segs, selected, rowIndex };
}

/** Pad a row so its meta segment sits against the right edge. */
function rightAligned(segs: Seg[], right: Seg, innerW: number): Seg[] {
	const leftWidth = segs.reduce((total, seg) => total + visibleWidth(seg.text), 0);
	const gap = Math.max(2, innerW - leftWidth - visibleWidth(right.text));
	return [{ text: " ".repeat(gap), hit: right.hit }, right];
}

/** Build the whole list mode body: prompt, separator, rows, separator, footer. */
export function renderList(view: ListView, innerW: number): LayoutLine[] {
	const lines: LayoutLine[] = [
		promptLine(view, innerW),
		{ segs: [{ text: "─".repeat(innerW), color: "borderMuted" }] },
	];
	for (let offset = 0; offset < view.bodyRows; offset += 1) {
		const entry = view.entries[view.start + offset];
		lines.push(entry ? entryLine(entry, view.start + offset === view.selected, view.start + offset, innerW) : emptyLine());
	}
	lines.push({ segs: [{ text: "─".repeat(innerW), color: "borderMuted" }] });
	lines.push(...footerLines(innerW, view.notice, view.mode));
	return lines;
}

/** Folder browser path line. */
function folderPathLine(view: FolderView, innerW: number): LayoutLine {
	if (view.folderFilter) {
		return {
			segs: [
				{ text: " " },
				{ text: "⌕ ", color: "muted" },
				{ text: truncateToWidth(view.folderFilter, Math.max(1, innerW - 4), "…") },
				{ text: "▏", color: "dim" },
			],
		};
	}
	return {
		segs: [
			{ text: " " },
			{ text: truncateToWidth(abbreviatePath(view.folderPath), Math.max(1, innerW - 2), "…"), color: "accent" },
		],
	};
}

/** Draw one folder row; only the create row's check mark is clickable. */
function folderLine(row: FolderRow, selected: boolean, rowIndex: number): LayoutLine {
	if (row.kind === "create" || row.kind === "move") {
		const action = row.kind === "move" ? { type: "folder-move" as const } : { type: "folder-create" as const };
		const label = row.kind === "move" ? "Move session here" : "Start a session in this folder";
		return {
			segs: [
				{ text: " ✓ ", color: "success", hit: action },
				{ text: label, color: "success", bold: true },
			],
			selected,
			rowIndex,
		};
	}
	if (row.kind === "jump") {
		return {
			segs: [
				{ text: " → ", color: "accent", hit: { type: "folder-open", path: row.path } },
				{ text: `Go to ${abbreviatePath(row.path)}`, color: "accent", hit: { type: "folder-open", path: row.path } },
			],
			selected,
			rowIndex,
		};
	}
	if (row.kind === "parent") {
		return {
			segs: [
				{ text: " ↑ ", color: "muted", hit: { type: "folder-open", path: row.path } },
				{ text: "..", color: "muted", hit: { type: "folder-open", path: row.path } },
			],
			selected,
			rowIndex,
		};
	}
	return {
		segs: [
			{ text: "   " },
			{ text: row.entry.name, color: "text", hit: { type: "folder-open", path: row.entry.path } },
		],
		selected,
		rowIndex,
	};
}

/** Build the whole folder browser body. */
export function renderFolder(view: FolderView, innerW: number): LayoutLine[] {
	const lines: LayoutLine[] = [
		folderPathLine(view, innerW),
		{ segs: [{ text: "─".repeat(innerW), color: "borderMuted" }] },
	];
	for (let offset = 0; offset < view.bodyRows; offset += 1) {
		const row = view.folderRows[view.folderStart + offset];
		lines.push(
			row ? folderLine(row, view.folderStart + offset === view.folderSelected, view.folderStart + offset) : emptyLine(),
		);
	}
	lines.push({ segs: [{ text: "─".repeat(innerW), color: "borderMuted" }] });
	lines.push(...footerLines(innerW, view.notice, view.purpose === "move-session" ? "move-folder" : "folder"));
	return lines;
}
