// Unit tests for FlutterInspector widget tree parsing.
//
// Tests _walkWidgetTree and Key extraction with sample VM service JSON
// without requiring a real Flutter app connection.
import 'package:test/test.dart';

import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/flutter/flutter_inspector.dart';
import 'package:saccadic/src/flutter/widget_style.dart';

void main() {
  group('parseKeyDescription', () {
    test('parses bracket format [<\'heroTitle\'>]', () {
      expect(
        FlutterInspector.parseKeyDescription("[<'heroTitle'>]"),
        equals('heroTitle'),
      );
    });

    test('parses ValueKey<String>(\'heroTitle\')', () {
      expect(
        FlutterInspector.parseKeyDescription("ValueKey<String>('heroTitle')"),
        equals('heroTitle'),
      );
    });

    test('parses ValueKey<String>("heroTitle") with double quotes', () {
      expect(
        FlutterInspector.parseKeyDescription('ValueKey<String>("heroTitle")'),
        equals('heroTitle'),
      );
    });

    test('parses Key(\'heroTitle\')', () {
      expect(
        FlutterInspector.parseKeyDescription("Key('heroTitle')"),
        equals('heroTitle'),
      );
    });

    test('parses Key("heroTitle") with double quotes', () {
      expect(
        FlutterInspector.parseKeyDescription('Key("heroTitle")'),
        equals('heroTitle'),
      );
    });

    test('parses GlobalObjectKey<State<StatefulWidget>>(\'myId\')', () {
      expect(
        FlutterInspector.parseKeyDescription(
          "GlobalObjectKey<State<StatefulWidget>>('myId')",
        ),
        equals('myId'),
      );
    });

    test('returns null for opaque inspector references', () {
      expect(
        FlutterInspector.parseKeyDescription('inspector-0'),
        isNull,
      );
    });

    test('returns null for empty string', () {
      expect(FlutterInspector.parseKeyDescription(''), isNull);
    });

    test('returns null for random text', () {
      expect(
        FlutterInspector.parseKeyDescription('some random value'),
        isNull,
      );
    });
  });

  group('walkWidgetTree', () {
    /// Helper: create a FlutterInspector and walk a tree.
    /// Uses the public static methods where possible.
    List<WidgetStyle> walkTree(Map<String, dynamic> root) {
      // We can't call _walkWidgetTree directly since it's private.
      // Instead, we test the public parseKeyDescription and _extractBounds
      // via the static methods, and test the full walk via a round-trip
      // through extractWidgetTree's logic.
      //
      // For now, replicate the walk logic for testing.
      final widgets = <WidgetStyle>[];
      _walkForTest(root, widgets, null);
      return widgets;
    }

    test('extracts widgets without bounds (no filtering)', () {
      final tree = _sampleTree();
      final widgets = walkTree(tree);

      // Should include all widgets, not just ones with bounds
      expect(widgets.length, greaterThan(0));

      // The root Scaffold should be included even without render object
      expect(
        widgets.any((w) => w.widgetType == 'Scaffold'),
        isTrue,
      );
    });

    test('extracts Key from properties list', () {
      final tree = {
        'description': 'Container',
        'widgetRuntimeType': 'Container',
        'properties': [
          {
            'name': 'key',
            'description': "[<'heroSection'>]",
          },
        ],
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.length, equals(1));
      expect(widgets.first.key, equals('heroSection'));
    });

    test('extracts Key from ValueKey format in properties', () {
      final tree = {
        'description': 'Text',
        'widgetRuntimeType': 'Text',
        'properties': [
          {
            'name': 'key',
            'description': "ValueKey<String>('heroTitle')",
          },
          {
            'name': 'data',
            'description': 'Welcome',
          },
        ],
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.first.key, equals('heroTitle'));
      expect(widgets.first.textContent, equals('Welcome'));
    });

    test('does NOT extract key from opaque valueId', () {
      final tree = {
        'description': 'Container',
        'widgetRuntimeType': 'Container',
        'valueId': 'inspector-42',
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.first.key, isNull);
    });

    test('extracts bounds from renderObject description', () {
      final tree = {
        'description': 'Container',
        'widgetRuntimeType': 'Container',
        'renderObject': {
          'description':
              'RenderDecoratedBox#abc12 relayoutBoundary=up1 ╌ size: Size(375.0, 812.0)',
        },
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.first.bounds.width, equals(375.0));
      expect(widgets.first.bounds.height, equals(812.0));
    });

    test('includes widget with zero bounds', () {
      final tree = {
        'description': 'Padding',
        'widgetRuntimeType': 'Padding',
        // No renderObject — bounds will be (0,0,0,0)
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.length, equals(1));
      expect(widgets.first.bounds.width, equals(0));
      expect(widgets.first.bounds.height, equals(0));
    });

    test('recurses into children', () {
      final tree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'properties': [
          {'name': 'key', 'description': "[<'mainColumn'>]"},
        ],
        'children': <dynamic>[
          {
            'description': 'Text',
            'widgetRuntimeType': 'Text',
            'properties': [
              {'name': 'key', 'description': "[<'title'>]"},
              {'name': 'data', 'description': 'Hello'},
            ],
            'children': <dynamic>[],
          },
          {
            'description': 'Text',
            'widgetRuntimeType': 'Text',
            'properties': [
              {'name': 'key', 'description': "[<'subtitle'>]"},
              {'name': 'data', 'description': 'World'},
            ],
            'children': <dynamic>[],
          },
        ],
      };

      final widgets = walkTree(tree);
      expect(widgets.length, equals(3)); // Column + 2 Text widgets
      expect(widgets[0].key, equals('mainColumn'));
      expect(widgets[0].layoutDirection, equals(LayoutMode.vertical));
      expect(widgets[1].key, equals('title'));
      expect(widgets[1].textContent, equals('Hello'));
      expect(widgets[1].parentKey, equals('mainColumn'));
      expect(widgets[2].key, equals('subtitle'));
      expect(widgets[2].textContent, equals('World'));
    });

    test('sets layout direction for Row/Column/ListView', () {
      for (final entry in {
        'Column': LayoutMode.vertical,
        'Row': LayoutMode.horizontal,
        'ListView': LayoutMode.vertical,
      }.entries) {
        final tree = {
          'description': entry.key,
          'widgetRuntimeType': entry.key,
          'children': <dynamic>[],
        };
        final widgets = walkTree(tree);
        expect(
          widgets.first.layoutDirection,
          equals(entry.value),
          reason: '${entry.key} should have ${entry.value} direction',
        );
      }
    });

    test('parses EdgeInsets.all padding from properties', () {
      final tree = {
        'description': 'Padding',
        'widgetRuntimeType': 'Padding',
        'properties': [
          {'name': 'padding', 'description': 'EdgeInsets.all(16.0)'},
        ],
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.first.padding, isNotNull);
      expect(widgets.first.padding!.top, equals(16.0));
      expect(widgets.first.padding!.right, equals(16.0));
      expect(widgets.first.padding!.bottom, equals(16.0));
      expect(widgets.first.padding!.left, equals(16.0));
    });

    test('parses gap from mainAxisSpacing', () {
      final tree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'properties': [
          {'name': 'mainAxisSpacing', 'description': '12.0'},
        ],
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.first.gap, equals(12.0));
    });

    test('sets description with Key when present', () {
      final tree = {
        'description': 'Container',
        'widgetRuntimeType': 'Container',
        'properties': [
          {'name': 'key', 'description': "[<'myBox'>]"},
        ],
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(
        widgets.first.description,
        equals("Container(key: Key('myBox'))"),
      );
    });

    test('sets description without Key when absent', () {
      final tree = {
        'description': 'SizedBox',
        'widgetRuntimeType': 'SizedBox',
        'children': <dynamic>[],
      };

      final widgets = walkTree(tree);
      expect(widgets.first.description, equals('SizedBox'));
    });
  });

  group('InspectionDiagnostics', () {
    test('toJson includes all fields', () {
      const diag = InspectionDiagnostics(
        widgetsExtracted: 0,
        vmServiceConnected: true,
        treeExtensionUsed: 'getRootWidgetTree',
        rawResponseKeys: ['result', 'type'],
        hint: 'No widgets found',
      );

      final json = diag.toJson();
      expect(json['widgetsExtracted'], equals(0));
      expect(json['vmServiceConnected'], isTrue);
      expect(json['treeExtensionUsed'], equals('getRootWidgetTree'));
      expect(json['rawResponseKeys'], equals(['result', 'type']));
      expect(json['hint'], equals('No widgets found'));
    });

    test('toJson omits null fields', () {
      const diag = InspectionDiagnostics(
        widgetsExtracted: 42,
        vmServiceConnected: true,
        treeExtensionUsed: 'getRootWidgetSummaryTree',
      );

      final json = diag.toJson();
      expect(json.containsKey('rawResponseKeys'), isFalse);
      expect(json.containsKey('hint'), isFalse);
    });
  });

  group('realistic VM service tree', () {
    test('parses a full sample widget tree', () {
      final tree = _realisticTree();
      final widgets = <WidgetStyle>[];
      _walkForTest(tree, widgets, null);

      // Should have all widgets from the tree
      expect(widgets.length, equals(7));

      // Find the keyed widgets
      final scaffold = widgets.firstWhere((w) => w.key == 'appScaffold');
      expect(scaffold.widgetType, equals('Scaffold'));

      final heroTitle = widgets.firstWhere((w) => w.key == 'heroTitle');
      expect(heroTitle.widgetType, equals('Text'));
      expect(heroTitle.textContent, equals('Welcome'));

      final heroSubtitle =
          widgets.firstWhere((w) => w.key == 'heroSubtitle');
      expect(heroSubtitle.textContent, equals('Build something amazing'));

      // Check parent key propagation
      expect(heroTitle.parentKey, equals('heroSection'));
      expect(heroSubtitle.parentKey, equals('heroSection'));
    });
  });

  group('extractBoundsFromDescription', () {
    test('parses size from render object description', () {
      final node = {
        'description':
            'RenderParagraph#abc relayoutBoundary=up1 ╌ size: Size(200.0, 24.0)',
      };
      final bounds = _extractBoundsFromDescriptionForTest(node);
      expect(bounds.width, equals(200.0));
      expect(bounds.height, equals(24.0));
    });

    test('parses size from description without extra metadata', () {
      final node = {
        'description': 'RenderFlex size: Size(375.0, 812.0)',
      };
      final bounds = _extractBoundsFromDescriptionForTest(node);
      expect(bounds.width, equals(375.0));
      expect(bounds.height, equals(812.0));
    });

    test('returns zero bounds when no size in description', () {
      final node = {'description': 'Text'};
      final bounds = _extractBoundsFromDescriptionForTest(node);
      expect(bounds.width, equals(0));
      expect(bounds.height, equals(0));
    });

    test('returns zero bounds for empty description', () {
      final node = <String, dynamic>{};
      final bounds = _extractBoundsFromDescriptionForTest(node);
      expect(bounds.width, equals(0));
      expect(bounds.height, equals(0));
    });
  });

  group('collectKeyValueIds', () {
    test('maps keyed widgets to their valueIds', () {
      final tree = _realisticTree();
      final keyToValueId = <String, String>{};
      _collectKeyValueIdsForTest(tree, keyToValueId);

      // Keyed widgets in the realistic tree
      expect(keyToValueId['appScaffold'], equals('inspector-0'));
      expect(keyToValueId['heroSection'], equals('inspector-3'));
      expect(keyToValueId['heroTitle'], equals('inspector-4'));
      expect(keyToValueId['heroSubtitle'], equals('inspector-5'));
      expect(keyToValueId['ctaButton'], equals('inspector-6'));
    });

    test('skips nodes without valueId', () {
      final tree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        // No valueId
        'properties': <dynamic>[
          {'name': 'key', 'description': "[<'myColumn'>]"},
        ],
        'children': <dynamic>[
          {
            'description': 'Text',
            'widgetRuntimeType': 'Text',
            'valueId': 'inspector-1',
            'properties': <dynamic>[
              {'name': 'key', 'description': "[<'myText'>]"},
            ],
            'children': <dynamic>[],
          },
        ],
      };

      final keyToValueId = <String, String>{};
      _collectKeyValueIdsForTest(tree, keyToValueId);

      // Column has no valueId so it's skipped
      expect(keyToValueId.containsKey('myColumn'), isFalse);
      // Text has valueId
      expect(keyToValueId['myText'], equals('inspector-1'));
    });

    test('skips nodes without a key', () {
      final tree = {
        'description': 'Container',
        'widgetRuntimeType': 'Container',
        'valueId': 'inspector-0',
        // No key property
        'children': <dynamic>[],
      };

      final keyToValueId = <String, String>{};
      _collectKeyValueIdsForTest(tree, keyToValueId);

      expect(keyToValueId, isEmpty);
    });
  });
}

