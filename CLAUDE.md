# Saccadic AI — Visual Feedback System for Flutter

## What This Is

Saccadic AI is a Dart MCP server that provides visual comparison tools for design-to-Flutter workflows. It compares `.pen`/Figma designs against running Flutter apps and provides actionable feedback to reach pixel-accurate builds.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `plan_build` | Analyze a .pen/Figma design and generate a full build plan with per-page agent prompts |
| `refine_build` | Iterative comparison — call repeatedly until score reaches target |
| `compare_design_build` | One-shot comparison between design and running Flutter app |
| `capture_screenshot` | Capture a screenshot of a running Flutter app via VM service |
| `load_design` | Parse a .pen or Figma file into structured design state |
| `get_design_tokens` | Extract design tokens from a .pen or Figma file |
| `compare_design_tokens` | Diff two sets of design tokens |
| `get_visual_diff` | Pixel diff between two images |

## Building From a .pen File

### Quick Start

Give Claude this prompt to build all pages from a .pen design:

```
Build all pages from the design at [path/to/design.pen].

1. Call plan_build({ pencilFile: "[path/to/design.pen]" })
2. Start the Flutter app with --observatory-port
3. For each page in the plan, spawn a parallel sub-agent with that page's agentPrompt
4. Each sub-agent should:
   a. Capture a reference screenshot via Pencil MCP get_screenshot
   b. Build the Flutter widget with Key('nodeId') attributes matching the design node IDs
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
   - Prioritized fixes with Flutter widget suggestions
   - Stall detection and recovery strategies
   - Incremental change tracking between iterations

### Key('nodeId') Convention

Every Flutter widget must have a `Key('nodeId')` matching its design node ID. This is how saccadic matches widgets to design nodes:

```dart
Container(
  key: Key('heroSection'),
  child: Column(children: [
    Text('Welcome', key: Key('heroTitle')),
    Text('Build something amazing', key: Key('heroSubtitle')),
  ]),
)
```

The node IDs come from the plan_build response (`pages[].nodeIds`).

### Reference Screenshots

For pixel-accurate comparison, each sub-agent should capture a reference screenshot before building:

```
get_screenshot({ pencilFile: "design.pen", nodeId: "frameId" })
```

Then pass it to refine_build as `referenceImage`. Without this, saccadic generates an approximation from the design state which is less accurate.

### Tab Navigation

For apps with a `BottomNavigationBar` or `NavigationBar`, saccadic can automatically switch tabs before comparing. Pass `tabIndex` (zero-based) to `refine_build`:

```json
{
  "designSource": { "pencilFile": "design.pen", "pencilFrame": "Learn" },
  "flutterUrl": "ws://127.0.0.1:PORT/ws",
  "tabIndex": 0,
  "iteration": 1
}
```

Saccadic finds the navigation bar in the widget tree, computes the tab position, and dispatches a tap via the VM service. Pass `tabCount` if auto-detection fails.

### Hot Reload

Saccadic automatically hot reloads the Flutter app before each comparison (iteration 2+). The flow:

1. Agent modifies Flutter code and saves to disk
2. Agent calls `refine_build` with `iteration: N`
3. Saccadic calls `reloadSources` + `ext.flutter.reassemble` on the VM service
4. Widget tree rebuilds with new code, then comparison runs

If hot reload fails (e.g., app is in release mode), the response includes `hotReloaded: false` and instructions to reload manually. Hot reload only works in **debug mode** (JIT compilation).

### Context Management

Each refine iteration generates large tool responses. To avoid running out of context:

- **Spawn a sub-agent per page** — each gets its own fresh context window
- The sub-agent runs the full refine loop until `status="pass"` or max iterations
- Only the final result summary returns to the main conversation
- For multi-page designs, run sub-agents in parallel

The `plan_build` orchestration prompt includes these instructions automatically.

## Development

```bash
cd saccadic
dart test          # Run all tests (114 tests)
dart analyze       # 0 issues expected
dart compile exe bin/saccadic_mcp.dart -o saccadic-mcp  # Build MCP server
```

## Architecture

All code lives in `saccadic/`:

- `lib/src/core/` — Types, thresholds, color science (CIEDE2000)
- `lib/src/comparison/` — Comparison engine, widget comparator, pixel comparator
- `lib/src/design/` — Pencil parser (.pen), Figma parser
- `lib/src/flutter/` — VM service inspector, widget style extraction
- `lib/src/feedback/` — Feedback generator, cascade suppression, fix suggester
- `lib/src/scoring/` — Multi-factor scorer
- `lib/src/plan/` — Build plan generator, agent prompt builder
- `lib/src/mcp/` — MCP server (8 tools), refine session state
- `lib/src/cli/` — CLI commands (compare, plan, refine)
- `bin/saccadic_mcp.dart` — MCP server entry point (stdio)
- `bin/saccadic.dart` — CLI entry point
