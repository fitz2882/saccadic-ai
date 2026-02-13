/**
 * Core type definitions for Saccadic AI visual feedback system.
 */

// ── Design State ──

export interface DesignState {
  id: string;
  name: string;
  viewport: Viewport;
  nodes: DesignNode[];
  tokens?: DesignTokens;
}

export interface DesignNode {
  id: string;
  name: string;
  type: NodeType;
  bounds: Bounds;
  fills?: Fill[];
  strokes?: Stroke[];
  effects?: Effect[];
  cornerRadius?: number | CornerRadius;
  typography?: Typography;
  padding?: Spacing;
  gap?: number;
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  children: DesignNode[];
  textContent?: string;
}

export type NodeType =
  | 'FRAME'
  | 'GROUP'
  | 'TEXT'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'IMAGE'
  | 'BUTTON'
  | 'INPUT'
  | 'COMPONENT'
  | 'INSTANCE'
  | 'VECTOR';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Fill {
  type: 'SOLID' | 'LINEAR_GRADIENT' | 'RADIAL_GRADIENT' | 'IMAGE';
  color?: string; // hex
  opacity?: number;
  gradient?: GradientStop[];
}

export interface GradientStop {
  position: number;
  color: string;
}

export interface Stroke {
  color: string;
  weight: number;
  position: 'INSIDE' | 'OUTSIDE' | 'CENTER';
}

export interface Effect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'BLUR' | 'BACKGROUND_BLUR';
  color?: string;
  offset?: { x: number; y: number };
  blur: number;
  spread?: number;
}

export interface Typography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
  textAlign?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
}

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

// ── Design Tokens ──

export interface DesignTokens {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  typography: Record<string, TypographyToken>;
  shadows: Record<string, string>;
  borders: Record<string, string>;
  radii: Record<string, string>;
}

export interface TypographyToken {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing?: string;
}

// ── Viewport ──

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export const STANDARD_VIEWPORTS: Record<string, Viewport> = {
  'mobile-sm': { width: 320, height: 568 },
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  'desktop-sm': { width: 1024, height: 768 },
  desktop: { width: 1280, height: 800 },
  'desktop-lg': { width: 1440, height: 900 },
};

// ── Screenshot Engine ──

export interface ScreenshotOptions {
  url: string;
  viewport?: Viewport;
  selector?: string;
  fullPage?: boolean;
  waitForSelector?: string;
  waitForTimeout?: number;
  disableAnimations?: boolean;
}

export interface ScreenshotResult {
  image: Buffer;
  viewport: Viewport;
  url: string;
  selector?: string;
  timestamp: number;
  domStyles?: DOMElementStyle[];
  elementBounds?: ElementBounds[];
}

export interface DOMElementStyle {
  selector: string;
  tagName: string;
  bounds: Bounds;
  computedStyles: Record<string, string>;
  penId?: string;
  textContent?: string;
  zIndex?: number;
  stackingLayer?: number;
  layoutContext?: LayoutContext;
}

export interface LayoutContext {
  display: string;
  position: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  parentSelector?: string;
  parentLayout?: {
    display: string;
    flexDirection?: string;
    justifyContent?: string;
    alignItems?: string;
  };
}

export interface ElementBounds {
  selector: string;
  tagName: string;
  bounds: Bounds;
}

// ── Virtual Canvas ──

export interface UINode {
  id: string;
  name: string;
  bounds: Bounds;
  type: string;
  parentId?: string;
  children?: string[];
  style?: Record<string, string>;
}

export interface AlignmentReport {
  horizontalGroups: AlignmentGroup[];
  verticalGroups: AlignmentGroup[];
  misaligned: UINode[];
}

export interface AlignmentGroup {
  axis: 'horizontal' | 'vertical';
  position: number;
  tolerance: number;
  nodes: UINode[];
}

export interface SpacingIssue {
  nodeA: UINode;
  nodeB: UINode;
  expected: number;
  actual: number;
  axis: 'horizontal' | 'vertical';
}

// ── ML Metrics ──

export interface MLMetrics {
  ssim: number;
  ssimMap?: Buffer;
}

// ── VLM Evaluation ──

export interface VLMEvaluation {
  overallAssessment: string;
  issues: VLMIssue[];
  qualityScore: number;
  suggestions: string[];
  model: string;
  tokensUsed: number;
}

export interface VLMIssue {
  description: string;
  severity: 'minor' | 'moderate' | 'major';
  category: string;
  element?: string;
}

// ── Token Versioning ──

