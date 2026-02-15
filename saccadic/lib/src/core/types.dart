/// Core type definitions for Saccadic visual feedback system.
library;

/// Root design representation — parsed from .pen or Figma.
class DesignState {
  final String id;
  final String name;
  final Viewport viewport;
  final List<DesignNode> nodes;
  final DesignTokens? tokens;

  const DesignState({
    required this.id,
    required this.name,
    required this.viewport,
    required this.nodes,
    this.tokens,
  });
}

/// Hierarchical design tree node.
class DesignNode {
  final String id;
  final String name;
  final NodeType type;
  final Bounds bounds;
  final List<Fill>? fills;
  final List<Stroke>? strokes;
  final List<Effect>? effects;
  final CornerRadius? cornerRadius;
  final Typography? typography;
  final Spacing? padding;
  final double? gap;
  final LayoutMode? layoutMode;
  final List<DesignNode> children;
  final String? textContent;

  const DesignNode({
    required this.id,
    required this.name,
    required this.type,
    required this.bounds,
    this.fills,
    this.strokes,
    this.effects,
    this.cornerRadius,
    this.typography,
    this.padding,
    this.gap,
    this.layoutMode,
    this.children = const [],
    this.textContent,
  });

  DesignNode copyWith({
    String? id,
    String? name,
    NodeType? type,
    Bounds? bounds,
    List<Fill>? fills,
    List<Stroke>? strokes,
    List<Effect>? effects,
    CornerRadius? cornerRadius,
    Typography? typography,
    Spacing? padding,
    double? gap,
    LayoutMode? layoutMode,
    List<DesignNode>? children,
    String? textContent,
  }) {
    return DesignNode(
      id: id ?? this.id,
      name: name ?? this.name,
      type: type ?? this.type,
      bounds: bounds ?? this.bounds,
      fills: fills ?? this.fills,
      strokes: strokes ?? this.strokes,
      effects: effects ?? this.effects,
      cornerRadius: cornerRadius ?? this.cornerRadius,
      typography: typography ?? this.typography,
      padding: padding ?? this.padding,
      gap: gap ?? this.gap,
      layoutMode: layoutMode ?? this.layoutMode,
      children: children ?? this.children,
      textContent: textContent ?? this.textContent,
    );
  }
}

/// Design node types.
enum NodeType {
  frame,
  group,
  text,
  rectangle,
  ellipse,
  image,
  button,
  input,
  component,
  instance,
  vector,
}

/// Layout direction.
enum LayoutMode {
  horizontal,
  vertical,
  none,
}

/// Bounding box.
class Bounds {
  final double x;
  final double y;
  final double width;
  final double height;

