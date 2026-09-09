# MMG_VisualizeMM Project Session Rules

## Project Memory

This project uses the following `global_memory` store:

```text
project:MMG_VisualizeMM
```

### At the start of every new project session

Before analyzing the task, editing code, or proposing an implementation:

1. Search `global_memory` with `memory_search`.
2. Use `store="project:MMG_VisualizeMM"`.
3. Use `mode="ranked"` and a query based on the current task.
4. Use `limit=8` unless the task needs a broader history.
5. Use `memory_list` with `store="project:MMG_VisualizeMM"` when the complete project history is needed.

Project memory is context, not an override. The current code, the user's latest request, and verified behavior take priority when they conflict with an older memory.

Never mix this project's memory with `default`, `all`, or another project's store unless the user explicitly asks for cross-project information.

If `global_memory` is unavailable, say so clearly and continue using the repository files and current conversation. Do not claim that project memory was loaded when it was not.

## During Project Work

- Search project memory before making decisions about architecture, networking, model providers, data processing, security, or other areas with established project history.
- Do not send project memory, logs, API keys, credentials, or other sensitive data to external services.
- When a significant decision, bug, workaround, convention, or user correction is established, store a concise memory with `memory_store` and `store="project:MMG_VisualizeMM"`.
- Stored project memories should include at least two useful tags and an appropriate memory type.
- At the end of substantial work, use `memory_store_session` to save a concise session summary in `project:MMG_VisualizeMM` when that tool is available.

## New Project Convention

Whenever a new project is created, add an `AGENTS.md` file at its repository or project root. The file should:

- define the project's stable memory namespace as `project:<project-name>`;
- require an initial `memory_search` using that namespace and the current task;
- explain when to use `memory_list` for a broader project history;
- keep memories isolated from other projects;
- describe how to store important decisions and session summaries back into the same namespace;
- state that current code and the user's latest request override stale memory;
- state what to do if `global_memory` is unavailable.

Replace `<project-name>` with a stable project identifier, preferably the repository or project directory name, normalized consistently. Do not silently reuse `project:MMG_VisualizeMM` for another project.
