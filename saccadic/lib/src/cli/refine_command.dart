/// CLI refine command — iterative comparison until target score is reached.
library;
import 'dart:io';

import 'package:args/command_runner.dart';

import '../comparison/comparison_engine.dart';
import '../design/design_source.dart';
import 'output_formatter.dart';

class RefineCommand extends Command<void> {
  @override
  final name = 'refine';

  @override
  final description = 'Iteratively compare and provide feedback until target score is reached.';

  RefineCommand() {
    argParser
      ..addOption('pen', help: 'Path to .pen design file')
      ..addOption('frame', help: 'Frame name within the .pen file')
      ..addOption('theme', help: 'Theme mode for .pen file')
      ..addOption('figma-url', help: 'Figma file URL')
      ..addOption('figma-key', help: 'Figma file key')
      ..addOption('flutter-url', help: 'Flutter VM service WebSocket URL (ws://...)')
      ..addOption('reference', help: 'Reference screenshot file path')
      ..addOption('target-score',
          help: 'Target match percentage (0-100)', defaultsTo: '95',)
      ..addOption('target-grade',
          help: 'Target grade', allowed: ['A', 'B', 'C'], defaultsTo: 'A',)
      ..addOption('max-iterations',
          help: 'Maximum iterations', defaultsTo: '10',)
      ..addOption('iteration',
          help: 'Current iteration number', defaultsTo: '1',)
      ..addOption('format',
          help: 'Output format', allowed: ['text', 'json'], defaultsTo: 'text',);
  }

  @override
  Future<void> run() async {
    final flutterUrl = argResults?['flutter-url'] as String?;
    if (flutterUrl == null) {
      usageException('--flutter-url is required');
    }

    final pen = argResults?['pen'] as String?;
    final figmaUrl = argResults?['figma-url'] as String?;
    final figmaKey = argResults?['figma-key'] as String?;

    if (pen == null && figmaUrl == null && figmaKey == null) {
      usageException('Provide a design source: --pen, --figma-url, or --figma-key');
    }

    final targetScore = double.parse(argResults?['target-score'] as String? ?? '95') / 100;
    final maxIterations = int.parse(argResults?['max-iterations'] as String? ?? '10');
    final iteration = int.parse(argResults?['iteration'] as String? ?? '1');

    final engine = ComparisonEngine();
    final formatter = OutputFormatter();

    try {
      final result = await engine.compare(CompareOptions(
        designSource: DesignSourceParams(
          pencilFile: pen,
          pencilFrame: argResults?['frame'] as String?,
          pencilTheme: argResults?['theme'] as String?,
          figmaUrl: figmaUrl,
          figmaFileKey: figmaKey,
          referenceImage: argResults?['reference'] as String?,
        ),
        flutterUrl: flutterUrl,
        referenceImage: argResults?['reference'] as String?,
      ),);

      final score = result.overall.matchPercentage;
      final passed = score >= targetScore;

      // Build refine-specific output
      final status = passed ? 'pass' : (iteration >= maxIterations ? 'stalled' : 'iterate');

      stderr.writeln('Iteration $iteration/$maxIterations: '
          '${(score * 100).toStringAsFixed(1)}% '
          '(Grade ${result.overall.grade}) — $status');

      final format = argResults?['format'] as String? ?? 'text';
      if (format == 'json') {
        stdout.writeln(formatter.toJson(result, extra: {
          'status': status,
          'iteration': iteration,
          'maxIterations': maxIterations,
          'targetScore': targetScore,
        },),);
      } else {
        stdout.writeln(formatter.toAnsi(result));
        if (status == 'stalled') {
          stdout.writeln('\n⚠ Stalled after $maxIterations iterations. '
              'Consider reviewing the approach or adjusting the target.');
        }
      }

      exit(passed ? 0 : (status == 'stalled' ? 2 : 1));
    } finally {
      await engine.close();
    }
  }
}
