/**
 * Design Renderer
 *
 * Renders DesignNode[] to absolute-positioned HTML for screenshot-based
 * pixel comparison when no reference image is provided.
 */

import type { DesignNode } from './types.js';

export class DesignRenderer {
  /**
   * Render design nodes to an HTML string suitable for screenshotting.
   */
  render(nodes: DesignNode[], width: number, height: number): string {
    const body = nodes.map(node => this.renderNode(node)).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; position: relative; overflow: hidden; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  }

  private renderNode(node: DesignNode): string {
    const styles: string[] = [
      'position: absolute',
      `left: ${node.bounds.x}px`,
      `top: ${node.bounds.y}px`,
      `width: ${node.bounds.width}px`,
      `height: ${node.bounds.height}px`,
    ];

    // Background color from fills
    if (node.fills?.[0]?.type === 'SOLID' && node.fills[0].color) {
      styles.push(`background-color: ${node.fills[0].color}`);
    }

    // Border radius
    if (node.cornerRadius !== undefined) {
      const radius = typeof node.cornerRadius === 'number'
        ? `${node.cornerRadius}px`
        : `${node.cornerRadius.topLeft}px ${node.cornerRadius.topRight}px ${node.cornerRadius.bottomRight}px ${node.cornerRadius.bottomLeft}px`;
      styles.push(`border-radius: ${radius}`);
    }

    // Typography
    if (node.typography) {
      const t = node.typography;
      styles.push(`font-family: ${t.fontFamily}`);
      styles.push(`font-size: ${t.fontSize}px`);
      styles.push(`font-weight: ${t.fontWeight}`);
      if (t.lineHeight) styles.push(`line-height: ${t.lineHeight}px`);
      if (t.letterSpacing) styles.push(`letter-spacing: ${t.letterSpacing}px`);
      if (t.color) styles.push(`color: ${t.color}`);
      if (t.textAlign) styles.push(`text-align: ${t.textAlign.toLowerCase()}`);
    }

    // Overflow hidden for frames with children
    if (node.children.length > 0) {
      styles.push('overflow: hidden');
    }

    const styleAttr = styles.join('; ');
    const textContent = node.textContent ? this.escapeHtml(node.textContent) : '';
    const childrenHtml = node.children.map(c => this.renderNode(c)).join('\n');

    return `<div style="${styleAttr}">${textContent}${childrenHtml}</div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
