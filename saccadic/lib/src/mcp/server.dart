/// Saccadic MCP Server — Model Context Protocol server for Flutter visual
/// comparison tools.
///
/// Provides 8 tools for the plan→build→refine loop:
///   plan_build, refine_build, compare_design_build, capture_screenshot,
///   load_design, get_design_tokens, compare_design_tokens, get_visual_diff
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:mcp_dart/mcp_dart.dart';

import '../comparison/comparison_engine.dart';
import '../comparison/pixel_comparator.dart';
import '../core/types.dart';
import '../design/design_source.dart';
import '../design/figma_parser.dart';
import '../design/pencil_parser.dart';
import '../design/pencil_types.dart';
import '../flutter/flutter_inspector.dart';
import '../plan/plan_generator.dart';
import 'session.dart';

class SaccadicMcpServer {
  final _sessions = <String, RefineSession>{};
  ComparisonEngine? _engine;
  FlutterInspector? _inspector;

  /// Create and start the MCP server over stdio.
  Future<void> start() async {
    final server = McpServer(
      Implementation(name: 'saccadic-ai', version: '0.1.0'),
      options: McpServerOptions(
        capabilities: ServerCapabilities(
          tools: ServerCapabilitiesTools(),
        ),
      ),
    );

    _registerTools(server);
    await server.connect(StdioServerTransport());
  }

  void _registerTools(McpServer server) {
    _registerPlanBuild(server);
    _registerRefineBuild(server);
    _registerCompareDesignBuild(server);
    _registerCaptureScreenshot(server);
    _registerLoadDesign(server);
    _registerGetDesignTokens(server);
    _registerCompareDesignTokens(server);
    _registerGetVisualDiff(server);
  }

  // ── plan_build ──

  void _registerPlanBuild(McpServer server) {
    server.registerTool(
      'plan_build',
      description:
          'Analyze a .pen/Figma design and generate a complete Flutter build '
          'plan with per-page agent prompts. Returns design structure, tokens, '
          'node IDs, and orchestration instructions for parallel sub-agents.',
      inputSchema: ToolInputSchema(
        properties: {
          'pencilFile': JsonSchema.string(
            description: 'Path to .pen design file',
          ),
          'pencilTheme': JsonSchema.string(
            description: 'Theme mode (e.g., "Light", "Dark")',
          ),
          'figmaUrl': JsonSchema.string(
            description: 'Figma file URL (alternative to pencilFile)',
          ),
          'figmaFileKey': JsonSchema.string(
            description: 'Figma file key',
          ),
          'techStack': JsonSchema.string(
            description: 'Tech stack (default: flutter)',
          ),
          'targetScore': JsonSchema.number(
            description: 'Target match score 0-1 (default: 0.95)',
          ),
          'maxIterationsPerPage': JsonSchema.number(
            description: 'Max refine iterations per page (default: 10)',
          ),
        },
      ),
      callback: (args, extra) async {
        final pencilFile = args['pencilFile'] as String?;
        final pencilTheme = args['pencilTheme'] as String?;
        final techStack = args['techStack'] as String? ?? 'flutter';
        final targetScore = (args['targetScore'] as num?)?.toDouble() ?? 0.95;
        final maxIterations =
            (args['maxIterationsPerPage'] as num?)?.toInt() ?? 10;
        final targetPct = (targetScore * 100).round();

        if (pencilFile != null) {
          return _planBuildFromPen(
            pencilFile: pencilFile,
            pencilTheme: pencilTheme,
            techStack: techStack,
            targetScore: targetScore,
            maxIterations: maxIterations,
            targetPct: targetPct,
          );
        }

        // Figma plan_build
        final figmaUrl = args['figmaUrl'] as String?;
        final figmaFileKey = args['figmaFileKey'] as String?;
        if (figmaUrl != null || figmaFileKey != null) {
          return _planBuildFromFigma(
            figmaUrl: figmaUrl,
            figmaFileKey: figmaFileKey,
            techStack: techStack,
            targetPct: targetPct,
          );
        }

        throw Exception('Must provide pencilFile, figmaUrl, or figmaFileKey');
      },
    );
  }

