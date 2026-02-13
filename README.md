# Saccadic AI

**Visual feedback system for AI coding agents** — see, compare, and fix UI against design specs.

Saccadic AI gives AI coding agents the ability to visually perceive what they build, compare it against design specifications, and receive actionable feedback to close the gap between design and implementation.

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
2. **Extract** DOM computed styles (colors, fonts, spacing, layout) from the live page
3. **Load** design specs from Figma or a local design token file
4. **Compare** DOM properties against the design (fast, precise)
5. **Pixel diff** the screenshot against a reference image (catches visual regressions)
6. **Generate feedback** with severity levels, affected elements, and CSS fix suggestions
7. **Grade** the result from A (>95% match) to F (<50% match)

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

Saccadic AI can be used three ways: as a **CLI tool**, as an **MCP server** for AI agents, or as a **library** in your own code.

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
| `capture_screenshot` | Capture a screenshot of any URL |
| `load_design` | Parse a Figma file or token file |
| `compare_design_build` | Full comparison pipeline with grading |
| `get_visual_diff` | Pixel diff overlay between two images |
| `get_design_tokens` | Extract structured design tokens |
| `compare_design_tokens` | Compare two token sets for breaking changes |
| `evaluate_with_vlm` | Claude Vision qualitative assessment (requires `ANTHROPIC_API_KEY`) |

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
    screenshot-engine.ts  — Playwright screenshot + DOM extraction
    design-parser.ts      — Figma API + W3C design token parsing
    pixel-comparator.ts   — pixelmatch + CIEDE2000 color science
    dom-comparator.ts     — IoU element matching + property comparison
    comparison-engine.ts  — Orchestrator combining all modules
    feedback-generator.ts — Actionable feedback + cascade suppression
    virtual-canvas.ts     — rbush R-tree spatial indexing
    ssim-comparator.ts    — Structural Similarity Index (pure TypeScript)
    vlm-comparator.ts     — Claude Vision qualitative assessment
    token-versioning.ts   — Design token diff engine
  mcp/
    server.ts             — JSON-RPC 2.0 stdio MCP server (7 tools)
  integration/            — E2E integration tests
  cli.ts                  — Commander CLI (compare, capture, tokens, tokens-diff, diff)
  index.ts                — Barrel export
```

### 5-Tier Comparison Pipeline

```
Design Spec (Figma / tokens)     Built Page (URL)
         |                              |
         v                              v
   DesignParser               ScreenshotEngine
   (design nodes)         (screenshot + DOM styles)
         |                       |            |
         +-------+-------+------+            |
                 |       |                   |
    Tier 1: DOMComparator |    Tier 2: PixelComparator
          (property diff) |          (pixel diff)
                 |        |                  |
                 |   Tier 3: SSIMComparator  |
                 |   (structural similarity) |
                 |        |                  |
                 |   Tier 4: VLMComparator   |
                 |   (Claude Vision, opt.)   |
                 |        |                  |
                 v        v                  v
         Tier 5: FeedbackGenerator
         (cascade suppression, grades, fixes)
```

For full details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
- [Commander.js](https://github.com/tj/commander.js/) — CLI framework
- [Chalk](https://github.com/chalk/chalk) — terminal styling
- [Vitest](https://vitest.dev/) — fast unit testing framework
