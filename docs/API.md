# Saccadic AI API Reference

## MCP Tools

### capture_screenshot

Capture a screenshot of a URL with optional viewport and selector targeting.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | Yes | URL to capture |
| viewport | string \| object | No | Viewport preset or `{width, height}` |
| selector | string | No | CSS selector for element capture |
| fullPage | boolean | No | Capture full scroll height |

**Viewport presets:** `mobile-sm`, `mobile`, `tablet`, `desktop-sm`, `desktop`, `desktop-lg`

**Response:**
```json
{
  "content": [
    { "type": "text", "text": "{viewport, url, timestamp, domElementCount}" },
    { "type": "image", "data": "<base64>", "mimeType": "image/png" }
  ]
}
```

### load_design

Parse a Figma design file or token file into design state.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| figmaUrl | string | No | Full Figma file URL |
| figmaFileKey | string | No | Figma file key |
| tokenFile | string | No | Path to design token file |
| nodeId | string | No | Specific Figma node ID |

### compare_design_build

Run full comparison pipeline between design and build implementation.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| designSource | object | Yes | `{figmaUrl?, figmaFileKey?, tokenFile?}` |
| buildUrl | string | Yes | URL of built implementation |
| viewport | string \| object | No | Viewport preset or custom |
| selector | string | No | CSS selector |
| threshold | number | No | Match threshold (0-1, default 0.95) |

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{overall, domDiff, pixelDiff, regionCount, feedback, timestamp}"
    }
  ]
}
```

### get_visual_diff

Generate visual diff overlay between two images.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| designImage | string | Yes | Base64 or file path |
| buildImage | string | Yes | Base64 or file path |

### get_design_tokens

Extract structured design tokens from Figma or token file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| figmaUrl | string | No | Full Figma file URL |
| figmaFileKey | string | No | Figma file key |
| tokenFile | string | No | Path to token file |

### compare_design_tokens

Compare two sets of design tokens and report breaking changes.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| oldTokens | string | Yes | Old tokens as JSON or file path |
| newTokens | string | Yes | New tokens as JSON or file path |

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{added: [], removed: [], changed: [], breaking: boolean}"
  }]
}
```

### evaluate_with_vlm

Use Claude Vision for qualitative design-build assessment.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| designImage | string | Yes | Base64 or file path |
| buildImage | string | Yes | Base64 or file path |
| prompt | string | No | Custom evaluation prompt |

**Requires:** `ANTHROPIC_API_KEY` environment variable.

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{overallAssessment, issues, qualityScore, suggestions, model, tokensUsed}"
  }]
}
```

---

## CLI Commands

### compare
```bash
saccadic-ai compare --design <source> --build <url> [options]
```
| Flag | Description |
|------|-------------|
| `--design` | Figma URL or token file path |
| `--build` | URL of built implementation |
| `--viewport` | Named preset or WxH (default: desktop) |
| `--selector` | CSS selector for element targeting |
| `--threshold` | Match threshold 0-1 (default: 0.9) |
| `--format` | Output format: json \| text |

### capture
```bash
saccadic-ai capture --url <url> [--viewport <vp>] [--selector <css>] [--output <file>]
```

### tokens
```bash
saccadic-ai tokens --source <file> [--format json|text]
```

### tokens-diff
```bash
saccadic-ai tokens-diff --old <file> --new <file> [--format json|text]
```

### diff
```bash
saccadic-ai diff --design <image> --build <image> [--output <file>]
```

---

## Library API

### ComparisonEngine

```typescript
import { ComparisonEngine } from 'saccadic-ai';

const engine = new ComparisonEngine();
await engine.init();

const result = await engine.compare({
  designSource: { designState },
  buildUrl: 'http://localhost:3000',
  viewport: { width: 1280, height: 800 },
  enableSSIM: true,   // optional
  enableVLM: false,   // optional, requires ANTHROPIC_API_KEY
});

await engine.close();
```

### VirtualCanvas

```typescript
import { VirtualCanvas } from 'saccadic-ai';

const canvas = VirtualCanvas.fromDOMStyles(domStyles, viewport);
const nodesAtPoint = canvas.findAt(100, 200);
const overlapping = canvas.findOverlapping({ x: 0, y: 0, width: 400, height: 300 });
const alignment = canvas.computeAlignment(canvas.getAllNodes());
const spacingIssues = canvas.detectSpacingInconsistencies();
```

### SSIMComparator

```typescript
import { SSIMComparator } from 'saccadic-ai';

const ssim = new SSIMComparator();
const metrics = ssim.compare(imageBufferA, imageBufferB);
console.log(metrics.ssim); // 0.0 - 1.0
```

### TokenVersioning

```typescript
import { TokenVersioning } from 'saccadic-ai';

const versioning = new TokenVersioning();
const diff = versioning.diff(oldTokens, newTokens);
console.log(diff.breaking); // boolean
console.log(diff.added, diff.removed, diff.changed);
```

### VLMComparator

```typescript
import { VLMComparator } from 'saccadic-ai';

const vlm = new VLMComparator(); // uses ANTHROPIC_API_KEY env var
if (vlm.isAvailable()) {
  const evaluation = await vlm.compare({
    designImage: designBuffer,
    buildImage: buildBuffer,
  });
  console.log(evaluation.qualityScore);
}
```
