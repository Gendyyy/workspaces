/**
 * Workspaces overlay panel. Owns UI state and dispatches every keyboard, mouse,
 * and hint-button intention through one action path.
 */
import {
	expandHome,
	parentDirectory,
	listDirectories,
	canonicalPath,
	type SessionRow,
	type WorkspaceRow,
} from "../data.ts";
import { Key, matchesKey, truncateToWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { HitAction, PanelAction } from "./actions.ts";
import { hitAt, rowIndexAt, sameHover, type Frame, type Hover } from "./hits.ts";
import { composeBox } from "./layout.ts";
import { deleteKeyAction, folderKeyAction, listKeyAction, printable, renameKeyAction } from "./keys.ts";
import {
	bodyRows as bodyRowCount,
	buildEntries,
	clampSelection,
	nextVisibleCount,
	windowStart,
	type Entry,
	type SortMode,
} from "./state.ts";
import {
	closeControl,
	folderHeaderSegs,
	listHeader,
	renderFolder,
	renderList,
	type FolderRow,
	type FolderView,
	type ListView,
} from "./render.ts";

export type { PanelAction } from "./actions.ts";

export interface PanelDeps {
	theme: Theme;
	tui: TUI;
	currentCwd: string;
	workspaces: WorkspaceRow[];
	/** Reload the workspace model after a rename or delete. */
	reload: () => Promise<WorkspaceRow[]>;
	/** Persist a new display name; returns an error message on failure. */
	rename: (sessionPath: string, name: string) => { ok: boolean; error?: string };
	/** Delete a session file; returns an error message on failure. */
	remove: (sessionPath: string) => Promise<{ ok: boolean; method?: string; error?: string }>;
	hiddenWorkspaces: Set<string>;
	/** Persist a workspace's visibility without changing its sessions. */
	setWorkspaceHidden: (cwd: string, hidden: boolean) => { ok: boolean; error?: string };
	done: (action: PanelAction) => void;
	initialFilter?: string;
}

type Mode = "list" | "rename" | "confirm-delete" | "folder";
type FolderPurpose = "new-session" | "move-session";

/** Modal workspace switcher overlay. */
export class WorkspacePanel implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly currentCwd: string;
	private readonly reload: () => Promise<WorkspaceRow[]>;
	private readonly rename: PanelDeps["rename"];
	private readonly remove: PanelDeps["remove"];
	private readonly setWorkspaceHidden: PanelDeps["setWorkspaceHidden"];
	private readonly done: PanelDeps["done"];

	private workspaces: WorkspaceRow[];
	private hiddenWorkspaces: Set<string>;
	private showingHidden = false;
	private expanded = new Set<string>();
	private visibleSessions = new Map<string, number>();
	private filter: string;
	private regexMode = false;
	private regexError?: string;
	/**
	 * True while printable keys extend the filter instead of firing actions.
	 * Entered with `/` (or by an initialFilter), left with Esc/Ctrl+U, so the
	 * single-keypress actions below stay unambiguous.
	 */
	private searching: boolean;
	private mode: Mode = "list";
	private selected = 0;
	private scroll = 0;
	private manualScroll = false;
	private sortMode: SortMode = "modified";
	private notice?: { text: string; tone: "info" | "error" };

	private renameTarget?: SessionRow;
	private renameValue = "";

	private deleteTarget?: SessionRow;

	private folderPath: string;
	private folderPurpose: FolderPurpose = "new-session";
	private moveTarget?: SessionRow;
	private folderRows: FolderRow[] = [];
	private folderSelected = 0;
	private folderScroll = 0;
	private folderManualScroll = false;
	private folderFilter = "";

	/** Hit map of the last painted frame; click targets come from here. */
	private frame: Frame = { rows: [] };
	/** Pointer position used for hover highlighting. */
	private hover?: Hover;

	constructor(deps: PanelDeps) {
		this.theme = deps.theme;
		this.tui = deps.tui;
		this.currentCwd = deps.currentCwd;
		this.workspaces = deps.workspaces;
		this.reload = deps.reload;
		this.rename = deps.rename;
		this.remove = deps.remove;
		this.hiddenWorkspaces = new Set(deps.hiddenWorkspaces);
		this.setWorkspaceHidden = deps.setWorkspaceHidden;
		this.done = deps.done;
		this.filter = deps.initialFilter ?? "";
		this.searching = this.filter.length > 0;
		this.folderPath = deps.currentCwd || expandHome("~");

		for (const workspace of this.workspaces) {
			if (workspace.isCurrent || workspace.sessions.length === 0) this.expanded.add(workspace.cwd);
		}
	}

	// ---------------------------------------------------------------- rendering

	render(width: number): string[] {
		const innerW = Math.max(24, width - 2);
		const rows = bodyRowCount(this.tui.terminal?.rows);
		if (this.mode === "folder") {
			const start = windowStart(
				this.folderRows.length,
				rows,
				this.folderSelected,
				this.folderManualScroll,
				this.folderScroll,
			);
			this.folderScroll = start;
			const view: FolderView = {
				purpose: this.folderPurpose,
				folderPath: this.folderPath,
				folderFilter: this.folderFilter,
				folderRows: this.folderRows,
				folderStart: start,
				folderSelected: this.folderSelected,
				bodyRows: rows,
				notice: this.notice,
			};
			const box = composeBox({
				left: folderHeaderSegs(this.folderPurpose === "move-session" ? "Move session" : "New session"),
				right: closeControl(),
				lines: renderFolder(view, innerW),
				width,
				theme: this.theme,
				hover: this.hover,
			});
			this.frame = box.frame;
			return box.lines;
		}

		const entries = this.entries();
		const start = windowStart(entries.length, rows, this.selected, this.manualScroll, this.scroll);
		this.scroll = start;
		const view: ListView = {
			mode: this.mode,
			filter: this.filter,
			regexMode: this.regexMode,
			regexError: this.regexError,
			searching: this.searching,
			renameValue: this.renameValue,
			deleteTitle: this.deleteTarget?.title ?? "",
			notice: this.notice,
			showingHidden: this.showingHidden,
			sortMode: this.sortMode,
			entries,
			start,
			selected: this.selected,
			bodyRows: rows,
		};
		const box = composeBox({
			left: listHeader(view),
			right: closeControl(),
			lines: renderList(view, innerW),
			width,
			theme: this.theme,
			hover: this.hover,
		});
		this.frame = box.frame;
		return box.lines;
	}

	// ------------------------------------------------------------- list model

	private entries(): Entry[] {
		const result = buildEntries({
			workspaces: this.workspaces,
			hiddenWorkspaces: this.hiddenWorkspaces,
			showingHidden: this.showingHidden,
			filter: this.filter,
			regexMode: this.regexMode,
			sortMode: this.sortMode,
			expanded: this.expanded,
			visibleSessions: this.visibleSessions,
		});
		this.regexError = result.regexError;
		return result.entries;
	}

	private selectedEntry(): Entry | undefined {
		return this.entries()[this.selected];
	}

	private workspaceFor(entry: Entry | undefined): WorkspaceRow | undefined {
		return entry?.workspace;
	}

	private clampSelection(): void {
		this.manualScroll = false;
		this.selected = clampSelection(this.entries().length, this.selected);
	}

	private refresh(): void {
		void this.reload().then((workspaces) => {
			this.workspaces = workspaces;
			this.clampSelection();
			this.tui.requestRender();
		});
	}

	// ---------------------------------------------------------------- input

	handleInput(data: string): void {
		this.notice = undefined;
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onEscape();
			return;
		}
		switch (this.mode) {
			case "rename":
				this.handleRenameInput(data);
				return;
			case "confirm-delete":
				this.handleDeleteInput(data);
				return;
			case "folder":
				this.handleFolderInput(data);
				return;
			default:
				this.handleListInput(data);
		}
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
		if (event.type === "wheel" && event.wheelDelta !== undefined) {
			const delta = Math.max(1, Math.abs(Math.round(event.wheelDelta))) * Math.sign(event.wheelDelta);
			this.hover = undefined;
			if (this.mode === "folder") {
				this.folderManualScroll = true;
				const limit = Math.max(0, this.folderRows.length - bodyRowCount(this.tui.terminal?.rows));
				this.folderScroll = Math.max(0, Math.min(limit, this.folderScroll + delta));
			} else if (this.mode === "list") {
				this.manualScroll = true;
				const limit = Math.max(0, this.entries().length - bodyRowCount(this.tui.terminal?.rows));
				this.scroll = Math.max(0, Math.min(limit, this.scroll + delta));
			} else {
				return undefined;
			}
			this.tui.requestRender();
			return { handled: true };
		}

		const hit = hitAt(this.frame, event.y, event.x);
		// Modal prompts expose clickable chips but no selectable rows.
		if (this.mode === "rename" || this.mode === "confirm-delete") {
			if (event.type !== "click" || event.button !== "left" || !hit) return undefined;
			this.perform(hit);
			return { handled: true };
		}
		const rowIndex = rowIndexAt(this.frame, event.y);

		if (event.type === "move") {
			const next: Hover | undefined = hit ? { y: event.y, x: event.x } : undefined;
			if (sameHover(this.hover, next)) return undefined;
			this.hover = next;
			return { handled: true, render: true };
		}

		if (event.button !== "left") return undefined;
		if (event.type === "press") {
			if (rowIndex !== undefined) this.selectRow(rowIndex);
			return hit || rowIndex !== undefined ? { handled: true } : undefined;
		}
		if (event.type !== "click") return undefined;
		if (rowIndex !== undefined) this.selectRow(rowIndex);
		if (!hit) return rowIndex !== undefined ? { handled: true } : undefined;
		// The first click already acted; a second click in a double click must not repeat it.
		if (event.clickCount && event.clickCount > 1) return { handled: true };
		this.perform(hit);
		return { handled: true };
	}

	/** Select the row painted on a line, for both list and folder modes. */
	private selectRow(index: number): void {
		if (this.mode === "folder") {
			this.folderSelected = index;
			this.folderManualScroll = false;
		} else {
			this.selected = index;
			this.manualScroll = false;
		}
		this.tui.requestRender();
	}

	private handleListInput(data: string): void {
		const action = listKeyAction(data, !this.searching && this.filter.length === 0);
		if (action) {
			this.perform(action);
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			if (this.filter) {
				this.filter = this.filter.slice(0, -1);
				this.clampSelection();
			} else {
				this.searching = false;
			}
			this.tui.requestRender();
			return;
		}
		const typed = printable(data);
		if (typed) {
			this.searching = true;
			this.filter += typed;
			this.clampSelection();
			this.tui.requestRender();
		}
	}

	private handleRenameInput(data: string): void {
		const action = renameKeyAction(data);
		if (action) {
			this.perform(action);
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			this.renameValue = this.renameValue.slice(0, -1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.ctrl("u"))) {
			this.renameValue = "";
			this.tui.requestRender();
			return;
		}
		const typed = printable(data);
		if (typed) {
			this.renameValue += typed;
			this.tui.requestRender();
		}
	}

	private handleDeleteInput(data: string): void {
		const action = deleteKeyAction(data);
		if (action) this.perform(action);
	}

	private handleFolderInput(data: string): void {
		const action = folderKeyAction(data, this.folderPurpose === "move-session");
		if (action) {
			this.perform(action);
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			this.folderFilter = this.folderFilter.slice(0, -1);
			this.folderSelected = 0;
			this.reloadFolderRows();
			return;
		}
		if (matchesKey(data, Key.ctrl("u"))) {
			this.folderFilter = "";
			this.folderSelected = 0;
			this.reloadFolderRows();
			return;
		}
		const typed = printable(data);
		if (typed) {
			this.folderFilter += typed;
			this.folderSelected = 0;
			this.reloadFolderRows();
		}
	}

	private onEscape(): void {
		if (this.mode === "rename" || this.mode === "confirm-delete") {
			this.cancelMode();
			return;
		}
		if (this.mode === "folder") {
			this.mode = "list";
			this.folderFilter = "";
			this.moveTarget = undefined;
			this.hover = undefined;
			this.tui.requestRender();
			return;
		}
		if (this.searching || this.filter) {
			this.clearFilter();
			return;
		}
		this.done({ type: "cancel" });
	}

	// ------------------------------------------------------------- dispatch

	/** Execute one intention, whether it came from a key, a row, or a button. */
	private perform(action: HitAction): void {
		this.notice = undefined;
		this.hover = undefined;
		let closed = false;
		switch (action.type) {
			case "activate":
				closed = this.activate();
				break;
			case "move-selection":
				this.manualScroll = false;
				this.selected = clampSelection(this.entries().length, this.selected + action.delta);
				break;
			case "move-folder-selection":
				this.folderManualScroll = false;
				this.folderSelected = clampSelection(this.folderRows.length, this.folderSelected + action.delta);
				break;
			case "expand-selected":
				this.setExpanded(action.expanded);
				break;
			case "new-session":
				closed = this.startNewSession();
				break;
			case "move":
				this.startMove();
				break;
			case "attach":
				this.done({ type: "attach-workspace" });
				closed = true;
				break;
			case "browse":
				this.openFolderBrowser();
				break;
			case "hide-workspace":
				this.toggleWorkspaceVisibility();
				break;
			case "rename":
				this.startRename();
				break;
			case "delete":
				this.startDelete();
				break;
			case "toggle-hidden":
				this.toggleHidden();
				break;
			case "toggle-sort":
				this.sortMode = this.sortMode === "modified" ? "created" : "modified";
				this.selected = 0;
				this.scroll = 0;
				break;
			case "toggle-regex":
				this.regexMode = !this.regexMode;
				break;
			case "focus-search":
				this.searching = true;
				break;
			case "clear-filter":
				this.clearFilter();
				break;
			case "close":
				this.done({ type: "cancel" });
				closed = true;
				break;
			case "save-rename":
				this.saveRename();
				break;
			case "cancel-mode":
				this.cancelMode();
				break;
			case "confirm-delete":
				this.confirmDelete();
				break;
			case "folder-open":
				this.folderOpen(action.path);
				break;
			case "folder-create":
				this.done({ type: "new-session", cwd: this.folderPath });
				closed = true;
				break;
			case "folder-move":
				closed = this.moveFolder(this.folderPath);
				break;
			case "folder-back":
				this.mode = "list";
				this.folderFilter = "";
				this.moveTarget = undefined;
				break;
			case "activate-folder":
				this.activateFolder();
				break;
		}
		if (!closed) this.tui.requestRender();
	}

	// -------------------------------------------------------------- actions

	/** Toggle a workspace row, page a "more" row, or open the selected session. */
	private activate(): boolean {
		const entry = this.selectedEntry();
		if (!entry) return false;
		if (entry.kind === "workspace") {
			if (this.expanded.has(entry.workspace.cwd)) this.expanded.delete(entry.workspace.cwd);
			else this.expanded.add(entry.workspace.cwd);
			this.clampSelection();
			return false;
		}
		if (entry.kind === "more") {
			this.visibleSessions.set(
				entry.workspace.cwd,
				nextVisibleCount(entry.showing, entry.total),
			);
			this.clampSelection();
			return false;
		}
		const session = entry.session;
		if (!session.path) {
			this.notice = { text: "That session has no file on disk yet", tone: "error" };
			return false;
		}
		if (session.isCurrent) {
			this.notice = { text: "Already in this session", tone: "info" };
			return false;
		}
		this.done({ type: "switch", sessionPath: session.path });
		return true;
	}

	private setExpanded(expanded: boolean): void {
		const entry = this.selectedEntry();
		if (!entry || entry.kind !== "workspace") return;
		if (expanded) this.expanded.add(entry.workspace.cwd);
		else this.expanded.delete(entry.workspace.cwd);
		this.clampSelection();
	}

	private toggleHidden(): void {
		this.showingHidden = !this.showingHidden;
		this.filter = "";
		this.searching = false;
		this.selected = 0;
		this.scroll = 0;
		this.manualScroll = false;
		this.notice = {
			text: this.showingHidden ? "Hidden workspaces · x restores" : "Showing active workspaces",
			tone: "info",
		};
	}

	private clearFilter(): void {
		this.filter = "";
		this.regexError = undefined;
		this.searching = false;
		this.clampSelection();
	}

	private toggleWorkspaceVisibility(): void {
		const entry = this.selectedEntry();
		if (!entry || entry.kind !== "workspace") {
			this.notice = { text: "Select a workspace row first", tone: "error" };
			return;
		}
		const key = canonicalPath(entry.workspace.cwd) ?? entry.workspace.cwd;
		const hide = !this.hiddenWorkspaces.has(key);
		const result = this.setWorkspaceHidden(entry.workspace.cwd, hide);
		if (!result.ok) {
			this.notice = { text: result.error ?? "Could not update workspace list", tone: "error" };
			return;
		}
		if (hide) this.hiddenWorkspaces.add(key);
		else this.hiddenWorkspaces.delete(key);
		this.notice = {
			text: hide ? "Removed from list; sessions are kept (h to restore)" : "Workspace restored to list",
			tone: "info",
		};
		this.clampSelection();
	}

	private startNewSession(): boolean {
		const workspace = this.workspaceFor(this.selectedEntry());
		const cwd = workspace?.cwd && !workspace.missing ? workspace.cwd : this.currentCwd;
		if (!cwd) {
			this.notice = { text: "Pick a workspace first", tone: "error" };
			return false;
		}
		this.done({ type: "new-session", cwd });
		return true;
	}

	private startMove(): void {
		const entry = this.selectedEntry();
		if (!entry || entry.kind !== "session") return;
		if (!entry.session.path) {
			this.notice = { text: "That session has no file on disk yet", tone: "error" };
			return;
		}
		this.moveTarget = entry.session;
		this.openFolderBrowser("move-session");
	}

	private startRename(): void {
		const entry = this.selectedEntry();
		if (!entry || entry.kind !== "session") return;
		this.renameTarget = entry.session;
		this.renameValue = entry.session.title;
		this.mode = "rename";
	}

	private saveRename(): void {
		const target = this.renameTarget;
		const name = this.renameValue.trim();
		this.mode = "list";
		this.renameTarget = undefined;
		if (!target || !name) return;
		const result = this.rename(target.path, name);
		if (!result.ok) {
			this.notice = { text: result.error ?? "Rename failed", tone: "error" };
			return;
		}
		this.notice = { text: `Renamed to "${truncateToWidth(name, 40, "…")}"`, tone: "info" };
		this.refresh();
	}

	private startDelete(): void {
		const entry = this.selectedEntry();
		if (!entry || entry.kind !== "session") return;
		if (entry.session.isCurrent) {
			this.notice = { text: "Cannot delete the session you are in", tone: "error" };
			return;
		}
		this.deleteTarget = entry.session;
		this.mode = "confirm-delete";
	}

	private confirmDelete(): void {
		const target = this.deleteTarget;
		this.mode = "list";
		this.deleteTarget = undefined;
		if (!target) return;
		void this.remove(target.path).then((result) => {
			if (!result.ok) {
				this.notice = { text: result.error ?? "Delete failed", tone: "error" };
				this.tui.requestRender();
				return;
			}
			this.notice = { text: result.method === "trash" ? "Moved to trash" : "Deleted", tone: "info" };
			this.refresh();
		});
	}

	private cancelMode(): void {
		if (this.mode === "folder") {
			this.mode = "list";
			this.folderFilter = "";
			this.moveTarget = undefined;
			return;
		}
		this.mode = "list";
		this.renameTarget = undefined;
		this.deleteTarget = undefined;
	}

	// -------------------------------------------------------------- folder mode

	private openFolderBrowser(purpose: FolderPurpose = "new-session"): void {
		const workspace = this.workspaceFor(this.selectedEntry());
		const start = workspace?.cwd && !workspace.missing ? workspace.cwd : this.currentCwd || expandHome("~");
		this.folderPurpose = purpose;
		this.folderPath = start;
		this.folderFilter = "";
		this.folderSelected = 0;
		this.folderScroll = 0;
		this.mode = "folder";
		this.reloadFolderRows();
	}

	private reloadFolderRows(): void {
		this.folderManualScroll = false;
		this.folderScroll = 0;
		const existing = listDirectories(this.folderPath);
		const rows: FolderRow[] = [{ kind: this.folderPurpose === "move-session" ? "move" : "create", path: this.folderPath }];

		const typed = expandHome(this.folderFilter.trim());
		if (typed && typed !== this.folderPath && (typed.startsWith("/") || typed.startsWith("~"))) {
			const listed = listDirectories(typed);
			if (!listed.error) rows.push({ kind: "jump", path: typed });
		}

		const query = this.folderFilter.trim().toLowerCase();
		if (!query || query.startsWith("/") || query.startsWith("~")) {
			const parent = parentDirectory(this.folderPath);
			if (parent) rows.push({ kind: "parent", path: parent });
		}

		const dirs = existing.entries.filter(
			(entry) =>
				!query ||
				query.startsWith("/") ||
				query.startsWith("~") ||
				entry.name.toLowerCase().includes(query),
		);
		for (const entry of dirs) rows.push({ kind: "dir", entry });

		this.folderRows = rows;
		this.folderSelected = Math.max(0, Math.min(this.folderSelected, rows.length - 1));
		this.tui.requestRender();
	}

	private folderOpen(path: string): void {
		this.folderPath = path;
		this.folderFilter = "";
		this.folderSelected = 0;
		this.folderScroll = 0;
		this.reloadFolderRows();
	}

	private activateFolder(): void {
		const row = this.folderRows[this.folderSelected];
		if (!row) return;
		switch (row.kind) {
			case "create":
				this.done({ type: "new-session", cwd: row.path });
				return;
			case "move":
				this.moveFolder(row.path);
				return;
			case "jump":
			case "parent":
				this.folderOpen(row.path);
				return;
			case "dir":
				this.folderOpen(row.entry.path);
				return;
		}
	}

	private moveFolder(targetCwd: string): boolean {
		if (!this.moveTarget) return false;
		this.done({ type: "move-session", sessionPath: this.moveTarget.path, targetCwd, isCurrent: this.moveTarget.isCurrent });
		return true;
	}

	invalidate(): void {}
	dispose(): void {}
}
