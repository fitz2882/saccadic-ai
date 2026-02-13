# Saccadic AI

**Visual feedback system for AI coding agents** — see, compare, and fix UI against design specs.

Saccadic AI gives AI coding agents the ability to visually perceive what they build, compare it against design specifications, and receive actionable feedback to close the gap between design and implementation. It can orchestrate full design-to-code builds from `.pen` files with parallel page execution and iterative refinement.

## Benchmarks

| Metric | Score |
|--------|-------|
| Precision | 97.3% |
| Recall | 98.6% |
| F1 | 97.9% |
| Fixtures | 31 |

Run benchmarks locally:

```bash
npm run bench:detection
```

## How It Works

Saccadic AI runs a multi-tier comparison pipeline:

1. **Capture** a screenshot of your built page using a headless browser (Playwright)
2. **Extract** DOM computed styles (colors, fonts, spacing, layout, z-index, stacking context) from the live page
3. **Load** design specs from Figma, Pencil.dev `.pen` files, or local design token files
4. **Match** DOM elements to design nodes via a 5-pass matching pipeline (penId, structural fingerprint, IoU, text content, visual similarity)
5. **Compare** DOM properties against the design with layout-aware suppression (flex positioning, cascade dedup)
6. **Pixel diff** the screenshot against a reference image (catches visual regressions beyond DOM)
7. **Generate feedback** with severity levels, affected elements, CSS fix suggestions with specificity context
8. **Grade** the result from A (>95% match) to F (<50% match)

## Building From a .pen Design File

The fastest way to go from design to pixel-accurate code. Saccadic AI orchestrates the entire build — it analyzes the design, generates per-page build instructions, and iteratively refines each page until it matches the design at 95%+.

### Prerequisites

You need two MCP servers configured in your Claude Code settings:

1. **Saccadic AI** — the visual comparison and build orchestration engine
2. **Pencil MCP** — reads `.pen` design files and captures reference screenshots

```json
{
  "mcpServers": {
    "saccadic-ai": {
      "command": "node",
      "args": ["/path/to/saccadic-ai/dist/mcp/server.js"]
    },
    "pencil": {
      "command": "npx",
      "args": ["-y", "@anthropic/pencil-mcp"]
    }
  }
}
```

No CLAUDE.md or special config is needed in the target project — everything the agent needs comes from the `plan_build` response.

### Usage

Open your build project directory in Claude Code and give this prompt:

```
Build all pages from the design at [path/to/design.pen]

1. Call plan_build({ pencilFile: "[path/to/design.pen]" })
2. Set up a dev server: npx serve ./build
3. For each page in the plan, spawn a parallel sub-agent with that page's agentPrompt
4. Each sub-agent should:
   a. Capture a reference screenshot via Pencil MCP get_screenshot
   b. Build the HTML/CSS with data-pen-id attributes matching the design node IDs
   c. Call refine_build with the reference screenshot until status="pass" (95%+)
5. Report final scores for all pages when done
```

### How It Works

```
You (prompt)                  Claude                          Saccadic MCP            Pencil MCP
────────────                  ──────                          ────────────            ──────────
"Build from design.pen" ───→  1. plan_build(pencilFile) ───→  Parses .pen file
                                                         ←──  Returns per-page plans
                                                               with agent prompts

                              2. Spawns parallel sub-agents
                                 (one per page, clean context)

                              Sub-agent per page:
                              ├─ 3. get_screenshot(frameId) ─────────────────────────→ Returns PNG
                              │                              ←─────────────────────────
                              ├─ 4. Builds HTML/CSS with data-pen-id attributes
                              │
                              ├─ 5. refine_build(buildUrl) ──→ Compares design vs build
                              │                            ←── Score, mismatches, fixes
                              ├─ 6. Applies fixes
                              ├─ 7. refine_build(iteration=2)──→ Re-checks
                              │                              ←── Improved score
                              └─ 8. Repeats until status="pass" (≥95%)

                              9. Collects results from all sub-agents
                         ←──  10. Reports final per-page scores
```

**Key details:**

