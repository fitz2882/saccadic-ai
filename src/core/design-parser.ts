/**
 * Design Parser module for Saccadic AI visual feedback system.
 * Handles parsing Figma designs and W3C Design Token files.
 */

import type {
  DesignState,
  DesignNode,
  DesignTokens,
  NodeType,
  Bounds,
  Fill,
  Stroke,
  Effect,
  Typography,
  Spacing,
  CornerRadius,
  TypographyToken,
  Viewport,
} from './types.js';

// ── Figma API Types ──

interface FigmaFile {
  document: FigmaNode;
  name: string;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fills?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a: number };
    opacity?: number;
    gradientStops?: Array<{
      position: number;
      color: { r: number; g: number; b: number; a: number };
    }>;
  }>;
  strokes?: Array<{
    type: string;
    color: { r: number; g: number; b: number; a: number };
  }>;
  strokeWeight?: number;
  strokeAlign?: string;
  effects?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a: number };
    offset?: { x: number; y: number };
    radius: number;
    spread?: number;
    visible?: boolean;
  }>;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
}

interface FigmaNodesResponse {
  nodes: Record<string, { document: FigmaNode }>;
}

interface FigmaImagesResponse {
  images: Record<string, string>;
}

interface FigmaVariablesResponse {
  meta: {
    variableCollections: Record<string, {
      id: string;
      name: string;
      modes: Array<{ modeId: string; name: string }>;
    }>;
    variables: Record<string, {
      id: string;
      name: string;
      resolvedType: string;
      valuesByMode: Record<string, any>;
    }>;
  };
}

// ── W3C DTCG Token Types ──

interface DTCGToken {
  $value: any;
  $type?: string;
  $description?: string;
  [key: string]: any; // Allows nested token groups
}

interface DTCGTokenFile {
  [key: string]: DTCGToken | DTCGTokenFile;
}

// ── Design Parser Class ──

export class DesignParser {
  private readonly figmaApiBase = 'https://api.figma.com';
  private readonly figmaToken: string;
  private readonly cache = new Map<string, DesignState>();

  constructor(figmaToken?: string) {
    this.figmaToken = figmaToken || process.env.FIGMA_ACCESS_TOKEN || '';
    if (!this.figmaToken) {
      console.warn('Warning: No Figma access token provided. Figma API calls will fail.');
    }
  }

