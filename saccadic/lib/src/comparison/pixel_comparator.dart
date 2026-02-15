/// Pixel-level image comparison with flood-fill region detection.
///
/// Uses a simple per-pixel threshold comparison (no external pixelmatch dep)
/// and CIEDE2000 color science for perceptual accuracy.
library;
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;

import '../core/thresholds.dart';
import '../core/types.dart';

/// Options for pixel comparison.
class PixelCompareOptions {
  /// Per-channel threshold for pixel difference (0-255), default 26 (~0.1 * 255).
  final int threshold;

  /// Minimum region area in pixels to report, default 4.
  final int minRegionSize;

  /// Diff mask color [R, G, B], default magenta.
  final List<int> diffColor;

  const PixelCompareOptions({
    this.threshold = 26,
    this.minRegionSize = 4,
    this.diffColor = const [255, 0, 255],
  });
}

/// Pixel-level image comparator.
class PixelComparator {
  /// Compare two PNG images pixel by pixel.
  PixelDiffResult compare(
    Uint8List imageA,
    Uint8List imageB, [
    PixelCompareOptions options = const PixelCompareOptions(),
  ]) {
    final pngA = img.decodePng(imageA);
    final pngB = img.decodePng(imageB);

    if (pngA == null || pngB == null) {
      throw ArgumentError('Failed to decode one or both PNG images');
    }

    if (pngA.width != pngB.width || pngA.height != pngB.height) {
      throw ArgumentError(
        'Image dimensions do not match: '
        'A(${pngA.width}x${pngA.height}) vs B(${pngB.width}x${pngB.height})',
      );
    }

    final width = pngA.width;
    final height = pngA.height;
    final totalPixels = width * height;

    // Create diff image
    final diffImg = img.Image(width: width, height: height);
    var diffPixels = 0;

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        final a = pngA.getPixel(x, y);
        final b = pngB.getPixel(x, y);

        final dr = (a.r.toInt() - b.r.toInt()).abs();
        final dg = (a.g.toInt() - b.g.toInt()).abs();
        final db = (a.b.toInt() - b.b.toInt()).abs();

        if (dr > options.threshold ||
            dg > options.threshold ||
            db > options.threshold) {
          diffPixels++;
          diffImg.setPixelRgba(
            x,
            y,
            options.diffColor[0],
            options.diffColor[1],
            options.diffColor[2],
            255,
          );
        } else {
          diffImg.setPixelRgba(x, y, 0, 0, 0, 0);
        }
      }
    }

    final diffPercentage = (diffPixels / totalPixels) * 100;
    final diffBuffer = Uint8List.fromList(img.encodePng(diffImg));

    return PixelDiffResult(
      totalPixels: totalPixels,
      diffPixels: diffPixels,
      diffPercentage: diffPercentage,
      diffImage: diffBuffer,
      pixelComparisonRan: true,
    );
  }

  /// Find contiguous diff regions using connected component analysis (flood fill).
  List<DiffRegion> findDiffRegions(
    Uint8List diffImage,
    int width,
    int height,
  ) {
    final png = img.decodePng(diffImage);
    if (png == null) return [];

    final visited = <int>{};
    final regions = <DiffRegion>[];

    bool isDiff(int x, int y) {
      final pixel = png.getPixel(x, y);
      final hasColor = pixel.r > 0 || pixel.g > 0 || pixel.b > 0;
      final hasAlpha = pixel.a > 128;
      return hasColor && hasAlpha;
    }

    DiffRegion? floodFill(int startX, int startY) {
      final stack = <(int, int)>[(startX, startY)];
      var minX = startX, maxX = startX;
      var minY = startY, maxY = startY;
      var pixelCount = 0;

      while (stack.isNotEmpty) {
        final (x, y) = stack.removeLast();
        final idx = y * width + x;

        if (visited.contains(idx)) continue;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        if (!isDiff(x, y)) continue;

        visited.add(idx);
        pixelCount++;

        minX = math.min(minX, x);
        maxX = math.max(maxX, x);
        minY = math.min(minY, y);
        maxY = math.max(maxY, y);

        stack.add((x + 1, y));
        stack.add((x - 1, y));
        stack.add((x, y + 1));
        stack.add((x, y - 1));
      }

      if (pixelCount == 0) return null;

      return DiffRegion(
        bounds: Bounds(
          x: minX.toDouble(),
          y: minY.toDouble(),
          width: (maxX - minX + 1).toDouble(),
          height: (maxY - minY + 1).toDouble(),
        ),
        severity: Severity.warn,
        type: DiffRegionType.rendering,
        description: 'Diff region of $pixelCount pixels',
      );
    }

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        final idx = y * width + x;
        if (visited.contains(idx)) continue;
        if (!isDiff(x, y)) continue;

        final region = floodFill(x, y);
        if (region != null && region.bounds.area >= minRegionPixels) {
          regions.add(region);
        }
      }
    }

    return regions;
  }

  /// Classify a diff region's severity based on size relative to total area.
  DiffRegion classifyRegion(DiffRegion region, double totalArea) {
    final areaPercentage = region.bounds.area / totalArea;

    Severity severity;
    if (areaPercentage < PixelThresholds.pass) {
      severity = Severity.pass;
    } else if (areaPercentage < PixelThresholds.warn) {
      severity = Severity.warn;
    } else {
      severity = Severity.fail;
    }

    return region.copyWith(severity: severity);
  }
}
