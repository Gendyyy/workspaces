/**
 * Pure list model for the workspaces panel: filtering, sorting, paging, and
 * selection arithmetic. No rendering and no terminal state live here.
 */
import { canonicalPath, type SessionRow, type WorkspaceRow } from "../data.ts";

export type SortMode = "modified" | "created";

export type Entry =
	| { kind: "workspace"; workspace: WorkspaceRow; expanded: boolean }
	| { kind: "session"; workspace: WorkspaceRow; session: SessionRow; matchSnippet?: string }
	| { kind: "more"; workspace: WorkspaceRow; showing: number; total: number };

export const MIN_BODY_ROWS = 6;
export const MAX_BODY_ROWS = 18;
/** Lines the panel spends on chrome (borders, separators, filter, hints). */
export const CHROME_ROWS = 8;
export const SESSION_PAGE_SIZE = 5;

export interface EntryInput {
	workspaces: WorkspaceRow[];
	hiddenWorkspaces: Set<string>;
	showingHidden: boolean;
	filter: string;
	regexMode: boolean;
	sortMode: SortMode;
	expanded: Set<string>;
	visibleSessions: Map<string, number>;
}

export interface EntryResult {
	entries: Entry[];
	regexError?: string;
}

/** Newest session timestamp under the active sort order. */
function sessionTime(session: SessionRow, sortMode: SortMode): number {
	return (sortMode === "modified" ? session.modified : session.created).getTime();
}

/** Compile the filter as a regex when regex mode is on; report invalid patterns. */
export function compileRegex(query: string, enabled: boolean): { regex?: RegExp; error?: string } {
	if (!enabled || !query) return {};
	try {
		return { regex: new RegExp(query, "is") };
	} catch {
		return { error: "Invalid regex" };
	}
}

/** Flatten workspaces and sessions into the visible row list. */
export function buildEntries(input: EntryInput): EntryResult {
	const query = input.filter.trim().toLowerCase();
	const compiled = compileRegex(query, input.regexMode);
	const invalidRegex = input.regexMode && query.length > 0 && !compiled.regex;
	const matches = (text: string) =>
		compiled.regex ? compiled.regex.test(text) : text.includes(query);

	const workspaces = input.workspaces
		.filter((workspace) => {
			const key = canonicalPath(workspace.cwd) ?? workspace.cwd;
			return input.hiddenWorkspaces.has(key) === input.showingHidden;
		})
		.sort((left, right) => {
			if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
			const newest = (workspace: WorkspaceRow) =>
				workspace.sessions.reduce(
					(latest, session) => Math.max(latest, sessionTime(session, input.sortMode)),
					0,
				);
			return newest(right) - newest(left);
		});

	const entries: Entry[] = [];
	for (const workspace of workspaces) {
		const workspaceText = `${workspace.label} ${workspace.cwd} ${workspace.branch ?? ""}`.toLowerCase();
		const workspaceMatches = !query || (!invalidRegex && matches(workspaceText));
		const sessions: Entry[] = [...workspace.sessions]
			.sort((left, right) => sessionTime(right, input.sortMode) - sessionTime(left, input.sortMode))
			.flatMap((session): Entry[] => {
				if (!query) return [{ kind: "session", workspace, session }];
				if (invalidRegex) return [];
				const metadataText = `${session.title} ${session.path}`.toLowerCase();
				const metadataMatch = matches(metadataText);
				const contentMatch = compiled.regex ? compiled.regex.exec(session.searchText) : undefined;
				const contentIndex = compiled.regex ? (contentMatch?.index ?? -1) : session.searchText.indexOf(query);
				if (!metadataMatch && contentIndex < 0) return [];
				const snippetLength = contentMatch?.[0].length ?? query.length;
				const matchSnippet =
					!metadataMatch && contentIndex >= 0
						? `…${session.searchText
								.slice(contentIndex, contentIndex + Math.min(snippetLength, 18))
								.replace(/\s+/g, " ")}…`
						: undefined;
				return [{ kind: "session", workspace, session, matchSnippet }];
			});
		if (query && !workspaceMatches && sessions.length === 0) continue;
		// A search forces every surviving workspace open so hits are never hidden.
		const expanded = query ? true : input.expanded.has(workspace.cwd);
		entries.push({ kind: "workspace", workspace, expanded });
		if (!expanded) continue;
		if (query) {
			entries.push(...sessions);
			continue;
		}
		const showing = Math.min(
			input.visibleSessions.get(workspace.cwd) ?? SESSION_PAGE_SIZE,
			sessions.length,
		);
		entries.push(...sessions.slice(0, showing));
		if (showing < sessions.length) entries.push({ kind: "more", workspace, showing, total: sessions.length });
	}
	return { entries, regexError: compiled.error };
}

/** How many body rows fit in the terminal. */
export function bodyRows(terminalRows: number | undefined): number {
	const rows = terminalRows ?? 32;
	return Math.max(MIN_BODY_ROWS, Math.min(MAX_BODY_ROWS, rows - CHROME_ROWS));
}

/** Keep a selection inside the list. */
export function clampSelection(total: number, selected: number): number {
	return total === 0 ? 0 : Math.max(0, Math.min(selected, total - 1));
}

/**
 * Slide a fixed-height window over a list, keeping `selected` visible unless
 * the user scrolled manually. Returns the resolved scroll offset.
 */
export function windowStart(
	total: number,
	height: number,
	selected: number,
	manualScroll: boolean,
	scroll: number,
): number {
	let next = scroll;
	if (!manualScroll) {
		if (selected < next) next = selected;
		if (selected >= next + height) next = selected - height + 1;
	}
	return Math.max(0, Math.min(next, Math.max(0, total - height)));
}

/** Reveal one more page of sessions for a workspace. */
export function nextVisibleCount(current: number, total: number, pageSize = SESSION_PAGE_SIZE): number {
	return Math.min(current + pageSize, total);
}
