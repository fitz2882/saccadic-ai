/// Widget Comparator — 5-pass matching algorithm for Flutter widgets.
///
/// Matches Flutter widgets to design nodes using the same algorithm
/// as the DOM comparator, adapted for Flutter's widget types.
library;
import 'dart:math' as math;

import '../core/color_science.dart';
import '../core/thresholds.dart';
import '../core/types.dart';
import '../flutter/widget_style.dart';

/// Structural fingerprint for component matching (Pass 0.5).
class _StructuralFingerprint {
  final int childCount;
  final List<String> childTypes;
  final bool hasText;
  final bool hasBg;
  final double aspectRatio;
  final double area;

  _StructuralFingerprint({
    required this.childCount,
    required this.childTypes,
    required this.hasText,
    required this.hasBg,
    required this.aspectRatio,
    required this.area,
  });
}

class WidgetComparator {
  /// Match Flutter widgets to design nodes and compare properties.
  WidgetDiffResult compare(
    List<WidgetStyle> widgets,
    List<DesignNode> designNodes,
  ) {
    final flatNodes = _flattenDesignNodes(designNodes);
    final matches = matchWidgets(widgets, flatNodes);
    final mismatches = <WidgetPropertyMismatch>[];
    final matchedWidgetIds = <String>{};
    final matchedDesignIds = <String>{};

    for (final match in matches) {
      mismatches.addAll(compareProperties(match.widget, match.designNode));
      matchedWidgetIds.add(match.widget.identifier);
      matchedDesignIds.add(match.designNode.id);
    }

    final missing = flatNodes
        .where((n) => !matchedDesignIds.contains(n.id))
        .map((n) => n.name)
        .toList();

    final extra = widgets
        .where((w) => !matchedWidgetIds.contains(w.identifier))
        .map((w) => w.identifier)
        .toList();

    // Key coverage metric
    final expectedKeys = flatNodes.length;
    final foundKeys = widgets.where((w) {
      if (w.key == null) return false;
      return flatNodes.any((n) => n.id == w.key || n.name == w.key);
    }).length;
    final keyCoverage = KeyCoverageMetric(
      expectedKeys: expectedKeys,
      foundKeys: foundKeys,
      widgetCount: widgets.length,
      coverage: expectedKeys > 0 ? foundKeys / expectedKeys : 0,
    );

    // Suggest key mappings when coverage is low
    List<KeySuggestion>? keySuggestions;
    if (keyCoverage.coverage < 0.2) {
      keySuggestions = suggestKeyMappings(widgets, flatNodes);
    }

    return WidgetDiffResult(
      matches: matches.length,
      mismatches: mismatches,
      missing: missing,
      extra: extra,
      keyCoverage: keyCoverage,
      keySuggestions: keySuggestions,
    );
  }

