/**
 * Test harness for the workspaces panel: fake TUI and theme, workspace fixtures,
 * and text-based click helpers that resolve coordinates from rendered lines.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { SessionRow, WorkspaceRow } from "../extensions/workspaces/data.ts";
import { WorkspacePanel, type PanelAction } from "../extensions/workspaces/panel/index.ts";

/** Panel width used by tests; 66 columns is a realistic narrow terminal. */
export const WIDTH = 66;
/** Terminal height used by tests. */
export const ROWS = 40;

const BASE_TIME = new Date("2024-05-01T10:00:00Z");

/** Build a session row with defaults the panel does not care about. */
export function makeSession(title: string, overrides: Partial<SessionRow> = {}): SessionRow {
	return {
		path: `/tmp/sessions/${title}.jsonl`,
		title,
		searchText: title.toLowerCase(),
		created: BASE_TIME,
		modified: BASE_TIME,
		messageCount: 2,
		isCurrent: false,
		missingCwd: false,
		...overrides,
	};
}

/** Build a workspace row with a cwd derived from its label. */
export function makeWorkspace(
	label: string,
	sessions: SessionRow[],
	overrides: Partial<WorkspaceRow> = {},
): WorkspaceRow {
	return {
		cwd: `/tmp/${label}`,
		label,
		sessions,
		modified: sessions[0]?.modified ?? BASE_TIME,
		isCurrent: false,
		missing: false,
		...overrides,
	};
}

/** Fixture with an expanded current workspace (7 sessions) and a collapsed one. */
export function makeWorkspaces(): WorkspaceRow[] {
	const sessions = [1, 2, 3, 4, 5, 6, 7].map((day) =>
		makeSession(`Alpha session ${day}`, { modified: new Date(BASE_TIME.getTime() + day * 60_000) }),
	);
	const alpha = makeWorkspace("alpha", sessions, {
		// /tmp exists on every platform, so the folder browser can list it for real.
		cwd: "/tmp",
		isCurrent: true,
	});
	const beta = makeWorkspace("beta", [makeSession("Beta session")]);
	return [alpha, beta];
}

/** Identity theme: styling is applied by pi, but tests assert on plain text. */
export const testTheme = {
	fg: (_color: string, value: string) => value,
	style: (value: string) => value,
} as unknown as Theme;

/** Fake TUI exposing only what the panel touches. */
class FakeTui {
	readonly terminal = { rows: ROWS };
	renders = 0;

	requestRender(): void {
		this.renders++;
	}
}

/** Theme that keeps the text intact but spells out the styles it was asked for. */
export const markingTheme = {
	fg: (color: string, value: string) => `«${color}»${value}`,
	style: (value: string, options?: { fg?: string; bg?: string; bold?: boolean; underline?: boolean }) =>
		`«${[options?.fg, options?.bg, options?.bold ? "bold" : undefined, options?.underline ? "underline" : undefined]
			.filter(Boolean)
			.join(" ")}»${value}`,
} as unknown as Theme;

export interface HarnessOptions {
	workspaces?: WorkspaceRow[];
	currentCwd?: string;
	rows?: number;
	initialFilter?: string;
	theme?: Theme;
}

/** Wraps a panel with recorded actions and coordinate helpers. */
export class PanelHarness {
	readonly panel: WorkspacePanel;
	readonly tui = new FakeTui();
	readonly actions: PanelAction[] = [];
	readonly renameCalls: { sessionPath: string; name: string }[] = [];
	readonly removeCalls: string[] = [];
	readonly hiddenCalls: { cwd: string; hidden: boolean }[] = [];
	private readonly workspaces: WorkspaceRow[];
	lines: string[] = [];

	constructor(options: HarnessOptions = {}) {
		this.workspaces = options.workspaces ?? makeWorkspaces();
		this.tui.terminal.rows = options.rows ?? ROWS;
		this.panel = new WorkspacePanel({
			theme: options.theme ?? testTheme,
			tui: this.tui as unknown as TUI,
			currentCwd: options.currentCwd ?? "/tmp",
			workspaces: this.workspaces,
			reload: async () => this.workspaces,
			rename: (sessionPath, name) => {
				this.renameCalls.push({ sessionPath, name });
				return { ok: true };
			},
			remove: async (sessionPath) => {
				this.removeCalls.push(sessionPath);
				return { ok: true };
			},
			hiddenWorkspaces: new Set<string>(),
			setWorkspaceHidden: (cwd, hidden) => {
				this.hiddenCalls.push({ cwd, hidden });
				return { ok: true };
			},
			done: (action) => this.actions.push(action),
			initialFilter: options.initialFilter,
		});
	}

	/** Render at a width and remember the lines for coordinate lookups. */
	render(width: number = WIDTH): string[] {
		this.lines = this.panel.render(width);
		return this.lines;
	}

	/** Whole frame as one string, for presence assertions. */
	get text(): string {
		return this.lines.join("\n");
	}

	/** Find the first (or nth) occurrence of a substring in the last render. */
	locate(needle: string, occurrence = 0): { y: number; x: number } {
		let seen = 0;
		for (let y = 0; y < this.lines.length; y++) {
			let x = this.lines[y].indexOf(needle);
			while (x !== -1) {
				if (seen === occurrence) return { y, x };
				seen++;
				x = this.lines[y].indexOf(needle, x + 1);
			}
		}
		throw new Error(`text not found: ${needle} (occurrence ${occurrence})\n${this.text}`);
	}

	/** Build a mouse event with coordinates local to the panel. */
	mouse(type: TuiMouseEvent["type"], point: { y: number; x: number }, extra: Partial<TuiMouseEvent> = {}): TuiMouseEvent {
		return {
			type,
			button: "left",
			x: point.x,
			y: point.y,
			screenX: point.x,
			screenY: point.y,
			width: WIDTH,
			height: ROWS,
			shift: false,
			alt: false,
			ctrl: false,
			clickCount: type === "click" ? 1 : undefined,
			...extra,
		} as TuiMouseEvent;
	}

	/** Move the pointer over a rendered substring and return the panel's reply. */
	move(needle: string, occurrence = 0): { handled: boolean; render?: boolean } | undefined {
		return this.panel.handleMouse(this.mouse("move", this.locate(needle, occurrence)));
	}

	/** Press and release (click) on a rendered substring, like a real terminal. */
	click(needle: string, occurrence = 0): void {
		const point = this.locate(needle, occurrence);
		this.panel.handleMouse(this.mouse("press", point));
		this.panel.handleMouse(this.mouse("click", point));
	}

	/** Press (without releasing) on a rendered substring, which only selects the row. */
	press(needle: string, occurrence = 0): void {
		this.panel.handleMouse(this.mouse("press", this.locate(needle, occurrence)));
	}

	/** Send a keyboard sequence to the panel. */
	key(data: string): void {
		this.panel.handleInput(data);
	}
}
