/// CIEDE2000 color distance and color space conversions.
///
/// Implements the full CIEDE2000 formula (Sharma et al., 2005)
/// with kL=kC=kH=1 for perceptual color comparison.
library;
import 'dart:math' as math;

import 'thresholds.dart';
import 'types.dart';

/// RGB color with 0-255 channels.
class RGB {
  final int r, g, b;
  const RGB(this.r, this.g, this.b);
}

/// CIELAB color.
class Lab {
  final double L, a, b;
  const Lab(this.L, this.a, this.b);
}

/// Compute CIEDE2000 color distance between two hex colors.
/// Returns ΔE₀₀ value (0 = identical, >2.3 = noticeable).
double computeDeltaE(String colorA, String colorB) {
  final rgbA = hexToRgb(colorA);
  final rgbB = hexToRgb(colorB);
  final labA = rgbToLab(rgbA);
  final labB = rgbToLab(rgbB);
  return labToDeltaE2000(labA, labB);
}

/// Map ΔE₀₀ value to severity level.
Severity severityFromDeltaE(double deltaE) {
  if (deltaE < ColorThresholds.pass) return Severity.pass;
  if (deltaE < ColorThresholds.warn) return Severity.warn;
  return Severity.fail;
}

/// Check if two hex colors match perceptually (ΔE₀₀ < pass threshold).
bool colorsMatch(String expected, String actual) {
  final normExpected = expected.toUpperCase();
  final normActual = actual.toUpperCase();
  if (normExpected == normActual) return true;
  final deltaE = computeDeltaE(normExpected, normActual);
  return deltaE < ColorThresholds.pass;
}

/// Convert hex color string to RGB.
/// Handles '#RGB', '#RRGGBB', 'RGB', 'RRGGBB'.
RGB hexToRgb(String hex) {
  hex = hex.replaceFirst('#', '');

  if (hex.length == 3) {
    hex = hex.split('').map((c) => '$c$c').join();
  }

  final r = int.parse(hex.substring(0, 2), radix: 16);
  final g = int.parse(hex.substring(2, 4), radix: 16);
  final b = int.parse(hex.substring(4, 6), radix: 16);
  return RGB(r, g, b);
}

/// Convert RGB to hex string (uppercase, with #).
String rgbToHex(int r, int g, int b) {
  return '#${r.toRadixString(16).padLeft(2, '0')}'
      '${g.toRadixString(16).padLeft(2, '0')}'
      '${b.toRadixString(16).padLeft(2, '0')}'
      .toUpperCase();
}

/// Convert RGB to CIELAB via sRGB → Linear RGB → XYZ → LAB.
Lab rgbToLab(RGB rgb) {
  // sRGB to linear RGB (gamma correction)
  double toLinear(int channel) {
    final c = channel / 255.0;
    return c <= 0.04045 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
  }

  final rL = toLinear(rgb.r);
  final gL = toLinear(rgb.g);
  final bL = toLinear(rgb.b);

  // Linear RGB to XYZ (D65 illuminant)
  var x = rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375;
  var y = rL * 0.2126729 + gL * 0.7151522 + bL * 0.072175;
  var z = rL * 0.0193339 + gL * 0.119192 + bL * 0.9503041;

  // Normalize to D65 white point
  x = (x / 0.95047) * 100;
  y = (y / 1.0) * 100;
  z = (z / 1.08883) * 100;

  // XYZ to LAB
  double labF(double t) {
    return t > 0.008856 ? math.pow(t, 1.0 / 3.0).toDouble() : 7.787 * t + 16.0 / 116.0;
  }

  final fx = labF(x / 100);
  final fy = labF(y / 100);
  final fz = labF(z / 100);

  final L = 116 * fy - 16;
  final a = 500 * (fx - fy);
  final b = 200 * (fy - fz);

  return Lab(L, a, b);
}

