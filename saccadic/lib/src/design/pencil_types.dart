/// Type definitions for Pencil.dev (.pen) design files.
///
/// .pen files are plain UTF-8 JSON with a tree of design nodes,
/// optional variables (design tokens), and component definitions.
library;

/// Root .pen file structure.
class PenFile {
  final String version;
  final List<PenNode> children;
  final Map<String, PenVariable>? variables;

  PenFile({
    required this.version,
    required this.children,
    this.variables,
  });

  factory PenFile.fromJson(Map<String, dynamic> json) {
    return PenFile(
      version: json['version'] as String? ?? '',
      children: (json['children'] as List<dynamic>?)
              ?.map((c) => PenNode.fromJson(c as Map<String, dynamic>))
              .toList() ??
          [],
      variables: json['variables'] != null
          ? (json['variables'] as Map<String, dynamic>).map(
              (k, v) => MapEntry(k, PenVariable.fromJson(v as Map<String, dynamic>)),
            )
          : null,
    );
  }
}

/// A node in the .pen tree.
class PenNode {
  String type; // 'frame', 'text', 'rectangle', 'ellipse', 'path', 'line', 'image', 'icon_font', 'ref'
  String id;
  String? name;
  double? x;
  double? y;
  dynamic width; // number | string ('fill_container', 'fit_content', etc.)
  dynamic height;
  String? layout; // 'vertical' | 'none' | null (horizontal)
  double? gap;
  dynamic padding; // number | [number, number] | [number, number, number, number]
  String? justifyContent;
  String? alignItems;
  dynamic fill; // string | PenFillObject
  Map<String, dynamic>? stroke;
  Map<String, dynamic>? effect;
  dynamic cornerRadius; // number | string (var ref)
  bool? clip;
  // Typography
  dynamic fontFamily; // string
  dynamic fontSize; // number | string (var ref)
  dynamic fontWeight; // number | string (var ref)
  double? lineHeight;
  double? letterSpacing;
  String? content;
  String? textGrowth;
  // Components
  bool? reusable;
  String? ref;
  Map<String, Map<String, dynamic>>? descendants;
  List<PenNode>? children;

  PenNode({
    required this.type,
    required this.id,
    this.name,
    this.x,
    this.y,
    this.width,
    this.height,
    this.layout,
    this.gap,
    this.padding,
    this.justifyContent,
    this.alignItems,
    this.fill,
    this.stroke,
    this.effect,
    this.cornerRadius,
    this.clip,
    this.fontFamily,
    this.fontSize,
    this.fontWeight,
    this.lineHeight,
    this.letterSpacing,
    this.content,
    this.textGrowth,
    this.reusable,
    this.ref,
    this.descendants,
    this.children,
  });

