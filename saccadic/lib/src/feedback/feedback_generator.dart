/// Feedback Generator — transforms comparison results into actionable items.
library;
import '../core/types.dart';
import '../flutter/widget_style.dart';
import 'cascade_suppression.dart';

class FeedbackGenerator {
  final _cascadeSuppression = CascadeSuppression();

  /// Generate prioritized feedback items from comparison results.
  List<FeedbackItem> generate(
    WidgetDiffResult widgetDiff,
    PixelDiffResult pixelDiff,
    List<DiffRegion> regions,
    List<WidgetStyle>? widgets,
  ) {
    final feedback = <FeedbackItem>[];

    // Zero-match pattern detection
    final isZeroMatch = widgetDiff.matches == 0 && widgetDiff.missing.isNotEmpty;

    if (isZeroMatch) {
      final coverageStr = widgetDiff.keyCoverage != null
          ? ' Key coverage: ${(widgetDiff.keyCoverage!.coverage * 100).round()}%.'
          : '';

      feedback.add(FeedbackItem(
        severity: Severity.fail,
        category: FeedbackCategory.missing,
        message: 'Widget comparison found 0 matches between '
            '${widgetDiff.missing.length} design nodes and '
            '${widgetDiff.extra.length} widgets.$coverageStr',
      ),);

      // Add per-widget key suggestions
      final suggestions = widgetDiff.keySuggestions;
      if (suggestions != null && suggestions.isNotEmpty) {
        for (final s in suggestions.take(10)) {
          feedback.add(FeedbackItem(
            severity: Severity.fail,
            category: FeedbackCategory.missing,
            message: "Widget ${s.widgetType}('${_truncate(s.widgetText, 30)}') "
                'likely matches node "${s.nodeName}"',
            element: s.widgetIdentifier,
            fix: "Add key: Key('${s.nodeId}') to ${s.widgetIdentifier}",
          ),);
        }
      } else {
        feedback.add(FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.missing,
          message: "Add Key('nodeId') to your widgets matching the design node IDs.",
        ),);
      }
    } else {
      // Widget property mismatches
      for (final mismatch in widgetDiff.mismatches) {
        feedback.add(FeedbackItem(
          severity: mismatch.severity,
          category: _categorizeProperty(mismatch.property),
          message: '${mismatch.widget}: ${mismatch.property} mismatch. '
              'Expected "${mismatch.expected}", got "${mismatch.actual}".',
          element: mismatch.widget,
          fix: mismatch.fix,
        ),);
      }

      // Missing widgets
      for (final name in widgetDiff.missing) {
        feedback.add(FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.missing,
          message: 'Missing widget: $name',
          element: name,
        ),);
      }

      // Extra widgets
      for (final id in widgetDiff.extra) {
        feedback.add(FeedbackItem(
          severity: Severity.warn,
          category: FeedbackCategory.extra,
          message: 'Extra widget found: $id',
          element: id,
        ),);
      }
    }

    // Pixel diff regions (deduplicated against widget feedback)
    final hasFeedback = feedback.isNotEmpty;
    final reportedElements = feedback.map((f) => f.element).whereType<String>().toSet();

    for (final region in regions) {
      final element = widgets != null ? _mapRegionToWidget(region, widgets) : null;

      if (element != null && reportedElements.contains(element)) continue;
      if (hasFeedback && region.severity != Severity.fail) continue;

      feedback.add(FeedbackItem(
        severity: region.severity,
        category: _regionTypeToCategory(region.type),
        message: region.description,
        element: element,
      ),);
    }

    // Cascade suppression
    final suppressed = _cascadeSuppression.suppress(feedback, widgetDiff, widgets);

    // Sort: fail > warn > pass
    suppressed.sort((a, b) => b.severity.index.compareTo(a.severity.index));

    return suppressed;
  }

  /// Generate human-readable summary.
  String generateSummary(ComparisonResult result) {
    final percentage = (result.overall.matchPercentage * 100).round();
    final failCount = result.feedback.where((f) => f.severity == Severity.fail).length;
    final warnCount = result.feedback.where((f) => f.severity == Severity.warn).length;

    final categoryCounts = <String, int>{};
    for (final item in result.feedback) {
      if (item.severity == Severity.fail || item.severity == Severity.warn) {
        categoryCounts[item.category.name] = (categoryCounts[item.category.name] ?? 0) + 1;
      }
    }

    var summary = 'Match: $percentage% (Grade ${result.overall.grade}).';

    if (failCount == 0 && warnCount == 0 && result.overall.grade == 'A') {
      summary += ' Perfect match!';
    } else if (failCount == 0 && warnCount == 0) {
      summary += ' Some discrepancies detected.';
    } else {
      final total = failCount + warnCount;
      summary += ' $total issue${total == 1 ? '' : 's'} found';

      final topCategories = categoryCounts.entries.toList()
        ..sort((a, b) => b.value.compareTo(a.value));
      final top3 = topCategories.take(3);

      if (top3.isNotEmpty) {
        final categoryList = top3
            .map((e) => '${e.value} ${e.key} ${e.value == 1 ? 'issue' : 'issues'}')
            .join(', ');
        summary += ': $categoryList';
      }
      summary += '.';
    }

    return summary;
  }

  FeedbackCategory _categorizeProperty(String property) {
    final prop = property.toLowerCase();

    if (['color', 'backgroundcolor', 'bordercolor', 'fill', 'stroke'].contains(prop)) {
      return FeedbackCategory.color;
    }
    if (prop.startsWith('padding') || prop.startsWith('margin') || prop == 'gap') {
      return FeedbackCategory.spacing;
    }
    if (['fontfamily', 'fontsize', 'fontweight', 'lineheight', 'letterspacing', 'textalign']
        .contains(prop)) {
      return FeedbackCategory.typography;
    }
    if (['width', 'height'].contains(prop)) return FeedbackCategory.size;
    if (['x', 'y', 'left', 'top', 'right', 'bottom'].contains(prop)) {
      return FeedbackCategory.layout;
    }
    return FeedbackCategory.rendering;
  }

  FeedbackCategory _regionTypeToCategory(DiffRegionType type) {
    switch (type) {
      case DiffRegionType.color:
        return FeedbackCategory.color;
      case DiffRegionType.position:
        return FeedbackCategory.layout;
      case DiffRegionType.size:
        return FeedbackCategory.size;
      case DiffRegionType.missing:
        return FeedbackCategory.missing;
      case DiffRegionType.extra:
        return FeedbackCategory.extra;
      case DiffRegionType.typography:
        return FeedbackCategory.typography;
      case DiffRegionType.rendering:
        return FeedbackCategory.rendering;
    }
  }

  String _truncate(String? text, int maxLen) {
    if (text == null) return '';
    return text.length > maxLen ? '${text.substring(0, maxLen - 3)}...' : text;
  }

  String? _mapRegionToWidget(DiffRegion region, List<WidgetStyle> widgets) {
    WidgetStyle? best;
    var smallestArea = double.infinity;

    for (final widget in widgets) {
      if (widget.bounds.contains(region.bounds)) {
        final area = widget.bounds.area;
        if (area < smallestArea) {
          smallestArea = area;
          best = widget;
        }
      }
    }

    return best?.identifier;
  }
}
