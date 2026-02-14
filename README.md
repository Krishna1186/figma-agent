# Figma Agent

An AI-powered Figma plugin that generates and manipulates design elements using natural language prompts. Built with React, TypeScript, and Google Gemini.

## Overview

Figma Agent translates plain-English descriptions into structured Figma designs. It uses Google's Gemini API (free tier) to interpret design intent and produces fully editable Figma nodes with proper Auto Layout, typography, colors, gradients, and effects.

### Key Features

- **Natural language design generation** -- describe what you want and the AI builds it on your canvas
- **Recursive node tree** -- supports nested frames, auto layout, and complex component hierarchies
- **Auto Layout** -- vertical/horizontal stacking with spacing, padding, and alignment
- **Rich styling** -- solid fills, linear gradients, drop shadows, blur effects, strokes, corner radius
- **Typography** -- custom fonts, sizes, alignment, letter spacing, line height, text decoration
- **Image injection** -- upload an image and reference it in your prompt
- **Chat interface** -- conversational UI with message history and collapsible settings

## Architecture

The plugin follows Figma's dual-context architecture:

```
+-------------------+          postMessage          +--------------------+
|    UI Context      | --------------------------> |  Sandbox Context    |
|    (React App)     | <-------------------------- |  (Figma API)        |
|                    |                              |                    |
|  - Chat interface  |                              |  - Node builder    |
|  - Gemini API call |                              |  - Font loader     |
|  - Image upload    |                              |  - Property mapper |
+-------------------+                              +--------------------+
```

- **UI Context** (`src/ui/`): React application that handles the chat interface, API calls to Gemini, and image uploads. Bundled into a single HTML file via Vite.
- **Sandbox Context** (`src/main/code.ts`): Runs inside Figma's sandbox with access to the Plugin API. Receives structured JSON commands and recursively builds Figma nodes.
- **Shared** (`src/shared/`): Type definitions and Zod schemas shared between both contexts.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Figma Desktop](https://www.figma.com/downloads/) application
- A Google Gemini API key (free) from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

```bash
git clone https://github.com/Krishna1186/figma-agent.git
cd figma-agent
npm install
npm run build
```

## Loading the Plugin

1. Open Figma Desktop
2. Navigate to **Plugins > Development > Import plugin from manifest...**
3. Select `manifest.json` from the project root
4. Run from **Plugins > Development > Figma Agent**

## Usage

1. Enter your Gemini API key in the settings panel (click the gear icon)
2. Type a design prompt in the chat input
3. Press Enter or click the send button
4. The AI generates the design directly on your Figma canvas

### Example Prompts

```
Create an A4 page with the text "Welcome" centered in bold, blue, 48pt font

Design a pricing card with a dark background, white title, gray description,
and a blue call-to-action button at the bottom

Create a horizontal navigation bar with a logo placeholder on the left
and three menu items on the right
```

### Image Support

Click the camera icon in the header to attach an image. Reference it in your prompt and the AI will place it using an IMAGE_NODE in the design.

## Project Structure

```
figma-agent/
  manifest.json          -- Figma plugin configuration
  package.json           -- Dependencies and build scripts
  vite.config.ts         -- Vite build configuration (single-file output)
  tsconfig.json          -- TypeScript configuration
  src/
    main/
      code.ts            -- Sandbox: recursive node builder, font loader
    ui/
      index.html         -- HTML entry point
      main.tsx           -- React entry point
      App.tsx            -- Chat UI, Gemini API integration
      index.css          -- Chat interface styles
    shared/
      types.ts           -- Message types for UI-Sandbox communication
      expert_schema.ts   -- Zod schemas for Figma node definitions
  dist/                  -- Build output (generated)
    index.html           -- Bundled UI (single file, all assets inlined)
    code.js              -- Bundled sandbox code
```

## Build System

The build runs two steps:

1. **Vite** compiles the React UI into a single self-contained HTML file using `vite-plugin-singlefile`. Figma plugins require all UI assets to be inlined.
2. **esbuild** bundles the sandbox code (`code.ts`) into a single JavaScript file targeting ES6 for compatibility with Figma's JavaScript runtime.

```bash
npm run build    # Full build (UI + sandbox)
npm run watch    # Watch mode for UI changes
```

## Supported Design Properties

| Category | Properties |
|----------|-----------|
| **Layout** | `layoutMode`, `itemSpacing`, `paddingTop/Right/Bottom/Left`, `primaryAxisAlignItems`, `counterAxisAlignItems` |
| **Fills** | Solid colors (`#hex`), linear gradients with color stops |
| **Effects** | Drop shadow (radius, offset, color), layer blur |
| **Strokes** | Color, weight, alignment |
| **Corners** | Uniform radius or per-corner (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`) |
| **Text** | `fontSize`, `fontName`, `textAlignHorizontal`, `textAutoResize`, `letterSpacing`, `lineHeight`, `textDecoration` |
| **Images** | Upload and inject via `IMAGE_NODE` |
| **General** | `name`, `opacity`, `visible`, `blendMode`, `clipsContent` |

## Technical Notes

- The Gemini API is called directly via `fetch` (no SDK dependency) to keep the bundle small
- Figma's sandbox uses an older JavaScript engine; the build targets ES6 to ensure compatibility
- Font loading is recursive -- all fonts in the node tree are loaded before any nodes are constructed
- Text nodes default to `textAutoResize: "WIDTH_AND_HEIGHT"` to prevent clipping

## License

MIT
