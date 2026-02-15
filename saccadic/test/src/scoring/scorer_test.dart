import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/scoring/scorer.dart';
import 'package:test/test.dart';

void main() {
  late Scorer scorer;

  setUp(() {
    scorer = Scorer();
  });

  group('computeScore', () {
    test('perfect match returns grade A', () {
      const widgetDiff = WidgetDiffResult(
        matches: 10,
        mismatches: [],
        missing: [],
        extra: [],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 1000000,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: true,
      );

      final score = scorer.computeScore(
        widgetDiff,
        pixelDiff,
        [],
        const Viewport(width: 1280, height: 800),
        null,
      );

      expect(score.grade, 'A');
      expect(score.matchPercentage, greaterThan(0.95));
    });

    test('zero matches returns grade F', () {
      const widgetDiff = WidgetDiffResult(
        matches: 0,
        mismatches: [],
        missing: ['a', 'b', 'c', 'd', 'e'],
        extra: [],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 0,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: false,
      );

      final score = scorer.computeScore(
        widgetDiff,
        pixelDiff,
        [],
        const Viewport(width: 1280, height: 800),
        null,
      );

      expect(score.grade, 'F');
      expect(score.matchPercentage, 0.0);
    });

    test('pixel-only mode works without widget comparison', () {
      const widgetDiff = WidgetDiffResult(
        matches: 5,
        mismatches: [],
        missing: [],
        extra: [],
      );
      const pixelDiff = PixelDiffResult(
        totalPixels: 1000000,
        diffPixels: 5000,
        diffPercentage: 0.5,
        pixelComparisonRan: true,
      );

      final score = scorer.computeScore(
        widgetDiff,
        pixelDiff,
        [],
        const Viewport(width: 1280, height: 800),
        null,
      );

      // 70% widget (100%) + 30% pixel (99.5%) = ~99.9%
      expect(score.grade, 'A');
      expect(score.matchPercentage, greaterThan(0.95));
    });

    test('fail mismatches reduce score', () {
      const widgetDiff = WidgetDiffResult(
        matches: 5,
        mismatches: [
          WidgetPropertyMismatch(
            widget: 'a',
            property: 'color',
            expected: '#FF0000',
            actual: '#00FF00',
            severity: Severity.fail,
          ),
          WidgetPropertyMismatch(
            widget: 'b',
            property: 'fontSize',
            expected: '16px',
            actual: '8px',
            severity: Severity.fail,
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

      final score = scorer.computeScore(
        widgetDiff,
        pixelDiff,
        [],
        const Viewport(width: 1280, height: 800),
        null,
      );

      expect(score.matchPercentage, lessThan(1.0));
    });
  });
}