  Future<CallToolResult> _planBuildFromPen({
    required String pencilFile,
    required String? pencilTheme,
    required String techStack,
    required double targetScore,
    required int maxIterations,
    required int targetPct,
  }) async {
    final content = await File(pencilFile).readAsString();
    final penData =
        PenFile.fromJson(jsonDecode(content) as Map<String, dynamic>);
    final parser = PencilParser();
    final generator = PlanGenerator();

    final plan = generator.generatePlan(
      penData,
      parser,
      techStack: techStack,
      themeMode: pencilTheme,
    );

    final response = {
      'projectName': penData.version,
      'totalPages': plan.pages.length,
      'targetScore': '$targetPct%',
      'techStack': techStack,
      'pages': plan.pages
          .map((p) {
            final refineParams = {
              'designSource': {
                'pencilFile': pencilFile,
                'pencilFrame': p.name,
                if (pencilTheme != null) 'pencilTheme': pencilTheme,
              },
              'targetScore': targetScore,
              'maxIterations': maxIterations,
            };

            return {
              'frame': p.name,
              'frameId': p.frameId,
              'viewport': {'width': p.width, 'height': p.height},
              'nodeCount': p.nodeMetadata.length,
              'agentPrompt': p.agentPrompt,
              'refineParams': refineParams,
            };
          })
          .toList(),
      'orchestrationPrompt': plan.orchestrationPrompt,
      if (plan.tokens != null)
        'tokens': {
          'colors': plan.tokens!.colors,
          'spacing': plan.tokens!.spacing,
          'radii': plan.tokens!.radii,
        },
    };

    return _textResult(response);
  }

  Future<CallToolResult> _planBuildFromFigma({
    required String? figmaUrl,
    required String? figmaFileKey,
    required String techStack,
    required int targetPct,
  }) async {
    final parser = FigmaParser();
    final designState = await parser.load(DesignSourceParams(
      figmaUrl: figmaUrl,
      figmaFileKey: figmaFileKey,
    ),);

    final pencilParser = PencilParser();
    final nodeIds = pencilParser.flattenNodeIds(designState.nodes);

    final response = {
      'projectName': designState.name,
      'totalPages': 1,
      'targetScore': '$targetPct%',
      'techStack': techStack,
      'pages': [
        {
          'frame': designState.name,
          'frameId': designState.id,
          'viewport': {
            'width': designState.viewport.width,
            'height': designState.viewport.height,
          },
          'nodeCount': nodeIds.length,
        },
      ],
    };

    return _textResult(response);
  }

  // ── refine_build ──

