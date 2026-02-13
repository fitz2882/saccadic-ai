/**
 * Tests for Saccadic AI MCP Server
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPServer } from './server.js';

describe('MCPServer', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer();
  });

  describe('initialize', () => {
    it('should return server capabilities and info', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize',
        params: {},
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'saccadic-ai-mcp',
          version: '0.1.0',
        },
      });
    });
  });

  describe('tools/list', () => {
    it('should return 8 tools', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 2,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(2);
      expect(response.result).toHaveProperty('tools');

      const result = response.result as { tools: unknown[] };
      expect(result.tools).toHaveLength(9);
    });

    it('should have valid tool definitions with JSON Schema', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 3,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
      const tools = result.tools;

      const expectedTools = [
        'capture_screenshot',
        'load_design',
        'compare_design_build',
        'get_visual_diff',
        'get_design_tokens',
      ];

      expectedTools.forEach((toolName) => {
        const tool = tools.find((t) => t.name === toolName);
        expect(tool).toBeDefined();
        expect(tool?.description).toBeTruthy();
        expect(tool?.inputSchema).toBeDefined();
        expect(tool?.inputSchema).toHaveProperty('type', 'object');
        expect(tool?.inputSchema).toHaveProperty('properties');
      });
    });

    it('should have required fields for capture_screenshot', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 4,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> };
      const captureScreenshotTool = result.tools.find((t) => t.name === 'capture_screenshot');

      expect(captureScreenshotTool).toBeDefined();
      expect(captureScreenshotTool?.inputSchema.required).toEqual(['url']);
    });

    it('should have required fields for compare_design_build', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 5,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> };
      const compareTool = result.tools.find((t) => t.name === 'compare_design_build');

      expect(compareTool).toBeDefined();
      expect(compareTool?.inputSchema.required).toContain('designSource');
      expect(compareTool?.inputSchema.required).toContain('buildUrl');
    });

    it('should have required fields for get_visual_diff', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 6,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> };
      const diffTool = result.tools.find((t) => t.name === 'get_visual_diff');

      expect(diffTool).toBeDefined();
      expect(diffTool?.inputSchema.required).toContain('designImage');
      expect(diffTool?.inputSchema.required).toContain('buildImage');
    });
  });

  describe('error handling', () => {
    it('should return method not found for unknown method', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 7,
        method: 'unknown_method',
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(7);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601); // MethodNotFound
      expect(response.error?.message).toContain('Method not found');
    });

    it('should return method not found for unknown tool', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 8,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(8);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601); // MethodNotFound
      expect(response.error?.message).toContain('Unknown tool');
    });

    it('should handle invalid JSON-RPC version', async () => {
      const request = {
        jsonrpc: '1.0' as any,
        id: 9,
        method: 'initialize',
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32600); // InvalidRequest
      expect(response.error?.message).toContain('Invalid JSON-RPC version');
    });

    it('should return internal error for exceptions', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 10,
        method: 'tools/call',
        params: {
          name: 'capture_screenshot',
          arguments: {
            url: 'invalid-url-format',
          },
        },
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(10);
      expect(response.error).toBeDefined();
      // Should fail with internal error due to invalid URL
      expect(response.error?.code).toBe(-32603); // InternalError
    });
  });

  describe('JSON-RPC message parsing', () => {
    it('should accept requests with null id', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: null,
        method: 'initialize',
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBeNull();
      expect(response.result).toBeDefined();
    });

    it('should accept requests without id (notifications)', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        method: 'notifications/initialized',
      };

      const response = await server.handleRequest(request);

      // Notifications return null (no response expected)
      expect(response).toBeNull();
    });

    it('should accept string ids', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 'test-id-123',
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-id-123');
      expect(response.result).toBeDefined();
    });
  });

  describe('viewport resolution', () => {
    it('should resolve standard viewport presets', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 11,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as {
        tools: Array<{ name: string; inputSchema: { properties: Record<string, any> } }>;
      };
      const captureScreenshotTool = result.tools.find((t) => t.name === 'capture_screenshot');

      expect(captureScreenshotTool).toBeDefined();
      const viewportSchema = captureScreenshotTool?.inputSchema.properties.viewport;
      expect(viewportSchema.oneOf).toBeDefined();

      // Check that preset names are defined
      const presetEnum = viewportSchema.oneOf[0];
      expect(presetEnum.enum).toContain('mobile');
      expect(presetEnum.enum).toContain('tablet');
      expect(presetEnum.enum).toContain('desktop');
    });

    it('should accept custom viewport objects', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 12,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as {
        tools: Array<{ name: string; inputSchema: { properties: Record<string, any> } }>;
      };
      const captureScreenshotTool = result.tools.find((t) => t.name === 'capture_screenshot');

      expect(captureScreenshotTool).toBeDefined();
      const viewportSchema = captureScreenshotTool?.inputSchema.properties.viewport;

      // Check that custom viewport object schema is defined
      const customViewport = viewportSchema.oneOf[1];
      expect(customViewport.type).toBe('object');
      expect(customViewport.properties).toHaveProperty('width');
      expect(customViewport.properties).toHaveProperty('height');
      expect(customViewport.required).toEqual(['width', 'height']);
    });
  });
});
