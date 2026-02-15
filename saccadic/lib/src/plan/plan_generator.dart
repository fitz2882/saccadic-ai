/// Plan Generator — per-page build plans from .pen/Figma designs.
///
/// Generates Flutter-specific agent prompts with Key('nodeId') conventions,
/// design tokens, and node structure for each page in the design.
library;
import '../core/types.dart';
import '../design/pencil_parser.dart';
import '../design/pencil_types.dart';
import 'agent_prompt_builder.dart';

/// A complete build plan for a design file.
class BuildPlan {
  final List<PagePlan> pages;
  final String orchestrationPrompt;
  final DesignTokens? tokens;

  const BuildPlan({
    required this.pages,
    required this.orchestrationPrompt,
    this.tokens,
  });

  Map<String, dynamic> toJson() => {
        'pages': pages.map((p) => p.toJson()).toList(),
        'orchestrationPrompt': orchestrationPrompt,
        'tokens': tokens != null
            ? {
                'colors': tokens!.colors,
                'spacing': tokens!.spacing,
                'radii': tokens!.radii,
              }
            : null,
      };

  String toText() {
    final buf = StringBuffer();
    buf.writeln('Build Plan (${pages.length} page${pages.length == 1 ? '' : 's'})');
    buf.writeln('=' * 60);
    buf.writeln();
    buf.writeln(orchestrationPrompt);
    buf.writeln();

    for (var i = 0; i < pages.length; i++) {
      final page = pages[i];
      buf.writeln('--- Page ${i + 1}: ${page.name} ---');
      buf.writeln('Frame: ${page.frameId} (${page.width}×${page.height})');
      buf.writeln('Nodes: ${page.nodeMetadata.length}');
      buf.writeln();
      buf.writeln(page.agentPrompt);
      buf.writeln();
    }

    return buf.toString();
  }
}

/// Node metadata record for structured plan_build responses.
typedef NodeMeta = ({String id, String name, String type, String? textContent});

/// Build plan for a single page/frame.
class PagePlan {
  final String name;
  final String frameId;
  final int width;
  final int height;
  final List<NodeMeta> nodeMetadata;
  final String agentPrompt;
  final String designTree;

  const PagePlan({
    required this.name,
    required this.frameId,
    required this.width,
    required this.height,
    required this.nodeMetadata,
    required this.agentPrompt,
    required this.designTree,
  });

  List<String> get nodeIds => nodeMetadata.map((n) => n.id).toList();

  Map<String, dynamic> toJson() => {
        'name': name,
        'frameId': frameId,
        'width': width,
        'height': height,
        'nodeCount': nodeMetadata.length,
        'agentPrompt': agentPrompt,
      };
}

class PlanGenerator {
  final _promptBuilder = AgentPromptBuilder();

  /// Generate a full build plan from a .pen file.
  BuildPlan generatePlan(
    PenFile penData,
    PencilParser parser, {
    String techStack = 'flutter',
    String? themeMode,
    String? frameName,
  }) {
    var frames = parser.listFrames(penData);
    if (frameName != null) {
      frames = frames.where((f) => f.name == frameName).toList();
      if (frames.isEmpty) {
        final available = parser.listFrames(penData).map((f) => f.name).join(', ');
        throw ArgumentError('Frame "$frameName" not found. Available: $available');
      }
    }
    final pages = <PagePlan>[];

    for (final frame in frames) {
      final designState = parser.parse(
        penData,
        PencilParseOptions(frameName: frame.name, themeMode: themeMode),
      );

      final nodeIds = parser.flattenNodeIds(designState.nodes);
      final tree = parser.describeNodeTree(designState.nodes);

      final agentPrompt = _promptBuilder.buildPrompt(
        frameName: frame.name,
        frameId: frame.id,
        width: frame.width,
        height: frame.height,
        designTree: tree,
        nodeMetadata: nodeIds,
        tokens: designState.tokens,
        techStack: techStack,
      );

      pages.add(PagePlan(
        name: frame.name,
        frameId: frame.id,
        width: frame.width,
        height: frame.height,
        nodeMetadata: nodeIds,
        agentPrompt: agentPrompt,
        designTree: tree,
      ),);
    }

    // Extract tokens once for the whole file
    final tokens = parser.parse(penData, PencilParseOptions(themeMode: themeMode)).tokens;

    final orchestrationPrompt = _buildOrchestrationPrompt(pages, techStack);

    return BuildPlan(
      pages: pages,
      orchestrationPrompt: orchestrationPrompt,
      tokens: tokens,
    );
  }

  String _buildOrchestrationPrompt(List<PagePlan> pages, String techStack) {
    final buf = StringBuffer();
    buf.writeln('# Build Orchestration');
    buf.writeln();
    buf.writeln('This design has ${pages.length} page${pages.length == 1 ? '' : 's'}. '
        'Build each page as a separate Flutter widget/screen.');
    buf.writeln();
    buf.writeln('## Pages');
    for (var i = 0; i < pages.length; i++) {
      buf.writeln('${i + 1}. **${pages[i].name}** (${pages[i].width}×${pages[i].height}) — '
          '${pages[i].nodeIds.length} nodes');
    }
    buf.writeln();
    buf.writeln('## Instructions');
    buf.writeln();
    buf.writeln("1. Add Key('nodeId') to every widget matching a design node");
    buf.writeln('2. Use the design tree structure to build the widget hierarchy');
    buf.writeln('3. Run `saccadic refine` after each build iteration');
    buf.writeln('4. Target: Grade A (95%+ match)');
    return buf.toString();
  }
}
