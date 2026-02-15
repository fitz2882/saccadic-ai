/// Pencil.dev (.pen) file parser.
///
/// Parses .pen JSON into Saccadic's DesignState for comparison.
/// Five-phase synchronous pipeline:
///   1. Variable resolution
///   2. Component registry
///   3. Ref expansion
///   4. Layout computation
///   5. DesignNode conversion
library;
import 'dart:math' as math;

import '../core/types.dart';
import 'pencil_types.dart';

class PencilParseOptions {
  final String? frameName;
  final String? themeMode;

  const PencilParseOptions({this.frameName, this.themeMode});
}

/// Internal node with computed absolute position.
class _ComputedNode {
  final PenNode source;
  final double absX;
  final double absY;
  final double computedWidth;
  final double computedHeight;
  final List<_ComputedNode> computedChildren;

  _ComputedNode({
    required this.source,
    required this.absX,
    required this.absY,
    required this.computedWidth,
    required this.computedHeight,
    this.computedChildren = const [],
  });
}

class PencilParser {
  final _variables = <String, dynamic>{}; // string | number
  final _components = <String, PenNode>{};
  final _expandingRefs = <String>{};

  DesignState parse(PenFile penData, [PencilParseOptions? options]) {
    // Reset state
    _variables.clear();
    _components.clear();
    _expandingRefs.clear();

    // Phase 1: Variable resolution
    _resolveVariables(penData.variables, options?.themeMode);

    // Phase 2: Component registry
    _buildComponentRegistry(penData.children);

    // Phase 3: Ref expansion
    final expanded = penData.children.map(_expandRefs).toList();

    // Phase 3b: Resolve variable references in node properties
    final resolved = expanded.map(_resolveNodeVariables).toList();

    // Select target frame if specified
    var targetNodes = resolved;
    if (options?.frameName != null) {
      final frame = resolved.firstWhere(
        (n) => n.name == options!.frameName || n.id == options.frameName,
        orElse: () => resolved.first,
      );
      targetNodes = [frame];
    }

    // Phase 4: Layout computation
    final computed = targetNodes
        .map((n) => _computeLayout(n, 0, 0, null, null))
        .toList();

    // Phase 5: DesignNode conversion
    final designNodes = computed.expand(_toDesignNodes).toList();

    // Extract tokens
    final tokens = _extractTokens(penData.variables);

    // Compute viewport from top-level frame bounds
    final maxW = computed.fold<double>(
      0,
      (m, n) => math.max(m, n.absX + n.computedWidth),
    );
    final maxH = computed.fold<double>(
      0,
      (m, n) => math.max(m, n.absY + n.computedHeight),
    );

    return DesignState(
      id: 'pencil',
      name: options?.frameName ?? penData.version,
      viewport: Viewport(
        width: maxW > 0 ? maxW.round() : 1280,
        height: maxH > 0 ? maxH.round() : 800,
      ),
      nodes: designNodes,
      tokens: tokens,
    );
  }

  // ── Phase 1: Variable Resolution ──

  void _resolveVariables(Map<String, PenVariable>? variables, String? themeMode) {
    if (variables == null) return;
    for (final entry in variables.entries) {
      _variables[entry.key] = _resolveVariableValue(entry.value, themeMode);
    }
  }

  dynamic _resolveVariableValue(PenVariable variable, String? themeMode) {
    if (variable.value is List) {
      final themed = variable.value as List<PenThemedValue>;
      if (themeMode != null) {
        final match = themed.where(
          (tv) => tv.theme.values.any((v) => v == themeMode),
        );
        if (match.isNotEmpty) return match.first.value;
      }
      return themed.isNotEmpty ? themed.first.value : '';
    }
    return variable.value;
  }

  dynamic _resolveTokenRef(dynamic value) {
    if (value is! String) return value;
    if (!value.startsWith(r'$--')) return value;
    final varName = value.substring(1); // strip leading $
    return _variables[varName] ?? value;
  }

  // ── Phase 2: Component Registry ──