- **`plan_build`** returns self-contained agent prompts for each page — includes the full design structure (node tree), design tokens, node IDs for `data-pen-id`, and pre-filled `refine_build` params
- Each sub-agent runs in a **clean context** with only its page's design info — no cross-page pollution
- **`refine_build`** tracks iteration history per page, detects stalls, suggests recovery strategies, and orders fixes by dependency (fixing a missing parent first resolves child mismatches)
- Sub-agents capture a **reference screenshot** from Pencil MCP before building — this enables pixel-accurate comparison. Without it, saccadic generates an approximation from the design state

### data-pen-id Attributes

Every HTML element should have a `data-pen-id` attribute matching its design node ID. This is how saccadic matches DOM elements to design nodes:

```html
<div data-pen-id="heroSection">
  <h1 data-pen-id="heroTitle">Welcome</h1>
  <p data-pen-id="heroSubtitle">Build something amazing</p>
</div>
```

Node IDs come from the `plan_build` response (`pages[].nodeIds`).

### Tech Stack Options

```
plan_build({ pencilFile: "design.pen", techStack: "html" })    // default
plan_build({ pencilFile: "design.pen", techStack: "react" })
plan_build({ pencilFile: "design.pen", techStack: "nextjs" })
```

## Quick Start

### Requirements

- Node.js >= 20.0.0
- A Chromium browser (installed automatically by Playwright)

### Install

```bash
npm install
npx playwright install chromium
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

## Usage

Saccadic AI can be used four ways: as an **MCP server** for AI agents, as a **build orchestrator** for `.pen` designs, as a **CLI tool**, or as a **library**.

---

### MCP Server

Saccadic AI includes a [Model Context Protocol](https://modelcontextprotocol.io/) server that AI agents (like Claude) can use directly. It communicates over stdio using JSON-RPC 2.0.

```bash
npm run mcp
```

Add to your MCP client config (e.g., Claude Code):

```json
{
  "mcpServers": {
    "saccadic-ai": {
      "command": "node",
      "args": ["path/to/saccadic-ai/dist/mcp/server.js"]
    }
  }
}
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `plan_build` | Analyze a `.pen` file and generate a full build plan with per-page agent prompts |
| `refine_build` | Iterative build refinement — call repeatedly until score reaches target |
| `compare_design_build` | Full comparison pipeline with grading |
| `capture_screenshot` | Capture a screenshot of any URL |
| `load_design` | Parse a Figma file, `.pen` file, or token file |
| `get_visual_diff` | Pixel diff overlay between two images |
| `get_design_tokens` | Extract structured design tokens |
| `compare_design_tokens` | Compare two token sets for breaking changes |
| `evaluate_with_vlm` | Claude Vision qualitative assessment (requires `ANTHROPIC_API_KEY`) |

---

### CLI

After building, use the `saccadic-ai` CLI:

#### Compare design vs. build

```bash
# Compare a Figma design against a running page
saccadic-ai compare \
  --design "https://figma.com/file/ABC123/MyDesign" \
  --build "http://localhost:3000" \
  --viewport desktop \
  --threshold 0.9

# Compare using a local design token file
saccadic-ai compare \
  --design ./tokens.json \
  --build "http://localhost:3000" \
  --format json
```

**Output:**
```
Saccadic AI Visual Comparison Report
================================

Match: 87% (Grade B)
3 issues found: 1 color issue, 1 spacing issue, 1 missing element.

Issues (3):

[FAIL] backgroundColor mismatch. Expected "#0066FF", got "#0055DD". on .header-cta
[WARN] gap mismatch. Expected "12px", got "8px". on .card-grid
[FAIL] Missing element: hero-image

Suggested fixes:
- Change `background-color: #0055DD` to `background-color: #0066FF` on `.header-cta`
- Change `gap: 8px` to `gap: 12px` on `.card-grid`
```

Exit code is `0` if the match percentage meets the threshold, `1` otherwise — great for CI pipelines.

#### Capture a screenshot

```bash
# Save to file
saccadic-ai capture --url "http://localhost:3000" --output screenshot.png

# Capture a specific element at mobile size
saccadic-ai capture --url "http://localhost:3000" --selector ".hero" --viewport mobile

# Output as base64 (pipe to other tools)
saccadic-ai capture --url "http://localhost:3000"
```

#### Extract design tokens

```bash
# From a local token file
saccadic-ai tokens --source ./tokens.json --format text

