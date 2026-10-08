/**
 * Workspaces panel (/ws, Ctrl+Shift+S).
 *
 * A toggleable centered panel listing every workspace pi knows about
 * (grouped by session cwd) and the sessions inside each one. Enter switches,
 * n starts a new session, o browses to any folder, r renames, d deletes.
 *
 * pi only exposes switchSession()/newSession() on the command context, so
 * both /ws and the keyboard shortcut dispatch the /ws command. The command
 * path opens the panel and applies the selected action with a real command
 * context.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
	abbreviatePath,
	attachWorkspacePath,
	createNewSessionFile,
	loadHiddenWorkspaces,
	deleteSession,
	loadWorkspaces,
	removeEmptySessionFile,
	renameSession,
	sessionsRootFor,
	setWorkspaceHidden,
} from "./data.ts";
import { WorkspacePanel, type PanelAction } from "./panel.ts";

const PANEL_TITLE = "Workspaces";

function panelWidth(): number {
	const columns = process.stdout.columns ?? 100;
	return Math.max(44, Math.min(66, columns - 34));
}

function requireTui(ctx: ExtensionContext): boolean {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		ctx.ui.notify(`${PANEL_TITLE} needs the interactive TUI`, "warning");
		return false;
	}
	return true;
}

/** Open the switcher and wait for the user to resolve it into an action. */
async function openPanel(ctx: ExtensionContext, initialFilter?: string): Promise<PanelAction | undefined> {
	const sessionsDir = sessionsRootFor(ctx.sessionManager.getSessionDir(), ctx.cwd);
	const load = () =>
		loadWorkspaces({
			currentCwd: ctx.cwd,
			currentSessionFile: ctx.sessionManager.getSessionFile(),
			sessionsDir,
		});

	const workspaces = await load();
	const action = await ctx.ui.custom<PanelAction>(
		(tui, theme, _keybindings, done) =>
			new WorkspacePanel({
				theme,
				tui,
				currentCwd: ctx.cwd,
				workspaces,
				hiddenWorkspaces: loadHiddenWorkspaces(),
				reload: load,
				rename: renameSession,
				remove: deleteSession,
				setWorkspaceHidden,
				done,
				initialFilter,
			}),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: panelWidth(),
				maxHeight: "90%",
			},
		},
	);
	return action;
}

/** Execute an action. Only callable from a command context. */
async function performAction(ctx: ExtensionCommandContext, action: PanelAction | undefined): Promise<void> {
	if (!action || action.type === "cancel") return;
	await ctx.waitForIdle();

	if (action.type === "new-session") {
		const cwd = action.cwd || ctx.cwd;
		const created = createNewSessionFile(cwd, sessionsRootFor(ctx.sessionManager.getSessionDir(), ctx.cwd));
		if (!created.path) {
			ctx.ui.notify(created.error ?? "Could not create a session file", "error");
			return;
		}
		const result = await ctx.switchSession(created.path, {
			withSession: async (next) => {
				next.ui.notify(`New session in ${abbreviatePath(cwd)}`, "info");
			},
		});
		if (result.cancelled) await removeEmptySessionFile(created.path);
		return;
	}

	const result = await ctx.switchSession(action.sessionPath, {
		withSession: async (next) => {
			next.ui.notify("Switched session", "info");
		},
	});
	if (result.cancelled) ctx.ui.notify("Session switch cancelled", "info");
}

async function runCommand(ctx: ExtensionCommandContext, initialFilter?: string): Promise<void> {
	if (!requireTui(ctx)) return;
	// Show the panel immediately, even if an agent turn is streaming. Any action
	// that changes sessions waits for idle in performAction().
	let action = await openPanel(ctx, initialFilter);
	while (action?.type === "attach-workspace") {
		const path = await ctx.ui.input("Attach workspace", "Absolute, ~, or current-directory-relative path");
		if (path === undefined) return;
		const result = attachWorkspacePath(path, ctx.cwd);
		if (!result.ok) {
			ctx.ui.notify(result.error ?? "Could not attach workspace", "error");
		} else {
			ctx.ui.notify(
				result.alreadyAttached ? "Workspace is already attached" : `Attached ${abbreviatePath(result.path ?? path)}`,
				"info",
			);
		}
		action = await openPanel(ctx, initialFilter);
	}
	await performAction(ctx, action);
}

export default function workspacesExtension(pi: ExtensionAPI): void {
	pi.registerCommand("ws", {
		description: "Open the workspaces sidebar: switch, create, rename, or delete sessions",
		handler: async (args, ctx) => {
			const filter = args.trim();
			await runCommand(ctx, filter.length > 0 ? filter : undefined);
		},
	});

	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "Open the workspaces sidebar",
		handler: async (ctx) => {
			if (!requireTui(ctx)) return;
			if (!ctx.isIdle()) {
				ctx.ui.notify(`${PANEL_TITLE}: wait for the current turn to finish`, "warning");
				return;
			}
			// Let /ws own the panel and selection using a command context.
			pi.sendUserMessage("/ws", { expandPromptTemplates: true });
		},
	});
}
