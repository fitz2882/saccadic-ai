/// Perceptual thresholds based on psychophysics research.
///
/// These thresholds determine when a difference is imperceptible (pass),
/// noticeable (warn), or clearly wrong (fail).
library;

/// CIEDE2000 color distance thresholds.
class ColorThresholds {
  /// ΔE₀₀ < 1.0: imperceptible difference
  static const double pass = 1.0;

  /// ΔE₀₀ 1.0-2.0: minor, noticeable on close inspection
  static const double warn = 2.0;

  // > 2.0: clearly different (fail)
}

/// Weber fraction thresholds for position (x/y offset).
class PositionThresholds {
  /// < 2% displacement: imperceptible
  static const double pass = 0.02;

  /// 2-4%: noticeable but acceptable
  static const double warn = 0.04;

  // > 4%: clearly mispositioned (fail)
}

/// Weber fraction thresholds for size (width/height).
class SizeThresholds {
  /// < 2.9%: imperceptible size difference
  static const double pass = 0.029;

  /// 2.9-5%: noticeable but acceptable
  static const double warn = 0.05;

  // > 5%: clearly wrong size (fail)
}

/// Pixel diff thresholds (fraction of total pixels).
class PixelThresholds {
  /// < 1% pixels different: nearly identical
  static const double pass = 0.01;

  /// 1-5%: some differences
  static const double warn = 0.05;

  // > 5%: significant pixel difference (fail)
}

/// SSIM (Structural Similarity Index) thresholds.
class SsimThresholds {
  /// > 0.95: high structural similarity
  static const double pass = 0.95;

  /// 0.85-0.95: moderate similarity
  static const double warn = 0.85;

  // < 0.85: low similarity (fail)
}

/// Minimum region area in pixels to report (noise filter).
const int minRegionPixels = 4;
