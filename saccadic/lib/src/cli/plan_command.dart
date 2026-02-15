/// CLI plan command — generate per-page build plans from a .pen/Figma design.
library;
import 'dart:convert';
import 'dart:io';

import 'package:args/command_runner.dart';

import '../design/pencil_parser.dart';
import '../design/pencil_types.dart';
import '../plan/plan_generator.dart';

class PlanCommand extends Command<void> {
  @override
  final name = 'plan';

  @override
  final description = 'Generate per-page build plans from a design file.';

  PlanCommand() {
    argParser
      ..addOption('pen', help: 'Path to .pen design file')
      ..addOption('frame', help: 'Specific frame/page name to plan (omit for all)')
      ..addOption('theme', help: 'Theme mode for .pen file')
      ..addOption('tech-stack',
          help: 'Target tech stack', defaultsTo: 'flutter',)
      ..addOption('format',
          help: 'Output format', allowed: ['text', 'json'], defaultsTo: 'text',);
  }

  @override
  Future<void> run() async {
    final pen = argResults?['pen'] as String?;
    if (pen == null) {
      usageException('--pen is required');
    }

    final content = await File(pen).readAsString();
    final penData = PenFile.fromJson(
      jsonDecode(content) as Map<String, dynamic>,
    );

    final parser = PencilParser();
    final generator = PlanGenerator();

    final plan = generator.generatePlan(
      penData,
      parser,
      techStack: argResults?['tech-stack'] as String? ?? 'flutter',
      themeMode: argResults?['theme'] as String?,
      frameName: argResults?['frame'] as String?,
    );

    final format = argResults?['format'] as String? ?? 'text';
    if (format == 'json') {
      stdout.writeln(jsonEncode(plan.toJson()));
    } else {
      stdout.writeln(plan.toText());
    }
  }
}