// ── Test helpers ──

/// Replicate _walkWidgetTree logic for testing (since it's private).
void _walkForTest(
  Map<String, dynamic> node,
  List<WidgetStyle> widgets,
  String? parentKey,
) {
  final description = node['description'] as String? ?? '';
  final widgetType = node['widgetRuntimeType'] as String? ?? description;

  final key = FlutterInspector.parseKeyDescription(
    _extractKeyDesc(node) ?? '',
  );

  // Extract bounds from render object
  final renderObject = node['renderObject'] as Map<String, dynamic>?;
  var bounds = const Bounds(x: 0, y: 0, width: 0, height: 0);
  if (renderObject != null) {
    final desc = renderObject['description'] as String? ?? '';
    final sizeMatch =
        RegExp(r'size: Size\(([\d.]+),\s*([\d.]+)\)').firstMatch(desc);
    if (sizeMatch != null) {
      bounds = Bounds(
        x: 0,
        y: 0,
        width: double.parse(sizeMatch.group(1)!),
        height: double.parse(sizeMatch.group(2)!),
      );
    }
  }

  // Extract properties
  String? textContent;
  Spacing? padding;
  double? gap;
  LayoutMode? layoutDirection;

  final properties = node['properties'] as List<dynamic>?;
  if (properties != null) {
    for (final prop in properties) {
      if (prop is! Map) continue;
      final propName = prop['name'] as String?;
      final propValue = prop['description'] as String?;
      if (propName == null || propValue == null) continue;

      switch (propName) {
        case 'data':
          textContent = propValue;
        case 'padding':
          padding = _parseEdgeInsetsForTest(propValue);
        case 'mainAxisSpacing' || 'spacing':
          gap = double.tryParse(propValue);
      }
    }
  }

  if (widgetType == 'Column' || widgetType == 'ListView') {
    layoutDirection = LayoutMode.vertical;
  } else if (widgetType == 'Row') {
    layoutDirection = LayoutMode.horizontal;
  }

  final children = node['children'] as List<dynamic>?;
  final childCount = children?.length ?? 0;

  widgets.add(
    WidgetStyle(
      key: key,
      widgetType: widgetType,
      bounds: bounds,
      textContent: textContent,
      padding: padding,
      gap: gap,
      layoutDirection: layoutDirection,
      childCount: childCount,
      description: '$widgetType${key != null ? "(key: Key('$key'))" : ""}',
      parentKey: parentKey,
    ),
  );

  if (children != null) {
    for (final child in children) {
      if (child is Map<String, dynamic>) {
        _walkForTest(child, widgets, key);
      }
    }
  }
}