  factory PenNode.fromJson(Map<String, dynamic> json) {
    return PenNode(
      type: json['type'] as String? ?? 'frame',
      id: json['id'] as String? ?? '',
      name: json['name'] as String?,
      x: (json['x'] as num?)?.toDouble(),
      y: (json['y'] as num?)?.toDouble(),
      width: json['width'], // keep dynamic
      height: json['height'],
      layout: json['layout'] as String?,
      gap: (json['gap'] as num?)?.toDouble(),
      padding: json['padding'], // keep dynamic
      justifyContent: json['justifyContent'] as String?,
      alignItems: json['alignItems'] as String?,
      fill: json['fill'],
      stroke: json['stroke'] as Map<String, dynamic>?,
      effect: json['effect'] as Map<String, dynamic>?,
      cornerRadius: json['cornerRadius'],
      clip: json['clip'] as bool?,
      fontFamily: json['fontFamily'],
      fontSize: json['fontSize'],
      fontWeight: json['fontWeight'],
      lineHeight: (json['lineHeight'] as num?)?.toDouble(),
      letterSpacing: (json['letterSpacing'] as num?)?.toDouble(),
      content: json['content'] as String?,
      textGrowth: json['textGrowth'] as String?,
      reusable: json['reusable'] as bool?,
      ref: json['ref'] as String?,
      descendants: json['descendants'] != null
          ? (json['descendants'] as Map<String, dynamic>).map(
              (k, v) => MapEntry(k, v as Map<String, dynamic>),
            )
          : null,
      children: (json['children'] as List<dynamic>?)
          ?.map((c) => PenNode.fromJson(c as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Deep clone this node.
  PenNode deepClone() {
    return PenNode(
      type: type,
      id: id,
      name: name,
      x: x,
      y: y,
      width: width,
      height: height,
      layout: layout,
      gap: gap,
      padding: _clonePadding(padding),
      justifyContent: justifyContent,
      alignItems: alignItems,
      fill: _cloneFill(fill),
      stroke: stroke != null ? Map<String, dynamic>.from(stroke!) : null,
      effect: effect != null ? Map<String, dynamic>.from(effect!) : null,
      cornerRadius: cornerRadius,
      clip: clip,
      fontFamily: fontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      lineHeight: lineHeight,
      letterSpacing: letterSpacing,
      content: content,
      textGrowth: textGrowth,
      reusable: reusable,
      ref: ref,
      descendants: descendants?.map((k, v) => MapEntry(k, Map<String, dynamic>.from(v))),
      children: children?.map((c) => c.deepClone()).toList(),
    );
  }

  static dynamic _clonePadding(dynamic p) {
    if (p is List) return List<dynamic>.from(p);
    return p;
  }

  static dynamic _cloneFill(dynamic f) {
    if (f is Map) return Map<String, dynamic>.from(f);
    return f;
  }

  /// Apply partial overrides from a JSON map.
  void applyOverrides(Map<String, dynamic> overrides) {
    if (overrides.containsKey('x')) x = (overrides['x'] as num?)?.toDouble();
    if (overrides.containsKey('y')) y = (overrides['y'] as num?)?.toDouble();
    if (overrides.containsKey('width')) width = overrides['width'];
    if (overrides.containsKey('height')) height = overrides['height'];
    if (overrides.containsKey('fill')) fill = overrides['fill'];
    if (overrides.containsKey('name')) name = overrides['name'] as String?;
    if (overrides.containsKey('content')) content = overrides['content'] as String?;
    if (overrides.containsKey('fontSize')) fontSize = overrides['fontSize'];
    if (overrides.containsKey('fontWeight')) fontWeight = overrides['fontWeight'];
    if (overrides.containsKey('fontFamily')) fontFamily = overrides['fontFamily'];
    if (overrides.containsKey('cornerRadius')) cornerRadius = overrides['cornerRadius'];
    if (overrides.containsKey('padding')) padding = overrides['padding'];
    if (overrides.containsKey('gap')) gap = (overrides['gap'] as num?)?.toDouble();
    if (overrides.containsKey('layout')) layout = overrides['layout'] as String?;
  }
}

class PenVariable {
  final String type; // 'color' | 'string' | 'number'
  final dynamic value; // string | number | List<PenThemedValue>

  PenVariable({required this.type, required this.value});

  factory PenVariable.fromJson(Map<String, dynamic> json) {
    final rawValue = json['value'];
    dynamic value;
    if (rawValue is List) {
      value = rawValue
          .map((v) => PenThemedValue.fromJson(v as Map<String, dynamic>))
          .toList();
    } else {
      value = rawValue;
    }
    return PenVariable(
      type: json['type'] as String? ?? 'string',
      value: value,
    );
  }
}

class PenThemedValue {
  final dynamic value; // string | number
  final Map<String, String> theme;

  PenThemedValue({required this.value, required this.theme});

  factory PenThemedValue.fromJson(Map<String, dynamic> json) {
    return PenThemedValue(
      value: json['value'],
      theme: (json['theme'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, v.toString()),
          ) ??
          {},
    );
  }
}