  void _buildComponentRegistry(List<PenNode> nodes) {
    for (final node in nodes) {
      if (node.reusable == true) {
        _components[node.id] = node;
      }
      if (node.children != null) {
        _buildComponentRegistry(node.children!);
      }
    }
  }

  // ── Phase 3: Ref Expansion ──

  PenNode _expandRefs(PenNode node) {
    if (node.type == 'ref' && node.ref != null) {
      if (_expandingRefs.contains(node.ref)) return node; // circular

      final prototype = _components[node.ref];
      if (prototype == null) return node;

      _expandingRefs.add(node.ref!);

      final clone = prototype.deepClone();

      // Override with instance properties
      if (node.x != null) clone.x = node.x;
      if (node.y != null) clone.y = node.y;
      if (node.width != null) clone.width = node.width;
      if (node.height != null) clone.height = node.height;
      if (node.fill != null) clone.fill = node.fill;
      if (node.name != null) clone.name = node.name;

      // Apply descendants overrides
      if (node.descendants != null && clone.children != null) {
        _applyDescendants(clone.children!, node.descendants!);
      }

      clone.type = 'ref';
      clone.id = node.id;

      // Recursively expand children
      if (clone.children != null) {
        clone.children = clone.children!.map(_expandRefs).toList();
      }

      _expandingRefs.remove(node.ref);
      return clone;
    }

    // Recursively expand children
    if (node.children != null) {
      return PenNode(
        type: node.type,
        id: node.id,
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        layout: node.layout,
        gap: node.gap,
        padding: node.padding,
        justifyContent: node.justifyContent,
        alignItems: node.alignItems,
        fill: node.fill,
        stroke: node.stroke,
        effect: node.effect,
        cornerRadius: node.cornerRadius,
        clip: node.clip,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        lineHeight: node.lineHeight,
        letterSpacing: node.letterSpacing,
        content: node.content,
        textGrowth: node.textGrowth,
        reusable: node.reusable,
        ref: node.ref,
        descendants: node.descendants,
        children: node.children!.map(_expandRefs).toList(),
      );
    }

    return node;
  }

  void _applyDescendants(
    List<PenNode> children,
    Map<String, Map<String, dynamic>> descendants,
  ) {
    for (final child in children) {
      final override = descendants[child.id];
      if (override != null) {
        child.applyOverrides(override);
      }
      if (child.children != null) {
        _applyDescendants(child.children!, descendants);
      }
    }
  }

  // ── Phase 3b: Resolve Variable References ──

  PenNode _resolveNodeVariables(PenNode node) {
    final resolved = node.deepClone();

    if (resolved.fill is String) {
      resolved.fill = _resolveTokenRef(resolved.fill)?.toString() ?? resolved.fill;
    }
    if (resolved.fontSize is String) {
      final ref = _resolveTokenRef(resolved.fontSize);
      if (ref is num) {
        resolved.fontSize = ref.toDouble();
      } else if (ref is String) {
        final n = double.tryParse(ref);
        if (n != null) resolved.fontSize = n;
      }
    }
    if (resolved.fontFamily is String) {
      resolved.fontFamily = _resolveTokenRef(resolved.fontFamily)?.toString() ?? resolved.fontFamily;
    }
    if (resolved.fontWeight is String) {
      final ref = _resolveTokenRef(resolved.fontWeight);
      if (ref is num) {
        resolved.fontWeight = ref.toInt();
      } else if (ref is String) {
        final n = int.tryParse(ref);
        if (n != null) resolved.fontWeight = n;
      }
    }
    if (resolved.cornerRadius is String) {
      final ref = _resolveTokenRef(resolved.cornerRadius);
      if (ref is num) {
        resolved.cornerRadius = ref.toDouble();
      } else if (ref is String) {
        final n = double.tryParse(ref);
        if (n != null) resolved.cornerRadius = n;
      }
    }

    if (resolved.children != null) {
      resolved.children = resolved.children!.map(_resolveNodeVariables).toList();
    }

    return resolved;
  }

  // ── Phase 4: Layout Computation ──

