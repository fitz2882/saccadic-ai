/// Extracted widget properties from Flutter VM service.
///
/// Represents the visual properties of a Flutter widget as inspected
/// via the VM service protocol, analogous to CSS computed styles.
library;
import '../core/types.dart';

/// A Flutter widget's visual properties extracted from the render tree.
class WidgetStyle {
  /// The widget's Key value (equivalent to data-pen-id).
  final String? key;

  /// Widget class name (e.g., 'Container', 'Text', 'Column').
  final String widgetType;

  /// Bounding box in screen coordinates.
  final Bounds bounds;

  /// Background color (from BoxDecoration, Container color, etc.).
  final String? backgroundColor;

  /// Text color (from TextStyle).
  final String? textColor;

  /// Font size.
  final double? fontSize;

  /// Font weight (100-900).
  final int? fontWeight;

  /// Font family.
  final String? fontFamily;

  /// Line height (in pixels).
  final double? lineHeight;

  /// Letter spacing.
  final double? letterSpacing;

  /// Text content (for Text widgets).
  final String? textContent;

  /// Padding (from EdgeInsets).
  final Spacing? padding;

  /// Gap (from Column/Row spacing or SizedBox between children).
  final double? gap;

  /// Corner radius (from BorderRadius).
  final CornerRadius? cornerRadius;

  /// Layout direction.
  final LayoutMode? layoutDirection;

  /// Number of children.
  final int childCount;

  /// Widget description for feedback messages.
  final String description;

  /// Parent widget key (for cascade analysis).
  final String? parentKey;

  const WidgetStyle({
    this.key,
    required this.widgetType,
    required this.bounds,
    this.backgroundColor,
    this.textColor,
    this.fontSize,
    this.fontWeight,
    this.fontFamily,
    this.lineHeight,
    this.letterSpacing,
    this.textContent,
    this.padding,
    this.gap,
    this.cornerRadius,
    this.layoutDirection,
    this.childCount = 0,
    required this.description,
    this.parentKey,
  });

  /// Returns a concise identifier for feedback messages.
  String get identifier {
    if (key != null) return "Key('$key')";
    return '$widgetType(${bounds.x.round()},${bounds.y.round()})';
  }

  /// Whether this is a text-like widget.
  bool get isText {
    const textWidgets = {'Text', 'RichText', 'SelectableText', 'EditableText'};
    return textWidgets.contains(widgetType);
  }

  /// Whether this is a container-like widget.
  bool get isContainer {
    const containerWidgets = {
      'Container',
      'DecoratedBox',
      'Card',
      'Material',
      'Scaffold',
      'AppBar',
      'Column',
      'Row',
      'Stack',
      'Flex',
      'Wrap',
      'ListView',
      'GridView',
      'SizedBox',
      'Padding',
    };
    return containerWidgets.contains(widgetType);
  }
}

/// A matched pair of design node and widget for comparison.
class WidgetMatch {
  final WidgetStyle widget;
  final DesignNode designNode;
  final double confidence;

  const WidgetMatch({
    required this.widget,
    required this.designNode,
    required this.confidence,
  });
}
