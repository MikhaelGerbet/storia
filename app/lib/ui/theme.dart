// Le style de Storia : une nuit étoilée, une lumière de lanterne, des titres doux et ronds.
import 'package:flutter/material.dart';

abstract final class Palette {
  static const abyss = Color(0xFF060A14);
  static const night = Color(0xFF0B1226);
  static const surface = Color(0xFF111A2F);
  static const surfaceHigh = Color(0xFF18233D);
  static const surfaceTop = Color(0xFF223050);
  static const line = Color(0x1FFFFFFF);
  static const lineStrong = Color(0x33FFFFFF);
  static const text = Color(0xFFF2F4FA);
  static const textSoft = Color(0xFFB9C1D6);
  static const textMute = Color(0xFF8590AC);
  static const accent = Color(0xFFF2A65A);
  static const accentHot = Color(0xFFFF8748);
  static const accentInk = Color(0xFF2B1505);
  static const star = Color(0xFFFFD983);
  static const mint = Color(0xFF63D9A4);
  static const rose = Color(0xFFFF7D8C);
  static const sky = Color(0xFF8FBAFF);
  static const lilac = Color(0xFFB7A0FF);

  static const accentGradient = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFFFC27A), accent, accentHot]);
}

abstract final class Fonts {
  static const display = 'Fraunces';
  static const body = 'Nunito';
}

/// Les tailles de texte, du plus grand au plus petit.
abstract final class Txt {
  static const hero = TextStyle(fontFamily: Fonts.display, fontWeight: FontWeight.w900, fontSize: 46, height: 1.04, letterSpacing: -0.6, color: Palette.text);
  static const h1 = TextStyle(fontFamily: Fonts.display, fontWeight: FontWeight.w800, fontSize: 34, height: 1.1, letterSpacing: -0.4, color: Palette.text);
  static const h2 = TextStyle(fontFamily: Fonts.display, fontWeight: FontWeight.w800, fontSize: 25, height: 1.15, letterSpacing: -0.2, color: Palette.text);
  static const h3 = TextStyle(fontFamily: Fonts.display, fontWeight: FontWeight.w700, fontSize: 20, height: 1.2, color: Palette.text);
  static const lead = TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w600, fontSize: 18, height: 1.45, color: Palette.textSoft);
  static const body = TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w600, fontSize: 15.5, height: 1.45, color: Palette.textSoft);
  static const strong = TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w800, fontSize: 15.5, height: 1.35, color: Palette.text);
  static const small = TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w700, fontSize: 13, height: 1.3, color: Palette.textMute);
  static const label = TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w900, fontSize: 11.5, height: 1.2, letterSpacing: 1.4, color: Palette.textMute);
  static const button = TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w900, fontSize: 17, height: 1.1, letterSpacing: 0.1);
}

abstract final class Radii {
  static const card = 26.0;
  static const big = 32.0;
  static const pill = 999.0;
}

/// Largeur d'écran : téléphone, tablette, ordinateur.
enum ScreenSize { compact, medium, wide }

ScreenSize screenOf(BuildContext context) {
  final width = MediaQuery.sizeOf(context).width;
  return width < 640 ? ScreenSize.compact : (width < 1080 ? ScreenSize.medium : ScreenSize.wide);
}

/// Marges latérales selon la largeur.
double gutterOf(BuildContext context) => switch (screenOf(context)) { ScreenSize.compact => 18, ScreenSize.medium => 32, ScreenSize.wide => 48 };

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: Palette.accent, brightness: Brightness.dark).copyWith(
    primary: Palette.accent,
    onPrimary: Palette.accentInk,
    secondary: Palette.sky,
    surface: Palette.surface,
    onSurface: Palette.text,
    surfaceContainerHighest: Palette.surfaceTop,
    surfaceContainerHigh: Palette.surfaceHigh,
    surfaceContainer: Palette.surface,
    outline: Palette.lineStrong,
    outlineVariant: Palette.line,
    error: Palette.rose,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: Fonts.body, scaffoldBackgroundColor: Palette.abyss);
  return base.copyWith(
    textTheme: base.textTheme.apply(fontFamily: Fonts.body, bodyColor: Palette.text, displayColor: Palette.text),
    splashFactory: InkSparkle.splashFactory,
    tooltipTheme: const TooltipThemeData(
      textStyle: TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w700, fontSize: 13, color: Palette.text),
      decoration: BoxDecoration(color: Palette.surfaceTop, borderRadius: BorderRadius.all(Radius.circular(10))),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Palette.surfaceTop,
      contentTextStyle: Txt.strong,
      actionTextColor: Palette.accent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      elevation: 10,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Palette.surfaceHigh,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.big)),
      titleTextStyle: Txt.h2,
      contentTextStyle: Txt.body,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Palette.surface,
      modalBackgroundColor: Palette.surface,
      showDragHandle: true,
      dragHandleColor: Palette.lineStrong,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.big))),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Palette.surfaceHigh,
      hintStyle: Txt.body.copyWith(color: Palette.textMute),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: const BorderSide(color: Palette.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: const BorderSide(color: Palette.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: const BorderSide(color: Palette.accent, width: 2)),
    ),
    textSelectionTheme: const TextSelectionThemeData(cursorColor: Palette.accent, selectionColor: Color(0x55F2A65A)),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Palette.accentInk : Palette.textSoft),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Palette.accent : Palette.surfaceTop),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStatePropertyAll(Colors.white.withValues(alpha: 0.18)),
      radius: const Radius.circular(8),
      thickness: const WidgetStatePropertyAll(6),
    ),
  );
}
