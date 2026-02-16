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

  /// Whether the inspector is currently connected to a VM service.
  bool get isConnected => _service != null && _isolateId != null;

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

  /// Navigate to a route in the running Flutter app.
  ///
  /// Uses VM service `evaluate()` to call navigation methods inside the
  /// running app. Tries three strategies in order:
  ///
  /// 1. **GoRouter**: Find a library that imports `go_router`, evaluate an
  ///    expression that walks the element tree to find a context with
  ///    GoRouter as an InheritedWidget, then calls `.go(route)`.
  /// 2. **Navigator**: Use any Flutter library to call
  ///    `Navigator.of(context).pushNamed(route)`.
  /// 3. Returns false if neither works.
  ///
  /// This approach works with any navigation setup — GoRouter, Navigator 2.0,
  /// custom tab bars — because it operates at the route level, not UI tap
  /// simulation.
  ///
  /// Returns true if navigation succeeded.
  Future<bool> navigateToRoute(String route) async {
    _ensureConnected();

    try {
      final isolate = await _service!.getIsolate(_isolateId!);
      final libraries = isolate.libraries ?? [];

      // Strategy 1: GoRouter — find a library that imports go_router
      final goRouterLib = _findLibraryContaining(libraries, 'go_router');
      if (goRouterLib != null) {
        stderr.writeln(
          '[saccadic] Found GoRouter library: ${goRouterLib.uri}',
        );
        final result = await _navigateViaGoRouter(goRouterLib.id!, route);
        if (result) {
          await Future<void>.delayed(const Duration(milliseconds: 500));
          stderr.writeln('[saccadic] Navigated to "$route" via GoRouter.');
          return true;
        }
      }

      // Strategy 2: Navigator.pushNamed — find any Flutter library
      final flutterLib = _findLibraryContaining(libraries, 'flutter');
      if (flutterLib != null) {
        stderr.writeln(
          '[saccadic] Trying Navigator.pushNamed via ${flutterLib.uri}',
        );
        final result = await _navigateViaPushNamed(flutterLib.id!, route);
        if (result) {
          await Future<void>.delayed(const Duration(milliseconds: 500));
          stderr.writeln(
            '[saccadic] Navigated to "$route" via Navigator.pushNamed.',
          );
          return true;
        }
      }

      stderr.writeln(
        '[saccadic] All navigation strategies failed for "$route".',
      );
      return false;
    } catch (e) {
      stderr.writeln('[saccadic] Route navigation failed: $e');
      return false;
    }
  }

  /// Find a library in the isolate whose URI contains [pattern].
  ///
  /// Prefers app-specific libraries (not package: or dart:) when multiple
  /// match, since the app's own routing file is most likely to have the
  /// right imports in scope.
  LibraryRef? _findLibraryContaining(
    List<LibraryRef> libraries,
    String pattern,
  ) {
    LibraryRef? packageMatch;
    for (final lib in libraries) {
      final uri = lib.uri ?? '';
      if (!uri.contains(pattern)) continue;

      // Prefer app-internal libraries (package:my_app/...) over
      // framework libraries (package:go_router/...)
      if (!uri.startsWith('dart:')) {
        if (!uri.startsWith('package:$pattern')) {
          // This is an app library that imports the pattern — best match
          return lib;
        }
        packageMatch ??= lib;
      }
    }
    return packageMatch;
  }

  /// Navigate using GoRouter.of(context).go(route).
  ///
  /// The expression walks the element tree to find a context that has
  /// GoRouter available as an InheritedWidget (since the root element
  /// doesn't have it in scope), then calls `.go(route)`.
  Future<bool> _navigateViaGoRouter(String libraryId, String route) async {
    // Single-line expression — no imports needed because we evaluate
    // against a library that already imports GoRouter.
    final expression = '(() {'
        'GoRouter? r;'
        'void v(Element e){'
        'try{r??=GoRouter.of(e);}catch(_){}'
        'if(r==null)e.visitChildren(v);'
        '}'
        'WidgetsBinding.instance.rootElement!.visitChildren(v);'
        "r?.go('$route');"
        "return r!=null?'navigated':'not found';"
        '})()';

    try {
      final result = await _service!.evaluate(
        _isolateId!,
        libraryId,
        expression,
      );

      final value = result.json?['valueAsString'] as String?;
      return value == 'navigated';
    } catch (e) {
      stderr.writeln('[saccadic] GoRouter evaluate failed: $e');
      return false;
    }
  }

  /// Navigate using Navigator.of(context).pushNamed(route).
  Future<bool> _navigateViaPushNamed(String libraryId, String route) async {
    final expression = '(() {'
        'NavigatorState? n;'
        'void v(Element e){'
        'try{n??=Navigator.of(e);}catch(_){}'
        'if(n==null)e.visitChildren(v);'
        '}'
        'WidgetsBinding.instance.rootElement!.visitChildren(v);'
        "n?.pushNamed('$route');"
        "return n!=null?'navigated':'not found';"
        '})()';

    try {
      final result = await _service!.evaluate(
        _isolateId!,
        libraryId,
        expression,
      );

      final value = result.json?['valueAsString'] as String?;
      return value == 'navigated';
    } catch (e) {
      stderr.writeln('[saccadic] Navigator.pushNamed evaluate failed: $e');
      return false;
    }
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

  /// Fetch render bounds for keyed widgets.
  ///
  /// Uses two strategies:
  /// 1. **Primary**: `evaluate()` with `localToGlobal(Offset.zero)` to get
  ///    absolute screen coordinates. Works correctly with scrollable content
  ///    (ListView, CustomScrollView, SingleChildScrollView).
  /// 2. **Fallback**: `getLayoutExplorerNode` for widgets not resolved by
  ///    the primary method (e.g., if evaluate is unavailable).
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

    // Primary: evaluate() with localToGlobal for absolute positions.
    // This correctly handles widgets inside ScrollView, ListView, etc.
    final resolvedViaEvaluate =
        await _fetchBoundsViaEvaluate(widgets, keyToIndex);

    // Rebuild keyToIndex for widgets still needing bounds
    final remainingKeys = <String, int>{};
    for (final entry in keyToIndex.entries) {
      if (!resolvedViaEvaluate.contains(entry.key)) {
        remainingKeys[entry.key] = entry.value;
      }
    }

    if (remainingKeys.isEmpty) {
      stderr.writeln(
        '[saccadic:diag] All ${keyToIndex.length} keyed widgets resolved '
        'via evaluate (absolute positions).',
      );
      return;
    }

    stderr.writeln(
      '[saccadic:diag] ${resolvedViaEvaluate.length}/${keyToIndex.length} '
      'resolved via evaluate. Falling back to getLayoutExplorerNode for '
      '${remainingKeys.length} remaining.',
    );

    // Fallback: getLayoutExplorerNode (layout-relative positions)
    await _fetchBoundsViaLayoutExplorer(rootNode, widgets, remainingKeys);

    // Summary: how many keyed widgets still have zero bounds?
    final stillZero = widgets
        .where((w) =>
            w.key != null && w.bounds.width == 0 && w.bounds.height == 0,)
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

  /// Fetch bounds via evaluate() using localToGlobal for absolute positions.
  ///
  /// Walks the Flutter element tree inside the running app, finds all widgets
  /// with a ValueKey, and calls `RenderBox.localToGlobal(Offset.zero)` to
  /// get absolute screen coordinates. This correctly handles scrollable
  /// content where layout-relative offsets would report y=0.
  ///
  /// Returns the set of keys that were successfully resolved.
  Future<Set<String>> _fetchBoundsViaEvaluate(
    List<WidgetStyle> widgets,
    Map<String, int> keyToIndex,
  ) async {
    final resolved = <String>{};
    try {
      final isolate = await _service!.getIsolate(_isolateId!);
      final rootLibId = isolate.rootLib?.id;
      if (rootLibId == null) return resolved;

      // Evaluate a Dart expression that walks the element tree and collects
      // absolute bounds for all ValueKey'd widgets in one call.
      const expression = '(() {'
          'final r=<String>[];'
          'void v(Element e){'
          'final w=e.widget;'
          'if(w.key is ValueKey){'
          'final k=(w.key! as ValueKey).value.toString();'
          'final ro=e.findRenderObject();'
          'if(ro is RenderBox && ro.hasSize){'
          'final p=ro.localToGlobal(Offset.zero);'
          'r.add("\$k:\${p.dx},\${p.dy},\${ro.size.width},\${ro.size.height}");'
          '}}'
          'e.visitChildren(v);'
          '}'
          'WidgetsBinding.instance.rootElement!.visitChildren(v);'
          'return r.join(";");'
          '})()';

      final result = await _service!.evaluate(
        _isolateId!,
        rootLibId,
        expression,
      );

      // Parse the result string: "key1:x,y,w,h;key2:x,y,w,h;..."
      final resultJson = result.json;
      final valueStr = resultJson?['valueAsString'] as String?;
      if (valueStr == null || valueStr.isEmpty) return resolved;

      for (final entry in valueStr.split(';')) {
        final colonIdx = entry.indexOf(':');
        if (colonIdx < 0) continue;

        final key = entry.substring(0, colonIdx);
        final parts = entry.substring(colonIdx + 1).split(',');
        if (parts.length != 4) continue;

        final idx = keyToIndex[key];
        if (idx == null) continue;

        final x = double.tryParse(parts[0]) ?? 0;
        final y = double.tryParse(parts[1]) ?? 0;
        final w = double.tryParse(parts[2]) ?? 0;
        final h = double.tryParse(parts[3]) ?? 0;

        if (w > 0 || h > 0) {
          _updateWidgetBounds(widgets, idx, Bounds(x: x, y: y, width: w, height: h));
          resolved.add(key);
        }
      }

      stderr.writeln(
        '[saccadic:diag] evaluate() resolved ${resolved.length} keyed '
        'widget bounds with absolute positions.',
      );
    } catch (e) {
      stderr.writeln(
        '[saccadic:diag] evaluate() bounds fetch failed: $e. '
        'Falling back to getLayoutExplorerNode.',
      );
    }
    return resolved;
  }

  /// Fallback: fetch bounds via getLayoutExplorerNode.
  ///
  /// Returns layout-relative positions (parentData offsets). Less accurate
  /// for scrollable content but works when evaluate() is unavailable.
  Future<void> _fetchBoundsViaLayoutExplorer(
    Map<String, dynamic> rootNode,
    List<WidgetStyle> widgets,
    Map<String, int> keyToIndex,
  ) async {
    final keyToValueId = <String, String>{};
    _collectKeyValueIds(rootNode, keyToValueId);

    if (keyToValueId.isEmpty) return;

    const batchSize = 20;
    final entriesToFetch = <MapEntry<String, String>>[];
    for (final key in keyToIndex.keys) {
      final valueId = keyToValueId[key];
      if (valueId != null) {
        entriesToFetch.add(MapEntry(key, valueId));
      }
    }

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
