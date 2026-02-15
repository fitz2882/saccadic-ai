import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/feedback/cascade_suppression.dart';
import 'package:saccadic/src/flutter/widget_style.dart';
import 'package:test/test.dart';

void main() {
  late CascadeSuppression suppression;

  setUp(() {
    suppression = CascadeSuppression();
  });

  group('Rule 1: Same-element suppression', () {
    test('suppresses height when fontSize mismatched on same element', () {
      final feedback = [
        const FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.typography,
          message: 'title: fontSize mismatch',
          element: 'title',
        ),
        const FeedbackItem(
          severity: Severity.warn,
          category: FeedbackCategory.size,
          message: 'title: height mismatch',
          element: 'title',
        ),
      ];
      const widgetDiff = WidgetDiffResult(
        matches: 5,
        mismatches: [
          WidgetPropertyMismatch(
            widget: 'title',
            property: 'fontSize',
            expected: '24',
            actual: '16',
            severity: Severity.fail,
          ),
          WidgetPropertyMismatch(
            widget: 'title',
            property: 'height',
            expected: '30',
            actual: '24',
            severity: Severity.warn,
          ),
        ],
        missing: [],
        extra: [],
      );

      final result = suppression.suppress(feedback, widgetDiff, null);

      // Height should be suppressed, typography kept
      expect(result.length, 1);
      expect(result.first.category, FeedbackCategory.typography);
    });
  });

  group('Rule 2: Parent-child suppression', () {
    test('suppresses child x position when parent has padding mismatch', () {
      final widgets = [
        WidgetStyle(
          key: 'parent',
          widgetType: 'Container',
          bounds: const Bounds(x: 0, y: 0, width: 400, height: 400),
          description: 'Container(parent)',
        ),
        WidgetStyle(
          key: 'child',
          widgetType: 'Text',
          bounds: const Bounds(x: 16, y: 16, width: 200, height: 30),
          description: 'Text(child)',
        ),
      ];
      // Use WidgetStyle.identifier format: Key('parent'), Key('child')
      final parentId = widgets[0].identifier; // "Key('parent')"
      final childId = widgets[1].identifier; // "Key('child')"
      final feedback = [
        FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.spacing,
          message: '$parentId: paddingleft mismatch',
          element: parentId,
        ),
        FeedbackItem(
          severity: Severity.warn,
          category: FeedbackCategory.layout,
          message: '$childId: x mismatch',
          element: childId,
        ),
      ];
      final widgetDiff = WidgetDiffResult(
        matches: 2,
        mismatches: [
          WidgetPropertyMismatch(
            widget: parentId,
            property: 'paddingleft',
            expected: '16',
            actual: '8',
            severity: Severity.fail,
          ),
        ],
        missing: const [],
        extra: const [],
      );

      final result = suppression.suppress(feedback, widgetDiff, widgets);

      // Child x position should be suppressed; parent padding kept
      expect(result.length, 1);
      expect(result.first.element, parentId);
    });
  });

  group('Rule 3: Missing/extra reflow', () {
    test('suppresses layout when missing elements exist', () {
      final feedback = [
        const FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.missing,
          message: 'Missing widget: sidebar',
          element: 'sidebar',
        ),
        const FeedbackItem(
          severity: Severity.warn,
          category: FeedbackCategory.layout,
          message: 'content: x mismatch',
          element: 'content',
        ),
      ];
      const widgetDiff = WidgetDiffResult(
        matches: 3,
        mismatches: [],
        missing: ['sidebar'],
        extra: [],
      );

      final result = suppression.suppress(feedback, widgetDiff, null);

      // Layout should be suppressed; missing kept
      expect(result.length, 1);
      expect(result.first.category, FeedbackCategory.missing);
    });
  });

  group('preserves root cause items', () {
    test('keeps color and typography feedback', () {
      final feedback = [
        const FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.color,
          message: 'btn: color mismatch',
          element: 'btn',
        ),
        const FeedbackItem(
          severity: Severity.fail,
          category: FeedbackCategory.typography,
          message: 'title: fontFamily mismatch',
          element: 'title',
        ),
      ];
      const widgetDiff = WidgetDiffResult(
        matches: 5,
        mismatches: [],
        missing: [],
        extra: [],
      );

      final result = suppression.suppress(feedback, widgetDiff, null);
      expect(result.length, 2);
    });
  });
}
