/// Flutter VM service integration — connect, screenshot, widget tree extraction.
///
/// Connects to a running Flutter app via the VM service protocol
/// to capture screenshots and extract the widget tree with properties.
library;
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

import '../core/types.dart';
import 'widget_style.dart';

/// Diagnostic info from widget tree extraction.
class InspectionDiagnostics {
  final int widgetsExtracted;
  final bool vmServiceConnected;
  final String treeExtensionUsed;
  final List<String>? rawResponseKeys;
  final String? hint;

  const InspectionDiagnostics({
    required this.widgetsExtracted,
    required this.vmServiceConnected,
    required this.treeExtensionUsed,
    this.rawResponseKeys,
    this.hint,
  });

  Map<String, dynamic> toJson() => {
        'widgetsExtracted': widgetsExtracted,
        'vmServiceConnected': vmServiceConnected,
        'treeExtensionUsed': treeExtensionUsed,
        if (rawResponseKeys != null) 'rawResponseKeys': rawResponseKeys,
        if (hint != null) 'hint': hint,
      };
}

/// Result of inspecting a running Flutter app.
class FlutterInspectionResult {
  /// Screenshot of the app as PNG bytes.
  final Uint8List screenshot;

  /// Extracted widget styles from the render tree.
  final List<WidgetStyle> widgets;

  /// The viewport dimensions of the app.
  final Viewport viewport;

  /// Diagnostic info (populated when extraction encounters issues).
  final InspectionDiagnostics? diagnostics;

  const FlutterInspectionResult({
    required this.screenshot,
    required this.widgets,
    required this.viewport,
    this.diagnostics,
  });
}

/// Connects to a running Flutter app's VM service.
class FlutterInspector {
  VmService? _service;
  String? _isolateId;

  /// The last diagnostics from [extractWidgetTree].
  InspectionDiagnostics? lastDiagnostics;

  /// Connect to a Flutter app at the given WebSocket URI.
  ///
  /// Example: `ws://127.0.0.1:52341/ws`
  Future<void> connect(String wsUri) async {
    _wsUri = wsUri;
    _service = await vmServiceConnectUri(wsUri);

    // Find the main isolate
    final vm = await _service!.getVM();
    for (final isolate in vm.isolates ?? <IsolateRef>[]) {
      _isolateId = isolate.id;
      break;
    }

    if (_isolateId == null) {
      throw StateError('No isolate found in Flutter VM');
    }
  }

  /// The WebSocket URI used to connect (needed for flutter screenshot fallback).
  String? _wsUri;

  /// Capture a screenshot of the running Flutter app.
  ///
  /// Tries VM service extension first (`_flutter.screenshot`), then falls back
  /// to `flutter screenshot` CLI command with device type (works with both
  /// Impeller and Skia). The VM extension does not work with Impeller
  /// (Flutter's default renderer since 3.16+), so the CLI fallback is expected
  /// for most modern Flutter apps.
  Future<Uint8List> captureScreenshot() async {
    _ensureConnected();

    // Try VM service extension first
    try {
      final response = await _service!.callServiceExtension(
        '_flutter.screenshot',
        isolateId: _isolateId,
      );

      final screenshotBase64 = response.json?['screenshot'] as String?;
      if (screenshotBase64 != null) {
        return base64Decode(screenshotBase64);
      }
    } catch (_) {
      // Fall through to CLI fallback
    }

    // Fallback: use `flutter screenshot` CLI command
    return _captureViaFlutterCli();
  }