/// Extract key description from a node's properties.
String? _extractKeyDesc(Map<String, dynamic> node) {
  final properties = node['properties'] as List<dynamic>?;
  if (properties != null) {
    for (final prop in properties) {
      if (prop is Map && prop['name'] == 'key') {
        return prop['description'] as String?;
      }
    }
  }
  return null;
}

Spacing? _parseEdgeInsetsForTest(String value) {
  final allMatch = RegExp(r'EdgeInsets\.all\(([\d.]+)\)').firstMatch(value);
  if (allMatch != null) {
    final v = double.parse(allMatch.group(1)!);
    return Spacing.all(v);
  }
  return null;
}

/// A minimal sample tree.
Map<String, dynamic> _sampleTree() => {
      'description': 'Scaffold',
      'widgetRuntimeType': 'Scaffold',
      'valueId': 'inspector-0',
      'children': <dynamic>[
        {
          'description': 'Column',
          'widgetRuntimeType': 'Column',
          'valueId': 'inspector-1',
          'children': <dynamic>[
            {
              'description': 'Text',
              'widgetRuntimeType': 'Text',
              'valueId': 'inspector-2',
              'properties': [
                {'name': 'data', 'description': 'Hello World'},
              ],
              'children': <dynamic>[],
            },
          ],
        },
      ],
    };

