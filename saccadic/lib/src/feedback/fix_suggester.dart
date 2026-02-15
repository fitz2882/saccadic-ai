/// Fix Suggester — generates Flutter/Dart code snippets for fixes.
///
/// Instead of CSS suggestions (like the TypeScript version), this generates
/// Dart code that the developer can copy-paste into their Flutter app.
library;
import '../core/types.dart';

class FixSuggester {
  /// Generate a Dart/Flutter fix suggestion for a property mismatch.
  String suggestFix(WidgetPropertyMismatch mismatch) {
    final widget = mismatch.widget;

    switch (mismatch.property) {
      case 'backgroundColor':
        return _colorFix('color', mismatch.expected, widget);
      case 'color':
        return _textColorFix(mismatch.expected, widget);
      case 'fontSize':
        return 'Change fontSize: ${mismatch.actual} to '
            'fontSize: ${mismatch.expected} in TextStyle on $widget';
      case 'fontWeight':
        return 'Change fontWeight to FontWeight.w${mismatch.expected} '
            'in TextStyle on $widget';
      case 'fontFamily':
        return "Change fontFamily to '${mismatch.expected}' "
            'in TextStyle on $widget';
      case 'lineHeight':
        return 'Change height (line height multiplier) in TextStyle on $widget';
      case 'letterSpacing':
        return 'Change letterSpacing to ${mismatch.expected} '
            'in TextStyle on $widget';
      case 'width':
        return 'Change width from ${mismatch.actual} to ${mismatch.expected} on $widget. '
            'Use SizedBox(width: ${mismatch.expected}) or Container(width: ${mismatch.expected}).';
      case 'height':
        return 'Change height from ${mismatch.actual} to ${mismatch.expected} on $widget. '
            'Use SizedBox(height: ${mismatch.expected}) or Container(height: ${mismatch.expected}).';
      case 'borderRadius':
        return 'Change BorderRadius.circular(${mismatch.actual}) to '
            'BorderRadius.circular(${mismatch.expected}) on $widget';
      case 'gap':
        return 'Change mainAxisSpacing/crossAxisSpacing from ${mismatch.actual} '
            'to ${mismatch.expected} on $widget';
      default:
        if (mismatch.property.startsWith('padding')) {
          return _paddingFix(mismatch);
        }
        return 'Change ${mismatch.property}: ${mismatch.actual} to '
            '${mismatch.property}: ${mismatch.expected} on $widget';
    }
  }

  String _colorFix(String property, String expected, String widget) {
    final hex = expected.replaceFirst('#', '');
    return 'Change $property to Color(0xFF$hex) on $widget';
  }

  String _textColorFix(String expected, String widget) {
    final hex = expected.replaceFirst('#', '');
    return 'Change TextStyle color to Color(0xFF$hex) on $widget';
  }

  String _paddingFix(WidgetPropertyMismatch mismatch) {
    final side = mismatch.property.replaceFirst('padding', '').toLowerCase();
    return 'Change padding $side from ${mismatch.actual} to ${mismatch.expected} '
        'in EdgeInsets on ${mismatch.widget}';
  }
}