  /// Fallback screenshot capture using `flutter screenshot` CLI.
  ///
  /// Tries device type first (works with Impeller and Skia), then rasterizer
  /// type as fallback (requires Skia).
  Future<Uint8List> _captureViaFlutterCli() async {
    final tmpFile = File(
      '${Directory.systemTemp.path}/saccadic_screenshot_${DateTime.now().millisecondsSinceEpoch}.png',
    );

    try {
      final observatoryUrl = _wsUri
          ?.replaceFirst('ws://', 'http://')
          .replaceFirst(RegExp(r'/ws$'), '');

      // Try device type first — it works with both Impeller and Skia.
      // Rasterizer type requires Skia and fails with Impeller (default since 3.16+).
      final attempts = <(String, List<String>)>[
        (
          'device',
          [
            'screenshot',
            '--type=device',
            '--out=${tmpFile.path}',
          ],
        ),
        (
          'rasterizer',
          [
            'screenshot',
            '--type=rasterizer',
            '--out=${tmpFile.path}',
            if (observatoryUrl != null) '--vm-service-url=$observatoryUrl',
          ],
        ),
      ];

      String lastError = '';
      for (final (name, args) in attempts) {
        final result = await Process.run('flutter', args);
        if (result.exitCode == 0 && tmpFile.existsSync()) {
          return tmpFile.readAsBytesSync();
        }
        lastError = '$name: ${result.stderr}';
      }

      throw StateError('All flutter screenshot methods failed. $lastError');
    } finally {
      if (tmpFile.existsSync()) {
        tmpFile.deleteSync();
      }
    }
  }

  /// Extract widget tree with visual properties.
  ///
  /// Tries `ext.flutter.inspector.getRootWidgetTree` first (Flutter 3.13+),
  /// falls back to `getRootWidgetSummaryTree` for older versions.
  Future<List<WidgetStyle>> extractWidgetTree() async {
    _ensureConnected();

    Map<String, dynamic>? rootNode;
    String extensionUsed = 'none';
    List<String>? rawKeys;

    // Try the newer getRootWidgetTree API first (Flutter 3.13+).
    // Do NOT pass withPreviews — it triggers internal widget screenshot
    // capture which crashes on Impeller (default renderer since 3.16+)
    // with "Compressed screenshots not supported for Impeller" and a
    // null check error in WidgetInspectorService._getRootWidgetTree.
    try {
      final response = await _service!.callServiceExtension(
        'ext.flutter.inspector.getRootWidgetTree',
        isolateId: _isolateId,
        args: {
          'objectGroup': 'saccadic-inspect',
          'isSummaryTree': 'true',
        },
      );
      extensionUsed = 'getRootWidgetTree';
      rootNode = _parseTreeResponse(response);
      rawKeys = response.json?.keys.toList();
    } catch (_) {
      // Fall back to summary tree
    }

    // Fallback: getRootWidgetSummaryTree
    if (rootNode == null) {
      try {
        final response = await _service!.callServiceExtension(
          'ext.flutter.inspector.getRootWidgetSummaryTree',
          isolateId: _isolateId,
          args: {'objectGroup': 'saccadic-inspect'},
        );
        extensionUsed = 'getRootWidgetSummaryTree';
        rootNode = _parseTreeResponse(response);
        rawKeys = response.json?.keys.toList();
      } catch (e) {
        stderr.writeln('[saccadic] Failed to get widget tree: $e');
      }
    }

    if (rootNode == null) {
      lastDiagnostics = InspectionDiagnostics(
        widgetsExtracted: 0,
        vmServiceConnected: true,
        treeExtensionUsed: extensionUsed,
        rawResponseKeys: rawKeys,
        hint: 'Widget tree response was null or empty. '
            'Verify the Flutter app is fully rendered.',
      );
      return [];
    }

    final widgets = <WidgetStyle>[];
    _walkWidgetTree(rootNode, widgets, null);

    // Fetch render bounds for widgets that have valueIds
    await _fetchRenderBounds(rootNode, widgets);

    if (widgets.isEmpty) {
      stderr.writeln(
        '[saccadic] Widget tree parsed but 0 widgets extracted. '
        'Extension: $extensionUsed, response keys: $rawKeys',
      );
    }

    lastDiagnostics = InspectionDiagnostics(
      widgetsExtracted: widgets.length,
      vmServiceConnected: true,
      treeExtensionUsed: extensionUsed,
      rawResponseKeys: rawKeys,
      hint: widgets.isEmpty
          ? 'No widgets extracted — verify the Flutter app is fully '
              "rendered and has Key('nodeId') attributes"
          : null,
    );

    return widgets;
  }

