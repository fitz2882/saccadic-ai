import 'package:saccadic/src/core/color_science.dart';
import 'package:test/test.dart';

void main() {
  group('hexToRgb', () {
    test('parses 6-digit hex', () {
      final rgb = hexToRgb('#FF0000');
      expect(rgb.r, 255);
      expect(rgb.g, 0);
      expect(rgb.b, 0);
    });

    test('parses 3-digit hex', () {
      final rgb = hexToRgb('#F00');
      expect(rgb.r, 255);
      expect(rgb.g, 0);
      expect(rgb.b, 0);
    });

    test('parses without #', () {
      final rgb = hexToRgb('00FF00');
      expect(rgb.r, 0);
      expect(rgb.g, 255);
      expect(rgb.b, 0);
    });
  });

  group('rgbToHex', () {
    test('converts RGB to hex', () {
      expect(rgbToHex(255, 0, 0), '#FF0000');
      expect(rgbToHex(0, 255, 0), '#00FF00');
      expect(rgbToHex(0, 0, 255), '#0000FF');
    });
  });

  group('computeDeltaE', () {
    test('identical colors return 0', () {
      expect(computeDeltaE('#FF0000', '#FF0000'), 0.0);
      expect(computeDeltaE('#000000', '#000000'), 0.0);
      expect(computeDeltaE('#FFFFFF', '#FFFFFF'), 0.0);
    });

    test('black vs white is large', () {
      final dE = computeDeltaE('#000000', '#FFFFFF');
      expect(dE, greaterThan(90)); // ~100 for black vs white
    });

    test('similar colors have small deltaE', () {
      // Two very close reds
      final dE = computeDeltaE('#FF0000', '#FE0000');
      expect(dE, lessThan(1.0)); // imperceptible
    });

    test('noticeably different colors have deltaE > 2', () {
      final dE = computeDeltaE('#FF0000', '#00FF00');
      expect(dE, greaterThan(2.0));
    });
  });

  group('colorsMatch', () {
    test('identical colors match', () {
      expect(colorsMatch('#FF0000', '#FF0000'), true);
    });

    test('very similar colors match', () {
      expect(colorsMatch('#FF0000', '#FE0000'), true);
    });

    test('different colors do not match', () {
      expect(colorsMatch('#FF0000', '#00FF00'), false);
    });

    test('case insensitive', () {
      expect(colorsMatch('#ff0000', '#FF0000'), true);
    });
  });

  group('severityFromDeltaE', () {
    test('returns pass for ΔE < 1.0', () {
      expect(severityFromDeltaE(0.5).name, 'pass');
    });

    test('returns warn for ΔE 1.0-2.0', () {
      expect(severityFromDeltaE(1.5).name, 'warn');
    });

    test('returns fail for ΔE > 2.0', () {
      expect(severityFromDeltaE(3.0).name, 'fail');
    });
  });

  group('parseColorToHex', () {
    test('parses hex string', () {
      expect(parseColorToHex('#FF0000'), '#FF0000');
    });

    test('parses rgb()', () {
      expect(parseColorToHex('rgb(255, 0, 0)'), '#FF0000');
    });

    test('parses rgba()', () {
      expect(parseColorToHex('rgba(0, 255, 0, 1)'), '#00FF00');
    });

    test('returns null for empty', () {
      expect(parseColorToHex(''), null);
      expect(parseColorToHex(null), null);
    });
  });
}
