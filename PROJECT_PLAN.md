# Giving AI coding agents a visual system: a complete architecture

**AI coding agents today are blind.** They generate HTML, CSS, and JavaScript but never see the result — they can't tell if a button is 3px too far left, if the heading color is wrong, or if the layout breaks on mobile. This report presents a complete technical architecture for an open-source tool that gives AI agents like Claude Code the ability to visually perceive, evaluate, and compare what they build against a design specification. The system combines bio-inspired perceptual models, state-of-the-art computer vision metrics, headless rendering, design file parsing, and vision-language models into a feedback loop exposed through MCP (Model Context Protocol). Every tool recommended is open-source with permissive licensing (MIT, Apache 2.0, or BSD), and the architecture is designed to be modular, extensible, and production-ready.

---

## How humans see design quality — and what AI must replicate

The human visual system processes design information hierarchically, and any AI visual system must mirror this priority ordering. Neuroscience research confirms that the brain evaluates visual stimuli through a cascade: low-level visual areas (V1/V2) process luminance, contrast, edges, and color first, while higher-order areas (V4, inferotemporal cortex) handle pattern recognition and semantic understanding. Eye-tracking studies quantify the relative attentional weight: **size influences attention by ~45%, color by ~30%, and typography by ~25%**.

When a human compares a design mockup to a built interface, they notice discrepancies in this order: **color and contrast** (pre-attentively, before conscious effort), then alignment and spacing (via the Gestalt principle of continuity), then typography (weight, size, style), and finally overall visual hierarchy and layout structure. This maps directly to the processing pipeline an AI comparison engine should follow — check colors first (cheapest, highest-impact), then spatial relationships, then typographic fidelity, then holistic layout.

Three perceptual models form the quantitative foundation for determining when a difference matters. The **Contrast Sensitivity Function (CSF)** describes human sensitivity as a band-pass filter peaking at 2–5 cycles per degree, explaining why fine 1px borders require high contrast to be visible while large color blocks are easily perceived. **CIEDE2000** (the latest color difference formula) provides the gold standard for measuring perceptual color distance, with a Just Noticeable Difference (JND) at **ΔE₀₀ ≈ 1.0** — differences below this are imperceptible to most observers, while ΔE₀₀ > 1.8 is the threshold for "unacceptable" in industrial quality control. **Weber's Law** gives JND thresholds for spatial attributes: position offset is detectable at ~2–4% of the reference distance (meaning an 8–16px shift on a 400px element), and size changes become noticeable at ~2.9% (a 3px change on a 100px element).

Visual saliency models predict what draws the eye and can verify whether the most important UI element (a CTA button, a primary heading) actually commands visual attention. The Itti-Koch model (1998) established the computational foundation using center-surround operations on intensity, color, and orientation feature maps. The UEyes study (CHI 2023) — the largest UI-specific eye-tracking dataset with 62 participants viewing 1,980 screenshots — demonstrated that **UI-specific saliency models dramatically outperform general-purpose ones** (AUC 0.878 vs 0.778), confirming that UI visual perception follows distinct patterns from natural scene viewing.

Key papers underpinning this foundation include Wang et al.'s SSIM paper (IEEE TIP 2004, 50,000+ citations), Itti-Koch-Niebur's saliency model (IEEE PAMI 1998), Sharma-Wu-Dalal's CIEDE2000 implementation notes (Color Research & Application 2005), and the UEyes study (Jiang et al., CHI 2023).

---

## The perceptual comparison toolbox: from pixel diffs to learned metrics

A robust comparison engine needs multiple levels of analysis. No single metric captures everything humans notice, so the architecture layers four tiers of comparison, each catching different types of issues.

**Tier 1 — Pixel-level diff** provides the fastest, most deterministic comparison. The library **pixelmatch** (ISC license) is the industry standard: ~150 lines of code, zero dependencies, with built-in anti-aliasing detection using YIQ color space weighting. For 6x faster performance, **odiff** (MIT) uses SIMD optimization. Both produce a binary diff mask highlighting changed pixels, but neither can determine whether a change is perceptually significant. **Delta E color distance** in CIELAB space bridges this gap — per-pixel CIEDE2000 computation identifies exact color deviations, with the `python-colormath` (BSD-2-Clause) or `coloraide` (MIT) libraries providing the calculations.

