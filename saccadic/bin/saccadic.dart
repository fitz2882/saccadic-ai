import 'dart:io';

import 'package:args/command_runner.dart';

import 'package:saccadic/src/cli/compare_command.dart';
import 'package:saccadic/src/cli/plan_command.dart';
import 'package:saccadic/src/cli/refine_command.dart';

void main(List<String> args) async {
  final runner = CommandRunner<void>(
    'saccadic',
    'Visual comparison tool for Flutter apps — '
        'compare .pen/Figma designs against running Flutter builds.',
  )
    ..addCommand(CompareCommand())
    ..addCommand(PlanCommand())
    ..addCommand(RefineCommand());

  try {
    await runner.run(args);
  } on UsageException catch (e) {
    stderr.writeln(e);
    exit(64);
  } catch (e, stack) {
    stderr.writeln('Error: $e');
    stderr.writeln(stack);
    exit(1);
  }
}
