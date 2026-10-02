import 'package:flutter/widgets.dart';

import 'data/app_model.dart';

/// Donne l'état de l'application à tous les écrans.
class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.model, required super.child});

  final AppModel model;

  static AppModel of(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.model;

  @override
  bool updateShouldNotify(AppScope oldWidget) => oldWidget.model != model;
}
