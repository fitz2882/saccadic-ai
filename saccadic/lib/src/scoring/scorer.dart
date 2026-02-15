/// Scoring module — 70% structural + 30% pixel, A-F grading.
///
/// Computes the overall match score with viewport-weighted severity penalties.
library;
import 'dart:math' as math;

import '../core/types.dart';
import '../flutter/widget_style.dart';

class Scorer {
  /// Compute overall match score and grade.
  OverallScore computeScore(
    WidgetDiffResult widgetDiff,
    PixelDiffResult pixelDiff,
    List<DiffRegion> regions,
    Viewport? viewport,
    List<WidgetStyle>? widgets,
  ) {
    final viewportArea = (viewport?.width ?? 1280) * (viewport?.height ?? 800);

    // DOM-equivalent match rate
    final total = widgetDiff.matches + widgetDiff.missing.length;
    final matchRate = total > 0 ? widgetDiff.matches / total : 1.0;

    // Pixel match rate
    final pixelMatchRate = 1 - (pixelDiff.diffPercentage / 100);

    // Viewport-weighted severity penalties
    final boundsMap = <String, Bounds>{};
    if (widgets != null) {
      for (final w in widgets) {
        boundsMap[w.identifier] = w.bounds;
      }
    }

    var weightedFailPenalty = 0.0;
    var weightedWarnPenalty = 0.0;

    // Unique elements with fails/warns
    final elementsWithFails = widgetDiff.mismatches
        .where((m) => m.severity == Severity.fail)
        .map((m) => m.widget)
        .toSet();
    final elementsWithWarns = widgetDiff.mismatches
        .where((m) => m.severity == Severity.warn)
        .map((m) => m.widget)
        .toSet();

    for (final el in elementsWithFails) {
      final bounds = boundsMap[el];
      final salience = bounds != null
          ? math.max(0.1, bounds.area / viewportArea)
          : 0.1;
      final multiplier = math.min(2.0, math.max(0.5, salience * 10));
      weightedFailPenalty += multiplier;
    }

    weightedFailPenalty += widgetDiff.missing.length;
    weightedFailPenalty += regions.where((r) => r.severity == Severity.fail).length;

    for (final el in elementsWithWarns) {
      final bounds = boundsMap[el];
      final salience = bounds != null
          ? math.max(0.1, bounds.area / viewportArea)
          : 0.1;
      final multiplier = math.min(2.0, math.max(0.5, salience * 10));
      weightedWarnPenalty += multiplier;
    }
    weightedWarnPenalty += regions.where((r) => r.severity == Severity.warn).length;

    // When pixel comparison didn't run, use widget-only score
    final matchPercentage = pixelDiff.pixelComparisonRan
        ? matchRate * 0.7 + pixelMatchRate * 0.3
        : matchRate;

    // Apply severity penalties
    final totalElements = math.max(1, widgetDiff.matches + widgetDiff.missing.length);
    final failFraction = weightedFailPenalty / totalElements;
    final warnFraction = weightedWarnPenalty / totalElements;
    final penalty = failFraction * 0.3 + warnFraction * 0.1;
    final adjusted = math.max(0.0, matchPercentage * (1 - penalty));

    final grade = _computeGrade(adjusted);

    return OverallScore(
      matchPercentage: adjusted,
      grade: grade,
      summary: '', // filled in by feedback generator
    );
  }

  String _computeGrade(double matchPercentage) {
    if (matchPercentage > 0.95) return 'A';
    if (matchPercentage > 0.85) return 'B';
    if (matchPercentage > 0.70) return 'C';
    if (matchPercentage > 0.50) return 'D';
    return 'F';
  }
}
