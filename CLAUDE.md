# Saccadic AI — Visual Feedback System

## What This Is

Saccadic AI is an MCP server that provides visual comparison tools for design-to-code workflows. It compares `.pen` design files against built HTML/CSS and provides actionable feedback to reach pixel-accurate builds.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `plan_build` | Analyze a .pen file and generate a full build plan with per-page agent prompts |
| `refine_build` | Iterative comparison — call repeatedly until score reaches target |
| `compare_design_build` | One-shot comparison between design and build |
| `capture_screenshot` | Capture a screenshot of a URL |
| `load_design` | Parse a design file into structured design state |
| `get_design_tokens` | Extract design tokens from a .pen or Figma file |
| `compare_design_tokens` | Diff two sets of design tokens |
| `get_visual_diff` | Pixel diff between two images |
| `evaluate_with_vlm` | AI-powered qualitative assessment (requires ANTHROPIC_API_KEY) |

## Building From a .pen File

### Quick Start

Give Claude this prompt to build all pages from a .pen design:

```
Build all pages from the design at [path/to/design.pen].

1. Call plan_build({ pencilFile: "[path/to/design.pen]" })
2. Set up a dev server: npx serve ./build
3. For each page in the plan, spawn a parallel sub-agent with that page's agentPrompt
4. Each sub-agent should:
   a. Capture a reference screenshot via Pencil MCP get_screenshot
   b. Build the HTML/CSS with data-pen-id attributes matching the design node IDs
   c. Call refine_build with the reference screenshot until status="pass" (95%+)
5. Report final scores for all pages when done
```

### What Happens

1. **`plan_build`** reads the .pen file and returns:
   - Per-page **agent prompts** with full design structure, tokens, and node IDs
   - An **orchestration prompt** explaining parallel execution
   - Pre-filled **refine_build params** for each page

2. Each sub-agent gets a **clean context** with only its page's design info (no cross-page pollution)

3. Sub-agents iterate with **`refine_build`** which returns:
   - Current score and grade (A/B/C/D/F)
   - Prioritized fixes with CSS suggestions
   - Stall detection and recovery strategies
   - Incremental change tracking between iterations

### data-pen-id Attributes

Every HTML element must have a `data-pen-id` attribute matching its design node ID. This is how saccadic matches DOM elements to design nodes:

```html
<div data-pen-id="heroSection">
  <h1 data-pen-id="heroTitle">Welcome</h1>
  <p data-pen-id="heroSubtitle">Build something amazing</p>
</div>
```

The node IDs come from the plan_build response (`pages[].nodeIds`).

### Reference Screenshots

For pixel-accurate comparison, each sub-agent should capture a reference screenshot before building:

```
get_screenshot({ pencilFile: "design.pen", nodeId: "frameId" })
```

Then pass it to refine_build as `referenceImage`. Without this, saccadic generates an approximation from the design state which is less accurate.

### Tech Stack Options

```
plan_build({ pencilFile: "design.pen", techStack: "html" })    // default
plan_build({ pencilFile: "design.pen", techStack: "react" })
plan_build({ pencilFile: "design.pen", techStack: "nextjs" })
```

## Development

```bash
npm test          # Run all tests (217 tests)
npx tsc --noEmit  # Type check
npm run build     # Build to dist/
```

## Architecture

- `src/core/` — Comparison engine, DOM comparator, pixel comparator, screenshot engine, parsers
- `src/mcp/server.ts` — MCP server (JSON-RPC 2.0 stdio transport)
- `src/bench/` — Benchmarking harness for A/B testing with/without saccadic feedback
