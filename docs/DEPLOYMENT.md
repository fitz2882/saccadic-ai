# Saccadic AI Deployment Guide

## Prerequisites

- Node.js >= 20.0.0
- Playwright browsers (auto-installed)

## Installation

```bash
npm install saccadic-ai
```

Or from source:
```bash
git clone <repo-url>
cd saccadic-ai
npm install
npm run build
```

## MCP Server Setup

### Claude Desktop / Claude Code

Add to your MCP configuration:

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

### Standalone

```bash
node dist/mcp/server.js
```

The server communicates via JSON-RPC 2.0 over stdio.

## CLI Usage

```bash
# Compare design against build
saccadic-ai compare --design tokens.json --build http://localhost:3000 --viewport desktop

# Compare with Figma URL
saccadic-ai compare --design https://figma.com/file/<key>/... --build http://localhost:3000

# Capture screenshot
saccadic-ai capture --url http://localhost:3000 --output screenshot.png --viewport mobile

# Extract design tokens
saccadic-ai tokens --source tokens.json --format text

# Compare design token versions
saccadic-ai tokens-diff --old tokens-v1.json --new tokens-v2.json

# Pixel diff two images
saccadic-ai diff --design design.png --build build.png --output diff.png
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | No | Required for VLM (Claude Vision) evaluation |
| `FIGMA_ACCESS_TOKEN` | No | Required for Figma API access |

## CI/CD Integration

### GitHub Actions

```yaml
- name: Visual Regression Test
  run: |
    npx saccadic-ai compare \
      --design tokens.json \
      --build http://localhost:3000 \
      --threshold 0.9 \
      --format json > visual-report.json
```

Exit codes:
- `0`: Match percentage >= threshold
- `1`: Match percentage < threshold or error

### Token Version Check

```yaml
- name: Check for Breaking Token Changes
  run: |
    npx saccadic-ai tokens-diff --old tokens-v1.json --new tokens-v2.json
    # Exit code 1 if breaking changes detected
```

## Running Tests

```bash
npm test                    # Unit tests
npm run bench:detection     # Detection accuracy benchmark
npm run bench:agent         # Agent benchmark (requires ANTHROPIC_API_KEY)
npm run typecheck           # TypeScript type checking
```

## Building

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
```