  /// Parse the VM service response into a root node map.
  ///
  /// The response structure varies across Flutter versions:
  /// - Some wrap the tree in a `result` key
  /// - Some return the tree directly (has `children` key)
  Map<String, dynamic>? _parseTreeResponse(Response response) {
    final json = response.json;
    if (json == null) return null;

    // Check if the response itself is the root node (has children key)
    if (json.containsKey('children')) {
      return json;
    }

    // Try the 'result' wrapper
    final resultJson = json['result'];
    if (resultJson is String) {
      try {
        return jsonDecode(resultJson) as Map<String, dynamic>?;
      } catch (_) {
        return null;
      }
    }
    if (resultJson is Map<String, dynamic>) {
      return resultJson;
    }

    return null;
  }

  /// Full inspection: screenshot + widget tree in parallel.
  Future<FlutterInspectionResult> inspect() async {
    _ensureConnected();

    final results = await Future.wait([
      captureScreenshot(),
      extractWidgetTree(),
    ]);

    final screenshot = results[0] as Uint8List;
    final widgets = results[1] as List<WidgetStyle>;

    // Derive viewport from actual screenshot PNG dimensions
    final viewport = _viewportFromPng(screenshot);

    return FlutterInspectionResult(
      screenshot: screenshot,
      widgets: widgets,
      viewport: viewport,
      diagnostics: lastDiagnostics,
    );
  }

  /// Decode PNG bytes to get actual viewport dimensions.
  Viewport _viewportFromPng(Uint8List pngBytes) {
    try {
      final decoded = img.decodePng(pngBytes);
      if (decoded != null) {
        return Viewport(width: decoded.width, height: decoded.height);
      }
    } catch (_) {
      // Fall through to default
    }
    // Fallback if PNG decoding fails
    return const Viewport(width: 1280, height: 800);
  }

  /// Trigger a hot reload on the connected Flutter app.
  ///
  /// Hot reload injects updated source code into the running Dart VM
  /// and rebuilds the widget tree without losing state. This is the
  /// two-step process:
  ///   1. `reloadSources` — inject updated code into the VM
  ///   2. `ext.flutter.reassemble` — rebuild the widget tree
  ///
  /// Only works in debug mode (JIT compilation). Profile and release
  /// builds use AOT compilation and cannot hot reload.
  ///
  /// Returns true if the reload succeeded, false otherwise.
  Future<bool> hotReload() async {
    _ensureConnected();

    try {
      final report = await _service!.reloadSources(_isolateId!);
      final success = report.success ?? false;
      if (!success) {
        stderr.writeln(
          '[saccadic] Hot reload failed: source injection unsuccessful.',
        );
        return false;
      }

      // Brief delay for VM to process injected code
      await Future<void>.delayed(const Duration(milliseconds: 200));

      // Rebuild widget tree
      await _service!.callServiceExtension(
        'ext.flutter.reassemble',
        isolateId: _isolateId,
      );

      // Allow widget tree to settle after reassembly
      await Future<void>.delayed(const Duration(milliseconds: 300));

      stderr.writeln('[saccadic] Hot reload succeeded.');
      return true;
    } catch (e) {
      stderr.writeln('[saccadic] Hot reload failed: $e');
      return false;
    }
  }

  /// Disconnect from the VM service.
  Future<void> disconnect() async {
    await _service?.dispose();
    _service = null;
    _isolateId = null;
  }

  void _ensureConnected() {
    if (_service == null || _isolateId == null) {
      throw StateError('Not connected to Flutter VM. Call connect() first.');
    }
  }