**Tier 2 — Structural similarity** captures perceptual quality beyond raw pixels. SSIM (available in `scikit-image`, BSD-3-Clause) compares luminance, contrast, and structural patterns through a sliding window, returning values from -1 to 1 where >0.95 indicates high similarity. **MS-SSIM** extends this across multiple scales for better viewing-distance robustness. Both are fast (no GPU needed) and produce spatial quality maps showing *where* degradation occurs, making them ideal for automated regression thresholds.

**Tier 3 — Learned perceptual metrics** use deep features to match human judgments more closely. **LPIPS** (BSD-2-Clause) compares feature activations from a pretrained AlexNet or VGG network, calibrated against human perceptual judgments from the BAPPS dataset — it correlates better with human similarity ratings than any classical metric. The variant **ST-LPIPS** (Shift-Tolerant LPIPS, ECCV 2022) adds anti-aliasing filtering to handle the sub-pixel shifts common in UI screenshots. **DISTS** (MIT) explicitly separates structure from texture similarity, tolerating acceptable texture variance while catching structural changes. The unified library **pyiqa** (Apache 2.0) provides 40+ metrics through a single API.

**Tier 4 — Semantic similarity** via **CLIP/SigLIP** embeddings captures high-level correspondence: does the build have the same visual structure, content organization, and gestalt as the design? OpenCLIP (MIT) with LAION-trained weights provides commercially-safe image embeddings. Cosine similarity between design and build embeddings gives a single semantic fidelity score. This catches entirely missing sections or major structural rearrangements that pixel metrics might represent as noise across the entire image.

| Metric | Best For | Speed | License | Library |
|--------|----------|-------|---------|---------|
| pixelmatch | Exact pixel changes, anti-aliasing-aware | <100ms | ISC | `pixelmatch` (npm) |
| Delta E (CIEDE2000) | Color accuracy verification | <200ms | BSD-2 | `python-colormath` |
| SSIM / MS-SSIM | Structural degradation detection | <500ms | BSD-3 | `scikit-image`, `piqa` |
| LPIPS / ST-LPIPS | Perceptual similarity (correlates with humans) | ~1s (GPU) | BSD-2 | `lpips`, `piqa` |
| CLIP cosine similarity | Semantic/layout correspondence | ~500ms (GPU) | MIT | `open_clip` |

**DOM-aware comparison** complements all pixel-based approaches. By extracting `window.getComputedStyle()` for every element, the system can compare intended properties directly: font-size 16px vs 16px ✓, gap 12px vs 8px ✗ (4px off). This produces immediately actionable feedback ("the card gap is 8px but should be 12px") without any image processing. The hybrid approach — DOM property comparison for style accuracy plus pixel comparison for rendering fidelity — catches issues that neither method detects alone.

---

## Headless rendering: capturing what the AI builds

The rendering pipeline must produce consistent, deterministic screenshots across environments. **Playwright** (Apache 2.0, Microsoft) is the clear recommendation: it supports Chromium, Firefox, and WebKit from a single API, offers built-in device emulation with a registry of device profiles (iPhone 14, Pixel 7, iPad, etc.), and provides element-specific screenshots via `locator.screenshot()`.

Critical screenshot capture capabilities include viewport control at standard responsive breakpoints (**320px, 375px, 768px, 1024px, 1280px, 1440px**), device pixel ratio emulation (1x, 2x, 3x — a 375×812 viewport at 3x DPR produces a 1125×2436px image), full-page versus viewport-only capture, and element-scoped screenshots via CSS selectors. Playwright's `waitForLoadState('networkidle')`, animation disabling via CSS injection, and `reducedMotion: 'reduce'` context option solve the dynamic content stabilization problem.

For cross-environment consistency (the biggest source of false positives in visual regression), running Playwright inside **Docker containers** eliminates font rendering differences between macOS (subpixel AA), Windows (ClearType), and Linux (grayscale AA). The recommended container approach uses the official `mcr.microsoft.com/playwright` Docker images.

For **mobile-native rendering**, Flutter's built-in golden testing (`flutter test --update-goldens`) renders widgets headlessly for pixel comparison with MIT-licensed `golden_toolkit` for enhanced workflows. React Native views can be captured via **Detox** (MIT, by Wix) or **Maestro** (Apache 2.0), which provides YAML-based test automation with `takeScreenshot` commands across iOS and Android. Both support CI integration through Android SDK emulators (headless mode with `-no-window`) and Xcode simulators (macOS-only limitation).

---

