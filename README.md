# Figma Agentic Interface

Agentic interface for Figma: create and edit designs via natural-language prompts. A Figma plugin talks to a small backend that calls an LLM and returns structured design operations; the plugin applies them in Figma.

## Structure

- **`figma-plugin/`** – Figma plugin (TypeScript, runs inside Figma). UI for prompts; calls backend; interprets design ops and applies them via the Figma Plugin API.
- **`backend/`** – Next.js app with API routes that proxy LLM calls (keep API keys server-side) and return design ops JSON.

## Setup

1. **Backend:** `cd backend && npm i && cp .env.example .env` — set your `OPENAI_API_KEY` (or similar). Run `npm run dev`.
2. **Plugin:** `cd figma-plugin && npm i && npm run build` — then in Figma: Plugins → Development → Import plugin from manifest → choose `figma-plugin/manifest.json`. Point plugin to your backend URL (e.g. `http://localhost:3000`).
3. Use a **testing** branch for work in progress; merge to `main` when ready.

## Branch policy

- **`testing`** – active development and pushes.
- **`main`** – updated only when explicitly requested.