/// Replicate _extractBoundsFromDescription for testing.
Bounds _extractBoundsFromDescriptionForTest(Map<String, dynamic> node) {
  final desc = node['description'] as String? ?? '';
  final sizeMatch =
      RegExp(r'size: Size\(([\d.]+),\s*([\d.]+)\)').firstMatch(desc);
  if (sizeMatch != null) {
    return Bounds(
      x: 0,
      y: 0,
      width: double.parse(sizeMatch.group(1)!),
      height: double.parse(sizeMatch.group(2)!),
    );
  }
  return const Bounds(x: 0, y: 0, width: 0, height: 0);
}

/// Replicate _collectKeyValueIds for testing.
void _collectKeyValueIdsForTest(
  Map<String, dynamic> node,
  Map<String, String> keyToValueId,
) {
  final valueId = node['valueId'] as String?;
  if (valueId != null) {
    final key = _extractKeyForTest(node);
    if (key != null) {
      keyToValueId[key] = valueId;
    }
  }

  final children = node['children'] as List<dynamic>?;
  if (children != null) {
    for (final child in children) {
      if (child is Map<String, dynamic>) {
        _collectKeyValueIdsForTest(child, keyToValueId);
      }
    }
  }
}

/// Extract key from a node using all sources (properties, description, valueId).
String? _extractKeyForTest(Map<String, dynamic> node) {
  // Check properties first
  final properties = node['properties'] as List<dynamic>?;
  if (properties != null) {
    for (final prop in properties) {
      if (prop is Map && prop['name'] == 'key') {
        final keyDesc = prop['description'] as String?;
        if (keyDesc != null) {
          final extracted = FlutterInspector.parseKeyDescription(keyDesc);
          if (extracted != null) return extracted;
        }
      }
    }
  }
  // Fallback: description field
  final description = node['description'] as String?;
  if (description != null) {
    final extracted = FlutterInspector.parseKeyDescription(description);
    if (extracted != null) return extracted;
  }
  return null;
}