  void _registerRefineBuild(McpServer server) {
    server.registerTool(
      'refine_build',
      description:
          'Iterative build refinement tool with multi-page orchestration. '
          'Compares a Flutter build against a design and returns detailed '
          "mismatches with actionable fixes. Call repeatedly until status='pass'. "
          'Tracks iteration history, detects stalls, and manages page progress. '
          'Target: 95% (Grade A).',
      inputSchema: ToolInputSchema(
        properties: {
          'designSource': JsonSchema.object(
            properties: {
              'pencilFile': JsonSchema.string(),
              'pencilFrame': JsonSchema.string(),
              'pencilTheme': JsonSchema.string(),
              'figmaUrl': JsonSchema.string(),
              'figmaFileKey': JsonSchema.string(),
              'figmaNodeId': JsonSchema.string(),
            },
            description: 'Design source parameters',
          ),
          'flutterUrl': JsonSchema.string(
            description:
                'WebSocket URL of the running Flutter app (ws://127.0.0.1:PORT/ws)',
          ),
          'referenceImage': JsonSchema.string(
            description:
                'Design screenshot as file path or base64. '
                'Use Pencil MCP get_screenshot for .pen designs.',
          ),
          'targetScore': JsonSchema.number(
            description: 'Target match score 0-1 (default: 0.95)',
          ),
          'targetGrade': JsonSchema.string(
            description: 'Target grade: A, B, or C (default: A)',
          ),
          'viewport': JsonSchema.string(
            description:
                'Viewport preset or custom JSON (e.g., "mobile", "desktop")',
          ),
          'iteration': JsonSchema.number(
            description: 'Current iteration number (start at 1)',
          ),
          'maxIterations': JsonSchema.number(
            description: 'Maximum iterations before stop (default: 10)',
          ),
        },
        required: ['designSource', 'flutterUrl'],
      ),
      callback: (args, extra) async {
        final designSourceMap = args['designSource'] as Map<String, dynamic>;
        final flutterUrl = args['flutterUrl'] as String;
        final referenceImage = args['referenceImage'] as String?;
        final targetScoreArg = (args['targetScore'] as num?)?.toDouble();
        final targetGrade = args['targetGrade'] as String? ?? 'A';
        final iteration = (args['iteration'] as num?)?.toInt() ?? 1;
        final maxIterations = (args['maxIterations'] as num?)?.toInt() ?? 10;

        final gradeThresholds = {'A': 0.95, 'B': 0.85, 'C': 0.7};
        final targetScore =
            targetScoreArg ?? gradeThresholds[targetGrade] ?? 0.95;

        final designSource = DesignSourceParams(
          pencilFile: designSourceMap['pencilFile'] as String?,
          pencilFrame: designSourceMap['pencilFrame'] as String?,
          pencilTheme: designSourceMap['pencilTheme'] as String?,
          figmaUrl: designSourceMap['figmaUrl'] as String?,
          figmaFileKey: designSourceMap['figmaFileKey'] as String?,
          figmaNodeId: designSourceMap['figmaNodeId'] as String?,
          referenceImage: referenceImage,
        );

        // Session management
        RefineSession? session;
        final pencilFile = designSource.pencilFile;
        final currentFrame = designSource.pencilFrame;

        if (pencilFile != null) {
          session = await _getOrCreateSession(pencilFile);
          if (currentFrame != null) {
            session.switchFrame(currentFrame);
          }
        }

        // Run comparison
        _engine ??= ComparisonEngine();
        final result = await _engine!.compare(CompareOptions(
          designSource: designSource,
          flutterUrl: flutterUrl,
          viewport: _resolveViewport(args['viewport']),
          threshold: targetScore,
          referenceImage: referenceImage,
        ),);

        final matchPercentage = result.overall.matchPercentage;
        final matchPct = (matchPercentage * 100).round();
        final currentGrade = result.overall.grade;

        final fails = result.feedback
            .where((f) => f.severity == Severity.fail)
            .toList();
        final warns = result.feedback
            .where((f) => f.severity == Severity.warn)
            .toList();

        // Track in session
        if (session != null) {
          session.recordIteration(
            iteration: iteration,
            score: matchPercentage,
            grade: currentGrade,
            failCount: fails.length,
            warnCount: warns.length,
          );

          // Incremental change tracking
          final currentHashes = <String, String>{};
          for (final f in result.feedback) {
            if (f.element != null) {
              final existing = currentHashes[f.element!] ?? '';
              currentHashes[f.element!] =
                  '$existing|${f.severity.name}:${f.category.name}';
            }
          }
          session.updateSnapshot(currentHashes);
        }

        // Stall detection
        final stalled = session?.isStalled ?? false;

        // Determine status
        final meetsTarget = matchPercentage >= targetScore;
        final hitMaxIterations = iteration >= maxIterations;

        String status;
        if (meetsTarget) {
          status = 'pass';
        } else if (hitMaxIterations) {
          status = 'max_iterations';
        } else {
          status = 'iterate';
        }

        // Find next page
        String? nextFrame;
        if (session != null && status == 'pass') {
          nextFrame = session.markPassedAndGetNext();
        }

        // Build prioritized fixes
        final prioritizedFixes = _buildPrioritizedFixes(fails, warns);

        // Score breakdown
        final domTotal = result.widgetDiff.matches +
            result.widgetDiff.missing.length;
        final domMatchRate =
            domTotal > 0 ? result.widgetDiff.matches / domTotal : 1.0;

        final scoreBreakdown = {
          'widgetMatchRate': domMatchRate,
          'pixelDiffPercentage': result.pixelDiff.diffPercentage,
          'pixelComparisonRan': result.pixelDiff.pixelComparisonRan,
          'failCount': fails.length,
          'warnCount': warns.length,
          'widgetMatches': result.widgetDiff.matches,
          'missingCount': result.widgetDiff.missing.length,
          'extraCount': result.widgetDiff.extra.length,
          'matchPercentage': matchPercentage,
        };

        // Mismatches for the agent
        final mismatches = result.feedback
            .where(
                (f) => f.severity == Severity.fail || f.severity == Severity.warn,)
            .map((f) {
              return {
                'element': f.element,
                'category': f.category.name,
                'severity': f.severity.name,
                'message': f.message,
                'fix': f.fix,
              };
            })
            .toList();

        // Issue breakdown by category
        final issueBreakdown = <String, int>{};
        for (final f in result.feedback) {
          issueBreakdown[f.category.name] =
              (issueBreakdown[f.category.name] ?? 0) + 1;
        }

        // Stall strategy
        String stallStrategy = '';
        if (stalled && session != null) {
          final remainingCategories = <String, int>{};
          for (final f in [...fails, ...warns]) {
            remainingCategories[f.category.name] =
                (remainingCategories[f.category.name] ?? 0) + 1;
          }
          stallStrategy = session.generateStallStrategy(
            matchPercentage: matchPercentage,
            remainingCategories: remainingCategories,
            totalRemaining: fails.length + warns.length,
          );
        }

        // Build message
        String message;
        String recommendation;
        if (status == 'pass') {
          message =
              'Page "${currentFrame ?? "default"}" passed! '
              'Score: $matchPct% (Grade $currentGrade).';
          recommendation = nextFrame != null
              ? 'Move to next page: set pencilFrame="$nextFrame" '
                  'and call refine_build with iteration=1.'
              : 'All pages complete!';
        } else if (status == 'max_iterations') {
          message =
              'Reached max $maxIterations iterations. Best score: $matchPct% '
              '(Grade $currentGrade). Target was ${(targetScore * 100).round()}%.';
          recommendation = stallStrategy.isNotEmpty
              ? stallStrategy
              : 'Review remaining mismatches below and apply fixes manually.';
        } else {
          message =
              'Iteration $iteration: $matchPct% (Grade $currentGrade), '
              'target ${(targetScore * 100).round()}%. Apply fixes below and '
              'call refine_build again with iteration=${iteration + 1}.';
          recommendation = stalled
              ? stallStrategy
              : 'Apply the fixes below, then call refine_build again.';
        }

        // Pencil reference image hint
        if (pencilFile != null && referenceImage == null) {
          recommendation +=
              ' Tip: For more accurate pixel comparison, provide a '
              'referenceImage captured via Pencil MCP get_screenshot.';
        }

        final response = <String, dynamic>{
          'status': status,
          'iteration': iteration,
          'score': '$matchPct%',
          'grade': currentGrade,
          'targetScore': '${(targetScore * 100).round()}%',
          'stalled': stalled,
          'message': message,
          'recommendation': recommendation,
          'scoreBreakdown': scoreBreakdown,
          'mismatches': mismatches,
          'missing': result.widgetDiff.missing,
          'extra': result.widgetDiff.extra,
          'topFixes': prioritizedFixes,
          'issueBreakdown': issueBreakdown,
        };

        // Add diagnostics when widget extraction fails or returns 0
        final diag = _engine!.lastDiagnostics;
        if (diag != null && diag.widgetsExtracted == 0) {
          response['diagnostics'] = diag.toJson();
        }

        // Key audit
        if (result.widgetDiff.keyCoverage != null) {
          final coverage = result.widgetDiff.keyCoverage!;
          final keyAudit = <String, dynamic>{
            'coverage': coverage.toJson(),
          };

          // When coverage is 0%, include the full node metadata table
          // so the agent has the definitive mapping to add Keys from
          if (coverage.foundKeys == 0 && coverage.expectedKeys > 0) {
            final nodeMetadata = await _loadDesignNodeMetadata(designSource);
            if (nodeMetadata != null) {
              keyAudit['requiredKeys'] = nodeMetadata;
              keyAudit['instruction'] =
                  'CRITICAL: 0% Key coverage. None of your ${coverage.widgetCount} '
                  "widgets have Key('nodeId') attributes. Add the Keys listed in "
                  "'requiredKeys' to the corresponding widgets. Without Keys, "
                  'the comparison cannot match widgets to design nodes.';
            }
          }

          final suggestions = result.widgetDiff.keySuggestions;
          if (suggestions != null && suggestions.isNotEmpty) {
            // Only include high-confidence suggestions (>= 0.6)
            final goodSuggestions = suggestions
                .where((s) => s.confidence >= 0.6)
                .take(15)
                .map((s) => s.toJson())
                .toList();
            if (goodSuggestions.isNotEmpty) {
              keyAudit['suggestions'] = goodSuggestions;
            }
          }
          response['keyAudit'] = keyAudit;
        }

        // Page progress
        if (session != null) {
          response['pageProgress'] =
              session.pages.map((p) => p.toJson()).toList();
          if (nextFrame != null) {
            response['nextPage'] = {'frame': nextFrame};
          }
          if (session.history.isNotEmpty) {
            response['iterationHistory'] =
                session.history.map((h) => h.toJson()).toList();
          }
          if (session.changedElements != null &&
              session.changedElements!.isNotEmpty &&
              iteration > 1) {
            response['changedSinceLastIteration'] =
                session.changedElements!.toList();
          }
          if (stalled && stallStrategy.isNotEmpty) {
            response['stallStrategy'] = stallStrategy;
          }
        }

        return _textResult(response);
      },
    );
  }