  /// Suggest Key('nodeId') mappings for keyless widgets.
  ///
  /// Runs 3 passes: text matching, structural fingerprinting, type+visual.
  /// Returns suggestions sorted by confidence descending.
  List<KeySuggestion> suggestKeyMappings(
    List<WidgetStyle> widgets,
    List<DesignNode> designNodes,
  ) {
    final suggestions = <KeySuggestion>[];
    final usedNodeIds = <String>{};
    final usedWidgetIds = <String>{};

    // Only consider keyless widgets, excluding framework scaffolding
    final keylessWidgets = widgets
        .where((w) => w.key == null && !_isFrameworkWidget(w.widgetType))
        .toList();

    // Pass 1: Text matching (highest confidence)
    for (final node in designNodes) {
      if (usedNodeIds.contains(node.id)) continue;
      if (node.textContent == null || node.textContent!.isEmpty) continue;

      final designText = _normalizeText(node.textContent!);
      if (designText.isEmpty) continue;

      KeySuggestion? bestSuggestion;
      var bestSim = 0.0;

      for (final widget in keylessWidgets) {
        if (usedWidgetIds.contains(widget.identifier)) continue;
        if (widget.textContent == null || widget.textContent!.isEmpty) continue;

        final widgetText = _normalizeText(widget.textContent!);
        if (widgetText.isEmpty) continue;

        double sim;
        if (designText == widgetText) {
          sim = 1.0;
        } else if (widgetText.contains(designText) || designText.contains(widgetText)) {
          sim = 0.9;
        } else {
          sim = _levenshteinSimilarity(designText, widgetText);
        }

        if (sim >= 0.7 && sim > bestSim) {
          bestSim = sim;
          final truncatedText = node.textContent!.length > 40
              ? '${node.textContent!.substring(0, 37)}...'
              : node.textContent!;
          bestSuggestion = KeySuggestion(
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            nodeText: node.textContent,
            widgetIdentifier: widget.identifier,
            widgetType: widget.widgetType,
            widgetText: widget.textContent,
            confidence: sim,
            reason: 'Text match: "$truncatedText"',
          );
        }
      }

      if (bestSuggestion != null) {
        suggestions.add(bestSuggestion);
        usedNodeIds.add(node.id);
        usedWidgetIds.add(bestSuggestion.widgetIdentifier);
      }
    }

    // Pass 2: Structural fingerprinting (medium confidence)
    for (final node in designNodes) {
      if (usedNodeIds.contains(node.id)) continue;
      if (node.children.isEmpty) continue;

      final designFP = _designNodeFingerprint(node);
      KeySuggestion? bestSuggestion;
      var bestScore = 0.0;

      for (final widget in keylessWidgets) {
        if (usedWidgetIds.contains(widget.identifier)) continue;

        final widgetFP = _widgetFingerprint(widget, widgets);
        final fpScore = _fingerprintSimilarity(designFP, widgetFP);

        if (fpScore > 0.4 && fpScore > bestScore) {
          bestScore = fpScore;
          bestSuggestion = KeySuggestion(
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            nodeText: node.textContent,
            widgetIdentifier: widget.identifier,
            widgetType: widget.widgetType,
            widgetText: widget.textContent,
            confidence: fpScore * 0.8, // scale down vs text match
            reason: 'Structural match: ${node.children.length} children, '
                '${node.type.name} type',
          );
        }
      }

      if (bestSuggestion != null) {
        suggestions.add(bestSuggestion);
        usedNodeIds.add(node.id);
        usedWidgetIds.add(bestSuggestion.widgetIdentifier);
      }
    }

    // Pass 3: Type + visual similarity (lower confidence)
    for (final node in designNodes) {
      if (usedNodeIds.contains(node.id)) continue;

      KeySuggestion? bestSuggestion;
      var bestScore = 0.0;

      for (final widget in keylessWidgets) {
        if (usedWidgetIds.contains(widget.identifier)) continue;

        final typeScore = _typeCompatibility(node.type, widget.widgetType);
        final colorScore = _colorSimilarity(node, widget);
        final sizeScore = _sizeSimilarity(node.bounds, widget.bounds);

        final score = typeScore * 0.5 + colorScore * 0.3 + sizeScore * 0.2;

        if (!score.isNaN && score > 0.4 && score > bestScore) {
          bestScore = score;
          bestSuggestion = KeySuggestion(
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            nodeText: node.textContent,
            widgetIdentifier: widget.identifier,
            widgetType: widget.widgetType,
            widgetText: widget.textContent,
            confidence: score * 0.6, // scale down further
            reason: 'Type+visual match: ${node.type.name} ↔ ${widget.widgetType}',
          );
        }
      }

      if (bestSuggestion != null) {
        suggestions.add(bestSuggestion);
        usedNodeIds.add(node.id);
        usedWidgetIds.add(bestSuggestion.widgetIdentifier);
      }
    }

    suggestions.sort((a, b) => b.confidence.compareTo(a.confidence));
    return suggestions;
  }

