/**
 * Integration test: MCP Server JSON-RPC protocol.
 *
 * Tests the MCP server by sending JSON-RPC requests and validating responses.
 */

import { describe, it, expect } from 'vitest';
import { MCPServer } from '../mcp/server.js';

describe('MCP Protocol Integration', () => {
  const server = new MCPServer();

  it('responds to initialize with protocol version and capabilities', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();

    const result = response.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities).toHaveProperty('tools');
    expect(result.serverInfo).toHaveProperty('name', 'saccadic-ai-mcp');
  });

  it('lists all tools with valid schemas', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    const result = response.result as { tools: Array<{ name: string; inputSchema: unknown }> };
    expect(result.tools.length).toBe(7);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('capture_screenshot');
    expect(toolNames).toContain('compare_design_build');
    expect(toolNames).toContain('get_visual_diff');
    expect(toolNames).toContain('get_design_tokens');
    expect(toolNames).toContain('load_design');
    expect(toolNames).toContain('compare_design_tokens');
    expect(toolNames).toContain('evaluate_with_vlm');

    // Each tool should have inputSchema
    for (const tool of result.tools) {
      expect(tool.inputSchema).toHaveProperty('type', 'object');
    }
  });

  it('returns error for unknown method', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'nonexistent/method',
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601); // MethodNotFound
  });

  it('returns error for unknown tool', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
  });

  it('handles ping', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'ping',
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({});
  });

  it('rejects invalid JSON-RPC version', async () => {
    const response = await server.handleRequest({
      jsonrpc: '1.0' as '2.0',
      id: 6,
      method: 'ping',
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32600); // InvalidRequest
  });

  it('compare_design_tokens returns structured diff', async () => {
    const oldTokens = JSON.stringify({
      colors: { primary: '#FF0000' },
      spacing: { sm: '4px' },
      typography: {},
      shadows: {},
      borders: {},
      radii: {},
    });

    const newTokens = JSON.stringify({
      colors: { primary: '#0000FF', accent: '#00FF00' },
      spacing: { sm: '4px' },
      typography: {},
      shadows: {},
      borders: {},
      radii: {},
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'compare_design_tokens',
        arguments: { oldTokens, newTokens },
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const diff = JSON.parse(result.content[0].text);
    expect(diff.added.length).toBe(1);
    expect(diff.changed.length).toBe(1);
    expect(diff.breaking).toBe(true);
  });
});