  // ── compare_design_build ──

  void _registerCompareDesignBuild(McpServer server) {
    server.registerTool(
      'compare_design_build',
      description:
          'Run full comparison pipeline between a design and a running Flutter '
          "build. Add Key('nodeId') to widgets for accurate matching. "
          'Provide a referenceImage for pixel comparison.',
      inputSchema: ToolInputSchema(
        properties: {
          'designSource': JsonSchema.object(
            properties: {
              'pencilFile': JsonSchema.string(),
              'pencilFrame': JsonSchema.string(),
              'pencilTheme': JsonSchema.string(),
              'figmaUrl': JsonSchema.string(),
              'figmaFileKey': JsonSchema.string(),
              'figmaNodeId': JsonSchema.string(),
            },
            description: 'Design source parameters',
          ),
          'flutterUrl': JsonSchema.string(
            description:
                'WebSocket URL of the running Flutter app (ws://127.0.0.1:PORT/ws)',
          ),
          'viewport': JsonSchema.string(
            description: 'Viewport preset name',
          ),
          'threshold': JsonSchema.number(
            description: 'Match threshold 0-1 (default: 0.95)',
          ),
          'referenceImage': JsonSchema.string(
            description: 'Design screenshot as file path or base64',
          ),
        },
        required: ['designSource', 'flutterUrl'],
      ),
      callback: (args, extra) async {
        final designSourceMap = args['designSource'] as Map<String, dynamic>;
        final flutterUrl = args['flutterUrl'] as String;
        final referenceImage = args['referenceImage'] as String?;
        final threshold = (args['threshold'] as num?)?.toDouble();

        final designSource = DesignSourceParams(
          pencilFile: designSourceMap['pencilFile'] as String?,
          pencilFrame: designSourceMap['pencilFrame'] as String?,
          pencilTheme: designSourceMap['pencilTheme'] as String?,
          figmaUrl: designSourceMap['figmaUrl'] as String?,
          figmaFileKey: designSourceMap['figmaFileKey'] as String?,
          figmaNodeId: designSourceMap['figmaNodeId'] as String?,
          referenceImage: referenceImage,
        );

        _engine ??= ComparisonEngine();
        final result = await _engine!.compare(CompareOptions(
          designSource: designSource,
          flutterUrl: flutterUrl,
          viewport: _resolveViewport(args['viewport']),
          threshold: threshold,
          referenceImage: referenceImage,
        ),);

        final response = {
          'overall': {
            'matchPercentage': result.overall.matchPercentage,
            'grade': result.overall.grade,
            'summary': result.overall.summary,
          },
          'widgetDiff': {
            'matches': result.widgetDiff.matches,
            'mismatchCount': result.widgetDiff.mismatches.length,
            'missingCount': result.widgetDiff.missing.length,
            'extraCount': result.widgetDiff.extra.length,
          },
          'pixelDiff': {
            'totalPixels': result.pixelDiff.totalPixels,
            'diffPixels': result.pixelDiff.diffPixels,
            'diffPercentage': result.pixelDiff.diffPercentage,
            'pixelComparisonRan': result.pixelDiff.pixelComparisonRan,
          },
          'regionCount': result.regions.length,
          'feedback': result.feedback
              .map((f) {
                return {
                  'severity': f.severity.name,
                  'category': f.category.name,
                  'message': f.message,
                  'element': f.element,
                  'fix': f.fix,
                };
              })
              .toList(),
          'timestamp': result.timestamp,
        };

        // Add diagnostics when widget extraction fails or returns 0
        final diag = _engine!.lastDiagnostics;
        if (diag != null && diag.widgetsExtracted == 0) {
          response['diagnostics'] = diag.toJson();
        }

        // Key audit
        if (result.widgetDiff.keyCoverage != null) {
          final coverage = result.widgetDiff.keyCoverage!;
          final keyAudit = <String, dynamic>{
            'coverage': coverage.toJson(),
          };

          if (coverage.foundKeys == 0 && coverage.expectedKeys > 0) {
            final nodeMetadata = await _loadDesignNodeMetadata(designSource);
            if (nodeMetadata != null) {
              keyAudit['requiredKeys'] = nodeMetadata;
              keyAudit['instruction'] =
                  'CRITICAL: 0% Key coverage. None of your ${coverage.widgetCount} '
                  "widgets have Key('nodeId') attributes. Add the Keys listed in "
                  "'requiredKeys' to the corresponding widgets. Without Keys, "
                  'the comparison cannot match widgets to design nodes.';
            }
          }

          final suggestions = result.widgetDiff.keySuggestions;
          if (suggestions != null && suggestions.isNotEmpty) {
            final goodSuggestions = suggestions
                .where((s) => s.confidence >= 0.6)
                .take(15)
                .map((s) => s.toJson())
                .toList();
            if (goodSuggestions.isNotEmpty) {
              keyAudit['suggestions'] = goodSuggestions;
            }
          }
          response['keyAudit'] = keyAudit;
        }

        return _textResult(response);
      },
    );
  }