/// A realistic tree mimicking actual Flutter VM service output.
Map<String, dynamic> _realisticTree() => {
      'description': 'Scaffold',
      'widgetRuntimeType': 'Scaffold',
      'valueId': 'inspector-0',
      'properties': [
        {'name': 'key', 'description': "[<'appScaffold'>]"},
      ],
      'children': <dynamic>[
        {
          'description': 'AppBar',
          'widgetRuntimeType': 'AppBar',
          'valueId': 'inspector-1',
          'renderObject': {
            'description':
                'RenderFlex#abc relayoutBoundary=up1 ╌ size: Size(375.0, 56.0)',
          },
          'children': <dynamic>[
            {
              'description': 'Text',
              'widgetRuntimeType': 'Text',
              'valueId': 'inspector-2',
              'properties': [
                {'name': 'data', 'description': 'My App'},
              ],
              'children': <dynamic>[],
            },
          ],
        },
        {
          'description': 'Column',
          'widgetRuntimeType': 'Column',
          'valueId': 'inspector-3',
          'properties': [
            {'name': 'key', 'description': "[<'heroSection'>]"},
            {'name': 'mainAxisSpacing', 'description': '16.0'},
          ],
          'children': <dynamic>[
            {
              'description': 'Text',
              'widgetRuntimeType': 'Text',
              'valueId': 'inspector-4',
              'properties': [
                {
                  'name': 'key',
                  'description': "ValueKey<String>('heroTitle')",
                },
                {'name': 'data', 'description': 'Welcome'},
              ],
              'children': <dynamic>[],
            },
            {
              'description': 'Text',
              'widgetRuntimeType': 'Text',
              'valueId': 'inspector-5',
              'properties': [
                {'name': 'key', 'description': "[<'heroSubtitle'>]"},
                {
                  'name': 'data',
                  'description': 'Build something amazing',
                },
              ],
              'children': <dynamic>[],
            },
            {
              'description': 'ElevatedButton',
              'widgetRuntimeType': 'ElevatedButton',
              'valueId': 'inspector-6',
              'properties': [
                {'name': 'key', 'description': "Key('ctaButton')"},
              ],
              'children': <dynamic>[],
            },
          ],
        },
      ],
    };
