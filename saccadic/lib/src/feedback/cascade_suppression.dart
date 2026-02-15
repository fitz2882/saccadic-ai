/// Cascade suppression — filters false positives caused by root-cause mismatches.
///
/// Three rules:
/// 1. Same-element: height suppressed when lineHeight/fontSize/padding mismatched
/// 2. Parent-child: child position/size suppressed when parent has padding/size mismatch
/// 3. Missing/extra reflow: layout/size/spacing suppressed when missing/extra exist
library;
import '../core/types.dart';
import '../flutter/widget_style.dart';

class CascadeSuppression {
  /// Suppress cascading false positives from [feedback].
  List<FeedbackItem> suppress(
    List<FeedbackItem> feedback,
    WidgetDiffResult widgetDiff,
    List<WidgetStyle>? widgets,
  ) {
    // Build per-element mismatch property sets
    final mismatchProps = <String, Set<String>>{};
    for (final m in widgetDiff.mismatches) {
      mismatchProps.putIfAbsent(m.widget, () => {}).add(m.property);
    }

    // Build element bounds map for parent-child inference
    final boundsMap = <String, Bounds>{};
    if (widgets != null) {
      for (final w in widgets) {
        boundsMap[w.identifier] = w.bounds;
      }
    }

    final hasMissingOrExtra = widgetDiff.missing.isNotEmpty || widgetDiff.extra.isNotEmpty;

    return feedback.where((item) {
      if (item.element == null) return true;
      // Always keep root cause items
      if (item.category == FeedbackCategory.missing ||
          item.category == FeedbackCategory.extra) {
        return true;
      }
      if (item.category == FeedbackCategory.color ||
          item.category == FeedbackCategory.typography) {
        return true;
      }

      final msg = item.message;
      final props = mismatchProps[item.element];

      final isHeight = item.category == FeedbackCategory.size && msg.contains('height');
      final isWidth = item.category == FeedbackCategory.size && msg.contains('width');
      final isXPos = item.category == FeedbackCategory.layout && msg.contains('x mismatch');
      final isYPos = item.category == FeedbackCategory.layout && msg.contains('y mismatch');

      // Rule 1: Suppress size when explained by other properties on same element
      if (isHeight && props != null) {
        if (props.contains('lineHeight') ||
            props.contains('fontSize') ||
            props.contains('paddingtop') ||
            props.contains('paddingbottom')) {
          return false;
        }
      }
      if (isWidth && props != null) {
        if (props.contains('paddingleft') ||
            props.contains('paddingright') ||
            props.contains('gap')) {
          return false;
        }
      }

      // Rule 2: Suppress child position/size when parent has relevant mismatch
      if (isXPos && _hasAncestorCascade(item.element!, 'x', mismatchProps, boundsMap)) return false;
      if (isYPos && _hasAncestorCascade(item.element!, 'y', mismatchProps, boundsMap)) return false;
      if (isWidth && _hasAncestorCascade(item.element!, 'width', mismatchProps, boundsMap)) return false;
      if (isHeight && _hasAncestorCascade(item.element!, 'height', mismatchProps, boundsMap)) return false;

      // Rule 3: Missing/extra reflow
      if (hasMissingOrExtra) {
        const cascadeCategories = {
          FeedbackCategory.layout,
          FeedbackCategory.size,
          FeedbackCategory.spacing,
        };
        if (cascadeCategories.contains(item.category)) {
          if (!_isRootCauseSizeItem(item, props)) return false;

          if (isHeight && _isContainer(item.element!, boundsMap)) {
            final otherProps = props != null
                ? props.where((p) => p != 'height').toSet()
                : <String>{};
            if (otherProps.length < 2) return false;
          }
        }
      }

      return true;
    }).toList();
  }

  bool _isRootCauseSizeItem(FeedbackItem item, Set<String>? props) {
    if (item.category == FeedbackCategory.spacing) return true;

    if (item.category == FeedbackCategory.size) {
      final msg = item.message;
      if (msg.contains('height') && props != null) {
        if (props.contains('paddingtop') ||
            props.contains('paddingbottom') ||
            props.contains('lineHeight') ||
            props.contains('fontSize')) {
          return false;
        }
      }
      if (msg.contains('width') && props != null) {
        if (props.contains('paddingleft') ||
            props.contains('paddingright') ||
            props.contains('gap')) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  bool _hasAncestorCascade(
    String element,
    String propertyType,
    Map<String, Set<String>> mismatchProps,
    Map<String, Bounds> boundsMap,
  ) {
    final childBounds = boundsMap[element];
    if (childBounds == null) return false;

    for (final entry in mismatchProps.entries) {
      if (entry.key == element) continue;
      final parentBounds = boundsMap[entry.key];
      if (parentBounds == null) continue;
      if (!parentBounds.contains(childBounds)) continue;

      final props = entry.value;
      switch (propertyType) {
        case 'x':
          if (props.contains('paddingleft') ||
              props.contains('paddingright') ||
              props.contains('width')) {
            return true;
          }
        case 'y':
          if (props.contains('paddingtop') ||
              props.contains('paddingbottom') ||
              props.contains('height')) {
            return true;
          }
        case 'width':
          if (props.contains('paddingleft') ||
              props.contains('paddingright') ||
              props.contains('width')) {
            return true;
          }
        case 'height':
          // Height rarely cascades from ancestor in normal flow
          break;
      }
    }

    return false;
  }

  bool _isContainer(String element, Map<String, Bounds> boundsMap) {
    final elBounds = boundsMap[element];
    if (elBounds == null) return false;

    for (final entry in boundsMap.entries) {
      if (entry.key == element) continue;
      if (elBounds.contains(entry.value)) return true;
    }
    return false;
  }
}