  // ── capture_screenshot ──

  void _registerCaptureScreenshot(McpServer server) {
    server.registerTool(
      'capture_screenshot',
      description:
          'Capture a screenshot of a running Flutter app via VM service. '
          'Returns the screenshot as a base64 PNG image.',
      inputSchema: ToolInputSchema(
        properties: {
          'flutterUrl': JsonSchema.string(
            description:
                'WebSocket URL of the running Flutter app (ws://127.0.0.1:PORT/ws)',
          ),
          'outputPath': JsonSchema.string(
            description: 'File path to save the screenshot PNG',
          ),
        },
        required: ['flutterUrl'],
      ),
      callback: (args, extra) async {
        final flutterUrl = args['flutterUrl'] as String;
        final outputPath = args['outputPath'] as String?;

        _inspector ??= FlutterInspector();
        await _inspector!.connect(flutterUrl);
        final screenshot = await _inspector!.captureScreenshot();

        if (outputPath != null) {
          await File(outputPath).writeAsBytes(screenshot);
        }

        final base64Image = base64Encode(screenshot);

        return CallToolResult(
          content: [
            TextContent(
              text: jsonEncode({
                'flutterUrl': flutterUrl,
                'timestamp': DateTime.now().millisecondsSinceEpoch,
                if (outputPath != null) 'filePath': outputPath,
              }),
            ),
            ImageContent(data: base64Image, mimeType: 'image/png'),
          ],
        );
      },
    );
  }

