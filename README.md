# Pi Workspaces

A workspace/session switcher for Pi. It groups sessions by working directory and lets you switch, create, rename, or delete sessions from a centered panel.

## Install

```sh
pi install git:github.com/Gendyyy/workspaces
```

Open the panel with `/ws` or `Ctrl+Shift+S`.

## Features

- Browse sessions grouped by workspace
- Switch to an existing session
- Create a new session in a selected workspace
- Rename or delete sessions
- Search/filter the workspace list
- Hide workspaces from the list without deleting sessions (`x`); press `h` to view hidden workspaces and `x` to restore one

This package uses Pi's host-provided `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` APIs.