  /// 5-pass widget matching algorithm.
  List<WidgetMatch> matchWidgets(
    List<WidgetStyle> widgets,
    List<DesignNode> designNodes,
  ) {
    final matches = <WidgetMatch>[];
    final usedDesignIds = <String>{};
    final usedWidgetIds = <String>{};

    // Pass 0: Exact Key match (Key('nodeId') ↔ designNode.id or .name)
    for (final widget in widgets) {
      if (widget.key == null) continue;
      for (final node in designNodes) {
        if (usedDesignIds.contains(node.id)) continue;
        if (widget.key == node.id || widget.key == node.name) {
          matches.add(WidgetMatch(
            widget: widget,
            designNode: node,
            confidence: 1.0,
          ),);
          usedDesignIds.add(node.id);
          usedWidgetIds.add(widget.identifier);
          break;
        }
      }
    }

    // Pass 0.5: Structural fingerprinting
    for (final node in designNodes) {
      if (usedDesignIds.contains(node.id)) continue;
      if (node.children.isEmpty) continue;

      final designFP = _designNodeFingerprint(node);
      WidgetMatch? bestMatch;
      var bestScore = 0.0;

      for (final widget in widgets) {
        if (usedWidgetIds.contains(widget.identifier)) continue;

        final widgetFP = _widgetFingerprint(widget, widgets);
        final fpScore = _fingerprintSimilarity(designFP, widgetFP);
        final iou = widget.bounds.iou(node.bounds);
        final combined = fpScore * 0.6 + math.min(iou * 2, 1.0) * 0.4;

        if (combined > 0.55 && combined > bestScore) {
          bestScore = combined;
          bestMatch = WidgetMatch(
            widget: widget,
            designNode: node,
            confidence: combined,
          );
        }
      }

      if (bestMatch != null) {
        matches.add(bestMatch);
        usedDesignIds.add(node.id);
        usedWidgetIds.add(bestMatch.widget.identifier);
      }
    }

    // Pass 1: Strong IoU matches (> 0.5)
    for (final widget in widgets) {
      if (usedWidgetIds.contains(widget.identifier)) continue;
      WidgetMatch? bestMatch;

      for (final node in designNodes) {
        if (usedDesignIds.contains(node.id)) continue;
        final iou = widget.bounds.iou(node.bounds);
        if (iou > 0.5 && (bestMatch == null || iou > bestMatch.confidence)) {
          bestMatch = WidgetMatch(
            widget: widget,
            designNode: node,
            confidence: iou,
          );
        }
      }

      if (bestMatch != null) {
        matches.add(bestMatch);
        usedDesignIds.add(bestMatch.designNode.id);
        usedWidgetIds.add(widget.identifier);
      }
    }

    // Pass 2: Text content matching with fuzzy support
    for (final node in designNodes) {
      if (usedDesignIds.contains(node.id)) continue;
      if (node.type != NodeType.text || node.textContent == null) continue;

      WidgetMatch? bestMatch;
      var bestIoU = -1.0;

      for (final widget in widgets) {
        if (usedWidgetIds.contains(widget.identifier)) continue;
        if (widget.textContent == null) continue;

        final designText = _normalizeText(node.textContent!);
        final widgetText = _normalizeText(widget.textContent!);
        if (designText.isEmpty || widgetText.isEmpty) continue;

        var isMatch = designText == widgetText ||
            widgetText.contains(designText) ||
            designText.contains(widgetText);

        if (!isMatch) {
          isMatch = _levenshteinSimilarity(designText, widgetText) >= 0.8;
        }

        if (isMatch) {
          final iou = widget.bounds.iou(node.bounds);
          if (iou > bestIoU) {
            bestIoU = iou;
            bestMatch = WidgetMatch(
              widget: widget,
              designNode: node,
              confidence: 0.85,
            );
          }
        }
      }

      if (bestMatch != null) {
        matches.add(bestMatch);
        usedDesignIds.add(node.id);
        usedWidgetIds.add(bestMatch.widget.identifier);
      }
    }

    // Pass 3: Type + visual similarity scoring
    for (final node in designNodes) {
      if (usedDesignIds.contains(node.id)) continue;

      WidgetMatch? bestMatch;
      var bestScore = 0.0;

      for (final widget in widgets) {
        if (usedWidgetIds.contains(widget.identifier)) continue;

        final iou = widget.bounds.iou(node.bounds);
        if (iou == 0) continue;

        final typeScore = _typeCompatibility(node.type, widget.widgetType);
        final colorScore = _colorSimilarity(node, widget);
        final sizeScore = _sizeSimilarity(node.bounds, widget.bounds);

        final score = typeScore * 0.3 +
            colorScore * 0.25 +
            sizeScore * 0.25 +
            math.min(iou * 2, 1.0) * 0.2;

        if (!score.isNaN && score > 0.4 && score > bestScore) {
          bestScore = score;
          bestMatch = WidgetMatch(
            widget: widget,
            designNode: node,
            confidence: score,
          );
        }
      }

      if (bestMatch != null) {
        matches.add(bestMatch);
        usedDesignIds.add(node.id);
        usedWidgetIds.add(bestMatch.widget.identifier);
      }
    }

    return matches;
  }

