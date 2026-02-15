/// CLI compare command — one-shot comparison between design and Flutter build.
library;
import 'dart:io';

import 'package:args/command_runner.dart';

import '../comparison/comparison_engine.dart';
import '../design/design_source.dart';
import 'output_formatter.dart';

class CompareCommand extends Command<void> {
  @override
  final name = 'compare';

  @override
  final description = 'Compare a design file against a running Flutter app.';

  CompareCommand() {
    argParser
      ..addOption('pen', help: 'Path to .pen design file')
      ..addOption('frame', help: 'Frame name within the .pen file')
      ..addOption('theme', help: 'Theme mode for .pen file')
      ..addOption('figma-url', help: 'Figma file URL')
      ..addOption('figma-key', help: 'Figma file key')
      ..addOption('figma-node', help: 'Figma node ID')
      ..addOption('flutter-url', help: 'Flutter VM service WebSocket URL (ws://...)')
      ..addOption('reference', help: 'Reference screenshot file path or URL')
      ..addOption('threshold', help: 'Pixel diff threshold (0-1)', defaultsTo: '0.1')
      ..addOption('format',
          help: 'Output format', allowed: ['text', 'json'], defaultsTo: 'text',)
      ..addOption('diff-output', help: 'Save diff PNG to this path');
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

    final engine = ComparisonEngine();

    try {
      final result = await engine.compare(CompareOptions(
        designSource: DesignSourceParams(
          pencilFile: pen,
          pencilFrame: argResults?['frame'] as String?,
          pencilTheme: argResults?['theme'] as String?,
          figmaUrl: figmaUrl,
          figmaFileKey: figmaKey,
          figmaNodeId: argResults?['figma-node'] as String?,
          referenceImage: argResults?['reference'] as String?,
        ),
        flutterUrl: flutterUrl,
        threshold: double.tryParse(argResults?['threshold'] as String? ?? '0.1'),
        referenceImage: argResults?['reference'] as String?,
      ),);

      final format = argResults?['format'] as String? ?? 'text';
      final formatter = OutputFormatter();

      if (format == 'json') {
        stdout.writeln(formatter.toJson(result));
      } else {
        stdout.writeln(formatter.toAnsi(result));
      }

      // Save diff image if requested
      final diffOutput = argResults?['diff-output'] as String?;
      if (diffOutput != null && result.pixelDiff.diffImage != null) {
        await File(diffOutput).writeAsBytes(result.pixelDiff.diffImage!);
        stderr.writeln('Diff image saved to $diffOutput');
      }

      // Exit with non-zero if grade is below B
      if (result.overall.grade == 'D' || result.overall.grade == 'F') {
        exit(1);
      }
    } finally {
      await engine.close();
    }
  }
}
