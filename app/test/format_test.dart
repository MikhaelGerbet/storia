import 'package:flutter_test/flutter_test.dart';
import 'package:storia/ui/format.dart';

void main() {
  final now = DateTime(2026, 10, 2, 21, 30);

  test('les dates se disent comme on les dit', () {
    expect(agoLabel(now.subtract(const Duration(seconds: 10)), now: now), 'à l’instant');
    expect(agoLabel(now.subtract(const Duration(minutes: 5)), now: now), 'il y a 5 min');
    expect(agoLabel(now.subtract(const Duration(hours: 2)), now: now), 'il y a 2 h');
    expect(agoLabel(DateTime(2026, 10, 1, 23), now: now), 'hier');
    expect(agoLabel(DateTime(2026, 9, 1, 10), now: now), 'le 1er septembre');
    expect(dayLabel(DateTime(2025, 12, 24), now: now), 'le 24 décembre 2025');
  });

  test('pluriels, durées et salutations', () {
    expect(plural(1, 'histoire'), '1 histoire');
    expect(plural(3, 'histoire'), '3 histoires');
    expect(durationLabel(const Duration(seconds: 45)), '45 s');
    expect(durationLabel(const Duration(minutes: 3, seconds: 5)), '3 min 05 s');
    expect(greeting(now: now), 'Bonsoir');
    expect(greeting(now: DateTime(2026, 10, 2, 9)), 'Bonjour');
  });
}