  const Bounds({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  double get area => width * height;
  double get right => x + width;
  double get bottom => y + height;

  /// Check if this bounds fully contains [other].
  bool contains(Bounds other) {
    return x <= other.x &&
        y <= other.y &&
        right >= other.right &&
        bottom >= other.bottom;
  }

  /// Check if this bounds overlaps with [other].
  bool overlaps(Bounds other) {
    return !(right < other.x ||
        other.right < x ||
        bottom < other.y ||
        other.bottom < y);
  }

  /// Compute Intersection over Union with [other].
  double iou(Bounds other) {
    final ix1 = x > other.x ? x : other.x;
    final iy1 = y > other.y ? y : other.y;
    final ix2 = right < other.right ? right : other.right;
    final iy2 = bottom < other.bottom ? bottom : other.bottom;

    if (ix2 < ix1 || iy2 < iy1) return 0;

    final intersection = (ix2 - ix1) * (iy2 - iy1);
    final union = area + other.area - intersection;
    return union > 0 ? intersection / union : 0;
  }
}

/// Fill definition.
class Fill {
  final FillType type;
  final String? color; // hex
  final double? opacity;
  final List<GradientStop>? gradient;

  const Fill({
    required this.type,
    this.color,
    this.opacity,
    this.gradient,
  });
}

enum FillType { solid, linearGradient, radialGradient, image }

class GradientStop {
  final double position;
  final String color;

  const GradientStop({required this.position, required this.color});
}

/// Stroke definition.
class Stroke {
  final String color;
  final double weight;
  final StrokePosition position;

  const Stroke({
    required this.color,
    required this.weight,
    required this.position,
  });
}

enum StrokePosition { inside, outside, center }

/// Effect definition.
class Effect {
  final EffectType type;
  final String? color;
  final ({double x, double y})? offset;
  final double blur;
  final double? spread;

  const Effect({
    required this.type,
    this.color,
    this.offset,
    required this.blur,
    this.spread,
  });
}

enum EffectType { dropShadow, innerShadow, blur, backgroundBlur }

/// Typography properties.
class Typography {
  final String fontFamily;
  final double fontSize;
  final int fontWeight;
  final double? lineHeight;
  final double? letterSpacing;
  final String? color;
  final TextAlign? textAlign;

  const Typography({
    required this.fontFamily,
    required this.fontSize,
    required this.fontWeight,
    this.lineHeight,
    this.letterSpacing,
    this.color,
    this.textAlign,
  });
}

enum TextAlign { left, center, right, justified }

/// Spacing (padding/margin).
class Spacing {
  final double top;
  final double right;
  final double bottom;
  final double left;

  const Spacing({
    required this.top,
    required this.right,
    required this.bottom,
    required this.left,
  });

  const Spacing.all(double value)
      : top = value,
        right = value,
        bottom = value,
        left = value;

  const Spacing.symmetric({double vertical = 0, double horizontal = 0})
      : top = vertical,
        bottom = vertical,
        left = horizontal,
        right = horizontal;

  bool get isZero => top == 0 && right == 0 && bottom == 0 && left == 0;
}

/// Corner radius — uniform or per-corner.
class CornerRadius {
  final double topLeft;
  final double topRight;
  final double bottomRight;
  final double bottomLeft;

  const CornerRadius.all(double value)
      : topLeft = value,
        topRight = value,
        bottomRight = value,
        bottomLeft = value;

  const CornerRadius({
    required this.topLeft,
    required this.topRight,
    required this.bottomRight,
    required this.bottomLeft,
  });

  /// Representative value (topLeft) for simple comparison.
  double get uniform => topLeft;
}

/// Viewport dimensions.
class Viewport {
  final int width;
  final int height;
  final double deviceScaleFactor;

  const Viewport({
    required this.width,
    required this.height,
    this.deviceScaleFactor = 1.0,
  });
}

/// Standard viewport presets.
const standardViewports = <String, Viewport>{
  'mobile-sm': Viewport(width: 320, height: 568),
  'mobile': Viewport(width: 375, height: 812),
  'tablet': Viewport(width: 768, height: 1024),
  'desktop-sm': Viewport(width: 1024, height: 768),
  'desktop': Viewport(width: 1280, height: 800),
  'desktop-lg': Viewport(width: 1440, height: 900),
};

// ── Design Tokens ──

class DesignTokens {
  final Map<String, String> colors;
  final Map<String, String> spacing;
  final Map<String, TypographyToken> typography;
  final Map<String, String> shadows;
  final Map<String, String> borders;
  final Map<String, String> radii;

  const DesignTokens({
    this.colors = const {},
    this.spacing = const {},
    this.typography = const {},
    this.shadows = const {},
    this.borders = const {},
    this.radii = const {},
  });
}

class TypographyToken {
  final String fontFamily;
  final String fontSize;
  final String fontWeight;
  final String lineHeight;
  final String? letterSpacing;

  const TypographyToken({
    required this.fontFamily,
    required this.fontSize,
    required this.fontWeight,
    required this.lineHeight,
    this.letterSpacing,
  });
}

// ── Comparison Results ──

class ComparisonResult {
  final OverallScore overall;
  final WidgetDiffResult widgetDiff;
  final PixelDiffResult pixelDiff;
  final List<DiffRegion> regions;
  final List<FeedbackItem> feedback;
  final int timestamp;

  const ComparisonResult({
    required this.overall,
    required this.widgetDiff,
    required this.pixelDiff,
    required this.regions,
    required this.feedback,
    required this.timestamp,
  });
}

class OverallScore {
  final double matchPercentage;
  final String grade; // A, B, C, D, F
  final String summary;

  const OverallScore({
    required this.matchPercentage,
    required this.grade,
    required this.summary,
  });
}

/// Widget diff result (Flutter equivalent of DOMDiffResult).
class WidgetDiffResult {
  final int matches;
  final List<WidgetPropertyMismatch> mismatches;
  final List<String> missing;
  final List<String> extra;
  final KeyCoverageMetric? keyCoverage;
  final List<KeySuggestion>? keySuggestions;

  const WidgetDiffResult({
    required this.matches,
    required this.mismatches,
    required this.missing,
    required this.extra,
    this.keyCoverage,
    this.keySuggestions,
  });
}

/// Suggested Key mapping from a keyless widget to a design node.
class KeySuggestion {
  final String nodeId;
  final String nodeName;
  final NodeType nodeType;
  final String? nodeText;
  final String widgetIdentifier;
  final String widgetType;
  final String? widgetText;
  final double confidence;
  final String reason;

  const KeySuggestion({
    required this.nodeId,
    required this.nodeName,
    required this.nodeType,
    this.nodeText,
    required this.widgetIdentifier,
    required this.widgetType,
    this.widgetText,
    required this.confidence,
    required this.reason,
  });

  Map<String, dynamic> toJson() => {
        'nodeId': nodeId,
        'nodeName': nodeName,
        'nodeType': nodeType.name,
        'nodeText': nodeText,
        'widgetIdentifier': widgetIdentifier,
        'widgetType': widgetType,
        'widgetText': widgetText,
        'confidence': confidence,
        'reason': reason,
        'suggestion': "Add key: Key('$nodeId') to $widgetIdentifier",
      };
}

/// Key coverage metric — how many design nodes have matching widget Keys.
class KeyCoverageMetric {
  final int expectedKeys;
  final int foundKeys;
  final int widgetCount;
  final double coverage;

  const KeyCoverageMetric({
    required this.expectedKeys,
    required this.foundKeys,
    required this.widgetCount,
    required this.coverage,
  });

  Map<String, dynamic> toJson() => {
        'expectedKeys': expectedKeys,
        'foundKeys': foundKeys,
        'widgetCount': widgetCount,
        'coverage': '${(coverage * 100).round()}%',
      };
}

class WidgetPropertyMismatch {
  final String widget; // Key or widget description
  final String property;
  final String expected;
  final String actual;
  final Severity severity;
  final String? fix;

  const WidgetPropertyMismatch({
    required this.widget,
    required this.property,
    required this.expected,
    required this.actual,
    required this.severity,
    this.fix,
  });
}

class PixelDiffResult {
  final int totalPixels;
  final int diffPixels;
  final double diffPercentage;
  final List<int>? diffImage; // PNG bytes
  final bool pixelComparisonRan;

  const PixelDiffResult({
    required this.totalPixels,
    required this.diffPixels,
    required this.diffPercentage,
    this.diffImage,
    required this.pixelComparisonRan,
  });
}

class DiffRegion {
  final Bounds bounds;
  final Severity severity;
  final DiffRegionType type;
  final String description;
  final double? deltaE;
  final String? element;

  const DiffRegion({
    required this.bounds,
    required this.severity,
    required this.type,
    required this.description,
    this.deltaE,
    this.element,
  });

  DiffRegion copyWith({Severity? severity}) {
    return DiffRegion(
      bounds: bounds,
      severity: severity ?? this.severity,
      type: type,
      description: description,
      deltaE: deltaE,
      element: element,
    );
  }
}

enum DiffRegionType { color, position, size, missing, extra, typography, rendering }

enum Severity { pass, warn, fail }

class FeedbackItem {
  final Severity severity;
  final FeedbackCategory category;
  final String message;
  final String? element;
  final String? fix;

  const FeedbackItem({
    required this.severity,
    required this.category,
    required this.message,
    this.element,
    this.fix,
  });
}

enum FeedbackCategory {
  color,
  spacing,
  typography,
  layout,
  size,
  missing,
  extra,
  rendering,
}