/// Compute CIEDE2000 color distance between two LAB colors.
/// Full implementation with kL=kC=kH=1.
double labToDeltaE2000(Lab lab1, Lab lab2) {
  final l1 = lab1.L, a1 = lab1.a, b1 = lab1.b;
  final l2 = lab2.L, a2 = lab2.a, b2 = lab2.b;

  // Mean L
  final lMean = (l1 + l2) / 2;

  // Chroma
  final c1 = math.sqrt(a1 * a1 + b1 * b1);
  final c2 = math.sqrt(a2 * a2 + b2 * b2);
  final cMean = (c1 + c2) / 2;

  // G factor for a' adjustment
  final g = 0.5 * (1 - math.sqrt(math.pow(cMean, 7) / (math.pow(cMean, 7) + math.pow(25, 7))));

  // Adjusted a'
  final a1Prime = a1 * (1 + g);
  final a2Prime = a2 * (1 + g);

  // Adjusted chroma
  final c1Prime = math.sqrt(a1Prime * a1Prime + b1 * b1);
  final c2Prime = math.sqrt(a2Prime * a2Prime + b2 * b2);
  final cMeanPrime = (c1Prime + c2Prime) / 2;

  // Hue
  final h1Prime = _computeHue(a1Prime, b1);
  final h2Prime = _computeHue(a2Prime, b2);

  // Hue difference
  var dhPrime = 0.0;
  if (c1Prime * c2Prime != 0) {
    dhPrime = h2Prime - h1Prime;
    if (dhPrime > 180) {
      dhPrime -= 360;
    } else if (dhPrime < -180) {
      dhPrime += 360;
    }
  }

  // Mean hue
  var hMeanPrime = 0.0;
  if (c1Prime * c2Prime != 0) {
    hMeanPrime = (h1Prime + h2Prime) / 2;
    if ((h1Prime - h2Prime).abs() > 180) {
      if (hMeanPrime < 180) {
        hMeanPrime += 180;
      } else {
        hMeanPrime -= 180;
      }
    }
  }

  // Differences
  final dL = l2 - l1;
  final dC = c2Prime - c1Prime;
  final dH = 2 * math.sqrt(c1Prime * c2Prime) * math.sin(dhPrime * math.pi / 360);

  // Weighting factors
  final t = 1 -
      0.17 * math.cos((hMeanPrime - 30) * math.pi / 180) +
      0.24 * math.cos(2 * hMeanPrime * math.pi / 180) +
      0.32 * math.cos((3 * hMeanPrime + 6) * math.pi / 180) -
      0.2 * math.cos((4 * hMeanPrime - 63) * math.pi / 180);

  final sL = 1 + (0.015 * math.pow(lMean - 50, 2)) / math.sqrt(20 + math.pow(lMean - 50, 2));
  final sC = 1 + 0.045 * cMeanPrime;
  final sH = 1 + 0.015 * cMeanPrime * t;

  // Rotation term (for blue region)
  final dTheta = 30 * math.exp(-math.pow((hMeanPrime - 275) / 25, 2));
  final rC = 2 * math.sqrt(math.pow(cMeanPrime, 7) / (math.pow(cMeanPrime, 7) + math.pow(25, 7)));
  final rT = -rC * math.sin(2 * dTheta * math.pi / 180);

  // Final ΔE₀₀
  final deltaE = math.sqrt(
    math.pow(dL / sL, 2) +
        math.pow(dC / sC, 2) +
        math.pow(dH / sH, 2) +
        rT * (dC / sC) * (dH / sH),
  );

  return deltaE;
}

/// Compute hue angle in degrees from a' and b.
double _computeHue(double aPrime, double b) {
  if (aPrime == 0 && b == 0) return 0;
  var h = math.atan2(b, aPrime) * 180 / math.pi;
  if (h < 0) h += 360;
  return h;
}

/// Parse CSS color value to hex string.
/// Supports: '#RRGGBB', '#RGB', 'rgb(r, g, b)', 'rgba(r, g, b, a)'.
String? parseColorToHex(String? value) {
  if (value == null || value.isEmpty) return null;
  value = value.trim();

  if (value.startsWith('#')) return value.toUpperCase();

  final rgbMatch = RegExp(r'rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)').firstMatch(value);
  if (rgbMatch != null) {
    final r = double.parse(rgbMatch.group(1)!).round();
    final g = double.parse(rgbMatch.group(2)!).round();
    final b = double.parse(rgbMatch.group(3)!).round();
    return rgbToHex(r, g, b);
  }

  return null;
}
