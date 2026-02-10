# Saccadic AI Architecture

## Overview

Saccadic AI is a visual feedback system that compares design specifications against built implementations. It provides automated detection of visual discrepancies through a multi-tier comparison pipeline.

## Module Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      MCP Server                          │
│                   (JSON-RPC 2.0 stdio)                   │
├─────────────────────────────────────────────────────────┤
│                   CLI (Commander.js)                      │
├─────────────────────────────────────────────────────────┤
│                  ComparisonEngine                         │
│              (Central Orchestrator)                       │
├──────────┬──────────┬───────────┬───────────┬───────────┤
│Screenshot│  Design  │    DOM    │   Pixel   │  Feedback  │
│ Engine   │  Parser  │Comparator │Comparator │ Generator  │
│(Playwright)│(Figma) │ (Props)   │(pixelmatch)│ (Reports) │
├──────────┴──────────┴───────────┴───────────┴───────────┤
│  SSIM        │  VLM          │  Virtual     │  Token     │
│  Comparator  │  Comparator   │  Canvas      │ Versioning │
│  (ML Tier)   │  (Claude)     │  (rbush)     │  (Diff)    │
└──────────────┴───────────────┴──────────────┴────────────┘
```

## 5-Tier Comparison Pipeline

### Tier 1: DOM Property Comparison (~50ms)
- **Module**: `DOMComparator`
- **Method**: Extracts computed styles from build, matches elements to design nodes via IoU
- **Detects**: Color, typography, spacing, position, size mismatches
- **Weight**: 70% of overall score

### Tier 2: Pixel Comparison (~100ms)
- **Module**: `PixelComparator`
- **Method**: pixelmatch for pixel-level diff, region clustering, CIEDE2000 color distance
- **Detects**: Rendering differences, anti-aliasing issues, visual regressions
- **Weight**: 30% of overall score

### Tier 3: SSIM (Structural Similarity) (~200ms)
- **Module**: `SSIMComparator`
- **Method**: Pure TypeScript sliding-window SSIM computation
- **Detects**: Perceptual quality differences (luminance, contrast, structure)
- **Thresholds**: >0.95 pass, 0.85-0.95 warn, <0.85 fail

### Tier 4: VLM (Vision Language Model) (~2-5s)
- **Module**: `VLMComparator`
- **Method**: Claude Vision API for qualitative assessment
- **Detects**: Visual hierarchy, brand consistency, readability, subjective quality
- **Cost**: ~$0.02-0.05 per comparison (optional, off by default)

### Tier 5: Feedback Generation
- **Module**: `FeedbackGenerator`
- **Method**: Aggregates all tier results, deduplicates, applies cascade suppression
- **Output**: Ordered list of actionable feedback items with CSS fix suggestions

## Spatial Indexing

### VirtualCanvas (rbush R-tree)
- O(log n) spatial queries for element lookup
- `findAt(x, y)` — point query
- `findOverlapping(bounds)` — region intersection
- `findInRegion(bounds)` — fully contained elements
- `computeAlignment(nodes)` — detect alignment groups
- `detectSpacingInconsistencies()` — find inconsistent gaps
- `getSiblings(node)` — parent-child hierarchy traversal

## Cascade Suppression

When a missing/extra element causes siblings to reflow, the `FeedbackGenerator.suppressCascadeEffects()` method filters out warn-level position/size/spacing feedback for non-root-cause elements. This improves precision by eliminating false positives caused by layout cascade effects.

## Design Token Versioning

`TokenVersioning.diff()` deep-compares two `DesignTokens` objects:
- **Added**: New tokens (non-breaking)
- **Removed**: Deleted tokens (breaking)
- **Changed**: Modified values (breaking for primitives; non-breaking if only new sub-properties added)

## Data Flow

```
Design Source ──→ DesignParser ──→ DesignState
                                       │
Build URL ──→ ScreenshotEngine ──→ ScreenshotResult
                                       │
           ┌───────────────────────────┤
           ▼                           ▼
     DOMComparator              PixelComparator
           │                           │
           ▼                           ▼
     DOMDiffResult              PixelDiffResult
           │                           │
           └───────────┬───────────────┘
                       ▼
              FeedbackGenerator
              (cascade suppression)
                       │
                       ▼
              ComparisonResult
```

## Extension Points

1. **New comparators**: Implement the compare interface and add to ComparisonEngine
2. **New MCP tools**: Add tool definition to TOOLS array and handler to MCPServer
3. **Custom thresholds**: Override THRESHOLDS in types.ts
4. **Design sources**: Extend DesignParser for new design tool formats
