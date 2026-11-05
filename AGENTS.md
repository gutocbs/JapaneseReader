# AGENTS.md

## Project Overview

Japanese Reader is a local Japanese reading and study application. It provides a browser UI for document management, reading, analysis, vocabulary, tags, reading overrides, and reading exceptions, with an optional Docker-packaged runtime and a separate note.com import userscript.

## Tech Stack

- Backend: Python 3.12, FastAPI, Uvicorn, Pydantic, SudachiPy/SudachiDict.
- Persistence: SQLite with ordered SQL migrations; the default database path is `./data/japanese-reader.db` and can be overridden with `DATABASE_PATH`.
- Frontend: React, TypeScript, Vite, TanStack Query, Vitest; frontend DTOs are generated from `frontend/openapi.json`.
- Tooling: `uv`, npm, PowerShell, Docker Compose.
- Import userscript: JavaScript modules bundled for Tampermonkey with a local `POST /api/imports` integration.

## Architecture

`backend/app/main.py` creates the FastAPI application, SQLite repositories, services, error handlers, API router, and optional static frontend serving. Feature routers under `backend/app/*/api.py` expose services and repositories for documents, imports, analysis, readings, reading exceptions, vocabulary, and tags. Analysis uses Sudachi morphology and furigana alignment; its results are derived, revision-aware SQLite cache data while document content remains canonical.

The frontend starts at `frontend/src/main.tsx`, composes providers and React Query in `frontend/src/app/App.tsx`, and dispatches paths through `frontend/src/app/router.tsx` to feature pages. `frontend/src/shared/api/client.ts` is the typed HTTP boundary. Docker builds the Vite frontend first and serves the resulting static files from the Python runtime.

## Main Components

- `backend/app/documents/`: document models, repository, service, and API.
- `backend/app/analysis/`: morphology, furigana alignment, analysis models, cache-aware service, and API.
- `backend/app/readings/` and `backend/app/reading_exceptions/`: document reading overrides and global lemma exceptions.
- `backend/app/vocabulary/` and `backend/app/tags_api.py`: vocabulary selections, display preferences, and document tags.
- `backend/app/persistence/`: SQLite connection, migrations, repositories, and in-memory test adapters.
- `frontend/src/features/`: document library/editor/reader, settings, tags, vocabulary, and reading-exception UI.
- `frontend/src/shared/api/`: generated OpenAPI types and the typed transport client.
- `userscript/note-import/`: note.com extraction, local API transport, UI, tests, and the generated installable bundle.
- `backend/tests/`, `frontend/src/**/*.test.*`, and `userscript/note-import/*.test.js`: backend, frontend, and userscript verification suites.

## Project Conventions

- Run local development from the repository root with `npm run dev`; backend and frontend can also run separately with `npm run dev:backend` and `npm run dev:frontend`.
- Backend tests are discovered from `backend/tests` by pytest; frontend tests use Vitest in run mode.
- Keep domain behavior in feature services and persistence behind repository interfaces; wire concrete SQLite implementations in `backend/app/main.py`.
- Add SQLite schema changes as the next numbered SQL migration under `backend/app/persistence/sqlite/migrations/`.
- Treat `frontend/openapi.json` as the HTTP schema source. After API schema or route changes, run `npm run api:generate` and commit the OpenAPI document and generated TypeScript together. Do not edit generated types manually.
- Preserve `application/problem+json` error fields (`type`, `title`, `status`, `detail`) at API boundaries.
- After changing userscript source modules, regenerate `userscript/note-import/note-import.user.js` and run its syntax check; automated tests do not prove real Tampermonkey or live note.com behavior.

## Instructions for AI Assistants

- Preserve the existing architecture and keep changes consistent with the current layering, naming, routing, persistence, and generated-contract workflow.
- Do not alter external HTTP, OpenAPI, userscript, or persisted-data contracts without validating the affected backend tests, frontend client/types, migrations, and documented workflow.
- Treat `Document.content` as canonical and analysis as derived cache data; preserve revision and invalidation behavior when changing analysis or reading features.
- Prefer the repository's existing commands and test organization. Report backend, frontend, userscript, build, Docker, and manual/runtime evidence separately; do not infer live-browser or live-Docker behavior from unit tests or a successful build.
- Keep changes narrowly scoped, avoid editing generated files by hand, and do not modify unrelated user changes.
- Be objective and do not speculate about rules, contracts, or runtime behavior that are not supported by repository code, configuration, tests, or documentation.
