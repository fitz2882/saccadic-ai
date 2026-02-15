import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/feedback/feedback_generator.dart';
import 'package:test/test.dart';

void main() {
  late FeedbackGenerator generator;

  setUp(() {
    generator = FeedbackGenerator();
  });

  group('generate', () {
    test('zero-match pattern produces header + fallback feedback', () {
      const widgetDiff = WidgetDiffResult(
        matches: 0,
        mismatches: [],
        missing: ['a', 'b', 'c'],
        extra: [],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 0,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: false,
      );

      final result = generator.generate(widgetDiff, pixelDiff, [], null);

      expect(result.length, 2);
      expect(result.first.severity, Severity.fail);
      expect(result.first.message, contains('0 matches'));
      // Second item is fallback since no suggestions available
      expect(result[1].message, contains("Key('nodeId')"));
    });

    test('zero-match with suggestions produces per-widget feedback', () {
      const widgetDiff = WidgetDiffResult(
        matches: 0,
        mismatches: [],
        missing: ['Header Title'],
        extra: ['Text(10,10)'],
        keyCoverage: KeyCoverageMetric(
          expectedKeys: 1,
          foundKeys: 0,
          widgetCount: 1,
          coverage: 0.0,
        ),
        keySuggestions: [
          KeySuggestion(
            nodeId: 'headerTitle',
            nodeName: 'Header Title',
            nodeType: NodeType.text,
            nodeText: 'Welcome Back',
            widgetIdentifier: 'Text(10,10)',
            widgetType: 'Text',
            widgetText: 'Welcome Back',
            confidence: 1.0,
            reason: 'Text match: "Welcome Back"',
          ),
        ],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 0,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: false,
      );

      final result = generator.generate(widgetDiff, pixelDiff, [], null);

      // Header + 1 suggestion = 2 items
      expect(result.length, 2);
      expect(result.first.message, contains('0 matches'));
      expect(result.first.message, contains('Key coverage: 0%'));
      expect(result[1].fix, contains("Key('headerTitle')"));
      expect(result[1].message, contains('Header Title'));
    });

    test('generates feedback for mismatches, missing, and extra', () {
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
        ],
        missing: ['sidebar'],
        extra: ['randomDiv'],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 1000000,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: true,
      );

      final result = generator.generate(widgetDiff, pixelDiff, [], null);

      // Should have: 1 mismatch + 1 missing + 1 extra = 3
      expect(result.length, 3);

      final categories = result.map((f) => f.category).toSet();
      expect(categories, contains(FeedbackCategory.typography));
      expect(categories, contains(FeedbackCategory.missing));
      expect(categories, contains(FeedbackCategory.extra));
    });

    test('sorts by severity (fail before warn)', () {
      const widgetDiff = WidgetDiffResult(
        matches: 5,
        mismatches: [
          WidgetPropertyMismatch(
            widget: 'a',
            property: 'fontSize',
            expected: '24',
            actual: '16',
            severity: Severity.fail,
          ),
          WidgetPropertyMismatch(
            widget: 'b',
            property: 'width',
            expected: '200',
            actual: '195',
            severity: Severity.warn,
          ),
        ],
        missing: [],
        extra: [],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 0,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: false,
      );

      final result = generator.generate(widgetDiff, pixelDiff, [], null);

      expect(result.first.severity, Severity.fail);
      expect(result.last.severity, Severity.warn);
    });
  });

  group('generateSummary', () {
    test('perfect match summary', () {
      const result = ComparisonResult(
        overall: OverallScore(
          matchPercentage: 1.0,
          grade: 'A',
          summary: 'Perfect match!',
        ),
        widgetDiff: WidgetDiffResult(
          matches: 10,
          mismatches: [],
          missing: [],
          extra: [],
        ),
        pixelDiff: PixelDiffResult(
          totalPixels: 1000000,
          diffPixels: 0,
          diffPercentage: 0,
          pixelComparisonRan: true,
        ),
        feedback: [],
        regions: [],
        timestamp: 0,
      );

      final summary = generator.generateSummary(result);

      expect(summary, contains('100%'));
      expect(summary, contains('Grade A'));
      expect(summary, contains('Perfect match'));
    });

    test('summary with issues includes category breakdown', () {
      const result = ComparisonResult(
        overall: OverallScore(
          matchPercentage: 0.75,
          grade: 'C',
          summary: '75% match',
        ),
        widgetDiff: WidgetDiffResult(
          matches: 5,
          mismatches: [],
          missing: [],
          extra: [],
        ),
        pixelDiff: PixelDiffResult(
          totalPixels: 1000000,
          diffPixels: 50000,
          diffPercentage: 5,
          pixelComparisonRan: true,
        ),
        feedback: [
          FeedbackItem(
            severity: Severity.fail,
            category: FeedbackCategory.color,
            message: 'color mismatch',
          ),
          FeedbackItem(
            severity: Severity.fail,
            category: FeedbackCategory.color,
            message: 'another color mismatch',
          ),
          FeedbackItem(
            severity: Severity.warn,
            category: FeedbackCategory.spacing,
            message: 'padding mismatch',
          ),
        ],
        regions: [],
        timestamp: 0,
      );

      final summary = generator.generateSummary(result);

      expect(summary, contains('75%'));
      expect(summary, contains('Grade C'));
      expect(summary, contains('3 issues'));
      expect(summary, contains('color'));
    });
  });
}
