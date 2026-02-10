/**
 * Type definitions for Pencil.dev (.pen) design files.
 *
 * .pen files are plain UTF-8 JSON with a tree of design nodes,
 * optional variables (design tokens), and component definitions.
 */

export interface PenFile {
  version: string;
  children: PenNode[];
  variables?: Record<string, PenVariable>;
}

export interface PenNode {
  type: 'frame' | 'text' | 'rectangle' | 'ellipse' | 'path' | 'line' | 'image' | 'icon_font' | 'ref';
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: PenSize;
  height?: PenSize;
  layout?: 'vertical' | 'none';
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  justifyContent?: string;
  alignItems?: string;
  fill?: string | PenFillObject;
  stroke?: PenStroke;
  effect?: PenEffect;
  cornerRadius?: number | string;
  clip?: boolean;
  // Typography
  fontFamily?: string;
  fontSize?: number | string;
  fontWeight?: number | string;
  lineHeight?: number;
  letterSpacing?: number;
  content?: string;
  textGrowth?: string;
  // Components
  reusable?: boolean;
  ref?: string;
  descendants?: Record<string, Partial<PenNode>>;
  children?: PenNode[];
  // Theme
  theme?: Record<string, string>;
}

/** number (px), "fill_container", "fill_container(N)", "fit_content", "fit_content(N)" */
export type PenSize = number | string;

export interface PenVariable {
  type: 'color' | 'string' | 'number';
  value: string | number | PenThemedValue[];
}

export interface PenThemedValue {
  value: string | number;
  theme: Record<string, string>;
}

export interface PenFillObject {
  type: string;
  color: string;
  enabled?: boolean;
}

export interface PenStroke {
  align?: string;
  thickness?: number | Record<string, number>;
  fill?: string;
}

export interface PenEffect {
  type: string;
  shadowType?: string;
  color?: string;
  offset?: { x: number; y: number };
  blur?: number;
  spread?: number;
}
