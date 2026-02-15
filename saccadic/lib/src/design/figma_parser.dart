/// Figma REST API parser — fetches design data and images.
library;
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../core/types.dart';
import 'design_source.dart';

class FigmaParser implements DesignSource {
  final String? _apiToken;

  FigmaParser({String? apiToken})
      : _apiToken = apiToken ?? const String.fromEnvironment('FIGMA_TOKEN');

  @override
  Future<DesignState> load(DesignSourceParams params) async {
    final fileKey = params.figmaFileKey ?? _extractFileKey(params.figmaUrl);
    if (fileKey == null) {
      throw ArgumentError('No Figma file key or URL provided');
    }
    return parseFromFigma(fileKey, params.figmaNodeId);
  }

  /// Parse a Figma file into a DesignState.
  Future<DesignState> parseFromFigma(String fileKey, [String? nodeId]) async {
    final token = _apiToken;
    if (token == null || token.isEmpty) {
      throw StateError('FIGMA_TOKEN not set. Pass it via environment or constructor.');
    }

    final uri = nodeId != null
        ? Uri.parse('https://api.figma.com/v1/files/$fileKey/nodes?ids=$nodeId')
        : Uri.parse('https://api.figma.com/v1/files/$fileKey');

    final response = await http.get(uri, headers: {'X-FIGMA-TOKEN': token});
    if (response.statusCode != 200) {
      throw Exception('Figma API error ${response.statusCode}: ${response.body}');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return _parseFigmaResponse(data, fileKey, nodeId);
  }

  /// Fetch a rendered image of a Figma node as PNG bytes.
  Future<Uint8List> fetchImage(String fileKey, String nodeId, {int scale = 2}) async {
    final token = _apiToken;
    if (token == null || token.isEmpty) {
      throw StateError('FIGMA_TOKEN not set');
    }

    final uri = Uri.parse(
      'https://api.figma.com/v1/images/$fileKey?ids=$nodeId&format=png&scale=$scale',
    );
    final response = await http.get(uri, headers: {'X-FIGMA-TOKEN': token});
    if (response.statusCode != 200) {
      throw Exception('Figma Images API error ${response.statusCode}');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final images = data['images'] as Map<String, dynamic>;
    final imageUrl = images.values.first as String;

    final imgResponse = await http.get(Uri.parse(imageUrl));
    return imgResponse.bodyBytes;
  }

  DesignState _parseFigmaResponse(
    Map<String, dynamic> data,
    String fileKey,
    String? nodeId,
  ) {
    final name = data['name'] as String? ?? fileKey;

    Map<String, dynamic>? document;
    if (nodeId != null) {
      final nodes = data['nodes'] as Map<String, dynamic>?;
      if (nodes != null && nodes.isNotEmpty) {
        final nodeData = nodes.values.first as Map<String, dynamic>;
        document = nodeData['document'] as Map<String, dynamic>?;
      }
    } else {
      document = data['document'] as Map<String, dynamic>?;
    }

    if (document == null) {
      return DesignState(
        id: fileKey,
        name: name,
        viewport: const Viewport(width: 1280, height: 800),
        nodes: [],
      );
    }

    final nodes = _parseFigmaNode(document);
    final frame = document['absoluteBoundingBox'] as Map<String, dynamic>?;
    final width = (frame?['width'] as num?)?.toInt() ?? 1280;
    final height = (frame?['height'] as num?)?.toInt() ?? 800;

    return DesignState(
      id: fileKey,
      name: name,
      viewport: Viewport(width: width, height: height),
      nodes: nodes != null ? [nodes] : [],
    );
  }

  DesignNode? _parseFigmaNode(Map<String, dynamic> node) {
    final type = _mapFigmaType(node['type'] as String? ?? 'FRAME');
    final bb = node['absoluteBoundingBox'] as Map<String, dynamic>?;
    final bounds = bb != null
        ? Bounds(
            x: (bb['x'] as num).toDouble(),
            y: (bb['y'] as num).toDouble(),
            width: (bb['width'] as num).toDouble(),
            height: (bb['height'] as num).toDouble(),
          )
        : const Bounds(x: 0, y: 0, width: 0, height: 0);

    final children = (node['children'] as List<dynamic>?)
            ?.map((c) => _parseFigmaNode(c as Map<String, dynamic>))
            .whereType<DesignNode>()
            .toList() ??
        [];

    // Parse fills
    final figmaFills = node['fills'] as List<dynamic>?;
    List<Fill>? fills;
    if (figmaFills != null && figmaFills.isNotEmpty) {
      fills = figmaFills
          .where((f) => f['visible'] != false)
          .map((f) {
            final color = f['color'] as Map<String, dynamic>?;
            if (color != null) {
              final r = ((color['r'] as num).toDouble() * 255).round();
              final g = ((color['g'] as num).toDouble() * 255).round();
              final b = ((color['b'] as num).toDouble() * 255).round();
              final hex = '#${r.toRadixString(16).padLeft(2, '0')}'
                  '${g.toRadixString(16).padLeft(2, '0')}'
                  '${b.toRadixString(16).padLeft(2, '0')}'
                  .toUpperCase();
              return Fill(type: FillType.solid, color: hex);
            }
            return null;
          })
          .whereType<Fill>()
          .toList();
    }

    // Parse typography
    Typography? typography;
    final style = node['style'] as Map<String, dynamic>?;
    if (style != null) {
      typography = Typography(
        fontFamily: style['fontFamily'] as String? ?? 'Inter',
        fontSize: (style['fontSize'] as num?)?.toDouble() ?? 16,
        fontWeight: (style['fontWeight'] as num?)?.toInt() ?? 400,
        lineHeight: (style['lineHeightPx'] as num?)?.toDouble(),
        letterSpacing: (style['letterSpacing'] as num?)?.toDouble(),
      );
    }

    return DesignNode(
      id: node['id'] as String? ?? '',
      name: node['name'] as String? ?? '',
      type: type,
      bounds: bounds,
      fills: fills,
      typography: typography,
      textContent: node['characters'] as String?,
      children: children,
    );
  }

  NodeType _mapFigmaType(String figmaType) {
    switch (figmaType) {
      case 'FRAME':
      case 'GROUP':
        return NodeType.frame;
      case 'TEXT':
        return NodeType.text;
      case 'RECTANGLE':
        return NodeType.rectangle;
      case 'ELLIPSE':
        return NodeType.ellipse;
      case 'COMPONENT':
        return NodeType.component;
      case 'INSTANCE':
        return NodeType.instance;
      case 'VECTOR':
      case 'LINE':
        return NodeType.vector;
      default:
        return NodeType.frame;
    }
  }

  String? _extractFileKey(String? url) {
    if (url == null) return null;
    // https://www.figma.com/file/FILEKEY/...
    final match = RegExp(r'figma\.com/(?:file|design)/([a-zA-Z0-9]+)').firstMatch(url);
    return match?.group(1);
  }
}