export interface TokenDiff {
  added: TokenChange[];
  removed: TokenChange[];
  changed: TokenChange[];
  breaking: boolean;
}

export interface TokenChange {
  path: string;
  category: string;
  oldValue?: string;
  newValue?: string;
  isBreaking: boolean;
}

// ── Comparison Results ──

export interface ComparisonResult {
  overall: OverallScore;
  domDiff: DOMDiffResult;
  pixelDiff: PixelDiffResult;
  regions: DiffRegion[];
  feedback: FeedbackItem[];
  timestamp: number;
  mlMetrics?: MLMetrics;
  vlmEvaluation?: VLMEvaluation;
}

export interface OverallScore {
  matchPercentage: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

export interface DOMDiffResult {
  matches: number;
  mismatches: DOMPropertyMismatch[];
  missing: string[];
  extra: string[];
}

export interface DOMPropertyMismatch {
  element: string;
  property: string;
  expected: string;
  actual: string;
  severity: Severity;
  fix?: string;
}

export interface PixelDiffResult {
  totalPixels: number;
  diffPixels: number;
  diffPercentage: number;
  diffImage?: Buffer;
  pixelComparisonRan: boolean;
}

export interface DiffRegion {
  bounds: Bounds;
  severity: Severity;
  type: 'color' | 'position' | 'size' | 'missing' | 'extra' | 'typography' | 'rendering';
  description: string;
  deltaE?: number;
  element?: string;
}

export type Severity = 'pass' | 'warn' | 'fail';

export interface FeedbackItem {
  severity: Severity;
  category: 'color' | 'spacing' | 'typography' | 'layout' | 'size' | 'missing' | 'extra' | 'rendering';
  message: string;
  element?: string;
  fix?: string;
}

// ── MCP Tool Interfaces ──

export interface CaptureScreenshotParams {
  url: string;
  viewport?: string | Viewport;
  selector?: string;
  fullPage?: boolean;
  outputPath?: string;
}

export interface LoadDesignParams {
  figmaUrl?: string;
  figmaFileKey?: string;
  tokenFile?: string;
  nodeId?: string;
  pencilFile?: string;
  pencilFrame?: string;
  pencilTheme?: string;
}

export interface CompareDesignBuildParams {
  designSource: LoadDesignParams;
  buildUrl: string;
  viewport?: string | Viewport;
  selector?: string;
  threshold?: number;
  referenceImage?: string; // base64, file path, or URL to a design screenshot
}

export interface RefineBuildParams {
  designSource: LoadDesignParams;
  buildUrl: string;
  referenceImage?: string;
  targetGrade?: 'A' | 'B' | 'C';
  targetScore?: number;
  viewport?: string | Viewport;
  selector?: string;
  iteration?: number;
  maxIterations?: number;
}

export interface GetVisualDiffParams {
  designImage: string; // base64 or file path
  buildImage: string;  // base64 or file path
}

export interface GetDesignTokensParams {
  figmaUrl?: string;
  figmaFileKey?: string;
  tokenFile?: string;
  pencilFile?: string;
  pencilFrame?: string;
  pencilTheme?: string;
}

export interface CompareDesignTokensParams {
  oldTokens: string; // JSON string or file path
  newTokens: string; // JSON string or file path
}

export interface EvaluateWithVLMParams {
  designImage: string; // base64 or file path
  buildImage: string;  // base64 or file path
  prompt?: string;
}

export interface PlanBuildParams {
  pencilFile: string;
  pencilTheme?: string;
  buildDir?: string;
  techStack?: string;
  targetScore?: number;
  maxIterationsPerPage?: number;
}

// ── Thresholds ──

export const THRESHOLDS = {
  color: {
    pass: 1.0,     // ΔE₀₀ < 1.0: imperceptible
    warn: 2.0,     // ΔE₀₀ 1.0-2.0: minor
    // > 2.0: fail
  },
  position: {
    pass: 0.02,    // Weber fraction < 2%: imperceptible
    warn: 0.04,    // 2-4%: noticeable
    // > 4%: fail
  },
  size: {
    pass: 0.029,   // < 2.9%: imperceptible
    warn: 0.05,    // 2.9-5%: noticeable
    // > 5%: fail
  },
  pixel: {
    pass: 0.01,    // < 1% pixels different
    warn: 0.05,    // 1-5%
    // > 5%: fail
  },
  ssim: {
    pass: 0.95,    // > 0.95: high similarity
    warn: 0.85,    // 0.85-0.95: moderate
    // < 0.85: fail
  },
} as const;
