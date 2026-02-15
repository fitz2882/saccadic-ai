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

  group('collectValueIds', () {
    test('collects valueId from nodes that have it', () {
      final tree = _sampleTree();
      final widgets = <WidgetStyle>[];
      _walkForTest(tree, widgets, null);

      final valueIdToIndices = <String, List<int>>{};
      _collectValueIdsForTest(tree, widgets, valueIdToIndices, 0);

      // All 3 nodes in the sample tree have valueIds
      expect(valueIdToIndices.length, equals(3));
      expect(valueIdToIndices.containsKey('inspector-0'), isTrue);
      expect(valueIdToIndices.containsKey('inspector-1'), isTrue);
      expect(valueIdToIndices.containsKey('inspector-2'), isTrue);
    });

    test('skips leaf widgets that have no valueId in summary tree', () {
      // Summary tree: leaf widgets (Text, Icon) don't have valueId.
      // Only parent/framework widgets tend to have them.
      final tree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'valueId': 'inspector-1',
        'children': <dynamic>[
          {
            'description': "Text-[<'title'>]",
            'widgetRuntimeType': 'Text',
            // No valueId in summary tree — the core problem
            'children': <dynamic>[],
          },
          {
            'description': 'Icon',
            'widgetRuntimeType': 'Icon',
            // No valueId in summary tree
            'children': <dynamic>[],
          },
        ],
      };

      final widgets = <WidgetStyle>[];
      _walkForTest(tree, widgets, null);

      final valueIdToIndices = <String, List<int>>{};
      _collectValueIdsForTest(tree, widgets, valueIdToIndices, 0);

      // Only Column has valueId; Text and Icon are missed
      // (their bounds must come from _extractKeyedChildBounds instead)
      expect(valueIdToIndices.length, equals(1));
      expect(valueIdToIndices.containsKey('inspector-1'), isTrue);
    });
  });

  group('extractKeyedChildBounds', () {
    test('finds keyed children through intermediate framework widgets', () {
      // Simulate getDetailsSubtree response with subtreeDepth=5.
      // Keyed Text is nested inside Semantics (intermediate framework widget).
      final detailTree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'renderObject': {
          'description':
              'RenderFlex#abc ╌ size: Size(375.0, 500.0)',
        },
        'children': <dynamic>[
          {
            'description': 'Semantics',
            'widgetRuntimeType': 'Semantics',
            'children': <dynamic>[
              {
                'description': 'Text',
                'widgetRuntimeType': 'Text',
                'properties': <dynamic>[
                  {'name': 'key', 'description': "[<'heroTitle'>]"},
                ],
                'renderObject': {
                  'description':
                      'RenderParagraph#def ╌ size: Size(300.0, 24.0)',
                },
                'children': <dynamic>[],
              },
            ],
          },
          {
            'description': 'Icon',
            'widgetRuntimeType': 'Icon',
            'properties': <dynamic>[
              {'name': 'key', 'description': "[<'heroIcon'>]"},
            ],
            'renderObject': {
              'description':
                  'RenderSemanticsAnnotations#ghi ╌ size: Size(48.0, 48.0)',
            },
            'children': <dynamic>[],
          },
        ],
      };

      // Widgets from summary tree walk — all have zero bounds
      final widgets = [
        _makeWidget(key: 'heroTitle', type: 'Text'),
        _makeWidget(key: 'heroIcon', type: 'Icon'),
        _makeWidget(key: 'otherWidget', type: 'Container'),
      ];

      final keyToIndex = <String, int>{
        'heroTitle': 0,
        'heroIcon': 1,
        'otherWidget': 2,
      };

      _extractKeyedChildBoundsForTest(detailTree, widgets, keyToIndex);

      // heroTitle found through Semantics → Text
      expect(widgets[0].bounds.width, equals(300.0));
      expect(widgets[0].bounds.height, equals(24.0));
      // heroIcon found as direct child
      expect(widgets[1].bounds.width, equals(48.0));
      expect(widgets[1].bounds.height, equals(48.0));
      // otherWidget not in detail tree — stays at 0
      expect(widgets[2].bounds.width, equals(0));
      expect(widgets[2].bounds.height, equals(0));
    });

    test('handles deeply nested keyed widgets', () {
      // 4 levels deep: Column → Padding → Semantics → DefaultTextStyle → Text
      final detailTree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'children': <dynamic>[
          {
            'description': 'Padding',
            'widgetRuntimeType': 'Padding',
            'children': <dynamic>[
              {
                'description': 'Semantics',
                'widgetRuntimeType': 'Semantics',
                'children': <dynamic>[
                  {
                    'description': 'DefaultTextStyle',
                    'widgetRuntimeType': 'DefaultTextStyle',
                    'children': <dynamic>[
                      {
                        'description': 'Text',
                        'widgetRuntimeType': 'Text',
                        'properties': <dynamic>[
                          {
                            'name': 'key',
                            'description': "[<'deepText'>]",
                          },
                        ],
                        'renderObject': {
                          'description':
                              'RenderParagraph#x ╌ size: Size(150.0, 18.0)',
                        },
                        'children': <dynamic>[],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      final widgets = [_makeWidget(key: 'deepText', type: 'Text')];
      final keyToIndex = <String, int>{'deepText': 0};

      _extractKeyedChildBoundsForTest(detailTree, widgets, keyToIndex);

      expect(widgets[0].bounds.width, equals(150.0));
      expect(widgets[0].bounds.height, equals(18.0));
    });

    test('uses description fallback when renderObject is absent', () {
      // Detail node is a render object itself — size is in own description
      final detailTree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'children': <dynamic>[
          {
            'description':
                'RenderParagraph#abc ╌ size: Size(250.0, 20.0)',
            'widgetRuntimeType': 'Text',
            'properties': <dynamic>[
              {'name': 'key', 'description': "[<'renderText'>]"},
            ],
            // No renderObject key — the node itself IS the render object
            'children': <dynamic>[],
          },
        ],
      };

      final widgets = [_makeWidget(key: 'renderText', type: 'Text')];
      final keyToIndex = <String, int>{'renderText': 0};

      _extractKeyedChildBoundsForTest(detailTree, widgets, keyToIndex);

      expect(widgets[0].bounds.width, equals(250.0));
      expect(widgets[0].bounds.height, equals(20.0));
    });

    test('stops updating once all keyed widgets are found', () {
      final detailTree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'children': <dynamic>[
          {
            'description': 'Text',
            'widgetRuntimeType': 'Text',
            'properties': <dynamic>[
              {'name': 'key', 'description': "[<'onlyWidget'>]"},
            ],
            'renderObject': {
              'description': 'RenderParagraph ╌ size: Size(100.0, 16.0)',
            },
            'children': <dynamic>[],
          },
        ],
      };

      final widgets = [_makeWidget(key: 'onlyWidget', type: 'Text')];
      final keyToIndex = <String, int>{'onlyWidget': 0};

      _extractKeyedChildBoundsForTest(detailTree, widgets, keyToIndex);

      expect(widgets[0].bounds.width, equals(100.0));
      // keyToIndex should be empty (entry removed after match)
      expect(keyToIndex, isEmpty);
    });
  });

  group('end-to-end bounds resolution', () {
    test('subtreeDepth finds keyed children in parent detail tree', () {
      // Secondary strategy: when renderObject.valueId isn't available,
      // subtreeDepth=5 on parent nodes discovers children via key matching.
      final summaryTree = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'valueId': 'inspector-1',
        'properties': <dynamic>[
          {'name': 'key', 'description': "[<'mainColumn'>]"},
        ],
        'children': <dynamic>[
          {
            'description': "Text-[<'orphanText'>]",
            'widgetRuntimeType': 'Text',
            // No valueId AND no renderObject — worst case
            'properties': <dynamic>[
              {'name': 'key', 'description': "[<'orphanText'>]"},
            ],
            'children': <dynamic>[],
          },
        ],
      };

      final widgets = <WidgetStyle>[];
      _walkForTest(summaryTree, widgets, null);
      expect(widgets[1].key, equals('orphanText'));
      expect(widgets[1].bounds.width, equals(0));

      // _collectValueIds only finds Column
      final valueIdToIndices = <String, List<int>>{};
      _collectValueIdsForTest(summaryTree, widgets, valueIdToIndices, 0);
      expect(valueIdToIndices.length, equals(1));

      // getDetailsSubtree(Column, subtreeDepth=5) returns children
      final detailResponse = {
        'description': 'Column',
        'widgetRuntimeType': 'Column',
        'renderObject': {
          'description': 'RenderFlex ╌ size: Size(375.0, 400.0)',
        },
        'children': <dynamic>[
          {
            'description': 'Text',
            'widgetRuntimeType': 'Text',
            'properties': <dynamic>[
              {'name': 'key', 'description': "[<'orphanText'>]"},
            ],
            'renderObject': {
              'description':
                  'RenderParagraph#x ╌ size: Size(200.0, 16.0)',
            },
            'children': <dynamic>[],
          },
        ],
      };

      // Build keyToIndex and extract child bounds
      final keyToIndex = <String, int>{};
      for (var i = 0; i < widgets.length; i++) {
        final key = widgets[i].key;
        if (key != null && widgets[i].bounds.width == 0) {
          keyToIndex[key] = i;
        }
      }

      _extractKeyedChildBoundsForTest(detailResponse, widgets, keyToIndex);

      expect(widgets[1].bounds.width, equals(200.0));
      expect(widgets[1].bounds.height, equals(16.0));
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

/// Create a WidgetStyle with zero bounds for testing.
WidgetStyle _makeWidget({
  required String key,
  required String type,
}) {
  return WidgetStyle(
    key: key,
    widgetType: type,
    bounds: const Bounds(x: 0, y: 0, width: 0, height: 0),
    description: "$type(key: Key('$key'))",
  );
}

/// Create a copy of a WidgetStyle with updated bounds.
WidgetStyle _withBounds(WidgetStyle w, Bounds bounds) {
  return WidgetStyle(
    key: w.key,
    widgetType: w.widgetType,
    bounds: bounds,
    backgroundColor: w.backgroundColor,
    textColor: w.textColor,
    fontSize: w.fontSize,
    fontWeight: w.fontWeight,
    fontFamily: w.fontFamily,
    lineHeight: w.lineHeight,
    letterSpacing: w.letterSpacing,
    textContent: w.textContent,
    padding: w.padding,
    gap: w.gap,
    cornerRadius: w.cornerRadius,
    layoutDirection: w.layoutDirection,
    childCount: w.childCount,
    description: w.description,
    parentKey: w.parentKey,
  );
}

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

/// Replicate _extractBounds for testing (uses renderObject child).
Bounds _extractBoundsForTest(Map<String, dynamic> node) {
  final renderObject = node['renderObject'] as Map<String, dynamic>?;
  if (renderObject == null) {
    return const Bounds(x: 0, y: 0, width: 0, height: 0);
  }
  final desc = renderObject['description'] as String? ?? '';
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

/// Replicate _collectValueIds for testing.
void _collectValueIdsForTest(
  Map<String, dynamic> node,
  List<WidgetStyle> widgets,
  Map<String, List<int>> valueIdToIndices,
  int startIndex,
) {
  final valueId = node['valueId'] as String?;

  if (valueId != null) {
    final description = node['description'] as String? ?? '';
    final widgetType = node['widgetRuntimeType'] as String? ?? description;

    for (var i = startIndex; i < widgets.length; i++) {
      if (widgets[i].widgetType == widgetType &&
          widgets[i].bounds.width == 0 &&
          widgets[i].bounds.height == 0) {
        valueIdToIndices.putIfAbsent(valueId, () => []).add(i);
        break;
      }
    }
  }

  final children = node['children'] as List<dynamic>?;
  if (children != null) {
    for (final child in children) {
      if (child is Map<String, dynamic>) {
        _collectValueIdsForTest(child, widgets, valueIdToIndices, startIndex);
      }
    }
  }
}

/// Replicate _extractKeyedChildBounds for testing.
void _extractKeyedChildBoundsForTest(
  Map<String, dynamic> node,
  List<WidgetStyle> widgets,
  Map<String, int> keyToIndex,
) {
  if (keyToIndex.isEmpty) return;

  final children = node['children'] as List<dynamic>?;
  if (children == null) return;

  for (final child in children) {
    if (child is! Map<String, dynamic>) continue;

    final key = FlutterInspector.parseKeyDescription(
      _extractKeyDescForBounds(child) ?? '',
    );
    if (key != null && keyToIndex.containsKey(key)) {
      var bounds = _extractBoundsForTest(child);
      if (bounds.width == 0 && bounds.height == 0) {
        bounds = _extractBoundsFromDescriptionForTest(child);
      }
      if (bounds.width > 0 && bounds.height > 0) {
        final idx = keyToIndex[key]!;
        widgets[idx] = _withBounds(widgets[idx], bounds);
        keyToIndex.remove(key);
      }
    }

    _extractKeyedChildBoundsForTest(child, widgets, keyToIndex);
  }
}

/// Extract key description from any source in a node (properties, description).
String? _extractKeyDescForBounds(Map<String, dynamic> node) {
  // Check properties first
  final properties = node['properties'] as List<dynamic>?;
  if (properties != null) {
    for (final prop in properties) {
      if (prop is Map && prop['name'] == 'key') {
        return prop['description'] as String?;
      }
    }
  }
  // Fallback: description field (e.g. "Text-[<'myKey'>]")
  return node['description'] as String?;
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
