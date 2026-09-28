# MMG_VisualizeMM Project Session Rules

## Project Memory

The repository-root [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) is the canonical, reviewable project memory. Do not depend on an MCP memory service for routine project work.

### At the start of every new project session

Before analyzing the task, editing code, or proposing an implementation:

1. Read the repository-root [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md).
2. Read linked authoritative documents when the task needs detail beyond that summary.
3. Inspect current code and verification evidence before relying on remembered implementation or test results.

Project memory is context, not an override. Current code, tests, verified behavior, and the user's latest request take priority when they conflict with it. Keep this project's memory in this repository; do not use another project's memory as a substitute.

## During Project Work

- Read project memory before making decisions about architecture, networking, model providers, data processing, security, or other areas with established project history.
- Do not send project memory, logs, API keys, credentials, or other sensitive data to external services.
- When a significant decision, bug, workaround, convention, or user correction is established, update the appropriate section of `PROJECT_MEMORY.md` with concise evidence and implications.
- At the end of substantial work, update its progress, verification, limitations, and next-step sections when those facts changed.
- Do not add transient debugging logs or secrets.

## New Project Convention

Whenever a new project is created, add an `AGENTS.md` file at its repository or project root. The file should:

- create a root `PROJECT_MEMORY.md` as the canonical, reviewable cross-session project summary;
- require reading it at the start of each project session;
- explain how to update stable decisions, evidence, limitations, and next steps;
- keep each project's memory in its own repository;
- state that current code and the user's latest request override stale memory.

Keep `PROJECT_MEMORY.md` at the project root and do not copy project-specific memory into another project's repository.
