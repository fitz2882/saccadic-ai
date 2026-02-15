/// Comparison Engine — central orchestrator for visual comparison.
///
/// Pipeline:
/// 1. Load design state (from .pen or Figma)
/// 2. Connect to Flutter app via VM service
/// 3. Capture screenshot + extract widget tree
/// 4. Widget property comparison (5-pass matching)
/// 5. Pixel-level comparison
/// 6. Score + feedback generation
library;
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

import '../core/types.dart';
import '../design/design_source.dart';
import '../design/figma_parser.dart';
import '../design/pencil_parser.dart';
import '../design/pencil_types.dart';
import '../feedback/feedback_generator.dart';
import '../flutter/flutter_inspector.dart';
import '../scoring/scorer.dart';
import 'pixel_comparator.dart';
import 'widget_comparator.dart';

class CompareOptions {
  final DesignSourceParams designSource;
  final String flutterUrl; // ws://127.0.0.1:PORT/ws
  final Viewport? viewport;
  final double? threshold;
  final String? referenceImage; // file path or URL

  const CompareOptions({
    required this.designSource,
    required this.flutterUrl,
    this.viewport,
    this.threshold,
    this.referenceImage,
  });
}

class ComparisonEngine {
  final _pixelComparator = PixelComparator();
  final _widgetComparator = WidgetComparator();
  final _feedbackGenerator = FeedbackGenerator();
  final _scorer = Scorer();
  FlutterInspector? _inspector;

  /// Last inspection diagnostics (available after [compare] completes).
  InspectionDiagnostics? get lastDiagnostics => _inspector?.lastDiagnostics;

  /// Run the full comparison pipeline.
  Future<ComparisonResult> compare(CompareOptions options) async {
    final startTime = DateTime.now().millisecondsSinceEpoch;

    // 1. Load design state
    final designState = await _loadDesignState(options.designSource);

    // 2. Connect to Flutter app and inspect
    _inspector = FlutterInspector();
    await _inspector!.connect(options.flutterUrl);
    final inspection = await _inspector!.inspect();

    // 3. Widget comparison
    final widgetDiff = _widgetComparator.compare(
      inspection.widgets,
      designState.nodes,
    );

    // 4. Pixel comparison
    var pixelDiff = const PixelDiffResult(
      totalPixels: 0,
      diffPixels: 0,
      diffPercentage: 0,
      pixelComparisonRan: false,
    );
    var regions = <DiffRegion>[];

    Uint8List? referenceBuffer;
    if (options.referenceImage != null) {
      referenceBuffer = await _loadReferenceImage(options.referenceImage!);
    }

    if (referenceBuffer != null) {
      pixelDiff = _pixelComparator.compare(
        referenceBuffer,
        inspection.screenshot,
        PixelCompareOptions(
          threshold: ((options.threshold ?? 0.1) * 255).round(),
        ),
      );

      if (pixelDiff.diffImage != null && pixelDiff.diffPixels > 0) {
        final diffPng = img.decodePng(Uint8List.fromList(pixelDiff.diffImage!));
        if (diffPng != null) {
          regions = _pixelComparator.findDiffRegions(
            Uint8List.fromList(pixelDiff.diffImage!),
            diffPng.width,
            diffPng.height,
          );
        }
      }
    }

    // 5. Feedback generation
    final feedback = _feedbackGenerator.generate(
      widgetDiff,
      pixelDiff,
      regions,
      inspection.widgets,
    );

    // 6. Scoring
    final overall = _scorer.computeScore(
      widgetDiff,
      pixelDiff,
      regions,
      options.viewport ?? designState.viewport,
      inspection.widgets,
    );

    // Fill in summary
    final result = ComparisonResult(
      overall: OverallScore(
        matchPercentage: overall.matchPercentage,
        grade: overall.grade,
        summary: _feedbackGenerator.generateSummary(ComparisonResult(
          overall: overall,
          widgetDiff: widgetDiff,
          pixelDiff: pixelDiff,
          regions: regions,
          feedback: feedback,
          timestamp: startTime,
        ),),
      ),
      widgetDiff: widgetDiff,
      pixelDiff: pixelDiff,
      regions: regions,
      feedback: feedback,
      timestamp: startTime,
    );

    return result;
  }

  /// Disconnect from Flutter VM service.
  Future<void> close() async {
    await _inspector?.disconnect();
  }

  Future<DesignState> _loadDesignState(DesignSourceParams source) async {
    if (source.pencilFile != null) {
      final content = await File(source.pencilFile!).readAsString();
      final penData = PenFile.fromJson(
        jsonDecode(content) as Map<String, dynamic>,
      );
      return PencilParser().parse(
        penData,
        PencilParseOptions(
          frameName: source.pencilFrame,
          themeMode: source.pencilTheme,
        ),
      );
    } else if (source.figmaFileKey != null || source.figmaUrl != null) {
      return FigmaParser().load(source);
    }

    return DesignState(
      id: 'default',
      name: 'Default',
      viewport: const Viewport(width: 1280, height: 800),
      nodes: [],
    );
  }

  Future<Uint8List> _loadReferenceImage(String path) async {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse(path));
      final response = await request.close();
      final bytes = <int>[];
      await for (final chunk in response) {
        bytes.addAll(chunk);
      }
      client.close();
      return Uint8List.fromList(bytes);
    }
    return File(path).readAsBytes();
  }
}