  // ── load_design ──

  void _registerLoadDesign(McpServer server) {
    server.registerTool(
      'load_design',
      description:
          'Parse a .pen or Figma design file into structured design state. '
          "Returns node IDs — add Key('nodeId') to widgets for comparison.",
      inputSchema: ToolInputSchema(
        properties: {
          'pencilFile': JsonSchema.string(
            description: 'Path to .pen design file',
          ),
          'pencilFrame': JsonSchema.string(
            description: 'Frame name/id to extract',
          ),
          'pencilTheme': JsonSchema.string(
            description: 'Theme mode (e.g., "Light", "Dark")',
          ),
          'figmaUrl': JsonSchema.string(
            description: 'Full Figma file URL',
          ),
          'figmaFileKey': JsonSchema.string(
            description: 'Figma file key',
          ),
          'figmaNodeId': JsonSchema.string(
            description: 'Specific Figma node ID',
          ),
        },
      ),
      callback: (args, extra) async {
        DesignState design;

        final pencilFile = args['pencilFile'] as String?;
        final figmaUrl = args['figmaUrl'] as String?;
        final figmaFileKey = args['figmaFileKey'] as String?;

        if (pencilFile != null) {
          final content = await File(pencilFile).readAsString();
          final penData =
              PenFile.fromJson(jsonDecode(content) as Map<String, dynamic>);
          design = PencilParser().parse(
            penData,
            PencilParseOptions(
              frameName: args['pencilFrame'] as String?,
              themeMode: args['pencilTheme'] as String?,
            ),
          );
        } else if (figmaUrl != null || figmaFileKey != null) {
          design = await FigmaParser().load(DesignSourceParams(
            figmaUrl: figmaUrl,
            figmaFileKey: figmaFileKey,
            figmaNodeId: args['figmaNodeId'] as String?,
          ),);
        } else {
          throw Exception(
              'Must provide pencilFile, figmaUrl, or figmaFileKey',);
        }

        final nodeIds = PencilParser().flattenNodeIds(design.nodes);

        return _textResult({
          'id': design.id,
          'name': design.name,
          'viewport': {
            'width': design.viewport.width,
            'height': design.viewport.height,
          },
          'nodeCount': design.nodes.length,
          'hasTokens': design.tokens != null,
          'nodeIds': nodeIds.map((n) => n.id).toList(),
          'instructions':
              "Add Key('nodeId') to each corresponding Flutter widget "
              'for accurate comparison. For example: '
              "Container(key: Key('heroSection'), ...).",
        });
      },
    );
  }

  // ── get_design_tokens ──

  void _registerGetDesignTokens(McpServer server) {
    server.registerTool(
      'get_design_tokens',
      description:
          'Extract structured design tokens from a .pen or Figma file.',
      inputSchema: ToolInputSchema(
        properties: {
          'pencilFile': JsonSchema.string(
            description: 'Path to .pen design file',
          ),
          'pencilTheme': JsonSchema.string(
            description: 'Theme mode (e.g., "Light", "Dark")',
          ),
          'figmaUrl': JsonSchema.string(
            description: 'Full Figma file URL',
          ),
          'figmaFileKey': JsonSchema.string(
            description: 'Figma file key',
          ),
        },
      ),
      callback: (args, extra) async {
        final pencilFile = args['pencilFile'] as String?;

        if (pencilFile != null) {
          final content = await File(pencilFile).readAsString();
          final penData =
              PenFile.fromJson(jsonDecode(content) as Map<String, dynamic>);
          final design = PencilParser().parse(
            penData,
            PencilParseOptions(
              themeMode: args['pencilTheme'] as String?,
            ),
          );
          final tokens = design.tokens ??
              const DesignTokens();

          return _textResult({
            'colors': tokens.colors,
            'spacing': tokens.spacing,
            'typography': tokens.typography.map(
                (k, v) => MapEntry(k, '${v.fontFamily} ${v.fontSize}'),),
            'radii': tokens.radii,
          });
        }

        final figmaUrl = args['figmaUrl'] as String?;
        final figmaFileKey = args['figmaFileKey'] as String?;
        if (figmaUrl != null || figmaFileKey != null) {
          final design = await FigmaParser().load(DesignSourceParams(
            figmaUrl: figmaUrl,
            figmaFileKey: figmaFileKey,
          ),);
          final tokens = design.tokens ?? const DesignTokens();
          return _textResult({
            'colors': tokens.colors,
            'spacing': tokens.spacing,
            'radii': tokens.radii,
          });
        }

        throw Exception(
            'Must provide pencilFile, figmaUrl, or figmaFileKey',);
      },
    );
  }

