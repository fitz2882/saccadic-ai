/// Saccadic — Visual comparison tool for Flutter apps.
///
/// Compare .pen/Figma designs against running Flutter builds
/// using VM service protocol for widget tree inspection.
library;

export 'src/core/types.dart';
export 'src/core/thresholds.dart';
export 'src/core/color_science.dart';
export 'src/comparison/pixel_comparator.dart';
export 'src/comparison/widget_comparator.dart';
export 'src/comparison/comparison_engine.dart';
export 'src/design/pencil_parser.dart';
export 'src/design/figma_parser.dart';
export 'src/feedback/feedback_generator.dart';
export 'src/feedback/cascade_suppression.dart';
export 'src/feedback/fix_suggester.dart';
export 'src/scoring/scorer.dart';
export 'src/design/pencil_types.dart';
export 'src/design/design_source.dart';
export 'src/flutter/flutter_inspector.dart';
export 'src/flutter/widget_style.dart';
export 'src/plan/plan_generator.dart';
export 'src/plan/agent_prompt_builder.dart';
export 'src/mcp/server.dart';
export 'src/mcp/session.dart';
