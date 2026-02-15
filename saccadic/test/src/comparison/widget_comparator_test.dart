import 'package:saccadic/src/comparison/widget_comparator.dart';
import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/flutter/widget_style.dart';
import 'package:test/test.dart';

void main() {
  late WidgetComparator comparator;

  setUp(() {
    comparator = WidgetComparator();
  });

  group('matchWidgets', () {
    test('Pass 0: matches by Key', () {
      final widgets = [
        WidgetStyle(
          key: 'heroTitle',
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
          description: "Text(key: Key('heroTitle'))",
        ),
      ];
      final nodes = [
        const DesignNode(
          id: 'heroTitle',
          name: 'Hero Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
        ),
      ];

      final matches = comparator.matchWidgets(widgets, nodes);
      expect(matches.length, 1);
      expect(matches.first.confidence, 1.0);
      expect(matches.first.designNode.id, 'heroTitle');
    });

    test('Pass 1: matches by IoU', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Container',
          bounds: const Bounds(x: 0, y: 0, width: 100, height: 100),
          description: 'Container(0,0)',
        ),
      ];
      final nodes = [
        const DesignNode(
          id: 'card',
          name: 'Card',
          type: NodeType.frame,
          bounds: Bounds(x: 0, y: 0, width: 100, height: 100),
        ),
      ];

      final matches = comparator.matchWidgets(widgets, nodes);
      expect(matches.length, 1);
      expect(matches.first.confidence, 1.0); // perfect overlap
    });

    test('Pass 2: matches by text content', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 50, y: 50, width: 200, height: 30),
          textContent: 'Welcome to our app',
          description: 'Text(50,50)',
        ),
      ];
      final nodes = [
        const DesignNode(
          id: 'welcomeText',
          name: 'Welcome Text',
          type: NodeType.text,
          bounds: Bounds(x: 48, y: 48, width: 204, height: 32),
          textContent: 'Welcome to our app',
        ),
      ];

      final matches = comparator.matchWidgets(widgets, nodes);
      expect(matches.length, 1);
      expect(matches.first.confidence, greaterThan(0.5));
    });

    test('no match for distant elements', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Container',
          bounds: const Bounds(x: 0, y: 0, width: 50, height: 50),
          description: 'Container(0,0)',
        ),
      ];
      final nodes = [
        const DesignNode(
          id: 'far',
          name: 'Far Away',
          type: NodeType.frame,
          bounds: Bounds(x: 500, y: 500, width: 50, height: 50),
        ),
      ];

      final matches = comparator.matchWidgets(widgets, nodes);
      expect(matches, isEmpty);
    });
  });

  group('suggestKeyMappings', () {
    test('suggests by text content match', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Welcome Back',
          description: 'Text(10,10)',
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'headerTitle',
          name: 'Header Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Welcome Back',
        ),
      ];

      final suggestions = comparator.suggestKeyMappings(widgets, nodes);
      expect(suggestions.length, 1);
      expect(suggestions.first.nodeId, 'headerTitle');
      expect(suggestions.first.widgetIdentifier, 'Text(10,10)');
      expect(suggestions.first.confidence, 1.0);
      expect(suggestions.first.reason, contains('Text match'));
    });

    test('suggests by fuzzy text match', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Welcom Back',
          description: 'Text(10,10)',
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'headerTitle',
          name: 'Header Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Welcome Back',
        ),
      ];

      final suggestions = comparator.suggestKeyMappings(widgets, nodes);
      expect(suggestions.length, 1);
      expect(suggestions.first.confidence, greaterThan(0.7));
    });

    test('skips widgets that already have Keys', () {
      final widgets = [
        WidgetStyle(
          key: 'existingKey',
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
          description: "Text(key: Key('existingKey'))",
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'title',
          name: 'Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
        ),
      ];

      final suggestions = comparator.suggestKeyMappings(widgets, nodes);
      expect(suggestions, isEmpty);
    });

    test('returns empty list when no reasonable matches exist', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Container',
          bounds: const Bounds(x: 0, y: 0, width: 50, height: 50),
          description: 'Container(0,0)',
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'far',
          name: 'Far Away',
          type: NodeType.text,
          bounds: Bounds(x: 500, y: 500, width: 200, height: 30),
          textContent: 'Completely different text',
        ),
      ];

      final suggestions = comparator.suggestKeyMappings(widgets, nodes);
      expect(suggestions, isEmpty);
    });

    test('sorts by confidence descending', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Exact Match',
          description: 'Text(10,10)',
        ),
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 50, width: 200, height: 30),
          textContent: 'Almost Match',
          description: 'Text(10,50)',
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'exact',
          name: 'Exact',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Exact Match',
        ),
        DesignNode(
          id: 'almost',
          name: 'Almost',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 50, width: 200, height: 30),
          textContent: 'Almost Matcg',
        ),
      ];

      final suggestions = comparator.suggestKeyMappings(widgets, nodes);
      expect(suggestions.length, 2);
      expect(
        suggestions.first.confidence,
        greaterThanOrEqualTo(suggestions.last.confidence),
      );
    });
  });

  group('compare key coverage', () {
    test('reports key coverage when no keys present', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
          description: 'Text(10,10)',
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'title',
          name: 'Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
        ),
      ];

      final result = comparator.compare(widgets, nodes);
      expect(result.keyCoverage, isNotNull);
      expect(result.keyCoverage!.expectedKeys, 1);
      expect(result.keyCoverage!.foundKeys, 0);
      expect(result.keyCoverage!.widgetCount, 1);
      expect(result.keyCoverage!.coverage, 0.0);
    });

    test('reports full coverage when all keys present', () {
      final widgets = [
        WidgetStyle(
          key: 'title',
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
          description: "Text(key: Key('title'))",
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'title',
          name: 'Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Hello',
        ),
      ];

      final result = comparator.compare(widgets, nodes);
      expect(result.keyCoverage!.coverage, 1.0);
      expect(result.keyCoverage!.foundKeys, 1);
    });

    test('triggers suggestions when coverage below 20%', () {
      final widgets = [
        WidgetStyle(
          widgetType: 'Text',
          bounds: const Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Welcome Back',
          description: 'Text(10,10)',
        ),
      ];
      const nodes = [
        DesignNode(
          id: 'headerTitle',
          name: 'Header Title',
          type: NodeType.text,
          bounds: Bounds(x: 10, y: 10, width: 200, height: 30),
          textContent: 'Welcome Back',
        ),
      ];

      final result = comparator.compare(widgets, nodes);
      expect(result.keySuggestions, isNotNull);
      expect(result.keySuggestions!.length, 1);
      expect(result.keySuggestions!.first.nodeId, 'headerTitle');
    });
  });

  group('compareProperties', () {
    test('detects font size mismatch', () {
      final widget = WidgetStyle(
        key: 'title',
        widgetType: 'Text',
        bounds: const Bounds(x: 0, y: 0, width: 200, height: 30),
        fontSize: 14,
        description: "Text(key: Key('title'))",
      );
      const node = DesignNode(
        id: 'title',
        name: 'Title',
        type: NodeType.text,
        bounds: Bounds(x: 0, y: 0, width: 200, height: 30),
        typography: Typography(
          fontFamily: 'Inter',
          fontSize: 24,
          fontWeight: 400,
        ),
      );

      final mismatches = comparator.compareProperties(widget, node);
      final fontSizeMismatch = mismatches.where((m) => m.property == 'fontSize');
      expect(fontSizeMismatch.length, 1);
      expect(fontSizeMismatch.first.severity, Severity.fail);
    });

    test('detects width mismatch', () {
      final widget = WidgetStyle(
        widgetType: 'Container',
        bounds: const Bounds(x: 0, y: 0, width: 200, height: 100),
        description: 'Container(0,0)',
      );
      const node = DesignNode(
        id: 'box',
        name: 'Box',
        type: NodeType.frame,
        bounds: Bounds(x: 0, y: 0, width: 300, height: 100),
      );

      final mismatches = comparator.compareProperties(widget, node);
      final widthMismatch = mismatches.where((m) => m.property == 'width');
      expect(widthMismatch.length, 1);
    });

    test('no mismatches for identical properties', () {
      final widget = WidgetStyle(
        widgetType: 'Container',
        bounds: const Bounds(x: 0, y: 0, width: 200, height: 100),
        description: 'Container(0,0)',
      );
      const node = DesignNode(
        id: 'box',
        name: 'Box',
        type: NodeType.frame,
        bounds: Bounds(x: 0, y: 0, width: 200, height: 100),
      );

      final mismatches = comparator.compareProperties(widget, node);
      expect(mismatches, isEmpty);
    });
  });
}
