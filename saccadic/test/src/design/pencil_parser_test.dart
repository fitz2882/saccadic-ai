import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/design/pencil_parser.dart';
import 'package:saccadic/src/design/pencil_types.dart';
import 'package:test/test.dart';

void main() {
  late PencilParser parser;

  setUp(() {
    parser = PencilParser();
  });

  group('parse', () {
    test('parses simple frame with text child', () {
      final penData = PenFile(
        version: '1.0',
        children: [
          PenNode(
            type: 'frame',
            id: 'root',
            name: 'HomePage',
            width: 375,
            height: 812,
            layout: 'vertical',
            padding: 16,
            children: [
              PenNode(
                type: 'text',
                id: 'title',
                name: 'Title',
                content: 'Hello World',
                fontSize: 24,
                fontWeight: 700,
                fontFamily: 'Inter',
                fill: '#000000',
              ),
            ],
          ),
        ],
      );

      final state = parser.parse(penData);

      expect(state.id, 'pencil');
      expect(state.nodes.length, 1);
      expect(state.nodes.first.name, 'HomePage');
      expect(state.nodes.first.type, NodeType.frame);
      expect(state.nodes.first.children.length, 1);

      final title = state.nodes.first.children.first;
      expect(title.name, 'Title');
      expect(title.type, NodeType.text);
      expect(title.textContent, 'Hello World');
      expect(title.typography?.fontSize, 24);
      expect(title.typography?.fontWeight, 700);
      expect(title.typography?.color, '#000000');
    });

    test('resolves fill_container sizing', () {
      final penData = PenFile(
        version: '1.0',
        children: [
          PenNode(
            type: 'frame',
            id: 'parent',
            name: 'Parent',
            width: 375,
            height: 812,
            children: [
              PenNode(
                type: 'frame',
                id: 'child',
                name: 'Child',
                width: 'fill_container',
                height: 100,
              ),
            ],
          ),
        ],
      );

      final state = parser.parse(penData);
      final child = state.nodes.first.children.first;
      expect(child.bounds.width, 375); // fills parent
    });

    test('resolves component refs', () {
      final penData = PenFile(
        version: '1.0',
        children: [
          PenNode(
            type: 'frame',
            id: 'btn',
            name: 'Button',
            reusable: true,
            width: 200,
            height: 48,
            fill: '#0000FF',
            children: [
              PenNode(
                type: 'text',
                id: 'btnLabel',
                name: 'Label',
                content: 'Click me',
                fontSize: 16,
              ),
            ],
          ),
          PenNode(
            type: 'frame',
            id: 'page',
            name: 'Page',
            width: 375,
            height: 812,
            children: [
              PenNode(
                type: 'ref',
                id: 'myBtn',
                ref: 'btn',
                x: 10,
                y: 10,
              ),
            ],
          ),
        ],
      );

      final state = parser.parse(
        penData,
        const PencilParseOptions(frameName: 'Page'),
      );

      final page = state.nodes.first;
      expect(page.children.length, 1);

      final btnInstance = page.children.first;
      expect(btnInstance.type, NodeType.instance);
      expect(btnInstance.id, 'myBtn');
      expect(btnInstance.bounds.width, 200);
      expect(btnInstance.children.length, 1);
      expect(btnInstance.children.first.textContent, 'Click me');
    });

    test('resolves variables', () {
      final penData = PenFile(
        version: '1.0',
        variables: {
          '--primary': PenVariable(type: 'color', value: '#FF5733'),
        },
        children: [
          PenNode(
            type: 'frame',
            id: 'box',
            name: 'Box',
            width: 100,
            height: 100,
            fill: r'$--primary',
          ),
        ],
      );

      final state = parser.parse(penData);
      expect(state.nodes.first.fills?.first.color, '#FF5733');
    });
  });

  group('listFrames', () {
    test('lists top-level frames', () {
      final penData = PenFile(
        version: '1.0',
        children: [
          PenNode(type: 'frame', id: 'p1', name: 'HomePage', width: 375, height: 812),
          PenNode(type: 'frame', id: 'p2', name: 'Settings', width: 375, height: 812),
          PenNode(type: 'frame', id: 'btn', name: 'Button', reusable: true, width: 200, height: 48),
        ],
      );

      final frames = parser.listFrames(penData);
      expect(frames.length, 3);
      expect(frames[0].name, 'HomePage');
      expect(frames[1].name, 'Settings');
    });
  });

  group('describeNodeTree', () {
    test('generates readable tree', () {
      final nodes = [
        const DesignNode(
          id: 'root',
          name: 'Page',
          type: NodeType.frame,
          bounds: Bounds(x: 0, y: 0, width: 375, height: 812),
          children: [
            DesignNode(
              id: 'title',
              name: 'Title',
              type: NodeType.text,
              bounds: Bounds(x: 16, y: 16, width: 343, height: 30),
              textContent: 'Hello',
            ),
          ],
        ),
      ];

      final tree = parser.describeNodeTree(nodes);
      expect(tree, contains('FRAME "Page"'));
      expect(tree, contains('TEXT "Title" "Hello"'));
    });
  });
}