  _ComputedNode _computeLayout(
    PenNode node,
    double parentAbsX,
    double parentAbsY,
    double? parentContentWidth,
    double? parentContentHeight,
  ) {
    final padding = _normalizePadding(node.padding);
    final gap = node.gap ?? 0;

    var width = _resolveSize(node.width, parentContentWidth);
    var height = _resolveSize(node.height, parentContentHeight);

    // Text node height estimation
    if (node.type == 'text') {
      final fontSize = (node.fontSize is num) ? (node.fontSize as num).toDouble() : 16.0;
      final lh = node.lineHeight ?? 1.2;
      if (height == 0) height = fontSize * lh;
    }

    final absX = parentAbsX + (node.x ?? 0);
    final absY = parentAbsY + (node.y ?? 0);

    final contentWidth = math.max(0.0, width - padding.left - padding.right);
    final contentHeight = math.max(0.0, height - padding.top - padding.bottom);

    final layoutMode = node.layout; // 'vertical' | 'none' | null (horizontal)
    final computedChildren = <_ComputedNode>[];

    if (node.children != null && node.children!.isNotEmpty) {
      var cursor = 0.0;

      for (var i = 0; i < node.children!.length; i++) {
        final child = node.children![i];
        double childParentAbsX;
        double childParentAbsY;

        if (layoutMode == 'none') {
          childParentAbsX = absX + padding.left;
          childParentAbsY = absY + padding.top;
        } else if (layoutMode == 'vertical') {
          childParentAbsX = absX + padding.left;
          childParentAbsY = absY + padding.top + cursor;
        } else {
          // Default: horizontal
          childParentAbsX = absX + padding.left + cursor;
          childParentAbsY = absY + padding.top;
        }

        final computed = _computeLayout(
          child,
          childParentAbsX,
          childParentAbsY,
          contentWidth,
          contentHeight,
        );
        computedChildren.add(computed);

        if (layoutMode != 'none') {
          final childExtent = layoutMode == 'vertical'
              ? computed.computedHeight
              : computed.computedWidth;
          cursor += childExtent + (i < node.children!.length - 1 ? gap : 0);
        }
      }

      // fit_content: shrink to children
      if (_isFitContent(node.width)) {
        final childrenExtent = layoutMode == 'vertical'
            ? computedChildren.fold<double>(0, (m, c) => math.max(m, c.computedWidth))
            : cursor;
        final fitWidth = childrenExtent + padding.left + padding.right;
        final maxFit = _getFitContentMax(node.width);
        width = maxFit != null ? math.min(maxFit, fitWidth) : fitWidth;
      }
      if (_isFitContent(node.height)) {
        final childrenExtent = layoutMode == 'vertical'
            ? cursor
            : computedChildren.fold<double>(0, (m, c) => math.max(m, c.computedHeight));
        final fitHeight = childrenExtent + padding.top + padding.bottom;
        final maxFit = _getFitContentMax(node.height);
        height = maxFit != null ? math.min(maxFit, fitHeight) : fitHeight;
      }
    }

    return _ComputedNode(
      source: node,
      absX: absX,
      absY: absY,
      computedWidth: width,
      computedHeight: height,
      computedChildren: computedChildren,
    );
  }

  double _resolveSize(dynamic size, double? parentSize) {
    if (size == null) return 0;
    if (size is num) return size.toDouble();
    if (size is! String) return 0;

    if (size == 'fill_container') return parentSize ?? 0;

    final fillMatch = RegExp(r'^fill_container\((\d+)\)$').firstMatch(size);
    if (fillMatch != null) {
      final maxVal = double.parse(fillMatch.group(1)!);
      return parentSize != null ? math.min(maxVal, parentSize) : maxVal;
    }

    if (size.startsWith('fit_content')) return 0; // resolved after children

    return 0;
  }

  bool _isFitContent(dynamic size) {
    return size is String && size.startsWith('fit_content');
  }

  double? _getFitContentMax(dynamic size) {
    if (size is! String) return null;
    final match = RegExp(r'^fit_content\((\d+)\)$').firstMatch(size);
    return match != null ? double.parse(match.group(1)!) : null;
  }