## From Figma to machine-readable design state

The design state is the structured, machine-readable representation of how every element should look — position, size, color, font, spacing, border, shadow, and layout constraints. The system must parse design files into this representation.

**Figma** dominates the design tool market, and its REST API (`GET /v1/files/:key`) exposes the complete node tree with per-element properties: absolute bounding box (x, y, width, height), fills, strokes, effects (shadows, blurs), corner radius, auto-layout properties (direction, spacing, padding, alignment, sizing mode), and typography (fontFamily, fontSize, fontWeight, lineHeightPx, letterSpacing). The Variables API (`GET /v1/files/:key/variables/local`) extracts design tokens directly. The npm package **figma-js** (MIT) provides a typed wrapper; **figma-api** (MIT) offers full TypeScript types based on the official OpenAPI spec. Rate limits are tiered by plan — free (Starter) plans have restrictive limits, while paid plans allow per-minute access.

The `.fig` binary format is proprietary (using Kiwi serialization by Evan Wallace, MIT), and no reliable open-source parser exists for direct file reading — the REST API is the only supported extraction path. **Sketch** files, by contrast, are ZIP archives containing JSON (`document.json`, `meta.json`, page files), parseable with **sketch-constructor** (Apache 2.0, by Amazon) or by simply unzipping and parsing the JSON. Adobe XD was discontinued in late 2023, and its ecosystem is effectively abandoned.

**Design token standards** have matured significantly. The **W3C Design Tokens Community Group specification** reached its first stable version (2025.10) in October 2025, defining a JSON format using `$value`, `$type`, and `$description` properties for colors, dimensions, typography, shadows, borders, and more. **Style Dictionary** (Apache 2.0, by Amazon) transforms these tokens into platform-specific outputs (CSS custom properties, iOS Swift, Android XML), with v4.x providing first-class DTCG format support.

A complete design state representation captures these properties per element:

```json
{
  "id": "header-cta",
  "type": "BUTTON",
  "bounds": { "x": 1144, "y": 12, "width": 120, "height": 40 },
  "fills": [{ "type": "SOLID", "color": "#0066FF" }],
  "cornerRadius": 8,
  "typography": {
    "fontFamily": "Inter",
    "fontSize": 14,
    "fontWeight": 600,
    "color": "#FFFFFF"
  },
  "padding": { "top": 8, "right": 16, "bottom": 8, "left": 16 },
  "effects": [{ "type": "DROP_SHADOW", "color": "rgba(0,0,0,0.1)", "offset": { "x": 0, "y": 2 }, "blur": 4 }],
  "children": []
}
```

---

## The virtual canvas: how AI "sees" internally

The virtual canvas is the AI's internal spatial model of the UI — a data structure separate from the browser DOM that lets it reason about element positions, relationships, and visual hierarchy. This concept borrows directly from game engine scene graphs and browser render trees.

A simplified **scene graph** represents the UI as a tree of typed nodes (Container, Text, Image, Button), each with bounds, computed styles, and children. This mirrors how game engines like Unity (GameObject + Transform hierarchy) and Godot (typed Node tree) represent visual scenes. The key insight: **the DOM already IS a scene graph**, and the render tree is its visually-resolved version. The AI's virtual canvas extracts and simplifies this into a structure optimized for spatial reasoning.

**Spatial data structures** accelerate the queries an AI needs: "what elements overlap?", "are these left-aligned?", "is spacing uniform?" An **R-tree** (available via `rbush`, npm, MIT) provides O(log n) spatial queries for elements of varying sizes — ideal for UI where buttons, cards, and headers differ dramatically in dimensions. The virtual canvas wraps this:

```typescript
interface VirtualCanvas {
  root: UINode;
  viewport: { width: number; height: number };
  spatialIndex: RTree<UINode>;
  
  findAt(x: number, y: number): UINode[];
  findOverlapping(): [UINode, UINode][];
  computeAlignment(nodes: UINode[]): AlignmentReport;
  diffAgainst(design: VirtualCanvas): DiffReport;
}
```

The mapping between this internal representation and actual rendered pixels requires a layout engine. **Yoga** (MIT, by Meta) implements CSS Flexbox and powers React Native's layout; **Taffy** (MIT/Apache-2.0 dual, Rust) implements both Flexbox and CSS Grid and powers the Zed editor. Both can compute layout from style declarations without a browser, enabling the AI to predict how its code changes will affect element positions before rendering.

