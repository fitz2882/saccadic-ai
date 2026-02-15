# Saccadic AI

**Visual feedback system for AI coding agents building Flutter apps** — compare .pen/Figma designs against running Flutter builds, get actionable feedback, and iterate to pixel-accuracy.

Saccadic AI gives AI coding agents the ability to visually perceive what they build, compare it against design specifications, and receive actionable feedback. It orchestrates full design-to-code builds from `.pen` or Figma files with parallel page execution and iterative refinement.

## Quick Start

### Requirements

- Dart SDK >= 3.4.0
- A running Flutter app with `--observatory-port` (for VM service connection)

### Install

```bash
cd saccadic
dart pub get
```

### Build

Compile the MCP server to a native executable:

```bash
dart compile exe bin/saccadic_mcp.dart -o saccadic-mcp
```

### Configure MCP Server

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "saccadic-ai": {
      "command": "/path/to/saccadic-mcp"
    }
  }
}
```

Or run directly without compiling:

```json
{
  "mcpServers": {
    "saccadic-ai": {
      "command": "dart",
      "args": ["run", "bin/saccadic_mcp.dart"],
      "cwd": "/path/to/saccadic-ai/saccadic"
    }
  }
}
```

### Run Tests

```bash
cd saccadic
dart test          # 69 tests
dart analyze       # 0 issues
```

## Building From a .pen Design File

The fastest way to go from design to pixel-accurate Flutter code.

### Prerequisites

Two MCP servers configured in Claude Code:

1. **Saccadic AI** — visual comparison and build orchestration
2. **Pencil MCP** — reads `.pen` design files and captures reference screenshots

### Usage

Open your Flutter project in Claude Code and give this prompt:

```
Build all pages from the design at [path/to/design.pen]

1. Call plan_build({ pencilFile: "[path/to/design.pen]" })
2. Start the Flutter app with --observatory-port
3. For each page in the plan, spawn a parallel sub-agent with that page's agentPrompt
4. Each sub-agent should:
   a. Capture a reference screenshot via Pencil MCP get_screenshot
   b. Build the Flutter widget with Key('nodeId') attributes matching design node IDs
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
                              ├─ 4. Builds Flutter widget with Key('nodeId') attributes
                              │
                              ├─ 5. refine_build(flutterUrl) ──→ Compares design vs build
                              │                              ←── Score, mismatches, fixes
                              ├─ 6. Applies fixes
                              ├─ 7. refine_build(iteration=2)──→ Re-checks
                              │                              ←── Improved score
                              └─ 8. Repeats until status="pass" (≥95%)

                              9. Collects results from all sub-agents
                         ←──  10. Reports final per-page scores
```

### Key('nodeId') Convention

Every Flutter widget that corresponds to a design node must have a `Key('nodeId')`:

```dart
Container(
  key: Key('heroSection'),
  child: Column(children: [
    Text('Welcome', key: Key('heroTitle')),
    Text('Build something amazing', key: Key('heroSubtitle')),
  ]),
)
```

Node IDs come from the `plan_build` response (`pages[].nodeIds`).

## MCP Tools

| Tool | Description |
|------|-------------|
| `plan_build` | Analyze a .pen/Figma design and generate a full build plan with per-page agent prompts |
| `refine_build` | Iterative build refinement — call repeatedly until score reaches target |
| `compare_design_build` | Full comparison pipeline with grading |
| `capture_screenshot` | Capture a screenshot of a running Flutter app via VM service |
| `load_design` | Parse a .pen file or Figma file into design state |
| `get_visual_diff` | Pixel diff overlay between two images |
| `get_design_tokens` | Extract structured design tokens |
| `compare_design_tokens` | Compare two token sets for changes |

## CLI

The CLI is also available for manual usage:

```bash
# Compare a .pen design against a running Flutter app
dart run bin/saccadic.dart compare \
  --pen design.pen \
  --frame "Home" \
  --flutter-url ws://127.0.0.1:52341/ws

# Generate a build plan
dart run bin/saccadic.dart plan --pen design.pen

# Iterative refinement
dart run bin/saccadic.dart refine \
  --pen design.pen \
  --frame "Home" \
  --flutter-url ws://127.0.0.1:52341/ws
```

## Architecture

```
saccadic/
  bin/
    saccadic.dart           — CLI entry point (compare, plan, refine commands)
    saccadic_mcp.dart       — MCP server entry point (stdio transport)
  lib/
    saccadic.dart           — Barrel export
    src/
      core/
        types.dart          — Shared types, thresholds, viewport presets
        thresholds.dart     — Perceptual thresholds (CIEDE2000, Weber)
        color_science.dart  — Color conversion and CIEDE2000
      comparison/
        comparison_engine.dart  — Central orchestrator
        widget_comparator.dart  — 5-pass widget matching + property comparison
        pixel_comparator.dart   — Pixel diff with flood-fill region detection
      design/
        pencil_parser.dart  — .pen file parser (5-phase pipeline)
        figma_parser.dart   — Figma REST API parser
        design_source.dart  — Abstract design source interface
        pencil_types.dart   — .pen file type definitions
      flutter/
        flutter_inspector.dart — VM service connection, screenshot, widget tree
        widget_style.dart      — Extracted widget properties
      feedback/
        feedback_generator.dart   — Actionable feedback with cascade suppression
        cascade_suppression.dart  — Dedup dependent mismatches
        fix_suggester.dart        — Flutter-specific fix suggestions
      scoring/
        scorer.dart         — Multi-factor scoring (widget + pixel)
      plan/
        plan_generator.dart      — Per-page build plans from designs
        agent_prompt_builder.dart — AI agent prompts with Key('nodeId')
      mcp/
        server.dart         — MCP server (8 tools via mcp_dart)
        session.dart        — Refine session state (stall detection, history)
      cli/
        compare_command.dart — CLI compare command
        plan_command.dart    — CLI plan command
        refine_command.dart  — CLI refine command
```

### Widget Matching (5-pass)

1. **Pass 0: Key** — Exact match via `Key('nodeId')`
2. **Pass 1: IoU** — Intersection-over-Union spatial overlap
3. **Pass 2: Text content** — Fuzzy text matching
4. **Pass 3: Type + visual** — Widget type + fill color + bounds
5. **Pass 4: Name fallback** — Widget description matching

### Grading Scale

| Grade | Match % | Meaning |
|-------|---------|---------|
| A | >95% | Excellent — nearly pixel-perfect |
| B | >85% | Good — minor differences |
| C | >70% | Acceptable — noticeable issues |
| D | >50% | Poor — significant gaps |
| F | <50% | Failing — major discrepancies |

## Configuration

### Figma Access Token

For Figma integration, set your access token:

```bash
export FIGMA_TOKEN=your_token_here
```

Or pass via Dart define: `-DFIGMA_TOKEN=your_token_here`

## License

Apache-2.0