# From Figma
saccadic-ai tokens --source "https://figma.com/file/ABC123/MyDesign"
```

#### Compare design token versions

```bash
# Check for breaking changes between token versions
saccadic-ai tokens-diff --old tokens-v1.json --new tokens-v2.json

# JSON output for CI
saccadic-ai tokens-diff --old tokens-v1.json --new tokens-v2.json --format json
```

Exit code is `1` if breaking changes detected — useful for CI token governance.

#### Pixel diff two images

```bash
saccadic-ai diff --design ./design.png --build ./build.png --output diff.png
```

#### Viewport options

Use named presets or custom dimensions:

| Name | Size |
|------|------|
| `mobile-sm` | 320x568 |
| `mobile` | 375x812 |
| `tablet` | 768x1024 |
| `desktop-sm` | 1024x768 |
| `desktop` | 1280x800 |
| `desktop-lg` | 1440x900 |

Or specify a custom size: `--viewport 1920x1080`

---

### Library

Import Saccadic AI into your own Node.js project:

```typescript
import {
  ComparisonEngine,
  ScreenshotEngine,
  DesignParser,
  PixelComparator,
} from 'saccadic-ai';

// Full comparison pipeline
const engine = new ComparisonEngine();
await engine.init();

const result = await engine.compare({
  designSource: {
    figmaFileKey: 'ABC123',
    figmaNodeId: '1:42',  // optional
  },
  buildUrl: 'http://localhost:3000',
  viewport: { width: 1280, height: 800 },
  threshold: 0.9,
});

console.log(result.overall.grade);       // 'B'
console.log(result.overall.summary);     // 'Match: 87% (Grade B). 3 issues...'
console.log(result.feedback);            // Array of actionable feedback items

await engine.close();
```

```typescript
// Just capture a screenshot
const screenshot = new ScreenshotEngine();
await screenshot.init();

const result = await screenshot.capture({
  url: 'http://localhost:3000',
  viewport: { width: 375, height: 812 },
  disableAnimations: true,
});

// result.image      — PNG Buffer
// result.domStyles  — computed styles for every visible element
// result.elementBounds — bounding boxes

await screenshot.close();
```

```typescript
// Compare two images pixel by pixel
const comparator = new PixelComparator();
const diff = comparator.compare(designPng, buildPng, { threshold: 0.1 });

console.log(diff.diffPercentage);   // 2.3
console.log(diff.diffPixels);       // 1847

// CIEDE2000 perceptual color distance
const deltaE = comparator.computeDeltaE('#0066FF', '#0055DD');
console.log(deltaE); // 3.2 (noticeable difference)
```

## Architecture

```
src/
  core/
    types.ts              — Shared types, thresholds, viewport presets
    screenshot-engine.ts  — Playwright screenshot + DOM extraction (z-index, layout context)
    design-parser.ts      — Figma API + W3C design token parsing
    pencil-parser.ts      — Pencil.dev .pen file parser (5-phase pipeline)
    pixel-comparator.ts   — pixelmatch + CIEDE2000 color science
    dom-comparator.ts     — 5-pass element matching + property comparison
    comparison-engine.ts  — Orchestrator combining all modules
    feedback-generator.ts — Actionable feedback + cascade suppression
    virtual-canvas.ts     — rbush R-tree spatial indexing
    ssim-comparator.ts    — Structural Similarity Index (pure TypeScript)
    vlm-comparator.ts     — Claude Vision qualitative assessment
    token-versioning.ts   — Design token diff engine
  mcp/
    server.ts             — JSON-RPC 2.0 stdio MCP server (9 tools)
  integration/            — E2E integration tests
  bench/                  — Benchmarking harness for A/B testing
  cli.ts                  — Commander CLI (compare, capture, tokens, tokens-diff, diff)
  index.ts                — Barrel export