The critical challenge is **pixel-perfect fidelity** — font rendering, sub-pixel positioning, and anti-aliasing all create discrepancies between the virtual model and actual rendered output. The solution is a two-layer approach: use the virtual canvas for structural reasoning (alignment, spacing, hierarchy) and pixel comparison for rendering verification.

---

## The comparison engine: from screenshots to actionable feedback

The comparison engine is the system's core intelligence layer, transforming raw pixel differences into developer-actionable feedback like "the heading color is #333 but should be #222" or "the button is 3px too far left."

**Data flow**: Design file → Parse to design state → Extract reference screenshot (via Figma's image rendering API or cached reference) → AI builds code → Playwright captures build screenshot → Multi-tier comparison → Generate structured feedback → Feed back to AI agent.

The engine runs comparisons in priority order, stopping early when major issues are found:

1. **DOM property comparison** (fastest, ~50ms): Extract `getComputedStyle()` for every element, compare against design state properties. This catches wrong colors, font sizes, padding values, border-radius — all expressible as exact numbers. Output: `{ property: "gap", expected: "12px", actual: "8px", element: ".card-grid" }`.

2. **Pixel-level diff** (~100ms): Run pixelmatch or odiff to identify changed regions. Apply connected component analysis to cluster pixel differences into block-level change regions, distinguishing "missing element" (large contiguous region) from "rendering noise" (scattered pixels).

3. **Perceptual metrics** (~500ms–1s): Compute SSIM for overall structural similarity and per-region scores. Run CIEDE2000 on flagged color regions to quantify perceptual significance. Apply **threshold tuning**: ΔE₀₀ < 1.0 → imperceptible (pass), 1.0–2.0 → minor (warn), >2.0 → significant (fail). For positional accuracy, apply Weber fraction thresholds: position offset < 2% of reference → pass, 2–4% → warn, >4% → fail.

4. **Semantic comparison** (~500ms): CLIP/SigLIP cosine similarity for holistic layout correspondence. Scores below 0.85 indicate major structural divergence.

Specific visual bug detection techniques include **misalignment detection** (compare element bounding boxes, extract edges via Canny filter, compute alignment deviation), **overlapping text** (OCR both images via Tesseract, compare text bounding boxes for intersections), **responsive breakage** (detect horizontal overflow where page width > viewport width, check element aspect ratio preservation across breakpoints), and **missing elements** (large contiguous diff regions flagged through connected component analysis on the diff mask).

---

## Vision-language models: the AI's qualitative eye

While algorithmic metrics handle quantitative comparison, **vision-language models (VLMs)** provide qualitative evaluation — understanding whether a UI "looks right," whether the visual hierarchy communicates the intended information architecture, and whether the overall aesthetic matches the design intent.

**Proprietary VLMs** lead in raw capability. GPT-4o and Claude 3.5 Sonnet both accept multiple images, enabling side-by-side design-vs-build comparison. They excel at structural analysis, layout understanding, OCR, and identifying high-level issues like "the navigation doesn't match the design's visual hierarchy." However, **they cannot reliably detect sub-pixel positioning errors or exact color mismatches** — they operate at semantic, not pixel, resolution.

**Open-source VLMs** have reached practical quality for UI understanding. The strongest candidates:

- **Qwen2.5-VL** (Apache 2.0, Alibaba): Available in 3B/7B/72B sizes, processes images at native resolution (no squashing), provides bounding box grounding, and excels at document understanding and GUI tasks. The 7B model runs on a single 16–24GB GPU.
- **InternVL 2.5/3** (MIT, Shanghai AI Lab): 1B–78B parameters, approaches GPT-4V on benchmarks, supports 4K images with dynamic resolution and strong OCR.
- **CogAgent-9B** (Apache 2.0 code, custom weight license): Purpose-built for GUI understanding, CVPR 2024 highlight, SOTA on GUI navigation benchmarks.
- **UI-TARS** (Apache 2.0, ByteDance): Native GUI agent model achieving 24.6 on OSWorld (surpassing Claude's 22.0), based on Qwen2-VL architecture.

For **embedding-based similarity**, OpenCLIP (MIT) with LAION-trained weights provides commercially safe image embeddings. SigLIP (Apache 2.0, Google) improves on CLIP with sigmoid loss, producing more meaningful absolute similarity scores. Adobe has demonstrated that fine-tuning OpenCLIP on 20,000+ UI design icons significantly improves UI-specific understanding — the same approach could be applied to design-build comparison pairs.

Fine-tuning a VLM for UI evaluation is feasible with modest resources: **QLoRA fine-tuning of Qwen2.5-VL-7B on 10K annotated design-build pairs requires ~12–16GB VRAM and ~4–8 hours on an RTX 4090**, costing approximately $5–15 on cloud GPU platforms. The training data would consist of design screenshots paired with build screenshots, annotated with quality ratings and specific issue descriptions.

---

## MCP integration: how the visual system talks to Claude Code

The **Model Context Protocol** (MCP), released by Anthropic in November 2024 and now stewarded by the Linux Foundation's Agentic AI Foundation, is the optimal integration path. MCP tools appear natively in the AI agent's context — the agent discovers available capabilities automatically and invokes them as needed, without special prompting or subprocess management.

Several MCP screenshot servers already exist: the official **@playwright/mcp** (Apache 2.0) enables browser automation and screenshot capture, and community servers like **upnorthmedia/ScreenshotMCP** (MIT) and **Domshot** provide focused screenshot functionality. The proposed visual feedback tool extends these with design-aware comparison.

Five core MCP tools define the system's API surface:

- **`capture_screenshot`** — Renders a URL at a specified viewport/selector, returns image + metadata
- **`load_design`** — Parses a Figma URL or design token file into the machine-readable design state
- **`compare_design_build`** — Runs the full comparison pipeline, returning match percentage, diff regions with severity, and actionable textual feedback
- **`get_visual_diff`** — Generates a visual diff overlay image for the AI to inspect
- **`get_design_tokens`** — Extracts structured design tokens (colors, spacing, typography)

Images are returned as base64-encoded `ImageContent` blocks per the MCP spec: `{ "type": "image", "data": "<base64>", "mimeType": "image/png" }`. For large images, the server should return compressed thumbnails initially and provide full-resolution on demand, or save to disk and return file paths via structured content.

A **CLI tool should coexist with the MCP server**, sharing a core library. The CLI serves CI/CD pipelines (`visual-feedback compare --design design.png --build http://localhost:3000 --threshold 0.1`), while MCP serves interactive AI agent workflows. The shared core library architecture:

```
┌─────────────────┐     ┌─────────────────┐
│  MCP Server      │     │  CLI Tool        │
│  (JSON-RPC 2.0)  │     │  (commander.js)  │
└────────┬────────┘     └────────┬────────┘
         └───────┬───────────────┘
    ┌────────────▼────────────┐
    │   Core Library           │
    │  ├─ ScreenshotEngine     │  (Playwright)
    │  ├─ DesignParser         │  (Figma API + tokens)
    │  ├─ ImageComparator      │  (pixelmatch + SSIM + LPIPS)
    │  ├─ DOMInspector         │  (getComputedStyle extraction)
    │  └─ FeedbackGenerator    │  (structured diff → text)
    └─────────────────────────┘
```

For real-time performance, the MCP server keeps a persistent Playwright browser instance alive (avoiding the ~500ms–2s cold-start per launch), caches the design state on first load, and uses incremental comparison via perceptual hashing of viewport tiles to avoid re-diffing unchanged regions. Integration with development server hot-reloading (via `chokidar` file watching) enables automatic re-capture and comparison on every code change.

---

## Open source licensing: what's safe to use

Every component in the recommended stack uses **permissive licenses** fully compatible with an open-source project. The core dependencies break down as follows:

- **Browser automation**: Playwright (Apache 2.0), Puppeteer (Apache 2.0)
- **Pixel comparison**: pixelmatch (ISC), odiff (MIT), looks-same (MIT)
- **Perceptual metrics**: LPIPS (BSD-2-Clause), scikit-image (BSD-3-Clause), pytorch-msssim (MIT), piqa (MIT), pyiqa (Apache 2.0)
- **Embeddings**: OpenCLIP with LAION-trained weights (MIT), SigLIP (Apache 2.0)
- **Design parsing**: figma-js (MIT), sketch-constructor (Apache 2.0), Style Dictionary (Apache 2.0)
- **Layout engines**: Yoga (MIT), Taffy (MIT/Apache-2.0 dual)
- **Spatial indexing**: rbush (MIT)
- **Testing tools**: jest-image-snapshot (Apache 2.0), BackstopJS (MIT), reg-suit (MIT)

**Three categories require caution.** Proprietary SaaS tools (Percy/BrowserStack, Applitools Eyes, Chromatic) cannot be used as open-source dependencies — they're services, not libraries. VLM model weights often carry restrictions separate from their code licenses: LLaVA weights inherit LLaMA's non-commercial restrictions despite Apache 2.0 code, and CogVLM/CogAgent weights have a custom "Model License." The safest VLM approach is to make model selection pluggable, defaulting to **Qwen2.5-VL** (Apache 2.0) or **InternVL** (MIT) for fully open models, while supporting proprietary APIs (GPT-4o, Claude) as optional backends.

The recommended project license is **Apache 2.0** — it provides explicit patent protection for contributors and users, requires a NOTICE file documenting third-party attributions, and is compatible with all identified dependencies. A `THIRD-PARTY-LICENSES` file should list every dependency with its license, copyright holder, and SPDX identifier.

---

## What already exists: prior art worth studying

The visual feedback loop pattern for AI agents has emerged rapidly since 2024. The most established approach uses **Playwright MCP + Claude Code**: the agent launches Playwright, captures a screenshot of `http://localhost:3000`, evaluates the result, proposes fixes, and iterates. GitHub has documented this pattern for Copilot Agent Mode, and the Agentic Coding Handbook (by Tweag) provides a comprehensive workflow guide.

**screenshot-to-code** (MIT, 60k+ GitHub stars) is the most popular open-source project in this space, using GPT-4V or Claude to generate HTML/Tailwind/React code from UI screenshots. Its evaluation framework shows Claude 3 Sonnet achieving **70.31% replication accuracy** versus GPT-4V's 65.10%. Several MCP screenshot servers exist: upnorthmedia/ScreenshotMCP (MIT), Domshot, and bradydouthit's screenshot-mcp for localhost capture.

In visual regression testing, the open-source ecosystem is mature. **BackstopJS** (MIT) provides config-driven responsive screenshot testing with Puppeteer. **Lost Pixel** (MIT) modernizes this with odiff-powered comparison and GitHub Actions integration. **Playwright's built-in `toHaveScreenshot()`** offers the simplest integration path. On the commercial side, Chromatic's anti-flakiness algorithms and Percy's Visual AI Engine represent the state of the art in intelligent diff filtering.

Design-to-code tools like **Anima**, **Locofy.ai** (using proprietary "Large Design Models"), **Builder.io Visual Copilot** (with open-source Mitosis compiler), and **Vercel v0** approach the problem from the opposite direction — generating code from designs rather than evaluating code against designs. The proposed system complements these by closing the feedback loop: after design-to-code generation, it verifies the output matches the intent.

Academic work is accelerating. **OwlEye** (ASE 2020) detects and localizes UI display issues from mobile screenshots using deep learning, finding bugs in 56 of 2,200 tested apps. **VisionDroid** (2024) uses MLLMs to detect non-crash functional bugs through visual cues. The "MLLM as a UI Judge" paper (arXiv:2510.08783) specifically benchmarks multimodal LLMs for pairwise UI comparison, confirming they're capable supplementary tools for human UI testing.

---

## Proposed system architecture: the complete feedback loop

The complete system architecture integrates five modules into a continuous feedback loop, exposed through both MCP and CLI interfaces.

**Module 1: Design Parser** ingests Figma files (via REST API + figma-js), Sketch files (via sketch-constructor), or W3C Design Token JSON files, producing a normalized design state: a tree of elements with bounds, styles, typography, and layout constraints. Design screenshots are extracted via Figma's image rendering API or from cached reference images. This module also extracts design tokens into Style Dictionary format for property-level comparison.

**Module 2: Screenshot Engine** uses a persistent Playwright browser instance to render the build at specified viewports, capture element-scoped or full-page screenshots, extract DOM computed styles via `getComputedStyle()`, and build the virtual canvas (scene graph + R-tree spatial index). It handles animation disabling, lazy-load triggering, and network-idle waiting.

**Module 3: Visual Comparator** runs the multi-tier comparison pipeline — DOM property diff, pixel diff (pixelmatch/odiff), perceptual metrics (SSIM, LPIPS), color accuracy (CIEDE2000), and semantic similarity (CLIP/SigLIP embeddings). Each tier produces structured output with severity ratings derived from perceptual thresholds (ΔE₀₀ < 1.0 = pass, Weber fraction thresholds for position).

**Module 4: Feedback Generator** transforms comparison results into developer-actionable text. DOM property mismatches become direct CSS fix suggestions ("change `gap: 8px` to `gap: 12px` on `.card-grid`"). Pixel diff regions are annotated with severity and mapped back to DOM elements via bounding box intersection. For qualitative assessment, an optional VLM pass (Qwen2.5-VL-7B or API-based GPT-4o/Claude) evaluates the side-by-side screenshots and provides natural-language feedback on visual hierarchy, aesthetic fidelity, and UX issues.

**Module 5: Interface Layer** exposes all capabilities through MCP tools (for interactive AI agent use) and CLI commands (for CI/CD pipelines). The MCP server maintains persistent state (cached design, browser instance, comparison history), while the CLI operates statelessly.

**Responsive design handling** runs the entire pipeline across multiple breakpoints in parallel. A standard configuration tests at 375px (mobile), 768px (tablet), and 1440px (desktop), each with its own design reference. The system reports per-breakpoint results and flags responsive-specific issues (horizontal overflow, element disappearance, aspect ratio distortion).

**Technology stack recommendation**: TypeScript for the core library and MCP server (maximizing compatibility with the Node.js ecosystem where Playwright, pixelmatch, figma-js, and rbush all live natively), with Python microservices for ML-dependent modules (LPIPS, SSIM via scikit-image, CLIP/SigLIP via OpenCLIP) communicating via local HTTP or subprocess calls. The Python ML service can be optional — the system should function with algorithmic-only comparison (pixelmatch + DOM diff + CIEDE2000) and enhance with ML metrics when GPU acceleration is available.

```
┌──────────────────────────────────────────────────────────┐
│                    AI Coding Agent                        │
│              (Claude Code, Copilot, Cursor)               │
└───────────────────────┬──────────────────────────────────┘
                        │ MCP Protocol (JSON-RPC 2.0)
┌───────────────────────▼──────────────────────────────────┐
│                  MCP Server / CLI                         │
│  Tools: capture_screenshot, load_design,                 │
│         compare_design_build, get_visual_diff,           │
│         get_design_tokens                                │
└──┬──────────┬──────────┬──────────┬──────────┬───────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
┌──────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐
│Design│ │Screenshot│ │ Visual │ │Feedback│ │VLM Pass │
│Parser│ │ Engine   │ │Compar- │ │Generat-│ │(optional│
│      │ │          │ │ator   │ │or      │ │ GPU)    │
│Figma │ │Playwright│ │pixel-  │ │DOM→CSS │ │Qwen2.5 │
│API + │ │+computed │ │match + │ │fixes + │ │-VL or  │
│Style │ │styles +  │ │SSIM +  │ │natural │ │GPT-4o  │
│Dict  │ │R-tree    │ │LPIPS + │ │language│ │API     │
│      │ │spatial   │ │CIEDE   │ │summari-│ │        │
│      │ │index     │ │2000 +  │ │zation  │ │        │
│      │ │          │ │CLIP    │ │        │ │        │
└──────┘ └──────────┘ └────────┘ └────────┘ └─────────┘
```

---

## Conclusion: what this system changes

This architecture transforms AI coding agents from text-only systems into visually-aware builders that can see, evaluate, and iteratively improve their output. The key technical insights are: **use DOM property comparison as the primary feedback channel** (it's fastest and produces the most actionable output), **layer perceptual metrics for rendering verification** (SSIM for structure, CIEDE2000 for color, LPIPS for human-correlated quality), and **reserve VLMs for qualitative assessment** (visual hierarchy, aesthetic judgment, UX evaluation).

The entire stack can be built from permissively-licensed open-source components. The minimum viable implementation requires only Playwright (screenshot capture + DOM extraction), pixelmatch (pixel diff), figma-js (design parsing), and an MCP server wrapper — achievable in under 2,000 lines of TypeScript. The full implementation adds perceptual metrics (Python ML service), the virtual canvas with spatial indexing (rbush), design token comparison (Style Dictionary), and optional VLM evaluation — a more substantial but well-defined engineering effort.

The most impactful near-term application is the **feedback loop acceleration**: today, AI agents make a change and hope it's right. With this system, they make a change, see the result in under a second, identify specific discrepancies ("button padding is 12px, should be 16px"), and fix them immediately. Human designers currently provide this feedback loop manually — this system automates it, making AI coding agents meaningfully more capable at producing pixel-faithful implementations of design specifications.