  /// Walk the widget tree and extract WidgetStyle for every node.
  ///
  /// Unlike the previous implementation, this does NOT filter by bounds.
  /// Widgets with zero bounds still participate in Key matching (Pass 0),
  /// which is the primary matching strategy.
  void _walkWidgetTree(
    Map<String, dynamic> node,
    List<WidgetStyle> widgets,
    String? parentKey,
  ) {
    final description = node['description'] as String? ?? '';
    final widgetType = node['widgetRuntimeType'] as String? ?? description;

    // Extract Key — check properties first (most reliable), then valueId
    final key = _extractKey(node);

    // Extract bounds from render object (if present in the tree)
    final bounds = _extractBounds(node);

    // Extract style properties
    String? backgroundColor;
    String? textColor;
    double? fontSize;
    int? fontWeight;
    String? fontFamily;
    double? lineHeight;
    double? letterSpacing;
    String? textContent;
    Spacing? padding;
    double? gap;
    CornerRadius? cornerRadius;
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
          case 'style':
            // TextStyle parsing would go deeper
            break;
          case 'padding':
            padding = _parseEdgeInsets(propValue);
          case 'mainAxisSpacing' || 'spacing':
            gap = double.tryParse(propValue);
          case 'direction':
            if (propValue.contains('vertical')) {
              layoutDirection = LayoutMode.vertical;
            } else if (propValue.contains('horizontal')) {
              layoutDirection = LayoutMode.horizontal;
            }
          case 'decoration':
            // Parse BoxDecoration for color, borderRadius
            break;
        }
      }
    }

    // Determine layout direction from widget type
    if (widgetType == 'Column' || widgetType == 'ListView') {
      layoutDirection = LayoutMode.vertical;
    } else if (widgetType == 'Row') {
      layoutDirection = LayoutMode.horizontal;
    }

    final children = node['children'] as List<dynamic>?;
    final childCount = children?.length ?? 0;

    // Always include the widget — bounds of (0,0,0,0) just means IoU
    // matching won't work, but Key matching (Pass 0) doesn't need bounds.
    widgets.add(
      WidgetStyle(
        key: key,
        widgetType: widgetType,
        bounds: bounds,
        backgroundColor: backgroundColor,
        textColor: textColor,
        fontSize: fontSize,
        fontWeight: fontWeight,
        fontFamily: fontFamily,
        lineHeight: lineHeight,
        letterSpacing: letterSpacing,
        textContent: textContent,
        padding: padding,
        gap: gap,
        cornerRadius: cornerRadius,
        layoutDirection: layoutDirection,
        childCount: childCount,
        description: '$widgetType${key != null ? "(key: Key('$key'))" : ""}',
        parentKey: parentKey,
      ),
    );

    // Recurse into children
    if (children != null) {
      for (final child in children) {
        if (child is Map<String, dynamic>) {
          _walkWidgetTree(child, widgets, key);
        }
      }
    }
  }

  /// Extract a Key value from a widget tree node.
  ///
  /// Checks the `properties` list first (most reliable), then falls back
  /// to the `valueId` field. Handles multiple Key formats:
  /// - `[<'heroTitle'>]` — Flutter's default Key.toString()
  /// - `ValueKey<String>('heroTitle')` — explicit ValueKey
  /// - `Key('heroTitle')` — shorthand
  /// - `GlobalKey#12345` — GlobalKey (extracted as-is)
  static String? _extractKey(Map<String, dynamic> node) {
    // Primary: check properties list
    final properties = node['properties'] as List<dynamic>?;
    if (properties != null) {
      for (final prop in properties) {
        if (prop is! Map) continue;
        if (prop['name'] != 'key') continue;

        final keyDesc = prop['description'] as String?;
        if (keyDesc == null) continue;

        final extracted = parseKeyDescription(keyDesc);
        if (extracted != null) return extracted;
      }
    }

    // Fallback 1: check description field (summary tree embeds keys as
    // "WidgetType-[<'keyId'>]" in the description string)
    final description = node['description'] as String?;
    if (description != null) {
      final extracted = parseKeyDescription(description);
      if (extracted != null) return extracted;
    }

    // Fallback 2: valueId field (rarely contains a usable key, but check)
    final valueId = node['valueId'] as String?;
    if (valueId != null) {
      // valueId is usually an opaque reference like "inspector-0", but
      // check in case it's a formatted key string
      final extracted = parseKeyDescription(valueId);
      if (extracted != null) return extracted;
    }

    return null;
  }

  /// Parse a Key description string into the raw key value.
  ///
  /// Handles:
  /// - `[<'heroTitle'>]` — Flutter's default Key.toString()
  /// - `ValueKey<String>('heroTitle')` or `ValueKey<String>("heroTitle")`
  /// - `Key('heroTitle')` or `Key("heroTitle")`
  /// - `GlobalObjectKey<State<StatefulWidget>>('id')` etc.
  static String? parseKeyDescription(String keyDesc) {
    // Pattern 1: [<'heroTitle'>] — Flutter's default toString
    final bracketMatch = RegExp(r"\[<'(.+?)'>]").firstMatch(keyDesc);
    if (bracketMatch != null) return bracketMatch.group(1);

    // Pattern 2: ValueKey<...>('heroTitle') or ValueKey<...>("heroTitle")
    final valueKeyMatch =
        RegExp(r'''ValueKey<[^>]*>\(['"](.+?)['"]\)''').firstMatch(keyDesc);
    if (valueKeyMatch != null) return valueKeyMatch.group(1);

    // Pattern 3: Key('heroTitle') or Key("heroTitle") — without ValueKey prefix
    final simpleKeyMatch =
        RegExp(r'''^Key\(['"](.+?)['"]\)$''').firstMatch(keyDesc);
    if (simpleKeyMatch != null) return simpleKeyMatch.group(1);

    // Pattern 4: GlobalObjectKey<...>('id') or GlobalKey#hash
    final globalKeyMatch =
        RegExp(r'''Global\w*Key[^(]*\(['"](.+?)['"]\)''').firstMatch(keyDesc);
    if (globalKeyMatch != null) return globalKeyMatch.group(1);

    return null;
  }

  /// Extract bounds from a node's renderObject, if present.
  static Bounds _extractBounds(Map<String, dynamic> node) {
    final renderObject = node['renderObject'] as Map<String, dynamic>?;
    if (renderObject == null) {
      return const Bounds(x: 0, y: 0, width: 0, height: 0);
    }

    final desc = renderObject['description'] as String? ?? '';
    // Parse "RenderFlex relayoutBoundary=up1 ... size: Size(375.0, 812.0)"
    final sizeMatch =
        RegExp(r'size: Size\(([\d.]+),\s*([\d.]+)\)').firstMatch(desc);
    if (sizeMatch != null) {
      return Bounds(
        x: 0, // position comes from paint transform
        y: 0,
        width: double.parse(sizeMatch.group(1)!),
        height: double.parse(sizeMatch.group(2)!),
      );
    }

    return const Bounds(x: 0, y: 0, width: 0, height: 0);
  }

  /// Fetch render bounds for keyed widgets via getLayoutExplorerNode.
  ///
  /// The summary tree includes `valueId` on all widgets (including leaf
  /// widgets like Text, Icon, Container). We use `getLayoutExplorerNode`
  /// instead of `getDetailsSubtree` because it returns structured layout
  /// data (`size`, `parentData`) even on Flutter Web where
  /// `getDetailsSubtree` omits `renderObject` data.
  Future<void> _fetchRenderBounds(
    Map<String, dynamic> rootNode,
    List<WidgetStyle> widgets,
  ) async {
    // Build key→widget index map for widgets that need bounds.
    final keyToIndex = <String, int>{};
    for (var i = 0; i < widgets.length; i++) {
      final key = widgets[i].key;
      if (key != null &&
          widgets[i].bounds.width == 0 &&
          widgets[i].bounds.height == 0) {
        keyToIndex[key] = i;
      }
    }

    if (keyToIndex.isEmpty) return;

    // Walk the summary tree to map design keys → valueIds directly.
    final keyToValueId = <String, String>{};
    _collectKeyValueIds(rootNode, keyToValueId);

    stderr.writeln(
      '[saccadic:diag] _fetchRenderBounds: ${keyToValueId.length} '
      'key→valueId mappings found, ${keyToIndex.length} keyed widgets need bounds.',
    );

    if (keyToValueId.isEmpty) return;

    // Batch fetch layout data using getLayoutExplorerNode.
    const batchSize = 20;
    final entriesToFetch = <MapEntry<String, String>>[];
    for (final key in keyToIndex.keys) {
      final valueId = keyToValueId[key];
      if (valueId != null) {
        entriesToFetch.add(MapEntry(key, valueId));
      }
    }

    stderr.writeln(
      '[saccadic:diag] Fetching layout for ${entriesToFetch.length} '
      'keyed widgets via getLayoutExplorerNode.',
    );

    for (var i = 0; i < entriesToFetch.length; i += batchSize) {
      final batch = entriesToFetch.skip(i).take(batchSize);
      final futures = batch.map((entry) async {
        final key = entry.key;
        final valueId = entry.value;
        try {
          final response = await _service!.callServiceExtension(
            'ext.flutter.inspector.getLayoutExplorerNode',
            isolateId: _isolateId,
            args: {
              'objectGroup': 'saccadic-bounds',
              'id': valueId,
              'subtreeDepth': '1',
            },
          );

          final layoutNode = _parseTreeResponse(response);
          if (layoutNode == null) return;

          final bounds = _extractLayoutBounds(layoutNode);
          if (bounds.width > 0 || bounds.height > 0) {
            final idx = keyToIndex[key];
            if (idx != null && idx < widgets.length) {
              _updateWidgetBounds(widgets, idx, bounds);
            }
          }
        } catch (e) {
          stderr.writeln(
            '[saccadic:diag] getLayoutExplorerNode failed for '
            'key="$key" valueId=$valueId: $e',
          );
        }
      });

      await Future.wait(futures);
    }

    // Summary: how many keyed widgets still have zero bounds?
    final stillZero = widgets
        .where((w) => w.key != null && w.bounds.width == 0 && w.bounds.height == 0)
        .toList();
    if (stillZero.isNotEmpty) {
      stderr.writeln(
        '[saccadic:diag] After _fetchRenderBounds: ${stillZero.length} '
        'keyed widgets still have 0-bounds: '
        '${stillZero.take(10).map((w) => '"${w.key}" (${w.widgetType})').join(', ')}'
        '${stillZero.length > 10 ? '...' : ''}',
      );
    } else {
      stderr.writeln(
        '[saccadic:diag] All keyed widgets have non-zero bounds.',
      );
    }
  }

  /// Extract bounds from getLayoutExplorerNode response.
  ///
  /// The response contains structured fields:
  ///   `size: { "width": "392.0", "height": "1684.0" }`
  ///   `parentData: { "offsetX": "24.0", "offsetY": "24.0" }`
  /// Falls back to renderObject.properties for size/offset if structured
  /// fields are missing.
  Bounds _extractLayoutBounds(Map<String, dynamic> node) {
    double width = 0;
    double height = 0;
    double x = 0;
    double y = 0;

    // Primary: structured size/parentData fields from layout explorer
    final size = node['size'] as Map<String, dynamic>?;
    if (size != null) {
      width = double.tryParse('${size['width']}') ?? 0;
      height = double.tryParse('${size['height']}') ?? 0;
    }

    final parentData = node['parentData'] as Map<String, dynamic>?;
    if (parentData != null) {
      x = double.tryParse('${parentData['offsetX']}') ?? 0;
      y = double.tryParse('${parentData['offsetY']}') ?? 0;
    }

    // Fallback: parse from renderObject properties
    if (width == 0 && height == 0) {
      final ro = node['renderObject'] as Map<String, dynamic>?;
      if (ro != null) {
        final props = ro['properties'] as List<dynamic>?;
        if (props != null) {
          for (final prop in props) {
            if (prop is! Map<String, dynamic>) continue;
            final name = prop['name'] as String?;
            final desc = prop['description'] as String?;
            if (desc == null) continue;

            if (name == 'size') {
              final m = RegExp(r'Size\(([\d.]+),\s*([\d.]+)\)').firstMatch(desc);
              if (m != null) {
                width = double.tryParse(m.group(1)!) ?? 0;
                height = double.tryParse(m.group(2)!) ?? 0;
              }
            } else if (name == 'parentData' && x == 0 && y == 0) {
              final m = RegExp(r'Offset\(([\d.]+),\s*([\d.]+)\)').firstMatch(desc);
              if (m != null) {
                x = double.tryParse(m.group(1)!) ?? 0;
                y = double.tryParse(m.group(2)!) ?? 0;
              }
            }
          }
        }
      }
    }

    return Bounds(x: x, y: y, width: width, height: height);
  }

  /// Walk the summary tree to map design keys to their valueIds.
  ///
  /// Every widget in the summary tree (including leaf Text, Icon, Container)
  /// has a `valueId`. We extract the design key from the description field
  /// (e.g., `Text-[<'yr0AQ'>]` → key `yr0AQ`) and map it to the valueId.
  void _collectKeyValueIds(
    Map<String, dynamic> node,
    Map<String, String> keyToValueId,
  ) {
    final valueId = node['valueId'] as String?;
    if (valueId != null) {
      final key = _extractKey(node);
      if (key != null) {
        keyToValueId[key] = valueId;
      }
    }

    final children = node['children'] as List<dynamic>?;
    if (children != null) {
      for (final child in children) {
        if (child is Map<String, dynamic>) {
          _collectKeyValueIds(child, keyToValueId);
        }
      }
    }
  }

  /// Replace a widget in the list with updated bounds.
  static void _updateWidgetBounds(
    List<WidgetStyle> widgets,
    int idx,
    Bounds bounds,
  ) {
    final w = widgets[idx];
    widgets[idx] = WidgetStyle(
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

  /// Parse Flutter EdgeInsets string to Spacing.
  Spacing? _parseEdgeInsets(String value) {
    // "EdgeInsets.all(16.0)"
    final allMatch = RegExp(r'EdgeInsets\.all\(([\d.]+)\)').firstMatch(value);
    if (allMatch != null) {
      final v = double.parse(allMatch.group(1)!);
      return Spacing.all(v);
    }

    // "EdgeInsets(16.0, 8.0, 16.0, 8.0)" — LTRB
    final ltrb = RegExp(r'EdgeInsets\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)')
        .firstMatch(value);
    if (ltrb != null) {
      return Spacing(
        left: double.parse(ltrb.group(1)!),
        top: double.parse(ltrb.group(2)!),
        right: double.parse(ltrb.group(3)!),
        bottom: double.parse(ltrb.group(4)!),
      );
    }

    // "EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0)"
    final sym = RegExp(
      r'EdgeInsets\.symmetric\((?:horizontal:\s*([\d.]+))?,?\s*(?:vertical:\s*([\d.]+))?\)',
    ).firstMatch(value);
    if (sym != null) {
      return Spacing.symmetric(
        horizontal: double.tryParse(sym.group(1) ?? '') ?? 0,
        vertical: double.tryParse(sym.group(2) ?? '') ?? 0,
      );
    }

    return null;
  }
}