  /**
   * Fetch Figma file via REST API and convert to DesignState.
   */
  async parseFromFigma(fileKey: string, nodeId?: string): Promise<DesignState> {
    const cacheKey = `${fileKey}:${nodeId || 'root'}`;

    // Check cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let figmaNode: FigmaNode;
    let fileName: string;

    if (nodeId) {
      // Fetch specific node
      const response = await fetch(
        `${this.figmaApiBase}/v1/files/${fileKey}/nodes?ids=${nodeId}`,
        {
          headers: { 'X-Figma-Token': this.figmaToken },
        }
      );

      if (!response.ok) {
        throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as FigmaNodesResponse;
      if (!data.nodes[nodeId]) {
        throw new Error(`Node ${nodeId} not found in file ${fileKey}`);
      }

      figmaNode = data.nodes[nodeId].document;
      fileName = figmaNode.name;
    } else {
      // Fetch entire file
      const response = await fetch(`${this.figmaApiBase}/v1/files/${fileKey}`, {
        headers: { 'X-Figma-Token': this.figmaToken },
      });

      if (!response.ok) {
        throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as FigmaFile;
      figmaNode = data.document;
      fileName = data.name;
    }

    // Parse the node tree
    const parsedNode = this.parseFigmaNode(figmaNode);

    // Calculate viewport from root bounds or first child with bounds
    let viewport: Viewport;
    if (figmaNode.absoluteBoundingBox) {
      viewport = {
        width: Math.ceil(figmaNode.absoluteBoundingBox.width),
        height: Math.ceil(figmaNode.absoluteBoundingBox.height)
      };
    } else if (figmaNode.children && figmaNode.children.length > 0) {
      // Try to get viewport from first child
      const firstChild = figmaNode.children[0];
      if (firstChild.absoluteBoundingBox) {
        viewport = {
          width: Math.ceil(firstChild.absoluteBoundingBox.width),
          height: Math.ceil(firstChild.absoluteBoundingBox.height)
        };
      } else {
        viewport = { width: 1280, height: 800 }; // Default fallback
      }
    } else {
      viewport = { width: 1280, height: 800 }; // Default fallback
    }

    const designState: DesignState = {
      id: fileKey + (nodeId ? `:${nodeId}` : ''),
      name: fileName,
      viewport,
      nodes: [parsedNode],
    };

    // Cache with eviction (limit to 50 entries)
    if (this.cache.size >= 50) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, designState);
    return designState;
  }

  /**
   * Parse W3C Design Token Community Group JSON format.
   */
  async parseFromTokenFile(filePath: string): Promise<DesignTokens> {
    const fs = await import('fs/promises');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const tokenData = JSON.parse(fileContent) as DTCGTokenFile;

    const tokens: DesignTokens = {
      colors: {},
      spacing: {},
      typography: {},
      shadows: {},
      borders: {},
      radii: {},
    };

    // Recursively extract tokens
    this.extractDTCGTokens(tokenData, '', tokens);

    return tokens;
  }

  /**
   * Fetch rendered image from Figma image API.
   */
  async getFigmaScreenshot(fileKey: string, nodeId?: string): Promise<Buffer> {
    const targetNodeId = nodeId || (await this.getDefaultNodeId(fileKey));

    const response = await fetch(
      `${this.figmaApiBase}/v1/images/${fileKey}?ids=${targetNodeId}&format=png&scale=2`,
      {
        headers: { 'X-Figma-Token': this.figmaToken },
      }
    );

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as FigmaImagesResponse;
    const imageUrl = data.images[targetNodeId];

    if (!imageUrl) {
      throw new Error(`No image generated for node ${targetNodeId}`);
    }

    // Fetch the actual image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }

    return Buffer.from(await imageResponse.arrayBuffer());
  }

  /**
   * Convert a Figma API node to our DesignNode type.
   */
  parseFigmaNode(figmaNode: FigmaNode): DesignNode {
    const bounds = this.parseBounds(figmaNode);
    const fills = this.parseFills(figmaNode.fills);
    const strokes = this.parseStrokes(figmaNode);
    const effects = this.parseEffects(figmaNode.effects);
    const typography = this.parseTypography(figmaNode);
    const cornerRadius = this.parseCornerRadius(figmaNode);
    const padding = this.parsePadding(figmaNode);

    const children = figmaNode.children?.map((child) => this.parseFigmaNode(child)) || [];

    return {
      id: figmaNode.id,
      name: figmaNode.name,
      type: this.mapNodeType(figmaNode.type),
      bounds,
      fills,
      strokes,
      effects,
      cornerRadius,
      typography,
      padding,
      gap: figmaNode.itemSpacing,
      layoutMode: figmaNode.layoutMode,
      children,
    };
  }

  /**
   * Extract design tokens from Figma Variables API.
   */
  async extractTokensFromFigma(fileKey: string): Promise<DesignTokens> {
    const response = await fetch(
      `${this.figmaApiBase}/v1/files/${fileKey}/variables/local`,
      {
        headers: { 'X-Figma-Token': this.figmaToken },
      }
    );

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as FigmaVariablesResponse;

    const tokens: DesignTokens = {
      colors: {},
      spacing: {},
      typography: {},
      shadows: {},
      borders: {},
      radii: {},
    };

    // Extract variables
    for (const variable of Object.values(data.meta.variables)) {
      const name = variable.name.toLowerCase().replace(/\s+/g, '-');
      const value = Object.values(variable.valuesByMode)[0]; // Use first mode

      switch (variable.resolvedType) {
        case 'COLOR':
          if (typeof value === 'object' && 'r' in value) {
            tokens.colors[name] = this.rgbaToHex(value.r, value.g, value.b, value.a);
          }
          break;
        case 'FLOAT':
          if (name.includes('spacing') || name.includes('gap') || name.includes('padding')) {
            tokens.spacing[name] = `${value}px`;
          } else if (name.includes('radius')) {
            tokens.radii[name] = `${value}px`;
          }
          break;
      }
    }

    return tokens;
  }

  // ── Private Helper Methods ──

  private async getDefaultNodeId(fileKey: string): Promise<string> {
    const response = await fetch(`${this.figmaApiBase}/v1/files/${fileKey}`, {
      headers: { 'X-Figma-Token': this.figmaToken },
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status}`);
    }

    const data = await response.json() as FigmaFile;
    return data.document.id;
  }

  private extractDTCGTokens(
    obj: DTCGTokenFile | DTCGToken,
    prefix: string,
    tokens: DesignTokens
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('$')) continue; // Skip metadata properties

      const tokenName = prefix ? `${prefix}-${key}` : key;

      if (this.isDTCGToken(value)) {
        // This is a token with $value
        const tokenType = value.$type || this.inferTokenType(tokenName, value.$value);
        this.assignTokenToCategory(tokenName, value.$value, tokenType, tokens);
      } else if (typeof value === 'object') {
        // This is a nested group
        this.extractDTCGTokens(value as DTCGTokenFile, tokenName, tokens);
      }
    }
  }

  private isDTCGToken(value: any): value is DTCGToken {
    return typeof value === 'object' && value !== null && '$value' in value;
  }

  private inferTokenType(name: string, value: any): string {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('color') || lowerName.includes('background') || lowerName.includes('text')) {
      return 'color';
    }
    if (lowerName.includes('spacing') || lowerName.includes('gap') || lowerName.includes('padding')) {
      return 'spacing';
    }
    if (lowerName.includes('shadow')) {
      return 'shadow';
    }
    if (lowerName.includes('radius')) {
      return 'borderRadius';
    }
    if (lowerName.includes('border')) {
      return 'border';
    }
    if (lowerName.includes('font')) {
      return 'typography';
    }
    return 'unknown';
  }

  private assignTokenToCategory(
    name: string,
    value: any,
    type: string,
    tokens: DesignTokens
  ): void {
    switch (type) {
      case 'color':
        tokens.colors[name] = String(value);
        break;
      case 'spacing':
      case 'dimension':
        tokens.spacing[name] = String(value);
        break;
      case 'shadow':
        tokens.shadows[name] = String(value);
        break;
      case 'border':
        tokens.borders[name] = String(value);
        break;
      case 'borderRadius':
        tokens.radii[name] = String(value);
        break;
      case 'typography':
        if (typeof value === 'object') {
          tokens.typography[name] = this.parseTypographyToken(value);
        }
        break;
    }
  }

  private parseTypographyToken(value: any): TypographyToken {
    return {
      fontFamily: value.fontFamily || value.family || 'sans-serif',
      fontSize: String(value.fontSize || value.size || '16px'),
      fontWeight: String(value.fontWeight || value.weight || '400'),
      lineHeight: String(value.lineHeight || value.leading || 'normal'),
      letterSpacing: value.letterSpacing ? String(value.letterSpacing) : undefined,
    };
  }

  private mapNodeType(figmaType: string): NodeType {
    const typeMap: Record<string, NodeType> = {
      FRAME: 'FRAME',
      GROUP: 'GROUP',
      TEXT: 'TEXT',
      RECTANGLE: 'RECTANGLE',
      ELLIPSE: 'ELLIPSE',
      VECTOR: 'VECTOR',
      COMPONENT: 'COMPONENT',
      INSTANCE: 'INSTANCE',
      BOOLEAN_OPERATION: 'VECTOR',
      STAR: 'VECTOR',
      LINE: 'VECTOR',
      REGULAR_POLYGON: 'VECTOR',
    };

    return typeMap[figmaType] || 'FRAME';
  }

  private parseBounds(figmaNode: FigmaNode): Bounds {
    const box = figmaNode.absoluteBoundingBox;
    return box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : { x: 0, y: 0, width: 0, height: 0 };
  }

  private parseFills(fills?: FigmaNode['fills']): Fill[] | undefined {
    if (!fills || fills.length === 0) return undefined;

    return fills
      .filter((fill) => fill.type !== 'IMAGE' || fill.type) // Keep all fills
      .map((fill) => {
        const result: Fill = {
          type: fill.type as Fill['type'],
          opacity: fill.opacity,
        };

        if (fill.color) {
          result.color = this.rgbaToHex(
            fill.color.r,
            fill.color.g,
            fill.color.b,
            fill.color.a
          );
        }

        if (fill.gradientStops) {
          result.gradient = fill.gradientStops.map((stop) => ({
            position: stop.position,
            color: this.rgbaToHex(
              stop.color.r,
              stop.color.g,
              stop.color.b,
              stop.color.a
            ),
          }));
        }

        return result;
      });
  }

  private parseStrokes(figmaNode: FigmaNode): Stroke[] | undefined {
    if (!figmaNode.strokes || figmaNode.strokes.length === 0) return undefined;

    const weight = figmaNode.strokeWeight || 1;
    const align = figmaNode.strokeAlign || 'CENTER';

    return figmaNode.strokes.map((stroke) => ({
      color: this.rgbaToHex(
        stroke.color.r,
        stroke.color.g,
        stroke.color.b,
        stroke.color.a
      ),
      weight,
      position: align as Stroke['position'],
    }));
  }

  private parseEffects(effects?: FigmaNode['effects']): Effect[] | undefined {
    if (!effects || effects.length === 0) return undefined;

    return effects
      .filter((effect) => effect.visible !== false)
      .map((effect) => {
        const result: Effect = {
          type: effect.type as Effect['type'],
          blur: effect.radius,
          spread: effect.spread,
        };

        if (effect.color) {
          result.color = this.rgbaToHex(
            effect.color.r,
            effect.color.g,
            effect.color.b,
            effect.color.a
          );
        }

        if (effect.offset) {
          result.offset = { x: effect.offset.x, y: effect.offset.y };
        }

        return result;
      });
  }

  private parseTypography(figmaNode: FigmaNode): Typography | undefined {
    if (!figmaNode.style) return undefined;

    const style = figmaNode.style;
    const typography: Typography = {
      fontFamily: style.fontFamily || 'sans-serif',
      fontSize: style.fontSize || 16,
      fontWeight: style.fontWeight || 400,
      lineHeight: style.lineHeightPx,
      letterSpacing: style.letterSpacing,
    };

    if (style.textAlignHorizontal) {
      typography.textAlign = style.textAlignHorizontal as Typography['textAlign'];
    }

    // Get text color from fills
    if (figmaNode.fills && figmaNode.fills.length > 0) {
      const firstFill = figmaNode.fills[0];
      if (firstFill.color) {
        typography.color = this.rgbaToHex(
          firstFill.color.r,
          firstFill.color.g,
          firstFill.color.b,
          firstFill.color.a
        );
      }
    }

    return typography;
  }

  private parseCornerRadius(figmaNode: FigmaNode): number | CornerRadius | undefined {
    if (figmaNode.rectangleCornerRadii) {
      const [topLeft, topRight, bottomRight, bottomLeft] = figmaNode.rectangleCornerRadii;
      // Return object only if corners differ
      if (
        topLeft === topRight &&
        topRight === bottomRight &&
        bottomRight === bottomLeft
      ) {
        return topLeft;
      }
      return { topLeft, topRight, bottomRight, bottomLeft };
    }
    return figmaNode.cornerRadius;
  }

  private parsePadding(figmaNode: FigmaNode): Spacing | undefined {
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = figmaNode;
    if (
      paddingTop === undefined &&
      paddingRight === undefined &&
      paddingBottom === undefined &&
      paddingLeft === undefined
    ) {
      return undefined;
    }

    return {
      top: paddingTop || 0,
      right: paddingRight || 0,
      bottom: paddingBottom || 0,
      left: paddingLeft || 0,
    };
  }

  /**
   * Convert Figma RGBA (0-1 floats) to hex string.
   */
  rgbaToHex(r: number, g: number, b: number, a: number = 1): string {
    const toHex = (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      const intValue = Math.round(clamped * 255);
      return intValue.toString(16).padStart(2, '0').toUpperCase();
    };

    const hexColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

    if (a < 1) {
      return `${hexColor}${toHex(a)}`;
    }

    return hexColor;
  }
}
