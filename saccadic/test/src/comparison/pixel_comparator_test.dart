import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:saccadic/src/comparison/pixel_comparator.dart';
import 'package:saccadic/src/core/types.dart';
import 'package:test/test.dart';

Uint8List createSolidPng(int width, int height, int r, int g, int b) {
  final image = img.Image(width: width, height: height);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      image.setPixelRgba(x, y, r, g, b, 255);
    }
  }
  return Uint8List.fromList(img.encodePng(image));
}

void main() {
  late PixelComparator comparator;

  setUp(() {
    comparator = PixelComparator();
  });

  group('compare', () {
    test('identical images have 0 diff', () {
      final imageA = createSolidPng(100, 100, 255, 0, 0);
      final imageB = createSolidPng(100, 100, 255, 0, 0);

      final result = comparator.compare(imageA, imageB);

      expect(result.diffPixels, 0);
      expect(result.diffPercentage, 0.0);
      expect(result.totalPixels, 10000);
      expect(result.pixelComparisonRan, true);
    });

    test('completely different images have 100% diff', () {
      final imageA = createSolidPng(100, 100, 255, 0, 0);
      final imageB = createSolidPng(100, 100, 0, 0, 255);

      final result = comparator.compare(imageA, imageB);

      expect(result.diffPixels, 10000);
      expect(result.diffPercentage, 100.0);
    });

    test('similar colors below threshold have 0 diff', () {
      final imageA = createSolidPng(10, 10, 128, 128, 128);
      final imageB = createSolidPng(10, 10, 130, 130, 130);

      final result = comparator.compare(imageA, imageB);

      expect(result.diffPixels, 0);
    });

    test('throws on mismatched dimensions', () {
      final imageA = createSolidPng(100, 100, 0, 0, 0);
      final imageB = createSolidPng(50, 50, 0, 0, 0);

      expect(
        () => comparator.compare(imageA, imageB),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('produces diff image', () {
      final imageA = createSolidPng(10, 10, 255, 0, 0);
      final imageB = createSolidPng(10, 10, 0, 0, 255);

      final result = comparator.compare(imageA, imageB);

      expect(result.diffImage, isNotNull);
      expect(result.diffImage!.isNotEmpty, true);
    });
  });

  group('findDiffRegions', () {
    test('finds single contiguous region', () {
      // Create a diff image with a block of diff pixels
      final diffImg = img.Image(width: 100, height: 100);
      // Clear
      for (var y = 0; y < 100; y++) {
        for (var x = 0; x < 100; x++) {
          diffImg.setPixelRgba(x, y, 0, 0, 0, 0);
        }
      }
      // Add a 10x10 block of diff
      for (var y = 10; y < 20; y++) {
        for (var x = 10; x < 20; x++) {
          diffImg.setPixelRgba(x, y, 255, 0, 255, 255);
        }
      }
      final diffPng = Uint8List.fromList(img.encodePng(diffImg));

      final regions = comparator.findDiffRegions(diffPng, 100, 100);

      expect(regions.length, 1);
      expect(regions.first.bounds.width, 10);
      expect(regions.first.bounds.height, 10);
    });

    test('returns empty for no diff', () {
      final diffImg = img.Image(width: 50, height: 50);
      for (var y = 0; y < 50; y++) {
        for (var x = 0; x < 50; x++) {
          diffImg.setPixelRgba(x, y, 0, 0, 0, 0);
        }
      }
      final diffPng = Uint8List.fromList(img.encodePng(diffImg));

      final regions = comparator.findDiffRegions(diffPng, 50, 50);

      expect(regions, isEmpty);
    });
  });

  group('classifyRegion', () {
    test('small region relative to total area is pass', () {
      const region = DiffRegion(
        bounds: Bounds(x: 0, y: 0, width: 5, height: 5),
        severity: Severity.warn,
        type: DiffRegionType.rendering,
        description: 'test',
      );

      final classified = comparator.classifyRegion(region, 1000000);
      expect(classified.severity, Severity.pass);
    });

    test('large region relative to total area is fail', () {
      const region = DiffRegion(
        bounds: Bounds(x: 0, y: 0, width: 500, height: 500),
        severity: Severity.warn,
        type: DiffRegionType.rendering,
        description: 'test',
      );

      final classified = comparator.classifyRegion(region, 1000000);
      expect(classified.severity, Severity.fail);
    });
  });
}