```

### DOM Element Matching (5-pass)

1. **Pass 1: penId** — Exact match via `data-pen-id` attributes
2. **Pass 1.5: Structural fingerprint** — Match by child count, types, aspect ratio, area (for components without penId)
3. **Pass 2: IoU + text** — Intersection-over-Union spatial overlap with fuzzy text matching (Levenshtein)
4. **Pass 3: Type + visual** — Tag type + fill color + bounds similarity
5. **Pass 4: Name/ID fallback** — CSS selector name matching

### Comparison Pipeline

```
Design Spec (Figma / .pen / tokens)     Built Page (URL)
         |                                     |
         v                                     v
   DesignParser / PencilParser       ScreenshotEngine
   (design nodes + tokens)       (screenshot + DOM styles)
         |                              |            |
         +-------+-------+-------------+            |
                 |       |                           |
    Tier 1: DOMComparator |         Tier 2: PixelComparator
    (5-pass matching,     |         (selective regions,
     layout-aware diff)   |          viewport-weighted)
                 |        |                          |
                 |   Tier 3: SSIMComparator           |
                 |   (structural similarity)          |
                 |        |                          |
                 |   Tier 4: VLMComparator            |
                 |   (Claude Vision, optional)        |
                 |        |                          |
                 v        v                          v
         Tier 5: FeedbackGenerator
         (cascade suppression, dependency ordering,
          CSS specificity fixes, grades)
```

### Grading Scale

| Grade | Match % | Meaning |
|-------|---------|---------|
| A | >95% | Excellent — nearly pixel-perfect |
| B | >85% | Good — minor differences |
| C | >70% | Acceptable — noticeable issues |
| D | >50% | Poor — significant gaps |
| F | <50% | Failing — major discrepancies |

### Perceptual Thresholds

Saccadic AI uses research-backed thresholds to distinguish real issues from imperceptible noise:

- **Color**: CIEDE2000 (deltaE < 1.0 = imperceptible, 1.0-2.0 = minor, >2.0 = fail)
- **Position**: Weber fraction (< 2% = imperceptible, 2-4% = noticeable, >4% = fail)
- **Size**: Weber fraction (< 2.9% = imperceptible, 2.9-5% = noticeable, >5% = fail)
- **Pixel diff**: < 1% pixels = pass, 1-5% = warn, >5% = fail

## Configuration

### Figma Access Token

For Figma integration, set your access token:

```bash
export FIGMA_ACCESS_TOKEN=your_token_here
```

Generate a token at: **Figma > Settings > Personal Access Tokens**

### Anthropic API Key

For VLM (Claude Vision) evaluation and stall-breaking:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or set it in your MCP server config:

```json
{
  "mcpServers": {
    "saccadic-ai": {
      "command": "node",
      "args": ["path/to/saccadic-ai/dist/mcp/server.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Design Token Files

Saccadic AI supports the [W3C Design Token Community Group](https://design-tokens.github.io/community-group/format/) JSON format:

```json
{
  "color": {
    "primary": {
      "$value": "#0066FF",
      "$type": "color"
    },
    "background": {
      "$value": "#FFFFFF",
      "$type": "color"
    }
  },
  "spacing": {
    "sm": {
      "$value": "8px",
      "$type": "dimension"
    }
  }
}
```

## Development

```bash
npm run dev          # Watch mode (rebuild on changes)
npm test             # Run all 217 tests
npm run test:watch   # Watch mode for tests
npm run test:coverage # Coverage report
npm run lint         # ESLint
npm run typecheck    # TypeScript check without emitting
```

## License

Apache-2.0

## Acknowledgements

- [Playwright](https://playwright.dev/) — headless browser automation for screenshot capture and DOM extraction
- [pixelmatch](https://github.com/mapbox/pixelmatch) — fast pixel-level image comparison
- [pngjs](https://github.com/lukeapage/pngjs) — PNG encoding/decoding in pure JavaScript
- [CIEDE2000](https://en.wikipedia.org/wiki/Color_difference#CIEDE2000) — perceptual color distance formula (Sharma et al., 2005)
- [Weber's Law](https://en.wikipedia.org/wiki/Weber%E2%80%93Fechner_law) — psychophysical thresholds for positional/size perception
- [W3C Design Tokens](https://design-tokens.github.io/community-group/format/) — community group format for interoperable design tokens
- [Figma REST API](https://www.figma.com/developers/api) — design file access and rendering
- [Model Context Protocol](https://modelcontextprotocol.io/) — open standard for AI agent tool integration
- [Pencil.dev](https://pencil.dev/) — design tool with `.pen` file format
- [Commander.js](https://github.com/tj/commander.js/) — CLI framework
- [Chalk](https://github.com/chalk/chalk) — terminal styling
- [Vitest](https://vitest.dev/) — fast unit testing framework