  Spacing _normalizePadding(dynamic padding) {
    if (padding == null) return const Spacing(top: 0, right: 0, bottom: 0, left: 0);
    if (padding is num) return Spacing.all(padding.toDouble());
    if (padding is List) {
      final values = padding.map((v) => (v as num).toDouble()).toList();
      if (values.length == 2) {
        return Spacing(top: values[0], right: values[1], bottom: values[0], left: values[1]);
      }
      if (values.length == 4) {
        return Spacing(top: values[0], right: values[1], bottom: values[2], left: values[3]);
      }
    }
    return const Spacing(top: 0, right: 0, bottom: 0, left: 0);
  }

  // ── Phase 5: DesignNode Conversion ──

  List<DesignNode> _toDesignNodes(_ComputedNode node) {
    final type = _mapNodeType(node.source.type);
    final bounds = Bounds(
      x: node.absX,
      y: node.absY,
      width: node.computedWidth,
      height: node.computedHeight,
    );

    final fills = _parseFills(node.source.fill);
    final padding = _normalizePadding(node.source.padding);
    final typography = _parseTypography(node.source);

    final children = node.computedChildren.expand(_toDesignNodes).toList();

    LayoutMode? layoutMode;
    if (node.source.layout == 'vertical') {
      layoutMode = LayoutMode.vertical;
    } else if (node.source.layout == 'none') {
      layoutMode = LayoutMode.none;
    } else if (node.source.children != null && node.source.children!.isNotEmpty) {
      layoutMode = LayoutMode.horizontal;
    }

    final cornerRadius = node.source.cornerRadius is num
        ? CornerRadius.all((node.source.cornerRadius as num).toDouble())
        : null;

    return [
      DesignNode(
        id: node.source.id,
        name: node.source.name ?? node.source.id,
        type: type,
        bounds: bounds,
        fills: fills,
        typography: typography,
        textContent: node.source.content,
        padding: padding.isZero ? null : padding,
        gap: node.source.gap,
        cornerRadius: cornerRadius,
        layoutMode: layoutMode,
        children: children,
      ),
    ];
  }

  NodeType _mapNodeType(String penType) {
    switch (penType) {
      case 'frame':
        return NodeType.frame;
      case 'text':
        return NodeType.text;
      case 'rectangle':
        return NodeType.rectangle;
      case 'ellipse':
        return NodeType.ellipse;
      case 'ref':
        return NodeType.instance;
      case 'image':
        return NodeType.image;
      case 'icon_font':
      case 'path':
      case 'line':
        return NodeType.vector;
      default:
        return NodeType.frame;
    }
  }

  List<Fill>? _parseFills(dynamic fill) {
    if (fill == null) return null;
    if (fill is String) {
      if (fill == 'transparent' || fill.isEmpty) return null;
      return [Fill(type: FillType.solid, color: fill)];
    }
    if (fill is Map) {
      if (fill['enabled'] == false) return null;
      return [Fill(type: FillType.solid, color: fill['color'] as String?)];
    }
    return null;
  }

  Typography? _parseTypography(PenNode node) {
    if (node.fontFamily == null && node.fontSize == null) return null;

    final fontSize = (node.fontSize is num) ? (node.fontSize as num).toDouble() : 16.0;
    final lhMultiplier = node.lineHeight ?? 1.2;

    String? color;
    if (node.type == 'text' && node.fill != null) {
      if (node.fill is String && node.fill != 'transparent' && (node.fill as String).isNotEmpty) {
        color = node.fill as String;
      } else if (node.fill is Map && (node.fill as Map)['color'] != null) {
        color = (node.fill as Map)['color'] as String;
      }
    }

    return Typography(
      fontFamily: node.fontFamily is String ? node.fontFamily as String : 'Inter',
      fontSize: fontSize,
      fontWeight: node.fontWeight is num ? (node.fontWeight as num).toInt() : 400,
      lineHeight: lhMultiplier * fontSize,
      letterSpacing: node.letterSpacing,
      color: color,
    );
  }