  // ── compare_design_tokens ──

  void _registerCompareDesignTokens(McpServer server) {
    server.registerTool(
      'compare_design_tokens',
      description:
          'Compare two sets of design tokens and report additions, '
          'removals, and changes.',
      inputSchema: ToolInputSchema(
        properties: {
          'oldTokens': JsonSchema.string(
            description: 'Old tokens as JSON string or file path',
          ),
          'newTokens': JsonSchema.string(
            description: 'New tokens as JSON string or file path',
          ),
        },
        required: ['oldTokens', 'newTokens'],
      ),
      callback: (args, extra) async {
        final oldTokens = await _loadTokensJson(args['oldTokens'] as String);
        final newTokens = await _loadTokensJson(args['newTokens'] as String);

        final diff = _diffTokenMaps(oldTokens, newTokens);
        return _textResult(diff);
      },
    );
  }

  // ── get_visual_diff ──

  void _registerGetVisualDiff(McpServer server) {
    server.registerTool(
      'get_visual_diff',
      description: 'Generate pixel-level visual diff between two images.',
      inputSchema: ToolInputSchema(
        properties: {
          'designImage': JsonSchema.string(
            description: 'Design image as file path or base64',
          ),
          'buildImage': JsonSchema.string(
            description: 'Build image as file path or base64',
          ),
        },
        required: ['designImage', 'buildImage'],
      ),
      callback: (args, extra) async {
        final designImage = await _loadImage(args['designImage'] as String);
        final buildImage = await _loadImage(args['buildImage'] as String);

        final comparator = PixelComparator();
        final result = comparator.compare(designImage, buildImage);

        final content = <Content>[
          TextContent(
            text: jsonEncode({
              'totalPixels': result.totalPixels,
              'diffPixels': result.diffPixels,
              'diffPercentage': result.diffPercentage,
            }),
          ),
        ];

        if (result.diffImage != null) {
          content.add(ImageContent(
            data: base64Encode(Uint8List.fromList(result.diffImage!)),
            mimeType: 'image/png',
          ),);
        }

        return CallToolResult(content: content);
      },
    );
  }

  // ── Helpers ──

  /// Load design node metadata for the keyAudit requiredKeys field.
  Future<List<Map<String, dynamic>>?> _loadDesignNodeMetadata(
    DesignSourceParams designSource,
  ) async {
    try {
      if (designSource.pencilFile != null) {
        final content = await File(designSource.pencilFile!).readAsString();
        final penData =
            PenFile.fromJson(jsonDecode(content) as Map<String, dynamic>);
        final parser = PencilParser();
        final design = parser.parse(
          penData,
          PencilParseOptions(
            frameName: designSource.pencilFrame,
            themeMode: designSource.pencilTheme,
          ),
        );
        return parser.flattenNodeIds(design.nodes).map((n) {
          return {
            'id': n.id,
            'name': n.name,
            'type': n.type,
            if (n.textContent != null) 'textContent': n.textContent,
            'key': "Key('${n.id}')",
          };
        }).toList();
      }
      if (designSource.figmaUrl != null ||
          designSource.figmaFileKey != null) {
        final design = await FigmaParser().load(designSource);
        return PencilParser().flattenNodeIds(design.nodes).map((n) {
          return {
            'id': n.id,
            'name': n.name,
            'type': n.type,
            if (n.textContent != null) 'textContent': n.textContent,
            'key': "Key('${n.id}')",
          };
        }).toList();
      }
    } catch (_) {
      // Non-fatal — keyAudit still works without requiredKeys
    }
    return null;
  }

  Future<RefineSession> _getOrCreateSession(String pencilFile) async {
    final existing = _sessions[pencilFile];
    if (existing != null) return existing;

    final content = await File(pencilFile).readAsString();
    final penData =
        PenFile.fromJson(jsonDecode(content) as Map<String, dynamic>);
    final parser = PencilParser();
    final frames = parser.listFrames(penData);

    final session = RefineSession(
      pencilFile: pencilFile,
      pages: frames
          .map((f) => RefinePageStatus(name: f.name))
          .toList(),
    );

    _sessions[pencilFile] = session;
    return session;
  }

  Viewport? _resolveViewport(dynamic viewport) {
    if (viewport == null) return null;
    if (viewport is String) {
      return standardViewports[viewport];
    }
    if (viewport is Map) {
      return Viewport(
        width: (viewport['width'] as num).toInt(),
        height: (viewport['height'] as num).toInt(),
      );
    }
    return null;
  }

  Future<Uint8List> _loadImage(String imageData) async {
    if (imageData.startsWith('data:image')) {
      final base64Data = imageData.split(',')[1];
      return base64Decode(base64Data);
    }
    // File path
    if (imageData.startsWith('/') || imageData.contains(':\\')) {
      return File(imageData).readAsBytes();
    }
    // Raw base64
    return base64Decode(imageData);
  }