  /// Compare individual properties between a widget and design node.
  List<WidgetPropertyMismatch> compareProperties(
    WidgetStyle widget,
    DesignNode designNode,
  ) {
    final mismatches = <WidgetPropertyMismatch>[];
    final identifier = widget.identifier;

    // Compare background color (skip for text nodes)
    if (designNode.fills != null &&
        designNode.fills!.isNotEmpty &&
        designNode.type != NodeType.text) {
      final fill = designNode.fills!.first;
      if (fill.type == FillType.solid && fill.color != null && widget.backgroundColor != null) {
        if (!colorsMatch(fill.color!, widget.backgroundColor!)) {
          mismatches.add(WidgetPropertyMismatch(
            widget: identifier,
            property: 'backgroundColor',
            expected: fill.color!,
            actual: widget.backgroundColor!,
            severity: Severity.fail,
            fix: "Change color to Color(0xFF${fill.color!.replaceFirst('#', '')}) "
                'on ${widget.description}',
          ),);
        }
      }
    }

    // Compare typography
    if (designNode.typography != null) {
      final typo = designNode.typography!;

      // Text color
      if (typo.color != null && widget.textColor != null) {
        if (!colorsMatch(typo.color!, widget.textColor!)) {
          mismatches.add(WidgetPropertyMismatch(
            widget: identifier,
            property: 'color',
            expected: typo.color!,
            actual: widget.textColor!,
            severity: Severity.fail,
            fix: "Change TextStyle color to Color(0xFF${typo.color!.replaceFirst('#', '')}) "
                'on ${widget.description}',
          ),);
        }
      }

      // Font size
      if (widget.fontSize != null && widget.fontSize != typo.fontSize) {
        final severity = _computeSizeSeverity(typo.fontSize, widget.fontSize!);
        if (severity != Severity.pass) {
          mismatches.add(WidgetPropertyMismatch(
            widget: identifier,
            property: 'fontSize',
            expected: '${typo.fontSize}',
            actual: '${widget.fontSize}',
            severity: severity,
            fix: 'Change fontSize: ${widget.fontSize} to fontSize: ${typo.fontSize} '
                'in TextStyle on ${widget.description}',
          ),);
        }
      }

      // Font weight
      if (widget.fontWeight != null && widget.fontWeight != typo.fontWeight) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'fontWeight',
          expected: '${typo.fontWeight}',
          actual: '${widget.fontWeight}',
          severity: Severity.warn,
          fix: 'Change fontWeight to FontWeight.w${typo.fontWeight} '
              'in TextStyle on ${widget.description}',
        ),);
      }

      // Font family
      if (widget.fontFamily != null &&
          typo.fontFamily.isNotEmpty &&
          widget.fontFamily!.toLowerCase() != typo.fontFamily.toLowerCase()) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'fontFamily',
          expected: typo.fontFamily,
          actual: widget.fontFamily!,
          severity: Severity.warn,
          fix: "Change fontFamily to '${typo.fontFamily}' "
              'in TextStyle on ${widget.description}',
        ),);
      }

      // Line height
      if (typo.lineHeight != null && widget.lineHeight != null) {
        if (widget.lineHeight != typo.lineHeight) {
          final severity = _computeSizeSeverity(typo.lineHeight!, widget.lineHeight!);
          if (severity != Severity.pass) {
            mismatches.add(WidgetPropertyMismatch(
              widget: identifier,
              property: 'lineHeight',
              expected: '${typo.lineHeight}',
              actual: '${widget.lineHeight}',
              severity: severity,
              fix: 'Change height to ${(typo.lineHeight! / typo.fontSize).toStringAsFixed(2)} '
                  'in TextStyle on ${widget.description}',
            ),);
          }
        }
      }

      // Letter spacing
      if (typo.letterSpacing != null && widget.letterSpacing != null) {
        if (widget.letterSpacing != typo.letterSpacing) {
          final ref = math.max(typo.letterSpacing!.abs(), 1.0);
          final fraction = (typo.letterSpacing! - widget.letterSpacing!).abs() / ref;
          Severity severity;
          if (fraction < SizeThresholds.pass) {
            severity = Severity.pass;
          } else if (fraction < SizeThresholds.warn) {
            severity = Severity.warn;
          } else {
            severity = Severity.fail;
          }
          if (severity != Severity.pass) {
            mismatches.add(WidgetPropertyMismatch(
              widget: identifier,
              property: 'letterSpacing',
              expected: '${typo.letterSpacing}',
              actual: '${widget.letterSpacing}',
              severity: severity,
              fix: 'Change letterSpacing to ${typo.letterSpacing} '
                  'in TextStyle on ${widget.description}',
            ),);
          }
        }
      }
    }

    // Compare padding
    if (designNode.padding != null && widget.padding != null) {
      final dp = designNode.padding!;
      final wp = widget.padding!;
      final sides = [
        ('top', dp.top, wp.top),
        ('right', dp.right, wp.right),
        ('bottom', dp.bottom, wp.bottom),
        ('left', dp.left, wp.left),
      ];
      for (final (side, expected, actual) in sides) {
        if (expected != actual) {
          final severity = _computePositionSeverity(expected, actual, expected);
          if (severity != Severity.pass) {
            mismatches.add(WidgetPropertyMismatch(
              widget: identifier,
              property: 'padding$side',
              expected: '${expected}px',
              actual: '${actual}px',
              severity: severity,
              fix: 'Change padding $side from $actual to $expected '
                  'in EdgeInsets on ${widget.description}',
            ),);
          }
        }
      }
    }

    // Compare gap
    if (designNode.gap != null && widget.gap != null && widget.gap != designNode.gap) {
      final severity = _computePositionSeverity(
        designNode.gap!,
        widget.gap!,
        designNode.gap!,
      );
      if (severity != Severity.pass) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'gap',
          expected: '${designNode.gap}',
          actual: '${widget.gap}',
          severity: severity,
          fix: 'Change spacing from ${widget.gap} to ${designNode.gap} '
              'on ${widget.description}',
        ),);
      }
    }

    // Compare position
    final actualX = widget.bounds.x;
    final expectedX = designNode.bounds.x;
    if (actualX != expectedX) {
      final severity = _computePositionSeverity(
        expectedX,
        actualX,
        math.max(expectedX, designNode.bounds.width),
      );
      if (severity != Severity.pass) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'x',
          expected: '${expectedX}px',
          actual: '${actualX}px',
          severity: severity,
        ),);
      }
    }

    final actualY = widget.bounds.y;
    final expectedY = designNode.bounds.y;
    if (actualY != expectedY) {
      final severity = _computePositionSeverity(
        expectedY,
        actualY,
        math.max(expectedY, designNode.bounds.height),
      );
      if (severity != Severity.pass) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'y',
          expected: '${expectedY}px',
          actual: '${actualY}px',
          severity: severity,
        ),);
      }
    }

    // Compare size
    final expectedW = designNode.bounds.width;
    final actualW = widget.bounds.width;
    if (expectedW > 0 && actualW != expectedW) {
      final severity = _computeSizeSeverity(expectedW, actualW);
      if (severity != Severity.pass) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'width',
          expected: '${expectedW}px',
          actual: '${actualW}px',
          severity: severity,
          fix: 'Change width from $actualW to $expectedW on ${widget.description}',
        ),);
      }
    }

    final expectedH = designNode.bounds.height;
    final actualH = widget.bounds.height;
    if (expectedH > 0 && actualH != expectedH) {
      final severity = _computeSizeSeverity(expectedH, actualH);
      if (severity != Severity.pass) {
        mismatches.add(WidgetPropertyMismatch(
          widget: identifier,
          property: 'height',
          expected: '${expectedH}px',
          actual: '${actualH}px',
          severity: severity,
          fix: 'Change height from $actualH to $expectedH on ${widget.description}',
        ),);
      }
    }

    // Compare corner radius
    if (designNode.cornerRadius != null && widget.cornerRadius != null) {
      final expected = designNode.cornerRadius!.uniform;
      final actual = widget.cornerRadius!.uniform;
      if (expected != actual) {
        final severity = _computeSizeSeverity(expected, actual);
        if (severity != Severity.pass) {
          mismatches.add(WidgetPropertyMismatch(
            widget: identifier,
            property: 'borderRadius',
            expected: '${expected}px',
            actual: '${actual}px',
            severity: severity,
            fix: 'Change BorderRadius.circular($actual) to '
                'BorderRadius.circular($expected) on ${widget.description}',
          ),);
        }
      }
    }

    return mismatches;
  }

  // ── Severity Computation ──

  Severity _computePositionSeverity(double expected, double actual, double reference) {
    final absRef = reference.abs();
    final effectiveRef = absRef < 100 ? 100.0 : absRef;
    final fraction = (expected - actual).abs() / effectiveRef;

    if (absRef < 100) {
      if (fraction <= PositionThresholds.pass) return Severity.pass;
      if (fraction <= PositionThresholds.warn) return Severity.warn;
      return Severity.fail;
    }

    if (fraction < PositionThresholds.pass) return Severity.pass;
    if (fraction < PositionThresholds.warn) return Severity.warn;
    return Severity.fail;
  }

  Severity _computeSizeSeverity(double expected, double actual) {
    if (expected == 0) return Severity.pass;
    final fraction = (expected - actual).abs() / expected.abs();
    if (fraction < SizeThresholds.pass) return Severity.pass;
    if (fraction < SizeThresholds.warn) return Severity.warn;
    return Severity.fail;
  }

  // ── Matching Helpers ──

  double _levenshteinSimilarity(String a, String b) {
    if (a == b) return 1;
    if (a.isEmpty || b.isEmpty) return 0;

    final matrix = List.generate(
      a.length + 1,
      (i) => List.generate(b.length + 1, (j) => i == 0 ? j : (j == 0 ? i : 0)),
    );

    for (var i = 1; i <= a.length; i++) {
      for (var j = 1; j <= b.length; j++) {
        final cost = a[i - 1] == b[j - 1] ? 0 : 1;
        matrix[i][j] = [
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        ].reduce(math.min);
      }
    }

    return 1 - matrix[a.length][b.length] / math.max(a.length, b.length);
  }

  String _normalizeText(String text) {
    return text
        .toLowerCase()
        .replaceAll(RegExp(r'[\u2018\u2019]'), "'")
        .replaceAll(RegExp(r'[\u201C\u201D]'), '"')
        .replaceAll(RegExp(r'[\u2013\u2014]'), '-')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  double _typeCompatibility(NodeType designType, String widgetType) {
    const textWidgets = {'Text', 'RichText', 'SelectableText', 'EditableText'};
    const containerWidgets = {
      'Container', 'DecoratedBox', 'Card', 'Material', 'Scaffold',
      'Column', 'Row', 'Stack', 'Flex', 'Wrap', 'Padding', 'Center',
      'Align', 'SizedBox', 'ConstrainedBox', 'AspectRatio',
    };
    const inputWidgets = {'TextField', 'TextFormField', 'ElevatedButton', 'TextButton', 'IconButton'};
    const imageWidgets = {'Image', 'Icon', 'SvgPicture', 'FadeInImage'};

    switch (designType) {
      case NodeType.text:
        return textWidgets.contains(widgetType) ? 1.0 : 0;
      case NodeType.frame:
      case NodeType.group:
      case NodeType.component:
      case NodeType.instance:
        return containerWidgets.contains(widgetType) ? 1.0 : 0.3;
      case NodeType.input:
      case NodeType.button:
        return inputWidgets.contains(widgetType) ? 1.0 : 0;
      case NodeType.image:
        return imageWidgets.contains(widgetType) ? 1.0 : 0;
      case NodeType.vector:
        return widgetType == 'Icon' || widgetType == 'SvgPicture' ? 1.0 : 0;
      case NodeType.rectangle:
        return containerWidgets.contains(widgetType) ? 0.5 : 0.2;
      case NodeType.ellipse:
        return widgetType == 'ClipOval' ? 1.0 : 0.2;
    }
  }

  double _colorSimilarity(DesignNode designNode, WidgetStyle widget) {
    String? designColor;
    if (designNode.fills != null && designNode.fills!.isNotEmpty && designNode.fills!.first.color != null) {
      designColor = designNode.fills!.first.color;
    } else if (designNode.typography?.color != null) {
      designColor = designNode.typography!.color;
    }
    if (designColor == null) return 0.5;

    var bestSim = 0.0;
    if (widget.backgroundColor != null) {
      final dE = computeDeltaE(designColor.toUpperCase(), widget.backgroundColor!.toUpperCase());
      bestSim = math.max(bestSim, math.max(0, 1 - dE / 50));
    }
    if (widget.textColor != null) {
      final dE = computeDeltaE(designColor.toUpperCase(), widget.textColor!.toUpperCase());
      bestSim = math.max(bestSim, math.max(0, 1 - dE / 50));
    }
    return bestSim;
  }

  double _sizeSimilarity(Bounds design, Bounds widget) {
    if (design.width == 0 || design.height == 0) return 0;
    final wr = math.min(design.width, widget.width) / math.max(design.width, widget.width);
    final hr = math.min(design.height, widget.height) / math.max(design.height, widget.height);
    return (wr + hr) / 2;
  }

  _StructuralFingerprint _designNodeFingerprint(DesignNode node) {
    return _StructuralFingerprint(
      childCount: node.children.length,
      childTypes: node.children.map((c) => c.type.name).toList()..sort(),
      hasText: node.type == NodeType.text || node.children.any((c) => c.type == NodeType.text),
      hasBg: node.fills != null && node.fills!.isNotEmpty && node.fills!.first.color != null,
      aspectRatio: node.bounds.height > 0 ? node.bounds.width / node.bounds.height : 1,
      area: node.bounds.area,
    );
  }

  _StructuralFingerprint _widgetFingerprint(
    WidgetStyle widget,
    List<WidgetStyle> allWidgets,
  ) {
    // Find children by containment
    final children = allWidgets.where((w) {
      if (w.identifier == widget.identifier) return false;
      return widget.bounds.contains(w.bounds);
    }).toList();

    return _StructuralFingerprint(
      childCount: widget.childCount,
      childTypes: children.map((c) {
        if (c.isText) return 'text';
        if (c.widgetType == 'Image' || c.widgetType == 'Icon') return 'image';
        return 'frame';
      }).toList()
        ..sort(),
      hasText: widget.isText || widget.textContent != null,
      hasBg: widget.backgroundColor != null,
      aspectRatio: widget.bounds.height > 0 ? widget.bounds.width / widget.bounds.height : 1,
      area: widget.bounds.area,
    );
  }

  double _fingerprintSimilarity(_StructuralFingerprint a, _StructuralFingerprint b) {
    var score = 0.0;

    final maxChildren = math.max(a.childCount, math.max(b.childCount, 1));
    score += 0.3 * (1 - (a.childCount - b.childCount).abs() / maxChildren);

    score += 0.25 * _arrayOverlap(a.childTypes, b.childTypes);
    score += 0.15 * (a.hasText == b.hasText ? 1.0 : 0.0);
    score += 0.1 * (a.hasBg == b.hasBg ? 1.0 : 0.0);

    final maxAR = math.max(a.aspectRatio, math.max(b.aspectRatio, 0.1));
    final minAR = math.min(a.aspectRatio, math.min(b.aspectRatio, 0.1));
    score += 0.2 * (minAR / maxAR);

    return score;
  }

  double _arrayOverlap(List<String> a, List<String> b) {
    if (a.isEmpty && b.isEmpty) return 1;
    if (a.isEmpty || b.isEmpty) return 0;
    final setA = a.toSet();
    final intersection = b.where(setA.contains).length;
    return intersection / math.max(a.length, b.length);
  }

  /// Framework/scaffold widgets that should never receive design Keys.
  bool _isFrameworkWidget(String widgetType) {
    const frameworkWidgets = {
      // App scaffolding
      'MaterialApp', 'CupertinoApp', 'WidgetsApp',
      'MyApp', 'RootWidget', 'RootRestorationScope',
      // State management / providers
      'ProviderScope', 'UncontrolledProviderScope',
      'MultiProvider', 'ChangeNotifierProvider',
      'BlocProvider', 'MultiBlocProvider',
      'InheritedWidget', 'InheritedElement',
      // Navigation / routing
      'Navigator', 'Router', 'GoRouter',
      'MaterialPageRoute', 'PageRoute',
      // Media / theme wrappers
      'MediaQuery', 'Theme', 'AnimatedTheme',
      'Directionality', 'Localizations',
      'DefaultTextStyle', 'DefaultTextHeightBehavior',
      'IconTheme', 'ScrollConfiguration',
      // Overlay / internal
      'Overlay', 'OverlayEntry', 'FocusScope',
      'FocusTraversalGroup', 'Actions', 'Shortcuts',
      'Semantics', 'MergeSemantics',
      'RepaintBoundary', 'CustomPaint',
      'RenderObjectToWidgetAdapter',
      // Layout internals (not user-facing)
      'LayoutBuilder', 'Builder', 'StatefulBuilder',
    };
    return frameworkWidgets.contains(widgetType);
  }

  List<DesignNode> _flattenDesignNodes(List<DesignNode> nodes) {
    final result = <DesignNode>[];
    void recurse(List<DesignNode> list) {
      for (final node in list) {
        result.add(node);
        if (node.children.isNotEmpty) recurse(node.children);
      }
    }
    recurse(nodes);
    return result;
  }
}
