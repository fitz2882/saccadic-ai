import 'package:saccadic/src/core/types.dart';
import 'package:saccadic/src/feedback/fix_suggester.dart';
import 'package:test/test.dart';

void main() {
  late FixSuggester suggester;

  setUp(() {
    suggester = FixSuggester();
  });

  test('suggests color fix with Flutter Color syntax', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'heroSection',
      property: 'backgroundColor',
      expected: '#FF5733',
      actual: '#000000',
      severity: Severity.fail,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('Color(0xFFFF5733)'));
    expect(fix, contains('heroSection'));
  });

  test('suggests text color fix', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'title',
      property: 'color',
      expected: '#FFFFFF',
      actual: '#000000',
      severity: Severity.fail,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('TextStyle'));
    expect(fix, contains('Color(0xFFFFFFFF)'));
  });

  test('suggests fontSize fix', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'heading',
      property: 'fontSize',
      expected: '24',
      actual: '16',
      severity: Severity.fail,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('fontSize'));
    expect(fix, contains('24'));
    expect(fix, contains('TextStyle'));
  });

  test('suggests width fix with SizedBox', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'card',
      property: 'width',
      expected: '300',
      actual: '200',
      severity: Severity.fail,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('SizedBox'));
    expect(fix, contains('300'));
  });

  test('suggests borderRadius fix', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'button',
      property: 'borderRadius',
      expected: '12',
      actual: '8',
      severity: Severity.warn,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('BorderRadius.circular'));
    expect(fix, contains('12'));
  });

  test('suggests padding fix with EdgeInsets', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'container',
      property: 'paddingLeft',
      expected: '16',
      actual: '8',
      severity: Severity.fail,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('EdgeInsets'));
    expect(fix, contains('left'));
    expect(fix, contains('16'));
  });

  test('suggests fontWeight fix', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'label',
      property: 'fontWeight',
      expected: '700',
      actual: '400',
      severity: Severity.fail,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('FontWeight.w700'));
  });

  test('suggests gap fix', () {
    const mismatch = WidgetPropertyMismatch(
      widget: 'column',
      property: 'gap',
      expected: '16',
      actual: '8',
      severity: Severity.warn,
    );

    final fix = suggester.suggestFix(mismatch);

    expect(fix, contains('mainAxisSpacing'));
    expect(fix, contains('16'));
  });
}
