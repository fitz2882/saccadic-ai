import 'package:saccadic/src/core/types.dart';
import 'package:test/test.dart';

void main() {
  group('Bounds', () {
    test('area calculation', () {
      const b = Bounds(x: 0, y: 0, width: 100, height: 50);
      expect(b.area, 5000);
    });

    test('contains', () {
      const parent = Bounds(x: 0, y: 0, width: 100, height: 100);
      const child = Bounds(x: 10, y: 10, width: 50, height: 50);
      const outside = Bounds(x: 200, y: 200, width: 50, height: 50);

      expect(parent.contains(child), true);
      expect(parent.contains(outside), false);
      expect(child.contains(parent), false);
    });

    test('overlaps', () {
      const a = Bounds(x: 0, y: 0, width: 100, height: 100);
      const b = Bounds(x: 50, y: 50, width: 100, height: 100);
      const c = Bounds(x: 200, y: 200, width: 50, height: 50);

      expect(a.overlaps(b), true);
      expect(a.overlaps(c), false);
    });

    test('iou', () {
      const a = Bounds(x: 0, y: 0, width: 100, height: 100);
      const same = Bounds(x: 0, y: 0, width: 100, height: 100);
      const noOverlap = Bounds(x: 200, y: 200, width: 100, height: 100);

      expect(a.iou(same), 1.0);
      expect(a.iou(noOverlap), 0.0);

      // 50% overlap
      const halfOverlap = Bounds(x: 50, y: 0, width: 100, height: 100);
      final iou = a.iou(halfOverlap);
      expect(iou, greaterThan(0.3));
      expect(iou, lessThan(0.4)); // ~1/3
    });
  });

  group('Spacing', () {
    test('all constructor', () {
      const s = Spacing.all(10);
      expect(s.top, 10);
      expect(s.right, 10);
      expect(s.bottom, 10);
      expect(s.left, 10);
    });

    test('isZero', () {
      expect(const Spacing(top: 0, right: 0, bottom: 0, left: 0).isZero, true);
      expect(const Spacing(top: 1, right: 0, bottom: 0, left: 0).isZero, false);
    });
  });

  group('CornerRadius', () {
    test('uniform', () {
      expect(const CornerRadius.all(8).uniform, 8);
    });
  });
}
