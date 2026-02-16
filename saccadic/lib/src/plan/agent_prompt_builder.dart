/// Agent Prompt Builder — Flutter-specific agent prompts with Key('nodeId').
///
/// Generates detailed prompts for AI coding agents to build Flutter pages
/// that match the design specification.
library;
import '../core/types.dart';

class AgentPromptBuilder {
  /// Build a complete agent prompt for a single page.
  ///
  /// When [mcpMode] is true, the verification section emits `refine_build`
  /// MCP tool calls instead of CLI commands. Pass [pencilFile] to pre-fill
  /// the refine_build parameters.
  String buildPrompt({
    required String frameName,
    required String frameId,
    required int width,
    required int height,
    required String designTree,
    required List<({String id, String name, String type, String? textContent})> nodeMetadata,
    DesignTokens? tokens,
    String techStack = 'flutter',
    bool mcpMode = false,
    String? pencilFile,
  }) {
    final buf = StringBuffer();

    buf.writeln('# Build: $frameName');
    buf.writeln();
    buf.writeln('Build a Flutter widget matching this design exactly.');
    buf.writeln('Target: $width×$height viewport.');
    buf.writeln();

    // Key convention
    buf.writeln('## Key Convention');
    buf.writeln();
    buf.writeln("Every widget that corresponds to a design node MUST have a Key('nodeId') attribute.");
    buf.writeln('This is how saccadic matches widgets to design nodes for comparison.');
    buf.writeln();
    buf.writeln('```dart');
    buf.writeln('Container(');
    buf.writeln("  key: Key('$frameId'),");
    buf.writeln('  child: Column(children: [');
    if (nodeMetadata.length >= 2) {
      buf.writeln("    Text('...', key: Key('${nodeMetadata[1].id}')),");
    }
    buf.writeln('  ]),');
    buf.writeln(')');
    buf.writeln('```');
    buf.writeln();

    // Required Key mappings — single combined section
    buf.writeln('## Required Keys (${nodeMetadata.length} nodes)');
    buf.writeln();
    buf.writeln('**CRITICAL**: Every widget below MUST have its Key set during initial build.');
    buf.writeln('Missing Keys will cause 0% match score on first refine_build call.');
    buf.writeln();
    buf.writeln('```dart');
    for (final node in nodeMetadata) {
      final typeHint = _widgetTypeHint(node.type);
      final text = node.textContent;
      if (text != null && text.isNotEmpty) {
        final truncated = text.length > 30 ? '${text.substring(0, 27)}...' : text;
        buf.writeln("$typeHint(key: Key('${node.id}'), ...) // \"$truncated\"");
      } else {
        buf.writeln("$typeHint(key: Key('${node.id}'), ...) // ${node.name}");
      }
    }
    buf.writeln('```');
    buf.writeln();

    // Design tree
    buf.writeln('## Design Structure');
    buf.writeln();
    buf.writeln('```');
    buf.writeln(designTree);
    buf.writeln('```');
    buf.writeln();

    // Tokens
    if (tokens != null) {
      buf.writeln('## Design Tokens');
      buf.writeln();

      if (tokens.colors.isNotEmpty) {
        buf.writeln('### Colors');
        for (final entry in tokens.colors.entries) {
          final hex = entry.value.replaceFirst('#', '');
          buf.writeln('- ${entry.key}: Color(0xFF$hex)');
        }
        buf.writeln();
      }

      if (tokens.spacing.isNotEmpty) {
        buf.writeln('### Spacing');
        for (final entry in tokens.spacing.entries) {
          buf.writeln('- ${entry.key}: ${entry.value}');
        }
        buf.writeln();
      }

      if (tokens.radii.isNotEmpty) {
        buf.writeln('### Border Radii');
        for (final entry in tokens.radii.entries) {
          buf.writeln('- ${entry.key}: BorderRadius.circular(${entry.value})');
        }
        buf.writeln();
      }
    }

    // Verification
    buf.writeln('## Verification');
    buf.writeln();

    if (mcpMode) {
      buf.writeln('After building, call the `refine_build` MCP tool:');
      buf.writeln('```json');
      buf.writeln('{');
      buf.writeln('  "designSource": {');
      if (pencilFile != null) {
        buf.writeln('    "pencilFile": "$pencilFile",');
        buf.writeln('    "pencilFrame": "$frameName"');
      } else {
        buf.writeln('    "pencilFrame": "$frameName"');
      }
      buf.writeln('  },');
      buf.writeln('  "flutterUrl": "ws://127.0.0.1:PORT/ws",');
      buf.writeln('  "iteration": 1');
      buf.writeln('}');
      buf.writeln('```');
      buf.writeln();
      buf.writeln('Repeat with incrementing `iteration` until `status` is `"pass"`.');
      buf.writeln('Capture a reference screenshot first via Pencil MCP `get_screenshot`');
      buf.writeln('and pass it as `referenceImage` for pixel-accurate comparison.');
      buf.writeln();
      buf.writeln('**Route navigation**: If this page is behind a tab bar or '
          'navigation system, pass `route` (e.g., "/learn", "/scenarios") '
          'so saccadic navigates to the correct page before comparing. '
          'Works with GoRouter, Navigator 2.0, and custom routing.');
      buf.writeln();
      buf.writeln('**Hot reload**: Save code changes before calling refine_build. '
          'Saccadic automatically hot reloads the Flutter app on iteration 2+. '
          'If hot reload fails, the response will tell you to reload manually.');
      buf.writeln();
      buf.writeln('**Context management**: Run this entire refine loop inside a '
          'sub-agent to avoid consuming the main conversation\'s context. '
          'The refine loop can take 5-15 iterations, each generating large '
          'tool responses.');
    } else {
      buf.writeln('After building, run:');
      buf.writeln('```bash');
      buf.writeln('saccadic refine --pen design.pen --frame "$frameName" --flutter-url ws://...');
      buf.writeln('```');
    }

    return buf.toString();
  }

  /// Map design node type to a suggested Flutter widget type.
  String _widgetTypeHint(String nodeType) {
    switch (nodeType.toLowerCase()) {
      case 'text':
        return 'Text';
      case 'frame':
      case 'group':
      case 'component':
        return 'Container';
      case 'instance':
        return 'Container';
      case 'rectangle':
        return 'Container';
      case 'ellipse':
        return 'ClipOval';
      case 'image':
        return 'Image';
      case 'button':
        return 'ElevatedButton';
      case 'input':
        return 'TextField';
      case 'vector':
        return 'Icon';
      default:
        return 'Container';
    }
  }
}
