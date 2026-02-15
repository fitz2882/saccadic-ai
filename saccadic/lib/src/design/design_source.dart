/// Abstract interface for design inputs (Pencil, Figma, etc.)
library;
import '../core/types.dart';

/// Parameters for loading a design.
class DesignSourceParams {
  final String? pencilFile;
  final String? pencilFrame;
  final String? pencilTheme;
  final String? figmaUrl;
  final String? figmaFileKey;
  final String? figmaNodeId;
  final String? tokenFile;
  final String? referenceImage; // base64, file path, or URL

  const DesignSourceParams({
    this.pencilFile,
    this.pencilFrame,
    this.pencilTheme,
    this.figmaUrl,
    this.figmaFileKey,
    this.figmaNodeId,
    this.tokenFile,
    this.referenceImage,
  });
}

/// Abstract interface for loading design state from various sources.
abstract class DesignSource {
  /// Parse the source into a [DesignState].
  Future<DesignState> load(DesignSourceParams params);
}
