/// Output formatting — ANSI terminal and JSON.
library;
import 'dart:convert';

import '../core/types.dart';

class OutputFormatter {
  /// Format result as ANSI-colored terminal output.
  String toAnsi(ComparisonResult result) {
    final buf = StringBuffer();

    // Header
    final score = (result.overall.matchPercentage * 100).toStringAsFixed(1);
    final gradeColor = _gradeColor(result.overall.grade);
    buf.writeln('$gradeColor${result.overall.grade}\x1B[0m  $score%  ${result.overall.summary}');
    buf.writeln();

    // Stats line
    buf.writeln('  Widgets matched: ${result.widgetDiff.matches}  '
        'Missing: ${result.widgetDiff.missing.length}  '
        'Extra: ${result.widgetDiff.extra.length}  '
        'Mismatches: ${result.widgetDiff.mismatches.length}');

    if (result.pixelDiff.pixelComparisonRan) {
      buf.writeln('  Pixel diff: ${result.pixelDiff.diffPercentage.toStringAsFixed(2)}%  '
          'Regions: ${result.regions.length}');
    }
    buf.writeln();

    // Feedback items (top 20)
    final items = result.feedback.take(20).toList();
    if (items.isNotEmpty) {
      buf.writeln('Issues:');
      for (final item in items) {
        final icon = _severityIcon(item.severity);
        buf.writeln('  $icon ${item.message}');
        if (item.fix != null) {
          buf.writeln('    → ${item.fix}');
        }
      }
      if (result.feedback.length > 20) {
        buf.writeln('  ... and ${result.feedback.length - 20} more');
      }
    }

    return buf.toString();
  }

  /// Format result as JSON string.
  String toJson(ComparisonResult result, {Map<String, dynamic>? extra}) {
    final map = <String, dynamic>{
      'overall': {
        'matchPercentage': result.overall.matchPercentage,
        'grade': result.overall.grade,
        'summary': result.overall.summary,
      },
      'widgetDiff': {
        'matches': result.widgetDiff.matches,
        'mismatches': result.widgetDiff.mismatches
            .map((m) => {
                  'widget': m.widget,
                  'property': m.property,
                  'expected': m.expected,
                  'actual': m.actual,
                  'severity': m.severity.name,
                  'fix': m.fix,
                },)
            .toList(),
        'missing': result.widgetDiff.missing,
        'extra': result.widgetDiff.extra,
      },
      'pixelDiff': {
        'totalPixels': result.pixelDiff.totalPixels,
        'diffPixels': result.pixelDiff.diffPixels,
        'diffPercentage': result.pixelDiff.diffPercentage,
        'pixelComparisonRan': result.pixelDiff.pixelComparisonRan,
      },
      'regions': result.regions
          .map((r) => {
                'bounds': {
                  'x': r.bounds.x,
                  'y': r.bounds.y,
                  'width': r.bounds.width,
                  'height': r.bounds.height,
                },
                'severity': r.severity.name,
                'type': r.type.name,
                'description': r.description,
              },)
          .toList(),
      'feedback': result.feedback
          .map((f) => {
                'severity': f.severity.name,
                'category': f.category.name,
                'message': f.message,
                'element': f.element,
                'fix': f.fix,
              },)
          .toList(),
      'timestamp': result.timestamp,
    };

    if (extra != null) map.addAll(extra);

    return const JsonEncoder.withIndent('  ').convert(map);
  }

  String _gradeColor(String grade) {
    switch (grade) {
      case 'A':
        return '\x1B[32m'; // green
      case 'B':
        return '\x1B[33m'; // yellow
      case 'C':
        return '\x1B[33m'; // yellow
      case 'D':
        return '\x1B[31m'; // red
      case 'F':
        return '\x1B[31m'; // red
      default:
        return '';
    }
  }

  String _severityIcon(Severity severity) {
    switch (severity) {
      case Severity.fail:
        return '\x1B[31m✗\x1B[0m';
      case Severity.warn:
        return '\x1B[33m⚠\x1B[0m';
      case Severity.pass:
        return '\x1B[32m✓\x1B[0m';
    }
  }
}
