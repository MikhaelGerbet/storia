// Dates et nombres en français, sans dépendance.
const _months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/// « le 2 octobre », avec l'année si ce n'est pas celle-ci.
String dayLabel(DateTime date, {DateTime? now}) {
  final today = now ?? DateTime.now();
  final day = date.day == 1 ? '1er' : '${date.day}';
  return 'le $day ${_months[date.month - 1]}${date.year == today.year ? '' : ' ${date.year}'}';
}

/// « à l’instant », « il y a 5 min », « il y a 2 h », « hier », sinon la date.
String agoLabel(DateTime date, {DateTime? now}) {
  final current = now ?? DateTime.now();
  final elapsed = current.difference(date);
  if (elapsed.inSeconds < 45) return 'à l’instant';
  if (elapsed.inMinutes < 60) return 'il y a ${elapsed.inMinutes.clamp(1, 59)} min';
  if (elapsed.inHours < 24 && date.day == current.day) return 'il y a ${elapsed.inHours} h';
  final yesterday = DateTime(current.year, current.month, current.day).subtract(const Duration(days: 1));
  if (!date.isBefore(yesterday)) return 'hier';
  return dayLabel(date, now: current);
}

/// « 3 min 20 s », « 45 s ».
String durationLabel(Duration d) {
  final minutes = d.inMinutes;
  final seconds = d.inSeconds % 60;
  if (minutes == 0) return '$seconds s';
  return seconds == 0 ? '$minutes min' : '$minutes min ${seconds.toString().padLeft(2, '0')} s';
}

/// « 1 histoire », « 3 histoires ».
String plural(int n, String one, [String? many]) => '$n ${n > 1 ? (many ?? '${one}s') : one}';

/// Bonjour ou bonsoir, selon l'heure.
String greeting({DateTime? now}) {
  final hour = (now ?? DateTime.now()).hour;
  return hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour';
}