  Future<Map<String, dynamic>> _loadTokensJson(String input) async {
    try {
      return jsonDecode(input) as Map<String, dynamic>;
    } catch (_) {
      final content = await File(input).readAsString();
      return jsonDecode(content) as Map<String, dynamic>;
    }
  }

  Map<String, dynamic> _diffTokenMaps(
    Map<String, dynamic> oldTokens,
    Map<String, dynamic> newTokens,
  ) {
    final added = <String, dynamic>{};
    final removed = <String, dynamic>{};
    final changed = <String, dynamic>{};

    // Compare all top-level token categories
    final allKeys = {...oldTokens.keys, ...newTokens.keys};
    for (final key in allKeys) {
      final oldVal = oldTokens[key];
      final newVal = newTokens[key];

      if (oldVal == null && newVal != null) {
        added[key] = newVal;
      } else if (oldVal != null && newVal == null) {
        removed[key] = oldVal;
      } else if (oldVal is Map && newVal is Map) {
        // Deep compare maps
        final catAdded = <String, dynamic>{};
        final catRemoved = <String, dynamic>{};
        final catChanged = <String, dynamic>{};

        final catKeys = {...oldVal.keys, ...newVal.keys};
        for (final ck in catKeys) {
          if (!oldVal.containsKey(ck)) {
            catAdded[ck] = newVal[ck];
          } else if (!newVal.containsKey(ck)) {
            catRemoved[ck] = oldVal[ck];
          } else if (oldVal[ck].toString() != newVal[ck].toString()) {
            catChanged[ck] = {
              'old': oldVal[ck],
              'new': newVal[ck],
            };
          }
        }

        if (catAdded.isNotEmpty ||
            catRemoved.isNotEmpty ||
            catChanged.isNotEmpty) {
          changed[key] = {
            if (catAdded.isNotEmpty) 'added': catAdded,
            if (catRemoved.isNotEmpty) 'removed': catRemoved,
            if (catChanged.isNotEmpty) 'changed': catChanged,
          };
        }
      }
    }

    return {
      'added': added,
      'removed': removed,
      'changed': changed,
      'hasBreakingChanges': removed.isNotEmpty ||
          changed.values.any((v) =>
              v is Map && (v['removed'] as Map?)?.isNotEmpty == true,),
    };
  }

  List<Map<String, dynamic>> _buildPrioritizedFixes(
    List<FeedbackItem> fails,
    List<FeedbackItem> warns,
  ) {
    final prioritizedFixes = <Map<String, dynamic>>[];
    var priority = 1;

    // Missing fixes first (highest priority)
    final missingFixes =
        fails.where((f) => f.category == FeedbackCategory.missing).toList();
    final nonMissingFails =
        fails.where((f) => f.category != FeedbackCategory.missing &&
            f.category != FeedbackCategory.extra,).toList();

    for (final f in missingFixes.take(3)) {
      final elementName =
          f.element ?? f.message.replaceFirst('Missing widget: ', '');
      final subsumed = nonMissingFails
          .where((child) =>
              child.element != null && child.element!.contains(elementName),)
          .map((child) => child.element!)
          .toList();

      prioritizedFixes.add({
        'priority': priority++,
        'element': f.element,
        'issue': f.message,
        'fix': subsumed.isNotEmpty
            ? '${f.fix ?? f.message}. Adding this widget may also resolve '
                '${subsumed.length} child mismatch(es).'
            : f.fix,
        if (subsumed.isNotEmpty) 'subsumes': subsumed,
      });
    }

    // Visual fixes (skip subsumed)
    final subsumedElements =
        prioritizedFixes.expand((f) => (f['subsumes'] as List?) ?? []).toSet();

    final visualFixes = nonMissingFails
        .where((f) => f.element == null || !subsumedElements.contains(f.element))
        .toList();

    for (final f in visualFixes.take(5)) {
      prioritizedFixes.add({
        'priority': priority++,
        'element': f.element,
        'issue': f.message,
        'fix': f.fix,
      });
    }

    final remainingSlots = (10 - prioritizedFixes.length).clamp(0, 10);
    for (final f in warns.take(remainingSlots)) {
      if (f.element == null || !subsumedElements.contains(f.element)) {
        prioritizedFixes.add({
          'priority': priority++,
          'element': f.element,
          'issue': f.message,
          'fix': f.fix,
        });
      }
    }

    return prioritizedFixes;
  }

  CallToolResult _textResult(Map<String, dynamic> data) {
    return CallToolResult(
      content: [
        TextContent(text: const JsonEncoder.withIndent('  ').convert(data)),
      ],
    );
  }

  Future<void> close() async {
    await _engine?.close();
    await _inspector?.disconnect();
  }
}