  DesignTokens? _extractTokens(Map<String, PenVariable>? variables) {
    if (variables == null || variables.isEmpty) return null;

    final colors = <String, String>{};
    final spacing = <String, String>{};
    final typography = <String, TypographyToken>{};
    final radii = <String, String>{};

    for (final entry in variables.entries) {
      final name = entry.key;
      final variable = entry.value;
      final value = _variables[name];
      if (value == null) continue;
      final strValue = value.toString();

      if (variable.type == 'color') {
        colors[name] = strValue;
      } else if (variable.type == 'number') {
        final lower = name.toLowerCase();
        if (lower.contains('radius') || lower.contains('round')) {
          radii[name] = strValue;
        } else {
          spacing[name] = strValue;
        }
      } else if (variable.type == 'string') {
        final lower = name.toLowerCase();
        if (lower.contains('font')) {
          typography[name] = TypographyToken(
            fontFamily: strValue,
            fontSize: '',
            fontWeight: '',
            lineHeight: '',
          );
        }
      }
    }

    return DesignTokens(
      colors: colors,
      spacing: spacing,
      typography: typography,
      radii: radii,
    );
  }

  // ── Utility Methods ──

  /// List top-level named frames in a .pen file (for multi-page discovery).
  List<({String id, String name, int width, int height})> listFrames(PenFile penData) {
    return penData.children
        .where((c) => c.type == 'frame' && c.name != null)
        .map((c) => (
              id: c.id,
              name: c.name ?? c.id,
              width: c.width is num ? (c.width as num).round() : 0,
              height: c.height is num ? (c.height as num).round() : 0,
            ),)
        .toList();
  }

  /// Generate a human-readable tree description of design nodes.
  String describeNodeTree(List<DesignNode> nodes) {
    final lines = <String>[];

    void walk(DesignNode node, String prefix, bool isLast) {
      final connector = prefix.isEmpty ? '' : (isLast ? '└── ' : '├── ');
      final childPrefix = prefix.isEmpty ? '' : prefix + (isLast ? '    ' : '│   ');

      final props = <String>[];
      props.add('${node.bounds.width.round()}×${node.bounds.height.round()}');

      if (node.fills != null && node.fills!.isNotEmpty) {
        final solidFill = node.fills!.where((f) => f.type == FillType.solid && f.color != null).firstOrNull;
        if (solidFill != null) props.add('bg: ${solidFill.color}');
      }
      if (node.typography != null) {
        props.add('fontSize: ${node.typography!.fontSize}');
        if (node.typography!.fontWeight != 400) {
          props.add('fontWeight: ${node.typography!.fontWeight}');
        }
        if (node.typography!.color != null) props.add('color: ${node.typography!.color}');
      }
      if (node.cornerRadius != null && node.cornerRadius!.uniform > 0) {
        props.add('borderRadius: ${node.cornerRadius!.uniform}');
      }
      if (node.layoutMode != null && node.layoutMode != LayoutMode.none) {
        props.add('layout: ${node.layoutMode!.name}');
      }
      if (node.gap != null) props.add('gap: ${node.gap}');

      final textSnippet = node.textContent != null
          ? ' "${node.textContent!.length > 50 ? '${node.textContent!.substring(0, 47)}...' : node.textContent}"'
          : '';

      lines.add('$prefix$connector${node.type.name.toUpperCase()} "${node.name}"$textSnippet (${props.join(', ')})');

      for (var i = 0; i < node.children.length; i++) {
        walk(node.children[i], childPrefix, i == node.children.length - 1);
      }
    }

    for (var i = 0; i < nodes.length; i++) {
      walk(nodes[i], '', i == nodes.length - 1);
    }
    return lines.join('\n');
  }

  /// Flatten all node IDs from a DesignNode tree.
  List<({String id, String name, String type, String? textContent})> flattenNodeIds(List<DesignNode> nodes) {
    final result = <({String id, String name, String type, String? textContent})>[];
    void walk(DesignNode node) {
      result.add((id: node.id, name: node.name, type: node.type.name, textContent: node.textContent));
      for (final child in node.children) {
        walk(child);
      }
    }
    for (final node in nodes) {
      walk(node);
    }
    return result;
  }
}
